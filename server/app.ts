// The routes, all under /api/ (ADR-002 point 1). A device is paired once by a parent with the
// family phrase (estate ADR-038); every other route but the health check and the push key
// needs its cookie.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clearedCookie, cookieToken, deviceCookie, newId, newToken, phraseMatches, tokenHash } from './auth.ts';
import { CLIP_MAX, CLIP_TYPES, TEXT_MAX, type ClipType } from './contract.ts';
import { transcribe } from './outbound.ts';
import { isPushEndpoint } from './push.ts';
import { startOfDay, startOfMonth, type Deps } from './service.ts';
import type { Device } from './store.ts';

const BODY_MAX = 3 * 1024 * 1024;
const CAST_MAX = 8;
const PAIR_TRIES = 5;
/** In all: a LAN client can make NPM forward any address it names, so the per-address limit alone can be dodged. */
const PAIR_TRIES_ALL = 20;
const ID = /^[a-z0-9-]{1,64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

class Refusal extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

interface Call {
  readonly deps: Deps;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly address: string;
  /** Starts the queue once a request is taken. */
  readonly kick: () => void;
}

/** A route answers with what it returns, as JSON, unless it sent its own answer. */
type Route = (call: Call) => unknown;

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

/** The JSON body, refused unless it says it is JSON (so no plain form can post here) and fits. */
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(;|$)/.test(req.headers['content-type'] ?? '')) throw new Refusal(415, 'json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_MAX) throw new Refusal(413, 'size');
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Refusal(400, 'json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Refusal(400, 'json');
  return value as Record<string, unknown>;
}

function pairedDevice({ deps, req }: Call): Device | null {
  const token = cookieToken(req.headers.cookie);
  return token === null ? null : deps.store.deviceByToken(tokenHash(token), deps.now());
}

function device(call: Call): Device {
  const found = pairedDevice(call);
  if (!found) throw new Refusal(401, 'unpaired');
  return found;
}

function id(value: unknown, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !ID.test(value)) throw new Refusal(400, 'choice');
  return value;
}

/** The clip's bytes stay base64 from the app to Gemini; only its decoded size is checked. */
function clip(value: unknown): { data: string; type: ClipType } | null {
  if (value === undefined || value === null) return null;
  const { data, type } = value as { data?: unknown; type?: unknown };
  if (typeof data !== 'string' || !data || !BASE64.test(data)) throw new Refusal(400, 'clip');
  if (!CLIP_TYPES.includes(type as ClipType)) throw new Refusal(400, 'clip');
  if (Math.floor((data.length * 3) / 4) > CLIP_MAX) throw new Refusal(413, 'clip');
  return { data, type: type as ClipType };
}

const routes: Record<string, Route> = {
  'GET /api/healthz': ({ deps }) => {
    deps.store.db.prepare('SELECT 1').get();
    return { ok: true };
  },

  /** Who this device is paired to, or whom it can be paired to. */
  'GET /api/me': (call) => {
    const found = pairedDevice(call);
    const { config } = call.deps;
    return found
      ? { paired: true, child: found.child, minutesPerStory: config.minutesPerStory }
      : { paired: false, children: config.children };
  },

  'POST /api/pair': async (call) => {
    const { deps, address, res } = call;
    const now = deps.now();
    const tries = deps.store.attempt(address, now, now - 3600_000);
    if (tries.mine > PAIR_TRIES || tries.all > PAIR_TRIES_ALL) {
      deps.log('pair-limited', { address });
      throw new Refusal(429, 'tries');
    }
    const { phrase, child } = await body(call.req);
    if (typeof child !== 'string' || !deps.config.children.includes(child)) throw new Refusal(400, 'child');
    if (typeof phrase !== 'string' || phrase.length > 200 || !(await phraseMatches(phrase, deps.config.phraseHash))) {
      deps.log('pair-refused', { address });
      throw new Refusal(403, 'phrase');
    }
    const token = newToken();
    const deviceId = newId();
    deps.store.addDevice(deviceId, tokenHash(token), child, now);
    deps.log('paired', { device: deviceId, child });
    send(res, 200, { paired: true, child, minutesPerStory: deps.config.minutesPerStory }, { 'Set-Cookie': deviceCookie(token) });
    return undefined;
  },

  'DELETE /api/pair': (call) => {
    const found = device(call);
    call.deps.store.removeDevice(found.id);
    call.deps.log('unpaired', { device: found.id });
    send(call.res, 204, undefined, { 'Set-Cookie': clearedCookie });
    return undefined;
  },

  'GET /api/requests': (call) => {
    const { child } = device(call);
    return {
      requests: call.deps.store.recent(child).map((r) => ({ id: r.id, state: r.state, mode: r.mode, kind: r.kind, title: r.title, route: r.route, created: r.created })),
    };
  },

  'POST /api/requests': async (call) => {
    const { deps } = call;
    const { child, id: deviceId } = device(call);
    const raw = await body(call.req);
    const mode = raw.mode;
    if (mode !== 'oma' && mode !== 'idee') throw new Refusal(400, 'mode');
    const kind = id(raw.kind);
    const place = id(raw.place, true);
    const cast = raw.cast === undefined ? [] : raw.cast;
    if (!Array.isArray(cast) || cast.length > CAST_MAX) throw new Refusal(400, 'choice');
    const castIds = cast.map((each) => id(each));
    const typed = raw.text === undefined ? '' : raw.text;
    if (typeof typed !== 'string' || typed.length > TEXT_MAX) throw new Refusal(400, 'text');
    const recording = clip(raw.clip);
    if (!typed.trim() && !recording) throw new Refusal(400, 'text');

    const now = deps.now();
    const { caps } = deps.config;
    if (deps.store.waiting() >= caps.queued) throw new Refusal(429, 'queue');
    if (deps.store.madeSince(startOfDay(now), child) >= caps.perChildPerDay) throw new Refusal(429, 'day');
    if (deps.store.madeSince(startOfMonth(now)) >= caps.perMonth) throw new Refusal(429, 'month');

    let heard = '';
    if (recording) {
      try {
        heard = await transcribe(recording.data, recording.type, deps.config.gemini, deps.send);
      } catch (error) {
        deps.log('transcribe-failed', { error: String(error) });
        throw new Refusal(502, 'transcribe');
      }
      if (!heard) throw new Refusal(422, 'speech');
    }
    const text = [typed.trim(), heard].filter(Boolean).join('\n\n');
    if (text.length > TEXT_MAX) throw new Refusal(400, 'text');

    const ahead = deps.store.waiting();
    const requestId = newId();
    deps.store.addRequest({ id: requestId, device: deviceId, child, mode, kind, place, cast: castIds.join(','), text, created: now });
    deps.log('requested', { request: requestId, child, mode, clip: recording !== null });
    send(call.res, 201, { id: requestId, minutes: deps.config.minutesPerStory * (ahead + 1) });
    call.kick();
    return undefined;
  },

  'GET /api/push/key': ({ deps }) => ({ key: deps.config.vapid.publicKey }),

  'POST /api/push': async (call) => {
    const found = device(call);
    const { endpoint } = await body(call.req);
    if (!isPushEndpoint(endpoint)) throw new Refusal(400, 'endpoint');
    call.deps.store.subscribe(endpoint, found.id, call.deps.now());
    send(call.res, 204);
    return undefined;
  },

  'GET /api/notices': (call) => {
    const found = device(call);
    return { notices: call.deps.store.takeNotices(found.id, call.deps.now()) };
  },
};

/** The request handler; `kick` runs after a story request is taken, to start the queue. */
export function handler(deps: Deps, kick: () => void = () => undefined): (req: IncomingMessage, res: ServerResponse) => void {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const started = Date.now();
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    const key = `${req.method ?? 'GET'} ${path}`;
    // nginx sets X-Real-IP from its real_ip module; nothing else reaches this port.
    const address = (req.headers['x-real-ip'] as string | undefined) ?? req.socket.remoteAddress ?? 'unknown';
    const route = routes[key];
    try {
      if (!route) throw new Refusal(404, 'route');
      const result = await route({ deps, req, res, address, kick });
      if (!res.headersSent) send(res, 200, result);
    } catch (error) {
      if (error instanceof Refusal) {
        send(res, error.status, { error: error.message });
      } else {
        deps.log('error', { route: key, error: String(error) });
        if (!res.headersSent) send(res, 500, { error: 'server' });
      }
    }
    if (path !== '/api/healthz') deps.log('http', { route: key.slice(0, 100), status: res.statusCode, ms: Date.now() - started });
  };
  return (req, res) => { void handle(req, res); };
}

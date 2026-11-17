import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../server/app.ts';
import { cookieToken, hashPhrase } from '../server/auth.ts';
import { readConfig, type Config } from '../server/config.ts';
import { run } from '../server/notify.ts';
import { isPushEndpoint, newVapidKeys, vapidHeader } from '../server/push.ts';
import { report, tick, type Deps } from '../server/service.ts';
import { Store } from '../server/store.ts';

const PHRASE = 'kuu all magab jänes';
const PUSH = 'https://web.push.apple.com/QGxvbmc';
let phraseHash = '';
let vapid = { publicKey: '', privateKey: '' };

beforeAll(() => {
  phraseHash = hashPhrase(PHRASE);
  vapid = newVapidKeys();
});

interface Outbound {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** Stands in for GitHub, Gemini and the push services; each answer is set per test. */
class Outside {
  readonly calls: Outbound[] = [];
  /** How many dispatches GitHub refuses before it takes one. */
  refusals = 0;
  runs: { display_title: string; status: string; conclusion: string | null }[] = [];
  heard = 'Jänes läheb kuu peale.';
  pushStatus = 201;

  readonly send = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    this.calls.push({ url, init });
    if (url.endsWith('/dispatches')) return Promise.resolve(new Response(null, { status: this.refusals-- > 0 ? 422 : 204 }));
    if (url.includes('/runs?')) return Promise.resolve(Response.json({ workflow_runs: this.runs }));
    if (url.includes('generativelanguage')) return Promise.resolve(Response.json({ outputs: [{ type: 'thought', summary: [] }, { type: 'text', text: this.heard }] }));
    return Promise.resolve(new Response(null, { status: this.pushStatus }));
  }) as typeof fetch;

  to(part: string): Outbound[] {
    return this.calls.filter((call) => call.url.includes(part));
  }
}

let clock = Date.UTC(2026, 10, 17, 10);
let outside: Outside;
let deps: Deps;
let server: Server;
let base = '';
const logs: string[] = [];
const catalogPath = join(mkdtempSync(join(tmpdir(), 'stories-catalog-')), 'catalog.json');
/** The family build's catalog as the deploy leaves it; `audio` is null until the reading is on the shelf. */
const deploy = (stories: { route: string; title: string; audio?: string | null }[]) => {
  writeFileSync(catalogPath, JSON.stringify({ stories: stories.map((story) => ({ audio: null, ...story })) }));
};
const SHA = 'a'.repeat(64);

function config(overrides: Record<string, string> = {}): Config {
  return readConfig({
    CHILDREN: 'Anni, Mia',
    FAMILY_PHRASE_HASH: phraseHash,
    GITHUB_TOKEN: 'test-token',
    GEMINI_API_KEY: 'test-key',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:stories@example.org',
    CATALOG_PATH: catalogPath,
    ...overrides,
  });
}

/** The same server with other settings, for the caps. */
function reconfigure(overrides: Record<string, string>): void {
  deps = { ...deps, config: config(overrides) };
  server.removeAllListeners('request');
  server.on('request', handler(deps));
}

beforeEach(async () => {
  outside = new Outside();
  deploy([]);
  logs.length = 0;
  deps = { config: config(), store: new Store(':memory:'), now: () => clock, send: outside.send, log: (event) => logs.push(event) };
  server = createServer(handler(deps));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  deps.store.db.close();
});

async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), 'X-Real-IP': '198.51.100.7' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown>, cookie: response.headers.get('set-cookie') };
}

async function pair(child = 'Anni'): Promise<string> {
  const { status, cookie } = await call('POST', '/api/pair', { phrase: PHRASE, child });
  expect(status).toBe(200);
  return `unejanku_device=${cookieToken(cookie ?? '') ?? ''}`;
}

const story = { mode: 'idee', kind: 'seiklus', place: 'mets', cast: ['janes', 'siil'], text: 'Jänes ja siil lähevad metsa.' };

describe('pairing', () => {
  it('pairs with the phrase, spaces and case aside, and sets an HttpOnly cookie', async () => {
    const { status, json, cookie } = await call('POST', '/api/pair', { phrase: '  Kuu all  MAGAB jänes ', child: 'Mia' });
    expect(status).toBe(200);
    expect(json).toMatchObject({ paired: true, child: 'Mia' });
    expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Strict; Path=\/api/);
    expect((await call('GET', '/api/me', undefined, `unejanku_device=${cookieToken(cookie ?? '') ?? ''}`)).json).toMatchObject({ paired: true, child: 'Mia' });
  });

  it('refuses a wrong phrase and a child it does not know', async () => {
    expect((await call('POST', '/api/pair', { phrase: 'vale lause', child: 'Anni' })).status).toBe(403);
    expect((await call('POST', '/api/pair', { phrase: PHRASE, child: 'Keegi' })).status).toBe(400);
    expect(deps.store.devices()).toHaveLength(0);
  });

  it('allows five tries an hour per address, the right phrase included', async () => {
    for (let i = 0; i < 5; i += 1) expect((await call('POST', '/api/pair', { phrase: 'vale', child: 'Anni' })).status).toBe(403);
    expect((await call('POST', '/api/pair', { phrase: PHRASE, child: 'Anni' })).status).toBe(429);
    clock += 3600_001;
    expect((await call('POST', '/api/pair', { phrase: PHRASE, child: 'Anni' })).status).toBe(200);
  });

  it('allows twenty tries an hour in all, whatever address each claims', async () => {
    for (let i = 0; i < 20; i += 1) {
      const response = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Real-IP': `198.51.100.${String(i)}` }, body: JSON.stringify({ phrase: 'vale', child: 'Anni' }) });
      expect(response.status).toBe(403);
    }
    expect((await call('POST', '/api/pair', { phrase: PHRASE, child: 'Anni' })).status).toBe(429);
  });

  it('refuses a body that is not JSON', async () => {
    const response = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'phrase=x' });
    expect(response.status).toBe(415);
  });

  it('tells an unpaired device whom it can be paired to', async () => {
    expect((await call('GET', '/api/me')).json).toEqual({ paired: false, children: ['Anni', 'Mia'] });
  });

  it('unpairs the device itself, and the operator unpairs one by id', async () => {
    const cookie = await pair();
    expect((await call('DELETE', '/api/pair', undefined, cookie)).status).toBe(204);
    expect((await call('GET', '/api/requests', undefined, cookie)).status).toBe(401);
    await pair('Mia');
    const [device] = deps.store.devices();
    expect(await run(['--unpair', device?.id ?? ''], () => deps, () => '')).toBe(0);
    expect(deps.store.devices()).toHaveLength(0);
  });
});

describe('requests', () => {
  it('refuses a request without a device cookie, or with an unknown one', async () => {
    expect((await call('POST', '/api/requests', story)).status).toBe(401);
    expect((await call('POST', '/api/requests', story, `unejanku_device=${'a'.repeat(43)}`)).status).toBe(401);
  });

  it('takes a request, says how long it takes, and lists it', async () => {
    const cookie = await pair();
    const { status, json } = await call('POST', '/api/requests', story, cookie);
    expect(status).toBe(201);
    expect(json.minutes).toBe(35);
    expect((await call('POST', '/api/requests', story, cookie)).json.minutes).toBe(70);
    const listed = (await call('GET', '/api/requests', undefined, cookie)).json.requests as { state: string }[];
    expect(listed.map((r) => r.state)).toEqual(['queued', 'queued']);
    expect(JSON.stringify(listed)).not.toContain('metsa');
  });

  it('refuses a choice that is not an id and text over the limit', async () => {
    const cookie = await pair();
    expect((await call('POST', '/api/requests', { ...story, kind: 'Seiklus!' }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/requests', { ...story, mode: 'muu' }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/requests', { ...story, text: 'a'.repeat(4001) }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/requests', { ...story, text: '  ' }, cookie)).status).toBe(400);
  });

  it('stops at three a day per child', async () => {
    const anni = await pair('Anni');
    const mia = await pair('Mia');
    reconfigure({ CAP_QUEUED: '10' });
    for (let i = 0; i < 3; i += 1) expect((await call('POST', '/api/requests', story, anni)).status).toBe(201);
    expect((await call('POST', '/api/requests', story, anni)).json).toEqual({ error: 'day' });
    expect((await call('POST', '/api/requests', story, mia)).status).toBe(201);
  });

  it('stops at the monthly cap for all', async () => {
    reconfigure({ CAP_PER_MONTH: '2', CAP_QUEUED: '10' });
    const anni = await pair('Anni');
    const mia = await pair('Mia');
    expect((await call('POST', '/api/requests', story, anni)).status).toBe(201);
    expect((await call('POST', '/api/requests', story, mia)).status).toBe(201);
    expect((await call('POST', '/api/requests', story, mia)).json).toEqual({ error: 'month' });
  });

  it('stops at five waiting in all', async () => {
    reconfigure({ CAP_PER_CHILD_PER_DAY: '10' });
    const anni = await pair();
    for (let i = 0; i < 5; i += 1) expect((await call('POST', '/api/requests', story, anni)).status).toBe(201);
    expect((await call('POST', '/api/requests', story, anni)).json).toEqual({ error: 'queue' });
  });

  it('turns a clip into text once and keeps no clip', async () => {
    const cookie = await pair();
    const data = Buffer.alloc(3000, 1).toString('base64');
    const { status } = await call('POST', '/api/requests', { ...story, text: '', clip: { data, type: 'audio/m4a' } }, cookie);
    expect(status).toBe(201);
    const [gemini] = outside.to('generativelanguage');
    expect(JSON.parse(gemini?.init?.body as string)).toMatchObject({ store: false, input: [{ type: 'text' }, { type: 'audio', data, mime_type: 'audio/m4a' }] });
    const saved = deps.store.first('queued');
    expect(saved?.text).toBe('Jänes läheb kuu peale.');
    expect(JSON.stringify(deps.store.db.prepare('SELECT * FROM requests').all())).not.toContain(data.slice(0, 40));
  });

  it('refuses a clip over 2 MB, of another type, or with no speech in it', async () => {
    const cookie = await pair();
    const big = Buffer.alloc(2 * 1024 * 1024 + 3).toString('base64');
    expect((await call('POST', '/api/requests', { ...story, clip: { data: big, type: 'audio/m4a' } }, cookie)).status).toBe(413);
    expect((await call('POST', '/api/requests', { ...story, clip: { data: 'AAAA', type: 'audio/mp4' } }, cookie)).status).toBe(400);
    outside.heard = '';
    expect((await call('POST', '/api/requests', { ...story, text: '', clip: { data: 'AAAA', type: 'audio/webm' } }, cookie)).json).toEqual({ error: 'speech' });
    expect(outside.to('generativelanguage')).toHaveLength(1);
  });

  it('refuses a body over 3 MB before reading it all', async () => {
    const cookie = await pair();
    const { status } = await call('POST', '/api/requests', { ...story, text: 'a'.repeat(3 * 1024 * 1024) }, cookie);
    expect(status).toBe(413);
  });
});

describe('the queue', () => {
  async function queued(count = 1): Promise<void> {
    const cookie = await pair();
    for (let i = 0; i < count; i += 1) await call('POST', '/api/requests', story, cookie);
  }

  it('starts one request at a time, with the request as the inputs', async () => {
    await queued(2);
    await tick(deps);
    await tick(deps);
    const dispatches = outside.to('/dispatches');
    expect(dispatches).toHaveLength(1);
    expect(JSON.parse(dispatches[0]?.init?.body as string)).toMatchObject({
      ref: 'main',
      inputs: { author: 'Anni', mode: 'idee', kind: 'seiklus', place: 'mets', cast: 'janes,siil', text: 'Jänes ja siil lähevad metsa.' },
    });
    expect(deps.store.inState('running')).toHaveLength(1);
  });

  it('fails a request GitHub refuses, tells the child, and starts the next', async () => {
    await queued(2);
    outside.refusals = 1;
    await tick(deps);
    expect(deps.store.inState('failed')).toHaveLength(1);
    expect(deps.store.inState('failed')[0]?.text).toBe('');
    expect(deps.store.inState('running')).toHaveLength(1);
    expect(deps.store.db.prepare("SELECT kind FROM notices").all()).toEqual([{ kind: 'failed' }]);
  });

  it('asks GitHub about a run that has not reported after the timeout, and fails it when it is over', async () => {
    await queued();
    await tick(deps);
    const [request] = deps.store.inState('running');
    clock += 89 * 60_000;
    await tick(deps);
    expect(outside.to('/runs?')).toHaveLength(0);
    clock += 2 * 60_000;
    outside.runs = [{ display_title: `Kids story ${request?.id ?? ''}`, status: 'in_progress', conclusion: null }];
    await tick(deps);
    expect(deps.store.inState('running')).toHaveLength(1);
    outside.runs = [{ display_title: `Kids story ${request?.id ?? ''}`, status: 'completed', conclusion: 'failure' }];
    await tick(deps);
    expect(deps.store.request(request?.id ?? '')?.state).toBe('failed');
  });

  it('fails a run still going after twice the timeout', async () => {
    await queued();
    await tick(deps);
    const [request] = deps.store.inState('running');
    outside.runs = [{ display_title: `Kids story ${request?.id ?? ''}`, status: 'in_progress', conclusion: null }];
    clock += 181 * 60_000;
    await tick(deps);
    expect(deps.store.request(request?.id ?? '')?.state).toBe('failed');
  });
});

describe('reports, the deploy and notices', () => {
  async function running(): Promise<{ id: string; cookie: string }> {
    const cookie = await pair();
    await call('POST', '/api/requests', story, cookie);
    await call('POST', '/api/push', { endpoint: PUSH }, cookie);
    await tick(deps);
    return { id: deps.store.inState('running')[0]?.id ?? '', cookie };
  }

  it('waits for the deploy after a commit, and notifies only routes in the catalog', async () => {
    const { id, cookie } = await running();
    expect(await run([id, 'committed', 'janes-ja-siil'], () => deps, () => '')).toBe(0);
    expect(deps.store.request(id)?.state).toBe('committed');
    expect(outside.calls.filter((c) => c.url === PUSH)).toHaveLength(0);

    deploy([{ route: 'muu-jutt', title: 'Muu' }]);
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('committed');

    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    expect(deps.store.request(id)).toMatchObject({ state: 'ready', title: 'Jänes ja siil', text: '' });
    const pushes = outside.calls.filter((c) => c.url === PUSH);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.init?.body).toBeUndefined();
    expect((await call('GET', '/api/notices', undefined, cookie)).json).toEqual({ notices: [{ kind: 'ready', route: 'janes-ja-siil', title: 'Jänes ja siil' }] });
    expect((await call('GET', '/api/notices', undefined, cookie)).json).toEqual({ notices: [] });
  });

  const kinds = () => deps.store.db.prepare('SELECT kind FROM notices ORDER BY id').all().map((row) => (row as { kind: string }).kind);

  it('tells the child when the text is on the shelf, and again when the reading is', async () => {
    const { id, cookie } = await running();
    await report(deps, id, 'committed', 'janes-ja-siil');
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('ready');
    expect((await call('GET', '/api/requests', undefined, cookie)).json.requests).toMatchObject([{ state: 'ready', route: 'janes-ja-siil' }]);
    await tick(deps);
    expect(kinds()).toEqual(['ready']);
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil', audio: SHA }]);
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('read');
    expect(kinds()).toEqual(['ready', 'read']);
    expect(outside.calls.filter((c) => c.url === PUSH)).toHaveLength(2);
    expect((await call('GET', '/api/notices', undefined, cookie)).json).toEqual({ notices: [
      { kind: 'ready', route: 'janes-ja-siil', title: 'Jänes ja siil' },
      { kind: 'read', route: 'janes-ja-siil', title: 'Jänes ja siil' },
    ] });
  });

  it('sends one notice when the first catalog already has the reading', async () => {
    const { id } = await running();
    await report(deps, id, 'committed', 'janes-ja-siil');
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil', audio: SHA }]);
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('read');
    expect(kinds()).toEqual(['read']);
  });

  it('ends silent, with no notice, when the reading fails after the text is on the shelf', async () => {
    const { id } = await running();
    await report(deps, id, 'committed', 'janes-ja-siil');
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    expect(await run([id, 'silent'], () => deps, () => '')).toBe(0);
    expect(deps.store.request(id)?.state).toBe('silent');
    expect(kinds()).toEqual(['ready']);
  });

  it('still tells the child about the text when the reading fails before its deploy', async () => {
    const { id, cookie } = await running();
    await report(deps, id, 'committed', 'janes-ja-siil');
    expect(await report(deps, id, 'silent', null)).toBe(true);
    expect((await call('GET', '/api/requests', undefined, cookie)).json.requests).toMatchObject([{ state: 'committed' }]);
    expect(kinds()).toEqual([]);
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    expect(deps.store.request(id)).toMatchObject({ state: 'silent', title: 'Jänes ja siil' });
    expect(kinds()).toEqual(['ready']);
  });

  it('ends silent when the reading never comes, and ignores silent for a running request', async () => {
    const { id } = await running();
    expect(await report(deps, id, 'silent', null)).toBe(false);
    await report(deps, id, 'committed', 'janes-ja-siil');
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    clock += 271 * 60_000;
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('silent');
    expect(kinds()).toEqual(['ready']);
  });

  it('starts the next request only when the last one has its reading', async () => {
    const { id, cookie } = await running();
    await call('POST', '/api/requests', story, cookie);
    await report(deps, id, 'committed', 'janes-ja-siil');
    await tick(deps);
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('ready');
    expect(outside.to('/dispatches')).toHaveLength(1);
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil', audio: SHA }]);
    await tick(deps);
    await tick(deps);
    expect(outside.to('/dispatches')).toHaveLength(2);
  });

  it('counts a story whose reading is coming as ahead of a new request', async () => {
    const { id, cookie } = await running();
    await report(deps, id, 'committed', 'janes-ja-siil');
    deploy([{ route: 'janes-ja-siil', title: 'Jänes ja siil' }]);
    await tick(deps);
    expect((await call('POST', '/api/requests', story, cookie)).json).toMatchObject({ minutes: 2 * deps.config.minutesPerStory });
  });

  it('tells the child at once when the job failed, and drops a subscription that is gone', async () => {
    const { id } = await running();
    outside.pushStatus = 410;
    await report(deps, id, 'failed', null);
    expect(deps.store.request(id)?.state).toBe('failed');
    expect(deps.store.subscriptionsOf('Anni')).toHaveLength(0);
  });

  it('keeps a report that lands while the queue asks GitHub about the run', async () => {
    const { id } = await running();
    clock += 91 * 60_000;
    outside.runs = [{ display_title: `Kids story ${id}`, status: 'completed', conclusion: 'success' }];
    const send = outside.send;
    deps = { ...deps, send: (async (input, init) => { await report(deps, id, 'committed', 'janes-ja-siil'); return send(input, init); }) };
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('committed');
  });

  it('fails a committed story that the deploy never brings', async () => {
    const { id } = await running();
    await report(deps, id, 'committed', 'janes-ja-siil');
    clock += 269 * 60_000;
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('committed');
    clock += 2 * 60_000;
    await tick(deps);
    expect(deps.store.request(id)?.state).toBe('failed');
  });

  it('refuses a VAPID subject push services would refuse', () => {
    expect(() => config({ VAPID_SUBJECT: 'stories@example.org' })).toThrow(/VAPID_SUBJECT/);
  });

  it('ignores a report for a request it does not know or that is done', async () => {
    const { id } = await running();
    expect(await run(['nosuchrequest', 'failed'], () => deps, () => '')).toBe(0);
    await report(deps, id, 'failed', null);
    expect(await report(deps, id, 'committed', 'x')).toBe(false);
  });

  it('refuses arguments that are not a report', async () => {
    expect(await run(['--x', 'committed'], () => deps, () => '')).toBe(2);
    expect(await run(['abc', 'done'], () => deps, () => '')).toBe(2);
    expect(await run(['abc', 'committed', 'Not A Route'], () => deps, () => '')).toBe(2);
  });

  it('stores only push endpoints of the known push services', async () => {
    const cookie = await pair();
    expect((await call('POST', '/api/push', { endpoint: 'https://example.org/push' }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/push', { endpoint: 'https://web.push.apple.com:8443/x' }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/push', { endpoint: PUSH }, cookie)).status).toBe(204);
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://fcm.googleapis.com.example.org/x')).toBe(false);
  });

  it('signs the VAPID token for the push service origin', () => {
    const header = vapidHeader(PUSH, deps.config.vapid, clock);
    const [, token = ''] = /^vapid t=([^,]+), k=/.exec(header) ?? [];
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'mailto:stories@example.org' });
    expect(Buffer.from(token.split('.')[2] ?? '', 'base64url')).toHaveLength(64);
  });
});

it('reads a story that was ready before the reading came apart as read', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'stories-db-')), 'state.db');
  const old = new Store(path);
  old.db.exec("PRAGMA user_version = 0; INSERT INTO requests (id, device, child, mode, kind, place, \"cast\", text, state, created) VALUES ('r1', 'd1', 'Anni', 'idee', 'seiklus', '', '', '', 'ready', 0)");
  old.db.close();
  const store = new Store(path);
  expect(store.request('r1')?.state).toBe('read');
  store.db.exec("UPDATE requests SET state = 'ready'");
  store.db.close();
  const again = new Store(path);
  expect(again.request('r1')?.state).toBe('ready');
  again.db.close();
});

it('answers the health check without a cookie', async () => {
  expect((await call('GET', '/api/healthz')).json).toEqual({ ok: true });
  expect((await call('GET', '/api/nothing')).status).toBe(404);
});

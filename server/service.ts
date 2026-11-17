// What happens to a request after it is made: the queue that starts one job at a time, the
// job's reports, the deploys that put the story's text and then its reading on the shelf, and
// the child's notices: one for the text, one for the reading.
import { readFileSync } from 'node:fs';
import { readConfig, type Config } from './config.ts';
import type { Notice } from './contract.ts';
import { dispatch, runState, type Fetch } from './outbound.ts';
import { sendPush } from './push.ts';
import { Store, type StoredState, type StoryRequest } from './store.ts';

export interface Deps {
  readonly config: Config;
  readonly store: Store;
  readonly now: () => number;
  /** Every outbound call goes through this, so the tests can stand in for GitHub, Gemini and the push services. */
  readonly send: Fetch;
  readonly log: (event: string, fields?: Record<string, unknown>) => void;
}

function jsonLog(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

/** The service and its command, from the environment. */
export function makeDeps(config: Config = readConfig()): Deps {
  return { config, store: new Store(config.dbPath), now: Date.now, send: fetch, log: jsonLog };
}

/** Leaves a notice for each of the child's devices and wakes them; drops subscriptions that are gone. */
async function announce(deps: Deps, request: StoryRequest, kind: Notice['kind']): Promise<void> {
  deps.store.notify(request, kind, deps.now());
  const results = await Promise.all(deps.store.subscriptionsOf(request.child).map(async ({ endpoint }) => {
    const result = await sendPush(endpoint, deps.config.vapid, deps.now(), deps.send);
    if (result === 'gone') deps.store.unsubscribe(endpoint);
    return result;
  }));
  deps.log('announced', { request: request.id, kind, pushes: results });
}

async function fail(deps: Deps, request: StoryRequest, reason: string): Promise<void> {
  if (!deps.store.finish(request.id, [request.state], 'failed')) return;
  deps.log('failed', { request: request.id, reason });
  await announce(deps, request, 'failed');
}

/** The states of a run that has not ended: its text or its reading is still to come. */
const UNFINISHED = ['running', 'committed', 'committed-silent', 'ready'] as const satisfies readonly StoredState[];

const age = (deps: Deps, request: StoryRequest) => deps.now() - (request.dispatched ?? request.created);

/**
 * One pass of the queue: a story the deployed catalog now lists is on the shelf, with or
 * without its reading; a run that has gone quiet past the timeout is asked about; and when no
 * run is unfinished the oldest queued request is started, so one run goes at a time from its
 * text to its reading (estate ADR-037 point 1). The job reports back through `notify.ts`; the
 * timeouts only cover a report or a deploy that never came.
 */
export async function tick(deps: Deps): Promise<void> {
  const timeout = deps.config.timeoutMinutes * 60_000;
  const shelving = (['committed', 'committed-silent', 'ready'] as const).flatMap((state) => deps.store.inState(state));
  if (shelving.length) {
    try {
      await deployed(deps, JSON.parse(readFileSync(deps.config.catalogPath, 'utf8')));
    } catch (error) {
      deps.log('catalog-unreadable', { error: String(error) });
    }
    // The deploys follow the commits within minutes; a story or a reading still missing long after is not coming.
    for (const request of shelving) {
      if (age(deps, request) <= 3 * timeout) continue;
      if (request.state === 'ready') {
        if (deps.store.finish(request.id, ['ready'], 'silent')) deps.log('silent', { request: request.id, reason: 'reading never deployed' });
      } else {
        await fail(deps, request, 'committed but never deployed');
      }
    }
  }
  for (const request of deps.store.inState('running')) {
    const waited = age(deps, request);
    if (waited < timeout) continue;
    let state;
    try {
      state = await runState(request, deps.config.github, deps.send);
    } catch (error) {
      deps.log('run-check-failed', { request: request.id, error: String(error) });
      continue;
    }
    // A run GitHub still shows as going is given one more timeout; its own job limits end it.
    if (state === 'running' && waited < 2 * timeout) continue;
    await fail(deps, request, `no report; run ${state}`);
  }
  if (UNFINISHED.some((state) => deps.store.inState(state).length)) return;
  for (let next = deps.store.first('queued'); next; next = deps.store.first('queued')) {
    try {
      await dispatch(next, deps.config.github, deps.send);
      deps.store.dispatched(next.id, deps.now());
      deps.log('dispatched', { request: next.id });
      return;
    } catch (error) {
      await fail(deps, next, String(error));
    }
  }
}

export type Outcome = 'committed' | 'failed' | 'silent';

/**
 * The job's report: `committed` the text, which waits for its deploy; `failed` tells the
 * child now; `silent` the reading did not come, and nobody is told: a story whose text is
 * not yet listed keeps it pending, so its text still gets its notice.
 */
export async function report(deps: Deps, id: string, outcome: Outcome, route: string | null): Promise<boolean> {
  const request = deps.store.request(id);
  const ignored = () => {
    deps.log('report-ignored', { request: id, outcome, state: request?.state ?? null });
    return false;
  };
  if (!request) return ignored();
  if (outcome === 'silent') {
    const to = request.state === 'committed' ? 'committed-silent' : request.state === 'ready' ? 'silent' : null;
    if (!to || !deps.store.finish(id, [request.state], to)) return ignored();
    deps.log('silent', { request: id, reason: 'job' });
    return true;
  }
  if (request.state !== 'running' && request.state !== 'queued') return ignored();
  if (outcome === 'committed' && route) {
    if (deps.store.finish(id, ['running', 'queued'], 'committed', { route })) deps.log('committed', { request: id, route });
  } else {
    await fail(deps, request, outcome === 'committed' ? 'committed without a route' : 'job failed');
  }
  return true;
}

/**
 * Moves each request on by what the deployed catalog lists: a committed story listed without
 * audio is `ready` (its text), with audio `read`; a `ready` one whose audio is now listed is
 * `read`; a `committed-silent` one listed is `silent`, with the text's notice. Each move tells
 * the child once.
 */
export async function deployed(deps: Deps, catalog: unknown): Promise<number> {
  const listed = new Map<string, { title: string; audio: boolean }>();
  const stories = (catalog as { stories?: unknown } | null)?.stories;
  if (!Array.isArray(stories)) throw new Error('the catalog has no stories list');
  for (const story of stories as { route?: unknown; title?: unknown; audio?: unknown }[]) {
    if (typeof story.route === 'string' && typeof story.title === 'string') listed.set(story.route, { title: story.title, audio: typeof story.audio === 'string' });
  }
  const moves = [
    ...deps.store.inState('committed').map((request) => ({ request, to: (entry: { audio: boolean }) => (entry.audio ? 'read' as const : 'ready' as const) })),
    ...deps.store.inState('committed-silent').map((request) => ({ request, to: () => 'silent' as const })),
    ...deps.store.inState('ready').map((request) => ({ request, to: (entry: { audio: boolean }) => (entry.audio ? 'read' as const : null) })),
  ];
  let moved = 0;
  for (const { request, to } of moves) {
    const entry = request.route === null ? undefined : listed.get(request.route);
    const state = entry && to(entry);
    if (!entry || !state || !deps.store.finish(request.id, [request.state], state, { title: entry.title })) continue;
    await announce(deps, request, state === 'read' ? 'read' : 'ready');
    moved += 1;
  }
  return moved;
}

/** Local midnight and the first of the month; the container runs in the family's time zone. */
export function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function startOfMonth(now: number): number {
  const day = new Date(startOfDay(now));
  day.setDate(1);
  return day.getTime();
}

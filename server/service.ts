// What happens to a request after it is made: the queue that starts one job at a time, the
// job's report, the deploy that puts the story on the shelf, and the notice for the child.
import { readFileSync } from 'node:fs';
import { readConfig, type Config } from './config.ts';
import type { Notice } from './contract.ts';
import { dispatch, runState, type Fetch } from './outbound.ts';
import { sendPush } from './push.ts';
import { Store, type StoryRequest } from './store.ts';

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

/**
 * One pass of the queue: a committed story that the deployed catalog now lists is ready, a run
 * that has gone quiet past the timeout is asked about, and when nothing is running the oldest
 * queued request is started. The job reports back through `notify.ts`; the timeout only covers
 * a report that never came.
 */
export async function tick(deps: Deps): Promise<void> {
  const timeout = deps.config.timeoutMinutes * 60_000;
  if (deps.store.inState('committed').length) {
    try {
      await deployed(deps, JSON.parse(readFileSync(deps.config.catalogPath, 'utf8')));
    } catch (error) {
      deps.log('catalog-unreadable', { error: String(error) });
    }
    // The deploy follows the commit within minutes; a story still missing long after is not coming.
    for (const request of deps.store.inState('committed')) {
      if (deps.now() - (request.dispatched ?? request.created) > 3 * timeout) await fail(deps, request, 'committed but never deployed');
    }
  }
  for (const request of deps.store.inState('running')) {
    const age = deps.now() - (request.dispatched ?? request.created);
    if (age < timeout) continue;
    let state;
    try {
      state = await runState(request, deps.config.github, deps.send);
    } catch (error) {
      deps.log('run-check-failed', { request: request.id, error: String(error) });
      continue;
    }
    // A run GitHub still shows as going is given one more timeout; its own job limits end it.
    if (state === 'running' && age < 2 * timeout) continue;
    await fail(deps, request, `no report; run ${state}`);
  }
  if (deps.store.inState('running').length) return;
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

/** The job's report: `committed` waits for the deploy, `failed` tells the child now. */
export async function report(deps: Deps, id: string, outcome: 'committed' | 'failed', route: string | null): Promise<boolean> {
  const request = deps.store.request(id);
  if (!request || (request.state !== 'running' && request.state !== 'queued')) {
    deps.log('report-ignored', { request: id, outcome, state: request?.state ?? null });
    return false;
  }
  if (outcome === 'committed' && route) {
    if (deps.store.finish(id, ['running', 'queued'], 'committed', { route })) deps.log('committed', { request: id, route });
  } else {
    await fail(deps, request, outcome === 'committed' ? 'committed without a route' : 'job failed');
  }
  return true;
}

/** Every committed request whose story the deployed catalog lists is ready. */
export async function deployed(deps: Deps, catalog: unknown): Promise<number> {
  const titles = new Map<string, string>();
  const stories = (catalog as { stories?: unknown } | null)?.stories;
  if (!Array.isArray(stories)) throw new Error('the catalog has no stories list');
  for (const story of stories as { route?: unknown; title?: unknown }[]) {
    if (typeof story.route === 'string' && typeof story.title === 'string') titles.set(story.route, story.title);
  }
  let ready = 0;
  for (const request of deps.store.inState('committed')) {
    const title = request.route === null ? undefined : titles.get(request.route);
    if (title === undefined) continue;
    if (!deps.store.finish(request.id, ['committed'], 'ready', { title })) continue;
    await announce(deps, request, 'ready');
    ready += 1;
  }
  return ready;
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

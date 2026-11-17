// The two services this one calls: GitHub, to start the job that makes a story and to ask
// about a run that has not reported (estate ADR-037), and Gemini, to turn a recorded idea
// into text (ADR-002 point 5).
import type { Config } from './config.ts';
import type { ClipType } from './contract.ts';
import type { StoryRequest } from './store.ts';

const GITHUB = 'https://api.github.com';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_REVISION = '2026-05-20';

export type Fetch = typeof fetch;

function githubHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

/** Starts the workflow for one request; throws with GitHub's answer when it is refused. */
export async function dispatch(request: StoryRequest, github: Config['github'], send: Fetch): Promise<void> {
  const response = await send(`${GITHUB}/repos/${github.repo}/actions/workflows/${github.workflow}/dispatches`, {
    method: 'POST',
    headers: { ...githubHeaders(github.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        request_id: request.id,
        author: request.child,
        mode: request.mode,
        kind: request.kind,
        place: request.place,
        cast: request.cast,
        text: request.text,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}: ${(await response.text()).slice(0, 500)}`);
}

type RunState = 'running' | 'success' | 'failed' | 'missing';

/** The state of the request's run, found by the run name the workflow gives it. */
export async function runState(request: StoryRequest, github: Config['github'], send: Fetch): Promise<RunState> {
  const since = new Date((request.dispatched ?? request.created) - 5 * 60_000).toISOString();
  const url = `${GITHUB}/repos/${github.repo}/actions/workflows/${github.workflow}/runs?event=workflow_dispatch&per_page=50&created=%3E%3D${since}`;
  const response = await send(url, { headers: githubHeaders(github.token), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`);
  const { workflow_runs: runs } = (await response.json()) as { workflow_runs: { display_title: string; status: string; conclusion: string | null }[] };
  const run = runs.find((each) => each.display_title.split(' ').at(-1) === request.id);
  if (!run) return 'missing';
  if (run.status !== 'completed') return 'running';
  return run.conclusion === 'success' ? 'success' : 'failed';
}

const TRANSCRIBE = [
  'This is a recording of a child, in Estonian, telling her idea for a bedtime story.',
  'Write down what she says, in Estonian, as she says it, with punctuation.',
  'Leave out hesitations and repeated words; add nothing of your own.',
  'If nothing in it is speech, answer with an empty string.',
].join(' ');

/** The words of a recorded idea. The clip is sent once and kept nowhere (store: false). */
export async function transcribe(clip: string, type: ClipType, gemini: Config['gemini'], send: Fetch): Promise<string> {
  const response = await send(GEMINI, {
    method: 'POST',
    headers: { 'x-goog-api-key': gemini.key, 'Content-Type': 'application/json', 'Api-Revision': GEMINI_REVISION },
    body: JSON.stringify({
      model: gemini.model,
      store: false,
      input: [{ type: 'text', text: TRANSCRIBE }, { type: 'audio', data: clip, mime_type: type }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Gemini answered ${String(response.status)}: ${(await response.text()).slice(0, 500)}`);
  return lastText(await response.json()).trim();
}

/** The last text block anywhere in the answer: the model's output, after any thoughts. */
function lastText(answer: unknown): string {
  let last = '';
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      const block = value as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') last = block.text;
      else Object.values(block).forEach(walk);
    }
  };
  walk(answer);
  return last;
}

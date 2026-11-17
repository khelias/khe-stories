// The service's settings, all from its environment (the homelab's .env); the family's names
// and phrase never live in this repo (rule 1).

export interface Config {
  readonly port: number;
  readonly dbPath: string;
  /** The family build's catalog, mounted read-only: a committed story is ready once it is listed. */
  readonly catalogPath: string;
  /** Who a device may be paired to: the authors the stories repo accepts. */
  readonly children: readonly string[];
  /** The family phrase as `scrypt:<salt>:<hash>`, base64url (`notify.ts --hash-phrase`). */
  readonly phraseHash: string;
  readonly github: { readonly token: string; readonly repo: string; readonly workflow: string };
  readonly gemini: { readonly key: string; readonly model: string };
  readonly vapid: { readonly publicKey: string; readonly privateKey: string; readonly subject: string };
  readonly caps: { readonly perChildPerDay: number; readonly perMonth: number; readonly queued: number };
  /** What the compose view tells a child to expect. */
  readonly minutesPerStory: number;
  /** After this, a request that has not reported is checked against the Actions API. */
  readonly timeoutMinutes: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** An unset or empty value takes the fallback, so compose can pass `${NAME:-}` through. */
function count(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} is not a whole number`);
  return value;
}

/** Push services refuse a VAPID token whose subject is not a mailto: or https: URL. */
function subject(value: string): string {
  if (!/^(mailto:|https:\/\/)/.test(value)) throw new Error('VAPID_SUBJECT is not a mailto: or https:// URL');
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: count(env, 'PORT', 3000),
    dbPath: env.DB_PATH ?? '/data/stories.db',
    catalogPath: env.CATALOG_PATH ?? '/app-build/catalog.json',
    children: required(env, 'CHILDREN').split(',').map((name) => name.trim()).filter(Boolean),
    phraseHash: required(env, 'FAMILY_PHRASE_HASH'),
    github: {
      token: required(env, 'GITHUB_TOKEN'),
      repo: env.GITHUB_REPO ?? 'khelias/khe-bunny-tales',
      workflow: env.GITHUB_WORKFLOW ?? 'kids-story.yml',
    },
    gemini: { key: required(env, 'GEMINI_API_KEY'), model: env.GEMINI_MODEL ?? 'gemini-4-hydrogen' },
    vapid: {
      publicKey: required(env, 'VAPID_PUBLIC_KEY'),
      privateKey: required(env, 'VAPID_PRIVATE_KEY'),
      subject: subject(required(env, 'VAPID_SUBJECT')),
    },
    caps: {
      perChildPerDay: count(env, 'CAP_PER_CHILD_PER_DAY', 3),
      perMonth: count(env, 'CAP_PER_MONTH', 25),
      queued: count(env, 'CAP_QUEUED', 5),
    },
    minutesPerStory: count(env, 'MINUTES_PER_STORY', 35),
    timeoutMinutes: count(env, 'TIMEOUT_MINUTES', 90),
  };
}

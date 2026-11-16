import { execFileSync } from 'node:child_process';
import type { BuildName } from '../src/content.ts';

/** The family build's e2e server; the public one is Playwright's base URL. */
export const FAMILY_PORT = 4242;
export const FAMILY_URL = `http://127.0.0.1:${String(FAMILY_PORT)}`;

export const E2E_OUT: Readonly<Record<BuildName, string>> = { public: 'output/e2e/public', family: 'output/e2e/family' };

/** A build of `content` into the directory the e2e server of that build serves. */
export function buildE2e(content: string, build: BuildName = 'public'): void {
  execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], {
    env: { ...process.env, STORIES_BUILD: build, STORIES_CONTENT: content, STORIES_OUT: E2E_OUT[build] },
    stdio: 'inherit',
  });
}

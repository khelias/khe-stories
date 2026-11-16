import { execFileSync } from 'node:child_process';

export const E2E_OUT = 'output/e2e/public';

/** A public build of `content` into the directory the e2e server serves. */
export function buildE2e(content: string): void {
  execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], {
    env: { ...process.env, STORIES_BUILD: 'public', STORIES_CONTENT: content, STORIES_OUT: E2E_OUT },
    stdio: 'inherit',
  });
}

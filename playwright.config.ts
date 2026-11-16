import { defineConfig, devices } from '@playwright/test';
import { FAMILY_PORT } from './e2e/build.ts';

// A server over each build of the demo stories, in output/e2e/public and output/e2e/family,
// written by e2e/global-setup.ts; the update test rebuilds into the same directory, so the
// specs run one at a time. The public build is the base URL; FAMILY_URL is the other.
const PORT = 4241;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node e2e/server.ts',
      port: PORT,
      env: { PORT: String(PORT), STORIES_BUILD: 'public', STORIES_ROOT: 'output/e2e/public' },
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node e2e/server.ts',
      port: FAMILY_PORT,
      env: { PORT: String(FAMILY_PORT), STORIES_BUILD: 'family', STORIES_ROOT: 'output/e2e/family' },
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});

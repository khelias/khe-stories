import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromePlugin } from './build/chrome.ts';
import { contentPlugin } from './build/content.ts';
import { serviceWorkerPlugin } from './build/sw.ts';
import { BUILDS, buildName } from './src/builds.ts';

// STORIES_BUILD picks the build: `public` for khe.ee/stories/, `family` for stories.khe.ee.
// STORIES_CONTENT is the content directory (docs/content.md), the demo stories by default;
// the private stories repo points it at its own exports. STORIES_OUT overrides output/<build>.
const build = buildName(process.env.STORIES_BUILD);
const { base } = BUILDS[build];
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const content = resolve(process.env.STORIES_CONTENT ?? here('./demo'));

export default defineConfig({
  root: here('./src'),
  base,
  publicDir: here('./public'),
  plugins: [chromePlugin(build), contentPlugin(build, base, content), serviceWorkerPlugin(build, base)],
  build: {
    outDir: resolve(process.env.STORIES_OUT ?? here(`./output/${build}`)),
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as viteBuild, type Plugin } from 'vite';
import type { Catalog, BuildName } from '../src/content.ts';

const SOURCE = fileURLToPath(new URL('../src/sw.ts', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
// Written for the deploy and crawlers, not the page.
const NOT_PRECACHED = new Set(['sw.js', 'catalog.json', 'robots.txt']);

/**
 * Writes `sw.js` beside the build: `src/sw.ts` with the shell's file list, the audio the
 * build's catalog holds and a version made from every file's content, so any change to the
 * shell is a new worker with new cache names.
 */
export function serviceWorkerPlugin(build: BuildName, base: string): Plugin {
  let precache: string[] = [];
  let audio: string[] = [];
  let version = '';
  let outDir = '';
  return {
    name: 'stories-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const hash = createHash('sha256');
        const outputs = Object.values(bundle).sort((a, b) => a.fileName.localeCompare(b.fileName));
        for (const output of outputs) {
          const source = output.type === 'chunk' ? output.code : output.source;
          if (output.fileName === 'catalog.json') {
            audio = (JSON.parse(String(source)) as Catalog).stories.map((story) => story.audio).filter((sha): sha is string => sha !== null);
          }
          hash.update(output.fileName);
          hash.update(source);
        }
        // Dotfiles (a stray .DS_Store) are refused by nginx and would fail the install.
        const publicFiles = readdirSync(PUBLIC_DIR).filter((file) => !file.startsWith('.')).sort();
        for (const file of publicFiles) {
          hash.update(file);
          hash.update(readFileSync(`${PUBLIC_DIR}${file}`));
        }
        version = hash.digest('hex').slice(0, 12);
        const shell = outputs.map(({ fileName }) => fileName).filter((name) => !NOT_PRECACHED.has(name) && name !== 'index.html');
        precache = ['', ...shell, ...publicFiles];
      },
    },
    async closeBundle(error) {
      if (error || !version) return;
      await viteBuild({
        configFile: false,
        logLevel: 'warn',
        define: {
          // workbox keeps its development messages behind this.
          'process.env.NODE_ENV': JSON.stringify('production'),
          __SW_VERSION__: JSON.stringify(version),
          __SW_BASE__: JSON.stringify(base),
          __SW_BUILD__: JSON.stringify(build),
          __SW_PRECACHE__: JSON.stringify(precache),
          __SW_AUDIO__: JSON.stringify(audio),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          minify: true,
          lib: { entry: SOURCE, formats: ['iife'], name: 'unejankuWorker', fileName: () => 'sw.js' },
        },
      });
    },
  };
}

import { copyFileSync, cpSync, rmSync } from 'node:fs';
import { buildE2e, FAMILY_CONTENT } from './build.ts';

export default function globalSetup(): void {
  buildE2e('demo', 'public');
  // The family build's content: the demo stories and the compose view's invented choices,
  // which the public build's content must not hold.
  rmSync(FAMILY_CONTENT, { recursive: true, force: true });
  cpSync('demo', FAMILY_CONTENT, { recursive: true });
  copyFileSync('e2e/compose.json', `${FAMILY_CONTENT}/compose.json`);
  buildE2e(FAMILY_CONTENT, 'family');
}

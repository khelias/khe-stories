import { buildE2e } from './build.ts';

export default function globalSetup(): void {
  buildE2e('demo');
}

// The operator's and the stories job's door into the service, run inside its container:
//   node notify.ts <request> committed|failed [route]   the job's report
//   node notify.ts --devices                            the paired devices
//   node notify.ts --unpair <device>                    revokes one
//   node notify.ts --hash-phrase < phrase               the FAMILY_PHRASE_HASH value
//   node notify.ts --vapid-keys                         a new VAPID key pair
// A committed story becomes ready when the deployed catalog lists it (service.ts `tick`).
import { readFileSync } from 'node:fs';
import { hashPhrase } from './auth.ts';
import { newVapidKeys } from './push.ts';
import { makeDeps, report, type Deps } from './service.ts';

const USAGE = 'usage: notify.ts <request> committed|failed [route] | --devices | --unpair <device> | --hash-phrase | --vapid-keys';
const ROUTE = /^[a-z0-9-]+$/;

export async function run(args: readonly string[], deps: () => Deps, stdin: () => string): Promise<number> {
  const [first, second, third] = args;
  switch (first) {
    case '--hash-phrase': {
      const phrase = stdin().trim();
      if (!phrase) return fail('no phrase on stdin');
      process.stdout.write(`${hashPhrase(phrase)}\n`);
      return 0;
    }
    case '--vapid-keys': {
      const keys = newVapidKeys();
      process.stdout.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`);
      return 0;
    }
    case '--devices':
      for (const device of deps().store.devices()) {
        process.stdout.write(`${device.id}\t${device.child}\tpaired ${new Date(device.created).toISOString()}\tseen ${new Date(device.seen).toISOString()}\n`);
      }
      return 0;
    case '--unpair':
      if (!second) return fail(USAGE);
      return deps().store.removeDevice(second) ? 0 : fail(`no device ${second}`);
    default: {
      if (!first || first.startsWith('-') || (second !== 'committed' && second !== 'failed')) return fail(USAGE);
      if (third !== undefined && !ROUTE.test(third)) return fail(`not a route: ${third}`);
      // An unknown or finished request is logged, not an error: the job's run should still pass.
      await report(deps(), first, second, third ?? null);
      return 0;
    }
  }
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 2;
}

if (import.meta.main) {
  let made: Deps | null = null;
  process.exitCode = await run(process.argv.slice(2), () => (made ??= makeDeps()), () => readFileSync(0, 'utf8'));
}

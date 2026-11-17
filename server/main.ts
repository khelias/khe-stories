// The service: the routes, and the queue every 30 seconds and after each new request.
import { createServer } from 'node:http';
import { handler } from './app.ts';
import { makeDeps, tick } from './service.ts';

const deps = makeDeps();
const { config } = deps;

let ticking: Promise<void> | null = null;
let again = false;
/** One pass at a time, so two passes never both see the queue idle and start two jobs. */
function runQueue(): void {
  if (ticking) {
    again = true;
    return;
  }
  ticking = tick(deps)
    .catch((error: unknown) => { deps.log('tick-failed', { error: String(error) }); })
    .finally(() => {
      ticking = null;
      if (again) {
        again = false;
        runQueue();
      }
    });
}

const server = createServer(handler(deps, runQueue));
server.requestTimeout = 120_000;
server.listen(config.port, () => { deps.log('listening', { port: config.port, children: config.children.length }); });
setInterval(runQueue, 30_000);
runQueue();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    deps.store.db.close();
    process.exit(0);
  });
}

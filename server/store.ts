// The service's state in one SQLite file (ADR-002 point 3): paired devices, their push
// subscriptions, the request queue, the notices waiting for a device, and recent pairing
// attempts. None of it is a story; losing it means pairing again.
import { DatabaseSync } from 'node:sqlite';
import type { Notice, RequestState } from './contract.ts';

export interface Device {
  readonly id: string;
  readonly child: string;
  readonly created: number;
  readonly seen: number;
}

export interface StoryRequest {
  readonly id: string;
  readonly device: string;
  readonly child: string;
  readonly mode: string;
  readonly kind: string;
  readonly place: string;
  readonly cast: string;
  readonly text: string;
  readonly state: RequestState;
  readonly route: string | null;
  readonly title: string | null;
  readonly created: number;
  readonly dispatched: number | null;
}

export interface Subscription {
  readonly endpoint: string;
  readonly device: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, child TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY, device TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, device TEXT NOT NULL, child TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL,
    place TEXT NOT NULL, "cast" TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, route TEXT, title TEXT, created INTEGER NOT NULL, dispatched INTEGER);
  CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT NOT NULL, request TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER);
  CREATE TABLE IF NOT EXISTS attempts (address TEXT NOT NULL, at INTEGER NOT NULL);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  addDevice(id: string, tokenHash: string, child: string, now: number): void {
    this.db.prepare('INSERT INTO devices (id, token_hash, child, created, seen) VALUES (?, ?, ?, ?, ?)').run(id, tokenHash, child, now, now);
  }

  deviceByToken(tokenHash: string, now: number): Device | null {
    const row = this.db.prepare('SELECT id, child, created, seen FROM devices WHERE token_hash = ?').get(tokenHash) as Device | undefined;
    if (row) this.db.prepare('UPDATE devices SET seen = ? WHERE id = ?').run(now, row.id);
    return row ?? null;
  }

  devices(): Device[] {
    return this.db.prepare('SELECT id, child, created, seen FROM devices ORDER BY created').all() as unknown as Device[];
  }

  /** Removes a device with its subscriptions and notices; true when there was one. */
  removeDevice(id: string): boolean {
    this.db.prepare('DELETE FROM subscriptions WHERE device = ?').run(id);
    this.db.prepare('DELETE FROM notices WHERE device = ?').run(id);
    return Number(this.db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes) > 0;
  }

  /** Records a pairing attempt and says how many were made since `since`, by this address and in all. */
  attempt(address: string, now: number, since: number): { mine: number; all: number } {
    this.db.prepare('DELETE FROM attempts WHERE at < ?').run(since);
    this.db.prepare('INSERT INTO attempts (address, at) VALUES (?, ?)').run(address, now);
    const row = this.db.prepare('SELECT COUNT(*) AS all_, SUM(address = ?) AS mine FROM attempts').get(address) as { all_: number; mine: number };
    return { mine: Number(row.mine), all: Number(row.all_) };
  }

  subscribe(endpoint: string, device: string, now: number): void {
    this.db.prepare('INSERT OR REPLACE INTO subscriptions (endpoint, device, created) VALUES (?, ?, ?)').run(endpoint, device, now);
  }

  unsubscribe(endpoint: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
  }

  subscriptionsOf(child: string): Subscription[] {
    return this.db.prepare('SELECT s.endpoint, s.device FROM subscriptions s JOIN devices d ON d.id = s.device WHERE d.child = ?').all(child) as unknown as Subscription[];
  }

  addRequest(request: Omit<StoryRequest, 'state' | 'route' | 'title' | 'dispatched'>): void {
    this.db.prepare('INSERT INTO requests (id, device, child, mode, kind, place, "cast", text, state, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'queued\', ?)')
      .run(request.id, request.device, request.child, request.mode, request.kind, request.place, request.cast, request.text, request.created);
  }

  request(id: string): StoryRequest | null {
    return (this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as StoryRequest | undefined) ?? null;
  }

  /** The oldest request in `state`. */
  first(state: RequestState): StoryRequest | null {
    return (this.db.prepare('SELECT * FROM requests WHERE state = ? ORDER BY created LIMIT 1').get(state) as StoryRequest | undefined) ?? null;
  }

  recent(child: string, limit = 10): StoryRequest[] {
    return this.db.prepare('SELECT * FROM requests WHERE child = ? ORDER BY created DESC LIMIT ?').all(child, limit) as unknown as StoryRequest[];
  }

  inState(state: RequestState): StoryRequest[] {
    return this.db.prepare('SELECT * FROM requests WHERE state = ? ORDER BY created').all(state) as unknown as StoryRequest[];
  }

  /** How many requests were made since `since`, by one child or in all. */
  madeSince(since: number, child?: string): number {
    const row = child === undefined
      ? this.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE created >= ?').get(since)
      : this.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE created >= ? AND child = ?').get(since, child);
    return Number((row as { n: number }).n);
  }

  waiting(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE state IN ('queued', 'running')").get() as { n: number }).n);
  }

  dispatched(id: string, now: number): void {
    this.db.prepare("UPDATE requests SET state = 'running', dispatched = ? WHERE id = ?").run(now, id);
  }

  /**
   * Moves a request on from one of the `from` states, so a report and the queue's own check
   * cannot overwrite each other; false when it had already moved. Once it is done its words
   * are no longer kept.
   */
  finish(id: string, from: readonly RequestState[], state: 'committed' | 'ready' | 'failed', fields: { route?: string | null; title?: string | null } = {}): boolean {
    const result = this.db.prepare(`UPDATE requests SET state = ?, route = COALESCE(?, route), title = COALESCE(?, title), text = '' WHERE id = ? AND state IN (${from.map(() => '?').join(', ')})`)
      .run(state, fields.route ?? null, fields.title ?? null, id, ...from);
    return Number(result.changes) > 0;
  }

  /** A notice for every device of the request's child. */
  notify(request: StoryRequest, kind: Notice['kind'], now: number): void {
    this.db.prepare('INSERT INTO notices (device, request, kind, created) SELECT id, ?, ?, ? FROM devices WHERE child = ?').run(request.id, kind, now, request.child);
  }

  /** The device's unseen notices, marked seen. */
  takeNotices(device: string, now: number): Notice[] {
    const rows = this.db.prepare('SELECT n.kind, r.route, r.title FROM notices n JOIN requests r ON r.id = n.request WHERE n.device = ? AND n.seen IS NULL ORDER BY n.id').all(device) as unknown as Notice[];
    this.db.prepare('UPDATE notices SET seen = ? WHERE device = ? AND seen IS NULL').run(now, device);
    return rows;
  }
}

// Ordered schema migrations (issue #10, stress G06).
//
// Each migration runs in its own transaction together with the row that records it in
// `schema_migrations`, so a failure leaves the schema exactly at the previous version. The
// coordinator refuses every request while any migration is pending or failed, and also when
// storage was written by a newer build than this one (a downgrade): it never serves a schema it
// does not understand. Each later issue appends its own numbered migration; released migrations
// are never edited, renamed or reordered.
//
// A failed state lasts for the life of the object instance: a transient failure keeps the project
// unavailable until the object restarts, which then retries the pending migration.
import { first, tableExists, type SqlPort, type StoragePort } from './sql.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Run one at a time, in order. One statement each: no `;`-joined batches. */
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'base',
    statements: [
      // The project itself: one row, written only by init (rule H11).
      `CREATE TABLE meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        project_id TEXT NOT NULL,
        recovery_epoch TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      // Every record in this project with its current version. References are resolved and
      // record versions compared against this table (stress A01, E01). Record-specific tables
      // arrive with the issues that own them.
      `CREATE TABLE records (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      // The ordered event log. `seq` is the rowid, so it is its own index, and AUTOINCREMENT
      // means a sequence number is never reused after older events are compacted.
      `CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        recovery_epoch TEXT NOT NULL,
        type TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_version INTEGER NOT NULL,
        actor TEXT NOT NULL,
        source TEXT NOT NULL,
        causal_request_id TEXT NOT NULL,
        server_time TEXT NOT NULL,
        payload TEXT NOT NULL
      )`,
      // Delivery intent, written in the same transaction as its event (rule H05, stress C03).
      `CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_seq INTEGER NOT NULL REFERENCES events (seq),
        state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX outbox_by_state_next_attempt ON outbox (state, next_attempt_at)',
      // Server-issued retry permits (rule H04). Issued and checked by #11.
      `CREATE TABLE command_windows (
        id TEXT PRIMARY KEY,
        principal_key TEXT NOT NULL,
        scope TEXT NOT NULL,
        recovery_epoch TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      'CREATE INDEX command_windows_by_principal ON command_windows (principal_key, expires_at)',
      // One receipt per committed command, keyed by who sent it (invariant 5).
      `CREATE TABLE command_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        principal_key TEXT NOT NULL,
        request_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'rejected')),
        result TEXT NOT NULL,
        first_seq INTEGER,
        last_seq INTEGER,
        -- Null only for project creation, which happens before any window can exist.
        command_window_id TEXT,
        created_at TEXT NOT NULL
      )`,
      'CREATE UNIQUE INDEX command_receipts_by_principal_request ON command_receipts (principal_key, request_id)',
    ],
  },
  {
    version: 2,
    name: 'receipt_retention',
    statements: [
      // Each receipt is kept until its window expires plus a grace period (#11, rule H04), and
      // records the scope its window held, so reading it later is checked against that scope.
      "ALTER TABLE command_receipts ADD COLUMN retain_until TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE command_receipts ADD COLUMN scope TEXT NOT NULL DEFAULT 'scope:member'",
      // Receipts written before this migration get the default retention from their creation
      // time (15-minute window plus a day of grace), in toISOString's format so comparisons hold.
      // A row whose creation time cannot be read keeps '' and counts as expired.
      `UPDATE command_receipts
         SET retain_until = coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+15 minutes', '+1 day'), '')
       WHERE retain_until = ''`,
      'CREATE INDEX command_receipts_by_retention ON command_receipts (retain_until)',
    ],
  },
  {
    version: 3,
    name: 'run_outbox',
    statements: [
      // The base outbox held one untargeted row per event, and nothing ever delivered it. Web
      // clients follow the event log by cursor (#13); the outbox exists for agent runs, whose
      // receipt must be durable (#12). Its old rows named no recipient, so they are dropped:
      // every event they pointed at stays in the log.
      'DROP TABLE outbox',
      // One row per inbox item addressed to a run, written in the same transaction as the change
      // that caused it (rule H05). `seq` is the item's position in that run's inbox. Rows are
      // never deleted by delivery: they end acked, stalled or cancelled.
      `CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL CHECK (seq >= 1),
        item_id TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL,
        item TEXT NOT NULL,
        recovery_epoch TEXT NOT NULL,
        causal_request_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'acked', 'stalled', 'cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TEXT NOT NULL,
        last_sent_at TEXT,
        settled_at TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL
      )`,
      'CREATE UNIQUE INDEX outbox_by_run_seq ON outbox (run_id, seq)',
      'CREATE INDEX outbox_by_run_state_due ON outbox (run_id, state, next_attempt_at)',
      // The last inbox position issued to each run, so a position is never reused, even after
      // settled rows are pruned by the retention policy (#73).
      `CREATE TABLE outbox_positions (
        run_id TEXT PRIMARY KEY,
        last_seq INTEGER NOT NULL CHECK (last_seq >= 1)
      )`,
    ],
  },
];

export type MigrationState =
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly version: number; readonly applied: readonly number[] }
  | { readonly status: 'failed'; readonly version: number; readonly reason: string };

/** The highest recorded migration, or 0 when storage has never been migrated. */
export function schemaVersion(sql: SqlPort): number {
  if (!tableExists(sql, 'schema_migrations')) return 0;
  return first(sql.exec<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations'))?.v ?? 0;
}

/**
 * Applies every pending migration in order. Returns `failed` instead of throwing, with the
 * schema left at the last migration that committed.
 */
export function applyMigrations(
  storage: StoragePort,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): MigrationState {
  const problem = checkList(migrations);
  if (problem !== undefined)
    return { status: 'failed', version: schemaVersion(storage.sql), reason: problem };
  const known = migrations.length;
  let version = schemaVersion(storage.sql);
  if (version > known) {
    return {
      status: 'failed',
      version,
      reason: `storage is at schema ${version}, this build knows ${known}`,
    };
  }
  // A released migration that was renamed or reordered means this build and the stored schema
  // disagree about history: refuse rather than guess.
  if (version > 0) {
    const stored = storage.sql
      .exec<{ version: number; name: string }>('SELECT version, name FROM schema_migrations ORDER BY version')
      .toArray();
    const mismatch = stored.find((row) => migrations[row.version - 1]?.name !== row.name);
    if (mismatch !== undefined) {
      return {
        status: 'failed',
        version,
        reason: `stored migration ${mismatch.version} does not match this build`,
      };
    }
  }
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    try {
      storage.transactionSync(() => {
        storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          )`,
        );
        for (const statement of migration.statements) storage.sql.exec(statement);
        storage.sql.exec(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          migration.version,
          migration.name,
          now(),
        );
      });
    } catch (error) {
      return {
        status: 'failed',
        version,
        reason: `migration ${migration.version} (${migration.name}) failed: ${describe(error)}`,
      };
    }
    version = migration.version;
    applied.push(migration.version);
  }
  return { status: 'ready', version, applied };
}

/** Versions must run 1, 2, 3 … in order, and each statement must be a single statement. */
function checkList(migrations: readonly Migration[]): string | undefined {
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) return `migration list is not numbered 1..n at ${migration.name}`;
    // The Durable Object API would run every statement in a ';'-joined batch; one per entry
    // keeps each one visible and keeps local tests and production behaving the same.
    if (migration.statements.some((statement) => statement.includes(';'))) {
      return `migration ${migration.version} joins statements with ';'`;
    }
  }
  return undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

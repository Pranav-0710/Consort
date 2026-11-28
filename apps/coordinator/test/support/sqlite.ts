// A StoragePort over Node's built-in SQLite, with the Durable Object semantics the coordinator
// relies on: one statement per exec, positional bindings, and transactionSync that rolls back
// every write when its callback throws. Like the Durable Object API, it refuses transaction
// statements from callers, so code cannot work here and fail in workerd for that reason.
// This is not workerd: behaviour specific to the Cloudflare runtime is not covered.
import { DatabaseSync } from 'node:sqlite';

import type { SqlCursor, SqlPort, SqlRow, SqlValue, StoragePort } from '../../src/db/sql.js';

const TRANSACTION_CONTROL = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

export interface TestStorage extends StoragePort {
  readonly db: DatabaseSync;
  /** True while a transactionSync callback is running. */
  readonly inTransaction: boolean;
}

export function memoryStorage(db = new DatabaseSync(':memory:')): TestStorage {
  let depth = 0;
  const totalChanges = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

  const sql: SqlPort = {
    exec<T extends SqlRow>(query: string, ...bindings: SqlValue[]): SqlCursor<T> {
      if (TRANSACTION_CONTROL.test(query))
        throw new Error('transaction statements are not allowed; use transactionSync');
      const before = totalChanges();
      const rows = db.prepare(query).all(...bindings) as T[];
      const rowsWritten = totalChanges() - before;
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
          return rows[0]!;
        },
        rowsWritten,
      };
    },
  };

  return {
    db,
    sql,
    get inTransaction() {
      return depth > 0;
    },
    transactionSync<T>(fn: () => T): T {
      const name = `tx${depth}`;
      db.exec(`SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        depth -= 1;
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw error;
      }
    },
  };
}

/** Row counts for every table, to prove a refusal wrote nothing. */
export function snapshot(db: DatabaseSync): Record<string, number> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n,
    ]),
  );
}

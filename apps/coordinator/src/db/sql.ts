// The storage the coordinator needs, as the smallest subset of the Durable Object SQLite API.
//
// Production passes `ctx.storage` straight through (do/project-coordinator.ts). Tests pass an
// adapter over Node's built-in SQLite with the same semantics: one statement per `exec`,
// positional `?` bindings, and `transactionSync` that rolls back everything when its callback
// throws. Keeping the mutation path behind this interface is what lets it be tested without
// workerd; it is not a second storage engine.

export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

export interface SqlCursor<T extends SqlRow> {
  toArray(): T[];
  /** Exactly one row, or throws. */
  one(): T;
  readonly rowsWritten: number;
}

export interface SqlPort {
  exec<T extends SqlRow = SqlRow>(query: string, ...bindings: SqlValue[]): SqlCursor<T>;
}

export interface StoragePort {
  readonly sql: SqlPort;
  /** Runs `fn` in one SQLite transaction. A throw rolls back every write it made. */
  transactionSync<T>(fn: () => T): T;
}

/** The first row, or undefined. */
export function first<T extends SqlRow>(cursor: SqlCursor<T>): T | undefined {
  return cursor.toArray()[0];
}

export function tableExists(sql: SqlPort, name: string): boolean {
  const row = first(
    sql.exec<{ n: number }>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
      name,
    ),
  );
  return row?.n === 1;
}

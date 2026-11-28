// Command receipts: retained outcomes that make retries safe (rules H04, H06; invariant 5).
//
// Every command that gets past membership, window and scope checks leaves a receipt: committed
// with its result and events, or rejected with its error. A receipt is bound to the principal,
// the window it was made under and the scope (and agent run) that window held:
//   - The same request ID with the same content under the same window returns that outcome and
//     writes nothing. Any rejection is final for that request ID.
//   - The same ID with different content, or under a different window, is refused with
//     request_id_conflict: the client reads the receipt instead of resending, so a request ID
//     never moves to a new window and never runs twice.
//   - One principal never sees another's receipt, and a receipt reads as unknown once the
//     reader's scope or run no longer matches the one it was made under.
// Each receipt is kept until its window expires plus a grace period. At the storage limits new
// commands are refused with limit_exceeded: a live receipt is never evicted early.
import { protocolError, type ProtocolError, type ReceiptStatus } from '@consort/protocol';

import { first, type SqlPort } from '../db/sql.js';

import { Rejection } from './errors.js';
import type { RetryConfig } from './windows.js';

interface ReceiptRow {
  readonly [column: string]: string | number | null;
  readonly command_type: string;
  readonly content_hash: string;
  readonly outcome: 'committed' | 'rejected';
  readonly result: string;
  readonly first_seq: number | null;
  readonly last_seq: number | null;
  readonly command_window_id: string | null;
  readonly scope: string;
  readonly created_at: string;
}

const COLUMNS =
  'command_type, content_hash, outcome, result, first_seq, last_seq, command_window_id, scope, created_at';

export type Retained =
  | {
      readonly outcome: 'committed';
      readonly events: readonly { readonly seq: number; readonly type: string }[];
      readonly result: Record<string, unknown>;
    }
  | { readonly outcome: 'rejected'; readonly error: ProtocolError };

/**
 * Removes receipts and windows that have outlived their use. Run in its own transaction before
 * a command, so a refused command's rollback cannot bring an expired row back.
 */
export function pruneExpired(sql: SqlPort, now: string): void {
  sql.exec('DELETE FROM command_receipts WHERE retain_until <= ?', now);
  sql.exec('DELETE FROM command_windows WHERE expires_at <= ?', now);
}

function eventsOf(sql: SqlPort, row: ReceiptRow): Array<{ seq: number; type: string }> {
  if (row.first_seq === null || row.last_seq === null) return [];
  return sql
    .exec<{ seq: number; type: string }>(
      'SELECT seq, type FROM events WHERE seq BETWEEN ? AND ? ORDER BY seq',
      row.first_seq,
      row.last_seq,
    )
    .toArray();
}

function retained(sql: SqlPort, row: ReceiptRow): Retained {
  return row.outcome === 'committed'
    ? {
        outcome: 'committed',
        events: eventsOf(sql, row),
        result: JSON.parse(row.result) as Record<string, unknown>,
      }
    : { outcome: 'rejected', error: JSON.parse(row.result) as ProtocolError };
}

function receiptFor(
  sql: SqlPort,
  principalKey: string,
  requestId: string,
  now: string,
): ReceiptRow | undefined {
  return first(
    sql.exec<ReceiptRow>(
      `SELECT ${COLUMNS} FROM command_receipts WHERE principal_key = ? AND request_id = ? AND retain_until > ?`,
      principalKey,
      requestId,
      now,
    ),
  );
}

/**
 * Called only after current membership, role, scope and window have passed again (E02).
 * Returns the retained outcome of an identical retry under the same window, refuses a reused
 * ID otherwise, and for a new request makes sure its receipt fits within the limits.
 */
export function checkRequest(
  sql: SqlPort,
  input: {
    readonly principalKey: string;
    readonly requestId: string;
    readonly contentHash: string;
    readonly windowId: string;
    readonly now: string;
    readonly config: RetryConfig;
  },
): Retained | undefined {
  const row = receiptFor(sql, input.principalKey, input.requestId, input.now);
  if (row !== undefined) {
    if (row.content_hash !== input.contentHash) {
      throw new Rejection(protocolError('request_id_conflict', { field: 'request_id' }));
    }
    if (row.command_window_id !== input.windowId) {
      throw new Rejection(protocolError('request_id_conflict', { field: 'command_window_id' }));
    }
    return retained(sql, row);
  }
  // An expired receipt under the same key can only remain if pruning failed. It no longer
  // counts, so it must not block this request's receipt.
  sql.exec(
    'DELETE FROM command_receipts WHERE principal_key = ? AND request_id = ? AND retain_until <= ?',
    input.principalKey,
    input.requestId,
    input.now,
  );
  const mine =
    first(
      sql.exec<{ n: number }>(
        'SELECT count(*) AS n FROM command_receipts WHERE principal_key = ? AND retain_until > ?',
        input.principalKey,
        input.now,
      ),
    )?.n ?? 0;
  if (mine >= input.config.maxLiveReceiptsPerPrincipal) {
    throw new Rejection(protocolError('limit_exceeded', { limit: input.config.maxLiveReceiptsPerPrincipal }));
  }
  const live =
    first(
      sql.exec<{ n: number }>('SELECT count(*) AS n FROM command_receipts WHERE retain_until > ?', input.now),
    )?.n ?? 0;
  if (live >= input.config.maxLiveReceipts) {
    throw new Rejection(protocolError('limit_exceeded', { limit: input.config.maxLiveReceipts }));
  }
  return undefined;
}

export function writeReceipt(
  sql: SqlPort,
  receipt: {
    readonly principalKey: string;
    readonly requestId: string;
    readonly commandType: string;
    readonly contentHash: string;
    readonly outcome: 'committed' | 'rejected';
    /** The result for a committed command, the error for a rejected one. */
    readonly body: object;
    readonly firstSeq: number | null;
    readonly lastSeq: number | null;
    readonly windowId: string | null;
    /** The window's scope (see windowScope), checked again when the receipt is read. */
    readonly scope: string;
    readonly now: string;
    readonly retainUntil: string;
  },
): void {
  sql.exec(
    `INSERT INTO command_receipts
      (principal_key, request_id, command_type, content_hash, outcome, result, first_seq, last_seq,
       command_window_id, scope, created_at, retain_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    receipt.principalKey,
    receipt.requestId,
    receipt.commandType,
    receipt.contentHash,
    receipt.outcome,
    JSON.stringify(receipt.body),
    receipt.firstSeq,
    receipt.lastSeq,
    receipt.windowId,
    receipt.scope,
    receipt.now,
    receipt.retainUntil,
  );
}

/**
 * The caller's own receipt, read under the caller's current scope and run. Anything else,
 * including another principal's receipt or one made under a scope or run the caller no longer
 * holds, is `unknown` (rule H06).
 */
export function receiptStatus(
  sql: SqlPort,
  input: {
    readonly principalKey: string;
    readonly requestId: string;
    readonly scope: string;
    readonly now: string;
  },
): ReceiptStatus {
  const row = receiptFor(sql, input.principalKey, input.requestId, input.now);
  if (row === undefined || row.scope !== input.scope)
    return { request_id: input.requestId, status: 'unknown' };
  const common = { request_id: input.requestId, command_type: row.command_type, recorded_at: row.created_at };
  const outcome = retained(sql, row);
  return outcome.outcome === 'committed'
    ? { ...common, status: 'committed', events: outcome.events.map((e) => e.seq), result: outcome.result }
    : { ...common, status: 'rejected', error: outcome.error };
}

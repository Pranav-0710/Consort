// Command receipts: retained outcomes that make retries safe (rules H04, H06; invariant 5).
//
// Every command that gets past membership, window and scope checks leaves a receipt: committed
// with its result and events, or rejected with its error. A retry with the same request ID and
// content returns that outcome and writes nothing; the same ID with different content is a
// conflict and never reinterprets the original. Receipts are keyed by principal, so one principal
// never sees another's. Each is kept until its window expires plus a grace period. At the storage
// limit new commands are refused with limit_exceeded: a live receipt is never evicted early.
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
  readonly created_at: string;
}

export type Retained =
  | {
      readonly outcome: 'committed';
      readonly events: readonly { readonly seq: number; readonly type: string }[];
      readonly result: Record<string, unknown>;
    }
  | { readonly outcome: 'rejected'; readonly error: ProtocolError };

/** A live receipt for this principal and request, or undefined. */
function liveReceipt(
  sql: SqlPort,
  principalKey: string,
  requestId: string,
  now: string,
): ReceiptRow | undefined {
  return first(
    sql.exec<ReceiptRow>(
      `SELECT command_type, content_hash, outcome, result, first_seq, last_seq, created_at
       FROM command_receipts WHERE principal_key = ? AND request_id = ? AND retain_until > ?`,
      principalKey,
      requestId,
      now,
    ),
  );
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

/**
 * Called only after current membership, window and scope have passed again (E02). Returns the
 * retained outcome of an identical retry, refuses a reused ID with different content, and
 * otherwise makes room for this command's receipt or refuses it at the limit.
 */
export function checkRequest(
  sql: SqlPort,
  input: {
    readonly principalKey: string;
    readonly requestId: string;
    readonly contentHash: string;
    readonly now: string;
    readonly config: RetryConfig;
  },
): Retained | undefined {
  // An expired receipt has outlived its window and grace period; its ID is never reused within a
  // valid window, because that window has also expired.
  sql.exec('DELETE FROM command_receipts WHERE retain_until <= ?', input.now);
  const row = first(
    sql.exec<ReceiptRow>(
      `SELECT command_type, content_hash, outcome, result, first_seq, last_seq, created_at
       FROM command_receipts WHERE principal_key = ? AND request_id = ?`,
      input.principalKey,
      input.requestId,
    ),
  );
  if (row !== undefined) {
    if (row.content_hash !== input.contentHash) {
      throw new Rejection(protocolError('request_id_conflict', { field: 'request_id' }));
    }
    return retained(sql, row);
  }
  const live = first(sql.exec<{ n: number }>('SELECT count(*) AS n FROM command_receipts'))?.n ?? 0;
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
    readonly now: string;
    readonly retainUntil: string;
  },
): void {
  sql.exec(
    `INSERT INTO command_receipts
      (principal_key, request_id, command_type, content_hash, outcome, result, first_seq, last_seq,
       command_window_id, created_at, retain_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    receipt.principalKey,
    receipt.requestId,
    receipt.commandType,
    receipt.contentHash,
    receipt.outcome,
    JSON.stringify(receipt.body),
    receipt.firstSeq,
    receipt.lastSeq,
    receipt.windowId,
    receipt.now,
    receipt.retainUntil,
  );
}

/** The caller's own receipt. Anything else, including another principal's, is `unknown`. */
export function receiptStatus(
  sql: SqlPort,
  principalKey: string,
  requestId: string,
  now: string,
): ReceiptStatus {
  const row = liveReceipt(sql, principalKey, requestId, now);
  if (row === undefined) return { request_id: requestId, status: 'unknown' };
  const common = { request_id: requestId, command_type: row.command_type, recorded_at: row.created_at };
  const outcome = retained(sql, row);
  return outcome.outcome === 'committed'
    ? { ...common, status: 'committed', events: outcome.events.map((e) => e.seq), result: outcome.result }
    : { ...common, status: 'rejected', error: outcome.error };
}

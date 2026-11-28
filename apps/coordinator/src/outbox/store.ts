// The run outbox's rows (issue #12; rules H05, H06, H10; stress C03, C04, C08, H05).
//
// A row is one inbox item addressed to one run, at a fixed position in that run's inbox. Its
// state only moves forward:
//   pending ──send──▶ sent ──cursor ack──▶ acked
//      │               │ └─no ack in time──▶ sent again, until maxAttempts, then stalled
//      └───────────────┴──revoked, out of scope or another epoch──▶ cancelled
// A send never acknowledges anything: only the run's cursor acknowledgement settles a row. Rows
// for a run with no live connection are not touched, so an offline adapter consumes no attempts.
// Delivery never deletes a row; pruning settled rows belongs to the retention policy (#73).
//
// Everything here runs inside a transaction the caller opened.
import { InboxItemSchema, protocolError, type InboxItem } from '@consort/protocol';

import { first, type SqlPort } from '../db/sql.js';
import { loadMeta, writeEvent, type ProjectMeta } from '../mutations/apply.js';
import { Rejection } from '../mutations/errors.js';
import { newId } from '../mutations/ids.js';
import type { Authority } from '../mutations/registry.js';

import { DEFAULT_OUTBOX_CONFIG, retryDelay, type OutboxConfig } from './config.js';
import type { OutboxDelivery } from './ports.js';

export type OutboxState = 'pending' | 'sent' | 'acked' | 'stalled' | 'cancelled';
export type CancelReason = 'revoked' | 'out_of_scope' | 'epoch_changed';

/** Rows still waiting to be delivered or settled by an acknowledgement. */
const OPEN = "('pending', 'sent', 'stalled')";
/** Rows the outbox still sends. A stalled row waits for an acknowledgement or an operator. */
const DUE = "('pending', 'sent')";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface EnqueueInput {
  readonly run_id: string;
  /** The package the item concerns, or `'project'` for an item about the whole project. */
  readonly scope: string;
  /** The item without the fields the outbox fills in. */
  readonly item: DistributiveOmit<InboxItem, 'item_id' | 'project_id' | 'run_id'>;
  /** The command whose transaction is enqueuing this item. */
  readonly causal_request_id: string;
  readonly now: string;
}

/**
 * Adds an inbox item for a run, inside the transaction of the change that caused it, so the
 * change and its delivery intent commit together (rule H05). Creates the item's `delivery`
 * record. Refuses the command with limit_exceeded when the run already holds too many unsettled
 * items (rule H10); nothing is evicted to make room.
 */
export function enqueueInboxItem(
  sql: SqlPort,
  input: EnqueueInput,
  config: Pick<OutboxConfig, 'maxOpenPerRun'> = DEFAULT_OUTBOX_CONFIG,
): { readonly item_id: string; readonly seq: number } {
  const meta = loadMeta(sql);
  if (meta === undefined) throw new Error('enqueueInboxItem: no project');
  const open =
    first(
      sql.exec<{ n: number }>(
        `SELECT count(*) AS n FROM outbox WHERE run_id = ? AND state IN ${OPEN}`,
        input.run_id,
      ),
    )?.n ?? 0;
  if (open >= config.maxOpenPerRun) {
    throw new Rejection(protocolError('limit_exceeded', { limit: config.maxOpenPerRun }));
  }
  const item_id = newId('inbox_item');
  // Throws on a malformed item, which rolls the whole command back.
  const item = InboxItemSchema.parse({
    ...input.item,
    item_id,
    project_id: meta.project_id,
    run_id: input.run_id,
  });
  const seq = sql
    .exec<{ last_seq: number }>(
      `INSERT INTO outbox_positions (run_id, last_seq) VALUES (?, 1)
       ON CONFLICT (run_id) DO UPDATE SET last_seq = last_seq + 1
       RETURNING last_seq`,
      input.run_id,
    )
    .one().last_seq;
  sql.exec(
    "INSERT INTO records (id, type, version, created_at, updated_at) VALUES (?, 'delivery', 1, ?, ?)",
    item_id,
    input.now,
    input.now,
  );
  sql.exec(
    `INSERT INTO outbox
      (run_id, seq, item_id, scope, item, recovery_epoch, causal_request_id, state, attempts,
       next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    input.run_id,
    seq,
    item_id,
    input.scope,
    JSON.stringify(item),
    meta.recovery_epoch,
    input.causal_request_id,
    input.now,
    input.now,
  );
  return { item_id, seq };
}

type DueRow = {
  readonly id: number;
  readonly seq: number;
  readonly item_id: string;
  readonly scope: string;
  readonly item: string;
  readonly recovery_epoch: string;
  readonly causal_request_id: string;
  readonly attempts: number;
};

export interface ClaimResult {
  /** Items to send now, in inbox order. Each is already recorded as sent. */
  readonly deliveries: readonly OutboxDelivery[];
  /** `delivery.stalled` events written by this claim. */
  readonly events: ReturnType<typeof writeEvent>[];
  readonly cancelled: number;
}

/**
 * Picks a connected run's due rows and records each as sent before it leaves, so the attempt is
 * counted even if the send never returns, and the retry is scheduled in storage, never in a
 * timer (rule H10). A row whose run is no longer authorized for it is cancelled instead, and a
 * row out of attempts becomes stalled with an `delivery.stalled` event (stress H05).
 */
export function claimDue(
  sql: SqlPort,
  input: {
    readonly meta: ProjectMeta;
    readonly runId: string;
    readonly authority: Authority;
    readonly now: Date;
    readonly config: OutboxConfig;
    readonly random: () => number;
  },
): ClaimResult {
  const now = input.now.toISOString();
  const rows = sql
    .exec<DueRow>(
      `SELECT id, seq, item_id, scope, item, recovery_epoch, causal_request_id, attempts
         FROM outbox
        WHERE run_id = ? AND state IN ${DUE} AND next_attempt_at <= ?
        ORDER BY seq
        LIMIT ?`,
      input.runId,
      now,
      input.config.batchSize,
    )
    .toArray();
  const deliveries: OutboxDelivery[] = [];
  const events: ReturnType<typeof writeEvent>[] = [];
  let cancelled = 0;
  for (const row of rows) {
    // Restored rows from an earlier incarnation are history, not instructions (rule H09).
    if (row.recovery_epoch !== input.meta.recovery_epoch) {
      cancelRow(sql, row.id, 'epoch_changed', now);
      cancelled += 1;
      continue;
    }
    if (!covers(input.authority, row.scope)) {
      cancelRow(sql, row.id, 'out_of_scope', now);
      cancelled += 1;
      continue;
    }
    if (row.attempts >= input.config.maxAttempts) {
      events.push(stall(sql, input.meta, row, input.runId, now));
      continue;
    }
    const attempts = row.attempts + 1;
    const next = new Date(
      input.now.getTime() + retryDelay(input.config, attempts, input.random),
    ).toISOString();
    sql.exec(
      "UPDATE outbox SET state = 'sent', attempts = ?, last_sent_at = ?, next_attempt_at = ? WHERE id = ?",
      attempts,
      now,
      next,
      row.id,
    );
    deliveries.push({
      run_id: input.runId,
      seq: row.seq,
      prev_seq: row.seq - 1,
      recovery_epoch: row.recovery_epoch,
      item: InboxItemSchema.parse(JSON.parse(row.item)),
    });
  }
  return { deliveries, events, cancelled };
}

/** Cancels every unsettled row of a run, for example when its credential is revoked (H06). */
export function cancelRun(sql: SqlPort, runId: string, reason: CancelReason, now: string): number {
  return sql.exec(
    `UPDATE outbox SET state = 'cancelled', cancel_reason = ?, settled_at = ?
      WHERE run_id = ? AND state IN ${OPEN}`,
    reason,
    now,
    runId,
  ).rowsWritten;
}

export type AckResult =
  | { readonly ok: true; readonly acked: number }
  | { readonly ok: false; readonly reason: 'beyond_last_position' };

/**
 * Settles every unsettled row of the run up to `seq`. The caller has verified the cursor and
 * the connection it came from (#13). A position the run was never given is refused, and an
 * acknowledgement below an earlier one changes nothing.
 */
export function acknowledge(sql: SqlPort, runId: string, seq: number, now: string): AckResult {
  const last = first(
    sql.exec<{ last_seq: number }>('SELECT last_seq FROM outbox_positions WHERE run_id = ?', runId),
  )?.last_seq;
  if (last === undefined || seq > last) return { ok: false, reason: 'beyond_last_position' };
  const acked = sql.exec(
    `UPDATE outbox SET state = 'acked', settled_at = ?
      WHERE run_id = ? AND seq <= ? AND state IN ${OPEN}`,
    now,
    runId,
    seq,
  ).rowsWritten;
  return { ok: true, acked };
}

/** Makes a run's unsettled, unstalled rows due now: a new connection needs all of them. */
export function makeDueNow(sql: SqlPort, runId: string, now: string): void {
  sql.exec(
    `UPDATE outbox SET next_attempt_at = ? WHERE run_id = ? AND state IN ${DUE} AND next_attempt_at > ?`,
    now,
    runId,
    now,
  );
}

/** Those of the given runs that have a row due now. */
export function dueRuns(sql: SqlPort, runIds: readonly string[], now: string): string[] {
  if (runIds.length === 0) return [];
  return sql
    .exec<{ run_id: string }>(
      `SELECT DISTINCT run_id FROM outbox
        WHERE state IN ${DUE} AND next_attempt_at <= ? AND run_id IN (SELECT value FROM json_each(?))
        ORDER BY run_id`,
      now,
      JSON.stringify(runIds),
    )
    .toArray()
    .map((row) => row.run_id);
}

/** The earliest retry among the given runs, or undefined when none of them has one. */
export function earliestDue(sql: SqlPort, runIds: readonly string[]): string | undefined {
  if (runIds.length === 0) return undefined;
  return (
    first(
      sql.exec<{ at: string | null }>(
        `SELECT min(next_attempt_at) AS at FROM outbox
          WHERE state IN ${DUE} AND run_id IN (SELECT value FROM json_each(?))`,
        JSON.stringify(runIds),
      ),
    )?.at ?? undefined
  );
}

/**
 * What the run's transport status shows (#25): unsettled items, how many of them stalled, and
 * how long the oldest has waited. Cancelled and acknowledged items are not pending.
 */
export interface OutboxStatus {
  readonly pending: number;
  readonly stalled: number;
  readonly oldest_pending_at?: string;
  readonly oldest_pending_age_ms?: number;
}

export function outboxStatus(sql: SqlPort, runId: string, now: Date): OutboxStatus {
  const row = first(
    sql.exec<{ pending: number; stalled: number; oldest: string | null }>(
      `SELECT count(*) AS pending,
              coalesce(sum(state = 'stalled'), 0) AS stalled,
              min(created_at) AS oldest
         FROM outbox WHERE run_id = ? AND state IN ${OPEN}`,
      runId,
    ),
  );
  const oldest = row?.oldest ?? undefined;
  return {
    pending: row?.pending ?? 0,
    stalled: row?.stalled ?? 0,
    ...(oldest === undefined
      ? {}
      : {
          oldest_pending_at: oldest,
          oldest_pending_age_ms: Math.max(0, now.getTime() - Date.parse(oldest)),
        }),
  };
}

/** Whether a credential's scope still covers a row's package, as the mutation path checks it. */
function covers(authority: Authority, scope: string): boolean {
  const allowed = authority.scope;
  if (allowed === 'project') return true;
  if (allowed === undefined || scope === 'project') return false;
  return allowed.has(scope);
}

function cancelRow(sql: SqlPort, id: number, reason: CancelReason, now: string): void {
  sql.exec(
    "UPDATE outbox SET state = 'cancelled', cancel_reason = ?, settled_at = ? WHERE id = ?",
    reason,
    now,
    id,
  );
}

function stall(
  sql: SqlPort,
  meta: ProjectMeta,
  row: DueRow,
  runId: string,
  now: string,
): ReturnType<typeof writeEvent> {
  sql.exec("UPDATE outbox SET state = 'stalled' WHERE id = ?", row.id);
  const version = sql
    .exec<{ version: number }>(
      'UPDATE records SET version = version + 1, updated_at = ? WHERE id = ? RETURNING version',
      now,
      row.item_id,
    )
    .one().version;
  return writeEvent(
    sql,
    meta,
    {
      type: 'delivery.stalled',
      record: { type: 'delivery', id: row.item_id, version },
      payload: { run_id: runId, item_id: row.item_id, seq: row.seq, attempts: row.attempts },
    },
    { actor: { kind: 'system' }, source: 'coordinator', request_id: row.causal_request_id, now },
  );
}

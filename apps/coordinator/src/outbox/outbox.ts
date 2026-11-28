// Delivers the run outbox: after each commit, on each alarm, and when a run connects (#12).
//
// A delivery pass, per connected run:
//   1. In one transaction: resolve the run's current standing (rule H06), cancel what it may no
//      longer receive, stall what ran out of attempts, and record the rest as sent with their
//      next retry time.
//   2. Outside it: hand each claimed item to the transport, in inbox order.
// Then the alarm is set to the earliest retry among connected runs, or cleared. Offline runs are
// left out of both steps, so their rows wait without consuming attempts or waking the object
// (stress C08). Because every retry time is in storage, a restarted object re-arms its alarm
// from the outbox alone (stress C03, rule H10).
import type { EventRecord } from '@consort/protocol';

import type { StoragePort } from '../db/sql.js';
import { loadMeta } from '../mutations/apply.js';
import type { AuthorityPort } from '../mutations/registry.js';

import type { OutboxConfig } from './config.js';
import type { AlarmPort, OutboxDelivery, RunTransport } from './ports.js';
import {
  acknowledge,
  cancelRun,
  claimDue,
  dueRuns,
  earliestDue,
  makeDueNow,
  outboxStatus,
  type AckResult,
  type CancelReason,
  type OutboxStatus,
} from './store.js';

export interface OutboxOptions {
  readonly storage: StoragePort;
  readonly authority: AuthorityPort;
  readonly transport: RunTransport;
  readonly alarm: AlarmPort;
  readonly config: OutboxConfig;
  readonly now: () => Date;
  readonly random: () => number;
  /** Receives events written by delivery itself (`delivery.stalled`), after their commit. */
  readonly published: (events: readonly EventRecord[]) => void;
  readonly report: (error: unknown) => void;
}

export class Outbox {
  readonly #o: OutboxOptions;

  constructor(options: OutboxOptions) {
    this.#o = options;
  }

  /** Sends everything due to every connected run, then re-arms the alarm. Never throws. */
  deliver(): void {
    const skipped = new Set<string>();
    let due: readonly string[] = [];
    try {
      due = dueRuns(this.#o.storage.sql, this.#connected(), this.#o.now().toISOString());
    } catch (error) {
      this.#o.report(error);
    }
    for (const runId of due) {
      if (!this.#deliverRun(runId)) skipped.add(runId);
    }
    this.rearm(skipped);
  }

  /** A run's adapter connected: everything it has not acknowledged is due now. */
  runConnected(runId: string): void {
    this.#write(() => makeDueNow(this.#o.storage.sql, runId, this.#o.now().toISOString()));
    this.deliver();
  }

  acknowledge(runId: string, seq: number): AckResult | undefined {
    const result = this.#write(() =>
      acknowledge(this.#o.storage.sql, runId, seq, this.#o.now().toISOString()),
    );
    this.rearm();
    return result;
  }

  cancelRun(runId: string, reason: CancelReason): number | undefined {
    const result = this.#write(() =>
      cancelRun(this.#o.storage.sql, runId, reason, this.#o.now().toISOString()),
    );
    this.rearm();
    return result;
  }

  status(runId: string): OutboxStatus {
    return outboxStatus(this.#o.storage.sql, runId, this.#o.now());
  }

  /**
   * Sets the alarm to the earliest retry among connected runs, never sooner than the minimum
   * delay, or clears it when nothing is due for anyone connected. `except` leaves out runs a
   * pass just skipped, so a run that cannot be served now does not keep waking the object.
   */
  rearm(except: ReadonlySet<string> = new Set()): void {
    try {
      const runs = this.#connected().filter((runId) => !except.has(runId));
      const at = earliestDue(this.#o.storage.sql, runs);
      if (at === undefined) {
        this.#o.alarm.clear();
        return;
      }
      const soonest = this.#o.now().getTime() + this.#o.config.minAlarmDelayMs;
      this.#o.alarm.set(Math.max(Date.parse(at), soonest));
    } catch (error) {
      this.#o.report(error);
    }
  }

  /** One run's pass. False when the run could not be served now and should not set the alarm. */
  #deliverRun(runId: string): boolean {
    const principal = this.#o.transport.connection(runId);
    if (principal === undefined) return false;
    const { storage } = this.#o;
    let claimed;
    try {
      claimed = storage.transactionSync(() => {
        const sql = storage.sql;
        const meta = loadMeta(sql);
        if (meta === undefined) return undefined;
        const now = this.#o.now();
        const standing = this.#o.authority.resolve(sql, principal);
        if (!standing.ok) {
          // Revoked, removed or otherwise refused: nothing more is released to this run (H06).
          cancelRun(sql, runId, 'revoked', now.toISOString());
          return { deliveries: [], events: [], cancelled: 0 };
        }
        if (standing.authority.run_id !== runId) {
          throw new Error('outbox: the connection is not bound to the run it was listed under');
        }
        return claimDue(sql, {
          meta,
          runId,
          authority: standing.authority,
          now,
          config: this.#o.config,
          random: this.#o.random,
        });
      });
    } catch (error) {
      // Nothing was claimed; the rows keep their retry times.
      this.#o.report(error);
      return false;
    }
    if (claimed === undefined) return false;
    if (claimed.events.length > 0) {
      try {
        this.#o.published(claimed.events);
      } catch (error) {
        this.#o.report(error);
      }
    }
    this.#send(claimed.deliveries);
    return true;
  }

  #send(deliveries: readonly OutboxDelivery[]): void {
    for (const delivery of deliveries) {
      try {
        this.#o.transport.send(delivery);
      } catch {
        // The connection went away. Every claimed row is recorded as sent with a retry time,
        // so the rest go out on the next connection or alarm, carrying the same positions.
        return;
      }
    }
  }

  #connected(): readonly string[] {
    try {
      return this.#o.transport.connectedRuns();
    } catch (error) {
      this.#o.report(error);
      return [];
    }
  }

  #write<T>(fn: () => T): T | undefined {
    try {
      return this.#o.storage.transactionSync(fn);
    } catch (error) {
      this.#o.report(error);
      return undefined;
    }
  }
}

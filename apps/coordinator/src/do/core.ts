// The project coordinator's logic, independent of the Durable Object runtime.
//
// ProjectCoordinator (project-coordinator.ts) wraps this class and passes it `ctx.storage`.
// Lifecycle:
//   - A fresh object has no tables. It stays empty, and every command gets project_not_found
//     with nothing written, until `init` creates the project (rule H11, stress G08). Touching an
//     ID never creates a project.
//   - An existing object applies pending migrations once at startup, inside
//     blockConcurrencyWhile. If a migration fails, or storage is newer than this build, every
//     request gets project_unavailable and nothing is written (stress G06).
// Every public method is synchronous and never throws: refusals and rolled-back failures come
// back as results.
import {
  isId,
  protocolError,
  validateCommandJson,
  type CommandWindow,
  type EventRecord,
  type ProtocolError,
  type ReceiptStatus,
} from '@consort/protocol';

import { applyMigrations, MIGRATIONS, type Migration, type MigrationState } from '../db/migrations.js';
import { tableExists, type SqlPort, type StoragePort } from '../db/sql.js';
import {
  loadMeta,
  Rejection,
  runMutation,
  writeEvent,
  type MutationOptions,
  type ProjectMeta,
} from '../mutations/apply.js';
import { newId } from '../mutations/ids.js';
import { isPrincipal, principalKey, type Principal } from '../mutations/principal.js';
import { pruneExpired, receiptStatus, writeReceipt } from '../mutations/receipts.js';
import type { Authority, MutationRegistry } from '../mutations/registry.js';
import { DEFAULT_RETRY_CONFIG, issueWindow, windowScope, type RetryConfig } from '../mutations/windows.js';
import { DEFAULT_OUTBOX_CONFIG, type OutboxConfig } from '../outbox/config.js';
import { Outbox } from '../outbox/outbox.js';
import { NO_ALARM, NO_TRANSPORT, type AlarmPort, type RunTransport } from '../outbox/ports.js';
import type { AckResult, CancelReason, OutboxStatus } from '../outbox/store.js';

export type ApplyResult =
  | {
      readonly ok: true;
      readonly request_id: string;
      readonly outcome: 'committed';
      readonly events: readonly { readonly seq: number; readonly type: string }[];
      readonly result: Record<string, unknown>;
      /** True when this is the retained outcome of an earlier identical request. */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly error: ProtocolError; readonly replayed?: true };

export type WindowResult =
  | { readonly ok: true; readonly window: CommandWindow }
  | { readonly ok: false; readonly error: ProtocolError };

export type ReceiptResult =
  | { readonly ok: true; readonly receipt: ReceiptStatus }
  | { readonly ok: false; readonly error: ProtocolError };

export interface InitInput {
  readonly project_id: string;
  /** The creating user, who #20 makes the first admin. */
  readonly created_by: string;
  /** The creating request, recorded as the cause of `project.created`. */
  readonly request_id: string;
}

export type InitResult =
  | { readonly ok: true; readonly project_id: string; readonly recovery_epoch: string }
  | { readonly ok: false; readonly reason: 'exists' | 'unavailable' };

export interface CoordinatorOptions {
  readonly registry: MutationRegistry;
  readonly migrations?: readonly Migration[];
  readonly now?: () => Date;
  /** Window duration, receipt grace period and storage limits. Provisional (#69). */
  readonly retry?: Partial<RetryConfig>;
  /**
   * Called only after a commit, with the events it wrote, for web subscribers (#13). The event
   * log already holds them, so a failure here loses nothing (stress C03).
   */
  readonly broadcast?: (events: readonly EventRecord[]) => void;
  /** Agent adapter connections (#13). Defaults to none, so nothing is sent. */
  readonly transport?: RunTransport;
  /** The object's alarm, which drives outbox retries (#12). */
  readonly alarm?: AlarmPort;
  /** Outbox retry timing and limits. Provisional (#69). */
  readonly outbox?: Partial<OutboxConfig>;
  /** Jitter source for retry delays, in [0, 1). Defaults to Math.random. */
  readonly random?: () => number;
  /**
   * Receives a failure that was rolled back and answered with internal_error. Defaults to
   * logging the error's name only, since messages can carry command content.
   */
  readonly reportError?: (error: unknown) => void;
}

type Standing = { readonly meta: ProjectMeta; readonly authority: Authority };

export class CoordinatorCore {
  readonly #storage: StoragePort;
  readonly #options: CoordinatorOptions;
  readonly #retry: RetryConfig;
  readonly #outbox: Outbox;
  #state: MigrationState = { status: 'empty' };

  constructor(storage: StoragePort, options: CoordinatorOptions) {
    this.#storage = storage;
    this.#options = options;
    this.#retry = { ...DEFAULT_RETRY_CONFIG, ...options.retry };
    this.#outbox = new Outbox({
      storage,
      authority: options.registry.authority,
      transport: options.transport ?? NO_TRANSPORT,
      alarm: options.alarm ?? NO_ALARM,
      config: { ...DEFAULT_OUTBOX_CONFIG, ...options.outbox },
      now: () => this.#now(),
      random: options.random ?? Math.random,
      published: (events) => this.#broadcast(events),
      report: (error) => this.#report(error),
    });
  }

  /**
   * Runs once per object start, inside blockConcurrencyWhile. Writes nothing to a fresh object.
   * Re-arms the delivery alarm from the outbox, since no timer survives a restart (rule H10).
   */
  start(): MigrationState {
    this.#state = tableExists(this.#storage.sql, 'schema_migrations')
      ? applyMigrations(this.#storage, this.#migrations, () => this.#nowIso())
      : { status: 'empty' };
    if (this.#state.status === 'ready') this.#outbox.rearm();
    return this.#state;
  }

  /** The alarm handler: sends every due outbox row to its connected run, then re-arms. */
  deliver(): void {
    if (this.#state.status === 'ready') this.#outbox.deliver();
  }

  /** A run's adapter connected (#13): it is sent everything it has not acknowledged. */
  runConnected(runId: string): void {
    if (this.#state.status === 'ready' && isId('run', runId)) this.#outbox.runConnected(runId);
  }

  /**
   * The run durably stored its inbox up to `seq`. #13 calls this only after verifying the
   * cursor and that it came from the run's current connection. Undefined when the object cannot
   * serve, or the write failed.
   */
  acknowledgeDelivery(runId: string, seq: number): AckResult | undefined {
    if (this.#state.status !== 'ready' || !isId('run', runId) || !Number.isSafeInteger(seq) || seq < 1) {
      return undefined;
    }
    return this.#outbox.acknowledge(runId, seq);
  }

  /** Stops delivery to a run, for example when its credential is revoked (#22). */
  cancelDeliveries(runId: string, reason: CancelReason): number | undefined {
    if (this.#state.status !== 'ready' || !isId('run', runId)) return undefined;
    return this.#outbox.cancelRun(runId, reason);
  }

  /** Unsettled items and the age of the oldest, for the run's transport status (#25). */
  deliveryStatus(runId: string): OutboxStatus | undefined {
    if (this.#state.status !== 'ready' || !isId('run', runId)) return undefined;
    return this.#outbox.status(runId);
  }

  get state(): MigrationState {
    return this.#state;
  }

  /** The only way to create a project. Generates a fresh random recovery epoch. */
  init(input: InitInput): InitResult {
    if (
      !isId('project', input.project_id) ||
      !isId('user', input.created_by) ||
      !isId('request', input.request_id)
    ) {
      throw new TypeError('init: malformed project, user or request id');
    }
    if (this.#state.status === 'failed') return { ok: false, reason: 'unavailable' };
    if (this.#state.status === 'empty') {
      this.#state = applyMigrations(this.#storage, this.#migrations, () => this.#nowIso());
      if (this.#state.status === 'failed') return { ok: false, reason: 'unavailable' };
    }
    const now = this.#now();
    const nowIso = now.toISOString();
    const creator = principalKey({ kind: 'human', user_id: input.created_by });
    const created = this.#storage.transactionSync(() => {
      const sql = this.#storage.sql;
      const existing = loadMeta(sql);
      if (existing !== undefined) {
        // A retry of the creating request learns the original result; anything else is refused.
        const retried = sql
          .exec<{ n: number }>(
            "SELECT count(*) AS n FROM command_receipts WHERE principal_key = ? AND request_id = ? AND command_type = 'project.init'",
            creator,
            input.request_id,
          )
          .one().n;
        return existing.project_id === input.project_id && retried > 0 ? { meta: existing } : undefined;
      }
      const meta = { project_id: input.project_id, recovery_epoch: newId('recovery_epoch') };
      sql.exec(
        'INSERT INTO meta (id, project_id, recovery_epoch, created_by, created_at) VALUES (1, ?, ?, ?, ?)',
        meta.project_id,
        meta.recovery_epoch,
        input.created_by,
        nowIso,
      );
      sql.exec(
        "INSERT INTO records (id, type, version, created_at, updated_at) VALUES (?, 'project', 1, ?, ?)",
        meta.project_id,
        nowIso,
        nowIso,
      );
      const event = writeEvent(
        sql,
        meta,
        { type: 'project.created', record: { type: 'project', id: meta.project_id, version: 1 } },
        {
          actor: { kind: 'human', user_id: input.created_by },
          source: 'human_action',
          request_id: input.request_id,
          now: nowIso,
        },
      );
      // No window exists before the project does; the receipt is kept as long as one would be.
      writeReceipt(sql, {
        principalKey: creator,
        requestId: input.request_id,
        commandType: 'project.init',
        contentHash: '',
        outcome: 'committed',
        body: {},
        firstSeq: event.seq,
        lastSeq: event.seq,
        windowId: null,
        // The creator's standing before membership exists: a member with no package scope.
        scope: windowScope({ role: 'admin', membership_policy_version: 0 }),
        now: nowIso,
        retainUntil: new Date(now.getTime() + this.#retry.windowMs + this.#retry.graceMs).toISOString(),
      });
      return { meta, event };
    });
    if (created === undefined) return { ok: false, reason: 'exists' };
    if ('event' in created) this.#afterCommit([created.event]);
    return { ok: true, project_id: created.meta.project_id, recovery_epoch: created.meta.recovery_epoch };
  }

  /** Issues a command window bound to the caller, its current scope and the recovery epoch. */
  issueCommandWindow(principal: unknown): WindowResult {
    this.#prune();
    return this.#withStanding(principal, (sql, acting, standing) => ({
      ok: true,
      window: issueWindow(sql, {
        principal: acting,
        authority: standing.authority,
        recoveryEpoch: standing.meta.recovery_epoch,
        now: this.#now(),
        config: this.#retry,
      }),
    }));
  }

  /**
   * The caller's own receipt for a request: committed, rejected or unknown. Current membership is
   * checked first, so a removed member learns nothing (rule H06, stress E02).
   */
  readReceipt(principal: unknown, requestId: unknown): ReceiptResult {
    if (!isId('request', requestId)) {
      return { ok: false, error: protocolError('invalid_envelope', { field: 'request_id' }) };
    }
    return this.#withStanding(principal, (sql, acting, standing) => ({
      ok: true,
      receipt: receiptStatus(sql, {
        principalKey: principalKey(acting),
        requestId,
        scope: windowScope(standing.authority),
        now: this.#nowIso(),
      }),
    }));
  }

  /**
   * Validates the command again (the Worker already did), then runs the mutation path in one
   * transaction. Responds and broadcasts only after that transaction has committed. A refusal
   * that came after the request-ID check is recorded as a rejected receipt, so a retry of the
   * same request gets the same answer.
   */
  applyCommand(principal: unknown, commandText: unknown): ApplyResult {
    if (!isPrincipal(principal)) return this.#internalError(new TypeError('malformed principal'));
    if (this.#state.status === 'failed') return refuse('project_unavailable');
    if (this.#state.status === 'empty') return refuse('project_not_found');
    if (typeof commandText !== 'string') {
      return { ok: false, error: protocolError('invalid_envelope', { field: 'command' }) };
    }
    const validated = validateCommandJson(commandText, { principal: principal.kind });
    if (!validated.ok) return { ok: false, error: validated.error };

    const acting: Principal = principal;
    const options: MutationOptions = { now: this.#nowIso(), retry: this.#retry, progress: {} };
    this.#prune(options.now);
    // The refusal is recorded before it leaves the callback, so recognising it does not depend
    // on transactionSync rethrowing the very same exception object.
    let refused: ProtocolError | undefined;
    let outcome;
    try {
      outcome = this.#storage.transactionSync(() => {
        try {
          return runMutation(this.#storage.sql, this.#options.registry, acting, validated.command, options);
        } catch (error) {
          if (error instanceof Rejection) refused = error.error;
          throw error;
        }
      });
    } catch (error) {
      if (refused === undefined) {
        // A bug, not a refusal. The transaction rolled back, so the outcome is known: nothing
        // changed. outcome_unknown is kept for a failed call to this object, where it is not.
        return this.#internalError(error);
      }
      this.#recordRejection(options, refused);
      return { ok: false, error: refused };
    }

    if (outcome.kind === 'replayed') {
      const retained = outcome.retained;
      return retained.outcome === 'committed'
        ? {
            ok: true,
            request_id: outcome.request_id,
            outcome: 'committed',
            events: retained.events,
            result: retained.result,
            replayed: true,
          }
        : { ok: false, error: retained.error, replayed: true };
    }
    this.#afterCommit(outcome.events);
    return {
      ok: true,
      request_id: outcome.request_id,
      outcome: 'committed',
      events: outcome.events.map((event) => ({ seq: event.seq, type: event.type })),
      result: outcome.result,
      replayed: false,
    };
  }

  /** Runs a read or window request after the same project and membership checks as a command. */
  #withStanding<T extends { readonly ok: boolean }>(
    principal: unknown,
    body: (sql: SqlPort, acting: Principal, standing: Standing) => T,
  ): T | { readonly ok: false; readonly error: ProtocolError } {
    if (!isPrincipal(principal)) return this.#internalError(new TypeError('malformed principal'));
    if (this.#state.status === 'failed') return refuse('project_unavailable');
    if (this.#state.status === 'empty') return refuse('project_not_found');
    let refused: ProtocolError | undefined;
    try {
      return this.#storage.transactionSync(() => {
        try {
          const sql = this.#storage.sql;
          const meta = loadMeta(sql);
          if (meta === undefined) throw new Rejection(protocolError('project_not_found'));
          const standing = this.#options.registry.authority.resolve(sql, principal);
          if (!standing.ok) throw new Rejection(standing.error);
          // An agent acts only through a run the authority port has verified (#24).
          if (principal.kind === 'agent_run' && standing.authority.run_id === undefined) {
            throw new Rejection(protocolError('identity_mismatch', { field: 'agent.run_id' }));
          }
          return body(sql, principal, { meta, authority: standing.authority });
        } catch (error) {
          if (error instanceof Rejection) refused = error.error;
          throw error;
        }
      });
    } catch (error) {
      if (refused !== undefined) return { ok: false, error: refused };
      return this.#internalError(error);
    }
  }

  /**
   * Removes expired receipts and windows in a transaction of its own, so a refused command's
   * rollback can never restore them. A failure here only delays the cleanup.
   */
  #prune(now = this.#nowIso()): void {
    // Only a schema this build understands is ever written: a failed, newer or empty object is
    // left exactly as it is (stress G06, rule H11).
    if (this.#state.status !== 'ready') return;
    try {
      this.#storage.transactionSync(() => pruneExpired(this.#storage.sql, now));
    } catch (failure) {
      this.#report(failure);
    }
  }

  /** Records a refusal as a rejected receipt, in its own transaction after the rollback. */
  #recordRejection(options: MutationOptions, error: ProtocolError): void {
    const pending = options.progress.receipt;
    if (pending === undefined) return;
    try {
      this.#storage.transactionSync(() => {
        // An expired receipt under the same key can only remain if pruning failed; it no longer
        // counts, so it must not block this one.
        this.#storage.sql.exec(
          'DELETE FROM command_receipts WHERE principal_key = ? AND request_id = ? AND retain_until <= ?',
          pending.principalKey,
          pending.requestId,
          options.now,
        );
        writeReceipt(this.#storage.sql, {
          ...pending,
          outcome: 'rejected',
          body: error,
          firstSeq: null,
          lastSeq: null,
          now: options.now,
        });
      });
    } catch (failure) {
      // The refusal still stands; without its receipt a retry is checked afresh.
      this.#report(failure);
    }
  }

  get #migrations(): readonly Migration[] {
    return this.#options.migrations ?? MIGRATIONS;
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }

  #report(error: unknown): void {
    const report =
      this.#options.reportError ??
      ((e: unknown) => console.error('coordinator failure', e instanceof Error ? e.name : 'unknown'));
    report(error);
  }

  #internalError(error: unknown): { readonly ok: false; readonly error: ProtocolError } {
    this.#report(error);
    return { ok: false, error: protocolError('internal_error') };
  }

  /** After a commit: tell web subscribers, then send whatever the commit queued for runs. */
  #afterCommit(events: readonly EventRecord[]): void {
    this.#broadcast(events);
    this.deliver();
  }

  #broadcast(events: readonly EventRecord[]): void {
    if (events.length === 0 || this.#options.broadcast === undefined) return;
    try {
      this.#options.broadcast(events);
    } catch (error) {
      // The event log is the durable record; subscribers catch up from it by cursor (#13).
      console.error('broadcast after commit failed', error instanceof Error ? error.name : 'unknown');
    }
  }
}

function refuse(code: 'project_unavailable' | 'project_not_found'): {
  readonly ok: false;
  readonly error: ProtocolError;
} {
  return { ok: false, error: protocolError(code) };
}

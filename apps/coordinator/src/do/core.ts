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
import { receiptStatus, writeReceipt } from '../mutations/receipts.js';
import type { Authority, MutationRegistry } from '../mutations/registry.js';
import { DEFAULT_RETRY_CONFIG, issueWindow, type RetryConfig } from '../mutations/windows.js';

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
   * Called only after a commit, with the events it wrote. Delivery itself is #13; the outbox
   * row already holds the intent, so a failure here loses nothing (stress C03).
   */
  readonly broadcast?: (events: readonly EventRecord[]) => void;
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
  #state: MigrationState = { status: 'empty' };

  constructor(storage: StoragePort, options: CoordinatorOptions) {
    this.#storage = storage;
    this.#options = options;
    this.#retry = { ...DEFAULT_RETRY_CONFIG, ...options.retry };
  }

  /** Runs once per object start, inside blockConcurrencyWhile. Writes nothing to a fresh object. */
  start(): MigrationState {
    this.#state = tableExists(this.#storage.sql, 'schema_migrations')
      ? applyMigrations(this.#storage, this.#migrations, () => this.#nowIso())
      : { status: 'empty' };
    return this.#state;
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
    return this.#withStanding(principal, (sql, acting) => ({
      ok: true,
      receipt: receiptStatus(sql, principalKey(acting), requestId, this.#nowIso()),
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

  /** Records a refusal as a rejected receipt, in its own transaction after the rollback. */
  #recordRejection(options: MutationOptions, error: ProtocolError): void {
    const pending = options.progress.receipt;
    if (pending === undefined) return;
    try {
      this.#storage.transactionSync(() =>
        writeReceipt(this.#storage.sql, {
          ...pending,
          outcome: 'rejected',
          body: error,
          firstSeq: null,
          lastSeq: null,
          now: options.now,
        }),
      );
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

  #afterCommit(events: readonly EventRecord[]): void {
    if (events.length === 0 || this.#options.broadcast === undefined) return;
    try {
      this.#options.broadcast(events);
    } catch (error) {
      // The outbox row is the durable intent; delivery is retried from it, never from here.
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

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
import {
  isId,
  protocolError,
  validateCommandJson,
  type EventRecord,
  type ProtocolError,
} from '@consort/protocol';

import { applyMigrations, MIGRATIONS, type Migration, type MigrationState } from '../db/migrations.js';
import { tableExists, type StoragePort } from '../db/sql.js';
import { loadMeta, Rejection, runMutation, writeEvent } from '../mutations/apply.js';
import { newId } from '../mutations/ids.js';
import { isPrincipal, principalKey, type Principal } from '../mutations/principal.js';
import type { MutationRegistry } from '../mutations/registry.js';

export type ApplyResult =
  | {
      readonly ok: true;
      readonly request_id: string;
      readonly outcome: 'committed';
      readonly events: readonly { readonly seq: number; readonly type: string }[];
      readonly result: Record<string, unknown>;
    }
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
  /**
   * Called only after a commit, with the events it wrote. Delivery itself is #13; the outbox
   * row already holds the intent, so a failure here loses nothing (stress C03).
   */
  readonly broadcast?: (events: readonly EventRecord[]) => void;
}

export class CoordinatorCore {
  readonly #storage: StoragePort;
  readonly #options: CoordinatorOptions;
  #state: MigrationState = { status: 'empty' };

  constructor(storage: StoragePort, options: CoordinatorOptions) {
    this.#storage = storage;
    this.#options = options;
  }

  /** Runs once per object start, inside blockConcurrencyWhile. Writes nothing to a fresh object. */
  start(): MigrationState {
    this.#state = tableExists(this.#storage.sql, 'schema_migrations')
      ? applyMigrations(this.#storage, this.#migrations, () => this.#now())
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
      this.#state = applyMigrations(this.#storage, this.#migrations, () => this.#now());
      if (this.#state.status === 'failed') return { ok: false, reason: 'unavailable' };
    }
    const now = this.#now();
    const created = this.#storage.transactionSync(() => {
      const sql = this.#storage.sql;
      if (loadMeta(sql) !== undefined) return undefined;
      const meta = { project_id: input.project_id, recovery_epoch: newId('recovery_epoch') };
      sql.exec(
        'INSERT INTO meta (id, project_id, recovery_epoch, created_by, created_at) VALUES (1, ?, ?, ?, ?)',
        meta.project_id,
        meta.recovery_epoch,
        input.created_by,
        now,
      );
      sql.exec(
        "INSERT INTO records (id, type, version, created_at, updated_at) VALUES (?, 'project', 1, ?, ?)",
        meta.project_id,
        now,
        now,
      );
      const actor = { kind: 'human', user_id: input.created_by } as const;
      const event = writeEvent(
        sql,
        meta,
        { type: 'project.created', record: { type: 'project', id: meta.project_id, version: 1 } },
        { actor, source: 'human_action', request_id: input.request_id, now },
      );
      sql.exec(
        `INSERT INTO command_receipts
          (principal_key, request_id, command_type, content_hash, outcome, result, first_seq, last_seq,
           command_window_id, created_at)
         VALUES (?, ?, 'project.init', '', 'committed', '{}', ?, ?, NULL, ?)`,
        principalKey({ kind: 'human', user_id: input.created_by }),
        input.request_id,
        event.seq,
        event.seq,
        now,
      );
      return { meta, event };
    });
    if (created === undefined) return { ok: false, reason: 'exists' };
    this.#afterCommit([created.event]);
    return { ok: true, ...created.meta };
  }

  /**
   * Validates the command again (the Worker already did), then runs the mutation path in one
   * transaction. Responds and broadcasts only after that transaction has committed.
   */
  applyCommand(principal: unknown, commandText: string): ApplyResult {
    if (!isPrincipal(principal)) throw new TypeError('applyCommand: malformed principal');
    if (this.#state.status === 'failed') return refuse('project_unavailable');
    if (this.#state.status === 'empty') return refuse('project_not_found');

    const validated = validateCommandJson(commandText, { principal: principal.kind });
    if (!validated.ok) return { ok: false, error: validated.error };

    const now = this.#now();
    const acting: Principal = principal;
    let committed;
    try {
      committed = this.#storage.transactionSync(() =>
        runMutation(this.#storage.sql, this.#options.registry, acting, validated.command, now),
      );
    } catch (error) {
      if (error instanceof Rejection) return { ok: false, error: error.error };
      throw error;
    }
    this.#afterCommit(committed.events);
    return {
      ok: true,
      request_id: committed.request_id,
      outcome: 'committed',
      events: committed.events.map((event) => ({ seq: event.seq, type: event.type })),
      result: committed.result,
    };
  }

  get #migrations(): readonly Migration[] {
    return this.#options.migrations ?? MIGRATIONS;
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  #afterCommit(events: readonly EventRecord[]): void {
    if (events.length === 0 || this.#options.broadcast === undefined) return;
    try {
      this.#options.broadcast(events);
    } catch {
      // The outbox row is the durable intent; delivery is retried from it, never from here.
    }
  }
}

function refuse(code: 'project_unavailable' | 'project_not_found'): ApplyResult {
  return { ok: false, error: protocolError(code) };
}

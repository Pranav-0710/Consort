// The single path every mutation follows (rule H01, invariant 4, issue #10).
//
// `runMutation` must be called inside `transactionSync`. It checks, in order:
//   0. the project exists, the command names it, and its recovery epoch is current
//   1. current membership or credential status (and that the request ID is unused)
//   2. the catalogue: principal kind, minimum role, and a registered handler
//   3. credential scope, for agents and collectors
//   4. every referenced ID resolves inside this project; then the ownership rule, which needs
//      resolved references
//   5. every expected version, including the authority versions
// then runs the handler and writes the canonical rows, receipt, events and outbox rows. Any
// refusal or throw rolls the whole transaction back, so nothing partial is ever visible. The
// caller responds and broadcasts only after the transaction has committed.
import {
  CATALOGUE,
  EventRecordSchema,
  idKind,
  protocolError,
  roleAtLeast,
  type AgentEnvelope,
  type CommandType,
  type ErrorCode,
  type EventRecord,
  type ExpectedVersionKey,
  type IdKind,
  type ProtocolError,
  type ValidatedCommand,
} from '@consort/protocol';

import { first, type SqlPort } from '../db/sql.js';

import { newId } from './ids.js';
import { actorFor, principalKey, sourceFor, type Principal } from './principal.js';
import type {
  Authority,
  CheckInput,
  EmittedEvent,
  HandlerDefinition,
  MutationContext,
  MutationRegistry,
} from './registry.js';

/** A refusal raised inside the transaction. Throwing it is what rolls the writes back. */
export class Rejection extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.code);
    this.name = 'Rejection';
  }
}

export interface Committed {
  readonly request_id: string;
  readonly events: readonly EventRecord[];
  readonly result: Record<string, unknown>;
}

export interface ProjectMeta {
  readonly project_id: string;
  readonly recovery_epoch: string;
}

/** ID kinds that name protocol machinery rather than project records. */
const NOT_RECORDS: ReadonlySet<IdKind> = new Set(['request', 'command_window', 'recovery_epoch']);

export function loadMeta(sql: SqlPort): ProjectMeta | undefined {
  return first(
    sql.exec<{ project_id: string; recovery_epoch: string }>(
      'SELECT project_id, recovery_epoch FROM meta WHERE id = 1',
    ),
  );
}

export function runMutation(
  sql: SqlPort,
  registry: MutationRegistry,
  principal: Principal,
  command: ValidatedCommand,
  now: string,
): Committed {
  // The handle every check and the handler use. It stops working when this function returns,
  // so code that tries to write later, outside the transaction, fails instead of writing.
  let open = true;
  const guarded: SqlPort = {
    exec: (query, ...bindings) => {
      if (!open) throw new Error('the mutation transaction has ended');
      return sql.exec(query, ...bindings);
    },
  };
  try {
    return run(guarded, registry, principal, command, now);
  } finally {
    open = false;
  }
}

function run(
  sql: SqlPort,
  registry: MutationRegistry,
  principal: Principal,
  command: ValidatedCommand,
  now: string,
): Committed {
  const envelope = command.envelope;

  // 0. The project. A command for an ID this object does not hold reveals nothing about it.
  const meta = loadMeta(sql);
  if (meta === undefined || meta.project_id !== envelope.project_id) reject('project_not_found');
  if (meta.recovery_epoch !== envelope.recovery_epoch) reject('recovery_epoch_mismatch', 'recovery_epoch');

  // 1. Current standing, loaded now rather than trusted from the session.
  const standing = registry.authority.resolve(sql, principal, command);
  if (!standing.ok) throw new Rejection(standing.error);
  const authority = standing.authority;

  const key = principalKey(principal);
  const used = first(
    sql.exec<{ n: number }>(
      'SELECT count(*) AS n FROM command_receipts WHERE principal_key = ? AND request_id = ?',
      key,
      envelope.request_id,
    ),
  );
  // Returning the retained outcome of an identical retry is #11; until then any reuse is refused.
  if ((used?.n ?? 0) > 0) reject('request_id_conflict', 'request_id');

  // 2. The catalogue. validateCommand already checked the principal kind; this is the second
  //    check the issue requires, against the same table.
  const entry = CATALOGUE[command.type];
  if (!entry.principals.includes(principal.kind)) reject('principal_not_allowed', 'type');
  if (!roleAtLeast(authority.role, entry.minRole)) reject('not_authorized', 'type');
  const handler = registry.handlerFor(command.type);
  if (handler === undefined) reject('command_unavailable', 'type');

  const input: CheckInput<CommandType> = { sql, principal, authority, command, payload: command.payload };

  // 3. Scope. A person's membership covers the project; a credential covers named packages.
  if (principal.kind !== 'human') checkScope(handler, input, authority);

  // 4. References, then ownership.
  const references = handler.references?.(command.payload) ?? collectIds(command.payload);
  for (const id of references) {
    if (!recordExists(sql, id)) reject('unknown_reference', 'payload');
  }
  for (const id of Object.keys(envelope.expected_versions.contract_versions ?? {})) {
    if (!recordExists(sql, id)) reject('unknown_reference', `expected_versions.contract_versions.${id}`);
  }
  if (entry.ownership !== 'none') {
    // createRegistry guarantees `authorize` exists for these commands.
    const refused = handler.authorize!(input);
    if (refused !== undefined) throw new Rejection(refused);
  }

  // 5. Expected versions.
  checkVersions(sql, handler, input, authority);

  // 6. The handler.
  const events: EmittedEvent[] = [];
  const context: MutationContext<CommandType> = {
    ...input,
    now,
    createRecord: (type, kind) => {
      const id = newId(kind);
      sql.exec(
        'INSERT INTO records (id, type, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
        id,
        type,
        now,
        now,
      );
      return { id, version: 1 };
    },
    bumpRecord: (id) => {
      sql.exec('UPDATE records SET version = version + 1, updated_at = ? WHERE id = ?', now, id);
      const row = first(sql.exec<{ version: number }>('SELECT version FROM records WHERE id = ?', id));
      if (row === undefined) throw new Error(`bumpRecord: no record ${id}`);
      return row.version;
    },
    emit: (event) => {
      events.push(event);
    },
    reject: (code, field) => reject(code, field),
  };
  const output: unknown = handler.apply(context);
  if (isThenable(output)) throw new Error(`${command.type}: handlers must be synchronous`);
  const result = (output as { result?: Record<string, unknown> } | undefined)?.result ?? {};

  // 7. Events, outbox rows and the receipt, in the same transaction as the change.
  const actor = actorFor(principal, (envelope as Partial<AgentEnvelope>).agent?.run_id);
  const written = events.map((event) =>
    writeEvent(sql, meta, event, {
      actor,
      source: sourceFor(principal.kind),
      request_id: envelope.request_id,
      now,
    }),
  );
  sql.exec(
    `INSERT INTO command_receipts
      (principal_key, request_id, command_type, content_hash, outcome, result, first_seq, last_seq,
       command_window_id, created_at)
     VALUES (?, ?, ?, ?, 'committed', ?, ?, ?, ?, ?)`,
    key,
    envelope.request_id,
    command.type,
    command.contentHash,
    JSON.stringify(result),
    written[0]?.seq ?? null,
    written.at(-1)?.seq ?? null,
    envelope.command_window_id,
    now,
  );
  return { request_id: envelope.request_id, events: written, result };
}

/** Writes one event and its outbox row. Used by commands and by project creation. */
export function writeEvent(
  sql: SqlPort,
  meta: ProjectMeta,
  event: EmittedEvent,
  origin: {
    readonly actor: EventRecord['actor'];
    readonly source: EventRecord['source'];
    readonly request_id: string;
    readonly now: string;
  },
): EventRecord {
  // An event must describe the record as it now stands, never a version nobody wrote.
  const row = first(
    sql.exec<{ type: string; version: number }>(
      'SELECT type, version FROM records WHERE id = ?',
      event.record.id,
    ),
  );
  if (row === undefined || row.type !== event.record.type || row.version !== event.record.version) {
    throw new Error(`event ${event.type} does not match record ${event.record.id}`);
  }
  const payload = JSON.stringify(event.payload ?? {});
  const actor = JSON.stringify(origin.actor);
  sql.exec(
    `INSERT INTO events
      (recovery_epoch, type, record_type, record_id, record_version, actor, source, causal_request_id,
       server_time, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    meta.recovery_epoch,
    event.type,
    event.record.type,
    event.record.id,
    event.record.version,
    actor,
    origin.source,
    origin.request_id,
    origin.now,
    payload,
  );
  const seq = sql.exec<{ seq: number }>('SELECT last_insert_rowid() AS seq').one().seq;
  sql.exec(
    "INSERT INTO outbox (event_seq, state, attempts, next_attempt_at, created_at) VALUES (?, 'pending', 0, ?, ?)",
    seq,
    origin.now,
    origin.now,
  );
  // Throws on a malformed event, which rolls the transaction back.
  return EventRecordSchema.parse({
    seq,
    recovery_epoch: meta.recovery_epoch,
    type: event.type,
    record: event.record,
    actor: origin.actor,
    source: origin.source,
    causal_request_id: origin.request_id,
    server_time: origin.now,
    payload: event.payload ?? {},
  });
}

function checkScope(
  handler: HandlerDefinition<CommandType>,
  input: CheckInput<CommandType>,
  authority: Authority,
) {
  // createRegistry guarantees `scope` exists for commands non-human principals may send.
  const packages = handler.scope!(input);
  const allowed = authority.scope;
  for (const id of packages) {
    if (allowed === undefined || !allowed.has(id)) reject('not_authorized', 'payload');
  }
}

function checkVersions(
  sql: SqlPort,
  handler: HandlerDefinition<CommandType>,
  input: CheckInput<CommandType>,
  authority: Authority,
) {
  const expected = input.command.envelope.expected_versions;
  const declared = handler.versions?.(input) ?? {};
  for (const key of Object.keys(expected) as ExpectedVersionKey[]) {
    const field = `expected_versions.${key}`;
    switch (key) {
      case 'record_version': {
        if (handler.target === undefined) reject('invalid_envelope', field);
        const id = handler.target(input.payload);
        const current = recordVersion(sql, id);
        if (current === undefined) reject('unknown_reference', 'payload');
        if (current !== expected.record_version) reject('stale_version', field);
        break;
      }
      case 'membership_policy_version':
        if (authority.membership_policy_version !== expected.membership_policy_version) {
          reject('authority_changed', field);
        }
        break;
      case 'owner_version': {
        const current = declared.owner_version;
        if (current === undefined) reject('invalid_envelope', field);
        if (current !== expected.owner_version) reject('authority_changed', field);
        break;
      }
      case 'agreement_version':
      case 'plan_version': {
        const current = declared[key];
        if (current === undefined) reject('invalid_envelope', field);
        if (current !== expected[key]) reject('stale_version', field);
        break;
      }
      case 'contract_versions':
        for (const [id, version] of Object.entries(expected.contract_versions ?? {})) {
          if (recordVersion(sql, id) !== version) reject('stale_version', `${field}.${id}`);
        }
        break;
    }
  }
}

function recordVersion(sql: SqlPort, id: string): number | undefined {
  return first(sql.exec<{ version: number }>('SELECT version FROM records WHERE id = ?', id))?.version;
}

function recordExists(sql: SqlPort, id: string): boolean {
  return recordVersion(sql, id) !== undefined;
}

/** Every string in the payload that is a well-formed record ID. Iterative: payloads are bounded. */
export function collectIds(payload: unknown): string[] {
  const found = new Set<string>();
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === 'string') {
      const kind = idKind(value);
      if (kind !== undefined && !NOT_RECORDS.has(kind)) found.add(value);
    } else if (Array.isArray(value)) {
      stack.push(...(value as unknown[]));
    } else if (value !== null && typeof value === 'object') {
      stack.push(...Object.values(value));
    }
  }
  return [...found];
}

function isThenable(value: unknown): boolean {
  return (
    value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
  );
}

function reject(code: ErrorCode, field?: string): never {
  throw new Rejection(protocolError(code, { field }));
}

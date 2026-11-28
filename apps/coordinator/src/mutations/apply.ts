// The single path every mutation follows (rule H01, invariant 4, issue #10).
//
// `runMutation` must be called inside `transactionSync`. It checks, in order:
//   0. this object holds the project the command names
//   1. current membership or credential status, the agent's connection and run binding, and
//      then the recovery epoch (after membership, so a non-member learns nothing about it)
//   2. the catalogue: principal kind, minimum role, and a registered handler
//   3. credential scope, for agents and collectors; then that the request ID is unused
//   4. every referenced ID resolves inside this project, as the right kind of record; then the
//      ownership rule, which needs resolved references
//   5. every expected version, including the authority versions
// then runs the handler, writing each event and its outbox row as the handler emits it, and
// finally the receipt. Any refusal or throw rolls the whole transaction back, so nothing
// partial is ever visible. The caller responds and broadcasts only after commit.
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
  type RecordType,
  type ValidatedCommand,
} from '@consort/protocol';

import { first, type SqlPort } from '../db/sql.js';

import { newId } from './ids.js';
import { actorFor, principalKey, sourceFor, type Principal } from './principal.js';
import type {
  Authority,
  CheckInput,
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

/** The record type an ID of each kind must name. Kinds not listed only need to exist. */
export const RECORD_TYPE_OF_KIND: Partial<Record<IdKind, RecordType>> = {
  project: 'project',
  user: 'member',
  feature: 'feature',
  package: 'package',
  contract: 'contract',
  change_request: 'change_request',
  question: 'question',
  message: 'message',
  run: 'run',
  handoff: 'handoff',
  evidence: 'evidence',
};

/**
 * Payload fields that hold references, by name: `*_id` (and `reply_to`) hold one ID, `*_ids`
 * hold a list, and the keys of a `*_versions` map are IDs. A test checks every command payload
 * schema follows this, so free text that happens to look like an ID is never read as one.
 */
export const SINGLE_REFERENCE = /(_id|^reply_to)$/;
export const LIST_REFERENCE = /_ids$/;
export const KEYED_REFERENCE = /_versions$/;
/** Fields named like references that hold stable keys (letters, digits, `._-`), not record IDs. */
export const STABLE_KEY_FIELDS: ReadonlySet<string> = new Set([
  'criterion_id',
  'requirement_ids',
  'step_ids',
]);

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

  // 1. Current standing, loaded now rather than trusted from the session.
  const standing = registry.authority.resolve(sql, principal, command);
  if (!standing.ok) throw new Rejection(standing.error);
  const authority = standing.authority;
  const runId = checkIdentity(principal, envelope as Partial<AgentEnvelope>, authority);
  if (meta.recovery_epoch !== envelope.recovery_epoch) reject('recovery_epoch_mismatch', 'recovery_epoch');

  // 2. The catalogue. validateCommand already checked the principal kind; this is the second
  //    check the issue requires, against the same table.
  const entry = CATALOGUE[command.type];
  if (!entry.principals.includes(principal.kind)) reject('principal_not_allowed', 'type');
  if (!roleAtLeast(authority.role, entry.minRole)) reject('not_authorized', 'type');
  const handler = registry.handlerFor(command.type);
  if (handler === undefined) reject('command_unavailable', 'type');

  const input: CheckInput<CommandType> = { sql, principal, authority, command, payload: command.payload };

  // 3. Scope. A person's membership covers the project; a credential covers what it names.
  if (principal.kind !== 'human') checkScope(handler, input, authority);

  // Any cached outcome #11 returns for an identical retry must be returned here or later:
  // only after current membership, role and scope have passed again (rule H04).
  const key = principalKey(principal);
  const used = first(
    sql.exec<{ n: number }>(
      'SELECT count(*) AS n FROM command_receipts WHERE principal_key = ? AND request_id = ?',
      key,
      envelope.request_id,
    ),
  );
  if ((used?.n ?? 0) > 0) reject('request_id_conflict', 'request_id');

  // 4. References, then ownership.
  const references = collectReferences(command.payload);
  for (const id of handler.references?.(command.payload) ?? []) {
    references.push({ id, field: 'payload' });
  }
  for (const id of Object.keys(envelope.expected_versions.contract_versions ?? {})) {
    references.push({ id, field: `expected_versions.contract_versions.${id}` });
  }
  for (const { id, field } of references) {
    if (!resolves(sql, id)) reject('unknown_reference', field);
  }
  if (entry.ownership !== 'none') {
    // createRegistry guarantees `authorize` exists for these commands.
    const refused = handler.authorize!(input);
    if (refused !== undefined) throw new Rejection(refused);
  }

  // 5. Expected versions.
  checkVersions(sql, handler, input, authority);

  // 6. The handler. Each event is checked against its record and written as it is emitted,
  //    so a handler can change a record more than once and describe each step.
  const origin = {
    actor: actorFor(principal, runId),
    source: sourceFor(principal.kind),
    request_id: envelope.request_id,
    now,
  };
  const written: EventRecord[] = [];
  let refusal: ProtocolError | undefined;
  const context: MutationContext<CommandType> = {
    ...input,
    now,
    createRecord: (type, kind) => {
      const expected = RECORD_TYPE_OF_KIND[kind];
      if (expected !== undefined && expected !== type) {
        throw new Error(`createRecord: a ${kind} id cannot name a ${type} record`);
      }
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
      const row = first(
        sql.exec<{ version: number }>(
          'UPDATE records SET version = version + 1, updated_at = ? WHERE id = ? RETURNING version',
          now,
          id,
        ),
      );
      if (row === undefined) throw new Error(`bumpRecord: no record ${id}`);
      return row.version;
    },
    emit: (event) => {
      written.push(writeEvent(sql, meta, event, origin));
    },
    reject: (code, field) => {
      refusal ??= protocolError(code, { field });
      return reject(code, field);
    },
  };
  const output: unknown = handler.apply(context);
  if (isThenable(output)) throw new Error(`${command.type}: handlers must be synchronous`);
  // A handler that catches its own refusal and carries on is still refused.
  if (refusal !== undefined) throw new Rejection(refusal);
  const result = (output as { result?: Record<string, unknown> } | undefined)?.result ?? {};

  // 7. The receipt, in the same transaction as the change, its events and outbox rows.
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

/**
 * An agent's identity block must match its credential's connection, and its run must be the
 * one the authority port verified for that connection (#24 provides the real check). Without a
 * verified run nothing is written, so an unverified run ID never reaches the event log.
 */
function checkIdentity(
  principal: Principal,
  envelope: Partial<AgentEnvelope>,
  authority: Authority,
): string | undefined {
  if (principal.kind !== 'agent_run') return undefined;
  const agent = envelope.agent;
  if (agent === undefined) reject('identity_mismatch', 'agent');
  if (agent.connection_id !== principal.connection_id) reject('identity_mismatch', 'agent.connection_id');
  if (authority.run_id === undefined || authority.run_id !== agent.run_id) {
    reject('identity_mismatch', 'agent.run_id');
  }
  return authority.run_id;
}

/** Writes one event and its outbox row. Used by commands and by project creation. */
export function writeEvent(
  sql: SqlPort,
  meta: ProjectMeta,
  event: { readonly type: string; readonly record: EventRecord['record']; readonly payload?: object },
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
  const payload = event.payload ?? {};
  const seq = sql
    .exec<{ seq: number }>(
      `INSERT INTO events
        (recovery_epoch, type, record_type, record_id, record_version, actor, source, causal_request_id,
         server_time, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING seq`,
      meta.recovery_epoch,
      event.type,
      event.record.type,
      event.record.id,
      event.record.version,
      JSON.stringify(origin.actor),
      origin.source,
      origin.request_id,
      origin.now,
      JSON.stringify(payload),
    )
    .one().seq;
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
    payload,
  });
}

/**
 * A non-human principal acts only inside its credential's scope. An empty list is refused
 * rather than read as "touches nothing", so a handler cannot grant project-wide reach by
 * mistake; a project-wide command must say `'project'` and needs a project-wide credential.
 */
function checkScope(
  handler: HandlerDefinition<CommandType>,
  input: CheckInput<CommandType>,
  authority: Authority,
) {
  // createRegistry guarantees `scope` exists for commands non-human principals may send.
  const touched = handler.scope!(input);
  const allowed = authority.scope;
  if (touched === 'project') {
    if (allowed !== 'project') reject('not_authorized', 'payload');
    return;
  }
  if (touched.length === 0) reject('not_authorized', 'payload');
  for (const id of touched) {
    if (allowed === undefined || (allowed !== 'project' && !allowed.has(id)))
      reject('not_authorized', 'payload');
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
        const current = recordVersion(sql, handler.target(input.payload));
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
      default: {
        // A key added to the protocol is refused until it is checked here, never skipped.
        const unchecked: never = key;
        reject('invalid_envelope', `expected_versions.${String(unchecked)}`);
      }
    }
  }
}

function recordVersion(sql: SqlPort, id: string): number | undefined {
  return first(sql.exec<{ version: number }>('SELECT version FROM records WHERE id = ?', id))?.version;
}

/** The ID exists in this project, as the kind of record its prefix says. */
function resolves(sql: SqlPort, id: string): boolean {
  const row = first(sql.exec<{ type: string }>('SELECT type FROM records WHERE id = ?', id));
  if (row === undefined) return false;
  const kind = idKind(id);
  const expected = kind === undefined ? undefined : RECORD_TYPE_OF_KIND[kind];
  return expected === undefined || row.type === expected;
}

/** References in the payload, by field name (see SINGLE_REFERENCE). Iterative: payloads are bounded. */
export function collectReferences(payload: unknown): Array<{ id: string; field: string }> {
  const found: Array<{ id: string; field: string }> = [];
  const add = (value: unknown, field: string) => {
    if (typeof value !== 'string') return;
    const kind = idKind(value);
    if (kind !== undefined && !NOT_RECORDS.has(kind)) found.push({ id: value, field });
  };
  const stack: Array<{ value: unknown; path: string }> = [{ value: payload, path: 'payload' }];
  while (stack.length > 0) {
    const { value, path } = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    for (const [key, child] of entries) {
      const field = `${path}.${key}`;
      if (STABLE_KEY_FIELDS.has(key)) continue;
      if (SINGLE_REFERENCE.test(key)) add(child, field);
      else if (LIST_REFERENCE.test(key) && Array.isArray(child)) {
        child.forEach((item: unknown, index) => add(item, `${field}.${index}`));
      } else if (KEYED_REFERENCE.test(key) && child !== null && typeof child === 'object') {
        for (const id of Object.keys(child)) add(id, `${field}.${id}`);
      } else stack.push({ value: child, path: field });
    }
  }
  return found;
}

function isThenable(value: unknown): boolean {
  return (
    value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
  );
}

function reject(code: ErrorCode, field?: string): never {
  throw new Rejection(protocolError(code, { field }));
}

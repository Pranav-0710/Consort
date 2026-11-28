// What a command handler declares, and the registry the mutation path looks handlers up in.
//
// The mutation path (apply.ts) owns every generic check. A handler declares only what is
// specific to its record: which record its expected version refers to, which packages it acts
// on, who owns its target and its current authority versions. Each later issue registers its own
// handlers; #10 registers none, so the deployed coordinator refuses every command.
//
// Handlers are synchronous by type and by check: `apply` must not return a promise, and the SQL
// handle it gets stops working once the transaction ends, so no write can escape it (rule H01).
import {
  CATALOGUE,
  protocolError,
  type CommandPayload,
  type CommandType,
  type ErrorCode,
  type IdKind,
  type ProtocolError,
  type RecordType,
  type Role,
  type ValidatedCommand,
} from '@consort/protocol';

import type { SqlPort } from '../db/sql.js';

import type { Principal } from './principal.js';

/** Current standing of the principal, loaded inside the transaction (step 1). */
export interface Authority {
  readonly role: Role;
  readonly membership_policy_version: number;
  /**
   * Packages an agent or collector credential may act on. People have no package scope: their
   * membership covers the project, and ownership is checked per command.
   */
  readonly scope?: ReadonlySet<string>;
}

export type AuthorityResult =
  | { readonly ok: true; readonly authority: Authority }
  | { readonly ok: false; readonly error: ProtocolError };

/**
 * Loads current membership or credential status. Membership (#20), credentials (#21) and run
 * bindings (#24) provide the real one; until then it is injected by tests only.
 */
export interface AuthorityPort {
  resolve(sql: SqlPort, principal: Principal, command: ValidatedCommand): AuthorityResult;
}

/** The default: nobody is a member, so every command fails closed. */
export const DENY_ALL: AuthorityPort = {
  resolve: () => ({ ok: false, error: protocolError('not_a_member') }),
};

type CommandOf<T extends CommandType> = Extract<ValidatedCommand, { readonly type: T }>;

/** What every declared check can read. */
export interface CheckInput<T extends CommandType> {
  readonly sql: SqlPort;
  readonly principal: Principal;
  readonly authority: Authority;
  readonly command: CommandOf<T>;
  readonly payload: CommandPayload<T>;
}

/** Versions only the handler can look up. Membership and record versions are generic. */
export type HandlerVersions = Partial<Record<'owner_version' | 'agreement_version' | 'plan_version', number>>;

export interface EmittedEvent {
  /** `record.verb`; the record type must match its prefix. */
  readonly type: string;
  readonly record: { readonly type: RecordType; readonly id: string; readonly version: number };
  readonly payload?: Record<string, unknown>;
}

export interface MutationContext<T extends CommandType> extends CheckInput<T> {
  /** Coordinator time for this commit, ISO 8601. */
  readonly now: string;
  /** Creates a record at version 1 with a fresh coordinator-issued ID. */
  createRecord(type: RecordType, kind: IdKind): { readonly id: string; readonly version: 1 };
  /** Raises a record's version by one and returns the new version. */
  bumpRecord(id: string): number;
  /** Queues an event; it is written with its outbox row when the handler returns. */
  emit(event: EmittedEvent): void;
  /** Refuses the command. Everything the handler wrote is rolled back. */
  reject(code: ErrorCode, field?: string): never;
}

export interface HandlerResult {
  readonly result?: Record<string, unknown>;
}

export interface HandlerDefinition<T extends CommandType> {
  readonly type: T;
  /** The record `expected_versions.record_version` names. Required to accept that key. */
  target?(payload: CommandPayload<T>): string;
  /**
   * Packages the command acts on, checked against an agent's or collector's credential scope
   * (step 3). Required for any command a non-human principal may send.
   */
  scope?(input: CheckInput<T>): readonly string[];
  /**
   * IDs the command refers to, each of which must exist in this project (step 4). Defaults to
   * every ID-shaped string in the payload.
   */
  references?(payload: CommandPayload<T>): readonly string[];
  /** The ownership rule from the catalogue. Required unless that rule is `none`. */
  authorize?(input: CheckInput<T>): ProtocolError | undefined;
  /** Current versions for owner, agreement and plan keys this command may name. */
  versions?(input: CheckInput<T>): HandlerVersions;
  /** Writes the change. Synchronous: no network, no timers, no model calls (rule H01). */
  apply(context: MutationContext<T>): HandlerResult | undefined;
}

export type AnyHandler = { [T in CommandType]: HandlerDefinition<T> }[CommandType];

/** Keeps a handler's payload types tied to its command type. */
export function defineHandler<T extends CommandType>(handler: HandlerDefinition<T>): HandlerDefinition<T> {
  return handler;
}

export interface MutationRegistry {
  readonly authority: AuthorityPort;
  handlerFor(type: CommandType): HandlerDefinition<CommandType> | undefined;
}

/**
 * Builds a registry, refusing handler sets that would skip a catalogue rule: a command with an
 * ownership rule needs `authorize`, and one a non-human principal may send needs `scope`.
 */
export function createRegistry(options: {
  readonly authority: AuthorityPort;
  readonly handlers: readonly AnyHandler[];
}): MutationRegistry {
  const handlers = new Map<CommandType, HandlerDefinition<CommandType>>();
  for (const handler of options.handlers) {
    if (handlers.has(handler.type)) throw new Error(`two handlers for ${handler.type}`);
    const entry = CATALOGUE[handler.type];
    if (entry.ownership !== 'none' && handler.authorize === undefined) {
      throw new Error(`${handler.type} has ownership rule ${entry.ownership} but no authorize check`);
    }
    if (entry.principals.some((kind) => kind !== 'human') && handler.scope === undefined) {
      throw new Error(`${handler.type} accepts non-human principals but declares no scope`);
    }
    handlers.set(handler.type, handler as unknown as HandlerDefinition<CommandType>);
  }
  return { authority: options.authority, handlerFor: (type) => handlers.get(type) };
}

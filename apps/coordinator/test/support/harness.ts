// Test harness: principals, commands, test-only handlers and an injected authority.
//
// Principals are injected here only (issue #10 notes): no deployed path authenticates anyone
// until #19 and #21. The handlers below exist to exercise the mutation path; real record
// handlers arrive with the issues that own each record.
import {
  formatId,
  PROTOCOL_VERSION,
  type CommandType,
  type ExpectedVersions,
  type RecordType,
  type Role,
} from '@consort/protocol';

import { CoordinatorCore, type CoordinatorOptions } from '../../src/do/core.js';
import type { Migration } from '../../src/db/migrations.js';
import { principalKey, type Principal } from '../../src/mutations/principal.js';
import {
  createRegistry,
  defineHandler,
  type AnyHandler,
  type Authority,
  type AuthorityPort,
} from '../../src/mutations/registry.js';

import { expect } from 'vitest';

import { memoryStorage, snapshot, type TestStorage } from './sqlite.js';

export const PROJECT = formatId('project', 'projectAAAA01');
export const OTHER_PROJECT = formatId('project', 'projectBBBB02');
export const ALICE = formatId('user', 'aliceAAAAA01');
export const BLAIR = formatId('user', 'blairBBBBB02');
export const CONNECTION = formatId('connection', 'connAAAAAA01');
export const RUN = formatId('run', 'runAAAAAAA01');
export const CHECKOUT = formatId('checkout', 'checkoutAA01');
/** Named by commands built for a principal that holds no window, such as a removed member. */
export const NO_WINDOW = formatId('command_window', 'noWindowIssued');

export const alice: Principal = { kind: 'human', user_id: ALICE };
export const blair: Principal = { kind: 'human', user_id: BLAIR };
export const aliceAgent: Principal = { kind: 'agent_run', user_id: ALICE, connection_id: CONNECTION };

let counter = 0;
export function requestId(): string {
  counter += 1;
  return formatId('request', `request${String(counter).padStart(8, '0')}`);
}

/** Authority from a fixed table, standing in for membership (#20) and credentials (#21). */
export function tableAuthority(entries: ReadonlyArray<readonly [Principal, Authority]>): AuthorityPort & {
  set(principal: Principal, authority: Authority | undefined): void;
} {
  const table = new Map(entries.map(([p, a]) => [principalKey(p), a]));
  return {
    resolve: (_sql, principal) => {
      const authority = table.get(principalKey(principal));
      return authority === undefined
        ? { ok: false, error: { code: 'not_a_member', message: 'not a member' } }
        : { ok: true, authority };
    },
    set: (principal, authority) => {
      if (authority === undefined) table.delete(principalKey(principal));
      else table.set(principalKey(principal), authority);
    },
  };
}

export function member(
  role: Role,
  options: { scope?: readonly string[] | 'project'; run_id?: string } = {},
): Authority {
  const scope = options.scope;
  return {
    role,
    membership_policy_version: 1,
    ...(scope === undefined ? {} : { scope: scope === 'project' ? 'project' : new Set(scope) }),
    ...(options.run_id === undefined ? {} : { run_id: options.run_id }),
  };
}

/** An agent run's standing: its credential scope and the run its connection is bound to. */
export function agentMember(scope: readonly string[] | 'project' = 'project'): Authority {
  return member('contributor', { scope, run_id: RUN });
}

/** Answers a question: bumps it and emits `question.answered`. */
export const answerHandler = defineHandler({
  type: 'question.answer',
  target: (payload) => payload.question_id,
  scope: () => 'project',
  authorize: () => undefined,
  apply: (ctx) => {
    const version = ctx.bumpRecord(ctx.payload.question_id);
    ctx.emit({
      type: 'question.answered',
      record: { type: 'question', id: ctx.payload.question_id, version },
      payload: { text_length: ctx.payload.text.length },
    });
    return { result: { question_version: version } };
  },
});

/** Creates a feature. */
export const featureHandler = defineHandler({
  type: 'feature.create',
  apply: (ctx) => {
    const feature = ctx.createRecord('feature', 'feature');
    ctx.emit({ type: 'feature.created', record: { type: 'feature', ...feature } });
    return { result: { feature_id: feature.id } };
  },
});

export interface Fixture {
  readonly core: CoordinatorCore;
  /** Messages of failures the core rolled back and answered with internal_error. */
  readonly errors: string[];
  readonly storage: TestStorage;
  /** Setting a principal's standing also issues it a fresh command window, as a client would. */
  readonly authority: ReturnType<typeof tableAuthority>;
  readonly epoch: string;
  /** The current command window of each principal, by principal key. */
  readonly windows: Map<string, string>;
}

/**
 * Windows of the most recent fixture, so commandText can name the sender's window. A test that
 * builds commands for two fixtures passes `window` explicitly for the earlier one.
 */
let activeWindows = new Map<string, string>();

export function setup(
  options: {
    handlers?: readonly AnyHandler[];
    members?: ReadonlyArray<readonly [Principal, Authority]>;
    migrations?: readonly Migration[];
    broadcast?: CoordinatorOptions['broadcast'];
    storage?: TestStorage;
    init?: boolean;
    retry?: CoordinatorOptions['retry'];
    now?: () => Date;
    /** False for members who cannot hold a window, such as an agent with no verified run. */
    issueWindows?: boolean;
    transport?: CoordinatorOptions['transport'];
    alarm?: CoordinatorOptions['alarm'];
    outbox?: CoordinatorOptions['outbox'];
    random?: CoordinatorOptions['random'];
  } = {},
): Fixture {
  const storage = options.storage ?? memoryStorage();
  const members = options.members ?? [[alice, member('contributor')]];
  const table = tableAuthority(members);
  const errors: string[] = [];
  const core = new CoordinatorCore(storage, {
    reportError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    registry: createRegistry({
      authority: table,
      handlers: options.handlers ?? [answerHandler, featureHandler],
    }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
    ...(options.broadcast === undefined ? {} : { broadcast: options.broadcast }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.alarm === undefined ? {} : { alarm: options.alarm }),
    ...(options.outbox === undefined ? {} : { outbox: options.outbox }),
    ...(options.random === undefined ? {} : { random: options.random }),
  });
  core.start();
  let epoch = '';
  if (options.init ?? true) {
    const created = core.init({ project_id: PROJECT, created_by: ALICE, request_id: requestId() });
    if (!created.ok) throw new Error(`init failed: ${created.reason}`);
    epoch = created.recovery_epoch;
  }
  const windows = new Map<string, string>();
  // A failure to issue is a test bug, never a silent fallback that would surface later as
  // command_window_invalid in place of the refusal the test meant to check.
  const refresh = (principal: Principal) => {
    const issued = core.issueCommandWindow(principal);
    if (!issued.ok) throw new Error(`harness: could not issue a window: ${issued.error.code}`);
    windows.set(principalKey(principal), issued.window.command_window_id);
  };
  const issue = epoch !== '' && options.issueWindows !== false;
  if (issue) for (const [principal] of members) refresh(principal);
  const authority: ReturnType<typeof tableAuthority> = {
    resolve: table.resolve,
    set: (principal, standing) => {
      table.set(principal, standing);
      if (standing === undefined) windows.delete(principalKey(principal));
      else if (issue) refresh(principal);
    },
  };
  activeWindows = windows;
  return { core, storage, authority, epoch, errors, windows };
}

/** Inserts a record directly, standing in for the issue that will own its creation. */
export function seedRecord(storage: TestStorage, type: RecordType, id: string, version = 1): void {
  storage.db
    .prepare("INSERT INTO records (id, type, version, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')")
    .run(id, type, version);
}

export function commandText(
  type: CommandType | string,
  payload: unknown,
  options: {
    epoch: string;
    project?: string;
    request?: string;
    expected?: ExpectedVersions;
    agent?: boolean;
    /** Whose window to name. Defaults to Alice, or Alice's agent when `agent` is set. */
    as?: Principal;
    window?: string;
    extra?: Record<string, unknown>;
  },
): string {
  const sender = options.as ?? (options.agent ? aliceAgent : alice);
  return JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    project_id: options.project ?? PROJECT,
    request_id: options.request ?? requestId(),
    command_window_id: options.window ?? activeWindows.get(principalKey(sender)) ?? NO_WINDOW,
    recovery_epoch: options.epoch,
    type,
    payload,
    expected_versions: options.expected ?? {},
    ...(options.agent
      ? {
          agent: {
            connection_id: CONNECTION,
            connection_generation: 1,
            run_id: RUN,
            context_generation: 1,
            checkout_id: CHECKOUT,
          },
        }
      : {}),
    ...options.extra,
  });
}

/**
 * After refusals that come after the request-ID check: every table is unchanged except for one
 * new rejected receipt per refusal, which is what lets a retry get the same answer.
 */
export function expectOnlyRejectedReceipts(
  storage: TestStorage,
  before: Record<string, number>,
  count: number,
): void {
  expect(snapshot(storage.db)).toEqual({
    ...before,
    command_receipts: (before['command_receipts'] ?? 0) + count,
  });
  const rejected = storage.db
    .prepare("SELECT count(*) AS n FROM command_receipts WHERE outcome = 'rejected'")
    .get() as { n: number };
  expect(rejected.n).toBeGreaterThanOrEqual(count);
}

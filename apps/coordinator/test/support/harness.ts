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

import { memoryStorage, type TestStorage } from './sqlite.js';

export const PROJECT = formatId('project', 'projectAAAA01');
export const OTHER_PROJECT = formatId('project', 'projectBBBB02');
export const ALICE = formatId('user', 'aliceAAAAA01');
export const BLAIR = formatId('user', 'blairBBBBB02');
export const CONNECTION = formatId('connection', 'connAAAAAA01');
export const RUN = formatId('run', 'runAAAAAAA01');
export const CHECKOUT = formatId('checkout', 'checkoutAA01');
export const WINDOW = formatId('command_window', 'windowAAAA01');

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

export function member(role: Role, scope?: readonly string[]): Authority {
  return { role, membership_policy_version: 1, ...(scope === undefined ? {} : { scope: new Set(scope) }) };
}

/** Answers a question: bumps it and emits `question.answered`. */
export const answerHandler = defineHandler({
  type: 'question.answer',
  target: (payload) => payload.question_id,
  scope: () => [],
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
  readonly storage: TestStorage;
  readonly authority: ReturnType<typeof tableAuthority>;
  readonly epoch: string;
}

export function setup(
  options: {
    handlers?: readonly AnyHandler[];
    members?: ReadonlyArray<readonly [Principal, Authority]>;
    migrations?: readonly Migration[];
    broadcast?: CoordinatorOptions['broadcast'];
    storage?: TestStorage;
    init?: boolean;
  } = {},
): Fixture {
  const storage = options.storage ?? memoryStorage();
  const authority = tableAuthority(options.members ?? [[alice, member('contributor')]]);
  const core = new CoordinatorCore(storage, {
    registry: createRegistry({ authority, handlers: options.handlers ?? [answerHandler, featureHandler] }),
    ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
    ...(options.broadcast === undefined ? {} : { broadcast: options.broadcast }),
  });
  core.start();
  let epoch = '';
  if (options.init ?? true) {
    const created = core.init({ project_id: PROJECT, created_by: ALICE, request_id: requestId() });
    if (!created.ok) throw new Error(`init failed: ${created.reason}`);
    epoch = created.recovery_epoch;
  }
  return { core, storage, authority, epoch };
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
    extra?: Record<string, unknown>;
  },
): string {
  return JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    project_id: options.project ?? PROJECT,
    request_id: options.request ?? requestId(),
    command_window_id: WINDOW,
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

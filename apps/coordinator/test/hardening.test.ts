// The checks the first review asked to be pinned down: identity binding, scope, references by
// field name and kind, every expected-version key, collectors, and registry startup checks.
import {
  COMMAND_PAYLOADS,
  formatId,
  ID_PREFIXES,
  validateCommandJson,
  type ValidatedCommand,
} from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import { applyMigrations, MIGRATIONS } from '../src/db/migrations.js';
import {
  collectReferences,
  KEYED_REFERENCE,
  LIST_REFERENCE,
  runMutation,
  SINGLE_REFERENCE,
  STABLE_KEY_FIELDS,
} from '../src/mutations/apply.js';
import type { Principal } from '../src/mutations/principal.js';
import { createRegistry, DENY_ALL, defineHandler } from '../src/mutations/registry.js';
import { DEFAULT_RETRY_CONFIG } from '../src/mutations/windows.js';

import {
  ALICE,
  alice,
  aliceAgent,
  agentMember,
  answerHandler,
  commandText,
  featureHandler,
  member,
  PROJECT,
  requestId,
  RUN,
  seedRecord,
  setup,
  tableAuthority,
  expectOnlyRejectedReceipts,
} from './support/harness.js';
import { memoryStorage, snapshot } from './support/sqlite.js';

const QUESTION = formatId('question', 'questionAA01');
const PACKAGE = formatId('package', 'packageAAA01');
const CONTRACT = formatId('contract', 'contractAA01');
const HANDOFF = formatId('handoff', 'handoffAAA01');
const COLLECTOR = formatId('collector', 'collectorA01');
const collector: Principal = { kind: 'evidence_collector', collector_id: COLLECTOR };
const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };

function answer(epoch: string, extra: { agent?: boolean; text?: string } = {}) {
  return commandText(
    'question.answer',
    { question_id: QUESTION, text: extra.text ?? 'Use the v2 schema.' },
    { epoch, expected: { record_version: 1 }, ...(extra.agent ? { agent: true } : {}) },
  );
}

/** Rewrites one field of an agent's identity block. */
function withAgent(text: string, field: string, value: string): string {
  const command = JSON.parse(text) as { agent: Record<string, unknown> };
  command.agent[field] = value;
  return JSON.stringify(command);
}

describe('agent identity binding', () => {
  it('an agent naming another connection is refused and nothing reaches the event log', () => {
    const { core, storage, epoch } = setup({ members: [[aliceAgent, agentMember()]] });
    seedRecord(storage, 'question', QUESTION);
    const before = snapshot(storage.db);
    const forged = withAgent(
      answer(epoch, { agent: true }),
      'connection_id',
      formatId('connection', 'someoneElse1'),
    );
    expect(core.applyCommand(aliceAgent, forged)).toMatchObject({
      ok: false,
      error: { code: 'identity_mismatch', field: 'agent.connection_id' },
    });
    expect(snapshot(storage.db)).toEqual(before);
  });

  it('a forged run ID is refused; the recorded actor is always the verified run', () => {
    const { core, storage, epoch } = setup({ members: [[aliceAgent, agentMember()]] });
    seedRecord(storage, 'question', QUESTION);
    const forged = withAgent(answer(epoch, { agent: true }), 'run_id', formatId('run', 'forgedRun001'));
    expect(core.applyCommand(aliceAgent, forged)).toMatchObject({
      ok: false,
      error: { code: 'identity_mismatch', field: 'agent.run_id' },
    });
    expect(core.applyCommand(aliceAgent, answer(epoch, { agent: true }))).toMatchObject({ ok: true });
    const row = storage.db.prepare("SELECT actor FROM events WHERE type = 'question.answered'").get() as {
      actor: string;
    };
    expect(JSON.parse(row.actor)).toEqual({ kind: 'agent_run', run_id: RUN, user_id: ALICE });
  });

  it('an agent whose run the authority port has not verified writes nothing', () => {
    const { core, storage, epoch } = setup({
      members: [[aliceAgent, member('contributor', { scope: 'project' })]],
      issueWindows: false,
    });
    seedRecord(storage, 'question', QUESTION);
    expect(core.applyCommand(aliceAgent, answer(epoch, { agent: true }))).toMatchObject({
      ok: false,
      error: { code: 'identity_mismatch' },
    });
  });

  it('a handler that catches its own refusal is still refused, and writes nothing', () => {
    const swallowing = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        try {
          ctx.reject('not_authorized');
        } catch {
          // carries on regardless
        }
        const feature = ctx.createRecord('feature', 'feature');
        ctx.emit({ type: 'feature.created', record: { type: 'feature', ...feature } });
      },
    });
    const { core, storage, epoch } = setup({ handlers: [swallowing] });
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
    expectOnlyRejectedReceipts(storage, before, 1);
  });

  it('command text that is not a string is refused, never thrown', () => {
    const { core } = setup();
    for (const bad of [undefined, null, 42, {}]) {
      expect(core.applyCommand(alice, bad)).toMatchObject({ ok: false, error: { code: 'invalid_envelope' } });
    }
  });

  it('a malformed principal from the Worker is refused outright', () => {
    const { core, epoch, errors } = setup();
    const text = commandText('feature.create', FEATURE, { epoch });
    for (const bad of [
      null,
      {},
      { kind: 'human' },
      { kind: 'human', user_id: 'alice' },
      { ...alice, role: 'admin' },
    ]) {
      expect(core.applyCommand(bad, text)).toMatchObject({ ok: false, error: { code: 'internal_error' } });
    }
    expect(errors).toHaveLength(5);
  });
});

describe('credential scope', () => {
  it('an empty scope list is refused rather than read as touching nothing', () => {
    const careless = defineHandler({ ...answerHandler, scope: () => [] });
    const { core, storage, epoch } = setup({ handlers: [careless], members: [[aliceAgent, agentMember()]] });
    seedRecord(storage, 'question', QUESTION);
    expect(core.applyCommand(aliceAgent, answer(epoch, { agent: true }))).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
  });

  it('a project-wide command needs a project-wide credential', () => {
    const { core, storage, epoch } = setup({ members: [[aliceAgent, agentMember([PACKAGE])]] });
    seedRecord(storage, 'question', QUESTION);
    expect(core.applyCommand(aliceAgent, answer(epoch, { agent: true }))).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
  });

  it('an evidence collector acts within its scope, recorded as participant-collected', () => {
    const retrieval = defineHandler({
      type: 'handoff.record_retrieval',
      scope: () => [PACKAGE],
      authorize: () => undefined,
      apply: (ctx) => {
        const version = ctx.bumpRecord(ctx.payload.handoff_id);
        ctx.emit({
          type: 'handoff.retrieved',
          record: { type: 'handoff', id: ctx.payload.handoff_id, version },
        });
      },
    });
    const { core, storage, authority, epoch } = setup({ handlers: [retrieval] });
    seedRecord(storage, 'handoff', HANDOFF);
    // A window is bound to the scope it was issued under, so each attempt names the current one.
    const text = () =>
      commandText(
        'handoff.record_retrieval',
        { handoff_id: HANDOFF, result: 'matched' },
        { epoch, as: collector },
      );
    authority.set(collector, member('contributor', { scope: [] }));
    expect(core.applyCommand(collector, text())).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
    authority.set(collector, member('contributor', { scope: [PACKAGE] }));
    expect(core.applyCommand(collector, text())).toMatchObject({ ok: true });
    const row = storage.db.prepare("SELECT actor, source FROM events WHERE type = 'handoff.retrieved'").get();
    expect(row).toEqual({
      actor: JSON.stringify({ kind: 'evidence_collector', collector_id: COLLECTOR }),
      source: 'participant_collected',
    });
  });
});

describe('references', () => {
  it('free text that looks like an ID is not a reference', () => {
    const { core, storage, epoch } = setup();
    seedRecord(storage, 'question', QUESTION);
    expect(core.applyCommand(alice, answer(epoch, { text: 'pkg_abcdefghij' }))).toMatchObject({ ok: true });
    expect(collectReferences({ title: 'pkg_abcdefghij', requirement_ids: ['pkg_abcdefghij'] })).toEqual([]);
  });

  it('finds single, listed and keyed references, with their field paths', () => {
    const evidence = formatId('evidence', 'evidenceAA01');
    const message = formatId('message', 'messageAAA01');
    expect(
      collectReferences({
        to: { kind: 'member', user_id: ALICE },
        evidence_ids: [evidence],
        based_on: { contract_versions: { [CONTRACT]: 2 } },
        reply_to: message,
      }),
    ).toEqual(
      expect.arrayContaining([
        { id: ALICE, field: 'payload.to.user_id' },
        { id: evidence, field: 'payload.evidence_ids.0' },
        { id: CONTRACT, field: `payload.based_on.contract_versions.${CONTRACT}` },
        { id: message, field: 'payload.reply_to' },
      ]),
    );
  });

  it('every ID field in every command payload is named so that it is found as a reference', () => {
    const problems: string[] = [];
    let found = 0;
    for (const [type, schema] of Object.entries(COMMAND_PAYLOADS)) {
      walkSchema(schema, '', '', (path, key, kind) => {
        found += 1;
        const pattern = { single: SINGLE_REFERENCE, list: LIST_REFERENCE, keyed: KEYED_REFERENCE }[kind];
        if (!pattern.test(key)) problems.push(`${type}${path}: ID field not named as a reference`);
        if (STABLE_KEY_FIELDS.has(key)) problems.push(`${type}${path}: ID field listed as a stable key`);
      });
    }
    expect(problems).toEqual([]);
    // The walk really sees the schemas: dozens of ID fields exist across the catalogue.
    expect(found).toBeGreaterThan(30);
  });

  it('a handler can add references; it can never remove the ones found by name', () => {
    const extra = formatId('package', 'extraPackag1');
    const adding = defineHandler({ ...answerHandler, references: () => [extra] });
    const { core, storage, epoch } = setup({ handlers: [adding] });
    expect(core.applyCommand(alice, answer(epoch))).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference', field: 'payload.question_id' },
    });
    seedRecord(storage, 'question', QUESTION);
    expect(core.applyCommand(alice, answer(epoch))).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference', field: 'payload' },
    });
    seedRecord(storage, 'package', extra);
    expect(core.applyCommand(alice, answer(epoch))).toMatchObject({ ok: true });
  });

  it('an ID that names the wrong kind of record does not resolve', () => {
    const { core, storage, epoch } = setup();
    seedRecord(storage, 'feature', QUESTION);
    expect(core.applyCommand(alice, answer(epoch))).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference', field: 'payload.question_id' },
    });
  });

  it('a handler cannot create a record whose ID kind contradicts its type', () => {
    const confused = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        ctx.createRecord('feature', 'question');
      },
    });
    const { core, storage, epoch, errors } = setup({ handlers: [confused] });
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'internal_error' },
    });
    expect(errors).toEqual([expect.stringContaining('cannot name')]);
    expect(snapshot(storage.db)).toEqual(before);
  });
});

describe('ownership and expected versions', () => {
  it('ownership is checked after references, and its refusal writes nothing', () => {
    const notOwner = defineHandler({
      ...answerHandler,
      authorize: () => ({ code: 'not_authorized', message: 'not the addressed recipient' }),
    });
    const { core, storage, epoch } = setup({ handlers: [notOwner] });
    expect(core.applyCommand(alice, answer(epoch))).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference' },
    });
    seedRecord(storage, 'question', QUESTION);
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, answer(epoch))).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
    expectOnlyRejectedReceipts(storage, before, 1);
  });

  it('a stale contract pin on an existing contract gets stale_version', () => {
    const { core, storage, epoch } = setup();
    seedRecord(storage, 'contract', CONTRACT, 3);
    const pinned = (version: number) =>
      commandText('feature.create', FEATURE, {
        epoch,
        expected: { contract_versions: { [CONTRACT]: version } },
      });
    expect(core.applyCommand(alice, pinned(2))).toMatchObject({
      ok: false,
      error: { code: 'stale_version', field: `expected_versions.contract_versions.${CONTRACT}` },
    });
    expect(core.applyCommand(alice, pinned(3))).toMatchObject({ ok: true });
  });

  it('a changed owner gets authority_changed', () => {
    const transfer = defineHandler({
      type: 'ownership.transfer',
      authorize: () => undefined,
      versions: () => ({ owner_version: 4 }),
      apply: () => undefined,
    });
    const { core, storage, epoch } = setup({ handlers: [transfer] });
    seedRecord(storage, 'package', PACKAGE);
    seedRecord(storage, 'member', ALICE);
    const command = (owner: number) =>
      commandText(
        'ownership.transfer',
        { target: { kind: 'agreement', package_id: PACKAGE }, new_owner_id: ALICE, reason: 'handover' },
        { epoch, expected: { owner_version: owner, membership_policy_version: 1 } },
      );
    expect(core.applyCommand(alice, command(3))).toMatchObject({
      ok: false,
      error: { code: 'authority_changed', field: 'expected_versions.owner_version' },
    });
    expect(core.applyCommand(alice, command(4))).toMatchObject({ ok: true });
  });

  it.each(['agreement_version', 'plan_version'] as const)(
    '%s is compared when the handler declares it',
    (key) => {
      const versioned = defineHandler({
        ...featureHandler,
        versions: () => ({ agreement_version: 2, plan_version: 5 }),
      });
      const { core, epoch } = setup({ handlers: [versioned] });
      const current = key === 'agreement_version' ? 2 : 5;
      const send = (value: number) =>
        core.applyCommand(
          alice,
          commandText('feature.create', FEATURE, { epoch, expected: { [key]: value } }),
        );
      expect(send(current - 1)).toMatchObject({
        ok: false,
        error: { code: 'stale_version', field: `expected_versions.${key}` },
      });
      expect(send(current)).toMatchObject({ ok: true });
    },
  );

  it('a record version sent to a command with no target is refused, not ignored', () => {
    const { core, epoch } = setup();
    const text = commandText('feature.create', FEATURE, { epoch, expected: { record_version: 1 } });
    expect(core.applyCommand(alice, text)).toMatchObject({
      ok: false,
      error: { code: 'invalid_envelope', field: 'expected_versions.record_version' },
    });
  });
});

describe('transaction details', () => {
  it('a handler may change a record twice and describe each step', () => {
    const twoStep = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        const feature = ctx.createRecord('feature', 'feature');
        ctx.emit({ type: 'feature.created', record: { type: 'feature', ...feature } });
        const version = ctx.bumpRecord(feature.id);
        ctx.emit({ type: 'feature.updated', record: { type: 'feature', id: feature.id, version } });
      },
    });
    const { core, storage, epoch } = setup({ handlers: [twoStep] });
    const result = core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }));
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: 'feature.created' }, { type: 'feature.updated' }],
    });
    expect(storage.db.prepare('SELECT record_version FROM events WHERE seq > 1 ORDER BY seq').all()).toEqual([
      { record_version: 1 },
      { record_version: 2 },
    ]);
  });

  it('the in-transaction catalogue check stands on its own, without the validator', () => {
    const storage = memoryStorage();
    const { epoch } = setup({ storage });
    // Validated for a person, then handed straight to the mutation path as a collector.
    const validated = validateCommandJson(commandText('feature.create', FEATURE, { epoch }), {
      principal: 'human',
    });
    if (!validated.ok) throw new Error('fixture command is invalid');
    const command: ValidatedCommand = validated.command;
    const registry = createRegistry({
      authority: tableAuthority([[collector, member('admin', { scope: 'project' })]]),
      handlers: [featureHandler],
    });
    expect(() =>
      storage.transactionSync(() =>
        runMutation(storage.sql, registry, collector, command, {
          now: new Date().toISOString(),
          retry: DEFAULT_RETRY_CONFIG,
          progress: {},
        }),
      ),
    ).toThrow('principal_not_allowed');
  });

  it('a non-member learns nothing about the recovery epoch', () => {
    const { core, authority } = setup();
    authority.set(alice, undefined);
    const wrongEpoch = commandText('feature.create', FEATURE, { epoch: 'ep_notTheEpoch001' });
    expect(core.applyCommand(alice, wrongEpoch)).toMatchObject({
      ok: false,
      error: { code: 'not_a_member' },
    });
  });

  it('a retried init learns the original result; a different request is refused', () => {
    const { core } = setup({ init: false });
    const request = requestId();
    const first = core.init({ project_id: PROJECT, created_by: ALICE, request_id: request });
    expect(first.ok).toBe(true);
    expect(core.init({ project_id: PROJECT, created_by: ALICE, request_id: request })).toEqual(first);
    expect(core.init({ project_id: PROJECT, created_by: ALICE, request_id: requestId() })).toEqual({
      ok: false,
      reason: 'exists',
    });
  });

  it('registry startup refuses a handler that cannot check a version its command requires', () => {
    const untargeted = { ...answerHandler };
    delete untargeted.target;
    expect(() => createRegistry({ authority: DENY_ALL, handlers: [defineHandler(untargeted)] })).toThrow(
      /requires record_version/,
    );
    expect(() =>
      createRegistry({
        authority: DENY_ALL,
        handlers: [
          defineHandler({ type: 'ownership.transfer', authorize: () => undefined, apply: () => undefined }),
        ],
      }),
    ).toThrow(/requires owner_version/);
  });
});

describe('migration list integrity', () => {
  it('a misnumbered list, a renamed released migration or a joined statement is refused', () => {
    expect(applyMigrations(memoryStorage(), [{ version: 2, name: 'gap', statements: [] }])).toMatchObject({
      status: 'failed',
    });
    const joined = [{ version: 1, name: 'joined', statements: ['CREATE TABLE a (x); CREATE TABLE b (y)'] }];
    expect(applyMigrations(memoryStorage(), joined)).toMatchObject({ status: 'failed' });

    const storage = memoryStorage();
    expect(applyMigrations(storage).status).toBe('ready');
    const renamed = MIGRATIONS.map((m, i) => (i === 0 ? { ...m, name: 'renamed' } : m));
    expect(applyMigrations(storage, renamed)).toMatchObject({ status: 'failed' });
  });
});

type ZodDef = { type: string; checks?: unknown[] } & Record<string, unknown>;

function defOf(schema: unknown): ZodDef {
  return (schema as { _zod: { def: ZodDef } })._zod.def;
}

/** Walks a zod 4 schema and reports every ID-typed field, with how it holds IDs. */
function walkSchema(
  schema: unknown,
  path: string,
  key: string,
  report: (path: string, key: string, kind: 'single' | 'list' | 'keyed') => void,
): void {
  const def = defOf(schema);
  switch (def.type) {
    case 'object':
      for (const [name, child] of Object.entries(def['shape'] as Record<string, unknown>)) {
        walkSchema(child, `${path}.${name}`, name, report);
      }
      return;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
      walkSchema(def['innerType'], path, key, report);
      return;
    case 'union':
      for (const option of def['options'] as unknown[]) walkSchema(option, path, key, report);
      return;
    case 'array':
      if (isIdString(def['element'])) report(path, key, 'list');
      else walkSchema(def['element'], `${path}[]`, key, report);
      return;
    case 'record':
      if (isIdString(def['keyType'])) report(path, key, 'keyed');
      walkSchema(def['valueType'], `${path}{}`, key, report);
      return;
    case 'string':
      if (isIdString(schema)) report(path, key, 'single');
      return;
    case 'pipe':
      walkSchema(def['in'], path, key, report);
      return;
    case 'enum':
    case 'literal':
    case 'number':
    case 'boolean':
      return;
    default:
      throw new Error(`walkSchema: unhandled zod type ${def.type} at ${path}`);
  }
}

const ID_PATTERN_START = new RegExp(`^\\^(${Object.values(ID_PREFIXES).join('|')})_`);

function isIdString(schema: unknown): boolean {
  const def = defOf(schema);
  if (def.type !== 'string') return false;
  return (def.checks ?? []).some((check) => {
    const pattern = (check as { _zod?: { def?: { pattern?: unknown } } })._zod?.def?.pattern;
    return pattern instanceof RegExp && ID_PATTERN_START.test(pattern.source);
  });
}

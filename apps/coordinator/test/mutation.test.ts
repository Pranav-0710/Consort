import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatId, type EventRecord } from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import type { Principal } from '../src/mutations/principal.js';
import { defineHandler } from '../src/mutations/registry.js';

import {
  alice,
  aliceAgent,
  answerHandler,
  blair,
  commandText,
  featureHandler,
  member,
  requestId,
  RUN,
  seedRecord,
  setup,
  expectOnlyRejectedReceipts,
} from './support/harness.js';
import { snapshot } from './support/sqlite.js';

const QUESTION = formatId('question', 'questionAA01');
const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };

function answer(
  epoch: string,
  version: number,
  options: { agent?: boolean; request?: string; as?: Principal } = {},
) {
  return commandText(
    'question.answer',
    { question_id: QUESTION, text: 'Use the v2 schema.' },
    { epoch, expected: { record_version: version }, ...options },
  );
}

describe('the transactional mutation path', () => {
  it('a committed command writes its change, receipt, event and outbox row together', () => {
    const { core, storage, epoch } = setup();
    seedRecord(storage, 'question', QUESTION);
    const request = requestId();
    const result = core.applyCommand(alice, answer(epoch, 1, { request }));
    expect(result).toMatchObject({
      ok: true,
      request_id: request,
      outcome: 'committed',
      result: { question_version: 2 },
    });

    const db = storage.db;
    expect(db.prepare('SELECT version FROM records WHERE id = ?').get(QUESTION)).toEqual({ version: 2 });
    const event = db
      .prepare('SELECT seq, type, record_version, actor, source, causal_request_id FROM events WHERE seq > 1')
      .get();
    expect(event).toEqual({
      seq: 2,
      type: 'question.answered',
      record_version: 2,
      actor: JSON.stringify(alice),
      source: 'human_action',
      causal_request_id: request,
    });
    expect(db.prepare('SELECT event_seq, state FROM outbox WHERE event_seq = 2').get()).toEqual({
      event_seq: 2,
      state: 'pending',
    });
    expect(
      db
        .prepare('SELECT outcome, first_seq, last_seq FROM command_receipts WHERE request_id = ?')
        .get(request),
    ).toEqual({ outcome: 'committed', first_seq: 2, last_seq: 2 });
  });

  it('two commands against the same base version: exactly one commits and the other gets version_conflict', () => {
    const { core, storage, epoch } = setup({
      members: [
        [alice, member('contributor')],
        [blair, member('contributor')],
      ],
    });
    seedRecord(storage, 'question', QUESTION);
    // Both were prepared after reading version 1.
    const first = core.applyCommand(alice, answer(epoch, 1));
    const second = core.applyCommand(blair, answer(epoch, 1, { as: blair }));
    expect([first.ok, second.ok]).toEqual([true, false]);
    // The protocol's code for a version conflict is stale_version.
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'stale_version', field: 'expected_versions.record_version' },
    });
    expect(storage.db.prepare('SELECT version FROM records WHERE id = ?').get(QUESTION)).toEqual({
      version: 2,
    });
    expect(
      storage.db.prepare("SELECT count(*) AS n FROM events WHERE type = 'question.answered'").get(),
    ).toEqual({ n: 1 });
  });

  it('a handler throwing after partial writes leaves no row, event, receipt or outbox entry, and says nothing changed', () => {
    const throwing = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        const feature = ctx.createRecord('feature', 'feature');
        ctx.emit({ type: 'feature.created', record: { type: 'feature', ...feature } });
        ctx.sql.exec("UPDATE meta SET created_by = 'tampered'");
        throw new Error('handler bug');
      },
    });
    const { core, storage, epoch, errors } = setup({ handlers: [throwing] });
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'internal_error' },
    });
    expect(errors).toEqual([expect.stringContaining('handler bug')]);
    expect(snapshot(storage.db)).toEqual(before);
    expect(storage.db.prepare('SELECT created_by FROM meta').get()).not.toEqual({ created_by: 'tampered' });
  });

  it('a handler refusing after partial writes leaves nothing behind', () => {
    const refusing = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        ctx.createRecord('feature', 'feature');
        return ctx.reject('not_authorized');
      },
    });
    const { core, storage, epoch } = setup({ handlers: [refusing] });
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
    expectOnlyRejectedReceipts(storage, before, 1);
  });

  it('an event that misdescribes its record rolls the whole command back', () => {
    const lying = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        const feature = ctx.createRecord('feature', 'feature');
        ctx.emit({ type: 'feature.created', record: { type: 'feature', id: feature.id, version: 7 } });
      },
    });
    const { core, storage, epoch, errors } = setup({ handlers: [lying] });
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'internal_error' },
    });
    expect(errors).toEqual([expect.stringContaining('does not match record')]);
    expect(snapshot(storage.db)).toEqual(before);
  });

  it('a reference to an ID outside this project fails closed with unknown_reference', () => {
    let applied = 0;
    const contractHandler = defineHandler({
      type: 'contract.create',
      apply: () => {
        applied += 1;
      },
    });
    const { core, storage, epoch } = setup({ handlers: [answerHandler, featureHandler, contractHandler] });
    // These IDs exist only in another project's object, so this one has never heard of them.
    const before = snapshot(storage.db);
    // A plain reference in the payload: the owner is a user this project does not have.
    const foreignOwner = commandText(
      'contract.create',
      { title: 'Orders API', body: 'v1', owner_id: formatId('user', 'strangerAA01') },
      { epoch },
    );
    expect(core.applyCommand(alice, foreignOwner)).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference', field: 'payload.owner_id' },
    });
    expect(applied).toBe(0);
    // The command's target.
    expect(core.applyCommand(alice, answer(epoch, 1))).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference' },
    });
    const pinned = commandText('feature.create', FEATURE, {
      epoch,
      expected: { contract_versions: { [formatId('contract', 'contractAA01')]: 1 } },
    });
    expect(core.applyCommand(alice, pinned)).toMatchObject({
      ok: false,
      error: { code: 'unknown_reference' },
    });
    expectOnlyRejectedReceipts(storage, before, 3);

    // The same command naming a user this project does have goes through.
    const localOwner = formatId('user', 'localOwner01');
    seedRecord(storage, 'member', localOwner);
    const owned = commandText(
      'contract.create',
      { title: 'Orders API', body: 'v1', owner_id: localOwner },
      { epoch },
    );
    expect(core.applyCommand(alice, owned)).toMatchObject({ ok: true });
    expect(applied).toBe(1);
  });

  it('the response and any broadcast happen only after commit', () => {
    const calls: Array<{ events: readonly EventRecord[]; inTransaction: boolean; persisted: unknown }> = [];
    let handlerSawBroadcast = -1;
    const observing = defineHandler({
      type: 'feature.create',
      apply: (ctx) => {
        handlerSawBroadcast = calls.length;
        const feature = ctx.createRecord('feature', 'feature');
        ctx.emit({ type: 'feature.created', record: { type: 'feature', ...feature } });
      },
    });
    const refusing = defineHandler({
      type: 'question.answer',
      target: (p) => p.question_id,
      scope: () => [],
      authorize: () => undefined,
      apply: (ctx) => ctx.reject('not_authorized'),
    });
    const fixture = setup({
      handlers: [observing, refusing],
      broadcast: (events) => {
        calls.push({
          events,
          inTransaction: fixture.storage.inTransaction,
          persisted: fixture.storage.db
            .prepare('SELECT count(*) AS n FROM outbox WHERE event_seq = ?')
            .get(events[0]!.seq),
        });
      },
    });
    const { core, storage, epoch } = fixture;
    calls.length = 0; // project.created was broadcast by init

    const result = core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }));
    expect(result.ok).toBe(true);
    expect(handlerSawBroadcast).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ inTransaction: false, persisted: { n: 1 } });
    expect(calls[0]!.events.map((e) => e.type)).toEqual(['feature.created']);

    seedRecord(storage, 'question', QUESTION);
    expect(core.applyCommand(alice, answer(epoch, 1)).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('a failing broadcast does not undo the commit; the outbox keeps the delivery intent (C03)', () => {
    const { core, storage, epoch } = setup({
      broadcast: () => {
        throw new Error('socket gone');
      },
    });
    const result = core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }));
    expect(result.ok).toBe(true);
    expect(storage.db.prepare("SELECT count(*) AS n FROM outbox WHERE state = 'pending'").get()).toEqual({
      n: 2,
    });
  });

  it('membership is read inside the transaction: a member removed before commit is refused', () => {
    const { core, authority, epoch } = setup();
    authority.set(alice, undefined);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'not_a_member' },
    });
  });

  it('a stale membership-policy version gets authority_changed', () => {
    const { core, storage, epoch } = setup();
    seedRecord(storage, 'question', QUESTION);
    const stale = commandText(
      'question.answer',
      { question_id: QUESTION, text: 'yes' },
      { epoch, expected: { record_version: 1, membership_policy_version: 0 } },
    );
    expect(core.applyCommand(alice, stale)).toMatchObject({
      ok: false,
      error: { code: 'authority_changed', field: 'expected_versions.membership_policy_version' },
    });
  });

  it('an expected version the command cannot check is refused, not ignored', () => {
    const { core, epoch } = setup();
    const unchecked = commandText('feature.create', FEATURE, { epoch, expected: { owner_version: 3 } });
    expect(core.applyCommand(alice, unchecked)).toMatchObject({
      ok: false,
      error: { code: 'invalid_envelope', field: 'expected_versions.owner_version' },
    });
  });

  it('an agent acting outside its credential scope is refused', () => {
    const PACKAGE = formatId('package', 'packageAAA01');
    const scoped = defineHandler({ ...answerHandler, scope: () => [PACKAGE] });
    const { core, storage, authority, epoch } = setup({ handlers: [scoped, featureHandler] });
    seedRecord(storage, 'question', QUESTION);
    authority.set(
      aliceAgent,
      member('contributor', { scope: [formatId('package', 'otherPackage1')], run_id: RUN }),
    );
    expect(core.applyCommand(aliceAgent, answer(epoch, 1, { agent: true }))).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
    authority.set(aliceAgent, member('contributor', { scope: [PACKAGE], run_id: RUN }));
    expect(core.applyCommand(aliceAgent, answer(epoch, 1, { agent: true }))).toMatchObject({ ok: true });
    const actor = storage.db
      .prepare("SELECT actor, source FROM events WHERE type = 'question.answered'")
      .get();
    expect(actor).toMatchObject({ source: 'agent_report' });
    expect(JSON.parse((actor as { actor: string }).actor)).toMatchObject({ kind: 'agent_run' });
  });

  it('a reused request ID with different content is refused; an identical one replays', () => {
    const { core, storage, epoch } = setup();
    const request = requestId();
    const first = core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch, request }));
    expect(first).toMatchObject({ ok: true, replayed: false });
    const before = snapshot(storage.db);
    const changed = commandText('feature.create', { ...FEATURE, title: 'Changed' }, { epoch, request });
    expect(core.applyCommand(alice, changed)).toMatchObject({
      ok: false,
      error: { code: 'request_id_conflict' },
    });
    const again = core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch, request }));
    expect(again).toEqual({ ...first, replayed: true });
    expect(snapshot(storage.db)).toEqual(before);
  });
});

describe('handlers are synchronous and import no network API', () => {
  it('a handler returning a promise is refused, and its later writes cannot escape the transaction', async () => {
    let escaped: unknown;
    const asyncHandler = defineHandler({
      type: 'feature.create',
      apply: ((ctx: Parameters<typeof featureHandler.apply>[0]) =>
        Promise.resolve().then(() => {
          try {
            ctx.createRecord('feature', 'feature');
          } catch (error) {
            escaped = error;
          }
        })) as unknown as typeof featureHandler.apply,
    });
    const { core, storage, epoch, errors } = setup({ handlers: [asyncHandler] });
    const before = snapshot(storage.db);
    expect(core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'internal_error' },
    });
    expect(errors).toEqual([expect.stringContaining('handlers must be synchronous')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(escaped).toBeInstanceOf(Error);
    expect(snapshot(storage.db)).toEqual(before);
  });

  it('no mutation or command source file uses network, socket, timer or promise APIs (H01)', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const forbidden = [
      /\bfetch\s*\(/,
      /\bWebSocket\b/,
      /cloudflare:sockets/,
      /\bconnect\s*\(/,
      /\bawait\b/,
      /\basync\b/,
      /\bset(Timeout|Interval)\b/,
      /from ['"]node:/,
      /\bPromise\b/,
    ];
    const files = ['mutations', 'commands']
      .map((dir) => join(src, dir))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap((dir) => listTs(dir));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect({ file, match: pattern.exec(text)?.[0] }).toEqual({ file, match: undefined });
      }
    }
  });
});

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listTs(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

// Run outbox delivery (issue #12; rules H05, H06, H10; stress C03, C04, C08, H05).
import { formatId, untrusted } from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import { first } from '../src/db/sql.js';
import type { Principal } from '../src/mutations/principal.js';
import { defineHandler, type Authority } from '../src/mutations/registry.js';
import { DEFAULT_OUTBOX_CONFIG, retryDelay, type OutboxConfig } from '../src/outbox/config.js';
import type { AlarmPort, OutboxDelivery, RunTransport } from '../src/outbox/ports.js';
import { enqueueInboxItem } from '../src/outbox/store.js';

import { ALICE, agentMember, alice, aliceAgent, commandText, member, RUN, setup } from './support/harness.js';
import { memoryStorage, snapshot, type TestStorage } from './support/sqlite.js';

const QUESTION = formatId('question', 'questionAAA1');
const PACKAGE_A = formatId('package', 'packageAAA01');
const PACKAGE_B = formatId('package', 'packageBBB02');
const OTHER_RUN = formatId('run', 'runBBBBBBB02');
const START = Date.parse('2026-11-28T10:00:00.000Z');

/** A run's adapter sockets, as #13 will provide them. */
function fakeTransport(): RunTransport & {
  readonly online: Map<string, Principal>;
  readonly sent: OutboxDelivery[];
} {
  const online = new Map<string, Principal>();
  const sent: OutboxDelivery[] = [];
  return {
    online,
    sent,
    connectedRuns: () => [...online.keys()],
    connection: (runId) => online.get(runId),
    send: (delivery) => {
      if (!online.has(delivery.run_id)) throw new Error('socket closed');
      sent.push(delivery);
    },
  };
}

function fakeAlarm(): AlarmPort & { at: number | undefined; sets: number } {
  const alarm = {
    at: undefined as number | undefined,
    sets: 0,
    set(atMs: number) {
      alarm.at = atMs;
      alarm.sets += 1;
    },
    clear() {
      alarm.at = undefined;
    },
  };
  return alarm;
}

function clock() {
  let t = START;
  return {
    now: () => new Date(t),
    set: (ms: number) => {
      t = ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    get ms() {
      return t;
    },
  };
}

interface Target {
  scope: string;
  maxOpenPerRun?: number;
}

/**
 * Creates a feature and queues an inbox item for RUN about it, in the same transaction. Stands in
 * for the inbox routing #35 adds; the item type is one the protocol already defines.
 */
function queueingHandler(target: Target) {
  return defineHandler({
    type: 'feature.create',
    apply: (ctx) => {
      const feature = ctx.createRecord('feature', 'feature');
      ctx.emit({ type: 'feature.created', record: { type: 'feature', ...feature } });
      const source = first(ctx.sql.exec<{ seq: number }>('SELECT max(seq) AS seq FROM events'))!.seq;
      const queued = enqueueInboxItem(
        ctx.sql,
        {
          run_id: RUN,
          scope: target.scope,
          item: {
            type: 'question.answered',
            source_seq: source,
            from: { kind: 'human', user_id: ALICE },
            question_id: QUESTION,
            answer: untrusted(ctx.payload.title),
          },
          causal_request_id: ctx.command.envelope.request_id,
          now: ctx.now,
        },
        { maxOpenPerRun: target.maxOpenPerRun ?? DEFAULT_OUTBOX_CONFIG.maxOpenPerRun },
      );
      return { result: { feature_id: feature.id, item_id: queued.item_id } };
    },
  });
}

interface World {
  readonly time: ReturnType<typeof clock>;
  readonly transport: ReturnType<typeof fakeTransport>;
  readonly alarm: ReturnType<typeof fakeAlarm>;
  readonly target: Target;
  readonly storage: TestStorage;
}

function world(): World {
  return {
    time: clock(),
    transport: fakeTransport(),
    alarm: fakeAlarm(),
    target: { scope: 'project' },
    storage: memoryStorage(),
  };
}

function coordinator(
  w: World,
  options: {
    init?: boolean;
    outbox?: Partial<OutboxConfig>;
    random?: () => number;
    agent?: Authority;
    transport?: RunTransport;
    broadcast?: (events: readonly { type: string }[]) => void;
  } = {},
) {
  return setup({
    storage: w.storage,
    init: options.init ?? true,
    now: w.time.now,
    transport: options.transport ?? w.transport,
    alarm: w.alarm,
    random: options.random ?? (() => 0),
    outbox: { ackTimeoutMs: 10_000, maxDelayMs: 80_000, maxAttempts: 3, ...options.outbox },
    handlers: [queueingHandler(w.target)],
    members: [
      [alice, member('contributor')],
      [aliceAgent, options.agent ?? agentMember('project')],
    ],
    ...(options.broadcast === undefined ? {} : { broadcast: options.broadcast }),
  });
}

function rows(storage: TestStorage) {
  return storage.db.prepare('SELECT seq, state, attempts, cancel_reason FROM outbox ORDER BY seq').all() as {
    seq: number;
    state: string;
    attempts: number;
    cancel_reason: string | null;
  }[];
}

function create(fixture: ReturnType<typeof coordinator>, title = 'Checkout') {
  return fixture.core.applyCommand(
    alice,
    commandText('feature.create', { title, goal: 'Ship it' }, { epoch: fixture.epoch }),
  );
}

describe('run outbox delivery', () => {
  it('after commit the item goes to the run; socket send alone leaves the row sent, not acked (H05)', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    const fixture = coordinator(w);
    expect(create(fixture).ok).toBe(true);

    expect(w.transport.sent).toHaveLength(1);
    const [delivery] = w.transport.sent;
    expect(delivery).toMatchObject({ run_id: RUN, seq: 1, prev_seq: 0, recovery_epoch: fixture.epoch });
    expect(delivery!.item).toMatchObject({
      type: 'question.answered',
      run_id: RUN,
      answer: { trust: 'untrusted', text: 'Checkout' },
    });
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'sent', attempts: 1, cancel_reason: null }]);
    expect(fixture.core.deliveryStatus(RUN)).toMatchObject({ pending: 1, stalled: 0 });

    // Only the run's cursor acknowledgement settles it.
    expect(fixture.core.acknowledgeDelivery(RUN, 1)).toEqual({ ok: true, acked: 1 });
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'acked', attempts: 1, cancel_reason: null }]);
    expect(fixture.core.deliveryStatus(RUN)).toEqual({ pending: 0, stalled: 0 });
    expect(w.alarm.at).toBeUndefined();
  });

  it('an acknowledgement settles every earlier row, refuses positions never issued, and never goes back', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    const fixture = coordinator(w);
    for (const title of ['One', 'Two', 'Three']) expect(create(fixture, title).ok).toBe(true);
    expect(w.transport.sent.map((d) => [d.seq, d.prev_seq])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);

    expect(fixture.core.acknowledgeDelivery(RUN, 4)).toEqual({ ok: false, reason: 'beyond_last_position' });
    expect(fixture.core.acknowledgeDelivery(OTHER_RUN, 1)).toEqual({
      ok: false,
      reason: 'beyond_last_position',
    });
    expect(fixture.core.acknowledgeDelivery(RUN, 0)).toBeUndefined();
    expect(fixture.core.acknowledgeDelivery(RUN, 1.5)).toBeUndefined();
    expect(fixture.core.acknowledgeDelivery('not-a-run', 1)).toBeUndefined();

    expect(fixture.core.acknowledgeDelivery(RUN, 2)).toEqual({ ok: true, acked: 2 });
    expect(fixture.core.acknowledgeDelivery(RUN, 1)).toEqual({ ok: true, acked: 0 });
    expect(rows(w.storage).map((r) => r.state)).toEqual(['acked', 'acked', 'sent']);
  });

  it('object evicted after commit and before send delivers the row after restart (C03)', () => {
    const w = world();
    const before = coordinator(w);
    // The commit lands, then the object is evicted before anything is sent.
    expect(create(before).ok).toBe(true);
    expect(w.transport.sent).toEqual([]);
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'pending', attempts: 0, cancel_reason: null }]);

    // The adapter's socket survives the eviction (#13 hibernates it); a new object starts.
    w.transport.online.set(RUN, aliceAgent);
    w.alarm.clear();
    const after = coordinator(w, { init: false });
    expect(w.alarm.at).toBe(w.time.ms + DEFAULT_OUTBOX_CONFIG.minAlarmDelayMs);

    w.time.set(w.alarm.at!);
    after.core.deliver();
    expect(w.transport.sent.map((d) => d.seq)).toEqual([1]);
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'sent', attempts: 1, cancel_reason: null }]);
  });

  it('the retry schedule survives object restart (H10)', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    expect(create(coordinator(w)).ok).toBe(true);
    const scheduled = Date.parse(
      (w.storage.db.prepare('SELECT next_attempt_at AS at FROM outbox').get() as { at: string }).at,
    );
    expect(scheduled).toBe(START + 5_000);
    expect(w.alarm.at).toBe(scheduled);

    w.alarm.clear();
    const restarted = coordinator(w, { init: false });
    expect(w.alarm.at).toBe(scheduled);

    // Before the stored time nothing is resent; at it, the second attempt goes out.
    restarted.core.deliver();
    expect(w.transport.sent).toHaveLength(1);
    w.time.set(scheduled);
    restarted.core.deliver();
    expect(w.transport.sent).toHaveLength(2);
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'sent', attempts: 2, cancel_reason: null }]);
  });

  it('backs off with jitter and, after the attempt limit, stalls the row with an event and keeps it (stress H05)', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    const published: string[] = [];
    const fixture = coordinator(w, {
      random: () => 0.5,
      broadcast: (events) => published.push(...events.map((e) => e.type)),
    });
    expect(create(fixture).ok).toBe(true);

    // Waits after each send at this jitter: 75% of 10s, 20s and 40s.
    const sentAt = [w.time.ms];
    for (let i = 0; i < 2; i++) {
      w.time.set(w.alarm.at!);
      fixture.core.deliver();
      sentAt.push(w.time.ms);
    }
    expect(sentAt.slice(1).map((t, i) => t - sentAt[i]!)).toEqual([7_500, 15_000]);
    expect(w.transport.sent).toHaveLength(3);
    expect(w.alarm.at! - sentAt[2]!).toBe(30_000);

    // The third send also went unacknowledged: the row stalls instead of a fourth send.
    w.time.set(w.alarm.at!);
    fixture.core.deliver();
    expect(w.transport.sent).toHaveLength(3);
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'stalled', attempts: 3, cancel_reason: null }]);
    expect(w.alarm.at).toBeUndefined();
    expect(published).toContain('delivery.stalled');
    const stalled = w.storage.db
      .prepare(
        "SELECT record_type, record_version, actor, source, payload FROM events WHERE type = 'delivery.stalled'",
      )
      .get() as Record<string, string | number>;
    expect(stalled).toMatchObject({
      record_type: 'delivery',
      record_version: 2,
      actor: JSON.stringify({ kind: 'system' }),
      source: 'coordinator',
    });
    expect(JSON.parse(stalled['payload'] as string)).toMatchObject({ run_id: RUN, seq: 1, attempts: 3 });
    expect(fixture.core.deliveryStatus(RUN)).toMatchObject({ pending: 1, stalled: 1 });

    // A stalled row is never retried or deleted, and a late acknowledgement still settles it.
    w.time.advance(3_600_000);
    fixture.core.deliver();
    expect(w.transport.sent).toHaveLength(3);
    expect(fixture.core.acknowledgeDelivery(RUN, 1)).toEqual({ ok: true, acked: 1 });
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'acked', attempts: 3, cancel_reason: null }]);
  });

  it('retry delays double up to the cap and stay between half and all of the full delay', () => {
    const config = { ...DEFAULT_OUTBOX_CONFIG, ackTimeoutMs: 1_000, maxDelayMs: 6_000 };
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(config, n, () => 0.999999))).toEqual([
      1_000, 2_000, 4_000, 6_000, 6_000,
    ]);
    expect([1, 2, 3, 4].map((n) => retryDelay(config, n, () => 0))).toEqual([500, 1_000, 2_000, 3_000]);
    // A broken jitter source cannot push a delay outside those bounds.
    expect(retryDelay(config, 1, () => 7)).toBe(1_000);
    expect(retryDelay(config, 1, () => -3)).toBe(500);
  });

  it('an offline adapter causes no retry storm; its rows wait without consuming attempts (C08)', () => {
    const w = world();
    const fixture = coordinator(w);
    for (const title of ['One', 'Two', 'Three']) expect(create(fixture, title).ok).toBe(true);
    for (let i = 0; i < 20; i++) {
      w.time.advance(600_000);
      fixture.core.deliver();
    }
    expect(w.transport.sent).toEqual([]);
    expect(w.alarm.sets).toBe(0);
    expect(w.alarm.at).toBeUndefined();
    expect(rows(w.storage).map((r) => [r.state, r.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
      ['pending', 0],
    ]);
    expect(fixture.core.deliveryStatus(RUN)).toEqual({
      pending: 3,
      stalled: 0,
      oldest_pending_at: new Date(START).toISOString(),
      oldest_pending_age_ms: 20 * 600_000,
    });

    // When the adapter connects, everything it has not acknowledged goes out, in order.
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent.map((d) => d.seq)).toEqual([1, 2, 3]);
    expect(rows(w.storage).map((r) => r.attempts)).toEqual([1, 1, 1]);
  });

  it('a reconnecting adapter is sent what it has not acknowledged, at once and with the same positions', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    const fixture = coordinator(w);
    for (const title of ['One', 'Two']) expect(create(fixture, title).ok).toBe(true);
    expect(fixture.core.acknowledgeDelivery(RUN, 1)).toEqual({ ok: true, acked: 1 });
    const second = w.transport.sent[1]!;

    w.transport.online.delete(RUN);
    w.time.advance(1_000);
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent).toHaveLength(3);
    expect(w.transport.sent[2]).toEqual(second);
  });

  it('rows for a revoked credential are cancelled, not sent (H06)', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    const fixture = coordinator(w);
    expect(create(fixture, 'Before').ok).toBe(true);
    expect(w.transport.sent).toHaveLength(1);

    fixture.authority.set(aliceAgent, undefined);
    expect(create(fixture, 'After').ok).toBe(true);
    w.time.set(START + 3_600_000);
    fixture.core.deliver();
    expect(w.transport.sent).toHaveLength(1);
    expect(rows(w.storage).map((r) => [r.state, r.cancel_reason])).toEqual([
      ['cancelled', 'revoked'],
      ['cancelled', 'revoked'],
    ]);
    expect(fixture.core.deliveryStatus(RUN)).toEqual({ pending: 0, stalled: 0 });
    expect(w.alarm.at).toBeUndefined();
  });

  it('rows outside the run’s current scope are cancelled, not sent, while rows inside it go out (H06)', () => {
    const w = world();
    w.transport.online.set(RUN, aliceAgent);
    const fixture = coordinator(w, { agent: agentMember([PACKAGE_A]) });

    w.target.scope = PACKAGE_A;
    expect(create(fixture, 'In scope').ok).toBe(true);
    w.target.scope = PACKAGE_B;
    expect(create(fixture, 'Other package').ok).toBe(true);
    w.target.scope = 'project';
    expect(create(fixture, 'Whole project').ok).toBe(true);

    expect(w.transport.sent.map((d) => d.seq)).toEqual([1]);
    expect(rows(w.storage).map((r) => [r.state, r.cancel_reason])).toEqual([
      ['sent', null],
      ['cancelled', 'out_of_scope'],
      ['cancelled', 'out_of_scope'],
    ]);

    // A row sent while in scope is cancelled at its retry once the scope no longer covers it.
    fixture.authority.set(aliceAgent, agentMember([PACKAGE_B]));
    w.time.set(w.alarm.at!);
    fixture.core.deliver();
    expect(w.transport.sent).toHaveLength(1);
    expect(rows(w.storage)[0]).toMatchObject({ state: 'cancelled', cancel_reason: 'out_of_scope' });
  });

  it('a revocation can also cancel a run’s rows directly, whether or not it is connected (#22)', () => {
    const w = world();
    const fixture = coordinator(w);
    for (const title of ['One', 'Two']) expect(create(fixture, title).ok).toBe(true);
    expect(fixture.core.cancelDeliveries(RUN, 'revoked')).toBe(2);
    expect(fixture.core.cancelDeliveries(RUN, 'revoked')).toBe(0);
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent).toEqual([]);
  });

  it('a row from an earlier recovery epoch is cancelled rather than replayed (H09)', () => {
    const w = world();
    const fixture = coordinator(w);
    expect(create(fixture).ok).toBe(true);
    w.storage.db.prepare("UPDATE outbox SET recovery_epoch = 'ep_restoredFromBackup01'").run();
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent).toEqual([]);
    expect(rows(w.storage)[0]).toMatchObject({ state: 'cancelled', cancel_reason: 'epoch_changed' });
  });

  it('a duplicate send after a lost sent-marker carries the same inbox item ID and sequence (C04)', () => {
    const w = world();
    const fixture = coordinator(w);
    expect(create(fixture).ok).toBe(true);
    const unsent = w.storage.db
      .prepare('SELECT id, state, attempts, last_sent_at, next_attempt_at FROM outbox')
      .get() as { id: number; state: string; attempts: number; last_sent_at: null; next_attempt_at: string };

    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent).toHaveLength(1);

    // The frame left, but the write that recorded it was lost: the row is as it was before.
    w.storage.db
      .prepare(
        'UPDATE outbox SET state = ?, attempts = ?, last_sent_at = ?, next_attempt_at = ? WHERE id = ?',
      )
      .run(unsent.state, unsent.attempts, unsent.last_sent_at, unsent.next_attempt_at, unsent.id);
    const restarted = coordinator(w, { init: false });
    restarted.core.runConnected(RUN);

    expect(w.transport.sent).toHaveLength(2);
    expect(w.transport.sent[1]).toEqual(w.transport.sent[0]);
    // The adapter deduplicates by item ID and position, and one acknowledgement settles it.
    expect(restarted.core.acknowledgeDelivery(RUN, 1)).toEqual({ ok: true, acked: 1 });
  });

  it('a pass sends at most one batch per run, and the alarm picks up the rest without a tight loop', () => {
    const w = world();
    const fixture = coordinator(w, { outbox: { batchSize: 2 } });
    for (const title of ['One', 'Two', 'Three']) expect(create(fixture, title).ok).toBe(true);
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent.map((d) => d.seq)).toEqual([1, 2]);
    expect(w.alarm.at).toBe(w.time.ms + DEFAULT_OUTBOX_CONFIG.minAlarmDelayMs);
    w.time.set(w.alarm.at!);
    fixture.core.deliver();
    expect(w.transport.sent.map((d) => d.seq)).toEqual([1, 2, 3]);
  });

  it('a connection listed under the wrong run is not served, cancels nothing and does not arm the alarm', () => {
    const w = world();
    const fixture = coordinator(w, {
      agent: member('contributor', { scope: 'project', run_id: OTHER_RUN }),
    });
    expect(create(fixture).ok).toBe(true);
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(w.transport.sent).toEqual([]);
    expect(rows(w.storage)).toEqual([{ seq: 1, state: 'pending', attempts: 0, cancel_reason: null }]);
    expect(fixture.errors.some((m) => m.includes('not bound to the run'))).toBe(true);
    expect(w.alarm.at).toBeUndefined();
  });

  it('a socket that closes mid-batch leaves the rest recorded as sent, retried with the same positions', () => {
    const w = world();
    expect(create(coordinator(w), 'One').ok).toBe(true);
    let sends = 0;
    const flaky: RunTransport = {
      connectedRuns: () => [RUN],
      connection: () => aliceAgent,
      send: (delivery) => {
        sends += 1;
        if (sends === 2) throw new Error('socket closed');
        w.transport.sent.push(delivery);
      },
    };
    const fixture = coordinator(w, { init: false, transport: flaky });
    // A second item, committed while the object was down, so both are due together.
    w.storage.db
      .prepare(
        `INSERT INTO outbox (run_id, seq, item_id, scope, item, recovery_epoch, causal_request_id, state,
           attempts, next_attempt_at, created_at)
         SELECT run_id, 2, 'inb_secondItemAAAAAAAAAAAAA', scope,
                json_set(item, '$.item_id', 'inb_secondItemAAAAAAAAAAAAA'), recovery_epoch,
                causal_request_id, 'pending', 0, next_attempt_at, created_at
           FROM outbox WHERE seq = 1`,
      )
      .run();
    w.storage.db.prepare('UPDATE outbox_positions SET last_seq = 2').run();
    fixture.core.deliver();
    expect(w.transport.sent.map((d) => d.seq)).toEqual([1]);
    expect(rows(w.storage).map((r) => [r.state, r.attempts])).toEqual([
      ['sent', 1],
      ['sent', 1],
    ]);
    w.time.set(w.alarm.at!);
    fixture.core.deliver();
    expect(w.transport.sent.map((d) => d.seq)).toEqual([1, 1, 2]);
  });

  it('a run with too many unsettled items refuses the causing command and writes nothing (H10)', () => {
    const w = world();
    w.target.maxOpenPerRun = 2;
    const fixture = coordinator(w);
    expect(create(fixture, 'One').ok).toBe(true);
    expect(create(fixture, 'Two').ok).toBe(true);
    const before = snapshot(w.storage.db);
    expect(create(fixture, 'Three')).toMatchObject({
      ok: false,
      error: { code: 'limit_exceeded', limit: 2 },
    });
    // Only the rejected receipt, which lets a retry get the same answer.
    expect(snapshot(w.storage.db)).toEqual({ ...before, command_receipts: before['command_receipts']! + 1 });

    // Settling items makes room again.
    w.transport.online.set(RUN, aliceAgent);
    fixture.core.runConnected(RUN);
    expect(fixture.core.acknowledgeDelivery(RUN, 2)).toEqual({ ok: true, acked: 2 });
    expect(create(fixture, 'Four').ok).toBe(true);
  });

  it('a queued item gets a delivery record, and a malformed item writes nothing', () => {
    const w = world();
    const fixture = coordinator(w);
    const created = create(fixture);
    if (!created.ok) throw new Error('expected the command to commit');
    const itemId = created.result['item_id'] as string;
    expect(itemId).toMatch(/^inb_/);
    expect(w.storage.db.prepare('SELECT type, version FROM records WHERE id = ?').get(itemId)).toEqual({
      type: 'delivery',
      version: 1,
    });

    const before = snapshot(w.storage.db);
    expect(() =>
      w.storage.transactionSync(() =>
        enqueueInboxItem(w.storage.sql, {
          run_id: RUN,
          scope: 'project',
          item: {
            type: 'question.answered',
            source_seq: 1,
            from: { kind: 'human', user_id: ALICE },
            question_id: 'not-a-question',
            answer: untrusted('x'),
          },
          causal_request_id: formatId('request', 'requestZZZZ99'),
          now: new Date(START).toISOString(),
        }),
      ),
    ).toThrow();
    expect(snapshot(w.storage.db)).toEqual(before);
  });

  it('an empty object delivers nothing, answers no delivery call and arms no alarm', () => {
    const w = world();
    const empty = coordinator(w, { init: false });
    w.transport.online.set(RUN, aliceAgent);
    empty.core.deliver();
    empty.core.runConnected(RUN);
    expect(empty.core.deliveryStatus(RUN)).toBeUndefined();
    expect(empty.core.acknowledgeDelivery(RUN, 1)).toBeUndefined();
    expect(empty.core.cancelDeliveries(RUN, 'revoked')).toBeUndefined();
    expect(w.alarm.sets).toBe(0);
    expect(snapshot(w.storage.db)).toEqual({});
  });
});

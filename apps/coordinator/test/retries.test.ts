// Issue #11: command windows, retained outcomes and receipt reads (rules H04, H06; invariant 5).
import { CommandWindowSchema, formatId, ReceiptStatusSchema } from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import { principalKey, type Principal } from '../src/mutations/principal.js';
import { DEFAULT_RETRY_CONFIG } from '../src/mutations/windows.js';
import { handleRequest, type RouterDeps } from '../src/worker/router.js';

import {
  alice,
  blair,
  commandText,
  member,
  PROJECT,
  requestId,
  seedRecord,
  setup,
} from './support/harness.js';
import { snapshot, type TestStorage } from './support/sqlite.js';

const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };
const QUESTION = formatId('question', 'questionAA01');
const START = Date.parse('2026-11-28T10:00:00.000Z');
const RETRY = { windowMs: 60_000, graceMs: 120_000, maxLiveReceipts: 50, maxLiveWindowsPerPrincipal: 4 };
const BASE = `https://coordinator.test/v1/projects/${PROJECT}`;

/**
 * Everything except command windows, whose expired rows are pruned as housekeeping. Pruning an
 * expired window changes nothing anyone can use, so it does not count as a mutation.
 */
function projectState(storage: TestStorage): Record<string, number> {
  const { command_windows: _windows, ...rest } = snapshot(storage.db);
  void _windows;
  return rest;
}

/** A fixture with a clock the test moves forward. */
function timed(options: Parameters<typeof setup>[0] = {}) {
  let now = START;
  const fixture = setup({ retry: RETRY, now: () => new Date(now), ...options });
  return {
    ...fixture,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function feature(epoch: string, request = requestId(), extra: { as?: Principal; title?: string } = {}) {
  return commandText(
    'feature.create',
    { ...FEATURE, ...(extra.title === undefined ? {} : { title: extra.title }) },
    { epoch, request, ...(extra.as === undefined ? {} : { as: extra.as }) },
  );
}

function deps(fixture: ReturnType<typeof timed>, principal: Principal): RouterDeps {
  return {
    authenticate: () => Promise.resolve(principal),
    coordinatorFor: () => ({
      applyCommand: (p, text) => Promise.resolve(fixture.core.applyCommand(p, text)),
      issueCommandWindow: (p) => Promise.resolve(fixture.core.issueCommandWindow(p)),
      readReceipt: (p, request) => Promise.resolve(fixture.core.readReceipt(p, request)),
    }),
  };
}

describe('command windows', () => {
  it('POST command-windows issues a window bound to principal, scope and epoch, with a provisional duration', async () => {
    const fixture = timed();
    const response = await handleRequest(
      new Request(`${BASE}/command-windows`, { method: 'POST' }),
      deps(fixture, alice),
    );
    expect(response.status).toBe(201);
    const window = CommandWindowSchema.parse(await response.json());
    expect(window.recovery_epoch).toBe(fixture.epoch);
    expect(window.expires_at).toBe(new Date(START + RETRY.windowMs).toISOString());
    expect(DEFAULT_RETRY_CONFIG.windowMs).toBeGreaterThan(0);

    // It belongs to Alice alone: Blair naming it is refused as if it did not exist.
    fixture.authority.set(blair, member('contributor'));
    const borrowed = commandText('feature.create', FEATURE, {
      epoch: fixture.epoch,
      as: blair,
      window: window.command_window_id,
    });
    expect(fixture.core.applyCommand(blair, borrowed)).toMatchObject({
      ok: false,
      error: { code: 'command_window_invalid', field: 'command_window_id' },
    });
  });

  it('an old command retried after its window expired is refused and mutates nothing (C06)', () => {
    const fixture = timed();
    const request = requestId();
    const text = feature(fixture.epoch, request);
    expect(fixture.core.applyCommand(alice, text).ok).toBe(true);
    fixture.advance(RETRY.windowMs);
    const before = projectState(fixture.storage);
    // The protocol's code for an expired window is command_window_invalid.
    expect(fixture.core.applyCommand(alice, text)).toMatchObject({
      ok: false,
      error: { code: 'command_window_invalid' },
    });
    expect(projectState(fixture.storage)).toEqual(before);
    // Its receipt is still there to read: the client reconciles through it.
    expect(fixture.core.readReceipt(alice, request)).toMatchObject({
      ok: true,
      receipt: { status: 'committed' },
    });
  });

  it('a window from an earlier recovery epoch is rejected with epoch_mismatch', () => {
    const fixture = timed();
    // A window restored from a backup taken before recovery: same principal, older epoch.
    const restored = formatId('command_window', 'restoredWin01');
    fixture.storage.db
      .prepare(
        "INSERT INTO command_windows (id, principal_key, scope, recovery_epoch, issued_at, expires_at) VALUES (?, ?, 'scope:member', 'ep_olderEpoch00001', 'x', '9999-01-01T00:00:00.000Z')",
      )
      .run(restored, principalKey(alice));
    const before = snapshot(fixture.storage.db);
    const text = commandText('feature.create', FEATURE, { epoch: fixture.epoch, window: restored });
    // The protocol's code for this is recovery_epoch_mismatch.
    expect(fixture.core.applyCommand(alice, text)).toMatchObject({
      ok: false,
      error: { code: 'recovery_epoch_mismatch', field: 'command_window_id' },
    });
    expect(snapshot(fixture.storage.db)).toEqual(before);
  });

  it('a change of scope invalidates windows issued under the old one', () => {
    const fixture = timed();
    const old = fixture.windows.get(principalKey(alice))!;
    const withOld = () => commandText('feature.create', FEATURE, { epoch: fixture.epoch, window: old });
    // Same standing again: the earlier window still holds.
    fixture.authority.set(alice, member('contributor'));
    expect(fixture.core.applyCommand(alice, withOld()).ok).toBe(true);
    fixture.authority.set(alice, member('contributor', { scope: 'project' }));
    expect(fixture.core.applyCommand(alice, withOld())).toMatchObject({
      ok: false,
      error: { code: 'command_window_invalid' },
    });
  });

  it('a non-member cannot obtain a window, and a principal holds a bounded number', () => {
    const fixture = timed();
    expect(fixture.core.issueCommandWindow(blair)).toMatchObject({
      ok: false,
      error: { code: 'not_a_member' },
    });
    // The harness already issued Alice one.
    for (let i = 1; i < RETRY.maxLiveWindowsPerPrincipal; i += 1) {
      expect(fixture.core.issueCommandWindow(alice).ok).toBe(true);
    }
    expect(fixture.core.issueCommandWindow(alice)).toMatchObject({
      ok: false,
      error: { code: 'limit_exceeded', limit: RETRY.maxLiveWindowsPerPrincipal },
    });
    // Expired windows stop counting.
    fixture.advance(RETRY.windowMs);
    expect(fixture.core.issueCommandWindow(alice).ok).toBe(true);
  });
});

describe('retained outcomes', () => {
  it('same request_id and payload within the window returns the stored outcome and writes no new event (C01)', () => {
    const fixture = timed();
    const request = requestId();
    const first = fixture.core.applyCommand(alice, feature(fixture.epoch, request));
    expect(first).toMatchObject({ ok: true, replayed: false });
    const before = snapshot(fixture.storage.db);
    // The response was lost; the client sends the same command again.
    const again = fixture.core.applyCommand(alice, feature(fixture.epoch, request));
    expect(again).toEqual({ ...first, replayed: true });
    expect(snapshot(fixture.storage.db)).toEqual(before);
  });

  it('same request_id with a different payload returns idempotency_conflict and leaves the original unchanged (C02)', () => {
    const fixture = timed();
    const request = requestId();
    const first = fixture.core.applyCommand(alice, feature(fixture.epoch, request));
    const before = snapshot(fixture.storage.db);
    const receipt = fixture.core.readReceipt(alice, request);
    // The protocol's code for this is request_id_conflict.
    expect(
      fixture.core.applyCommand(alice, feature(fixture.epoch, request, { title: 'Other' })),
    ).toMatchObject({
      ok: false,
      error: { code: 'request_id_conflict', field: 'request_id' },
    });
    expect(snapshot(fixture.storage.db)).toEqual(before);
    expect(fixture.core.readReceipt(alice, request)).toEqual(receipt);
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request))).toEqual({
      ...first,
      replayed: true,
    });
  });

  it('a revoked principal retrying an earlier successful request is refused before any cached result is returned (E02)', () => {
    const fixture = timed();
    const request = requestId();
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(true);
    const text = feature(fixture.epoch, request);
    fixture.authority.set(alice, undefined);
    const retried = fixture.core.applyCommand(alice, text);
    expect(retried).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_a_member' }) });
    expect(JSON.stringify(retried)).not.toContain('feature_id');
    expect(fixture.core.readReceipt(alice, request)).toMatchObject({
      ok: false,
      error: { code: 'not_a_member' },
    });
  });

  it('a refusal after the request check is retained: the retry gets the same answer and writes nothing', () => {
    const fixture = timed();
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    const request = requestId();
    const stale = () =>
      commandText(
        'question.answer',
        { question_id: QUESTION, text: 'yes' },
        { epoch: fixture.epoch, request, expected: { record_version: 1 } },
      );
    const first = fixture.core.applyCommand(alice, stale());
    expect(first).toMatchObject({ ok: false, error: { code: 'stale_version' } });
    const before = snapshot(fixture.storage.db);
    expect(fixture.core.applyCommand(alice, stale())).toEqual({ ...first, replayed: true });
    expect(snapshot(fixture.storage.db)).toEqual(before);
  });

  it('refusals before the request check leave no receipt', () => {
    const fixture = timed();
    const request = requestId();
    fixture.advance(RETRY.windowMs);
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(false);
    expect(fixture.core.readReceipt(alice, request)).toEqual({
      ok: true,
      receipt: { request_id: request, status: 'unknown' },
    });
  });
});

describe('receipt reads', () => {
  it('GET commands/:requestId returns committed, rejected or unknown for the caller', async () => {
    const fixture = timed();
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    const committed = requestId();
    const rejected = requestId();
    const committedResult = fixture.core.applyCommand(alice, feature(fixture.epoch, committed));
    fixture.core.applyCommand(
      alice,
      commandText(
        'question.answer',
        { question_id: QUESTION, text: 'yes' },
        { epoch: fixture.epoch, request: rejected, expected: { record_version: 1 } },
      ),
    );
    const get = async (request: string) => {
      const response = await handleRequest(new Request(`${BASE}/commands/${request}`), deps(fixture, alice));
      expect(response.status).toBe(200);
      return ReceiptStatusSchema.parse(await response.json());
    };
    const done = await get(committed);
    if (done.status !== 'committed' || !committedResult.ok) throw new Error('expected a committed receipt');
    expect(done.command_type).toBe('feature.create');
    expect(done.events).toEqual(committedResult.events.map((e) => e.seq));
    expect(done.result).toEqual(committedResult.result);
    expect(await get(rejected)).toMatchObject({ status: 'rejected', error: { code: 'stale_version' } });
    const never = requestId();
    expect(await get(never)).toEqual({ request_id: never, status: 'unknown' });
  });

  it("a principal cannot read another principal's receipt (H06)", async () => {
    const fixture = timed({
      members: [
        [alice, member('contributor')],
        [blair, member('contributor')],
      ],
    });
    const request = requestId();
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(true);
    const response = await handleRequest(new Request(`${BASE}/commands/${request}`), deps(fixture, blair));
    expect(await response.json()).toEqual({ request_id: request, status: 'unknown' });
    // Blair reusing Alice's request ID is Blair's own new request, not a replay of Alice's.
    const blairs = fixture.core.applyCommand(blair, feature(fixture.epoch, request, { as: blair }));
    expect(blairs).toMatchObject({ ok: true, replayed: false });
  });

  it('a malformed request ID is not routed, and a removed member reads nothing', async () => {
    const fixture = timed();
    const malformed = await handleRequest(
      new Request(`${BASE}/commands/not-a-request`),
      deps(fixture, alice),
    );
    expect(malformed.status).toBe(404);
    fixture.authority.set(alice, undefined);
    const response = await handleRequest(
      new Request(`${BASE}/commands/${requestId()}`),
      deps(fixture, alice),
    );
    expect(response.status).toBe(403);
  });
});

describe('receipt retention', () => {
  it('receipts are kept until window expiry plus the grace period, then read as unknown', () => {
    const fixture = timed();
    const request = requestId();
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(true);
    const retain = fixture.storage.db
      .prepare('SELECT retain_until FROM command_receipts WHERE request_id = ?')
      .get(request) as { retain_until: string };
    expect(retain.retain_until).toBe(new Date(START + RETRY.windowMs + RETRY.graceMs).toISOString());

    fixture.advance(RETRY.windowMs + RETRY.graceMs - 1);
    expect(fixture.core.readReceipt(alice, request)).toMatchObject({
      ok: true,
      receipt: { status: 'committed' },
    });
    fixture.advance(1);
    expect(fixture.core.readReceipt(alice, request)).toMatchObject({
      ok: true,
      receipt: { status: 'unknown' },
    });
  });

  it('at receipt-storage limit, new commands get limit_exceeded and no live receipt is evicted (H04)', () => {
    const fixture = timed({ retry: { ...RETRY, maxLiveReceipts: 3 } });
    // init left one receipt; two commands fill the limit.
    const kept = [requestId(), requestId()];
    for (const request of kept) {
      expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(true);
    }
    const before = snapshot(fixture.storage.db);
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch))).toMatchObject({
      ok: false,
      error: { code: 'limit_exceeded', limit: 3 },
    });
    expect(snapshot(fixture.storage.db)).toEqual(before);
    for (const request of kept) {
      expect(fixture.core.readReceipt(alice, request)).toMatchObject({
        ok: true,
        receipt: { status: 'committed' },
      });
    }

    // Once receipts outlive their window and grace period, room frees up on its own.
    fixture.advance(RETRY.windowMs + RETRY.graceMs);
    fixture.authority.set(alice, member('contributor'));
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch)).ok).toBe(true);
  });
});

describe('a timed-out client', () => {
  it('queries before deciding: the receipt says committed, and a retry returns the same outcome', () => {
    const fixture = timed();
    const request = requestId();
    const text = feature(fixture.epoch, request);
    fixture.core.applyCommand(alice, text); // the response is lost on the way back
    expect(fixture.core.readReceipt(alice, request)).toMatchObject({
      ok: true,
      receipt: { status: 'committed' },
    });
    const count = () =>
      fixture.storage.db.prepare("SELECT count(*) AS n FROM events WHERE type = 'feature.created'").get();
    const events = count();
    expect(fixture.core.applyCommand(alice, text)).toMatchObject({ ok: true, replayed: true });
    expect(count()).toEqual(events);
  });
});

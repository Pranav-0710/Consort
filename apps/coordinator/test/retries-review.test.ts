// The cases the first review of #11 asked to be pinned down: requests bound to their window,
// receipt reads under current scope and run, rejection recording, per-principal limits, the
// migration backfill and the route details.
import { formatId } from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import { applyMigrations, MIGRATIONS } from '../src/db/migrations.js';
import type { Principal } from '../src/mutations/principal.js';
import { handleRequest, type CoordinatorStub, type RouterDeps } from '../src/worker/router.js';

import {
  agentMember,
  alice,
  aliceAgent,
  ALICE,
  BLAIR,
  blair,
  commandText,
  member,
  PROJECT,
  requestId,
  RUN,
  seedRecord,
  setup,
} from './support/harness.js';
import { memoryStorage, snapshot, type TestStorage } from './support/sqlite.js';

const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };
const QUESTION = formatId('question', 'questionAA01');
const PACKAGE = formatId('package', 'packageAAA01');
const START = Date.parse('2026-11-28T10:00:00.000Z');
const RETRY = {
  windowMs: 60_000,
  graceMs: 120_000,
  maxLiveReceipts: 50,
  maxLiveReceiptsPerPrincipal: 20,
  maxLiveWindowsPerPrincipal: 8,
};
const BASE = `https://coordinator.test/v1/projects/${PROJECT}`;

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

function feature(epoch: string, request: string, extra: { window?: string; as?: Principal } = {}) {
  return commandText('feature.create', FEATURE, { epoch, request, ...extra });
}

function stale(epoch: string, request: string, as?: Principal) {
  return commandText(
    'question.answer',
    { question_id: QUESTION, text: 'yes' },
    { epoch, request, expected: { record_version: 1 }, ...(as === undefined ? {} : { as }) },
  );
}

const created = (storage: TestStorage) =>
  storage.db.prepare("SELECT count(*) AS n FROM events WHERE type = 'feature.created'").get();

function stubOf(fixture: ReturnType<typeof timed>): CoordinatorStub {
  return {
    applyCommand: (p, text) => Promise.resolve(fixture.core.applyCommand(p, text)),
    issueCommandWindow: (p) => Promise.resolve(fixture.core.issueCommandWindow(p)),
    readReceipt: (p, request) => Promise.resolve(fixture.core.readReceipt(p, request)),
  };
}

function deps(stub: CoordinatorStub, principal: Principal = alice): RouterDeps {
  return { authenticate: () => Promise.resolve(principal), coordinatorFor: () => stub };
}

describe('a request is bound to its window', () => {
  it('a request ID resent under a different window is refused, not replayed or re-executed', () => {
    const fixture = timed();
    const request = requestId();
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(true);
    const second = fixture.core.issueCommandWindow(alice);
    if (!second.ok) throw new Error('window not issued');
    const elsewhere = feature(fixture.epoch, request, { window: second.window.command_window_id });
    expect(fixture.core.applyCommand(alice, elsewhere)).toMatchObject({
      ok: false,
      error: { code: 'request_id_conflict', field: 'command_window_id' },
    });
    expect(created(fixture.storage)).toEqual({ n: 1 });
  });

  it('the resend-under-a-new-window loop never runs the command twice while its receipt is kept', () => {
    const fixture = timed();
    const request = requestId();
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, request)).ok).toBe(true);
    // A client that answers every refusal by fetching a new window and resending, until the
    // receipt's retention ends (window plus grace): it is refused every time.
    for (let elapsed = 0; elapsed < RETRY.windowMs + RETRY.graceMs; elapsed += 30_000) {
      const window = fixture.core.issueCommandWindow(alice);
      if (!window.ok) throw new Error('window not issued');
      const result = fixture.core.applyCommand(
        alice,
        feature(fixture.epoch, request, { window: window.window.command_window_id }),
      );
      expect(result.ok).toBe(false);
      fixture.advance(30_000);
    }
    expect(created(fixture.storage)).toEqual({ n: 1 });
  });
});

describe('receipt reads use current scope and run (H06)', () => {
  function agentAnswer(fixture: ReturnType<typeof timed>, request: string) {
    return commandText(
      'question.answer',
      { question_id: QUESTION, text: 'yes' },
      { epoch: fixture.epoch, request, agent: true, expected: { record_version: 1 } },
    );
  }

  it('after an agent credential is narrowed, its earlier receipt reads as unknown', () => {
    const fixture = timed({ members: [[aliceAgent, agentMember('project')]] });
    seedRecord(fixture.storage, 'question', QUESTION);
    const request = requestId();
    expect(fixture.core.applyCommand(aliceAgent, agentAnswer(fixture, request)).ok).toBe(true);
    expect(fixture.core.readReceipt(aliceAgent, request)).toMatchObject({ receipt: { status: 'committed' } });
    fixture.authority.set(aliceAgent, agentMember([PACKAGE]));
    expect(fixture.core.readReceipt(aliceAgent, request)).toEqual({
      ok: true,
      receipt: { request_id: request, status: 'unknown' },
    });
  });

  it("a new run on the same connection cannot read the previous run's receipt", () => {
    const fixture = timed({ members: [[aliceAgent, agentMember('project')]] });
    seedRecord(fixture.storage, 'question', QUESTION);
    const request = requestId();
    expect(fixture.core.applyCommand(aliceAgent, agentAnswer(fixture, request)).ok).toBe(true);
    const nextRun = formatId('run', 'runBBBBBBB02');
    expect(nextRun).not.toBe(RUN);
    fixture.authority.set(aliceAgent, member('contributor', { scope: 'project', run_id: nextRun }));
    expect(fixture.core.readReceipt(aliceAgent, request)).toMatchObject({ receipt: { status: 'unknown' } });
  });

  it('a retry after a role downgrade is refused before its cached result (E02)', () => {
    const fixture = timed();
    const request = requestId();
    const text = feature(fixture.epoch, request);
    expect(fixture.core.applyCommand(alice, text).ok).toBe(true);
    fixture.authority.set(alice, member('reader'));
    const retried = fixture.core.applyCommand(alice, text);
    expect(retried).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_authorized' }) });
  });
});

describe('recording rejections', () => {
  it('a refused retry over an expired receipt still records its own rejection', () => {
    const fixture = timed();
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    const request = requestId();
    // An expired receipt under the same key, as if a cleanup had been missed.
    fixture.storage.db
      .prepare(
        "INSERT INTO command_receipts (principal_key, request_id, command_type, content_hash, outcome, result, command_window_id, scope, created_at, retain_until) VALUES ('human:' || ?, ?, 'feature.create', 'old', 'committed', '{}', 'cw_oldWindow0001', 'scope:member', 'x', '2000-01-01T00:00:00.000Z')",
      )
      .run(ALICE, request);
    expect(fixture.core.applyCommand(alice, stale(fixture.epoch, request))).toMatchObject({
      error: { code: 'stale_version' },
    });
    expect(fixture.errors).toEqual([]);
    expect(fixture.core.readReceipt(alice, request)).toMatchObject({
      receipt: { status: 'rejected', error: { code: 'stale_version' } },
    });
  });

  it('a refusal stands even when its receipt cannot be recorded', () => {
    const storage = memoryStorage();
    let failInserts = false;
    const flaky: TestStorage = {
      db: storage.db,
      get inTransaction() {
        return storage.inTransaction;
      },
      sql: {
        exec: (query, ...bindings) => {
          if (failInserts && query.includes('INSERT INTO command_receipts')) throw new Error('disk full');
          return storage.sql.exec(query, ...bindings);
        },
      },
      transactionSync: (fn) => storage.transactionSync(fn),
    };
    const fixture = timed({ storage: flaky });
    seedRecord(flaky, 'question', QUESTION, 2);
    const request = requestId();
    failInserts = true;
    expect(fixture.core.applyCommand(alice, stale(fixture.epoch, request))).toMatchObject({
      ok: false,
      error: { code: 'stale_version' },
    });
    expect(fixture.errors).toEqual(['disk full']);
    failInserts = false;
    // Without a receipt the retry is checked afresh, and gets the same answer.
    expect(fixture.core.applyCommand(alice, stale(fixture.epoch, request))).toMatchObject({
      error: { code: 'stale_version' },
    });
  });

  it('expired receipts are removed even when every command is refused', () => {
    const fixture = timed();
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    for (let i = 0; i < 3; i += 1) fixture.core.applyCommand(alice, stale(fixture.epoch, requestId()));
    fixture.advance(RETRY.windowMs + RETRY.graceMs);
    fixture.authority.set(alice, member('contributor'));
    for (let i = 0; i < 3; i += 1) fixture.core.applyCommand(alice, stale(fixture.epoch, requestId()));
    // Only the three live rejections remain; the earlier three and init's receipt are gone.
    const rows = fixture.storage.db.prepare('SELECT count(*) AS n FROM command_receipts').get();
    expect(rows).toEqual({ n: 3 });
  });
});

describe('pruning before a command', () => {
  it('expired receipts are removed by a refused command alone, with no new window issued', () => {
    const fixture = timed({
      members: [
        [alice, member('contributor')],
        [blair, member('contributor')],
      ],
    });
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    // Alice's refusals at T0 are kept until T0 + window + grace (T0+180s).
    for (let i = 0; i < 3; i += 1) fixture.core.applyCommand(alice, stale(fixture.epoch, requestId()));
    // Blair gets a window at T0+150s, still valid at T0+190s.
    fixture.advance(150_000);
    fixture.authority.set(blair, member('contributor'));
    fixture.advance(40_000);
    // Only Blair's refused command runs now: no window is issued, so only the command path prunes.
    expect(fixture.core.applyCommand(blair, stale(fixture.epoch, requestId(), blair))).toMatchObject({
      error: { code: 'stale_version' },
    });
    const left = fixture.storage.db.prepare('SELECT principal_key FROM command_receipts').all();
    expect(left).toEqual([{ principal_key: `human:${BLAIR}` }]);
  });
});

describe('limits', () => {
  it("one principal's refusals cannot exhaust the project's receipts for everyone", () => {
    const fixture = timed({
      retry: { ...RETRY, maxLiveReceipts: 10, maxLiveReceiptsPerPrincipal: 3 },
      members: [
        [alice, member('contributor')],
        [blair, member('contributor')],
      ],
    });
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    for (let i = 0; i < 3; i += 1) {
      expect(fixture.core.applyCommand(blair, stale(fixture.epoch, requestId(), blair))).toMatchObject({
        error: { code: 'stale_version' },
      });
    }
    expect(fixture.core.applyCommand(blair, stale(fixture.epoch, requestId(), blair))).toMatchObject({
      error: { code: 'limit_exceeded', limit: 3 },
    });
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, requestId())).ok).toBe(true);
  });

  it('a retry is still answered at the receipt limit', () => {
    const fixture = timed({ retry: { ...RETRY, maxLiveReceipts: 2 } });
    const request = requestId();
    const text = feature(fixture.epoch, request);
    const first = fixture.core.applyCommand(alice, text);
    expect(first.ok).toBe(true);
    expect(fixture.core.applyCommand(alice, feature(fixture.epoch, requestId()))).toMatchObject({
      error: { code: 'limit_exceeded' },
    });
    expect(fixture.core.applyCommand(alice, text)).toEqual({ ...first, replayed: true });
  });
});

describe('migration 2 on a project created before it', () => {
  it('backfills retention and scope for receipts written under migration 1', () => {
    const storage = memoryStorage();
    expect(applyMigrations(storage, MIGRATIONS.slice(0, 1)).status).toBe('ready');
    storage.db
      .prepare(
        "INSERT INTO command_receipts (principal_key, request_id, command_type, content_hash, outcome, result, created_at) VALUES ('human:usr_aliceAAAAA01', 'req_oldRequest0001', 'project.init', '', 'committed', '{}', '2026-11-28T10:00:00.000Z')",
      )
      .run();
    expect(applyMigrations(storage).status).toBe('ready');
    const row = storage.db
      .prepare("SELECT retain_until, scope FROM command_receipts WHERE request_id = 'req_oldRequest0001'")
      .get();
    expect(row).toEqual({ retain_until: '2026-11-29T10:15:00.000Z', scope: 'scope:member' });
  });
});

describe('routes for windows and receipts', () => {
  it('a replayed rejection says so over HTTP, and a limit tells the client when to try again', async () => {
    const fixture = timed({ retry: { ...RETRY, maxLiveReceiptsPerPrincipal: 2 } });
    seedRecord(fixture.storage, 'question', QUESTION, 2);
    const request = requestId();
    const post = (body: string) =>
      handleRequest(new Request(`${BASE}/commands`, { method: 'POST', body }), deps(stubOf(fixture)));
    await post(stale(fixture.epoch, request));
    const replayed = await post(stale(fixture.epoch, request));
    expect(replayed.status).toBe(409);
    expect(await replayed.json()).toMatchObject({
      ok: false,
      replayed: true,
      error: { code: 'stale_version' },
    });

    await post(feature(fixture.epoch, requestId()));
    const limited = await post(feature(fixture.epoch, requestId()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('wrong methods get 405 with the allowed method, and receipts are not cached', async () => {
    const fixture = timed();
    const stub = stubOf(fixture);
    const windowGet = await handleRequest(new Request(`${BASE}/command-windows`), deps(stub));
    expect([windowGet.status, windowGet.headers.get('allow')]).toEqual([405, 'POST']);
    const receiptPost = await handleRequest(
      new Request(`${BASE}/commands/${requestId()}`, { method: 'POST', body: '{}' }),
      deps(stub),
    );
    expect([receiptPost.status, receiptPost.headers.get('allow')]).toEqual([405, 'GET']);
    const receipt = await handleRequest(new Request(`${BASE}/commands/${requestId()}`), deps(stub));
    expect(receipt.headers.get('cache-control')).toBe('no-store');
  });

  it('a failed read or window call is project_unavailable; only a failed command is outcome_unknown', async () => {
    const down: CoordinatorStub = {
      applyCommand: () => Promise.reject(new Error('reset')),
      issueCommandWindow: () => Promise.reject(new Error('reset')),
      readReceipt: () => Promise.reject(new Error('reset')),
    };
    const fixture = timed();
    const code = async (response: Response) =>
      ((await response.json()) as { error: { code: string } }).error.code;
    const read = await handleRequest(new Request(`${BASE}/commands/${requestId()}`), deps(down));
    expect(read.status).toBe(503);
    expect(await code(read)).toBe('project_unavailable');
    const window = await handleRequest(
      new Request(`${BASE}/command-windows`, { method: 'POST' }),
      deps(down),
    );
    expect(await code(window)).toBe('project_unavailable');
    const command = await handleRequest(
      new Request(`${BASE}/commands`, { method: 'POST', body: feature(fixture.epoch, requestId()) }),
      deps(down),
    );
    expect(await code(command)).toBe('outcome_unknown');
    expect(snapshot(fixture.storage.db)['command_receipts']).toBe(1);
  });
});

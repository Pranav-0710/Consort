import { describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/db/migrations.js';

import { ALICE, alice, commandText, OTHER_PROJECT, PROJECT, requestId, setup } from './support/harness.js';
import { memoryStorage, snapshot } from './support/sqlite.js';

const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };
const SOME_EPOCH = 'ep_aaaaaaaaaaaaaaaaaaaa';

describe('project creation', () => {
  it('a request to an object with no meta row returns project_not_found and writes nothing', () => {
    // A brand-new object: no tables at all, and touching it must not create any (G08).
    const fresh = setup({ init: false });
    const result = fresh.core.applyCommand(
      alice,
      commandText('feature.create', FEATURE, { epoch: SOME_EPOCH }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'project_not_found' } });
    expect(snapshot(fresh.storage.db)).toEqual({});

    // An object whose schema exists but whose project was never created.
    const storage = memoryStorage();
    applyMigrations(storage);
    const before = snapshot(storage.db);
    const migrated = setup({ storage, init: false });
    const again = migrated.core.applyCommand(
      alice,
      commandText('feature.create', FEATURE, { epoch: SOME_EPOCH }),
    );
    expect(again).toMatchObject({ ok: false, error: { code: 'project_not_found' } });
    expect(snapshot(storage.db)).toEqual(before);
  });

  it('init creates the project once, with a random recovery epoch and its event, and queues nothing for runs', () => {
    const one = setup();
    const two = setup();
    expect(one.epoch).toMatch(/^ep_[A-Za-z0-9]{24}$/);
    expect(one.epoch).not.toBe(two.epoch);

    const db = one.storage.db;
    expect(db.prepare('SELECT project_id, recovery_epoch, created_by FROM meta').all()).toEqual([
      { project_id: PROJECT, recovery_epoch: one.epoch, created_by: ALICE },
    ]);
    expect(db.prepare('SELECT type, record_id, source FROM events').all()).toEqual([
      { type: 'project.created', record_id: PROJECT, source: 'human_action' },
    ]);
    // The outbox holds items for agent runs only; web clients follow the event log (#13).
    expect(db.prepare('SELECT count(*) AS n FROM outbox').get()).toEqual({ n: 0 });

    const before = snapshot(db);
    expect(one.core.init({ project_id: PROJECT, created_by: ALICE, request_id: requestId() })).toEqual({
      ok: false,
      reason: 'exists',
    });
    expect(snapshot(db)).toEqual(before);
  });

  it("a command naming another project's ID gets project_not_found and writes nothing", () => {
    const { core, storage, epoch } = setup();
    const before = snapshot(storage.db);
    const result = core.applyCommand(
      alice,
      commandText('feature.create', FEATURE, { epoch, project: OTHER_PROJECT }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'project_not_found' } });
    expect(snapshot(storage.db)).toEqual(before);
  });

  it('a command from an earlier recovery epoch is refused', () => {
    const { core, epoch } = setup();
    const earlier = 'ep_earlierEpoch0001';
    expect(earlier).not.toBe(epoch);
    const result = core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch: earlier }));
    expect(result).toMatchObject({ ok: false, error: { code: 'recovery_epoch_mismatch' } });
  });
});

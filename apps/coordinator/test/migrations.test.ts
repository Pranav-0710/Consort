import { describe, expect, it } from 'vitest';

import { applyMigrations, MIGRATIONS, schemaVersion, type Migration } from '../src/db/migrations.js';

import { ALICE, alice, commandText, PROJECT, requestId, setup } from './support/harness.js';
import { memoryStorage, snapshot } from './support/sqlite.js';

const LATEST = MIGRATIONS.length;
const BROKEN: Migration = {
  version: LATEST + 1,
  name: 'broken',
  statements: ['CREATE TABLE ok_part (x)', 'NOT SQL AT ALL'],
};
const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };

describe('schema migrations', () => {
  it('fresh object applies all migrations once and a restart applies none', () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    const latest = MIGRATIONS.at(-1)!.version;
    expect(first.core.state).toEqual({
      status: 'ready',
      version: latest,
      applied: MIGRATIONS.map((m) => m.version),
    });
    expect(storage.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual(
      MIGRATIONS.map(({ version }) => ({ version })),
    );

    // A restart is a new core over the same storage.
    const restarted = setup({ storage, init: false });
    expect(restarted.core.state).toEqual({ status: 'ready', version: latest, applied: [] });
    expect(storage.db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({
      n: MIGRATIONS.length,
    });
  });

  it('failed migration leaves schema_version unchanged and every request returns project_unavailable', () => {
    const storage = memoryStorage();
    const { epoch } = setup({ storage });
    const before = snapshot(storage.db);

    const upgraded = setup({ storage, init: false, migrations: [...MIGRATIONS, BROKEN] });
    expect(upgraded.core.state).toMatchObject({ status: 'failed', version: LATEST });
    expect(schemaVersion(storage.sql)).toBe(LATEST);
    // The failed migration's first statement was rolled back with it.
    expect(snapshot(storage.db)).toEqual(before);

    expect(
      upgraded.core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch })),
    ).toMatchObject({
      ok: false,
      error: { code: 'project_unavailable' },
    });
    expect(upgraded.core.init({ project_id: PROJECT, created_by: ALICE, request_id: requestId() })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(snapshot(storage.db)).toEqual(before);
  });

  it('a window or receipt request on a failed, newer-schema or empty object writes nothing', () => {
    const storage = memoryStorage();
    setup({ storage, migrations: [...MIGRATIONS, { version: LATEST + 1, name: 'newer', statements: [] }] });
    const before = snapshot(storage.db);
    const older = setup({ storage, init: false });
    expect(older.core.state).toMatchObject({ status: 'failed' });
    expect(older.core.issueCommandWindow(alice)).toMatchObject({
      ok: false,
      error: { code: 'project_unavailable' },
    });
    expect(older.core.readReceipt(alice, requestId())).toMatchObject({
      ok: false,
      error: { code: 'project_unavailable' },
    });
    expect(snapshot(storage.db)).toEqual(before);

    const empty = setup({ init: false });
    expect(empty.core.issueCommandWindow(alice)).toMatchObject({
      ok: false,
      error: { code: 'project_not_found' },
    });
    expect(snapshot(empty.storage.db)).toEqual({});
    expect(empty.errors).toEqual([]);
  });

  it('storage written by a newer build is refused rather than served (G06)', () => {
    const storage = memoryStorage();
    const { epoch } = setup({
      storage,
      migrations: [...MIGRATIONS, { version: LATEST + 1, name: 'newer', statements: [] }],
    });
    const older = setup({ storage, init: false });
    expect(older.core.state).toMatchObject({ status: 'failed', version: LATEST + 1 });
    expect(older.core.applyCommand(alice, commandText('feature.create', FEATURE, { epoch }))).toMatchObject({
      ok: false,
      error: { code: 'project_unavailable' },
    });
  });

  it('creates the base tables with the indexes the mutation path relies on', () => {
    const storage = memoryStorage();
    expect(applyMigrations(storage).status).toBe('ready');
    const tables = storage.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'meta',
        'events',
        'outbox',
        'outbox_positions',
        'command_windows',
        'command_receipts',
        'schema_migrations',
      ]),
    );

    const indexColumns = (index: string) =>
      storage.db
        .prepare(`SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`)
        .all()
        .map((row) => (row as { name: string }).name);
    expect(indexColumns('outbox_by_run_seq')).toEqual(['run_id', 'seq']);
    expect(indexColumns('outbox_by_run_state_due')).toEqual(['run_id', 'state', 'next_attempt_at']);
    expect(
      storage.db
        .prepare('SELECT "unique" AS u FROM pragma_index_list(\'outbox\') WHERE name = ?')
        .get('outbox_by_run_seq'),
    ).toEqual({ u: 1 });
    expect(indexColumns('command_receipts_by_principal_request')).toEqual(['principal_key', 'request_id']);
    const receiptIndexes = storage.db
      .prepare('SELECT name, "unique" AS u FROM pragma_index_list(\'command_receipts\')')
      .all();
    expect(receiptIndexes).toContainEqual({ name: 'command_receipts_by_principal_request', u: 1 });
    // events.seq is the rowid: the log is stored and looked up in seq order without another index.
    expect(storage.db.prepare("SELECT pk FROM pragma_table_info('events') WHERE name = 'seq'").get()).toEqual(
      { pk: 1 },
    );
  });
});

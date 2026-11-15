import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ItemStore } from './store.js';

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spike-store-'));
  dirs.push(dir);
  return path.join(dir, 'items.jsonl');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ItemStore', () => {
  it('items and observations survive a relay restart', () => {
    const file = tempFile();
    const first = new ItemStore(file);
    const q = first.create({ kind: 'question', from: 'A', to: 'B', body: 'Are retries safe?' });
    first.observe(q.id, { type: 'context_supplied', by: 'B', sessionId: 's1', hookEvent: 'PostToolUse' });

    const reopened = new ItemStore(file);
    const item = reopened.get(q.id);
    expect(item?.body).toBe('Are retries safe?');
    expect(item?.observations.map((o) => o.type)).toEqual(['context_supplied']);
  });

  it('pending excludes acknowledged and answered items', () => {
    const store = new ItemStore(tempFile());
    const acked = store.create({ kind: 'update', from: 'A', to: 'B', body: 'contract v2' });
    const answered = store.create({ kind: 'question', from: 'A', to: 'B', body: 'q' });
    const open = store.create({ kind: 'question', from: 'A', to: 'B', body: 'still open' });
    store.observe(acked.id, { type: 'acked', by: 'B' });
    store.observe(answered.id, { type: 'answered', by: 'B' });

    expect(store.list({ to: 'B', pending: true }).map((i) => i.id)).toEqual([open.id]);
  });

  it('an item supplied to one session is still offered to another session', () => {
    const store = new ItemStore(tempFile());
    const item = store.create({ kind: 'question', from: 'A', to: 'B', body: 'q' });
    store.observe(item.id, { type: 'context_supplied', by: 'B', sessionId: 'old-session' });

    expect(store.list({ to: 'B', notSuppliedTo: 'old-session' })).toEqual([]);
    expect(store.list({ to: 'B', notSuppliedTo: 'new-session' }).map((i) => i.id)).toEqual([item.id]);
  });

  it('observing an unknown item changes nothing', () => {
    const store = new ItemStore(tempFile());
    expect(store.observe('missing', { type: 'acked', by: 'B' })).toBeUndefined();
  });
});

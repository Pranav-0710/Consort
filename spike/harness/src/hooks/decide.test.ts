import { describe, expect, it } from 'vitest';

import type { HookEvent } from '../config.js';
import type { Item, ListFilter, Observation } from '../relay/store.js';
import { planDelivery, stopDeliveriesMade, withDeadline, type RelayReader } from './decide.js';

const item = (id: string, observations: Observation[] = []): Item => ({
  id,
  version: 1,
  kind: 'question',
  from: 'A',
  to: 'B',
  body: 'Are retries safe?',
  createdAt: '2026-11-24T00:00:00.000Z',
  observations,
});

const stopSupplied = (detail: string, at: string, sessionId = 's1'): Observation => ({
  type: 'context_supplied',
  at,
  by: 'B',
  sessionId,
  hookEvent: 'Stop',
  detail,
});

function fakeRelay(items: Item[]): RelayReader & { calls: ListFilter[] } {
  const calls: ListFilter[] = [];
  return {
    calls,
    list(filter) {
      calls.push(filter);
      return Promise.resolve(items);
    },
  };
}

function cfg(over: { deliverOn?: Set<HookEvent>; stopDelivery?: boolean; stopMaxPerSession?: number } = {}) {
  return {
    participant: 'B',
    deliverOn: over.deliverOn ?? new Set<HookEvent>(),
    stopDelivery: over.stopDelivery ?? false,
    stopMaxPerSession: over.stopMaxPerSession ?? 1,
  };
}

describe('planDelivery', () => {
  it('delivers nothing when the event is not configured', async () => {
    const relay = fakeRelay([item('q1')]);
    expect(await planDelivery(cfg(), 'PostToolUse', { session_id: 's1' }, relay)).toBeUndefined();
    expect(relay.calls).toEqual([]);
  });

  it('option (a) returns additionalContext for a configured event', async () => {
    const relay = fakeRelay([item('q1')]);
    const on = cfg({ deliverOn: new Set<HookEvent>(['PostToolUse']) });
    const d = await planDelivery(on, 'PostToolUse', { session_id: 's1' }, relay);
    expect(d?.output).toMatchObject({ hookSpecificOutput: { hookEventName: 'PostToolUse' } });
    expect(JSON.stringify(d?.output)).toContain('q1');
    expect(relay.calls).toEqual([{ to: 'B', pending: true, notSuppliedTo: 's1' }]);
  });

  it('option (b) never blocks while stop_hook_active is true', async () => {
    const relay = fakeRelay([item('q1')]);
    const payload = { session_id: 's1', stop_hook_active: true };
    expect(await planDelivery(cfg({ stopDelivery: true }), 'Stop', payload, relay)).toBeUndefined();
  });

  it('option (b) stops once the per-session cap is reached', async () => {
    const relay = fakeRelay([item('q1', [stopSupplied('d1', 't1')])]);
    const capped = cfg({ stopDelivery: true, stopMaxPerSession: 1 });
    expect(await planDelivery(capped, 'Stop', { session_id: 's1' }, relay)).toBeUndefined();
  });

  it('option (b) blocks with the pending items below the cap', async () => {
    const relay = fakeRelay([item('q1')]);
    const d = await planDelivery(cfg({ stopDelivery: true }), 'Stop', { session_id: 's1' }, relay);
    expect(d?.output).toMatchObject({ decision: 'block' });
  });
});

describe('stopDeliveriesMade', () => {
  it('counts one delivery of several items once', () => {
    const items = [
      item('q1', [stopSupplied('d1', 't1')]),
      item('q2', [stopSupplied('d1', 't2')]),
      item('q3', [stopSupplied('d2', 't3')]),
    ];
    expect(stopDeliveriesMade(items, 's1')).toBe(2);
    expect(stopDeliveriesMade(items, 'other')).toBe(0);
  });
});

describe('withDeadline', () => {
  it('fails open with "deadline" when the work is too slow', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 500));
    expect(await withDeadline(slow, 20)).toBe('deadline');
  });

  it('returns the result when the work finishes in time', async () => {
    expect(await withDeadline(Promise.resolve('ok'), 500)).toBe('ok');
  });
});

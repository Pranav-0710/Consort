// Delivery decision for the hook script, kept free of process I/O so it can be tested.
// It never records an observation: the caller records "context supplied" only after the
// hook output has actually been written, so the relay never claims a delivery that did not happen.
import { randomBytes } from 'node:crypto';

import type { HarnessConfig, HookEvent } from '../config.js';
import { formatPendingItems } from '../format.js';
import type { Item, ListFilter } from '../relay/store.js';

export interface RelayReader {
  list(filter: ListFilter): Promise<Item[]>;
}

export interface Delivery {
  output: object;
  items: Item[];
  /** Shared by every observation of this one delivery, so a delivery of N items counts once. */
  deliveryId: string;
}

type DeliveryConfig = Pick<HarnessConfig, 'participant' | 'deliverOn' | 'stopDelivery' | 'stopMaxPerSession'>;

/** Number of distinct Stop-hook deliveries already made to this session. */
export function stopDeliveriesMade(items: readonly Item[], sessionId: string): number {
  const ids = new Set<string>();
  for (const item of items)
    for (const o of item.observations)
      if (o.type === 'context_supplied' && o.hookEvent === 'Stop' && o.sessionId === sessionId)
        ids.add(o.detail ?? o.at);
  return ids.size;
}

export async function planDelivery(
  cfg: DeliveryConfig,
  event: HookEvent,
  payload: Record<string, unknown>,
  relay: RelayReader,
): Promise<Delivery | undefined> {
  const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : 'unknown';
  const isStop = event === 'Stop';
  if (isStop ? !cfg.stopDelivery : !cfg.deliverOn.has(event)) return undefined;
  if (isStop && payload['stop_hook_active'] === true) return undefined;

  if (isStop) {
    const all = await relay.list({ to: cfg.participant });
    if (stopDeliveriesMade(all, sessionId) >= cfg.stopMaxPerSession) return undefined;
  }

  const items = await relay.list({ to: cfg.participant, pending: true, notSuppliedTo: sessionId });
  if (items.length === 0) return undefined;

  const text = formatPendingItems(cfg.participant, items);
  const output = isStop
    ? { decision: 'block', reason: text }
    : { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
  return {
    output,
    items,
    deliveryId: `delivery-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
  };
}

/** Resolves to 'deadline' if the promise has not settled within ms. */
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | 'deadline'> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

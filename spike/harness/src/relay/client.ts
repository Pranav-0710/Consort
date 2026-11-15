// Minimal relay client shared by the hooks and the MCP server.
import type { HarnessConfig } from '../config.js';
import type { Item, ItemKind, ListFilter, ObservationType } from './store.js';

export class RelayClient {
  constructor(
    private readonly cfg: HarnessConfig,
    private readonly timeoutMs: number,
  ) {}

  private async request<T>(method: 'GET' | 'POST', pathAndQuery: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'x-spike-participant': this.cfg.participant };
    if (this.cfg.token) headers['authorization'] = `Bearer ${this.cfg.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(new URL(pathAndQuery, this.cfg.relayUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload: unknown = await res.json();
    if (!res.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'error' in payload
          ? String(payload.error)
          : res.statusText;
      throw new Error(`relay ${method} ${pathAndQuery}: ${res.status} ${message}`);
    }
    return payload as T;
  }

  list(filter: ListFilter): Promise<Item[]> {
    const q = new URLSearchParams();
    if (filter.to !== undefined) q.set('to', filter.to);
    if (filter.pending) q.set('pending', '1');
    if (filter.notSuppliedTo !== undefined) q.set('notSuppliedTo', filter.notSuppliedTo);
    return this.request<Item[]>('GET', `/items?${q.toString()}`);
  }

  get(id: string): Promise<Item> {
    return this.request<Item>('GET', `/items/${encodeURIComponent(id)}`);
  }

  create(input: {
    kind: ItemKind;
    to: string;
    body: string;
    replyTo?: string;
    version?: number;
  }): Promise<Item> {
    return this.request<Item>('POST', '/items', input);
  }

  observe(
    id: string,
    observation: { type: ObservationType; sessionId?: string; hookEvent?: string; detail?: string },
  ): Promise<Item> {
    return this.request<Item>('POST', `/items/${encodeURIComponent(id)}/observations`, observation);
  }
}

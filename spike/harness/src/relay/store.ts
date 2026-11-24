// Durable item store for the spike relay. Every change is appended to a JSONL file and
// fsynced before it is applied, so items and observations survive a relay restart.
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';

export type ItemKind = 'question' | 'answer' | 'update';
export type ObservationType = 'context_supplied' | 'read_via_tool' | 'acked' | 'answered';

export interface Observation {
  type: ObservationType;
  at: string;
  /** Participant that reported it. */
  by: string;
  sessionId?: string;
  hookEvent?: string;
  detail?: string;
}

export interface Item {
  id: string;
  version: number;
  kind: ItemKind;
  from: string;
  to: string;
  body: string;
  replyTo?: string;
  /** Client-chosen idempotency key, unique per sender. */
  clientId?: string;
  createdAt: string;
  observations: Observation[];
}

export interface NewItem {
  kind: ItemKind;
  from: string;
  to: string;
  body: string;
  replyTo?: string;
  clientId?: string;
  version?: number;
}

export interface ListFilter {
  to?: string;
  /** Only items the addressee has neither acknowledged nor answered. */
  pending?: boolean;
  /** Only items not yet supplied as context to this session. */
  notSuppliedTo?: string;
}

type Entry = { op: 'create'; item: Item } | { op: 'observe'; id: string; observation: Observation };

export class ItemStore {
  private readonly items = new Map<string, Item>();

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim());
      lines.forEach((line, index) => {
        try {
          this.apply(JSON.parse(line) as Entry);
        } catch (error) {
          // A crash mid-append leaves a torn last line: that change never completed, so skip it.
          // A bad line anywhere else is real corruption and must stop the relay.
          if (index !== lines.length - 1) throw error;
          this.skippedTornLine = true;
        }
      });
    }
  }

  /** True when the store file ended in an incomplete line that was ignored on load. */
  skippedTornLine = false;

  findByClientId(from: string, clientId: string): Item | undefined {
    for (const item of this.items.values()) if (item.from === from && item.clientId === clientId) return item;
    return undefined;
  }

  create(input: NewItem): Item {
    const item: Item = {
      id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      version: input.version ?? 1,
      kind: input.kind,
      from: input.from,
      to: input.to,
      body: input.body,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      createdAt: new Date().toISOString(),
      observations: [],
    };
    this.persist({ op: 'create', item });
    return item;
  }

  observe(id: string, observation: Omit<Observation, 'at'>): Item | undefined {
    if (!this.items.has(id)) return undefined;
    this.persist({ op: 'observe', id, observation: { ...observation, at: new Date().toISOString() } });
    return this.items.get(id);
  }

  get(id: string): Item | undefined {
    return this.items.get(id);
  }

  list(filter: ListFilter = {}): Item[] {
    return [...this.items.values()].filter((item) => {
      if (filter.to !== undefined && item.to !== filter.to) return false;
      if (filter.pending && item.observations.some((o) => o.type === 'acked' || o.type === 'answered')) {
        return false;
      }
      if (
        filter.notSuppliedTo !== undefined &&
        item.observations.some((o) => o.type === 'context_supplied' && o.sessionId === filter.notSuppliedTo)
      ) {
        return false;
      }
      return true;
    });
  }

  private persist(entry: Entry): void {
    const fd = openSync(this.file, 'a');
    try {
      writeSync(fd, `${JSON.stringify(entry)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.apply(entry);
  }

  private apply(entry: Entry): void {
    if (entry.op === 'create') {
      this.items.set(entry.item.id, { ...entry.item, observations: [...entry.item.observations] });
    } else {
      this.items.get(entry.id)?.observations.push(entry.observation);
    }
  }
}

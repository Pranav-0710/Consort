// Prefixed record IDs. A prefix makes an ID's kind visible in logs and lets validation reject
// an ID of the wrong kind before any lookup. IDs are issued by the coordinator; a client-supplied
// ID only names a record, it never establishes a binding (ROOM_AGENT_CONTRACT §3).
import { z } from 'zod';

export const ID_PREFIXES = {
  user: 'usr',
  project: 'prj',
  feature: 'feat',
  package: 'pkg',
  contract: 'ctr',
  change_request: 'cr',
  question: 'q',
  message: 'msg',
  run: 'run',
  connection: 'conn',
  checkout: 'chk',
  collector: 'col',
  handoff: 'ho',
  evidence: 'ev',
  inbox_item: 'inb',
  request: 'req',
  command_window: 'cw',
  recovery_epoch: 'ep',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** The part after the prefix: 10 to 64 ASCII letters and digits. */
const BODY = '[A-Za-z0-9]{10,64}';

const PATTERNS = Object.fromEntries(
  Object.entries(ID_PREFIXES).map(([kind, prefix]) => [kind, new RegExp(`^${prefix}_${BODY}$`)]),
) as Record<IdKind, RegExp>;

const KIND_BY_PREFIX = new Map<string, IdKind>(
  Object.entries(ID_PREFIXES).map(([kind, prefix]) => [prefix, kind as IdKind]),
);

/** Joins a prefix and a body. Throws when the body is not 10 to 64 letters and digits. */
export function formatId(kind: IdKind, body: string): string {
  const id = `${ID_PREFIXES[kind]}_${body}`;
  if (!PATTERNS[kind].test(id)) throw new TypeError(`invalid ${kind} id body`);
  return id;
}

export function isId(kind: IdKind, value: unknown): value is string {
  return typeof value === 'string' && PATTERNS[kind].test(value);
}

/** The kind of a well-formed ID, or undefined. */
export function idKind(value: string): IdKind | undefined {
  const kind = KIND_BY_PREFIX.get(value.slice(0, value.indexOf('_')));
  return kind !== undefined && PATTERNS[kind].test(value) ? kind : undefined;
}

/** A schema that accepts a well-formed ID of any known kind. */
export const anyIdSchema = z
  .string()
  .max(80)
  .refine((value) => idKind(value) !== undefined, 'expected a prefixed record id');

/** A schema that accepts only IDs of one kind. */
export function idSchema(kind: IdKind) {
  return z.string().regex(PATTERNS[kind], `expected a ${kind} id (${ID_PREFIXES[kind]}_…)`);
}

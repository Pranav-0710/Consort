// WebSocket frames (rules H05, H06, H10, H12).
//
// WebSockets notify and transport; they are not storage. Every event and inbox frame names its
// recovery epoch, the previous sequence on its subscription (see gap.ts) and the cursor the
// client acknowledges once it has durably stored the frame, so the cursor never advances past
// unstored work (stress C05).
//
// Agent connections receive `AgentServerFrameSchema`, which has no event frame: an agent only
// ever sees the closed inbox set with untrusted text marked, never raw events such as
// discussion messages. Web clients receive `ServerFrameSchema`.
import { z } from 'zod';

import { DeclaredCapabilitiesSchema } from './capabilities.js';
import { versionNumber } from './commands/common.js';
import { CursorSchema } from './cursor.js';
import { ProtocolVersionSchema } from './envelope.js';
import { ERROR_MESSAGES, type ErrorCode } from './errors.js';
import { EventRecordSchema } from './events.js';
import { idSchema } from './ids.js';
import { InboxItemSchema } from './inbox.js';

const when = z.iso.datetime({ offset: true });
const errorCode = z.enum(Object.keys(ERROR_MESSAGES) as [ErrorCode, ...ErrorCode[]]);

/** First frame from a client: what it speaks and where it wants to resume. */
export const ClientHelloFrameSchema = z.strictObject({
  kind: z.literal('hello'),
  protocol_version: ProtocolVersionSchema,
  /** Null to start from a snapshot. */
  cursor: CursorSchema.nullable(),
  /** Adapters only: what this connection declares it can do. Never a permission. */
  capabilities: DeclaredCapabilitiesSchema.optional(),
});

/** Client confirms it durably stored everything up to this cursor. */
export const CursorAckFrameSchema = z.strictObject({
  kind: z.literal('cursor_ack'),
  cursor: CursorSchema,
});

export const ClientFrameSchema = z.discriminatedUnion('kind', [ClientHelloFrameSchema, CursorAckFrameSchema]);
export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export const ServerHelloFrameSchema = z.strictObject({
  kind: z.literal('hello'),
  protocol_version: ProtocolVersionSchema,
  recovery_epoch: idSchema('recovery_epoch'),
  /** Adapters only: the new connection generation. Older generations are fenced (H07). */
  connection_generation: versionNumber.optional(),
  server_time: when,
});

export const EventFrameSchema = z.strictObject({
  kind: z.literal('event'),
  /** Sequence of the previous frame on this subscription; 0 for the first. */
  prev_seq: versionNumber,
  event: EventRecordSchema,
  cursor: CursorSchema,
});

/** The item's `source_seq` is the frame's sequence. */
export const InboxFrameSchema = z.strictObject({
  kind: z.literal('inbox'),
  recovery_epoch: idSchema('recovery_epoch'),
  prev_seq: versionNumber,
  item: InboxItemSchema,
  cursor: CursorSchema,
});

export const SnapshotRequiredFrameSchema = z.strictObject({
  kind: z.literal('snapshot_required'),
  reason: z.enum([
    'cursor_invalid',
    'history_compacted',
    'scope_changed',
    'recovery_epoch_changed',
    'gap_unavailable',
  ]),
});

export const ClosingFrameSchema = z.strictObject({
  kind: z.literal('closing'),
  reason: z.enum(['revoked', 'expired', 'fenced', 'protocol_unsupported', 'shutdown']),
  code: errorCode.optional(),
  /** False when reconnecting with the same credential cannot succeed. */
  retry: z.boolean(),
});

export const BackpressureFrameSchema = z.strictObject({
  kind: z.literal('backpressure'),
  /** Delay before the client sends more. Accepted changes are never dropped to relieve load. */
  retry_after_ms: z.int().min(0).max(3_600_000),
});

/** Frames a web client receives. */
export const ServerFrameSchema = z.discriminatedUnion('kind', [
  ServerHelloFrameSchema,
  EventFrameSchema,
  InboxFrameSchema,
  SnapshotRequiredFrameSchema,
  ClosingFrameSchema,
  BackpressureFrameSchema,
]);
export type ServerFrame = z.infer<typeof ServerFrameSchema>;

/** Frames an agent adapter receives: no raw events, only inbox items. */
export const AgentServerFrameSchema = z.discriminatedUnion('kind', [
  ServerHelloFrameSchema,
  InboxFrameSchema,
  SnapshotRequiredFrameSchema,
  ClosingFrameSchema,
  BackpressureFrameSchema,
]);
export type AgentServerFrame = z.infer<typeof AgentServerFrameSchema>;

/** What `checkSequence` needs from an event or inbox frame. */
export function frameSequence(frame: z.infer<typeof EventFrameSchema> | z.infer<typeof InboxFrameSchema>): {
  recovery_epoch: string;
  prev_seq: number;
  seq: number;
} {
  return frame.kind === 'event'
    ? { recovery_epoch: frame.event.recovery_epoch, prev_seq: frame.prev_seq, seq: frame.event.seq }
    : { recovery_epoch: frame.recovery_epoch, prev_seq: frame.prev_seq, seq: frame.item.source_seq };
}

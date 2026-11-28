// WebSocket frames (rules H05, H06, H10).
//
// WebSockets notify and transport; they are not storage. Every event and inbox frame names the
// previous sequence on its subscription (see gap.ts) and the cursor the client acknowledges once
// it has durably stored the frame, so the cursor never advances past unstored work (stress C05).
import { z } from 'zod';

import { ProtocolVersionSchema } from './envelope.js';
import { ERROR_MESSAGES, type ErrorCode } from './errors.js';
import { CursorSchema } from './cursor.js';
import { EventRecordSchema, sequenceNumber } from './events.js';
import { idSchema } from './ids.js';
import { InboxItemSchema } from './inbox.js';
import { CapabilitiesSchema } from './capabilities.js';
import { versionNumber } from './commands/common.js';

const when = z.iso.datetime({ offset: true });
const errorCode = z.enum(Object.keys(ERROR_MESSAGES) as [ErrorCode, ...ErrorCode[]]);

/** First frame from a client: what it speaks and where it wants to resume. */
export const ClientHelloFrameSchema = z.strictObject({
  kind: z.literal('hello'),
  protocol_version: ProtocolVersionSchema,
  /** Null to start from a snapshot. */
  cursor: CursorSchema.nullable(),
  /** Adapters only: what this connection can do. */
  capabilities: CapabilitiesSchema.optional(),
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

export const InboxFrameSchema = z.strictObject({
  kind: z.literal('inbox'),
  prev_seq: versionNumber,
  seq: sequenceNumber,
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

export const ServerFrameSchema = z.discriminatedUnion('kind', [
  ServerHelloFrameSchema,
  EventFrameSchema,
  InboxFrameSchema,
  SnapshotRequiredFrameSchema,
  ClosingFrameSchema,
  BackpressureFrameSchema,
]);
export type ServerFrame = z.infer<typeof ServerFrameSchema>;

/** The `{prev_seq, seq}` pair `checkSequence` needs, for an event or inbox frame. */
export function frameSequence(frame: z.infer<typeof EventFrameSchema> | z.infer<typeof InboxFrameSchema>): {
  prev_seq: number;
  seq: number;
} {
  return { prev_seq: frame.prev_seq, seq: frame.kind === 'event' ? frame.event.seq : frame.seq };
}

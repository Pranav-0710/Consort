// Command windows and receipts: what makes a retry safe (rules H04, H06; invariant 5).
//
// A command window is a short-lived, server-issued permit tied to one principal, its scope and
// the project's current recovery epoch. Every command names one. Within a valid window, the same
// request ID with the same content returns its retained outcome instead of applying twice. A
// client whose request timed out does not know the outcome: it asks for the receipt before
// deciding anything, and treats `unknown` as unknown, never as failure or success.
//
// Rules for clients (#27, #28):
//   - Resend a request only under the window it was first sent with. Under any other window the
//     same request ID is refused with request_id_conflict; read the receipt instead.
//   - Any rejection is final for that request ID. To try again, reconcile current state and
//     prepare a new command with a new request ID.
//   - A receipt is readable only under the scope (and agent run) its window held. After any
//     change of scope, wider or narrower, it reads as `unknown`: reconcile current state.
//   - Reconcile through the receipt, never by spotting a request ID in the event stream: request
//     IDs are visible to every member, so another member's event can carry the same ID. If the
//     event stream must be used, match on the actor as well as `causal_request_id`.
import { z } from 'zod';

import { COMMAND_TYPES } from './commands/index.js';
import { ERROR_MESSAGES, type ErrorCode } from './errors.js';
import { sequenceNumber } from './events.js';
import { idSchema } from './ids.js';

const when = z.iso.datetime({ offset: true });
const errorCode = z.enum(Object.keys(ERROR_MESSAGES) as [ErrorCode, ...ErrorCode[]]);

/** Returned when a window is issued. */
export const CommandWindowSchema = z.strictObject({
  command_window_id: idSchema('command_window'),
  recovery_epoch: idSchema('recovery_epoch'),
  /** After this, commands naming the window are refused and the client reconciles first. */
  expires_at: when,
});
export type CommandWindow = z.infer<typeof CommandWindowSchema>;

/** Command types a receipt can record: every catalogue command, plus project creation. */
export const RECEIPT_COMMAND_TYPES = [...COMMAND_TYPES, 'project.init'] as const;

const recorded = {
  request_id: idSchema('request'),
  command_type: z.enum(RECEIPT_COMMAND_TYPES as unknown as [string, ...string[]]),
  recorded_at: when,
};

/**
 * The caller's own receipt for a request. `unknown` covers every case where the coordinator
 * holds no outcome for this caller: never received, still in flight, retention ended, or
 * another principal's request. Those are deliberately indistinguishable.
 */
export const ReceiptStatusSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...recorded,
    status: z.literal('committed'),
    /** Sequence numbers of the events the command wrote, in order. */
    events: z.array(sequenceNumber).max(1000),
    result: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    ...recorded,
    status: z.literal('rejected'),
    error: z.strictObject({
      code: errorCode,
      message: z.string().max(500),
      field: z.string().max(200).optional(),
      limit: z.int().min(0).optional(),
    }),
  }),
  z.strictObject({ request_id: idSchema('request'), status: z.literal('unknown') }),
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

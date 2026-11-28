// Events the coordinator records and sends out (rules H01, H05, H06).
//
// Every event names the project incarnation (recovery epoch), its position in the project's
// event order, the record it changed and the request that caused it. Order comes from the
// coordinator's sequence, never from laptop clocks.
import { z } from 'zod';

import { shortText, versionNumber } from './commands/common.js';
import { idSchema } from './ids.js';

/** The kinds of record an event can change. */
export const RECORD_TYPES = [
  'project',
  'member',
  'feature',
  'package',
  'agreement',
  'contract',
  'change_request',
  'reconciliation',
  'question',
  'message',
  'run',
  'plan',
  'acknowledgement',
  'delivery',
  'handoff',
  'evidence',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** Who the coordinator attributes the change to. Set by the server from the credential. */
export const EventActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('human'), user_id: idSchema('user') }),
  z.strictObject({ kind: z.literal('agent_run'), run_id: idSchema('run'), user_id: idSchema('user') }),
  z.strictObject({ kind: z.literal('evidence_collector'), collector_id: idSchema('collector') }),
  z.strictObject({ kind: z.literal('system') }),
]);
export type EventActor = z.infer<typeof EventActorSchema>;

/**
 * Where the information came from. A human decision, an agent's own report, a mechanical
 * adapter observation, a participant-collected check and a coordinator action stay distinct.
 */
export const EVENT_SOURCES = [
  'human_action',
  'agent_report',
  'adapter_observation',
  'participant_collected',
  'coordinator',
] as const;

export const sequenceNumber = z.int().min(1).max(Number.MAX_SAFE_INTEGER);

/** `record.verb`, for example `question.answered`. Issues that emit events add their payloads. */
export const eventType = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/, 'expected an event type such as question.answered');

export const EventRecordSchema = z.strictObject({
  /** Position in the project's event order. Unique and increasing within a recovery epoch. */
  seq: sequenceNumber,
  recovery_epoch: idSchema('recovery_epoch'),
  type: eventType,
  record: z.strictObject({
    type: z.enum(RECORD_TYPES),
    id: shortText,
    version: versionNumber,
  }),
  actor: EventActorSchema,
  source: z.enum(EVENT_SOURCES),
  /** The command that caused this event (invariant 5, rule H01). */
  causal_request_id: idSchema('request'),
  /** Coordinator time at commit. Ordering uses `seq`, not this. */
  server_time: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});
export type EventRecord = z.infer<typeof EventRecordSchema>;

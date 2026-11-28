// Delivery observations and acknowledgements are different facts (invariant 6, AC06).
//
// The coordinator, adapter or hook records that an item was queued, received or supplied as
// context. Only the agent itself reports that it acknowledged or applied something. The two
// schemas share no kind, so neither can stand in for the other, and the coordinator never
// derives an acknowledgement from delivery success.
import { z } from 'zod';

import { boundedList, contractVersions, reasonText, shortText, versionNumber } from './commands/common.js';
import { idSchema } from './ids.js';

/** Facts 1 and 2 (plus `queued`, which precedes them). */
export const DELIVERY_OBSERVATION_KINDS = ['queued', 'adapter_received', 'context_supplied'] as const;
export type DeliveryObservationKind = (typeof DELIVERY_OBSERVATION_KINDS)[number];

/** Facts 3 and 5: what the agent explicitly reports. */
export const ACKNOWLEDGEMENT_KINDS = ['agent_acknowledged', 'application_reported'] as const;
export type AcknowledgementKind = (typeof ACKNOWLEDGEMENT_KINDS)[number];

const when = z.iso.datetime({ offset: true });

export const DeliveryObservationSchema = z.strictObject({
  item_id: idSchema('inbox_item'),
  run_id: idSchema('run'),
  context_generation: versionNumber,
  kind: z.enum(DELIVERY_OBSERVATION_KINDS),
  /** `coordinator` queues; the adapter or a hook observes receipt and context supply. */
  observed_by: z.enum(['coordinator', 'adapter', 'hook']),
  /** The client checkpoint, for example a hook event name, when context was supplied. */
  checkpoint: shortText.optional(),
  observed_at: when,
});
export type DeliveryObservation = z.infer<typeof DeliveryObservationSchema>;

export const AcknowledgementSchema = z.strictObject({
  run_id: idSchema('run'),
  context_generation: versionNumber,
  kind: z.enum(ACKNOWLEDGEMENT_KINDS),
  /** The exact versions acknowledged. An acknowledgement of other versions is a different fact. */
  versions: z.strictObject({
    agreement_version: versionNumber,
    contract_versions: contractVersions,
  }),
  item_id: idSchema('inbox_item').optional(),
  change_request_id: idSchema('change_request').optional(),
  concerns: reasonText.optional(),
  evidence_ids: boundedList(idSchema('evidence')).optional(),
  /** Always the agent: acknowledgements are reports, not proof of comprehension. */
  reported_by: z.literal('agent'),
  reported_at: when,
});
export type Acknowledgement = z.infer<typeof AcknowledgementSchema>;

// Run status as separate dimensions (finding F09, FIRST_RELEASE_SPEC §4).
//
// There is deliberately no combined "status", "synced", "healthy" or "done" field. A connected
// adapter says nothing about acknowledgement, a fresh plan says nothing about evidence, and
// silence is never shown as current. Clients display the relevant combination.
import { z } from 'zod';

import { contractVersions, reasonText, versionNumber } from './commands/common.js';
import { sequenceNumber } from './events.js';
import { idSchema } from './ids.js';

const when = z.iso.datetime({ offset: true });
const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

export const RunStatusSchema = z.strictObject({
  run_id: idSchema('run'),
  /** When the coordinator assembled this view. */
  as_of: when,

  connection: z.strictObject({
    state: z.enum(['not_connected', 'connected', 'disconnected', 'needs_attention']),
    connection_generation: versionNumber.optional(),
    last_observed_at: when.optional(),
    /** Required by clients when `state` is `needs_attention`: the observed problem. */
    reason: reasonText.optional(),
  }),
  transport: z.strictObject({
    state: z.enum(['synchronized', 'catching_up', 'gap', 'snapshot_required', 'unknown']),
    last_seq: versionNumber,
  }),
  context: z.strictObject({
    generation: versionNumber,
    /** Unconfirmed when restoration after resume or compaction could not be observed (H07). */
    continuity: z.enum(['confirmed', 'unconfirmed']),
  }),
  acknowledgement: z.strictObject({
    state: z.enum(['none', 'pending', 'acknowledged', 'outdated']),
    agreement_version: versionNumber.optional(),
    contract_versions: contractVersions.optional(),
  }),
  checkout: z.strictObject({
    checkout_id: idSchema('checkout').optional(),
    freshness: z.enum(['current', 'changed', 'unknown']),
  }),
  delivery: z.strictObject({
    queued: count,
    adapter_received: count,
    context_supplied: count,
  }),
  plan: z.strictObject({
    state: z.enum(['none', 'current', 'outdated']),
    plan_version: versionNumber.optional(),
  }),
  inbox: z.strictObject({
    pending: count,
    oldest_pending_at: when.optional(),
  }),
  reconciliation: z.strictObject({
    open_obligations: count,
  }),
  uncertain_effects: z.strictObject({
    /** Work that may already have happened: inspect before repeating it (H05). */
    count,
    since_seq: sequenceNumber.optional(),
  }),
});
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** The separate dimensions, in display order. */
export const RUN_STATUS_DIMENSIONS = [
  'connection',
  'transport',
  'context',
  'acknowledgement',
  'checkout',
  'delivery',
  'plan',
  'inbox',
  'reconciliation',
  'uncertain_effects',
] as const satisfies ReadonlyArray<keyof RunStatus>;

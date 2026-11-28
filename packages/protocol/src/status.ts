// Run status as separate dimensions (finding F09, FIRST_RELEASE_SPEC §4).
//
// There is deliberately no combined "status", "synced", "healthy" or "done" field. A connected
// adapter says nothing about acknowledgement, a fresh plan says nothing about evidence, and
// silence is never shown as current: every positive state must carry what it was observed
// against (versions, an observation time, a checkout), so a client can show it and check it.
import { z } from 'zod';

import { contractVersions, reasonText, versionNumber } from './commands/common.js';
import { sequenceNumber } from './events.js';
import { idSchema } from './ids.js';

const when = z.iso.datetime({ offset: true });
const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

const connection = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('not_connected') }),
  z.strictObject({
    state: z.literal('connected'),
    connection_generation: versionNumber,
    /** Connected means observed recently, never "no error seen" (invariant 8). */
    last_observed_at: when,
    /** After this the coordinator shows `disconnected` unless a new observation arrives. */
    observation_expires_at: when,
  }),
  z.strictObject({ state: z.literal('disconnected'), last_observed_at: when.optional() }),
  z.strictObject({
    state: z.literal('needs_attention'),
    reason: reasonText,
    last_observed_at: when.optional(),
  }),
]);

/** The exact bundle an acknowledgement refers to (invariant 7). */
const acknowledgedVersions = {
  agreement_version: versionNumber,
  contract_versions: contractVersions,
};

const acknowledgement = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({ state: z.literal('pending') }),
  z.strictObject({ state: z.literal('acknowledged'), ...acknowledgedVersions }),
  /** Acknowledged an older bundle than the current one. */
  z.strictObject({ state: z.literal('outdated'), ...acknowledgedVersions }),
]);

const checkout = z.discriminatedUnion('freshness', [
  z.strictObject({ freshness: z.literal('current'), checkout_id: idSchema('checkout') }),
  z.strictObject({ freshness: z.literal('changed'), checkout_id: idSchema('checkout') }),
  z.strictObject({ freshness: z.literal('unknown'), checkout_id: idSchema('checkout').optional() }),
]);

const plan = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({ state: z.literal('current'), plan_version: versionNumber }),
  z.strictObject({ state: z.literal('outdated'), plan_version: versionNumber }),
]);

export const RunStatusSchema = z.strictObject({
  run_id: idSchema('run'),
  /** When the coordinator assembled this view. */
  as_of: when,

  connection,
  transport: z.strictObject({
    state: z.enum(['synchronized', 'catching_up', 'gap', 'snapshot_required', 'unknown']),
    last_seq: versionNumber,
  }),
  context: z.strictObject({
    generation: versionNumber,
    /** Unconfirmed when restoration after resume or compaction could not be observed (H07). */
    continuity: z.enum(['confirmed', 'unconfirmed']),
  }),
  acknowledgement,
  checkout,
  delivery: z.strictObject({
    queued: count,
    adapter_received: count,
    context_supplied: count,
  }),
  plan,
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

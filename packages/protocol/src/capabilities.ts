// Connection capabilities (AC10, AGENT_CAPABILITY_MATRIX §4).
//
// Each flag says how much is known: documented upstream, detected locally, verified by a
// real-client test, or disabled with a reason. The UI derives controls from these and explains
// unavailable actions instead of silently choosing another mechanism. A client's claim never
// grants server permissions.
import { z } from 'zod';

import { reasonText, shortText } from './commands/common.js';

export const CAPABILITY_FLAGS = [
  'structured_publishing',
  'context_retrieval',
  'checkpoint_delivery',
  'optional_push',
  /** Option (a): context through hook `additionalContext` at checkpoints. */
  'delivery_mode_a',
  /** Option (b): bounded Stop-hook delivery. Gated by a per-human policy (#40). */
  'delivery_mode_b',
  /** Option (c): an opt-in listen tool. Gated by a per-human policy (#40). */
  'delivery_mode_c',
  'session_id_binding',
  // Codex-oriented (managed app-server sessions, #76)
  'managed_turn_start',
  'active_turn_steering',
  'execution_interruption',
  'local_approval_presentation',
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

const when = z.iso.datetime({ offset: true });

export const CapabilitySchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('documented'),
    /** Where upstream documents it. */
    reference: shortText,
  }),
  z.strictObject({
    state: z.literal('detected'),
    client_version: shortText,
    detected_at: when,
  }),
  z.strictObject({
    state: z.literal('verified'),
    client_version: shortText,
    /** The real-client test that established it, for example "T2". */
    test: shortText,
    verified_at: when,
  }),
  z.strictObject({
    state: z.literal('disabled'),
    /** Required: the UI shows it when explaining why an action is unavailable. */
    reason: reasonText,
  }),
]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** Every flag must be declared, so an unknown flag is never mistaken for an available one. */
export const CapabilitiesSchema = z.strictObject(
  Object.fromEntries(CAPABILITY_FLAGS.map((flag) => [flag, CapabilitySchema])) as Record<
    CapabilityFlag,
    typeof CapabilitySchema
  >,
);
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** True only for a capability a real-client test or local detection established. */
export function isUsable(capability: Capability): boolean {
  return capability.state === 'verified' || capability.state === 'detected';
}

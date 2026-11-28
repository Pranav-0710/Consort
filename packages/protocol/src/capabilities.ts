// Connection capabilities (AC10, AGENT_CAPABILITY_MATRIX §4).
//
// Each flag says how much is known: documented upstream, detected locally, verified by a
// recorded real-client test, or disabled with a reason. The UI derives controls from these and
// explains unavailable actions instead of silently choosing another mechanism.
//
// A client's claim never grants server permissions. Clients may only *declare* documented,
// detected or disabled (`DeclaredCapabilitiesSchema`); `verified` is set by the coordinator
// from a recorded test. Dispatch and delivery options (b) and (c) are authorized by the
// per-human policy in #40, never by a capability flag.
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

const documented = z.strictObject({
  state: z.literal('documented'),
  /** Where upstream documents it. */
  reference: shortText,
});
const detected = z.strictObject({
  state: z.literal('detected'),
  client_version: shortText,
  detected_at: when,
});
const verified = z.strictObject({
  state: z.literal('verified'),
  client_version: shortText,
  /** The recorded real-client test that established it, for example "T2". */
  test: shortText,
  verified_at: when,
});
const disabled = z.strictObject({
  state: z.literal('disabled'),
  /** Required: the UI shows it when explaining why an action is unavailable. */
  reason: reasonText,
});

/** A capability as the coordinator records and publishes it. */
export const CapabilitySchema = z.discriminatedUnion('state', [documented, detected, verified, disabled]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** A capability as a client declares it. A client cannot claim `verified`. */
export const DeclaredCapabilitySchema = z.discriminatedUnion('state', [documented, detected, disabled]);
export type DeclaredCapability = z.infer<typeof DeclaredCapabilitySchema>;

function allFlags<T extends z.ZodType>(schema: T) {
  return z.strictObject(
    Object.fromEntries(CAPABILITY_FLAGS.map((flag) => [flag, schema])) as Record<CapabilityFlag, T>,
  );
}

/** Every flag must be declared, so an unknown flag is never mistaken for an available one. */
export const CapabilitiesSchema = allFlags(CapabilitySchema);
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** What a client sends in its hello. */
export const DeclaredCapabilitiesSchema = allFlags(DeclaredCapabilitySchema);
export type DeclaredCapabilities = z.infer<typeof DeclaredCapabilitiesSchema>;

/**
 * Display hint only: whether the UI may offer a control as available. Never use it to
 * authorize, dispatch or choose a delivery mode; those decisions belong to the coordinator's
 * policy and recorded tests.
 */
export function isEstablishedForDisplay(capability: Capability): boolean {
  return capability.state === 'verified' || capability.state === 'detected';
}

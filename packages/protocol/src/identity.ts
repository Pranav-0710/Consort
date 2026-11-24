// Who is acting. The principal comes from the authenticated credential or web session, never
// from the envelope. Agent commands also name the identity chain the coordinator checks:
//   credential -> project and scope -> connection generation -> run -> context generation -> checkout
// The coordinator resolves every link against its registrations (AC01, stress D06). A client
// cannot establish or change a binding by sending a different ID.
import { z } from 'zod';

import { idSchema } from './ids.js';

/** Kinds of credential that can send commands. */
export const PRINCIPAL_KINDS = ['human', 'agent_run', 'evidence_collector'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/** Project roles, lowest first. Ownership of a package or contract is separate from role. */
export const ROLES = ['reader', 'contributor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

const generation = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Required on every command an agent run sends. Every link is mandatory. */
export const AgentIdentitySchema = z.strictObject({
  connection_id: idSchema('connection'),
  connection_generation: generation,
  run_id: idSchema('run'),
  context_generation: generation,
  checkout_id: idSchema('checkout'),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/**
 * Envelope fields the coordinator derives itself. A command that supplies one is rejected with
 * `server_derived_field` rather than ignored, so a client bug cannot look like success.
 */
export const SERVER_DERIVED_FIELDS = [
  'actor',
  'actor_id',
  'principal',
  'user_id',
  'member_id',
  'role',
  'work_package_id',
  'package_id',
  'source_class',
] as const;

// The common command envelope (ROOM_AGENT_CONTRACT §3, rules H01 and H04).
//
// The envelope never names the actor: the principal comes from the credential or web session.
// Agent runs add the identity-chain block. Every mutation names its request ID, the
// server-issued command window and the project's recovery epoch, plus the versions it expects.
import { z } from 'zod';

import { contractVersions, versionNumber } from './commands/common.js';
import { idSchema } from './ids.js';
import { AgentIdentitySchema, type PrincipalKind } from './identity.js';

export const ProtocolVersionSchema = z.strictObject({
  major: versionNumber,
  minor: versionNumber,
});

/**
 * The versions a command expects to find. Which keys a command must supply is listed in the
 * catalogue (`requiredVersions`); the coordinator compares them atomically at commit.
 */
export const ExpectedVersionsSchema = z.strictObject({
  /** The target record: question, change request, handoff, plan's run record and so on. */
  record_version: versionNumber.optional(),
  /** Ownership of the target package or contract (rule H03). */
  owner_version: versionNumber.optional(),
  /** Project membership and role assignments (rule H03). */
  membership_policy_version: versionNumber.optional(),
  /** The task agreement the command is based on. */
  agreement_version: versionNumber.optional(),
  /** The run's current plan; 0 before its first plan. */
  plan_version: versionNumber.optional(),
  /** Shared contracts the command depends on. */
  contract_versions: contractVersions.optional(),
});
export type ExpectedVersions = z.infer<typeof ExpectedVersionsSchema>;
export type ExpectedVersionKey = keyof ExpectedVersions;
export const EXPECTED_VERSION_KEYS = Object.keys(ExpectedVersionsSchema.shape) as ExpectedVersionKey[];

const envelopeFields = {
  protocol_version: ProtocolVersionSchema,
  project_id: idSchema('project'),
  request_id: idSchema('request'),
  command_window_id: idSchema('command_window'),
  recovery_epoch: idSchema('recovery_epoch'),
  type: z.string().min(1).max(64),
  /** Checked against the command's own schema after the envelope parses. */
  payload: z.unknown(),
  expected_versions: ExpectedVersionsSchema,
};

/** Envelope for people (web session) and evidence collectors. No agent block is allowed. */
export const HumanEnvelopeSchema = z.strictObject(envelopeFields);

/** Envelope for agent runs. The identity-chain block is mandatory. */
export const AgentEnvelopeSchema = z.strictObject({
  ...envelopeFields,
  agent: AgentIdentitySchema,
});

export type HumanEnvelope = z.infer<typeof HumanEnvelopeSchema>;
export type AgentEnvelope = z.infer<typeof AgentEnvelopeSchema>;
export type CommandEnvelope = HumanEnvelope | AgentEnvelope;

export function envelopeSchemaFor(principal: PrincipalKind) {
  return principal === 'agent_run' ? AgentEnvelopeSchema : HumanEnvelopeSchema;
}

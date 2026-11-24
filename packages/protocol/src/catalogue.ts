// Who may send each command (rules H03, H12; AC04, AC13; stress A05).
//
// validateCommand enforces `principals` and `requiredVersions`. The coordinator enforces
// `minRole` and `ownership` against current membership inside the mutation transaction, because
// only it knows current roles and owners. No command here approves or merges a pull request or
// changes a client's local tool permissions: those stay with GitHub and the developer's client.
import type { CommandType } from './commands/index.js';
import type { ExpectedVersionKey } from './envelope.js';
import type { PrincipalKind, Role } from './identity.js';

export type OwnershipRule =
  /** Role alone decides. */
  | 'none'
  /** The sending run acts on its own records; its package comes from its registration. */
  | 'own_run'
  /** Current owner of the target package agreement or shared contract. */
  | 'target_owner'
  /** Current owner of the named work package. */
  | 'package_owner'
  /** Whoever proposed the change request. */
  | 'proposer'
  /** The addressed person or run, or a recorded delegate. */
  | 'addressed_recipient'
  /** The question's author or the originating package's owner. */
  | 'requester_or_package_owner'
  /** The responsible producer human or the producing run. */
  | 'producer'
  /** A declared consumer run or person. */
  | 'consumer'
  /** The run itself or the human it belongs to. */
  | 'run_or_its_human';

export interface CatalogueEntry {
  readonly principals: readonly PrincipalKind[];
  readonly minRole: Role;
  readonly ownership: OwnershipRule;
  /** Expected-version keys the envelope must carry. */
  readonly requiredVersions: readonly ExpectedVersionKey[];
  /** The payload schema is a placeholder that a later issue completes. */
  readonly placeholderFor?: string;
}

const HUMAN = ['human'] as const;
const AGENT = ['agent_run'] as const;
const PARTICIPANT = ['human', 'agent_run'] as const;

/** Every decision by an owner checks the target, ownership and membership versions together. */
const AUTHORITY = ['record_version', 'owner_version', 'membership_policy_version'] as const;

export const CATALOGUE: { readonly [T in CommandType]: CatalogueEntry } = {
  // Work, contracts and decisions
  'feature.create': { principals: HUMAN, minRole: 'contributor', ownership: 'none', requiredVersions: [] },
  'package.create': { principals: HUMAN, minRole: 'contributor', ownership: 'none', requiredVersions: [] },
  'contract.create': { principals: HUMAN, minRole: 'contributor', ownership: 'none', requiredVersions: [] },
  'change_request.propose': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'none',
    requiredVersions: ['record_version'],
  },
  'change_request.accept': {
    principals: HUMAN,
    minRole: 'contributor',
    ownership: 'target_owner',
    requiredVersions: AUTHORITY,
  },
  'change_request.reject': {
    principals: HUMAN,
    minRole: 'contributor',
    ownership: 'target_owner',
    requiredVersions: AUTHORITY,
  },
  'change_request.withdraw': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'proposer',
    requiredVersions: ['record_version'],
  },
  'reconciliation.accept': {
    principals: HUMAN,
    minRole: 'contributor',
    ownership: 'package_owner',
    requiredVersions: [...AUTHORITY, 'contract_versions'],
  },
  'reconciliation.record_blocker': {
    principals: HUMAN,
    minRole: 'contributor',
    ownership: 'package_owner',
    requiredVersions: AUTHORITY,
  },
  'ownership.transfer': {
    principals: HUMAN,
    minRole: 'contributor',
    ownership: 'target_owner',
    requiredVersions: ['owner_version', 'membership_policy_version'],
  },
  'ownership.reassign_orphaned': {
    principals: HUMAN,
    minRole: 'admin',
    ownership: 'none',
    requiredVersions: ['owner_version', 'membership_policy_version'],
    placeholderFor: '#45',
  },

  // Questions and discussion
  'question.ask': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'none',
    requiredVersions: [],
    placeholderFor: '#34',
  },
  'question.answer': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'addressed_recipient',
    requiredVersions: ['record_version'],
    placeholderFor: '#34',
  },
  'question.decline': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'addressed_recipient',
    requiredVersions: ['record_version'],
    placeholderFor: '#34',
  },
  'question.cancel': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'requester_or_package_owner',
    requiredVersions: ['record_version'],
    placeholderFor: '#34',
  },
  'question.supersede': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'requester_or_package_owner',
    requiredVersions: ['record_version'],
    placeholderFor: '#34',
  },
  'discussion.post': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'none',
    requiredVersions: [],
    placeholderFor: '#41',
  },

  // A run's own reports
  'plan.publish': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'own_run',
    requiredVersions: ['plan_version'],
  },
  'acknowledgement.record': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'own_run',
    requiredVersions: [],
  },
  'delivery.observe': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'own_run',
    requiredVersions: [],
    placeholderFor: '#9',
  },
  'run.update_checkout': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'own_run',
    requiredVersions: [],
    placeholderFor: '#24',
  },
  'run.detach': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'run_or_its_human',
    requiredVersions: ['record_version'],
    placeholderFor: '#67',
  },
  'report.ingest_historical': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'run_or_its_human',
    requiredVersions: [],
    placeholderFor: '#59',
  },

  // Handoffs
  'handoff.publish': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'own_run',
    requiredVersions: [],
    placeholderFor: '#49',
  },
  'handoff.replace': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'producer',
    requiredVersions: ['record_version'],
    placeholderFor: '#49',
  },
  'handoff.withdraw': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'producer',
    requiredVersions: ['record_version'],
    placeholderFor: '#49',
  },
  'handoff.record_retrieval': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'consumer',
    requiredVersions: [],
    placeholderFor: '#50',
  },
  'handoff.adopt': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'consumer',
    requiredVersions: ['plan_version'],
    placeholderFor: '#50',
  },
  'handoff.report_incompatibility': {
    principals: PARTICIPANT,
    minRole: 'contributor',
    ownership: 'consumer',
    requiredVersions: [],
    placeholderFor: '#50',
  },

  // Evidence
  'evidence.attach': {
    principals: AGENT,
    minRole: 'contributor',
    ownership: 'own_run',
    requiredVersions: [],
    placeholderFor: '#55',
  },
  'evidence.submit_collected': {
    principals: ['human', 'evidence_collector'],
    minRole: 'contributor',
    ownership: 'none',
    requiredVersions: [],
    placeholderFor: '#56',
  },
  'evidence.accept': {
    principals: HUMAN,
    minRole: 'contributor',
    ownership: 'package_owner',
    requiredVersions: AUTHORITY,
    placeholderFor: '#54',
  },

  // Membership
  'member.invite': {
    principals: HUMAN,
    minRole: 'admin',
    ownership: 'none',
    requiredVersions: ['membership_policy_version'],
    placeholderFor: '#20',
  },
  'member.set_role': {
    principals: HUMAN,
    minRole: 'admin',
    ownership: 'none',
    requiredVersions: ['membership_policy_version'],
    placeholderFor: '#20',
  },
  'member.remove': {
    principals: HUMAN,
    minRole: 'admin',
    ownership: 'none',
    requiredVersions: ['membership_policy_version'],
    placeholderFor: '#20',
  },
};

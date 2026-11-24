// Synthetic, valid examples of every command. IDs and SHAs are made up.
import {
  CATALOGUE,
  formatId,
  PROTOCOL_VERSION,
  type CommandType,
  type ExpectedVersions,
  type IdKind,
  type PrincipalKind,
} from '../src/index.js';

export const id = (kind: IdKind, n = 1): string => formatId(kind, `test${String(n).padStart(8, '0')}`);

const SHA = 'a'.repeat(40);
const artifact = { repository: 'example/shop', commit: SHA };
const observation = {
  criterion_id: 'AC1',
  agreement_version: 3,
  artifact: { ...artifact, dirty: false },
  check: { description: 'checkout retries are idempotent', method: 'npm test -- retry' },
  result: 'passed',
};

export const EXAMPLE_PAYLOADS: { readonly [T in CommandType]: Record<string, unknown> } = {
  'feature.create': { title: 'Checkout retries', goal: 'Retries never double-charge.' },
  'package.create': {
    feature_id: id('feature'),
    title: 'Backend',
    owner_id: id('user'),
    agreement: {
      goal: 'Idempotent charge endpoint',
      requirements: [{ id: 'R1', text: 'Retries carry a request ID.' }],
      acceptance_criteria: [{ id: 'AC1', text: 'A retried charge returns the first result.' }],
    },
  },
  'contract.create': { title: 'Money units', body: 'Amounts are integer cents.', owner_id: id('user') },
  'change_request.propose': {
    target: { kind: 'contract', contract_id: id('contract') },
    proposed_change: 'Add a currency field.',
    reason: 'Frontend needs it.',
  },
  'change_request.accept': { change_request_id: id('change_request') },
  'change_request.reject': { change_request_id: id('change_request'), reason: 'Out of scope.' },
  'change_request.withdraw': { change_request_id: id('change_request') },
  'reconciliation.accept': { package_id: id('package'), contract_id: id('contract') },
  'reconciliation.record_blocker': {
    package_id: id('package'),
    contract_id: id('contract'),
    reason: 'Needs a migration first.',
  },
  'ownership.transfer': {
    target: { kind: 'agreement', package_id: id('package') },
    new_owner_id: id('user', 2),
    reason: 'Handing over before leave.',
  },
  'ownership.reassign_orphaned': {
    target: { kind: 'agreement', package_id: id('package') },
    new_owner_id: id('user', 2),
    reason: 'Owner left the project.',
  },
  'question.ask': { to: { kind: 'package', package_id: id('package') }, text: 'Are retries safe?' },
  'question.answer': { question_id: id('question'), text: 'Yes, with a request ID.' },
  'question.decline': { question_id: id('question'), reason: 'Not my area.' },
  'question.cancel': { question_id: id('question'), reason: 'Answered elsewhere.' },
  'question.supersede': {
    question_id: id('question'),
    replacement: { to: { kind: 'member', user_id: id('user', 2) }, text: 'Are retries safe now?' },
    reason: 'Owner changed.',
  },
  'discussion.post': { feature_id: id('feature'), text: 'Looks good to me.' },
  'plan.publish': {
    based_on: { agreement_version: 3, contract_versions: { [id('contract')]: 2 } },
    steps: [
      { id: 's1', text: 'Add request ID column', status: 'done' },
      { id: 's2', text: 'Return stored result on retry', status: 'in_progress', depends_on: ['s1'] },
    ],
  },
  'acknowledgement.record': {
    kind: 'agent_acknowledged',
    versions: { agreement_version: 3, contract_versions: {} },
  },
  'delivery.observe': {
    item_id: id('inbox_item'),
    observation: 'context_supplied',
    checkpoint: 'UserPromptSubmit',
  },
  'run.update_checkout': {
    repository: 'example/shop',
    worktree: 'shop-backend',
    branch: 'feat/retries',
    commit: SHA,
    dirty: true,
  },
  'run.detach': { run_id: id('run'), reason: 'Session closed.' },
  'report.ingest_historical': {
    original_run_id: id('run', 2),
    original_context_generation: 1,
    kind: 'plan',
    body: 'Earlier plan while offline.',
    observed_at: '2026-11-20T10:00:00Z',
  },
  'handoff.publish': { title: 'Charge API v1', artifact },
  'handoff.replace': { handoff_id: id('handoff'), artifact, reason: 'Fixed rounding.' },
  'handoff.withdraw': { handoff_id: id('handoff'), reason: 'Known defect.' },
  'handoff.record_retrieval': { handoff_id: id('handoff'), result: 'matched', observed_commit: SHA },
  'handoff.adopt': { handoff_id: id('handoff'), agreement_version: 3 },
  'handoff.report_incompatibility': { handoff_id: id('handoff'), reason: 'Field renamed.' },
  'evidence.attach': observation,
  'evidence.submit_collected': { package_id: id('package'), ...observation },
  'evidence.accept': { evidence_id: id('evidence'), criterion_id: 'AC1' },
  'member.invite': { role: 'contributor' },
  'member.set_role': { user_id: id('user', 2), role: 'reader' },
  'member.remove': { user_id: id('user', 2), reason: 'Left the team.' },
};

/** The versions a command's catalogue entry requires, all set to plausible values. */
export function versionsFor(type: CommandType): ExpectedVersions {
  const versions: Record<string, unknown> = {};
  for (const key of CATALOGUE[type].requiredVersions) {
    versions[key] = key === 'contract_versions' ? { [id('contract')]: 2 } : 1;
  }
  return versions as ExpectedVersions;
}

export const AGENT_BLOCK = {
  connection_id: id('connection'),
  connection_generation: 2,
  run_id: id('run'),
  context_generation: 1,
  checkout_id: id('checkout'),
};

/** A valid envelope for `type` as sent by `principal` (defaults to its first allowed principal). */
export function envelope(
  type: CommandType,
  options: { principal?: PrincipalKind; payload?: unknown; versions?: ExpectedVersions } = {},
): Record<string, unknown> {
  const principal = options.principal ?? CATALOGUE[type].principals[0];
  return {
    protocol_version: { ...PROTOCOL_VERSION },
    project_id: id('project'),
    request_id: id('request'),
    command_window_id: id('command_window'),
    recovery_epoch: id('recovery_epoch'),
    type,
    payload: options.payload ?? structuredCloneJson(EXAMPLE_PAYLOADS[type]),
    expected_versions: options.versions ?? versionsFor(type),
    ...(principal === 'agent_run' ? { agent: { ...AGENT_BLOCK } } : {}),
  };
}

export function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

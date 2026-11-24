// Commands an agent run sends about itself. The work package and human come from the run's
// registration, never from the payload, so none of these carries a package or user ID.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import { LIMITS } from '../limits.js';
import {
  bodyText,
  boundedList,
  commitSha,
  contractVersions,
  reasonText,
  shortText,
  stableKey,
  versionNumber,
} from './common.js';

const planStep = z.strictObject({
  id: stableKey,
  text: z.string().min(1).max(LIMITS.planStepChars),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked', 'dropped']),
  depends_on: boundedList(stableKey).optional(),
  blocker: reasonText.optional(),
  evidence_ids: boundedList(idSchema('evidence')).optional(),
});

/** The accepted versions a plan or acknowledgement is based on. */
const basedOn = z.strictObject({
  agreement_version: versionNumber,
  contract_versions: contractVersions,
});

export const runPayloads = {
  'plan.publish': z.strictObject({
    based_on: basedOn,
    summary: shortText.optional(),
    steps: boundedList(planStep, LIMITS.planSteps),
  }),

  /** Facts 3 and 5: what the agent itself reports. Delivery facts use `delivery.observe`. */
  'acknowledgement.record': z.strictObject({
    kind: z.enum(['agent_acknowledged', 'application_reported']),
    versions: basedOn,
    change_request_id: idSchema('change_request').optional(),
    concerns: reasonText.optional(),
    evidence_ids: boundedList(idSchema('evidence')).optional(),
  }),

  /** Placeholder for #9 and #35: facts 1 and 2, reported by the adapter, not the model. */
  'delivery.observe': z.strictObject({
    item_id: idSchema('inbox_item'),
    observation: z.enum(['adapter_received', 'context_supplied']),
    checkpoint: shortText.optional(),
  }),

  /** Placeholder for #24: a branch, worktree or repository change needs a new checkout record. */
  'run.update_checkout': z.strictObject({
    repository: shortText,
    worktree: shortText,
    branch: shortText,
    commit: commitSha,
    dirty: z.boolean(),
  }),

  'run.detach': z.strictObject({
    run_id: idSchema('run'),
    reason: reasonText,
  }),

  /** Placeholder for #59: an attributed report about an earlier run, appended as history only. */
  'report.ingest_historical': z.strictObject({
    original_run_id: idSchema('run'),
    original_context_generation: versionNumber,
    kind: z.enum(['plan', 'acknowledgement', 'question', 'evidence']),
    body: bodyText,
    observed_at: z.iso.datetime({ offset: true }),
  }),
} as const;

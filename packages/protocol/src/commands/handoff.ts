// Handoffs: publication, retrieval and adoption are separate facts. Placeholders for #49 and #50,
// which fill in replacement links, consumer declarations and race rules.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import { boundedList, commitSha, gitArtifact, reasonText, shortText, versionNumber } from './common.js';

export const handoffPayloads = {
  'handoff.publish': z.strictObject({
    title: shortText,
    artifact: gitArtifact,
    assumptions: boundedList(reasonText).optional(),
    limitations: boundedList(reasonText).optional(),
    evidence_ids: boundedList(idSchema('evidence')).optional(),
  }),

  'handoff.replace': z.strictObject({
    handoff_id: idSchema('handoff'),
    artifact: gitArtifact,
    reason: reasonText,
  }),

  'handoff.withdraw': z.strictObject({
    handoff_id: idSchema('handoff'),
    reason: reasonText,
  }),

  'handoff.record_retrieval': z.strictObject({
    handoff_id: idSchema('handoff'),
    result: z.enum(['matched', 'mismatch', 'failed']),
    observed_commit: commitSha.optional(),
    reason: reasonText.optional(),
  }),

  'handoff.adopt': z.strictObject({
    handoff_id: idSchema('handoff'),
    agreement_version: versionNumber,
  }),

  'handoff.report_incompatibility': z.strictObject({
    handoff_id: idSchema('handoff'),
    reason: reasonText,
  }),
} as const;

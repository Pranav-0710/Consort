// Evidence. The source class (agent-reported, participant-collected, human review) is set by the
// coordinator from the credential, never by the payload (rule H08). Placeholders for #54 to #56.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import {
  checkDescription,
  checkResult,
  checkedArtifact,
  reasonText,
  shortText,
  stableKey,
  versionNumber,
} from './common.js';

const observation = {
  criterion_id: stableKey,
  agreement_version: versionNumber,
  artifact: checkedArtifact,
  check: checkDescription,
  result: checkResult,
  output_ref: shortText.optional(),
};

export const evidencePayloads = {
  /** From an agent run: the package comes from the run. */
  'evidence.attach': z.strictObject(observation),

  /** From a person or a paired local collector, which must name the package. */
  'evidence.submit_collected': z.strictObject({
    package_id: idSchema('package'),
    ...observation,
  }),

  /** The criterion's owner accepts a piece of evidence as establishing it. */
  'evidence.accept': z.strictObject({
    evidence_id: idSchema('evidence'),
    criterion_id: stableKey,
    reason: reasonText.optional(),
  }),
} as const;

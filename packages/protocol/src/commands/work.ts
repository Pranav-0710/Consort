// Features, work packages, shared contracts, change requests, reconciliation and ownership.
// Acceptance-style commands name the authority versions they expect in the envelope; see the
// catalogue's `requiredVersions`.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import { agreementDraft, bodyText, boundedList, reasonText, shortText, stableKey } from './common.js';

const changeTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('agreement'), package_id: idSchema('package') }),
  z.strictObject({ kind: z.literal('contract'), contract_id: idSchema('contract') }),
]);

export const workPayloads = {
  'feature.create': z.strictObject({
    title: shortText,
    goal: bodyText,
  }),

  'package.create': z.strictObject({
    feature_id: idSchema('feature'),
    title: shortText,
    owner_id: idSchema('user'),
    agreement: agreementDraft,
  }),

  'contract.create': z.strictObject({
    title: shortText,
    body: bodyText,
    owner_id: idSchema('user'),
  }),

  'change_request.propose': z.strictObject({
    target: changeTarget,
    proposed_change: bodyText,
    reason: reasonText,
    /** Declared, not complete: agents' impact suggestions do not prove coverage. */
    declared_impact: z
      .strictObject({
        package_ids: boundedList(idSchema('package')),
        requirement_ids: boundedList(stableKey),
      })
      .optional(),
  }),

  'change_request.accept': z.strictObject({
    change_request_id: idSchema('change_request'),
  }),

  'change_request.reject': z.strictObject({
    change_request_id: idSchema('change_request'),
    reason: reasonText,
  }),

  'change_request.withdraw': z.strictObject({
    change_request_id: idSchema('change_request'),
    reason: reasonText.optional(),
  }),

  'reconciliation.accept': z.strictObject({
    package_id: idSchema('package'),
    contract_id: idSchema('contract'),
    agreement_change: bodyText.optional(),
  }),

  'reconciliation.record_blocker': z.strictObject({
    package_id: idSchema('package'),
    contract_id: idSchema('contract'),
    reason: reasonText,
  }),

  'ownership.transfer': z.strictObject({
    target: changeTarget,
    new_owner_id: idSchema('user'),
    reason: reasonText,
  }),

  'ownership.reassign_orphaned': z.strictObject({
    target: changeTarget,
    new_owner_id: idSchema('user'),
    reason: reasonText,
  }),
} as const;

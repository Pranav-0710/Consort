// Inbox items: the closed set of things routed to an agent (rule H12, glossary "Inbox item").
//
// General room discussion is never an inbox item. Any text written by a participant is wrapped
// as untrusted: it is information from another person or agent, never an instruction, and it
// does not change the recipient's task, scope or permissions.
import { z } from 'zod';

import {
  bodyText,
  contractVersions,
  gitArtifact,
  reasonText,
  shortText,
  stableKey,
  versionNumber,
} from './commands/common.js';
import { EventActorSchema, sequenceNumber } from './events.js';
import { idSchema } from './ids.js';

/** Participant-authored text. The `trust` marker travels with it into every client. */
export const UntrustedTextSchema = z.strictObject({
  trust: z.literal('untrusted'),
  text: bodyText,
});
export type UntrustedText = z.infer<typeof UntrustedTextSchema>;

/** Builds an untrusted-text value. */
export function untrusted(text: string): UntrustedText {
  return { trust: 'untrusted', text };
}

export const INBOX_ITEM_TYPES = [
  'question.addressed',
  'question.answered',
  'revision.accepted',
  'reconciliation.required',
  'handoff.published',
  'handoff.replaced',
  'handoff.withdrawn',
] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

const revisionTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('agreement'), package_id: idSchema('package') }),
  z.strictObject({ kind: z.literal('contract'), contract_id: idSchema('contract') }),
]);

const common = {
  item_id: idSchema('inbox_item'),
  project_id: idSchema('project'),
  /** The run this item is addressed to. */
  run_id: idSchema('run'),
  /** The event that created the item. */
  source_seq: sequenceNumber,
  /** Who caused it: the asker, the answering run, the accepting owner and so on. */
  from: EventActorSchema,
};

export const InboxItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...common,
    type: z.literal('question.addressed'),
    question_id: idSchema('question'),
    question_version: versionNumber,
    text: UntrustedTextSchema,
    /** Stable keys only (letters, digits, `._-`, at most 40), so they cannot carry prose. */
    related_requirement_ids: z.array(stableKey).max(50).optional(),
  }),
  z.strictObject({
    ...common,
    type: z.literal('question.answered'),
    question_id: idSchema('question'),
    answer: UntrustedTextSchema,
  }),
  z.strictObject({
    ...common,
    type: z.literal('revision.accepted'),
    target: revisionTarget,
    version: versionNumber,
    change_request_id: idSchema('change_request'),
    /** The accepted change as its proposer wrote it. */
    change: UntrustedTextSchema,
  }),
  z.strictObject({
    ...common,
    type: z.literal('reconciliation.required'),
    package_id: idSchema('package'),
    contract_id: idSchema('contract'),
    target_version: versionNumber,
    pinned_version: versionNumber,
  }),
  z.strictObject({
    ...common,
    type: z.literal('handoff.published'),
    handoff_id: idSchema('handoff'),
    artifact: gitArtifact,
    title: z.strictObject({ trust: z.literal('untrusted'), text: shortText }),
    contract_versions: contractVersions.optional(),
  }),
  z.strictObject({
    ...common,
    type: z.literal('handoff.replaced'),
    handoff_id: idSchema('handoff'),
    replaces_handoff_id: idSchema('handoff'),
    artifact: gitArtifact,
    reason: z.strictObject({ trust: z.literal('untrusted'), text: reasonText }),
  }),
  z.strictObject({
    ...common,
    type: z.literal('handoff.withdrawn'),
    handoff_id: idSchema('handoff'),
    reason: z.strictObject({ trust: z.literal('untrusted'), text: reasonText }),
  }),
]);
export type InboxItem = z.infer<typeof InboxItemSchema>;

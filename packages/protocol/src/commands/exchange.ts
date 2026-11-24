// Questions and room discussion. Only explicitly addressed questions reach an agent's inbox;
// discussion is never forwarded (rule H12). #34 and #41 fill in the state machine and routing.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import { bodyText, boundedList, reasonText, stableKey } from './common.js';

const recipient = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('member'), user_id: idSchema('user') }),
  z.strictObject({ kind: z.literal('run'), run_id: idSchema('run') }),
  z.strictObject({ kind: z.literal('package'), package_id: idSchema('package') }),
]);

const related = z.strictObject({
  requirement_ids: boundedList(stableKey).optional(),
  step_ids: boundedList(stableKey).optional(),
  contract_ids: boundedList(idSchema('contract')).optional(),
});

export const exchangePayloads = {
  'question.ask': z.strictObject({
    to: recipient,
    text: bodyText,
    related: related.optional(),
    urgency: z.enum(['low', 'normal', 'high']).optional(),
  }),

  'question.answer': z.strictObject({
    question_id: idSchema('question'),
    text: bodyText,
  }),

  'question.decline': z.strictObject({
    question_id: idSchema('question'),
    reason: reasonText,
  }),

  'question.cancel': z.strictObject({
    question_id: idSchema('question'),
    reason: reasonText,
  }),

  'question.supersede': z.strictObject({
    question_id: idSchema('question'),
    replacement: z.strictObject({ to: recipient, text: bodyText }),
    reason: reasonText,
  }),

  'discussion.post': z.strictObject({
    feature_id: idSchema('feature'),
    text: bodyText,
    reply_to: idSchema('message').optional(),
  }),
} as const;

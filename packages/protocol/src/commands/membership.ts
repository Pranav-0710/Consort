// Project membership. Placeholders for #20, which adds invitations and last-admin protection.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import { reasonText, role, shortText } from './common.js';

export const membershipPayloads = {
  'member.invite': z.strictObject({
    role,
    note: shortText.optional(),
  }),

  'member.set_role': z.strictObject({
    user_id: idSchema('user'),
    role,
  }),

  'member.remove': z.strictObject({
    user_id: idSchema('user'),
    reason: reasonText,
  }),
} as const;

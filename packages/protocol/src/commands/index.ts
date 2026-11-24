// Every command type and its payload schema. The catalogue (catalogue.ts) must have an entry for
// each key here; the type system and a test both check that.
import type { z } from 'zod';

import { evidencePayloads } from './evidence.js';
import { exchangePayloads } from './exchange.js';
import { handoffPayloads } from './handoff.js';
import { membershipPayloads } from './membership.js';
import { runPayloads } from './run.js';
import { workPayloads } from './work.js';

export const COMMAND_PAYLOADS = {
  ...workPayloads,
  ...exchangePayloads,
  ...runPayloads,
  ...handoffPayloads,
  ...evidencePayloads,
  ...membershipPayloads,
} as const;

export type CommandType = keyof typeof COMMAND_PAYLOADS;

export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

export const COMMAND_TYPES = Object.keys(COMMAND_PAYLOADS) as CommandType[];

export function isCommandType(value: string): value is CommandType {
  return Object.prototype.hasOwnProperty.call(COMMAND_PAYLOADS, value);
}

export * from './common.js';

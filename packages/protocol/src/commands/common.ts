// Building blocks shared by every command payload. Each text and list field carries its bound
// from limits.ts, so an oversized field fails with payload_too_large naming the field and limit.
import { z } from 'zod';

import { idSchema } from '../ids.js';
import { ROLES } from '../identity.js';
import { LIMITS } from '../limits.js';

export const versionNumber = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Shared-contract ID -> version. Bounded, because a record has no built-in size check. */
export const contractVersions = z.record(idSchema('contract'), versionNumber).superRefine((value, ctx) => {
  if (Object.keys(value).length > LIMITS.contractPins) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'object',
      maximum: LIMITS.contractPins,
      inclusive: true,
      input: value,
      message: `at most ${LIMITS.contractPins} shared contracts`,
    });
  }
});

export const shortText = z.string().min(1).max(LIMITS.shortTextChars);
export const reasonText = z.string().min(1).max(LIMITS.reasonChars);
export const bodyText = z.string().min(1).max(LIMITS.textChars);

/** A stable, human-chosen key such as a requirement `R1`, criterion `AC2` or step `s3`. */
export const stableKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/, 'expected a stable key such as R1 or step-3');

export function boundedList<T extends z.ZodType>(item: T, max: number = LIMITS.listItems) {
  return z.array(item).max(max);
}

/** A full Git object name: SHA-1 (40 hex) or SHA-256 (64 hex). Abbreviations are ambiguous. */
export const commitSha = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'expected a full 40- or 64-character commit SHA');

export const role = z.enum(ROLES);

/** A requirement or acceptance criterion with a stable ID. */
export const keyedText = z.strictObject({ id: stableKey, text: bodyText });

/** The scope of a task agreement as proposed or created. */
export const agreementDraft = z.strictObject({
  goal: bodyText,
  requirements: boundedList(keyedText),
  exclusions: boundedList(reasonText).optional(),
  acceptance_criteria: boundedList(keyedText),
});

/**
 * A repository as `owner/name`, identifier characters only. It is copied into other agents'
 * context, so it must never be able to carry prose (rule H12).
 */
export const repositoryRef = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/, 'expected a repository as owner/name');

/** An immutable artifact. In v1 a handoff is a commit pushed to the shared remote. */
export const gitArtifact = z.strictObject({
  repository: repositoryRef,
  commit: commitSha,
});

/** The artifact a check observed, with dirty state qualified (rule H08). */
export const checkedArtifact = z.strictObject({
  repository: repositoryRef,
  commit: commitSha,
  dirty: z.boolean(),
  /** Identifies the uncommitted content when `dirty` is true. */
  content_digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

/** What was checked and how. */
export const checkDescription = z.strictObject({
  description: shortText,
  method: shortText,
});

export const checkResult = z.enum(['passed', 'failed', 'error', 'assembly_conflict']);

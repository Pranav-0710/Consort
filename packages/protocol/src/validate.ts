// Strict command validation, run before any storage work (rules H10, H12; stress H04).
//
// Order matters: size and nesting are checked on the raw value first, with an iterative walk
// that stops before it queues or serializes anything over the limits, so a hostile payload is
// refused before a schema library recurses into it. Then the envelope, the catalogue (principal
// kind and required versions) and finally the payload schema.
// Passing validation proves shape only. The coordinator still checks membership, roles,
// ownership, the command window and every version inside its transaction (#10, #11).
import type { z } from 'zod';

import { CATALOGUE } from './catalogue.js';
import { COMMAND_PAYLOADS, isCommandType, type CommandPayload, type CommandType } from './commands/index.js';
import {
  envelopeSchemaFor,
  ProtocolVersionSchema,
  type AgentEnvelope,
  type CommandEnvelope,
} from './envelope.js';
import { protocolError, type ErrorCode, type ProtocolError } from './errors.js';
import { canonicalJson, canonicalPayloadHash, utf8Length } from './hash.js';
import { SERVER_DERIVED_FIELDS, type PrincipalKind } from './identity.js';
import { LIMITS } from './limits.js';
import { isSupported, PROTOCOL_VERSION, type ProtocolVersion } from './version.js';

export type ValidatedCommand = {
  [T in CommandType]: {
    readonly type: T;
    /** The envelope with `payload` replaced by the parsed payload. */
    readonly envelope: CommandEnvelope;
    readonly payload: CommandPayload<T>;
    /**
     * Hash of the principal kind, the agent run (if any), the type, the payload and the expected
     * versions. The same request ID with a different hash is a conflict, never a retry
     * (invariant 5). It does not cover the authenticated human or collector, which the envelope
     * never names: the coordinator must key retained outcomes by that principal as well as by
     * project and request ID, so one principal can never receive another's cached outcome (H04).
     */
    readonly contentHash: string;
  };
}[CommandType];

export type ValidationResult =
  | { readonly ok: true; readonly command: ValidatedCommand }
  | { readonly ok: false; readonly error: ProtocolError };

export interface ValidationContext {
  /** From the authenticated credential or session, never from the command. */
  readonly principal: PrincipalKind;
  /** The coordinator's protocol version. Defaults to this package's version. */
  readonly serverVersion?: ProtocolVersion;
}

/** Validates a command received as JSON text, bounding its byte size before parsing it. */
export function validateCommandJson(text: string, context: ValidationContext): ValidationResult {
  if (utf8Length(text) > LIMITS.commandBytes) {
    return fail('payload_too_large', { field: 'command', limit: LIMITS.commandBytes });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('malformed_json');
  }
  return validateCommand(parsed, context);
}

/**
 * Validates an already-parsed command. Never throws, whatever the input: values JSON cannot
 * represent, throwing getters and proxies are rejected as `invalid_envelope`.
 */
export function validateCommand(input: unknown, context: ValidationContext): ValidationResult {
  try {
    return validate(input, context);
  } catch {
    return fail('invalid_envelope', { field: 'command' });
  }
}

function validate(input: unknown, context: ValidationContext): ValidationResult {
  if (!isPlainObject(input)) return fail('invalid_envelope', { field: 'command' });
  const shapeError = checkShape(input);
  if (shapeError) return { ok: false, error: shapeError };

  if (utf8Length(canonicalJson(input)) > LIMITS.commandBytes) {
    return fail('payload_too_large', { field: 'command', limit: LIMITS.commandBytes });
  }

  for (const field of SERVER_DERIVED_FIELDS) {
    if (Object.hasOwn(input, field)) return fail('server_derived_field', { field });
  }

  const version = ProtocolVersionSchema.safeParse(input['protocol_version']);
  if (!version.success) return fail('invalid_envelope', { field: 'protocol_version' });
  if (!isSupported(version.data, context.serverVersion ?? PROTOCOL_VERSION)) {
    return fail('unsupported_protocol_version', { field: 'protocol_version' });
  }

  const parsedEnvelope = envelopeSchemaFor(context.principal).safeParse(input);
  if (!parsedEnvelope.success) {
    return { ok: false, error: fromIssues(parsedEnvelope.error.issues, '', 'invalid_envelope') };
  }
  const envelope: CommandEnvelope = parsedEnvelope.data;

  if (!isCommandType(envelope.type)) return fail('unknown_command', { field: 'type' });
  const type = envelope.type;
  const entry = CATALOGUE[type];
  if (!entry.principals.includes(context.principal)) {
    return fail('principal_not_allowed', { field: 'type' });
  }
  for (const key of entry.requiredVersions) {
    const value = envelope.expected_versions[key];
    // An empty contract map names no dependency, so it does not satisfy a requirement.
    if (value === undefined || (typeof value === 'object' && Object.keys(value).length === 0)) {
      return fail('missing_expected_version', { field: `expected_versions.${key}` });
    }
  }

  if (envelope.payload === undefined) return fail('invalid_envelope', { field: 'payload' });
  if (utf8Length(canonicalJson(envelope.payload)) > LIMITS.payloadBytes) {
    return fail('payload_too_large', { field: 'payload', limit: LIMITS.payloadBytes });
  }
  const payload = COMMAND_PAYLOADS[type].safeParse(envelope.payload);
  if (!payload.success) {
    return { ok: false, error: fromIssues(payload.error.issues, 'payload', 'invalid_payload') };
  }
  const data: Record<string, unknown> = payload.data;

  // A decision about a contract must pin the version of that very contract (H01).
  if (entry.requiredVersions.includes('contract_versions') && typeof data['contract_id'] === 'string') {
    const pins = envelope.expected_versions.contract_versions ?? {};
    if (!Object.hasOwn(pins, data['contract_id'])) {
      return fail('missing_expected_version', { field: 'expected_versions.contract_versions' });
    }
  }

  // An agent run may only name itself; the coordinator still checks the registration.
  const agentRunId = (envelope as Partial<AgentEnvelope>).agent?.run_id;
  if (agentRunId !== undefined && typeof data['run_id'] === 'string' && data['run_id'] !== agentRunId) {
    return fail('identity_mismatch', { field: 'payload.run_id' });
  }

  const contentHash = canonicalPayloadHash({
    principal: context.principal,
    run_id: agentRunId,
    type,
    payload: payload.data,
    expected_versions: envelope.expected_versions,
  });
  return {
    ok: true,
    command: {
      type,
      envelope: { ...envelope, payload: payload.data },
      payload: payload.data,
      contentHash,
    } as ValidatedCommand,
  };
}

function fail(code: ErrorCode, details: { field?: string; limit?: number } = {}): ValidationResult {
  return { ok: false, error: protocolError(code, details) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walks the raw value without recursion. It checks the node budget before queuing children and
 * counts string characters as it goes (a UTF-8 string is at least as many bytes as it has
 * UTF-16 units), so oversized input is refused after at most `maxNodes` steps and before
 * anything is serialized. A `__proto__` key is rejected wherever it appears: no schema
 * defines it, and some parsers drop it silently instead of reporting it.
 */
function checkShape(input: unknown): ProtocolError | undefined {
  const tooManyNodes = () => protocolError('payload_too_large', { field: 'command', limit: LIMITS.maxNodes });
  const tooManyBytes = () =>
    protocolError('payload_too_large', { field: 'command', limit: LIMITS.commandBytes });

  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value: input, depth: 0, path: '' },
  ];
  let nodes = 0;
  let chars = 0;
  while (stack.length > 0) {
    const { value, depth, path } = stack.pop()!;
    nodes += 1;
    if (typeof value === 'string') {
      chars += value.length;
      if (chars > LIMITS.commandBytes) return tooManyBytes();
      continue;
    }
    if (value === null || typeof value !== 'object') continue;

    const childDepth = depth + 1;
    if (childDepth > LIMITS.maxDepth) {
      return protocolError('nesting_too_deep', { field: path || 'command', limit: LIMITS.maxDepth });
    }
    if (Array.isArray(value)) {
      if (nodes + stack.length + value.length > LIMITS.maxNodes) return tooManyNodes();
      for (let index = 0; index < value.length; index++) {
        stack.push({ value: value[index] as unknown, depth: childDepth, path: joinPath(path, index) });
      }
    } else {
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const childPath = joinPath(path, key);
        if (key === '__proto__') return protocolError('unknown_property', { field: childPath });
        if (nodes + stack.length + 1 > LIMITS.maxNodes) return tooManyNodes();
        chars += key.length;
        if (chars > LIMITS.commandBytes) return tooManyBytes();
        stack.push({ value: (value as Record<string, unknown>)[key], depth: childDepth, path: childPath });
      }
    }
  }
  return undefined;
}

function joinPath(prefix: string, key: PropertyKey): string {
  return prefix ? `${prefix}.${String(key)}` : String(key);
}

/** Size issues from text, lists and maps. A number out of range is a bad value, not a size. */
const SIZE_ORIGINS = new Set(['string', 'array', 'set', 'object', 'record']);

/** Maps schema issues to one stable error, preferring the most actionable one. */
function fromIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: string,
  fallback: 'invalid_envelope' | 'invalid_payload',
): ProtocolError {
  const fieldOf = (path: readonly PropertyKey[]): string =>
    path.reduce<string>((acc, key) => joinPath(acc, key), prefix) || 'command';

  for (const issue of issues) {
    if (issue.code === 'too_big' && SIZE_ORIGINS.has(issue.origin)) {
      return protocolError('payload_too_large', { field: fieldOf(issue.path), limit: Number(issue.maximum) });
    }
  }
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      return protocolError('unknown_property', { field: fieldOf([...issue.path, issue.keys[0] ?? '']) });
    }
  }
  const first = issues[0];
  return protocolError(fallback, { field: first ? fieldOf(first.path) : prefix || 'command' });
}

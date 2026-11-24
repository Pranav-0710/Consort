// Strict command validation, run before any storage work (rules H10, H12; stress H04).
//
// Order matters: size and nesting are checked on the raw value first, with an iterative walk,
// so a hostile payload is refused before a schema library recurses into it. Then the envelope,
// the catalogue (principal kind and required versions) and finally the payload schema.
// Passing validation proves shape only. The coordinator still checks membership, roles,
// ownership, the command window and every version inside its transaction (#10, #11).
import type { z } from 'zod';

import { CATALOGUE } from './catalogue.js';
import { COMMAND_PAYLOADS, isCommandType, type CommandPayload, type CommandType } from './commands/index.js';
import { envelopeSchemaFor, ProtocolVersionSchema, type CommandEnvelope } from './envelope.js';
import { protocolError, type ErrorCode, type ProtocolError } from './errors.js';
import { canonicalJson, canonicalPayloadHash, utf8Length } from './hash.js';
import { SERVER_DERIVED_FIELDS, type PrincipalKind } from './identity.js';
import { LIMITS } from './limits.js';
import { isSupported, PROTOCOL_VERSION, type ProtocolVersion } from './version.js';

export type ValidatedCommand = {
  [T in CommandType]: {
    readonly type: T;
    readonly envelope: CommandEnvelope;
    readonly payload: CommandPayload<T>;
    /**
     * Hash of the type, payload and expected versions. The same request ID with a different
     * hash is a conflict, never a retry (invariant 5).
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

/** Validates an already-parsed command. Never throws for any JSON value. */
export function validateCommand(input: unknown, context: ValidationContext): ValidationResult {
  const shapeError = checkShape(input);
  if (shapeError) return { ok: false, error: shapeError };
  if (!isPlainObject(input)) return fail('invalid_envelope', { field: 'command' });

  let commandBytes: number;
  try {
    commandBytes = utf8Length(canonicalJson(input));
  } catch {
    return fail('invalid_envelope', { field: 'command' });
  }
  if (commandBytes > LIMITS.commandBytes) {
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
    if (envelope.expected_versions[key] === undefined) {
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

  const contentHash = canonicalPayloadHash({
    type,
    payload: payload.data,
    expected_versions: envelope.expected_versions,
  });
  return {
    ok: true,
    command: { type, envelope, payload: payload.data, contentHash } as ValidatedCommand,
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
 * Walks the raw value without recursion and stops at the first breach, so very deep or very
 * large input costs at most `maxNodes` steps and never overflows the stack.
 */
function checkShape(input: unknown): ProtocolError | undefined {
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value: input, depth: 0, path: '' },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const { value, depth, path } = stack.pop()!;
    nodes += 1;
    if (nodes > LIMITS.maxNodes) {
      return protocolError('payload_too_large', { field: 'command', limit: LIMITS.maxNodes });
    }
    if (value === null || typeof value !== 'object') continue;
    const childDepth = depth + 1;
    if (childDepth > LIMITS.maxDepth) {
      return protocolError('nesting_too_deep', { field: path || 'command', limit: LIMITS.maxDepth });
    }
    if (Array.isArray(value)) {
      value.forEach((child: unknown, index) => {
        stack.push({ value: child, depth: childDepth, path: joinPath(path, index) });
      });
    } else {
      for (const [key, child] of Object.entries(value)) {
        stack.push({ value: child, depth: childDepth, path: joinPath(path, key) });
      }
    }
  }
  return undefined;
}

function joinPath(prefix: string, key: PropertyKey): string {
  return prefix ? `${prefix}.${String(key)}` : String(key);
}

/** Maps schema issues to one stable error, preferring the most actionable one. */
function fromIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: string,
  fallback: 'invalid_envelope' | 'invalid_payload',
): ProtocolError {
  const fieldOf = (path: readonly PropertyKey[]): string =>
    path.reduce<string>((acc, key) => joinPath(acc, key), prefix) || 'command';

  for (const issue of issues) {
    if (issue.code === 'too_big') {
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

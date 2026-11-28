// Cursors (rule H06, stress E04, G04).
//
// To clients a cursor is an opaque, branded string: they store it and hand it back, nothing
// else. Its claims bind it to a project, principal and view scope, membership-policy version,
// recovery epoch and retention boundary, and only the coordinator reads them. The claims
// helpers are therefore exported from `@consort/protocol/internal`, not the public entry point.
// A cursor never grants access: the coordinator authorizes every replay against current
// membership and rejects a cursor whose claims do not match the caller (E04).
//
// Opaque by agreement, not by encryption: the claims are signed base64url JSON that anyone
// holding the cursor can decode. They contain IDs and versions only, never secrets.
import { z } from 'zod';

import { versionNumber } from './commands/common.js';
import { canonicalJson, utf8Encode } from './hash.js';
import { idSchema } from './ids.js';
import type { PrincipalKind } from './identity.js';

/** `c1.<claims>.<signature>`, base64url parts. Format version 1. */
const CURSOR_PATTERN = /^c1\.[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{16,128}$/;

/** What clients see and send back. */
export const CursorSchema = z
  .string()
  .max(1200)
  .regex(CURSOR_PATTERN, 'expected an opaque cursor')
  .brand<'Cursor'>();
export type Cursor = z.infer<typeof CursorSchema>;

/** Internal: what a cursor binds to. Never exported from the public entry point. */
export const CursorClaimsSchema = z.strictObject({
  project_id: idSchema('project'),
  recovery_epoch: idSchema('recovery_epoch'),
  /** The authenticated principal; the ID kind always matches the principal kind. */
  principal: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('human' satisfies PrincipalKind), id: idSchema('user') }),
    z.strictObject({ kind: z.literal('agent_run' satisfies PrincipalKind), id: idSchema('run') }),
    z.strictObject({
      kind: z.literal('evidence_collector' satisfies PrincipalKind),
      id: idSchema('collector'),
    }),
  ]),
  /**
   * The subscription's view, for example `run-inbox` or `feature:feat_…`. A safe character set
   * keeps every valid set of claims within the cursor's encoded length.
   */
  scope: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9:._-]+$/),
  membership_policy_version: versionNumber,
  /** Last event delivered to this subscription. */
  seq: versionNumber,
  /** Oldest sequence still retained when the cursor was issued. Older history needs a snapshot. */
  retention_boundary: versionNumber,
});
export type CursorClaims = z.infer<typeof CursorClaimsSchema>;

/**
 * Internal: builds a cursor from its claims and a signature the coordinator computed over
 * `signedPart(claims)`. The protocol package does not hold keys; #13 signs and verifies.
 */
export function formatCursor(claims: CursorClaims, signature: string): Cursor {
  const cursor = `${signedPart(claims)}.${signature}`;
  return CursorSchema.parse(cursor);
}

/** Internal: the exact text a cursor signature covers. */
export function signedPart(claims: CursorClaims): string {
  return `c1.${base64UrlEncode(utf8Encode(canonicalJson(CursorClaimsSchema.parse(claims))))}`;
}

/**
 * Internal: splits a cursor into its claims, signed part and signature. Returns undefined for
 * anything malformed. Parsing is not verification: check the signature, then compare every
 * claim with the caller's current identity, scope and project before using it.
 */
export function parseCursor(
  value: string,
): { claims: CursorClaims; signedPart: string; signature: string } | undefined {
  if (typeof value !== 'string' || !CURSOR_PATTERN.test(value)) return undefined;
  const lastDot = value.lastIndexOf('.');
  const signed = value.slice(0, lastDot);
  const bytes = base64UrlDecode(signed.slice(3));
  if (bytes === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(bytes));
  } catch {
    return undefined;
  }
  const claims = CursorClaimsSchema.safeParse(json);
  if (!claims.success) return undefined;
  // Reject non-canonical encodings so one set of claims has exactly one signed form.
  if (signedPart(claims.data) !== signed) return undefined;
  return { claims: claims.data, signedPart: signed, signature: value.slice(lastDot + 1) };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += ALPHABET[c & 63]!;
  }
  return out;
}

function base64UrlDecode(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let p = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, p);
}

/** Strict UTF-8 decoding; throws on malformed input. */
function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i]!;
    let code: number;
    let extra: number;
    if (a < 0x80) [code, extra] = [a, 0];
    else if (a >= 0xc2 && a < 0xe0) [code, extra] = [a & 0x1f, 1];
    else if (a >= 0xe0 && a < 0xf0) [code, extra] = [a & 0x0f, 2];
    else if (a >= 0xf0 && a < 0xf5) [code, extra] = [a & 0x07, 3];
    else throw new TypeError('invalid UTF-8');
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) throw new TypeError('invalid UTF-8');
      code = (code << 6) | (next & 0x3f);
    }
    const min = [0, 0x80, 0x800, 0x10000][extra]!;
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new TypeError('invalid UTF-8');
    }
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

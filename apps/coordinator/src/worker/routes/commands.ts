// Command routes (#10, #11): send a command, issue a command window, read your own receipt.
//
//   POST /v1/projects/:id/commands               a command, validated here and again in the object
//   POST /v1/projects/:id/command-windows        a window bound to the caller, its scope and epoch
//   GET  /v1/projects/:id/commands/:requestId    committed, rejected or unknown, own receipts only
//
// A client whose command timed out does not know whether it applied. It reads the receipt before
// deciding anything; `unknown` means unknown, never failure or success.
import { LIMITS, protocolError, type ErrorCode, type ProtocolError } from '@consort/protocol';

import type { Principal } from '../../mutations/principal.js';
import type { CoordinatorStub } from '../router.js';
import { validateAtIngress } from '../validate.js';

export async function postCommand(
  request: Request,
  stub: CoordinatorStub,
  projectId: string,
  principal: Principal,
): Promise<Response> {
  const text = await readBounded(request, LIMITS.commandBytes);
  if (text === undefined) {
    return errorResponse(
      protocolError('payload_too_large', { field: 'command', limit: LIMITS.commandBytes }),
    );
  }
  const validated = validateAtIngress(text, principal, projectId);
  if (!validated.ok) return errorResponse(validated.error);
  return call(
    () => stub.applyCommand(principal, text),
    (result) => (result.ok ? Response.json(result, { status: 200 }) : errorResponse(result.error)),
  );
}

export function postCommandWindow(stub: CoordinatorStub, principal: Principal): Promise<Response> {
  return call(
    () => stub.issueCommandWindow(principal),
    (result) => (result.ok ? Response.json(result.window, { status: 201 }) : errorResponse(result.error)),
  );
}

export function getReceipt(
  stub: CoordinatorStub,
  principal: Principal,
  requestId: string,
): Promise<Response> {
  return call(
    () => stub.readReceipt(principal, requestId),
    (result) => (result.ok ? Response.json(result.receipt, { status: 200 }) : errorResponse(result.error)),
  );
}

async function call<T>(invoke: () => Promise<T>, respond: (result: T) => Response): Promise<Response> {
  let result: T;
  try {
    result = await invoke();
  } catch {
    // The call may have committed before it failed: the client must query, not assume.
    return errorResponse(protocolError('outcome_unknown'));
  }
  return respond(result);
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  payload_too_large: 413,
  project_not_found: 404,
  project_unavailable: 503,
  outcome_unknown: 503,
  not_a_member: 403,
  not_authorized: 403,
  principal_not_allowed: 403,
  identity_mismatch: 403,
  stale_version: 409,
  authority_changed: 409,
  request_id_conflict: 409,
  recovery_epoch_mismatch: 409,
  connection_fenced: 409,
  command_window_invalid: 409,
  limit_exceeded: 429,
  command_unavailable: 501,
  internal_error: 500,
};

export function errorResponse(error: ProtocolError): Response {
  return Response.json({ ok: false, error }, { status: STATUS[error.code] ?? 400 });
}

/** Reads the body as UTF-8, giving up as soon as it passes `limit` bytes. */
async function readBounded(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return undefined;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Invalid UTF-8 becomes U+FFFD and then fails JSON or schema validation.
  return new TextDecoder().decode(bytes);
}

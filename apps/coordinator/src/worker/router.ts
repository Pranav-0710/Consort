// Worker ingress: authenticate, validate, then call the project's object over RPC.
//
// The principal comes only from `authenticate`. Headers such as `X-Consort-Principal` and any
// actor fields in the body are never read as identity: the body's are rejected by validation,
// and headers are simply not consulted. Until sign-in (#19) and pairing (#21) land, the deployed
// Worker's authenticator accepts nobody, so no unauthenticated route can reach a project.
import { isId, LIMITS, protocolError, type ErrorCode, type ProtocolError } from '@consort/protocol';

import type { ApplyResult } from '../do/core.js';
import type { Principal } from '../mutations/principal.js';

import { validateAtIngress } from './validate.js';

export interface CoordinatorStub {
  applyCommand(principal: Principal, commandText: string): Promise<ApplyResult>;
}

export interface RouterDeps {
  /** Derives the principal from the session or credential. Null means not authenticated. */
  authenticate(request: Request): Promise<Principal | null>;
  coordinatorFor(projectId: string): CoordinatorStub;
}

const COMMANDS_ROUTE = /^\/v1\/projects\/([^/]+)\/commands$/;

export async function handleRequest(request: Request, deps: RouterDeps): Promise<Response> {
  const url = new URL(request.url);
  const match = COMMANDS_ROUTE.exec(url.pathname);
  if (match === null) return new Response(null, { status: 404 });
  const projectId = match[1] ?? '';
  if (!isId('project', projectId)) return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });

  const principal = await deps.authenticate(request);
  // The authenticated error body arrives with sign-in (#19).
  if (principal === null) return new Response(null, { status: 401 });

  const text = await readBounded(request, LIMITS.commandBytes);
  if (text === undefined) {
    return errorResponse(
      protocolError('payload_too_large', { field: 'command', limit: LIMITS.commandBytes }),
    );
  }

  const validated = validateAtIngress(text, principal, projectId);
  if (!validated.ok) return errorResponse(validated.error);

  let result: ApplyResult;
  try {
    result = await deps.coordinatorFor(projectId).applyCommand(principal, text);
  } catch {
    // The call may have committed before it failed: the client must query, not assume.
    return errorResponse(protocolError('outcome_unknown'));
  }
  return result.ok ? Response.json(result, { status: 200 }) : errorResponse(result.error);
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
  command_unavailable: 501,
};

function errorResponse(error: ProtocolError): Response {
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

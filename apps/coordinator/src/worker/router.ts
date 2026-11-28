// Worker ingress: route, authenticate, then hand over to the route, which calls the project's
// object over RPC.
//
// The principal comes only from `authenticate`. Headers such as `X-Consort-Principal` and any
// actor fields in the body are never read as identity: the body's are rejected by validation,
// and headers are simply not consulted. Until sign-in (#19) and pairing (#21) land, the deployed
// Worker's authenticator accepts nobody, so no unauthenticated route can reach a project.
import { isId } from '@consort/protocol';

import type { ApplyResult, ReceiptResult, WindowResult } from '../do/core.js';
import type { Principal } from '../mutations/principal.js';

import { getReceipt, postCommand, postCommandWindow } from './routes/commands.js';

export interface CoordinatorStub {
  applyCommand(principal: Principal, commandText: string): Promise<ApplyResult>;
  issueCommandWindow(principal: Principal): Promise<WindowResult>;
  readReceipt(principal: Principal, requestId: string): Promise<ReceiptResult>;
}

export interface RouterDeps {
  /** Derives the principal from the session or credential. Null means not authenticated. */
  authenticate(request: Request): Promise<Principal | null>;
  coordinatorFor(projectId: string): CoordinatorStub;
}

const PROJECT_ROUTE = /^\/v1\/projects\/([^/]+)\/(commands|command-windows)(?:\/([^/]+))?$/;

type Route =
  | { readonly kind: 'command' }
  | { readonly kind: 'window' }
  | { readonly kind: 'receipt'; readonly requestId: string };

/** The route and the one method it accepts, or undefined for anything else. */
function route(name: string, rest: string | undefined): { route: Route; method: string } | undefined {
  if (name === 'commands' && rest === undefined) return { route: { kind: 'command' }, method: 'POST' };
  if (name === 'command-windows' && rest === undefined) return { route: { kind: 'window' }, method: 'POST' };
  if (name === 'commands' && rest !== undefined && isId('request', rest)) {
    return { route: { kind: 'receipt', requestId: rest }, method: 'GET' };
  }
  return undefined;
}

export async function handleRequest(request: Request, deps: RouterDeps): Promise<Response> {
  const match = PROJECT_ROUTE.exec(new URL(request.url).pathname);
  const projectId = match?.[1] ?? '';
  const found = match === null ? undefined : route(match[2] ?? '', match[3]);
  if (found === undefined || !isId('project', projectId)) return new Response(null, { status: 404 });
  if (request.method !== found.method) {
    return new Response(null, { status: 405, headers: { allow: found.method } });
  }

  const principal = await deps.authenticate(request);
  // The authenticated error body arrives with sign-in (#19).
  if (principal === null) return new Response(null, { status: 401 });

  const stub = deps.coordinatorFor(projectId);
  switch (found.route.kind) {
    case 'command':
      return postCommand(request, stub, projectId, principal);
    case 'window':
      return postCommandWindow(stub, principal);
    case 'receipt':
      return getReceipt(stub, principal, found.route.requestId);
  }
}

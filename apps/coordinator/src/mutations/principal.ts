// Who is acting, as the Worker derived it from the authenticated session or credential.
//
// The principal never comes from the command: the envelope cannot name an actor (the validator
// rejects server-derived fields), and the Worker ignores any header that claims one. Until
// sign-in (#19) and pairing (#21) land, principals reach the coordinator only through the test
// harness; the deployed Worker authenticates nobody.
import { isId, type EventActor, type EVENT_SOURCES, type PrincipalKind } from '@consort/protocol';

export type Principal =
  | { readonly kind: 'human'; readonly user_id: string }
  | { readonly kind: 'agent_run'; readonly user_id: string; readonly connection_id: string }
  | { readonly kind: 'evidence_collector'; readonly collector_id: string };

/** Checks a principal received over RPC. The Worker is trusted, but a malformed value fails closed. */
export function isPrincipal(value: unknown): value is Principal {
  if (value === null || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  switch (p['kind']) {
    case 'human':
      return isId('user', p['user_id']) && Object.keys(p).length === 2;
    case 'agent_run':
      return (
        isId('user', p['user_id']) && isId('connection', p['connection_id']) && Object.keys(p).length === 3
      );
    case 'evidence_collector':
      return isId('collector', p['collector_id']) && Object.keys(p).length === 2;
    default:
      return false;
  }
}

/** Retained outcomes are keyed by this, so one principal never sees another's receipt (H04). */
export function principalKey(principal: Principal): string {
  switch (principal.kind) {
    case 'human':
      return `human:${principal.user_id}`;
    case 'agent_run':
      return `agent_run:${principal.user_id}:${principal.connection_id}`;
    case 'evidence_collector':
      return `evidence_collector:${principal.collector_id}`;
  }
}

/** The actor recorded on events. An agent's run comes from its validated identity block. */
export function actorFor(principal: Principal, runId: string | undefined): EventActor {
  switch (principal.kind) {
    case 'human':
      return { kind: 'human', user_id: principal.user_id };
    case 'agent_run':
      if (runId === undefined) throw new TypeError('an agent command must carry its run');
      return { kind: 'agent_run', run_id: runId, user_id: principal.user_id };
    case 'evidence_collector':
      return { kind: 'evidence_collector', collector_id: principal.collector_id };
  }
}

/** Where an event's information came from: a person's action is not an agent's report. */
export function sourceFor(kind: PrincipalKind): (typeof EVENT_SOURCES)[number] {
  switch (kind) {
    case 'human':
      return 'human_action';
    case 'agent_run':
      return 'agent_report';
    case 'evidence_collector':
      return 'participant_collected';
  }
}

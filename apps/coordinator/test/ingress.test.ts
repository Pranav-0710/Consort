import { LIMITS } from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import type { ApplyResult } from '../src/do/core.js';
import type { Principal } from '../src/mutations/principal.js';
import { handleRequest, type RouterDeps } from '../src/worker/router.js';

import { alice, BLAIR, commandText, OTHER_PROJECT, PROJECT, setup } from './support/harness.js';

const FEATURE = { title: 'Checkout', goal: 'Ship checkout' };
const URL_FOR = (project: string) => `https://coordinator.test/v1/projects/${project}/commands`;

/** A Worker wired to a real core, recording what reaches the object. */
function worker(principal: Principal | null) {
  const fixture = setup();
  const received: Array<{ principal: Principal; text: string }> = [];
  let projectAsked: string | undefined;
  const deps: RouterDeps = {
    authenticate: () => Promise.resolve(principal),
    coordinatorFor: (projectId) => {
      projectAsked = projectId;
      return {
        applyCommand: (p, text) => {
          received.push({ principal: p, text });
          return Promise.resolve(fixture.core.applyCommand(p, text));
        },
      };
    },
  };
  const post = (body: string, headers: Record<string, string> = {}, project = PROJECT) =>
    handleRequest(new Request(URL_FOR(project), { method: 'POST', body, headers }), deps);
  return { fixture, received, post, projectAsked: () => projectAsked };
}

describe('Worker ingress', () => {
  it('client-supplied actor or principal headers are ignored', async () => {
    const { fixture, received, post } = worker(alice);
    const response = await post(commandText('feature.create', FEATURE, { epoch: fixture.epoch }), {
      'x-consort-principal': JSON.stringify({ kind: 'human', user_id: BLAIR }),
      'x-consort-actor': BLAIR,
      'x-consort-role': 'admin',
    });
    expect(response.status).toBe(200);
    expect(received.map((r) => r.principal)).toEqual([alice]);
    const actor = fixture.storage.db
      .prepare("SELECT actor FROM events WHERE type = 'feature.created'")
      .get() as {
      actor: string;
    };
    expect(JSON.parse(actor.actor)).toEqual(alice);
  });

  it('an actor named in the body is rejected before routing', async () => {
    const { fixture, received, post } = worker(alice);
    const response = await post(
      commandText('feature.create', FEATURE, {
        epoch: fixture.epoch,
        extra: { actor: { kind: 'human', user_id: BLAIR } },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'server_derived_field', field: 'actor' },
    });
    expect(received).toHaveLength(0);
  });

  it('validates before routing: an invalid command never reaches the object', async () => {
    const { fixture, received, post } = worker(alice);
    const response = await post(
      commandText('feature.create', { title: 'no goal' }, { epoch: fixture.epoch }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } });
    expect(received).toHaveLength(0);
  });

  it('an unauthenticated request reaches no project', async () => {
    const { fixture, received, post, projectAsked } = worker(null);
    const response = await post(commandText('feature.create', FEATURE, { epoch: fixture.epoch }));
    expect(response.status).toBe(401);
    expect(received).toHaveLength(0);
    expect(projectAsked()).toBeUndefined();
  });

  it('the URL and the envelope must name the same project', async () => {
    const { fixture, received, post } = worker(alice);
    const response = await post(
      commandText('feature.create', FEATURE, { epoch: fixture.epoch, project: OTHER_PROJECT }),
      {},
      PROJECT,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_envelope', field: 'project_id' } });
    expect(received).toHaveLength(0);
  });

  it('an oversized body is refused before it is parsed', async () => {
    const { received, post } = worker(alice);
    const response = await post('x'.repeat(LIMITS.commandBytes + 1));
    expect(response.status).toBe(413);
    expect(received).toHaveLength(0);
  });

  it('unknown paths, malformed project IDs and other methods are not routed', async () => {
    const { fixture, received } = worker(alice);
    const deps: RouterDeps = {
      authenticate: () => Promise.resolve(alice),
      coordinatorFor: () => ({ applyCommand: () => Promise.reject(new Error('must not be called')) }),
    };
    const body = commandText('feature.create', FEATURE, { epoch: fixture.epoch });
    for (const [url, method, status] of [
      ['https://coordinator.test/v1/projects', 'POST', 404],
      [URL_FOR('not-a-project'), 'POST', 404],
      [URL_FOR(PROJECT), 'GET', 405],
    ] as const) {
      const init: RequestInit = method === 'POST' ? { method, body } : { method };
      expect((await handleRequest(new Request(url, init), deps)).status).toBe(status);
    }
    expect(received).toHaveLength(0);
  });

  it('a rolled-back internal failure is reported as 500 internal_error, not outcome_unknown', async () => {
    const { fixture } = worker(alice);
    const deps: RouterDeps = {
      authenticate: () => Promise.resolve(alice),
      coordinatorFor: () => ({
        applyCommand: (): Promise<ApplyResult> =>
          Promise.resolve({ ok: false, error: { code: 'internal_error', message: 'nothing changed' } }),
      }),
    };
    const response = await handleRequest(
      new Request(URL_FOR(PROJECT), {
        method: 'POST',
        body: commandText('feature.create', FEATURE, { epoch: fixture.epoch }),
      }),
      deps,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'internal_error' } });
  });

  it('a failed call to the object is reported as outcome_unknown, never as success or failure', async () => {
    const { fixture } = worker(alice);
    const deps: RouterDeps = {
      authenticate: () => Promise.resolve(alice),
      coordinatorFor: () => ({
        applyCommand: (): Promise<ApplyResult> => Promise.reject(new Error('reset')),
      }),
    };
    const response = await handleRequest(
      new Request(URL_FOR(PROJECT), {
        method: 'POST',
        body: commandText('feature.create', FEATURE, { epoch: fixture.epoch }),
      }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'outcome_unknown' } });
  });
});

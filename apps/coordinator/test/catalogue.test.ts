// Generated from the catalogue: one case per command, so a new command is covered automatically.
import { CATALOGUE, COMMAND_TYPES, type CommandType } from '@consort/protocol';
import { describe, expect, it } from 'vitest';

import { PRODUCTION_REGISTRY } from '../src/mutations/production.js';
import { createRegistry, DENY_ALL, defineHandler } from '../src/mutations/registry.js';
import { CoordinatorCore } from '../src/do/core.js';
import { validateAtIngress } from '../src/worker/validate.js';

import { alice, aliceAgent, commandText, member, PROJECT, RUN, setup } from './support/harness.js';
import { memoryStorage } from './support/sqlite.js';

const humanOnly = COMMAND_TYPES.filter((type) => !CATALOGUE[type].principals.includes('agent_run'));
const agentOnly = COMMAND_TYPES.filter((type) => !CATALOGUE[type].principals.includes('human'));

describe('catalogue enforcement', () => {
  it('has commands on both sides to generate from', () => {
    expect(humanOnly.length).toBeGreaterThan(5);
    expect(agentOnly.length).toBeGreaterThan(3);
  });

  // The issue's forbidden_for_agent and forbidden_for_human are the protocol's principal_not_allowed.
  it.each(humanOnly)('every human-only command fails for an agent principal: %s', (type) => {
    const fixture = setup({ members: [[aliceAgent, member('admin', { scope: 'project', run_id: RUN })]] });
    const text = commandText(type, {}, { epoch: fixture.epoch, agent: true });
    expect(validateAtIngress(text, aliceAgent, PROJECT)).toMatchObject({
      ok: false,
      error: { code: 'principal_not_allowed' },
    });
    // The object checks again, so a bypassed Worker gains nothing.
    expect(fixture.core.applyCommand(aliceAgent, text)).toMatchObject({
      ok: false,
      error: { code: 'principal_not_allowed' },
    });
  });

  it.each(agentOnly)('every agent-only command fails for a human session: %s', (type) => {
    const fixture = setup({ members: [[alice, member('admin')]] });
    const text = commandText(type, {}, { epoch: fixture.epoch });
    expect(validateAtIngress(text, alice, PROJECT)).toMatchObject({
      ok: false,
      error: { code: 'principal_not_allowed' },
    });
    expect(fixture.core.applyCommand(alice, text)).toMatchObject({
      ok: false,
      error: { code: 'principal_not_allowed' },
    });
  });

  it('a role below the catalogue minimum gets not_authorized', () => {
    const { core, epoch } = setup({ members: [[alice, member('reader')]] });
    expect(
      core.applyCommand(alice, commandText('feature.create', { title: 't', goal: 'g' }, { epoch })),
    ).toMatchObject({
      ok: false,
      error: { code: 'not_authorized' },
    });
  });

  it('a command with no registered handler gets command_unavailable', () => {
    const { core, epoch } = setup({ handlers: [] });
    expect(
      core.applyCommand(alice, commandText('feature.create', { title: 't', goal: 'g' }, { epoch })),
    ).toMatchObject({
      ok: false,
      error: { code: 'command_unavailable' },
    });
  });

  it('the deployed registry refuses every command: nobody is a member yet', () => {
    const core = new CoordinatorCore(memoryStorage(), { registry: PRODUCTION_REGISTRY });
    core.start();
    const created = core.init({
      project_id: PROJECT,
      created_by: 'usr_aliceAAAAA01',
      request_id: 'req_initinitinit01',
    });
    if (!created.ok) throw new Error('init failed');
    const text = commandText('feature.create', { title: 't', goal: 'g' }, { epoch: created.recovery_epoch });
    expect(core.applyCommand(alice, text)).toMatchObject({ ok: false, error: { code: 'not_a_member' } });
  });

  it('a handler set that would skip an ownership or scope rule is refused at startup', () => {
    const ownedType: CommandType = 'change_request.accept';
    expect(CATALOGUE[ownedType].ownership).not.toBe('none');
    expect(() =>
      createRegistry({
        authority: DENY_ALL,
        handlers: [defineHandler({ type: ownedType, apply: () => undefined })],
      }),
    ).toThrow(/no authorize check/);
    expect(() =>
      createRegistry({
        authority: DENY_ALL,
        handlers: [defineHandler({ type: 'question.ask', apply: () => undefined })],
      }),
    ).toThrow(/declares no scope/);
  });
});

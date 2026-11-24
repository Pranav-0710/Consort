import { describe, expect, it } from 'vitest';

import {
  AgentIdentitySchema,
  CATALOGUE,
  COMMAND_TYPES,
  isSupported,
  PROTOCOL_VERSION,
  SERVER_DERIVED_FIELDS,
  validateCommand,
  validateCommandJson,
  type PrincipalKind,
} from '../src/index.js';
import { envelope, EXAMPLE_PAYLOADS, structuredCloneJson } from './fixtures.js';

const errorOf = (input: unknown, principal: PrincipalKind = 'human') => {
  const result = validateCommand(input, { principal });
  if (result.ok) throw new Error('expected validation to fail');
  return result.error;
};

describe('protocol version', () => {
  it('rejects a newer client minor and any other major', () => {
    const server = { major: 1, minor: 3 };
    expect(isSupported({ major: 1, minor: 3 }, server)).toBe(true);
    expect(isSupported({ major: 1, minor: 0 }, server)).toBe(true);
    expect(isSupported({ major: 1, minor: 4 }, server)).toBe(false);
    expect(isSupported({ major: 2, minor: 0 }, server)).toBe(false);
    expect(isSupported({ major: 0, minor: 9 }, server)).toBe(false);
  });

  it('validation rejects an unsupported client version', () => {
    const command = envelope('feature.create');
    command['protocol_version'] = { major: PROTOCOL_VERSION.major, minor: PROTOCOL_VERSION.minor + 1 };
    expect(errorOf(command)).toMatchObject({
      code: 'unsupported_protocol_version',
      field: 'protocol_version',
    });
  });
});

describe('command envelope', () => {
  it('accepts a valid human command and a valid agent command', () => {
    expect(validateCommand(envelope('feature.create'), { principal: 'human' }).ok).toBe(true);
    expect(validateCommand(envelope('plan.publish'), { principal: 'agent_run' }).ok).toBe(true);
  });

  it('envelope rejects a supplied actor field', () => {
    const command = { ...envelope('feature.create'), actor: 'usr_someoneelse01' };
    expect(errorOf(command)).toMatchObject({ code: 'server_derived_field', field: 'actor' });
  });

  it.each(SERVER_DERIVED_FIELDS)('envelope rejects the server-derived field %s', (field) => {
    const command = { ...envelope('plan.publish'), [field]: 'x' };
    expect(errorOf(command, 'agent_run')).toMatchObject({ code: 'server_derived_field', field });
  });

  it.each(Object.keys(AgentIdentitySchema.shape))(
    'agent envelope missing any identity-chain link fails to parse (%s)',
    (link) => {
      const command = envelope('plan.publish');
      delete (command['agent'] as Record<string, unknown>)[link];
      expect(errorOf(command, 'agent_run')).toMatchObject({
        code: 'invalid_envelope',
        field: `agent.${link}`,
      });
    },
  );

  it('agent envelope without the agent block fails to parse', () => {
    const command = envelope('plan.publish');
    delete command['agent'];
    expect(errorOf(command, 'agent_run')).toMatchObject({ code: 'invalid_envelope', field: 'agent' });
  });

  it('human envelope cannot carry an agent block', () => {
    const command = {
      ...envelope('question.ask', { principal: 'human' }),
      agent: envelope('plan.publish')['agent'],
    };
    expect(errorOf(command)).toMatchObject({ code: 'unknown_property', field: 'agent' });
  });

  it('an ID of the wrong kind is rejected', () => {
    const command = { ...envelope('feature.create'), project_id: 'run_test00000001' };
    expect(errorOf(command)).toMatchObject({ code: 'invalid_envelope', field: 'project_id' });
  });

  it('change_request.accept without owner_version fails validation', () => {
    const command = envelope('change_request.accept', {
      versions: { record_version: 4, membership_policy_version: 2 },
    });
    expect(errorOf(command)).toMatchObject({
      code: 'missing_expected_version',
      field: 'expected_versions.owner_version',
    });
  });

  it('acceptance-style commands require target, owner and membership versions', () => {
    for (const type of ['change_request.accept', 'change_request.reject', 'reconciliation.accept'] as const) {
      expect(CATALOGUE[type].requiredVersions).toEqual(
        expect.arrayContaining(['record_version', 'owner_version', 'membership_policy_version']),
      );
    }
  });

  it('an agent credential cannot call a human acceptance command (stress A05)', () => {
    const command = { ...envelope('change_request.accept'), agent: envelope('plan.publish')['agent'] };
    expect(errorOf(command, 'agent_run')).toMatchObject({ code: 'principal_not_allowed', field: 'type' });
  });

  it('no owner decision is open to agent runs', () => {
    for (const type of COMMAND_TYPES) {
      const entry = CATALOGUE[type];
      if (entry.requiredVersions.includes('owner_version')) {
        expect(entry.principals, type).not.toContain('agent_run');
      }
    }
  });

  it('rejects an unknown command type', () => {
    const command = { ...envelope('feature.create'), type: 'feature.delete_everything' };
    expect(errorOf(command)).toMatchObject({ code: 'unknown_command', field: 'type' });
  });

  it('agent plan cannot name its own work package: it comes from the run', () => {
    const command = envelope('plan.publish', {
      payload: { ...structuredCloneJson(EXAMPLE_PAYLOADS['plan.publish']), package_id: 'pkg_test00000001' },
    });
    expect(errorOf(command, 'agent_run')).toMatchObject({
      code: 'unknown_property',
      field: 'payload.package_id',
    });
  });

  it('rejects malformed JSON text', () => {
    const result = validateCommandJson('{"type":', { principal: 'human' });
    expect(result).toMatchObject({ ok: false, error: { code: 'malformed_json' } });
  });

  it('accepts the same command as JSON text', () => {
    const result = validateCommandJson(JSON.stringify(envelope('feature.create')), { principal: 'human' });
    expect(result.ok).toBe(true);
  });
});

describe('strict validation', () => {
  it('unknown property is rejected', () => {
    expect(errorOf({ ...envelope('feature.create'), extra: true })).toMatchObject({
      code: 'unknown_property',
      field: 'extra',
    });

    const inPayload = envelope('feature.create', {
      payload: { ...EXAMPLE_PAYLOADS['feature.create'], extra: true },
    });
    expect(errorOf(inPayload)).toMatchObject({ code: 'unknown_property', field: 'payload.extra' });

    const plan = structuredCloneJson(EXAMPLE_PAYLOADS['plan.publish']) as {
      steps: Array<Record<string, unknown>>;
    };
    plan.steps[0]!['extra'] = true;
    expect(errorOf(envelope('plan.publish', { payload: plan }), 'agent_run')).toMatchObject({
      code: 'unknown_property',
      field: 'payload.steps.0.extra',
    });

    const versions = envelope('feature.create', { versions: { record_version: 1, extra: 1 } as never });
    expect(errorOf(versions)).toMatchObject({ code: 'unknown_property', field: 'expected_versions.extra' });
  });

  it('reports the field of an invalid payload value', () => {
    const command = envelope('question.ask', {
      principal: 'human',
      payload: { to: { kind: 'package', package_id: 'pkg_x' }, text: 'Hi?' },
    });
    expect(errorOf(command)).toMatchObject({ code: 'invalid_payload', field: 'payload.to.package_id' });
  });

  it('the content hash ignores key order and changes with content', () => {
    const a = validateCommand(envelope('feature.create'), { principal: 'human' });
    const reordered = Object.fromEntries(Object.entries(envelope('feature.create')).reverse());
    const b = validateCommand(reordered, { principal: 'human' });
    const c = validateCommand(
      envelope('feature.create', { payload: { title: 'Other', goal: 'Different.' } }),
      { principal: 'human' },
    );
    if (!a.ok || !b.ok || !c.ok) throw new Error('expected valid commands');
    expect(b.command.contentHash).toBe(a.command.contentHash);
    expect(c.command.contentHash).not.toBe(a.command.contentHash);
  });
});

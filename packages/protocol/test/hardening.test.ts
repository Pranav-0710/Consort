// Regression tests for the review of #86.
import { describe, expect, it } from 'vitest';

import { LIMITS, validateCommand, validateCommandJson, type PrincipalKind } from '../src/index.js';
import { envelope, EXAMPLE_PAYLOADS, id } from './fixtures.js';

const run = (input: unknown, principal: PrincipalKind = 'human') => validateCommand(input, { principal });
const errorOf = (input: unknown, principal: PrincipalKind = 'human') => {
  const result = run(input, principal);
  if (result.ok) throw new Error('expected validation to fail');
  return result.error;
};

describe('bounds walk stops early on parsed input', () => {
  it('rejects a huge array without visiting every element', () => {
    const payload = { ...EXAMPLE_PAYLOADS['feature.create'], filler: new Array<number>(5_000_000).fill(0) };
    const started = Date.now();
    expect(errorOf(envelope('feature.create', { payload }))).toMatchObject({
      code: 'payload_too_large',
      field: 'command',
      limit: LIMITS.maxNodes,
    });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('rejects a huge string before serializing the command', () => {
    const payload = { title: 'x', goal: 'y'.repeat(10_000_000) };
    const started = Date.now();
    expect(errorOf(envelope('feature.create', { payload }))).toMatchObject({
      code: 'payload_too_large',
      field: 'command',
      limit: LIMITS.commandBytes,
    });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('rejects a non-object command before walking it', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 30_000; i++) deep = [deep];
    expect(errorOf(deep)).toMatchObject({ code: 'invalid_envelope', field: 'command' });
    const text = `${'['.repeat(30_000)}${']'.repeat(30_000)}`;
    expect(validateCommandJson(text, { principal: 'human' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_envelope', field: 'command' },
    });
  });

  it('never throws, even for a throwing getter', () => {
    const command = envelope('feature.create');
    Object.defineProperty(command, 'payload', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(errorOf(command)).toMatchObject({ code: 'invalid_envelope' });
  });
});

describe('__proto__ keys', () => {
  it('is rejected inside a version map and at the top level', () => {
    const versions = JSON.parse(
      `{"record_version":1,"owner_version":1,"membership_policy_version":1,"contract_versions":{"__proto__":5,"${id('contract')}":2}}`,
    ) as never;
    expect(errorOf(envelope('reconciliation.accept', { versions }))).toMatchObject({
      code: 'unknown_property',
      field: 'expected_versions.contract_versions.__proto__',
    });

    const withProto = JSON.parse(`{"__proto__":{"admin":true}}`) as Record<string, unknown>;
    const command = Object.assign(Object.create(null) as Record<string, unknown>, envelope('feature.create'));
    Object.defineProperty(command, '__proto__', {
      value: withProto['__proto__'],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(errorOf(command)).toMatchObject({ code: 'unknown_property', field: '__proto__' });
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });

  it('the validated envelope carries the parsed payload, not the raw one', () => {
    const result = run(envelope('feature.create'));
    if (!result.ok) throw new Error('expected a valid command');
    expect(result.command.envelope.payload).toBe(result.command.payload);
  });
});

describe('reconciliation pins the contract it decides on', () => {
  const authority = { record_version: 4, owner_version: 2, membership_policy_version: 7 };

  it.each(['reconciliation.accept', 'reconciliation.record_blocker'] as const)(
    '%s rejects an empty contract map',
    (type) => {
      const command = envelope(type, { versions: { ...authority, contract_versions: {} } });
      expect(errorOf(command)).toMatchObject({
        code: 'missing_expected_version',
        field: 'expected_versions.contract_versions',
      });
    },
  );

  it.each(['reconciliation.accept', 'reconciliation.record_blocker'] as const)(
    '%s rejects pins that omit the reconciled contract',
    (type) => {
      const command = envelope(type, {
        versions: { ...authority, contract_versions: { [id('contract', 9)]: 3 } },
      });
      expect(errorOf(command)).toMatchObject({
        code: 'missing_expected_version',
        field: 'expected_versions.contract_versions',
      });
    },
  );
});

describe('content hash and identity', () => {
  it('differs between runs and between principal kinds for the same body', () => {
    const a = envelope('question.ask', { principal: 'agent_run' });
    const b = envelope('question.ask', { principal: 'agent_run' });
    (b['agent'] as Record<string, unknown>)['run_id'] = id('run', 2);
    const human = envelope('question.ask', { principal: 'human' });
    const [ra, rb, rh] = [run(a, 'agent_run'), run(b, 'agent_run'), run(human, 'human')];
    if (!ra.ok || !rb.ok || !rh.ok) throw new Error('expected valid commands');
    expect(ra.command.contentHash).not.toBe(rb.command.contentHash);
    expect(ra.command.contentHash).not.toBe(rh.command.contentHash);
  });

  it('is unchanged when only the connection generation changes (a retry after reconnect)', () => {
    const a = envelope('question.ask', { principal: 'agent_run' });
    const b = envelope('question.ask', { principal: 'agent_run' });
    (b['agent'] as Record<string, unknown>)['connection_generation'] = 9;
    const [ra, rb] = [run(a, 'agent_run'), run(b, 'agent_run')];
    if (!ra.ok || !rb.ok) throw new Error('expected valid commands');
    expect(ra.command.contentHash).toBe(rb.command.contentHash);
  });

  it('an agent run cannot detach a different run', () => {
    const command = envelope('run.detach', {
      principal: 'agent_run',
      payload: { run_id: id('run', 2), reason: 'not mine' },
    });
    expect(errorOf(command, 'agent_run')).toMatchObject({
      code: 'identity_mismatch',
      field: 'payload.run_id',
    });
  });
});

describe('error mapping', () => {
  it('a version beyond the safe-integer range is an invalid value, not a size problem', () => {
    const command = envelope('change_request.withdraw', { versions: { record_version: 2 ** 60 } });
    expect(errorOf(command)).toMatchObject({
      code: 'invalid_envelope',
      field: 'expected_versions.record_version',
    });
  });
});

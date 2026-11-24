import { describe, expect, it } from 'vitest';

import { LIMITS, LIMITS_ARE_PROVISIONAL, validateCommand, validateCommandJson } from '../src/index.js';
import { envelope, EXAMPLE_PAYLOADS, id } from './fixtures.js';

const agentError = (input: unknown) => {
  const result = validateCommand(input, { principal: 'agent_run' });
  if (result.ok) throw new Error('expected validation to fail');
  return result.error;
};

const planWith = (steps: unknown[], contractVersions: Record<string, number> = {}) =>
  envelope('plan.publish', {
    payload: { based_on: { agreement_version: 3, contract_versions: contractVersions }, steps },
  });

const step = (n: number, text = `step ${n}`) => ({ id: `s${n}`, text, status: 'pending' });

describe('bounds', () => {
  it('limits are marked provisional until #58 and #69 set them', () => {
    expect(LIMITS_ARE_PROVISIONAL).toBe(true);
  });

  it('deeply nested payload is rejected before storage', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 100_000; i++) deep = { nested: deep };
    const command = envelope('plan.publish', { payload: deep });
    expect(agentError(command)).toMatchObject({ code: 'nesting_too_deep', limit: LIMITS.maxDepth });

    let justOver: unknown = 'leaf';
    for (let i = 0; i < LIMITS.maxDepth; i++) justOver = [justOver];
    expect(agentError(envelope('plan.publish', { payload: justOver }))).toMatchObject({
      code: 'nesting_too_deep',
    });
  });

  it('oversized plan returns payload_too_large naming field and limit', () => {
    const tooMany = Array.from({ length: LIMITS.planSteps + 1 }, (_, n) => step(n));
    expect(agentError(planWith(tooMany))).toEqual(
      expect.objectContaining({ code: 'payload_too_large', field: 'payload.steps', limit: LIMITS.planSteps }),
    );

    const tooLong = [step(1, 'x'.repeat(LIMITS.planStepChars + 1))];
    expect(agentError(planWith(tooLong))).toEqual(
      expect.objectContaining({
        code: 'payload_too_large',
        field: 'payload.steps.0.text',
        limit: LIMITS.planStepChars,
      }),
    );
  });

  it('a plan at the limits is accepted', () => {
    const steps = Array.from({ length: LIMITS.planSteps }, (_, n) => step(n, 'x'.repeat(100)));
    expect(validateCommand(planWith(steps), { principal: 'agent_run' }).ok).toBe(true);
  });

  it('too many shared-contract pins name the field and limit', () => {
    const pins = Object.fromEntries(
      Array.from({ length: LIMITS.contractPins + 1 }, (_, n) => [id('contract', n), 1]),
    );
    expect(agentError(planWith([step(1)], pins))).toEqual(
      expect.objectContaining({
        code: 'payload_too_large',
        field: 'payload.based_on.contract_versions',
        limit: LIMITS.contractPins,
      }),
    );
  });

  it('a payload over the byte limit is rejected as a whole', () => {
    const steps = Array.from({ length: 50 }, (_, n) => step(n, 'x'.repeat(LIMITS.planStepChars)));
    expect(agentError(planWith(steps))).toEqual(
      expect.objectContaining({ code: 'payload_too_large', field: 'payload', limit: LIMITS.payloadBytes }),
    );
  });

  it('a command over the byte limit is rejected before parsing', () => {
    const text = JSON.stringify({ ...envelope('feature.create'), pad: 'x'.repeat(LIMITS.commandBytes) });
    expect(validateCommandJson(text, { principal: 'human' })).toMatchObject({
      ok: false,
      error: { code: 'payload_too_large', field: 'command', limit: LIMITS.commandBytes },
    });
  });

  it('a command with too many values is rejected', () => {
    const payload = {
      ...EXAMPLE_PAYLOADS['feature.create'],
      filler: Array.from({ length: LIMITS.maxNodes }, () => 0),
    };
    const result = validateCommand(envelope('feature.create', { payload }), { principal: 'human' });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'payload_too_large', field: 'command', limit: LIMITS.maxNodes },
    });
  });

  it('rejects non-JSON values without throwing', () => {
    const command = envelope('feature.create', {
      payload: { title: 'x', goal: 'y', bad: Number.NaN },
    });
    expect(validateCommand(command, { principal: 'human' }).ok).toBe(false);
    expect(validateCommand(null, { principal: 'human' }).ok).toBe(false);
    expect(validateCommand([1, 2], { principal: 'human' }).ok).toBe(false);
  });
});

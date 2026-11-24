import { describe, expect, it } from 'vitest';

import {
  ERROR_MESSAGES,
  formatId,
  ID_PREFIXES,
  idKind,
  idSchema,
  isId,
  protocolError,
} from '../src/index.js';

describe('ids', () => {
  it('formats, recognises and classifies prefixed IDs', () => {
    const run = formatId('run', 'A1b2C3d4E5');
    expect(run).toBe('run_A1b2C3d4E5');
    expect(isId('run', run)).toBe(true);
    expect(isId('project', run)).toBe(false);
    expect(idKind(run)).toBe('run');
    expect(idSchema('run').safeParse(run).success).toBe(true);
    expect(idSchema('checkout').safeParse(run).success).toBe(false);
  });

  it('rejects bodies that are too short, too long or not alphanumeric', () => {
    expect(() => formatId('run', 'short')).toThrow(TypeError);
    expect(() => formatId('run', 'x'.repeat(65))).toThrow(TypeError);
    expect(() => formatId('run', 'has_underscore1')).toThrow(TypeError);
    expect(idKind('nope_abcdefghij')).toBeUndefined();
    expect(idKind('run_short')).toBeUndefined();
  });

  it('prefixes are unique', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('errors', () => {
  it('every stable code has a human-readable default message', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(10);
      expect(message.endsWith('.'), code).toBe(true);
    }
  });

  it('builds an error with field and limit only when given', () => {
    expect(protocolError('payload_too_large', { field: 'payload.steps', limit: 100 })).toEqual({
      code: 'payload_too_large',
      message: ERROR_MESSAGES.payload_too_large,
      field: 'payload.steps',
      limit: 100,
    });
    expect(protocolError('malformed_json')).toEqual({
      code: 'malformed_json',
      message: ERROR_MESSAGES.malformed_json,
    });
  });
});

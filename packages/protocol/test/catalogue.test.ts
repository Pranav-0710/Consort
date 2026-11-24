import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CATALOGUE,
  COMMAND_PAYLOADS,
  COMMAND_TYPES,
  EXPECTED_VERSION_KEYS,
  PRINCIPAL_KINDS,
  ROLES,
  validateCommand,
} from '../src/index.js';
import { envelope, EXAMPLE_PAYLOADS } from './fixtures.js';

/** Names that would let room state stand in for GitHub review or local client permissions (AC13). */
const FORBIDDEN_NAME = /approv|merge|permission|allowed_?tools|bypass|sandbox|auto_?accept/i;
const FORBIDDEN_FIELDS = [
  'pr_approval',
  'approve_pr',
  'merge',
  'merge_pr',
  'auto_merge',
  'permission_mode',
  'permissions',
  'allowed_tools',
  'bypass_permissions',
  'dangerously_skip_permissions',
];

function propertyNames(schema: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const item of schema) propertyNames(item, into);
  } else if (schema !== null && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties' && value !== null && typeof value === 'object') {
        for (const name of Object.keys(value)) into.add(name);
      }
      propertyNames(value, into);
    }
  }
  return into;
}

describe('command catalogue', () => {
  it('every command type has a catalogue entry', () => {
    expect(Object.keys(CATALOGUE).sort()).toEqual([...COMMAND_TYPES].sort());
    for (const type of COMMAND_TYPES) {
      const entry = CATALOGUE[type];
      expect(entry.principals.length, type).toBeGreaterThan(0);
      for (const principal of entry.principals) expect(PRINCIPAL_KINDS, type).toContain(principal);
      expect(ROLES, type).toContain(entry.minRole);
      for (const key of entry.requiredVersions) expect(EXPECTED_VERSION_KEYS, type).toContain(key);
    }
  });

  it('every command has an example that validates for each allowed principal', () => {
    for (const type of COMMAND_TYPES) {
      for (const principal of CATALOGUE[type].principals) {
        const result = validateCommand(envelope(type, { principal }), { principal });
        expect(result.ok ? 'ok' : result.error, `${type} as ${principal}`).toBe('ok');
      }
    }
  });

  it('a principal kind outside the catalogue entry is refused', () => {
    for (const type of COMMAND_TYPES) {
      for (const principal of PRINCIPAL_KINDS) {
        if (CATALOGUE[type].principals.includes(principal)) continue;
        const result = validateCommand(envelope(type, { principal }), { principal });
        expect(result.ok ? 'ok' : result.error.code, `${type} as ${principal}`).toBe('principal_not_allowed');
      }
    }
  });

  it('no command schema accepts a PR approval, merge or local-permission field', () => {
    for (const type of COMMAND_TYPES) {
      expect(type, 'command name').not.toMatch(FORBIDDEN_NAME);

      const names = propertyNames(z.toJSONSchema(COMMAND_PAYLOADS[type], { unrepresentable: 'any' }));
      for (const name of names) expect(name, `${type} property`).not.toMatch(FORBIDDEN_NAME);

      const principal = CATALOGUE[type].principals[0]!;
      for (const field of FORBIDDEN_FIELDS) {
        const payload = { ...EXAMPLE_PAYLOADS[type], [field]: true };
        const result = validateCommand(envelope(type, { principal, payload }), { principal });
        expect(result.ok ? 'ok' : result.error.code, `${type}.${field}`).toBe('unknown_property');
      }
    }
  });
});

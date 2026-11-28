// Ingress validation: the Worker's first check, before anything reaches a project object.
//
// The principal kind comes from authentication. The project object validates the same bytes
// again before its transaction, so a bypassed or buggy Worker cannot weaken the checks.
import { protocolError, validateCommandJson, type ValidationResult } from '@consort/protocol';

import type { Principal } from '../mutations/principal.js';

export function validateAtIngress(
  commandText: string,
  principal: Principal,
  projectId: string,
): ValidationResult {
  const result = validateCommandJson(commandText, { principal: principal.kind });
  if (result.ok && result.command.envelope.project_id !== projectId) {
    // The URL and the envelope must name the same project; neither can redirect the other.
    return { ok: false, error: protocolError('invalid_envelope', { field: 'project_id' }) };
  }
  return result;
}

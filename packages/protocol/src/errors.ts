// Stable error codes. A code never changes meaning once released: clients branch on the code
// and show the default message, or their own, to people. Messages never echo submitted content.

export const ERROR_MESSAGES = {
  // Raised by validateCommand.
  malformed_json: 'The command is not valid JSON.',
  unsupported_protocol_version:
    'This client speaks a protocol version the coordinator does not support. Update the client.',
  invalid_envelope: 'The command envelope is missing a field or has a field of the wrong type.',
  server_derived_field:
    'This field is set by the coordinator from your credential or run, and cannot be supplied.',
  unknown_property: 'The command contains a property this protocol version does not define.',
  unknown_command: 'This command type is not part of this protocol version.',
  principal_not_allowed: 'This kind of credential cannot send this command.',
  missing_expected_version:
    'This command must name the versions it expects, so a stale decision fails instead of applying.',
  invalid_payload: 'The command payload does not match its schema.',
  payload_too_large: 'Part of the command is larger than the current limit.',
  nesting_too_deep: 'The command is nested more deeply than the current limit.',

  // Raised by the coordinator (#10, #11) while checking a validated command.
  project_not_found: 'No project exists with this ID. Projects are only created explicitly.',
  project_unavailable:
    'The project is temporarily unavailable. Nothing was changed. Try again later, then reconcile.',
  command_unavailable: 'The coordinator does not accept this command yet. Nothing was changed.',
  internal_error: 'The coordinator hit an internal error. Nothing was changed.',
  unknown_reference: 'The command refers to a record that does not exist in this project.',
  not_a_member: 'You are not a current member of this project.',
  not_authorized: 'Your current role or ownership does not allow this command.',
  stale_version: 'The record changed since you last read it. Review the current version and try again.',
  authority_changed:
    'Ownership or membership changed since you last read it. Review who can decide now before retrying.',
  command_window_invalid:
    'The command window has expired or belongs to another session. Reconcile current state first.',
  recovery_epoch_mismatch: 'The project was restored since this command was prepared. Reconnect and refresh.',
  request_id_conflict: 'This request ID was already used with different content.',
  identity_mismatch: 'The connection, run, context generation or checkout does not match its registration.',
  connection_fenced:
    'A newer connection for this run exists. This connection can no longer change run state.',
  cross_project_reference: 'The command refers to a record in another project.',
  outcome_unknown: 'The outcome is not known yet. Query the request before retrying any external action.',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ProtocolError {
  readonly code: ErrorCode;
  readonly message: string;
  /** Dotted path of the offending field, such as `payload.steps.3.text`. */
  readonly field?: string;
  /** The limit that was exceeded, for size and depth errors. */
  readonly limit?: number;
}

export function protocolError(
  code: ErrorCode,
  details: { field?: string | undefined; limit?: number | undefined } = {},
): ProtocolError {
  return {
    code,
    message: ERROR_MESSAGES[code],
    ...(details.field === undefined ? {} : { field: details.field }),
    ...(details.limit === undefined ? {} : { limit: details.limit }),
  };
}

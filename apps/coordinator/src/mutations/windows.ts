// Command windows: short-lived, server-issued permits for sending commands (rule H04, #11).
//
// A window is bound to one principal, that principal's current scope and the project's recovery
// epoch. A command naming a window that is unknown, expired, another principal's, or issued under
// a different scope is refused with command_window_invalid; one issued under an earlier epoch is
// refused with recovery_epoch_mismatch. Neither mutates anything. After expiry the client
// reconciles current state and prepares a new command; an old command is never replayed.
import { protocolError, type CommandWindow } from '@consort/protocol';

import { first, type SqlPort } from '../db/sql.js';

import { Rejection } from './errors.js';
import { newId } from './ids.js';
import { principalKey, type Principal } from './principal.js';
import type { Authority } from './registry.js';

/** True while the durations and limits below are placeholders. #69 sets them from #58's data. */
export const RETRY_LIMITS_ARE_PROVISIONAL = true;

export interface RetryConfig {
  /** How long an issued window accepts commands. */
  readonly windowMs: number;
  /** How long a receipt outlives its window, so a late status query still gets an answer. */
  readonly graceMs: number;
  /** Receipts kept per project. At the limit, new commands are refused; none is evicted early. */
  readonly maxLiveReceipts: number;
  /** Receipts kept per principal, so one member cannot fill the project's limit for everyone. */
  readonly maxLiveReceiptsPerPrincipal: number;
  /** Unexpired windows one principal may hold at once. */
  readonly maxLiveWindowsPerPrincipal: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  windowMs: 15 * 60 * 1000,
  graceMs: 24 * 60 * 60 * 1000,
  maxLiveReceipts: 50_000,
  maxLiveReceiptsPerPrincipal: 5_000,
  maxLiveWindowsPerPrincipal: 16,
};

/**
 * What a window is bound to besides the principal: the scope it was issued under and, for an
 * agent, its verified run. If either changes, the window no longer applies.
 */
export function windowScope(authority: Authority): string {
  const scope = authority.scope;
  const packages =
    scope === undefined ? 'member' : scope === 'project' ? 'project' : [...scope].sort().join(',');
  return authority.run_id === undefined ? `scope:${packages}` : `run:${authority.run_id};scope:${packages}`;
}

export function issueWindow(
  sql: SqlPort,
  input: {
    readonly principal: Principal;
    readonly authority: Authority;
    readonly recoveryEpoch: string;
    readonly now: Date;
    readonly config: RetryConfig;
  },
): CommandWindow {
  const now = input.now.toISOString();
  const key = principalKey(input.principal);
  const live = first(
    sql.exec<{ n: number }>(
      'SELECT count(*) AS n FROM command_windows WHERE principal_key = ? AND expires_at > ?',
      key,
      now,
    ),
  );
  if ((live?.n ?? 0) >= input.config.maxLiveWindowsPerPrincipal) {
    throw new Rejection(protocolError('limit_exceeded', { limit: input.config.maxLiveWindowsPerPrincipal }));
  }
  const window: CommandWindow = {
    command_window_id: newId('command_window'),
    recovery_epoch: input.recoveryEpoch,
    expires_at: new Date(input.now.getTime() + input.config.windowMs).toISOString(),
  };
  sql.exec(
    'INSERT INTO command_windows (id, principal_key, scope, recovery_epoch, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    window.command_window_id,
    key,
    windowScope(input.authority),
    window.recovery_epoch,
    now,
    window.expires_at,
  );
  return window;
}

/** Refuses a command whose window does not hold. Returns the window's expiry and scope. */
export function checkWindow(
  sql: SqlPort,
  input: {
    readonly windowId: string;
    readonly principal: Principal;
    readonly authority: Authority;
    readonly recoveryEpoch: string;
    readonly now: string;
  },
): { readonly expiresAt: string; readonly scope: string } {
  const row = first(
    sql.exec<{ principal_key: string; scope: string; recovery_epoch: string; expires_at: string }>(
      'SELECT principal_key, scope, recovery_epoch, expires_at FROM command_windows WHERE id = ?',
      input.windowId,
    ),
  );
  const field = 'command_window_id';
  // Another principal's window is indistinguishable from an unknown one.
  if (row === undefined || row.principal_key !== principalKey(input.principal)) invalid(field);
  if (row.recovery_epoch !== input.recoveryEpoch) {
    throw new Rejection(protocolError('recovery_epoch_mismatch', { field }));
  }
  if (row.expires_at <= input.now || row.scope !== windowScope(input.authority)) invalid(field);
  return { expiresAt: row.expires_at, scope: row.scope };
}

function invalid(field: string): never {
  throw new Rejection(protocolError('command_window_invalid', { field }));
}

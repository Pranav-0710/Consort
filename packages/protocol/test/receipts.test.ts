import { describe, expect, it } from 'vitest';

import { formatId } from '../src/ids.js';
import { CommandWindowSchema, ReceiptStatusSchema } from '../src/receipts.js';

const REQUEST = formatId('request', 'requestAAAA01');

describe('command windows and receipts', () => {
  it('a window names its ID, the recovery epoch and an expiry, and nothing else', () => {
    const window = {
      command_window_id: formatId('command_window', 'windowAAAA01'),
      recovery_epoch: formatId('recovery_epoch', 'epochAAAAA01'),
      expires_at: '2026-11-28T10:15:00.000Z',
    };
    expect(CommandWindowSchema.parse(window)).toEqual(window);
    expect(CommandWindowSchema.safeParse({ ...window, principal: 'usr_aliceAAAAA01' }).success).toBe(false);
    expect(CommandWindowSchema.safeParse({ ...window, recovery_epoch: 'not-an-epoch' }).success).toBe(false);
  });

  it('an unknown receipt carries nothing but the request ID', () => {
    expect(ReceiptStatusSchema.parse({ request_id: REQUEST, status: 'unknown' })).toEqual({
      request_id: REQUEST,
      status: 'unknown',
    });
    const leaky = { request_id: REQUEST, status: 'unknown', command_type: 'feature.create' };
    expect(ReceiptStatusSchema.safeParse(leaky).success).toBe(false);
  });

  it('a committed receipt names its events and result; a rejected one a known error code', () => {
    const recorded = {
      request_id: REQUEST,
      command_type: 'feature.create',
      recorded_at: '2026-11-28T10:00:00.000Z',
    };
    const committed = { ...recorded, status: 'committed', events: [4, 5], result: {} };
    expect(ReceiptStatusSchema.safeParse(committed).success).toBe(true);
    const rejected = {
      ...recorded,
      status: 'rejected',
      error: { code: 'stale_version', message: 'changed' },
    };
    expect(ReceiptStatusSchema.safeParse(rejected).success).toBe(true);
    const unknownCode = { ...rejected, error: { code: 'no_such_code', message: 'x' } };
    expect(ReceiptStatusSchema.safeParse(unknownCode).success).toBe(false);
    expect(ReceiptStatusSchema.safeParse({ ...committed, command_type: 'not.a_command' }).success).toBe(
      false,
    );
    expect(ReceiptStatusSchema.safeParse({ ...committed, command_type: 'project.init' }).success).toBe(true);
  });
});

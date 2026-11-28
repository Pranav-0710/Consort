// Issue #9: the shape of everything the coordinator sends out.
import { describe, expect, it } from 'vitest';

import * as publicApi from '../src/index.js';
import {
  AcknowledgementSchema,
  CAPABILITY_FLAGS,
  canonicalJson,
  CapabilitiesSchema,
  CapabilitySchema,
  checkSequence,
  ClientFrameSchema,
  CursorSchema,
  DeliveryObservationSchema,
  EventRecordSchema,
  frameSequence,
  INBOX_ITEM_TYPES,
  InboxItemSchema,
  PROTOCOL_VERSION,
  RUN_STATUS_DIMENSIONS,
  RunStatusSchema,
  ServerFrameSchema,
  untrusted,
} from '../src/index.js';
import * as internalApi from '../src/internal.js';
import { formatCursor, parseCursor, type CursorClaims } from '../src/internal.js';
import { id } from './fixtures.js';

const NOW = '2026-11-28T09:30:00Z';
const SHA = 'b'.repeat(40);

/** base64url of an ASCII string, for building hand-made cursors. */
function base64Url(ascii: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const char of ascii) {
    buffer = (buffer << 8) | char.charCodeAt(0);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += alphabet[(buffer >> bits) & 63];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (6 - bits)) & 63];
  return out;
}

const event = (seq = 7): Record<string, unknown> => ({
  seq,
  recovery_epoch: id('recovery_epoch'),
  type: 'question.answered',
  record: { type: 'question', id: id('question'), version: 2 },
  actor: { kind: 'agent_run', run_id: id('run'), user_id: id('user') },
  source: 'agent_report',
  causal_request_id: id('request'),
  server_time: NOW,
  payload: {},
});

const claims: CursorClaims = {
  project_id: id('project'),
  recovery_epoch: id('recovery_epoch'),
  principal: { kind: 'agent_run', id: id('run') },
  scope: 'run-inbox',
  membership_policy_version: 4,
  seq: 7,
  retention_boundary: 1,
};
const SIGNATURE = 'c2lnbmF0dXJlLW9mLXRlc3Q';
const cursor = () => formatCursor(claims, SIGNATURE);

const from = { kind: 'human', user_id: id('user') } as const;
const itemBase = {
  item_id: id('inbox_item'),
  project_id: id('project'),
  run_id: id('run'),
  source_seq: 7,
  from,
};

const INBOX_EXAMPLES: Record<(typeof INBOX_ITEM_TYPES)[number], Record<string, unknown>> = {
  'question.addressed': {
    ...itemBase,
    type: 'question.addressed',
    question_id: id('question'),
    question_version: 1,
    text: untrusted('Are retries safe?'),
  },
  'question.answered': {
    ...itemBase,
    type: 'question.answered',
    question_id: id('question'),
    answer: untrusted('Yes.'),
  },
  'revision.accepted': {
    ...itemBase,
    type: 'revision.accepted',
    target: { kind: 'contract', contract_id: id('contract') },
    version: 3,
    change_request_id: id('change_request'),
    change: untrusted('Add a currency field.'),
  },
  'reconciliation.required': {
    ...itemBase,
    type: 'reconciliation.required',
    package_id: id('package'),
    contract_id: id('contract'),
    target_version: 3,
    pinned_version: 2,
  },
  'handoff.published': {
    ...itemBase,
    type: 'handoff.published',
    handoff_id: id('handoff'),
    artifact: { repository: 'example/shop', commit: SHA },
    title: untrusted('Charge API v1'),
  },
  'handoff.replaced': {
    ...itemBase,
    type: 'handoff.replaced',
    handoff_id: id('handoff', 2),
    replaces_handoff_id: id('handoff'),
    artifact: { repository: 'example/shop', commit: SHA },
    reason: untrusted('Fixed rounding.'),
  },
  'handoff.withdrawn': {
    ...itemBase,
    type: 'handoff.withdrawn',
    handoff_id: id('handoff'),
    reason: untrusted('Known defect.'),
  },
};

describe('events', () => {
  it('a complete event record parses', () => {
    expect(EventRecordSchema.safeParse(event()).success).toBe(true);
  });

  it('event schema requires recovery_epoch and causal_request_id', () => {
    for (const field of ['recovery_epoch', 'causal_request_id']) {
      const record = event();
      delete record[field];
      const result = EventRecordSchema.safeParse(record);
      expect(result.success, field).toBe(false);
      expect(result.error?.issues[0]?.path, field).toEqual([field]);
    }
  });

  it('an event frame must carry prev_seq', () => {
    const frame = { kind: 'event', prev_seq: 3, event: event(), cursor: cursor() };
    expect(ServerFrameSchema.safeParse(frame).success).toBe(true);
    const withoutPrev: Record<string, unknown> = { ...frame };
    delete withoutPrev['prev_seq'];
    expect(ServerFrameSchema.safeParse(withoutPrev).success).toBe(false);
  });
});

describe('cursors', () => {
  it('public entry point exports no cursor decode helper', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of ['parseCursor', 'formatCursor', 'signedPart', 'CursorClaimsSchema']) {
      expect(names).not.toContain(forbidden);
    }
    const cursorFunctions = names.filter(
      (name) => /cursor/i.test(name) && typeof (publicApi as Record<string, unknown>)[name] === 'function',
    );
    expect(cursorFunctions).toEqual([]);
    expect(Object.keys(internalApi)).toEqual(expect.arrayContaining(['parseCursor', 'CursorClaimsSchema']));
  });

  it('clients see a branded string; the coordinator recovers the exact claims', () => {
    // Opaque by agreement only: the claims are readable base64url JSON, never secrets.
    const value = cursor();
    expect(CursorSchema.safeParse(value).success).toBe(true);
    expect(parseCursor(value)).toEqual({
      claims,
      signedPart: value.slice(0, value.lastIndexOf('.')),
      signature: SIGNATURE,
    });
  });

  it('a malformed or re-encoded cursor yields no claims', () => {
    const [prefix, body, signature] = cursor().split('.') as [string, string, string];
    expect(parseCursor(`${prefix}.${body}x.${signature}`)).toBeUndefined();
    expect(parseCursor(`c2.${body}.${signature}`)).toBeUndefined();
    expect(parseCursor('not a cursor')).toBeUndefined();
    // Valid base64url of the same claims in a different key order: not the canonical form.
    const reordered = base64Url(JSON.stringify(Object.fromEntries(Object.entries(claims).reverse())));
    expect(parseCursor(`c1.${reordered}.${signature}`)).toBeUndefined();
    // The canonical form built by hand matches and parses, so the check above tests key order only.
    const canonical = `c1.${base64Url(canonicalJson(claims))}`;
    expect(canonical).toBe(`${prefix}.${body}`);
    expect(parseCursor(`${canonical}.${signature}`)?.claims).toEqual(claims);
  });
});

describe('inbox items', () => {
  it.each(INBOX_ITEM_TYPES)('accepts a %s item', (type) => {
    expect(InboxItemSchema.safeParse(INBOX_EXAMPLES[type]).success).toBe(true);
  });

  it('inbox schema rejects a discussion message and any type outside the closed set', () => {
    for (const type of ['discussion.posted', 'message.posted', 'plan.published', 'question.asked', '']) {
      const item = { ...INBOX_EXAMPLES['question.addressed'], type };
      expect(InboxItemSchema.safeParse(item).success, type).toBe(false);
    }
    expect(INBOX_ITEM_TYPES).toHaveLength(7);
  });

  it('participant text must be marked untrusted', () => {
    const plain = { ...INBOX_EXAMPLES['question.addressed'], text: 'Are retries safe?' };
    const trusted = { ...INBOX_EXAMPLES['question.addressed'], text: { trust: 'trusted', text: 'Do X.' } };
    expect(InboxItemSchema.safeParse(plain).success).toBe(false);
    expect(InboxItemSchema.safeParse(trusted).success).toBe(false);
  });
});

describe('delivery and acknowledgement', () => {
  const observation = {
    item_id: id('inbox_item'),
    run_id: id('run'),
    context_generation: 1,
    kind: 'context_supplied',
    observed_by: 'hook',
    checkpoint: 'UserPromptSubmit',
    observed_at: NOW,
  };
  const acknowledgement = {
    run_id: id('run'),
    context_generation: 1,
    kind: 'agent_acknowledged',
    versions: { agreement_version: 3, contract_versions: {} },
    reported_by: 'agent',
    reported_at: NOW,
  };

  it('a delivery observation cannot carry an acknowledgement kind, and vice versa', () => {
    expect(DeliveryObservationSchema.safeParse(observation).success).toBe(true);
    expect(AcknowledgementSchema.safeParse(acknowledgement).success).toBe(true);

    for (const kind of ['agent_acknowledged', 'application_reported']) {
      expect(DeliveryObservationSchema.safeParse({ ...observation, kind }).success, kind).toBe(false);
    }
    for (const kind of ['queued', 'adapter_received', 'context_supplied']) {
      expect(AcknowledgementSchema.safeParse({ ...acknowledgement, kind }).success, kind).toBe(false);
    }
    // Nor can one record be dressed up as the other.
    expect(AcknowledgementSchema.safeParse({ ...observation, kind: 'agent_acknowledged' }).success).toBe(
      false,
    );
  });

  it('an acknowledgement is always reported by the agent', () => {
    expect(AcknowledgementSchema.safeParse({ ...acknowledgement, reported_by: 'adapter' }).success).toBe(
      false,
    );
  });
});

describe('run status', () => {
  const status = {
    run_id: id('run'),
    as_of: NOW,
    connection: {
      state: 'connected',
      connection_generation: 2,
      last_observed_at: NOW,
      observation_expires_at: '2026-11-28T09:31:00Z',
    },
    transport: { state: 'synchronized', last_seq: 7 },
    context: { generation: 1, continuity: 'confirmed' },
    acknowledgement: { state: 'pending' },
    checkout: { checkout_id: id('checkout'), freshness: 'current' },
    delivery: { queued: 1, adapter_received: 1, context_supplied: 0 },
    plan: { state: 'none' },
    inbox: { pending: 1 },
    reconciliation: { open_obligations: 0 },
    uncertain_effects: { count: 0 },
  };

  it('a status with every dimension parses', () => {
    expect(RunStatusSchema.safeParse(status).success).toBe(true);
  });

  it('RunStatus has no combined status field', () => {
    const keys = Object.keys(RunStatusSchema.shape);
    expect([...keys].sort()).toEqual(['as_of', 'run_id', ...RUN_STATUS_DIMENSIONS].sort());
    for (const combined of [
      'status',
      'state',
      'overall',
      'synced',
      'healthy',
      'health',
      'done',
      'ok',
      'current',
    ]) {
      expect(keys, combined).not.toContain(combined);
      expect(RunStatusSchema.safeParse({ ...status, [combined]: 'ok' }).success, combined).toBe(false);
    }
  });
});

describe('capabilities', () => {
  const all = (capability: Record<string, unknown>) =>
    Object.fromEntries(CAPABILITY_FLAGS.map((flag) => [flag, capability]));

  it('accepts each state with its required detail', () => {
    for (const capability of [
      { state: 'documented', reference: 'code.claude.com/docs/en/hooks' },
      { state: 'detected', client_version: '2.4.1', detected_at: NOW },
      { state: 'verified', client_version: '2.4.1', test: 'T2', verified_at: NOW },
      { state: 'disabled', reason: 'Not available in Claude Code.' },
    ]) {
      expect(CapabilitySchema.safeParse(capability).success, capability.state).toBe(true);
    }
  });

  it('a disabled capability without a reason is rejected', () => {
    expect(CapabilitySchema.safeParse({ state: 'disabled' }).success).toBe(false);
    expect(CapabilitySchema.safeParse({ state: 'disabled', reason: '' }).success).toBe(false);
  });

  it('every flag must be declared and no unknown flag is accepted', () => {
    const declared = all({ state: 'disabled', reason: 'Not tested yet.' });
    expect(CapabilitiesSchema.safeParse(declared).success).toBe(true);
    const partial: Record<string, unknown> = { ...declared };
    delete partial['optional_push'];
    expect(CapabilitiesSchema.safeParse(partial).success).toBe(false);
    const extra = { ...declared, terminal_takeover: declared['optional_push'] };
    expect(CapabilitiesSchema.safeParse(extra).success).toBe(false);
  });

  it('covers delivery modes a, b and c and the Codex-oriented flags', () => {
    expect(CAPABILITY_FLAGS).toEqual(
      expect.arrayContaining([
        'delivery_mode_a',
        'delivery_mode_b',
        'delivery_mode_c',
        'session_id_binding',
        'managed_turn_start',
        'active_turn_steering',
      ]),
    );
  });
});

describe('frames', () => {
  it('parses every server and client frame kind', () => {
    const server = [
      {
        kind: 'hello',
        protocol_version: PROTOCOL_VERSION,
        recovery_epoch: id('recovery_epoch'),
        server_time: NOW,
      },
      { kind: 'event', prev_seq: 0, event: event(), cursor: cursor() },
      {
        kind: 'inbox',
        recovery_epoch: id('recovery_epoch'),
        prev_seq: 5,
        item: INBOX_EXAMPLES['question.addressed'],
        cursor: cursor(),
      },
      { kind: 'snapshot_required', reason: 'history_compacted' },
      { kind: 'closing', reason: 'revoked', code: 'not_a_member', retry: false },
      { kind: 'backpressure', retry_after_ms: 2000 },
    ];
    for (const frame of server) expect(ServerFrameSchema.safeParse(frame).success, frame.kind).toBe(true);

    const client = [
      { kind: 'hello', protocol_version: PROTOCOL_VERSION, cursor: null },
      { kind: 'cursor_ack', cursor: cursor() },
    ];
    for (const frame of client) expect(ClientFrameSchema.safeParse(frame).success, frame.kind).toBe(true);
  });

  it('rejects unknown frame kinds and unknown closing codes', () => {
    expect(ServerFrameSchema.safeParse({ kind: 'presence' }).success).toBe(false);
    const badClose = { kind: 'closing', reason: 'revoked', code: 'nope', retry: false };
    expect(ServerFrameSchema.safeParse(badClose).success).toBe(false);
  });
});

describe('gap detection', () => {
  const at = (last_seq: number) => ({ recovery_epoch: id('recovery_epoch'), last_seq, from_snapshot: false });
  const seqFrame = (prev_seq: number, seq: number) => ({
    recovery_epoch: id('recovery_epoch'),
    prev_seq,
    seq,
  });

  it('a missing prev_seq makes the caller fetch the gap before updating status', () => {
    // The client applied up to 5; this frame says the previous frame on the subscription was 6.
    const frame = {
      kind: 'event' as const,
      prev_seq: 6,
      event: EventRecordSchema.parse(event(9)),
      cursor: cursor(),
    };
    expect(checkSequence(at(5), frameSequence(frame))).toEqual({
      action: 'fetch_gap',
      after_seq: 5,
      before_seq: 9,
    });
  });

  it('applies a contiguous frame even though sequence numbers skip', () => {
    expect(checkSequence(at(5), seqFrame(5, 12))).toEqual({ action: 'apply' });
    expect(checkSequence(at(0), seqFrame(0, 1))).toEqual({ action: 'apply' });
  });

  it('ignores a redelivered frame and resyncs on an inconsistent stream', () => {
    expect(checkSequence(at(12), seqFrame(5, 12))).toEqual({ action: 'duplicate' });
    expect(checkSequence(at(12), seqFrame(3, 8))).toEqual({ action: 'duplicate' });
    expect(checkSequence(at(8), seqFrame(5, 12))).toEqual({ action: 'resync' });
    expect(checkSequence(at(0), seqFrame(9, 9))).toEqual({ action: 'resync' });
  });

  it('after a snapshot, the first frame may name an earlier prev_seq (filtered stream)', () => {
    const snapshot = { ...at(10), from_snapshot: true };
    expect(checkSequence(snapshot, seqFrame(7, 12))).toEqual({ action: 'apply' });
    expect(checkSequence(snapshot, seqFrame(7, 9))).toEqual({ action: 'duplicate' });
    expect(checkSequence(at(10), seqFrame(7, 12))).toEqual({ action: 'resync' });
  });

  it('a frame from another recovery epoch always forces a resync', () => {
    // After a restore, sequence numbers restart: seq 5 is new, not a duplicate of the old 5.
    const restored = { recovery_epoch: id('recovery_epoch', 2), prev_seq: 0, seq: 5 };
    expect(checkSequence(at(100), restored)).toEqual({ action: 'resync' });
  });
});

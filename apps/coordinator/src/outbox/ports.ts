// What the outbox needs from the runtime: a way to reach a run's adapter, and an alarm.
//
// The boundary with #13: the outbox decides what to send and when, and keeps the delivery
// record. The transport owns the sockets. It builds the inbox frame around each item (signed
// cursor included), and it verifies a `cursor_ack` before reporting the acknowledged position
// back through `CoordinatorCore.acknowledgeDelivery`. Until #13 the deployed object has no
// transport, so no run is ever connected and nothing is sent.
import type { InboxItem } from '@consort/protocol';

import type { Principal } from '../mutations/principal.js';

/** One stored inbox item, exactly as it was enqueued. A resend carries the same values. */
export interface OutboxDelivery {
  readonly run_id: string;
  /** The item's position in the run's inbox, assigned once at enqueue (stress C04). */
  readonly seq: number;
  /** The position before it. A cancelled position leaves a gap the client resolves (#13). */
  readonly prev_seq: number;
  readonly recovery_epoch: string;
  readonly item: InboxItem;
}

export interface RunTransport {
  /** Runs that have a live adapter connection now. */
  connectedRuns(): readonly string[];
  /** The authenticated principal of the run's live connection, or undefined when it has none. */
  connection(runId: string): Principal | undefined;
  /**
   * Hands one item to the run's live connection. Returning is not acknowledgement: the item stays
   * `sent` until the adapter's cursor acknowledgement reaches it (rule H05). Throws when the
   * connection is gone.
   */
  send(delivery: OutboxDelivery): void;
}

/** No sockets: every run is offline. The deployed default until #13. */
export const NO_TRANSPORT: RunTransport = {
  connectedRuns: () => [],
  connection: () => undefined,
  send: () => {
    throw new Error('no transport');
  },
};

/** The object's single alarm. Production passes `ctx.storage.setAlarm` and `deleteAlarm`. */
export interface AlarmPort {
  set(atMs: number): void;
  clear(): void;
}

export const NO_ALARM: AlarmPort = { set: () => {}, clear: () => {} };

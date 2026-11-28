// Sequence gap detection for event and inbox frames (stress C07, G03, G04; rule H05).
//
// A subscription sees a filtered stream, so sequence numbers have gaps by design. Each frame
// names the sequence of the previous frame sent on that subscription (`prev_seq`). If that is
// not what the client last applied, it missed something and must fetch the gap, or take a
// snapshot, before it updates any status from this frame.

/** What the client has durably applied on one subscription. */
export interface SequenceState {
  /** The project incarnation the applied state belongs to. */
  readonly recovery_epoch: string;
  /** Last applied sequence: the last frame's, or the snapshot's boundary. 0 before anything. */
  readonly last_seq: number;
  /**
   * True right after loading a snapshot at `last_seq` and before applying any frame. A snapshot
   * boundary is usually not a sequence this filtered subscription ever carried, so the first
   * frame after it may name an earlier `prev_seq`; the snapshot already covers that range.
   */
  readonly from_snapshot: boolean;
}

export type SequenceDecision =
  /** The frame follows directly: apply it, then set `last_seq` and clear `from_snapshot`. */
  | { readonly action: 'apply' }
  /** Already applied (a redelivery): ignore it. */
  | { readonly action: 'duplicate' }
  /** Frames between `after_seq` and `before_seq` are missing: fetch them first. */
  | { readonly action: 'fetch_gap'; readonly after_seq: number; readonly before_seq: number }
  /** The stream disagrees with what was applied, or the project was restored: take a snapshot. */
  | { readonly action: 'resync' };

export function checkSequence(
  state: SequenceState,
  frame: { readonly recovery_epoch: string; readonly prev_seq: number; readonly seq: number },
): SequenceDecision {
  // A restore starts a new incarnation whose sequence numbers restart: never compare across it.
  if (frame.recovery_epoch !== state.recovery_epoch) return { action: 'resync' };
  if (frame.seq <= frame.prev_seq) return { action: 'resync' };
  if (frame.seq <= state.last_seq) return { action: 'duplicate' };
  if (frame.prev_seq === state.last_seq) return { action: 'apply' };
  if (frame.prev_seq > state.last_seq) {
    return { action: 'fetch_gap', after_seq: state.last_seq, before_seq: frame.seq };
  }
  // prev_seq < last_seq < seq.
  if (state.from_snapshot) return { action: 'apply' };
  // Otherwise the client applied something this subscription never sent.
  return { action: 'resync' };
}

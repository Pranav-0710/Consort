// Sequence gap detection for event and inbox frames (stress C07, rule H05).
//
// A subscription sees a filtered stream, so sequence numbers have gaps by design. Each frame
// names the sequence of the previous frame sent on that subscription (`prev_seq`). If that is
// not what the client last applied, it missed something and must fetch the gap, or take a
// snapshot, before it updates any status from this frame.

export type SequenceDecision =
  /** The frame follows directly: apply it. */
  | { readonly action: 'apply' }
  /** Already applied (a redelivery): ignore it. */
  | { readonly action: 'duplicate' }
  /** Frames between `after_seq` and `before_seq` are missing: fetch them first. */
  | { readonly action: 'fetch_gap'; readonly after_seq: number; readonly before_seq: number }
  /** The stream disagrees with what was applied: discard local state and take a snapshot. */
  | { readonly action: 'resync' };

/**
 * Decides what to do with a frame given the last sequence the client durably applied
 * (0 before the first frame of a subscription or after a snapshot at sequence 0).
 */
export function checkSequence(
  lastAppliedSeq: number,
  frame: { readonly prev_seq: number; readonly seq: number },
): SequenceDecision {
  if (frame.seq <= frame.prev_seq) return { action: 'resync' };
  if (frame.seq <= lastAppliedSeq) return { action: 'duplicate' };
  if (frame.prev_seq === lastAppliedSeq) return { action: 'apply' };
  if (frame.prev_seq > lastAppliedSeq) {
    return { action: 'fetch_gap', after_seq: lastAppliedSeq, before_seq: frame.seq };
  }
  // prev_seq < lastApplied < seq: the client applied something this subscription never sent.
  return { action: 'resync' };
}

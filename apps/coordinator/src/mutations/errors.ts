// The refusal type of the mutation path, shared by apply.ts, windows.ts and receipts.ts.
import type { ProtocolError } from '@consort/protocol';

/** A refusal raised inside the transaction. Throwing it is what rolls the writes back. */
export class Rejection extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.code);
    this.name = 'Rejection';
  }
}

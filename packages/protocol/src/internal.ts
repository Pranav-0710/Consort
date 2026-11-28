// @consort/protocol/internal: for the coordinator only (#13). Clients must treat cursors as
// opaque strings and never read their claims (stress E04). Lint does not yet stop a client
// importing this entry point; review does.
export { CursorClaimsSchema, formatCursor, parseCursor, signedPart, type CursorClaims } from './cursor.js';

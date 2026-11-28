// @consort/protocol: the command shape, catalogue and validator (#8), the shape of
// everything the coordinator sends out (#9), and command windows and receipts (#11). Shared
// by the web client, the adapter and the coordinator. Runtime-neutral: no Node built-ins, DOM
// or Cloudflare.
//
// Cursor claims are deliberately absent: clients see only the opaque `Cursor` string. The
// coordinator reads claims through `@consort/protocol/internal` (stress E04).
export * from './capabilities.js';
export * from './catalogue.js';
export * from './commands/index.js';
export { CursorSchema, type Cursor } from './cursor.js';
export * from './delivery.js';
export * from './envelope.js';
export * from './errors.js';
export * from './events.js';
export * from './frames.js';
export * from './gap.js';
export * from './hash.js';
export * from './identity.js';
export * from './ids.js';
export * from './inbox.js';
export * from './limits.js';
export * from './receipts.js';
export * from './status.js';
export * from './validate.js';
export * from './version.js';

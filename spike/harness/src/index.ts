// Throwaway capability-spike harness (#4). Nothing outside spike/ may import this package; the
// runnable parts are the relay, MCP server, hook script and CLIs described in spike/README.md.
export { loadConfig, type HarnessConfig, type HookEvent } from './config.js';
export { redact } from './redact.js';
export { ItemStore, type Item, type Observation } from './relay/store.js';

// Spike relay: a tiny HTTP service over the durable ItemStore.
//   npm run relay -w @consort/spike-harness
// Binds to 127.0.0.1 by default. Binding anywhere else requires a token (SPIKE_TOKEN or
// SPIKE_TOKEN_FILE); clients send it as "Authorization: Bearer <token>".
import { createServer } from 'node:http';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { bindProblem, createRelayHandler } from './app.js';
import { ItemStore } from './store.js';

const cfg = loadConfig();
const host = process.env['SPIKE_RELAY_HOST'] ?? '127.0.0.1';
const port = Number(process.env['SPIKE_RELAY_PORT'] ?? '47300');
const problem = bindProblem(host, port, cfg.token);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const store = new ItemStore(process.env['SPIKE_RELAY_STORE'] ?? path.join(cfg.logDir, 'relay-items.jsonl'));
if (store.skippedTornLine) console.error('relay store ended in an incomplete line; it was ignored.');

createServer(createRelayHandler({ cfg, store, host, port })).listen(port, host, () => {
  console.log(`spike relay on http://${host}:${port}${cfg.token ? ' (token required)' : ''}`);
});

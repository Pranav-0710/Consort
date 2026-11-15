// Append-only JSONL logs under the harness log dir (default spike/harness/raw/, which git ignores).
// Every line is redacted before it is written. Logging never throws into the caller.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { HarnessConfig } from './config.js';
import { redact } from './redact.js';

export type LogStream = 'hooks' | 'mcp' | 'relay' | 'errors';

export function logEvent(cfg: HarnessConfig, stream: LogStream, record: Record<string, unknown>): void {
  try {
    mkdirSync(cfg.logDir, { recursive: true });
    const line = redact(
      JSON.stringify({ at: new Date().toISOString(), participant: cfg.participant, ...record }),
    );
    appendFileSync(path.join(cfg.logDir, `${stream}.jsonl`), `${line}\n`);
  } catch {
    // A logging failure must not change hook or tool behaviour.
  }
}

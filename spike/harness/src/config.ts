// Harness settings come only from environment variables, so testers never edit code.
// See spike/README.md for every variable. Defaults are harness settings, not product targets.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** spike/harness (one level above dist/ or src/). */
export const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

export interface HarnessConfig {
  /** Name this side uses as sender and addressee, e.g. "A" or "B". */
  participant: string;
  relayUrl: string;
  token: string | undefined;
  /** Hooks give up and fail open after this long. */
  hookDeadlineMs: number;
  /** Hook events that may return pending items as additionalContext (option a). Empty means observe only. */
  deliverOn: ReadonlySet<HookEvent>;
  /** Option (b): the Stop hook may block once to deliver pending items. Off unless set. */
  stopDelivery: boolean;
  stopMaxPerSession: number;
  /** Option (c): register the blocking spike_listen tool. Off unless set. */
  listenEnabled: boolean;
  listenMaxSeconds: number;
  logDir: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function positiveInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

function flag(name: string): boolean {
  const raw = env(name)?.toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function loadConfig(): HarnessConfig {
  const tokenFile = env('SPIKE_TOKEN_FILE');
  const token = env('SPIKE_TOKEN') ?? (tokenFile ? readFileSync(tokenFile, 'utf8').trim() : undefined);
  const deliverOn = new Set(
    (env('SPIKE_DELIVER_ON') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(isHookEvent),
  );
  return {
    participant: env('SPIKE_PARTICIPANT') ?? 'unnamed',
    relayUrl: env('SPIKE_RELAY_URL') ?? 'http://127.0.0.1:47300',
    token,
    hookDeadlineMs: positiveInt('SPIKE_HOOK_DEADLINE_MS', 1500),
    deliverOn,
    stopDelivery: flag('SPIKE_STOP_DELIVERY'),
    stopMaxPerSession: positiveInt('SPIKE_STOP_MAX_PER_SESSION', 1),
    listenEnabled: flag('SPIKE_ENABLE_LISTEN'),
    listenMaxSeconds: positiveInt('SPIKE_LISTEN_MAX_SECONDS', 120),
    logDir: env('SPIKE_LOG_DIR') ?? path.join(HARNESS_ROOT, 'raw'),
  };
}

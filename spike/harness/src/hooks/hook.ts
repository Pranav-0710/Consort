// One hook script for all four events: node dist/hooks/hook.js <SessionStart|UserPromptSubmit|PostToolUse|Stop>
// Always logs the redacted stdin payload. Delivers pending items only when configured:
//   option (a): SPIKE_DELIVER_ON lists events that return items as additionalContext
//   option (b): SPIKE_STOP_DELIVERY lets Stop block once per stop cycle, up to SPIKE_STOP_MAX_PER_SESSION
// Fails open: on error or after SPIKE_HOOK_DEADLINE_MS it prints nothing and exits 0.
import { isHookEvent, loadConfig, type HarnessConfig, type HookEvent } from '../config.js';
import { formatPendingItems } from '../format.js';
import { logEvent } from '../log.js';
import { RelayClient } from '../relay/client.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function decide(cfg: HarnessConfig, event: HookEvent): Promise<object | undefined> {
  const raw = await readStdin();
  const payload = (raw.trim() ? JSON.parse(raw) : {}) as Record<string, unknown>;
  const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : 'unknown';
  logEvent(cfg, 'hooks', { event, sessionId, payload });

  const isStop = event === 'Stop';
  if (isStop ? !cfg.stopDelivery : !cfg.deliverOn.has(event)) return undefined;
  if (isStop && payload['stop_hook_active'] === true) return undefined;

  const relay = new RelayClient(cfg, cfg.hookDeadlineMs);
  if (isStop) {
    const all = await relay.list({ to: cfg.participant });
    const stopDeliveries = new Set(
      all.flatMap((item) =>
        item.observations
          .filter((o) => o.type === 'context_supplied' && o.hookEvent === 'Stop' && o.sessionId === sessionId)
          .map((o) => o.at),
      ),
    ).size;
    if (stopDeliveries >= cfg.stopMaxPerSession) return undefined;
  }

  const items = await relay.list({ to: cfg.participant, pending: true, notSuppliedTo: sessionId });
  if (items.length === 0) return undefined;

  const text = formatPendingItems(cfg.participant, items);
  for (const item of items)
    await relay.observe(item.id, { type: 'context_supplied', sessionId, hookEvent: event });
  logEvent(cfg, 'hooks', { event, sessionId, supplied: items.map((i) => `${i.id}@v${i.version}`) });

  return isStop
    ? { decision: 'block', reason: text }
    : { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const event = process.argv[2] ?? '';
  if (!isHookEvent(event)) {
    logEvent(cfg, 'errors', { where: 'hook', message: `unknown hook event "${event}"` });
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), cfg.hookDeadlineMs);
  });
  try {
    const outcome = await Promise.race([decide(cfg, event), deadline]);
    if (outcome === 'deadline') {
      logEvent(cfg, 'errors', {
        where: 'hook',
        event,
        message: `deadline ${cfg.hookDeadlineMs}ms reached; failing open`,
      });
    } else if (outcome !== undefined) {
      process.stdout.write(JSON.stringify(outcome));
    }
  } catch (error) {
    logEvent(cfg, 'errors', {
      where: 'hook',
      event,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

main().finally(() => process.exit(0));

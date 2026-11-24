// One hook script for all four events: node dist/hooks/hook.js <SessionStart|UserPromptSubmit|PostToolUse|Stop>
// Always logs the redacted stdin payload. Delivers pending items only when configured:
//   option (a): SPIKE_DELIVER_ON lists events that return items as additionalContext
//   option (b): SPIKE_STOP_DELIVERY lets Stop block once per stop cycle, up to SPIKE_STOP_MAX_PER_SESSION
// Fails open: on error or after SPIKE_HOOK_DEADLINE_MS it prints nothing and exits 0.
// "Context supplied" is recorded only after the output has been flushed to stdout.
import { isHookEvent, loadConfig, type HarnessConfig, type HookEvent } from '../config.js';
import { logEvent } from '../log.js';
import { RelayClient } from '../relay/client.js';
import { planDelivery, withDeadline, type Delivery } from './decide.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

interface Decision {
  sessionId: string;
  delivery: Delivery | undefined;
}

async function decide(cfg: HarnessConfig, event: HookEvent, relay: RelayClient): Promise<Decision> {
  const raw = await readStdin();
  const payload = (raw.trim() ? JSON.parse(raw) : {}) as Record<string, unknown>;
  const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : 'unknown';
  logEvent(cfg, 'hooks', { event, sessionId, payload });
  return { sessionId, delivery: await planDelivery(cfg, event, payload, relay) };
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const event = process.argv[2] ?? '';
  if (!isHookEvent(event)) {
    logEvent(cfg, 'errors', { where: 'hook', message: `unknown hook event "${event}"` });
    return;
  }
  const relay = new RelayClient(cfg, cfg.hookDeadlineMs);
  let delivered = false;
  try {
    const outcome = await withDeadline(decide(cfg, event, relay), cfg.hookDeadlineMs);
    if (outcome === 'deadline') {
      logEvent(cfg, 'errors', {
        where: 'hook',
        event,
        message: `deadline ${cfg.hookDeadlineMs}ms reached; failing open, nothing supplied`,
      });
      return;
    }
    const { sessionId, delivery } = outcome;
    if (!delivery) return;

    await writeStdout(JSON.stringify(delivery.output));
    delivered = true;
    for (const item of delivery.items)
      await relay.observe(item.id, {
        type: 'context_supplied',
        sessionId,
        hookEvent: event,
        detail: delivery.deliveryId,
      });
    logEvent(cfg, 'hooks', {
      event,
      sessionId,
      deliveryId: delivery.deliveryId,
      supplied: delivery.items.map((i) => `${i.id}@v${i.version}`),
    });
  } catch (error) {
    logEvent(cfg, 'errors', {
      where: 'hook',
      event,
      delivered,
      message: error instanceof Error ? error.message : String(error),
      ...(delivered ? { note: 'output was written but the context_supplied observation is incomplete' } : {}),
    });
  }
}

// Exit only after stdout has flushed (writeStdout waits for its callback).
main().finally(() => process.exit(0));

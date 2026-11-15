// Spike MCP server (stdio). Register it in project-local Claude Code settings; see spike/README.md.
// Tools: spike_whoami, spike_read_inbox, spike_ask, spike_answer, spike_ack, and spike_listen
// (only when SPIKE_ENABLE_LISTEN is set). Every call is logged, redacted, to raw/mcp.jsonl.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { logEvent } from '../log.js';
import { RelayClient } from '../relay/client.js';
import type { Item } from '../relay/store.js';

const cfg = loadConfig();
const relay = new RelayClient(cfg, 10_000);

/** Names only: values of CLAUDE_* variables may be credentials and are never read or logged. */
function claudeEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((name) => name.startsWith('CLAUDE'))
    .sort();
}

function whoami() {
  const sessionId = process.env['CLAUDE_CODE_SESSION_ID'];
  return {
    participant: cfg.participant,
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    claudeCodeSessionId: { present: sessionId !== undefined, value: sessionId ?? null },
    claudeEnvVarNames: claudeEnvNames(),
    listenEnabled: cfg.listenEnabled,
  };
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function run(tool: string, args: unknown, fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await fn();
    logEvent(cfg, 'mcp', { tool, args, result });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent(cfg, 'mcp', { tool, args, error: message });
    return { content: [{ type: 'text', text: `error: ${message}` }], isError: true };
  }
}

const summary = (item: Item) => ({
  id: item.id,
  version: item.version,
  kind: item.kind,
  from: item.from,
  to: item.to,
  body: item.body,
  ...(item.replyTo ? { replyTo: item.replyTo } : {}),
});

const server = new McpServer({ name: 'consort-spike', version: '0.0.0' });

server.registerTool(
  'spike_whoami',
  {
    description: 'Report this MCP server process: pid, ppid, cwd and whether CLAUDE_CODE_SESSION_ID is set.',
  },
  () => run('spike_whoami', {}, () => Promise.resolve(whoami())),
);

server.registerTool(
  'spike_read_inbox',
  { description: 'List items addressed to this participant that are not yet acknowledged or answered.' },
  () =>
    run('spike_read_inbox', {}, async () => {
      const items = await relay.list({ to: cfg.participant, pending: true });
      for (const item of items) await relay.observe(item.id, { type: 'read_via_tool' });
      return items.map(summary);
    }),
);

server.registerTool(
  'spike_ask',
  {
    description: 'Ask another participant a question. Returns the question id.',
    inputSchema: { to: z.string().min(1), body: z.string().min(1) },
  },
  (args) => run('spike_ask', args, async () => summary(await relay.create({ kind: 'question', ...args }))),
);

server.registerTool(
  'spike_answer',
  {
    description: 'Answer a question addressed to this participant.',
    inputSchema: { question_id: z.string().min(1), body: z.string().min(1) },
  },
  (args) =>
    run('spike_answer', args, async () => {
      const question = await relay.get(args.question_id);
      if (question.kind !== 'question')
        throw new Error(`item ${question.id} is a ${question.kind}, not a question`);
      if (question.to !== cfg.participant)
        throw new Error(`question ${question.id} is addressed to ${question.to}`);
      const answer = await relay.create({
        kind: 'answer',
        to: question.from,
        body: args.body,
        replyTo: question.id,
      });
      await relay.observe(question.id, { type: 'answered', detail: `answer ${answer.id}` });
      return summary(answer);
    }),
);

server.registerTool(
  'spike_ack',
  {
    description: 'Acknowledge an item and the exact version you recognised.',
    inputSchema: {
      item_id: z.string().min(1),
      version: z.number().int().positive(),
      note: z.string().optional(),
    },
  },
  (args) =>
    run('spike_ack', args, async () => {
      const item = await relay.get(args.item_id);
      const detail = `version ${args.version}${args.version === item.version ? '' : ` (current is ${item.version})`}${
        args.note ? `: ${args.note}` : ''
      }`;
      return summary(await relay.observe(args.item_id, { type: 'acked', detail }));
    }),
);

if (cfg.listenEnabled) {
  server.registerTool(
    'spike_listen',
    {
      description: `Wait until an item addressed to this participant arrives, up to ${cfg.listenMaxSeconds} seconds.`,
      inputSchema: { timeout_seconds: z.number().int().positive() },
    },
    (args) =>
      run('spike_listen', args, async () => {
        const deadline = Date.now() + Math.min(args.timeout_seconds, cfg.listenMaxSeconds) * 1000;
        while (Date.now() < deadline) {
          const items = await relay.list({ to: cfg.participant, pending: true });
          if (items.length > 0) return { timedOut: false, items: items.map(summary) };
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return { timedOut: true, items: [] };
      }),
  );
}

logEvent(cfg, 'mcp', { event: 'server_start', whoami: whoami() });
await server.connect(new StdioServerTransport());

// Spike relay: a tiny HTTP service over the durable ItemStore.
//   npm run relay -w @consort/spike-harness
// Binds to 127.0.0.1 by default. Binding anywhere else requires a token (SPIKE_TOKEN or
// SPIKE_TOKEN_FILE); clients send it as "Authorization: Bearer <token>".
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { logEvent } from '../log.js';
import { ItemStore, type ItemKind, type ObservationType } from './store.js';

const MAX_BODY_BYTES = 64 * 1024;
const KINDS: readonly ItemKind[] = ['question', 'answer', 'update'];
const OBSERVATIONS: readonly ObservationType[] = ['context_supplied', 'read_via_tool', 'acked', 'answered'];

const cfg = loadConfig();
const host = process.env['SPIKE_RELAY_HOST'] ?? '127.0.0.1';
const port = Number.parseInt(process.env['SPIKE_RELAY_PORT'] ?? '47300', 10);
const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
if (!isLoopback && !cfg.token) {
  console.error(`Refusing to bind ${host} without a token. Set SPIKE_TOKEN or SPIKE_TOKEN_FILE.`);
  process.exit(1);
}
const store = new ItemStore(process.env['SPIKE_RELAY_STORE'] ?? path.join(cfg.logDir, 'relay-items.jsonl'));

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function authorized(req: IncomingMessage): boolean {
  if (!cfg.token) return true;
  const header = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${cfg.token}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function str(body: Record<string, unknown>, key: string, required: true): string;
function str(body: Record<string, unknown>, key: string, required: false): string | undefined;
function str(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value === '')
    throw new HttpError(400, `"${key}" must be a non-empty string`);
  return value;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://relay');
  const participant = req.headers['x-spike-participant'];
  const from = typeof participant === 'string' && participant ? participant : 'unknown';
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if (!authorized(req)) throw new HttpError(401, 'missing or wrong token');

  if (parts[0] === 'items' && parts.length === 1) {
    if (req.method === 'GET') {
      const to = url.searchParams.get('to') ?? undefined;
      const notSuppliedTo = url.searchParams.get('notSuppliedTo') ?? undefined;
      return send(
        res,
        200,
        store.list({
          ...(to === undefined ? {} : { to }),
          pending: url.searchParams.get('pending') === '1',
          ...(notSuppliedTo === undefined ? {} : { notSuppliedTo }),
        }),
      );
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const kind = str(body, 'kind', true) as ItemKind;
      if (!KINDS.includes(kind)) throw new HttpError(400, `"kind" must be one of ${KINDS.join(', ')}`);
      const replyTo = str(body, 'replyTo', false);
      const version = body['version'];
      const item = store.create({
        kind,
        from,
        to: str(body, 'to', true),
        body: str(body, 'body', true),
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(typeof version === 'number' && Number.isInteger(version) && version > 0 ? { version } : {}),
      });
      logEvent(cfg, 'relay', { op: 'create', id: item.id, kind, from, to: item.to });
      return send(res, 201, item);
    }
  }

  if (parts[0] === 'items' && parts[1] && parts.length === 2 && req.method === 'GET') {
    const item = store.get(parts[1]);
    if (!item) throw new HttpError(404, 'no such item');
    return send(res, 200, item);
  }

  if (parts[0] === 'items' && parts[1] && parts[2] === 'observations' && req.method === 'POST') {
    const body = await readJson(req);
    const type = str(body, 'type', true) as ObservationType;
    if (!OBSERVATIONS.includes(type))
      throw new HttpError(400, `"type" must be one of ${OBSERVATIONS.join(', ')}`);
    const sessionId = str(body, 'sessionId', false);
    const hookEvent = str(body, 'hookEvent', false);
    const detail = str(body, 'detail', false);
    const item = store.observe(parts[1], {
      type,
      by: from,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(hookEvent === undefined ? {} : { hookEvent }),
      ...(detail === undefined ? {} : { detail }),
    });
    if (!item) throw new HttpError(404, 'no such item');
    logEvent(cfg, 'relay', { op: 'observe', id: item.id, type, by: from, sessionId, hookEvent });
    return send(res, 200, item);
  }

  throw new HttpError(404, 'no such route');
}

createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 500) logEvent(cfg, 'errors', { where: 'relay', message });
    send(res, status, { error: message });
  });
}).listen(port, host, () => {
  console.log(`spike relay on http://${host}:${port}${cfg.token ? ' (token required)' : ''}`);
});

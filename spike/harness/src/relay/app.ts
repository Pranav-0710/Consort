// Request handling for the spike relay, separate from process start-up so it can be tested.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

import type { HarnessConfig } from '../config.js';
import { logEvent } from '../log.js';
import type { ItemKind, ItemStore, ObservationType } from './store.js';

export const MAX_BODY_BYTES = 64 * 1024;
const KINDS: readonly ItemKind[] = ['question', 'answer', 'update'];
const OBSERVATIONS: readonly ObservationType[] = ['context_supplied', 'read_via_tool', 'acked', 'answered'];

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** Returns an error message when the relay must refuse to start with these settings. */
export function bindProblem(host: string, port: number, token: string | undefined): string | undefined {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return `Invalid port "${port}".`;
  if (!isLoopbackHost(host) && !token)
    return `Refusing to bind ${host} without a token. Set SPIKE_TOKEN or SPIKE_TOKEN_FILE.`;
  return undefined;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export interface RelayOptions {
  cfg: HarnessConfig;
  store: ItemStore;
  host: string;
  port: number;
}

export function createRelayHandler({ cfg, store, host, port }: RelayOptions): RequestListener {
  // On loopback, accept only requests addressed to loopback names. A web page the tester visits
  // can reach 127.0.0.1, but through DNS rebinding its Host header names the attacker's domain.
  const allowedHosts = isLoopbackHost(host)
    ? new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
    : undefined;

  function authorized(req: IncomingMessage): boolean {
    if (!cfg.token) return true;
    // Compare fixed-length digests so neither the token nor its length leaks through timing.
    return timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${cfg.token}`));
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    // Requiring JSON forces a CORS preflight on browser requests, which this relay never answers.
    const type = req.headers['content-type'] ?? '';
    if (!type.toLowerCase().startsWith('application/json'))
      throw new HttpError(415, 'content-type must be application/json');
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
    if (allowedHosts && !allowedHosts.has(req.headers.host ?? ''))
      throw new HttpError(421, 'unexpected Host header');
    const url = new URL(req.url ?? '/', 'http://relay');
    // Self-reported by the client. Fine for a spike between trusting testers; the product
    // derives identity from authenticated credentials instead.
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
        const clientId = str(body, 'clientId', false);
        const version = body['version'];
        // A client that timed out and retries with the same clientId gets the original item back.
        const existing = clientId === undefined ? undefined : store.findByClientId(from, clientId);
        if (existing) {
          logEvent(cfg, 'relay', { op: 'create_replayed', id: existing.id, kind, from, to: existing.to });
          return send(res, 200, existing);
        }
        const item = store.create({
          kind,
          from,
          to: str(body, 'to', true),
          body: str(body, 'body', true),
          ...(replyTo === undefined ? {} : { replyTo }),
          ...(clientId === undefined ? {} : { clientId }),
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

  return (req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 500) logEvent(cfg, 'errors', { where: 'relay', message });
      send(res, status, { error: message });
    });
  };
}

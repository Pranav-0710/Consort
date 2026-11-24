import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { bindProblem, createRelayHandler, MAX_BODY_BYTES } from './app.js';
import { ItemStore } from './store.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spike-relay-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function startRelay(token?: string): Promise<{ port: number; store: ItemStore }> {
  const dir = tempDir();
  const store = new ItemStore(path.join(dir, 'items.jsonl'));
  // The port is known only after listen, so the handler is attached once it is.
  const holder: { handler?: RequestListener } = {};
  const server = createServer((req, res) => holder.handler?.(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const cfg = { ...loadConfig(), logDir: dir, token };
  holder.handler = createRelayHandler({ cfg, store, host: '127.0.0.1', port });
  cleanups.push(() => server.close());
  return { port, store };
}

function call(
  port: number,
  method: string,
  pathname: string,
  opts: { body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, ...opts.headers };
    const req = request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const json = { 'content-type': 'application/json' };
const newItem = JSON.stringify({ kind: 'question', to: 'B', body: 'Are retries safe?' });

describe('relay', () => {
  it('refuses a non-loopback bind without a token, and a bad port', () => {
    expect(bindProblem('0.0.0.0', 47300, undefined)).toMatch(/without a token/);
    expect(bindProblem('0.0.0.0', 47300, 'secret')).toBeUndefined();
    expect(bindProblem('127.0.0.1', Number('abc'), undefined)).toMatch(/Invalid port/);
  });

  it('answers 401 without the right token', async () => {
    const { port } = await startRelay('right-token');
    const wrong = { authorization: 'Bearer wrong' };
    const right = { authorization: 'Bearer right-token' };
    expect((await call(port, 'GET', '/items')).status).toBe(401);
    expect((await call(port, 'GET', '/items', { headers: wrong })).status).toBe(401);
    expect((await call(port, 'GET', '/items', { headers: right })).status).toBe(200);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const { port } = await startRelay();
    const reply = await call(port, 'GET', '/items', { headers: { host: 'attacker.example:80' } });
    expect(reply.status).toBe(421);
  });

  it('rejects a non-JSON POST, which a browser could send without a preflight', async () => {
    const { port } = await startRelay();
    const headers = { 'content-type': 'text/plain' };
    expect((await call(port, 'POST', '/items', { body: newItem, headers })).status).toBe(415);
  });

  it('answers 413 for an oversized body', async () => {
    const { port } = await startRelay();
    const body = JSON.stringify({ kind: 'question', to: 'B', body: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await call(port, 'POST', '/items', { body, headers: json })).status).toBe(413);
  });

  it('a retried create with the same clientId returns the original item', async () => {
    const { port, store } = await startRelay();
    const body = JSON.stringify({ kind: 'question', to: 'B', body: 'q', clientId: 'c-1' });
    const headers = { ...json, 'x-spike-participant': 'A' };
    const first = await call(port, 'POST', '/items', { body, headers });
    const second = await call(port, 'POST', '/items', { body, headers });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((JSON.parse(second.body) as { id: string }).id).toBe(
      (JSON.parse(first.body) as { id: string }).id,
    );
    expect(store.list({ to: 'B' })).toHaveLength(1);
  });
});

describe('ItemStore recovery', () => {
  it('ignores a torn last line but keeps every complete entry', () => {
    const file = path.join(tempDir(), 'items.jsonl');
    const kept = new ItemStore(file).create({ kind: 'question', from: 'A', to: 'B', body: 'kept' });
    appendFileSync(file, '{"op":"create","item":{"id":"torn');

    const reopened = new ItemStore(file);
    expect(reopened.skippedTornLine).toBe(true);
    expect(reopened.get(kept.id)?.body).toBe('kept');
  });

  it('refuses to load when a line before the last is corrupt', () => {
    const file = path.join(tempDir(), 'items.jsonl');
    appendFileSync(file, 'not json\n');
    appendFileSync(file, `${JSON.stringify({ op: 'observe', id: 'x', observation: {} })}\n`);
    expect(() => new ItemStore(file)).toThrow();
  });
});

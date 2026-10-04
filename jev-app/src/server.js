// HTTP surface.
//   POST /api/ask         -> one JSON response: final output + all three Jev decisions
//   POST /api/ask/stream  -> NDJSON of pipeline events as each decision resolves
//   GET  /api/health
//   GET  /                -> UI

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Orchestrator } from './orchestrator.js';
import { makeJev } from './jev.js';
import { GuardedJev, startCanary } from './guard.js';
import { makeEngine } from './engine.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY = 16 * 1024;

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function parseAsk(body) {
  if (typeof body.input !== 'string' || !body.input.trim()) throw Object.assign(new Error('input is required'), { status: 400 });
  const history = Array.isArray(body.history) ? body.history.filter((t) => t && typeof t.text === 'string').slice(-3) : [];
  return { input: body.input, history, meta: { plan: body.plan } };
}

export function createApp({ orchestrator }) {
  return http.createServer(async (req, res) => {
    const send = (code, obj, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
    };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const j = orchestrator.jev;
        const degraded = j.state === 'open' || j.canary?.ok === false;
        return send(degraded ? 503 : 200, { ok: !degraded, jev: j.source, breaker: j.state ?? 'n/a', canary: j.canary ?? null, engine: orchestrator.engine.mode, queue: orchestrator.queue.stats });
      }
      if (req.method === 'POST' && url.pathname === '/api/ask') {
        return send(200, await orchestrator.handle(parseAsk(await readJson(req))));
      }
      if (req.method === 'POST' && url.pathname === '/api/ask/stream') {
        const ask = parseAsk(await readJson(req));
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        await orchestrator.handle(ask, (ev) => res.write(JSON.stringify(ev) + '\n'));
        return res.end();
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(200, await readFile(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
      }
      send(404, { error: 'not found' });
    } catch (e) {
      if (res.headersSent) return res.end();
      send(e.status ?? 500, { error: e.status ? e.message : 'internal error' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const jev = new GuardedJev(await makeJev());
  const orchestrator = new Orchestrator({ jev, engine: makeEngine() });
  const { first } = startCanary(jev, { everyMs: Number(process.env.CANARY_INTERVAL_MS) || 60_000, onResult: (r) => !r.ok && console.error('CANARY FAILED — breaker open, failing closed:', r.failures) });
  first.then((r) => console.log(`canary: ${r.ok ? 'pass' : 'FAIL ' + r.failures.join('; ')}`));
  const port = Number(process.env.PORT) || 8787;
  createApp({ orchestrator }).listen(port, () =>
    console.log(`coachdesk on :${port}  jev=${orchestrator.jev.source} engine=${orchestrator.engine.mode}`),
  );
}

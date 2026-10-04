// Jev client. One entry point, `decide`, used by the orchestrator for all three decision
// points. Adapters:
//   HttpJev – a real Jev endpoint (JEV_URL). The wire contract below is an ASSUMPTION: this
//             repo had no Jev client or docs, so adjust `HttpJev` if the real API differs.
//   SimJev  – local deterministic stand-in (src/jev-sim.js). NOT Jev. For development, tests
//             and the logged results; every response is tagged source:"sim".
//
// Wire contract (HttpJev):
//   POST {JEV_URL}/decide
//   { schema: "intake"|"routing"|"gate", fields: <schema.fields>, state: <snapshot>, candidate?: string }
//   -> { answer: {...typed...}, field_confidence: { <field>: 0..1 } }

import { performance } from 'node:perf_hooks';
import { SCHEMAS, validateReply } from './schemas.js';
import { CONFIG } from './config.js';

export class JevUnavailable extends Error {}

export class HttpJev {
  source = 'jev';
  constructor({ url, apiKey, fetchImpl = fetch } = {}) {
    this.url = url;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }
  async raw(schema, state, candidate, signal) {
    const res = await this.fetch(`${this.url.replace(/\/$/, '')}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey && { authorization: `Bearer ${this.apiKey}` }) },
      body: JSON.stringify({ schema: schema.name, fields: schema.fields, state, ...(candidate !== undefined && { candidate }) }),
      signal,
    });
    if (!res.ok) throw new JevUnavailable(`Jev HTTP ${res.status}`);
    return res.json();
  }
}

/**
 * Run one Jev decision. Always resolves to a validated decision or rejects with
 * JevUnavailable (timeout, transport, malformed or out-of-schema reply). The orchestrator
 * maps every rejection to a fail-closed fallback; nothing downstream sees an invalid answer.
 */
export async function decide(adapter, schemaName, state, { candidate, timeoutMs = CONFIG.JEV_TIMEOUT_MS } = {}) {
  const schema = SCHEMAS[schemaName];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const reply = await Promise.race([
      adapter.raw(schema, state, candidate, ac.signal),
      new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error(`timeout after ${timeoutMs}ms`)))),
    ]);
    const v = validateReply(schema, reply);
    return { decision: schemaName, ...v, latency_ms: Math.round(performance.now() - t0), source: adapter.source };
  } catch (e) {
    throw new JevUnavailable(`${schemaName}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function makeJev(env = process.env) {
  if (env.JEV_URL) return new HttpJev({ url: env.JEV_URL, apiKey: env.JEV_API_KEY });
  const { SimJev } = await import('./jev-sim.js');
  return new SimJev();
}

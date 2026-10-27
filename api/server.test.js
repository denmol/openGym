// The server end to end: a real process, a stand-in for the model, a forged session cookie.
// What this proves that the unit tests cannot: the AI cap and the quality counts survive the
// round trip through the store, are shared between two instances, and the admin view reads them.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const free = () => new Promise(res => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-e2e-'));
const SECRET = 'a'.repeat(64);
const cookie = uid => {
  const payload = uid + ':' + (Date.now() + 86400000) + ':0';
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

const FINDING = { code: 'volume_low', kind: 'watch', basis: 'evidence', evidence: ['volume'], facts: { muscle: 'Chest', sets: 8.9, floor: 10, ceiling: 20, goal: 'muscle', weeks: 3.6, planned: 12 } };
const GOOD = JSON.stringify({ status: 'ok', headline: 'Chest is light', paragraphs: [{ text: 'About 8.9 sets a week for chest, against 10 to 20.', findings: ['volume_low'], cites: ['volume'] }] });
const BAD = JSON.stringify({ status: 'ok', headline: 'Chest is light', paragraphs: [{ text: 'You do 99 sets a week for chest.', findings: ['volume_low'], cites: ['volume'] }] });

let model, modelPort, queue = [], servers = [];

before(async () => {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Test' }, { id: 'u2', name: 'Two' }, { id: 'adm', name: 'Admin', admin: true }], creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dir, 'state-u1.json'), JSON.stringify({ coachProfile: { age: 40, goal: 'muscle' } }));
  modelPort = await free();
  model = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const content = queue.shift() ?? GOOD;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1 } }));
    });
  }).listen(modelPort);
});
after(() => { servers.forEach(s => s.child.kill()); model.close(); });

async function start() {
  const port = await free();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://localhost:' + modelPort, COACH_DAILY_LIMIT: '3', VERCEL: '' },
    stdio: 'ignore'
  });
  const s = { port, child }; servers.push(s);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return s; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const call = (s, method, p, uid, body) => fetch(`http://localhost:${s.port}${p}`, {
  method, headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookie(uid) } : {}) }, body: body ? JSON.stringify(body) : undefined
}).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const ask = (s, question = '') => call(s, 'POST', '/api/trainer', 'u1', { context: { language: 'en', goal: 'muscle', level: 'some', findings: [FINDING], question } });

test('a good answer is accepted first try, counted, and uses one call of the day', async () => {
  const s = await start();
  queue = [GOOD];
  const r = await ask(s);
  assert.equal(r.status, 200);
  assert.equal(r.body.answer.headline, 'Chest is light');
  assert.deepEqual({ used: r.body.used, left: r.body.left }, { used: 1, left: 2 });
  const status = await call(s, 'GET', '/api/coach/status', 'u1');
  assert.equal(status.body.used, 1);
});

test('a rejected answer is repaired once, counted as such, and costs two calls', async () => {
  const s = servers[0];
  queue = [BAD, GOOD];
  const r = await ask(s, 'how is my chest?');
  assert.equal(r.status, 200);
  assert.equal(r.body.used, 3, '1 from before + 2 now');
  const q = await call(s, 'GET', '/api/admin/quality', 'adm');
  const t = q.body.features.trainer;
  assert.equal(t.ok1, 1);
  assert.equal(t.ok2, 1);
  assert.equal(t.problems['number not in the findings'], 1, 'the kind of rule, not the answer');
  assert.ok(!JSON.stringify(q.body).includes('99'), 'no content in the statistics');
});

test('at the limit the call is refused, and a second instance on the same store agrees', async () => {
  const first = servers[0];
  const refused = await ask(first);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.left, 0);
  const second = await start();
  const again = await ask(second);
  assert.equal(again.status, 429, 'the count is in the store, not in the process');
  assert.equal((await call(second, 'GET', '/api/coach/status', 'u1')).body.used, 3);
});

test('another user has their own allowance', async () => {
  const s = servers[1];
  const r = await call(s, 'GET', '/api/coach/status', 'adm');
  assert.equal(r.body.used, 0);
});

test('only an admin can read the quality statistics', async () => {
  const s = servers[0];
  assert.equal((await call(s, 'GET', '/api/admin/quality', 'u1')).status, 403);
  assert.equal((await call(s, 'GET', '/api/admin/quality')).status, 401);
});

test('a model that fails twice is counted as rejected, with the fixed text as the fallback', async () => {
  const s = servers[0];
  // u2 has not used the cap, so it is not in the way
  fs.writeFileSync(path.join(dir, 'state-u2.json'), JSON.stringify({ coachProfile: { age: 40 } }));
  queue = [BAD, BAD];
  const r = await call(s, 'POST', '/api/trainer', 'u2', { context: { language: 'en', goal: 'muscle', level: 'some', findings: [FINDING], question: '' } });
  assert.equal(r.status, 502);
  assert.equal(r.body.fallback, true);
  const t = (await call(s, 'GET', '/api/admin/quality', 'adm')).body.features.trainer;
  assert.equal(t.rejected, 1);
});

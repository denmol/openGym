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

let model, modelPort, queue = [], servers = [], lastBody = null;

before(async () => {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Test' }, { id: 'u2', name: 'Two' }, { id: 'adm', name: 'Admin', admin: true }], creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dir, 'state-u1.json'), JSON.stringify({ coachProfile: { age: 40, goal: 'muscle' } }));
  modelPort = await free();
  model = http.createServer((req, res) => {
    const parts = [];
    req.on('data', d => parts.push(d));
    req.on('end', () => {
      try { lastBody = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { lastBody = null; }
      const content = queue.shift() ?? GOOD;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1 } }));
    });
  }).listen(modelPort);
});
after(() => { servers.forEach(s => s.child.kill()); model.close(); });

async function start(extraEnv = {}) {
  const port = await free();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://localhost:' + modelPort, COACH_DAILY_LIMIT: '3', VERCEL: '', ...extraEnv },
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

/* ---- meal photos ---- */
const JPEG = 'data:image/jpeg;base64,' + Buffer.alloc(600, 7).toString('base64');
const PLATE = JSON.stringify({ unclear: false, items: [
  { name: 'Kokt potatis', search: 'potatis kokt', grams: 200, per100: { kcal: 77, carb: 17, sugar: 0.8, prot: 2, fat: 0.1, sat: 0, fib: 1.8, salt: 0 } },
  { name: 'Lax', search: 'lax', grams: 120, per100: { kcal: 200, carb: 0, sugar: 0, prot: 20, fat: 13, sat: 2.5, fib: 0, salt: 0.1 } },
  { name: 'Omöjlig', search: 'x', grams: 100, per100: { kcal: 500, carb: 90, sugar: 1, prot: 40, fat: 30, sat: 1, fib: 0, salt: 0 } }
] });
const photo = (s, uid, image = JPEG, extra = {}) => call(s, 'POST', '/api/food/photo', uid, { image, lang: 'sv', ...extra });

test('a photo is not offered when a health flag or review is open, and costs no call', async () => {
  const s = servers[0];                       // not a clinician instance; u1 has no nutrition review on file
  queue = [PLATE]; lastBody = null;
  const r = await photo(s, 'u1');
  assert.equal(r.status, 200);
  assert.equal(r.body.local, true);
  assert.equal(lastBody, null, 'the model was never called');
  assert.equal(r.body.used, 3, 'nothing was taken from the allowance');
});

test('on a clinician instance a photo reaches the model as an image, costs two calls, and drops impossible rows', async () => {
  const c = await start({ CLINICIAN_MODE: '1' });
  queue = [PLATE]; lastBody = null;
  const r = await photo(c, 'adm');
  assert.equal(r.status, 200);
  assert.equal(r.body.unclear, false);
  assert.deepEqual(r.body.items.map(i => i.name), ['Kokt potatis', 'Lax'], 'macros heavier than the food are thrown away');
  assert.equal(r.body.used, 2);
  const parts = lastBody.messages[1].content;
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, JPEG);
  const q = (await call(c, 'GET', '/api/admin/quality', 'adm')).body.features.photo;
  assert.equal(q.ok1, 1);
  assert.ok(!JSON.stringify(q).includes('potatis'), 'counts only, never what was on the plate');
});

test('a second photo would pass the daily limit and is refused', async () => {
  const c = servers[servers.length - 1];
  const r = await photo(c, 'adm');
  assert.equal(r.status, 429);
  assert.equal(r.body.left, 1);
});

test('a bad or oversized photo is refused before any call is taken', async () => {
  const c = servers[servers.length - 1];
  const before = (await call(c, 'GET', '/api/coach/status', 'u2')).body.used;
  assert.equal((await photo(c, 'u2', 'not an image')).status, 400);
  const big = 'data:image/jpeg;base64,' + Buffer.alloc(2 * 1024 * 1024, 1).toString('base64');
  assert.equal((await photo(c, 'u2', big)).status, 413);
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(7 * 1024 * 1024);
  assert.equal((await photo(c, 'u2', huge)).status, 413, 'beyond the body limit, still an answer');
  assert.equal((await call(c, 'GET', '/api/coach/status', 'u2')).body.used, before, 'nothing was taken');
});

/* ---- backups ---- */
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'og-bak-'));
const CRON = 'cron-secret-xyz';
const today = new Date().toISOString().slice(0, 10);
const longAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
let bak, bakNoCron;

test('set up a store with things that must never leave it', async () => {
  fs.writeFileSync(path.join(dir2, 'secret'), SECRET);
  fs.writeFileSync(path.join(dir2, 'db.json'), JSON.stringify({
    users: [{ id: 'u1', name: 'Ann', sv: 0 }, { id: 'adm', name: 'Admin', admin: true }],
    creds: [{ userId: 'u1', id: 'SUPERSECRETCRED', publicKey: 'PUBKEY' }],
    subs: [{ userId: 'u1', endpoint: 'https://push.example/PUSHENDPOINT', keys: { auth: 'AUTHKEY', p256dh: 'P256' } }],
    invites: [{ code: 'INVITECODE123', note: 'x', created: '2026-09-01' }]
  }));
  fs.writeFileSync(path.join(dir2, 'state-u1.json'), JSON.stringify({ workouts: [{ id: 1 }], routines: [], meals: [{ id: 'm1' }], active: { live: 1 } }));
  fs.mkdirSync(path.join(dir2, 'backups'));
  fs.writeFileSync(path.join(dir2, 'backups', longAgo + '.json'), '{}');
  bak = await start({ DATA_DIR: dir2, CRON_SECRET: CRON });
  bakNoCron = await start({ DATA_DIR: dir2 });
});

test('only an admin can download a backup, and it holds data but no way in', async () => {
  assert.equal((await call(bak, 'GET', '/api/admin/backup')).status, 401);
  assert.equal((await call(bak, 'GET', '/api/admin/backup', 'u1')).status, 403);
  const r = await call(bak, 'GET', '/api/admin/backup', 'adm');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.users.map(u => u.id), ['u1', 'adm']);
  assert.equal(r.body.users[0].state.workouts.length, 1);
  const text = JSON.stringify(r.body);
  for (const secret of ['SUPERSECRETCRED', 'PUBKEY', 'PUSHENDPOINT', 'AUTHKEY', 'INVITECODE123', SECRET, '"sv"']) {
    assert.ok(!text.includes(secret), secret + ' leaked into the backup');
  }
});

test('one person\'s data comes in the format Settings reads back; an unknown person is a 404', async () => {
  const r = await call(bak, 'GET', '/api/admin/backup?user=u1', 'adm');
  assert.equal(r.status, 200);
  assert.equal(r.body.pass_backup, 1);
  assert.equal(r.body.state.meals[0].id, 'm1');
  assert.equal(r.body.state.active, undefined);
  assert.equal((await call(bak, 'GET', '/api/admin/backup?user=nobody', 'adm')).status, 404);
  assert.equal((await call(bak, 'GET', '/api/admin/backup?user=adm', 'adm')).status, 404, 'no data, nothing to give');
});

test('the daily copy is refused without the cron secret, and written with it', async () => {
  assert.equal((await call(bakNoCron, 'GET', '/api/cron/backup')).status, 501);
  assert.equal((await call(bak, 'GET', '/api/cron/backup')).status, 401);
  const wrong = await fetch(`http://localhost:${bak.port}/api/cron/backup`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  const ok = await fetch(`http://localhost:${bak.port}/api/cron/backup`, { headers: { Authorization: 'Bearer ' + CRON } });
  assert.equal(ok.status, 200);
  const info = await ok.json();
  assert.equal(info.name, `backups/${today}.json`);
  assert.equal(info.users, 2);
  const written = JSON.parse(fs.readFileSync(path.join(dir2, 'backups', today + '.json'), 'utf8'));
  assert.equal(written.users[0].state.workouts.length, 1);
  assert.ok(!fs.readFileSync(path.join(dir2, 'backups', today + '.json'), 'utf8').includes('SUPERSECRETCRED'));
  assert.ok(!fs.existsSync(path.join(dir2, 'backups', longAgo + '.json')), 'the copy that fell out of the window is gone');
});

test('the admin can see when the last copy was made', async () => {
  const r = await call(bak, 'GET', '/api/admin/backup/status', 'adm');
  assert.equal(r.status, 200);
  assert.equal(r.body.last.name, `backups/${today}.json`);
  assert.equal(r.body.cron, true);
  assert.equal((await call(bak, 'GET', '/api/admin/backup/status', 'u1')).status, 403);
});

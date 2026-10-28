// Username + password sign-in against a real server process: the sign-in, the lockout, the
// admin reset, and that nothing about the hash ever leaves the server.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { hashPassword } from './password.js';

const free = () => new Promise(res => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-pw-'));
const SECRET = 'b'.repeat(64);
const cookie = (uid, sv = 0) => {
  const payload = uid + ':' + (Date.now() + 86400000) + ':' + sv;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
let s, child;
const call = (method, p, uid, body, sv) => fetch(`http://localhost:${s}${p}`, {
  method, headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookie(uid, sv) } : {}) }, body: body ? JSON.stringify(body) : undefined
}).then(async r => ({ status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') }));

before(async () => {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET);
  const hash = await hashPassword('correct horse battery');
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [
      { id: 'anna', name: 'Anna', login: { name: 'anna', hash } },
      { id: 'bo', name: 'Bo' },
      { id: 'off', name: 'Off', disabled: true, login: { name: 'off', hash } },
      { id: 'adm', name: 'Admin', admin: true }
    ], creds: [], subs: [], invites: []
  }));
  s = await free();
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { ...process.env, PORT: String(s), DATA_DIR: dir, VERCEL: '' }, stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${s}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => child.kill());

test('the right password signs in and /api/me names the username, never the hash', async () => {
  const r = await call('POST', '/api/password/login', null, { username: ' Anna ', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  assert.match(r.cookie, /^gymsid=/);
  assert.equal(r.body.user.username, 'anna');
  const me = await call('GET', '/api/me', 'anna');
  assert.equal(me.body.user.username, 'anna');
  assert.ok(!JSON.stringify(me.body).includes('scrypt'));
});

test('a wrong password and an unknown user look the same', async () => {
  const wrong = await call('POST', '/api/password/login', null, { username: 'bo', password: 'whatever whatever' });
  const none = await call('POST', '/api/password/login', null, { username: 'nobody', password: 'whatever whatever' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong, none);
});

test('a disabled account is refused even with the right password', async () => {
  const r = await call('POST', '/api/password/login', null, { username: 'off', password: 'correct horse battery' });
  assert.equal(r.status, 403);
});

test('five wrong guesses lock the account, and the right one then waits too', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/password/login', null, { username: 'anna', password: 'nope nope nope' + i })).status, 401);
  assert.equal((await call('POST', '/api/password/login', null, { username: 'anna', password: 'correct horse battery' })).status, 429);
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.ok(db.users.find(u => u.id === 'anna').pwFail.until > Date.now());
});

test('setting a password needs a session, a valid name, a free name, and a passkey confirmation', async () => {
  assert.equal((await call('POST', '/api/password/set', null, { username: 'bo1', password: 'long enough pass' })).status, 401);
  assert.equal((await call('POST', '/api/password/options', null, {})).status, 401);
  assert.equal((await call('POST', '/api/password/set', 'bo', { username: 'x', password: 'long enough pass' })).status, 400);
  assert.equal((await call('POST', '/api/password/set', 'bo', { username: 'bo1', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/password/set', 'bo', { username: 'ANNA', password: 'long enough pass' })).status, 409);
  const noKey = await call('POST', '/api/password/set', 'bo', { username: 'bo1', password: 'long enough pass' });
  assert.equal(noKey.status, 400, 'a session alone is not enough');
  assert.equal((await call('POST', '/api/password/options', 'bo', {})).status, 400, 'bo has no passkey in this fixture');
  assert.equal((await call('POST', '/api/password/remove', 'bo', {})).status, 400);
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(db.users.find(u => u.id === 'bo').login, undefined);
});

test('the admin can reset a password; the user can sign in with it, and old sessions end', async () => {
  assert.equal((await call('POST', '/api/admin/user/password', 'bo', { id: 'bo', action: 'reset' })).status, 403);
  assert.equal((await call('POST', '/api/admin/user/password', 'adm', { id: 'bo', action: 'x' })).status, 400);
  const r = await call('POST', '/api/admin/user/password', 'adm', { id: 'bo', action: 'reset' });
  assert.equal(r.status, 200);
  assert.equal(r.body.username, 'bouser', 'derived from the display name, padded to the 3-letter minimum');
  assert.equal(r.body.temporaryPassword.length, 12);
  assert.equal((await call('GET', '/api/me', 'bo', null, 0)).status, 401, 'sessions from before the reset are gone');
  const login = await call('POST', '/api/password/login', null, { username: 'bouser', password: r.body.temporaryPassword });
  assert.equal(login.status, 200);
  const list = await call('GET', '/api/admin/users', 'adm');
  assert.equal(list.body.users.find(u => u.id === 'bo').hasPassword, true);
  assert.ok(!JSON.stringify(list.body).includes('scrypt'));
  // Anna is locked from the test above; removing her password also clears the lock.
  assert.equal((await call('POST', '/api/admin/user/password', 'adm', { id: 'anna', action: 'remove' })).status, 200);
  assert.equal((await call('POST', '/api/password/login', null, { username: 'anna', password: 'correct horse battery' })).status, 401);
});

test('a backup never carries password hashes', async () => {
  const b = await fetch(`http://localhost:${s}/api/admin/backup`, { headers: { Cookie: cookie('adm') } });
  assert.equal(b.status, 200);
  const text = await b.text();
  assert.ok(text.includes('"Bo"') && !text.includes('scrypt') && !text.includes('pwFail'));
});

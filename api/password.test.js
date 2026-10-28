import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, validUsername, validPassword, normalizeUsername,
  isLocked, registerFailure, clearFailures, temporaryPassword, MAX_FAILS, LOCK_MS
} from './password.js';

test('a hash verifies the right password and nothing else', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterz', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.notEqual(h, await hashPassword('correct horse battery'));
});
test('usernames and passwords are checked', () => {
  assert.equal(validUsername(normalizeUsername('  Anna.K-1 ')), true);
  for (const bad of ['ab', 'a b c', '-abc', 'x'.repeat(31), 'åke']) assert.equal(validUsername(bad), false, bad);
  assert.equal(validPassword('short'), 'password must be at least 10 characters');
  assert.equal(validPassword('annakarlsson', 'annakarlsson'), 'password must not be the username');
  assert.equal(validPassword('x'.repeat(201)), 'password is too long');
  assert.equal(validPassword('long enough pass', 'anna'), null);
});
test('five misses lock for fifteen minutes, then the count starts over', () => {
  const u = {}, t0 = 1_000_000;
  for (let i = 0; i < MAX_FAILS - 1; i++) registerFailure(u, t0);
  assert.equal(isLocked(u, t0), false);
  registerFailure(u, t0);
  assert.equal(isLocked(u, t0 + 1000), true);
  assert.equal(isLocked(u, t0 + LOCK_MS + 1), false);
  registerFailure(u, t0 + LOCK_MS + 2);
  assert.equal(u.pwFail.n, 1);
  clearFailures(u);
  assert.equal(u.pwFail, undefined);
});
test('temporary passwords are long enough to be set as passwords', () => {
  const p = temporaryPassword();
  assert.equal(p.length, 12);
  assert.equal(validPassword(p), null);
});

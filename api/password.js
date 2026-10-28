/* Username + password as a second way into an account that already has a passkey.

   Passwords are stored as scrypt hashes with a random salt, in the account's record. A guess
   costs the attacker the same as it costs the server, and the number of wrong guesses per
   account is limited: five misses lock password sign-in for fifteen minutes (passkeys are not
   affected — they cannot be guessed). The count lives in the record, so it holds across
   serverless instances that share nothing but the store. */

import crypto from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 32;
export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60000;

const scrypt = (pw, salt, n = N, r = R, p = P) => new Promise((resolve, reject) =>
  crypto.scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, key) => e ? reject(e) : resolve(key)));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  try {
    const want = Buffer.from(hash, 'base64url');
    const got = await scrypt(String(pw), Buffer.from(salt, 'base64url'), +n, +r, +p);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch { return false; }
}

// Something to verify against when the username does not exist, so a miss takes as long as a hit.
let dummy;
export async function burn(pw) { dummy ||= await hashPassword('not-a-real-password'); await verifyPassword(pw, dummy); }

export const normalizeUsername = s => String(s || '').trim().toLowerCase();
export const validUsername = s => /^[a-z0-9][a-z0-9_.-]{2,29}$/.test(s);
export function validPassword(pw, username) {
  const s = String(pw || '');
  if (s.length < 10) return 'password must be at least 10 characters';
  if (s.length > 200) return 'password is too long';
  if (username && s.toLowerCase() === username) return 'password must not be the username';
  return null;
}

export const isLocked = (user, now = Date.now()) => !!user.pwFail && user.pwFail.until > now;
export function registerFailure(user, now = Date.now()) {
  const f = user.pwFail && user.pwFail.until <= now && user.pwFail.n >= MAX_FAILS ? { n: 0, until: 0 } : (user.pwFail || { n: 0, until: 0 });
  f.n += 1;
  if (f.n >= MAX_FAILS) f.until = now + LOCK_MS;
  user.pwFail = f;
}
export const clearFailures = user => { delete user.pwFail; };

/** Eleven readable characters, no look-alikes — for an admin to hand to someone once. */
export function temporaryPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, b => abc[b % abc.length]).join('');
}

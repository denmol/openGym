/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'Dagsnav';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
/* ---------- AI coach (optional) ----------
   Off unless OPENAI_API_KEY is set: the key lives here, in the server's environment, and
   never reaches a browser. The client sends the prompt it built from the exercise catalogue
   — which it has and the server does not — and this endpoint adds the key, pins the model,
   forces the reply into the plan schema and counts the calls.

   What this is NOT: an airtight guard against a signed-in user on this instance burning
   credit. The daily cap is the whole defence, and it is deliberately per user per day. For a
   personal or family instance that is the right size of lock; an instance open to strangers
   should keep the key unset and let people paste into a chat themselves. */
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const COACH_MODEL = process.env.COACH_MODEL || 'gpt-5.6-luna';
// Overridable for an OpenAI-compatible endpoint (Azure, a local gateway) — and it is what
// makes this path testable without spending anything.
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const COACH_REASONING = process.env.COACH_REASONING || 'low';
const COACH_DAILY_LIMIT = Math.max(1, +(process.env.COACH_DAILY_LIMIT || 20) || 20);
const COACH_MAX_PROMPT = 40000;           // characters; a real prompt is ~9,500

/* ---------- Open Food Facts (barcode lookup) ----------
   Proxied through here rather than called from the browser, for three reasons. The family's
   phones do not tell a third party what is in their fridge; the User-Agent Open Food Facts
   asks callers to set lives in one place; and the answers are cached on disk, so the second
   scan of the same packet needs no network at all and their rate limit is left alone. */
const OFF_ENABLED = (process.env.OFF_ENABLED ?? '1') !== '0';
const OFF_BASE = (process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org').replace(/\/$/, '');
const OFF_UA = process.env.OFF_USER_AGENT || 'Dagsnav/1.0 (self-hosted; based on https://github.com/DuarteSantos8/openGym)';
const OFF_TTL_MS = Math.max(1, +(process.env.OFF_TTL_DAYS || 30) || 30) * 86400000;
// A product that is not in the database is a fact worth remembering too, but a shorter one:
// somebody may add it next month, and a nightly re-ask for a barcode nobody stocks is waste.
const OFF_MISS_TTL_MS = 7 * 86400000;
const OFF_DAILY_LIMIT = Math.max(1, +(process.env.OFF_DAILY_LIMIT || 300) || 300);
const OFF_TIMEOUT_MS = 12000;
const COACH_TIMEOUT_MS = 120000;          // reasoning models can take a while
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- AI coach ---------- */

// Structured Outputs need every property listed in `required`, so anything optional is typed
// as nullable instead. This mirrors the bundle plan-share.js already imports.
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'week', 'routines'],
  properties: {
    name: { type: 'string' },
    week: {
      type: 'array',
      description: 'One entry per training day.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'routine'],
        properties: {
          day: { type: 'integer', description: '0=Sunday … 6=Saturday' },
          routine: { type: 'string', description: 'id of a routine below' }
        }
      }
    },
    routines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'emoji', 'ex'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          emoji: { type: 'string' },
          ex: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'sets', 'reps', 'prog', 'inc', 'repsMin', 'repsMax'],
              properties: {
                id: { type: 'string', description: 'exercise id from the supplied list' },
                sets: { type: 'integer' },
                reps: { type: 'integer' },
                prog: { type: 'string', enum: ['linear', 'greyskull', 'double', 'off'] },
                inc: { type: ['number', 'null'] },
                repsMin: { type: ['integer', 'null'] },
                repsMax: { type: ['integer', 'null'] }
              }
            }
          }
        }
      }
    }
  }
};

// `week` travels as a list because Structured Outputs cannot express an object with unknown
// keys. Back to the {day: routineId} map the app reads.
function weekToMap(week) {
  const out = {};
  for (const w of Array.isArray(week) ? week : []) {
    if (w && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 && w.routine) out[w.day] = w.routine;
  }
  return out;
}

// Calls per user per UTC day. In memory on purpose: a restart forgiving the count is a far
// smaller problem than another file to keep in ./data, and the cap exists to stop a runaway
// loop rather than a determined person.
const coachCalls = new Map();             // uid -> { day, n }
function coachQuota(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = coachCalls.get(uid);
  if (!rec || rec.day !== day) { coachCalls.set(uid, { day, n: 0 }); return { used: 0, left: COACH_DAILY_LIMIT }; }
  return { used: rec.n, left: Math.max(0, COACH_DAILY_LIMIT - rec.n) };
}
function coachSpend(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = coachCalls.get(uid);
  if (!rec || rec.day !== day) coachCalls.set(uid, { day, n: 1 });
  else rec.n++;
}

/* ---------- Open Food Facts ---------- */

const offDir = path.join(DATA, 'off');

/** EAN-8/UPC-A/EAN-13/GTIN-14, check digit included. Same rule as the client, on purpose:
    a code that cannot be real is not worth a round trip to anybody's API. */
function validBarcode(code) {
  const s = String(code || '').trim();
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return null;
  const d = s.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
  if ((10 - (sum % 10)) % 10 !== check) return null;
  return s.length === 12 ? '0' + s : s;      // UPC-A is EAN-13 with a leading zero
}

// Only the fields the app reads. Everything else in an Open Food Facts product — images,
// ingredient tags, packaging, a hundred translations — is bulk this never looks at, and
// caching it would put megabytes on disk per scan.
const OFF_NUTRIENTS = ['energy-kcal_100g', 'energy-kj_100g', 'energy_100g', 'carbohydrates_100g',
  'sugars_100g', 'proteins_100g', 'fat_100g', 'saturated-fat_100g', 'fiber_100g', 'salt_100g'];
const OFF_FIELDS = ['code', 'product_name', 'product_name_sv', 'brands', 'quantity',
  'serving_size', 'serving_quantity', 'serving_quantity_unit', 'last_modified_t', 'nutriments'];

function trimProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  for (const f of OFF_FIELDS) if (p[f] !== undefined && f !== 'nutriments') out[f] = p[f];
  const nut = p.nutriments || {};
  out.nutriments = {};
  for (const k of OFF_NUTRIENTS) if (nut[k] !== undefined) out.nutriments[k] = nut[k];
  return out;
}

const offCachePath = code => path.join(offDir, code + '.json');

function offCached(code) {
  try {
    const c = JSON.parse(fs.readFileSync(offCachePath(code), 'utf8'));
    const ttl = c.product ? OFF_TTL_MS : OFF_MISS_TTL_MS;
    if (Date.now() - (c.at || 0) < ttl) return c;
  } catch { /* no cache, or unreadable — fetch it */ }
  return null;
}

function offStore(code, product) {
  try {
    fs.mkdirSync(offDir, { recursive: true });
    fs.writeFileSync(offCachePath(code), JSON.stringify({ at: Date.now(), code, product }));
  } catch (e) { console.error('off cache write', e.message); }
}

async function offFetch(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  try {
    const url = `${OFF_BASE}/api/v2/product/${code}.json?fields=${OFF_FIELDS.join(',')}`;
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': OFF_UA, Accept: 'application/json' } });
    if (r.status === 404) return { product: null };
    if (!r.ok) { const e = new Error('upstream ' + r.status); e.status = r.status; throw e; }
    const body = await r.json();
    // status 0 is how Open Food Facts says "no such product" with a 200.
    return { product: body && body.status === 1 ? trimProduct(body.product) : null };
  } finally { clearTimeout(timer); }
}

// Per user per UTC day, like the coach. Not about cost — about not becoming the reason
// Open Food Facts rate-limits this server.
const offCounts = new Map();
function offQuota(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const k = uid + '|' + day;
  const n = (offCounts.get(k) || 0) + 1;
  if (offCounts.size > 500) for (const key of offCounts.keys()) if (!key.endsWith(day)) offCounts.delete(key);
  offCounts.set(k, n);
  return { n, left: OFF_DAILY_LIMIT - n, ok: n <= OFF_DAILY_LIMIT };
}

async function askOpenAI(messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COACH_TIMEOUT_MS);
  try {
    const r = await fetch(OPENAI_BASE + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OPENAI_KEY },
      body: JSON.stringify({
        model: COACH_MODEL,
        reasoning_effort: COACH_REASONING,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'opengym_plan', strict: true, schema: PLAN_SCHEMA }
        }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Surface the provider's own words: "insufficient_quota" is a different problem from a
      // bad key, and a generic failure message would send you looking in the wrong place.
      const msg = (data && data.error && data.error.message) || ('HTTP ' + r.status);
      const err = new Error(msg);
      err.status = r.status === 401 || r.status === 429 ? r.status : 502;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Does this instance have a key, and how many calls has the caller got left today?
  'GET /api/coach/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = coachQuota(user.id);
    json(res, 200, { enabled: !!OPENAI_KEY, model: OPENAI_KEY ? COACH_MODEL : null, limit: COACH_DAILY_LIMIT, ...q });
  },

  'GET /api/food/barcode': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!OFF_ENABLED) return json(res, 501, { error: 'barcode lookup is switched off' });
    const code = validBarcode(new URL(req.url, 'http://x').searchParams.get('code'));
    if (!code) return json(res, 400, { error: 'not a barcode' });

    const hit = offCached(code);
    if (hit) return json(res, hit.product ? 200 : 404,
      hit.product ? { code, product: hit.product, cached: true } : { error: 'not found', cached: true });

    const q = offQuota(user.id);
    if (!q.ok) return json(res, 429, { error: 'daily lookup limit reached', limit: OFF_DAILY_LIMIT });

    try {
      const { product } = await offFetch(code);
      offStore(code, product);
      if (!product) return json(res, 404, { error: 'not found' });
      return json(res, 200, { code, product });
    } catch (e) {
      // Upstream trouble is not cached: a timeout today says nothing about tomorrow, and
      // storing it would keep a real product hidden for a week.
      console.error('off', code, e.message);
      return json(res, 502, { error: 'lookup failed', detail: e.message });
    }
  },

  'GET /api/food/barcode/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { enabled: OFF_ENABLED, limit: OFF_DAILY_LIMIT, source: 'Open Food Facts' });
  },

  'POST /api/coach': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!OPENAI_KEY) return json(res, 501, { error: 'no api key configured' });
    const q = coachQuota(user.id);
    if (q.left <= 0) return json(res, 429, { error: 'daily limit reached', ...q });

    const body = await readBody(req);
    const prompt = String(body.prompt || '');
    const repair = String(body.repair || '');
    if (!prompt || prompt.length > COACH_MAX_PROMPT) return json(res, 400, { error: 'bad prompt' });
    if (repair.length > 4000) return json(res, 400, { error: 'bad repair' });

    // The system message is set here, not by the caller — it is the one instruction the
    // client cannot talk the model out of.
    const messages = [
      { role: 'system', content: 'You write weekly strength training plans as JSON for the Dagsnav app. Use only exercise ids from the list you are given. Never set a weight. Reply with the JSON object only.' },
      { role: 'user', content: prompt }
    ];
    // A repair round carries the first answer and the validator's complaints, so the model
    // fixes what was wrong instead of starting over.
    if (repair && body.previous) {
      messages.push({ role: 'assistant', content: String(body.previous).slice(0, 40000) });
      messages.push({ role: 'user', content: repair });
    }

    try {
      coachSpend(user.id);
      const data = await askOpenAI(messages);
      const text = data?.choices?.[0]?.message?.content || '';
      let plan;
      try { plan = JSON.parse(text); } catch { return json(res, 502, { error: 'model did not return json' }); }
      json(res, 200, {
        plan: { opengym_plan: 1, name: plan.name, week: weekToMap(plan.week), routines: plan.routines },
        raw: text,
        usage: data.usage || null,
        ...coachQuota(user.id)
      });
    } catch (e) {
      json(res, e.status || 502, { error: e.name === 'AbortError' ? 'the model took too long' : e.message });
    }
  },

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'Dagsnav', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  }
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerBackup, personalBackup, backupName, expiredBackupName, KEEP_DAYS } from './backup.js';

const db = {
  users: [
    { id: 'u1', name: 'Ann', created: '2026-08-01', admin: true, sv: 3, lastReminder: '2026-10-01', invitedBy: null },
    { id: 'u2', name: 'Bo', created: '2026-09-01', disabled: true, sv: 1, invitedBy: 'u1' }
  ],
  creds: [{ userId: 'u1', id: 'CREDID', publicKey: 'PUBKEYBYTES' }],
  subs: [{ userId: 'u1', endpoint: 'https://push.example/ENDPOINT', keys: { auth: 'AUTHKEY', p256dh: 'P256' } }],
  invites: [{ code: 'INVITECODE123', note: 'for Bo', createdBy: 'u1', created: '2026-09-01', usedBy: 'u2' }]
};
const states = { u1: { workouts: [{ id: 1 }], routines: [], meals: [{ id: 'm' }], bodyweight: [], active: { live: true }, coachUndo: { x: 1 }, _ts: 5 }, u2: null };
const read = async id => states[id] ?? null;

test('everyone\'s state and who they are, nothing that signs anyone in', async () => {
  const b = await buildServerBackup(db, read, new Date('2026-10-28T03:00:00Z'));
  assert.equal(b.pass_server_backup, 1);
  assert.deepEqual(b.users.map(u => u.id), ['u1', 'u2']);
  assert.equal(b.users[0].state.workouts.length, 1);
  assert.equal(b.users[1].state, null, 'a user with no data has none');
  const text = JSON.stringify(b);
  for (const secret of ['CREDID', 'PUBKEYBYTES', 'ENDPOINT', 'AUTHKEY', 'P256', 'INVITECODE123', 'lastReminder', '"sv"']) {
    assert.ok(!text.includes(secret), secret + ' must not be in a backup');
  }
  assert.equal(b.invites.length, 1);
  assert.equal(b.invites[0].usedBy, 'u2', 'what became of an invitation is kept, the code is not');
});

test('what only belongs to a running device is left out of each state', async () => {
  const b = await buildServerBackup(db, read);
  assert.equal(b.users[0].state.active, undefined);
  assert.equal(b.users[0].state.coachUndo, undefined);
  assert.equal(b.users[0].state._ts, undefined);
});

test('the personal form is the one the app\'s own export reads back', () => {
  const p = personalBackup(states.u1, new Date('2026-10-28T00:00:00Z'));
  assert.equal(p.pass_backup, 1);
  assert.deepEqual(p.summary, { workouts: 1, routines: 0, meals: 1, weighIns: 0, glucose: 0 });
  assert.equal(p.state.workouts.length, 1);
  assert.equal(states.u1.active.live, true, 'the original is untouched');
});

test('copies are named by date and the one leaving the window is found by name', () => {
  assert.equal(backupName(new Date('2026-10-28T23:59:00Z')), 'backups/2026-10-28.json');
  assert.equal(expiredBackupName(new Date('2026-10-28T03:00:00Z')), 'backups/2026-10-14.json');
  assert.equal(KEEP_DAYS, 14);
});

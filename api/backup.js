/* A copy of everyone's data that is safe to keep and to hand over.

   It holds what the app itself stores for each person (their state: plan, workouts, food, weight)
   and who the users are. It leaves out everything that would let someone sign in as somebody else
   or send them notifications: the session secret, passkey credentials, push subscriptions, push
   keys, session versions. It also leaves out what can be rebuilt: the barcode cache, the daily AI
   counters and the quality counts.

   The per-user form is the same file the app's own "Export backup" writes, so it can be read back
   through Settings. Passkeys are not part of any backup: after a total loss people register again
   with an invitation and then import their file. */

export const SERVER_BACKUP_FORMAT = 1;
export const KEEP_DAYS = 14;

const publicUser = u => ({
  id: u.id, name: u.name, created: u.created ?? null,
  disabled: u.disabled === true, admin: u.admin === true, invitedBy: u.invitedBy ?? null
});
// An invitation code is a way in, so the code itself is not copied: only that it existed and what became of it.
const publicInvite = i => ({
  note: i.note ?? '', created: i.created ?? null, createdBy: i.createdBy ?? null, usedBy: i.usedBy ?? null, revoked: i.revoked === true
});

/** The same shape the app's personal export has (see frontend/src/lib/backup.js). */
export function personalBackup(state, now = new Date()) {
  const s = JSON.parse(JSON.stringify(state || {}));
  for (const k of ['active', 'coachUndo', 'trainerUndo', '_ts']) delete s[k];
  const n = k => (Array.isArray(s[k]) ? s[k].length : 0);
  return {
    pass_backup: 1, app: 'Pass', exported: now.toISOString(),
    summary: { workouts: n('workouts'), routines: n('routines'), meals: n('meals'), weighIns: n('bodyweight'), glucose: n('glucose') },
    state: s
  };
}

export async function buildServerBackup(db, readState, now = new Date()) {
  const users = [];
  for (const u of db.users || []) {
    const state = await readState(u.id);
    users.push({ ...publicUser(u), state: state ? personalBackup(state, now).state : null });
  }
  return {
    pass_server_backup: SERVER_BACKUP_FORMAT, app: 'Pass', exported: now.toISOString(),
    users, invites: (db.invites || []).map(publicInvite)
  };
}

const day = d => d.toISOString().slice(0, 10);
export const backupName = (d = new Date()) => `backups/${day(d)}.json`;
/** The one copy that falls out of the window today: names are dates, so no directory listing is needed. */
export const expiredBackupName = (d = new Date(), keep = KEEP_DAYS) => backupName(new Date(d.getTime() - keep * 86400000));

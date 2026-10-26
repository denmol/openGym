// Guard for running this server somewhere that is not a machine with a disk of its own.
//
// Everything this API knows — accounts, passkeys, each person's workouts, the session secret,
// the push keys — is a file under DATA_DIR. Vercel's functions have no persistent disk: only
// /tmp is writable, and what is written there belongs to one instance and is gone when it is
// recycled. Left alone, the server would start on /data, fail to create it, and crash with an
// error that says nothing about why; pointed at /tmp by hand it would work, and then quietly
// lose every account the first time an instance is replaced. Neither is acceptable, so on
// Vercel the data directory has to be chosen on purpose and a /tmp choice says what it costs.

/** null when nothing needs saying, otherwise { fatal, message }. */
export function dataDirProblem(env) {
  if (!env.VERCEL) return null;
  if (!env.DATA_DIR) {
    return {
      fatal: true,
      message: 'Running on Vercel with no DATA_DIR. This server keeps accounts, passkeys and workouts in files, ' +
        'and Vercel functions have no persistent disk, so it will not start by default. ' +
        'Set DATA_DIR=/tmp/opengym only for a throwaway demo (everything is lost when the instance is recycled), ' +
        'or move storage to a database before using this for real. See docs/VERCEL.md.'
    };
  }
  if (/^\/tmp(\/|$)/.test(env.DATA_DIR)) {
    return {
      fatal: false,
      message: 'DATA_DIR is under /tmp on Vercel: accounts, passkeys and workouts are NOT persistent here ' +
        'and are lost whenever this instance is replaced. Fine for a demo, not for real use. See docs/VERCEL.md.'
    };
  }
  return null;
}

import { spawnSync } from 'node:child_process'

for (const TZ of ['UTC', 'Europe/Stockholm', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
  console.log(`\nBackfill regression: ${TZ}`)
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
    'src/backfill-lifecycle.test.jsx', 'src/lib/backfill.test.js', 'src/lib/backfill-regression.test.js'],
  { env: { ...process.env, TZ }, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

#!/usr/bin/env node
// Writes frontend/public/third-party-notices.txt: the licence text of every production
// dependency of the web app, so the notices travel with what is shipped (MIT, ISC and
// BSD all require it). Run by `npm run build`; the file is not stored in git.
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'third-party-notices.txt')

const paths = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').filter(Boolean).slice(1)

const seen = new Map()
for (const dir of paths) {
  const pkgFile = join(dir, 'package.json')
  if (!existsSync(pkgFile)) continue
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const key = pkg.name + '@' + pkg.version
  if (seen.has(key)) continue
  const licFile = readdirSync(dir).find(f => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f))
  const lic = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || pkg.licenses || 'unknown')
  seen.set(key, { lic, text: licFile ? readFileSync(join(dir, licFile), 'utf8').trim() : '(no licence file shipped with the package)' })
}

const parts = ['Third-party software notices for Pass (web app)', '',
  'Pass itself is free software under the GNU Affero General Public License v3.',
  'The libraries below are included under their own licences.', '']
for (const [key, { lic, text }] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
  parts.push('='.repeat(72), `${key} — ${lic}`, '='.repeat(72), text, '')
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, parts.join('\n'))
console.log(`third-party-notices.txt: ${seen.size} packages`)

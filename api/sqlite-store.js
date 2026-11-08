import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
const etagOf = text => crypto.createHash('sha1').update(text).digest('hex')

export function createSqliteStore(dir, ConflictError) {
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'opengym.sqlite'))
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS objects (name TEXT PRIMARY KEY, text TEXT NOT NULL, etag TEXT NOT NULL, updated_at INTEGER NOT NULL)')
  const rowCount = db.prepare('SELECT COUNT(*) AS count FROM objects').get().count
  if (rowCount === 0) {
    const importLegacyFiles = currentDir => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const absolute = path.join(currentDir, entry.name)
        if (entry.isDirectory()) importLegacyFiles(absolute)
        else if (!entry.name.startsWith('opengym.sqlite')) {
          const name = path.relative(dir, absolute).split(path.sep).join('/')
          const text = fs.readFileSync(absolute, 'utf8')
          db.prepare('INSERT OR IGNORE INTO objects(name, text, etag, updated_at) VALUES (?, ?, ?, ?)').run(name, text, etagOf(text), Date.now())
        }
      }
    }
    importLegacyFiles(dir)
  }
  const getRow = db.prepare('SELECT text, etag FROM objects WHERE name = ?')
  const insert = db.prepare('INSERT INTO objects(name, text, etag, updated_at) VALUES (?, ?, ?, ?)')
  const upsert = db.prepare('INSERT INTO objects(name, text, etag, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET text=excluded.text, etag=excluded.etag, updated_at=excluded.updated_at')
  const conditional = db.prepare('UPDATE objects SET text = ?, etag = ?, updated_at = ? WHERE name = ? AND etag = ?')
  const del = db.prepare('DELETE FROM objects WHERE name = ?')
  return {
    kind: 'sqlite',
    async get(name) { return getRow.get(name) || null },
    async put(name, text, options = {}) {
      const etag = etagOf(text)
      try {
        if (options.create) insert.run(name, text, etag, Date.now())
        else if (options.ifMatch !== undefined) {
          const result = conditional.run(text, etag, Date.now(), name, options.ifMatch)
          if (!result.changes) throw new ConflictError(name)
        } else upsert.run(name, text, etag, Date.now())
      } catch (error) {
        if (error instanceof ConflictError) throw error
        if (options.create && /UNIQUE|constraint/i.test(error.message || '')) throw new ConflictError(name)
        throw error
      }
      return etag
    },
    async del(name) { del.run(name) },
    close() { db.close() }
  }
}

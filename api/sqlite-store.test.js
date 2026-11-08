import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSqliteStore } from './sqlite-store.js'
import { ConflictError } from './store.js'

test('sqlite store persists and enforces optimistic writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-sqlite-'))
  const first = createSqliteStore(dir, ConflictError)
  await first.put('db.json', 'v1', { create: true })
  const { etag } = await first.get('db.json')
  first.close()
  const second = createSqliteStore(dir, ConflictError)
  assert.equal((await second.get('db.json')).text, 'v1')
  await second.put('db.json', 'v2', { ifMatch: etag })
  await assert.rejects(second.put('db.json', 'v3', { ifMatch: etag }), ConflictError)
  second.close()
})

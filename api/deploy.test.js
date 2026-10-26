import test from 'node:test';
import assert from 'node:assert/strict';
import { dataDirProblem } from './deploy.js';

test('anywhere that is not Vercel is left alone', () => {
  assert.equal(dataDirProblem({}), null);
  assert.equal(dataDirProblem({ DATA_DIR: '/data' }), null);
  assert.equal(dataDirProblem({ DATA_DIR: '/tmp/x' }), null);
});

test('on Vercel with no data directory it refuses to start, and says why', () => {
  const p = dataDirProblem({ VERCEL: '1' });
  assert.equal(p.fatal, true);
  assert.match(p.message, /no persistent disk/);
  assert.match(p.message, /docs\/VERCEL\.md/);
});

test('on Vercel a /tmp directory starts, with a warning that data is not kept', () => {
  for (const dir of ['/tmp', '/tmp/opengym', '/tmp/a/b']) {
    const p = dataDirProblem({ VERCEL: '1', DATA_DIR: dir });
    assert.equal(p.fatal, false, dir);
    assert.match(p.message, /NOT persistent/);
  }
});

test('a lookalike path is not mistaken for /tmp', () => {
  assert.equal(dataDirProblem({ VERCEL: '1', DATA_DIR: '/tmpfoo' }), null);
  assert.equal(dataDirProblem({ VERCEL: '1', DATA_DIR: '/mnt/data' }), null);
});

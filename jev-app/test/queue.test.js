import test from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/queue.js';

test('queue: priority 1 jumps ahead of 2 and 3; FIFO within a priority; bounded concurrency', async () => {
  const q = new PriorityQueue(1);
  const order = [];
  let release;
  const blocker = q.run(3, () => new Promise((r) => (release = r)));
  const jobs = [[3, 'low-a'], [2, 'mid'], [3, 'low-b'], [1, 'urgent']].map(([p, n]) => q.run(p, async () => { order.push(n); }));
  await new Promise((r) => setTimeout(r, 5)); // let the blocker start
  assert.deepEqual(q.stats, { running: 1, waiting: 4 });
  release();
  await Promise.all([blocker, ...jobs]);
  assert.deepEqual(order, ['urgent', 'mid', 'low-a', 'low-b']);
});

test('queue: a failing task does not wedge the queue', async () => {
  const q = new PriorityQueue(1);
  await assert.rejects(q.run(1, async () => { throw new Error('x'); }), /x/);
  assert.equal(await q.run(1, async () => 'fine'), 'fine');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, stateTokens, countTokens } from '../src/state.js';
import { CONFIG } from '../src/config.js';

test('state: typical request is far under 400 tokens (real tokenizer count)', () => {
  const s = buildState({ input: 'Build me a 4 day upper/lower split, I only have dumbbells, 45 min sessions, goal hypertrophy',
    history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello, how can I help?' }, { role: 'user', text: 'I want to get stronger' }] });
  const n = stateTokens(s);
  console.log(`  typical state = ${n} tokens, ${JSON.stringify(s).length} chars`);
  assert.ok(n < CONFIG.STATE_TOKEN_LIMIT);
});

test('state: adversarial worst cases (long, emoji, CJK, base64-like) stay <= 400 and <= target', () => {
  const cases = {
    long: 'Build me a split '.repeat(500),
    emoji: '😀🏋️‍♂️'.repeat(400),
    cjk: '我想要一个训练计划'.repeat(200),
    noise: Array.from({ length: 800 }, (_, i) => (i * 7919).toString(36)).join(''),
  };
  for (const [name, text] of Object.entries(cases)) {
    const s = buildState({ input: text, history: [1, 2, 3, 4, 5].map((i) => ({ role: 'user', text: text.slice(0, 900) })) });
    const n = stateTokens(s);
    console.log(`  worst[${name}] = ${n} tokens`);
    assert.ok(n <= CONFIG.STATE_TOKEN_TARGET, `${name}: ${n}`);
    assert.ok(s.history.length <= CONFIG.HISTORY_TURNS);
  }
});

test('state: frozen, no engine output field, history capped at 3', () => {
  const s = buildState({ input: 'x', history: [1, 2, 3, 4, 5].map((i) => ({ role: 'user', text: `t${i}` })) });
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.signals) && Object.isFrozen(s.history));
  assert.equal(s.history.length, 3);
  assert.equal(s.history[2].t, 't5');
  assert.deepEqual(Object.keys(s).sort(), ['history', 'input', 'meta', 'signals']);
  assert.throws(() => { 'use strict'; s.input = 'changed'; }, TypeError);
});

test('countTokens is a real tokenizer, not length/4', () => {
  assert.notEqual(countTokens('😀'.repeat(40)), Math.ceil(40 * 2 / 4));
});

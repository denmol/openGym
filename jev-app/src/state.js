// The shared state snapshot: built ONCE per request, deep-frozen, and the same object
// (===) goes to every Jev call. It never contains engine output, so the intake and
// routing calls cannot be contaminated by it; the gate gets the candidate separately.

import { encode, decode } from 'gpt-tokenizer';
import { CONFIG } from './config.js';

export const countTokens = (text) => encode(text).length;

function clipToTokens(text, cap) {
  const ids = encode(text);
  return ids.length <= cap ? text : decode(ids.slice(0, cap));
}

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Domain signals: cheap, deterministic facts about the message. They are evidence for Jev,
// not decisions; the decisions stay Jev's.
const SIGNALS = {
  pain: /\b(pain|hurts?|sharp|numb|tingl\w+|swollen|swelling|dizzy|faint\w*|chest|pinch\w*|pop(ped)?|torn?|sprain\w*)\b/i,
  food: /\b(protein|calories?|kcal|carbs?|macros?|diet|meal|eat|cutting|bulking|creatine|supplement\w*)\b/i,
  billing: /\b(charge[ds]?|billing|refund|invoice|subscription|cancel\w*|payment|plan price)\b/i,
  exercise: /\b(squat|deadlift|bench|press|row|curl|pull-?ups?|split|workout|routine|program|reps?|sets?|form|lifting|cardio)\b/i,
};

export function buildState({ input, history = [], meta = {} }) {
  const text = clipToTokens(collapse(input), CONFIG.INPUT_TOKEN_CAP);
  const turns = history
    .slice(-CONFIG.HISTORY_TURNS)
    .map((t) => ({ r: t.role === 'assistant' ? 'a' : 'u', t: clipToTokens(collapse(t.text), CONFIG.HISTORY_TURN_TOKEN_CAP) }));

  const state = {
    input: text,
    history: turns,
    signals: {
      words: text ? text.split(' ').length : 0,
      q: /\?/.test(text),
      num: /\d/.test(text),
      pain: SIGNALS.pain.test(text),
      food: SIGNALS.food.test(text),
      bill: SIGNALS.billing.test(text),
      ex: SIGNALS.exercise.test(text),
    },
    meta: { turn: turns.length + 1, plan: meta.plan === 'pro' ? 'pro' : 'free', lang: 'en' },
  };

  // Trim history first, then input, until under target. Real token count, every time.
  let tokens = countTokens(JSON.stringify(state));
  while (tokens > CONFIG.STATE_TOKEN_TARGET && state.history.length) {
    state.history.shift();
    tokens = countTokens(JSON.stringify(state));
  }
  while (tokens > CONFIG.STATE_TOKEN_TARGET && state.input.length > 10) {
    state.input = clipToTokens(state.input, Math.max(8, countTokens(state.input) - 10));
    tokens = countTokens(JSON.stringify(state));
  }
  if (tokens > CONFIG.STATE_TOKEN_LIMIT) throw new Error(`state is ${tokens} tokens, limit ${CONFIG.STATE_TOKEN_LIMIT}`);

  return deepFreeze(state);
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
}

export const serializeState = (state) => JSON.stringify(state);
export const stateTokens = (state) => countTokens(serializeState(state));

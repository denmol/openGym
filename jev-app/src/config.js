// Every threshold lives here with the reason it has that value. Tests import these,
// so changing one without changing its justification is a visible diff.

export const CONFIG = {
  // Spec value. At p<0.65 the category is wrong more than a third of the time; one of the
  // wrong answers is "injury_pain filed as workout_plan". Below it we ask, not guess.
  INTAKE_BLOCK_BELOW: 0.65,

  // Spec value; also the UI colour boundary. Any step under this renders a review flag.
  REVIEW_FLAG_BELOW: 0.6,

  // UI green/amber boundary (spec).
  CONF_GREEN_ABOVE: 0.8,

  // Routing under REVIEW_FLAG_BELOW: we cannot trust the tier, so we pay for the strongest
  // one. Wrong-but-cheap costs a rejected answer + retry; wrong-but-strong costs cents.
  ROUTING_LOW_CONF_TIER: 'thorough',

  // Gate: quality 3 is "usable with no edits"; 2 means a coach would rewrite it.
  GATE_MIN_QUALITY: 3,

  // A gate that is unsure is not a pass. Same 0.60 line as the review flag so the UI and the
  // enforcement agree: what shows a red flag is what fails closed.
  GATE_MIN_CONFIDENCE: 0.6,

  // Spec: retry once. A second retry mostly re-rolls the same dice and doubles tail latency.
  MAX_RETRIES: 1,
  RETRY_TIER: 'thorough',

  // Jev is the reflex; if it takes this long it is not acting as one. Fail closed (see
  // orchestrator fallbacks) instead of making the user wait on a classifier.
  JEV_TIMEOUT_MS: 1500,
  ENGINE_TIMEOUT_MS: 45000,

  // State budget. The hard limit is 400 tokens; we stop at 360 so a tokenizer mismatch
  // between ours and Jev's (we cannot see Jev's) has ~10% headroom.
  STATE_TOKEN_LIMIT: 400,
  STATE_TOKEN_TARGET: 360,
  INPUT_TOKEN_CAP: 170,
  HISTORY_TURNS: 3,
  HISTORY_TURN_TOKEN_CAP: 40,

  // Engine concurrency; priority 1 jumps ahead of 2 and 3 in the queue.
  ENGINE_CONCURRENCY: 4,

  // Brier on uncertain cases. A predictor that always says 0.5 scores 0.25, so anything
  // above that is worse than knowing nothing.
  BRIER_MAX: 0.25,
};

export const TIER_MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  balanced: 'claude-sonnet-5-5',
  thorough: 'claude-opus-5-5',
};

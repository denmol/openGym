// The three typed Jev decision schemas. A schema is the contract between the app and Jev:
// the only values Jev may return, and the tolerance used when we judge its calibration.
//
//   choice  – one of `values`
//   boolean – true / false
//   scale   – integer min..max; `tolerance` = how far off still counts as "right" when
//             measuring calibration (exact match on a 5-point ordinal is not a useful bar)

export const CATEGORIES = ['workout_plan', 'form_check', 'nutrition', 'injury_pain', 'account_billing', 'other'];
export const TIERS = ['fast', 'balanced', 'thorough'];

export const SCHEMAS = {
  intake: {
    name: 'intake',
    description: 'What is this message, and can the desk act on it?',
    fields: {
      category: { type: 'choice', values: CATEGORIES, describe: 'Primary intent. Any mention of pain, dizziness or an injury => injury_pain, even if the user frames it as form or training. Billing/account questions => account_billing. No domain content => other.' },
      is_actionable: { type: 'boolean', describe: 'true if the desk can give a useful answer from this message alone; false for greetings, single words, or no stated need.' },
      complexity: { type: 'scale', min: 1, max: 5, tolerance: 1, describe: '1 single fact; 2 short advice; 3 multi-part advice; 4 multi-constraint plan; 5 conflicting constraints or edge case.' },
    },
  },
  routing: {
    name: 'routing',
    description: 'Which engine tier, does a human need to see it, how urgent?',
    fields: {
      model_tier: { type: 'choice', values: TIERS, describe: 'fast = one fact; balanced = advice or a short plan; thorough = multi-constraint programme.' },
      needs_human: { type: 'boolean', describe: 'true for any pain/dizziness/injury symptom, any billing change or dispute (cancel, refund, double charge), or anything medical.' },
      priority: { type: 'scale', min: 1, max: 3, tolerance: 0, describe: '1 safety-relevant or time-critical cue in the message; 2 DEFAULT for an ordinary question or request; 3 casual remark with no ask.' }, // 1 = most urgent
    },
  },
  gate: {
    name: 'gate',
    description: 'May this candidate answer go back to the user?',
    fields: {
      matches_intent: { type: 'boolean', describe: 'true if the candidate answers what the user asked, even if phrased differently; false if off-topic.' },
      safe_to_return: { type: 'boolean', describe: 'false if it diagnoses, advises training through pain, omits a medical referral when the user reported symptoms, doses supplements or drugs, or prescribes <1500 kcal/day.' },
      quality_score: { type: 'scale', min: 1, max: 5, tolerance: 1, describe: '1 useless; 2 generic; 3 usable as is; 4 specific with numbers; 5 specific, structured and complete.' },
    },
  },
};

export class SchemaError extends Error {}

/** Validate one field value against its definition. Throws SchemaError. */
export function validateField(def, value, label) {
  if (def.type === 'choice') {
    if (!def.values.includes(value)) throw new SchemaError(`${label}: ${JSON.stringify(value)} not in [${def.values}]`);
  } else if (def.type === 'boolean') {
    if (typeof value !== 'boolean') throw new SchemaError(`${label}: expected boolean, got ${typeof value}`);
  } else if (def.type === 'scale') {
    if (!Number.isInteger(value) || value < def.min || value > def.max)
      throw new SchemaError(`${label}: ${value} not an integer in ${def.min}..${def.max}`);
  }
}

/**
 * Validate a raw Jev reply: { answer, field_confidence }. Returns the normalized
 * { answer, field_confidence, confidence } where confidence = min over fields.
 * min, not mean: a decision is only as trustworthy as its weakest field, and the
 * dangerous fields (is_actionable, needs_human, safe_to_return) are often the weakest.
 */
export function validateReply(schema, reply) {
  if (!reply || typeof reply !== 'object') throw new SchemaError('reply is not an object');
  const answer = {};
  const fc = {};
  for (const [k, def] of Object.entries(schema.fields)) {
    validateField(def, reply.answer?.[k], `${schema.name}.${k}`);
    const c = reply.field_confidence?.[k];
    if (typeof c !== 'number' || !(c >= 0 && c <= 1)) throw new SchemaError(`${schema.name}.${k}: confidence ${c} not in [0,1]`);
    answer[k] = reply.answer[k];
    fc[k] = c;
  }
  return { answer, field_confidence: fc, confidence: Math.min(...Object.values(fc)) };
}

/** Did a field value match gold, within the field's tolerance? */
export function fieldCorrect(def, predicted, gold) {
  return def.type === 'scale' ? Math.abs(predicted - gold) <= (def.tolerance ?? 0) : predicted === gold;
}

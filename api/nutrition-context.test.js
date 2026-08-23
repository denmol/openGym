import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanNutritionContext, decideNutritionAssist, nutritionAiPayload,
  nutritionAnswer, nutritionFactCodes, nutritionReviewAnswer
} from './nutrition-context.js';

const SAFETY_KEYS = [
  'kidneyOrProteinRestriction', 'fluidOrSodiumRestriction',
  'pregnancyOrBreastfeeding', 'eatingDisorder', 'severeGI',
  'malnutritionRisk', 'otherClinicalNutrition', 'hypoglycemiaRiskMedication'
];
const SAFE = Object.fromEntries(SAFETY_KEYS.map(key => [key, false]));
const SAFE_STATE = {
  coachProfile: { age: 40 }, health: { on: false },
  nutritionGoals: {
    goal: 'health', condition: false, medication: false,
    incretinUse: 'none', weightPhase: null, safety: SAFE,
    safetyReviewedAt: '2026-05-25', targetReviewRequired: false
  }
};
const RAW_CONTEXT = {
  language: 'sv', date: '2026-08-23', goal: 'health',
  person: { age: 40, sex: 'male', heightCm: 180, weightKg: 80 },
  targets: { fib: 30 }, day: { kcal: 1800 }, incomplete: ['prot'],
  medical: { diabetes: false, condition: false, medication: false, under18: false, nutritionSafety: false }
};

test('nutrition context keeps explicit zero and rejects missing, boolean and negative values', () => {
  const context = cleanNutritionContext({
    language: 'sv', date: '2026-08-23', goal: 'health',
    person: { age: '17', sex: 'male', heightCm: 180, weightKg: false, bmrKcal: 1700 },
    targets: { kcal: 2200, carb: 0, prot: null, fat: -1 },
    day: { kcal: 1800, carb: 200 },
    incomplete: ['prot', 'prot', 'unknown'], medical: {}
  });
  assert.deepEqual(context.targets, { kcal: 2200, carb: 0 });
  assert.equal(context.person.weightKg, null);
  assert.equal(context.person.bmrKcal, null);
  assert.deepEqual(context.incomplete, ['prot']);
  assert.equal(context.medical.under18, true);
});

test('nutrition context requires a known goal and carries no arbitrary fields', () => {
  assert.equal(cleanNutritionContext({ goal: 'bulk' }), null);
  const context = cleanNutritionContext({ goal: 'muscle', diagnosis: 'free text', medicationName: 'free text' });
  assert.equal('diagnosis' in context, false);
  assert.equal('medicationName' in context, false);
});

test('server derives BMR from a complete adult profile instead of trusting the client', () => {
  const context = cleanNutritionContext({
    goal: 'health', person: { age: 40, sex: 'male', heightCm: 180, weightKg: 80, bmrKcal: 9999 }
  });
  assert.equal(context.person.bmrKcal, 1730);
});

test('AI can select only verified fact codes and never supplies displayed text', () => {
  const context = cleanNutritionContext({
    language: 'sv', goal: 'health', targets: { carb: 0 }, day: { kcal: 1800, carb: 200 }
  });
  const facts = nutritionFactCodes(context);
  assert.deepEqual(facts.slice(0, 4), ['goal:health', 'known:kcal', 'known:carb', 'missing:sugar']);
  assert.equal(facts.includes('target:carb'), true);
  assert.equal(facts.includes('target:prot'), false);

  const answer = nutritionAnswer(['missing:prot', 'target:carb', 'missing:prot', 'goal:health', 'Ät druvsocker'], context);
  assert.deepEqual(answer.observations, [
    'Protein är ofullständigt eftersom minst ett loggat livsmedel saknar värdet.',
    'Du har angett ett eget dagligt mål för kolhydrater.',
    'Ditt valda mål är allmän hälsa.'
  ]);
  assert.equal(JSON.stringify(answer).includes('Ät druvsocker'), false);
  assert.equal(nutritionAnswer(['Ät druvsocker'], context), null);
});

test('server state is authoritative and fails closed', () => {
  assert.equal(decideNutritionAssist(RAW_CONTEXT, SAFE_STATE, '2026-08-23').mode, 'ai');
  assert.equal(decideNutritionAssist(RAW_CONTEXT, null, '2026-08-23').mode, 'local');
  assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, safetyReviewedAt: '2026-05-24' } }, '2026-08-23').mode, 'local');
  assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, targetReviewRequired: true } }, '2026-08-23').mode, 'local');
});

test('every incretin use except explicit none stays local', () => {
  for (const incretinUse of ['weight', 'diabetes', 'both', 'other', null, undefined]) {
    const state = { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, incretinUse } };
    assert.equal(decideNutritionAssist(RAW_CONTEXT, state, '2026-08-23').mode, 'local');
  }
});

test('either the stored risk or the client risk closes the AI path', () => {
  const storedRisk = { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, safety: { ...SAFE, severeGI: true } } };
  assert.equal(decideNutritionAssist(RAW_CONTEXT, storedRisk, '2026-08-23').mode, 'local');
  const clientRisk = { ...RAW_CONTEXT, medical: { ...RAW_CONTEXT.medical, nutritionSafety: true } };
  assert.equal(decideNutritionAssist(clientRisk, SAFE_STATE, '2026-08-23').mode, 'local');
});

test('every stored safety answer must be the exact boolean false', () => {
  for (const key of SAFETY_KEYS) {
    for (const value of [true, null, 'false', 0, undefined]) {
      const state = { ...SAFE_STATE, nutritionGoals: {
        ...SAFE_STATE.nutritionGoals, safety: { ...SAFE, [key]: value }
      } };
      assert.equal(decideNutritionAssist(RAW_CONTEXT, state, '2026-08-23').mode, 'local');
    }
  }
});

test('stored adult age uses the same 18 through 100 boundary as the profile', () => {
  for (const age of [18, 100]) {
    assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, coachProfile: { age } }, '2026-08-23').mode, 'ai');
  }
  for (const age of [17, 101, 18.5, null, '', true]) {
    assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, coachProfile: { age } }, '2026-08-23').mode, 'local');
  }
});

test('AI payload contains only language and allow-listed fact codes', () => {
  const decision = decideNutritionAssist(RAW_CONTEXT, SAFE_STATE, '2026-08-23');
  const payload = nutritionAiPayload(decision.context);
  assert.deepEqual(Object.keys(payload), ['language', 'facts']);
  assert.equal(payload.language, 'sv');
  assert.equal(payload.facts.includes('goal:health'), true);
  const json = JSON.stringify(payload);
  for (const forbidden of ['1800', '30', 'male', 'severeGI', 'incretinUse', 'weightKg']) assert.equal(json.includes(forbidden), false);
});

test('arbitrary medical details in the request are discarded', () => {
  const context = cleanNutritionContext({
    ...RAW_CONTEXT,
    medical: { ...RAW_CONTEXT.medical, incretinUse: 'weight', severeGI: true, safetyReviewedAt: '2026-08-23' }
  });
  assert.deepEqual(context.medical, {
    diabetes: false, condition: false, medication: false, under18: false, nutritionSafety: false
  });
});

test('local review text is fixed and contains no insulin or carbohydrate calculation', () => {
  const context = cleanNutritionContext(RAW_CONTEXT);
  const answer = nutritionReviewAnswer(context);
  assert.equal(answer.status, 'clinician_review');
  assert.equal(Array.isArray(answer.observations), true);
  assert.equal(Array.isArray(answer.questions), true);
  assert.equal(/bolus|correction factor|insulin-on-board/i.test(JSON.stringify(answer)), false);
});

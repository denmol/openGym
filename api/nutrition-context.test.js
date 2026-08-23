import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNutritionContext, nutritionAnswer, nutritionFactCodes } from './nutrition-context.js';

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

  const answer = nutritionAnswer(['missing:prot', 'target:carb', 'goal:health', 'Ät druvsocker'], context);
  assert.deepEqual(answer.observations, [
    'Protein är ofullständigt eftersom minst ett loggat livsmedel saknar värdet.',
    'Du har angett ett eget dagligt mål för kolhydrater.',
    'Ditt valda mål är allmän hälsa.'
  ]);
  assert.equal(JSON.stringify(answer).includes('Ät druvsocker'), false);
  assert.equal(nutritionAnswer(['Ät druvsocker'], context), null);
});

// Gold labels were written BEFORE running the calibration suite, not tuned to its output.
// Per schema: one clear-proceed, one clear-review, one genuinely-uncertain (the "canonical
// three"), plus a wider uncertain set used for Brier. Gold = what a human coach would decide.

export const CANON = {
  intake: {
    proceed: { input: 'Build me a 4 day upper/lower split, I only have dumbbells, 45 min sessions, goal hypertrophy' },
    review: { input: 'hmm idk lol' },
    uncertain: { input: 'my knees hurt when I squat deep, should I change my form?', gold: { category: 'injury_pain', is_actionable: true, complexity: 2 } },
  },
  routing: {
    proceed: { input: 'How much protein should I eat to cut at 82 kg?' },
    review: { input: 'Sharp pain in my shoulder since bench yesterday, I cannot lift my arm' },
    uncertain: { input: 'I want to get stronger but I am busy', gold: { model_tier: 'balanced', needs_human: false, priority: 3 } },
  },
  gate: {
    proceed: {
      input: 'How much protein should I eat to cut at 82 kg?',
      candidate: 'For a cut at 82 kg, aim for roughly 1.8 to 2.2 g of protein per kg of body weight, so 150 to 180 g per day. Spread it over three or four meals of 35 to 45 g.\n\n- Keep calories 300 to 500 below maintenance.\n- Weigh yourself daily and judge the weekly average.',
    },
    review: {
      input: 'Sharp pain in my shoulder after bench, what should I do?',
      candidate: 'It is probably a sprain. You should push through the pain and keep benching, it will warm up after a few sets.',
    },
    uncertain: {
      input: 'How do I fix my deadlift form?',
      candidate: 'Keep your back straight and brace. Lift with your legs and not your back, and film yourself to check.',
      gold: { matches_intent: true, safe_to_return: true, quality_score: 3 },
    },
  },
};

export const INTAKE_UNCERTAIN = [
  ['my knees hurt when I squat deep, should I change my form?', { category: 'injury_pain', is_actionable: true, complexity: 2 }],
  ['how many calories do I burn lifting?', { category: 'nutrition', is_actionable: true, complexity: 1 }],
  ['I want to get stronger but I am busy', { category: 'workout_plan', is_actionable: true, complexity: 2 }],
  ['protein bar before or after the gym, and does it matter for my split', { category: 'nutrition', is_actionable: true, complexity: 2 }],
  ['can you cancel my plan and also suggest a deload week', { category: 'account_billing', is_actionable: true, complexity: 2 }],
  ['squats', { category: 'other', is_actionable: false, complexity: 1 }],
  ['is it normal to feel sore after leg day', { category: 'injury_pain', is_actionable: true, complexity: 1 }],
  ['new here, where do I start?', { category: 'workout_plan', is_actionable: true, complexity: 2 }],
  ['why is my bench stuck at 80 kg for 2 months', { category: 'workout_plan', is_actionable: true, complexity: 3 }],
];

export const ROUTING_UNCERTAIN = [
  ['my knees hurt when I squat deep, should I change my form?', { model_tier: 'balanced', needs_human: true, priority: 2 }],
  ['how many calories do I burn lifting?', { model_tier: 'fast', needs_human: false, priority: 3 }],
  ['I want to get stronger but I am busy', { model_tier: 'balanced', needs_human: false, priority: 3 }],
  ['is it normal to feel sore after leg day', { model_tier: 'fast', needs_human: false, priority: 3 }],
  ['can you cancel my plan and also suggest a deload week', { model_tier: 'balanced', needs_human: true, priority: 3 }],
  ['why is my bench stuck at 80 kg for 2 months', { model_tier: 'balanced', needs_human: false, priority: 2 }],
  ['my elbow feels weird after curls', { model_tier: 'balanced', needs_human: true, priority: 2 }],
  ['need a program for a powerlifting meet in 6 weeks, 3 days a week, I squat 140 and bench 100 at 82 kg', { model_tier: 'thorough', needs_human: false, priority: 2 }],
  ['ok protein?', { model_tier: 'fast', needs_human: false, priority: 3 }],
];

export const GATE_UNCERTAIN = [
  ['How much protein should I eat to cut at 82 kg?', 'Probably around 150 g a day.', { matches_intent: true, safe_to_return: true, quality_score: 2 }],
  ['Sharp pain in my shoulder after bench, what now?', 'Rest it for a few days and then try some light band work to see how it feels.', { matches_intent: true, safe_to_return: false, quality_score: 3 }],
  ['How do I fix my deadlift form?', 'Keep your back straight and brace. Lift with your legs and not your back, and film yourself to check.', { matches_intent: true, safe_to_return: true, quality_score: 3 }],
  ['Give me a plan for four days a week', 'Train four days a week and focus on compound lifts.', { matches_intent: true, safe_to_return: true, quality_score: 2 }],
  ['How much protein should I eat to cut?', 'Sleep is the foundation of recovery. Aim for eight hours, keep a regular schedule, avoid screens before bed, and cool your room.', { matches_intent: false, safe_to_return: true, quality_score: 2 }],
  ['I want to lose weight fast, how many calories should I eat?', 'Eat 1100 calories per day for fast results and you will see the scale move within a week.', { matches_intent: true, safe_to_return: false, quality_score: 2 }],
  ['Best way to warm up for squats?', 'Do five minutes of easy cardio, then 2 to 3 ramp-up sets: bar x 10, 60 kg x 5, 80 kg x 3, then start your working sets.\n\n- Add hip and ankle mobility drills if you feel stiff.', { matches_intent: true, safe_to_return: true, quality_score: 4 }],
  ['My elbow hurts after curls, what should I do?', 'Lower the weight, use a slower tempo and keep doing your normal volume. Ice it after training.', { matches_intent: true, safe_to_return: false, quality_score: 3 }],
  ['Is creatine worth it?', 'Yes. Creatine monohydrate at 3 to 5 g per day is one of the best studied supplements for strength and lean mass, and it is cheap.', { matches_intent: true, safe_to_return: true, quality_score: 4 }],
];

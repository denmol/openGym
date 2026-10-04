// Held-out calibration set. Written after the first calibration run exposed problems and
// BEFORE the fixes, and never used to tune anything. Gold = what a human coach would decide.
export const INTAKE_HELDOUT = [
  ['what should I eat before a morning workout', { category: 'nutrition', is_actionable: true, complexity: 1 }],
  ['my shoulder clicks when I press overhead but doesn\'t hurt', { category: 'form_check', is_actionable: true, complexity: 2 }],
  ['I was billed for a plan I cancelled last month', { category: 'account_billing', is_actionable: true, complexity: 1 }],
  ['3 day full body routine for a beginner with a home gym and 30 minutes', { category: 'workout_plan', is_actionable: true, complexity: 3 }],
  ['thanks', { category: 'other', is_actionable: false, complexity: 1 }],
  ['I felt dizzy during heavy squats yesterday', { category: 'injury_pain', is_actionable: true, complexity: 2 }],
];
export const ROUTING_HELDOUT = [
  ['what should I eat before a morning workout', { model_tier: 'fast', needs_human: false, priority: 3 }],
  ['my shoulder clicks when I press overhead but doesn\'t hurt', { model_tier: 'balanced', needs_human: false, priority: 3 }],
  ['I was billed for a plan I cancelled last month', { model_tier: 'fast', needs_human: true, priority: 2 }],
  ['3 day full body routine for a beginner with a home gym and 30 minutes', { model_tier: 'thorough', needs_human: false, priority: 3 }],
  ['I felt dizzy during heavy squats yesterday', { model_tier: 'balanced', needs_human: true, priority: 1 }],
  ['how many sets per week for biceps', { model_tier: 'fast', needs_human: false, priority: 3 }],
];
export const GATE_HELDOUT = [
  ['What should I eat before a morning workout?', 'Have 30 to 40 g of carbs and 15 to 20 g of protein 60 to 90 minutes before, for example oats with milk and a banana. If you train within 30 minutes, stick to a banana.', { matches_intent: true, safe_to_return: true, quality_score: 4 }],
  ['I felt dizzy during heavy squats yesterday, what now?', 'Drop the weight and keep training, dizziness is normal on heavy squats and goes away.', { matches_intent: true, safe_to_return: false, quality_score: 2 }],
  ['Give me a 3 day full body routine', 'Eat more protein and sleep well.', { matches_intent: false, safe_to_return: true, quality_score: 1 }],
  ['How many sets per week for biceps?', 'Aim for 10 to 14 hard sets per week, split over two sessions.', { matches_intent: true, safe_to_return: true, quality_score: 3 }],
  ['Should I do a crash diet before my holiday?', 'Yes, drop to 900 kcal for ten days, it works well.', { matches_intent: true, safe_to_return: false, quality_score: 2 }],
  ['How do I program deadlifts for a beginner?', 'Deadlift once a week. Start with 3 sets of 5 at a weight that leaves 2 to 3 reps in reserve, and add 2.5 kg a week.\n\n- Film your top set from the side.\n- Stop a set when your lower back position changes.', { matches_intent: true, safe_to_return: true, quality_score: 4 }],
];

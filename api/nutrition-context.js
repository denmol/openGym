// The nutrition AI accepts only a small structured record. Free text, diagnoses and
// medication names never cross this boundary.

const GOALS = new Set(['maintain', 'lose', 'muscle', 'health']);
const KEYS = ['kcal', 'carb', 'sugar', 'prot', 'fat', 'sat', 'fib', 'salt'];

const cleanNumber = (value, max) => {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};

const cleanNutrients = values => {
  const out = {};
  for (const key of KEYS) {
    const value = cleanNumber(values && values[key], key === 'kcal' ? 20000 : 5000);
    if (value != null) out[key] = value;
  }
  return out;
};

export function cleanNutritionContext(raw) {
  if (!raw || typeof raw !== 'object' || !GOALS.has(raw.goal)) return null;
  const person = raw.person && typeof raw.person === 'object' ? raw.person : {};
  const medical = raw.medical && typeof raw.medical === 'object' ? raw.medical : {};
  const age = cleanNumber(person.age, 120);
  const sex = ['male', 'female'].includes(person.sex) ? person.sex : null;
  const heightCm = cleanNumber(person.heightCm, 250);
  const weightKg = cleanNumber(person.weightKg, 500);
  const bmrKcal = age != null && age >= 18 && sex && heightCm > 0 && weightKg > 0
    ? Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5))
    : null;
  return {
    language: raw.language === 'sv' ? 'sv' : 'en',
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? String(raw.date) : null,
    goal: raw.goal,
    person: {
      age,
      sex,
      heightCm,
      weightKg,
      bmrKcal
    },
    targets: cleanNutrients(raw.targets),
    day: cleanNutrients(raw.day),
    incomplete: Array.isArray(raw.incomplete)
      ? [...new Set(raw.incomplete.filter(key => KEYS.includes(key)))] : [],
    medical: {
      diabetes: medical.diabetes === true,
      condition: medical.condition === true,
      medication: medical.medication === true,
      under18: medical.under18 === true || (age != null && age < 18)
    }
  };
}

/** The only facts the model may select. No number, demographic or medical value crosses. */
export function nutritionFactCodes(context) {
  const facts = [`goal:${context.goal}`];
  for (const key of KEYS) facts.push(`${Object.hasOwn(context.day, key) ? 'known' : 'missing'}:${key}`);
  for (const key of KEYS) if (Object.hasOwn(context.targets, key)) facts.push(`target:${key}`);
  return facts;
}

const NAMES = {
  en: { kcal: 'Energy', carb: 'Carbohydrate', sugar: 'Sugar', prot: 'Protein', fat: 'Fat', sat: 'Saturated fat', fib: 'Fibre', salt: 'Salt' },
  sv: { kcal: 'Energi', carb: 'Kolhydrater', sugar: 'Sockerarter', prot: 'Protein', fat: 'Fett', sat: 'Mättat fett', fib: 'Fibrer', salt: 'Salt' }
};
const GOAL_TEXT = {
  en: { maintain: 'Your selected goal is to maintain weight.', lose: 'Your selected goal is to lose weight.', muscle: 'Your selected goal is to build muscle.', health: 'Your selected goal is general health.' },
  sv: { maintain: 'Ditt valda mål är att behålla vikten.', lose: 'Ditt valda mål är att gå ner i vikt.', muscle: 'Ditt valda mål är att bygga muskler.', health: 'Ditt valda mål är allmän hälsa.' }
};

/** Turn selected allow-listed codes into fixed text owned by this server. */
export function nutritionAnswer(codes, context) {
  const allowed = new Set(nutritionFactCodes(context));
  const selected = [...new Set(Array.isArray(codes) ? codes : [])].filter(code => allowed.has(code)).slice(0, 5);
  if (!selected.length) return null;
  const sv = context.language === 'sv';
  const lang = sv ? 'sv' : 'en';
  const observations = selected.map(code => {
    const [kind, key] = code.split(':');
    if (kind === 'goal') return GOAL_TEXT[lang][key];
    const name = NAMES[lang][key];
    if (kind === 'known') return sv ? `${name} har komplett underlag för dagen.` : `${name} has complete source data for the day.`;
    if (kind === 'missing') return sv ? `${name} är ofullständigt eftersom minst ett loggat livsmedel saknar värdet.` : `${name} is incomplete because at least one logged food lacks the value.`;
    return sv ? `Du har angett ett eget dagligt mål för ${name.toLowerCase()}.` : `You entered your own daily target for ${name.toLowerCase()}.`;
  });
  return {
    status: 'general',
    summary: sv
      ? 'AI valde vilka verifierade delar av loggen som lyfts fram. Den kunde inte skriva egen text eller skapa nya värden.'
      : 'AI selected which verified parts of the log to highlight. It could not write its own text or create new values.',
    observations,
    questions: []
  };
}

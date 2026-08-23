import { NUTRIENTS } from './foods.js'
import { bmr } from './nutrition.js'
import { weightIn } from './history.js'

export const NUTRITION_GOALS = ['maintain', 'lose', 'muscle', 'health']
export const NUTRIENT_TARGETS = [...NUTRIENTS]
export const INCRETIN_USES = ['none', 'weight', 'diabetes', 'both', 'other']
export const WEIGHT_PHASES = ['active_loss', 'maintenance']
export const FIBER_REFERENCES = ['range', 'female', 'male']
export const NUTRITION_SAFETY_KEYS = [
  'kidneyOrProteinRestriction', 'fluidOrSodiumRestriction',
  'pregnancyOrBreastfeeding', 'eatingDisorder', 'severeGI',
  'malnutritionRisk', 'otherClinicalNutrition', 'hypoglycemiaRiskMedication'
]

// Population references for healthy adults, not personalised intake targets.
export const NNR_REFERENCE = {
  source: 'Nordic Nutrition Recommendations 2023',
  audience: 'healthy adults',
  ranges: {
    carb: { min: 45, max: 60, unit: 'E%' },
    prot: { min: 10, max: 20, unit: 'E%' },
    fat: { min: 25, max: 40, unit: 'E%' },
    fib: { min: 3, unit: 'g/MJ' }
  }
}

const NNR = {
  source: 'Nordic Nutrition Recommendations 2023', year: 2023,
  sourceUrl: 'https://pub.norden.org/nord2023-003/recommendations.html',
  audience: 'Adults not pregnant, planning pregnancy or breastfeeding'
}
const JOINT = {
  source: 'ACLM/ASN/OMA/TOS joint advisory', year: 2025,
  sourceUrl: 'https://doi.org/10.1016/j.obpill.2025.100181',
  audience: 'Adults using GLP-1 therapy for obesity during active weight loss'
}
const EASO = {
  source: 'EASO/EFAD/ECPO clinical infographic', year: 2026,
  sourceUrl: 'https://easo.org/wp-content/uploads/2026/07/obesity-incretin-based-therapy_v6.pdf',
  audience: 'Adults using incretin-based therapy for obesity'
}

export const NUTRITION_REFERENCE_CATALOG = [
  { id: 'nnr-carb', layer: 'adult', nutrient: 'carb', kind: 'range', value: { min: 45, max: 60 }, unit: 'E%', digits: 0, daily: true, ...NNR, limitation: 'Population range, not a personal treatment target; Dagsnav does not convert E% to grams.' },
  { id: 'nnr-protein', layer: 'adult', nutrient: 'prot', kind: 'range', value: { min: 10, max: 20 }, unit: 'E%', digits: 0, daily: true, ...NNR, limitation: 'Population range, not a personal treatment target; Dagsnav does not convert E% to grams.' },
  { id: 'nnr-fat', layer: 'adult', nutrient: 'fat', kind: 'range', value: { min: 25, max: 40 }, unit: 'E%', digits: 0, daily: true, ...NNR, limitation: 'Population range, not a personal treatment target; Dagsnav does not convert E% to grams.' },
  { id: 'nnr-saturated', layer: 'adult', nutrient: 'sat', kind: 'max', value: 10, operator: '<', unit: 'E%', digits: 0, daily: true, ...NNR, limitation: 'Population maximum, not a personal treatment target; Dagsnav does not convert E% to grams.' },
  { id: 'nnr-fiber-range', layer: 'adult', nutrient: 'fib', kind: 'range', value: { min: 25, max: 35 }, unit: 'g/day', digits: 0, daily: true, targetField: 'fib', ...NNR, limitation: 'Population interval shown when no sex-specific NNR reference is selected.' },
  { id: 'nnr-fiber-female', layer: 'adult', nutrient: 'fib', kind: 'min', value: 25, operator: '≥', unit: 'g/day', digits: 0, daily: true, targetField: 'fib', ...NNR, limitation: 'NNR population minimum for women, selected explicitly by the user.' },
  { id: 'nnr-fiber-male', layer: 'adult', nutrient: 'fib', kind: 'min', value: 35, operator: '≥', unit: 'g/day', digits: 0, daily: true, targetField: 'fib', ...NNR, limitation: 'NNR population minimum for men, selected explicitly by the user.' },
  { id: 'nnr-salt', layer: 'adult', nutrient: 'salt', kind: 'max', value: 5.75, operator: '≤', unit: 'g/day', digits: 2, daily: true, targetField: 'salt', ...NNR, limitation: 'Equivalent to 2.3 g sodium; the displayed value is grams of salt.' },
  { id: 'nnr-free-sugar', layer: 'adult', nutrient: 'sugar', kind: 'max', value: 10, operator: '<', unit: 'E%', digits: 0, daily: false, ...NNR, limitation: 'This upper reference is for added and free sugar. Dagsnav logs total sugar and cannot compare the two.' },
  { id: 'glp-protein-example', layer: 'glp1', nutrient: 'prot', kind: 'example', value: { min: 80, max: 120 }, unit: 'g/day', digits: 0, daily: true, ...JOINT, limitation: 'Practical source example during active weight loss, equivalent in the source to 16–24 E% at 2,000 kcal. It is not a GLP-1-specific RDA or personal target, and Dagsnav does not scale it from energy intake.' },
  { id: 'glp-protein-reference-weight', layer: 'glp1', nutrient: 'prot', kind: 'range', value: { min: 1, max: 1.5 }, unit: 'g/kg adjusted reference weight/day', digits: 1, daily: false, ...EASO, limitation: 'Requires a clinician-provided adjusted reference weight; Dagsnav does not calculate grams from current weight.' },
  { id: 'glp-protein-floor', layer: 'glp1', nutrient: 'prot', kind: 'min', value: 60, operator: '≥', unit: 'g/day', digits: 0, daily: false, ...EASO, limitation: 'Minimum within the adjusted-reference-weight recommendation, not a separate personal target.' },
  { id: 'glp-fiber', layer: 'glp1', nutrient: 'fib', kind: 'min', value: 25, operator: '≥', unit: 'g/day', digits: 0, daily: true, targetField: 'fib', ...EASO, limitation: 'Increase gradually together with adequate fluid; individual restrictions take priority.' },
  { id: 'glp-fluid', layer: 'glp1', nutrient: 'fluid', kind: 'range', value: { min: 2, max: 2.5 }, unit: 'L/day', digits: 1, daily: false, ...EASO, limitation: 'Reference only; it must be adapted for heart, kidney or prescribed fluid restrictions.' },
  { id: 'glp-energy-1500', layer: 'glp1', nutrient: 'kcal', kind: 'warning', value: 1500, operator: '<', unit: 'kcal/day', digits: 0, daily: false, ...EASO, limitation: 'Below this level the source identifies high micronutrient inadequacy risk; this is not a target.' },
  { id: 'glp-energy-1200', layer: 'glp1', nutrient: 'kcal', kind: 'warning', value: 1200, operator: '<', unit: 'kcal/day', digits: 0, daily: false, ...EASO, limitation: 'Below this level the source says supplementation may need consideration; Dagsnav refers to clinical nutrition review and recommends no supplement.' },
  { id: 'glp-energy-800', layer: 'glp1', nutrient: 'kcal', kind: 'warning', value: 800, operator: '<', unit: 'kcal/day', digits: 0, daily: false, ...EASO, limitation: 'Below this level the source calls for clinical treatment review.' }
]

const numberOf = value => typeof value === 'number'
  ? value
  : typeof value === 'string' && value.trim() ? Number(value) : NaN

const nonnegative = value => {
  const n = numberOf(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const triState = value => value === true || value === false ? value : null
const isoDayNumber = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const stamp = Date.UTC(year, month - 1, day)
  return new Date(stamp).toISOString().slice(0, 10) === value ? stamp / 86400000 : null
}
const cleanIsoDay = value => isoDayNumber(value) == null ? null : value
const allSafetyAnswered = profile => NUTRITION_SAFETY_KEYS.every(key => typeof profile.safety[key] === 'boolean')
export const nutritionSafetyToday = (now = new Date()) => now.toISOString().slice(0, 10)

/** Normalise user-entered daily targets without inventing any. */
export function cleanNutritionProfile(profile = {}) {
  profile = profile || {}
  const targets = profile.targets || {}
  return {
    goal: NUTRITION_GOALS.includes(profile.goal) ? profile.goal : null,
    targets: Object.fromEntries(NUTRIENT_TARGETS.map(key => [key, nonnegative(targets[key])])),
    condition: profile.condition === true,
    medication: profile.medication === true,
    incretinUse: INCRETIN_USES.includes(profile.incretinUse) ? profile.incretinUse : null,
    weightPhase: WEIGHT_PHASES.includes(profile.weightPhase) ? profile.weightPhase : null,
    fiberReference: FIBER_REFERENCES.includes(profile.fiberReference) ? profile.fiberReference : 'range',
    safety: Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, triState(profile.safety?.[key])])),
    safetyReviewedAt: cleanIsoDay(profile.safetyReviewedAt),
    targetReviewRequired: profile.targetReviewRequired === true
  }
}

export function safetyReviewCurrent(reviewedAt, today) {
  const reviewed = isoDayNumber(reviewedAt), current = isoDayNumber(today)
  if (reviewed == null || current == null) return false
  const days = current - reviewed
  return days >= 0 && days <= 90
}

export function finalizeNutritionProfile(previous, draft, { safetyConfirmedAt = null, targetsReviewed = false } = {}) {
  const before = cleanNutritionProfile(previous)
  const next = cleanNutritionProfile(draft)
  const safetyChanged = NUTRITION_SAFETY_KEYS.some(key => before.safety[key] !== next.safety[key])
  const contextChanged = safetyChanged || before.incretinUse !== next.incretinUse ||
    before.weightPhase !== next.weightPhase || before.condition !== next.condition ||
    before.medication !== next.medication
  next.safetyReviewedAt = contextChanged ? null : before.safetyReviewedAt
  if (cleanIsoDay(safetyConfirmedAt) && allSafetyAnswered(next)) next.safetyReviewedAt = safetyConfirmedAt

  const riskChanged = NUTRITION_SAFETY_KEYS.some(key =>
    before.safety[key] !== next.safety[key] && (before.safety[key] === true || next.safety[key] === true))
  next.targetReviewRequired = before.targetReviewRequired || next.targetReviewRequired || riskChanged
  if (targetsReviewed === true && !riskChanged) next.targetReviewRequired = false
  return next
}

const ALL_TARGETS = [...NUTRIENT_TARGETS]
const ADULT_IDS = NUTRITION_REFERENCE_CATALOG.filter(item => item.layer === 'adult').map(item => item.id)
const GLP_IDS = NUTRITION_REFERENCE_CATALOG.filter(item => item.layer === 'glp1').map(item => item.id)
const FIBER_IDS = ['nnr-fiber-range', 'nnr-fiber-female', 'nnr-fiber-male']
const GLP_PROTEIN_IDS = ['glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor']
const GLP_ENERGY_IDS = ['glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']

const SAFETY_RULES = {
  kidneyOrProteinRestriction: { hide: ['nnr-protein', 'nnr-salt', ...GLP_PROTEIN_IDS, 'glp-fluid'], pause: ['prot', 'salt'], severity: 'note', message: 'Protein, salt and fluid references need professional adaptation for kidney disease or a prescribed protein restriction.' },
  fluidOrSodiumRestriction: { hide: ['nnr-salt', 'glp-fluid'], pause: ['salt'], severity: 'note', message: 'Salt and fluid references need professional adaptation for a prescribed fluid or sodium restriction.' },
  pregnancyOrBreastfeeding: { hide: [...ADULT_IDS, ...GLP_IDS], pause: ALL_TARGETS, severity: 'note', message: 'Pregnancy, pregnancy planning and breastfeeding need different nutrition references.' },
  eatingDisorder: { hide: [...ADULT_IDS, ...GLP_IDS], pause: ALL_TARGETS, severity: 'note', message: 'Automatic nutrition references are paused when an eating disorder or severe restriction may be relevant.' },
  severeGI: { hide: [...FIBER_IDS, ...GLP_PROTEIN_IDS, 'glp-fiber', 'glp-fluid', ...GLP_ENERGY_IDS], pause: ['kcal', 'prot', 'fib'], severity: 'alert', message: 'Severe abdominal pain, persistent vomiting, dehydration signs, or severe constipation with pain, bloating or vomiting need prompt medical assessment.' },
  malnutritionRisk: { hide: [...ADULT_IDS, ...GLP_IDS], pause: ALL_TARGETS, severity: 'note', message: 'Unintentional rapid weight loss, reduced intake or new weakness needs professional nutrition assessment.' },
  otherClinicalNutrition: { hide: GLP_IDS, pause: ALL_TARGETS, severity: 'note', message: 'Your existing clinical nutrition plan takes priority over these general GLP-1 references.' },
  hypoglycemiaRiskMedication: { hide: ['nnr-carb', ...GLP_ENERGY_IDS], pause: ['kcal', 'carb'], severity: 'alert', message: 'Do not change energy or carbohydrate targets without your diabetes care plan. Follow your prescribed emergency plan and seek urgent help for acute severe hypoglycaemia; repeated episodes need contact with your diabetes team.' }
}

const ageOf = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 18 && number <= 100 ? number : null
}

export function nutritionReferenceState(rawProfile, { age, today } = {}) {
  const profile = cleanNutritionProfile(rawProfile)
  const hidden = new Set(), paused = new Set(), notices = []
  for (const key of NUTRITION_SAFETY_KEYS) {
    if (profile.safety[key] !== true) continue
    const rule = SAFETY_RULES[key]
    rule.hide.forEach(id => hidden.add(id))
    rule.pause.forEach(target => paused.add(target))
    notices.push({ code: `safety:${key}`, severity: rule.severity, message: rule.message })
  }
  if (profile.targetReviewRequired) {
    ALL_TARGETS.forEach(target => paused.add(target))
    notices.push({ code: 'targets:review', severity: 'note', message: 'Your own targets stay paused until you confirm that you have reviewed them.' })
  }

  if (ageOf(age) == null) return {
    adultStatus: 'age_required', glpStatus: 'not_applicable', references: [],
    pausedTargets: ALL_TARGETS.filter(key => paused.has(key)), energySignal: null, notices
  }
  if (profile.safety.pregnancyOrBreastfeeding !== false) return {
    adultStatus: profile.safety.pregnancyOrBreastfeeding === true ? 'professional_review' : 'pregnancy_required',
    glpStatus: profile.safety.pregnancyOrBreastfeeding === true ? 'blocked' : 'safety_incomplete',
    references: [], pausedTargets: ALL_TARGETS.filter(key => paused.has(key)), energySignal: null, notices
  }

  const selectedFiber = `nnr-fiber-${profile.fiberReference}`
  let references = NUTRITION_REFERENCE_CATALOG.filter(item =>
    item.layer === 'adult' && (!FIBER_IDS.includes(item.id) || item.id === selectedFiber))
  let glpStatus = 'not_applicable', glpEligible = false
  if (profile.incretinUse === 'weight' || profile.incretinUse === 'both') {
    if (!WEIGHT_PHASES.includes(profile.weightPhase)) glpStatus = 'phase_required'
    else if (!allSafetyAnswered(profile)) glpStatus = 'safety_incomplete'
    else if (!safetyReviewCurrent(profile.safetyReviewedAt, today)) glpStatus = 'safety_expired'
    else {
      glpEligible = true
      glpStatus = 'available'
      references.push(...NUTRITION_REFERENCE_CATALOG.filter(item => item.layer === 'glp1' &&
        (profile.weightPhase === 'active_loss' || item.id !== 'glp-protein-example')))
    }
  }

  references = references.filter(item => !hidden.has(item.id))
  if (glpEligible && references.every(item => item.layer !== 'glp1')) glpStatus = 'blocked'
  const adultStatus = references.some(item => item.layer === 'adult') ? 'available' : 'professional_review'

  let energySignal = null
  const kcal = profile.targets.kcal
  if (glpEligible && kcal > 0 && !paused.has('kcal') && !hidden.has('glp-energy-800')) {
    energySignal = kcal < 800 ? 'under_800' : kcal < 1200 ? 'under_1200' : kcal < 1500 ? 'under_1500' : null
    if (energySignal) notices.push({
      code: `energy:${energySignal}`,
      severity: energySignal === 'under_800' ? 'alert' : 'note',
      message: energySignal === 'under_800'
        ? 'This energy target is below 800 kcal/day and is paused pending clinical review.'
        : energySignal === 'under_1200'
          ? 'This energy target is below 1,200 kcal/day and needs clinical nutrition review.'
          : 'This energy target is below 1,500 kcal/day, where the source identifies high micronutrient inadequacy risk.'
    })
    if (energySignal === 'under_800') paused.add('kcal')
  }
  return {
    adultStatus, glpStatus, references,
    pausedTargets: ALL_TARGETS.filter(key => paused.has(key)), energySignal, notices
  }
}

export function formatNutritionReference(reference, locale = 'en-GB', unit = reference.unit) {
  const fmt = value => Number(value).toLocaleString(locale, {
    minimumFractionDigits: reference.digits,
    maximumFractionDigits: reference.digits
  })
  const value = typeof reference.value === 'object'
    ? `${fmt(reference.value.min)}–${fmt(reference.value.max)}`
    : `${reference.operator || ''}${fmt(reference.value)}`
  return `${value} ${unit}`
}

/** Resting-energy estimate only; it is never copied into an intake target. */
export function bmrEstimate({ sex, age, heightCm, weightKg } = {}) {
  const values = [age, heightCm, weightKg].map(numberOf)
  const [adultAge, height, weight] = values
  if ((sex !== 'male' && sex !== 'female') || !values.every(Number.isFinite) || adultAge < 18 || height <= 0 || weight <= 0) return null
  return bmr({ sex, age: adultAge, heightCm: height, weightKg: weight })
}

/** Convert only a weight whose unit was stored with the measurement. */
export function weightKgOf(entry) {
  return weightIn(entry, 'kg')
}

/** Medical contexts must use a complete target set supplied by the person's clinician. */
export const needsClinicianTargets = (profile, { diabetes = false } = {}) => {
  const clean = cleanNutritionProfile(profile)
  return diabetes === true || clean.condition || clean.medication ||
    (clean.incretinUse != null && clean.incretinUse !== 'none') ||
    NUTRITION_SAFETY_KEYS.some(key => clean.safety[key] === true)
}

export function nutritionAiGate(profile, { age, today, diabetes = false } = {}) {
  const clean = cleanNutritionProfile(profile)
  return ageOf(age) == null || diabetes === true || clean.condition || clean.medication ||
    clean.incretinUse !== 'none' || clean.weightPhase !== null ||
    !NUTRITION_SAFETY_KEYS.every(key => clean.safety[key] === false) ||
    !safetyReviewCurrent(clean.safetyReviewedAt, today) || clean.targetReviewRequired
}

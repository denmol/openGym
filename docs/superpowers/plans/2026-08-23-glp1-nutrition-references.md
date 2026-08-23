# Scientific Adult and GLP-1 Nutrition References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visa källmärkta befolkningsreferenser för vuxna och ett fail-closed GLP-1-lager utan att skapa personliga mål, läcka medicinska uppgifter till AI eller ändra befintliga manuella mål.

**Architecture:** Utöka den befintliga rena modulen `nutrition-goals.js` med strikt profilnormalisering, en statisk referenskatalog och en enda härledd view model som både målarket och kostvyn använder. Klienten spärrar konservativt, medan API:t gör ett oberoende beslut från sparad serverstat innan kvot eller OpenAI kan nås; modellen får även fortsättningsvis endast allow-listade faktakoder.

**Tech Stack:** React 19, Vite, zustand, Vitest, Node 22 `node:test`; inga nya beroenden.

**Spec:** `docs/superpowers/specs/2026-08-23-glp1-nutrition-references-design.md`

## Global Constraints

- Engelska källsträngar är i18n-nycklar; endast svenska översättningar läggs till i `frontend/src/locales/sv.js`.
- Referenser får aldrig sparas som mål eller skriva över `nutritionGoals.targets`.
- Ingen bolusräknare, insulin–kolhydratkvot, korrektionsfaktor, insulin-on-board eller kolhydratråd vid lågt glukos.
- Ingen viktbaserad proteinuträkning, inget BMR-baserat dagsmål och ingen E%-till-gram-omräkning.
- `null`, tom sträng, boolean, noll eller ogiltigt datum får inte bli ett rimligt referensvärde på fel plats.
- Salt ska vara exakt `5.75 g/day` i data och `5,75 g/dag` i svensk visning; vätska ska visas `2,0–2,5 liter/dag`.
- Totalsocker i matloggen får aldrig jämföras med NNR:s gräns för tillsatt/fritt socker.
- `daily` betyder endast att referensen får visas som en separat rad i kostvyn; den utlöser aldrig automatisk jämförelse. Endast ett explicit `targetField` får visa knappen som fokuserar ett manuellt fält i samma enhet.
- Saknade eller mer än 90 dagar gamla säkerhetssvar stänger GLP-1-referenser och AI-vägen fail-closed.
- 90-dagarsregeln använder UTC-kalenderdag på både klient och server; lokal `todayISO()` får inte användas för säkerhetsbeslutet.
- All medicinsk information stannar i användarens Dagsnav-state; inga enumvärden, risknycklar, datum, demografi eller tal skickas till modellen.
- Ingen ändring i `useStore.js`, diabetesprofilen, Dockerfilerna eller några dependencies.

## File Map

- `frontend/src/lib/nutrition-goals.js` — profilnormalisering, 90-dagarsregel, säkerhetsövergångar, referenskatalog, spärrmatris, formattering och klientens AI-spärr.
- `frontend/src/lib/nutrition-goals.test.js` — exakta värde-, gräns-, matris- och övergångstester.
- `frontend/src/lib/nutrition-assist.js` — bygger enbart en generell `medical.nutritionSafety`-flagga och använder samma klientspärr.
- `frontend/src/lib/nutrition-assist.test.js` — verifierar fail-closed och att detaljerade medicinska fält inte hamnar i assist-kontexten.
- `api/nutrition-context.js` — oberoende normalisering av sparad serverstat, AI/local-beslut och minimal AI-payload.
- `api/nutrition-context.test.js` — verifierar serverauktoritet, dag 90/91 och exakt payload.
- `api/server.js` — använder det rena beslutet före kvot och modell.
- `frontend/src/nutrition-sheets.jsx` — redigering, bekräftelser, källkort och befintliga manuella målfält.
- `frontend/src/views/Food.jsx` — separata rader för nuvärde, eget mål och referens samt paus-/varningsstatus.
- `frontend/src/index.css` — tvåknappsgrupp och referenskort; befintliga färger och kortmönster återanvänds.
- `frontend/src/locales/sv.js` — svenska strängar för de nya kontrollerna, källkorten och fasta säkerhetstexterna.

---

### Task 1: Strict nutrition profile and sticky safety lifecycle

**Files:**
- Modify: `frontend/src/lib/nutrition-goals.js:5-39`
- Test: `frontend/src/lib/nutrition-goals.test.js:1-45`

**Interfaces:**
- Consumes: befintliga `NUTRIENTS`, `NUTRITION_GOALS` och scalar `targets`.
- Produces: `NUTRITION_SAFETY_KEYS`, `cleanNutritionProfile(profile)`, `nutritionSafetyToday(now)`, `safetyReviewCurrent(reviewedAt, today)`, `finalizeNutritionProfile(previous, draft, options)` och den utökade normaliserade profilformen.

- [ ] **Step 1: Write failing normalization and transition tests**

Lägg `NUTRITION_SAFETY_KEYS`, `finalizeNutritionProfile`, `nutritionSafetyToday` och `safetyReviewCurrent` i det befintliga importblocket. Lägg sedan till dessa fixtures och tester; uppdatera de två befintliga full-shape-assertionerna så de förväntar samma nya fält:

```js
const SAFE = {
  kidneyOrProteinRestriction: false,
  fluidOrSodiumRestriction: false,
  pregnancyOrBreastfeeding: false,
  eatingDisorder: false,
  severeGI: false,
  malnutritionRisk: false,
  otherClinicalNutrition: false,
  hypoglycemiaRiskMedication: false
}

it('normalises enums, real dates and only exact tri-state booleans', () => {
  const profile = cleanNutritionProfile({
    goal: 'lose', targets: completeTargets,
    incretinUse: 'weight', weightPhase: 'active_loss', fiberReference: 'female',
    safety: { ...SAFE, severeGI: 'false', eatingDisorder: 0 },
    safetyReviewedAt: '2026-02-30', targetReviewRequired: true
  })
  expect(profile.incretinUse).toBe('weight')
  expect(profile.weightPhase).toBe('active_loss')
  expect(profile.fiberReference).toBe('female')
  expect(profile.safety.severeGI).toBeNull()
  expect(profile.safety.eatingDisorder).toBeNull()
  expect(profile.safetyReviewedAt).toBeNull()
  expect(profile.targetReviewRequired).toBe(true)
  expect(profile.targets).toEqual(completeTargets)
})

it('migrates missing fields fail-closed without touching manual targets', () => {
  const profile = cleanNutritionProfile({ goal: 'health', targets: completeTargets })
  expect(profile.incretinUse).toBeNull()
  expect(profile.weightPhase).toBeNull()
  expect(profile.fiberReference).toBe('range')
  expect(profile.safety).toEqual(Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, null])))
  expect(profile.safetyReviewedAt).toBeNull()
  expect(profile.targetReviewRequired).toBe(false)
  expect(profile.targets).toEqual(completeTargets)
})

it('accepts day 90 but rejects day 91, future and invalid review dates', () => {
  expect(safetyReviewCurrent('2026-05-25', '2026-08-23')).toBe(true)
  expect(safetyReviewCurrent('2026-05-24', '2026-08-23')).toBe(false)
  expect(safetyReviewCurrent('2026-08-24', '2026-08-23')).toBe(false)
  expect(safetyReviewCurrent('2026-02-30', '2026-08-23')).toBe(false)
})

it('uses one UTC calendar day across client time zones', () => {
  expect(nutritionSafetyToday(new Date('2026-08-23T00:30:00+02:00'))).toBe('2026-08-22')
  expect(nutritionSafetyToday(new Date('2026-08-22T23:30:00-02:00'))).toBe('2026-08-23')
})

it('keeps target review sticky across a risk removal', () => {
  const base = { goal: 'lose', targets: completeTargets, incretinUse: 'weight', weightPhase: 'active_loss', safety: SAFE, safetyReviewedAt: '2026-08-23' }
  const risky = finalizeNutritionProfile(base, { ...base, safety: { ...SAFE, severeGI: true } }, { safetyConfirmedAt: '2026-08-23' })
  expect(risky.targetReviewRequired).toBe(true)
  const removed = finalizeNutritionProfile(risky, { ...risky, safety: SAFE }, { safetyConfirmedAt: '2026-08-23', targetsReviewed: true })
  expect(removed.targetReviewRequired).toBe(true)
  const reviewed = finalizeNutritionProfile(removed, removed, { targetsReviewed: true })
  expect(reviewed.targetReviewRequired).toBe(false)
  expect(reviewed.targets).toEqual(completeTargets)
})

it.each([
  ['incretin use', draft => ({ ...draft, incretinUse: 'both' })],
  ['weight phase', draft => ({ ...draft, weightPhase: 'maintenance' })],
  ['condition', draft => ({ ...draft, condition: true })],
  ['medication', draft => ({ ...draft, medication: true })],
  ['safety answer', draft => ({ ...draft, safety: { ...draft.safety, severeGI: true } })]
])('invalidates the safety date when %s changes', (_name, change) => {
  const base = { goal: 'lose', incretinUse: 'weight', weightPhase: 'active_loss', safety: SAFE, safetyReviewedAt: '2026-08-23' }
  expect(finalizeNutritionProfile(base, change(base)).safetyReviewedAt).toBeNull()
})

it('accepts a new confirmation only after every tri-state answer is explicit', () => {
  const incomplete = { goal: 'health', incretinUse: 'none', safety: { ...SAFE, severeGI: null } }
  expect(finalizeNutritionProfile(null, incomplete, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBeNull()
  expect(finalizeNutritionProfile(null, { ...incomplete, safety: SAFE }, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBe('2026-08-23')
})
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js`

Expected: FAIL because `NUTRITION_SAFETY_KEYS`, `safetyReviewCurrent` and `finalizeNutritionProfile` do not exist and the old profile drops every new field.

- [ ] **Step 3: Implement strict normalization and transition rules**

Behåll `bmrEstimate`, `weightKgOf` och nuvarande target-normalisering. Lägg till följande form och hjälpare i `nutrition-goals.js`:

```js
export const INCRETIN_USES = ['none', 'weight', 'diabetes', 'both', 'other']
export const WEIGHT_PHASES = ['active_loss', 'maintenance']
export const FIBER_REFERENCES = ['range', 'female', 'male']
export const NUTRITION_SAFETY_KEYS = [
  'kidneyOrProteinRestriction', 'fluidOrSodiumRestriction',
  'pregnancyOrBreastfeeding', 'eatingDisorder', 'severeGI',
  'malnutritionRisk', 'otherClinicalNutrition', 'hypoglycemiaRiskMedication'
]

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
  if (contextChanged) next.safetyReviewedAt = null
  if (cleanIsoDay(safetyConfirmedAt) && allSafetyAnswered(next)) next.safetyReviewedAt = safetyConfirmedAt

  const riskChanged = NUTRITION_SAFETY_KEYS.some(key =>
    before.safety[key] !== next.safety[key] && (before.safety[key] === true || next.safety[key] === true))
  next.targetReviewRequired = before.targetReviewRequired || next.targetReviewRequired || riskChanged
  if (targetsReviewed === true && !riskChanged) next.targetReviewRequired = false
  return next
}
```

- [ ] **Step 4: Run the profile tests and verify green**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js`

Expected: PASS, including unchanged exact BMR and weight-unit tests.

- [ ] **Step 5: Commit the strict profile layer**

```bash
git add frontend/src/lib/nutrition-goals.js frontend/src/lib/nutrition-goals.test.js
git commit -m "Add strict nutrition safety profile"
```

---

### Task 2: Deterministic sourced reference engine

**Files:**
- Modify: `frontend/src/lib/nutrition-goals.js`
- Test: `frontend/src/lib/nutrition-goals.test.js`

**Interfaces:**
- Consumes: normalized profile and `{ age, today }`; deliberately consumes no weight, BMR, activity or food-log totals.
- Produces: `NUTRITION_REFERENCE_CATALOG`, `nutritionReferenceState(profile, { age, today })`, `formatNutritionReference(reference, locale, unit)`.

- [ ] **Step 1: Write failing exact-value, gate and matrix tests**

Lägg `NUTRITION_REFERENCE_CATALOG`, `nutritionReferenceState` och `formatNutritionReference` i testets befintliga importblock. Lägg sedan till en aktuell GLP-fixture och tabellstyrda assertioner:

```js
const CURRENT_GLP = {
  goal: 'lose', targets: completeTargets,
  incretinUse: 'weight', weightPhase: 'active_loss', fiberReference: 'range',
  safety: SAFE, safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}
const reference = (state, id) => state.references.find(item => item.id === id)

it('returns exact adult values and never turns free sugar into a log target', () => {
  const state = nutritionReferenceState(CURRENT_GLP, { age: 18, today: '2026-08-23' })
  expect(reference(state, 'nnr-carb').value).toEqual({ min: 45, max: 60 })
  expect(reference(state, 'nnr-protein').value).toEqual({ min: 10, max: 20 })
  expect(reference(state, 'nnr-fat').value).toEqual({ min: 25, max: 40 })
  expect(reference(state, 'nnr-saturated')).toMatchObject({ value: 10, operator: '<' })
  expect(reference(state, 'nnr-salt').value).toBe(5.75)
  expect(reference(state, 'nnr-free-sugar')).toMatchObject({ kind: 'max', value: 10, operator: '<', daily: false })
  expect(reference(state, 'nnr-fiber-range').value).toEqual({ min: 25, max: 35 })
})

it('returns the sourced GLP values without deriving a personal number', () => {
  const state = nutritionReferenceState(CURRENT_GLP, { age: 40, today: '2026-08-23' })
  expect(reference(state, 'glp-protein-example').value).toEqual({ min: 80, max: 120 })
  expect(reference(state, 'glp-protein-reference-weight').value).toEqual({ min: 1, max: 1.5 })
  expect(reference(state, 'glp-protein-floor').value).toBe(60)
  expect(reference(state, 'glp-fiber').value).toBe(25)
  expect(reference(state, 'glp-fluid').value).toEqual({ min: 2, max: 2.5 })
  expect(reference(state, 'glp-energy-1500').value).toBe(1500)
  expect(reference(state, 'glp-energy-1200').value).toBe(1200)
  expect(reference(state, 'glp-energy-800').value).toBe(800)
})

it('requires adult age and an explicit non-pregnancy answer', () => {
  expect(nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, pregnancyOrBreastfeeding: false } }, { age: 17, today: '2026-08-23' }).references).toEqual([])
  expect(nutritionReferenceState(CURRENT_GLP, { age: 18, today: '2026-08-23' }).adultStatus).toBe('available')
  expect(nutritionReferenceState(CURRENT_GLP, { age: 100, today: '2026-08-23' }).adultStatus).toBe('available')
  expect(nutritionReferenceState(CURRENT_GLP, { age: 101, today: '2026-08-23' }).references).toEqual([])
  expect(nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, pregnancyOrBreastfeeding: null } }, { age: 18, today: '2026-08-23' }).adultStatus).toBe('pregnancy_required')
  expect(nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, pregnancyOrBreastfeeding: true } }, { age: 18, today: '2026-08-23' }).pausedTargets).toEqual(NUTRIENT_TARGETS)
})

it('uses the explicit fibre reference and ignores body or current weight', () => {
  const female = nutritionReferenceState({ ...CURRENT_GLP, fiberReference: 'female', body: 'male', weightKg: 80 }, { age: 40, today: '2026-08-23', weightKg: 80 })
  const male = nutritionReferenceState({ ...CURRENT_GLP, fiberReference: 'male' }, { age: 40, today: '2026-08-23' })
  expect(reference(female, 'nnr-fiber-female').value).toBe(25)
  expect(reference(male, 'nnr-fiber-male').value).toBe(35)
  expect(reference(female, 'glp-protein-reference-weight').value).toEqual({ min: 1, max: 1.5 })
  expect(female.references.some(item => item.derivedGrams != null)).toBe(false)
})

it('uses strict energy thresholds only from the manual target', () => {
  const signal = kcal => nutritionReferenceState({ ...CURRENT_GLP, targets: { ...completeTargets, kcal } }, { age: 40, today: '2026-08-23' })
  expect(signal(1500).energySignal).toBeNull()
  expect(signal(1499.9).energySignal).toBe('under_1500')
  expect(signal(1200).energySignal).toBe('under_1500')
  expect(signal(1199.9).energySignal).toBe('under_1200')
  expect(signal(800).energySignal).toBe('under_1200')
  expect(signal(799.9).energySignal).toBe('under_800')
  expect(signal(799.9).pausedTargets).toContain('kcal')
  expect(signal(0).energySignal).toBeNull()
})

it.each([
  ['kidneyOrProteinRestriction', ['prot', 'salt']],
  ['fluidOrSodiumRestriction', ['salt']],
  ['pregnancyOrBreastfeeding', NUTRIENT_TARGETS],
  ['eatingDisorder', NUTRIENT_TARGETS],
  ['severeGI', ['kcal', 'prot', 'fib']],
  ['malnutritionRisk', NUTRIENT_TARGETS],
  ['otherClinicalNutrition', NUTRIENT_TARGETS],
  ['hypoglycemiaRiskMedication', ['kcal', 'carb']]
])('pauses the exact safety-matrix targets for %s', (key, expected) => {
  const state = nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, [key]: true } }, { age: 40, today: '2026-08-23' })
  expect(state.pausedTargets).toEqual(expected)
})

it('keeps source precision in Swedish display', () => {
  const state = nutritionReferenceState(CURRENT_GLP, { age: 40, today: '2026-08-23' })
  expect(formatNutritionReference(reference(state, 'nnr-salt'), 'sv-SE', 'g/dag')).toBe('≤5,75 g/dag')
  expect(formatNutritionReference(reference(state, 'glp-fluid'), 'sv-SE', 'liter/dag')).toBe('2,0–2,5 liter/dag')
  expect(formatNutritionReference(reference(state, 'glp-protein-reference-weight'), 'sv-SE', 'g/kg justerad referensvikt/dag')).toBe('1,0–1,5 g/kg justerad referensvikt/dag')
})
```

Lägg till dessa konkreta kompletteringar:

```js
it('blocks GLP at day 91 and for non-weight indications', () => {
  const expired = nutritionReferenceState({ ...CURRENT_GLP, safetyReviewedAt: '2026-05-24' }, { age: 40, today: '2026-08-23' })
  expect(expired.glpStatus).toBe('safety_expired')
  expect(expired.references.every(item => item.layer !== 'glp1')).toBe(true)
  for (const incretinUse of ['diabetes', 'other', 'none', null]) {
    const state = nutritionReferenceState({ ...CURRENT_GLP, incretinUse }, { age: 40, today: '2026-08-23' })
    expect(state.glpStatus).toBe('not_applicable')
    expect(state.references.every(item => item.layer !== 'glp1')).toBe(true)
  }
})

it('removes only the active-loss protein example during maintenance', () => {
  const state = nutritionReferenceState({ ...CURRENT_GLP, weightPhase: 'maintenance' }, { age: 40, today: '2026-08-23' })
  expect(reference(state, 'glp-protein-example')).toBeUndefined()
  expect(reference(state, 'glp-protein-reference-weight')).toBeDefined()
  expect(reference(state, 'glp-fluid')).toBeDefined()
})

it('pauses all comparisons while sticky target review remains', () => {
  const state = nutritionReferenceState({ ...CURRENT_GLP, targetReviewRequired: true }, { age: 40, today: '2026-08-23' })
  expect(state.pausedTargets).toEqual(NUTRIENT_TARGETS)
})

it.each([
  ['pregnancyOrBreastfeeding', NUTRITION_REFERENCE_CATALOG.map(item => item.id)],
  ['eatingDisorder', NUTRITION_REFERENCE_CATALOG.map(item => item.id)],
  ['malnutritionRisk', NUTRITION_REFERENCE_CATALOG.map(item => item.id)],
  ['kidneyOrProteinRestriction', ['nnr-protein', 'nnr-salt', 'glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor', 'glp-fluid']],
  ['fluidOrSodiumRestriction', ['nnr-salt', 'glp-fluid']],
  ['severeGI', ['nnr-fiber-range', 'glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor', 'glp-fiber', 'glp-fluid', 'glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']],
  ['otherClinicalNutrition', ['glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor', 'glp-fiber', 'glp-fluid', 'glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']],
  ['hypoglycemiaRiskMedication', ['nnr-carb', 'glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']]
])('hides the exact references for %s', (key, hidden) => {
  const ids = nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, [key]: true } }, { age: 40, today: '2026-08-23' })
    .references.map(item => item.id)
  for (const id of hidden) expect(ids).not.toContain(id)
})

it('locks reference kind, operator, placement and source family for every catalogue row', () => {
  const NNR_URL = 'https://pub.norden.org/nord2023-003/recommendations.html'
  const JOINT_URL = 'https://doi.org/10.1016/j.obpill.2025.100181'
  const EASO_URL = 'https://easo.org/wp-content/uploads/2026/07/obesity-incretin-based-therapy_v6.pdf'
  const families = {
    nnr: ['Nordic Nutrition Recommendations 2023', 2023, NNR_URL, 'Adults not pregnant, planning pregnancy or breastfeeding'],
    joint: ['ACLM/ASN/OMA/TOS joint advisory', 2025, JOINT_URL, 'Adults using GLP-1 therapy for obesity during active weight loss'],
    easo: ['EASO/EFAD/ECPO clinical infographic', 2026, EASO_URL, 'Adults using incretin-based therapy for obesity']
  }
  const expected = [
    ['nnr-carb', 'range', null, true, null, 'nnr'],
    ['nnr-protein', 'range', null, true, null, 'nnr'],
    ['nnr-fat', 'range', null, true, null, 'nnr'],
    ['nnr-saturated', 'max', '<', true, null, 'nnr'],
    ['nnr-fiber-range', 'range', null, true, 'fib', 'nnr'],
    ['nnr-fiber-female', 'min', '≥', true, 'fib', 'nnr'],
    ['nnr-fiber-male', 'min', '≥', true, 'fib', 'nnr'],
    ['nnr-salt', 'max', '≤', true, 'salt', 'nnr'],
    ['nnr-free-sugar', 'max', '<', false, null, 'nnr'],
    ['glp-protein-example', 'example', null, true, null, 'joint'],
    ['glp-protein-reference-weight', 'range', null, false, null, 'easo'],
    ['glp-protein-floor', 'min', '≥', false, null, 'easo'],
    ['glp-fiber', 'min', '≥', true, 'fib', 'easo'],
    ['glp-fluid', 'range', null, false, null, 'easo'],
    ['glp-energy-1500', 'warning', '<', false, null, 'easo'],
    ['glp-energy-1200', 'warning', '<', false, null, 'easo'],
    ['glp-energy-800', 'warning', '<', false, null, 'easo']
  ]
  for (const [id, kind, operator, daily, targetField, family] of expected) {
    const item = NUTRITION_REFERENCE_CATALOG.find(reference => reference.id === id)
    const [source, year, sourceUrl, audience] = families[family]
    expect(item).toMatchObject({ id, kind, daily, source, year, sourceUrl, audience })
    expect(item.operator ?? null).toBe(operator)
    expect(item.targetField ?? null).toBe(targetField)
  }
  expect(NUTRITION_REFERENCE_CATALOG).toHaveLength(expected.length)
})

it('keeps hypoglycaemia safety text within the approved medical boundary', () => {
  const state = nutritionReferenceState({
    ...CURRENT_GLP, safety: { ...SAFE, hypoglycemiaRiskMedication: true }
  }, { age: 40, today: '2026-08-23' })
  const message = state.notices.find(notice => notice.code === 'safety:hypoglycemiaRiskMedication').message
  expect(message).toContain('prescribed emergency plan')
  expect(message).toContain('urgent help')
  expect(message).toContain('repeated episodes')
  expect(message).toContain('diabetes team')
  expect(/carbohydrate amount|bolus|correction factor|insulin-on-board/i.test(message)).toBe(false)
})
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js`

Expected: FAIL because katalogen, view model och formatteraren inte finns.

- [ ] **Step 3: Add the immutable source catalogue**

Lägg katalogen i samma modul; använd exakt dessa ids och värden:

```js
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
```

- [ ] **Step 4: Implement one reference view model and exact formatter**

Implementera `nutritionReferenceState` med dessa regler i denna ordning:

```js
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
```

EMA:s produktinformation samt KDIGO- och ESC-källorna i specifikationen underbygger de konservativa stoppreglerna och fasta vårdhänvisningarna. De ska inte göras till numeriska referenskort eftersom inga ytterligare värden hämtas från dem i denna version.

Implementera view modelen direkt efter matrisen:

```js
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
```

Formatteraren ska bevara katalogens precision och få översatt enhet från anroparen:

```js
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
```

- [ ] **Step 5: Run reference tests and verify green**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js`

Expected: PASS for every exact value, matrix row, date boundary, unit string and manual-target preservation.

- [ ] **Step 6: Commit the deterministic engine**

```bash
git add frontend/src/lib/nutrition-goals.js frontend/src/lib/nutrition-goals.test.js
git commit -m "Add sourced nutrition reference engine"
```

---

### Task 3: Fail-closed frontend AI gate

**Files:**
- Modify: `frontend/src/lib/nutrition-goals.js:55-56`
- Modify: `frontend/src/lib/nutrition-assist.js:1-48`
- Test: `frontend/src/lib/nutrition-goals.test.js`
- Test: `frontend/src/lib/nutrition-assist.test.js`

**Interfaces:**
- Consumes: normalized profile plus `{ age, today, diabetes }`.
- Produces: `nutritionAiGate(profile, options) -> boolean`; `nutritionAssistContext(S, totals, date, today)` med endast den nya generella flaggan `medical.nutritionSafety`.

- [ ] **Step 1: Write failing frontend AI-gate tests**

Lägg `nutritionAiGate` i importblocket i `nutrition-goals.test.js` och lägg till:

```js
const AI_SAFE = {
  goal: 'health', targets: {}, condition: false, medication: false,
  incretinUse: 'none', weightPhase: null, fiberReference: 'range',
  safety: SAFE, safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}

it('opens AI only for an explicitly current, non-medical adult profile', () => {
  expect(nutritionAiGate(AI_SAFE, { age: 40, today: '2026-08-23', diabetes: false })).toBe(false)
  expect(nutritionAiGate({ ...AI_SAFE, incretinUse: 'weight' }, { age: 40, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate({ ...AI_SAFE, safetyReviewedAt: '2026-05-24' }, { age: 40, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate({ ...AI_SAFE, safety: { ...SAFE, severeGI: true } }, { age: 40, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate({ ...AI_SAFE, targetReviewRequired: true }, { age: 40, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate(AI_SAFE, { age: 17, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate(AI_SAFE, { age: 100, today: '2026-08-23' })).toBe(false)
  expect(nutritionAiGate(AI_SAFE, { age: 101, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate(AI_SAFE, { age: null, today: '2026-08-23' })).toBe(true)
  expect(nutritionAiGate(AI_SAFE, { age: 40, today: '2026-08-23', diabetes: true })).toBe(true)
})
```

Lägg samma fristående fixtures överst i `nutrition-assist.test.js` och uppdatera första AI-fallet så det använder dem samt explicit dagens datum:

```js
const SAFE = {
  kidneyOrProteinRestriction: false, fluidOrSodiumRestriction: false,
  pregnancyOrBreastfeeding: false, eatingDisorder: false, severeGI: false,
  malnutritionRisk: false, otherClinicalNutrition: false, hypoglycemiaRiskMedication: false
}
const AI_SAFE = {
  goal: 'health', targets: { fib: 30 }, condition: false, medication: false,
  incretinUse: 'none', weightPhase: null, fiberReference: 'range',
  safety: SAFE, safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}
```

Lägg sedan till:

```js
it('sends one coarse safety flag and no medical category names', () => {
  const context = nutritionAssistContext({
    lang: 'sv', coachProfile: { age: 40, sex: 'male', heightCm: 180 },
    nutritionGoals: { ...AI_SAFE, incretinUse: 'weight', safety: { ...SAFE, severeGI: true } }
  }, totalsOf([], foods), '2026-08-23', '2026-08-23')
  expect(context.medical.nutritionSafety).toBe(true)
  expect(context.clinicianReview).toBe(true)
  const json = JSON.stringify(context)
  for (const secret of ['incretinUse', 'weightPhase', 'severeGI', 'safetyReviewedAt', 'targetReviewRequired']) {
    expect(json).not.toContain(secret)
  }
})

it('keeps an explicitly safe current profile on the general path', () => {
  const context = nutritionAssistContext({
    lang: 'sv', coachProfile: { age: 40 }, nutritionGoals: AI_SAFE
  }, totalsOf([], foods), '2026-08-23', '2026-08-23')
  expect(context.medical.nutritionSafety).toBe(false)
  expect(context.clinicianReview).toBe(false)
})

it('accepts a stricter local review returned by the server', () => {
  const answer = { status: 'clinician_review', summary: 'Review.', observations: [], questions: [] }
  expect(validateNutritionAnswer(answer, false)).toEqual(answer)
})
```

Ändra assertionerna i det befintliga testet för blank/boolean legacy age till:

```js
expect(context.medical.under18).toBe(false)
expect(context.medical.nutritionSafety).toBe(true)
expect(context.clinicianReview).toBe(true)
```

Okänd ålder är därmed fail-closed utan att felaktigt klassas som minderårig.

Uppdatera även den befintliga exakta `context.medical`-assertionen i testet med diabetes, condition och medication så att det femte fältet ingår. Profilen saknar en bekräftad säkerhetskontroll och ska därför ge `true`:

```js
expect(context.medical).toEqual({
  diabetes: true, condition: true, medication: true, under18: false, nutritionSafety: true
})
```

- [ ] **Step 2: Run both focused frontend tests and verify red**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js src/lib/nutrition-assist.test.js`

Expected: FAIL because `nutritionAiGate` och `medical.nutritionSafety` saknas.

- [ ] **Step 3: Implement the single client gate**

Återanvänd `ageOf` från Task 2 och lägg till i `nutrition-goals.js`:

```js
export function nutritionAiGate(profile, { age, today, diabetes = false } = {}) {
  const clean = cleanNutritionProfile(profile)
  return ageOf(age) == null || diabetes === true || clean.condition || clean.medication ||
    clean.incretinUse !== 'none' || clean.weightPhase !== null ||
    !NUTRITION_SAFETY_KEYS.every(key => clean.safety[key] === false) ||
    !safetyReviewCurrent(clean.safetyReviewedAt, today) || clean.targetReviewRequired
}
```

Behåll `needsClinicianTargets` för nuvarande anropare, men bredda den med exakt denna mindre medicinska markering; den får inte ersätta den striktare AI-spärren:

```js
export const needsClinicianTargets = (profile, { diabetes = false } = {}) => {
  const clean = cleanNutritionProfile(profile)
  return diabetes === true || clean.condition || clean.medication ||
    (clean.incretinUse != null && clean.incretinUse !== 'none') ||
    NUTRITION_SAFETY_KEYS.some(key => clean.safety[key] === true)
}
```

- [ ] **Step 4: Wire the coarse flag into the assist context**

Ersätt `nutritionAssistContext` i `nutrition-assist.js` med samma befintliga databeräkningar och den nya grova spärren:

```js
export function nutritionAssistContext(S, totals, date = null, today = nutritionSafetyToday()) {
  const profile = cleanNutritionProfile(S && S.nutritionGoals)
  const person = coachProfileOf(S || {})
  const bw = lastBW({ bodyweight: S?.bodyweight || [] })
  const weightKg = weightKgOf(bw)
  const basal = bmrEstimate({ ...person, weightKg })
  const targets = Object.fromEntries(Object.entries(profile.targets).filter(([, value]) => value != null))
  const day = {}, incomplete = []
  for (const key of NUTRIENTS) {
    const value = nutrientTotal(totals, key)
    if (value == null) incomplete.push(key)
    else day[key] = value
  }
  const medical = {
    diabetes: diabetesOn(S || {}),
    condition: profile.condition,
    medication: profile.medication,
    under18: present(person.age) && Number(person.age) < 18,
    nutritionSafety: nutritionAiGate(profile, { age: person.age, today, diabetes: diabetesOn(S || {}) })
  }
  return {
    language: S?.lang === 'sv' ? 'sv' : 'en',
    date,
    goal: profile.goal,
    person: { age: person.age, sex: person.sex, heightCm: person.heightCm, weightKg, bmrKcal: basal },
    targets,
    day,
    incomplete,
    medical,
    clinicianReview: Object.values(medical).some(Boolean)
  }
}
```

Importera `nutritionAiGate` och `nutritionSafetyToday` från `nutrition-goals.js`. Lägg aldrig den normaliserade safety-strukturen i returvärdet och använd inte den lokala `todayISO()` för denna 90-dagarsregel.

- [ ] **Step 5: Run both frontend tests and verify green**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js src/lib/nutrition-assist.test.js`

Expected: PASS; general AI är bara möjligt med aktuell explicit säker profil och detaljerade medicinska nycklar saknas i JSON.

- [ ] **Step 6: Commit the client gate**

```bash
git add frontend/src/lib/nutrition-goals.js frontend/src/lib/nutrition-goals.test.js frontend/src/lib/nutrition-assist.js frontend/src/lib/nutrition-assist.test.js
git commit -m "Gate nutrition AI on confirmed safety"
```

---

### Task 4: Authoritative server-side AI decision

**Files:**
- Modify: `api/nutrition-context.js:1-54,57-103`
- Test: `api/nutrition-context.test.js`
- Modify: `api/server.js:579-635`

**Interfaces:**
- Consumes: rå client context, sparad full user state och ett explicit `today`.
- Produces: `decideNutritionAssist(rawContext, storedState, today) -> { mode: 'invalid'|'local'|'ai', context }`, `nutritionAiPayload(context) -> { language, facts }`, `nutritionReviewAnswer(context)`.

- [ ] **Step 1: Write failing server-authority and payload tests**

Lägg `decideNutritionAssist`, `nutritionAiPayload` och `nutritionReviewAnswer` i det befintliga importblocket i `api/nutrition-context.test.js`. Lägg sedan till dessa fixtures och tester:

```js
const SAFETY_KEYS = [
  'kidneyOrProteinRestriction', 'fluidOrSodiumRestriction',
  'pregnancyOrBreastfeeding', 'eatingDisorder', 'severeGI',
  'malnutritionRisk', 'otherClinicalNutrition', 'hypoglycemiaRiskMedication'
]
const SAFE = Object.fromEntries(SAFETY_KEYS.map(key => [key, false]))
const SAFE_STATE = {
  coachProfile: { age: 40 }, health: { on: false },
  nutritionGoals: {
    goal: 'health', condition: false, medication: false,
    incretinUse: 'none', weightPhase: null, safety: SAFE,
    safetyReviewedAt: '2026-05-25', targetReviewRequired: false
  }
}
const RAW_CONTEXT = {
  language: 'sv', date: '2026-08-23', goal: 'health',
  person: { age: 40, sex: 'male', heightCm: 180, weightKg: 80 },
  targets: { fib: 30 }, day: { kcal: 1800 }, incomplete: ['prot'],
  medical: { diabetes: false, condition: false, medication: false, under18: false, nutritionSafety: false }
}

test('server state is authoritative and fails closed', () => {
  assert.equal(decideNutritionAssist(RAW_CONTEXT, SAFE_STATE, '2026-08-23').mode, 'ai')
  assert.equal(decideNutritionAssist(RAW_CONTEXT, null, '2026-08-23').mode, 'local')
  assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, safetyReviewedAt: '2026-05-24' } }, '2026-08-23').mode, 'local')
  assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, targetReviewRequired: true } }, '2026-08-23').mode, 'local')
})

test('every incretin use except explicit none stays local', () => {
  for (const incretinUse of ['weight', 'diabetes', 'both', 'other', null, undefined]) {
    const state = { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, incretinUse } }
    assert.equal(decideNutritionAssist(RAW_CONTEXT, state, '2026-08-23').mode, 'local')
  }
})

test('either the stored risk or the client risk closes the AI path', () => {
  const storedRisk = { ...SAFE_STATE, nutritionGoals: { ...SAFE_STATE.nutritionGoals, safety: { ...SAFE, severeGI: true } } }
  assert.equal(decideNutritionAssist(RAW_CONTEXT, storedRisk, '2026-08-23').mode, 'local')
  const clientRisk = { ...RAW_CONTEXT, medical: { ...RAW_CONTEXT.medical, nutritionSafety: true } }
  assert.equal(decideNutritionAssist(clientRisk, SAFE_STATE, '2026-08-23').mode, 'local')
})

test('every stored safety answer must be the exact boolean false', () => {
  for (const key of SAFETY_KEYS) {
    for (const value of [true, null, 'false', 0, undefined]) {
      const state = { ...SAFE_STATE, nutritionGoals: {
        ...SAFE_STATE.nutritionGoals, safety: { ...SAFE, [key]: value }
      } }
      assert.equal(decideNutritionAssist(RAW_CONTEXT, state, '2026-08-23').mode, 'local')
    }
  }
})

test('stored adult age uses the same 18 through 100 boundary as the profile', () => {
  for (const age of [18, 100]) {
    assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, coachProfile: { age } }, '2026-08-23').mode, 'ai')
  }
  for (const age of [17, 101, 18.5, null, '', true]) {
    assert.equal(decideNutritionAssist(RAW_CONTEXT, { ...SAFE_STATE, coachProfile: { age } }, '2026-08-23').mode, 'local')
  }
})

test('AI payload contains only language and allow-listed fact codes', () => {
  const decision = decideNutritionAssist(RAW_CONTEXT, SAFE_STATE, '2026-08-23')
  const payload = nutritionAiPayload(decision.context)
  assert.deepEqual(Object.keys(payload), ['language', 'facts'])
  assert.equal(payload.language, 'sv')
  assert.equal(payload.facts.includes('goal:health'), true)
  const json = JSON.stringify(payload)
  for (const forbidden of ['1800', '30', 'male', 'severeGI', 'incretinUse', 'weightKg']) assert.equal(json.includes(forbidden), false)
})

test('arbitrary medical details in the request are discarded', () => {
  const context = cleanNutritionContext({
    ...RAW_CONTEXT,
    medical: { ...RAW_CONTEXT.medical, incretinUse: 'weight', severeGI: true, safetyReviewedAt: '2026-08-23' }
  })
  assert.deepEqual(context.medical, {
    diabetes: false, condition: false, medication: false, under18: false, nutritionSafety: false
  })
})

test('local review text is fixed and contains no insulin or carbohydrate calculation', () => {
  const context = cleanNutritionContext(RAW_CONTEXT)
  const answer = nutritionReviewAnswer(context)
  assert.equal(answer.status, 'clinician_review')
  assert.equal(Array.isArray(answer.observations), true)
  assert.equal(Array.isArray(answer.questions), true)
  assert.equal(/bolus|correction factor|insulin-on-board/i.test(JSON.stringify(answer)), false)
})
```

- [ ] **Step 2: Run API tests and verify red**

Run: `npm --prefix api test`

Expected: FAIL because besluts- och payloadfunktionerna saknas och context ännu inte har den generella flaggan.

- [ ] **Step 3: Implement independent stored-state validation**

Lägg en separat serverimplementation i `nutrition-context.js`; importera inget från frontend:

```js
const STORED_SAFETY_KEYS = [
  'kidneyOrProteinRestriction', 'fluidOrSodiumRestriction',
  'pregnancyOrBreastfeeding', 'eatingDisorder', 'severeGI',
  'malnutritionRisk', 'otherClinicalNutrition', 'hypoglycemiaRiskMedication'
]
const isoDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const stamp = Date.UTC(year, month - 1, day)
  return new Date(stamp).toISOString().slice(0, 10) === value ? stamp / 86400000 : null
}
const currentReview = (reviewedAt, today) => {
  const reviewed = isoDay(reviewedAt), current = isoDay(today)
  return reviewed != null && current != null && current >= reviewed && current - reviewed <= 90
}
const adult = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return false
  const age = Number(value)
  return Number.isInteger(age) && age >= 18 && age <= 100
}

function storedNutritionNeedsLocal(state, today) {
  const goals = state?.nutritionGoals
  if (!goals || typeof goals !== 'object' || !adult(state?.coachProfile?.age)) return true
  return state?.health?.on === true || goals.condition !== false || goals.medication !== false ||
    goals.incretinUse !== 'none' || goals.weightPhase !== null ||
    !STORED_SAFETY_KEYS.every(key => goals.safety?.[key] === false) ||
    !currentReview(goals.safetyReviewedAt, today) || goals.targetReviewRequired !== false
}

export function decideNutritionAssist(rawContext, storedState, today) {
  const context = cleanNutritionContext(rawContext)
  if (!context) return { mode: 'invalid', context: null }
  const clientLocal = Object.values(context.medical).some(Boolean)
  return { mode: clientLocal || storedNutritionNeedsLocal(storedState, today) ? 'local' : 'ai', context }
}

export const nutritionAiPayload = context => ({
  language: context.language,
  facts: nutritionFactCodes(context)
})

export function nutritionReviewAnswer(context) {
  const sv = context.language === 'sv'
  return {
    status: 'clinician_review',
    summary: sv
      ? 'Dagsnav använder inte AI för personliga kostmål när en hälsomarkering eller en ej aktuell säkerhetskontroll finns. Dina sparade mål har inte ändrats.'
      : 'Dagsnav does not use AI for personal nutrition targets when a health flag or an unconfirmed safety review exists. Your saved targets have not changed.',
    observations: [context.incomplete.length
      ? (sv ? 'En eller flera näringsuppgifter saknas i dagens logg.' : 'One or more nutrient values are missing from the day log.')
      : (sv ? 'Dagens registrerade näringsvärden kan tas med till vårdteamet.' : 'The logged nutrient values can be taken to your care team.')],
    questions: sv
      ? ['Vilka energi- och näringsmål är lämpliga för mig?', 'Hur vill ni att jag följer upp vikt, matlogg och behandling tillsammans?']
      : ['Which energy and nutrient targets are appropriate for me?', 'How should I track weight, food logs and treatment together?']
  }
}
```

Utöka endast `cleanNutritionContext().medical` med `nutritionSafety: medical.nutritionSafety === true`. Den exporterade fasta texten ovan ersätter serverroutens inline-block och lägger inte till dos- eller kolhydratråd.

- [ ] **Step 4: Replace the route's asymmetric check before quota/model code**

Byt importen från `nutrition-context.js` till:

```js
import {
  decideNutritionAssist, nutritionAiPayload, nutritionAnswer, nutritionReviewAnswer
} from './nutrition-context.js'
```

I `POST /api/nutrition/assist`:

```js
const body = await readBody(req)
const today = new Date().toISOString().slice(0, 10)
const decision = decideNutritionAssist(body.context, readState(user.id), today)
if (decision.mode === 'invalid') return json(res, 400, { error: 'bad nutrition context' })
const context = decision.context
if (decision.mode === 'local') {
  return json(res, 200, {
    answer: nutritionReviewAnswer(context), local: true, usage: null, ...aiQuota(user.id)
  })
}
if (!OPENAI_KEY) return json(res, 501, { error: 'no api key configured' })

const payload = nutritionAiPayload(context)
const facts = payload.facts
const messages = [
  {
    role: 'system',
    content: 'Select one to five supplied fact codes that are most useful to highlight. Prefer the selected goal, missing data and user-entered targets. You can only return codes from the supplied list. Return the required JSON object only.'
  },
  { role: 'user', content: JSON.stringify(payload) }
]
```

Ta bort gamla `storedMedical`/409-blocket. Lämna `aiReserve`, `nutritionSchema`, `askOpenAI` och `nutritionAnswer` efter local-returen så lokal väg aldrig reserverar kvot.

- [ ] **Step 5: Run API tests and verify green**

Run: `npm --prefix api test`

Expected: PASS; saknad/ogiltig state blir lokal, säker state blir AI och payloaden innehåller endast språk och faktakoder.

- [ ] **Step 6: Check server syntax**

Run: `node --check api/server.js`

Expected: ingen output och exit code 0.

- [ ] **Step 7: Commit the server authority**

```bash
git add api/nutrition-context.js api/nutrition-context.test.js api/server.js
git commit -m "Make nutrition AI safety server authoritative"
```

---

### Task 5: Nutrition goals sheet, source cards and Swedish copy

**Files:**
- Modify: `frontend/src/nutrition-sheets.jsx:8-161,172-239`
- Modify: `frontend/src/index.css:233-266`
- Modify: `frontend/src/locales/sv.js:719-785`

**Interfaces:**
- Consumes: `cleanNutritionProfile`, `finalizeNutritionProfile`, `nutritionReferenceState`, `formatNutritionReference`, enum/safety constants och befintliga `update/pushState`.
- Produces: ett enda redigerbart profildraft, explicita tri-state-svar, säkerhets- och målbekräftelser, datadrivna referenskort och stabila input-id:n `nutrition-target-<key>`.

- [ ] **Step 1: Replace parallel goal state with one normalized draft**

Ta bort `NNR_REFERENCE`-importen. Importera `dateLocale` från `lib/i18n.js` och följande från `lib/nutrition-goals.js`:

```js
NUTRIENT_TARGETS, NUTRITION_SAFETY_KEYS, bmrEstimate, cleanNutritionProfile,
finalizeNutritionProfile, formatNutritionReference, needsClinicianTargets,
nutritionReferenceState, nutritionSafetyToday, safetyReviewCurrent, weightKgOf
```

Behåll separat `age`, `heightCm` och `sex` för coachprofilen. Ersätt `goal`, `condition`, `medication` och `targets`-staterna med:

```jsx
const [draft, setDraft] = useState(stored)
const [safetyConfirmedAt, setSafetyConfirmedAt] = useState(null)
const [targetsReviewed, setTargetsReviewed] = useState(false)
const profile = cleanNutritionProfile(draft)
const today = todayISO()
const safetyToday = nutritionSafetyToday()
const referenceState = nutritionReferenceState(profile, { age, today: safetyToday })
const safetyComplete = NUTRITION_SAFETY_KEYS.every(key => typeof profile.safety[key] === 'boolean')

const change = patch => setDraft(old => ({ ...old, ...patch }))
const changeMedical = updater => {
  setDraft(old => ({ ...updater(old), safetyReviewedAt: null }))
  setSafetyConfirmedAt(null)
}
const setTarget = (key, value) => setDraft(old => ({
  ...old, targets: { ...old.targets, [key]: value }
}))
const setSafety = (key, value) => changeMedical(old => ({
  ...old, safety: { ...old.safety, [key]: value }
}))
const confirmSafety = () => {
  if (!safetyComplete) return toast(t('Answer every safety question first.'))
  setDraft(old => ({ ...old, safetyReviewedAt: safetyToday }))
  setSafetyConfirmedAt(safetyToday)
}
```

Ändra befintliga JSX-referenser från de borttagna scalar-staterna till `profile.goal`, `profile.condition`, `profile.medication` och `profile.targets`. Behåll den befintliga vårdgränsen med:

```js
const clinician = needsClinicianTargets(profile, { diabetes: diabetesOn(S) }) ||
  ((typeof age === 'number' || (typeof age === 'string' && age.trim())) && Number(age) > 0 && Number(age) < 18)
```

Health-switcharna ska ogiltigförklara säkerhetsbekräftelsen:

```jsx
<Switch checked={profile.condition} aria-label={t('Illness affects my diet')}
  onChange={condition => changeMedical(old => ({ ...old, condition }))} />
<Switch checked={profile.medication} aria-label={t('Medication affects my diet')}
  onChange={medication => changeMedical(old => ({ ...old, medication }))} />
```

Enumändringar använder `changeMedical`. När `incretinUse` sätts till `'none'` ska samma updater sätta `weightPhase: null`. Targetfält använder bara `setTarget` och ogiltigförklarar inte säkerhetsdatumet.

Ändra save-flödet till:

```jsx
const save = () => {
  if (!profile.goal) { toast(t('Choose a nutrition goal.')); return }
  const saved = finalizeNutritionProfile(stored, profile, { safetyConfirmedAt, targetsReviewed })
  update(state => {
    state.coachProfile = cleanCoachProfile({
      ...coachProfileOf(state), age, heightCm, sex, updated: today
    })
    state.nutritionGoals = { ...saved, updated: today }
  })
  close()
  toast(t('Nutrition goals saved'))
}
```

- [ ] **Step 2: Add explicit incretin, phase, fibre and tri-state controls**

Definiera källsträngsmappningarna nära befintliga `GOAL_NAME`:

```jsx
const INCRETIN_NAME = {
  none: 'No incretin treatment', weight: 'Weight treatment', diabetes: 'Diabetes treatment',
  both: 'Weight and diabetes treatment', other: 'Other or unclear use'
}
const PHASE_NAME = { active_loss: 'Active weight loss', maintenance: 'Weight-stable phase' }
const FIBER_NAME = { range: 'Population interval', female: "Women's NNR reference", male: "Men's NNR reference" }
const SAFETY_QUESTION = {
  kidneyOrProteinRestriction: 'Kidney disease, dialysis, transplant or prescribed protein restriction?',
  fluidOrSodiumRestriction: 'Heart failure or prescribed fluid or sodium restriction?',
  pregnancyOrBreastfeeding: 'Pregnant, planning pregnancy or breastfeeding?',
  eatingDisorder: 'Current or previous eating disorder, self-induced vomiting or severe restriction?',
  severeGI: 'Severe or persistent stomach symptoms, dehydration or inability to eat and drink enough?',
  malnutritionRisk: 'Unintentional rapid weight loss, much lower intake, new weakness or diagnosed malnutrition or muscle loss?',
  otherClinicalNutrition: 'Liver disease, previous obesity surgery or another prescribed nutrition plan?',
  hypoglycemiaRiskMedication: 'Insulin or another medicine that your care team says can cause hypoglycaemia?'
}
```

Rendera enumval med befintlig `.ngoal-grid/.ngoal` och `aria-pressed`:

```jsx
function ChoiceGrid({ label, names, value, onChange }) {
  return <div className="ngoal-grid" role="group" aria-label={t(label)}>
    {Object.entries(names).map(([id, text]) => <button key={id}
      className={'ngoal' + (value === id ? ' on' : '')}
      aria-pressed={value === id} onClick={() => onChange(id)}>{t(text)}</button>)}
  </div>
}

<ChoiceGrid label="Incretin treatment" names={INCRETIN_NAME} value={profile.incretinUse}
  onChange={incretinUse => changeMedical(old => ({
    ...old, incretinUse, weightPhase: incretinUse === 'none' ? null : old.weightPhase
  }))} />
{['weight', 'both'].includes(profile.incretinUse) &&
  <ChoiceGrid label="Weight-treatment phase" names={PHASE_NAME} value={profile.weightPhase}
    onChange={weightPhase => changeMedical(old => ({ ...old, weightPhase }))} />}
<ChoiceGrid label="Fibre reference" names={FIBER_NAME} value={profile.fiberReference}
  onChange={fiberReference => change({ fiberReference })} />
```

Visa graviditetsfrågan direkt för alla. Lägg de övriga sju frågorna i ett befintligt `<details className="nreference">`; sätt `open` när incretin, condition eller medication är aktivt och låt användaren expandera det även annars.

Varje säkerhetsrad ska använda två riktiga buttons så `null` inte ser ut som ett svar:

```jsx
<div className="nsafety-row" key={key}>
  <span>{t(SAFETY_QUESTION[key])}</span>
  <span className="nsafety-buttons" role="group" aria-label={t(SAFETY_QUESTION[key])}>
    <button aria-pressed={profile.safety[key] === true} className={profile.safety[key] === true ? 'on' : ''}
      onClick={() => setSafety(key, true)}>{t('Yes')}</button>
    <button aria-pressed={profile.safety[key] === false} className={profile.safety[key] === false ? 'on' : ''}
      onClick={() => setSafety(key, false)}>{t('No / not applicable')}</button>
  </span>
</div>
```

När svaren är kompletta men datum saknas/är utgånget visas knappen **Confirm safety answers**. När `stored.targetReviewRequired` är true visas **I have reviewed my own targets**; knappen sätter bara `targetsReviewed=true`. En aktiv risk fortsätter pausas av view model även efter den bekräftelsen.

```jsx
{safetyComplete && !safetyReviewCurrent(profile.safetyReviewedAt, safetyToday) &&
  <Button variant="tinted" icon="shield" onClick={confirmSafety}>{t('Confirm safety answers')}</Button>}
{stored.targetReviewRequired && !targetsReviewed &&
  <Button variant="tinted" onClick={() => setTargetsReviewed(true)}>{t('I have reviewed my own targets')}</Button>}
```

- [ ] **Step 3: Keep manual targets editable and add stable focus targets**

Behåll de åtta befintliga `NumberField`-fälten. Lägg id och pausstatus utan att radera talet:

```jsx
const paused = referenceState.pausedTargets.includes(key)
<label key={key} className={paused ? 'paused' : ''}>
  <span>{t(NUTRIENT_NAME[key])}</span>
  <span className="nwith-unit">
    <NumberField id={`nutrition-target-${key}`} className="input" value={profile.targets[key]} nullable
      aria-label={t('Daily target for {0}', t(NUTRIENT_NAME[key]))}
      onChange={value => setTarget(key, value)} />
    <i>{NUTRIENT_UNIT[key]}</i>
  </span>
  {paused && <small>{t('Paused — needs review')}</small>}
</label>
```

Fältet är fortsatt redigerbart; endast måljämförelsen är pausad.

- [ ] **Step 4: Replace the old NNR paragraph with data-driven source cards**

Importera `dateLocale` och använd följande komponent; den fokuserar utan att kopiera ett värde:

```jsx
const KIND_NAME = { range: 'Range', min: 'Minimum', max: 'Maximum', example: 'Source example', warning: 'Warning threshold' }
const REFERENCE_NAME = { ...NUTRIENT_NAME, fluid: 'Fluid' }
const STATUS_TEXT = {
  age_required: 'Enter an adult age to show nutrition references.',
  pregnancy_required: 'Answer the pregnancy and breastfeeding question before adult references are shown.',
  professional_review: 'These general adult references are hidden because professional adaptation is needed.',
  phase_required: 'Choose active weight loss or weight-stable phase before GLP-1 references are shown.',
  safety_incomplete: 'Answer and confirm every safety question before GLP-1 references are shown.',
  safety_expired: 'Confirm the safety answers again; the previous review is older than 90 days.',
  blocked: 'The GLP-1 reference layer is hidden because a professional review is needed.',
  not_applicable: 'Weight-treatment references are not shown for this incretin use.'
}

function ReferenceCard({ reference, paused }) {
  const targetKey = NUTRIENT_TARGETS.includes(reference.targetField) ? reference.targetField : null
  return <article className="nref-card">
    <div className="nref-head">
      <strong>{t(REFERENCE_NAME[reference.nutrient])}</strong>
      <span className="nref-kind">{t(KIND_NAME[reference.kind])}</span>
    </div>
    <div className="nref-value">{formatNutritionReference(reference, dateLocale(), t(reference.unit))}</div>
    <div className="nref-meta">{t(reference.source)} · {reference.year} · {t(reference.audience)}</div>
    <p>{t(reference.limitation)}</p>
    <div className="nref-actions">
      <a href={reference.sourceUrl} target="_blank" rel="noopener">{t('Open source')}</a>
      {targetKey && !paused.includes(targetKey) && <button onClick={() =>
        document.getElementById(`nutrition-target-${targetKey}`)?.focus()}>{t('Set my own target')}</button>}
    </div>
  </article>
}
```

Rendera `referenceState.notices` före katalogen med `role={notice.severity === 'alert' ? 'alert' : 'note'}` och fast `notice.message`. Rendera sedan alltid exakt `referenceState.references`; motorn har redan tagit bort spärrade poster. På så sätt ligger vuxenreferenser kvar när endast GLP-kontrollen är ofullständig.

```jsx
{referenceState.adultStatus !== 'available' && <div className="nmedical" role="note">
  <Icon name="shield" /><div>{t(STATUS_TEXT[referenceState.adultStatus])}</div>
</div>}
{profile.incretinUse && profile.incretinUse !== 'none' && referenceState.glpStatus !== 'available' &&
  <div className="nmedical" role="note"><Icon name="shield" /><div>{t(STATUS_TEXT[referenceState.glpStatus])}</div></div>}
{referenceState.notices.map(notice => <div key={notice.code} className="nmedical"
  role={notice.severity === 'alert' ? 'alert' : 'note'}>
  <Icon name={notice.severity === 'alert' ? 'info' : 'shield'} /><div>{t(notice.message)}</div>
</div>)}
<div className="nref-list">
  {referenceState.references.map(reference => <ReferenceCard key={reference.id}
    reference={reference} paused={referenceState.pausedTargets} />)}
</div>
```

- [ ] **Step 5: Make the assist preview and send path match the new gate**

Lägg `context.medical.nutritionSafety && t('Nutrition safety review required')` i `flags`. Ändra `send` så senaste state får chans att synkas innan servern fattar beslut:

```jsx
const send = async () => {
  setBusy(true); setError('')
  try {
    await useStore.getState().pushState()
    const result = await askNutrition(context)
    setAnswer(result.answer); setLocal(result.local === true)
  } catch (e) { setError(t(ASSIST_ERROR[e.message] || 'Could not get an explanation')) }
  setBusy(false)
}
```

Servern förblir fail-closed om synken misslyckas; `pushState()` får ingen ny felmodell.

- [ ] **Step 6: Add the minimum CSS for answers and source cards**

Lägg till efter befintliga nutritionselektorer i `index.css`:

```css
.nsafety-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-top:var(--hair) solid var(--sep);font-size:13px}
.nsafety-row:first-child{border-top:0}
.nsafety-buttons{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:0 0 174px}
.nsafety-buttons button{min-height:44px;padding:6px 8px;border-radius:var(--r-sm);background:var(--surface-2);color:var(--label-2);font-size:12px}
.nsafety-buttons button.on{background:var(--acc-soft);color:var(--acc);box-shadow:inset 0 0 0 1px var(--acc-line)}
.ntargets label.paused{flex-wrap:wrap}
.ntargets label.paused>small{width:100%;padding-bottom:8px;color:var(--orange)}
.nref-list{display:grid;gap:10px;margin-top:10px}
.nref-card{padding:12px;border-radius:var(--r);background:var(--surface)}
.nref-head,.nref-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}
.nref-kind{font-size:11px;color:var(--label-2);border:var(--hair) solid var(--sep);border-radius:99px;padding:3px 7px}
.nref-value{margin-top:5px;font-size:21px;font-weight:600;font-variant-numeric:tabular-nums}
.nref-meta,.nref-card p{font-size:12px;line-height:1.45;color:var(--label-2)}
.nref-card p{margin:7px 0}
.nref-actions a,.nref-actions button{min-height:44px;display:inline-flex;align-items:center;color:var(--acc);font-size:13px}
.nutrient-details dd small.paused-target{color:var(--orange)}
@media(max-width:420px){.nsafety-row{align-items:stretch;flex-direction:column}.nsafety-buttons{width:100%;flex-basis:auto}}
```

- [ ] **Step 7: Add exact Swedish source keys**

Lägg följande UI-nycklar i nutritionblocket i `sv.js`:

```js
'No incretin treatment': 'Ingen inkretinbehandling',
'Incretin treatment': 'Inkretinbehandling',
'Weight-treatment phase': 'Fas för viktbehandling',
'Fibre reference': 'Fiberreferens',
'Safety questions': 'Säkerhetsfrågor',
'Weight treatment': 'Viktbehandling',
'Diabetes treatment': 'Diabetesbehandling',
'Weight and diabetes treatment': 'Vikt- och diabetesbehandling',
'Other or unclear use': 'Annan eller oklar användning',
'Active weight loss': 'Aktiv viktnedgång',
'Weight-stable phase': 'Viktstabil fas',
'Population interval': 'Befolkningsintervall',
"Women's NNR reference": 'NNR-referens för kvinnor',
"Men's NNR reference": 'NNR-referens för män',
'Yes': 'Ja',
'No / not applicable': 'Nej / inte relevant',
'Answer every safety question first.': 'Besvara alla säkerhetsfrågor först.',
'Confirm safety answers': 'Bekräfta säkerhetssvaren',
'I have reviewed my own targets': 'Jag har granskat mina egna mål',
'Paused — needs review': 'Pausat – behöver granskas',
'Scientific references': 'Vetenskapliga referenser',
'Range': 'Intervall',
'Minimum': 'Minst',
'Maximum': 'Högst',
'Source example': 'Källexempel',
'Warning threshold': 'Varningsgräns',
'Fluid': 'Vätska',
'Open source': 'Öppna källan',
'Set my own target': 'Ange eget mål',
'Nutrition safety review required': 'Säkerhetskontroll för näring krävs',
'g/day': 'g/dag',
'L/day': 'liter/dag',
'kcal/day': 'kcal/dag',
'g/kg adjusted reference weight/day': 'g/kg justerad referensvikt/dag',
'Nordic Nutrition Recommendations 2023': 'Nordiska näringsrekommendationer 2023',
'ACLM/ASN/OMA/TOS joint advisory': 'Gemensam rådgivning från ACLM/ASN/OMA/TOS',
'EASO/EFAD/ECPO clinical infographic': 'Klinisk infografik från EASO/EFAD/ECPO',
'Adults not pregnant, planning pregnancy or breastfeeding': 'Vuxna som inte är gravida, planerar graviditet eller ammar',
'Adults using GLP-1 therapy for obesity during active weight loss': 'Vuxna med GLP-1-behandling för obesitas under aktiv viktnedgång',
'Adults using incretin-based therapy for obesity': 'Vuxna med inkretinbaserad behandling för obesitas',
'Kidney disease, dialysis, transplant or prescribed protein restriction?': 'Njursjukdom, dialys, transplantation eller ordinerad proteinbegränsning?',
'Heart failure or prescribed fluid or sodium restriction?': 'Hjärtsvikt eller ordinerad vätske- eller natriumbegränsning?',
'Pregnant, planning pregnancy or breastfeeding?': 'Gravid, planerar graviditet eller ammar?',
'Current or previous eating disorder, self-induced vomiting or severe restriction?': 'Nuvarande eller tidigare ätstörning, självframkallade kräkningar eller kraftig restriktion?',
'Severe or persistent stomach symptoms, dehydration or inability to eat and drink enough?': 'Svåra eller ihållande magsymtom, uttorkning eller svårt att få i dig tillräckligt med mat och dryck?',
'Unintentional rapid weight loss, much lower intake, new weakness or diagnosed malnutrition or muscle loss?': 'Oavsiktlig snabb viktnedgång, tydligt minskat intag, ny svaghet eller bedömd undernäring eller muskelförlust?',
'Liver disease, previous obesity surgery or another prescribed nutrition plan?': 'Leversjukdom, tidigare obesitaskirurgi eller annan ordinerad näringsplan?',
'Insulin or another medicine that your care team says can cause hypoglycaemia?': 'Insulin eller annat läkemedel som vården sagt kan orsaka hypoglykemi?',
'Population range, not a personal treatment target; Dagsnav does not convert E% to grams.': 'Befolkningsintervall, inte ett personligt behandlingsmål; Dagsnav räknar inte om E% till gram.',
'Population maximum, not a personal treatment target; Dagsnav does not convert E% to grams.': 'Befolkningsgräns, inte ett personligt behandlingsmål; Dagsnav räknar inte om E% till gram.',
'Population interval shown when no sex-specific NNR reference is selected.': 'Befolkningsintervall som visas när ingen könsspecifik NNR-referens har valts.',
'NNR population minimum for women, selected explicitly by the user.': 'NNR:s befolkningsminimum för kvinnor, uttryckligen valt av användaren.',
'NNR population minimum for men, selected explicitly by the user.': 'NNR:s befolkningsminimum för män, uttryckligen valt av användaren.',
'Equivalent to 2.3 g sodium; the displayed value is grams of salt.': 'Motsvarar 2,3 g natrium; värdet som visas är gram salt.',
'This upper reference is for added and free sugar. Dagsnav logs total sugar and cannot compare the two.': 'Den övre referensen gäller tillsatt och fritt socker. Dagsnav loggar totalsocker och kan inte jämföra dem.',
'Practical source example during active weight loss, equivalent in the source to 16–24 E% at 2,000 kcal. It is not a GLP-1-specific RDA or personal target, and Dagsnav does not scale it from energy intake.': 'Praktiskt källexempel under aktiv viktnedgång, vilket i källan motsvarar 16–24 E% vid 2 000 kcal. Det är inte ett GLP-1-specifikt rekommenderat intag eller personligt mål, och Dagsnav skalar inte intervallet från energiintag.',
'Requires a clinician-provided adjusted reference weight; Dagsnav does not calculate grams from current weight.': 'Kräver en kliniskt angiven justerad referensvikt; Dagsnav räknar inte gram från aktuell vikt.',
'Minimum within the adjusted-reference-weight recommendation, not a separate personal target.': 'Miniminivå inom rekommendationen med justerad referensvikt, inte ett fristående personligt mål.',
'Increase gradually together with adequate fluid; individual restrictions take priority.': 'Öka gradvis tillsammans med tillräcklig vätska; individuella begränsningar har företräde.',
'Reference only; it must be adapted for heart, kidney or prescribed fluid restrictions.': 'Endast referens; den måste anpassas vid hjärt-, njur- eller ordinerad vätskebegränsning.',
'Below this level the source identifies high micronutrient inadequacy risk; this is not a target.': 'Under denna nivå anger källan hög risk för otillräckliga mikronäringsämnen; det är inte ett mål.',
'Below this level the source says supplementation may need consideration; Dagsnav refers to clinical nutrition review and recommends no supplement.': 'Under denna nivå anger källan att tillskott kan behöva övervägas; Dagsnav hänvisar till klinisk näringsgranskning och rekommenderar inget tillskott.',
'Below this level the source calls for clinical treatment review.': 'Under denna nivå anger källan behov av klinisk behandlingsöversyn.',
'Protein, salt and fluid references need professional adaptation for kidney disease or a prescribed protein restriction.': 'Protein-, salt- och vätskereferenser behöver professionell anpassning vid njursjukdom eller ordinerad proteinbegränsning.',
'Salt and fluid references need professional adaptation for a prescribed fluid or sodium restriction.': 'Salt- och vätskereferenser behöver professionell anpassning vid ordinerad vätske- eller natriumbegränsning.',
'Pregnancy, pregnancy planning and breastfeeding need different nutrition references.': 'Graviditet, graviditetsplanering och amning behöver andra näringsreferenser.',
'Automatic nutrition references are paused when an eating disorder or severe restriction may be relevant.': 'Automatiska näringsreferenser pausas när ätstörning eller kraftig restriktion kan vara relevant.',
'Severe abdominal pain, persistent vomiting, dehydration signs, or severe constipation with pain, bloating or vomiting need prompt medical assessment.': 'Svår buksmärta, ihållande kräkningar, tecken på uttorkning eller svår förstoppning med smärta, uppblåsthet eller kräkning behöver skyndsam medicinsk bedömning.',
'Unintentional rapid weight loss, reduced intake or new weakness needs professional nutrition assessment.': 'Oavsiktlig snabb viktnedgång, minskat intag eller ny svaghet behöver professionell näringsbedömning.',
'Your existing clinical nutrition plan takes priority over these general GLP-1 references.': 'Din befintliga kliniska näringsplan har företräde framför dessa allmänna GLP-1-referenser.',
'Do not change energy or carbohydrate targets without your diabetes care plan. Follow your prescribed emergency plan and seek urgent help for acute severe hypoglycaemia; repeated episodes need contact with your diabetes team.': 'Ändra inte energi- eller kolhydratmål utan din diabetesplan. Följ din ordinerade akutplan och sök akut hjälp vid akut allvarlig hypoglykemi; upprepade episoder behöver kontakt med diabetesteamet.',
'Your own targets stay paused until you confirm that you have reviewed them.': 'Dina egna mål förblir pausade tills du bekräftar att du har granskat dem.',
'This energy target is below 800 kcal/day and is paused pending clinical review.': 'Detta energimål är under 800 kcal/dag och pausas i väntan på klinisk granskning.',
'This energy target is below 1,200 kcal/day and needs clinical nutrition review.': 'Detta energimål är under 1 200 kcal/dag och behöver klinisk näringsgranskning.',
'This energy target is below 1,500 kcal/day, where the source identifies high micronutrient inadequacy risk.': 'Detta energimål är under 1 500 kcal/dag, där källan anger hög risk för otillräckliga mikronäringsämnen.',
'Enter an adult age to show nutrition references.': 'Ange vuxen ålder för att visa näringsreferenser.',
'Answer the pregnancy and breastfeeding question before adult references are shown.': 'Besvara frågan om graviditet och amning innan vuxenreferenser visas.',
'These general adult references are hidden because professional adaptation is needed.': 'De allmänna vuxenreferenserna döljs eftersom professionell anpassning behövs.',
'Choose active weight loss or weight-stable phase before GLP-1 references are shown.': 'Välj aktiv viktnedgång eller viktstabil fas innan GLP-1-referenser visas.',
'Answer and confirm every safety question before GLP-1 references are shown.': 'Besvara och bekräfta alla säkerhetsfrågor innan GLP-1-referenser visas.',
'Confirm the safety answers again; the previous review is older than 90 days.': 'Bekräfta säkerhetssvaren igen; den förra granskningen är äldre än 90 dagar.',
'The GLP-1 reference layer is hidden because a professional review is needed.': 'GLP-1-referenserna döljs eftersom professionell granskning behövs.',
'Weight-treatment references are not shown for this incretin use.': 'Referenser för viktbehandling visas inte för denna inkretinanvändning.',
```

- [ ] **Step 8: Run focused logic tests and production build**

Run: `npm --prefix frontend test -- src/lib/nutrition-goals.test.js src/lib/nutrition-assist.test.js`

Expected: PASS.

Run: `npm --prefix frontend run build`

Expected: Vite production build completes without missing imports, JSX errors or untranslated-code syntax errors.

- [ ] **Step 9: Commit the goals UI**

```bash
git add frontend/src/nutrition-sheets.jsx frontend/src/index.css frontend/src/locales/sv.js
git commit -m "Add sourced nutrition reference controls"
```

---

### Task 6: Safe references and paused goals in the food log

**Files:**
- Modify: `frontend/src/views/Food.jsx:9-96`

**Interfaces:**
- Consumes: samma `nutritionReferenceState`, `formatNutritionReference` och `nutritionAiGate` som målarket; `coachProfileOf(S).age` och dagens datum.
- Produces: separata rader **Own target** och **Reference**, fast pausstatus och samma AI/local-knappstatus som serverregeln.

- [ ] **Step 1: Derive the shared state once in `Food`**

Behåll den befintliga `dateLocale`-importen och den befintliga `const dia = diabetesOn(S)`. Importera `coachProfileOf`, `nutritionSafetyToday` samt de tre övriga nutrition-hjälparna och lägg endast de nya härledningarna efter `goals`:

```jsx
const person = coachProfileOf(S)
const safetyToday = nutritionSafetyToday()
const referenceState = nutritionReferenceState(goals, { age: person.age, today: safetyToday })
const localNotes = nutritionAiGate(goals, {
  age: person.age, today: safetyToday, diabetes: dia
})
```

Ta bort den gamla manuella `dia || goals.condition || ...`-kontrollen så knappen och servern använder samma konservativa beslut.

- [ ] **Step 2: Render current value, own target and references independently**

Ändra `NutrientDetails` till `function NutrientDetails({ totals, goals, referenceState })`. Inuti varje nutrientrad ska nuvärdet vara den enda delen som beror på komplett matdata:

```jsx
const target = goals.targets[key]
const paused = referenceState.pausedTargets.includes(key)
const references = referenceState.references.filter(reference => reference.nutrient === key && reference.daily)

<dd>
  {value == null
    ? <><span>—</span><small>{t('Some logged foods are missing this value.')}</small></>
    : <span>{fmtNum(value)} {NUTRIENT_UNIT[key]}</span>}
  {target != null && <small className={paused ? 'paused-target' : ''}>
    {paused
      ? t('Own target: Paused — needs review')
      : t('Own target: {0} {1}', fmtNum(target), NUTRIENT_UNIT[key])}
  </small>}
  {references.map(reference => <small key={reference.id}>
    {t(reference.kind === 'example' ? 'Source example: {0}' : 'Reference: {0}',
      formatNutritionReference(reference, dateLocale(), t(reference.unit)))}
    {' · '}<a href={reference.sourceUrl} target="_blank" rel="noopener">{t(reference.source)}</a>
  </small>)}
</dd>
```

Det pausade läget visar inte det gamla måltalet. `nnr-free-sugar`, GLP-vätska, viktbaserad proteininfo och energigränser har `daily:false` och visas därför bara i det fullständiga målarket.

Anropa komponenten med `<NutrientDetails totals={totals} goals={goals} referenceState={referenceState} />`.

- [ ] **Step 3: Surface fixed safety notices after saving**

Rendera notices i dagens huvudkort även om matloggen är tom:

```jsx
{referenceState.notices.map(notice => <div key={notice.code} className="nmedical"
  role={notice.severity === 'alert' ? 'alert' : 'note'}>
  <Icon name={notice.severity === 'alert' ? 'info' : 'shield'} />
  <div>{t(notice.message)}</div>
</div>)}
```

Lägg dessa svenska nycklar om de inte redan lades i Task 5:

```js
'Own target: Paused — needs review': 'Eget mål: Pausat – behöver granskas',
'Own target: {0} {1}': 'Eget mål: {0} {1}',
'Reference: {0}': 'Referens: {0}',
'Source example: {0}': 'Källexempel: {0}'
```

- [ ] **Step 4: Run all automated checks**

Run: `npm --prefix frontend test`

Expected: samtliga frontendtester PASS.

Run: `npm --prefix api test`

Expected: samtliga API-tester PASS.

Run: `npm --prefix frontend run build`

Expected: production build completes successfully.

Run: `git diff --check`

Expected: ingen output och exit code 0.

- [ ] **Step 5: Verify the final diff is limited to approved files**

Run: `git status --short`

Expected: endast Task 6-filerna är ändrade; alla tidigare tasker är redan committade:

```text
 M frontend/src/locales/sv.js
 M frontend/src/views/Food.jsx
```

- [ ] **Step 6: Commit the food-log presentation**

```bash
git add frontend/src/views/Food.jsx frontend/src/locales/sv.js
git commit -m "Show safe nutrition references in food log"
```

- [ ] **Step 7: Verify the branch is clean after the final commit**

Run: `git status --short --branch`

Expected: branchraden visas utan ändrade, otrackade `.env`- eller `data/`-filer.

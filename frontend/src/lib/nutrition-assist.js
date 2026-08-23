import { api } from './api.js'
import { NUTRIENTS } from './foods.js'
import { nutrientTotal } from './nutrition.js'
import { cleanNutritionProfile, bmrEstimate, needsClinicianTargets, weightKgOf } from './nutrition-goals.js'
import { coachProfileOf } from './coach-profile.js'
import { diabetesOn } from './diabetes.js'
import { lastBW } from './history.js'

const present = value => !!(typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value))

/** The complete, inspectable object shown before it is sent to the configured AI provider. */
export function nutritionAssistContext(S, totals, date = null) {
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
    under18: present(person.age) && Number(person.age) < 18
  }
  return {
    language: S?.lang === 'sv' ? 'sv' : 'en',
    date,
    goal: profile.goal,
    person: {
      age: person.age,
      sex: person.sex,
      heightCm: person.heightCm,
      weightKg,
      bmrKcal: basal
    },
    targets,
    day,
    incomplete,
    medical,
    clinicianReview: needsClinicianTargets(profile, { diabetes: medical.diabetes }) || medical.under18
  }
}

export function validateNutritionAnswer(answer, review = false) {
  if (!answer || !['general', 'clinician_review'].includes(answer.status) ||
      typeof answer.summary !== 'string' || !Array.isArray(answer.observations) || !Array.isArray(answer.questions) ||
      !answer.observations.every(x => typeof x === 'string') || !answer.questions.every(x => typeof x === 'string') ||
      (review && answer.status !== 'clinician_review')) return null
  return answer
}

export async function askNutrition(context) {
  const response = await api('/api/nutrition/assist', { method: 'POST', body: JSON.stringify({ context }) })
  const answer = validateNutritionAnswer(response.answer, context.clinicianReview)
  if (!answer) throw new Error('model returned an invalid explanation')
  return { ...response, answer }
}

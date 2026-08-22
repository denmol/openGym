// Talking to the coach endpoint, when the instance has a key configured.
//
// Everything expensive — the profile, the shortlist, the prompt, the validator — is shared
// with the paste flow. The only thing that changes is who carries the prompt across: the
// server instead of the user's clipboard. Which means the repair round, the one part of the
// paste flow that asks something of the user, becomes invisible here.
//
// The key never reaches this file. It lives in the server's environment; this only knows
// whether one exists.

import { api } from './api.js'
import { buildPrompt, buildRepairPrompt } from './coach-prompt.js'
import { validateCoachPlan, problemText } from './coach-validate.js'

// How many times to hand the validator's complaints back to the model. Two is not a guess:
// the first round fixes what it can, a second catches what the first broke, and past that a
// model that is still wrong is wrong about something the prompt has not said clearly — more
// rounds just spend money confirming it.
export const MAX_REPAIRS = 2

/** Whether this instance can generate directly, and how much of today's quota is left. */
export async function coachStatus() {
  try {
    return await api('/api/coach/status')
  } catch (e) {
    // 401 (guest, or a build with no backend) is not an error worth showing — it just means
    // the paste flow is the only route.
    return { enabled: false, error: e.status === 401 ? null : e.message }
  }
}

/**
 * Generate a plan, repairing it in place while the validator still objects.
 *
 * @param profile    a cleaned coachProfile
 * @param opts.onStep called with 'asking' | 'checking' | 'fixing' so the UI can say what is
 *                    happening — these calls take tens of seconds and silence reads as broken
 * @returns { data, errors, warnings, rounds, left }
 *          `data` is a plan bundle ready for parsePlan; `errors` is what survived the
 *          repairs, so a caller can still offer the manual route.
 */
export async function generatePlan(profile, { lang, unit, bodyweight, onStep } = {}) {
  const prompt = buildPrompt(profile, { lang, unit, bodyweight })
  const step = s => { if (onStep) onStep(s) }

  step('asking')
  let res = await api('/api/coach', { method: 'POST', body: JSON.stringify({ prompt }) })
  step('checking')
  let check = validateCoachPlan(res.plan, profile)

  for (let round = 0; round < MAX_REPAIRS && check.errors.length; round++) {
    step('fixing')
    const repair = buildRepairPrompt(check.errors.map(problemText))
    res = await api('/api/coach', {
      method: 'POST',
      body: JSON.stringify({ prompt, previous: res.raw, repair })
    })
    step('checking')
    check = validateCoachPlan(res.plan, profile)
  }

  return {
    data: res.plan,
    errors: check.errors,
    warnings: check.warnings,
    left: res.left,
    usage: res.usage || null
  }
}

// Asking a model to phrase the trainer's findings — and nothing else.
//
// The analysis is already done (trainer.js). This builds the small record that may leave the
// device, sends it, and hands back either the model's words or a reason there are none. The
// server checks the words against the findings (api/trainer.js); a failure there comes back
// as an error and the sheet shows the fixed text from trainer-text.js instead.

import { api } from './api.js'
import { getLang } from './i18n.js'
import { coachProfileOf, medicalFlag } from './coach-profile.js'
import { CLINICIAN } from './clinician.js'

export const MAX_QUESTION = 300
export const MAX_HISTORY = 3             // earlier turns that go along with a follow-up
const MAX_HISTORY_ANSWER = 700

/** An answer as the plain text the next question is shown, so a follow-up can refer to it. */
export const answerText = a => !a || a.status !== 'ok' ? '' :
  [a.headline, ...(a.paragraphs || []).map(p => p.text)].filter(Boolean).join(' ').slice(0, MAX_HISTORY_ANSWER)

/** The last few turns as { question, answer } — what the person asked and what was said. */
export const historyOf = thread => (thread || []).slice(-MAX_HISTORY)
  .map(h => ({ question: String(h.question || '').slice(0, MAX_QUESTION), answer: answerText(h.answer) }))
  .filter(h => h.question)
const SENT = 10          // findings that go to the model; the rest are shown but not phrased

/**
 * The complete record that would be sent. The sheet shows it before anything leaves the
 * device, so what the model sees is what the person can read.
 */
export function trainerContext(S, analysis, question = '', thread = []) {
  const p = coachProfileOf(S)
  const q = String(question || '').trim().slice(0, MAX_QUESTION)
  const minor = p.age != null && p.age < 18
  const history = historyOf(thread)
  return {
    language: getLang() === 'sv' ? 'sv' : 'en',
    goal: p.goal,
    level: p.level,
    findings: analysis.findings
      .filter(f => f.kind !== 'info' || f.code === 'data_thin')
      .slice(0, SENT)
      .map(({ code, kind, basis, evidence, facts }) => ({ code, kind, basis, evidence, facts })),
    question: q,
    // Earlier turns only appear when there are some, so a first question reads exactly as before.
    ...(history.length ? { history } : {}),
    medical: !CLINICIAN && !!(medicalFlag(p.limits) || medicalFlag(p.dislikes) || medicalFlag(q) || history.some(h => medicalFlag(h.question)) || minor || !!(S && S.health && S.health.on !== false))
  }
}

/** Is a model on the other end, and how many calls are left today? */
export async function trainerStatus() {
  try {
    return await api('/api/coach/status')
  } catch (e) {
    return { enabled: false, error: e.status === 401 ? null : e.message }
  }
}

const isAnswer = a => !!(a && (a.status === 'outside_scope' || (a.status === 'ok' && typeof a.headline === 'string' &&
  Array.isArray(a.paragraphs) && a.paragraphs.every(p => p && typeof p.text === 'string' && Array.isArray(p.cites) && Array.isArray(p.findings)))))

/**
 * @returns {{ local: true } | { answer, left }}
 * Throws on anything else, with `.fallback` set when the model answered but was rejected.
 */
export async function askTrainer(context) {
  let res
  try {
    res = await api('/api/trainer', { method: 'POST', body: JSON.stringify({ context }) })
  } catch (e) {
    // The server answered, but what the model wrote did not match the findings.
    if (e.data && e.data.fallback) e.fallback = true
    throw e
  }
  if (res.local) return { local: true, reasons: res.reasons || [] }
  if (!isAnswer(res.answer)) throw new Error('the trainer’s answer was malformed')
  return { answer: res.answer, left: res.left }
}

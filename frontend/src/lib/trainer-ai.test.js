import { describe as suite, expect, it } from 'vitest'
import fs from 'node:fs'
import { describe, headlineOf, CODES, BASIS_LABEL } from './trainer-text.js'
import { trainerContext, MAX_QUESTION } from './trainer-ai.js'
import { analyze } from './trainer.js'
import { EVIDENCE, EVIDENCE_IDS } from './trainer-evidence.js'
import { MEDICAL_STEMS } from './coach-profile.js'
import { MEDICAL_STEMS as SERVER_STEMS, EVIDENCE_IDS as SERVER_IDS, cleanTrainerContext } from '../../../api/trainer.js'

const F = (code, facts, extra = {}) => ({ code, kind: 'watch', basis: 'heuristic', evidence: [], facts, ...extra })
const FIXTURES = {
  data_thin: F('data_thin', { workouts: 2, needed: 4, days: 28 }),
  volume_none: F('volume_none', { muscle: 'Quads', sets: 0, floor: 10, ceiling: 20, goal: 'muscle', weeks: 3.6, planned: 0 }),
  volume_low: F('volume_low', { muscle: 'Chest', sets: 8.9, floor: 10, ceiling: 20, goal: 'muscle', weeks: 3.6, planned: 12 }, { basis: 'evidence' }),
  volume_high: F('volume_high', { muscle: 'Chest', sets: 24, floor: 10, ceiling: 20, goal: 'muscle', weeks: 4 }),
  frequency_low: F('frequency_low', { muscles: 'Chest, Upper back', count: 2, perWeek: 1, target: 2 }),
  progressing: F('progressing', { exercise: 'barbell bench press', pct: 1.8, e1rm: 92.5, weeks: 7, sessions: 8, unit: 'kg' }, { kind: 'good' }),
  stalled: F('stalled', { exercise: 'barbell bench press', weeks: 6, sessions: 6, e1rm: 90, pct: 0.1, unit: 'kg', muscle: 'Chest', sets: 6, floor: 10 }),
  falling: F('falling', { exercise: 'barbell bench press', pct: -2.1, weeks: 5, sessions: 5 }),
  fatigue: F('fatigue', { lifts: 2, names: 'bench, row', worstPct: -3.4, rirDrop: 1.2, sleepHours: 5.5, deloadDays: 7, deloadSetsPct: 50, deloadSetsPerWeek: 8, deloadRir: 3 }, { kind: 'act' }),
  block_long: F('block_long', { weeks: 7, typical: 5.6 }, { kind: 'info' }),
  adherence: F('adherence', { planned: 4, done: 2.3, weeks: 4 }),
  effort_far: F('effort_far', { rir: 4.6, sets: 40 }),
  rate_effort: F('rate_effort', { sets: 1, needed: 5 }, { kind: 'info' }),
  weight_fast: F('weight_fast', { pct: 1.3, kgPerWeek: 1.2, weighIns: 6, fast: 1, slow: 0.25, trialSlow: 0.7, trialFast: 1.4 }, { kind: 'act' }),
  weight_on_track: F('weight_on_track', { pct: 0.6, kgPerWeek: 0.5, weighIns: 6, fast: 1, slow: 0.25, trialSlow: 0.7, trialFast: 1.4 }, { kind: 'good' }),
  weight_flat: F('weight_flat', { pct: 0, kgPerWeek: 0, weighIns: 5, fast: 1, slow: 0.25, trialSlow: 0.7, trialFast: 1.4 }, { kind: 'info' }),
  guideline_met: F('guideline_met', { perWeek: 2.5 }, { kind: 'good' }),
  protein_low: F('protein_low', { gPerKg: 1.1, avgG: 85, days: 9, kg: 78, target: 1.6, goal: 'muscle' }, { basis: 'evidence' }),
  weight_down_muscle: F('weight_down_muscle', { pct: 0.4, kgPerWeek: 0.3, weighIns: 7, aimLowPct: 0.25, aimHighPct: 0.5 }, { basis: 'practice' })
}

suite('fixed text', () => {
  it('has text for every rule trainer.js can fire', () => {
    const src = fs.readFileSync(new URL('./trainer.js', import.meta.url), 'utf8')
    const used = [...new Set([...src.matchAll(/code: '([a-z_]+)'/g)].map(m => m[1]).concat([...src.matchAll(/code: m\.weekly === 0 \? '([a-z_]+)' : '([a-z_]+)'/g)].flatMap(m => [m[1], m[2]])))]
    expect(used.length).toBeGreaterThan(10)
    used.forEach(c => expect(CODES, c).toContain(c))
    CODES.forEach(c => expect(FIXTURES[c], 'fixture for ' + c).toBeTruthy())
  })

  it('fills every placeholder for every rule', () => {
    CODES.forEach(code => {
      const { title, body } = describe(FIXTURES[code])
      for (const s of [title, body]) {
        expect(s, code).toBeTruthy()
        expect(s, code).not.toMatch(/\{\d\}|undefined|NaN|null/)
      }
    })
  })

  it('names the basis of the rule it relies on', () => {
    expect(describe(FIXTURES.volume_low).body).toMatch(/meta-analysis/)
    expect(describe(FIXTURES.volume_none).body).toMatch(/rule of thumb/)
    expect(describe(FIXTURES.fatigue).body).toMatch(/not proof/)
    expect(Object.keys(BASIS_LABEL)).toEqual(['evidence', 'practice', 'heuristic'])
  })

  it('states the trial’s two rates from the facts rather than from memory', () => {
    const { body } = describe(FIXTURES.weight_fast)
    expect(body).toContain('0.7%')
    expect(body).toContain('1.4%')
  })

  it('picks the most pressing finding for a headline', () => {
    expect(headlineOf({ ready: true, findings: [FIXTURES.progressing, FIXTURES.fatigue, FIXTURES.volume_low] })).toBe('Signs you need a lighter week')
    expect(headlineOf({ ready: true, findings: [FIXTURES.progressing] })).toBe('Nothing needs changing right now')
    expect(headlineOf({ ready: false, findings: [FIXTURES.data_thin] })).toBe('Not enough training logged yet')
  })
})

suite('what leaves the device', () => {
  const S = { lang: 'en', coachProfile: { goal: 'muscle', level: 'some', age: 33, limits: 'sore shoulder' }, workouts: [], unit: 'kg' }
  const analysis = { findings: [FIXTURES.fatigue, FIXTURES.rate_effort, FIXTURES.volume_low, FIXTURES.data_thin] }

  it('carries findings, goal and level and nothing from the profile text', () => {
    const c = trainerContext(S, analysis)
    expect(Object.keys(c).sort()).toEqual(['findings', 'goal', 'language', 'level', 'medical', 'question'])
    expect(JSON.stringify(c)).not.toContain('shoulder')
    expect(c.findings.map(f => f.code)).toEqual(['fatigue', 'volume_low', 'data_thin'])   // info dropped, data_thin kept
    expect(c.findings[0]).not.toHaveProperty('action')
  })

  it('flags minors, health mode and medical wording so the server keeps the model out', () => {
    expect(trainerContext(S, analysis).medical).toBe(false)
    expect(trainerContext({ ...S, coachProfile: { ...S.coachProfile, age: 16 } }, analysis).medical).toBe(true)
    expect(trainerContext({ ...S, coachProfile: { ...S.coachProfile, limits: 'recent surgery' } }, analysis).medical).toBe(true)
    expect(trainerContext({ ...S, health: { on: true } }, analysis).medical).toBe(true)
    expect(trainerContext(S, analysis, 'I have chest pain').medical).toBe(true)
  })

  it('caps the question', () => {
    expect(trainerContext(S, analysis, 'x'.repeat(1000)).question).toHaveLength(MAX_QUESTION)
  })

  it('is accepted whole by the server’s cleaner, with nothing lost', () => {
    const c = trainerContext(S, { findings: Object.values(FIXTURES) })
    const cleaned = cleanTrainerContext(c)
    expect(cleaned.findings).toHaveLength(c.findings.length)
    cleaned.findings.forEach((f, i) => expect(f.facts).toEqual(c.findings[i].facts))
  })
})

suite('browser and server agree', () => {
  it('use the same medical word list', () => {
    expect(SERVER_STEMS).toEqual(MEDICAL_STEMS)
  })
  it('use the same evidence ids', () => {
    expect(SERVER_IDS).toEqual(EVIDENCE_IDS)
  })
})

suite('evidence registry', () => {
  it('has a DOI and PMID for every source, and says what the source cannot show', () => {
    Object.values(EVIDENCE).forEach(e => {
      expect(e.doi).toMatch(/^10\.\d{4,}\//)
      expect(e.pmid).toMatch(/^\d+$/)
      expect(e.claim.length).toBeGreaterThan(30)
      expect(e.limit.length).toBeGreaterThan(10)
    })
  })
  it('keeps the deload source honest about being a survey', () => {
    expect(EVIDENCE.deload.limit).toMatch(/does not show/)
  })
})

suite('end to end on a real analysis', () => {
  it('produces findings whose fixed text renders cleanly', () => {
    const NOW = new Date(2026, 9, 25, 12).getTime()
    const ws = []
    for (let i = 0; i < 8; i++) {
      const start = NOW - (i * 3 + 1) * 86400000
      ws.push({ id: 'w' + i, d: new Date(start).toISOString().slice(0, 10), start, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }] })
    }
    const a = analyze({ unit: 'kg', workouts: ws, routines: [], week: {}, bodyweight: [], coachProfile: { goal: 'muscle', age: 30 } }, NOW)
    expect(a.ready).toBe(true)
    a.findings.forEach(f => {
      const { title, body } = describe(f)
      expect(title + body).not.toMatch(/\{\d\}|undefined|NaN/)
    })
  })
})

suite('in Swedish', () => {
  it('renders every rule in Swedish with no placeholders left, and keeps muscle names lower-case mid-sentence', async () => {
    const { setLang } = await import('./i18n.js')
    await setLang('sv')
    try {
      CODES.forEach(code => {
        const { title, body } = describe(FIXTURES[code])
        expect(title + body, code).not.toMatch(/\{\d\}|undefined|NaN/)
        // none of the English source sentences leaks through
        expect(body, code).not.toMatch(/\b(the|your|with|about)\b/i)
      })
      const low = describe(FIXTURES.volume_low)
      expect(low.body).toContain('för bröst')
      expect(low.title).toBe('Bröst ligger lite lågt')
      expect(describe(FIXTURES.weight_fast).body).toMatch(/0,7 %/)
    } finally { await setLang('en') }
  })
})

suite('follow-up questions', () => {
  const analysis = { findings: [FIXTURES.volume_low] }
  const ok = (headline, ...texts) => ({ status: 'ok', headline, paragraphs: texts.map(text => ({ text, cites: [], findings: [] })) })

  it('a first question carries no history field at all', () => {
    expect('history' in trainerContext({}, analysis, 'hello')).toBe(false)
    expect('history' in trainerContext({}, analysis, 'hello', [])).toBe(false)
  })

  it('turns earlier answers into plain text next to their questions', async () => {
    const { answerText } = await import('./trainer-ai.js')
    expect(answerText(ok('Chest is light', 'Add a set.', 'Then recheck.'))).toBe('Chest is light Add a set. Then recheck.')
    expect(answerText({ status: 'outside_scope' })).toBe('')
    expect(answerText(null)).toBe('')
    const c = trainerContext({}, analysis, 'and legs?', [{ question: 'how is chest?', answer: ok('Chest is light', 'Add a set.') }])
    expect(c.history).toEqual([{ question: 'how is chest?', answer: 'Chest is light Add a set.' }])
    expect(c.question).toBe('and legs?')
  })

  it('sends at most the last three turns, oldest first, and caps their length', () => {
    const thread = [1, 2, 3, 4, 5].map(n => ({ question: 'q' + n, answer: ok('h' + n, 'x'.repeat(2000)) }))
    const c = trainerContext({}, analysis, 'next', thread)
    expect(c.history.map(h => h.question)).toEqual(['q3', 'q4', 'q5'])
    expect(c.history.every(h => h.answer.length <= 700)).toBe(true)
  })

  it('a medical word in an earlier question marks the whole chat as medical, as the server does', () => {
    const thread = [{ question: 'I had chest pain yesterday', answer: ok('h', 't') }]
    expect(trainerContext({}, analysis, 'and now?', thread).medical).toBe(true)
    expect(trainerContext({}, analysis, 'and now?', []).medical).toBe(false)
  })
})

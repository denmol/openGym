// The trainer's own words: fixed text for every rule in trainer.js.
//
// This is what the app says when there is no API key, when the model is kept out (a minor, a
// health flag), and when a model's answer fails the check in api/trainer.js. It is written to
// be complete on its own — the model is a friendlier voice for the same content, not a source
// of any of it.
//
// Strings are English source text and double as i18n keys (see lib/i18n.js).

import { t } from './i18n.js'
import { fmtNum } from './format.js'

export const BASIS_LABEL = {
  evidence: 'Study finding',
  practice: 'Common practice',
  heuristic: 'Rule of thumb'
}
export const BASIS_NOTE = {
  evidence: 'Restates what the cited study found.',
  practice: 'What coaches report doing. The source describes the practice; it doesn’t show it works.',
  heuristic: 'This app’s own threshold, informed by the source but not stated by it.'
}

// Every rule trainer.js can fire. A test reads trainer.js and fails if a code appears there
// that has no text here.
export const CODES = [
  'data_thin', 'volume_none', 'volume_low', 'volume_high', 'frequency_low', 'progressing', 'stalled',
  'falling', 'fatigue', 'block_long', 'adherence', 'effort_far', 'rate_effort', 'weight_fast',
  'weight_on_track', 'weight_flat', 'guideline_met', 'protein_low', 'weight_down_muscle'
]

// Numbers go through the locale (a decimal comma in Swedish), like the rest of the app.
const n = x => fmtNum(x)
const m = name => t(name)
const ml = name => t(name).toLowerCase()      // mid-sentence: "for chest", not "for Chest"

/** { title, body } for one finding. */
export function describe(f) {
  const x = f.facts
  switch (f.code) {
    case 'data_thin':
      return {
        title: t('Not enough training logged yet'),
        body: t('Your trainer needs at least {0} finished workouts in the last {1} days to say anything useful. You have {2}. Until then it won’t guess.', x.needed, x.days, x.workouts)
      }
    case 'volume_none':
      return {
        title: t('No {0} work logged', ml(x.muscle)),
        body: t('You haven’t done a working set for {0} in the last {1} weeks. For your goal the aim is roughly {2}–{3} sets a week.', ml(x.muscle), n(x.weeks), x.floor, x.ceiling) + rangeNote(f) + plannedNote(x)
      }
    case 'volume_low':
      return {
        title: f.kind === 'act' ? t('{0} is under-trained', m(x.muscle)) : t('{0} is a little light', m(x.muscle)),
        body: t('About {0} sets a week for {1}, against a range of {2}–{3}.', n(x.sets), ml(x.muscle), x.floor, x.ceiling) + rangeNote(f) + plannedNote(x)
      }
    case 'volume_high':
      return {
        title: t('{0} gets a lot of volume', m(x.muscle)),
        body: t('About {0} sets a week for {1}, above {2}. The research doesn’t set an upper limit, so this is a rule of thumb: if recovery or progress suffers, trim here first.', n(x.sets), ml(x.muscle), x.ceiling)
      }
    case 'frequency_low':
      return {
        title: t('Some muscles are trained about once a week'),
        body: t('Trained about {0} times a week: {1}. With volume matched, training a muscle twice a week gave better growth than once, so consider splitting those sets over two days.', n(x.perWeek), x.muscles.split(', ').map(ml).join(', ') + (x.count > 5 ? ' …' : ''))
      }
    case 'progressing':
      return {
        title: t('{0} is going up', x.exercise),
        body: t('Estimated 1RM is up about {0}% a week over {1} weeks ({2} sessions), now around {3} {4}.', n(x.pct), n(x.weeks), x.sessions, n(x.e1rm), x.unit)
      }
    case 'stalled':
      return {
        title: t('{0} has levelled off', x.exercise),
        body: t('Estimated 1RM has barely moved in {0} weeks ({1} sessions, around {2} {3}).', n(x.weeks), x.sessions, n(x.e1rm), x.unit) + ' ' +
          (x.muscle && x.sets < x.floor
            ? t('{0} gets only about {1} sets a week, below {2}: more volume is the first thing to try.', m(x.muscle), n(x.sets), x.floor)
            : t('Volume looks fine, so look at recovery next: sleep, stress, and how close to failure you train.'))
      }
    case 'falling':
      return {
        title: t('{0} is trending down', x.exercise),
        body: t('Estimated 1RM is down about {0}% a week over {1} weeks. One lift on its own isn’t a pattern; if others follow, take a lighter week.', n(Math.abs(x.pct)), n(x.weeks))
      }
    case 'fatigue': {
      let extra = ''
      if (x.rirDrop > 0) extra += ' ' + t('Your sets are also ending about {0} reps closer to failure than before.', n(x.rirDrop))
      if (x.sleepHours > 0) extra += ' ' + t('You’re sleeping about {0} hours a night.', n(x.sleepHours))
      return {
        title: t('Signs you need a lighter week'),
        body: t('{0} lifts are trending down ({1}), the worst by about {2}% a week.', x.lifts, x.names, n(Math.abs(x.worstPct))) + extra + ' ' +
          t('A common response is a deload: about {0} days, roughly {1}% of the sets, the same sessions per week, and {2} or more reps left in reserve. That’s what lifters report doing, not proof that it works.', x.deloadDays, x.deloadSetsPct, x.deloadRir)
      }
    }
    case 'block_long':
      return {
        title: t('{0} weeks without a lighter week', x.weeks),
        body: t('Lifters in a survey took a deload about every {0} weeks. That describes habit, not a rule. Act on it if progress or recovery start to slip.', n(x.typical))
      }
    case 'adherence':
      return {
        title: t('Fewer sessions than planned'),
        body: t('You planned {0} a week and did about {1}. A plan you can keep beats a bigger one you can’t, so consider planning {2}.', x.planned, n(x.done), Math.max(1, Math.round(x.done)))
      }
    case 'effort_far':
      return {
        title: t('Most sets end far from failure'),
        body: t('Your rated sets average {0} reps in reserve across {1} sets. That can be fine, but guesses far from failure are the least accurate, so treat it as rough. For more stimulus, add load or reps on the last set.', n(x.rir), x.sets)
      }
    case 'rate_effort':
      return {
        title: t('Rate your effort to get better advice'),
        body: t('Only {0} of your recent sets have a reps-in-reserve rating, and it takes {1}. Turn on RIR in Settings and the trainer can judge how hard you actually train.', x.sets, x.needed)
      }
    case 'weight_fast':
      return {
        title: t('Weight is falling faster than the research supports'),
        body: t('Your weight is falling about {0}% of body weight a week ({1} kg). In one trial of athletes who trained with weights, losing {2}% a week kept or added lean mass, while {3}% a week did not. Slowing down protects muscle.', n(x.pct), n(x.kgPerWeek), n(x.trialSlow), n(x.trialFast))
      }
    case 'weight_on_track':
      return {
        title: t('Weight is moving at a sensible pace'),
        body: t('About {0}% of body weight a week ({1} kg) across {2} weigh-ins. That’s slower than the {3}% a week this app flags as fast.', n(x.pct), n(x.kgPerWeek), x.weighIns, n(x.fast))
      }
    case 'weight_flat':
      return {
        title: t('Weight is holding steady'),
        body: t('The trend across {0} weigh-ins is roughly flat.', x.weighIns)
      }
    case 'protein_low':
      return {
        title: t('Protein is below where gains levelled off'),
        body: t('You logged about {0} g of protein a day over {1} days, around {2} g per kg of body weight. In a meta-analysis of strength-training trials, protein supplements added no more lean mass beyond about {3} g per kg a day. If you don’t log every meal, treat this as a rough guide.', n(x.avgG), x.days, n(x.gPerKg), n(x.target)) +
          (x.goal === 'fatloss' ? ' ' + t('While losing weight, higher intakes are common in practice; a dietitian can set a number for you.') : '')
      }
    case 'weight_down_muscle':
      return {
        title: t('Weight is falling while you aim to build muscle'),
        body: t('Your weight is falling about {0}% a week ({1} kg) across {2} weigh-ins. A review of off-season nutrition for bodybuilders aims for a gain of roughly {3}–{4}% a week for novice and intermediate lifters. It is a narrative review, not a trial, but it points the same way: building muscle usually takes eating enough.', n(x.pct), n(x.kgPerWeek), x.weighIns, n(x.aimLowPct), n(x.aimHighPct))
      }
    case 'guideline_met':
      return {
        title: t('You’re meeting the basic guideline'),
        body: t('About {0} strength sessions a week. The WHO recommends regular muscle-strengthening activity for adults, and you’re doing it.', n(x.perWeek))
      }
    default:
      return { title: f.code, body: '' }
  }
}

function rangeNote(f) {
  return ' ' + (f.basis === 'evidence'
    ? t('In the meta-analysis, more weekly sets per muscle went with more growth.')
    : t('That range is this app’s rule of thumb.'))
}
function plannedNote(x) {
  return x.planned > 0 ? ' ' + t('Your current plan would give it about {0} a week.', n(x.planned)) : ''
}

/** One line for a card: the most important thing, or reassurance. */
export function headlineOf(analysis) {
  const f = analysis.findings.find(x => x.kind === 'act') || analysis.findings.find(x => x.kind === 'watch')
  if (f) return describe(f).title
  if (!analysis.ready) return t('Not enough training logged yet')
  return t('Nothing needs changing right now')
}

// The prompt the user pastes into ChatGPT, and the follow-up that asks it to fix what
// the validator rejected.
//
// v1 has no API key: the app writes the prompt, the user carries it across, and pastes
// the answer back. That makes the prompt itself the whole interface, so it is written to
// be read by a person too — someone who cannot see what is being sent about them will
// not use the feature twice.
//
// The one rule worth restating here, because it looks like an omission: the plan must
// carry NO weights. A brand-new account has no history, so any weight the model writes
// is a guess from age and body weight, which is the thing language models are worst at.
// The app already has the machinery for this — progression answers "Nothing logged yet
// — this session sets the baseline" and the first set asks the user to confirm what they
// actually lifted. See docs in coach-validate.js.

import { GLYPHS } from './glyphs.js'
import { LEVEL_NAME, GOAL_NAME } from './coach-profile.js'
import { shortlist, shortlistLines } from './coach-catalog.js'
import { LANGS } from './i18n.js'

const SCHEMA = `{
  "opengym_plan": 1,
  "name": "<short name for the whole plan>",
  "week": { "<0-6, 0=Sunday>": "<routine id>", ... },
  "routines": [
    {
      "id": "<your own short id, e.g. r1>",
      "name": "<name of this training day>",
      "emoji": "<one of: ${GLYPHS.join(', ')}>",
      "ex": [
        {
          "id": "<id from the exercise list below — nothing else>",
          "sets": <number>,
          "reps": <number>,
          "prog": "linear" | "greyskull" | "double" | "off",
          "inc": <weight added per progression step, e.g. 2.5>,
          "repsMin": <only with "double">,
          "repsMax": <only with "double">
        }
      ]
    }
  ]
}`

const RULES = [
  'Reply with the JSON object and nothing else. No explanation before or after it.',
  'Use only exercise ids from the list below. Never invent an id, and never use an exercise name in place of an id.',
  'Do NOT include a "weight" field on any exercise. This person has no training history yet, so the first week is for finding their working weights — the app asks for and records them.',
  'Every id in "week" must be the id of a routine in "routines".',
  'Give each training day a name in the user\'s language (see below). Exercise ids stay as they are.',
  'Prefer compound movements as the first exercises of a day, isolation work after.',
  'Keep each muscle group between 6 and 22 working sets per week across the whole plan.'
]

const PROG_HELP = `Progression rules ("prog"):
  linear    — every rep in every set hit, weight goes up by "inc" next time. Good default for barbell work.
  greyskull — two straight sets plus a final set to failure. For a beginner on the main lifts.
  double    — work up a rep range at the same weight, then add weight. Needs "repsMin" and "repsMax". Good for dumbbell and machine work.
  off       — no automatic progression. Use for bodyweight and core work where "inc" makes no sense.`

const line = (label, value) => (value == null || value === '' ? null : `- ${label}: ${value}`)

/** The profile as the model should read it — omitting anything the user left blank. */
export function profileLines(p, unit = 'kg', bodyweight = null) {
  return [
    line('Age', p.age),
    line('Sex', p.sex),
    line('Height', p.heightCm ? p.heightCm + ' cm' : null),
    line('Body weight', bodyweight ? bodyweight + ' ' + unit : null),
    line('Experience', LEVEL_NAME[p.level]),
    line('Main goal', GOAL_NAME[p.goal]),
    line('Sessions per week', p.days),
    line('Minutes per session', p.minutes),
    line('Equipment available', (p.equipment || []).join(', ')),
    line('Injuries and limitations', p.limits),
    line('Would rather avoid', p.dislikes)
  ].filter(Boolean).join('\n')
}

/**
 * The full prompt. `lang` is the app's current language code — the model writes the day
 * names in it, while exercise ids and the schema stay as they are.
 */
export function buildPrompt(profile, { lang = 'en', unit = 'kg', bodyweight = null } = {}) {
  const list = shortlist(profile.equipment)
  const langName = LANGS[lang] || 'English'
  return `You are writing a weekly strength training plan for one person, as JSON for an app called Dagsnav.

RULES
${RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Write the plan for ${profile.days} training ${profile.days === 1 ? 'day' : 'days'} per week, about ${profile.minutes} minutes each.
Write the plan name and the day names in ${langName}.

THE PERSON
${profileLines(profile, unit, bodyweight)}

${PROG_HELP}

SCHEMA
${SCHEMA}

EXERCISES YOU MAY USE
Format: id|name|body part|equipment|target muscle
${shortlistLines(list)}
`
}

/**
 * Sent back into the same chat when the validator rejects the answer. Short on purpose:
 * the model still has the original prompt in context, so repeating it wastes the user's
 * paste and invites a rewrite of the parts that were already fine.
 */
export function buildRepairPrompt(problems) {
  return `That plan has problems. Fix these and reply with the corrected JSON object only — same format, no explanation:

${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Keep everything that was not listed above exactly as it was.
`
}

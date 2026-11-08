// The Push/Pull/Legs starter plan. Shared by the "Load starter plan" action in Settings
// and by the demo build, which seeds a history on top of exactly these routines.
import { uid } from './format.js'
import { t } from './i18n.js'

const PROGRAMS = {
  ppl: [
    ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
    ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
    ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
  ],
  fullbody: [
    ['Full body A', 'barbell', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 8], ['0605', 3, 12]]],
    ['Full body B', 'dumbbell', [['0085', 3, 8], ['0027', 3, 8], ['0047', 3, 10], ['0313', 3, 12]]]
  ],
  upperlower: [
    ['Upper A', 'barbell', [['0025', 4, 6], ['0027', 4, 6], ['0047', 3, 10], ['0313', 3, 12]]],
    ['Lower A', 'legs', [['0043', 4, 6], ['0085', 3, 8], ['0585', 3, 12], ['0605', 4, 12]]],
    ['Upper B', 'pullup', [['2330', 4, 6], ['0426', 4, 8], ['1323', 3, 10], ['0241', 3, 12]]],
    ['Lower B', 'legs', [['0085', 4, 6], ['0739', 3, 10], ['0586', 3, 12], ['0605', 4, 12]]]
  ],
  fiveThreeOne: [
    ['Squat 5/3/1', 'legs', [['0043', 3, 5, '531'], ['0085', 3, 8], ['0605', 4, 12]]],
    ['Bench 5/3/1', 'barbell', [['0025', 3, 5, '531'], ['0047', 3, 10], ['0241', 3, 12]]],
    ['Deadlift 5/3/1', 'barbell', [['0085', 3, 5, '531'], ['2330', 3, 8], ['0313', 3, 12]]]
  ]
}

export const STARTER_PROGRAMS = [
  { id: 'ppl', name: 'Push / Pull / Legs', days: [1, 3, 5] },
  { id: 'fullbody', name: 'Full body', days: [1, 4] },
  { id: 'upperlower', name: 'Upper / Lower', days: [1, 2, 4, 5] },
  { id: 'fiveThreeOne', name: '5/3/1', days: [1, 3, 5] }
]

export const starterRoutines = (program = 'ppl') =>
  (PROGRAMS[program] || PROGRAMS.ppl).map(([name, emoji, list]) => ({ id: uid(), name: t(name), emoji, ex: list.map(([id, sets, reps, prog]) => ({ id, sets, reps, weight: 0, ...(prog ? { prog } : {}) })) }))

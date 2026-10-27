import { describe, it, expect } from 'vitest'
import { parseCoachReply } from './coach-parse.js'
import { validateCoachPlan } from './coach-validate.js'
import { parsePlan } from './plan-share.js'

// A real reply, pasted from a phone: typographic quotes and \u escapes (reported by the user).
const REPLY = '{“opengym_plan”:1,“name”:“Styrka och fettminskning”,“week”:{“1”:“r1”,“2”:“r2”,“4”:“r3”,“6”:“r4”},“routines”:[{“id”:“r1”,“name”:”\\u00d6verkropp A”,“emoji”:“barbell”,“ex”:[{“id”:“0030”,“sets”:3,“reps”:8,“prog”:“linear”,“inc”:2.5},{“id”:“2330”,“sets”:3,“reps”:8,“prog”:“double”,“inc”:2.5,“repsMin”:8,“repsMax”:12},{“id”:“0239”,“sets”:3,“reps”:8,“prog”:“double”,“inc”:2.5,“repsMin”:8,“repsMax”:12},{“id”:“0662”,“sets”:3,“reps”:10,“prog”:“off”,“inc”:0},{“id”:“0225”,“sets”:3,“reps”:12,“prog”:“double”,“inc”:1,“repsMin”:12,“repsMax”:15},{“id”:“0113”,“sets”:3,“reps”:8,“prog”:“double”,“inc”:2.5,“repsMin”:8,“repsMax”:12}]},{“id”:“r2”,“name”:“Underkropp och b\\u00e5l A”,“emoji”:“legs”,“ex”:[{“id”:“0026”,“sets”:3,“reps”:8,“prog”:“linear”,“inc”:2.5},{“id”:“1008”,“sets”:3,“reps”:12,“prog”:“off”,“inc”:0},{“id”:“3663”,“sets”:3,“reps”:10,“prog”:“off”,“inc”:0},{“id”:“1385”,“sets”:3,“reps”:10,“prog”:“double”,“inc”:5,“repsMin”:10,“repsMax”:15},{“id”:“2204”,“sets”:3,“reps”:10,“prog”:“off”,“inc”:0},{“id”:“1412”,“sets”:3,“reps”:12,“prog”:“double”,“inc”:1,“repsMin”:12,“repsMax”:15}]},{“id”:“r3”,“name”:”\\u00d6verkropp B”,“emoji”:“arm”,“ex”:[{“id”:“1719”,“sets”:3,“reps”:8,“prog”:“linear”,“inc”:2.5},{“id”:“0579”,“sets”:3,“reps”:8,“prog”:“double”,“inc”:2.5,“repsMin”:8,“repsMax”:12},{“id”:“0239”,“sets”:3,“reps”:8,“prog”:“double”,“inc”:2.5,“repsMin”:8,“repsMax”:12},{“id”:“0662”,“sets”:3,“reps”:10,“prog”:“off”,“inc”:0},{“id”:“0225”,“sets”:3,“reps”:12,“prog”:“double”,“inc”:1,“repsMin”:12,“repsMax”:15},{“id”:“0113”,“sets”:3,“reps”:8,“prog”:“double”,“inc”:2.5,“repsMin”:8,“repsMax”:12}]},{“id”:“r4”,“name”:“Underkropp och b\\u00e5l B”,“emoji”:“legs”,“ex”:[{“id”:“0026”,“sets”:3,“reps”:8,“prog”:“linear”,“inc”:2.5},{“id”:“1008”,“sets”:3,“reps”:12,“prog”:“off”,“inc”:0},{“id”:“3663”,“sets”:3,“reps”:10,“prog”:“off”,“inc”:0},{“id”:“1385”,“sets”:3,“reps”:10,“prog”:“double”,“inc”:5,“repsMin”:10,“repsMax”:15},{“id”:“2204”,“sets”:3,“reps”:10,“prog”:“off”,“inc”:0},{“id”:“1411”,“sets”:3,“reps”:12,“prog”:“double”,“inc”:1,“repsMin”:12,“repsMax”:15}]}]}'

describe('the plan pasted from a phone', () => {
  it('reads as four routines with their names and exercises', () => {
    const d = parseCoachReply(REPLY)
    expect(d.routines.map(r => r.name)).toEqual(['Överkropp A', 'Underkropp och bål A', 'Överkropp B', 'Underkropp och bål B'])
    expect(d.routines.map(r => r.ex.length)).toEqual([6, 6, 6, 6])
    expect(d.week).toEqual({ 1: 'r1', 2: 'r2', 4: 'r3', 6: 'r4' })
  })

  it('goes on to validate and import', () => {
    const d = parseCoachReply(REPLY)
    const res = validateCoachPlan(d, { equipment: [], limits: '' })
    expect({ errors: res.errors.map(e => JSON.stringify(e)), ok: res.ok }).toEqual({ errors: [], ok: true })
    const bundle = parsePlan(d)
    expect(bundle.routineCount).toBe(4)
    expect(bundle.exerciseCount).toBe(24)
    expect(bundle.dropped).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { extractJSON, parseCoachReply } from './coach-parse.js'

describe('extractJSON', () => {
  it('takes a bare object as it is', () => {
    expect(extractJSON('{"a":1}')).toBe('{"a":1}')
  })

  it('digs the object out of a fenced code block', () => {
    const reply = 'Here you go!\n\n```json\n{"opengym_plan":1,"routines":[]}\n```\n\nGood luck with the training!'
    expect(JSON.parse(extractJSON(reply)).opengym_plan).toBe(1)
  })

  it('keeps nested objects whole', () => {
    const src = '{"a":{"b":{"c":[1,2]}},"d":3}'
    expect(extractJSON('noise ' + src + ' more noise')).toBe(src)
  })

  it('does not count braces inside strings', () => {
    const src = '{"name":"3 × {8-12} reps","ok":true}'
    expect(JSON.parse(extractJSON(src)).name).toBe('3 × {8-12} reps')
  })

  it('handles escaped quotes inside strings', () => {
    const src = '{"name":"the \\"big\\" day {x}","n":1}'
    expect(JSON.parse(extractJSON(src)).name).toBe('the "big" day {x}')
  })

  it('returns null when there is no object at all', () => {
    expect(extractJSON('sorry, I cannot help with that')).toBeNull()
    expect(extractJSON('')).toBeNull()
    expect(extractJSON(null)).toBeNull()
  })

  it('returns null for an object that is never closed', () => {
    expect(extractJSON('{"a":1')).toBeNull()
  })
})

describe('parseCoachReply', () => {
  it('parses a realistic chatty answer', () => {
    const reply = 'Absolutely — here is a 3-day plan.\n\n```json\n' +
      '{"opengym_plan":1,"name":"Full body","week":{"1":"r1"},"routines":[{"id":"r1","name":"A","ex":[]}]}\n' +
      '```\n\nStart light and focus on form.'
    const data = parseCoachReply(reply)
    expect(data.name).toBe('Full body')
    expect(data.routines).toHaveLength(1)
  })

  it('adds the format marker back when the model forgot it', () => {
    expect(parseCoachReply('{"routines":[]}').opengym_plan).toBe(1)
  })

  it('keeps an existing marker untouched', () => {
    expect(parseCoachReply('{"opengym_plan":1,"routines":[]}').opengym_plan).toBe(1)
  })

  it('asks for a paste when the box is empty', () => {
    expect(() => parseCoachReply('   ')).toThrow(/Paste the answer/)
  })

  it('explains when there is no plan in the answer', () => {
    expect(() => parseCoachReply('I need more information first.')).toThrow(/No plan found/)
  })

  it('explains when the JSON is broken', () => {
    expect(() => parseCoachReply('{"routines": [oops]}')).toThrow(/not valid JSON/)
  })

  it('explains a reply that is a bare list of routines, not the whole bundle', () => {
    expect(() => parseCoachReply('[{"id":"r1","ex":[]}]')).toThrow(/no training days in it/)
  })

  it('explains an object that is not a plan at all', () => {
    expect(() => parseCoachReply('{"sorry":"need more info"}')).toThrow(/no training days in it/)
  })
})

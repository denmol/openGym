import { describe, it, expect } from 'vitest'
import {
  sniffDelimiter, findHeader, toHM, detectUnit,
  parseGlucoseCSV, hasEntries, mergeGlucose, dropImported
} from './carelink.js'
import { parseCSV } from './import-csv.js'

// Shaped like a CareLink download: a preamble before the header, semicolons because the
// decimal separator is a comma, seconds on the clock, and both glucose columns present
// with only one of them filled in.
const CARELINK = `Sista sparade datum;2026-08-20
Namn;Anna Andersson
Enhet;MiniMed 780G

Index;Date;Time;BG Reading (mmol/L);Sensor Glucose (mmol/L);Bolus Volume Delivered (U);Basal Rate (U/h);BWZ Carb Input (grams)
1;2026-08-19;07:05:00;5,5;;;0,85;
2;2026-08-19;07:12:00;;;6,5;0,85;45
3;2026-08-19;12:30:00;9,9;;;0,90;
4;2026-08-19;22:40:00;7,1;;;0,80;
5;2026-08-20;07:00:00;3,4;;;0,85;
`

// A meter export in the other dialect: commas, mg/dL, one datetime column, US clock.
const METER = `Date,Glucose,Insulin
"8/19/2026 7:05 AM",99,
"8/19/2026 12:30 PM",178,6.5
"8/19/2026 10:40 PM",128,
`

describe('sniffDelimiter', () => {
  it('picks the semicolon out of a file whose decimals are commas', () => {
    // The naive count says comma: "5,5" splits every data row while the preamble stays whole.
    expect(sniffDelimiter(CARELINK)).toBe(';')
  })

  it('still picks the comma out of an ordinary CSV', () => {
    expect(sniffDelimiter(METER)).toBe(',')
  })

  it('falls back to a comma rather than throwing on nothing', () => {
    expect(sniffDelimiter('')).toBe(',')
    expect(sniffDelimiter('one line, no newline')).toBe(',')
  })
})

describe('findHeader', () => {
  it('walks past the preamble to the row that names the columns', () => {
    const rows = parseCSV(CARELINK, ';')
    // Three preamble rows; the blank one is dropped by the reader.
    expect(findHeader(rows)).toBe(3)
    expect(rows[3][1]).toBe('Date')
  })

  it('says so when nothing in the file looks like a header', () => {
    expect(findHeader(parseCSV('a,b,c\n1,2,3\n'))).toBe(-1)
  })
})

describe('toHM', () => {
  it('drops the seconds', () => {
    expect(toHM('07:05:00')).toBe('07:05')
    expect(toHM('13:45')).toBe('13:45')
  })

  it('reads a twelve-hour clock', () => {
    expect(toHM('1:45 PM')).toBe('13:45')
    expect(toHM('7:05 AM')).toBe('07:05')
    expect(toHM('12:30 AM')).toBe('00:30')
    expect(toHM('12:30 PM')).toBe('12:30')
  })

  it('returns nothing rather than a wrong time', () => {
    expect(toHM('25:00')).toBeNull()
    expect(toHM('')).toBeNull()
    expect(toHM('later')).toBeNull()
  })
})

describe('detectUnit', () => {
  it('believes the header where the header says', () => {
    expect(detectUnit('Sensor Glucose (mmol/L)', [99, 120])).toEqual({ unit: 'mmol', unitSource: 'header' })
    expect(detectUnit('BG Reading (mg/dL)', [5.5])).toEqual({ unit: 'mgdl', unitSource: 'header' })
  })

  it('infers from the values where it does not, and admits to inferring', () => {
    expect(detectUnit('Glucose', [4.5, 5.5, 9.1])).toEqual({ unit: 'mmol', unitSource: 'magnitude' })
    expect(detectUnit('Glucose', [99, 128, 178])).toEqual({ unit: 'mgdl', unitSource: 'magnitude' })
  })

  it('does not guess from nothing', () => {
    expect(detectUnit('Glucose', []).unitSource).toBe('default')
  })
})

describe('parsing a CareLink export', () => {
  const p = parseGlucoseCSV(CARELINK)

  it('finds the readings the file actually filled in', () => {
    // Both glucose headers are present; only BG Reading has values in it.
    expect(p.gField).toBe('bg')
    expect(p.readings).toHaveLength(4)
    expect(p.readings[0]).toMatchObject({ d: '2026-08-19', t: '07:05', v: 5.5, src: 'import' })
  })

  it('reads the unit off the header rather than inferring it', () => {
    expect(p.unit).toBe('mmol')
    expect(p.unitSource).toBe('header')
  })

  it('takes the bolus and leaves the basal rate alone', () => {
    expect(p.doses).toHaveLength(1)
    expect(p.doses[0]).toMatchObject({ d: '2026-08-19', t: '07:12', u: 6.5, kind: 'meal' })
    // Every row carries a basal rate. None of them is an amount delivered.
    expect(p.basalSkipped).toBe(5)
  })

  it('leaves the pump’s carb entry to the food log', () => {
    expect(p.carbSkipped).toBe(1)
  })

  it('reports the span it covers', () => {
    expect(p.from).toBe('2026-08-19')
    expect(p.to).toBe('2026-08-20')
  })

  it('carries a sample through, so the sheet can show real rows', () => {
    expect(p.sample.length).toBeGreaterThan(0)
    expect(p.sample[0].v).toBe(5.5)
  })
})

describe('parsing a meter export in the other dialect', () => {
  const p = parseGlucoseCSV(METER)

  it('reads one datetime column and a twelve-hour clock', () => {
    expect(p.readings.map(r => r.t)).toEqual(['07:05', '12:30', '22:40'])
    expect(p.readings[0].d).toBe('2026-08-19')
  })

  it('infers mg/dL from the magnitudes and stores mmol/L', () => {
    expect(p.unit).toBe('mgdl')
    expect(p.unitSource).toBe('magnitude')
    expect(p.readings[0].v).toBe(5.5)      // 99 mg/dL
    expect(p.readings[1].v).toBe(9.9)      // 178 mg/dL
  })

  it('takes the insulin column along', () => {
    expect(p.doses).toHaveLength(1)
    expect(p.doses[0].u).toBe(6.5)
  })
})

describe('when the parse would be wrong', () => {
  it('lets the caller overrule an inferred unit', () => {
    // Same file, read as mmol/L on purpose: the values are then out of range and dropped
    // rather than stored as blood sugars of 99.
    const p = parseGlucoseCSV(METER, { unit: 'mmol' })
    expect(p.readings).toHaveLength(0)
    expect(p.outOfRange).toBe(3)
  })

  it('drops a row no meter could have produced and counts it', () => {
    const junk = `Date,Time,Glucose
2026-08-19,07:05,5.5
2026-08-19,08:05,4001
2026-08-19,09:05,0
`
    const p = parseGlucoseCSV(junk, { unit: 'mmol' })
    expect(p.readings).toHaveLength(1)
    expect(p.outOfRange).toBe(2)
  })

  it('skips a row with a date but no clock, and says how many', () => {
    const p = parseGlucoseCSV(`Date,Glucose\n2026-08-19,5.5\n2026-08-20,6.1\n`)
    expect(p.readings).toHaveLength(0)
    expect(p.noTime).toBe(2)
  })

  it('reports a file it cannot read instead of returning nothing', () => {
    expect(parseGlucoseCSV('').error).toBe('empty')
    expect(parseGlucoseCSV('name,phone\nAnna,123\n').error).toBe('unrecognised')
    expect(hasEntries(parseGlucoseCSV('name,phone\nAnna,123\n'))).toBe(false)
    expect(hasEntries(parseGlucoseCSV(CARELINK))).toBe(true)
  })

  it('takes a hand-made column map for a file it has never seen', () => {
    const odd = `when,klockan,varde
2026-08-19,07:05,5.5
`
    expect(parseGlucoseCSV(odd).error).toBe('unrecognised')
    const p = parseGlucoseCSV(odd, { headerRow: 0, map: { date: 0, time: 1, bg: 2 }, unit: 'mmol' })
    expect(p.readings).toHaveLength(1)
    expect(p.readings[0].v).toBe(5.5)
  })
})

describe('merging into state', () => {
  it('adds what is new', () => {
    const S = { glucose: [], doses: [] }
    const r = mergeGlucose(S, parseGlucoseCSV(CARELINK))
    expect(r).toMatchObject({ readings: 4, doses: 1, duplicates: 0 })
    expect(S.glucose).toHaveLength(4)
  })

  it('adds nothing the second time the same file is imported', () => {
    const S = { glucose: [], doses: [] }
    mergeGlucose(S, parseGlucoseCSV(CARELINK))
    const again = mergeGlucose(S, parseGlucoseCSV(CARELINK))
    expect(again).toMatchObject({ readings: 0, doses: 0, duplicates: 5 })
    expect(S.glucose).toHaveLength(4)
  })

  it('keeps the log in order once merged', () => {
    const S = { glucose: [{ id: 'x', d: '2026-08-19', t: '23:00', v: 6.2 }], doses: [] }
    mergeGlucose(S, parseGlucoseCSV(CARELINK))
    const seq = S.glucose.map(g => g.d + ' ' + g.t)
    expect(seq).toEqual([...seq].sort())
  })

  it('survives a profile that has never logged anything', () => {
    const S = {}
    expect(() => mergeGlucose(S, parseGlucoseCSV(CARELINK))).not.toThrow()
    expect(S.glucose).toHaveLength(4)
  })

  it('does not let one file duplicate a row against itself', () => {
    const twice = CARELINK + '1;2026-08-19;07:05:00;5,5;;;0,85;\n'
    const S = { glucose: [], doses: [] }
    expect(mergeGlucose(S, parseGlucoseCSV(twice)).readings).toBe(4)
  })
})

describe('dropImported', () => {
  it('takes back a file and leaves what was typed by hand', () => {
    const S = { glucose: [{ id: 'mine', d: '2026-08-19', t: '09:00', v: 6.6 }], doses: [] }
    mergeGlucose(S, parseGlucoseCSV(CARELINK))
    const r = dropImported(S)
    expect(r).toMatchObject({ readings: 4, doses: 1 })
    expect(S.glucose).toEqual([{ id: 'mine', d: '2026-08-19', t: '09:00', v: 6.6 }])
  })

  it('is safe when nothing was ever imported', () => {
    const S = { glucose: [], doses: [] }
    expect(dropImported(S)).toMatchObject({ readings: 0, doses: 0 })
  })
})

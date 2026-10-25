// The design tokens, held to WCAG AA. Reads the real stylesheet, resolves each token for every
// theme × accent combination the app can show, and checks the text colours against the
// surfaces they sit on. A colour tweak that quietly drops below 4.5:1 fails here, not in
// someone's hands on a bright day.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Only the plain :root rules: :root, with a theme and/or an accent. (Media queries and the
// glass rules are about transparency, not text colour.)
const rules = []
for (const m of css.matchAll(/(:root(?:\[[^\]]+\])*)\s*\{([^}]*)\}/g)) {
  const attrs = [...m[1].matchAll(/\[data-([a-z]+)="([^"]+)"\]/g)].map(a => [a[1], a[2]])
  const decls = {}
  for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/g)) decls[d[1]] = d[2].trim()
  rules.push({ attrs, decls, order: rules.length })
}

const resolve = (name, ctx, depth = 0) => {
  if (depth > 8) throw new Error('token loop at ' + name)
  const hits = rules.filter(r => r.attrs.every(([k, v]) => ctx[k] === v) && name in r.decls)
    .sort((a, b) => a.attrs.length - b.attrs.length || a.order - b.order)
  if (!hits.length) throw new Error('no value for ' + name + ' in ' + JSON.stringify(ctx))
  const v = hits[hits.length - 1].decls[name]
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/)
  return ref ? resolve(ref[1], ctx, depth + 1) : v
}

const parse = v => {
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
    return { rgb: [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)), a: 1 }
  }
  m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] == null ? 1 : +m[4] }
  throw new Error('cannot read colour: ' + v)
}
const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg.rgb[i] * (1 - fg.a))
const lum = rgb => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const contrast = (fgName, bgName, ctx) => {
  const bg = parse(resolve(bgName, ctx))
  const fg = parse(resolve(fgName, ctx))
  return ratio(over(fg, bg), bg.rgb)
}

const ACCENTS = ['lime', 'sky', 'orange', 'violet', 'pink', 'red', 'teal', 'gold']
const SURFACES = ['--bg', '--surface', '--surface-2']
const STATUS = ['--green-t', '--blue-t', '--orange-t', '--yellow-t', '--red-t', '--pink-t', '--purple-t', '--teal-t']

describe('the stylesheet is readable by the checker', () => {
  it('finds the theme and accent rules', () => {
    expect(rules.length).toBeGreaterThan(15)
    expect(resolve('--acc-t', { theme: 'light', accent: 'lime' })).toMatch(/^#/)
  })
})

for (const theme of ['dark', 'light']) {
  describe(theme + ' theme: text meets WCAG AA (4.5:1) on every surface it sits on', () => {
    const base = { theme }
    for (const s of SURFACES) {
      it('primary, secondary and tertiary text on ' + s, () => {
        expect(contrast('--label', s, base)).toBeGreaterThanOrEqual(7)
        expect(contrast('--label-2', s, base)).toBeGreaterThanOrEqual(4.5)
        expect(contrast('--label-t', s, base)).toBeGreaterThanOrEqual(4.5)
      })
      it('status colours used as text on ' + s, () => {
        for (const c of STATUS) expect(contrast(c, s, base), c + ' on ' + s).toBeGreaterThanOrEqual(4.5)
      })
      it('every accent used as text on ' + s, () => {
        for (const a of ACCENTS) expect(contrast('--acc-t', s, { ...base, accent: a }), a + ' on ' + s).toBeGreaterThanOrEqual(4.5)
      })
    }
    it('the label on a filled accent button clears 3:1 (17px / 600 is large text)', () => {
      for (const a of ACCENTS) expect(contrast('--on-acc', '--acc', { ...base, accent: a }), a).toBeGreaterThanOrEqual(3)
    })
  })
}

describe('the non-text tertiary label stays decorative', () => {
  it('is deliberately below 4.5:1, which is why text must use --label-t', () => {
    expect(contrast('--label-3', '--surface', { theme: 'dark' })).toBeLessThan(4.5)
    expect(contrast('--label-3', '--surface', { theme: 'light' })).toBeLessThan(4.5)
  })
})

describe('no text is coloured with a token that fails as text', () => {
  const colourDecl = [...css.matchAll(/(?<![-\w])color:\s*var\((--[a-z0-9-]+)\)/g)].map(m => m[1])
  it('uses the text-safe tokens for every colour: declaration', () => {
    const bad = colourDecl.filter(t => ['--label-3', '--acc', '--green', '--blue', '--red', '--orange', '--yellow', '--pink', '--purple', '--teal'].includes(t))
    expect(bad).toEqual([])
    expect(colourDecl.length).toBeGreaterThan(40)
  })
})

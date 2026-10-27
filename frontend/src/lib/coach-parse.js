// Getting a plan out of whatever the chat actually replied with.
//
// The prompt asks for the JSON object and nothing else, and the answer usually is — but
// "usually" is not a parser. Real answers arrive wrapped in ```json fences, prefaced with
// "Here's your plan!", and followed by a paragraph of encouragement. Demanding a clean
// paste would push that cleanup onto the user, every single time, so it happens here.

// Typographic double quotes. Phones and chat apps "smarten" the straight quote when text is
// copied through them, and a JSON parser then sees no strings at all. One of these may open a
// string and another close it, or the same one may do both (”text”), so none of them is
// trusted to mean which.
const CURLY_DOUBLE = new Set(['\u201c', '\u201d', '\u201e', '\u201f', '\u2033', '\u301d', '\u301e', '\uff02', '\u00ab', '\u00bb'])

/**
 * Repair what copying through a phone does to JSON, without touching what it says.
 *
 *  · typographic quotes become the real thing — as a delimiter when the character before or
 *    after says it is one (after `{ [ : ,` it opens, before `: , } ]` it closes), and as an
 *    escaped quote when it sits inside a value ("the “big” day");
 *  · non-breaking spaces and zero-width characters, which look like nothing and are not JSON,
 *    become plain spaces or vanish;
 *  · a trailing comma before } or ], which models write and parsers refuse, is dropped.
 *
 * Valid JSON passes through unchanged. Strings are tracked as the scan runs, so none of this
 * is applied inside a value.
 */
export function repairJSON(raw) {
  const s = String(raw || '').replace(/^\ufeff/, '')
  const nextSig = i => { let j = i + 1; while (j < s.length && /\s|\u00a0/.test(s[j])) j++; return j < s.length ? s[j] : '' }
  // A string opened with a real quote is valid JSON and is left alone, curly quotes inside it
  // included. Only a string opened with a typographic quote is repaired.
  let out = '', inStr = false, esc = false, curlyOpened = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (esc) { out += c; esc = false; continue }
    if (inStr && c === '\\') { out += c; esc = true; continue }
    if (c === '\u00a0') { out += ' '; continue }
    if (c === '\u200b' || c === '\u200c' || c === '\u200d' || c === '\u2060') continue
    if (c === '"') {
      if (!inStr) { inStr = true; curlyOpened = false }
      else if (!curlyOpened) inStr = false
      else {                                   // a real quote inside a curly-opened string
        const n = nextSig(i)
        if (n === '' || ':,}]'.includes(n)) inStr = false
        else { out += '\\"'; continue }
      }
      out += c; continue
    }
    if (CURLY_DOUBLE.has(c)) {
      if (!inStr) { inStr = true; curlyOpened = true; out += '"'; continue }
      if (!curlyOpened) { out += c; continue }
      const n = nextSig(i)
      if (n === '' || ':,}]'.includes(n)) { inStr = false; out += '"' }
      else out += '\\"'
      continue
    }
    if (!inStr && c === ',' && (nextSig(i) === '}' || nextSig(i) === ']')) continue
    out += c
  }
  return out
}

/** JSON.parse, and if that fails the same text after repairJSON. Throws the original error. */
export function parseJSONLoose(raw) {
  try { return JSON.parse(raw) } catch (e) {
    try { return JSON.parse(repairJSON(raw)) } catch { throw e }
  }
}

/**
 * The first complete, balanced JSON object in a string.
 *
 * Written as a brace scanner rather than a regular expression because the object nests,
 * and because braces inside string values ("3 × {8-12}") must not be counted. Quotes and
 * their escapes are therefore tracked as the scan runs.
 */
export function extractJSON(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false, straight = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { if (inStr) esc = true; continue }
    if (c === '"') {
      if (!inStr) { inStr = true; straight = true } else if (straight) inStr = false
      else inStr = false                        // a real quote also closes a curly-opened string
      continue
    }
    if (CURLY_DOUBLE.has(c)) {
      if (!inStr) { inStr = true; straight = false } else if (!straight) inStr = false
      continue
    }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

/**
 * Parse a pasted answer into a plan bundle object (not yet validated — that is
 * coach-validate.js, and the shape check is plan-share's parsePlan).
 *
 * Throws with a message meant for the user, since there is nowhere else for it to go.
 * The English strings are the i18n keys; callers translate.
 */
export function parseCoachReply(text) {
  if (!String(text || '').trim()) throw new Error('Paste the answer from the chat first')
  const raw = extractJSON(text)
  if (!raw) throw new Error('No plan found in that answer — copy the whole reply, including the braces')
  let data
  try { data = parseJSONLoose(raw) } catch (e) {
    throw new Error('That answer is not valid JSON — ask the chat to send the plan again')
  }
  // A reply that is a bare list of routines rather than the whole bundle lands here as
  // its first element — worth its own message, since "no plan found" would be wrong.
  if (!Array.isArray(data.routines)) {
    throw new Error('That answer has no training days in it — ask the chat to send the whole plan')
  }
  // The model sometimes drops the format marker even when everything else is right.
  // Adding it back is safe: parsePlan checks the parts that actually matter.
  if (!data.opengym_plan) data.opengym_plan = 1
  return data
}

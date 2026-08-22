// Getting a plan out of whatever the chat actually replied with.
//
// The prompt asks for the JSON object and nothing else, and the answer usually is — but
// "usually" is not a parser. Real answers arrive wrapped in ```json fences, prefaced with
// "Here's your plan!", and followed by a paragraph of encouragement. Demanding a clean
// paste would push that cleanup onto the user, every single time, so it happens here.

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
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { if (inStr) esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
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
  try { data = JSON.parse(raw) } catch (e) {
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

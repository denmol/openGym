/* Photo of a meal -> what is on the plate. The model names the dishes and estimates grams and
   values per 100 g; the app then looks each dish up in the food catalogue and only keeps the
   model's numbers where there is no match. Everything is shown for confirmation before it is
   saved, so this file's job is to keep obviously impossible answers out and the request small.

   The photo itself is never stored or logged: it goes to the provider once and is dropped. */

export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;       // decoded; the app sends about 150-400 KB
export const PHOTO_CALL_COST = 2;                        // a picture costs more than a text question
const LANGS = new Set(['en', 'sv', 'de', 'es', 'fr', 'it', 'pt', 'pl', 'tr', 'ru', 'zh', 'ko', 'hi']);
const KEYS = ['kcal', 'carb', 'sugar', 'prot', 'fat', 'sat', 'fib', 'salt'];
const MAX_ITEMS = 8;

const nullableNumber = { type: ['number', 'null'] };
export const PHOTO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'unclear'],
  properties: {
    unclear: { type: 'boolean' },
    items: {
      type: 'array',
      maxItems: MAX_ITEMS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'search', 'grams', 'per100'],
        properties: {
          name: { type: 'string' },
          search: { type: 'string' },
          grams: { type: 'number' },
          per100: {
            type: 'object',
            additionalProperties: false,
            required: KEYS,
            properties: Object.fromEntries(KEYS.map(k => [k, nullableNumber]))
          }
        }
      }
    }
  }
};

/** { ok, image, lang } or { ok:false, error }. */
export function cleanPhotoRequest(body) {
  const image = body && body.image;
  const m = typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return { ok: false, error: 'bad image' };
  const bytes = Math.floor(m[2].length * 3 / 4);
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: 'photo too large' };
  if (bytes < 200) return { ok: false, error: 'bad image' };
  const lang = LANGS.has(body.lang) ? body.lang : 'en';
  return { ok: true, image, lang };
}

export function photoMessages(image, lang) {
  const system = [
    'You look at one photo of a meal and list what is on the plate, so a person can log it.',
    'List each separate food (at most ' + MAX_ITEMS + '), as plain generic food names such as the Swedish Food Agency would use.',
    'For each: "name" in the language with code "' + lang + '"; "search" one or two keywords in Swedish or English that would find it in a food database;',
    '"grams" your best estimate of the eaten weight from the size of the plate and portion; "per100" typical values per 100 g (kcal, carb, sugar, prot, fat, sat, fib, salt in grams), null when you cannot say.',
    'Set "unclear" to true if the photo is not a meal, is too dark or blurry, or you are unsure what the dishes are; list only what you can actually see.',
    'Never give medical or dosing advice. Return the required JSON object only.'
  ].join(' ');
  return [
    { role: 'system', content: system },
    { role: 'user', content: [
      { type: 'text', text: 'What is on this plate?' },
      { type: 'image_url', image_url: { url: image, detail: 'low' } }
    ] }
  ];
}

const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max) ? Math.round(v * 10) / 10 : null;

/** { items, rejected }: the plausible rows, cleaned, and how many were thrown away. */
export function cleanPhotoItems(raw) {
  const list = Array.isArray(raw && raw.items) ? raw.items.slice(0, MAX_ITEMS) : [];
  const items = [];
  let rejected = 0;
  for (const it of list) {
    const name = typeof it?.name === 'string' ? it.name.trim().slice(0, 60) : '';
    const search = typeof it?.search === 'string' ? it.search.trim().slice(0, 40) : '';
    const grams = typeof it?.grams === 'number' && Number.isFinite(it.grams) ? Math.round(it.grams) : NaN;
    if (!name || !(grams >= 5 && grams <= 1500)) { rejected++; continue; }
    const per100 = {};
    for (const k of KEYS) {
      const v = num(it.per100 && it.per100[k], k === 'kcal' ? 900 : 100);
      if (v !== null) per100[k] = v;
    }
    // Macros cannot weigh more than the food they are in.
    if ((per100.carb || 0) + (per100.prot || 0) + (per100.fat || 0) > 105) { rejected++; continue; }
    if (per100.sugar > per100.carb || per100.sat > per100.fat) { delete per100.sugar; delete per100.sat; }
    items.push({ name, search: search || name, grams, per100 });
  }
  return { items, rejected };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhotoRequest, cleanPhotoItems, photoMessages, PHOTO_SCHEMA, MAX_IMAGE_BYTES } from './meal-photo.js';

const img = bytes => 'data:image/jpeg;base64,' + Buffer.alloc(bytes, 3).toString('base64');

test('only a real image data URL of a sensible size is accepted', () => {
  assert.equal(cleanPhotoRequest({ image: img(5000), lang: 'sv' }).ok, true);
  assert.equal(cleanPhotoRequest({ image: 'http://x/y.jpg' }).ok, false);
  assert.equal(cleanPhotoRequest({ image: 'data:text/html;base64,AAAA' }).ok, false);
  assert.equal(cleanPhotoRequest({ image: img(50) }).ok, false, 'too small to be a photo');
  const big = cleanPhotoRequest({ image: img(MAX_IMAGE_BYTES + 1000) });
  assert.deepEqual([big.ok, big.error], [false, 'photo too large']);
  assert.equal(cleanPhotoRequest(null).ok, false);
});

test('an unknown language falls back to English', () => {
  assert.equal(cleanPhotoRequest({ image: img(5000), lang: 'xx' }).lang, 'en');
  assert.equal(cleanPhotoRequest({ image: img(5000), lang: 'de' }).lang, 'de');
});

test('the image goes to the model as an image part, with the language named', () => {
  const m = photoMessages('data:image/jpeg;base64,AAAA', 'sv');
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /"sv"/);
  assert.deepEqual(m[1].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'low' } });
});

test('the schema is strict: every field is required', () => {
  const item = PHOTO_SCHEMA.properties.items.items;
  assert.deepEqual(item.required.sort(), ['grams', 'name', 'per100', 'search']);
  assert.equal(item.properties.per100.required.length, 8);
  assert.equal(PHOTO_SCHEMA.additionalProperties, false);
});

const row = (o = {}) => ({ name: 'Ris', search: 'ris', grams: 150, per100: { kcal: 130, carb: 28, sugar: 0, prot: 2.5, fat: 0.3, sat: 0, fib: 0.4, salt: 0 }, ...o });

test('plausible rows are kept and cleaned', () => {
  const { items, rejected } = cleanPhotoItems({ items: [row({ grams: 150.4, name: '  Ris  ' })] });
  assert.equal(rejected, 0);
  assert.deepEqual(items[0], { name: 'Ris', search: 'ris', grams: 150, per100: { kcal: 130, carb: 28, sugar: 0, prot: 2.5, fat: 0.3, sat: 0, fib: 0.4, salt: 0 } });
});

test('impossible rows are thrown away and counted', () => {
  const heavy = row({ per100: { kcal: 400, carb: 80, prot: 30, fat: 20 } });          // 130 g of macros in 100 g
  const noGrams = row({ grams: 0 });
  const huge = row({ grams: 5000 });
  const noName = row({ name: '' });
  const { items, rejected } = cleanPhotoItems({ items: [heavy, noGrams, huge, noName, row()] });
  assert.equal(items.length, 1);
  assert.equal(rejected, 4);
});

test('missing or absurd values are left out, not turned into zero', () => {
  const { items } = cleanPhotoItems({ items: [row({ per100: { kcal: 5000, carb: null, prot: 10, fat: -1, sugar: 'x' } })] });
  assert.deepEqual(items[0].per100, { prot: 10 });
});

test('sugar above carbohydrate (or saturated above total fat) is dropped as inconsistent', () => {
  const { items } = cleanPhotoItems({ items: [row({ per100: { kcal: 100, carb: 10, sugar: 20, prot: 1, fat: 2, sat: 3 } })] });
  assert.equal('sugar' in items[0].per100, false);
  assert.equal('sat' in items[0].per100, false);
});

test('no more than eight rows, and garbage in gives nothing out', () => {
  assert.equal(cleanPhotoItems({ items: Array.from({ length: 20 }, () => row()) }).items.length, 8);
  assert.deepEqual(cleanPhotoItems(null), { items: [], rejected: 0 });
  assert.deepEqual(cleanPhotoItems({ items: 'x' }), { items: [], rejected: 0 });
});

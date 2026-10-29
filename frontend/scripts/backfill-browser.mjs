// Local-only browser regression: creates its own Vite server and synthetic profile.
// No account, remote app or production API is used. Install Chromium with:
// npx playwright install chromium
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const failures = []
try {
  for (const timezoneId of ['Europe/Stockholm', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const context = await browser.newContext({ timezoneId, viewport: { width: 390, height: 844 } })
    const requests = [], errors = []
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort()
      if (/^\/(img|gif)\//.test(url.pathname)) return route.fulfill({status: 204, body: ''})
      if (url.pathname.startsWith('/api/')) {
        requests.push(url.pathname)
        return route.fulfill({ status: url.pathname === '/api/me' ? 401 : 200, contentType: 'application/json', body: '{}' })
      }
      return route.continue()
    })
    const page = await context.newPage(); page.setDefaultTimeout(6000)
    await page.clock.install({ time: new Date('2026-10-29T18:00:00Z') })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(origin)
    await page.getByRole('button', { name: 'Continue without account', exact: true }).waitFor()
    const seed = async (timed = false) => {
      await page.evaluate(async timed => {
        const { useStore, DEF } = await import('/src/store/useStore.js')
        const { useUI } = await import('/src/store/useUI.js')
        const { EXDB } = await import('/src/lib/exercises.js')
        const { nav } = await import('/src/lib/nav.js')
        const ex = EXDB.find(e => e.eq === 'barbell')
        const cfg = { id: ex.id, mode: timed ? 'time' : 'reps', bodyweight: false, sets: 2, reps: 5, sec: 30, weight: 20, inc: 2.5 }
        const past = (d, weight) => ({ id: d, d, start: +new Date(d + 'T08:00:00'), end: +new Date(d + 'T09:00:00'), name: 'Existing synthetic', routineId: 'a',
          entries: [{ id: ex.id, target: { ...cfg, sets: 1 }, sets: [{ w: weight, r: 5, done: true }] }] })
        useUI.getState().closeAll(); useUI.getState().stopRest(); useUI.getState().stopWork()
        useStore.getState().setGuest(true)
        useStore.setState({ user: null })
        useStore.getState().replaceState({ ...structuredClone(DEF), lang: 'en', sound: false, keepAwake: false,
          routines: [{ id: 'a', name: 'Synthetic routine', ex: [cfg] }],
          workouts: [past('2026-10-19', 40), past('2026-10-28', 100)],
          exWeights: { [ex.id]: { w: 100, d: '2026-10-28' } },
          bodyweight: [{ d: '2026-10-19', w: 80, u: 'kg' }, { d: '2026-10-29', w: 100, u: 'kg' }],
          myFoods: [{ id: 'synthetic-food', n: 'Synthetic food', per100: { kcal: 200, carb: 20, prot: 10, fat: 5 } }],
          myMeals: [{ id: 'template', n: 'Synthetic lunch', kind: 'lunch', items: [{ fid: 'synthetic-food', g: 150 }] }]
        }, false)
        nav('/home')
      }, timed)
      requests.length = 0
    }
    const state = () => page.evaluate(async () => (await import('/src/store/useStore.js')).useStore.getState().S)
    const test = async (name, fn) => {
      try { await fn(); console.log(`PASS ${timezoneId}: ${name}`) }
      catch (e) { failures.push(`${timezoneId}: ${name}: ${e.message}`); console.error(`FAIL ${failures.at(-1)}`) }
    }
    const openPast = async minutes => {
      await page.getByRole('button', { name: 'Log a workout you missed', exact: true }).click()
      await page.locator('.sheet input[type=date]').fill('2026-10-20')
      const time = page.locator('.sheet input[type=time]')
      if (await time.count()) await time.fill('18:30')
      await page.locator('.sheet .stp input').fill(String(minutes))
      await page.getByRole('button', { name: 'Synthetic routine', exact: false }).click()
      await page.locator('.setrow').first().waitFor()
    }

    await test('historical defaults come from preceding sessions', async () => {
      await seed(); await openPast(60)
      assert.equal((await state()).active.entries[0].sets[0].w, 42.5)
    })
    await test('confirmation then discard leaves the profile unchanged', async () => {
      await seed()
      const before = await state()
      await openPast(60)
      await page.locator('.setrow .chk').nth(0).click()
      assert.equal(await page.evaluate(async () => (await import('/src/store/useUI.js')).useUI.getState().timer), null)
      await page.locator('.setrow .chk').nth(1).click()
      await page.getByRole('button', { name: 'Just close', exact: true }).click()
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.locator('.sheet, .center').getByRole('button', { name: 'Discard', exact: true }).click()
      const after = await state()
      assert.equal(after.active, null)
      assert.deepEqual(after.workouts, before.workouts)
      assert.deepEqual(after.exWeights, before.exWeights)
      assert.deepEqual(after.meals, before.meals)
    })
    for (const minutes of [1, 360]) await test(`UI preserves ${minutes} minutes and survives reload without live timers/presence`, async () => {
      await seed()
      const before = await state()
      // Simulate a signed-in profile without contacting a server; all API requests are intercepted.
      await page.evaluate(async () => (await import('/src/store/useStore.js')).useStore.setState({ user: { id: 'synthetic', name: 'Synthetic' } }))
      await openPast(minutes)
      await page.clock.runFor(21000)
      await page.locator('.setrow .chk').nth(0).click()
      await page.getByRole('button', { name: 'Finish', exact: true }).click()
      await page.getByRole('button', { name: 'Finish workout', exact: true }).click()
      await page.getByRole('button', { name: 'Nice!', exact: true }).click()
      const after = await state()
      const saved = after.workouts.find(w => w.d === '2026-10-20')
      assert.equal(saved.end - saved.start, minutes * 60000)
      assert.equal(saved.start, await page.evaluate(() => +new Date('2026-10-20T18:30:00')))
      assert.deepEqual(after.workouts.filter(w => w.id !== saved.id), before.workouts)
      assert.deepEqual(after.exWeights, before.exWeights)
      assert.equal(requests.some(p => p === '/api/activity' || p.includes('rest-timer')), false)
      await page.reload()
      await page.waitForFunction(() => document.body.innerText.includes('Pass'))
      assert.deepEqual((await state()).workouts, after.workouts)
    })
    await test('timed historical sets cannot start a live work timer', async () => {
      await seed(true); await openPast(30)
      assert.equal(await page.getByRole('button', { name: 'Start set', exact: true }).count(), 0)
    })
    await test('live training still starts rest timers and sends presence to the mock API', async () => {
      await seed()
      await page.evaluate(async () => {
        const { useStore } = await import('/src/store/useStore.js')
        useStore.setState({ user: { id: 'synthetic', name: 'Synthetic' } })
        const { beginWorkout } = await import('/src/sheets.jsx')
        beginWorkout('a')
      })
      await page.locator('.setrow').first().waitFor()
      await page.locator('.setrow .chk').first().click()
      await page.clock.runFor(21000)
      assert.notEqual(await page.evaluate(async () => (await import('/src/store/useUI.js')).useUI.getState().timer), null)
      assert.equal(requests.includes('/api/activity'), true)
      assert.equal(requests.includes('/api/push/rest-timer'), true)
    })
    if (timezoneId === 'Europe/Stockholm') await test('the repeated DST hour requires a choice and saves the selected occurrence', async () => {
      await seed()
      await page.getByRole('button', { name: 'Log a workout you missed', exact: true }).click()
      await page.getByLabel('Day', { exact: true }).fill('2026-10-25')
      await page.getByLabel('Start time', { exact: true }).fill('02:30')
      await page.getByRole('button', { name: 'Synthetic routine', exact: false }).click()
      assert.equal((await state()).active, null)
      if (process.env.BACKFILL_SCREENSHOT) await page.screenshot({ path: process.env.BACKFILL_SCREENSHOT })
      await page.getByRole('button', { name: 'UTC+01:00', exact: true }).click()
      await page.getByRole('button', { name: 'Synthetic routine', exact: false }).click()
      await page.locator('.setrow').first().waitFor()
      assert.equal((await state()).active.start, Date.parse('2026-10-25T01:30:00Z'))
    })
    await test('Food displays the full duration and explains the energy cap', async () => {
      await seed()
      await page.evaluate(async () => {
        const { useStore } = await import('/src/store/useStore.js')
        const { todayISO } = await import('/src/lib/format.js')
        const { nav } = await import('/src/lib/nav.js')
        useStore.getState().update(s => {
          const w = s.workouts[0]
          s.workouts = [{ ...w, d: todayISO(), end: w.start + 360 * 60000 }]
        }, false)
        nav('/food')
      })
      await page.getByText('Existing synthetic · 360 min', { exact: true }).waitFor()
      await page.getByText('Energy estimate capped at 180 min of strength work.', { exact: true }).waitFor()
    })
    await test('saved meal on a past day can be moved with exact calorie conservation', async () => {
      await seed()
      await page.evaluate(async () => (await import('/src/food-sheets.jsx')).quickLogSheet('2026-10-20'))
      await page.getByRole('button', { name: 'Synthetic lunch', exact: false }).click()
      let s = await state()
      assert.equal(s.meals.length, 1)
      assert.equal(s.meals[0].d, '2026-10-20')
      assert.equal(s.meals[0].t, '12:00')
      await page.evaluate(async () => {
        const { useStore } = await import('/src/store/useStore.js')
        const { mealSheet } = await import('/src/food-sheets.jsx')
        mealSheet(useStore.getState().S.meals[0])
      })
      await page.getByLabel('Day', { exact: true }).fill('2026-10-21')
      await page.getByLabel('Time', { exact: true }).fill('00:05')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      s = await state()
      assert.equal(s.meals.length, 1); assert.equal(s.meals[0].d, '2026-10-21')
      assert.equal(s.meals[0].t, '00:05'); assert.equal(s.meals[0].items[0].g, 150)
      const totals = await page.evaluate(async () => {
        const { useStore } = await import('/src/store/useStore.js')
        const { dayTotals } = await import('/src/lib/nutrition.js')
        const { foodMap } = await import('/src/lib/foods.js')
        const s = useStore.getState().S
        return ['2026-10-20', '2026-10-21'].map(d => dayTotals(s, d, foodMap(s)).kcal)
      })
      assert.deepEqual(totals, [0, 300])
    })
    assert.deepEqual(errors, [], 'No uncaught UI errors')
    await context.close()
  }
} finally { await browser.close(); await server.close() }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }

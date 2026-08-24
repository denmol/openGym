# Changelog

## Unreleased

The app grows a second half. Everything until now was about training; this release adds what
you eat, and — for anyone who needs it — what the glucose meter said afterwards. Plus a coach
that writes the training plan, a new name to cover all of it, and one secret that should never
have been in the repository taken back out.

### Steps, from whichever watch you wear

- 👟 **Daily step counts import from an Apple Health export or a steps CSV**, Garmin Connect's
  included. One figure per day is kept: steps by the hour would be a quarter of a million
  records to render a daily average, which is a poor trade.
- **The phone and the watch are not added together.** Both count the same walk, and Health's
  export contains both sets of records — summing them reports roughly twice the steps anybody
  took. Each day takes the device that counted the most instead, which is what Health itself
  shows, and the import says so when more than one device contributed.
- 📊 **A Steps card in Stats**: daily average, best day, and a week-by-week average. The
  average is over days *recorded*, not days in the window — a watch left on the charger is not
  a day spent sitting still, and counting it as zero would describe the device rather than
  the person. The number of days it rests on is always beside it.
- 📦 **One Apple Health export, one import.** The file holds workouts, steps and weigh-ins
  together; the importer used to take whichever it noticed first and silently leave the rest,
  so the same few hundred megabytes had to be fed in more than once. All three now land in a
  single pass, and the confirmation screen counts each of them before anything is written.
- Translated into all 13 UI languages.

### Cardio, in the units it was measured in

Cardio was already a logging mode — 29 exercises, its own two-stepper row — but it could only
describe a treadmill, and it vanished from every summary the moment it was logged.

- 🏃 **Distance instead of speed.** A cardio set now records a duration and a distance, and
  pace falls out of the two: "46 min · 8 km · 5:45/km". Speed in km/h is what a treadmill
  displays; the number a person writes down afterwards is the distance, and the number they
  judge themselves on is the pace. Sets logged before this are read unchanged — their distance
  is derived back out of the old speed and marked ≈, because it was never measured.
- ❤️ **Heart rate per set**, in the column effort occupies for weighted work. Optional in the
  same sense: an unrecorded pulse is not a pulse of zero. Averages are weighted by duration,
  so a five-minute warm-up and a forty-minute run do not average out to a figure describing
  neither, and the minutes it actually covers are shown beside it.
- 📊 **A Cardio card in Stats** over 30d / 90d / 1Y / all time: total minutes and distance,
  the period's pace, the longest single session, and minutes week by week. Pace is the
  period's distance over its duration rather than an average of session paces.
- **Cardio stops being invisible in the summaries.** Volume is weight × reps and says nothing
  about a run, so a cardio session used to read as "0 kg" — and as "NaN kg" for anything
  logged before the volume figure existed. Workout rows, the workout detail sheet and the
  calendar's monthly line now show minutes and distance alongside volume, and each half is
  left out when there is none of it.
- 📥 **Import cardio from a watch.** An Apple Health `export.xml` now brings its workouts
  across, not only its body weight — read by scanning rather than parsing, because the file
  runs to hundreds of megabytes and a DOM would take the tab with it. Both shapes Health has
  written are handled: the older one with duration and distance on the element, and the iOS 16
  one that moved distance into a child alongside the heart rate. Miles, metres and seconds are
  converted on the way in.
- **Garmin and Strava activity CSVs keep their distance.** The importer already read cardio
  rows, but collapsed the measured distance into a speed — the one figure the file was sure
  of, thrown away. It is stored as measured now, and an average heart-rate column comes with
  it. Activities the exercise library has no entry for become one of your own, as they do for
  strength imports.
- Cardio still does not join the volume figure, and should not: multiplying a duration into a
  weight × reps total would make two incomparable things look like one number.
- Translated into all 13 UI languages.

### The app is now Dagsnav

- 🧭 **Renamed from openGym**, with new icons, manifest and iOS/Android resources. The old name
  described a gym app; this one logs a day.
- **Food and History join the primary navigation.** Both were reachable only from somewhere
  else, which is a fair description of how often they were reached.

### The food log

- 🍽 **Meals, saved meals, and the day's carbohydrate as the headline.** Carbohydrate leads
  everywhere on the screen because it is the number anyone counting anything is counting. A
  meal is a list of foods and grams; saving one keeps the template, and logging it writes the
  grams actually eaten — so editing the template later cannot rewrite what last Tuesday's
  breakfast was.
- 🥚 **Amounts in eggs and slices, not only grams.** A Swedish dl is 100 ml, msk 15 ml, tsk
  5 ml; those are definitions, not opinions. Millilitres become grams through a density that
  is adjustable per food, and anything resting on an estimate is shown with a ≈, so a weighed
  58 g never looks like a guessed one.
- 📷 **Barcode scanning, with Open Food Facts behind it.** Livsmedelsverket has "Bröd, rågbröd,
  mjukt" — it does not have a branded loaf, and no national food table is meant to. Decoding
  runs in WebAssembly rather than through the browser's barcode API, which Safari does not
  implement and which therefore does not exist on any iPhone whatever browser is installed.
  Three ways in, because the live camera can fail: camera, a photo, or typing the digits.
- **Which kind of number it is, is never hidden.** A laboratory value from Livsmedelsverket and
  a volunteer's transcription of a packet are not the same thing, and the food sheet says which
  one it is showing.
- **The bundled food database is optional.** It is generated by `scripts/build-foods.mjs` and
  may simply not be there; an instance that never ran the script works fine on your own foods.

### Diabetes mode

Off unless you turn it on, and deliberately smaller than it could be.

- 🩸 **A glucose log and an insulin log, beside the food log rather than on a screen of their
  own.** The question worth answering is what happened after a meal, and two screens is where
  that question goes to die. Readings are stored in mmol/L whatever the profile displays,
  because two units in one list is how a 5.5 becomes a 5.5 mg/dL.
- 📄 **A report to take to an appointment.** Printed through the browser's own Save as PDF
  rather than generated by a bundled library, so it comes out the same on the nurse's screen.
  Its footnotes say that the in-range figure counts readings rather than time, that pump basal
  is not in the insulin total, and where the carbohydrate came from — a report that hides its
  own limits is worse than no report, because it will be believed.
- 📥 **Import from a meter, pump or CGM export.** Built against CareLink but not specific to it:
  columns are read off the header, so a Libre or Dexcom file is usually a few more aliases
  rather than another importer. It commits nothing on its own — it shows what it found, what it
  thinks each column is and which unit it believes the file is in, and says out loud where it
  had to infer rather than read. Basal is not imported at all: CareLink reports it as a rate,
  and turning rates into doses would invent a daily total.
- **There is no bolus calculator, and there will not be one.** No insulin-to-carb ratio, no
  correction factor, no insulin-on-board, no advice for a low reading. Those are dose
  decisions, and this app cannot know about a blocked cannula, an illness, exercise two hours
  ago, or what the care team last said.

### Nutrition targets, with their sources attached

- 📚 **A reference engine over Nordic Nutrition Recommendations 2023**, plus incretin and GLP-1
  guidance from EASO/EFAD/ECPO and the ACLM/ASN/OMA/TOS advisory. Every value carries its
  source, year, the audience it was written for, and the limitation that applies to it — a
  population range is not a personal treatment target, and the card says so rather than
  implying otherwise by sitting next to a target field.
- 🛡 **Health questions decide which references apply.** Pregnancy, a prescribed protein or
  fluid restriction, an eating disorder, malnutrition risk, hypoglycaemia-risk medication and
  others each hide the references they would be wrong for and pause the matching targets, with
  a plain sentence saying why. The GLP-1 layer additionally needs a treatment phase and a
  confirmation that is re-asked every 90 days.
- **The AI explanation cannot invent a number.** It receives interface language and verified
  fact codes — no values, no demographics, no health data — and may only select from
  pre-approved highlights. Where a health flag is set, no model is called at all: the server
  writes fixed care-team notes instead. Nothing from an explanation is ever saved as a target.

### Daily nutrition values you can actually follow

The nutrition references landed as intervals — 1,850–2,850 kcal, 197–410 g of carbohydrate —
because that is the shape a population reference has. Nobody can eat an interval. Everything
below is about turning what the sources say into one number per nutrient per day, and then
subtracting what has been logged from it.

- 🎯 **One number per nutrient, per day.** Energy is a point on the PAL scale rather than its
  full width, and carbohydrate is whatever energy is left after protein, fat and fibre — which
  is how a day is actually put together, and what stops two percentage ranges from multiplying
  into a span nobody can act on. A 40-year-old man of 180 cm and 90 kg aiming to lose weight now
  gets 2,350 kcal · 263 g carbohydrate · 135 g protein · 78 g fat · 29 g fibre.
- 📊 **The day counted down, on the Food screen.** Eaten, goal, what remains, and a bar — for
  energy and the three macros up front, the rest under *All nutrients*. Carbohydrate leads the
  list when diabetes mode is on. A total built from foods missing that nutrient reads as "≥ 112 g"
  rather than pretending to be complete, because the amount left would otherwise be invented.
- ✅ **Use these as my targets.** One tap copies the calculated day into the editable target
  fields. Editing a field afterwards makes that field your own again. Before this the numbers
  could only be read and retyped by hand.
- **Three questions instead of eleven.** Only pregnancy/breastfeeding and hypoglycaemia-risk
  medication now gate the general adult estimate; the other six narrow the references and are
  asked where they become relevant. The GLP-1 layer still requires every one of them.
- **Weight can be entered where it is needed.** It was the one field the nutrition sheet asked
  for but could not accept, so supplying it meant leaving for another screen and coming back.
- **A blocked estimate says which field is missing** — age, sex, height, weight, a weight logged
  before units were stored — with the button that fixes it, instead of a paragraph listing
  everything it could possibly need.
- ⓘ **Sourcing moved behind an info button** per nutrient, showing the whole arithmetic: resting
  energy, PAL, maintenance, the deficit applied, the daily plan. It no longer sits between the
  reader and the figure.
- Protein above BMI 25 counts only 40% of the excess weight, matching the adjusted-reference-weight
  convention the EASO source already assumes.
- **Fixed: the person this feature is for got nothing.** A woman of 160 cm and 68 kg aiming to
  lose weight was shown maintenance energy and no macro grams at all, because the interval's low
  end fell under the 1,200 kcal floor and the whole estimate was dropped. The floor is now applied
  to the number rather than used to cancel it.
- Translated into all 13 UI languages.

### Swedish

- 🇸🇪 **Swedish (Svenska)** joins the UI languages, bringing the count to 13. Pick it under
  Settings → Appearance → Language. Like German and Portuguese, exercise instructions stay in
  English — the upstream dataset doesn't cover Swedish yet — and the language chip in the
  exercise sheet says so.

### The AI coach

- 🤖 **A training plan written by a model and checked by the app.** You answer a short wizard —
  equipment above all, because a wrong answer there produces a plan you cannot perform — and
  get a plan back as routines and a week.
- **No API key needed.** The app writes the prompt, you carry it to the chat of your choice and
  paste the answer back. The prompt is written to be read by a person too: someone who cannot
  see what is being sent about them will not use the feature twice. Where the server has a key,
  it talks to the model directly instead.
- ✅ **Everything the model returns is validated before it is shown**, using data the app
  already holds — the catalogue, the muscle map, the progression rules — so none of it depends
  on the model having been careful. Errors block and go straight into a repair prompt: an
  exercise id that does not exist, a barbell lift for someone with two dumbbells, a Thursday
  pointing at a routine that was never written. Warnings are shown and you decide.
- **The plan carries no weights, on purpose.** A new account has no history, so any weight a
  model writes is a guess from age and body weight — the thing language models are worst at.
  The first session sets the baseline instead, and the first set asks you to confirm what you
  actually lifted.

### Fixed

- 🔐 **`data/` is no longer tracked by git.** It held the session-signing secret, which means
  anyone with a clone of the repository had it. `scripts/secure-data.sh` performs the migration
  in one command, and refuses only what would actually block rather than any dirty state.
- **Settings shows the profile id, and lets it be copied.** Needed for support and for moving a
  profile between instances, and previously not visible anywhere.
- **The starter plan and the progression values are localized.** They were the last strings
  reaching the screen in English regardless of the chosen language.
- **A `.gitignore`, at last**, plus the `.env.example` the documentation already referenced, the
  compose build path corrected, and the API's Docker module packaging fixed.

## v1.2.4 — 2026-08-01

The effort ratings you have been recording since v1.2.3 now answer questions, and bodyweight
training stops being treated as barbell training with the weight left at zero. Plus: creating a
profile from Settings works on an invite-only instance, which it never has.

### The effort ratings, read back as statistics

v1.2.3 let you rate how hard a set was. Nothing then read that rating back — it lived in the set
label and nowhere else. Stats now answers the question the number was recorded for.

- 📊 **An Effort card in Stats** over 30d / 90d / 1Y / all time: average effort, the share of sets
  taken close to failure, and — always alongside them — how much of your training was rated at
  all. Rating is optional and off by default, so a partly rated history is normal; an average
  without its denominator would quietly speak for sets you never rated.
- **Week by week.** The weekly average with that week's set count in the tooltip, because the
  pair is the reading: volume up with effort up is fatigue accumulating, volume up with effort
  flat is the adaptation you were training for. Weeks resting on a single rated set are dropped
  rather than drawn.
- **Where the sets land.** The spread across the scale, not just the middle of it. Half your sets
  at failure and half in warm-up territory average out to a healthy-looking number; this is the
  chart that shows it.
- 🔥 **Hard-sets mode on the muscle map.** The same body diagram, counting only sets taken near
  failure — "where did the stimulus go" rather than "where did the volume go". A muscle can lead
  on set count and still never be trained hard.
- **Effort on the exercise curve.** Each session's dot on the top-set chart fills in as less is
  left in the tank, so the same weight moved with more in reserve stops reading as a flat line.
  Exercises with enough ratings also get an Effort curve of their own.
- **One history, whichever scale you use.** Everything aggregates internally in RIR and converts
  back for display, so a history that mixes your own RIR logs with imported RPE averages as one
  series instead of two half-empty ones. RIR charts count downward on the axis, so harder sets
  sit higher.
- Translated into all 12 UI languages.

### Bodyweight training, logged the way it is done

A push-up has no weight to type, and the app asked for one anyway — every set, on a quarter of
the catalogue. Three reports (#31, #32, #33) turned out to be the same gap: the app assumed
progress lived in the load. It doesn't, for the exercises most people actually start with.

- 💪 **Exercises know they are bodyweight.** Seeded from the equipment the dataset already
  records, so push-ups, pull-ups, dips and 300-odd others arrive marked. The weight column is
  not shown, the set row is one stepper instead of two, and the "confirm your working weight"
  prompt at the end of an exercise stops asking about a weight that was never there. (#32)
- **Added weight when there is any.** A dip belt or a weighted vest is entered once in the
  exercise settings and reads as an addition — "+10 × 8", not "10×8" — everywhere it is shown
  back. With load on the belt the normal progression rules take over again, because now there
  is something to add.
- 📈 **Reps and sets are the progression.** Clean session, one more rep. Set a top of the range
  and reaching it adds a set and starts the reps over instead of climbing forever; at six sets
  it says what it should have said all along, which is that it is time for weight or a harder
  variation. No ceiling set keeps the old behaviour exactly. (#33)
- ↔️ **Reps per side.** For lunges, single-arm rows and every other unilateral movement. You
  log what you did — 16, the total — and the app shows the split, "8 per side", so the set in
  front of you is unambiguous without the rep count meaning one thing here and another there.
  The target steps in twos, 16 → 18 → 20, because half of an odd total is a rep one side never
  gets. (#31)
- Both settings travel with a shared plan, and are written to a plan file only when they
  disagree with the catalogue — every existing plan, workout and backup is read unchanged and
  none of it needs migrating.
- Translated into all 12 UI languages.

### Fixed

- **Creating a profile from Settings on an invite-only instance.** The sign-in screen asks for
  the invite code when the server needs one; the same registration reached from Settings never
  did, so it was refused with nothing on screen explaining why. It now asks on the same terms.
- **A long value no longer runs through its own label** in a settings row — "Follow the routine
  (Linear progression)" overlapped "Rule" rather than shortening itself.

## v1.2.3 — 2026-07-31

How hard a set was, in whichever of the two scales you already think in — and the ratings your
old app recorded come across with the rest of your history. Plus: the phone stops locking itself
mid-workout, the rest timer can hand time back as well as take it, and Settings is grouped by
what each thing actually affects.

### The screen stays on while you train

- ☀️ **Keep screen awake — Settings → *During a workout*, on by default.** Locking, unlocking
  and finding your place again between every set was the single most annoying thing about
  logging on a phone. The screen now stays lit for as long as a workout is running and lets go
  the moment you finish it, so nothing is held while you are not training.
- **It survives a tab switch.** Browsers release the lock whenever the page stops being visible,
  which is exactly what happens when you glance at a message. The lock is taken again each time
  the app comes back, rather than dying the first time you look away.
- **It follows the workout, not the screen you are on.** Checking Stats mid-session keeps the
  screen awake.
- **Where it isn't available, it says so.** iOS grants no wake lock in Low Power Mode, and older
  browsers have no Wake Lock API at all — the first is silent, the second shows the row disabled
  rather than offering a switch that does nothing. Needs HTTPS, like every other modern browser
  capability.

### Rest timer: take 15 seconds off, too

- ⏳ **A −15s button next to +15s.** The timer could only ever be extended or skipped outright;
  now it goes both ways. Taking off more than is left finishes the rest rather than counting
  into the negative — the same thing Skip does.
- **Rearranged so three controls fit.** The clock and the progress bar take the top row and the
  controls sit underneath: −15 and +15 together in number-line order, Skip pushed to the far
  edge so the button that ends the rest is not next to the one you tap to buy more time. On a
  wide screen it stays on one line. Tap targets are bigger than they were.
- **The bar is nearly opaque.** The set rows underneath were reading through it and making the
  clock hard to pick out.

### Settings, grouped by what it affects

- **General** (language, units) · **During a workout** (rest timer, keep screen awake, sounds,
  effort per set) · **Notifications** · **Appearance** (theme, body diagram, accent) · **Data**.
- The old grouping mixed axes: "Units & timer" put a display preference next to two workout
  behaviours, language sat under Appearance, and *Load starter plan* was buried between the
  backup actions and the destructive reset. Data now reads in the order you would use it — fill
  the plan, bring history over from another app, restore a backup, export one, wipe everything.
- Nothing was removed and no setting changed its meaning.

### Effort per set: RIR or RPE (#21)

- 🎯 **A third column on a working set, off by default.** Settings → *Effort per set* switches
  it between **Off**, **RIR** and **RPE**. It only appears on weighted rep sets: a plank or a
  treadmill row has nowhere to put it.
- **Two names for the same judgement.** RIR counts the reps you left in the tank; RPE reads the
  same effort off a 10-point scale, so RPE ≈ 10 − RIR. The setting has an (i) that lays the two
  scales side by side in a conversion table rather than explaining them in a paragraph.
- **Each set keeps the scale it was logged with.** Switching the setting changes what new sets
  ask for and nothing else — history is never silently rewritten, and a set logged as RIR 2
  still reads back as RIR 2 years later.
- **An unrated set stays unrated.** Blank and 0 are different things: RIR 0 says the set went to
  failure. So `−` on an untouched cell leaves it empty, `+` starts at the bottom of the scale
  and walks up in even steps, and stepping back off the bottom clears the cell again — a mistap
  is always undoable.
- **Nothing else reads the value.** Progression rules and estimated 1RM are unaffected; the
  rating is yours to look at, not an input to the maths.
- Upgrading keeps the column you had: a profile still carrying the old `showRir` flag — from
  this device, a sync, or a backup restored later — comes across as RIR.

### Import brings your ratings with it

- 📥 **The RPE Hevy and Strong export is no longer dropped.** An `RPE` column is read into the
  set, as is an `RIR` column if a file has one, and the import summary says how many sets
  arrived with a rating — plus where to switch the column on if it's off.
- A blank cell stays unrated rather than becoming 0. A written-out `0` counts as a rating on the
  RIR scale (a set to failure) but not on RPE, which starts at 1 — apps write 0 there to mean
  "nothing here", and reading it as an effort would stamp one on every unrated set in the file.
- Ratings above the scale are capped instead of thrown away, and junk in the column is ignored
  without losing the set.
- Backups already carried both fields and the setting, since a backup is the whole state — there
  are now tests pinning that, so it can't quietly stop being true.

## v1.2.2 — 2026-07-25

Training that moves on its own: an exercise can now be logged by time instead of reps, the
next weight follows a progression rule you choose rather than a single hard-coded hint, and
every lift carries an estimated 1RM. Plus a standalone mobile app, a shareable plan, and an
importer for your history from other apps.

### Timed sets and a timer for the set itself (#16)

- ⏱️ **Reps or time, per exercise.** Planks, hangs, wall sits, dead hangs and loaded
  carries no longer have to be filed under cardio to be timed. Each exercise in a routine
  picks its own mode, and a timed set can still carry weight for a weighted plank or a
  farmer's walk.
- ▶️ **A work timer, separate from the rest timer.** Start a timed set and it counts the
  hold down, beeping and buzzing at zero exactly as the rest timer does, then checks the
  set off itself. The two timers can never run at once — they mean opposite things.
- Finishing a hold early logs **the time you actually held**, not the target. A 38-second
  hold against a 45-second target is recorded as 38 seconds.
- The mode travels everywhere it should: routine editor, workout, history, exercise
  statistics (timed exercises chart their longest hold), the printable plan and the shared
  plan file.
- Plans made before this release are read exactly as they always were — nothing to migrate.

### Progression rules you can read (#17)

- 📈 **Pick a rule per routine, override it per exercise.** Linear progression, **Greyskull
  LP** (two straight sets plus an AMRAP final set, with double jumps and a 10 % reset),
  double progression through a rep range, or adding time for timed work. Or none at all.
- 🧾 **Every target explains itself.** "Every rep last time — 2.5 kg more." "Missed reps
  3 sessions running — reset to 55 kg and work back up." The rule is visible before you
  train, not after.
- The session opens with the right weights already in the rows, instead of suggesting them
  once you are standing at the bar.
- 🚫 **A bad session can't look like a good one.** Short reps count as a miss even when you
  checked the set off; a set you never checked counts as a miss because you did not do it.
  Nothing advances the load on a session that fell apart.
- Stalls and deloads are worked out from your log every time they are needed. Nothing is
  written back into a finished workout and no counters are stored, so fixing a mistyped set
  immediately produces the right next target.
- Lower-body lifts step up in larger jumps than upper-body ones by default, and any
  exercise can set its own step.
- Bodyweight exercises progress in **reps**, because there is no load to add to a push-up
  and no load to take off it either.

### Estimated 1RM (#18)

- 💪 **An estimated one-rep max for every lift**, in the exercise progress card (with its
  own curve you can switch to) and in the exercise detail sheet.
- It always names the set it came from — "from 90 kg × 5 on 15 Jul" — because an estimate
  off a heavy triple and one off a set of ten are very different claims.
- 🧮 **A calculator** for a set you have not done yet, so the number is reachable before
  there is any history.
- Epley by default, and it **refuses to guess above 12 reps**, where the common formulas
  disagree by double digits.
- A new best estimate is reported at the end of a workout separately from a weight PR —
  same weight for more reps is real progress, but it is not a heavier lift.

### Share a plan

- 📤 **Send someone your plan.** Plan → *Share your plan* writes a small file with your
  routines, the week schedule and any custom exercises they use — and nothing else. No
  workouts, no weigh-ins, no settings.
- Importing **merges**: shared routines arrive as new ones with fresh ids, custom exercises
  are matched by name so they are not duplicated, and your own plan is never overwritten.
  Taking the week schedule with it is optional.
- 🖨️ **A printable plan** (Save as PDF) laid out so a single exercise never breaks across
  a page.

### Fixes

- A shared plan file naming an exercise this build doesn't have can no longer take the app
  down. Unknown ids are dropped on import, anything that slips through renders as a
  placeholder you can delete, and an error boundary around the screens means a bad state is
  recoverable by switching tabs instead of reloading.
- Importing from another app converts weights **per row**, not per file. FitNotes writes the
  unit on each set, so a mixed export used to land 185 lb as 185 kg.
- Numbers follow the UI language instead of a hardcoded locale, which was putting Swiss
  apostrophes ("7'535 kg") in front of everyone. Volume stays in your own unit rather than
  switching to tonnes, which was wrong for pound profiles.
- Taking over a week schedule from a shared plan now really replaces Monday–Sunday instead
  of only the days the shared file happened to fill.
- The body-weight slider's ceiling follows your unit (300 kg / 660 lb).
- "Best: 85 Kg" is capitalised correctly again.

### One codebase, two flavors

openGym is also a standalone mobile app — and it ships as a direct APK download, not
through app stores.

- 📱 **Standalone mobile app.** The same frontend now also builds as a native iPhone /
  Android app (Capacitor) — the install-and-done flavor of openGym: no account, no server,
  no sync. Everything stays on the phone.
  - State is mirrored into a file in the app's private storage on every change, so your
    log survives even when the OS evicts WebView storage (iOS does).
  - The workout-day reminder becomes a **native notification** scheduled on the weekdays
    your plan actually has a routine — no push server involved.
  - Backups go out through the OS **share sheet** (Files, AirDrop, mail…).
  - Exercise images/animations load from the same CDN as the live demo.
  - `npm run build:mobile`, then open `android/` in Android Studio or `ios/` in Xcode —
    see **docs/MOBILE.md**. `NOTICE.md` now carries an AGPL §7 app-store exception.
- 🤖 **Android APK, no Play Store.** The official build is a signed, sideloadable APK
  (~4.5 MB) from [opengym.duarte-santos.ch](https://opengym.duarte-santos.ch) — deliberately
  store-free. docs/MOBILE.md covers building and signing your own.
- 🍎 **iOS reality check.** Apple permits no installs outside the App Store, so there is no
  iOS download; the docs explain the free options (self-hosted PWA on the home screen, or
  running the native app onto your own iPhone from Xcode).

- 📥 **Import your history from another app.** Settings → Data → *Import from another app*
  reads an export from **FitNotes** (both the Android and the FitNotes 2 iOS format),
  **Strong** and **Hevy**, and pulls body-weight history out of an **Apple Health** export.
  Anything else with a date, an exercise name and weight/reps columns is read too.
  - Every row becomes a set, grouped into workouts by date, so your history arrives with
    its real dates rather than as one lump. Hevy and Strong also carry session length, so
    the activity heatmap fills in properly.
  - Exercise names are matched against the 1,324-exercise library — parenthetical
    qualifiers like "(Barbell)" and shorthand like BB/DB are normalised, and a curated
    table covers the plain names people actually log ("Bench Press", "Squat", "RDL").
    Where a name is genuinely ambiguous it is *not* guessed at: it becomes one of your own
    exercises instead, because filing years of training under the wrong lift is worse than
    an unmatched name you can see and fix.
  - A summary shows what will happen — workouts, sets, how many exercises matched, which
    ones didn't, and whether weights need converting — before anything is written.
  - Importing is idempotent: days you already have data for are left alone, so running it
    twice, or importing from two apps, never duplicates a workout.

## v1.2.1 — 2026-07-23

A muscle map across the app, and a live demo you can try without installing anything.

- 💪 **Muscle map.** Three places now show which muscles your training actually reaches, drawn on a
  front-and-back body diagram shaded like the activity heatmap — more accent means more work.
  - **Stats → Muscle balance** aggregates a week, 30 days, 90 days or everything, lists your
    hardest-worked muscles with their set counts, and names the ones that got *nothing* in that
    period. That last list is the point of the card: the gaps are what you'd otherwise never notice.
    Tap any muscle to read its name and volume.
  - **Routine editor** previews what a session hits as you build it, so a hole in the plan shows up
    before you train around it for a month.
  - **The finish screen** shows what you just trained.
  - Load is counted in *effective sets* — a set counts fully for the exercise's target muscle and
    partially for its supporting ones — not in kilograms, because 100 kg of leg press and 12 kg of
    lateral raise say nothing about which muscle worked harder. Shading is relative within the
    period you're looking at, so the map always reads as a balance rather than an absolute.
  - Settings → Appearance → **Body diagram** switches between a male and female figure.
  - The exercise dataset spells muscles inconsistently ("delts", "deltoids" and "shoulders" are one
    muscle); all 50 spellings it uses are normalised onto the 18 the diagram can draw. Custom
    exercises, which only carry a body part, fall back to it. The geometry is ~90 kB and loads on
    demand, so the initial bundle is unchanged.
- 🐛 **Fixed: finishing a workout from its last exercise could blank the whole app.** The
  per-exercise weight sheet read the running workout without checking it was still there, and
  finishing clears it while that sheet is still on screen.
- ▶️ **Live demo** at [duartesantos8.github.io/openGym](https://duartesantos8.github.io/openGym/) —
  a browser-only build (`VITE_DEMO=1`) published to GitHub Pages on every push to `main`. It boots
  into guest mode with a seeded example profile (12 weeks of Push/Pull/Legs, weigh-ins, PRs) so
  every screen has something to show, and it never talks to a server. Passkeys, sync and the admin
  dashboard stay exclusive to self-hosted instances, which is where the backend lives.
- 🖼️ Builds can point the exercise media elsewhere via `VITE_IMG_BASE` / `VITE_GIF_BASE` — the demo
  serves the ~140 MB dataset from a CDN instead of shipping it. The default (`img/` and `gif/` next
  to the app) is unchanged.

## v1.2.0 — 2026-07-23

A complete visual redesign. Same app, same data — every screen redrawn.

### A designed interface, not an assembled one

- 🎨 **Rebuilt design system.** One type scale carrying hierarchy through size instead of making
  everything bold, a neutral surface ramp instead of saturated blue-greys, hairline separators
  instead of outlined boxes, and motion that acknowledges a press rather than animating for
  decoration. Light and dark are both first-class, and the eight accent colours now pick their
  label colour by measured contrast — the default green in light mode was failing WCAG AA on
  every primary button before.
- ✏️ **A hand-drawn icon set** (77 icons, single stroke weight, drawn on one 24×24 grid) replaces
  every emoji in the interface. Emoji render differently on each platform, sit on their own
  baseline and can't take a theme colour, which is what made the old UI feel stitched together.
  Icons inherit the surrounding text colour and optical size.
- 🏋️ **Routine icons.** Picking an icon for a routine now offers a grouped set — strength,
  equipment, cardio, recovery — instead of an emoji keyboard. Routines you already made keep
  their look: the old emoji are mapped forward automatically, so nothing to migrate and nothing
  to redo.
- ▶️ **New tab bar** with a raised Start button that turns into a pulsing orange Resume while a
  workout is running.
- 🏠 **Home reads as a plan for today** — week strip, today's session as one tappable row, body
  weight, and your streak.

### Charts

- 📈 **Axis labels, gridlines and the target-weight line are visible again** in dark mode. They
  were painted with colour variables that no longer existed, which silently fell back to black
  on black — and to no stroke at all for the lines.
- 💬 **The hover readout stays on screen.** It used to be positioned with a fixed offset that
  assumed one label width, so the first and last point pushed it under the chart's clip; it's now
  placed from its measured size and kept inside the frame, dropping below the point when the
  point sits high enough that the label would cover the value it reports.
- 🖱️ **It also goes away again** — moving off the chart now clears the readout, crosshair and
  marker, which previously stayed until you hovered somewhere else.

## v1.1.3 — 2026-07-22

Admin dashboard for self-hosters (opt-in — off by default), equipment filtering, and
workout-screen fixes.

### Admin dashboard

- 🛠️ **Admin dashboard** (Settings → Admin dashboard) for whoever runs the instance: a users
  overview with workout counts and last-active times, plus a per-user drill-down into their full
  workout history and body-weight log.
- 🟢 **Live "training now"** — see who's mid-workout in real time, with their current exercise and
  set progress, updated by a lightweight heartbeat while a workout is on screen.
- 🚫 **Disable / enable accounts** — a disabled account is signed out and locked out everywhere
  until you re-enable it.
- 🔑 **Invite-only signup** (optional) — require an invite code to create a profile; generate and
  revoke codes from the dashboard. Existing accounts are unaffected.
- ⚙️ Configured via environment: `ADMIN_UIDS` (comma-separated user ids who are admins) and
  `INVITE_ONLY=1`; both default off, so a fresh instance stays open with no admin. See
  `.env.example`. Admin access is gated by your passkey and enforced server-side.

### Exercises & workout

- 🏋️ **Filter exercises by equipment** (#6). A second filter row under the body parts lets you
  narrow the list to what you actually have — body weight, dumbbell, barbell, cable, band, and so
  on — in both the Exercises library and the exercise picker. The options adapt to what you've
  already selected and are ordered by how many exercises use them, so every combination on screen
  has results behind it and the row stays short. Building a bodyweight-only plan is now two taps
  per body part.
- 🔎 **Minimize the exercise animation during a workout** (#12). A ⤡ Minimize / ⤢ Expand button
  on the animation shrinks it to a thin strip so the set rows sit right under your thumb — no more
  scrolling past a big GIF to tick off a set. Your choice is remembered and applied to every
  exercise and future workout until you change it, so you set it once. Tapping the animation still
  pauses/plays it as before.
- ⏱️ **Fixed: the rest timer froze at 0:01** (#14) instead of counting down to the end. It also
  meant the timer could only be cleared with Skip, and a redundant "rest over" push notification
  could still fire.

## v1.1.2 — 2026-07-22

Custom exercises, full localization, and input fixes.

### Custom exercises (#11)

- ✨ **Create your own exercise** from the exercise picker or the Exercises tab: a name and a
  body part is all it takes. Your search text is pre-filled as the name, so "no match" flows
  straight into "create it".
- 📝 **Optional description** — setup, cues, anything you want to remember. It shows on the
  exercise's detail and config sheets (where a built-in exercise would show its animation),
  and it's searchable, so you can find your own exercises by their cues too.
- 🏋️ Custom exercises behave like built-in ones everywhere — routines, supersets, workout
  logging, weight suggestions, PRs, stats and history. The animation stays blank by design.
- 🏃 Pick the *cardio* body part and it logs time + speed instead of weight × reps, like the
  built-in cardio exercises.
- ✏️ Edit (rename, change body part or description) or delete your custom exercises — from
  their detail sheet in the Exercises tab, or straight from the exercise inside a routine via
  "Edit or delete this exercise". Deleting removes them from your routines; already-logged
  workouts keep their sets and still show the exercise name. (The routine sheet's old "Remove
  exercise" button is now labelled "Remove from routine", so the two are no longer confusable.)

### Localization (#7)

- 🌍 **12 UI languages**: English, Deutsch, Español, Français, Italiano, Português, Polski,
  Türkçe, Русский, 中文, 한국어, हिन्दी. Pick yours under Settings → Appearance → Language;
  the choice syncs with your profile like the theme does.
- 📖 **Localized exercise instructions** for 10 of those languages (all except German and
  Portuguese, which the upstream dataset doesn't cover yet — those fall back to English),
  covering all 1,324 exercises. Body-part filters, equipment and muscle tags are translated
  too; exercise *names* stay English (upstream limitation). Custom exercises are translated too.
- 📅 Dates, weekday and month labels follow the selected language.
- ⚡ Zero cost when unused: the app still ships English-only by default. Each UI language is a
  ~7 kB chunk and each instruction pack ~80–120 kB (gzipped), downloaded only when you switch —
  the initial bundle size is unchanged.
- 🛠️ New `scripts/build-instructions.mjs` regenerates the instruction packs from the upstream
  dataset; translations live in `frontend/src/locales/` (PRs welcome — it's one flat
  English-string → translation map per language).
- Known gaps: push notification texts (sent by the server) and plural forms in some languages
  are approximated; happy to take corrections from native speakers.

### Fixes

- ⌨️ Weight and other numeric fields now accept a comma as decimal separator ("33,5") — iOS
  decimal keyboards in many locales only offer a comma, which previously reset the field to 0.
  Partial input like "33," no longer snaps to 0 while typing. (#13)
- 📱 Fixed the exercise-config sheet (Sets / Reps / Weight, and the cardio variant) overflowing the
  screen edge on narrow phones — the Weight stepper was clipped and could make the whole page pan
  sideways in iOS Safari. Steppers now shrink to fit the viewport. (#10)
- 🛡️ Added a global horizontal-overflow guard so a single too-wide element can no longer knock the
  page layout off-scale.

## v1.1.1 — 2026-07-21

Reliability fixes for the push notifications shipped in v1.1.0, found through live testing:

- 🌍 Workout day reminder now fires by each user's own browser-detected timezone instead of a
  single server-wide one — works correctly regardless of where the server runs, and follows you
  automatically if you travel.
- 💾 Settings changes (like the reminder time) are flushed to the server immediately when the tab
  backgrounds or closes, instead of relying solely on a 1.5s debounce that could get cut short.
- ⏱️ Reminder check tightened from a 60s to a 10s interval, and pushes are now marked
  `urgency: 'high'` — cuts avoidable delay on top of it, though delivery time is ultimately up to
  Apple/Google's push relay.
- 🪵 Push send failures are now logged instead of silently swallowed.

## v1.1.0 — 2026-07-21

- 🐳 Prebuilt Docker images published to `ghcr.io/duartesantos8/opengym-{api,web}` (amd64 + arm64)
  via GitHub Actions, so self-hosting no longer requires building from source. `docker compose pull`
  grabs them; `docker compose up -d --build` still builds locally if you'd rather.
- 🔔 Push notifications: rest-timer-over alert (fires even if the app is closed) and an optional
  daily reminder on days you have a workout planned but haven't logged one yet. Opt in per-profile
  in Settings — requires a signed-in passkey profile. Backend gains one dependency (`web-push`);
  VAPID keys are generated on first run.
- 🐛 Fixed the rest timer stalling when the tab/app is backgrounded — it's now anchored to a real
  timestamp instead of a plain per-second counter, so it stays accurate after you come back.

## v1.0.0 — 2026-07-20

First public release. A complete, self-hostable gym & body-weight tracker.

**Highlights**
- ⚖️ Body-weight tracking with an interactive chart + goal line
- 🏋️ Weekly routine planner over 1,324 exercises with animated demos
- ▶️ Guided workouts: body-weight check-in, pre-filled weights, rest timer, PR detection, per-exercise weight tracking
- 🔗 Supersets and 🏃 cardio (time + speed) logging
- 🗓️ Per-day rescheduling without touching your weekly plan
- 🟩 GitHub-style activity heatmap (by time trained)
- 🔑 Passkey (WebAuthn) login with per-profile data that syncs across devices
- 🎨 Light/dark themes + 8 accent colors, synced to your profile
- 📦 JSON export/import, guest mode, PWA install, no telemetry

**Stack**
- React 19 + Vite (React Router, Zustand)
- Node backend, no framework, single dependency (`@simplewebauthn/server`), JSON-file storage
- nginx + multi-stage Docker so `docker compose up` builds and serves everything

**Notes**
- Exercise media (~140 MB) is fetched from [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) on first run.
- Licensed under GNU AGPL v3.0.

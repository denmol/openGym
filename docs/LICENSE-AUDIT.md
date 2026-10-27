# Licence audit — what has to change before Pass could be sold

Audit of 27 October 2026. It reads the repository, `NOTICE.md`, every production dependency and
the published terms of each upstream source. **It is an engineering review, not legal advice** —
have a lawyer confirm the points marked *blocker* before any paid release.

## Summary

| # | Component | Licence | Free use (you two) | Paid app |
|---|-----------|---------|--------------------|----------|
| 1 | Pass / openGym code | AGPL-3.0-or-later | fine | **sellable, but never closed** — see 1 |
| 2 | Exercise images and animations | © Gym visual, own terms | fine (openGym-only permission, 180 px) | **blocker** — needs its own licence or replacement |
| 3 | Exercise names and instructions | MIT (dataset) | fine | fine with notice; our translations are derivatives |
| 4 | Livsmedelsverket food data | CC BY 4.0 | fine | fine; **in-app credit missing** |
| 5 | Open Food Facts lookups | ODbL + DbCL | fine | needs care — see 5 |
| 6 | npm dependencies | MIT, ISC, BSD-3, 0BSD, Apache-2.0, MPL-2.0 | fine | fine; ship a third-party notices file |
| 7 | Body-map outlines (MuscleMap) | MIT | fine | fine; notice already in `NOTICE.md` |
| 8 | Name "Pass" | — | fine | check trademark first |

## 1. The code itself (AGPL-3.0-or-later)

* Anyone may sell AGPL software. What nobody can do is keep it closed: every user of a hosted
  copy, and every recipient of an app, may ask for the complete source, including your changes.
* Relicensing (for example to a closed or dual licence) needs **every** copyright holder. The
  history has the original authors, you, and a large share of Claude-written commits. The
  upstream project has a CLA that lets *openGym* relicense contributions, but that right belongs
  to upstream, not to a fork.
* `NOTICE.md` carries an **App Store exception** written by the upstream author for "the openGym
  mobile application". Whether it covers a differently named fork should be confirmed in writing.
* Claude-written code: ownership of AI output is uncertain in some jurisdictions. Anthropic's
  terms assign output to the customer, but a lawyer should note it for a sale or investment.

**Options**
1. *Open core, paid service.* Keep AGPL, charge for hosting, support and the clinician features.
   Legally the cleanest; the source stays public.
2. *Ask upstream* for a commercial licence or a written confirmation of the App Store exception.
3. *Rewrite* the parts you want closed. Large effort; the engine and trainer rules are the
   valuable bits and are intertwined with upstream code.

## 2. Exercise images and animations — **blocker for a paid app**

The media belongs to **Gym visual** (gymvisual.com). The dataset's own notice and the upstream
README say the permission is limited: shown at 180 px, with the credit line
"© Gym visual — https://gymvisual.com/", for openGym, and "a non-commercial fork may keep them
unmodified with the notice". Anything else needs a licence from Gym visual.

Two further problems today, even for free use:
* The production build **hot-links** the files from `raw.githubusercontent.com`
  (`vercel.json`), which is not a CDN and gives no guarantee.
* The required credit line is **not shown anywhere in the app**, only in `NOTICE.md`.

**Options**
1. *Buy a licence* from Gym visual (their terms were not readable from this environment; ask
   for commercial app pricing, display size and hosting rights in writing).
2. *Replace the media* with something you own: commissioned drawings, or a public-domain set.
   The "Free Exercise DB" project is reported to be public domain — verify before relying on it.
3. *Ship text-only* in the paid tier and keep media as an opt-in for self-hosters.
4. *Either way, now:* add an in-app credits screen with the credit line and host the media
   yourself or through a proper CDN.

## 3. Exercise names and instructions (MIT)

The dataset releases code, structure and instruction text under MIT, and our Swedish, German
and Portuguese packs are translations of that text. MIT permits that, including commercial use,
but requires keeping the copyright and licence text. `NOTICE.md` currently says the instructions
are "not covered by openGym's AGPL" without reproducing the MIT text.

**Fix:** add the dataset's MIT notice to `NOTICE.md` and the credits screen.

## 4. Livsmedelsverket food data (CC BY 4.0)

Commercial use is allowed. Conditions: name the Swedish Food Agency as the source, link to the
licence and say whether you changed the data (`NOTICE.md` states values are carried through
unchanged). The credit exists only in `NOTICE.md`; **the app should show it** (a line under the
food search is enough).

## 5. Open Food Facts (ODbL for the database, DbCL for contents, CC BY-SA for photos)

* The app shows the required attribution on the scan confirmation. Good.
* The server caches each looked-up barcode for 30 days and users can save a product as their
  own food. Private caching for the person who asked is normal use. The risk starts if the
  accumulated cache is **shared between users or sold as a dataset**: that can count as a derived
  database, which must then be offered under ODbL.
* Photos are CC BY-SA and the app does not use them. Keep it that way.
* The `User-Agent` string should name your own contact address, as Open Food Facts asks.

**Options:** keep lookups per user (no cross-user catalogue), keep the attribution, or write to
reuse@openfoodfacts.org to confirm how they view a paid app calling the API at volume.

## 6. Dependencies

Production dependencies are permissive: MIT, ISC, BSD-3-Clause, 0BSD, Apache-2.0, and MPL-2.0
for `web-push` (file-level copyleft, no obligation for unmodified use). Build tools (Vite,
Vitest, Capacitor CLI) are MIT and are not shipped. Bundled client libraries (React, zustand,
react-router, zxing-wasm) require their copyright notice to travel with the app.

**Fix:** generate a `THIRD-PARTY-NOTICES.txt` at build time and link it from the credits screen.

## 7–8. Smaller points

* **MuscleMap** body outlines: MIT, notice already included.
* **Name:** "Pass" is a very common word, and Apple uses "Pass" for Wallet passes. Search the
  Swedish and EU trademark registers (PRV, EUIPO) and the App Store before building a brand on
  it. This is cheap to check now and expensive to change later.
* **Not licensing but decisive for a paid product:** health data (GDPR special category), the
  line between a logbook and medical-device software (insulin, glucose), per-user storage and
  account recovery. These are listed separately in the earlier assessment.

## Suggested order

1. Decide the model: open core with paid hosting, or a rewrite of the parts to be closed.
2. Contact Gym visual (licence) and, in parallel, evaluate a replacement media set.
3. Build the credits screen (Gym visual line, Livsmedelsverket, Open Food Facts, MIT notice,
   third-party notices) — small, and correct even if the app stays free.
4. Trademark search for the name.
5. Lawyer review of items 1, 2 and 5.

# Coach Desk — a Jev-decides / LLM-writes triage app

A gym-coaching inbox. A member sends a message; **Jev** (REFLEX) makes every judgment call, a **primary LLM** (ENGINE) writes the reply, and the **UI** (INTERFACE) shows every decision with its confidence and latency.

```
npm install      # one dependency: gpt-tokenizer (real token counts)
npm start        # http://localhost:8787
npm test         # 60 tests
npm run e2e      # 5 real messages end to end -> logs/
```

## Read this first: what is and isn't real

- **Jev is not wired up.** The repo had no Jev client, docs or credentials. `src/jev.js` defines a wire contract (below) and an `HttpJev` adapter behind `JEV_URL`; **that contract is my assumption** and may need adjusting.
- Until `JEV_URL` is set the app runs on **`SimJev`**, a deterministic lexicon-and-softmax stand-in (`src/jev-sim.js`). Every response, log line and UI header says `jev: sim`. **Every confidence, latency and Brier number in this README describes SimJev, not Jev.** They prove the harness, thresholds, fallbacks and UI work. They say nothing about Jev's calibration. Re-run `npm test && npm run e2e` with `JEV_URL` set to get numbers that do.
- No `ANTHROPIC_API_KEY` was available, so the ENGINE ran as an offline template stub (`engine: stub`). `AnthropicEngine` is implemented and untested against the live API.
- Token counts use `gpt-tokenizer` (a real BPE tokenizer), not Jev's tokenizer, which I can't see. Hence the 360-token target under the 400 limit.

## Architecture

```
                    ┌────────────────────────── INTERFACE (public/index.html) ──────────────────────────┐
                    │ input · per-decision card: typed answer, confidence (green/amber/red), ms, flag   │
                    │ tier chip · queue priority · gate result beside every output · "why" trail        │
                    └───────────────▲──────────────────────────────────────────────┬────────────────────┘
                       NDJSON events│ (state, intake, routing, llm_start, gate…)   │ POST /api/ask[/stream]
                    ┌───────────────┴──────────────────── API (src/orchestrator.js) ▼───────────────────┐
                    │ buildState() ONCE ──► frozen snapshot (<400 tok), identical object to all 3 calls │
                    └───┬────────────────────────────────────────────────────────────────────────────────┘
                        │ parallel, before any LLM call
          ┌─────────────┴─────────────┐
   ┌──────▼──────┐             ┌──────▼──────┐        REFLEX = Jev (src/jev.js, GuardedJev: breaker+canary)
   │ 1 INTAKE    │             │ 2 ROUTING   │        category · is_actionable · complexity
   │ conf < 0.65 │             │ tier · human│        model_tier · needs_human · priority
   │  ──► BLOCK  │             │ · priority  │
   └──────┬──────┘             └──────┬──────┘
          │ ok                        │ needs_human ──► HUMAN REVIEW (LLM never called)
          └─────────────┬─────────────┘ conf < 0.60  ──► tier forced to `thorough`
                        ▼
                 priority queue (p1 before p2 before p3)
                        ▼
              ┌────────────────────┐
              │ ENGINE = LLM       │        generation only; never sees a Jev decision
              │ fast/balanced/thor.│
              └─────────┬──────────┘
                        ▼  candidate output
                 ┌──────────────┐          matches_intent · safe_to_return · quality_score
                 │ 3 OUTPUT GATE│          (state snapshot + candidate)
                 └──────┬───────┘
        pass ◄──────────┤  fail: quality<3 | unsafe | !intent | conf<0.60
   (return + gate result)│
                        ▼ retry ONCE on `thorough` with a plain-text reason ──► gate again
                        ▼ still failing, or gate unavailable
                   HUMAN REVIEW  (no output returned)
```

Separation is enforced in code and by tests: the engine receives only `{tier, input, history, category, feedback}`; intake and routing receive a state that cannot contain engine output; only the gate gets `candidate`; no generation goes through Jev and no decision goes through the LLM.

## The three typed Jev schemas (`src/schemas.js`)

Every reply is validated; anything out of enum/range/type becomes "Jev unavailable" and fails closed. A decision's `confidence` is the **minimum** over its fields (weakest-field rule: the dangerous fields — `is_actionable`, `needs_human`, `safe_to_return` — are often the weakest).

| Decision | Field | Type | Definition sent to Jev |
|---|---|---|---|
| **Intake** | `category` | choice: `workout_plan, form_check, nutrition, injury_pain, account_billing, other` | Any mention of pain/dizziness/injury ⇒ `injury_pain`, even if framed as form |
| | `is_actionable` | boolean | Desk can answer usefully from this message alone |
| | `complexity` | scale 1–5 (±1 tolerance in calibration) | 1 single fact … 5 conflicting constraints |
| **Routing** | `model_tier` | choice: `fast, balanced, thorough` | fast = one fact; balanced = advice/short plan; thorough = multi-constraint programme |
| | `needs_human` | boolean | Pain/dizziness/injury, billing change or dispute, anything medical |
| | `priority` | scale 1–3 (exact) | 1 safety/time-critical cue; **2 default**; 3 casual, no ask |
| **Gate** | `matches_intent` | boolean | Answers what was asked, even if rephrased |
| | `safe_to_return` | boolean | False if it diagnoses, says train through pain, omits referral when symptoms were reported, doses supplements, prescribes <1500 kcal |
| | `quality_score` | scale 1–5 (±1) | 3 usable as is; 4 specific with numbers; 5 structured and complete |

Assumed wire contract (`HttpJev`): `POST {JEV_URL}/decide` with `{schema, fields, state, candidate?}` → `{answer, field_confidence}`; per-field confidences in `[0,1]`.

## Shared state (`src/state.js`)

Built once per request, deep-frozen, passed by reference (`===`, asserted in a test) to all three calls. Contents: `input`, last ≤3 turns, domain `signals` (words, question mark, digits, pain/food/billing/exercise regex flags), `meta` (turn, plan, lang). Never any engine output.

```json
{"input":"Sharp pain in my shoulder","history":[],"signals":{"words":5,"q":false,"num":false,"pain":true,"food":false,"bill":false,"ex":false},"meta":{"turn":1,"plan":"free","lang":"en"}}
```

**Real token counts** (gpt-tokenizer, measured by `test/state.test.js`): that example 56; a typical request with 3 history turns **111**; adversarial worst cases (500× repeated phrase, 400× emoji, CJK, random base36 noise, each with 5 oversized history turns) **315–316**. The builder trims by tokens (not characters) to a 360 target and throws above 400.

## Thresholds and why (`src/config.js`)

| Threshold | Value | Reason |
|---|---|---|
| Intake block | conf < **0.65** | Spec. Below ~⅔ the category is wrong >⅓ of the time and one wrong answer is "injury filed as workout plan" |
| Review flag / amber–red | < **0.60** | Spec. Same line the gate fails closed on, so what shows a red flag is what is enforced |
| Green | > **0.80** | Spec |
| Routing low-confidence tier | **thorough** | Wrong-but-cheap costs a rejected answer + retry; wrong-but-strong costs cents |
| Gate min quality | **3** | 3 = usable with no edits; 2 = a coach would rewrite |
| Gate min confidence | **0.60** | An unsure gate is not a pass |
| Retries | **1**, on `thorough` | Spec. A second retry mostly re-rolls the same dice and doubles tail latency |
| Jev timeout | **1500 ms** | A reflex that takes longer isn't one; fail closed rather than make the user wait |
| State target / limit | **360 / 400** tok | ~10% headroom for tokenizer mismatch with Jev |
| Brier max (uncertain cases) | **0.25** | Always saying 0.5 scores 0.25; anything above is worse than knowing nothing |
| Breaker | 5 failures → open 10 s | Stops every request paying the timeout during an outage |

Extension beyond the spec, documented: the gate also fails on `matches_intent=false` and on gate confidence < 0.60.

## Every fallback has a test that triggers it

| Fallback | Test |
|---|---|
| Intake conf < 0.65 → block, LLM never called | `FALLBACK intake<0.65` (+ exact-0.65 boundary) |
| Not actionable → clarification | `FALLBACK not actionable` |
| `needs_human` → human review, LLM never called | `FALLBACK routing.needs_human` |
| Routing conf < 0.60 → `thorough` + flag | `FALLBACK routing<0.60` |
| Priority becomes queue order | `priority decision becomes queue order`, `queue: priority 1 jumps…` |
| Gate quality < 3 → retry once → ok | `FALLBACK gate quality<3` |
| Unsafe twice → human, no output | `FALLBACK gate unsafe twice` |
| Unsafe then safe → recovers | `…unsafe first, safe second` |
| `matches_intent=false` / gate conf < 0.60 → fail | two matching tests |
| **All three low confidence at once** | `ALL THREE low confidence` ×2 (blocked at intake; and intake barely passing, gate fails closed) |
| Jev down at intake / routing / gate | three `FALLBACK Jev down at …` tests |
| Engine error | `FALLBACK engine error` |
| Invalid/out-of-schema Jev reply, timeout, HTTP 5xx | `test/jev.test.js` |
| Breaker open; canary catches an up-but-wrong Jev | `test/guard.test.js` |
| Intake + routing parallel; LLM waits for both | `parallel: …` |
| One state object; no engine output in state | `layering: …` ×3 |

Human-review path with a real input: **E4** below ("Sharp pain in my shoulder…").

## Calibration (SimJev — see caveat at top)

Per schema: a clear-proceed, a clear-review and a genuinely-uncertain canonical input (`test/fixtures.js`), plus 9 uncertain gold-labelled cases per schema for Brier. Gold labels were written before the first run. Brier is per field (`field_confidence` vs. whether the field matched gold, within the schema's tolerance).

**First run failed** (`logs/calibration-first-run.txt`): routing **0.314**, gate **0.288**, intake 0.219 (limit 0.25). Diagnosis: routing was over-confident (0.95) on a tier boundary nobody had defined and on `priority`, which messages rarely state; the gate judged intent by word overlap and scored on-topic rephrasings quality 1 at 0.88 confidence, and missed "eat 1100 calories".

Per the brief, I **tightened the schema before touching any threshold**: sharper field definitions (above — tier boundaries, "priority 2 is the default", explicit unsafe list) and fixed the evidence behind them. No threshold was changed.

| Brier | Intake | Routing | Gate |
|---|---|---|---|
| First run (9 cases) | 0.219 | 0.314 ✗ | 0.288 ✗ |
| After tightening, same 9 cases | 0.160 | 0.181 | 0.116 |
| **Held-out** (6 cases each, written before the fixes, never tuned on) | **0.127** | **0.218** | **0.129** |

The same-9-case numbers are optimistic (I fixed what I saw). The held-out row is the honest one; routing at 0.218 is close to the 0.25 limit. Remaining misses are mostly low-confidence (e.g. a held-out `model_tier` miss at 0.46).

## End-to-end: five real inputs (`logs/e2e-results.jsonl`, `logs/e2e-summary.md`)

Jev = SimJev, engine = stub. Latencies are the stand-in's, not Jev's.

| # | Input | Final | Intake | Routing (applied) | Gate | Flags |
|---|---|---|---|---|---|---|
| E1 | 4-day upper/lower, dumbbells | **ok** | workout_plan 0.88 · 14 ms | thorough/auto/p2 0.59 · 12 ms | q5 safe 0.88 · 12 ms | routing (tier on a boundary → forced to thorough) |
| E2 | protein to cut at 82 kg | **ok** | nutrition 0.81 · 20 ms | balanced/auto/p2 0.62 · 16 ms | q5 safe 0.83 · 7 ms | — |
| E3 | deadlift back rounds | **ok** | form_check 0.96 · 13 ms | fast/auto/p2 0.72 · 15 ms | q5 safe 0.83 · 8 ms | — |
| E4 | sharp shoulder pain, can't lift arm | **human_review** | injury_pain 0.90 · 8 ms | fast/**human**/p1 0.80 · 15 ms | not run (no output) | — |
| E5 | "hmm idk lol" | **needs_clarification** | other 0.40 · 19 ms | thorough/p3 0.40 · 10 ms | not run | intake, routing |

The gate-retry and gate-reject paths are exercised by the scripted tests, not by these five (the stub engine never produces a bad answer).

## API

`POST /api/ask` → `{status, output, decisions:{intake,routing,gate}, gate_attempts, review_flags, trail, model_tier, priority, state:{tokens,snapshot}, jev_source, engine_mode, …}`. Every response carries all three decision slots (`gate` is `null` only when nothing was generated). `POST /api/ask/stream` emits the same as NDJSON events as each decision resolves (the UI uses it). `GET /api/health` → 503 when the breaker is open or the canary failed.

## Final check

| Question | Answer |
|---|---|
| Every Jev decision in the UI with confidence? | Yes: three cards with typed answer, per-field and overall confidence, ms, colour band, review flag <0.60; tier chip, queue priority, quality score; checked in a browser at desktop and 390 px width |
| Handles low confidence on all three at once? | Yes: two tests; blocked at intake, nothing returned, flags shown |
| State <400 tokens, real count? | Yes: 56–111 typical, 316 worst measured, hard throw >400 |
| Human-review path with a real input? | Yes: E4, plus unit tests |

## WHAT BREAKS FIRST

**Jev being up but wrong, or slow, or not matching my assumed contract, on first contact with the real thing.** Every guarantee here is fail-closed on *errors*, but a Jev that returns valid, confident, wrong answers (say `needs_human=false` on a pain message) triggers no fallback at all and unsafe output goes out. Separately, a Jev outage would make every request wait 1.5 s on two calls, then flood the human queue.

Fixed before declaring this shipped (`src/guard.js`, `test/guard.test.js`):
- **Circuit breaker** (`GuardedJev`): 5 consecutive failures open it for 10 s; open means instant fail-closed to human review (tested <20 ms, adapter not called).
- **Canary**: on boot and every 60 s, three known-answer probes (pain → `needs_human`+p1; noise doesn't proceed; "push through the pain" isn't `safe_to_return`). Any failure trips the breaker and `/api/health` goes 503. A test proves an always-"proceed" Jev is caught (3/3 probes fail) and can't wave unsafe traffic through.

Not fixed, because I can't from here: the `HttpJev` wire format is unverified, and real-Jev calibration is unmeasured. First action on connecting Jev: run `npm test && npm run e2e` with `JEV_URL`, and read the Brier lines. Next failure after that is the human-review queue itself: it is unbounded and has no staffing signal, so a Jev incident becomes a support backlog.

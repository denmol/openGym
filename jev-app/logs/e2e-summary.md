# E2E run — jev=sim, engine=stub

> **Jev here is the local stand-in (SimJev), not Jev.** Confidences and latencies describe the stand-in. Re-run with JEV_URL set for real numbers.
> **Engine here is the offline stub**, not an LLM. Set ANTHROPIC_API_KEY for real generation.

| # | Final status | Intake (category conf, latency) | Routing (applied tier/handler/priority conf, latency) | Gate (final attempt) | Review flags | Total |
|---|---|---|---|---|---|---|
| E1 | ok | workout_plan 0.88 (7ms) | thorough/auto/p2 0.59 (18ms) | q5 safe=true 0.88 (9ms) | routing | 56ms |
| E2 | ok | nutrition 0.81 (14ms) | balanced/auto/p2 0.62 (18ms) | q5 safe=true 0.83 (20ms) | — | 60ms |
| E3 | ok | form_check 0.96 (7ms) | fast/auto/p2 0.72 (8ms) | q5 safe=true 0.83 (17ms) | — | 46ms |
| E4 | human_review | injury_pain 0.90 (19ms) | fast/human/p1 0.80 (17ms) | — (no output generated) | — | 20ms |
| E5 | needs_clarification | other 0.40 (19ms) | thorough/auto/p3 0.40 (5ms) | — (no output generated) | intake,routing | 19ms |

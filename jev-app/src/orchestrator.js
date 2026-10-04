// The API layer's brain. Strict layering:
//   REFLEX (Jev)   decide() at intake, routing, gate. No generation.
//   ENGINE (LLM)   generate(). No decisions.
//   This file      sequencing + the fallback for every way a step can fail.
//
// Statuses (final.status):
//   ok               answer returned, gate passed
//   needs_clarification  intake blocked (low confidence or not actionable); LLM never called
//   human_review     routed to a person: routing.needs_human, gate failed twice, or Jev down
//
// Fail-closed rule: when a decision cannot be made (Jev timeout / invalid reply), we never
// guess *toward* returning output. Intake down -> clarification/human; routing down -> strongest
// tier + human; gate down -> human (an unverified answer is never shown).

import { CONFIG } from './config.js';
import { decide, JevUnavailable } from './jev.js';
import { buildState, stateTokens } from './state.js';
import { PriorityQueue } from './queue.js';

export class Orchestrator {
  constructor({ jev, engine, queue = new PriorityQueue(CONFIG.ENGINE_CONCURRENCY), log = () => {} }) {
    Object.assign(this, { jev, engine, queue, log });
  }

  async handle(req, emit = () => {}) {
    const state = buildState(req); // ONCE. Same frozen object goes to every Jev call below.
    const tokens = stateTokens(state);
    emit({ type: 'state', state, tokens });

    const decisions = { intake: null, routing: null, gate: null };
    const gateAttempts = [];
    const flags = [];
    const trail = []; // human-readable "why" lines for the UI / logs
    const finish = (status, extra = {}) => {
      const out = {
        status,
        output: null,
        decisions,
        gate_attempts: gateAttempts,
        review_flags: flags,
        trail,
        model_tier: decisions.routing?.applied?.model_tier ?? null,
        priority: decisions.routing?.applied?.priority ?? null,
        state: { tokens, snapshot: state },
        engine_mode: this.engine.mode,
        jev_source: this.jev.source,
        ...extra,
      };
      emit({ type: 'final', result: out });
      return out;
    };

    // 1+2. Intake and routing fire in parallel, before any LLM call, on the same snapshot.
    const settle = (name) =>
      decide(this.jev, name, state).then(
        (d) => { decisions[name] = d; emit({ type: name, decision: d }); return d; },
        (err) => { decisions[name] = this.#down(name, err); emit({ type: name, decision: decisions[name] }); return decisions[name]; },
      );
    const [intake, routing] = await Promise.all([settle('intake'), settle('routing')]);
    this.#flagLow(intake, 'intake', flags);

    // 3. Apply routing (with its own fallbacks) so the UI can show what was actually used.
    routing.applied = this.#applyRouting(routing, trail);
    this.#flagLow(routing, 'routing', flags);
    emit({ type: 'routing_applied', applied: routing.applied });

    // 4. Intake block. Below 0.65 (or Jev down) we do not proceed, whatever routing says.
    if (intake.unavailable) {
      trail.push('Intake unavailable: failing closed to a person.');
      return finish('human_review', { reason: 'intake_unavailable', message: 'A coach will pick this up.' });
    }
    if (intake.confidence < CONFIG.INTAKE_BLOCK_BELOW) {
      trail.push(`Intake confidence ${intake.confidence} < ${CONFIG.INTAKE_BLOCK_BELOW}: blocked before the LLM.`);
      return finish('needs_clarification', { reason: 'intake_low_confidence', message: 'I am not sure what you need. Could you add detail, e.g. your goal, the exercise, or what hurts?' });
    }
    if (!intake.answer.is_actionable) {
      trail.push('Intake says not actionable: asking for detail instead of calling the LLM.');
      return finish('needs_clarification', { reason: 'not_actionable', message: 'Could you tell me a bit more about what you want help with?' });
    }

    // 5. Human routing: the LLM is not called at all.
    if (routing.applied.needs_human) {
      trail.push(`Routing sent this to a person (${routing.applied.human_reason}).`);
      return finish('human_review', { reason: routing.applied.human_reason, message: 'A human coach will review this and reply. In the meantime, if you have sharp pain, dizziness or chest symptoms, stop and seek medical care.' });
    }

    // 6. Generate (queued by priority) -> gate -> retry once -> human.
    let feedback;
    let tier = routing.applied.model_tier;
    for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      let gen;
      try {
        gen = await this.queue.run(routing.applied.priority, (q) => {
          emit({ type: 'llm_start', attempt, tier, queued_ms: q.queued_ms });
          return this.engine.generate({ tier, input: state.input, history: state.history, category: intake.answer.category, feedback });
        });
      } catch (err) {
        trail.push(`Engine failed (${err.message}).`);
        return finish('human_review', { reason: 'engine_error', message: 'A coach will pick this up.' });
      }
      emit({ type: 'output', attempt, model: gen.model, text_chars: gen.text.length });

      let gate;
      try {
        gate = await decide(this.jev, 'gate', state, { candidate: gen.text });
      } catch (err) {
        gate = this.#down('gate', err);
      }
      gate.attempt = attempt;
      gateAttempts.push(gate);
      decisions.gate = gate;
      emit({ type: 'gate', decision: gate, attempt });

      const verdict = this.#gateVerdict(gate);
      if (verdict.pass) {
        this.#flagLow(gate, 'gate', flags);
        return finish('ok', { output: gen.text, model: gen.model, attempts: attempt + 1 });
      }
      this.#flagLow(gate, 'gate', flags);
      trail.push(`Gate rejected attempt ${attempt + 1}: ${verdict.reason}.`);
      if (gate.unavailable) break; // cannot verify -> do not retry blind
      feedback = verdict.reason;
      tier = CONFIG.RETRY_TIER;
      if (attempt < CONFIG.MAX_RETRIES) emit({ type: 'retry', reason: verdict.reason, tier });
    }
    return finish('human_review', { reason: 'gate_failed', message: 'A coach will review this answer before it is sent.' });
  }

  // A Jev failure becomes a decision-shaped record with confidence 0 so the UI shows it.
  #down(name, err) {
    const fallback = {
      intake: { category: 'other', is_actionable: false, complexity: 3 },
      routing: { model_tier: CONFIG.ROUTING_LOW_CONF_TIER, needs_human: true, priority: 1 },
      gate: { matches_intent: false, safe_to_return: false, quality_score: 1 },
    }[name];
    return { decision: name, answer: fallback, field_confidence: {}, confidence: 0, latency_ms: null, source: this.jev.source, unavailable: true, error: String(err.message ?? err) };
  }

  #flagLow(d, name, flags) {
    if (d.confidence < CONFIG.REVIEW_FLAG_BELOW) flags.push({ decision: name, confidence: d.confidence, reason: d.unavailable ? 'jev_unavailable' : 'low_confidence' });
  }

  #applyRouting(r, trail) {
    const a = { ...r.answer, human_reason: null };
    if (r.unavailable) {
      a.needs_human = true; a.human_reason = 'routing_unavailable';
      trail.push('Routing unavailable: strongest tier, priority 1, human review.');
    } else if (r.confidence < CONFIG.REVIEW_FLAG_BELOW) {
      a.model_tier = CONFIG.ROUTING_LOW_CONF_TIER;
      trail.push(`Routing confidence ${r.confidence} < ${CONFIG.REVIEW_FLAG_BELOW}: tier forced to ${a.model_tier}.`);
    }
    if (r.answer.needs_human && !r.unavailable) a.human_reason = 'routing_needs_human';
    return a;
  }

  #gateVerdict(g) {
    const a = g.answer;
    if (g.unavailable) return { pass: false, reason: 'gate unavailable, output cannot be verified' };
    if (!a.safe_to_return) return { pass: false, reason: 'answer judged unsafe to return' };
    if (a.quality_score < CONFIG.GATE_MIN_QUALITY) return { pass: false, reason: `quality ${a.quality_score} < ${CONFIG.GATE_MIN_QUALITY}` };
    if (!a.matches_intent) return { pass: false, reason: 'answer does not match what was asked' };
    if (g.confidence < CONFIG.GATE_MIN_CONFIDENCE) return { pass: false, reason: `gate confidence ${g.confidence} < ${CONFIG.GATE_MIN_CONFIDENCE}` };
    return { pass: true };
  }
}

export { JevUnavailable };

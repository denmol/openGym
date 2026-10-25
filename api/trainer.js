// The AI trainer's server side: what may be sent to a model, and what may come back.
//
// The analysis itself happens in the browser (frontend/src/lib/trainer.js), from the user's
// own log, by fixed rules. This file never computes a training fact. It does three things:
//
//   1. cleans the findings the browser sends, so only a small structured record — rule codes,
//      numbers, exercise and muscle names — can reach a model. No free text from the profile,
//      no diagnoses, no body-weight history.
//   2. decides whether a model is used at all. A health flag, a minor, or an unreviewed
//      profile gets the app's own fixed text instead, the same line the nutrition assistant
//      draws.
//   3. checks what the model wrote. Every number must be one the findings contain, every
//      citation must be a study the findings point to, and nothing may look like a link. An
//      answer that fails is thrown away and the browser shows the fixed text.
//
// What the check cannot do: tell which quantity a number belongs to. "9 weeks" passes when the
// findings hold a 9 that is really a set count. Percentages are held to percentage facts for
// that reason; everything else leans on the prompt, on the schema (which stops the model
// naming codes or studies that aren't there) and on the reader seeing the findings beside
// the prose. The fixed text is always one tap away.
//
// That third step is what "scientific" means here: a model can phrase a verdict but cannot
// make up a figure or a reference, and the reader can see which kind of rule each verdict
// rests on.

const MAX_FINDINGS = 12;
const MAX_QUESTION = 300;

export const EVIDENCE_IDS = ['volume', 'frequency', 'rir', 'rirAccuracy', 'deload', 'weightLoss', 'who'];
const KINDS = ['act', 'watch', 'good', 'info'];
const BASES = ['evidence', 'practice', 'heuristic'];
const CODE = /^[a-z][a-z_]{1,40}$/;

// Must match MEDICAL_STEMS in frontend/src/lib/coach-profile.js; a test keeps them equal.
export const MEDICAL_STEMS = [
  'pregnan', 'gravid',
  'heart condition', 'heart disease', 'cardiac', 'angina', 'arrhythmi', 'pacemaker',
  'hjärtfel', 'hjärtsjuk', 'hjärtinfarkt', 'kärlkramp', 'pacemaker',
  'blood pressure', 'högt blodtryck', 'hypertens',
  'surgery', 'operated', 'post-op', 'opererad', 'operation', 'nyopererad',
  'fracture', 'fraktur', 'broken bone', 'benbrott',
  'herniat', 'disc prolapse', 'diskbråck',
  'epilep', 'stroke', 'blodpropp', 'embol', 'chemo', 'cytostatika',
  'chest pain', 'bröstsmärt'
];
export const medicalFlag = text => {
  const s = String(text || '').toLowerCase();
  return s ? MEDICAL_STEMS.find(k => s.includes(k)) || null : null;
};

const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const finite = value => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

function cleanFacts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw).slice(0, 24)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,24}$/.test(key)) continue;
    const v = raw[key];
    if (typeof v === 'number') { const n = finite(v); if (n != null) out[key] = n; }
    else if (typeof v === 'string') out[key] = cleanName(v);
  }
  return out;
}

export function cleanTrainerContext(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.findings)) return null;
  const findings = [];
  for (const f of raw.findings.slice(0, MAX_FINDINGS)) {
    if (!f || typeof f.code !== 'string' || !CODE.test(f.code) || !KINDS.includes(f.kind) || !BASES.includes(f.basis)) continue;
    findings.push({
      code: f.code,
      kind: f.kind,
      basis: f.basis,
      evidence: [...new Set(Array.isArray(f.evidence) ? f.evidence : [])].filter(id => EVIDENCE_IDS.includes(id)),
      facts: cleanFacts(f.facts)
    });
  }
  if (!findings.length) return null;
  const question = typeof raw.question === 'string' ? raw.question.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION) : '';
  const goal = ['muscle', 'strength', 'fatloss', 'health'].includes(raw.goal) ? raw.goal : null;
  const level = ['new', 'some', 'experienced'].includes(raw.level) ? raw.level : null;
  return {
    language: raw.language === 'sv' ? 'sv' : 'en',
    goal, level,
    findings,
    question,
    // Browser-side reasons to keep the model out of it. The server adds its own from the
    // stored profile (decideTrainer), so a modified client cannot lower the bar.
    medical: raw.medical === true
  };
}

const adult = age => typeof age === 'number' && Number.isInteger(age) && age >= 18 && age <= 100;

/** 'ai' when a model may phrase the verdict, 'local' when the fixed text is all there is. */
export function decideTrainer(rawContext, storedState) {
  const context = cleanTrainerContext(rawContext);
  if (!context) return { mode: 'invalid', context: null };
  const profile = storedState?.coachProfile;
  const reasons = [];
  if (context.medical) reasons.push('client');
  if (!adult(profile?.age)) reasons.push('age');
  if (medicalFlag(profile?.limits) || medicalFlag(profile?.dislikes) || medicalFlag(context.question)) reasons.push('medical');
  const health = storedState?.health;
  if (health && typeof health === 'object' && health.on !== false) reasons.push('health');
  return { mode: reasons.length ? 'local' : 'ai', context, reasons };
}

/* ------------------------------ what the model sees ------------------------------ */

export function trainerSchema(context) {
  const codes = [...new Set(context.findings.map(f => f.code))];
  const cites = [...new Set(context.findings.flatMap(f => f.evidence))];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'headline', 'paragraphs'],
    properties: {
      status: { type: 'string', enum: ['ok', 'outside_scope'] },
      headline: { type: 'string' },
      paragraphs: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'findings', 'cites'],
          properties: {
            text: { type: 'string' },
            findings: { type: 'array', maxItems: 3, items: { type: 'string', enum: codes } },
            cites: { type: 'array', maxItems: 2, items: cites.length ? { type: 'string', enum: cites } : { type: 'string', enum: ['none'] } }
          }
        }
      }
    }
  };
}

export const TRAINER_SYSTEM = [
  'You are the voice of a strength-training coach inside a self-hosted workout log.',
  'You are given FINDINGS: results computed from this person\'s own log by fixed rules. Your job is to explain them in plain language and put the most important one first. You do not analyse, estimate or invent anything.',
  'Hard rules:',
  '- Use only facts that appear in the findings. Every number you write must be a number from a finding\'s facts (you may round it). Never introduce a number of your own, never a percentage or a week count that is not given.',
  '- A finding\'s "basis" says how firm it is: "evidence" restates a study finding; "practice" is what coaches report doing, not proven; "heuristic" is this app\'s own rule of thumb. Say which, in your own words, when you rely on one that is not "evidence". Never describe a heuristic or a practice as established science.',
  '- You may cite a study only through the "cites" field, and only ids listed in a finding. Do not write author names, years, journals or links in the text.',
  '- Findings of kind "act" come first, then "watch", then "good". Skip "info" unless it explains something else.',
  '- No diagnosis, no medical advice, no supplements or drugs. If the person mentions pain, injury or illness, tell them to talk to a clinician and stop there.',
  '- If a finding says there is not enough data, say that plainly and do not speculate.',
  '- At most 4 paragraphs of at most 60 words each. Direct and warm; no hype, no emoji.',
  '- If a question is given and the findings cannot answer it, set status to "outside_scope" and leave paragraphs empty.',
  '- Write in the language given.'
].join('\n');

export function trainerPayload(context) {
  const payload = {
    language: context.language,
    goal: context.goal,
    experience: context.level,
    findings: context.findings
  };
  if (context.question) payload.question = context.question;
  return payload;
}

/* ------------------------------ what comes back ------------------------------ */

const NUM = /\d+(?:[.,]\d+)?/g;

function allowedNumbers(context) {
  const nums = [];
  const add = text => { for (const m of String(text).match(NUM) || []) nums.push(parseFloat(m.replace(',', '.'))); };
  for (const f of context.findings) {
    for (const v of Object.values(f.facts)) {
      if (typeof v === 'number') nums.push(Math.abs(v)); else add(v);
    }
  }
  return nums;
}

// A figure written as a percentage has to match a fact that is one (pct, worstPct, ...).
// Without this, "12 %" would pass because the plan happens to contain 12 sets.
const PCT = /(\d+(?:[.,]\d+)?)\s*(?:%|procent|percent|prosent)/gi;
function allowedPercents(context) {
  const nums = [];
  for (const f of context.findings) {
    for (const [k, v] of Object.entries(f.facts)) if (typeof v === 'number' && /pct/i.test(k)) nums.push(Math.abs(v));
  }
  return nums;
}

const matches = (x, allowed) => allowed.some(a =>
  x === a ||
  (Number.isInteger(x) && Math.round(a) === x) ||
  (Math.round(a * 10) / 10 === x));

/** Why an answer is unusable, or an empty list. */
export function trainerProblems(answer, context) {
  const problems = [];
  if (!answer || typeof answer !== 'object') return ['not an object'];
  if (answer.status === 'outside_scope') return context.question ? [] : ['outside_scope without a question'];
  if (answer.status !== 'ok') return ['bad status'];
  if (typeof answer.headline !== 'string' || !answer.headline.trim() || answer.headline.length > 140) problems.push('bad headline');
  if (!Array.isArray(answer.paragraphs) || !answer.paragraphs.length || answer.paragraphs.length > 4) return [...problems, 'bad paragraphs'];
  const codes = new Set(context.findings.map(f => f.code));
  const allowed = allowedNumbers(context);
  const texts = [answer.headline, ...answer.paragraphs.map(p => p && p.text)];
  for (const p of answer.paragraphs) {
    if (!p || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 520) { problems.push('bad paragraph text'); continue; }
    if (!Array.isArray(p.findings) || !p.findings.every(c => codes.has(c))) problems.push('unknown finding code');
    const cited = new Set(context.findings.filter(f => (p.findings || []).includes(f.code)).flatMap(f => f.evidence));
    if (!Array.isArray(p.cites) || !p.cites.every(id => cited.has(id))) problems.push('citation not backed by the findings in this paragraph');
  }
  const pcts = allowedPercents(context);
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const m of text.matchAll(PCT)) {
      if (!matches(parseFloat(m[1].replace(',', '.')), pcts)) problems.push('percentage not in the findings: ' + m[1]);
    }
    if (/https?:|www\.|doi\.org|\bdoi:|pubmed|\bet al\b/i.test(text)) problems.push('contains a link or reference');
    for (const m of text.match(NUM) || []) {
      const x = parseFloat(m.replace(',', '.'));
      if (!matches(x, allowed)) problems.push('number not in the findings: ' + m);
    }
  }
  return [...new Set(problems)];
}

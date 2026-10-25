import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTrainerContext, decideTrainer, trainerSchema, trainerPayload, trainerProblems, medicalFlag, EVIDENCE_IDS
} from './trainer.js';

const FINDINGS = [
  {
    code: 'volume_low', kind: 'watch', basis: 'evidence', evidence: ['volume'],
    facts: { muscle: 'Chest', sets: 8.9, floor: 10, ceiling: 20, goal: 'muscle', weeks: 3.6, planned: 12 }
  },
  {
    code: 'fatigue', kind: 'act', basis: 'practice', evidence: ['deload', 'rir'],
    facts: { lifts: 2, names: 'barbell bench press, barbell bent over row', worstPct: -3.4, rirDrop: 1.2, sleepHours: 0, deloadDays: 7, deloadSetsPct: 50, deloadSetsPerWeek: 8, deloadRir: 3 }
  }
];
const RAW = { language: 'sv', goal: 'muscle', level: 'some', findings: FINDINGS };
const STORED = { coachProfile: { age: 34, limits: 'tight left shoulder' } };

test('cleaning keeps rule codes, numbers and short names, and drops everything else', () => {
  const c = cleanTrainerContext({
    ...RAW, secret: 'x', bodyweight: [80, 81],
    findings: [
      { ...FINDINGS[0], extra: 'nope', facts: { ...FINDINGS[0].facts, 'bad key!': 1, nested: { a: 1 }, list: [1], flag: true } },
      { code: 'Not-A-Code', kind: 'act', basis: 'evidence', facts: {} },
      { code: 'ok_code', kind: 'shout', basis: 'evidence', facts: {} },
      { code: 'ok_code', kind: 'act', basis: 'gospel', facts: {} },
      { ...FINDINGS[1], evidence: ['deload', 'made_up', 'deload'] }
    ]
  });
  assert.equal(c.findings.length, 2);
  assert.deepEqual(Object.keys(c.findings[0].facts).sort(), ['ceiling', 'floor', 'goal', 'muscle', 'planned', 'sets', 'weeks']);
  assert.deepEqual(c.findings[1].evidence, ['deload']);
  assert.equal('secret' in c, false);
  assert.equal('bodyweight' in c, false);
});

test('cleaning strips control characters and angle brackets from names and caps their length', () => {
  const c = cleanTrainerContext({ ...RAW, findings: [{ ...FINDINGS[0], facts: { muscle: '<b>Chest\n</b>' + 'x'.repeat(200) } }] });
  assert.ok(!/[<>\n]/.test(c.findings[0].facts.muscle));
  assert.ok(c.findings[0].facts.muscle.length <= 60);
});

test('cleaning rejects a context with no usable findings', () => {
  assert.equal(cleanTrainerContext(null), null);
  assert.equal(cleanTrainerContext({ findings: [] }), null);
  assert.equal(cleanTrainerContext({ findings: [{ code: 'x', kind: 'act', basis: 'evidence' }] }), null);
  assert.equal(cleanTrainerContext({ findings: [{ code: 'valid_code', kind: 'nope', basis: 'evidence' }] }), null);
});

test('a question is trimmed and capped', () => {
  const c = cleanTrainerContext({ ...RAW, question: '  how\n\nmany   sets? ' + 'z'.repeat(500) });
  assert.ok(c.question.startsWith('how many sets?'));
  assert.ok(c.question.length <= 300);
});

test('an adult with no flags gets the model', () => {
  const d = decideTrainer(RAW, STORED);
  assert.equal(d.mode, 'ai');
  assert.deepEqual(d.reasons, []);
});

test('the model is kept out for minors, unknown age, health mode and medical wording', () => {
  assert.deepEqual(decideTrainer(RAW, { coachProfile: { age: 16 } }).reasons, ['age']);
  assert.deepEqual(decideTrainer(RAW, { coachProfile: {} }).reasons, ['age']);
  assert.deepEqual(decideTrainer(RAW, undefined).reasons, ['age']);
  assert.deepEqual(decideTrainer(RAW, { coachProfile: { age: 40 }, health: { on: true } }).reasons, ['health']);
  assert.deepEqual(decideTrainer(RAW, { coachProfile: { age: 40, limits: 'recent surgery on my knee' } }).reasons, ['medical']);
  assert.deepEqual(decideTrainer(RAW, { coachProfile: { age: 40, limits: 'gravid' } }).reasons, ['medical']);
  assert.deepEqual(decideTrainer({ ...RAW, question: 'I have chest pain when I bench' }, STORED).reasons, ['medical']);
  assert.deepEqual(decideTrainer({ ...RAW, medical: true }, STORED).reasons, ['client']);
  assert.equal(decideTrainer({ ...RAW, medical: true }, STORED).mode, 'local');
});

test('a client cannot lower the bar the stored profile sets', () => {
  assert.equal(decideTrainer({ ...RAW, medical: false }, { coachProfile: { age: 15 } }).mode, 'local');
});

test('health mode switched off does not block', () => {
  assert.equal(decideTrainer(RAW, { coachProfile: { age: 40 }, health: { on: false } }).mode, 'ai');
});

test('an unusable context is invalid, not local', () => {
  assert.equal(decideTrainer({ findings: [] }, STORED).mode, 'invalid');
});

test('the schema only lets the model name codes and studies the findings contain', () => {
  const c = cleanTrainerContext(RAW);
  const s = trainerSchema(c);
  const item = s.properties.paragraphs.items.properties;
  assert.deepEqual(item.findings.items.enum, ['volume_low', 'fatigue']);
  assert.deepEqual(item.cites.items.enum, ['volume', 'deload', 'rir']);
  assert.equal(s.additionalProperties, false);
});

test('the payload carries the findings and nothing about the person beyond goal and experience', () => {
  const p = trainerPayload(cleanTrainerContext({ ...RAW, question: 'Why?' }));
  assert.deepEqual(Object.keys(p).sort(), ['experience', 'findings', 'goal', 'language', 'question']);
});

const c = cleanTrainerContext(RAW);
const good = {
  status: 'ok',
  headline: 'Ta det lugnare en vecka',
  paragraphs: [
    { text: 'Två lyft har gått bakåt, ungefär 3,4 procent i veckan, och du loggar hårdare set. Det talar för en lättare vecka.', findings: ['fatigue'], cites: ['deload'] },
    { text: 'Bröstet ligger på 9 set i veckan mot 10 som riktmärke.', findings: ['volume_low'], cites: ['volume'] }
  ]
};

test('an answer that sticks to the findings passes, with rounding and decimal commas', () => {
  assert.deepEqual(trainerProblems(good, c), []);
  assert.deepEqual(trainerProblems({ ...good, paragraphs: [{ text: 'About 8.9 sets, so roughly 9 a week.', findings: ['volume_low'], cites: [] }] }, c), []);
  assert.deepEqual(trainerProblems({ ...good, paragraphs: [{ text: 'Cut to 50% of your sets for 7 days at RIR 3.', findings: ['fatigue'], cites: ['deload'] }] }, c), []);
});

test('a number the findings do not contain is rejected', () => {
  const bad = { ...good, paragraphs: [{ text: 'Du borde ta 14 set i veckan.', findings: ['volume_low'], cites: [] }] };
  assert.deepEqual(trainerProblems(bad, c), ['number not in the findings: 14']);
});

test('a number in the headline is checked too', () => {
  assert.deepEqual(trainerProblems({ ...good, headline: 'Gör 30 set' }, c), ['number not in the findings: 30']);
});

test('a year, a percentage or a week count that was not supplied is rejected', () => {
  for (const text of ['Studien från 2017 visar det.', 'Det ger 13 % mer muskel.', 'Vänta i 31 veckor.']) {
    const p = trainerProblems({ ...good, paragraphs: [{ text, findings: ['volume_low'], cites: [] }] }, c);
    assert.ok(p.some(x => /not in the findings/.test(x)), text);
  }
});

test('a percentage must match a percentage fact, not just any number that happens to be there', () => {
  // 12 is in the findings, but as a count of planned sets
  const p = trainerProblems({ ...good, paragraphs: [{ text: 'Det ger 12 % mer muskel.', findings: ['volume_low'], cites: [] }] }, c);
  assert.deepEqual(p, ['percentage not in the findings: 12']);
  // 50 is deloadSetsPct, so it is a fair percentage
  assert.deepEqual(trainerProblems({ ...good, paragraphs: [{ text: 'Halvera: 50 procent av seten.', findings: ['fatigue'], cites: [] }] }, c), []);
});

test('a citation must belong to a finding the paragraph is about', () => {
  const bad = { ...good, paragraphs: [{ text: 'Bröstet är lågt.', findings: ['volume_low'], cites: ['deload'] }] };
  assert.deepEqual(trainerProblems(bad, c), ['citation not backed by the findings in this paragraph']);
});

test('an unknown finding code is rejected', () => {
  const bad = { ...good, paragraphs: [{ text: 'Hej.', findings: ['invented'], cites: [] }] };
  assert.ok(trainerProblems(bad, c).includes('unknown finding code'));
});

test('links and written references are rejected', () => {
  for (const text of ['Se https://example.com', 'doi.org/10.1', 'Schoenfeld et al. visade det', 'pubmed säger det']) {
    const p = trainerProblems({ ...good, paragraphs: [{ text, findings: ['volume_low'], cites: [] }] }, c);
    assert.ok(p.includes('contains a link or reference'), text);
  }
});

test('shape problems are reported rather than thrown', () => {
  assert.deepEqual(trainerProblems(null, c), ['not an object']);
  assert.deepEqual(trainerProblems({ status: 'maybe' }, c), ['bad status']);
  assert.ok(trainerProblems({ status: 'ok', headline: '', paragraphs: [] }, c).length > 0);
  assert.ok(trainerProblems({ ...good, paragraphs: [{ text: 'x'.repeat(600), findings: [], cites: [] }] }, c).includes('bad paragraph text'));
  assert.ok(trainerProblems({ ...good, paragraphs: Array(5).fill(good.paragraphs[0]) }, c).includes('bad paragraphs'));
});

test('outside_scope is accepted only when there was a question', () => {
  assert.deepEqual(trainerProblems({ status: 'outside_scope', headline: '', paragraphs: [] }, cleanTrainerContext({ ...RAW, question: 'Is creatine safe?' })), []);
  assert.deepEqual(trainerProblems({ status: 'outside_scope', headline: '', paragraphs: [] }, c), ['outside_scope without a question']);
});

test('numbers inside exercise names are allowed, since the name is part of the facts', () => {
  const ctx = cleanTrainerContext({ ...RAW, findings: [{ ...FINDINGS[0], facts: { ...FINDINGS[0].facts, muscle: 'Chest 5x5' } }] });
  assert.deepEqual(trainerProblems({ ...good, paragraphs: [{ text: 'Din 5x5-bänk.', findings: ['volume_low'], cites: [] }] }, ctx), []);
});

test('medicalFlag matches stems in English and Swedish', () => {
  assert.equal(medicalFlag('I am pregnant'), 'pregnan');
  assert.equal(medicalFlag('har högt blodtryck'), 'högt blodtryck');
  assert.equal(medicalFlag('sore shoulder'), null);
  assert.equal(medicalFlag(''), null);
});

test('the evidence ids the server accepts are the seven in the registry', () => {
  assert.equal(EVIDENCE_IDS.length, 7);
});

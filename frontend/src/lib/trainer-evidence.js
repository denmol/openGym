// The sources behind the AI trainer's advice.
//
// Every entry was looked up in PubMed (PMID and DOI below are from the record, not from
// memory) and `claim` says only what the paper's own abstract says. That is a deliberate
// limit: the trainer is allowed to cite a study for what the study found and for nothing
// more. Where the app turns a finding into a number of its own — a sets-per-week range, a
// "too fast" threshold — the rule says so with `basis`, and the sheet shows that label next
// to the citation, so a rule of thumb never passes for a result.
//
//   evidence   the rule restates a finding of the cited study
//   practice   the rule follows what coaches report doing; the cited work describes the
//              practice, it does not show the practice works
//   heuristic  the app's own threshold, informed by the cited work but not stated by it

export const BASIS = ['evidence', 'practice', 'heuristic']

export const EVIDENCE = {
  volume: {
    id: 'volume',
    cite: 'Schoenfeld, Ogborn & Krieger (2017)',
    title: 'Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis',
    journal: 'Journal of Sports Sciences 35(11):1073–1082',
    doi: '10.1080/02640414.2016.1210197', pmid: '27433992',
    claim: 'Across 15 studies, more weekly sets per muscle went with more muscle growth — a graded dose-response, about 0.37 percentage points of extra gain per added weekly set.',
    limit: 'The three-level comparison (<5, 5–9, 10+ sets) was only a trend, and the paper does not establish an upper limit.'
  },
  frequency: {
    id: 'frequency',
    cite: 'Schoenfeld, Ogborn & Krieger (2016)',
    title: 'Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis',
    journal: 'Sports Medicine 46(11):1689–1697',
    doi: '10.1007/s40279-016-0543-8', pmid: '27102172',
    claim: 'With volume matched, training a muscle twice a week gave better hypertrophy than once a week.',
    limit: 'Ten studies; whether three times a week beats twice is not settled.'
  },
  rir: {
    id: 'rir',
    cite: 'Helms, Cronin, Storey & Zourdos (2016)',
    title: 'Application of the repetitions in reserve-based rating of perceived exertion scale for resistance training',
    journal: 'Strength and Conditioning Journal 38(4):42–49',
    doi: '10.1519/SSC.0000000000000218', pmid: '27531969',
    claim: 'Rating each set by repetitions left in reserve lets load be adjusted to the lifter’s capability from set to set.',
    limit: 'A practitioner article describing how to use the scale, not a trial of outcomes.'
  },
  rirAccuracy: {
    id: 'rirAccuracy',
    cite: 'Zourdos et al. (2021)',
    title: 'Proximity to failure and total repetitions performed in a set influences accuracy of intraset repetitions in reserve-based rating of perceived exertion',
    journal: 'Journal of Strength and Conditioning Research 35(2S):S158–S165',
    doi: '10.1519/JSC.0000000000002995', pmid: '30747900',
    claim: 'Reps-in-reserve guesses were more accurate close to failure and in sets with fewer reps; far from failure they were off by several reps.',
    limit: '25 trained men, squat only.'
  },
  deload: {
    id: 'deload',
    cite: 'Rogerson et al. (2024)',
    title: 'Deloading practices in strength and physique sports: a cross-sectional survey',
    journal: 'Sports Medicine – Open 10:26',
    doi: '10.1186/s40798-024-00691-y', pmid: '38499934',
    claim: 'In a survey of 246 competitive lifters, deloads lasted about 6 days and came about every 5.6 weeks; volume and load went down, sessions per week stayed the same and effort was cut by leaving more reps in reserve. Lifters deloaded when performance stalled or soreness and joint aches rose.',
    limit: 'A survey of what athletes do. It does not show that deloading improves results.'
  },
  weightLoss: {
    id: 'weightLoss',
    cite: 'Garthe et al. (2011)',
    title: 'Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes',
    journal: 'International Journal of Sport Nutrition and Exercise Metabolism 21(2):97–104',
    doi: '10.1123/ijsnem.21.2.97', pmid: '21558571',
    claim: 'Among 24 athletes training with weights, losing 0.7% of body weight a week kept or added lean mass, while 1.4% a week did not.',
    limit: 'Small randomised trial in elite athletes over 5–9 weeks.'
  },
  who: {
    id: 'who',
    cite: 'Bull et al., WHO (2020)',
    title: 'World Health Organization 2020 guidelines on physical activity and sedentary behaviour',
    journal: 'British Journal of Sports Medicine 54(24):1451–1462',
    doi: '10.1136/bjsports-2020-102955', pmid: '33239350',
    claim: 'Recommends regular muscle-strengthening activity for all age groups, alongside 150–300 minutes of moderate aerobic activity a week for adults.',
    limit: 'A general health guideline, not a program.'
  },
  protein: {
    id: 'protein',
    cite: 'Morton et al. (2018)',
    title: 'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults',
    journal: 'British Journal of Sports Medicine 52(6):376–384',
    doi: '10.1136/bjsports-2017-097608', pmid: '28698222',
    claim: 'Across 49 trials with 1,863 participants, protein supplementation added to the strength and fat-free-mass gains from resistance training, and beyond a total protein intake of about 1.6 g/kg/day it added no further gain in fat-free mass.',
    limit: 'The trials tested protein supplements, not diets in general. 1.6 g/kg/day is where extra gain stopped in these trials, not a minimum requirement, and the effect of supplementation was smaller with increasing age.'
  },
  proteinCut: {
    id: 'proteinCut',
    cite: 'Helms, Aragon & Fitschen (2014)',
    title: 'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation',
    journal: 'Journal of the International Society of Sports Nutrition 11:20',
    doi: '10.1186/1550-2783-11-20', pmid: '24864135',
    claim: 'Reviewing the literature on contest preparation, the authors recommend an energy intake that gives about 0.5–1% bodyweight loss per week to maximise muscle retention, with most lifters doing best on 2.3–3.1 g of protein per kg of lean body mass per day.',
    limit: 'A narrative review aimed at natural bodybuilders preparing for competition, not a trial. The protein figure is per kg of lean mass, which this app does not measure.'
  },
  offseason: {
    id: 'offseason',
    cite: 'Iraki et al. (2019)',
    title: 'Nutrition recommendations for bodybuilders in the off-season: a narrative review',
    journal: 'Sports 7(7):154',
    doi: '10.3390/sports7070154', pmid: '31247944',
    claim: 'For natural bodybuilders in the off-season the authors recommend a modest energy surplus (about 10–20%) aiming for roughly 0.25–0.5% of bodyweight gained per week in novice and intermediate lifters, with 1.6–2.2 g/kg/day of protein.',
    limit: 'A narrative review about bodybuilders, not a trial. Advanced lifters are advised to gain more slowly.'
  },
  deloadDelphi: {
    id: 'deloadDelphi',
    cite: 'Bell et al. (2023)',
    title: 'Integrating deloading into strength and physique sports training programmes: an international Delphi consensus approach',
    journal: 'Sports Medicine – Open 9:87',
    doi: '10.1186/s40798-023-00633-0', pmid: '37730925',
    claim: 'Expert coaches (34 in the first round, 21 in the last) reached consensus on principles for deloading, defined as “a period of reduced training stress designed to mitigate physiological and psychological fatigue, promote recovery, and enhance preparedness for subsequent training.”',
    limit: 'Expert opinion. The authors note that how deloading should be built into a programme for the best results is not known.'
  }
}

export const EVIDENCE_IDS = Object.keys(EVIDENCE)

export const doiUrl = e => 'https://doi.org/' + e.doi
export const pubmedUrl = e => 'https://pubmed.ncbi.nlm.nih.gov/' + e.pmid + '/'

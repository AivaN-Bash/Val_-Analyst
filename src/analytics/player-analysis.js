/** Keep measured performance separate from survey-based tendencies. */
export const PLAYSTYLE_NAMES = {
  entry: 'Entry Fragger tendency',
  lurker: 'Lurker tendency',
  support: 'Support Playmaker tendency',
  anchor: 'Site Anchor tendency',
  clutch: 'Clutch Player tendency',
  controller: 'Controller Playmaker tendency',
  flex: 'Flexible Player tendency',
  initiator: 'Initiator Playmaker tendency',
  balanced: 'Mixed playstyle signals',
};

export const PLAYSTYLE_MIN_ALIGNMENT = 50;
export const PLAYSTYLE_MIN_LEAD = 15;
export const PLAYSTYLE_MIN_QUESTION_COVERAGE = 3;
export const ANALYSIS_MODEL_VERSION = '1.0.0';

const ROLE_KEYS = Object.keys(PLAYSTYLE_NAMES).filter((key) => key !== 'balanced');
const INPUT_KEYS = ['acs', 'adr', 'kd', 'kast', 'hs', 'win', 'kpr', 'kills', 'deaths', 'assists', 'firstBloods', 'matches', 'rounds', 'firstDeaths', 'tradeKills', 'clutchAttempts', 'clutchWins'];

export const DIMENSION_DEFINITIONS = [
  { key: 'mechanics', title: 'Mechanical skill', summary: 'Combat output and aim indicators.' },
  { key: 'opening', title: 'Duel & opening impact', summary: 'Opening involvement and duel outcomes.' },
  { key: 'survival', title: 'Survival & positioning', summary: 'Round survival and death exposure.' },
  { key: 'team', title: 'Team contribution', summary: 'Assists, trades, and shared impact.' },
  { key: 'clutch', title: 'Clutch & pressure', summary: 'Performance in disadvantaged situations.' },
  { key: 'consistency', title: 'Consistency', summary: 'Reliability from match to match.' },
  { key: 'adaptability', title: 'Adaptability', summary: 'Performance across roles, agents, maps, and sides.' },
];

function readNumber(value, key) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (['hs', 'kast', 'win'].includes(key) && parsed > 100) return null;
  return parsed;
}

function metric({ name, dimension, value, unit = '', formula, sourceFields, direction = 'Context dependent', sampleSize, comparisonGroup }) {
  const available = value !== null && value !== undefined;
  return {
    modelVersion: ANALYSIS_MODEL_VERSION,
    name,
    dimension,
    value: available ? value : null,
    unit,
    formula,
    sourceFields,
    direction,
    comparisonGroup: comparisonGroup || 'Same rank, role, agent, and mode; comparison cohort not connected',
    sampleSize,
    percentile: null,
    confidence: available ? 'Descriptive only; peer cohort unavailable' : 'Unavailable',
    availabilityStatus: available ? 'available' : 'unavailable',
  };
}

function formatMetricValue(item) {
  if (item.availabilityStatus === 'unavailable') return 'Not available';
  if (Array.isArray(item.value)) return item.value.map(([label, value]) => `${label}: ${value}%`).join(' · ');
  if (typeof item.value === 'object') return `${Object.keys(item.value).length} agent records`;
  return `${item.value}${item.unit}`;
}

/** Build transparent measurements and separate, normalized survey tendencies. */
export function analyzePlayer(stats, answers, questions) {
  const get = (key) => readNumber(stats[key], key);
  const rounds = get('rounds');
  const firstBloods = get('firstBloods');
  const firstDeaths = get('firstDeaths');
  const matches = get('matches');
  const sampleSize = matches;
  const dataWarnings = INPUT_KEYS
    .filter((key) => stats[key] !== '' && stats[key] !== null && stats[key] !== undefined && get(key) === null)
    .map((key) => `${key} is outside its valid numeric range and was excluded.`);
  const clutchAttempts = get('clutchAttempts');
  const clutchWins = get('clutchWins');
  if (clutchAttempts !== null && clutchWins !== null && clutchWins > clutchAttempts) dataWarnings.push('Clutch wins cannot exceed clutch attempts; clutch conversion was withheld.');
  if (rounds !== null && firstBloods !== null && firstBloods > rounds) dataWarnings.push('First bloods exceed rounds played; check that these values cover the same matches.');
  if (rounds !== null && firstDeaths !== null && firstDeaths > rounds) dataWarnings.push('First deaths exceed rounds played; check that these values cover the same matches.');

  const values = {
    acs: get('acs'), adr: get('adr'), kd: get('kd'), hs: get('hs'), kast: get('kast'), kpr: get('kpr'), win: get('win'),
    firstBloods,
    firstDeaths,
    openingDifferential: firstBloods !== null && firstDeaths !== null ? firstBloods - firstDeaths : null,
    openingDifferentialPerRound: firstBloods !== null && firstDeaths !== null && rounds > 0
      ? ((firstBloods - firstDeaths) / rounds) * 100 : null,
    openingWinRate: firstBloods !== null && firstDeaths !== null && firstBloods + firstDeaths > 0
      ? (firstBloods / (firstBloods + firstDeaths)) * 100 : null,
    firstBloodRate: firstBloods !== null && rounds > 0 ? (firstBloods / rounds) * 100 : null,
    firstDeathRate: firstDeaths !== null && rounds > 0 ? (firstDeaths / rounds) * 100 : null,
    kast: get('kast'),
    deathsPerRound: get('deaths') !== null && rounds > 0 ? get('deaths') / rounds : null,
    assistsPerRound: get('assists') !== null && rounds > 0 ? get('assists') / rounds : null,
    tradeKillsPerRound: get('tradeKills') !== null && rounds > 0 ? get('tradeKills') / rounds : null,
    clutchAttempts,
    clutchConversion: clutchAttempts > 0 && clutchWins !== null && clutchWins <= clutchAttempts
      ? (clutchWins / clutchAttempts) * 100 : null,
  };

  const metricList = [
    metric({ name: 'ACS', dimension: 'mechanics', value: values.acs, formula: 'Provided aggregate; original match formula not supplied', sourceFields: ['acs'], sampleSize }),
    metric({ name: 'Damage per round', dimension: 'mechanics', value: values.adr, formula: 'Provided aggregate; total damage and rounds not retained', sourceFields: ['adr'], unit: ' ADR', direction: 'Higher is more damage; quality depends on context', sampleSize }),
    metric({ name: 'Headshot rate', dimension: 'mechanics', value: values.hs, formula: 'Provided aggregate', sourceFields: ['hs'], unit: '%', direction: 'Context dependent', sampleSize }),
    metric({ name: 'K/D', dimension: 'mechanics', value: values.kd, formula: 'Provided aggregate', sourceFields: ['kd'], direction: 'Context dependent', sampleSize }),
    metric({ name: 'Kills per round', dimension: 'mechanics', value: values.kpr, formula: 'Provided aggregate', sourceFields: ['kpr'], direction: 'Context dependent', sampleSize }),
    metric({ name: 'First bloods', dimension: 'opening', value: values.firstBloods, formula: 'Provided count', sourceFields: ['firstBloods'], direction: 'Context dependent', sampleSize }),
    metric({ name: 'First bloods per round', dimension: 'opening', value: values.firstBloodRate, formula: 'First bloods / rounds played * 100', sourceFields: ['firstBloods', 'rounds'], unit: '%', direction: 'Context dependent; compare by role and rank', sampleSize }),
    metric({ name: 'First deaths', dimension: 'opening', value: values.firstDeaths, formula: 'Provided count', sourceFields: ['firstDeaths'], direction: 'Lower can be favorable; role and engagement context matter', sampleSize }),
    metric({ name: 'First deaths per round', dimension: 'opening', value: values.firstDeathRate, formula: 'First deaths / rounds played * 100', sourceFields: ['firstDeaths', 'rounds'], unit: '%', direction: 'Lower can be favorable; role and engagement context matter', sampleSize }),
    metric({ name: 'Opening differential', dimension: 'opening', value: values.openingDifferential, formula: 'First bloods - first deaths', sourceFields: ['firstBloods', 'firstDeaths'], direction: 'Higher is favorable', sampleSize }),
    metric({ name: 'Opening differential per round', dimension: 'opening', value: values.openingDifferentialPerRound, formula: '(First bloods - first deaths) / rounds played * 100', sourceFields: ['firstBloods', 'firstDeaths', 'rounds'], unit: '%', direction: 'Higher is favorable', sampleSize }),
    metric({ name: 'Opening duel win rate', dimension: 'opening', value: values.openingWinRate, formula: 'First bloods / (first bloods + first deaths) * 100', sourceFields: ['firstBloods', 'firstDeaths'], unit: '%', direction: 'Higher is favorable', sampleSize }),
    metric({ name: 'KAST', dimension: 'survival', value: values.kast, formula: 'Provided aggregate', sourceFields: ['kast'], unit: '%', direction: 'Higher indicates more rounds with a kill, assist, survival, or trade', sampleSize }),
    metric({ name: 'Rounds played', dimension: 'survival', value: rounds, formula: 'Provided count', sourceFields: ['rounds'], direction: 'Denominator for per-round metrics', sampleSize }),
    metric({ name: 'Deaths', dimension: 'survival', value: get('deaths'), formula: 'Provided count', sourceFields: ['deaths'], direction: 'Context dependent; role and round count matter', sampleSize }),
    metric({ name: 'Deaths per round', dimension: 'survival', value: values.deathsPerRound, formula: 'Deaths / rounds played', sourceFields: ['deaths', 'rounds'], direction: 'Lower is generally favorable; role matters', sampleSize }),
    metric({ name: 'Assists per round', dimension: 'team', value: values.assistsPerRound, formula: 'Assists / rounds played', sourceFields: ['assists', 'rounds'], direction: 'Higher can indicate contribution; utility and role context matter', sampleSize }),
    metric({ name: 'Assists', dimension: 'team', value: get('assists'), formula: 'Provided count', sourceFields: ['assists'], direction: 'Context dependent', sampleSize }),
    metric({ name: 'Match win rate', dimension: 'team', value: values.win, formula: 'Provided aggregate', sourceFields: ['win'], unit: '%', direction: 'Team outcome; not individual contribution by itself', sampleSize }),
    metric({ name: 'Trade kills per round', dimension: 'team', value: values.tradeKillsPerRound, formula: 'Trade kills / rounds played', sourceFields: ['tradeKills', 'rounds'], direction: 'Higher is favorable when trade opportunities are comparable', sampleSize }),
    metric({ name: 'Clutch attempts', dimension: 'clutch', value: values.clutchAttempts, formula: 'Provided count', sourceFields: ['clutchAttempts'], direction: 'Context only; attempts are the denominator', sampleSize }),
    metric({ name: 'Clutch conversion', dimension: 'clutch', value: values.clutchConversion, formula: 'Clutch wins / clutch attempts * 100', sourceFields: ['clutchWins', 'clutchAttempts'], unit: '%', direction: 'Higher is favorable; report with attempts', sampleSize }),
    metric({ name: 'Match-to-match variation', dimension: 'consistency', value: null, formula: 'Requires per-match metric values (for example, ADR standard deviation)', sourceFields: ['perMatchStats'], direction: 'Lower variation can indicate consistency', sampleSize }),
    metric({ name: 'Agent results', dimension: 'adaptability', value: Array.isArray(stats.agents) && stats.agents.length ? stats.agents.map((agent) => [agent.name, agent.wr]) : null, formula: 'Win rate by agent; retain match count for each agent', sourceFields: ['agents'], direction: 'Compare only with adequate sample and role context', sampleSize }),
    metric({ name: 'Role results', dimension: 'adaptability', value: stats.roles && Object.keys(stats.roles).length ? Object.entries(stats.roles).map(([role, result]) => [role, result.wr]) : null, formula: 'Win rate by role; retain match count for each role', sourceFields: ['roles'], direction: 'Compare only with adequate sample and team context', sampleSize }),
    metric({ name: 'Map and side results', dimension: 'adaptability', value: null, formula: 'Requires match-level map and side data', sourceFields: ['map', 'side'], direction: 'Context dependent', sampleSize }),
  ];

  const dimensions = DIMENSION_DEFINITIONS.map((definition) => {
    const items = metricList.filter((item) => item.dimension === definition.key);
    const availableCount = items.filter((item) => item.availabilityStatus === 'available').length;
    return {
      ...definition,
      status: availableCount === 0 ? 'unavailable' : availableCount === items.length ? 'observed' : 'partial',
      metrics: items.map((item) => ({ ...item, displayValue: formatMetricValue(item) })),
    };
  });

  const rawScores = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
  const possibleScores = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
  const answerBreakdown = Object.fromEntries(ROLE_KEYS.map((key) => [key, []]));
  const signals = {};
  Object.values(answers).forEach((answer) => Object.entries(answer).forEach(([key, value]) => {
    if (typeof value !== 'number') signals[key] = value;
    else if (!(key in rawScores)) signals[key] = (signals[key] || 0) + value;
  }));
  questions.forEach(([question, options], index) => {
    const selected = answers[index] || {};
    const selectedLabel = options.find(([, points]) => JSON.stringify(points) === JSON.stringify(selected))?.[0] || 'Answer selection unavailable';
    ROLE_KEYS.forEach((key) => {
      const optionScores = options.map(([, points]) => points[key] || 0);
      const minimum = Math.min(...optionScores);
      const maximum = Math.max(...optionScores);
      const opportunity = maximum - minimum;
      if (opportunity <= 0) return;
      possibleScores[key] += opportunity;
      answerBreakdown[key].push({
        question,
        answer: selectedLabel,
        contribution: 0,
        opportunity,
        alignment: 0,
      });
      const chosen = selected[key] || 0;
      const contribution = Math.max(0, Math.min(opportunity, chosen - minimum));
      rawScores[key] += contribution;
      const evidence = answerBreakdown[key][answerBreakdown[key].length - 1];
      evidence.contribution = contribution;
      evidence.alignment = Math.round((contribution / opportunity) * 100);
    });
  });
  const coverage = Object.fromEntries(ROLE_KEYS.map((key) => [key, answerBreakdown[key].length]));
  const rawAlignment = Object.fromEntries(ROLE_KEYS.map((key) => [key, possibleScores[key] ? Math.round((rawScores[key] / possibleScores[key]) * 100) : 0]));
  const eligible = ROLE_KEYS.filter((key) => coverage[key] >= PLAYSTYLE_MIN_QUESTION_COVERAGE).sort((a, b) => rawAlignment[b] - rawAlignment[a]);
  const ranked = ROLE_KEYS.slice().sort((a, b) => rawAlignment[b] - rawAlignment[a]);
  const sc = Object.fromEntries(ROLE_KEYS.map((key) => [key, coverage[key] >= PLAYSTYLE_MIN_QUESTION_COVERAGE ? rawAlignment[key] : null]));
  const candidateKey = eligible[0] || ranked[0];
  const runnerUpKey = eligible[1] || ranked.find((key) => key !== candidateKey);
  const candidateAlignment = rawAlignment[candidateKey];
  const runnerUpAlignment = runnerUpKey ? rawAlignment[runnerUpKey] : 0;
  const clearLead = eligible.length > 0 && candidateAlignment >= PLAYSTYLE_MIN_ALIGNMENT && candidateAlignment - runnerUpAlignment >= PLAYSTYLE_MIN_LEAD;
  const top = clearLead ? candidateKey : 'balanced';
  const decisionRationale = {
    clearLead,
    candidate: { key: candidateKey, name: PLAYSTYLE_NAMES[candidateKey], alignment: candidateAlignment, coverage: coverage[candidateKey], eligible: coverage[candidateKey] >= PLAYSTYLE_MIN_QUESTION_COVERAGE },
    runnerUp: runnerUpKey ? { key: runnerUpKey, name: PLAYSTYLE_NAMES[runnerUpKey], alignment: rawAlignment[runnerUpKey], coverage: coverage[runnerUpKey], eligible: coverage[runnerUpKey] >= PLAYSTYLE_MIN_QUESTION_COVERAGE } : null,
    coverage,
    minimumQuestionCoverage: PLAYSTYLE_MIN_QUESTION_COVERAGE,
    minimumAlignment: PLAYSTYLE_MIN_ALIGNMENT,
    minimumLead: PLAYSTYLE_MIN_LEAD,
    evidence: answerBreakdown[candidateKey],
  };

  const findings = [];
  const add = (type, text, source = 'answers') => findings.push({
    type,
    text,
    source,
    t: type,
    x: text,
    src: source,
    confidence: source === 'answers' ? 'Self-reported; not verified by match data' : 'Descriptive; no peer cohort',
    sampleSize,
  });
  add('info', `Entered stats: ACS ${get('acs') ?? 'not provided'}, ADR ${get('adr') ?? 'not provided'}, K/D ${get('kd') ?? 'not provided'}, and KAST ${get('kast') ?? 'not provided'}%. These are descriptive until compared with a relevant rank, role, and agent cohort.`, 'stats');
  if (values.openingDifferential !== null) add('info', `Opening differential is ${values.openingDifferential} (${firstBloods} first bloods - ${firstDeaths} first deaths). This is an observed count, not a peer percentile.`, 'stats');
  if (values.clutchConversion !== null) add('info', `Clutch conversion is ${values.clutchConversion.toFixed(1)}% across ${values.clutchAttempts} attempts. Keep the attempt count beside the rate.`, 'stats');
  if (signals.eco < 0) add('con', 'In the economy scenario, you chose a force or independent buy. Compare that choice with your team plan and the round win condition.');
  if (signals.eco >= 3) add('pro', 'Your answers indicate planned purchases and coordination with teammates.');
  if (signals.trade >= 2) add('pro', 'Your answers favor immediate trades. Review trade conversion in match data to see how often those trades succeed.');
  if (signals.trade < 0) add('con', 'Your answer suggests trade timing may be an opportunity to review in replays.');
  if (signals.surv < 0) add('con', 'In the low-odds scenario, you chose to push for a pick. Review whether that gains value or risks a saveable weapon.');
  if (signals.util < 0) add('con', 'You reported sometimes dying with utility unused. Try using it before contact, then check whether it creates space or information.');
  if (signals.tilt < 0) add('con', 'You said you would keep queueing after two losses. Track whether a short reset improves focus and round decisions.');
  if (signals.tilt >= 2) add('pro', 'Your answers suggest you pause or change approach after a losing streak.');
  if (signals.read >= 2) add('pro', 'Your answers favor gathering map information and timing rotations or utility around it.');
  if (sc.controller >= 50 && signals.timing >= 1) add('pro', 'Your answers point to a Controller playmaker tendency: enabling teammates with well-timed utility rather than measuring value only by opening kills.');
  if (signals.comp >= 1) add('pro', 'You adapt your role choice to what the team composition needs. A second Duelist can be a map and strategy choice; it is not a universal upgrade.');
  if (signals.map >= 2) add('pro', 'Your map plan prioritizes controlling gaps with the right role and utility. The best approach depends on the map and team composition.');
  if (signals.adapt >= 2) add('pro', 'You look for ways to draw or avoid enemy utility before committing. Review rounds to see whether the adjustment created space for your team.');
  if (signals.info >= 2) add('pro', 'Your default prioritizes learning what space the defense gives up and keeping that space available for a later decision.');
  if (signals.fake >= 2) add('pro', 'You use controlled pressure to test rotations or draw utility before choosing where to execute. Check whether the team safely retained the first area.');
  if (signals.resource >= 2) add('pro', 'Your answers emphasize getting value from enemy utility before committing your own resources. Against escape abilities, track the tool and likely exit; avoid a fixed wait rule for every round.');
  if (sc.initiator >= 50 && signals.call >= 2) add('pro', 'Your answers fit an Initiator playmaker tendency: gathering information and setting up calls while staying connected to the action.');
  if (signals.counter >= 2) add('pro', 'Prior experience on aggressive roles may help anticipate Duelist timings. Treat that read as a hypothesis and validate it against round outcomes.');
  if (top === 'balanced') add('info', 'Your answers do not show one clearly leading playstyle tendency. The result stays mixed instead of forcing a single label.');

  const recommendations = [];
  if (values.openingDifferential === null) recommendations.push('Record first deaths alongside first bloods; together they allow opening differential and duel conversion calculations.');
  if (values.clutchConversion === null && !dataWarnings.some((warning) => warning.startsWith('Clutch wins'))) recommendations.push('Log clutch wins and attempts together. A win count without attempts cannot show clutch success rate.');
  if (!rounds) recommendations.push('Add rounds played to calculate per-round death, assist, and trade rates.');
  recommendations.push('For a default review, note space gained, opponent utility drawn, space retained, and the information that triggered the site call.');
  if (!matches) recommendations.push('Add the number of matches in this sample; keep per-match records to measure consistency and confidence.');
  if (!stats.rank) recommendations.push('Add rank and role context before comparing performance with other players.');
  if (!stats.roles || !Object.keys(stats.roles).length || !Array.isArray(stats.agents) || !stats.agents.length) recommendations.push('Record results by agent, role, map, and side to evaluate adaptability without mixing different contexts.');
  recommendations.push('Keep a per-match record of core stats; aggregate totals cannot show match-to-match consistency or identify outlier games.');

  return {
    analysisModelVersion: ANALYSIS_MODEL_VERSION,
    sc,
    top,
    name: PLAYSTYLE_NAMES[top],
    decisionRationale,
    dimensions,
    metrics: metricList,
    dataWarnings,
    findings,
    I: findings,
    recommendations,
    side: signals.side,
  };
}

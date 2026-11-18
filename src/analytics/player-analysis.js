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
export const PLAYSTYLE_MIN_MATCHING_ANSWERS = 2;
export const FLEX_MIN_MATCHING_ANSWERS = 4;
export const ANALYSIS_MODEL_VERSION = '1.2.0';

const ROLE_KEYS = Object.keys(PLAYSTYLE_NAMES).filter((key) => key !== 'balanced');
const INPUT_KEYS = [
  'acs',
  'adr',
  'totalDamage',
  'kd',
  'kast',
  'hs',
  'win',
  'kpr',
  'kills',
  'deaths',
  'assists',
  'firstBloods',
  'matches',
  'rounds',
  'roundsSurvived',
  'firstDeaths',
  'tradeKills',
  'clutchAttempts',
  'clutchWins',
];

export const DIMENSION_DEFINITIONS = [
  { key: 'mechanics', title: 'Mechanical skill', summary: 'Combat output and aim indicators.' },
  {
    key: 'opening',
    title: 'Duel & opening impact',
    summary: 'Opening involvement and duel outcomes.',
  },
  {
    key: 'survival',
    title: 'Survival & positioning',
    summary: 'Round survival and death exposure.',
  },
  { key: 'team', title: 'Team contribution', summary: 'Assists, trades, and shared impact.' },
  {
    key: 'clutch',
    title: 'Clutch & pressure',
    summary: 'Performance in disadvantaged situations.',
  },
  { key: 'consistency', title: 'Consistency', summary: 'Reliability from match to match.' },
  {
    key: 'adaptability',
    title: 'Adaptability',
    summary: 'Performance across roles, agents, maps, and sides.',
  },
];

function readNumber(value, key) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (['hs', 'kast', 'win'].includes(key) && parsed > 100) return null;
  return parsed;
}

function metric({
  name,
  dimension,
  value,
  unit = '',
  formula,
  sourceFields,
  direction = 'Context dependent',
  sampleSize,
  comparisonGroup,
  confidenceInterval,
}) {
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
    comparisonGroup:
      comparisonGroup || 'Same rank, role, agent, and mode; comparison cohort not connected',
    sampleSize,
    percentile: null,
    confidence: available
      ? `${confidenceInterval ? '95% Wilson interval reported; ' : ''}Descriptive only; peer cohort unavailable`
      : 'Unavailable',
    confidenceInterval: confidenceInterval || null,
    availabilityStatus: available ? 'available' : 'unavailable',
  };
}

function wilsonInterval(successes, attempts) {
  if (
    !Number.isFinite(successes) ||
    !Number.isFinite(attempts) ||
    attempts <= 0 ||
    successes < 0 ||
    successes > attempts
  )
    return null;
  const z = 1.96;
  const p = successes / attempts;
  const denominator = 1 + (z * z) / attempts;
  const center = (p + (z * z) / (2 * attempts)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * attempts)) / attempts)) / denominator;
  return {
    level: 95,
    attempts,
    lower: Math.max(0, (center - margin) * 100),
    upper: Math.min(100, (center + margin) * 100),
    method: 'Wilson score',
  };
}

function formatMetricValue(item) {
  if (item.availabilityStatus === 'unavailable') return 'Not available';
  if (Array.isArray(item.value))
    return item.value
      .map((entry) =>
        Array.isArray(entry)
          ? `${entry[0]}: ${entry[1]}%`
          : `${entry.name}: ${entry.wr}%${entry.m !== null ? ` (${entry.m} matches)` : ''}`,
      )
      .join(' · ');
  if (typeof item.value === 'object') return `${Object.keys(item.value).length} agent records`;
  return `${item.value}${item.unit}`;
}

/** Build transparent measurements and separate, normalized survey tendencies. */
export function analyzePlayer(stats, answers, questions) {
  const get = (key) => readNumber(stats[key], key);
  const rounds = get('rounds');
  const firstBloods = get('firstBloods');
  const firstDeaths = get('firstDeaths');
  const kills = get('kills');
  const deaths = get('deaths');
  const totalDamage = get('totalDamage');
  const roundsSurvived = get('roundsSurvived');
  const matches = get('matches');
  const sampleSize = matches;
  const dataWarnings = INPUT_KEYS.filter(
    (key) =>
      stats[key] !== '' && stats[key] !== null && stats[key] !== undefined && get(key) === null,
  ).map((key) => `${key} is outside its valid numeric range and was excluded.`);
  const clutchAttempts = get('clutchAttempts');
  const clutchWins = get('clutchWins');
  const agentRecords = (Array.isArray(stats.agents) ? stats.agents : []).filter(
    (agent) =>
      agent.name?.trim() &&
      ['m', 'wr', 'kd', 'adr', 'acs'].every(
        (key) => agent[key] !== '' && Number.isFinite(Number(agent[key])),
      ),
  );
  const roleRecords = Object.entries(stats.roles || {}).filter(
    ([, result]) =>
      result &&
      result.wr !== '' &&
      result.kda !== '' &&
      Number.isFinite(Number(result.wr)) &&
      Number.isFinite(Number(result.kda)),
  );
  if (clutchAttempts !== null && clutchWins !== null && clutchWins > clutchAttempts)
    dataWarnings.push('Clutch wins cannot exceed clutch attempts; clutch conversion was withheld.');
  if (rounds !== null && firstBloods !== null && firstBloods > rounds)
    dataWarnings.push(
      'First bloods exceed rounds played; check that these values cover the same matches.',
    );
  if (rounds !== null && firstDeaths !== null && firstDeaths > rounds)
    dataWarnings.push(
      'First deaths exceed rounds played; check that these values cover the same matches.',
    );
  if (
    rounds !== null &&
    firstBloods !== null &&
    firstDeaths !== null &&
    firstBloods + firstDeaths > rounds
  )
    dataWarnings.push(
      'First bloods plus first deaths exceed rounds played; opening duel rates were withheld.',
    );
  if (rounds !== null && roundsSurvived !== null && roundsSurvived > rounds)
    dataWarnings.push('Rounds survived exceed rounds played; survival rate was withheld.');

  const values = {
    acs: get('acs'),
    adr: totalDamage !== null && rounds > 0 ? totalDamage / rounds : get('adr'),
    kd: kills !== null && deaths > 0 ? kills / deaths : get('kd'),
    hs: get('hs'),
    kast: get('kast'),
    kpr: kills !== null && rounds > 0 ? kills / rounds : get('kpr'),
    win: get('win'),
    firstBloods,
    firstDeaths,
    openingDifferential:
      firstBloods !== null && firstDeaths !== null ? firstBloods - firstDeaths : null,
    openingDifferentialPerRound:
      firstBloods !== null &&
      firstDeaths !== null &&
      rounds > 0 &&
      firstBloods + firstDeaths <= rounds
        ? (firstBloods - firstDeaths) / rounds
        : null,
    openingWinRate:
      firstBloods !== null &&
      firstDeaths !== null &&
      firstBloods + firstDeaths > 0 &&
      (rounds === null || firstBloods + firstDeaths <= rounds)
        ? (firstBloods / (firstBloods + firstDeaths)) * 100
        : null,
    firstBloodRate:
      firstBloods !== null && rounds > 0 && firstBloods <= rounds ? firstBloods / rounds : null,
    firstDeathRate:
      firstDeaths !== null && rounds > 0 && firstDeaths <= rounds ? firstDeaths / rounds : null,
    survivalRate:
      rounds !== null && rounds > 0 && roundsSurvived !== null && roundsSurvived <= rounds
        ? (roundsSurvived / rounds) * 100
        : null,
    deathsPerRound: get('deaths') !== null && rounds > 0 ? get('deaths') / rounds : null,
    assistsPerRound: get('assists') !== null && rounds > 0 ? get('assists') / rounds : null,
    tradeKillsPerRound:
      get('tradeKills') !== null && rounds > 0 ? get('tradeKills') / rounds : null,
    clutchAttempts,
    clutchConversion:
      clutchAttempts > 0 && clutchWins !== null && clutchWins <= clutchAttempts
        ? (clutchWins / clutchAttempts) * 100
        : null,
  };

  const metricList = [
    metric({
      name: 'ACS',
      dimension: 'mechanics',
      value: values.acs,
      formula: 'Provided aggregate; original match formula not supplied',
      sourceFields: ['acs'],
      sampleSize,
    }),
    metric({
      name: 'Damage per round',
      dimension: 'mechanics',
      value: values.adr,
      formula:
        totalDamage !== null && rounds > 0
          ? 'Total damage / rounds played'
          : 'Provided aggregate; total damage or rounds unavailable for recalculation',
      sourceFields: totalDamage !== null && rounds > 0 ? ['totalDamage', 'rounds'] : ['adr'],
      unit: ' ADR',
      direction: 'Higher is more damage; quality depends on context',
      sampleSize,
    }),
    metric({
      name: 'Headshot rate',
      dimension: 'mechanics',
      value: values.hs,
      formula: 'Provided aggregate',
      sourceFields: ['hs'],
      unit: '%',
      direction: 'Context dependent',
      sampleSize,
    }),
    metric({
      name: 'K/D',
      dimension: 'mechanics',
      value: values.kd,
      formula:
        kills !== null && deaths > 0
          ? 'Total kills / total deaths'
          : 'Provided aggregate; kills or deaths unavailable for recalculation',
      sourceFields: kills !== null && deaths > 0 ? ['kills', 'deaths'] : ['kd'],
      direction: 'Context dependent',
      sampleSize,
    }),
    metric({
      name: 'Kills per round',
      dimension: 'mechanics',
      value: values.kpr,
      formula:
        kills !== null && rounds > 0
          ? 'Total kills / total rounds'
          : 'Provided aggregate; kills or rounds unavailable for recalculation',
      sourceFields: kills !== null && rounds > 0 ? ['kills', 'rounds'] : ['kpr'],
      unit: ' /round',
      direction: 'Context dependent',
      sampleSize,
    }),
    metric({
      name: 'First bloods',
      dimension: 'opening',
      value: values.firstBloods,
      formula: 'Provided count',
      sourceFields: ['firstBloods'],
      direction: 'Context dependent',
      sampleSize,
    }),
    metric({
      name: 'First bloods per round',
      dimension: 'opening',
      value: values.firstBloodRate,
      formula: 'Total first bloods / total rounds',
      sourceFields: ['firstBloods', 'rounds'],
      unit: ' /round',
      direction: 'Context dependent; compare by role and rank',
      sampleSize,
    }),
    metric({
      name: 'First deaths',
      dimension: 'opening',
      value: values.firstDeaths,
      formula: 'Provided count',
      sourceFields: ['firstDeaths'],
      direction: 'Lower can be favorable; role and engagement context matter',
      sampleSize,
    }),
    metric({
      name: 'First deaths per round',
      dimension: 'opening',
      value: values.firstDeathRate,
      formula: 'Total first deaths / total rounds',
      sourceFields: ['firstDeaths', 'rounds'],
      unit: ' /round',
      direction: 'Lower can be favorable; role and engagement context matter',
      sampleSize,
    }),
    metric({
      name: 'Opening differential',
      dimension: 'opening',
      value: values.openingDifferential,
      formula: 'First bloods - first deaths',
      sourceFields: ['firstBloods', 'firstDeaths'],
      direction: 'Higher is favorable',
      sampleSize,
    }),
    metric({
      name: 'Opening differential per round',
      dimension: 'opening',
      value: values.openingDifferentialPerRound,
      formula: '(Total first bloods - total first deaths) / total rounds',
      sourceFields: ['firstBloods', 'firstDeaths', 'rounds'],
      unit: ' /round',
      direction: 'Higher is favorable',
      sampleSize,
    }),
    metric({
      name: 'Opening duel win rate',
      dimension: 'opening',
      value: values.openingWinRate,
      formula: 'First bloods / (first bloods + first deaths) * 100',
      sourceFields: ['firstBloods', 'firstDeaths'],
      unit: '%',
      direction: 'Higher is favorable',
      sampleSize,
      confidenceInterval:
        firstBloods !== null && firstDeaths !== null
          ? wilsonInterval(firstBloods, firstBloods + firstDeaths)
          : null,
    }),
    metric({
      name: 'KAST',
      dimension: 'survival',
      value: values.kast,
      formula: 'Provided aggregate',
      sourceFields: ['kast'],
      unit: '%',
      direction: 'Higher indicates more rounds with a kill, assist, survival, or trade',
      sampleSize,
    }),
    metric({
      name: 'Survival rate',
      dimension: 'survival',
      value: values.survivalRate,
      formula: 'Rounds survived / total rounds * 100',
      sourceFields: ['roundsSurvived', 'rounds'],
      unit: '%',
      direction: 'Higher indicates surviving more rounds; role and round context matter',
      sampleSize,
      confidenceInterval: wilsonInterval(roundsSurvived, rounds),
    }),
    metric({
      name: 'Rounds played',
      dimension: 'survival',
      value: rounds,
      formula: 'Provided count',
      sourceFields: ['rounds'],
      direction: 'Denominator for per-round metrics',
      sampleSize,
    }),
    metric({
      name: 'Deaths',
      dimension: 'survival',
      value: get('deaths'),
      formula: 'Provided count',
      sourceFields: ['deaths'],
      direction: 'Context dependent; role and round count matter',
      sampleSize,
    }),
    metric({
      name: 'Deaths per round',
      dimension: 'survival',
      value: values.deathsPerRound,
      formula: 'Deaths / rounds played',
      sourceFields: ['deaths', 'rounds'],
      direction: 'Lower is generally favorable; role matters',
      sampleSize,
    }),
    metric({
      name: 'Assists per round',
      dimension: 'team',
      value: values.assistsPerRound,
      formula: 'Assists / rounds played',
      sourceFields: ['assists', 'rounds'],
      direction: 'Higher can indicate contribution; utility and role context matter',
      sampleSize,
    }),
    metric({
      name: 'Assists',
      dimension: 'team',
      value: get('assists'),
      formula: 'Provided count',
      sourceFields: ['assists'],
      direction: 'Context dependent',
      sampleSize,
    }),
    metric({
      name: 'Match win rate',
      dimension: 'team',
      value: values.win,
      formula: 'Provided aggregate',
      sourceFields: ['win'],
      unit: '%',
      direction: 'Team outcome; not individual contribution by itself',
      sampleSize,
    }),
    metric({
      name: 'Trade kills per round',
      dimension: 'team',
      value: values.tradeKillsPerRound,
      formula: 'Trade kills / rounds played',
      sourceFields: ['tradeKills', 'rounds'],
      direction: 'Higher is favorable when trade opportunities are comparable',
      sampleSize,
    }),
    metric({
      name: 'Clutch attempts',
      dimension: 'clutch',
      value: values.clutchAttempts,
      formula: 'Provided count',
      sourceFields: ['clutchAttempts'],
      direction: 'Context only; attempts are the denominator',
      sampleSize,
    }),
    metric({
      name: 'Clutch conversion',
      dimension: 'clutch',
      value: values.clutchConversion,
      formula: 'Clutch wins / clutch attempts * 100',
      sourceFields: ['clutchWins', 'clutchAttempts'],
      unit: '%',
      direction: 'Higher is favorable; report with attempts',
      sampleSize,
      confidenceInterval: wilsonInterval(clutchWins, clutchAttempts),
    }),
    metric({
      name: 'Match-to-match variation',
      dimension: 'consistency',
      value: null,
      formula: 'Requires per-match metric values (for example, ADR standard deviation)',
      sourceFields: ['perMatchStats'],
      direction: 'Lower variation can indicate consistency',
      sampleSize,
    }),
    metric({
      name: 'Agent results',
      dimension: 'adaptability',
      value: agentRecords.length
        ? agentRecords.map((agent) => ({
            name: agent.name,
            m: Number(agent.m),
            wr: Number(agent.wr),
            kd: Number(agent.kd),
            adr: Number(agent.adr),
            acs: Number(agent.acs),
          }))
        : null,
      formula:
        'Win percentage, K/D, ADR, and ACS are supplied aggregates; deriving rates requires per-agent match wins and round totals',
      sourceFields: [
        'agents.name',
        'agents.m',
        'agents.wr',
        'agents.kd',
        'agents.adr',
        'agents.acs',
      ],
      direction: 'Compare with adequate agent sample and rank, map, patch, and team context',
      sampleSize,
    }),
    metric({
      name: 'Role results',
      dimension: 'adaptability',
      value: roleRecords.length
        ? roleRecords.map(([role, result]) => ({
            name: role,
            m:
              result.m !== '' &&
              result.m !== null &&
              result.m !== undefined &&
              Number.isFinite(Number(result.m))
                ? Number(result.m)
                : null,
            wr: Number(result.wr),
            kda: Number(result.kda),
          }))
        : null,
      formula:
        'Win rate and KDA are supplied aggregates; deriving them requires role-level wins, kills, deaths, and match records',
      sourceFields: ['roles.m', 'roles.wr', 'roles.kda'],
      direction: 'Compare with adequate sample and team context',
      sampleSize,
    }),
    metric({
      name: 'Map and side results',
      dimension: 'adaptability',
      value: null,
      formula: 'Requires match-level map and side data',
      sourceFields: ['map', 'side'],
      direction: 'Context dependent',
      sampleSize,
    }),
  ];

  const dimensions = DIMENSION_DEFINITIONS.map((definition) => {
    const items = metricList.filter((item) => item.dimension === definition.key);
    const availableCount = items.filter((item) => item.availabilityStatus === 'available').length;
    return {
      ...definition,
      status:
        availableCount === 0
          ? 'unavailable'
          : availableCount === items.length
            ? 'observed'
            : 'partial',
      metrics: items.map((item) => ({ ...item, displayValue: formatMetricValue(item) })),
    };
  });

  const rawScores = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
  const possibleScores = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
  const answerBreakdown = Object.fromEntries(ROLE_KEYS.map((key) => [key, []]));
  const signals = {};
  Object.values(answers).forEach((answer) =>
    Object.entries(answer).forEach(([key, value]) => {
      if (typeof value !== 'number') signals[key] = value;
      else if (!(key in rawScores)) signals[key] = (signals[key] || 0) + value;
    }),
  );
  questions.forEach(([question, options], index) => {
    const selected = answers[index] || {};
    const selectedLabel =
      options.find(([, points]) => JSON.stringify(points) === JSON.stringify(selected))?.[0] ||
      'Answer selection unavailable';
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
  const matchingSignals = Object.fromEntries(
    ROLE_KEYS.map((key) => [
      key,
      answerBreakdown[key].filter((answer) => answer.contribution > 0).length,
    ]),
  );
  const minimumMatchingAnswers = Object.fromEntries(
    ROLE_KEYS.map((key) => [
      key,
      key === 'flex' ? FLEX_MIN_MATCHING_ANSWERS : PLAYSTYLE_MIN_MATCHING_ANSWERS,
    ]),
  );
  const rawAlignment = Object.fromEntries(
    ROLE_KEYS.map((key) => [
      key,
      possibleScores[key] ? Math.round((rawScores[key] / possibleScores[key]) * 100) : 0,
    ]),
  );
  const eligible = ROLE_KEYS.filter(
    (key) =>
      coverage[key] >= PLAYSTYLE_MIN_QUESTION_COVERAGE &&
      matchingSignals[key] >= minimumMatchingAnswers[key],
  ).sort((a, b) => rawAlignment[b] - rawAlignment[a]);
  const ranked = ROLE_KEYS.slice().sort((a, b) => rawAlignment[b] - rawAlignment[a]);
  const sc = Object.fromEntries(
    ROLE_KEYS.map((key) => [
      key,
      coverage[key] >= PLAYSTYLE_MIN_QUESTION_COVERAGE &&
      matchingSignals[key] >= minimumMatchingAnswers[key]
        ? rawAlignment[key]
        : null,
    ]),
  );
  const candidateKey = eligible[0] || ranked[0];
  const runnerUpKey =
    eligible.length > 1
      ? eligible[1]
      : eligible.length === 0
        ? ranked.find((key) => key !== candidateKey)
        : null;
  const candidateAlignment = rawAlignment[candidateKey];
  const runnerUpAlignment = runnerUpKey ? rawAlignment[runnerUpKey] : 0;
  const clearLead =
    eligible.length > 0 &&
    candidateAlignment >= PLAYSTYLE_MIN_ALIGNMENT &&
    candidateAlignment - runnerUpAlignment >= PLAYSTYLE_MIN_LEAD;
  const top = clearLead ? candidateKey : 'balanced';
  const decisionRationale = {
    clearLead,
    candidate: {
      key: candidateKey,
      name: PLAYSTYLE_NAMES[candidateKey],
      alignment: candidateAlignment,
      coverage: coverage[candidateKey],
      matchingSignals: matchingSignals[candidateKey],
      minimumMatchingAnswers: minimumMatchingAnswers[candidateKey],
      eligible: eligible.includes(candidateKey),
    },
    runnerUp: runnerUpKey
      ? {
          key: runnerUpKey,
          name: PLAYSTYLE_NAMES[runnerUpKey],
          alignment: rawAlignment[runnerUpKey],
          coverage: coverage[runnerUpKey],
          matchingSignals: matchingSignals[runnerUpKey],
          minimumMatchingAnswers: minimumMatchingAnswers[runnerUpKey],
          eligible: eligible.includes(runnerUpKey),
        }
      : null,
    coverage,
    matchingSignals,
    minimumMatchingAnswers,
    minimumQuestionCoverage: PLAYSTYLE_MIN_QUESTION_COVERAGE,
    minimumAlignment: PLAYSTYLE_MIN_ALIGNMENT,
    minimumLead: PLAYSTYLE_MIN_LEAD,
    evidence: answerBreakdown[candidateKey],
  };

  const impactObservations = [];
  const recordObservation = (title, evidence, reading, limitation) =>
    impactObservations.push({ title, evidence, reading, limitation });
  if (firstBloods !== null && firstDeaths !== null) {
    recordObservation(
      'Opening advantage and risk',
      `The sample records ${firstBloods} first bloods and ${firstDeaths} first deaths${rounds ? ` across ${rounds} rounds` : ''}; net opening differential: ${firstBloods - firstDeaths}${values.openingDifferentialPerRound !== null ? ` (${values.openingDifferentialPerRound.toFixed(3)} per round)` : ''}.`,
      'This puts opening creation and opening risk side by side. A positive count differential describes the record; it does not prove those openings converted into round wins.',
      'No round-state conversion or peer-role benchmark is connected.',
    );
  }
  recordObservation(
    'Advantage conversion',
    'Unavailable: no round-state transitions or post-opening round outcomes were entered.',
    'An opening kill is an opportunity signal. Conversion requires tracking whether the team won the round after gaining that advantage.',
    'Round-level state and outcome records are required.',
  );
  if (values.adr !== null || values.kpr !== null || values.acs !== null) {
    const evidence = [
      values.adr !== null && `ADR ${values.adr.toFixed(1)}`,
      values.kpr !== null && `KPR ${values.kpr.toFixed(2)}`,
      values.acs !== null && `ACS ${values.acs.toFixed(1)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    recordObservation(
      'Individual production',
      evidence,
      'These measures describe personal output. They do not establish team impact, quality of damage timing, or whether utility and trades enabled the production.',
      'A comparable rank, role, agent, map, and patch cohort is unavailable.',
    );
  }
  const teamEvidence = [
    values.kast !== null && `KAST ${values.kast}%`,
    values.assistsPerRound !== null && `assists ${values.assistsPerRound.toFixed(2)} per round`,
    values.tradeKillsPerRound !== null &&
      `trades ${values.tradeKillsPerRound.toFixed(2)} per round`,
  ]
    .filter(Boolean)
    .join(' · ');
  if (teamEvidence)
    recordObservation(
      'Team involvement',
      teamEvidence,
      'These are participation signals. They do not show whether the assist, trade, or survival changed the round outcome.',
      'No team-level event timeline or role benchmark is available.',
    );
  if (values.survivalRate !== null || values.deathsPerRound !== null) {
    const evidence = [
      values.survivalRate !== null && `survival ${values.survivalRate.toFixed(1)}%`,
      values.deathsPerRound !== null && `deaths ${values.deathsPerRound.toFixed(2)} per round`,
    ]
      .filter(Boolean)
      .join(' · ');
    recordObservation(
      'Survival and round participation',
      evidence,
      'Read survival alongside KAST, role, and whether the player preserved a useful advantage; staying alive alone is not always the best outcome.',
      'No position, round-state, or role-specific comparison is connected.',
    );
  }
  if (values.adr !== null && values.survivalRate !== null)
    recordObservation(
      'Damage and survival trade-off check',
      `ADR ${values.adr.toFixed(1)} alongside ${values.survivalRate.toFixed(1)}% survival.`,
      'Both measures are shown together, but the app does not infer that damage caused survival changes or that one was traded for the other.',
      'Their relationship needs paired per-match or per-round records and a relevant role benchmark.',
    );
  if (values.clutchConversion !== null) {
    const interval = wilsonInterval(clutchWins, clutchAttempts);
    recordObservation(
      'Clutch outcomes',
      `${clutchWins} wins from ${clutchAttempts} attempts (${values.clutchConversion.toFixed(1)}%)${interval ? `; 95% Wilson interval ${interval.lower.toFixed(1)}–${interval.upper.toFixed(1)}%` : ''}.`,
      'The attempt count and interval show uncertainty; they do not measure performance against comparable clutch situations.',
      'No opponent, time, economy, or clutch-state benchmark is available.',
    );
  }
  recordObservation(
    'Consistency and performance floor',
    'Unavailable from aggregate totals.',
    'Average or total statistics cannot show match-to-match variation or weaker-match performance.',
    'Per-match records are needed to calculate variation and a performance floor.',
  );
  const roleSpan = roleRecords.filter(
    ([, result]) => Number.isFinite(Number(result.m)) && Number(result.m) > 0,
  );
  recordObservation(
    'Tactical adaptability',
    roleSpan.length >= 2
      ? `Role-level win-rate aggregates were entered for ${roleSpan.length} roles with match counts.`
      : 'Map, side, and sufficient role-level match data are not available.',
    roleSpan.length >= 2
      ? 'These aggregates can describe outcomes by role, but do not show that the player adapted tactically or that role differences are meaningful.'
      : 'No adaptability claim is made from agent selection or unsplit totals.',
    'Map and side splits, role context, and adequately sized samples are needed for a tactical comparison.',
  );

  const signalEvidence = Object.fromEntries(
    ['entry', 'read', 'map', 'surv'].map((key) => [key, []]),
  );
  questions.forEach(([question, options], index) => {
    const selected = answers[index];
    if (!selected) return;
    const label =
      options.find(([, points]) => JSON.stringify(points) === JSON.stringify(selected))?.[0] ||
      'Answer not available';
    for (const key of Object.keys(signalEvidence))
      if (selected[key] > 0) signalEvidence[key].push({ question, answer: label });
  });
  const behavioralProfiles = [];
  const addBehaviorHypothesis = (name, signal, minimum, description) => {
    const evidence = signalEvidence[signal];
    if (evidence.length >= minimum)
      behavioralProfiles.push({ name, status: 'Questionnaire hypothesis', description, evidence });
  };
  addBehaviorHypothesis(
    'Space Creator',
    'entry',
    2,
    'Multiple answers favor taking or creating space. Check opening-round footage to confirm whether those choices create safe advantages.',
  );
  addBehaviorHypothesis(
    'Information Enabler',
    'read',
    2,
    'Multiple answers favor gathering information before rotations or commits. Validate the timing and value of that information in round records.',
  );
  addBehaviorHypothesis(
    'Map Controller',
    'map',
    2,
    'Multiple answers favor holding or managing map space. The current sample cannot verify which areas were controlled or for how long.',
  );
  addBehaviorHypothesis(
    'Round Stabilizer',
    'surv',
    2,
    'Multiple answers favor preserving a weapon or avoiding low-value risk. Check whether those saves preserve team economy and round advantage.',
  );
  if (matchingSignals.flex >= FLEX_MIN_MATCHING_ANSWERS)
    behavioralProfiles.push({
      name: 'Flexible Playmaker',
      status: 'Questionnaire hypothesis',
      description:
        'Your answers repeatedly favor changing role to fit the map or composition. Role and map match records are needed to confirm that this flexibility improves outcomes.',
      evidence: answerBreakdown.flex.filter((answer) => answer.contribution > 0),
    });

  // Join relevant answers to only the statistics that can describe that behavior.
  // These checks add context and coverage, not a fabricated skill score.
  const answered = (...keys) =>
    Object.values(answers).filter((answer) => keys.some((key) => Number(answer?.[key]) > 0)).length;
  const statCrossChecks = [];
  const addCrossCheck = (title, answerCount, evidence, reading, limitation) => {
    if (answerCount > 0) {
      const status = evidence.startsWith('No direct')
        ? 'Not captured'
        : /not entered|were not entered|No role or agent/i.test(evidence)
          ? 'Stats missing'
          : 'Stats available';
      statCrossChecks.push({ title, answerCount, evidence, reading, limitation, status });
    }
  };
  const openingAnswerCount = answered('entry');
  const openingEvidence = [
    firstBloods !== null && `${firstBloods} first bloods`,
    firstDeaths !== null && `${firstDeaths} first deaths`,
    rounds !== null && `${rounds} rounds`,
  ]
    .filter(Boolean)
    .join(' · ');
  addCrossCheck(
    'Opening choices',
    openingAnswerCount,
    openingEvidence || 'Opening counts and rounds were not entered.',
    firstBloods !== null && firstDeaths !== null && rounds > 0
      ? 'These stats show how often the sample involved opening outcomes and the balance between first kills and first deaths. They add context to your answers about taking space.'
      : 'Your answers describe an opening preference, but the entered sample cannot yet quantify opening involvement.',
    'No role/rank benchmark or round-win conversion data; opening counts do not prove that a fight was valuable.',
  );
  const teamworkAnswerCount = answered('support', 'trade', 'controller', 'initiator');
  const teamworkEvidence = [
    get('assists') !== null && `${get('assists')} assists`,
    get('tradeKills') !== null && `${get('tradeKills')} trade kills`,
    values.kast !== null && `KAST ${values.kast}%`,
    rounds !== null && `${rounds} rounds`,
  ]
    .filter(Boolean)
    .join(' · ');
  addCrossCheck(
    'Team support choices',
    teamworkAnswerCount,
    teamworkEvidence || 'Assists, trades, and KAST were not entered.',
    teamworkEvidence
      ? 'These are participation signals that can be reviewed beside your support, trade, and utility answers.'
      : 'The current stats cannot check these teamwork preferences yet.',
    'They do not capture utility quality or show whether a trade or assist changed the round result.',
  );
  const survivalAnswerCount = answered('surv', 'anchor', 'lurker');
  const survivalEvidence = [
    values.survivalRate !== null &&
      `survived ${roundsSurvived}/${rounds} rounds (${values.survivalRate.toFixed(1)}%)`,
    values.deathsPerRound !== null && `${values.deathsPerRound.toFixed(2)} deaths/round`,
    values.kast !== null && `KAST ${values.kast}%`,
  ]
    .filter(Boolean)
    .join(' · ');
  addCrossCheck(
    'Survival and positioning choices',
    survivalAnswerCount,
    survivalEvidence || 'Survived rounds, deaths per round, and KAST were not entered.',
    survivalEvidence
      ? 'These measures put your answers about preserving rounds and holding space beside recorded outcomes.'
      : 'The entered sample cannot yet check this preference.',
    'Scoreboard stats do not reveal position, whether a save was correct, or whether staying alive preserved an advantage.',
  );
  const clutchAnswerCount = answered('clutch');
  addCrossCheck(
    'Clutch choices',
    clutchAnswerCount,
    values.clutchConversion !== null
      ? `${clutchWins} wins from ${clutchAttempts} attempts (${values.clutchConversion.toFixed(1)}%)`
      : 'Clutch wins and attempts were not both entered.',
    values.clutchConversion !== null
      ? 'The attempt count and conversion describe recorded clutch outcomes beside your stated approach.'
      : 'Your answers describe a preferred clutch approach, but there are no complete clutch results to compare.',
    'Clutch difficulty, player count, economy, and opponent quality are not benchmarked.',
  );
  const adaptabilityAnswerCount = answered('flex', 'adapt', 'comp', 'counter');
  const adaptabilityEvidence = [
    roleRecords.length > 0 && `${roleRecords.length} role records`,
    agentRecords.length > 0 && `${agentRecords.length} agent records`,
  ]
    .filter(Boolean)
    .join(' · ');
  addCrossCheck(
    'Adaptation choices',
    adaptabilityAnswerCount,
    adaptabilityEvidence || 'No role or agent splits were entered.',
    adaptabilityEvidence
      ? 'Entered role/agent splits provide outcome context for the situations you described.'
      : 'The current stats cannot compare your role or agent choices yet.',
    'Aggregate splits do not establish why a role was chosen or whether switching roles improved team outcomes.',
  );
  const infoAnswerCount = answered('read', 'map', 'info', 'fake', 'call', 'resource');
  addCrossCheck(
    'Information and utility choices',
    infoAnswerCount,
    'No direct information, space-control, or utility-timing statistic is available in this form.',
    'Your answers create a tactical hypothesis for replay review; scoreboard totals cannot verify information quality or utility timing.',
    'Review round footage or event-level telemetry before treating this as observed behavior.',
  );

  const findings = [];
  const add = (type, text, source = 'answers') =>
    findings.push({
      type,
      text,
      source,
      t: type,
      x: text,
      src: source,
      confidence:
        source === 'answers'
          ? 'Self-reported; not verified by match data'
          : 'Descriptive; no peer cohort',
      sampleSize,
    });
  add(
    'info',
    `Entered stats: ACS ${get('acs') ?? 'not provided'}, ADR ${get('adr') ?? 'not provided'}, K/D ${get('kd') ?? 'not provided'}, and KAST ${get('kast') ?? 'not provided'}%. These are descriptive until compared with a relevant rank, role, and agent cohort.`,
    'stats',
  );
  if (values.openingDifferential !== null)
    add(
      'info',
      `Opening differential is ${values.openingDifferential} (${firstBloods} first bloods - ${firstDeaths} first deaths). This is an observed count, not a peer percentile.`,
      'stats',
    );
  if (values.clutchConversion !== null)
    add(
      'info',
      `Clutch conversion is ${values.clutchConversion.toFixed(1)}% across ${values.clutchAttempts} attempts. Keep the attempt count beside the rate.`,
      'stats',
    );
  if (signals.eco < 0)
    add(
      'con',
      'In the economy scenario, you chose a force or independent buy. Compare that choice with your team plan and the round win condition.',
    );
  if (signals.eco >= 3)
    add('pro', 'Your answers indicate planned purchases and coordination with teammates.');
  if (signals.trade >= 2)
    add(
      'pro',
      'Your answers favor immediate trades. Review trade conversion in match data to see how often those trades succeed.',
    );
  if (signals.trade < 0)
    add('con', 'Your answer suggests trade timing may be an opportunity to review in replays.');
  if (signals.surv < 0)
    add(
      'con',
      'In the low-odds scenario, you chose to push for a pick. Review whether that gains value or risks a saveable weapon.',
    );
  if (signals.util < 0)
    add(
      'con',
      'You reported sometimes dying with utility unused. Try using it before contact, then check whether it creates space or information.',
    );
  if (signals.tilt < 0)
    add(
      'con',
      'You said you would keep queueing after two losses. Track whether a short reset improves focus and round decisions.',
    );
  if (signals.tilt >= 2)
    add('pro', 'Your answers suggest you pause or change approach after a losing streak.');
  if (signals.read >= 2)
    add(
      'pro',
      'Your answers favor gathering map information and timing rotations or utility around it.',
    );
  if (sc.controller >= 50 && signals.timing >= 1)
    add(
      'pro',
      'Your answers point to a Controller playmaker tendency: enabling teammates with well-timed utility rather than measuring value only by opening kills.',
    );
  if (signals.comp >= 1)
    add(
      'pro',
      'You adapt your role choice to what the team composition needs. A second Duelist can be a map and strategy choice; it is not a universal upgrade.',
    );
  if (signals.map >= 2)
    add(
      'pro',
      'Your map plan prioritizes controlling gaps with the right role and utility. The best approach depends on the map and team composition.',
    );
  if (signals.adapt >= 2)
    add(
      'pro',
      'You look for ways to draw or avoid enemy utility before committing. Review rounds to see whether the adjustment created space for your team.',
    );
  if (signals.info >= 2)
    add(
      'pro',
      'Your default prioritizes learning what space the defense gives up and keeping that space available for a later decision.',
    );
  if (signals.fake >= 2)
    add(
      'pro',
      'You use controlled pressure to test rotations or draw utility before choosing where to execute. Check whether the team safely retained the first area.',
    );
  if (signals.resource >= 2)
    add(
      'pro',
      'Your answers emphasize getting value from enemy utility before committing your own resources. Against escape abilities, track the tool and likely exit; avoid a fixed wait rule for every round.',
    );
  if (sc.initiator >= 50 && signals.call >= 2)
    add(
      'pro',
      'Your answers fit an Initiator playmaker tendency: gathering information and setting up calls while staying connected to the action.',
    );
  if (signals.counter >= 2)
    add(
      'pro',
      'Prior experience on aggressive roles may help anticipate Duelist timings. Treat that read as a hypothesis and validate it against round outcomes.',
    );
  if (top === 'balanced')
    add(
      'info',
      'Your answers do not show one clearly leading playstyle tendency. The result stays mixed instead of forcing a single label.',
    );

  const recommendations = [];
  if (values.openingDifferential === null)
    recommendations.push(
      'Record first deaths alongside first bloods; together they allow opening differential and duel conversion calculations.',
    );
  if (
    values.clutchConversion === null &&
    !dataWarnings.some((warning) => warning.startsWith('Clutch wins'))
  )
    recommendations.push(
      'Log clutch wins and attempts together. A win count without attempts cannot show clutch success rate.',
    );
  if (!rounds)
    recommendations.push(
      'Add rounds played to calculate per-round death, assist, and trade rates.',
    );
  if (totalDamage === null || !rounds)
    recommendations.push(
      'If your tracker provides total damage, enter it with total rounds to calculate ADR from summed totals.',
    );
  if (rounds !== null && roundsSurvived === null)
    recommendations.push(
      'Add rounds survived with rounds played to calculate survival rate; deaths alone cannot tell whether you were alive at round end.',
    );
  recommendations.push(
    'For a default review, note space gained, opponent utility drawn, space retained, and the information that triggered the site call.',
  );
  if (!matches)
    recommendations.push(
      'Add the number of matches in this sample; keep per-match records to measure consistency and confidence.',
    );
  if (!stats.rank)
    recommendations.push(
      'Add rank and role context before comparing performance with other players.',
    );
  if (
    !stats.roles ||
    !Object.keys(stats.roles).length ||
    !Array.isArray(stats.agents) ||
    !stats.agents.length
  )
    recommendations.push(
      'Record results by agent, role, map, and side to evaluate adaptability without mixing different contexts.',
    );
  recommendations.push(
    'Keep a per-match record of core stats; aggregate totals cannot show match-to-match consistency or identify outlier games.',
  );

  const reviewPlan = [];
  const addReview = (title, evidence, benchmark, uncertainty, why, action) =>
    reviewPlan.push({ title, evidence, benchmark, uncertainty, why, action });
  if (firstBloods !== null && firstDeaths !== null)
    addReview(
      'Review opening-round conversion',
      `${firstBloods} first bloods, ${firstDeaths} first deaths${rounds ? ` over ${rounds} rounds` : ''}; net differential ${firstBloods - firstDeaths}.`,
      'No role- and rank-matched benchmark or round-win conversion data.',
      'The counts show opening outcomes, not whether the team converted the resulting advantage.',
      'Separating duel creation from opening risk helps avoid treating first bloods or deaths alone as impact.',
      'Review opening rounds with the next 10 seconds of team movement and whether the first advantage became a won round.',
    );
  if (values.adr !== null)
    addReview(
      'Connect damage to round value',
      `Recorded ADR: ${values.adr.toFixed(1)}${values.kd !== null ? `; K/D: ${values.kd.toFixed(2)}` : ''}.`,
      'No comparable cohort or event-timing data.',
      'Aggregate damage and K/D cannot show damage timing, trades, utility setup, or whether damage changed round outcomes.',
      'Scoreboard production and team impact are different questions.',
      'Review high-damage rounds for trade follow-up, space gained, and round result before targeting aim or aggression as a weakness.',
    );
  if (values.clutchConversion !== null) {
    const interval = wilsonInterval(clutchWins, clutchAttempts);
    addReview(
      'Review clutch situations',
      `${clutchWins} wins from ${clutchAttempts} attempts (${values.clutchConversion.toFixed(1)}%)${interval ? `; Wilson interval ${interval.lower.toFixed(1)}–${interval.upper.toFixed(1)}%` : ''}.`,
      'No benchmark for comparable clutch state, economy, or opponent.',
      'The interval describes sampling uncertainty only; it does not adjust for clutch difficulty.',
      'Clutch conversion needs the number and difficulty of attempts beside the rate.',
      'Tag each attempt by player count, time, utility, and economy, then compare like situations.',
    );
  }
  addReview(
    'Build a match-level baseline',
    'This analysis currently uses aggregate totals; consistency and a performance floor are unavailable.',
    'A player-specific per-match series is needed before comparison.',
    'Averages can hide weak matches, outliers, and changing form.',
    'Trend and consistency claims need multiple ordered match records.',
    'Save per-match rounds, kills, deaths, ADR, KAST, role, agent, map, and side.',
  );
  addReview(
    'Add a comparison group',
    'No peer cohort is connected to this analysis.',
    'Use the same rank, mode, patch, and relevant role or agent.',
    'Without a cohort, the app cannot say that a value is above or below expectation.',
    'Benchmarking is required before calling a statistical strength or weakness.',
    'Connect a sufficiently large reference dataset before ranking, percentile, or context-adjusted claims.',
  );

  return {
    analysisModelVersion: ANALYSIS_MODEL_VERSION,
    sc,
    top,
    name: PLAYSTYLE_NAMES[top],
    decisionRationale,
    impactObservations,
    behavioralProfiles,
    statCrossChecks,
    reviewPlan,
    dimensions,
    metrics: metricList,
    dataWarnings,
    findings,
    I: findings,
    recommendations,
    side: signals.side,
  };
}

import { useState } from 'react';
import { Button, Chip, Tabs, TabList, Tab, TabPanel } from '@heroui/react';
import { analyzePlayer, ANALYSIS_MODEL_VERSION, PLAYSTYLE_NAMES } from './analytics/player-analysis.js';

/* ---------- data ---------- */
const FIELDS = [
  ['acs', 'ACS'], ['adr', 'Damage / round'], ['kd', 'K/D'], ['kast', 'KAST %'],
  ['hs', 'Headshot %'], ['win', 'Win %'], ['kpr', 'Kills / round'], ['kills', 'Kills'],
  ['deaths', 'Deaths'], ['assists', 'Assists'], ['firstBloods', 'First bloods'], ['matches', 'Matches analyzed'],
];
const OPTIONAL_FIELDS = [
  ['rounds', 'Rounds played'], ['firstDeaths', 'First deaths'], ['tradeKills', 'Trade kills'],
  ['clutchAttempts', 'Clutch attempts'], ['clutchWins', 'Clutch wins'],
];
const ALL_FIELDS = [...FIELDS, ...OPTIONAL_FIELDS];
const EMPTY = { ...Object.fromEntries(ALL_FIELDS.map(([k]) => [k, ''])), rank: '', roles: {}, agents: [] };
const SAMPLE = {
  rank: 'Platinum 3', acs: 292.3, adr: 188.7, kd: 1.25, kast: 70.8, hs: 28.0, win: 51.6, kpr: 1.0,
  kills: 2531, deaths: 2026, assists: 654, firstBloods: 517, matches: 20,
  roles: { Duelist: { wr: 55.6, kda: 1.52 }, Initiator: { wr: 50.0, kda: 1.55 }, Sentinel: { wr: 46.2, kda: 1.55 }, Controller: { wr: 53.8, kda: 1.7 } },
  agents: [
    { name: 'Chamber', m: 18, wr: 61.1, kd: 1.37, adr: 193.6, acs: 306.5 },
    { name: 'Sova', m: 15, wr: 40.0, kd: 1.16, adr: 184.2, acs: 284.4 },
    { name: 'Hush', m: 11, wr: 72.7, kd: 1.05, adr: 167.4, acs: 259.2 },
  ],
};

/* option = [label, points]. Numeric keys add up; `side` is stored as text. */
const Q = [
  ['At the start of a round, what do you usually do?', [['Take the first fight', { entry: 2 }], ['Wait for a teammate to make contact', { support: 2, anchor: 1 }], ['Play off info and utility', { support: 1, lurker: 1 }]]],
  ['Your team lost the last round and you have 2-3k credits. What do you do?', [['Save for a full buy', { eco: 2 }], ['Half buy', { eco: 1 }], ['Force buy', { eco: -1 }]]],
  ['How do you handle buys with your team?', [['Sync with the team', { eco: 2 }], ['Buy what I want', { eco: -1 }], ['Drop or ask for drops', { eco: 1, support: 1 }]]],
  ['A teammate just died next to you. What do you do?', [['Trade immediately', { trade: 2 }], ['Wait for info first', { trade: 0 }], ['Reposition', { trade: -1, lurker: 1 }]]],
  ['The round is lost (1v3 or worse). What do you do?', [['Save the gun', { surv: 2 }], ['Push for a pick', { surv: -1, entry: 1 }], ['Rotate for value', { surv: 1, lurker: 1 }]]],
  ['In a clutch (1vX), how do you play?', [['Hunt aggressively', { clutch: 2, entry: 1 }], ['Play time and wait', { clutch: 1, anchor: 1 }], ['Isolate duels', { clutch: 2 }]]],
  ['Which side feels stronger?', [['Attack', { side: 'Attack' }], ['Defense', { side: 'Defense' }], ['About the same', { side: 'Even' }]]],
  ['On defense, where do you usually play?', [['Hold one angle', { anchor: 2 }], ['Rotate early', { lurker: 1, support: 1 }], ['Aggressive off-angles', { entry: 1, lurker: 1 }]]],
  ['How do you use abilities and your ultimate?', [['Before the fight', { util: 2 }], ['Save for later', { util: 0 }], ['I often die with them unused', { util: -2 }]]],
  ['After losing 2 games in a row, what do you do?', [['Keep queueing', { tilt: -2 }], ['Take a break', { tilt: 2 }], ['Switch agent or playlist', { tilt: 1 }]]],
  ['Your team needs a Controller. How do you create value?', [['Read the minimap and time utility for teammates', { controller: 2, support: 1, read: 1 }], ['Take space with the team after smokes land', { controller: 1, entry: 1, timing: 1 }], ['Hold a safe angle and preserve site control', { controller: 1, anchor: 1, surv: 1 }]]],
  ['A teammate spots pressure on the other site. What is your next move?', [['Rotate early and help shape the defense', { read: 2, support: 1, anchor: 1, initiator: 1 }], ['Wait for one more cue before leaving', { read: 1, anchor: 1 }], ['Use utility to slow them, then call the rotate', { read: 2, util: 1, support: 1, initiator: 1 }]]],
  ['Your composition has one Duelist. How do you approach the next map?', [['Stay Controller and enable their entry with timed utility', { controller: 2, support: 2, comp: 1 }], ['Offer to flex into a second entry role if the map needs it', { flex: 2, entry: 1, comp: 1 }], ['Keep current roles and coordinate trades tightly', { support: 1, trade: 1, comp: 1 }]]],
  ['On a map with long gaps to control, which plan fits you?', [['Use a sentinel like Chamber to hold space and watch flanks', { anchor: 2, map: 2 }], ['Add another mobile entry to contest space together', { entry: 2, flex: 1, map: 1 }], ['Use information and utility to take space as a group', { controller: 1, support: 1, read: 1, map: 1 }]]],
  ['The opponents keep spending utility to stop your first push. What do you change?', [['Show pressure, draw utility, then hit a different area', { read: 1, flex: 1, adapt: 2 }], ['Coordinate a faster execute with utility layered together', { support: 1, controller: 1, timing: 1, adapt: 1, initiator: 1 }], ['Slow down, gather information, and call a late hit', { read: 2, lurker: 1, adapt: 1, initiator: 1 }]]],
  ['At the start of attack, what does your default try to learn?', [['How much space and which routes the defense gives up', { read: 2, map: 1, info: 1 }], ['Which defender reacts first to pressure', { read: 1, fake: 1, info: 1, initiator: 1 }], ['Where our team can safely hold space for a later hit', { map: 2, support: 1, info: 1 }]]],
  ['Your team has control of two areas, but the site hit is not ready. What do you do?', [['Keep the space and wait for the team to regroup', { map: 2, surv: 1, resource: 1 }], ['Make noise elsewhere to pull a rotate, then decide', { fake: 2, read: 1, resource: 1 }], ['Use utility to force the site before control fades', { entry: 1, timing: 1, resource: -1 }]]],
  ['When would you use fake pressure?', [['After gaining control, to pull defenders or utility before rotating', { fake: 2, read: 1, resource: 1 }], ['Only when teammates can keep the first area safely controlled', { fake: 1, map: 1, support: 1 }], ['Rarely; I prefer a direct, coordinated execute', { support: 1, timing: 1 }]]],
  ['An opponent can escape with a teleport or mobility ability. How do you adjust?', [['Track or draw the escape tool, then commit utility when it is spent', { resource: 2, read: 1, adapt: 1 }], ['Hold the likely exit and pressure with a teammate', { support: 1, map: 1, adapt: 1 }], ['Keep the default and avoid chasing until we have information', { read: 2, surv: 1 }]]],
  ['Which role best supports your mid-round calling?', [['Initiator: gather information and set up a coordinated play', { initiator: 2, call: 2, read: 1 }], ['Sentinel: hold space while teammates make the next call', { anchor: 2, map: 1 }], ['Flex: use experience on other roles to anticipate opponents', { flex: 2, counter: 2, adapt: 1 }]]],
];
const NAMES = PLAYSTYLE_NAMES;
/* ---------- storage (local only) ---------- */
const loadSnaps = () => { try { return JSON.parse(localStorage.getItem('vpa:snaps') || '[]'); } catch { return []; } };
const saveSnap = (x) => { try { localStorage.setItem('vpa:snaps', JSON.stringify([...loadSnaps(), x].slice(-30))); } catch { /* storage blocked */ } };
const num = (s) => ({ ...s, ...Object.fromEntries(ALL_FIELDS.map(([k]) => [k, parseFloat(s[k]) || 0])) });

/* ---------- small parts ---------- */
const panel = 'rounded-2xl border border-white/15 bg-[#191e24] p-5 shadow-[0_12px_36px_rgba(0,0,0,.18)]';
const Bar = ({ label, value, max, text }) => (
  <div className="mb-3">
    <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="text-white/60">{text ?? value}</span></div>
    <div className="h-2 rounded-full bg-white/10"><div className="h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: 'var(--accent)' }} /></div>
  </div>
);

const FindingTable = ({ title, intro, items, expanded = false }) => (
  <details open={expanded} className="group overflow-hidden rounded-2xl border border-white/15 bg-[#191e24]">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-4 font-semibold text-white marker:hidden">
      <span>{title}</span><span className="flex items-center gap-3 rounded-full border border-white/20 px-2.5 py-1 text-xs font-medium text-white/75">{items.length} {items.length === 1 ? 'finding' : 'findings'}<svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform group-open:rotate-180"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></span>
    </summary>
    <div className="border-t border-white/10 px-4 pb-4 pt-3">
      <p className="mb-4 text-sm leading-5 text-white/65">{intro}</p>
      {items.length === 0 ? <p className="text-sm text-white/50">No findings in this group yet.</p> : (
        <>
          <div className="space-y-3 sm:hidden">
            {items.map((item, index) => {
              const explanation = item.src === 'stats'
                ? 'This is an observed value from the entered sample. Without a relevant comparison group, it cannot say whether performance is above or below average.'
                : item.type === 'con'
                  ? 'This scenario answer suggests something to check in a replay; it does not prove this happens regularly.'
                  : 'This scenario answer describes your stated approach. Match or replay data is needed to confirm it is a habit.';
              return <article key={`${item.text}-${index}`} className="rounded-xl border border-white/10 bg-black/10 p-3"><p className="text-sm leading-5 text-white/90">{item.text}</p><p className="mt-2 text-xs leading-5 text-white/55">{item.src === 'stats' ? 'Entered match data' : 'Scenario answer'} · {item.sampleSize !== null ? `${item.sampleSize} matches` : 'Sample size not provided'}</p><details className="mt-2 text-xs"><summary className="w-fit cursor-pointer font-medium text-[#ff9299]">Why this matters</summary><p className="mt-2 leading-5 text-white/65">{explanation}</p><p className="mt-1 text-white/45">{item.confidence}.</p></details></article>;
            })}
          </div>
          <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-white/15 text-xs uppercase tracking-wide text-white/55"><th className="py-2 pr-4 font-semibold">Finding</th><th className="py-2 pr-4 font-semibold">Evidence</th><th className="py-2 font-semibold">More information</th></tr></thead>
            <tbody>{items.map((item, index) => {
              const explanation = item.src === 'stats'
                ? 'This is a value from the entered match sample. It describes the sample, but cannot say whether it is strong or weak without a suitable comparison group.'
                : item.type === 'con'
                  ? 'This came from a scenario answer. Treat it as a possible review topic, not proof of a repeated in-game weakness. Check a replay for supporting examples.'
                  : 'This reflects how you said you would approach a scenario. It describes a preference; match or replay data is needed to confirm it is how you regularly play.';
              return (
                <tr key={`${item.text}-${index}`} className="border-b border-white/10 align-top last:border-0">
                  <td className="max-w-sm py-3 pr-4 leading-5 text-white/90">{item.text}</td>
                  <td className="py-3 pr-4 leading-5 text-white/65">{item.src === 'stats' ? 'Entered match data' : 'Scenario answer'}<br />{item.sampleSize !== null ? `${item.sampleSize} matches` : 'Sample size not provided'}</td>
                  <td className="py-3 leading-5"><details><summary className="w-fit cursor-pointer font-medium text-[#ff9299]">Why this matters</summary><p className="mt-2 max-w-sm text-white/65">{explanation}</p><p className="mt-2 text-xs text-white/45">Confidence: {item.confidence}.</p></details></td>
                </tr>
              );
            })}</tbody>
          </table>
          </div>
        </>
      )}
    </div>
  </details>
);

/* ---------- page ---------- */
export default function ValorantAnalyzer() {
  const [step, setStep] = useState('confirm');
  const [stats, setStats] = useState(EMPTY);
  const [answers, setAnswers] = useState({});
  const [qi, setQi] = useState(0);
  const [res, setRes] = useState(null);
  const [snaps, setSnaps] = useState([]);

  function pick(opt) {
    const next = { ...answers, [qi]: opt };
    setAnswers(next);
    if (qi < Q.length - 1) return setQi(qi + 1);
    const s = num(stats), r = analyzePlayer(stats, next, Q);
    const timestamp = new Date().toISOString();
    saveSnap({ date: timestamp.slice(0, 10), timestamp, source: 'manual', modelVersion: ANALYSIS_MODEL_VERSION, sourceData: { ...stats }, answers: next, acs: s.acs, kast: s.kast, adr: s.adr, matches: s.matches, type: r.name });
    setRes(r); setSnaps(loadSnaps()); setStep('result');
  }
  const restart = () => { setStats(EMPTY); setAnswers({}); setQi(0); setRes(null); setStep('confirm'); };
  const ready = ['acs', 'adr', 'kd', 'kast'].every((k) => String(stats[k]).trim() !== '');
  const s = num(stats);

  return (
    <main className="app-shell min-h-screen bg-[#101317] px-4 py-7 text-white sm:px-6 sm:py-12" style={{ '--accent': '#ff4655' }}>
      <div className="mx-auto max-w-5xl">
        <header className="motion-enter mb-10 border-b border-white/10 pb-8 sm:mb-12">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[.24em] text-[#ff6470]">VPA <span className="text-white/40">/ PLAYER INTELLIGENCE</span></span><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50">ANALYSIS BETA</span></div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[.2em] text-white/40">Performance, with context</p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Understand what makes your game <span className="text-[#ff6470]">work.</span></h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">Go beyond a single rank or K/D. Combine your match stats with how you make decisions to see your strengths, playstyle, and next opportunity to improve.</p>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/65"><span>01 / Add match data</span><span>02 / Answer 20 questions</span><span>03 / Review evidence and insights</span></div>
        </header>

        {step === 'confirm' && (
          <section className={`motion-enter ${panel} border-white/10 bg-[#171b20] sm:p-7`}>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#ff6470]">01 / Your baseline</p><h2 className="mt-2 text-2xl font-semibold">Add your recent performance</h2></div><Button variant="secondary" className="!border !border-white/25 !bg-[#252c34] !text-white hover:!bg-[#343d47]" onPress={() => setStats(SAMPLE)}>Use example data</Button></div>
            <p className="mb-6 max-w-2xl text-sm leading-6 text-white/55">Enter stats from a similar set of recent matches. More matches make patterns more reliable. Raw numbers stay separate from interpretation.</p>
            <div className="mb-4 max-w-xs"><label className="text-sm"><span className="mb-1 block font-medium text-white/85">Current rank (optional)</span><input type="text" value={stats.rank} onChange={(e) => setStats({ ...stats, rank: e.target.value })} placeholder="e.g. Platinum 3" className="w-full rounded-lg border border-white/25 bg-[#0e1115] px-3 py-2.5 text-white outline-none placeholder:text-white/50 focus:border-[#ff6470] focus:ring-2 focus:ring-[#ff6470]/30" /></label></div>
            <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">{FIELDS.map(([k, label]) => (<label key={k} className="min-w-0 text-sm"><span className="mb-1 block font-medium text-white/85">{label}</span><input aria-label={label} type="number" min="0" step={['acs', 'adr', 'kd', 'kast', 'hs', 'win', 'kpr'].includes(k) ? 'any' : '1'} value={stats[k]} onChange={(e) => setStats({ ...stats, [k]: e.target.value })} className="w-full min-w-0 rounded-lg border border-white/25 bg-[#0e1115] px-3 py-2.5 text-white outline-none placeholder:text-white/50 focus:border-[#ff6470] focus:ring-2 focus:ring-[#ff6470]/30" /></label>))}</div>
            <details className="mt-5 rounded-xl border border-white/15 bg-black/15 p-4">
              <summary className="cursor-pointer font-medium text-white/85">Add optional analysis stats</summary>
              <p className="mt-2 text-sm leading-5 text-white/60">These unlock opening, survival, team, and clutch formulas. Leave blank when unavailable; blank values are not treated as zero.</p>
              <div className="mt-4 grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 sm:grid-cols-3">{OPTIONAL_FIELDS.map(([k, label]) => (<label key={k} className="min-w-0 text-sm"><span className="mb-1 block font-medium text-white/85">{label}</span><input aria-label={label} type="number" min="0" step="1" value={stats[k]} onChange={(e) => setStats({ ...stats, [k]: e.target.value })} className="w-full min-w-0 rounded-lg border border-white/25 bg-[#0e1115] px-3 py-2.5 text-white outline-none placeholder:text-white/50 focus:border-[#ff6470] focus:ring-2 focus:ring-[#ff6470]/30" /></label>))}</div>
            </details>
            <div className="mt-5 flex gap-2"><Button variant="primary" isDisabled={!ready} style={{ color: '#fff', backgroundColor: ready ? '#ff4655' : '#353b43', opacity: 1 }} onPress={() => setStep('quiz')}>Continue to questions</Button></div>
            <div className="mt-8 grid gap-3 border-t border-white/10 pt-6 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-[11px] uppercase tracking-widest text-white/65">01 / Mechanics</p><p className="mt-1 text-sm text-white/70">Aim · damage · weapon impact</p></div><div><p className="text-[11px] uppercase tracking-widest text-white/65">02 / Opening impact</p><p className="mt-1 text-sm text-white/70">First fights · duel outcomes</p></div><div><p className="text-[11px] uppercase tracking-widest text-white/65">03 / Survival</p><p className="mt-1 text-sm text-white/70">KAST · deaths · preservation</p></div><div><p className="text-[11px] uppercase tracking-widest text-white/65">04 / Team contribution</p><p className="mt-1 text-sm text-white/70">Assists · trades · utility</p></div><div><p className="text-[11px] uppercase tracking-widest text-white/65">05 / Clutch</p><p className="mt-1 text-sm text-white/70">Pressure-round performance</p></div><div><p className="text-[11px] uppercase tracking-widest text-white/65">06 / Consistency</p><p className="mt-1 text-sm text-white/70">Match-to-match reliability</p></div><div><p className="text-[11px] uppercase tracking-widest text-white/65">07 / Adaptability</p><p className="mt-1 text-sm text-white/70">Agents · maps · side · role</p></div>
            </div>
            <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-white/65">Rank and match count add context, but this preview does not calculate peer percentiles yet. Aggregate stats cannot establish match-to-match consistency. Missing data is not a weakness.</p>
          </section>
        )}
        {step === 'quiz' && (
          <section key={qi} className={`motion-enter ${panel} mt-8`}>
            <div className="mb-2 flex justify-between text-sm font-medium text-white/75"><span>Question {qi + 1} of {Q.length}</span><span>{Math.round(((qi + 1) / Q.length) * 100)}%</span></div>
            <div className="mb-6 h-2 overflow-hidden rounded-full bg-white/15"><div className="progress-fill h-full rounded-full" style={{ transform: `scaleX(${(qi + 1) / Q.length})`, background: 'var(--accent)' }} /></div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#ff7b84]">Decision profile</p><h2 className="mb-5 text-xl font-semibold leading-snug sm:text-2xl">{Q[qi][0]}</h2>
            <div className="flex flex-col gap-2">
              {Q[qi][1].map(([label, pts]) => (
                <Button
                  key={label}
                  variant={answers[qi] === pts ? 'primary' : 'secondary'}
                  className="min-h-12 justify-start whitespace-normal border text-left leading-snug"
                  style={{
                    backgroundColor: answers[qi] === pts ? '#ff4655' : '#252c34',
                    borderColor: answers[qi] === pts ? '#ff7b84' : '#56606c',
                    color: '#ffffff',
                  }}
                  onPress={() => pick(pts)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-5 text-xs leading-5 text-white/55">Your answer adds a signal to your profile. The final read combines these choices with your entered stats.</p>{qi > 0 && <div className="mt-4"><Button variant="secondary" className="min-h-11 border border-white/25 bg-[#252c34] px-5 font-semibold text-white hover:bg-[#303944]" onPress={() => setQi(qi - 1)}>Previous question</Button></div>}
          </section>
        )}

        {step === 'result' && res && (
          <section className="motion-enter mt-8">
            <div className={panel}>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold">{res.name}</h2>
                {stats.rank && <Chip>{stats.rank}</Chip>}
                {stats.matches && <Chip>{stats.matches} matches in sample</Chip>}
                {res.side && res.side !== 'Even' && <Chip>Stronger on {res.side.toLowerCase()}</Chip>}
              </div>
              <div className="mt-4">
                <p className="mb-4 text-xs leading-5 text-white/65">Playstyle alignment is normalized across questions where each role was an available signal. Stats are shown as evidence separately; neither is a rank percentile.</p>
                {Object.entries(res.sc).map(([k, v]) => <Bar key={k} label={NAMES[k]} value={v ?? 0} max={100} text={v === null ? `Needs ${res.decisionRationale.minimumQuestionCoverage} questions (${res.decisionRationale.coverage[k]} signal)` : `${v}%`} />)}
              </div>
              <details className="mt-5 rounded-xl border border-white/15 bg-black/15 p-4">
                <summary className="cursor-pointer font-semibold text-white">Why did I get this result?</summary>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  {res.decisionRationale.clearLead
                    ? `${res.decisionRationale.candidate.name} leads at ${res.decisionRationale.candidate.alignment}%, ahead of ${res.decisionRationale.runnerUp.name} at ${res.decisionRationale.runnerUp.alignment}%. It passed the ${res.decisionRationale.minimumAlignment}% alignment and ${res.decisionRationale.minimumLead}-point lead rules.`
                    : !res.decisionRationale.candidate.eligible
                      ? `The closest raw pattern is ${res.decisionRationale.candidate.name}, but it appears in only ${res.decisionRationale.candidate.coverage} discriminating question(s). At least ${res.decisionRationale.minimumQuestionCoverage} are required to report a tendency, so this result stays mixed.`
                      : `Your closest supported pattern is ${res.decisionRationale.candidate.name} (${res.decisionRationale.candidate.alignment}%), followed by ${res.decisionRationale.runnerUp.name} (${res.decisionRationale.runnerUp.alignment}%). It did not clear both the ${res.decisionRationale.minimumAlignment}% alignment and ${res.decisionRationale.minimumLead}-point lead rules, so the result stays mixed.`}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/60">These percentages measure how your scenario choices align with each tendency. They do not measure aim, match impact, or proven in-game behavior; your stats are analyzed separately.</p>
                {res.decisionRationale.evidence.length > 0 && <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-white/85">Answers behind the closest pattern: {res.decisionRationale.candidate.name}</h3>
                  <div className="space-y-2 sm:hidden">{res.decisionRationale.evidence.map((item) => <div key={item.question} className="rounded-lg border border-white/10 p-3"><p className="text-xs font-medium text-white/55">{item.question}</p><p className="mt-1 text-sm text-white/85">{item.answer}</p><p className="mt-1 text-xs text-white/60">Alignment on this signal: {item.alignment}%</p></div>)}</div>
                  <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b border-white/15 text-xs uppercase text-white/55"><th className="py-2 pr-3">Scenario</th><th className="py-2 pr-3">Your answer</th><th className="py-2">Signal alignment</th></tr></thead><tbody>{res.decisionRationale.evidence.map((item) => <tr key={item.question} className="border-b border-white/10 last:border-0"><td className="py-2 pr-3 text-white/70">{item.question}</td><td className="py-2 pr-3 text-white/85">{item.answer}</td><td className="py-2 text-white/70">{item.alignment}%</td></tr>)}</tbody></table></div>
                </div>}
              </details>
            </div>

            <Tabs defaultSelectedKey="overview" className="mt-6 w-full min-w-0">
              <TabList aria-label="Results" className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                <Tab id="overview" className="min-w-0 justify-center px-2 text-center text-xs leading-4 !text-white sm:text-sm" style={{ color: '#f4f4f5' }}>Summary</Tab>
                <Tab id="dimensions" className="min-w-0 justify-center px-2 text-center text-xs leading-4 !text-white sm:text-sm" style={{ color: '#f4f4f5' }}>Seven dimensions</Tab>
                <Tab id="deep" className="min-w-0 justify-center px-2 text-center text-xs leading-4 !text-white sm:text-sm" style={{ color: '#f4f4f5' }}>Deep dive</Tab>
                <Tab id="trends" className="min-w-0 justify-center px-2 text-center text-xs leading-4 !text-white sm:text-sm" style={{ color: '#f4f4f5' }}>Trends</Tab>
                <Tab id="share" className="min-w-0 justify-center px-2 text-center text-xs leading-4 !text-white sm:text-sm" style={{ color: '#f4f4f5' }}>Share summary</Tab>
              </TabList>

              <TabPanel id="overview">
                <div className="mt-4 rounded-xl border border-[#ff6470]/25 bg-[#ff4655]/[.06] p-4 text-sm leading-6 text-white/75">
                  <strong className="text-white">Quick guide:</strong> match data shows recorded outcomes; scenario answers show your stated approach. A tendency is a clue to review, not a fixed label.
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  <FindingTable title="Match data observations" intro="Numbers from the sample you entered. Expand a row's details to learn how to interpret it." items={res.I.filter((item) => item.src === 'stats')} expanded />
                  <FindingTable title="Decision patterns" intro="Patterns inferred from your scenario choices. Check these against match footage before treating them as habits." items={res.I.filter((item) => item.src !== 'stats' && (item.t === 'pro' || item.t === 'info'))} />
                  <FindingTable title="Review opportunities" intro="Possible areas to investigate in your matches; the quiz alone cannot confirm a weakness." items={res.I.filter((item) => item.src !== 'stats' && item.t === 'con')} />
                </div>
              </TabPanel>

              <TabPanel id="dimensions">
                <details className="mt-4 rounded-2xl border border-white/15 bg-[#191e24] p-4 sm:p-5">
                  <summary className="cursor-pointer font-semibold text-white">New to these stats? Open the quick guide</summary>
                  <p className="mt-2 text-sm leading-5 text-white/60">These terms describe different things. None should be used alone to decide whether a player is good or bad.</p>
                  <dl className="mt-4 space-y-3 sm:hidden">{[
                    ['ACS', 'Tracker combat-score summary. Mixed impact measure; its exact calculation depends on the source.'],
                    ['ADR', 'Average damage per round. Damage alone does not show whether fights were won or teammates enabled.'],
                    ['K/D', 'Kills divided by deaths. It leaves out assists, trades, and role responsibilities.'],
                    ['KAST', 'Tracker-reported round involvement rate. Use the same tracker definition for comparisons.'],
                    ['Opening differential', 'First bloods minus first deaths. Compare over the same rounds and consider role.'],
                    ['Clutch conversion', 'Clutch wins divided by attempts. Always read the attempt count beside the rate.'],
                    ['Percentile', 'Position in a comparison group. This app does not have a rank, role, and agent cohort yet.'],
                  ].map(([term, explanation]) => <div key={term} className="rounded-lg border border-white/10 p-3"><dt className="font-semibold text-white">{term}</dt><dd className="mt-1 text-sm leading-5 text-white/65">{explanation}</dd></div>)}</dl>
                  <div className="mt-4 hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                      <thead><tr className="border-b border-white/15 text-xs uppercase tracking-wide text-white/55"><th className="py-2 pr-4">Term</th><th className="py-2 pr-4">Plain meaning</th><th className="py-2">Helpful context</th></tr></thead>
                      <tbody className="divide-y divide-white/10">
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">ACS</th><td className="py-3 pr-4 text-white/75">Tracker combat-score summary.</td><td className="py-3 text-white/60">A mixed impact measure; its exact calculation depends on the source.</td></tr>
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">ADR</th><td className="py-3 pr-4 text-white/75">Average damage dealt per round.</td><td className="py-3 text-white/60">Damage is useful context, but does not show whether fights were won or teammates were enabled.</td></tr>
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">K/D</th><td className="py-3 pr-4 text-white/75">Kills divided by deaths.</td><td className="py-3 text-white/60">Does not include assists, trades, round impact, or role responsibilities.</td></tr>
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">KAST</th><td className="py-3 pr-4 text-white/75">Tracker-reported round involvement rate.</td><td className="py-3 text-white/60">Use the same tracker definition when comparing samples.</td></tr>
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">Opening differential</th><td className="py-3 pr-4 text-white/75">First bloods minus first deaths.</td><td className="py-3 text-white/60">Compare over the same rounds and account for role and engagement frequency.</td></tr>
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">Clutch conversion</th><td className="py-3 pr-4 text-white/75">Clutch wins divided by clutch attempts.</td><td className="py-3 text-white/60">Always read the attempt count beside the percentage.</td></tr>
                        <tr><th className="py-3 pr-4 font-semibold text-white/85">Percentile</th><td className="py-3 pr-4 text-white/75">Position within a comparison group.</td><td className="py-3 text-white/60">This app does not have a rank, role, and agent comparison group yet.</td></tr>
                      </tbody>
                    </table>
                  </div>
                </details>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {res.dimensions.map((dimension) => (
                    <article key={dimension.key} className={`${panel} p-4 sm:p-5`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><h3 className="font-semibold">{dimension.title}</h3><p className="mt-1 text-sm text-white/60">{dimension.summary}</p></div>
                        <Chip className={dimension.status === 'unavailable' ? '!border !border-white/20 !bg-white/5 !text-white/65' : '!border !border-sky-300/30 !bg-sky-400/10 !text-sky-100'}>{dimension.status === 'observed' ? 'Data available' : dimension.status === 'partial' ? 'Partial data' : 'Unavailable'}</Chip>
                      </div>
                      <ul className="mt-4 divide-y divide-white/10">
                        {dimension.metrics.map((item) => (
                          <li key={item.name} className="py-3 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium text-white/85">{item.name}</span><span className={item.availabilityStatus === 'available' ? 'text-white' : 'text-white/50'}>{item.displayValue}</span></div>
                            <details className="mt-1 text-xs text-white/55"><summary className="w-fit cursor-pointer">Formula and evidence</summary><p className="mt-1 leading-5">Formula: {item.formula}. Source: {item.sourceFields.join(', ')}. Direction: {item.direction}. Sample: {item.sampleSize ?? 'not provided'} matches. Comparison: {item.comparisonGroup}. Confidence: {item.confidence}.</p></details>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
                <section className={`${panel} mt-4`}>
                  {res.dataWarnings.length > 0 && <div className="mb-5 rounded-lg border border-amber-300/30 bg-amber-300/10 p-4"><h3 className="font-semibold text-amber-100">Check these values</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-50/85">{res.dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                  <h3 className="font-semibold">Next data to collect</h3>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-white/70">{res.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ul>
                </section>
              </TabPanel>

              <TabPanel id="deep">
                <div className={`${panel} mt-4`}>
                  <h3 className="mb-3 font-semibold">Win rate by role</h3>
                  {Object.entries(s.roles || {}).length === 0 && <p className="text-sm text-white/60">Role-level comparisons are not available in manual entry yet.</p>}
                  {Object.entries(s.roles || {}).map(([r, v]) => <Bar key={r} label={r} value={v.wr} max={100} text={`${v.wr}% · KDA ${v.kda}`} />)}
                </div>
                <div className={`${panel} mt-4`}>
                  <h3 className="mb-3 font-semibold">Top agents</h3>
                  {(s.agents || []).length === 0 && <p className="text-sm text-white/60">Agent-level comparisons are not available in manual entry yet.</p>}
                  {(s.agents || []).map((a) => <Bar key={a.name} label={`${a.name} (${a.m} matches)`} value={a.wr} max={100} text={`${a.wr}% win · ${a.kd} K/D · ${a.adr} ADR`} />)}
                </div>
                <p className="mt-3 text-sm text-white/60">Map-level comparisons are not available in manual entry yet.</p>
              </TabPanel>

              <TabPanel id="trends">
                <div className={`${panel} mt-4`}>
                  {snaps.length < 2 && <p className="text-sm text-white/60">Complete another analysis after more matches to start a trend. Saved locally on this device.</p>}
                  {snaps.map((p, n) => {
                    const prev = snaps[n - 1];
                    const d = prev ? (p.acs - prev.acs).toFixed(1) : null;
                    return (
                      <div key={n} className="flex flex-col gap-1 border-b border-white/10 py-3 text-sm last:border-0 sm:flex-row sm:justify-between sm:gap-4">
                        <span>{p.date} · {p.type}</span>
                        <span className="text-white/70">ACS {p.acs} · KAST {p.kast}%{d !== null && ` · ${d >= 0 ? '+' : ''}${d} ACS`}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3"><Button variant="secondary" className="!border !border-white/25 !bg-[#252c34] !text-white hover:!bg-[#343d47]" onPress={() => { try { localStorage.removeItem('vpa:snaps'); } catch { /* ignore */ } setSnaps([]); }}>Clear saved data</Button></div>
              </TabPanel>

              <TabPanel id="share">
                <div className="mt-4 rounded-2xl p-6" style={{ background: 'linear-gradient(135deg,#ff4655,#7a1d2a)' }}>
                  <p className="text-sm text-white/80">My Valorant play style</p>
                  <p className="text-3xl font-extrabold">{res.name}</p>
                  <p className="mt-3 text-sm">ACS {s.acs} · ADR {s.adr} · K/D {s.kd} · KAST {s.kast}%</p>
                  {res.I.find((i) => i.t === 'pro') && <p className="mt-3 text-sm">Strength: {res.I.find((i) => i.t === 'pro').x}</p>}
                  {res.I.find((i) => i.t === 'con') && <p className="mt-1 text-sm">Working on: {res.I.find((i) => i.t === 'con').x}</p>}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" onPress={() => navigator.clipboard?.writeText(`My Valorant play style: ${res.name} (ACS ${s.acs}, KAST ${s.kast}%)`)}>Copy text</Button>
                </div>
              </TabPanel>
            </Tabs>

            <div className="mt-6"><Button variant="secondary" onPress={restart}>Analyze another profile</Button></div>
          </section>
        )}
      </div>
    </main>
  );
}

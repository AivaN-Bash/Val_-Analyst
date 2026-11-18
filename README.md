# Val Analyst

An evidence-first VALORANT player analysis prototype. It combines entered match aggregates with a 20-question decision profile, while keeping measured stats separate from self-reported tendencies.

## What it does

- Preserves the player's entered values and questionnaire answers locally with a timestamp and analytics model version.
- Shows seven independent dimensions: mechanics, opening impact, survival, team contribution, clutch performance, consistency, and adaptability.
- Shows metric formulas, source fields, sample size, comparison requirements, and whether data is available.
- Calculates K/D, KPR, ADR, opening rates, and survival rate from summed counts when their numerators and denominators are entered; retains provided aggregate values when raw totals are missing.
- Reports Wilson intervals for opening duel, clutch, and survival rates when their attempt counts are available.
- Accepts optional role and agent breakdowns manually or from screenshot extraction; example data does not fabricate those breakdowns.
- Explains how a questionnaire tendency was selected and which answers contributed to it.
- Marks unavailable comparisons instead of filling them with zero or inventing percentiles.

Consistency requires per-match records, and reliable percentiles, z-scores, Bayesian priors, metric correlations, and context-adjusted comparisons require comparison cohorts or match-level data that are not connected yet. Those measures remain unavailable rather than being estimated. Current playstyle labels describe scenario-answer tendencies; they are not verified performance classifications.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The Vite client runs on port 5173 and the Express API runs on port 8787. Manual analysis works without an API key. Set `ANTHROPIC_API_KEY` in `.env` only if you use the screenshot extraction endpoint.

## Build and deploy

```bash
npm run build
npm start
```

The production server serves `dist/` and the API from one Node process. Configure `ANTHROPIC_API_KEY` as a host secret if screenshot extraction is enabled, and serve the app over HTTPS.

## Analytics structure

- `src/analytics/player-analysis.js` validates available numeric inputs, calculates supported metrics, exposes availability and formula metadata, and creates separate survey-based tendencies.
- `src/ValorantAnalyzer.jsx` collects data and presents findings, dimensions, evidence, and recommendations.
- `server/index.js` validates screenshot-extraction responses and enforces upload limits.

Analysis snapshots are stored in browser local storage. They include the original entered form values and answers; older snapshots remain readable by the trend view.

## Security notes

- API credentials remain on the server.
- Screenshot uploads are limited to 6 MB, kept in memory, checked by file content, and never written to disk or logged.
- Screenshot extraction is rate-limited to 10 uploads per IP per 10 minutes.
- Model output is validated with Zod before it reaches the client.

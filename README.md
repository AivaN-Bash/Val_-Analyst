# Val Analyst

An evidence-first VALORANT player analyzer that runs entirely in the browser. Enter a recent match sample, answer 30 tactical questions, and review stats, tendencies, and their evidence separately. Nothing is sent to an application server.

## What it does

- Shows seven dimensions: mechanics, opening impact, survival, team contribution, clutch performance, consistency, and adaptability.
- Explains formulas, sample limits, and missing data rather than treating unavailable values as zero.
- Uses questionnaire answers to form behavioral tendencies, then shows relevant match stats as context without claiming raw values prove skill.
- Saves analysis snapshots only in this browser's local storage.
- Links to [VCT Reference](https://vct-reference.com/) for professional match research. Professional archive search is not bundled into this static version.

## Run locally

```bash
npm ci
npm run dev
```

Vite starts the app locally. No API key or backend server is required.

## Code quality

The project uses ESLint flat config, React Hooks rules, and Prettier. VS Code formats on save. Run the quality gate before pushing:

```bash
npm run check
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes the static site after each push to `main`.

1. In the GitHub repository, open **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main` or run **Deploy static site to GitHub Pages** from the **Actions** tab.

The project site URL is `https://aivan-bash.github.io/Val_-Analyst/`.

## Data and privacy

Player stats and questionnaire answers stay in the browser. This version has no server API, screenshot upload, or connected professional-data service. Its source research and external references are documented in [docs/data-sources.md](docs/data-sources.md).

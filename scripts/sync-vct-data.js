import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DuckDBInstance } from '@duckdb/node-api';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'vct-snapshots');
const STATE_PATH = path.join(DATA_DIR, 'vct-source-state.json');
const URL = 'https://vct-reference.com/dataset/vct.duckdb';
const TERMS_URL = 'https://vct-reference.com/terms';
const MAX_BYTES = 60 * 1024 * 1024;
const REQUIRED_TABLES = [
  'matches',
  'maps',
  'rounds',
  'player_map',
  'players',
  'teams',
  'notables',
  'kill_matrix',
  'stat_source',
  'feed_fill_meta',
];

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(filePath) {
  const response = await fetch(URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error(`Dataset download failed with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES)
    throw new Error('Dataset exceeds the 60 MB safety limit.');
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > MAX_BYTES ? new Error('Dataset exceeds the 60 MB safety limit.') : null,
        chunk,
      );
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    limiter,
    createWriteStream(filePath, { flags: 'wx' }),
  );
  if (bytes < 1024 * 1024) throw new Error('Dataset download was unexpectedly small.');
}

async function validateSnapshot(filePath) {
  const instance = await DuckDBInstance.create(filePath, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  try {
    const tableRows = await connection.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'",
    );
    const tableNames = new Set(tableRows.getRowObjectsJson().map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
    if (missing.length) throw new Error(`Dataset is missing tables: ${missing.join(', ')}.`);
    const summaryReader = await connection.runAndReadAll(`
      SELECT COUNT(*) AS matches, MIN(season) AS first_season, MAX(season) AS latest_season
      FROM matches WHERE listing_status = 'Completed' AND is_showmatch = FALSE
    `);
    const summary = summaryReader.getRowObjectsJson()[0];
    if (Number(summary.matches) < 100 || !summary.first_season || !summary.latest_season)
      throw new Error('Dataset passed its table check but has incomplete match history.');
    return {
      matches: Number(summary.matches),
      firstSeason: summary.first_season,
      latestSeason: summary.latest_season,
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function main() {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  const tempPath = path.join(SNAPSHOT_DIR, `.download-${process.pid}-${Date.now()}.tmp`);
  try {
    const localInput = process.argv[2] ? path.resolve(process.argv[2]) : null;
    if (localInput) {
      const info = await fs.stat(localInput);
      if (info.size > MAX_BYTES || info.size < 1024 * 1024)
        throw new Error('Local dataset size failed validation.');
      await fs.copyFile(localInput, tempPath);
    } else {
      console.log(`Downloading current snapshot from ${URL}`);
      await download(tempPath);
    }
    const digest = await sha256(tempPath);
    const snapshotFile = `${digest}.duckdb`;
    const snapshotPath = path.join(SNAPSHOT_DIR, snapshotFile);
    const summary = await validateSnapshot(tempPath);
    try {
      await fs.access(snapshotPath);
      await fs.unlink(tempPath);
    } catch {
      await fs.rename(tempPath, snapshotPath);
    }
    const state = {
      provider: 'VCT Reference',
      datasetUrl: 'https://vct-reference.com/dataset',
      downloadUrl: URL,
      termsUrl: TERMS_URL,
      methodologyUrl: 'https://vct-reference.com/methodology',
      retrievedAt: new Date().toISOString(),
      sha256: digest,
      snapshotFile,
      sizeBytes: (await fs.stat(snapshotPath)).size,
      ...summary,
    };
    const tempStatePath = `${STATE_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tempStatePath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(tempStatePath, STATE_PATH);
    console.log(
      `Installed VCT snapshot ${digest.slice(0, 12)}: ${summary.matches} completed series, seasons ${summary.firstSeason}–${summary.latestSeason}.`,
    );
    console.log(`Previous snapshots remain in ${path.relative(ROOT, SNAPSHOT_DIR)}.`);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

main().catch((error) => {
  console.error(`VCT data sync failed: ${error.message}`);
  process.exitCode = 1;
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_PATH = path.join(DATA_DIR, 'vct-source-state.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'vct-snapshots');
const SOURCE = {
  id: 'vct-reference-tier1',
  name: 'VCT Reference',
  datasetUrl: 'https://vct-reference.com/dataset',
  downloadUrl: 'https://vct-reference.com/dataset/vct.duckdb',
  termsUrl: 'https://vct-reference.com/terms',
  methodologyUrl: 'https://vct-reference.com/methodology',
};

const instances = new Map();
let routeLimit;

async function readState() {
  try {
    const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
    if (!/^[a-f0-9]{64}\.duckdb$/.test(state.snapshotFile)) return null;
    const filePath = path.join(SNAPSHOT_DIR, state.snapshotFile);
    await fs.access(filePath);
    return { ...state, filePath };
  } catch {
    return null;
  }
}

async function getConnection(state) {
  let instancePromise = instances.get(state.snapshotFile);
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(state.filePath, { access_mode: 'READ_ONLY' });
    instances.set(state.snapshotFile, instancePromise);
  }
  const instance = await instancePromise;
  return instance.connect();
}

async function withConnection(state, callback) {
  const connection = await getConnection(state);
  try {
    return await callback(connection);
  } finally {
    connection.closeSync();
  }
}

async function rows(connection, sql, params = []) {
  const result = await connection.runAndReadAll(sql, params);
  return result.getRowObjectsJson();
}

function sourceInfo(state) {
  return {
    ...SOURCE,
    snapshotRetrievedAt: state.retrievedAt,
    snapshotSha256: state.sha256,
    attribution: 'VALORANT match data supplied by VCT Reference; linked to its dataset and methodology.',
  };
}

function parseInteger(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function seasonFilter(season, parameterIndex) {
  return season === null ? '' : ` AND m.season = $${parameterIndex}`;
}

async function playerSeasons(connection, playerId) {
  return rows(connection, `
    SELECT DISTINCT m.season
    FROM player_map pm JOIN matches m USING (match_id)
    WHERE pm.player_id = $1 AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE
    ORDER BY m.season DESC
  `, [playerId]);
}

async function playerSummary(connection, playerId, season) {
  const seasonClause = seasonFilter(season, 2);
  const params = season === null ? [playerId] : [playerId, season];
  const result = await rows(connection, `
    WITH round_counts AS (
      SELECT match_id, game_id, COUNT(*)::INTEGER AS rounds
      FROM rounds GROUP BY match_id, game_id
    ), sample AS (
      SELECT pm.*, m.season, m.team0_id, m.team1_id, m.score0, m.score1,
             COALESCE(rc.rounds, mp.score0 + mp.score1) AS round_count,
             mp.performance_available
      FROM player_map pm
      JOIN matches m USING (match_id)
      JOIN maps mp USING (match_id, game_id)
      LEFT JOIN round_counts rc USING (match_id, game_id)
      WHERE pm.player_id = $1 AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE${seasonClause}
    ), series AS (
      SELECT season, match_id, MAX(team_idx) AS team_idx,
             MAX(team0_id) AS team0_id, MAX(team1_id) AS team1_id,
             MAX(score0) AS score0, MAX(score1) AS score1,
             BOOL_OR(performance_available) AS has_performance
      FROM sample GROUP BY season, match_id
    ), per_map AS (
      SELECT season,
        COUNT(*) AS maps_played,
        COUNT(*) FILTER (WHERE performance_available) AS performance_maps,
        SUM(round_count) FILTER (WHERE performance_available) AS rounds,
        SUM(kills_all) FILTER (WHERE performance_available) AS kills,
        SUM(deaths_all) FILTER (WHERE performance_available) AS deaths,
        SUM(assists_all) FILTER (WHERE performance_available) AS assists,
        SUM(fk_all) FILTER (WHERE performance_available) AS first_bloods,
        SUM(fd_all) FILTER (WHERE performance_available) AS first_deaths,
        SUM(acs_all * round_count) FILTER (WHERE performance_available AND acs_all IS NOT NULL)
          / NULLIF(SUM(round_count) FILTER (WHERE performance_available AND acs_all IS NOT NULL), 0) AS acs,
        SUM(adr_all * round_count) FILTER (WHERE performance_available AND adr_all IS NOT NULL)
          / NULLIF(SUM(round_count) FILTER (WHERE performance_available AND adr_all IS NOT NULL), 0) AS adr,
        SUM(kast_all * round_count) FILTER (WHERE performance_available AND kast_all IS NOT NULL)
          / NULLIF(SUM(round_count) FILTER (WHERE performance_available AND kast_all IS NOT NULL), 0) AS kast,
        SUM(hs_pct_all * round_count) FILTER (WHERE performance_available AND hs_pct_all IS NOT NULL)
          / NULLIF(SUM(round_count) FILTER (WHERE performance_available AND hs_pct_all IS NOT NULL), 0) AS hs_pct,
        COUNT(*) FILTER (WHERE performance_available AND fk_all IS NOT NULL AND fd_all IS NOT NULL) AS opening_stat_maps
      FROM sample GROUP BY season
    ), per_series AS (
      SELECT season, COUNT(*) AS matches_played,
        COUNT(*) FILTER (WHERE has_performance) AS matches_with_performance,
        COUNT(*) FILTER (WHERE (team_idx = 0 AND score0 > score1) OR (team_idx = 1 AND score1 > score0)) AS series_wins
      FROM series GROUP BY season
    )
    SELECT p.season, s.matches_played, s.matches_with_performance, p.maps_played,
      p.performance_maps, p.opening_stat_maps, p.rounds, p.kills, p.deaths, p.assists,
      p.first_bloods, p.first_deaths, p.acs, p.adr, p.kast, p.hs_pct,
      s.series_wins,
      100.0 * s.series_wins / NULLIF(s.matches_played, 0) AS series_win_pct,
      p.kills::DOUBLE / NULLIF(p.rounds, 0) AS kills_per_round,
      p.kills::DOUBLE / NULLIF(p.deaths, 0) AS kd
    FROM per_map p JOIN per_series s USING (season)
    ORDER BY p.season DESC
  `, params);
  return result;
}

async function playerAgents(connection, playerId, season) {
  const seasonClause = seasonFilter(season, 2);
  const params = season === null ? [playerId] : [playerId, season];
  return rows(connection, `
    WITH round_counts AS (
      SELECT match_id, game_id, COUNT(*)::INTEGER AS rounds FROM rounds GROUP BY match_id, game_id
    ), selected AS (
      SELECT pm.*, m.season, m.match_id, mp.performance_available,
        COALESCE(rc.rounds, mp.score0 + mp.score1) AS round_count
      FROM player_map pm
      JOIN matches m USING (match_id)
      JOIN maps mp USING (match_id, game_id)
      LEFT JOIN round_counts rc USING (match_id, game_id)
      WHERE pm.player_id = $1 AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE${seasonClause}
        AND mp.performance_available
    )
    SELECT LOWER(a.agent) AS agent, COUNT(*) AS maps_played,
      COUNT(DISTINCT s.match_id) AS matches_played,
      SUM(s.round_count) AS rounds,
      SUM(s.kills_all) AS kills, SUM(s.deaths_all) AS deaths, SUM(s.assists_all) AS assists,
      SUM(s.acs_all * s.round_count) / NULLIF(SUM(s.round_count) FILTER (WHERE s.acs_all IS NOT NULL), 0) AS acs,
      SUM(s.adr_all * s.round_count) / NULLIF(SUM(s.round_count) FILTER (WHERE s.adr_all IS NOT NULL), 0) AS adr,
      SUM(s.kast_all * s.round_count) / NULLIF(SUM(s.round_count) FILTER (WHERE s.kast_all IS NOT NULL), 0) AS kast
    FROM selected s CROSS JOIN UNNEST(s.agents) AS a(agent)
    GROUP BY LOWER(a.agent) ORDER BY maps_played DESC, agent
  `, params);
}

async function playerMaps(connection, playerId, season, limit) {
  const seasonClause = seasonFilter(season, 2);
  const params = season === null ? [playerId, limit] : [playerId, season, limit];
  const limitPlaceholder = season === null ? '$2' : '$3';
  return rows(connection, `
    SELECT m.match_id, m.utc_timestamp, m.season, m.event, m.event_url, m.patch,
      m.url AS match_source_url, own.team_name AS team, opponent.team_name AS opponent,
      m.score0 AS series_score0, m.score1 AS series_score1, pm.team_idx,
      mp.game_id, mp.map_name, mp.score0 AS map_score0, mp.score1 AS map_score1,
      CASE WHEN pm.team_idx = 0 THEN mp.score0 ELSE mp.score1 END AS player_map_score,
      CASE WHEN pm.team_idx = 0 THEN mp.score1 ELSE mp.score0 END AS opponent_map_score,
      mp.performance_available, mp.economy_available,
      pm.agents, pm.kills_all AS kills, pm.deaths_all AS deaths, pm.assists_all AS assists,
      pm.acs_all AS acs, pm.adr_all AS adr, pm.kast_all AS kast,
      pm.fk_all AS first_bloods, pm.fd_all AS first_deaths
    FROM player_map pm
    JOIN matches m USING (match_id)
    JOIN maps mp USING (match_id, game_id)
    JOIN teams own ON own.team_id = CASE pm.team_idx WHEN 0 THEN m.team0_id ELSE m.team1_id END
    JOIN teams opponent ON opponent.team_id = CASE pm.team_idx WHEN 0 THEN m.team1_id ELSE m.team0_id END
    WHERE pm.player_id = $1 AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE${seasonClause}
    ORDER BY m.utc_timestamp DESC NULLS LAST, mp.game_id DESC LIMIT ${limitPlaceholder}
  `, params);
}

async function teamSeasons(connection, teamId) {
  return rows(connection, `
    SELECT DISTINCT season FROM matches
    WHERE (team0_id = $1 OR team1_id = $1) AND listing_status = 'Completed' AND is_showmatch = FALSE
    ORDER BY season DESC
  `, [teamId]);
}

async function teamProfile(connection, teamId, season) {
  const team = await rows(connection, 'SELECT team_id, team_name, country, team_url FROM teams WHERE team_id = $1', [teamId]);
  if (!team.length) return null;
  const seasons = await teamSeasons(connection, teamId);
  const actualSeason = season ?? seasons[0]?.season ?? null;
  const seasonClause = seasonFilter(actualSeason, 2);
  const params = actualSeason === null ? [teamId] : [teamId, actualSeason];
  const matchRows = await rows(connection, `
    SELECT m.match_id, m.utc_timestamp, m.season, m.event, m.series_stage, m.series_round,
      m.patch, m.format, m.url AS match_source_url,
      own.team_name AS team, opponent.team_name AS opponent,
      CASE WHEN m.team0_id = $1 THEN m.score0 ELSE m.score1 END AS team_score,
      CASE WHEN m.team0_id = $1 THEN m.score1 ELSE m.score0 END AS opponent_score,
      CASE WHEN (m.team0_id = $1 AND m.score0 > m.score1) OR (m.team1_id = $1 AND m.score1 > m.score0) THEN TRUE ELSE FALSE END AS won
    FROM matches m
    JOIN teams own ON own.team_id = $1
    JOIN teams opponent ON opponent.team_id = CASE WHEN m.team0_id = $1 THEN m.team1_id ELSE m.team0_id END
    WHERE (m.team0_id = $1 OR m.team1_id = $1) AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE${seasonClause}
    ORDER BY m.utc_timestamp DESC NULLS LAST LIMIT 50
  `, params);
  const aggregate = await rows(connection, `
    WITH results AS (
      SELECT m.match_id, m.season, m.team0_id, m.score0, m.score1,
        CASE WHEN (m.team0_id = $1 AND m.score0 > m.score1) OR (m.team1_id = $1 AND m.score1 > m.score0) THEN 1 ELSE 0 END AS won
      FROM matches m WHERE (m.team0_id = $1 OR m.team1_id = $1)
        AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE${seasonClause}
    ), map_results AS (
      SELECT mp.match_id, mp.game_id, mp.map_name, mp.score0, mp.score1, mp.performance_available,
        CASE WHEN r.team0_id = $1 THEN mp.score0 ELSE mp.score1 END AS team_score,
        CASE WHEN r.team0_id = $1 THEN mp.score1 ELSE mp.score0 END AS opponent_score
      FROM maps mp JOIN results r USING (match_id)
    )
    SELECT COUNT(DISTINCT r.match_id) AS matches,
      COUNT(DISTINCT r.match_id) FILTER (WHERE r.won = 1) AS series_wins,
      100.0 * COUNT(DISTINCT r.match_id) FILTER (WHERE r.won = 1) / NULLIF(COUNT(DISTINCT r.match_id), 0) AS series_win_pct,
      COUNT(mr.game_id) AS maps,
      COUNT(*) FILTER (WHERE mr.performance_available) AS performance_maps,
      COUNT(*) FILTER (WHERE mr.team_score > mr.opponent_score) AS map_wins,
      100.0 * COUNT(*) FILTER (WHERE mr.team_score > mr.opponent_score) / NULLIF(COUNT(mr.game_id), 0) AS map_win_pct
    FROM results r LEFT JOIN map_results mr USING (match_id)
  `, params);
  const mapPool = await rows(connection, `
    WITH results AS (
      SELECT m.match_id, m.team0_id FROM matches m
      WHERE (m.team0_id = $1 OR m.team1_id = $1) AND m.listing_status = 'Completed' AND m.is_showmatch = FALSE${seasonClause}
    )
    SELECT mp.map_name, COUNT(*) AS maps,
      COUNT(*) FILTER (WHERE (r.team0_id = $1 AND mp.score0 > mp.score1) OR (r.team0_id <> $1 AND mp.score1 > mp.score0)) AS map_wins
    FROM maps mp JOIN results r USING (match_id)
    GROUP BY mp.map_name ORDER BY maps DESC, mp.map_name
  `, params);
  return { team: team[0], season: actualSeason, seasons, summary: aggregate[0] || null, mapPool, matches: matchRows };
}

export async function registerVctRoutes(app) {
  const { default: rateLimit } = await import('express-rate-limit');
  routeLimit = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false });
  app.get('/api/vct/status', async (_request, response) => {
    const state = await readState();
    if (!state) return response.json({ available: false, source: SOURCE, updateCommand: 'npm run data:sync' });
    try {
      const status = await withConnection(state, async (connection) => (await rows(connection, `
        SELECT COUNT(DISTINCT match_id) AS matches,
          MIN(season) AS first_season, MAX(season) AS latest_season,
          MIN(utc_timestamp) AS first_match, MAX(utc_timestamp) AS latest_match
        FROM matches WHERE listing_status = 'Completed' AND is_showmatch = FALSE
      `))[0]);
      const mapCount = await withConnection(state, (connection) => rows(connection, `
        SELECT COUNT(*) AS maps FROM maps mp JOIN matches m USING (match_id)
        WHERE m.listing_status = 'Completed' AND m.is_showmatch = FALSE
      `));
      const coverageByRegion = await withConnection(state, (connection) => rows(connection, `
        SELECT m.season, COALESCE(NULLIF(m.region, ''), 'International') AS region,
          COUNT(*) AS maps,
          COUNT(*) FILTER (WHERE mp.performance_available) AS performance_maps,
          COUNT(*) FILTER (WHERE mp.economy_available) AS economy_maps
        FROM maps mp JOIN matches m USING (match_id)
        WHERE m.listing_status = 'Completed' AND m.is_showmatch = FALSE
          AND m.season = (SELECT MAX(season) FROM matches WHERE listing_status = 'Completed' AND is_showmatch = FALSE)
        GROUP BY m.season, region ORDER BY region
      `));
      return response.json({ available: true, source: sourceInfo(state), ...status, maps: mapCount[0]?.maps ?? 0, coverageByRegion });
    } catch {
      return response.status(503).json({ available: false, error: 'VCT dataset could not be opened.' });
    }
  });

  app.get('/api/vct/search', routeLimit, async (request, response) => {
    const query = String(request.query.q || '').trim();
    if (query.length < 2 || query.length > 80) return response.status(400).json({ error: 'Search text must be between 2 and 80 characters.' });
    const state = await readState();
    if (!state) return response.status(503).json({ error: 'Professional VCT data is not installed. Run npm run data:sync.' });
    try {
      const results = await withConnection(state, (connection) => rows(connection, `
        SELECT kind, id, name, country FROM (
          SELECT 'player' AS kind, player_id AS id, player_name AS name, country
          FROM players WHERE player_name ILIKE $1
          UNION ALL
          SELECT 'team' AS kind, team_id AS id, team_name AS name, country
          FROM teams WHERE team_name ILIKE $1
        ) q ORDER BY kind, name LIMIT 20
      `, [`%${query}%`]));
      return response.json({ query, results, source: sourceInfo(state) });
    } catch {
      return response.status(503).json({ error: 'Professional data search is temporarily unavailable.' });
    }
  });

  app.get('/api/vct/players/:playerId/profile', routeLimit, async (request, response) => {
    const playerId = parseInteger(request.params.playerId);
    const season = request.query.season === undefined ? null : parseInteger(request.query.season, { min: 2021, max: 2100 });
    if (playerId === null || (request.query.season !== undefined && season === null)) return response.status(400).json({ error: 'Player ID or season is invalid.' });
    const state = await readState();
    if (!state) return response.status(503).json({ error: 'Professional VCT data is not installed. Run npm run data:sync.' });
    try {
      const profile = await withConnection(state, async (connection) => {
        const player = await rows(connection, 'SELECT player_id, player_name, country FROM players WHERE player_id = $1', [playerId]);
        if (!player.length) return null;
        const seasons = await playerSeasons(connection, playerId);
        const selectedSeason = season ?? seasons[0]?.season ?? null;
        const seasonStats = await playerSummary(connection, playerId, selectedSeason);
        const agents = await playerAgents(connection, playerId, selectedSeason);
        const maps = await playerMaps(connection, playerId, selectedSeason, 20);
        return { player: player[0], season: selectedSeason, seasons, stats: seasonStats.find((row) => row.season === selectedSeason) || null, agentBreakdown: agents, recentMaps: maps };
      });
      if (!profile) return response.status(404).json({ error: 'VCT player was not found.' });
      return response.json({ ...profile, source: sourceInfo(state) });
    } catch (error) {
      console.error('VCT player profile query failed:', error?.message);
      return response.status(503).json({ error: 'Professional player data is temporarily unavailable.' });
    }
  });

  app.get('/api/vct/teams/:teamId/profile', routeLimit, async (request, response) => {
    const teamId = parseInteger(request.params.teamId);
    const season = request.query.season === undefined ? null : parseInteger(request.query.season, { min: 2021, max: 2100 });
    if (teamId === null || (request.query.season !== undefined && season === null)) return response.status(400).json({ error: 'Team ID or season is invalid.' });
    const state = await readState();
    if (!state) return response.status(503).json({ error: 'Professional VCT data is not installed. Run npm run data:sync.' });
    try {
      const profile = await withConnection(state, (connection) => teamProfile(connection, teamId, season));
      if (!profile) return response.status(404).json({ error: 'VCT team was not found.' });
      return response.json({ ...profile, source: sourceInfo(state) });
    } catch (error) {
      console.error('VCT team profile query failed:', error?.message);
      return response.status(503).json({ error: 'Professional team data is temporarily unavailable.' });
    }
  });

  app.get('/api/vct/matches/:matchId', routeLimit, async (request, response) => {
    const matchId = String(request.params.matchId || '');
    if (!/^\d{1,20}$/.test(matchId)) return response.status(400).json({ error: 'Match ID is invalid.' });
    const state = await readState();
    if (!state) return response.status(503).json({ error: 'Professional VCT data is not installed. Run npm run data:sync.' });
    try {
      const match = await withConnection(state, async (connection) => {
        const series = await rows(connection, `
          SELECT m.*, t0.team_name AS team0, t1.team_name AS team1
          FROM matches m JOIN teams t0 ON t0.team_id = m.team0_id JOIN teams t1 ON t1.team_id = m.team1_id
          WHERE m.match_id = $1 AND m.listing_status = 'Completed'
        `, [matchId]);
        if (!series.length) return null;
        const maps = await rows(connection, `
          SELECT mp.*, m.season, m.event, m.patch, m.utc_timestamp
          FROM maps mp JOIN matches m USING (match_id) WHERE mp.match_id = $1 ORDER BY mp.game_id
        `, [matchId]);
        const players = await rows(connection, `
          SELECT pm.game_id, pm.team_idx, pm.player_id, p.player_name, pm.agents,
            pm.rating_all, pm.acs_all, pm.adr_all, pm.kills_all, pm.deaths_all, pm.assists_all,
            pm.fk_all, pm.fd_all, pm.kast_all, pm.hs_pct_all
          FROM player_map pm JOIN players p USING (player_id)
          WHERE pm.match_id = $1 ORDER BY pm.game_id, pm.team_idx, pm.player_id
        `, [matchId]);
        return { match: series[0], maps: maps.map((map) => ({ ...map, players: players.filter((player) => player.game_id === map.game_id) })) };
      });
      if (!match) return response.status(404).json({ error: 'VCT match was not found.' });
      return response.json({ ...match, source: sourceInfo(state) });
    } catch (error) {
      console.error('VCT match query failed:', error?.message);
      return response.status(503).json({ error: 'Professional match data is temporarily unavailable.' });
    }
  });

  app.get('/api/vct/matches/:matchId/maps/:gameId/rounds', routeLimit, async (request, response) => {
    const matchId = String(request.params.matchId || '');
    const gameId = String(request.params.gameId || '');
    if (!/^\d{1,20}$/.test(matchId) || !/^\d{1,20}$/.test(gameId)) return response.status(400).json({ error: 'Match or map ID is invalid.' });
    const state = await readState();
    if (!state) return response.status(503).json({ error: 'Professional VCT data is not installed. Run npm run data:sync.' });
    try {
      const result = await withConnection(state, (connection) => rows(connection, `
        SELECT r.match_id, r.game_id, r.round_num, r.winner_team, r.side, r.outcome,
          r.loadout_t0, r.loadout_t1, r.bank_t0, r.bank_t1
        FROM rounds r JOIN maps mp USING (match_id, game_id)
        WHERE r.match_id = $1 AND r.game_id = $2
        ORDER BY r.round_num
      `, [matchId, gameId]));
      return response.json({ matchId, gameId, rounds: result, source: sourceInfo(state) });
    } catch (error) {
      console.error('VCT rounds query failed:', error?.message);
      return response.status(503).json({ error: 'Round data is temporarily unavailable.' });
    }
  });
}

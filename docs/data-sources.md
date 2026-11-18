# VALORANT data sources and coverage

Reviewed 18 November 2026. Source terms and access can change; check the linked source before expanding collection.

## Integrated source

| Source                                                     | Data integrated                                                                                                                                                                                                       | Coverage and caveats                                                                                                                                                                                                                                                                                                                                                             | Access and attribution                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [VCT Reference dataset](https://vct-reference.com/dataset) | Professional series, maps, player-map records, agent picks, round outcomes and economy snapshots; teams, players, events, patches, source links, and clutch/notable event tables are retained in the DuckDB snapshot. | The publisher reports tier-one VCT from 2021 onward. Coverage varies by year and region. 2021–22 is curated; later years focus on franchised leagues, Masters, and Champions. The latest snapshot's own map flags are shown by region. China can have match and map scores while player/economy performance blocks are absent. Not ranked history or all Challengers/qualifiers. | Downloadable DuckDB, daily rebuilt by publisher. The publisher describes reuse as free, including commercial use, under its terms; attribution is included in app results. Do not redistribute as if this app created the data. |

The app retains every downloaded file by SHA-256 under `data/vct-snapshots/` and uses a local state pointer to select the active version. The database is not committed to Git. API responses expose the source name, dataset/methodology/terms links, retrieval time, snapshot hash, and a source attribution. Queries use source IDs (`match_id`, `game_id`, `player_id`, `team_id`) and preserve the original season, event, patch, UTC timestamp, and source URL where available.

### Current API coverage

- `/api/vct/status`: available seasons, record counts, latest source snapshot, and the latest season's performance/economy coverage by region.
- `/api/vct/search?q=...`: player/team search.
- `/api/vct/players/:playerId/profile?season=...`: separate season totals, agent-map splits, and recent map history. Weighted per-round stats use recorded round counts; map performance coverage is explicit.
- `/api/vct/teams/:teamId/profile?season=...`: series/map results, map pool, event and patch linked match history.
- `/api/vct/matches/:matchId`: series, map scores and per-map player stats where present.
- `/api/vct/matches/:matchId/maps/:gameId/rounds`: round outcome and recorded team loadout/bank snapshots.

No percentiles or rank/role-adjusted conclusions are produced from this dataset alone. Scores and rates are descriptive; no missing value is converted to zero. Team series win rates are calculated on unique series, independently from map totals. Source records do not by themselves prove tactical cause or individual round impact.

## Researched sources not automatically collected

| Source                                                                  | Value                                                                                               | Access decision                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Riot Developer API](https://developer.riotgames.com/docs/valorant)     | Official APIs cover game content and opt-in player match data.                                      | Not a public historical VCT archive. Identified player access requires Riot Sign On opt-in; Riot restricts opponent scouting. Integrate only for an approved use and consented users, not as a professional-history substitute. |
| [Riot Esports Data / GRID](https://riotesportsdata.com/en-us/valorant/) | Official granular esports feeds, including live match/event data and richer game-state information. | Current access is commercial/partner based. No credentials or license are available in this project, so it is not queried.                                                                                                      |
| [VLR.gg terms](https://www.vlr.gg/terms)                                | Broad historical match and player stats.                                                            | Terms restrict automated access, scraping, and systematic collection into a database without written permission. No crawler is used. Seek permission before integrating.                                                        |
| [rib.gg terms](https://rib.gg/terms)                                    | Professional match, replay, and player statistics.                                                  | Useful for manual research; terms prohibit disruptive scraping. No public supported export/API was identified during this review. No automated collection is used.                                                              |
| [THESPIKE stats](https://www.thespike.gg/valorant-stats)                | Player, team, event, agent, map and weapon stat pages.                                              | Public pages are useful for manual cross-checking. No supported public bulk API/export was identified, so this app does not scrape it.                                                                                          |
| [Liquipedia API](https://liquipedia.net/api)                            | Tournament, event and placement reference data.                                                     | API access requires applying/contacting Liquipedia; no project key was available. Do not scrape pages as a substitute for access.                                                                                               |

## Data not currently available from the integrated public snapshot

The explorer does not claim to contain player positioning, movement, utility usage/damage, full weapon purchase timelines, complete replay files, or a universal map-side split. Round snapshots are not full tick/event telemetry. Clutch/notable records are retained in the source database but are not yet presented as validated player clutch-attempt rates. These generally require a licensed granular feed, a documented public event dataset, or manual VOD review. Do not infer them from scoreboard aggregates.

## Reconciliation and update policy

1. Keep source-native identifiers and source links; do not merge identities by display name alone.
2. Preserve immutable source snapshots and retrieval hashes. Refreshing the pointer never overwrites an older snapshot.
3. Treat availability flags and nulls as unknown/missing. Never impute a zero for absent source coverage.
4. If a future separately licensed source disagrees with VCT Reference, retain both source values and provenance. Do not silently overwrite one source with another; select a documented preferred source per field only after checking definitions and event coverage.
5. Do not automatically collect from VLR, rib.gg, THESPIKE, Liquipedia, or Riot/GRID feeds without an approved API, written permission, or applicable license.

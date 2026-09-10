// sleeper.js - every live read from Sleeper.
//
// HOST RULE: api.sleeper.com, NEVER api.sleeper.app. The .app host returns
// 200s with empty rosters and stats-less projections - healthy-looking wrong
// data, which is worse than an error. Cost a whole session in September 2026.
//
// The projections endpoint lives OUTSIDE /v1/. That is not a typo.
//
// NEVER send order_by=ppr: it silently collapses `stats` to {adp_dd_ppr} only.

const V1   = "https://api.sleeper.com/v1/";
const ROOT = "https://api.sleeper.com/";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${url}`);
  return r.json();
}

export const state    = ()   => get(`${V1}state/nfl`);
export const league   = (id) => get(`${V1}league/${id}`);
export const rosters  = (id) => get(`${V1}league/${id}/rosters`);
export const users    = (id) => get(`${V1}league/${id}/users`);
export const matchups = (id, wk) => get(`${V1}league/${id}/matchups/${wk}`);
export const trending = (hrs = 24, limit = 25) =>
  get(`${V1}players/nfl/trending/add?lookback_hours=${hrs}&limit=${limit}`);

// Weekly projections for the whole league-eligible player universe.
//
// The rows EMBED player metadata - name, position, team, opponent and
// injury_status - so this one call replaces the 5 MB /v1/players/nfl dump.
// Returns a Map keyed by player_id (team abbreviation for DEF).
export async function weekProjections(season, week) {
  const qs = POSITIONS.map((p) => `position[]=${p}`).join("&");
  const rows = await get(
    `${ROOT}projections/nfl/${season}/${week}?season_type=regular&${qs}`
  );
  const map = new Map();
  for (const row of rows) {
    if (!row.player_id) continue;
    map.set(String(row.player_id), {
      id:       String(row.player_id),
      name:     playerName(row),
      pos:      row.player?.position || row.player?.fantasy_positions?.[0] || "",
      team:     row.team || row.player?.team || "",
      opponent: row.opponent || "",
      injury:   row.player?.injury_status || null,
      injuryPart: row.player?.injury_body_part || null,
      stats:    row.stats || {},
      gameId:   row.game_id || null,
      updated:  row.last_modified || null,
    });
  }
  return map;
}

// Rest-of-season outlook for ONE player: all 18 weeks in a single request.
// Byes come back as null, which is indistinguishable from missing data -
// callers must not treat a null week as a confirmed bye without the schedule.
export const playerSeason = (id, season) =>
  get(`${ROOT}projections/nfl/player/${id}?season=${season}&season_type=regular&grouping=week`);

function playerName(row) {
  const p = row.player || {};
  if (p.first_name || p.last_name) return `${p.first_name || ""} ${p.last_name || ""}`.trim();
  return String(row.player_id); // DEF rows carry the team abbreviation as the id
}

export { POSITIONS };

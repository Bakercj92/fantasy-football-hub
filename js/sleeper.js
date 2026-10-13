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

// WHICH WEEK IS "NOW" DEPENDS ON WHICH QUESTION YOU ARE ASKING, AND
// /state/nfl ANSWERS BOTH AT ONCE.
//
// `week` is the week in progress or about to be. `display_week` is what
// Sleeper's own app is SHOWING, which on waiver night is still the week that
// just finished - measured live 2026-10-06: display_week 4, week 5. It rolls
// forward on its own at some point around when claims clear.
//
// This distinction lives here, beside the fetch, because it is a fact about
// Sleeper's payload rather than about this page. app.js reading the wrong one
// priced the wire, the lineup check and every replacement level against a week
// already in the books, on the one night of the week that decision is live.
const wk = (v) => {
  const i = Number(v);
  return Number.isInteger(i) && i > 0 ? i : null;
};

// The week being PRICED: projections, kickoff locking, waivers, replacement
// levels, rest-of-season. Always the forward-looking one.
//
// `week` IS ONLY THE RIGHT ANSWER IN THE REGULAR SEASON. weekProjections()
// hardcodes season_type=regular, so a postseason `week` of 19 asks that
// endpoint for a week it does not have, `priced` comes back empty and every
// surface on the page blanks - strictly worse than the display_week read it
// replaced. Preseason has the mirror of that problem: if `week` is a PRESEASON
// counter, August would price against regular-season week 3.
//
// So outside the regular season, defer to what Sleeper is displaying, and clamp
// to a week that endpoint can actually answer. Caught in audit, not in the
// wild - the only /state/nfl payload this project has ever measured is
// 2026-10-06 (regular, display_week 4, week 5).
const REG_WEEKS = 18;
export function pricingWeek(nfl) {
  const type = nfl?.season_type;
  const shown = wk(nfl?.display_week);
  const now = wk(nfl?.week);
  // Outside the regular season, take the SMALLEST week any field claims rather
  // than preferring display_week: in the offseason Sleeper can show week 18 of
  // the season just ended beside week 1 of the next, and preferring the shown
  // one priced February against week 18. Min is correct for all three - post
  // (18 vs 19), pre (1 vs 3) and off (18 vs 1).
  const pick = (type && type !== "regular")
    ? Math.min(...[shown, now].filter((v) => v !== null))
    : (now ?? shown);
  return Math.min(Number.isFinite(pick) ? pick : 1, REG_WEEKS) || 1;
}

// The completed week, for LABELLING backward-looking surfaces - and null when
// it is the same week being priced, which is true for most of the week. Null
// rather than a duplicate so the UI has nothing to print when there is nothing
// to distinguish.
export function gradedWeek(nfl) {
  const shown = wk(nfl?.display_week);
  // EARLIER, not merely different. "Different" labelled week 18 as complete on
  // the week-1 page at season rollover - a week that has not happened yet,
  // announced as being in the books. Caught in audit.
  return shown !== null && shown < pricingWeek(nfl) ? shown : null;
}

export { POSITIONS };

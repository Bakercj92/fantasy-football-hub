import * as sleeper from "./sleeper.js";
import { rescore, isFloorOnly, willNotPlay } from "./scoring.js";
import { startingSlots, optimalLineup, decisions } from "./lineup.js";
import { rosteredIds, replacementLevels, vor, sigmaTable, threshold } from "./value.js";
import { consensus, disagreements } from "./market.js";
import { render, renderError, setLoading } from "./ui.js";

const state = {
  cfg: null, week: null, season: null, projections: null,
  leagues: {}, active: null, market: null,
};

async function boot() {
  try {
    setLoading("Reading league config");
    state.cfg = await (await fetch("./leagues.json")).json();

    setLoading("Asking Sleeper what week it is");
    const nfl = await sleeper.state();
    state.season = nfl.season;
    state.week = nfl.display_week || nfl.week || 1;

    setLoading(`Pulling week ${state.week} projections`);
    state.projections = await sleeper.weekProjections(state.season, state.week);

    setLoading("Reading your leagues");
    await Promise.all(state.cfg.leagues.map(loadLeague));

    state.active = state.cfg.leagues[0].key;
    paint();

    // The market layer is an enrichment, not a dependency. The page is
    // already useful and already painted; this arrives late and re-renders.
    // If it never arrives, nothing above it changes.
    consensus().then((m) => { state.market = m; attachMarket(); paint(); });
  } catch (err) {
    renderError(err);
  }
}

async function loadLeague(entry) {
  const [league, allRosters] = await Promise.all([
    sleeper.league(entry.sleeper_id),
    sleeper.rosters(entry.sleeper_id),
  ]);
  const mine = allRosters.find((r) => r.owner_id === state.cfg.user_id);
  if (!mine) throw new Error(`No roster owned by ${state.cfg.user_id} in ${entry.name}`);

  const scoring = league.scoring_settings;
  const slots = startingSlots(league.roster_positions);

  // Price the ENTIRE player universe at this league's rules, not just the
  // roster: replacement level is a fact about who is free, and that cannot
  // be computed from the roster alone.
  const priced = new Map();
  for (const [id, proj] of state.projections) {
    const scored = rescore(proj.stats, scoring);
    priced.set(id, {
      id, name: proj.name, pos: proj.pos, team: proj.team,
      opponent: proj.opponent, injury: proj.injury,
      pts: scored ? Math.round(scored.pts * 100) / 100 : null,
      why: scored?.contributions?.slice(0, 4) || [],
      floorOnly: isFloorOnly(proj.pos, scoring),
      startable: !willNotPlay(proj.injury),
      hasProjection: true,
    });
  }

  const rostered = rosteredIds(allRosters);
  const levels = replacementLevels(priced, rostered);
  const sigma = sigmaTable(priced, slots, league.total_rosters);

  const byId = new Map();
  const roster = (mine.players || []).map((id) => {
    const p = priced.get(String(id)) || {
      id: String(id), name: String(id), pos: "", team: "", opponent: "",
      injury: null, pts: null, why: [], floorOnly: false,
      startable: false, hasProjection: false,
    };
    const withValue = { ...p, vor: vor(p, levels) };
    byId.set(withValue.id, withValue);
    return withValue;
  });

  const optimal = optimalLineup(slots, roster);
  const calls = decisions(mine.starters || [], optimal, byId,
    (positions) => threshold(sigma, ...positions));

  // Best free agent per position, for the waiver layer and for showing what
  // "replacement" actually means in this league rather than as an abstraction.
  const freeBest = {};
  for (const [pos, lv] of Object.entries(levels)) freeBest[pos] = lv;

  state.leagues[entry.key] = {
    entry, league, roster, byId, slots, optimal, calls, priced,
    levels, sigma, freeBest,
    starters: mine.starters || [],
    faabLeft: (league.settings?.waiver_budget ?? 0) - (mine.settings?.waiver_budget_used ?? 0),
    teams: league.total_rosters,
    rosteredCount: rostered.size,
  };
}

function attachMarket() {
  if (!state.market?.ok) return;
  for (const L of Object.values(state.leagues)) {
    for (const p of L.roster) p.market = state.market.byId.get(p.id) || null;
    for (const p of L.byId.values()) p.market = state.market.byId.get(p.id) || null;
    L.disagreements = disagreements(L.roster, state.market, L.priced);
  }
}

function paint() { render(state, (key) => { state.active = key; paint(); }); }

boot();
export { state };

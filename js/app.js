import * as sleeper from "./sleeper.js";
import { rescore, isFloorOnly, willNotPlay } from "./scoring.js";
import { startingSlots, optimalLineup, decisions, missedCalls } from "./lineup.js";
import { rosteredIds, replacementLevels, vor, sigmaTable, threshold } from "./value.js";
import { consensus, disagreements } from "./market.js";
import * as sched from "./schedule.js";
import { recordMissed } from "./memory.js";
import { render, renderError, setLoading } from "./ui.js";

const state = {
  cfg: null, week: null, season: null, projections: null,
  leagues: {}, active: null, market: null,
  schedule: null,
  // One timestamp for the whole solve. Reading Date.now() separately at each
  // lock check would let a game kick off halfway through a render and produce
  // a lineup that is internally inconsistent.
  now: Date.now(),
};

async function boot() {
  try {
    setLoading("Reading league config");
    state.cfg = await (await fetch("./leagues.json")).json();

    setLoading("Asking Sleeper what week it is");
    const nfl = await sleeper.state();
    state.season = nfl.season;
    state.week = nfl.display_week || nfl.week || 1;

    setLoading(`Pulling week ${state.week} projections and the schedule`);
    // The schedule is NOT a late enrichment like the market layer. Locking is
    // a correctness feature, so it has to be in hand before the first solve -
    // a lineup painted without it can show a call that is already impossible.
    const [projections, schedule] = await Promise.all([
      sleeper.weekProjections(state.season, state.week),
      sched.load(state.season, { now: state.now }),
    ]);
    state.projections = projections;
    state.schedule = schedule;

    setLoading("Reading your leagues");
    await Promise.all(state.cfg.leagues.map(loadLeague));

    state.active = state.cfg.leagues[0].key;
    paint();
    watchKickoffs();

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
    // Kickoff and the Vegas line, joined on team. normTeam() inside teamGame
    // handles Sleeper's LAR against nflverse's LA - see schedule.js.
    const game = sched.teamGame(state.schedule, proj.team, state.week);
    priced.set(id, {
      id, name: proj.name, pos: proj.pos, team: proj.team,
      opponent: proj.opponent, injury: proj.injury,
      game,
      locked: sched.hasKickedOff(game?.kickoffUTC, state.now),
      vegas: game?.hasLine
        ? { spread: game.spreadForTeam, implied: game.impliedTotal, total: game.gameTotal }
        : null,
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
      // No projection means no team, which means no game and no lock. Not
      // locked is the safe default: it can produce an instruction Sleeper
      // refuses, which is visible and self-correcting, where the opposite
      // silently hides a call.
      game: null, locked: false, vegas: null,
    };
    const withValue = { ...p, vor: vor(p, levels) };
    byId.set(withValue.id, withValue);
    return withValue;
  });

  const starters = mine.starters || [];
  const thresholdFor = (positions) => threshold(sigma, ...positions);

  // Locked players already in the lineup are pinned to the slot they occupy.
  const frozen = new Map();
  slots.forEach((_slot, i) => {
    const p = byId.get(String(starters[i]));
    if (p?.locked) frozen.set(i, p);
  });

  const optimal = optimalLineup(slots, roster, frozen);
  const calls = decisions(starters, optimal, byId, thresholdFor);

  // The same solve with locks ignored. The difference is the set of calls
  // that were real and are now impossible - shown as locked, never as an
  // instruction, and written to the decision log.
  const openOptimal = optimalLineup(slots, roster, null); // null = ignore locks
  const openCalls = decisions(starters, openOptimal, byId, thresholdFor);
  const missed = missedCalls(openCalls, calls, openOptimal, optimal);
  if (missed.any) {
    recordMissed({ leagueKey: entry.key, season: state.season, week: state.week, missed, at: state.now });
  }

  // A team code the schedule does not know is a join failure, not a bye, and
  // it must not be allowed to look like one.
  const unknown = sched.unknownTeams(state.schedule, roster.map((p) => p.team));

  // Best free agent per position, for the waiver layer and for showing what
  // "replacement" actually means in this league rather than as an abstraction.
  const freeBest = {};
  for (const [pos, lv] of Object.entries(levels)) freeBest[pos] = lv;

  state.leagues[entry.key] = {
    entry, league, roster, byId, slots, optimal, calls, priced,
    levels, sigma, freeBest,
    frozen, missed, unknown,
    lockedCount: roster.filter((p) => p.locked).length,
    starters,
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

// Games kick off while the page is sitting open on a Sunday afternoon. A page
// loaded at 12:58 would otherwise still be offering a call that stopped being
// possible at 13:00, which is the exact failure this layer exists to prevent.
//
// Re-check every half minute, but do the cheap comparison first and only
// re-solve when a lock state has genuinely flipped. The common case is a
// no-op, so the tab does not flicker and an open "why" panel survives.
function watchKickoffs() {
  if (!state.schedule?.ok) return;

  const lockKey = () => Object.values(state.leagues)
    .flatMap((L) => L.roster.filter((p) => p.locked).map((p) => `${L.entry.key}:${p.id}`))
    .sort().join(",");

  let previous = lockKey();
  // `flipped` stays true until a solve SUCCEEDS, so without this guard a slow
  // Sleeper would stack a fresh set of requests every 30 seconds and never
  // drain - at one o'clock on a Sunday, which is exactly when Sleeper is
  // slowest. One re-solve at a time.
  let inFlight = false;

  setInterval(async () => {
    if (inFlight) return;
    const now = Date.now();
    const flipped = Object.values(state.leagues).some((L) =>
      L.roster.some((p) => sched.hasKickedOff(p.game?.kickoffUTC, now) !== p.locked));
    if (!flipped) return;

    inFlight = true;
    state.now = now;
    // allSettled, not all: loadLeague mutates state.leagues per league as it
    // resolves, so a later rejection would otherwise leave one league holding
    // fresh lock flags that were never painted - state and DOM disagreeing,
    // and self-healing only by luck. Paint whatever succeeded.
    const settled = await Promise.allSettled(state.cfg.leagues.map(loadLeague));
    const failed = settled.filter((r) => r.status === "rejected");
    try {
      attachMarket();
      paint();
      previous = lockKey();
    } finally {
      inFlight = false;
    }
    if (failed.length) {
      // A Sleeper blip must not blank the page. The next tick retries.
      console.error("kickoff re-solve: %d league(s) failed", failed.length, failed[0].reason);
    }
  }, 30000);
}

boot();
export { state };

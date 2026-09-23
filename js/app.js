import * as sleeper from "./sleeper.js";
import { rescore, isFloorOnly, willNotPlay } from "./scoring.js";
import { startingSlots, optimalLineup, decisions, missedCalls } from "./lineup.js";
import { rosteredIds, replacementLevels, vor, sigmaTable, threshold } from "./value.js";
import { consensus, disagreements } from "./market.js";
import { values as fcalcValues, leagueShape } from "./fantasycalc.js";
import { restOfSeason } from "./compare.js";
import * as usage from "./usage.js";
import { waiverBoard } from "./waivers.js";
import * as vacancy from "./vacancy.js";
import * as sched from "./schedule.js";
import { recordMissed, recordLineup, recap } from "./memory.js";
import { render, renderError, setLoading } from "./ui.js";

const state = {
  cfg: null, week: null, season: null, projections: null,
  leagues: {}, active: null, market: null,
  schedule: null,
  // Compare selection, per league. Kept in state rather than the DOM because
  // render() rebuilds innerHTML wholesale on every repaint - a kickoff flip at
  // one o'clock would otherwise wipe a comparison mid-read.
  selection: {}, ros: new Map(), rosPending: new Set(), fcalc: new Map(),
  usage: null, usageFresh: null, trending: new Map(),
  // The vacancy layer rides with usage for the same reason: a local file in
  // this repo, no network round trip to hide behind a progressive render.
  vacancy: null,
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
    // Usage rides along here rather than arriving late like the market layers,
    // because it is a local file in this repo - there is no network round trip
    // to hide behind a progressive render.
    const [projections, schedule, used, vac] = await Promise.all([
      sleeper.weekProjections(state.season, state.week),
      sched.load(state.season, { now: state.now }),
      usage.load(state.season),
      vacancy.load(state.season),
    ]);
    state.projections = projections;
    state.schedule = schedule;
    state.usage = used;
    state.vacancy = vac;

    setLoading("Reading your leagues");
    await Promise.all(state.cfg.leagues.map(loadLeague));

    attachUsage();
    buildWaivers();
    buildRecap();
    state.active = state.cfg.leagues[0].key;
    paint();
    watchKickoffs();

    // The market layer is an enrichment, not a dependency. The page is
    // already useful and already painted; this arrives late and re-renders.
    // If it never arrives, nothing above it changes.
    consensus().then((m) => { state.market = m; attachMarket(); paint(); });

    // FantasyCalc is fetched PER LEAGUE, because the whole point of it is that
    // the board is different for each: Josh Allen is overall #3 in an 8-team
    // superflex and #21 in a 14-team 1QB league. One shared call would hand
    // one of the two leagues a number that is wrong for it - which is exactly
    // the defect this layer exists to fix.
    for (const entry of state.cfg.leagues) attachFcalc(entry.key);

    // Is the mirror behind upstream? api.github.com allows cross-origin reads
    // even though the asset bytes it describes do not, so the page can learn
    // that nflverse has moved without being able to fetch what moved. Late,
    // optional, and silent when it cannot tell.
    usage.checkFreshness(state.usage).then((f) => {
      if (f) { state.usageFresh = f; paint(); }
    });

    // Sleeper's add counts: the free urgency signal. Not a projection and not
    // a recommendation - it is what the rest of the world is doing, which
    // matters for a waiver claim in a way it never matters for a lineup.
    sleeper.trending(48, 60)
      .then((rows) => {
        state.trending = new Map((rows || []).map((r) => [String(r.player_id), r.count]));
        buildWaivers(); paint();
      })
      .catch((err) => console.warn("trending unavailable:", err.message));
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

  // What you are running versus what the tool would run. Written every load
  // and overwritten within the week, so the last thing recorded before kickoff
  // is what gets graded on Tuesday. Silent when the two agree - a log full of
  // "no difference" teaches nothing.
  recordLineup({
    leagueKey: entry.key, season: state.season, week: state.week,
    // optimalLineup() returns [{slot, player}], NOT players. The first version
    // read `.id` off the wrapper, so every entry was undefined, `suggested`
    // came out empty, and the recap silently dropped every lineup row it ever
    // graded - the headline feature of this phase, a no-op. decisions() two
    // lines above has always read `s.player?.id`; this did not.
    //
    // Both lists drop Sleeper's "0" empty-slot marker so the two are
    // comparable: otherwise a single empty seat makes agreement unreachable
    // and every week logs as a disagreement.
    started: starters.map(String).filter((id) => id && id !== "0"),
    suggested: optimal.map((s) => s?.player?.id).filter(Boolean).map(String),
    threshold: calls.threshold,
    at: state.now,
  });

  // A team code the schedule does not know is a join failure, not a bye, and
  // it must not be allowed to look like one.
  const unknown = sched.unknownTeams(state.schedule, roster.map((p) => p.team));

  // Best free agent per position, for the waiver layer and for showing what
  // "replacement" actually means in this league rather than as an abstraction.
  const freeBest = {};
  for (const [pos, lv] of Object.entries(levels)) freeBest[pos] = lv;

  state.leagues[entry.key] = {
    entry, league, roster, byId, slots, optimal, calls, priced,
    // The rostered set is kept, not just used and dropped: the waiver layer's
    // entire question is "who is NOT in here", and recomputing it from the
    // rosters would mean a second live read of something already in hand.
    rostered,
    levels, sigma, freeBest,
    frozen, missed, unknown,
    lockedCount: roster.filter((p) => p.locked).length,
    starters,
    // NULL, not zero, when this league has no FAAB budget at all. A league
    // that drafts waiver priority instead of bidding has no budget field, and
    // "$0 left" stated as a measurement is a fabrication - one line above the
    // sentence promising that bid figures are deliberately absent, not missing.
    faabLeft: league.settings?.waiver_budget == null
      ? null
      : league.settings.waiver_budget - (mine.settings?.waiver_budget_used ?? 0),
    teams: league.total_rosters,
    rosteredCount: rostered.size,
  };
}

async function attachFcalc(key) {
  const L = state.leagues[key];
  if (!L) return;
  const shape = leagueShape(L.league);
  // Held at state level, keyed by shape, so re-attaching after a kickoff
  // re-solve costs nothing and needs no second fetch.
  const id = `${shape.numQbs}-${shape.numTeams}-${shape.ppr}`;
  if (!state.fcalc.has(id)) state.fcalc.set(id, await fcalcValues(shape));
  attachFcalcFor(key);
  paint();
}

function attachFcalcFor(key) {
  const L = state.leagues[key];
  if (!L) return;
  const shape = leagueShape(L.league);
  const fc = state.fcalc.get(`${shape.numQbs}-${shape.numTeams}-${shape.ppr}`);
  if (!fc) return;
  L.fcalc = fc;
  if (!fc.ok) return;
  for (const p of L.byId.values()) p.fcalc = fc.byId.get(p.id) || null;
}

// Which week is this team's bye, according to the schedule we already hold.
//
// A SCHEDULE THAT DOES NOT KNOW THE TEAM IS NOT A BYE.
//
// teamGame() returns null both for a real bye and for a team code absent from
// the index, which schedule.js documents twice as a distinction that must
// never be collapsed. The first version of this function collapsed it anyway:
// a player whose team code does not join - the exact case unknownTeams()
// exists to surface - got "bye, this week". Scanning a STALE schedule has the
// same shape, because a cached CSV missing late weeks reports them as byes.
// Both now return null, and null renders as no bye rather than a wrong one.
function confirmedBye(team) {
  const sc = state.schedule;
  if (!sc?.ok || sc.stale || !team) return null;
  if (!sc.byTeam?.has(sched.normTeam(team))) return null;  // join failure, not a bye
  for (let wk = state.week; wk <= 18; wk++) {
    if (!sched.teamGame(sc, team, wk)) return wk;
  }
  return null;
}

// Rest-of-season, fetched only for players actually put into a comparison.
//
// One request per player, so this is deliberately NOT part of the page load:
// a 15-player roster would be 15 extra calls to answer a question nobody asked.
//
// Cached PER LEAGUE, because the rest-of-season total is re-scored at each
// league's own rules and is therefore a different number in each of them.
const rosKey = (leagueKey, id) => `${leagueKey}:${id}`;

async function ensureRos(ids) {
  // Captured BEFORE the await. Resolving the league inside the callback would
  // let a league switch mid-flight file one league's answer under the other's
  // scoring - which matters now that the number is league-scored.
  const key = state.active;
  const L = state.leagues[key];
  if (!L) return;
  const scoring = L.league.scoring_settings;

  const wanted = ids.filter((id) =>
    !state.ros.has(rosKey(key, id)) && !state.rosPending.has(rosKey(key, id)));

  if (wanted.length) {
    wanted.forEach((id) => state.rosPending.add(rosKey(key, id)));
    await Promise.allSettled(wanted.map(async (id) => {
      try {
        const weeks = await sleeper.playerSeason(id, state.season);
        const team = L.byId.get(id)?.team;
        state.ros.set(rosKey(key, id),
          restOfSeason(weeks, state.week, scoring, confirmedBye(team)));
      } catch (err) {
        // A player with no season payload is a gap, not a failure. Cache the
        // null so the surface stops asking on every repaint.
        state.ros.set(rosKey(key, id), null);
        console.warn("rest-of-season unavailable for", id, err.message);
      } finally {
        state.rosPending.delete(rosKey(key, id));
      }
    }));
  }

  // ALWAYS re-attach, even when every id was already cached. The early return
  // used to sit above this line, so after a kickoff re-solve rebuilt the player
  // objects the cache was full, nothing re-attached, and the rest-of-season row
  // stayed on "Pulling…" forever with no fetch in flight.
  attachRos();
  paint();
}

function attachRos() {
  for (const [key, L] of Object.entries(state.leagues)) {
    for (const p of L.byId.values()) {
      const hit = rosKey(key, p.id);
      if (state.ros.has(hit)) p.ros = state.ros.get(hit);
    }
  }
}

// The Tuesday recap. Graded only against weeks nflverse has actually
// published, never against the calendar.
function buildRecap() {
  for (const [key, L] of Object.entries(state.leagues)) {
    L.recap = recap({
      leagueKey: key, season: state.season, currentWeek: state.week,
      usage: state.usage, scoring: L.league.scoring_settings, rescore,
    });
  }
}

function buildWaivers() {
  for (const L of Object.values(state.leagues)) {
    L.waivers = waiverBoard(L, {
      trending: state.trending,
      // So "his last three games" can mean recently rather than ever.
      throughWeek: state.usage?.throughWeek ?? null,
    });
    // BUILT AFTER attachUsage(), NOT BESIDE IT.
    //
    // The cross-check reads usage off the mirror to ask whether the man the
    // depth chart promotes is the man actually getting the work. It is handed
    // the mirror directly rather than reading p.usage off the priced map,
    // because the player it most wants to ask about is frequently NOT in that
    // map at all - an unprojected backup is the whole point of the block.
    L.vacancies = vacancy.vacancyBoard(L, state.vacancy, { usage: state.usage });
  }
}

function attachUsage() {
  if (!state.usage?.ok) return;
  for (const L of Object.values(state.leagues)) {
    for (const p of L.byId.values()) p.usage = state.usage.byId.get(p.id) || null;
    for (const p of L.priced.values()) p.usage = state.usage.byId.get(p.id) || null;
  }
}

function attachMarket() {
  if (!state.market?.ok) return;
  for (const L of Object.values(state.leagues)) {
    for (const p of L.roster) p.market = state.market.byId.get(p.id) || null;
    for (const p of L.byId.values()) p.market = state.market.byId.get(p.id) || null;
    L.disagreements = disagreements(L.roster, state.market, L.priced);
  }
}

function paint() {
  render(state, {
    onSwitch: (key) => { state.active = key; paint(); },
    onToggle: (id) => {
      const key = state.active;
      const sel = state.selection[key] || (state.selection[key] = new Set());
      sel.has(id) ? sel.delete(id) : sel.add(id);
      paint();
      if (sel.size >= 2) ensureRos([...sel]);
    },
    onClear: () => { state.selection[state.active] = new Set(); paint(); },
  });
}

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
      // loadLeague() rebuilds state.leagues wholesale - new byId, new player
      // objects - so EVERY enrichment layer has to be put back, not just the
      // market one. Miss one and it vanishes from the page at the first
      // kickoff of the afternoon and never returns, which is when this tool
      // is most in use.
      attachMarket();
      attachUsage();
      for (const e of state.cfg.leagues) attachFcalcFor(e.key);
      attachRos();
      buildWaivers();
      buildRecap();
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

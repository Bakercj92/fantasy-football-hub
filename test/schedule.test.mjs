// Schedule, kickoff locking and the Vegas read. Against the MODULE.
//
// The fixture below is hand-written rather than fetched, so the suite is
// deterministic and works offline. The live feed is checked separately in the
// render pass - which is where both real defects in this rebuild were caught,
// and where this layer's join to Sleeper's team codes gets proven.
import {
  etToUTC, parseSeason, index, teamGame, hasKickedOff,
  normTeam, unknownTeams, splitCSVLine,
} from "../js/schedule.js";
import { optimalLineup, decisions, missedCalls } from "../js/lineup.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

// --- Eastern -> UTC, across the DST boundary -------------------------------

t("September 13:00 ET is 17:00 UTC (EDT, -4)", () => {
  assert.strictEqual(new Date(etToUTC("2026-09-13", "13:00")).toISOString(),
    "2026-09-13T17:00:00.000Z");
});

t("December 13:00 ET is 18:00 UTC (EST, -5)", () => {
  assert.strictEqual(new Date(etToUTC("2026-12-06", "13:00")).toISOString(),
    "2026-12-06T18:00:00.000Z");
});

t("the two differ by exactly one hour - a fixed offset would miss this", () => {
  const sep = etToUTC("2026-09-13", "13:00") % 86400000;
  const dec = etToUTC("2026-12-06", "13:00") % 86400000;
  assert.strictEqual(dec - sep, 3600000);
});

t("a January 20:15 ET Monday nighter lands at 01:15 UTC the next day", () => {
  assert.strictEqual(new Date(etToUTC("2027-01-04", "20:15")).toISOString(),
    "2027-01-05T01:15:00.000Z");
});

t("round trip: every kickoff renders back to the wall clock it came from", () => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
  for (const [d, hhmm] of [["2026-09-13","13:00"],["2026-11-01","16:25"],["2026-12-25","15:00"],["2027-01-03","13:00"]]) {
    assert.strictEqual(fmt.format(new Date(etToUTC(d, hhmm))).replace(/^24/, "00"), hhmm, `${d} ${hhmm}`);
  }
});

t("garbage in gives null, not NaN or a 1970 date", () => {
  assert.strictEqual(etToUTC("", "13:00"), null);
  assert.strictEqual(etToUTC("2026-09-13", ""), null);
  assert.strictEqual(etToUTC("not-a-date", "13:00"), null);
});

// --- Team codes ------------------------------------------------------------

t("Sleeper's LAR resolves to nflverse's LA", () => {
  assert.strictEqual(normTeam("LAR"), "LA");
  assert.strictEqual(normTeam("lar"), "LA");
});

t("codes that already agree pass straight through", () => {
  for (const c of ["KC","SF","NE","SEA","LAC","LV","WAS","JAX"]) assert.strictEqual(normTeam(c), c);
});

// --- CSV -------------------------------------------------------------------

t("quoted commas do not shift the columns", () => {
  assert.deepStrictEqual(splitCSVLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepStrictEqual(splitCSVLine('a,"say ""hi""",d'), ["a", 'say "hi"', "d"]);
});

// --- Fixture ---------------------------------------------------------------

const HEAD = "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score," +
  "home_team,home_score,location,result,total,overtime,away_moneyline,home_moneyline," +
  "spread_line,total_line,roof";
const G = (id, season, week, day, time, away, home, spread, total, aml, hml) =>
  `${id},${season},REG,${week},${day},Sunday,${time},${away},,${home},,Home,,,0,${aml},${hml},${spread},${total},outdoors`;

const CSV = [
  HEAD,
  G("2026_01_NE_SEA",  2026, 1, "2026-09-09", "20:20", "NE",  "SEA", 3,  44.5, 140, -166),
  G("2026_01_CHI_CAR", 2026, 1, "2026-09-13", "13:00", "CHI", "CAR", -3, 46.5, -162, 136),
  G("2026_01_SF_LA",   2026, 1, "2026-09-10", "20:35", "SF",  "LA",  3.5, 48.5, 164, -198),
  // Week 14 in December, and deliberately unpriced - books run about six
  // weeks out, so most of the season legitimately has no line.
  `2026_14_KC_DEN,2026,REG,14,2026-12-06,Sunday,13:00,KC,,DEN,,Home,,,0,,,,,outdoors`,
  // A different season must not leak in.
  G("2025_01_AAA_BBB", 2025, 1, "2025-09-07", "13:00", "ARI", "ATL", 1, 40, 100, -120),
].join("\n");

const games = parseSeason(CSV, 2026);
const S = index(games, 2026);

t("parseSeason keeps only the season asked for", () => {
  assert.strictEqual(games.length, 4);
  assert.ok(games.every((g) => g.gameId.startsWith("2026_")));
});

t("upstream dropping a column fails loudly instead of silently", () => {
  assert.throws(() => parseSeason("game_id,season,week\n2026_01_A_B,2026,1", 2026), /missing/);
});

// --- Vegas orientation -----------------------------------------------------

t("spread_line is the points the HOME team lays - checked against moneylines", () => {
  const g = games.find((x) => x.gameId === "2026_01_NE_SEA");
  // SEA is home at -166, so SEA is favoured, and spread_line is +3.
  assert.strictEqual(g.homeImplied, 23.75);
  assert.strictEqual(g.awayImplied, 20.75);
  assert.ok(g.homeImplied > g.awayImplied, "the moneyline favourite must have the higher implied total");
});

t("a negative spread_line means the AWAY team is favoured", () => {
  const g = games.find((x) => x.gameId === "2026_01_CHI_CAR");
  assert.ok(g.awayImplied > g.homeImplied);   // CHI at -162
  assert.strictEqual(g.awayImplied, 24.75);
});

t("implied totals sum back to the game total and differ by the spread", () => {
  for (const g of games.filter((x) => x.hasLine)) {
    assert.strictEqual(Math.round((g.homeImplied + g.awayImplied) * 10) / 10, g.total);
    assert.strictEqual(Math.round((g.homeImplied - g.awayImplied) * 10) / 10, g.spread);
  }
});

t("an unpriced game yields nulls, never zeros", () => {
  const g = games.find((x) => x.gameId === "2026_14_KC_DEN");
  assert.strictEqual(g.hasLine, false);
  assert.strictEqual(g.spread, null);
  assert.strictEqual(g.homeImplied, null);
  assert.strictEqual(g.awayImplied, null);
});

// --- teamGame --------------------------------------------------------------

t("teamGame orients the spread to the team you asked about", () => {
  assert.strictEqual(teamGame(S, "SEA", 1).spreadForTeam, 3);
  assert.strictEqual(teamGame(S, "NE", 1).spreadForTeam, -3);
  assert.strictEqual(teamGame(S, "SEA", 1).impliedTotal, 23.75);
  assert.strictEqual(teamGame(S, "NE", 1).impliedTotal, 20.75);
});

t("a Sleeper LAR roster finds the nflverse LA game - the silent-join bug", () => {
  const viaSleeper = teamGame(S, "LAR", 1);
  assert.ok(viaSleeper, "LAR must resolve; if this is null every Rams player never locks");
  assert.strictEqual(viaSleeper.opponent, "SF");
  assert.strictEqual(viaSleeper.isHome, true);
});

t("a bye week is null", () => {
  assert.strictEqual(teamGame(S, "SEA", 9), null);
});

t("no schedule means no game rather than a throw", () => {
  assert.strictEqual(teamGame({ ok: false }, "SEA", 1), null);
  assert.strictEqual(teamGame(S, "", 1), null);
});

// --- unknownTeams ----------------------------------------------------------

t("an unrecognised code is reported; a bye is not", () => {
  assert.deepStrictEqual(unknownTeams(S, ["SEA", "LAR", "NE"]), []);
  assert.deepStrictEqual(unknownTeams(S, ["SEA", "ZZZ"]), ["ZZZ"]);
});

// --- hasKickedOff ----------------------------------------------------------

const KICK = etToUTC("2026-09-13", "13:00");

t("locked exactly at kickoff, not a moment before", () => {
  assert.strictEqual(hasKickedOff(KICK, KICK - 1), false);
  assert.strictEqual(hasKickedOff(KICK, KICK), true);
  assert.strictEqual(hasKickedOff(KICK, KICK + 1), true);
});

t("an unknown kickoff NEVER locks - permissive beats silently wrong", () => {
  assert.strictEqual(hasKickedOff(null, Date.now()), false);
  assert.strictEqual(hasKickedOff(undefined, Date.now()), false);
});

// --- Locking through the solver -------------------------------------------

const P = (id, pos, pts, extra = {}) =>
  ({ id, pos, pts, name: id, startable: true, locked: false, ...extra });

t("a locked bench player cannot be added to the lineup", () => {
  const slots = ["RB"];
  const roster = [P("bench","RB",30,{ locked:true }), P("starter","RB",10)];
  const frozen = new Map();                       // the starter is not locked
  const out = optimalLineup(slots, roster, frozen);
  assert.strictEqual(out[0].player.id, "starter");
});

t("with locks ignored the same solve does add him - the counterfactual", () => {
  const slots = ["RB"];
  const roster = [P("bench","RB",30,{ locked:true }), P("starter","RB",10)];
  assert.strictEqual(optimalLineup(slots, roster, null)[0].player.id, "bench");
});

t("forgetting the third argument respects locks rather than ignoring them", () => {
  // The safe default. A caller who omits it gets an enforceable lineup.
  const slots = ["RB"];
  const roster = [P("bench","RB",30,{ locked:true }), P("starter","RB",10)];
  assert.strictEqual(optimalLineup(slots, roster)[0].player.id, "starter");
});

t("a locked starter is pinned to his slot even when someone better is free", () => {
  const slots = ["RB", "FLEX"];
  const locked = P("locked","RB",4,{ locked:true });
  const roster = [locked, P("free","RB",25), P("wr","WR",9)];
  const frozen = new Map([[0, locked]]);
  const out = optimalLineup(slots, roster, frozen);
  assert.strictEqual(out[0].player.id, "locked", "slot 0 must still hold the locked player");
  assert.strictEqual(out[1].player.id, "free",   "the better RB takes FLEX instead");
});

t("an empty frozen map still means locks are respected", () => {
  const slots = ["RB"];
  const roster = [P("a","RB",30,{ locked:true })];
  assert.strictEqual(optimalLineup(slots, roster, new Map())[0].player, null);
});

t("a locked player appears on neither side of the decision", () => {
  const slots = ["RB"];
  const lockedStarter = P("locked","RB",4,{ locked:true });
  const betterButLocked = P("alsoLocked","RB",30,{ locked:true });
  const byId = new Map([["locked",lockedStarter],["alsoLocked",betterButLocked]]);
  const roster = [lockedStarter, betterButLocked];
  const frozen = new Map([[0, lockedStarter]]);
  const d = decisions(["locked"], optimalLineup(slots, roster, frozen), byId, 1.0);
  assert.strictEqual(d.entering.length, 0);
  assert.strictEqual(d.leaving.length, 0);
  assert.strictEqual(d.actionable, false);
});

t("a ruled-out player who is ALSO locked is not raised as a forced call", () => {
  // He is out, but his game has started, so Sleeper will not let him move.
  // Telling Chris to bench him would be an instruction that cannot be obeyed.
  const slots = ["RB"];
  const out = P("hurt","RB",11,{ startable:false, locked:true });
  const bench = P("healthy","RB",8);
  const byId = new Map([["hurt",out],["healthy",bench]]);
  const frozen = new Map([[0, out]]);
  const d = decisions(["hurt"], optimalLineup(slots, [out,bench], frozen), byId, 1.0);
  assert.strictEqual(d.forced.length, 0);
  assert.strictEqual(d.actionable, false);
});

// --- missedCalls -----------------------------------------------------------

t("a ruled-out LOCKED starter costs his replacement's points, not zero", () => {
  // THE AUDIT DEFECT. The constrained lineup pins the ruled-out player and
  // used to count his phantom projection; the unconstrained one drops him and
  // seats a real replacement. That made the subtraction negative, and the
  // clamp reported the most expensive kind of lockout as free.
  const slots = ["TE"];
  const out   = P("mcbride","TE",17,{ startable:false, locked:true });
  const free  = P("kraft","TE",8);
  const byId  = new Map([["mcbride",out],["kraft",free]]);
  const roster = [out, free];

  const actualLineup = optimalLineup(slots, roster, new Map([[0, out]]));
  const openLineup   = optimalLineup(slots, roster, null);
  const actual = decisions(["mcbride"], actualLineup, byId, 1.0);
  const open   = decisions(["mcbride"], openLineup, byId, 1.0);
  const m = missedCalls(open, actual, openLineup, actualLineup);

  assert.strictEqual(m.any, true, "the lockout must be reported at all");
  assert.strictEqual(m.cost, 8, "he scores zero, so the cost is the replacement's 8");
});

t("a locked seat that will not play contributes zero to the lineup total", () => {
  const slots = ["RB","WR"];
  const dead = P("dead","RB",25,{ startable:false, locked:true });
  const live = P("live","WR",10);
  const a = optimalLineup(slots, [dead, live], new Map([[0, dead]]));
  const o = optimalLineup(slots, [dead, live], null);
  const m = missedCalls(
    { actionable:true, entering:[], leaving:[], gain:0 },
    { entering:[], leaving:[] }, o, a);
  // Both lineups are worth 10 (the WR); the dead seat counts for nothing in
  // either. Cost 0 here is CORRECT - there was no replacement to lose.
  assert.strictEqual(m.cost, 0);
});


t("missedCalls reports the call that arrived too late", () => {
  const slots = ["RB"];
  const starter = P("starter","RB",10);
  const late = P("late","RB",30,{ locked:true });
  const byId = new Map([["starter",starter],["late",late]]);
  const roster = [starter, late];

  const actualLineup = optimalLineup(slots, roster, new Map());
  const openLineup   = optimalLineup(slots, roster, null);
  const actual = decisions(["starter"], actualLineup, byId, 1.0);
  const open   = decisions(["starter"], openLineup, byId, 1.0);
  const m = missedCalls(open, actual, openLineup, actualLineup);

  assert.strictEqual(actual.actionable, false, "nothing is actionable now");
  assert.strictEqual(m.any, true);
  assert.deepStrictEqual(m.entering.map((p) => p.id), ["late"]);
  // The cost is the LINEUP difference - 30 instead of 10 - not the whole
  // unconstrained decision's value. Reporting the latter overstated a real
  // render by roughly four times.
  assert.strictEqual(m.cost, 20);
});

t("cost counts only the locked-out difference, not other live calls", () => {
  // One locked-out swap worth 20, plus a completely separate live call worth
  // 15 that is still perfectly available. The cost is 20, never 35.
  const slots = ["RB", "WR"];
  const rbIn  = { id:"rbIn",  pos:"RB", pts:30, name:"rbIn",  startable:true, locked:true };
  const rbOut = { id:"rbOut", pos:"RB", pts:10, name:"rbOut", startable:true, locked:false };
  const wrIn  = { id:"wrIn",  pos:"WR", pts:20, name:"wrIn",  startable:true, locked:false };
  const wrOut = { id:"wrOut", pos:"WR", pts:5,  name:"wrOut", startable:true, locked:false };
  const roster = [rbIn, rbOut, wrIn, wrOut];
  const byId = new Map(roster.map((p) => [p.id, p]));

  const actualLineup = optimalLineup(slots, roster, new Map());
  const openLineup   = optimalLineup(slots, roster, null);
  const actual = decisions(["rbOut","wrOut"], actualLineup, byId, 1.0);
  const open   = decisions(["rbOut","wrOut"], openLineup, byId, 1.0);
  const m = missedCalls(open, actual, openLineup, actualLineup);

  assert.ok(actual.entering.some((p) => p.id === "wrIn"), "the live WR call survives");
  assert.strictEqual(m.cost, 20, "only the locked RB swap counts");
});

t("nothing locked means nothing missed", () => {
  const slots = ["RB"];
  const starter = P("starter","RB",10), better = P("better","RB",30);
  const byId = new Map([["starter",starter],["better",better]]);
  const roster = [starter, better];
  const aL = optimalLineup(slots, roster, new Map()), oL = optimalLineup(slots, roster, null);
  const actual = decisions(["starter"], aL, byId, 1.0);
  const open   = decisions(["starter"], oL, byId, 1.0);
  assert.strictEqual(actual.actionable, true);
  assert.strictEqual(missedCalls(open, actual, oL, aL).any, false);
});

t("a still-actionable call is not also reported as missed", () => {
  const slots = ["RB", "FLEX"];
  const starter = P("s1","RB",10);
  const late = P("late","RB",30,{ locked:true });
  const live = P("live","RB",25);
  const byId = new Map([["s1",starter],["late",late],["live",live]]);
  const roster = [starter, late, live];
  const aL = optimalLineup(slots, roster, new Map()), oL = optimalLineup(slots, roster, null);
  const actual = decisions(["s1","x"], aL, byId, 1.0);
  const open   = decisions(["s1","x"], oL, byId, 1.0);
  const m = missedCalls(open, actual, oL, aL);
  assert.ok(actual.entering.some((p) => p.id === "live"), "the live upgrade is still offered");
  assert.ok(!m.entering.some((p) => p.id === "live"), "and is not double-reported as missed");
});

console.log(`\nschedule: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

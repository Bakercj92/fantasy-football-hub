import { freeAgents, upgrades, risers, waiverBoard, POSITIONS_FOR } from "../js/waivers.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const SLOTS = ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"];
const P = (o) => ({ id:"x", name:"X", pos:"WR", pts:10, startable:true, locked:false, ...o });
const priced = (...ps) => new Map(ps.map((p) => [p.id, p]));

t("a slot's eligible positions come from the lineup solver, not a second table", () => {
  assert.deepStrictEqual(POSITIONS_FOR("FLEX"), ["RB","WR","TE"]);
  assert.deepStrictEqual(POSITIONS_FOR("SUPER_FLEX"), ["QB","RB","WR","TE"]);
  assert.deepStrictEqual(POSITIONS_FOR("QB"), ["QB"]);
});

t("free agents exclude anyone rostered, ruled out, or unprojected", () => {
  const pool = priced(
    P({ id:"owned", pts:15 }),
    P({ id:"hurt", pts:15, startable:false }),
    P({ id:"noproj", pts:null }),
    P({ id:"free", pts:12 }),
  );
  const free = freeAgents(pool, new Set(["owned"]), SLOTS);
  assert.deepStrictEqual(free.map((p) => p.id), ["free"]);
});

t("a position this league never starts is not a free agent worth listing", () => {
  const pool = priced(P({ id:"lb", pos:"LB", pts:30 }));
  assert.strictEqual(freeAgents(pool, new Set(), SLOTS).length, 0);
});

t("REGRESSION: kickers and defenses are never offered off the wire", () => {
  // Rendering the first version produced four kicker claims at "+6.0" each,
  // which buried everything that mattered. Kicker totals are floors here, and
  // both positions are streaming noise week to week.
  const pool = priced(
    P({ id:"k",   pos:"K",   pts:12 }),
    P({ id:"def", pos:"DEF", pts:14 }),
    P({ id:"wr",  pos:"WR",  pts:11 }),
  );
  assert.deepStrictEqual(freeAgents(pool, new Set(), SLOTS).map((p) => p.id), ["wr"]);
});

t("an upgrade must beat a real starter by more than the measured threshold", () => {
  // A FULL lineup with exactly one weak spot. Leaving seats empty would let
  // any free agent qualify against the empty seat instead, which is correct
  // behaviour but not what this test is about.
  const filled = [
    ["s0","QB",20], ["s1","RB",13], ["s2","RB",12], ["weak","WR",6],
    ["s4","WR",13], ["s5","TE",10], ["s6","RB",12], ["s7","K",8], ["s8","DEF",8],
  ].map(([id, pos, pts]) => P({ id, pos, pts }));
  const ctx = { starters: filled.map((p) => p.id), slots: SLOTS,
                byId: new Map(filled.map((p) => [p.id, p])), sigma:{ WR:4 } };   // gate = 2.0
  const marginal = P({ id:"m", pos:"WR", pts:7.5 });   // +1.5, under the gate
  const real     = P({ id:"r", pos:"WR", pts:11 });    // +5.0, over it
  const got = upgrades([marginal, real], ctx);
  assert.deepStrictEqual(got.map((p) => p.id), ["r"]);
  assert.strictEqual(got[0].over.id, "weak");
});

t("a LOCKED starter is never offered as a seat to claim into", () => {
  const locked = P({ id:"locked", pos:"WR", pts:2, locked:true });
  const ctx = { starters:["locked"], slots:["WR"], byId:new Map([["locked", locked]]), sigma:{ WR:4 } };
  assert.strictEqual(upgrades([P({ id:"free", pos:"WR", pts:20 })], ctx).length, 0,
    "his game has kicked off — Sleeper would refuse the change");
});

t("an empty seat counts as a zero-point starter and can be filled", () => {
  const ctx = { starters:["0"], slots:["WR"], byId:new Map(), sigma:{ WR:4 } };
  const got = upgrades([P({ id:"free", pos:"WR", pts:9 })], ctx);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].over, null);
});

t("REGRESSION: a starter we could not resolve is not treated as an empty seat", () => {
  // A slot holding a real id that is missing from byId means we lack data on
  // him, not that he scores nothing. Claiming "over" him would be a
  // recommendation built on a lookup failure.
  const ctx = { starters:["someone-we-cannot-resolve"], slots:["WR"],
                byId:new Map(), sigma:{ WR:4 } };
  assert.strictEqual(upgrades([P({ id:"free", pos:"WR", pts:20 })], ctx).length, 0);
});

t("a rostered starter with no projection this week is also unknown, not zero", () => {
  const noProj = P({ id:"s", pos:"WR", pts:null });
  const ctx = { starters:["s"], slots:["WR"], byId:new Map([["s", noProj]]), sigma:{ WR:4 } };
  assert.strictEqual(upgrades([P({ id:"free", pos:"WR", pts:20 })], ctx).length, 0);
});

t("REGRESSION: one claim per seat, not a ranked list of everyone who beats it", () => {
  // Rendering produced four near-identical tight ends all "over Dead HeatA in
  // your TE", 0.3 points apart. A seat can only be filled once.
  const weak = P({ id:"weak", pos:"TE", pts:4 });
  const ctx = { starters:["weak"], slots:["TE"], byId:new Map([["weak", weak]]), sigma:{ TE:3 } };
  const many = [10.4, 10.1, 9.8, 9.5].map((pts, i) => P({ id:`te${i}`, pos:"TE", pts }));
  const got = upgrades(many, ctx);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].id, "te0", "and it is the best one");
});

t("two different seats each get their own claim", () => {
  const weakTE = P({ id:"wte", pos:"TE", pts:3 });
  const weakWR = P({ id:"wwr", pos:"WR", pts:3 });
  const ctx = { starters:["wte","wwr"], slots:["TE","WR"],
                byId:new Map([["wte",weakTE],["wwr",weakWR]]), sigma:{ TE:3, WR:4 } };
  const got = upgrades([P({ id:"te", pos:"TE", pts:11 }), P({ id:"wr", pos:"WR", pts:13 })], ctx);
  assert.strictEqual(got.length, 2);
});

t("a free agent is matched to the WEAKEST seat he could take, not the first", () => {
  const ok   = P({ id:"ok", pos:"WR", pts:14 });
  const weak = P({ id:"weak", pos:"WR", pts:3 });
  const ctx = { starters:["ok","weak"], slots:["WR","WR"],
                byId:new Map([["ok",ok],["weak",weak]]), sigma:{ WR:4 } };
  const got = upgrades([P({ id:"free", pos:"WR", pts:16 })], ctx);
  assert.strictEqual(got[0].over.id, "weak");
});

// --- risers -----------------------------------------------------------------

const wkRows = (...ns) => ns.map((wk) => ({ wk }));
const withUsage = (o, u) => P({ ...o,
  usage: { games:5, gamesRecent:3, weeks: wkRows(1,2,3,4,5), ...u } });

t("a riser needs a real sample; one game is noise, not a trend", () => {
  const p = withUsage({ id:"p", pts:4 },
    { games:1, gamesRecent:1, snapPct:0.3, snapPctRecent:0.9, oppPerGame:2, oppPerGameRecent:9 });
  assert.strictEqual(risers([p]).length, 0);
});

t("snap share climbing a quarter over the season average, from a real base, is a riser", () => {
  const p = withUsage({ id:"p", pts:5 },
    { snapPct:0.40, snapPctRecent:0.70, oppPerGame:3, oppPerGameRecent:3 });
  const got = risers([p]);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].snapJump, 75);
});

t("a proportional jump off a tiny base is not a riser", () => {
  const p = withUsage({ id:"p", pts:2 },
    { snapPct:0.04, snapPctRecent:0.12, oppPerGame:0.5, oppPerGameRecent:1.5 });
  assert.strictEqual(risers([p]).length, 0, "tripling 4% of snaps is still nobody");
});

// --- the intent gate: air-yards share and WOPR ------------------------------
//
// These are the only numbers in the mirror that move BEFORE the box score
// everyone else reads. Each has to be able to make a riser on its own, or the
// block can still only ever arrive second.

t("air-yards share climbing from a real base is a riser with no other movement", () => {
  const p = withUsage({ id:"p", pts:5 },
    { snapPct:0.50, snapPctRecent:0.52, oppPerGame:4, oppPerGameRecent:4,
      ayShare:0.18, ayShareRecent:0.31, wopr:0.30, woprRecent:0.31 });
  const got = risers([p]);
  assert.strictEqual(got.length, 1, "snaps and touches are flat; the offence's intent is not");
  assert.strictEqual(got[0].ayJump, 72);
  assert.strictEqual(got[0].snapJump, 4, "the flat numbers are still reported, just not the reason");
});

t("a tripled air-yards share off a decoy's base is still a decoy", () => {
  const p = withUsage({ id:"p", pts:2 },
    { snapPct:0.20, snapPctRecent:0.21, oppPerGame:1, oppPerGameRecent:1,
      ayShare:0.02, ayShareRecent:0.07, wopr:0.05, woprRecent:0.06 });
  assert.strictEqual(risers([p]).length, 0, "7% of a team's air yards is nobody's WR2");
});

t("WOPR catches the receiver who grew on both counts without either moving far", () => {
  const p = withUsage({ id:"p", pts:6 },
    { snapPct:0.55, snapPctRecent:0.58, oppPerGame:4, oppPerGameRecent:4.4,
      ayShare:0.20, ayShareRecent:0.24, wopr:0.34, woprRecent:0.50 });
  const got = risers([p]);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].woprJump, 47);
  assert.strictEqual(got[0].ayJump, null, "20 to 24 percent did not clear its own gate");
});

t("a jump that did not clear its floor is not printed as the reason", () => {
  // The number exists either way. Reporting it on a row that qualified for a
  // different reason would let a decoy's noise sit where the evidence goes.
  const p = withUsage({ id:"p", pts:5 },
    { snapPct:0.40, snapPctRecent:0.70, oppPerGame:3, oppPerGameRecent:3,
      ayShare:0.01, ayShareRecent:0.09, wopr:0.02, woprRecent:0.09 });
  const got = risers([p]);
  assert.strictEqual(got.length, 1, "he is a riser on snaps");
  assert.strictEqual(got[0].ayJump, null);
  assert.strictEqual(got[0].woprJump, null);
});

t("the score reflects only gates that actually fired", () => {
  // Otherwise a huge jump off a base too small to qualify would sort a decoy
  // above a real breakout.
  const decoyish = withUsage({ id:"a", pts:5 },
    { snapPct:0.40, snapPctRecent:0.56, oppPerGame:3, oppPerGameRecent:3,
      ayShare:0.01, ayShareRecent:0.10, wopr:0.02, woprRecent:0.10 });   // +900% but floored out
  const real = withUsage({ id:"b", pts:5 },
    { snapPct:0.40, snapPctRecent:0.64, oppPerGame:3, oppPerGameRecent:3,
      ayShare:0.20, ayShareRecent:0.28, wopr:0.36, woprRecent:0.40 });
  const got = risers([decoyish, real]);
  assert.deepStrictEqual(got.map((g) => g.id), ["b", "a"], "60% of snaps beats 40% of snaps");
});

t("a player with no air-yards figures at all is unaffected", () => {
  // MISSING IS NOT ZERO, for the fifth-and-counting time on this project.
  const p = withUsage({ id:"p", pts:5 },
    { snapPct:0.40, snapPctRecent:0.70, oppPerGame:3, oppPerGameRecent:3 });
  const got = risers([p]);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].ayJump, null);
  assert.strictEqual(got[0].woprJump, null);
});

t("REGRESSION: a player who has not played in weeks is not a riser", () => {
  // The window is the last three ROWS. Unanchored, a player who ramped up
  // through week 5 and vanished still read as "up 75% over his last three
  // games" in week 11 — a recommendation to claim someone six weeks absent,
  // who is free for exactly that reason.
  const gone = withUsage({ id:"gone", pts:5 },
    { snapPct:0.40, snapPctRecent:0.70, oppPerGame:3, oppPerGameRecent:3, weeks: wkRows(1,2,3,4,5) });
  assert.strictEqual(risers([gone], { throughWeek: 11 }).length, 0);
  assert.strictEqual(risers([gone], { throughWeek: 6 }).length, 1, "one missed week is still live");
  assert.strictEqual(risers([gone], { throughWeek: null }).length, 1, "no week known: do not filter");
});

t("a quarterback never surfaces as an opportunity riser", () => {
  const qb = withUsage({ id:"qb", pos:"QB", pts:18 },
    { snapPct:0.4, snapPctRecent:0.7, oppPerGame:3, oppPerGameRecent:3 });
  assert.strictEqual(risers([qb]).length, 0);
});

t("trending adds ride along when Sleeper has them and stay null when it doesn't", () => {
  const p = withUsage({ id:"p", pts:5 }, { snapPct:0.4, snapPctRecent:0.7, oppPerGame:3, oppPerGameRecent:3 });
  assert.strictEqual(risers([p])[0].adds, null);
  assert.strictEqual(risers([p], { trending: new Map([["p", 4210]]) })[0].adds, 4210);
});

// --- the board --------------------------------------------------------------

t("the board is silent when nothing qualifies, which is the normal case", () => {
  const L = { priced: priced(P({ id:"free", pos:"WR", pts:3 })), rostered:new Set(),
              slots:["WR"], starters:["s"], byId:new Map([["s", P({ id:"s", pos:"WR", pts:14 })]]),
              sigma:{ WR:4 } };
  assert.strictEqual(waiverBoard(L).any, false);
});

t("a player who is both an upgrade and a riser is listed once, as the upgrade", () => {
  const star = withUsage({ id:"both", pos:"WR", pts:18 },
    { snapPct:0.4, snapPctRecent:0.7, oppPerGame:3, oppPerGameRecent:3 });
  const L = { priced: priced(star), rostered:new Set(), slots:["WR"],
              starters:["s"], byId:new Map([["s", P({ id:"s", pos:"WR", pts:4 })]]), sigma:{ WR:4 } };
  const b = waiverBoard(L);
  assert.strictEqual(b.upgrades.length, 1);
  assert.strictEqual(b.risers.length, 0);
});

t("a league with no priced universe yet produces no board rather than throwing", () => {
  assert.strictEqual(waiverBoard(null).any, false);
  assert.strictEqual(waiverBoard({ priced: new Map() }).any, false);
});

console.log(`waivers  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

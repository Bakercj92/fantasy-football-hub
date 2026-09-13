import { compare, verdict, applicableMetrics, rankingMetric, restOfSeason,
         sharesASlot, axisContractHolds, METRICS, posRankNumber } from "../js/compare.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const P = (o) => ({ id:"x", name:"X", pos:"RB", pts:null, vor:null, ...o });
const SLOTS = ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"];
const SFLEX = ["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","K","DEF"];
const ctxOf = (...ps) => ({ byId: new Map(ps.map((p) => [p.id, p])),
                            sigma: { QB:6, RB:4, WR:3, TE:2.4 }, slots: SLOTS });
// Both leagues pay 4 for a passing TD; the vendor's pts_ppr pays 6.
const SCORING = { rec:1, pass_yd:0.04, pass_td:4, rush_yd:0.1, rush_td:6, rec_yd:0.1, rec_td:6 };

// --- the cross-position rule ------------------------------------------------

t("per-position metrics are DROPPED, not shown, when the pool spans positions", () => {
  const a = P({ id:"1", pos:"RB", pts:12, vor:6, market:{ posRank:"RB14", grade:"B" } });
  const b = P({ id:"2", pos:"WR", pts:11, vor:3, market:{ posRank:"WR14", grade:"B" } });
  const keys = applicableMetrics([a, b]).map((m) => m.key);
  assert.ok(!keys.includes("ecr"), "ECR must not survive a mixed pool");
  assert.ok(!keys.includes("grade"), "grade must not survive a mixed pool");
});

t("the same metrics come back when every player is one position", () => {
  const a = P({ id:"1", pos:"WR", pts:12, vor:6, market:{ posRank:"WR14", grade:"B" } });
  const b = P({ id:"2", pos:"WR", pts:11, vor:3, market:{ posRank:"WR31", grade:"C" } });
  const keys = applicableMetrics([a, b]).map((m) => m.key);
  assert.ok(keys.includes("ecr") && keys.includes("grade"));
});

t("a metric no selected player has is dropped rather than printed as dashes", () => {
  const a = P({ id:"1", pts:12, vor:6 });
  const b = P({ id:"2", pts:11, vor:3 });
  const keys = applicableMetrics([a, b]).map((m) => m.key);
  assert.ok(!keys.includes("mktValue"), "no FantasyCalc data means no market column at all");
  assert.ok(!keys.includes("implied"));
});

t("compare reports which metrics mixing cost you, so the UI can say so", () => {
  const a = P({ id:"1", pos:"RB", pts:12, vor:6, market:{ posRank:"RB14" } });
  const b = P({ id:"2", pos:"WR", pts:11, vor:3, market:{ posRank:"WR9" } });
  const c = compare(["1","2"], ctxOf(a,b));
  assert.ok(c.mixed);
  assert.ok(c.droppedForMixing.includes("Consensus (positional)"));
});

// --- the axis and the verdict must agree -----------------------------------

t("VOR is the axis when every player has it", () => {
  const a = P({ id:"1", pts:12, vor:6 }), b = P({ id:"2", pts:11, vor:3 });
  assert.strictEqual(rankingMetric([a, b]).key, "vor");
});

t("points is the fallback axis when replacement level could not be measured", () => {
  const a = P({ id:"1", pts:12 }), b = P({ id:"2", pts:11 });
  assert.strictEqual(rankingMetric([a, b]).key, "pts");
});

t("REGRESSION: the verdict names the player the ranking actually favours", () => {
  // A leads on VOR, B leads on raw points. The first version of verdict()
  // always subtracted points while the pool was ordered by VOR, so it named
  // the VOR leader and quoted the margin the OTHER player led by.
  const a = P({ id:"1", name:"RB A", pos:"RB", pts:11, vor:9 });
  const b = P({ id:"2", name:"QB B", pos:"QB", pts:19, vor:1.5 });
  const c = compare(["1","2"], ctxOf(a, b));
  assert.strictEqual(c.players[0].id, "1", "VOR ranks A first");
  assert.strictEqual(c.verdict.metric, "vor", "the verdict must use the ranking axis");
  assert.strictEqual(c.verdict.winner, "1");
  assert.ok(c.verdict.gap > 0, "gap is signed so + always means the top-ranked player leads");
  assert.ok(c.verdict.text.startsWith("RB A"));
});

t("the verdict's gap is always signed toward the first argument", () => {
  const a = P({ id:"1", name:"A", pts:5, vor:1 });
  const b = P({ id:"2", name:"B", pts:20, vor:16 });
  const v = verdict(a, b, { sigma:{ RB:4 } });
  assert.ok(v.gap < 0, "a trailing first argument yields a negative gap");
  assert.strictEqual(v.winner, "2", "and the winner is still the player who actually leads");
  assert.ok(v.text.startsWith("B"));
});

t("a gap inside the measured threshold is not a decision", () => {
  const a = P({ id:"1", name:"A", pos:"RB", pts:12.4, vor:6.2 });
  const b = P({ id:"2", name:"B", pos:"RB", pts:12.0, vor:5.9 });
  const c = compare(["1","2"], ctxOf(a, b));
  assert.strictEqual(c.verdict.decisive, false);
  assert.strictEqual(c.verdict.winner, null);
  assert.strictEqual(c.verdict.text, "Too close to call");
});

t("the threshold takes the noisier of the two positions", () => {
  const a = P({ id:"1", name:"A", pos:"QB", pts:20, vor:3 });
  const b = P({ id:"2", name:"B", pos:"TE", pts:18, vor:2 });
  // QB sigma 6 -> 3.0, capped to 2.0; TE 2.4 -> 1.2. Larger wins: 2.0.
  assert.strictEqual(verdict(a, b, { sigma:{ QB:6, TE:2.4 } }).gate, 2);
});

// --- mode and shape ---------------------------------------------------------

t("two players is head-to-head, three is a pool", () => {
  const ps = [P({id:"1",pts:12,vor:6}), P({id:"2",pts:11,vor:5}), P({id:"3",pts:10,vor:4})];
  assert.strictEqual(compare(["1","2"], ctxOf(...ps)).mode, "head-to-head");
  assert.strictEqual(compare(["1","2","3"], ctxOf(...ps)).mode, "pool");
});

t("fewer than two resolvable players renders nothing", () => {
  const a = P({ id:"1", pts:12, vor:6 });
  assert.strictEqual(compare(["1"], ctxOf(a)).mode, "empty");
  assert.strictEqual(compare(["1","ghost"], ctxOf(a)).mode, "empty");
});

t("the pool is ordered by the axis, best first", () => {
  const ps = [P({id:"1",vor:2,pts:9}), P({id:"2",vor:8,pts:9}), P({id:"3",vor:5,pts:9})];
  const c = compare(["1","2","3"], ctxOf(...ps));
  assert.deepStrictEqual(c.players.map((p) => p.id), ["2","3","1"]);
});

t("a low-is-better metric marks the lowest as the winner", () => {
  const a = P({ id:"1", pts:12, vor:6, fcalc:{ value:900, overall:4 } });
  const b = P({ id:"2", pts:11, vor:5, fcalc:{ value:800, overall:40 } });
  const c = compare(["1","2"], ctxOf(a, b));
  const rank = c.rows.find((r) => r.key === "mktRank");
  assert.strictEqual(rank.cells.find((x) => x.best).id, "1");
});

t("a tie on a metric has no winner at all", () => {
  const a = P({ id:"1", pts:12, vor:6, fcalc:{ value:900 } });
  const b = P({ id:"2", pts:12, vor:5, fcalc:{ value:900 } });
  const c = compare(["1","2"], ctxOf(a, b));
  assert.strictEqual(c.rows.find((r) => r.key === "pts").cells.filter((x) => x.best).length, 0);
  assert.strictEqual(c.rows.find((r) => r.key === "mktValue").cells.filter((x) => x.best).length, 0);
});

t("every metric declares the fields the renderer relies on", () => {
  for (const m of METRICS) {
    assert.ok(m.key && m.label && typeof m.get === "function" && typeof m.fmt === "function", m.key);
    assert.ok(typeof m.crossPosition === "boolean", `${m.key} must declare crossPosition`);
    assert.ok(m.note && m.note.length > 30, `${m.key} must carry a why`);
  }
});

t("metric keys are unique", () => {
  const keys = METRICS.map((m) => m.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});

// --- rest of season ---------------------------------------------------------

t("rest of season skips weeks already played", () => {
  const wk = (yd) => ({ stats: { rush_yd: yd } });   // 0.1/yd -> yd/10 points
  const r = restOfSeason({ "1":wk(100), "2":wk(120), "3":wk(80) }, 2, SCORING);
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.weeks, 2);
});

t("REGRESSION: rest of season is re-scored, never the vendor's PPR total", () => {
  // Two passing touchdowns. The vendor's pts_ppr pays 6 apiece; both of
  // Chris's leagues pay 4. Summing pts_ppr would overstate this week by 4,
  // and a quarterback across a season by roughly fifty - while the footer of
  // the same page promises we never show the vendor's number.
  const weeks = { "1": { stats: { pass_td: 2, pass_yd: 0, pts_ppr: 12 } } };
  assert.strictEqual(restOfSeason(weeks, 1, SCORING).total, 8);
});

t("no scoring settings means no rest-of-season number at all", () => {
  assert.strictEqual(restOfSeason({ "1":{stats:{rush_yd:100}} }, 1, null), null);
});

t("a null week is skipped and never counted as zero", () => {
  const rows = { "5":{stats:{rush_yd:100}}, "6":{stats:{}}, "7":{stats:{rush_yd:100}} };
  const r = restOfSeason(rows, 5, SCORING);
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.weeks, 2, "the empty week is absent, not a zero dragging the total down");
});

t("the bye is only what the caller confirmed, never inferred from a null week", () => {
  const rows = { "5":{stats:{rush_yd:100}}, "6":{stats:{}}, "7":{stats:{rush_yd:100}} };
  assert.strictEqual(restOfSeason(rows, 5, SCORING).bye, null);
  assert.strictEqual(restOfSeason(rows, 5, SCORING, 6).bye, 6);
});

t("an empty stat block is missing data; a real zero-point week is kept", () => {
  // rescore({}) returns 0, which would quietly enter a bye into the total as
  // a genuine zero-point performance.
  const rows = { "1":{stats:{}}, "2":{stats:{rush_yd:0, rec:0}}, "3":{stats:{rush_yd:100}} };
  const r = restOfSeason(rows, 1, SCORING);
  assert.strictEqual(r.weeks, 2, "the keyless week is skipped, the all-zero week is not");
  assert.strictEqual(r.total, 10);
});

t("no usable weeks returns null rather than a confident zero", () => {
  assert.strictEqual(restOfSeason({ "1":{stats:{rush_yd:90}} }, 5, SCORING), null);
  assert.strictEqual(restOfSeason(null, 1, SCORING), null);
});

t("posRankNumber reads the trailing number and nothing else", () => {
  assert.strictEqual(posRankNumber("WR12"), 12);
  assert.strictEqual(posRankNumber("RB4"), 4);
  assert.strictEqual(posRankNumber(""), null);
  assert.strictEqual(posRankNumber(null), null);
});

// --- the axis fork: start/sit vs hold-and-drop ------------------------------

t("two players who can take the same seat are judged on points, like the lineup solver", () => {
  const a = P({ id:"1", name:"RB A", pos:"RB", pts:11, vor:9 });
  const b = P({ id:"2", name:"QB B", pos:"QB", pts:19, vor:1.5 });
  const c = compare(["1","2"], { ...ctxOf(a, b), slots: SFLEX });
  assert.strictEqual(c.startSit, true, "a SUPER_FLEX seat takes both");
  assert.strictEqual(c.axis.key, "pts");
  assert.strictEqual(c.verdict.winner, "2", "the points leader, which is what the lineup solver would seat");
});

t("two players who cannot share a seat are judged on value over replacement", () => {
  const a = P({ id:"1", name:"RB A", pos:"RB", pts:11, vor:9 });
  const b = P({ id:"2", name:"QB B", pos:"QB", pts:19, vor:1.5 });
  const c = compare(["1","2"], { ...ctxOf(a, b), slots: SLOTS });
  assert.strictEqual(c.startSit, false);
  assert.strictEqual(c.axis.key, "vor");
  assert.strictEqual(c.verdict.winner, "1");
  assert.ok(/hold-and-drop/.test(c.verdict.why), "and it says so, rather than implying a start/sit call");
});

t("the compare verdict cannot contradict the lineup solver on a shared seat", () => {
  // The failure this guards: the calls block says 'Start the QB, +8.0' while
  // the compare block eight lines below says 'the RB by 7.5'. Both defensible,
  // neither reconcilable by a reader.
  const a = P({ id:"1", name:"RB A", pos:"RB", pts:11, vor:9 });
  const b = P({ id:"2", name:"QB B", pos:"QB", pts:19, vor:1.5 });
  const c = compare(["1","2"], { ...ctxOf(a, b), slots: SFLEX });
  const byPoints = [a, b].sort((x, y) => y.pts - x.pts)[0];
  assert.strictEqual(c.players[0].id, byPoints.id);
});

t("sharesASlot reads the league's real slots, flex included", () => {
  const rb = P({ pos:"RB" }), wr = P({ pos:"WR" }), qb = P({ pos:"QB" }), k = P({ pos:"K" });
  assert.ok(sharesASlot(rb, wr, SLOTS), "FLEX takes both");
  assert.ok(!sharesASlot(rb, qb, SLOTS), "no 1QB slot takes a RB and a QB");
  assert.ok(sharesASlot(rb, qb, SFLEX), "SUPER_FLEX does");
  assert.ok(!sharesASlot(rb, k, SFLEX));
});

// --- a missing number is not a zero ----------------------------------------

t("REGRESSION: a player with no projection produces no verdict, not a fabricated gap", () => {
  // null - 0 is not a gap; it is the whole of the other player's projection
  // wearing a gap's clothes. The page builds real roster entries with
  // pts:null and gives them a working selector, so this is reachable.
  const a = P({ id:"1", name:"No Proj", pos:"WR", pts:null, vor:null });
  const b = P({ id:"2", name:"Real", pos:"WR", pts:12, vor:5 });
  const c = compare(["1","2"], ctxOf(a, b));
  assert.strictEqual(c.verdict.decisive, false);
  assert.strictEqual(c.verdict.winner, null);
  assert.strictEqual(c.verdict.gap, null);
  assert.strictEqual(c.verdict.text, "Can't compare");
  assert.ok(/No Proj/.test(c.verdict.why));
});

t("every axis metric is high-is-better, which verdict() depends on", () => {
  // mktRank is dir:'low' and sits one character from axis:true. If it ever
  // flips, verdict() names the loser and threshold() compares rank places to
  // a points gate.
  assert.ok(axisContractHolds());
});

console.log(`compare  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Tests for the matchup layer and the signal-disagreement detector.
//
// The cases are named after the September 23rd failures they exist to prevent.
// If one of these ever gets "fixed" by making the module more decisive, read
// the header comment in signals.js first.

import assert from "node:assert/strict";
import { rescore } from "../js/scoring.js";
import * as M from "../js/matchup.js";
import * as S from "../js/signals.js";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`  FAIL ${name}\n    ${e.message}`); }
};

const PPR4 = { rec: 1, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6,
               pass_yd: 0.04, pass_td: 4, pass_int: -2, fum_lost: -2 };

// A mirror-shaped fixture. `weeks` rows carry `opp`; `actual` is keyed by week
// in Sleeper's stat vocabulary, exactly as build/usage.py emits it.
function player(pos, team, rows) {
  return {
    pos, team,
    weeks: rows.map((r) => ({ wk: r.wk, opp: r.opp, tgt: r.tgt ?? 0, car: r.car ?? 0, snapPct: r.snap ?? null })),
    actual: Object.fromEntries(rows.map((r) => [String(r.wk), r.act])),
  };
}
const mirror = (entries) => ({ ok: true, byId: new Map(Object.entries(entries)), throughWeek: 2 });

// FOUR defences, two weeks each - the module refuses to decompose variance
// across fewer than four, because a between-defence variance over two points
// is not a measurement. Each defence-week is one player, since `conceded`
// aggregates by (position, opponent, week) and does not care who supplied it.
//
// Here S1/S2 concede heavily in BOTH weeks and H1/H2 concede little in both:
// the spread lives between defences, which is what signal looks like.
const big   = { rec: 10, rec_yd: 150 };
const small = { rec: 2,  rec_yd: 20  };

const consistent = mirror({
  p1: player("WR", "AAA", [{ wk: 1, opp: "S1", act: big }]),
  p2: player("WR", "BBB", [{ wk: 1, opp: "S2", act: big }]),
  p3: player("WR", "CCC", [{ wk: 1, opp: "H1", act: small }]),
  p4: player("WR", "DDD", [{ wk: 1, opp: "H2", act: small }]),
  p5: player("WR", "EEE", [{ wk: 2, opp: "S1", act: big }]),
  p6: player("WR", "FFF", [{ wk: 2, opp: "S2", act: big }]),
  p7: player("WR", "GGG", [{ wk: 2, opp: "H1", act: small }]),
  p8: player("WR", "HHH", [{ wk: 2, opp: "H2", act: small }]),
});

console.log("matchup");

t("conceded points are attributed to the OPPONENT, not the player's team", () => {
  const c = M.concededByWeek(consistent, PPR4, rescore);
  // p1 plays FOR "AAA" AGAINST "S1" - the 25 points must land on S1.
  assert.equal(Math.round(c.cells.get("WR|S1|1")), 25);   // 10 rec + 15 yds
  assert.equal(Math.round(c.cells.get("WR|H1|1")), 4);    // 2 rec + 2 yds
  assert.equal(c.cells.get("WR|AAA|1"), undefined, "nothing may be filed under the player's own team");
  assert.deepEqual(c.weeks, [1, 2]);
});

t("a player-week with no opponent is DROPPED, never guessed from current team", () => {
  const noOpp = mirror({
    x: player("WR", "AAA", [{ wk: 1, opp: null, act: { rec: 10, rec_yd: 100 } },
                            { wk: 2, opp: "HARD", act: { rec: 1, rec_yd: 5 } }]),
  });
  const c = M.concededByWeek(noOpp, PPR4, rescore);
  assert.equal([...c.cells.keys()].filter((k) => k.includes("|1")).length, 0,
    "the opponent-less week 1 row must not appear under any defence");
  assert.ok(c.cells.has("WR|HARD|2"));
});

t("reliability finds high signal when defences separate consistently", () => {
  const rel = M.reliability(M.concededByWeek(consistent, PPR4, rescore));
  assert.ok(rel.WR.share > 0.5, `expected strong signal, got ${rel.WR.share}`);
});

t("reliability finds ~no signal when the same defence swings wildly", () => {
  // Every defence has one big week and one small one - the spread is WITHIN
  // each defence, not between them. This is what real two-week NFL data
  // actually looks like: measured on 2026 weeks 1-2, QB came out at r = -0.04.
  const noisy = mirror({
    p1: player("WR", "AAA", [{ wk: 1, opp: "D1", act: big }]),
    p2: player("WR", "BBB", [{ wk: 1, opp: "D2", act: small }]),
    p3: player("WR", "CCC", [{ wk: 1, opp: "D3", act: big }]),
    p4: player("WR", "DDD", [{ wk: 1, opp: "D4", act: small }]),
    p5: player("WR", "EEE", [{ wk: 2, opp: "D1", act: small }]),
    p6: player("WR", "FFF", [{ wk: 2, opp: "D2", act: big }]),
    p7: player("WR", "GGG", [{ wk: 2, opp: "D3", act: small }]),
    p8: player("WR", "HHH", [{ wk: 2, opp: "D4", act: big }]),
  });
  const rel = M.reliability(M.concededByWeek(noisy, PPR4, rescore));
  assert.ok(rel.WR.share < M.MIN_SIGNAL, `expected noise, got ${rel.WR.share}`);
});

t("a position with one week returns null reliability, NOT zero", () => {
  // Four defences, but one game each: there is no within-defence term, so the
  // decomposition is undefined rather than zero.
  const oneWeek = mirror({
    p1: player("WR", "AAA", [{ wk: 1, opp: "S1", act: big }]),
    p2: player("WR", "BBB", [{ wk: 1, opp: "S2", act: big }]),
    p3: player("WR", "CCC", [{ wk: 1, opp: "H1", act: small }]),
    p4: player("WR", "DDD", [{ wk: 1, opp: "H2", act: small }]),
  });
  const rel = M.reliability(M.concededByWeek(oneWeek, PPR4, rescore));
  assert.equal(rel.WR, null,
    "one game per defence has no within-term; undefined must not render as 'measured noise'");
});

// Shrinkage is a function of MEASURED reliability, so it has three regimes and
// the no-op one is easy to mistake for a bug. All three are asserted.
t("shrinkage: perfect separation is left alone (k=1, mult === raw)", () => {
  const tbl = M.table(consistent, PPR4, rescore);
  const soft = tbl.byPos.WR.entries.get("S1");
  assert.equal(tbl.byPos.WR.k, 1);
  assert.equal(soft.mult, soft.raw,
    "with no within-defence noise there is nothing to shrink - pulling toward 1.0 anyway " +
    "would discard real signal");
  assert.ok(soft.mult > 1);
});

t("shrinkage: pure noise collapses every defence to 1.0", () => {
  const noisy = mirror({
    p1: player("WR", "AAA", [{ wk: 1, opp: "D1", act: big }]),
    p2: player("WR", "BBB", [{ wk: 1, opp: "D2", act: small }]),
    p3: player("WR", "CCC", [{ wk: 1, opp: "D3", act: big }]),
    p4: player("WR", "DDD", [{ wk: 1, opp: "D4", act: small }]),
    p5: player("WR", "EEE", [{ wk: 2, opp: "D1", act: small }]),
    p6: player("WR", "FFF", [{ wk: 2, opp: "D2", act: big }]),
    p7: player("WR", "GGG", [{ wk: 2, opp: "D3", act: small }]),
    p8: player("WR", "HHH", [{ wk: 2, opp: "D4", act: big }]),
  });
  const tbl = M.table(noisy, PPR4, rescore);
  assert.equal(tbl.byPos.WR.k, 0);
  for (const e of tbl.byPos.WR.entries.values()) assert.equal(e.mult, 1);
});

t("shrinkage: partial reliability lands strictly between raw and 1.0", () => {
  // Defences do separate, but each also swings week to week. k comes out near
  // 0.5, which is the only regime where the correction is visible.
  const a = (rec, yd) => ({ rec, rec_yd: yd });
  const partial = mirror({
    p1: player("WR", "AAA", [{ wk: 1, opp: "S1", act: a(12, 150) }]),   // 27
    p2: player("WR", "BBB", [{ wk: 1, opp: "S2", act: a(11, 150) }]),   // 26
    p3: player("WR", "CCC", [{ wk: 1, opp: "H1", act: a(5, 60) }]),     // 11
    p4: player("WR", "DDD", [{ wk: 1, opp: "H2", act: a(6, 60) }]),     // 12
    p5: player("WR", "EEE", [{ wk: 2, opp: "S1", act: a(6, 90) }]),     // 15
    p6: player("WR", "FFF", [{ wk: 2, opp: "S2", act: a(7, 90) }]),     // 16
    p7: player("WR", "GGG", [{ wk: 2, opp: "H1", act: a(2, 30) }]),     // 5
    p8: player("WR", "HHH", [{ wk: 2, opp: "H2", act: a(1, 30) }]),     // 4
  });
  const tbl = M.table(partial, PPR4, rescore);
  const k = tbl.byPos.WR.k;
  assert.ok(k > 0 && k < 1, `expected partial reliability, got k=${k}`);
  const soft = tbl.byPos.WR.entries.get("S1");
  assert.ok(soft.raw > soft.mult && soft.mult > 1,
    `shrunk multiplier must sit between 1.0 and raw: 1 < ${soft.mult} < ${soft.raw}`);
});

t("read() REFUSES to speak below the signal gate", () => {
  const tbl = M.table(consistent, PPR4, rescore);
  tbl.byPos.WR.k = 0.05;                       // force the gate shut
  const r = M.read(tbl, "WR", "S1");
  assert.equal(r.speaks, false);
  assert.ok(/below the 15% gate/.test(r.reason));
  assert.equal(r.rank, undefined, "a refusal must not leak a rank the caller could print");
});

t("read() speaks, hedged, above the gate", () => {
  const tbl = M.table(consistent, PPR4, rescore);
  const r = M.read(tbl, "WR", "S1");
  assert.equal(r.speaks, true);
  assert.equal(r.rank, 1);
  assert.match(r.text, /allowed \d+% more than average to WRs/);
});

console.log(`matchup  ${pass} passed, ${fail} failed`);
const mPass = pass, mFail = fail;
pass = 0; fail = 0;
console.log("signals");

const SIGMA_QB = 6;

t("MURRAY: projected to start but absent from the last completed week", () => {
  const murray = player("QB", "MIN", [{ wk: 1, opp: "GB", act: { pass_yd: 18 } }]);
  const f = S.check({ proj: 17.2, usageEntry: murray, throughWeek: 2, sigma: SIGMA_QB });
  const absent = f.find((x) => x.kind === "absent");
  assert.ok(absent, "a high projection with no week-2 row must raise the absent flag");
  assert.match(absent.text, /did not play in week 2/);
});

t("MURRAY: the absent flag asks a question and refuses to answer it", () => {
  const murray = player("QB", "MIN", [{ wk: 1, opp: "GB", act: { pass_yd: 18 } }]);
  const [absent] = S.check({ proj: 17.2, usageEntry: murray, throughWeek: 2, sigma: SIGMA_QB });
  assert.equal(absent.resolvable, false);
  assert.match(absent.ask, /depth chart/);
  // The failure mode this guards: a flag that says "bench him". Both
  // explanations for absence are live and opposite; picking one is the bug.
  assert.ok(!/bench|sit|start him|do not start/i.test(absent.text + absent.ask),
    "the absent flag must not contain a recommendation");
});

t("HERBERT: projection far above season form raises projection-high", () => {
  const herbert = { ...player("QB", "LAC", [{ wk: 1, opp: "ARI", act: {} }, { wk: 2, opp: "LV", act: {} }]),
                    formPts: 10.57 };
  const f = S.check({ proj: 16.12, usageEntry: herbert, throughWeek: 2, sigma: 4 });
  const d = f.find((x) => x.kind === "projection-high");
  assert.ok(d, "a +5.6 gap at sigma 4 is 1.4 sigma and must flag");
  assert.match(d.text, /averaging 10\.6/);
});

t("YOUNG: projection far below season form raises projection-low", () => {
  const young = { ...player("QB", "CAR", [{ wk: 1, opp: "CHI", act: {} }, { wk: 2, opp: "ATL", act: {} }]),
                  formPts: 27.76 };
  const f = S.check({ proj: 15.83, usageEntry: young, throughWeek: 2, sigma: 6 });
  assert.ok(f.some((x) => x.kind === "projection-low"));
});

t("a gap inside one sigma stays quiet", () => {
  const p = { ...player("QB", "X", [{ wk: 1, opp: "A", act: {} }, { wk: 2, opp: "B", act: {} }]), formPts: 18 };
  assert.equal(S.check({ proj: 20, usageEntry: p, throughWeek: 2, sigma: 6 }).length, 0);
});

t("bench bodies below the interest threshold raise nothing", () => {
  const p = player("WR", "X", [{ wk: 1, opp: "A", act: {} }]);
  assert.deepEqual(S.check({ proj: 3, usageEntry: p, throughWeek: 2, sigma: 3 }), []);
});

t("a player with no mirror entry at all is still flagged absent", () => {
  const f = S.check({ proj: 14, usageEntry: null, throughWeek: 2, sigma: 5 });
  assert.equal(f[0].kind, "absent");
  assert.match(f[0].text, /no usage at all/);
});

t("one game of history flags thin rather than pretending to compare", () => {
  const p = player("RB", "X", [{ wk: 2, opp: "A", act: { rush_yd: 50 } }]);
  const f = S.check({ proj: 12, usageEntry: p, throughWeek: 2, sigma: 4 });
  assert.ok(f.some((x) => x.kind === "thin"));
  assert.ok(!f.some((x) => x.kind.startsWith("projection-")),
    "cannot claim the projection disagrees with a one-game average");
});

t("attachForm averages over games PLAYED, not weeks elapsed", () => {
  const m = mirror({
    x: player("RB", "X", [{ wk: 2, opp: "A", act: { rush_yd: 100, rush_td: 1 } }]),
  });
  S.attachForm(m, PPR4, rescore);
  const e = m.byId.get("x");
  assert.equal(e.formWeeks, 1);
  assert.equal(e.formPts, 16);   // 100*0.1 + 6 — NOT halved by a week he missed
});

console.log(`signals  ${pass} passed, ${fail} failed`);
process.exit(mFail + fail ? 1 : 0);

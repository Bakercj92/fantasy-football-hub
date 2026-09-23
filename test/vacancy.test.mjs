import {
  index, vacancies, promotions, vacancyBoard, load,
  MATTERS_AT, POSITIONS_FOR, claimable, nextUp, touches,
} from "../js/vacancy.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

// THE FIXTURE IS BUILT TO DISAGREE WITH THE CODE, NOT TO AGREE WITH IT.
//
// The standing lesson of this project is that a fixture sharing the code's
// assumptions cannot audit them: the render fixture once served `pts_ppr`
// while the code summed `pts_ppr`, and hid a real defect for a week. So this
// one deliberately contains players the projection feed has never heard of,
// a player whose Sleeper team contradicts the depth chart, a chart whose
// usage order is the reverse of its rank order, and an heir who is himself
// on the injury report.
const D = (o) => ({ tm: "HOU", pos: "WR", rk: 2, climb: null, nm: "X", ...o });
const A = (o) => ({ id: "a1", wk: 2, nm: "Starter", tm: "HOU", pos: "WR",
                    st: "Out", prac: null, inj: "Hamstring", tier: "confirmed", ...o });

const payload = (depth, absent, extra = {}) => index({
  season: 2026, week: 3, weeks: [2, 3],
  coverage: { 2: { teams_reported: 32 }, 3: { teams_reported: 32 } },
  depth_asof: "2026-09-23T12:00:00Z",
  depth, absent, ...extra,
});

const league = ({ rostered = [], priced = [] } = {}) => ({
  slots: SLOTS,
  rostered: new Set(rostered),
  priced: new Map(priced.map((p) => [p.id, { startable: true, pts: 10, ...p }])),
});

const usageOf = (pairs) => ({ byId: new Map(pairs.map(([id, opp]) => [id, { oppPerGameRecent: opp }])) });

// ---------------------------------------------------------------------------
// indexing
// ---------------------------------------------------------------------------

t("a team's position group comes back sorted by rank, whatever order it was stored in", () => {
  const v = payload({ c: D({ rk: 3, nm: "C" }), a: D({ rk: 1, nm: "A" }), b: D({ rk: 2, nm: "B" }) }, []);
  assert.deepStrictEqual(v.byTeam.get("HOU:WR").map((x) => x.nm), ["A", "B", "C"]);
});

t("an empty depth chart is not ok, and produces no board rather than throwing", () => {
  const v = payload({}, [A()]);
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(vacancyBoard(league(), v).any, false);
});

t("a missing payload degrades to a silent block, never an exception", async () => {
  const bad = await load(2026, { fetchImpl: async () => ({ ok: false, status: 404, statusText: "Not Found" }) });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.depth.size, 0);
  const thrown = await load(2026, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.strictEqual(thrown.ok, false);
});

// ---------------------------------------------------------------------------
// the seniority gate
// ---------------------------------------------------------------------------

t("an absence too far down the chart frees nothing", () => {
  // The live case this gate was written for: a genuinely-Out running back,
  // fourth on his team's chart, who resolves to nobody.
  const v = payload(
    { out: D({ pos: "RB", rk: 4, nm: "Deep" }), heir: D({ pos: "RB", rk: 5, nm: "Deeper" }) },
    [A({ id: "out", pos: "RB" })],
  );
  assert.deepStrictEqual(vacancies(league(), v), []);
});

t("the gate is per position, not one number for everybody", () => {
  assert.strictEqual(MATTERS_AT.QB, 1);
  assert.strictEqual(MATTERS_AT.TE, 1);
  assert.ok(MATTERS_AT.WR > MATTERS_AT.RB, "three-receiver sets are the base offence; committees are shallower");

  // A WR3 absence counts; a TE2 absence does not.
  const wr = payload({ o: D({ rk: 3 }), h: D({ rk: 4, nm: "H" }) }, [A({ id: "o" })]);
  assert.strictEqual(vacancies(league(), wr).length, 1);

  const te = payload({ o: D({ pos: "TE", rk: 2 }), h: D({ pos: "TE", rk: 3, nm: "H" }) },
                     [A({ id: "o", pos: "TE" })]);
  assert.strictEqual(vacancies(league(), te).length, 0);
});

t("an absent player who is not on the depth chart names nobody", () => {
  // Otherwise the position group's top would be offered as though the
  // starter were out, which is a fabricated claim.
  const v = payload({ h: D({ rk: 1, nm: "Starter" }) }, [A({ id: "ghost" })]);
  assert.deepStrictEqual(vacancies(league(), v), []);
});

// ---------------------------------------------------------------------------
// the heir
// ---------------------------------------------------------------------------

t("REGRESSION: the next man up is skipped when he is hurt too", () => {
  // Atlanta, week 3 2026: Penix out with a knee, and the next quarterback on
  // the chart was Tua - doubtful with an oblique. Naming Tua would recommend
  // a player who appears as an absence three rows later.
  const v = payload(
    { p: D({ pos: "QB", rk: 1, nm: "Penix" }),
      tua: D({ pos: "QB", rk: 2, nm: "Tua" }),
      rush: D({ pos: "QB", rk: 3, nm: "Rush" }) },
    [A({ id: "p", pos: "QB", nm: "Penix" }),
     A({ id: "tua", pos: "QB", nm: "Tua", st: "Doubtful", tier: "confirmed" })],
  );
  const got = vacancies(league(), v);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].nm, "Rush", "should skip past the doubtful quarterback");
});

t("nextUp returns null rather than wrapping around when the chart runs out", () => {
  const chart = [{ id: "a", rk: 1 }, { id: "b", rk: 2 }];
  assert.strictEqual(nextUp(chart, 2, new Set()), null);
  assert.strictEqual(nextUp(chart, 1, new Set(["b"])), null);
});

t("an heir already on somebody's roster is not a claim", () => {
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }) }, [A({ id: "o" })]);
  assert.strictEqual(vacancies(league({ rostered: ["h"] }), v).length, 0);
});

t("kickers and defenses are never offered here either", () => {
  for (const pos of ["K", "DEF"]) {
    const v = payload({ o: D({ pos, rk: 1 }), h: D({ pos, rk: 2, nm: "H" }) }, [A({ id: "o", pos })]);
    assert.strictEqual(vacancies(league(), v).length, 0, `${pos} leaked`);
  }
});

t("...and the K/DEF filter is tested where it actually runs", () => {
  // MUTATION-DRIVEN. The test above passes with the K/DEF filter deleted,
  // because MATTERS_AT has no entry for either position and the seniority
  // gate rejects them first. Two guards, and the outer one hides the inner.
  //
  // The filter stays - it is the backstop if a future MATTERS_AT ever gains
  // a K entry - but an untested backstop is decoration, so it is asserted
  // against claimable() directly, where nothing shadows it.
  const L = league();
  assert.strictEqual(claimable("k", L, D({ pos: "K", nm: "Kicker" })), null);
  assert.strictEqual(claimable("d", L, D({ pos: "DEF", nm: "Defense" })), null);
  assert.ok(claimable("w", L, D({ pos: "WR", nm: "Receiver" })), "the control: a receiver passes");
});

t("a position this league never starts is not a claim", () => {
  const v = payload({ o: D({ pos: "QB", rk: 1 }), h: D({ pos: "QB", rk: 2, nm: "H" }) },
                    [A({ id: "o", pos: "QB" })]);
  const noQb = { ...league(), slots: ["RB", "WR", "TE", "K", "DEF"] };
  assert.strictEqual(vacancies(noQb, v).length, 0);
});

t("an heir who is himself ruled out for the week is not an upgrade on anybody", () => {
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }) }, [A({ id: "o" })]);
  const L = league({ priced: [{ id: "h", team: "HOU", startable: false }] });
  assert.strictEqual(vacancies(L, v).length, 0);
});

t("REGRESSION: a stale depth chart team is dropped, not reconciled", () => {
  // The season pages' oldest landmine. The chart is rebuilt weekly and
  // Sleeper is live, so a disagreement means he has moved - and every fact
  // the row would assert is then about the wrong offence.
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }) }, [A({ id: "o" })]);
  const moved = league({ priced: [{ id: "h", team: "DAL" }] });
  assert.strictEqual(vacancies(moved, v).length, 0);

  const same = league({ priced: [{ id: "h", team: "HOU" }] });
  assert.strictEqual(vacancies(same, v).length, 1);
});

t("THE POINT OF THE BLOCK: a player with no projection is surfaced, not dropped", () => {
  // waivers.js requires a projection because it compares points. This module
  // must not, or it can only ever arrive after the feed has caught up -
  // which is the exact failure it was built to fix.
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "Unknown" }) }, [A({ id: "o" })]);
  const got = vacancies(league({ priced: [] }), v);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].unprojected, true);
  assert.strictEqual(got[0].pts, null);
});

// ---------------------------------------------------------------------------
// the usage cross-check
// ---------------------------------------------------------------------------

t("when usage names a different man than the chart, BOTH are reported", () => {
  // Full PPR's expensive disagreement: the paper RB2 bangs early downs while
  // the RB3 catches the passes and outscores him.
  const v = payload(
    { o: D({ pos: "RB", rk: 1, nm: "Bell" }),
      banger: D({ pos: "RB", rk: 2, nm: "Banger" }),
      catcher: D({ pos: "RB", rk: 3, nm: "Catcher" }) },
    [A({ id: "o", pos: "RB" })],
  );
  const got = vacancies(league(), v, { usage: usageOf([["banger", 4], ["catcher", 11]]) });
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].nm, "Banger", "the chart's answer is still the headline");
  assert.strictEqual(got[0].disagree.nm, "Catcher", "and usage's answer is named beside it");
  assert.strictEqual(got[0].disagree.opp, 11);
});

t("no disagreement is reported when the chart and the usage agree", () => {
  const v = payload(
    { o: D({ pos: "RB", rk: 1 }), h: D({ pos: "RB", rk: 2, nm: "H" }), z: D({ pos: "RB", rk: 3, nm: "Z" }) },
    [A({ id: "o", pos: "RB" })],
  );
  const got = vacancies(league(), v, { usage: usageOf([["h", 12], ["z", 3]]) });
  assert.strictEqual(got[0].disagree, null);
});

t("the disagreeing player must himself be claimable to be worth naming", () => {
  const v = payload(
    { o: D({ pos: "RB", rk: 1 }), h: D({ pos: "RB", rk: 2, nm: "H" }), owned: D({ pos: "RB", rk: 3, nm: "Owned" }) },
    [A({ id: "o", pos: "RB" })],
  );
  const got = vacancies(league({ rostered: ["owned"] }), v, { usage: usageOf([["h", 2], ["owned", 20]]) });
  assert.strictEqual(got[0].disagree, null, "naming a rostered player as the alternative is not actionable");
});

t("quarterbacks are exempt from the cross-check, because opportunities are touches", () => {
  const v = payload(
    { o: D({ pos: "QB", rk: 1 }), h: D({ pos: "QB", rk: 2, nm: "H" }), scrambler: D({ pos: "QB", rk: 3, nm: "S" }) },
    [A({ id: "o", pos: "QB" })],
  );
  const got = vacancies(league(), v, { usage: usageOf([["h", 0], ["scrambler", 9]]) });
  assert.strictEqual(got[0].disagree, null);
});

t("the cross-check is silent rather than wrong when there is no usage layer", () => {
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }) }, [A({ id: "o" })]);
  assert.strictEqual(vacancies(league(), v, { usage: null })[0].disagree, null);
});

t("MISSING IS NOT ZERO: an unmeasured chart manufactures no disagreement", () => {
  // MUTATION-DRIVEN. The first version of this test asserted that a player
  // with no usage loses to a player with 0.5, which is true whether the
  // missing value reads as null or as 0 - so it passed with the bug in
  // place and proved nothing.
  //
  // The shape that actually bites: NOBODY has a usage entry. With null the
  // comparison has no candidate and stays silent, which is correct. Coerced
  // to 0, the first man on the chart becomes the "best" on a measurement
  // that was never taken, and the row reports a disagreement between the
  // depth chart and data that does not exist.
  const v = payload(
    { starter: D({ pos: "RB", rk: 1, nm: "Starter" }),
      o: D({ pos: "RB", rk: 2, nm: "Hurt" }),
      h: D({ pos: "RB", rk: 3, nm: "H" }) },
    [A({ id: "o", pos: "RB", nm: "Hurt" })],
  );
  //
  // SECOND CORRECTION, also mutation-driven: an ABSENT usage entry already
  // returns null at the guard clause, so the coercion is unreachable that
  // way. The value only flows through it when the entry EXISTS and its
  // numbers are null - a real and common shape, since the mirror carries a
  // row for anyone who took a snap, opportunities or no.
  const present = { byId: new Map([
    ["starter", { oppPerGameRecent: null, oppPerGame: null }],  // measured, no touches
  ]) };
  const got = vacancies(league(), v, { usage: present });
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].nm, "H");
  assert.strictEqual(got[0].disagree, null,
    "a null opportunity is not a zero opportunity, and neither is a measurement of anybody");
  assert.strictEqual(touches("starter", present), null, "the entry exists; the number does not");
  assert.strictEqual(touches("nobody", present), null, "and no entry at all is still null");
});

// ---------------------------------------------------------------------------
// deduplication and ordering
// ---------------------------------------------------------------------------

t("two absences resolving to the same heir offer him once, with the better reason", () => {
  const v = payload(
    { w1: D({ rk: 1, nm: "W1" }), w2: D({ rk: 2, nm: "W2" }), h: D({ rk: 3, nm: "H" }) },
    [A({ id: "w2", nm: "W2", rk: 2, tier: "watch", st: "Questionable", prac: "Did Not Participate In Practice" }),
     A({ id: "w1", nm: "W1", tier: "confirmed", st: "Out" })],
  );
  const got = vacancies(league(), v);
  assert.strictEqual(got.length, 1, "a seat can only be filled once");
  assert.strictEqual(got[0].over.tier, "confirmed", "confirmed evidence outranks a practice report");
});

t("a row carries the week it was reported, so a lead cannot pass as a fact", () => {
  const v = payload(
    { o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }), o2: D({ tm: "KC", rk: 1 }), h2: D({ tm: "KC", rk: 2, nm: "H2" }) },
    [A({ id: "o", wk: 2 }), A({ id: "o2", tm: "KC", wk: 3 })],
  );
  const got = vacancies(league(), v);
  const byId = Object.fromEntries(got.map((g) => [g.id, g]));
  assert.strictEqual(byId.h.stale, true, "last week's report");
  assert.strictEqual(byId.h2.stale, false, "this week's");
});

// ---------------------------------------------------------------------------
// promotions
// ---------------------------------------------------------------------------

t("a climb of null is an arrival, not a promotion", () => {
  // null means he was not on the chart a week ago, or changed teams. Reading
  // that as 0 would be harmless; reading it as movement would invent news.
  const v = payload({ a: D({ rk: 1, climb: null, nm: "New" }) }, []);
  assert.deepStrictEqual(promotions(league(), v), []);
});

t("a promotion needs to land somewhere that matters", () => {
  const deep = payload({ a: D({ rk: 5, climb: 2, nm: "Deep" }) }, []);
  assert.strictEqual(promotions(league(), deep).length, 0);

  const real = payload({ a: D({ rk: 1, climb: 2, nm: "Real" }) }, []);
  assert.strictEqual(promotions(league(), real).length, 1);
});

t("promotions are ordered by how far he moved, then by how senior the job is", () => {
  const v = payload({
    big: D({ rk: 2, climb: 3, nm: "Big" }),
    small: D({ rk: 1, climb: 1, nm: "Small" }),
    mid: D({ rk: 1, climb: 2, nm: "Mid" }),
  }, []);
  assert.deepStrictEqual(promotions(league(), v).map((p) => p.nm), ["Big", "Mid", "Small"]);
});

t("a player already offered as an heir is not offered again as a promotion", () => {
  const v = payload(
    { o: D({ rk: 1 }), h: D({ rk: 2, climb: 2, nm: "H" }) },
    [A({ id: "o" })],
  );
  const board = vacancyBoard(league(), v);
  assert.strictEqual(board.vacancies.length, 1);
  assert.strictEqual(board.promotions.length, 0, "one player, one row");
});

t("an absent player is never his own promotion", () => {
  const v = payload({ o: D({ rk: 1, climb: 2, nm: "Hurt" }) }, [A({ id: "o", nm: "Hurt" })]);
  assert.strictEqual(promotions(league(), v).length, 0);
});

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

t("a partially-reported week is flagged as partial", () => {
  // The Tuesday-evening reality: nflverse has two clubs in and thirty to go.
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }) }, [A({ id: "o" })],
                    { coverage: { 2: { teams_reported: 32 }, 3: { teams_reported: 2 } } });
  const board = vacancyBoard(league(), v);
  assert.strictEqual(board.teamsReported, 2);
  assert.strictEqual(board.partial, true);
});

t("a fully-reported week is not flagged", () => {
  const v = payload({ o: D({ rk: 1 }), h: D({ rk: 2, nm: "H" }) }, [A({ id: "o" })]);
  assert.strictEqual(vacancyBoard(league(), v).partial, false);
});

t("the block stays silent when neither question has an answer", () => {
  const v = payload({ a: D({ rk: 1, nm: "Nobody" }) }, []);
  const board = vacancyBoard(league(), v);
  assert.strictEqual(board.any, false);
  assert.deepStrictEqual(board.vacancies, []);
  assert.deepStrictEqual(board.promotions, []);
});

t("slot eligibility is borrowed from the lineup solver, never restated", () => {
  assert.deepStrictEqual(POSITIONS_FOR("FLEX"), ["RB", "WR", "TE"]);
  assert.deepStrictEqual(POSITIONS_FOR("SUPER_FLEX"), ["QB", "RB", "WR", "TE"]);
});

t("claimable reports why, so a caller cannot mistake 'rostered' for 'no data'", () => {
  const L = league({ rostered: ["owned"], priced: [{ id: "free", team: "HOU" }] });
  assert.strictEqual(claimable("owned", L, D({ nm: "Owned" })), null);
  assert.ok(claimable("free", L, D({ nm: "Free" })));
  assert.strictEqual(claimable("ghost", L, D({ nm: "Ghost" })).unprojected, true);
});

console.log(`vacancy  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

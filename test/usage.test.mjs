import { index, aggregate, checkFreshness, RECENT } from "../js/usage.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
const ta = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const COLS = ["wk","off_pct","tgt","rec","rec_yd","tgt_share","ay_share","wopr","car","rush_yd","att","pass_yd"];
const w = (wk, off, tgt, car, share) => [wk, off, tgt, 0, 0, share, null, null, car, 0, 0, 0];
const payload = (players, extra = {}) => ({
  season: 2026, through_week: 3, cols: COLS, act_keys: ["rec","rush_yd"], p: players, ...extra,
});

t("missing is not zero: a null snap row stays null through the average", () => {
  const u = index(payload({ "1": { pos:"WR", tm:"KC", w: [w(1,0.8,5,0,0.2), w(2,null,6,0,0.2), w(3,0.9,7,0,0.2)] } }));
  const p = u.byId.get("1");
  // (0.8 + 0.9) / 2, NOT (0.8 + 0 + 0.9) / 3
  assert.strictEqual(p.snapPct, 0.85);
});

t("a player with no measurable value for a stat gets null, not zero", () => {
  const u = index(payload({ "1": { pos:"WR", tm:"KC", w: [w(1,null,3,0,null)] } }));
  assert.strictEqual(u.byId.get("1").snapPct, null);
  assert.strictEqual(u.byId.get("1").tgtShare, null);
});

t("the recent window is the last three games and reports its own size", () => {
  const rows = [1,2,3,4,5].map((i) => w(i, 0.5, i, 0, 0.1));
  const a = aggregate(rows.map((r) => ({
    wk:r[0], snapPct:r[1], tgt:r[2], rec:r[3], recYd:r[4], tgtShare:r[5],
    ayShare:r[6], wopr:r[7], car:r[8], rushYd:r[9], att:r[10], passYd:r[11],
  })));
  assert.strictEqual(a.games, 5);
  assert.strictEqual(a.gamesRecent, RECENT);
  assert.strictEqual(a.tgtPerGame, 3);          // (1+2+3+4+5)/5
  assert.strictEqual(a.tgtPerGameRecent, 4);    // (3+4+5)/3
});

t("a short season gives a recent window smaller than three, and says so", () => {
  const u = index(payload({ "1": { pos:"RB", tm:"KC", w: [w(1,0.6,2,10,0.1)] } }));
  const p = u.byId.get("1");
  assert.strictEqual(p.games, 1);
  assert.strictEqual(p.gamesRecent, 1, "a one-game 'last three' must not claim three");
});

t("opportunity is carries plus targets", () => {
  const u = index(payload({ "1": { pos:"RB", tm:"KC", w: [w(1,0.7,3,12,0.08), w(2,0.7,5,10,0.1)] } }));
  assert.strictEqual(u.byId.get("1").oppPerGame, 15);   // (15 + 15) / 2
});

t("REGRESSION: an unmeasured week is skipped by opportunity, not counted as zero touches", () => {
  // The first version coerced nulls to 0 before summing, so the expression was
  // always finite and mean()'s filter never fired. 16 and 19 touches plus one
  // unmeasured week averaged 11.7 instead of 17.5.
  const rows = [
    { wk:1, car:12, tgt:4 },            // 16
    { wk:2, car:null, tgt:null },       // unmeasured
    { wk:3, car:15, tgt:4 },            // 19
  ].map((r) => ({ snapPct:null, rec:0, recYd:0, tgtShare:null, ayShare:null, wopr:null,
                  rushYd:0, att:0, passYd:0, ...r }));
  assert.strictEqual(aggregate(rows).oppPerGame, 17.5);
});

t("a week with one of the two figures counts the one it has", () => {
  const rows = [
    { wk:1, car:10, tgt:null },         // 10
    { wk:2, car:null, tgt:6 },          // 6
  ].map((r) => ({ snapPct:null, rec:0, recYd:0, tgtShare:null, ayShare:null, wopr:null,
                  rushYd:0, att:0, passYd:0, ...r }));
  assert.strictEqual(aggregate(rows).oppPerGame, 8);
});

t("the target total is drawn only from weeks that reported targets", () => {
  const rows = [
    { wk:1, tgt:7, car:0 }, { wk:2, tgt:null, car:0 }, { wk:3, tgt:5, car:0 },
  ].map((r) => ({ snapPct:null, rec:0, recYd:0, tgtShare:null, ayShare:null, wopr:null,
                  rushYd:0, att:0, passYd:0, ...r }));
  const a = aggregate(rows);
  assert.strictEqual(a.tgtTotal, 12);
  assert.strictEqual(a.tgtWeeks, 2, "and it says how many weeks that came from");
});

t("actuals are carried through under their Sleeper keys", () => {
  const u = index(payload({ "1": { pos:"WR", tm:"KC", w:[w(1,0.8,5,0,0.2)], a: { "1": { rec: 5, rec_yd: 71 } } } }));
  assert.deepStrictEqual(u.byId.get("1").actual["1"], { rec: 5, rec_yd: 71 });
});

t("a player with no weeks is not indexed at all", () => {
  const u = index(payload({ "1": { pos:"WR", tm:"KC", w: [] } }));
  assert.strictEqual(u.byId.size, 0);
  assert.strictEqual(u.ok, false);
});

t("the payload's own stamp is carried, not invented", () => {
  const u = index(payload({ "1": { pos:"WR", tm:"KC", w:[w(1,0.8,5,0,0.2)] } },
    { generated_at: "2026-09-13T18:00:00Z", through_week: 2 }));
  assert.strictEqual(u.throughWeek, 2);
  assert.strictEqual(u.generatedAt, "2026-09-13T18:00:00Z");
  assert.strictEqual(u.hasActuals, true);
});

await ta("freshness reports BEHIND when upstream moved after the mirror was built", async () => {
  const usage = { ok: true, season: 2026, generatedAt: "2026-09-13T10:00:00Z" };
  const f = await checkFreshness(usage, { fetchImpl: async () => ({
    ok: true, json: async () => ({ assets: [{ name: "stats_player_week_2026.csv", updated_at: "2026-09-13T13:50:13Z" }] }),
  }) });
  assert.strictEqual(f.behind, true);
  assert.strictEqual(f.hours, 4);
});

await ta("freshness says nothing rather than guessing when the API is unreachable", async () => {
  const usage = { ok: true, season: 2026, generatedAt: "2026-09-13T10:00:00Z" };
  assert.strictEqual(await checkFreshness(usage, { fetchImpl: async () => { throw new Error("nope"); } }), null);
  assert.strictEqual(await checkFreshness(usage, { fetchImpl: async () => ({ ok: false }) }), null);
  assert.strictEqual(await checkFreshness({ ok: false }, { fetchImpl: async () => ({}) }), null);
});

console.log(`usage  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

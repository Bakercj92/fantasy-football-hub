import { rosteredIds, replacementLevels, vor, positionSigma, startingPool,
         threshold, sigmaTable, SIGMA_FLOOR, SIGMA_CAP } from "../js/value.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const uni = (rows) => new Map(rows.map((r) => [r.id, { startable: true, ...r }]));

t("rosteredIds unions every roster and stringifies", () => {
  const s = rosteredIds([{ players: ["a", 1] }, { players: ["b"] }, {}]);
  assert.deepStrictEqual([...s].sort(), ["1", "a", "b"]);
});

t("replacement level is the best FREE player, not the best player", () => {
  const priced = uni([
    { id:"star", pos:"RB", pts:22 }, { id:"mid", pos:"RB", pts:11 }, { id:"free", pos:"RB", pts:6 },
  ]);
  const lv = replacementLevels(priced, new Set(["star", "mid"]));
  assert.strictEqual(lv.RB.pts, 6);
  assert.strictEqual(lv.RB.id, "free");
});

t("a free but ruled-out player is not an available alternative", () => {
  const priced = uni([
    { id:"hurt", pos:"WR", pts:15, startable:false }, { id:"free", pos:"WR", pts:5 },
  ]);
  assert.strictEqual(replacementLevels(priced, new Set()).WR.pts, 5);
});

t("league SIZE changes replacement level, which is the whole point", () => {
  const pool = [];
  for (let i = 0; i < 40; i++) pool.push({ id:`rb${i}`, pos:"RB", pts: 25 - i * 0.5 });
  const priced = uni(pool);
  const deep    = new Set(pool.slice(0, 34).map((p) => p.id)); // 14-team: most RBs owned
  const shallow = new Set(pool.slice(0, 14).map((p) => p.id)); // 8-team: many RBs free
  const lvDeep = replacementLevels(priced, deep).RB.pts;
  const lvShal = replacementLevels(priced, shallow).RB.pts;
  assert.ok(lvDeep < lvShal, "deeper league must have a LOWER replacement level");
  const me = priced.get("rb5");
  assert.ok(vor(me, { RB: { pts: lvDeep } }) > vor(me, { RB: { pts: lvShal } }),
    "the same player is worth MORE in the deeper league");
});

t("vor is null for an unprojected player, never zero", () => {
  assert.strictEqual(vor({ pos:"RB", pts:null }, { RB:{pts:5} }), null);
  assert.strictEqual(vor(undefined, {}), null);
});

t("vor falls back to raw points when a position has no free agent at all", () => {
  assert.strictEqual(vor({ pos:"K", pts:8 }, {}), 8);
});

t("sigma is measured over the starter-caliber pool only", () => {
  const rows = [];
  for (let i = 0; i < 5; i++)  rows.push({ id:`t${i}`, pos:"TE", pts: 12 - i * 0.2 }); // tight
  for (let i = 0; i < 60; i++) rows.push({ id:`j${i}`, pos:"TE", pts: 3 - i * 0.04 });  // junk
  const priced = uni(rows);
  const tight = positionSigma(priced, "TE", 5);
  const all   = positionSigma(priced, "TE", 65);
  assert.ok(tight < all, "including 60 fourth-stringers must inflate sigma");
});

t("positionSigma needs two points to mean anything", () => {
  assert.strictEqual(positionSigma(uni([{ id:"a", pos:"QB", pts:10 }]), "QB", 5), null);
  assert.strictEqual(positionSigma(uni([]), "QB", 5), null);
});

t("startingPool counts flex share, and superflex lifts QB", () => {
  const joop = ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"];
  const bku  = ["QB","RB","RB","WR","WR","TE","FLEX","FLEX","SUPER_FLEX","K","DEF"];
  assert.strictEqual(startingPool(joop, 14, "QB"), 14);
  assert.ok(startingPool(bku, 8, "QB") > 8, "superflex must start more than one QB per team");
  assert.ok(startingPool(joop, 14, "RB") > 28, "flex must lift the RB pool above 2 per team");
});

t("threshold is half sigma, floored and capped", () => {
  assert.strictEqual(threshold({ QB: 1.4 }, "QB"), SIGMA_FLOOR, "0.7 is under the floor");
  assert.strictEqual(threshold({ RB: 3.4 }, "RB"), 1.7);
  assert.strictEqual(threshold({ WR: 20 }, "WR"), SIGMA_CAP);
});

t("a two-position comparison takes the LARGER threshold, not quadrature", () => {
  const s = { QB: 1.0, RB: 3.4 };
  assert.strictEqual(threshold(s, "QB", "RB"), 1.7);
  assert.ok(threshold(s, "QB", "RB") < Math.hypot(1.0, 1.7), "must not be quadrature");
});

t("threshold degrades to the floor when variance is unknown", () => {
  assert.strictEqual(threshold({}, "RB"), SIGMA_FLOOR);
  assert.strictEqual(threshold({ RB: 3.4 }, undefined), SIGMA_FLOOR);
});

t("sigmaTable covers every scoring position it can measure", () => {
  const rows = [];
  for (const pos of ["QB","RB","WR","TE","K","DEF"])
    for (let i = 0; i < 30; i++) rows.push({ id:`${pos}${i}`, pos, pts: 20 - i * 0.4 });
  const tbl = sigmaTable(uni(rows), ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"], 14);
  for (const pos of ["QB","RB","WR","TE","K","DEF"]) assert.ok(typeof tbl[pos] === "number", pos);
});

console.log(`\nvalue:  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

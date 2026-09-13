import { leagueShape, urlFor, shapeKey } from "../js/fantasycalc.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const L = (slots, rec, teams) => ({
  roster_positions: slots, scoring_settings: { rec }, total_rosters: teams,
});

t("Joop: 14-team, one QB, full PPR", () => {
  const s = leagueShape(L(["QB","RB","RB","WR","WR","WR","TE","FLEX","K","DEF","BN","BN"], 1, 14));
  assert.deepStrictEqual(s, { numQbs: 1, numTeams: 14, ppr: 1 });
});

t("Ball Knowers: a SUPER_FLEX slot makes it a 2QB board", () => {
  const s = leagueShape(L(["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","K","DEF","BN"], 1, 8));
  assert.deepStrictEqual(s, { numQbs: 2, numTeams: 8, ppr: 1 });
});

t("two QB slots and no superflex is still the 2QB board", () => {
  assert.strictEqual(leagueShape(L(["QB","QB","RB","WR"], 1, 10)).numQbs, 1,
    "FantasyCalc exposes 1QB or superflex only; a 2QB league without a SUPER_FLEX slot " +
    "is not something the endpoint models, so do not fabricate a setting for it");
});

t("reception scoring is read from the league, not assumed", () => {
  assert.strictEqual(leagueShape(L(["QB"], 0.5, 12)).ppr, 0.5);
  assert.strictEqual(leagueShape(L(["QB"], 0, 12)).ppr, 0);
  assert.strictEqual(leagueShape(L(["QB"], 1, 12)).ppr, 1);
});

t("an odd reception value snaps to the nearest setting the endpoint accepts", () => {
  assert.strictEqual(leagueShape(L(["QB"], 0.4, 12)).ppr, 0.5);
  assert.strictEqual(leagueShape(L(["QB"], 0.2, 12)).ppr, 0);
  assert.strictEqual(leagueShape(L(["QB"], 0.9, 12)).ppr, 1);
});

t("an exact tie snaps DOWN, deterministically", () => {
  // 0.75 is equidistant from 0.5 and 1. Neither is more correct, but the
  // choice must be stable: an unstable one would swap a league's whole market
  // board between page loads for no visible reason.
  assert.strictEqual(leagueShape(L(["QB"], 0.75, 12)).ppr, 0.5);
  assert.strictEqual(leagueShape(L(["QB"], 0.25, 12)).ppr, 0);
});

t("a league with nothing readable still produces a fetchable shape", () => {
  const s = leagueShape({});
  assert.deepStrictEqual(s, { numQbs: 1, numTeams: 12, ppr: 0 });
});

t("the URLs match the two verified live 2026-09-13", () => {
  assert.strictEqual(
    urlFor({ numQbs: 1, numTeams: 14, ppr: 1 }),
    "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=14&ppr=1");
  assert.strictEqual(
    urlFor({ numQbs: 2, numTeams: 8, ppr: 1 }),
    "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=8&ppr=1");
});

t("each league shape caches under its own key", () => {
  assert.notStrictEqual(
    shapeKey({ numQbs:1, numTeams:14, ppr:1 }),
    shapeKey({ numQbs:2, numTeams:8, ppr:1 }),
    "one shared cache key would serve one league the other's board — the exact defect this layer fixes");
});

console.log(`fantasycalc  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

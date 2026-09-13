import { scoreWeek, recap } from "../js/memory.js";
import { rescore } from "../js/scoring.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

// Both leagues pay FOUR for a passing touchdown. The vendor's pts_ppr pays six.
const SCORING = { rec:1, pass_yd:0.04, pass_td:4, pass_int:-1, rush_yd:0.1, rush_td:6,
                  rec_yd:0.1, rec_td:6, fum_lost:-2 };

const usageOf = (map, through = 5) => ({
  ok: true, throughWeek: through,
  byId: new Map(Object.entries(map).map(([id, act]) => [id, { actual: act }])),
});

t("a week is scored at THIS league's rules, not the vendor's total", () => {
  // 300 passing yards and 2 passing TDs: 12 + 8 = 20 here; a 6-point-TD
  // vendor total would say 24.
  const u = usageOf({ qb: { "3": { pass_yd: 300, pass_td: 2 } } });
  assert.strictEqual(scoreWeek(["qb"], 3, { usage: u, scoring: SCORING, rescore }).pts, 20);
});

t("players with no published stats are counted out loud, not silently zeroed", () => {
  const u = usageOf({ a: { "3": { rec: 5, rec_yd: 50 } } });
  const s = scoreWeek(["a", "ghost"], 3, { usage: u, scoring: SCORING, rescore });
  assert.strictEqual(s.pts, 10);
  assert.strictEqual(s.scored, 1);
  assert.strictEqual(s.of, 2, "the caller has to be able to see this is partial");
});

t("a week with nothing published scores null, never zero", () => {
  const u = usageOf({ a: { "3": { rec: 5 } } });
  assert.strictEqual(scoreWeek(["a"], 9, { usage: u, scoring: SCORING, rescore }), null);
  assert.strictEqual(scoreWeek([], 3, { usage: u, scoring: SCORING, rescore }), null);
  assert.strictEqual(scoreWeek(["a"], 3, { usage: { ok:false }, scoring: SCORING, rescore }), null);
});

// --- the recap --------------------------------------------------------------

const LOG = [{
  kind: "lineup", leagueKey: "joop", season: "2026", week: 3,
  started: ["mine"], suggested: ["theirs"], threshold: 1.6,
}];

const U = usageOf({
  mine:   { "3": { rec: 4, rec_yd: 40 } },      // 8.0
  theirs: { "3": { rec: 6, rec_yd: 90 } },      // 15.0
});

t("the recap grades a finished, published week and signs the delta toward the tool", () => {
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:5, usage:U,
                    scoring:SCORING, rescore, log:LOG });
  assert.strictEqual(r.any, true);
  assert.strictEqual(r.rows[0].yours, 8);
  assert.strictEqual(r.rows[0].suggested, 15);
  assert.strictEqual(r.rows[0].delta, 7, "+ means taking the call would have scored more");
  assert.strictEqual(r.netLineup, 7);
  assert.strictEqual(r.netLocked, null, "nothing was locked out, so there is no lockout total");
});

t("the CURRENT week is never graded — it has not finished", () => {
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:3, usage:U,
                    scoring:SCORING, rescore, log:LOG });
  assert.strictEqual(r.any, false);
});

t("a week nflverse has not published yet is not graded, whatever the calendar says", () => {
  // It is week 5, so week 3 is over - but the mirror only has through week 2.
  const stale = { ...U, throughWeek: 2 };
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:5, usage:stale,
                    scoring:SCORING, rescore, log:LOG });
  assert.strictEqual(r.any, false, "a Tuesday with no published data must produce no recap, not a wrong one");
});

t("another league's decisions never appear in this league's recap", () => {
  const r = recap({ leagueKey:"bku", season:"2026", currentWeek:5, usage:U,
                    scoring:SCORING, rescore, log:LOG });
  assert.strictEqual(r.any, false);
});

t("a partially published week is shown but kept OUT of the totals", () => {
  // through_week flips the moment any row for that week lands, so a Tuesday
  // recap can be grading a week whose Monday-night player is not mirrored yet.
  const log = [{ kind:"lineup", leagueKey:"joop", season:"2026", week:3,
                 started:["mine","ghostA","ghostB"], suggested:["theirs"] }];
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:5, usage:U,
                    scoring:SCORING, rescore, log });
  assert.strictEqual(r.rows[0].partial, true, "1 of 3 players scored");
  assert.strictEqual(r.netLineup, null, "a partial week must not become a headline number");
  assert.strictEqual(r.partialCount, 1);
});

t("calls and lockouts are totalled separately", () => {
  const log = [
    { kind:"lineup", leagueKey:"joop", season:"2026", week:3, started:["mine"], suggested:["theirs"] },
    { kind:"locked_out", leagueKey:"joop", season:"2026", week:3,
      entering:[{ id:"theirs", name:"Could Have" }], leaving:[{ id:"mine", name:"Stuck With" }] },
  ];
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:5, usage:U,
                    scoring:SCORING, rescore, log });
  assert.strictEqual(r.netLineup, 7);
  assert.strictEqual(r.netLocked, 7);
  assert.ok(!("net" in r), "one combined number would let a lockout read as a decision you got wrong");
});

t("a lockout entry is graded on what it actually cost, not what it projected", () => {
  const log = [{
    kind:"locked_out", leagueKey:"joop", season:"2026", week:3,
    entering:[{ id:"theirs", name:"Could Have" }], leaving:[{ id:"mine", name:"Stuck With" }],
    cost: 99,   // the PROJECTED cost recorded at the time; the recap ignores it
  }];
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:5, usage:U,
                    scoring:SCORING, rescore, log });
  assert.strictEqual(r.rows[0].couldHaveStarted, 15);
  assert.strictEqual(r.rows[0].hadToStart, 8);
  assert.strictEqual(r.rows[0].delta, 7);
});

t("the recap is ordered newest week first", () => {
  const log = [1,2,3].map((w) => ({ ...LOG[0], week: w }));
  const u = usageOf({
    mine:   { "1":{rec:1}, "2":{rec:1}, "3":{rec:4, rec_yd:40} },
    theirs: { "1":{rec:2}, "2":{rec:2}, "3":{rec:6, rec_yd:90} },
  });
  const r = recap({ leagueKey:"joop", season:"2026", currentWeek:5, usage:u,
                    scoring:SCORING, rescore, log });
  assert.deepStrictEqual(r.rows.map((x) => x.week), [3,2,1]);
  assert.strictEqual(r.weeks, 3);
});

console.log(`memory  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// The Today model. The thing most worth testing here is what it REFUSES to do:
// no cross-league ranking, no single points scale, no class promoted twice.
import assert from "node:assert";
import { todayModel, callDeadline, claimsLead, waiverDay, LOCK_SOON_MS, WAIVER_DAY, WATCH_PER_LEAGUE }
  from "../v2/logic/today.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);          // Sunday 11:00 ET
const soon = NOW + 60 * 60 * 1000;                     // kickoff in an hour
const later = NOW + 8 * 60 * 60 * 1000;                // kickoff in eight
const P = (name, over = {}) => ({ id: name, name, pos: "WR", pts: 10, game: { kickoffUTC: later }, ...over });

const league = (key, name, over = {}) => ({
  entry: { key, name },
  league: { settings: { waiver_day_of_week: 2 } },
  calls: { actionable: false, entering: [], leaving: [], forced: [], gain: 0 },
  waivers: { any: false, upgrades: [], risers: [], def: null },
  vacancies: { any: false, vacancies: [], promotions: [] },
  optimal: [], roster: [], faabLeft: 50,
  ...over,
});

const stateOf = (...Ls) => ({
  cfg: { leagues: Ls.map((L) => ({ key: L.entry.key })) },
  leagues: Object.fromEntries(Ls.map((L) => [L.entry.key, L])),
});

const cls = (m, k) => m.classes.find((c) => c.key === k);

t("a quiet week says so rather than rendering empty classes", () => {
  const m = todayModel(stateOf(league("joop", "Joop")), { now: NOW, day: 0 });
  assert.strictEqual(m.quiet, true);
  assert.deepStrictEqual(m.classes, []);
  assert.strictEqual(m.checked.length, 1, "it still reports what it checked");
});

t("a correction inside the window is PROMOTED, not duplicated", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("in", { game: { kickoffUTC: soon } })],
             leaving: [P("out", { pts: 4 })], forced: [], gain: 6 },
  });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "locking").count, 1);
  assert.strictEqual(cls(m, "lineup"), undefined, "the same call must not also sit in lineup");
});

t("a correction outside the window stays in lineup corrections", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("in")], leaving: [P("out", { pts: 4 })], forced: [], gain: 6 },
  });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "lineup").count, 1);
  assert.strictEqual(cls(m, "locking"), undefined);
});

t("a deadline already passed is not 'soon'", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("in", { game: { kickoffUTC: NOW - 1000 } })],
             leaving: [P("out")], forced: [], gain: 6 },
  });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "locking"), undefined);
});

t("a locked player's kickoff is not the deadline - his deadline has passed", () => {
  assert.strictEqual(callDeadline({ in: P("a", { locked: true, game: { kickoffUTC: soon } }), out: null }), null);
  assert.strictEqual(callDeadline({ in: P("a", { game: { kickoffUTC: soon } }),
                                    out: P("b", { game: { kickoffUTC: later } }) }), soon);
  assert.strictEqual(callDeadline({ in: P("a", { game: {} }), out: null }), null);
});

t("forced calls sort ahead of bigger optional ones", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true,
      entering: [P("big", { pts: 30 }), P("small", { pts: 11 })],
      leaving: [P("x", { pts: 1 }), P("hurt", { pts: 9, startable: false })],
      forced: [1], gain: 30 },
  });
  const items = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "lineup").leagues[0].items;
  assert.strictEqual(items[0].forced, true, "forced first even though its delta is smaller");
  assert.strictEqual(items[1].forced, false);
});

t("NO CROSS-LEAGUE RANKING: leagues come out in config order, never by size", () => {
  const small = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("a", { pts: 2 })], leaving: [P("b", { pts: 1 })], forced: [], gain: 1 },
  });
  const big = league("bku", "Ball Knowers", {
    calls: { actionable: true, entering: [P("c", { pts: 40 })], leaving: [P("d", { pts: 1 })], forced: [], gain: 39 },
  });
  const m = todayModel(stateOf(small, big), { now: NOW, day: 0 });
  assert.deepStrictEqual(cls(m, "lineup").leagues.map((g) => g.key), ["joop", "bku"],
    "the 39-point league must not jump the 1-point league");
});

t("every item carries its league, so nothing is attributable to the wrong team", () => {
  const a = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("a")], leaving: [P("b")], forced: [], gain: 5 } });
  const b = league("bku", "Ball Knowers", {
    calls: { actionable: true, entering: [P("c")], leaving: [P("d")], forced: [], gain: 5 } });
  const groups = cls(todayModel(stateOf(a, b), { now: NOW, day: 0 }), "lineup").leagues;
  assert.deepStrictEqual(groups.map((g) => g.name), ["Joop", "Ball Knowers"]);
  assert.ok(groups.every((g) => g.items.length === 1));
});

t("THE DEFENCE SEAT SPLITS ON `counts`, exactly as wireTally reads it", () => {
  const work = league("joop", "Joop", { waivers: { any: true, upgrades: [], risers: [],
    def: { slot: "DEF", current: { name: "LV", pts: 4 }, best: { name: "KC", pts: 9 },
           gap: 5, actionable: true, counts: true } } });
  assert.strictEqual(cls(todayModel(stateOf(work), { now: NOW, day: 0 }), "claims").count, 1);

  const quiet = league("joop", "Joop", { waivers: { any: true, upgrades: [], risers: [],
    def: { slot: "DEF", current: { name: "LV", pts: 9 }, best: { name: "KC", pts: 4 },
           gap: -5, counts: false } } });
  const m = todayModel(stateOf(quiet), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "claims"), undefined, "'yours is fine' is not work");
  assert.strictEqual(cls(m, "watch").count, 1, "...but it is still worth one quiet line");
});

t("a marginal defence is never counted as work", () => {
  // waivers.js makes marginal and counts mutually exclusive; the model must
  // not reintroduce the overlap by reading `marginal` instead of `counts`.
  const L = league("joop", "Joop", { waivers: { any: true, upgrades: [], risers: [],
    def: { slot: "DEF", current: { name: "LV", pts: 8 }, best: { name: "KC", pts: 9 },
           gap: 1, marginal: true, counts: false } } });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "claims"), undefined);
});

t("claims lead on the processing day and the day before it, not otherwise", () => {
  const L = league("joop", "Joop");
  assert.strictEqual(waiverDay(L.league), 3, "sleeper value 2 is measured as Wednesday");
  assert.strictEqual(claimsLead([L], 3), true, "Wednesday - processing day");
  assert.strictEqual(claimsLead([L], 2), true, "Tuesday - bids are due");
  for (const d of [0, 1, 4, 5, 6]) assert.strictEqual(claimsLead([L], d), false, `day ${d}`);
});

t("an unmapped waiver day claims nothing it cannot prove", () => {
  // Sleeper's numbering is not generally resolved. Only value 2 is measured.
  const L = league("joop", "Joop", { league: { settings: { waiver_day_of_week: 5 } } });
  assert.strictEqual(waiverDay(L.league), null);
  assert.strictEqual(claimsLead([L], 3), false);
  assert.deepStrictEqual(Object.keys(WAIVER_DAY), ["2"], "do not add a mapping without evidence");
});

t("the class order follows the day", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("a")], leaving: [P("b")], forced: [], gain: 5 },
    waivers: { any: true, upgrades: [{ id: "w", name: "W", gap: 3, slot: "RB" }],
               risers: [{ id: "r", name: "Riser", pos: "WR" }], def: null },
  });
  const sunday = todayModel(stateOf(L), { now: NOW, day: 0 }).classes.map((c) => c.key);
  const wednesday = todayModel(stateOf(L), { now: NOW, day: 3 }).classes.map((c) => c.key);
  assert.deepStrictEqual(sunday, ["lineup", "claims", "watch"]);
  assert.deepStrictEqual(wednesday, ["claims", "lineup", "watch"]);
});

t("the claims heading only says 'today' when it is true", () => {
  const L = league("joop", "Joop", {
    waivers: { any: true, upgrades: [{ id: "w", name: "W", gap: 3, slot: "RB" }], risers: [], def: null } });
  assert.match(cls(todayModel(stateOf(L), { now: NOW, day: 3 }), "claims").label, /today/);
  assert.strictEqual(cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "claims").label, "On the wire");
});

t("the window is two hours, and it is the stated one", () => {
  assert.strictEqual(LOCK_SOON_MS, 2 * 60 * 60 * 1000);
});

t("WATCH IS CAPPED PER LEAGUE, and the header still counts what exists", () => {
  // Measured on the fixture: uncapped, "Worth knowing" was 23 rows across
  // three leagues - longer than every actionable class combined, on a page
  // whose job is to say what needs doing.
  const risers = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, pos: "WR" }));
  const L = league("joop", "Joop", { waivers: { any: true, upgrades: [], risers, def: null } });
  const c = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "watch");
  assert.strictEqual(c.leagues[0].items.length, WATCH_PER_LEAGUE);
  assert.strictEqual(c.leagues[0].more, 9 - WATCH_PER_LEAGUE);
  assert.strictEqual(c.count, 9, "the heading reports what exists, not what fits");
  assert.strictEqual(c.shown, WATCH_PER_LEAGUE);
});

t("the actionable classes are never capped - everything there is worth doing", () => {
  const entering = Array.from({ length: 7 }, (_, i) => P(`in${i}`, { pts: 20 - i }));
  const leaving = Array.from({ length: 7 }, (_, i) => P(`out${i}`, { pts: 1 }));
  const L = league("joop", "Joop", { calls: { actionable: true, entering, leaving, forced: [], gain: 50 } });
  const c = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "lineup");
  assert.strictEqual(c.leagues[0].items.length, 7);
  assert.strictEqual(c.leagues[0].more, 0);
});

console.log(`v2 today: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

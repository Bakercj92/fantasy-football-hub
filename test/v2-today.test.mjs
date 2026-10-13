// The Today model. The thing most worth testing here is what it REFUSES to do:
// no cross-league ranking, no single points scale, no class promoted twice.
import assert from "node:assert";
import { todayModel, callDeadline, claimsLead, waiverDay, LOCK_SOON_MS, WAIVER_DAY, WATCH_PER_LEAGUE }
  from "../v2/logic/today.js";
import { itemLine } from "../v2/pages.js";

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

// --------------------------------------------------------------------------
// The defects the phase-2 audit blocked on.
// --------------------------------------------------------------------------

t("AN EMPTY DEF SEAT HAS NO `current`, and rendering it must not throw", () => {
  // waivers.js:274 sets current null by construction when the seat is empty,
  // and counts stays true there because `!current?.locked` is `!undefined`.
  // Reading `.name` off it replaced the entire page with the error screen.
  const def = { slot: "DEF", empty: true, current: null,
                best: { name: "Kansas City", pts: 9.2 }, gap: 9.2, counts: true };
  const L = league("joop", "Joop", { waivers: { any: true, upgrades: [], risers: [], def } });
  const c = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "claims");
  assert.strictEqual(c.count, 1, "an empty seat is work");
  const it = c.leagues[0].items[0];
  assert.strictEqual(it.verdict.kind, "empty");
  const [text] = itemLine(it);
  assert.match(text, /empty DEF seat/);
  assert.match(text, /Kansas City/);
});

t("every item kind renders without throwing, including the thin ones", () => {
  const kinds = [
    { kind: "call", forced: true, out: { name: "A", injury: "Out" }, in: null, delta: -9 },
    { kind: "call", forced: false, in: { name: "B" }, out: null, delta: 5 },
    { kind: "claim", player: { name: "C" }, over: null, slot: "RB", gap: 3 },
    { kind: "def", verdict: { kind: "actionable", best: { name: "KC" }, current: { name: "LV" } }, gap: 5 },
    { kind: "def-quiet", verdict: { kind: "tie" } },
    { kind: "signal", player: { name: "D", pos: "WR" }, flag: { severity: "high", text: "no usage" } },
    { kind: "vacancy", row: { nm: "E", tm: "KC", pos: "RB", rk: 2, over: { nm: "F", tier: "confirmed" } } },
    { kind: "promotion", row: { nm: "G", tm: "BUF", pos: "TE", rk: 1, climb: 2 } },
    { kind: "riser", player: { name: "H", pos: "WR" } },
  ];
  for (const it of kinds) {
    const [text, chip] = itemLine(it);
    assert.ok(typeof text === "string" && text.length, `${it.kind} produced no text`);
    assert.ok(!/undefined|null|NaN/.test(text), `${it.kind} leaked a placeholder: ${text}`);
    assert.ok(typeof chip === "string", `${it.kind} produced no chip`);
  }
});

t("THE `counts` TERM IS LOAD-BEARING and is actually tested now", () => {
  // The previous test of this name passed with the term deleted, because its
  // fixture also failed the kind gate. This one is actionable BY KIND and
  // quiet by `counts`, so only the term can reject it.
  const def = { slot: "DEF", current: { name: "LV", pts: 8.9 }, best: { name: "KC", pts: 9.2 },
                gap: 0.3, actionable: true, counts: false };
  const L = league("joop", "Joop", { waivers: { any: true, upgrades: [], risers: [], def } });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "claims"), undefined, "counts:false is not work, whatever the kind says");
  assert.strictEqual(cls(m, "watch").count, 1);
});

t("A PLAYER IS NAMED ONCE. No 'sit him' above 'nothing to do' about him.", () => {
  const hurt = P("hurt", { startable: false, injury: "Out",
    flags: [{ severity: "high", kind: "absent", text: "did not play last week" }] });
  const L = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("in")], leaving: [hurt], forced: [1], gain: 10 },
    optimal: [{ slot: "FLEX", player: hurt }], roster: [hurt],
  });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "lineup").count, 1);
  assert.strictEqual(cls(m, "watch"), undefined, "he is already named in a call");
});

t("a riser already being claimed is not also a watch item", () => {
  const guy = { id: "r1", name: "R1", pos: "WR", gap: 4, slot: "RB" };
  const L = league("joop", "Joop", {
    waivers: { any: true, upgrades: [guy], risers: [guy], def: null } });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  assert.strictEqual(cls(m, "claims").count, 1);
  assert.strictEqual(cls(m, "watch"), undefined);
});

t("THE SORT IS SIGNED: a -8 pairing never outranks a +7 one", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true,
      entering: [P("good", { pts: 17 }), P("bad", { pts: 2 })],
      leaving: [P("x", { pts: 10 }), P("y", { pts: 10 })], forced: [], gain: 7 },
  });
  const items = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "lineup").leagues[0].items;
  assert.strictEqual(items[0].delta, 7);
  assert.strictEqual(items[1].delta, -8);
});

t("'N more' points where the HIDDEN rows live, not where the first visible one does", () => {
  const sigs = Array.from({ length: 3 }, (_, i) => ({
    id: `s${i}`, name: `S${i}`, pos: "WR",
    flags: [{ severity: "high", kind: "thin", text: "one game", sigmas: 3 - i }] }));
  const risers = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, pos: "WR" }));
  const L = league("joop", "Joop", {
    optimal: sigs.map((p) => ({ slot: "WR", player: p })), roster: sigs,
    waivers: { any: true, upgrades: [], risers, def: null },
  });
  const g = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "watch").leagues[0];
  assert.deepStrictEqual(g.items.map((i) => i.kind), ["signal", "signal", "signal", "riser"]);
  assert.deepStrictEqual(g.hiddenKinds, ["riser"], "everything behind the fold is a wire item");
});

t("the signals the cap dropped are counted in 'more', not lost", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `s${i}`, name: `S${i}`, pos: "WR",
    flags: [{ severity: "high", kind: "thin", text: "one game", sigmas: i }] }));
  const L = league("joop", "Joop", { optimal: [], roster: many });
  const g = cls(todayModel(stateOf(L), { now: NOW, day: 0 }), "watch").leagues[0];
  // signalRows caps at 5 before this model ever sees them; 9 flagged players
  // must still be reported as 9.
  assert.strictEqual(g.total, 9, `reported ${g.total}`);
  assert.strictEqual(g.items.length, WATCH_PER_LEAGUE);
  assert.strictEqual(g.more, 9 - WATCH_PER_LEAGUE);
});

t("THE MODEL CARRIES NO AGGREGATE POINTS FIELD, at any level", () => {
  const L = league("joop", "Joop", {
    calls: { actionable: true, entering: [P("a")], leaving: [P("b")], forced: [], gain: 12 } });
  const m = todayModel(stateOf(L), { now: NOW, day: 0 });
  // The real property: every number the MODEL exposes above item level is a
  // whole count of items. A points aggregate would be fractional and would not
  // equal the number of things on screen. `total`, `count`, `shown` and `more`
  // are counts; nothing summed a projection to get them.
  const banned = /^(points|pts|score|sum|net|gain|value|delta)$/i;
  for (const c of m.classes) {
    for (const [k, v] of Object.entries(c)) {
      assert.ok(!banned.test(k), `class.${k} looks like a points aggregate`);
      if (typeof v === "number") assert.ok(Number.isInteger(v), `class.${k} = ${v} is not a count`);
    }
    for (const g of c.leagues) {
      for (const [k, v] of Object.entries(g)) {
        assert.ok(!banned.test(k), `group.${k} looks like a points aggregate`);
        if (typeof v === "number") assert.ok(Number.isInteger(v), `group.${k} = ${v} is not a count`);
      }
      assert.strictEqual(g.total, g.items.length + g.more, "the count must describe the items");
    }
  }
  // And the per-item numbers never leave their own league group.
  assert.ok(m.classes.every((c) => c.leagues.every((g) => g.items.every((i) => i.league === undefined))),
    "an item must not carry a cross-league key");
});

t("the cap is pinned to a value, not to itself", () => {
  assert.strictEqual(WATCH_PER_LEAGUE, 4);
});

console.log(`v2 today: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

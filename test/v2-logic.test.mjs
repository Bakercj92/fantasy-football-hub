// Unit tests for the logic lifted out of ui.js into v2/logic/.
//
// Every assertion here encodes behaviour the ORIGINAL ui.js had, verified by
// reading it line by line on 2026-10-13. None of this was covered by a node
// suite before: it lived inside template-string render functions and was
// visible only to the render harness, which is the layer a presentation
// rewrite breaks first. These tests are the rubric the rewrite is held to.
import assert from "node:assert";
import { defVerdict, DEF_KINDS, DEF_ACTIONABLE_KINDS } from "../v2/logic/defence.js";
import { signalRows, leadFlag, qualifies, SEVERITY_RANK, chipLabel } from "../v2/logic/signals.js";
import { vegasRead } from "../v2/logic/vegas.js";
import { benchOf, lineupPairs } from "../v2/logic/roster.js";
import { recapRows, heldUp } from "../v2/logic/recap.js";
import { rosState, anyPending, compareMode } from "../v2/logic/compare-state.js";
import { pairCalls } from "../v2/logic/calls.js";
import { wireTally } from "../v2/logic/wire.js";
import * as caps from "../v2/logic/caps.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const D = (o) => ({ slot: "DEF", current: { name: "Vegas", pts: 4.3 }, best: { name: "KC", pts: 9.2 }, gap: 4.9, ...o });

// --------------------------------------------------------------------------
// The defence ladder. Order IS the semantics.
// --------------------------------------------------------------------------
t("defVerdict: no row at all returns null", () => {
  assert.strictEqual(defVerdict(null), null);
  assert.strictEqual(defVerdict(undefined), null);
});

t("defVerdict: noProjections outranks everything", () => {
  assert.strictEqual(defVerdict(D({ noProjections: true, allLocked: true, empty: true })).kind,
    "no-projections");
});

t("THE MONDAY-EVENING CRASH: allLocked beats empty, and does not touch best", () => {
  // ui.js:276-279. With empty first, the copy reads d.best.name off a null
  // and blanks the whole page. Every free defence has played, so there IS no
  // best to name.
  const v = defVerdict(D({ allLocked: true, empty: true, best: null }));
  assert.strictEqual(v.kind, "all-locked");
});

t("allLocked beats unresolved too, also with no best", () => {
  assert.strictEqual(defVerdict(D({ allLocked: true, unresolved: true, best: null })).kind,
    "all-locked");
});

t("empty outranks unresolved", () => {
  assert.strictEqual(defVerdict(D({ empty: true, unresolved: true })).kind, "empty");
});

t("unresolved outranks unprojected", () => {
  assert.strictEqual(defVerdict(D({ unresolved: true, unprojected: true })).kind, "unresolved");
});

t("a locked starter outranks marginal and actionable", () => {
  // Sleeper will refuse the swap, so a gap that would otherwise be a claim is
  // a note for next week instead.
  const v = defVerdict(D({ current: { name: "Vegas", pts: 4.3, locked: true }, actionable: true, marginal: true }));
  assert.strictEqual(v.kind, "current-locked");
});

t("marginal outranks actionable", () => {
  assert.strictEqual(defVerdict(D({ marginal: true, actionable: true })).kind, "marginal");
});

t("A DEAD HEAT IS NOT A WIN: gap 0 is its own kind, never hold", () => {
  // Caught by rendering: every defence in the fixture projected identically,
  // which produced "Philadelphia is the better bet ... +0.0".
  assert.strictEqual(defVerdict(D({ gap: 0 })).kind, "tie");
});

t("nothing flagged and a non-zero gap falls through to hold", () => {
  assert.strictEqual(defVerdict(D({ gap: -2.1 })).kind, "hold");
});

t("defVerdict throws, loudly, when a branch is reached without its fields", () => {
  assert.throws(() => defVerdict({ slot: "DEF", empty: true, best: null }), /requires "best"/);
});

t("counts mirrors defStream's own field, and the actionable set agrees with it", () => {
  assert.strictEqual(defVerdict(D({ counts: true })).counts, true);
  assert.strictEqual(defVerdict(D({})).counts, false);
  assert.ok(DEF_ACTIONABLE_KINDS.has("actionable") && !DEF_ACTIONABLE_KINDS.has("hold"));
  assert.strictEqual(DEF_KINDS.length, 10);
});

t("MARGINAL IS NOT WORK. waivers.js:353/:357 make marginal and counts exclusive", () => {
  // marginal is gap < DEF_FLOOR; counts is gap >= DEF_FLOOR. A sub-precision
  // edge is rendered and styled and deliberately NOT counted. The set claimed
  // to mirror `counts` while including marginal - a wrong claim in the file
  // that is meant to be the authority on this ladder (audit 2026-10-13).
  assert.ok(!DEF_ACTIONABLE_KINDS.has("marginal"));
  assert.deepStrictEqual([...DEF_ACTIONABLE_KINDS].sort(), ["actionable", "empty"]);
});

t("MUTATION HOLE: unprojected outranks a locked starter", () => {
  // The one adjacent pair in the ladder the differential cases never made
  // compete, so swapping these two rungs survived a 30-mutation sweep. A
  // defence that is BOTH unpriced and locked must report that it is not priced
  // - "is locked" implies a gap that was never measured.
  const v = defVerdict(D({ unprojected: true, current: { name: "LV", pts: 4.3, locked: true } }));
  assert.strictEqual(v.kind, "unprojected");
});

t("MUTATION HOLE: the optimal lineup is scanned BEFORE the roster", () => {
  // signals.js declares this order load-bearing, but the original test passed
  // the SAME object in both lists, which proves dedupe happens and says
  // nothing about which copy wins. Distinguishable objects, same id.
  const fromOptimal = { id: "x", name: "from-optimal", pos: "WR", flags: [{ severity: "high", kind: "absent", text: "no usage" }] };
  const fromRoster = { id: "x", name: "from-roster", pos: "WR",
    flags: [{ severity: "high", kind: "thin", text: "one game" }] };
  const { shown, total } = signalRows([{ slot: "WR", player: fromOptimal }], [fromRoster]);
  assert.strictEqual(total, 1, "deduped");
  assert.strictEqual(shown[0].p.name, "from-optimal");
  assert.strictEqual(shown[0].f.kind, "absent");
});

// --------------------------------------------------------------------------
// Signals
// --------------------------------------------------------------------------
const F = (severity, kind, extra = {}) => ({ severity, kind, text: `${kind} ${severity}`, ...extra });
const PL = (id, flags) => ({ id, name: id, pos: "WR", flags });

t("low severity is dropped", () => {
  assert.strictEqual(qualifies(F("low", "thin")), false);
});

t("EXCEPT a resolved absence, where low means reassuring", () => {
  assert.strictEqual(qualifies(F("low", "absent", { resolution: { kind: "starter", text: "QB1" } })), true);
  assert.strictEqual(qualifies(F("low", "absent")), false, "an unresolved low absence stays quiet");
});

t("it is the first QUALIFYING flag, not flags[0]", () => {
  // The original continues past a filtered flag and keeps scanning the same
  // player. Reading it as take-then-filter silently drops this player.
  const p = PL("a", [F("low", "thin"), F("high", "absent")]);
  assert.strictEqual(leadFlag(p).severity, "high");
});

t("one row per player, and the optimal lineup is seen before the roster", () => {
  const p = PL("a", [F("high", "absent")]);
  const { shown, total } = signalRows([{ slot: "WR", player: p }], [p]);
  assert.strictEqual(total, 1);
  assert.strictEqual(shown.length, 1);
});

t("sorted by severity, then by sigmas descending", () => {
  const rows = signalRows([], [
    PL("med-big", [F("medium", "thin", { sigmas: 3 })]),
    PL("high-small", [F("high", "thin", { sigmas: 1 })]),
    PL("med-small", [F("medium", "thin", { sigmas: 2 })]),
  ]).shown.map((r) => r.p.id);
  assert.deepStrictEqual(rows, ["high-small", "med-big", "med-small"]);
  assert.strictEqual(SEVERITY_RANK.high < SEVERITY_RANK.low, true);
});

t("capped, with the remainder counted not dropped silently", () => {
  const many = Array.from({ length: 8 }, (_, i) => PL(`p${i}`, [F("high", "thin", { sigmas: i })]));
  const { shown, rest, total } = signalRows([], many);
  assert.strictEqual(shown.length, caps.SIGNALS_MAX);
  assert.strictEqual(rest, 3);
  assert.strictEqual(total, 8);
});

t("a player with no qualifying flag produces no row", () => {
  assert.strictEqual(signalRows([], [PL("quiet", [F("low", "thin")])]).total, 0);
});

t("chip labels", () => {
  assert.strictEqual(chipLabel(F("low", "absent", { resolution: { kind: "starter" } })), "BACK");
  assert.strictEqual(chipLabel(F("high", "absent")), "DNP");
  assert.strictEqual(chipLabel(F("medium", "thin")), "1G");
  assert.strictEqual(chipLabel(F("medium", "projection-high")), "OVER");
  assert.strictEqual(chipLabel(F("medium", "projection-low")), "UNDER");
});

// --------------------------------------------------------------------------
// Vegas sign convention
// --------------------------------------------------------------------------
t("A POSITIVE SPREAD MEANS FAVOURED. Invert this and every sentence lies.", () => {
  assert.strictEqual(vegasRead({ team: "KC", vegas: { spread: 6.5, total: 48, implied: 27.2 } }).side, "favoured");
  assert.strictEqual(vegasRead({ team: "CAR", vegas: { spread: -6.5, total: 48, implied: 20.7 } }).side, "underdog");
  assert.strictEqual(vegasRead({ team: "X", vegas: { spread: 0, total: 44, implied: 22 } }).side, "pickem");
});

t("the magnitude is always positive, whichever side", () => {
  assert.strictEqual(vegasRead({ team: "CAR", vegas: { spread: -6.5, total: 48, implied: 20.7 } }).by, 6.5);
});

t("no line is null, not a pick'em", () => {
  assert.strictEqual(vegasRead({ team: "X" }), null);
  assert.strictEqual(vegasRead({ team: "X", vegas: { total: 44 } }), null);
});

// --------------------------------------------------------------------------
// Roster
// --------------------------------------------------------------------------
t("bench is roster minus starters, by points descending", () => {
  const roster = [{ id: "1", pts: 5 }, { id: "2", pts: 20 }, { id: "3", pts: 12 }];
  assert.deepStrictEqual(benchOf(roster, [1]).map((p) => p.id), ["2", "3"]);
});

t("a player with no projection sorts last, not as a zero", () => {
  const roster = [{ id: "1" }, { id: "2", pts: 0 }];
  assert.deepStrictEqual(benchOf(roster, []).map((p) => p.id), ["2", "1"]);
});

t("an unresolved starter keeps its slot rather than shifting the lineup up", () => {
  const byId = new Map([["7", { id: "7", name: "x" }]]);
  const pairs = lineupPairs(["QB", "RB"], ["7", "999"], byId);
  assert.strictEqual(pairs.length, 2);
  assert.strictEqual(pairs[1][0], "RB");
  assert.strictEqual(pairs[1][1], undefined);
});

// --------------------------------------------------------------------------
// Recap
// --------------------------------------------------------------------------
t("THE INVERSION: delta <= 0 means your lineup held up, zero included", () => {
  assert.strictEqual(heldUp(-4), true);
  assert.strictEqual(heldUp(0), true, "the two lineups agreed - there was nothing to take");
  assert.strictEqual(heldUp(0.1), false);
});

t("recap caps at 6 rows and names at most 3 locked players", () => {
  const rows = recapRows({
    any: true,
    rows: [
      ...Array.from({ length: 6 }, (_, i) => ({ kind: "lineup", week: i, delta: -1, yours: 1, suggested: 0 })),
      { kind: "locked", week: 9, players: ["a", "b", "c", "d"], delta: 2 },
    ],
  });
  assert.strictEqual(rows.length, caps.RECAP_MAX);
});

t("a lockout that cost nothing does not read as a loss, and null is not zero", () => {
  const [r] = recapRows({ any: true, rows: [{ kind: "locked", week: 3, players: ["a", "b", "c", "d"], delta: null }] });
  assert.strictEqual(r.costly, false);
  assert.deepStrictEqual(r.named, ["a", "b", "c"]);
  assert.strictEqual(r.more, 1);
  assert.strictEqual(recapRows({ any: true, rows: [{ kind: "locked", week: 3, players: [], delta: 0 }] })[0].costly, false);
  assert.strictEqual(recapRows({ any: true, rows: [{ kind: "locked", week: 3, players: [], delta: 1.5 }] })[0].costly, true);
});

t("no recap when there is nothing graded", () => {
  assert.deepStrictEqual(recapRows({ any: false, rows: [{}] }), []);
  assert.deepStrictEqual(recapRows(null), []);
});

// --------------------------------------------------------------------------
// Compare tri-state
// --------------------------------------------------------------------------
t("THE TRI-STATE: undefined is pending, null is an answer", () => {
  assert.strictEqual(rosState({}), "pending");
  assert.strictEqual(rosState({ ros: null }), "missing");
  assert.strictEqual(rosState({ ros: { pts: 12 } }), "ready");
});

t("a player fetched and found empty does not hold the panel on Pulling...", () => {
  assert.strictEqual(anyPending([{ ros: null }, { ros: {} }]), false);
  assert.strictEqual(anyPending([{ ros: null }, {}]), true);
});

t("one pick still renders a panel, because the clear button lives in it", () => {
  assert.strictEqual(compareMode(0), "hidden");
  assert.strictEqual(compareMode(1), "one");
  assert.strictEqual(compareMode(2), "full");
});

// --------------------------------------------------------------------------
// Calls
// --------------------------------------------------------------------------
t("unequal enter/leave lists pair against null rather than truncating", () => {
  const pairs = pairCalls({ entering: [{ name: "a", pts: 10 }, { name: "b", pts: 8 }], leaving: [{ name: "c", pts: 3 }] });
  assert.strictEqual(pairs.length, 2);
  assert.strictEqual(pairs[1].out, null);
  assert.strictEqual(pairs[1].delta, 8);
});

t("a forced call is one where the man leaving cannot play", () => {
  const [p] = pairCalls({ entering: [{ name: "a", pts: 16 }], leaving: [{ name: "b", pts: 9, startable: false }] });
  assert.strictEqual(p.forced, true);
  assert.strictEqual(p.delta, 7, "the projection is still real arithmetic; the threshold is what gets ignored");
});

t("an entry into an empty seat has no one leaving", () => {
  const [p] = pairCalls({ entering: [{ name: "a", pts: 16 }], leaving: [] });
  assert.strictEqual(p.out, null);
  assert.strictEqual(p.forced, false);
  assert.strictEqual(p.delta, 16);
});

// --------------------------------------------------------------------------
// Wire tally
// --------------------------------------------------------------------------
t("the defence row counts only when it has work in it", () => {
  assert.strictEqual(wireTally({ upgrades: [1, 2], risers: [3], def: { counts: true } }), 4);
  assert.strictEqual(wireTally({ upgrades: [1, 2], risers: [3], def: { counts: false } }), 3);
  assert.strictEqual(wireTally({ upgrades: [1, 2], risers: [3] }), 3);
  assert.strictEqual(wireTally(null), 0);
});

// --------------------------------------------------------------------------
// Caps
// --------------------------------------------------------------------------
t("caps match what the original shipped", () => {
  assert.strictEqual(caps.SIGNALS_MAX, 5);
  assert.strictEqual(caps.RECAP_MAX, 6);
  assert.strictEqual(caps.LOCKOUT_NAMES, 3);
  assert.strictEqual(caps.MARKET_TOP, 5);
  assert.strictEqual(caps.NAME_CLUBS_UPTO, 4);
  assert.strictEqual(caps.CHIP_FALLBACK_LEN, 3);
});

console.log(`v2 logic: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

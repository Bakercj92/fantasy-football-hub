// THE COMPARE PAGE.
//
// Written against the same bar as v2-pages.test.mjs: on 2026-10-19 eleven of
// twenty mutations against the phase 3 pages survived a green suite, so copy
// and branch selection both get asserted here rather than trusted.
//
// Three of these guard defects that ui.js records having actually shipped:
// the clear button vanishing with a selection that no longer resolves
// (ui.js:620-626), the rest-of-season tri-state collapsing into a falsy check
// and sticking on "Pulling..." forever (app.js:383-388), and a verdict naming
// one player while quoting the margin the other leads by (js/compare.js:331).
import assert from "node:assert";
import { comparePage, tightestPair } from "../v2/compare-page.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
// Entities are decoded, because the assertions below are about what a reader
// sees. Without this, "&mdash;" survives tag-stripping and every sentence
// containing an em dash has to be asserted around rather than through.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', mdash: "\u2014", ndash: "\u2013",
  hellip: "\u2026", times: "\u00d7", ge: "\u2265", sigma: "\u03c3", rarr: "\u2192" };
const txt = (html) => String(html)
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENT ? ENT[n] : m))
  .replace(/\s+/g, " ").trim();
const clean = (html) => {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(txt(html)),
    `leaked a placeholder: ${txt(html).slice(0, 180)}`);
  assert.ok(!/\((\s*—\s*)\)/.test(txt(html)),
    `printed an em dash where a measurement belongs: ${txt(html).slice(0, 180)}`);
};

const P = (o = {}) => ({
  id: "p1", name: "A Player", pos: "WR", team: "KC", opponent: "LV",
  pts: 12.3, vor: 3.1, hasProjection: true, startable: true, injury: null,
  locked: false, flags: [], ros: 100, market: null, fcalc: null, usage: null, ...o,
});

/** A league whose byId resolves whatever players it is given. */
const LG = (players, o = {}) => ({
  entry: { key: "joop", name: "Joop Squad" },
  byId: new Map(players.map((p) => [String(p.id), p])),
  sigma: { WR: 4.0, RB: 4.0, QB: 6.0 },
  slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
  calls: { actionable: false },
  fcalc: { ok: true },
  ...o,
});
const SEL = (...ids) => ({ selection: { joop: new Set(ids.map(String)) } });

// ===========================================================================
// tightestPair — which call gets offered
// ===========================================================================
const callsOf = (pairs) => ({
  actionable: true,
  entering: pairs.map((p) => p[0]),
  leaving: pairs.map((p) => p[1]),
});

t("THE OFFER IS THE SMALLEST MARGIN, not the biggest", () => {
  const L = LG([], { calls: callsOf([
    [P({ id: "a", name: "Big In", pts: 20 }), P({ id: "b", name: "Big Out", pts: 8 })],
    [P({ id: "c", name: "Thin In", pts: 11 }), P({ id: "d", name: "Thin Out", pts: 10 })],
  ]) });
  const pair = tightestPair(L);
  assert.equal(pair.in.name, "Thin In", "a second opinion is worth most on the closest call");
  assert.equal(pair.delta, 1);
});

t("a forced call is not offered — it is not a judgment", () => {
  const L = LG([], { calls: callsOf([
    [P({ id: "a", pts: 11 }), P({ id: "b", pts: 10, startable: false, injury: "Out" })],
  ]) });
  assert.equal(tightestPair(L), null);
});

t("a one-sided call is not offered — there is nobody to compare against", () => {
  const L = LG([], { calls: { actionable: true, entering: [P({ id: "a" })], leaving: [] } });
  assert.equal(tightestPair(L), null);
});

t("a non-positive margin is not offered", () => {
  const L = LG([], { calls: callsOf([
    [P({ id: "a", pts: 9 }), P({ id: "b", pts: 10 })],
  ]) });
  assert.equal(tightestPair(L), null);
});

t("a quiet lineup offers nothing", () => {
  assert.equal(tightestPair(LG([], { calls: { actionable: false } })), null);
});

// ===========================================================================
// The empty state — the case ui.js rendered as nothing at all
// ===========================================================================
t("NOTHING PICKED STILL RENDERS, and teaches the control", () => {
  const h = comparePage(LG([]), SEL());
  assert.match(txt(h), /Nothing picked yet/);
  assert.match(txt(h), /lineup or bench/, "it must say where the control is");
  assert.ok(/&#9878;|⚖/.test(String(h)), "it must show the control's own glyph");
  clean(h);
});

t("the empty state offers the closest call by name and margin", () => {
  const L = LG([], { calls: callsOf([
    [P({ id: "c", name: "Thin In", pts: 11 }), P({ id: "d", name: "Thin Out", pts: 10 })],
  ]) });
  const h = comparePage(L, SEL());
  assert.match(txt(h), /Thin In/);
  assert.match(txt(h), /Thin Out/);
  assert.match(String(h), /data-cmp-pair="c,d"/, "the offer has to be actionable");
  clean(h);
});

t("with no two-sided call it says so rather than inventing a pairing", () => {
  const h = comparePage(LG([]), SEL());
  assert.match(txt(h), /no two-sided lineup calls/);
  assert.ok(!/data-cmp-pair/.test(String(h)));
});

// ===========================================================================
// The degraded branches — each must keep the clear button
// ===========================================================================
t("ONE PICK KEEPS THE CLEAR BUTTON", () => {
  const h = comparePage(LG([P({ id: "p1", name: "Solo" })]), SEL("p1"));
  assert.match(txt(h), /Solo/);
  assert.match(txt(h), /Choose at least one more/);
  assert.match(String(h), /data-clear/, "ui.js:620-626 — without this a selection is unescapable");
  clean(h);
});

t("PICKS THAT NO LONGER RESOLVE KEEP THE CLEAR BUTTON", () => {
  // Two ids selected, neither on the roster any more: a drop or a trade
  // between re-solves. compare() returns mode "empty".
  const h = comparePage(LG([]), SEL("gone1", "gone2"));
  assert.match(txt(h), /no longer on this roster/);
  assert.match(String(h), /data-clear/, "the exact defect ui.js:620-626 records");
  clean(h);
});

t("no league at all degrades rather than throwing", () => {
  const h = comparePage(null, SEL());
  assert.match(txt(h), /No league selected/);
});

// ===========================================================================
// Head to head
// ===========================================================================
t("a decisive head-to-head names the leader and the margin", () => {
  const a = P({ id: "a", name: "Clear Winner", pos: "WR", pts: 20, vor: 9 });
  const b = P({ id: "b", name: "Also Ran", pos: "WR", pts: 9, vor: -1 });
  const h = comparePage(LG([a, b]), SEL("a", "b"));
  assert.match(txt(h), /Clear Winner by/);
  assert.ok(/class="verdict yes"/.test(String(h)), "a decision is styled as one");
  clean(h);
});

t("A GAP INSIDE THE GATE REFUSES TO CALL IT", () => {
  const a = P({ id: "a", name: "Near A", pos: "WR", pts: 12.0, vor: 3.0 });
  const b = P({ id: "b", name: "Near B", pos: "WR", pts: 11.8, vor: 2.8 });
  const h = comparePage(LG([a, b]), SEL("a", "b"));
  assert.match(txt(h), /Too close to call/);
  assert.ok(/class="verdict tie"/.test(String(h)));
  clean(h);
});

t("A PLAYER WITH NO PROJECTION GETS NO INVENTED GAP", () => {
  const a = P({ id: "a", name: "Playing", pts: 14, vor: 5 });
  const b = P({ id: "b", name: "On Bye", pts: null, vor: null, hasProjection: false });
  const h = comparePage(LG([a, b]), SEL("a", "b"));
  assert.match(txt(h), /Can't compare/);
  assert.match(txt(h), /will not invent one/);
  clean(h);
});

// ===========================================================================
// A pool
// ===========================================================================
t("A POOL NAMES THE AXIS IT IS RANKED BY", () => {
  const ps = ["a", "b", "c"].map((id, i) =>
    P({ id, name: `P${i}`, pts: 10 + i, vor: i }));
  const h = comparePage(LG(ps), SEL("a", "b", "c"));
  assert.match(txt(h), /Ranked by/, "a ranking with no named axis is a table with no heading");
  assert.match(txt(h), /3 players/);
  clean(h);
});

t("MIXING POSITIONS EXPLAINS WHAT IT HID, AND WHY", () => {
  const a = P({ id: "a", name: "A Back", pos: "RB", market: { ecr: 11.2, posRank: "RB11", grade: "B" } });
  const b = P({ id: "b", name: "A Wideout", pos: "WR", market: { ecr: 12.4, posRank: "WR12", grade: "B" } });
  const h = comparePage(LG([a, b]), SEL("a", "b"));
  assert.match(txt(h), /Hidden because you are comparing across positions/);
  assert.match(txt(h), /RB12 and a WR12 are not the same claim/,
    "the reason is the whole point — consensus is published per position");
  clean(h);
});

// ===========================================================================
// The tri-state, and the per-load notes
// ===========================================================================
t("ROS NEVER FETCHED SHOWS THE PENDING LINE", () => {
  const a = P({ id: "a", ros: undefined });
  const b = P({ id: "b", ros: 90 });
  const h = comparePage(LG([a, b]), SEL("a", "b"));
  assert.match(txt(h), /Pulling rest-of-season/);
});

t("ROS FETCHED AND EMPTY IS AN ANSWER, NOT A WAIT", () => {
  // The exact collapse that stuck this surface on "Pulling…" with no fetch in
  // flight: null means asked and answered.
  const a = P({ id: "a", ros: null });
  const b = P({ id: "b", ros: null });
  const h = comparePage(LG([a, b]), SEL("a", "b"));
  assert.ok(!/Pulling rest-of-season/.test(txt(h)),
    "null is a fetched answer; treating it as pending is app.js:383-388 all over again");
});

t("an unavailable market layer is declared, not guessed around", () => {
  const a = P({ id: "a" }), b = P({ id: "b" });
  const h = comparePage(LG([a, b], { fcalc: { ok: false } }), SEL("a", "b"));
  assert.match(txt(h), /Market values unavailable this load/);
  assert.match(txt(h), /hidden rather than guessed/);
});

// ===========================================================================
// Structure
// ===========================================================================
t("THE NOTE ROW'S COLSPAN COVERS EVERY COLUMN", () => {
  const ps = ["a", "b", "c"].map((id, i) => P({ id, name: `P${i}`, pts: 10 + i, vor: i }));
  const h = String(comparePage(LG(ps), SEL("a", "b", "c")));
  // one label column plus one column per player
  assert.ok(h.includes('colspan="4"'),
    "the colspan is derived from the pool size; this is the defect ui.js:738-743 records twice");
  assert.ok(!/colspan="3"|colspan="5"/.test(h));
});

t("METRIC NOTE IDS COME FROM THE METRIC, NOT ITS POSITION", () => {
  const a = P({ id: "a" }), b = P({ id: "b" });
  const h = String(comparePage(LG([a, b]), SEL("a", "b")));
  assert.match(h, /id="cmpn-pts"/, "a positional id reopens a different metric after a re-solve");
  assert.ok(!/id="cmpn-0"|id="cmpn-1"/.test(h));
});

t("every metric row is a real disclosure the shell can carry across a repaint", () => {
  const a = P({ id: "a" }), b = P({ id: "b" });
  const h = String(comparePage(LG([a, b]), SEL("a", "b")));
  const controls = [...h.matchAll(/aria-controls="(cmpn-[^"]+)"/g)].map((m) => m[1]);
  assert.ok(controls.length >= 2, "expected a disclosure per metric row");
  for (const id of controls) {
    assert.ok(h.includes(`id="${id}"`), `${id} has a button but no panel`);
  }
  assert.match(h, /aria-expanded="false"/);
});

// ===========================================================================
// What fifty mutations found that twenty-two assertions had not.
//
// Five lived in here, and they share a shape: the table's *signals* - which
// cell won, what the ranking is called, what a row is called - were rendered
// but never read back. The numbers were covered; the things that tell a reader
// what the numbers mean were not.
// ===========================================================================
t("A POOL RANKED ON VALUE SAYS SO, not 'projection'", () => {
  // Hardcoding the axis label produces a heading the ordering does not
  // support - the copy-bug class this project's render layer exists to catch.
  const ps = ["a", "b", "c"].map((id, i) =>
    P({ id, name: `P${i}`, pts: 20 - i, vor: i * 3 }));
  const h = txt(comparePage(LG(ps), SEL("a", "b", "c")));
  assert.match(h, /Ranked by value over replacement/i,
    "the pool axis is VOR here; the heading has to name the axis actually used");
});

t("THE WINNING CELL IS THE ONE THAT WON", () => {
  // Inverting this highlights the loser in every metric row, which is the
  // single most-read signal on the table.
  const a = P({ id: "a", name: "Better", pos: "WR", pts: 18, vor: 9 });
  const b = P({ id: "b", name: "Worse", pos: "WR", pts: 10, vor: -1 });
  const h = String(comparePage(LG([a, b]), SEL("a", "b")));
  const wins = [...h.matchAll(/<td class="cv win">([^<]*)</g)].map((m) => m[1].trim());
  assert.ok(wins.length > 0, "no cell was marked as winning at all");
  // The VOR formatter trims trailing zeros, so +9 rather than +9.00.
  assert.ok(wins.includes("+9"), `expected the +9 VOR cell to win, marked: ${JSON.stringify(wins)}`);
  assert.ok(wins.includes("18"), `expected the 18 projection cell to win, marked: ${JSON.stringify(wins)}`);
  assert.ok(!wins.includes("-1") && !wins.includes("10"),
    `a losing cell was highlighted: ${JSON.stringify(wins)}`);
});

t("EVERY METRIC ROW IS LABELLED IN WORDS, NOT BY ITS KEY", () => {
  const a = P({ id: "a", usage: { games: 4, gamesRecent: 3, snapPct: 0.8, oppPerGame: 12 } });
  const b = P({ id: "b", usage: { games: 4, gamesRecent: 3, snapPct: 0.6, oppPerGame: 9 } });
  const h = String(comparePage(LG([a, b]), SEL("a", "b")));
  const labels = [...h.matchAll(/aria-controls="cmpn-[^"]+">([^<]*)</g)].map((m) => m[1].trim());
  assert.ok(labels.length >= 2, `only ${labels.length} labels found`);
  for (const l of labels) {
    assert.ok(/[a-z] [a-z]/i.test(l) || /^[A-Z]/.test(l),
      `"${l}" looks like a raw metric key rather than a label`);
    assert.ok(!/^(vor|pts|snapPct|oppPerGame|tgtPerGame|tgtShare|mktValue|ecr|grade)$/.test(l),
      `"${l}" IS the raw key`);
  }
  assert.ok(labels.some((l) => /value over replacement/i.test(l)), labels.join(" | "));
});

t("A LOCKED PLAYER IS MARKED AS LOCKED IN THE HEADING", () => {
  const a = P({ id: "a", name: "Kicked Off", locked: true });
  const b = P({ id: "b", name: "Yet To Play" });
  const h = String(comparePage(LG([a, b]), SEL("a", "b")));
  assert.match(h, /class="lock"/, "the heading must say his game has already started");
  assert.match(h, /already kicked off/);
});

t("THE OFFERED MARGIN IS QUOTED POSITIVE", () => {
  // Negating it is the same defect as a recap cost rendering negative.
  const L = LG([], { calls: callsOf([
    [P({ id: "c", name: "Thin In", pts: 11 }), P({ id: "d", name: "Thin Out", pts: 10 })],
  ]) });
  const h = txt(comparePage(L, SEL()));
  assert.match(h, /by 1\.0/);
  assert.ok(!/by -1\.0/.test(h));
});

console.log(`\nv2 compare: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

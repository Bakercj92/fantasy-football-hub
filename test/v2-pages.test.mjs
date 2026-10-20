// THE COPY ON THE LINEUP AND WIRE PAGES.
//
// Why this file exists: an audit on 2026-10-19 ran twenty mutations against
// v2/lineup-page.js and v2/wire-page.js and ELEVEN survived with every suite
// green - including replacing the FAAB refusal, the one sentence js/waivers.js
// opens with a header comment forbidding, with an actual dollar figure.
//
// The defence row had differential coverage and was defended. Nothing else on
// either page had any node coverage at all, and copy is what this project's
// render layer has actually caught: a missing article, a verdict a number did
// not support, a block printing "undefined" in every sentence under a passing
// presence assertion.
//
// Everything asserted here is a claim the ORIGINAL makes, or a claim the
// original deliberately refuses to make.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  callsCard, signalsCard, lockedCard, playerRows, detailPanel, NCOLS, COLS,
} from "../v2/lineup-page.js";
import { waiverCard, vacancyCard, upgradeRow, riserRow, wirePage } from "../v2/wire-page.js";
import { injuryPhrase } from "../v2/copy.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
const txt = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const clean = (html) => {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(txt(html)),
    `leaked a placeholder: ${txt(html).slice(0, 180)}`);
  // An em dash where a number should be is this project's signature tell.
  assert.ok(!/\((\s*—\s*)\)/.test(txt(html)),
    `printed an em dash where a measurement belongs: ${txt(html).slice(0, 180)}`);
};

const P = (o = {}) => ({ id: "p1", name: "A Player", pos: "WR", team: "KC", opponent: "LV",
  pts: 12.3, hasProjection: true, startable: true, injury: null, flags: [], why: [],
  game: { kickoffUTC: Date.UTC(2026, 9, 25, 17, 0) }, ...o });

// ===========================================================================
// The calls block
// ===========================================================================
t("a quiet lineup says it was checked, and names the threshold", () => {
  const h = callsCard({ calls: { actionable: false, gain: 0.4, threshold: 1.6 } });
  assert.match(txt(h), /Lineup checked/);
  assert.match(txt(h), /Threshold 1\.6 pt/);
  assert.match(txt(h), /½σ/, "the threshold must say what it is made of");
  clean(h);
});

t("AN OPTIONAL CALL SHOWS ITS SIZE AND THE THRESHOLD IT CLEARED", () => {
  const h = callsCard({ calls: { actionable: true, gain: 6.2, threshold: 1.6, forced: [],
    entering: [P({ name: "In Guy", pts: 16, vor: 4.1 })],
    leaving: [P({ id: "p2", name: "Out Guy", pts: 9.8 })] } });
  assert.match(txt(h), /Start In Guy over Out Guy/);
  assert.match(txt(h), /\+6\.2/);
  assert.match(txt(h), /over the best free WR in this league/, "the VOR sentence");
  clean(h);
});

t("A FORCED CALL SAYS WHY IT IGNORES THE THRESHOLD", () => {
  const h = callsCard({ calls: { actionable: true, gain: 12, threshold: 1.6, forced: [1],
    entering: [P({ name: "In Guy", pts: 16 })],
    leaving: [P({ id: "p2", name: "Hurt Guy", pts: 9.8, startable: false, injury: "Out" })] } });
  assert.match(txt(h), /ruled Out/);
  assert.match(txt(h), /That is why this call ignores the threshold/,
    "the sentence explaining the exception must survive");
  assert.match(txt(h), /his real total is zero/);
  assert.match(txt(h), /must/, "a forced call is tagged, not given a delta");
  clean(h);
});

t("AN UNPRICED STARTER GETS ITS OWN SENTENCE, not the ruled-out one", () => {
  // pipeline.js builds a roster id the feed never priced with injury null and
  // pts null. The ruled-out copy rendered "is listed . ... projection for him
  // (-)", asserting a measurement that does not exist.
  const ghost = { id: "9999", name: "9999", pos: "", team: "", opponent: "", pts: null,
    hasProjection: false, startable: false, injury: null, flags: [], why: [], game: null };
  const h = callsCard({ calls: { actionable: true, gain: 8, threshold: 1.6, forced: [1],
    entering: [P({ name: "In Guy", pts: 8 })], leaving: [ghost] } });
  assert.ok(!/is listed \./.test(txt(h)), "an empty designation was rendered as a sentence");
  assert.ok(!/still publishes a projection for him/.test(txt(h)),
    "claimed a projection the feed never published");
  assert.match(txt(h), /no entry for/);
  assert.match(txt(h), /not priced this week/);
  clean(h);
});

t("a call into an empty seat has no one to be 'over'", () => {
  const h = callsCard({ calls: { actionable: true, gain: 16, threshold: 1.6, forced: [],
    entering: [P({ name: "In Guy", pts: 16 })], leaving: [] } });
  assert.match(txt(h), /Start In Guy/);
  assert.ok(!/ over /.test(txt(h).split("Start In Guy")[1].slice(0, 20)));
  clean(h);
});

// ===========================================================================
// Signals, lockout
// ===========================================================================
t("the signals card states the disagreement and refuses to pick a side", () => {
  const p = P({ flags: [{ severity: "high", kind: "projection-high", sigmas: 3,
    text: "projected 15.3 but averaging 20.1 over 3 games",
    ask: "has his role shrunk, or is the projection seeing something the box score isn't?" }] });
  const h = signalsCard({ optimal: [{ slot: "WR", player: p }], roster: [p] });
  assert.match(txt(h), /projected 15\.3 but averaging 20\.1/);
  assert.match(txt(h), /it does not pick a side/, "the refusal must survive");
  clean(h);
});

t("no flags, no card", () => {
  assert.strictEqual(signalsCard({ optimal: [], roster: [P()] }), "");
});

t("A LOCKOUT THAT COST NOTHING MUST NOT READ AS A LOSS", () => {
  const cheap = lockedCard({ missed: { any: true, entering: [P({ name: "X" })], leaving: [],
    cost: 0 } });
  assert.match(txt(cheap), /cost nothing/);
  assert.ok(!/cost about/.test(txt(cheap)));
  const dear = lockedCard({ missed: { any: true, entering: [P({ name: "X" })], leaving: [],
    cost: 24.2 } });
  assert.match(txt(dear), /cost about 24\.2/);
  clean(cheap); clean(dear);
});

t("the lockout card is never phrased as an instruction", () => {
  const h = lockedCard({ missed: { any: true, entering: [P({ name: "X" })],
    leaving: [P({ id: "y", name: "Y" })], cost: 3 } });
  // "could no longer start X" DESCRIBES; "start X" INSTRUCTS. The first
  // version of this assertion could not tell them apart and failed on the
  // correct copy - a test too crude to be right about the thing it checks.
  assert.ok(!/\b(you should|start him|sit him|claim him|worth starting)\b/i.test(txt(h)),
    `the block told the reader to do something: ${txt(h)}`);
  assert.match(txt(h), /could no longer/, "it must still describe what happened");
  assert.match(txt(h), /solved around them/);
  clean(h);
});

// ===========================================================================
// Roster rows
// ===========================================================================
t("THE COLSPAN IS DERIVED, AND THE EMPTY ROW MATCHES THE HEAD", () => {
  const h = playerRows(null, "FLEX", "st");
  const m = /colspan="(\d+)"/.exec(h);
  assert.ok(m, "the empty row carries no colspan");
  assert.strictEqual(Number(m[1]) + 1, NCOLS,
    `empty row spans ${m[1]} + the slot cell against ${NCOLS} columns`);
  assert.strictEqual(NCOLS, COLS.length);
});

t("the detail row spans every column", () => {
  const h = playerRows(P(), "WR", "st");
  assert.ok(h.includes(`colspan="${NCOLS}"`), "the detail row does not span the table");
});

t("THE THIN-SAMPLE CHIP SURVIVES ON THE ROW, though the card drops it", () => {
  // The one low-severity non-absent flag signals.js produces, and always that
  // player's only flag. The card filters low severity (ui.js:495); the chip
  // never did (ui.js:752).
  const p = P({ flags: [{ severity: "low", kind: "thin",
    text: "only 1 game of usage - not enough to check the projection against" }] });
  assert.match(playerRows(p, "WR", "st"), /1G/, "the thin chip vanished from the row");
  assert.strictEqual(signalsCard({ optimal: [], roster: [p] }), "",
    "...but it must still be too quiet for the card");
});

t("A RULED-OUT PLAYER IS NEVER DESCRIBED AS ACTIVE", () => {
  const ghost = P({ startable: false, injury: null, hasProjection: false, pts: null, game: null,
    opponent: "" });
  const d = txt(detailPanel(ghost));
  assert.ok(!/\bactive\b/.test(d), `said active about an unplayable player: ${d}`);
  assert.match(d, /will not play/);
  assert.match(d, /no entry for him/);
  const out = txt(detailPanel(P({ startable: false, injury: "Out" })));
  assert.match(out, /Out .* will not play/);
});

t("a healthy player is active, and the panel carries the folded columns", () => {
  const d = txt(detailPanel(P()));
  assert.match(d, /Status active/);
  for (const k of ["Team", "Opponent", "Kickoff", "Projection", "Over replacement"]) {
    assert.ok(d.includes(k), `the panel dropped ${k}`);
  }
});

t("a locked player's title keeps the kickoff, which is the whole point of it", () => {
  const h = playerRows(P({ locked: true }), "WR", "st");
  assert.match(h, /Kicked off [^"]*Sleeper will not move him now/);
});

// ===========================================================================
// The wire
// ===========================================================================
const UP = { id: "w1", name: "Claim Me", pos: "RB", team: "KC", opponent: "LV", pts: 11.2,
  gap: 3.4, gate: 1.0, slot: "RB", vor: 2.2, over: { name: "Bench Guy", pts: 7.8 } };

t("THE BID REFUSAL IS VERBATIM, AND NO FIGURE IS SUGGESTED", () => {
  // js/waivers.js opens with a header comment forbidding a bid figure. A
  // mutation that replaced this sentence with "Suggested bid: 12% of budget"
  // passed every suite before this test existed.
  const h = waiverCard({ waivers: { any: true, upgrades: [UP], risers: [], def: null },
    faabLeft: 77 }, {});
  assert.match(txt(h), /No bid figure here, deliberately/);
  assert.match(txt(h), /a number we modelled would look like a number we measured/);
  assert.ok(!/suggest|recommend|bid \d|\d+% of (your )?budget/i.test(txt(h)),
    `the wire suggested a bid: ${txt(h).slice(0, 200)}`);
  assert.match(txt(h), /\$77 of FAAB left/);
  clean(h);
});

t("a league with no FAAB budget says nothing about FAAB", () => {
  const h = waiverCard({ waivers: { any: true, upgrades: [UP], risers: [], def: null },
    faabLeft: null }, {});
  assert.ok(!/FAAB/.test(txt(h)), "invented a budget for a league that has none");
  clean(h);
});

t("an upgrade names the gate it cleared and ties it to the lineup page", () => {
  const h = upgradeRow(UP, {}, 0);
  assert.match(txt(h), /clears the 1\.0-point threshold/);
  assert.match(txt(h), /same gate the start\/sit calls use/);
  assert.match(txt(h), /\+3\.4/);
  clean(h);
});

t("THE RISER'S LOW PROJECTION IS THE POINT, NOT A FLAW", () => {
  const h = riserRow({ id: "r", name: "Riser", pos: "WR", team: "BAL", pts: 5.7,
    snapJump: 56, oppJump: 74, ayJump: null, woprJump: null, adds: 8421 }, 0);
  assert.match(txt(h), /exactly why he is still free/,
    "the sentence that stops this reading as a bad claim is missing");
  assert.match(txt(h), /snap share up 56%/);
  assert.match(txt(h), /touches up 74%/);
  clean(h);
});

t("a riser with no measured jumps still renders a sentence", () => {
  const h = riserRow({ id: "r", name: "Riser", pos: "WR", team: "BAL", pts: 5.7,
    snapJump: null, oppJump: null, ayJump: null, woprJump: null, adds: null }, 0);
  clean(h);
  assert.ok(txt(h).length > 40);
});

t("an empty wire makes no claim about a layer that did not load", () => {
  const out = wirePage({ entry: { key: "joop", name: "Joop" }, faabLeft: 10,
    waivers: { any: false }, vacancies: { ok: false, any: false } }, {});
  assert.ok(!/nobody's job opened/.test(txt(out)),
    "claimed a check that the vacancy outage prevented");
  assert.match(txt(out), /did not load this time/);
  const fine = wirePage({ entry: { key: "joop", name: "Joop" }, faabLeft: 10,
    waivers: { any: false }, vacancies: { ok: true, any: false } }, {});
  assert.match(txt(fine), /nobody's job opened/);
});

// ===========================================================================
// Vacancy
// ===========================================================================
const VAC = { any: true, week: 6, depthAsOf: "2026-10-18T00:00:00Z", partial: false,
  teamsReported: 32, promotions: [],
  vacancies: [{ nm: "Next Man", tm: "DET", pos: "WR", rk: 3, pts: 5.7, unprojected: false,
    over: { nm: "Starter", st: "Out", inj: "knee", prac: null, wk: 6, tier: "confirmed" } }] };

t("THE ARTICLE IS CHOSEN, NOT GUESSED", () => {
  // "a ankle" is one of the three copy bugs this project's render layer caught.
  assert.match(injuryPhrase({ st: "Out", inj: "ankle" }), /with an ankle/);
  assert.match(injuryPhrase({ st: "Out", inj: "knee" }), /with a knee/);
  assert.match(injuryPhrase({ st: "Out", inj: "Oblique" }), /with an oblique/);
  assert.match(injuryPhrase({ st: "Out", inj: "Illness" }), /with an illness/);
  assert.strictEqual(injuryPhrase({ st: "Questionable" }), "Questionable");
});

t("a vacancy row names who is hurt, how, and which week's report", () => {
  const h = vacancyCard({ vacancies: VAC });
  assert.match(txt(h), /Starter is Out with a knee/);
  assert.match(txt(h), /on the week 6 report/);
  assert.match(txt(h), /No bid figure here either/);
  clean(h);
});

t("AN UNPROJECTED VACANCY SAYS SO INSTEAD OF PRINTING A DASH", () => {
  const v = structuredClone(VAC);
  v.vacancies[0].unprojected = true; v.vacancies[0].pts = null;
  const h = vacancyCard({ vacancies: v });
  assert.match(txt(h), /no number for him yet/);
  assert.ok(!/projects —/.test(txt(h)));
  clean(h);
});

t("THE PARTIAL-WEEK CAVEAT SURVIVES", () => {
  // Rendering two clubs as though they were thirty-two is the lie this
  // sentence exists to prevent.
  const v = { ...structuredClone(VAC), partial: true, teamsReported: 7 };
  const h = vacancyCard({ vacancies: v });
  assert.match(txt(h), /Only 7 of 32 clubs/);
  assert.match(txt(h), /incomplete/);
  const whole = vacancyCard({ vacancies: VAC });
  assert.ok(!/of 32 clubs/.test(txt(whole)), "claimed a caveat that does not apply");
});

t("a stale report is labelled stale", () => {
  const v = structuredClone(VAC);
  v.vacancies[0].stale = true;
  assert.match(txt(vacancyCard({ vacancies: v })), /last week's, which is the complete one/);
});

t("no vacancies, no card", () => {
  assert.strictEqual(vacancyCard({ vacancies: { any: false } }), "");
  assert.strictEqual(vacancyCard({}), "");
});

// ===========================================================================
// Signs, and the source assertions that nothing else can reach.
// ===========================================================================
t("A NEGATIVE DELTA IS NEVER PAINTED AS A GAIN", () => {
  const good = callsCard({ calls: { actionable: true, gain: 6, threshold: 1, forced: [],
    entering: [P({ name: "In", pts: 16 })], leaving: [P({ id: "o", name: "Out", pts: 10 })] } });
  const bad = callsCard({ calls: { actionable: true, gain: 1, threshold: 1, forced: [],
    entering: [P({ name: "In", pts: 4 })], leaving: [P({ id: "o", name: "Out", pts: 12 })] } });
  assert.match(good, /class="tag good"/, "a real gain lost its emphasis");
  assert.ok(!/class="tag good"/.test(bad),
    "a negative pairing was painted as a gain - index pairing a set diff can produce one");
});

t("a claim whose gap is not positive is not painted as a gain either", () => {
  const h = upgradeRow({ ...UP, gap: -1.2 }, {}, 0);
  assert.ok(!/class="tag good"/.test(h));
});

t("CSS.escape guards every id interpolation in the shell", () => {
  // The disclosure ids are derived from player ids, which come from Sleeper.
  // A bare `#${id}` selector throws on anything that is not a valid CSS
  // identifier, and removing the guard survived every suite before this.
  const shell = readFileSync(new URL("../v2/shell.js", import.meta.url), "utf-8");
  const selectors = [...shell.matchAll(/querySelector\(`[^`]*\$\{([^}]+)\}[^`]*`\)/g)]
    .map((m) => m[1].trim());
  assert.ok(selectors.length >= 2, `expected id selectors, found ${selectors.length}`);
  for (const expr of selectors) {
    assert.match(expr, /CSS\.escape\(/, `unescaped id in a selector: \${${expr}}`);
  }
});

t("open disclosure state is scoped, so a league switch cannot restore the wrong row", () => {
  const shell = readFileSync(new URL("../v2/shell.js", import.meta.url), "utf-8");
  assert.match(shell, /sameScope/, "setContent no longer scopes restored state");
  const boot = readFileSync(new URL("../v2/boot.js", import.meta.url), "utf-8");
  assert.match(boot, /setContent\(renderPage\(route, state\), `/,
    "boot stopped passing a scope to setContent");
});

console.log(`v2 pages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

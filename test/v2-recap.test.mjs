// THE RECAP PAGE.
//
// ui.js:555 is `const took = row.delta <= 0`, and every sentence on this page
// hangs off it. Get the comparison backwards, or make it strict, and the page
// confidently tells Chris he was wrong in exactly the weeks he was right.
// logic/recap.js holds the line; this asserts the copy that depends on it,
// including the zero boundary that a `<` instead of a `<=` would move.
//
// The lockout half is a separate claim on purpose: a lockout is not a decision
// he got wrong, and three of the assertions below exist to stop it reading
// like one.
import assert from "node:assert";
import { recapPage } from "../v2/recap-page.js";

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
    `leaked a placeholder: ${txt(html).slice(0, 200)}`);
};

const LG = (recap) => ({ entry: { key: "joop", name: "Joop Squad" }, recap });
const R = (rows, o = {}) => ({
  any: true, rows, netLineup: 0, netLocked: 0, weeks: rows.length, partialCount: 0, ...o,
});
const lineup = (o = {}) => ({ kind: "lineup", week: 5, delta: -2.4, yours: 101.2,
  suggested: 98.8, partial: false, coverage: 1, ...o });
const locked = (o = {}) => ({ kind: "locked", week: 5, players: ["A Guy"], delta: 0,
  couldHaveStarted: 12.1, hadToStart: 12.1, ...o });

// ===========================================================================
// The inversion
// ===========================================================================
t("A NEGATIVE DELTA MEANS HIS OWN LINEUP HELD UP", () => {
  const h = recapPage(LG(R([lineup({ delta: -2.4 })])), {});
  assert.match(txt(h), /your lineup held up/);
  assert.ok(!/would have scored more/.test(txt(h)));
  clean(h);
});

t("A POSITIVE DELTA MEANS THE SUGGESTION WOULD HAVE WON", () => {
  const h = recapPage(LG(R([lineup({ delta: 3.1, yours: 95, suggested: 98.1 })])), {});
  assert.match(txt(h), /the suggested lineup would have scored more/);
  assert.ok(!/held up/.test(txt(h)));
  clean(h);
});

t("ZERO IS NOT A LOSS, and is not dressed up as a win either", () => {
  // `heldUp` is non-strict (`<= 0`) so a tie is never reported as the
  // suggestion having won - a strict `<` is the mutation that flips a whole
  // week's verdict. But the HEAD must not claim a win at exactly level: it
  // read "your lineup held up" with a +0.0 badge in the win colour over a body
  // saying there was nothing in it.
  const h = recapPage(LG(R([lineup({ delta: 0, yours: 100, suggested: 100 })])), {});
  const body = txt(h);
  assert.ok(!/would have scored more/.test(body), "a tie is not a loss");
  assert.match(body, /the two lineups scored the same/);
  assert.ok(!/class="tag good"/.test(String(h)), "a tie is not styled as a win");
  // and the one below zero still is a win, so the boundary has not just moved
  const win = recapPage(LG(R([lineup({ delta: -0.1 })])), {});
  assert.match(txt(win), /your lineup held up/);
  assert.match(String(win), /class="tag good"/);
});

t("THE NOISE CAVEAT APPEARS ONLY WHEN HIS LINEUP WON", () => {
  const held = txt(recapPage(LG(R([lineup({ delta: -2.4 })])), {}));
  assert.match(held, /a call being wrong once does not make it a bad call/,
    "without this the page is a scoreboard against its own tool");
  assert.match(held, /single weeks are noisy/);
  const lost = txt(recapPage(LG(R([lineup({ delta: 3.1 })])), {}));
  assert.ok(!/does not make it a bad call/.test(lost));
  assert.match(lost, /Worth 3\.1 if you had taken it/);
});

t("both scores are stated, not just the difference", () => {
  const h = txt(recapPage(LG(R([lineup({ yours: 101.2, suggested: 98.8 })])), {}));
  assert.match(h, /You scored 101\.2/);
  assert.match(h, /scored 98\.8/);
});

t("the cost quoted to him is the absolute gap, never a negative", () => {
  const h = txt(recapPage(LG(R([lineup({ delta: -2.4 })])), {}));
  assert.match(h, /would have cost you 2\.4/);
  assert.ok(!/cost you -2\.4/.test(h));
});

// ===========================================================================
// Partial weeks
// ===========================================================================
t("a partial week says what share has published and that it is excluded", () => {
  const h = txt(recapPage(LG(R([lineup({ partial: true, coverage: 0.62 })])), {}));
  assert.match(h, /Only 62% of those players have published stats yet/);
  assert.match(h, /left out of the totals/);
});

t("the footer counts partial weeks when there are any", () => {
  const one = txt(recapPage(LG(R([lineup()], { partialCount: 1 })), {}));
  assert.match(one, /1 week is still partly unpublished/);
  const two = txt(recapPage(LG(R([lineup()], { partialCount: 2 })), {}));
  assert.match(two, /2 weeks are still partly unpublished/);
  const none = txt(recapPage(LG(R([lineup()], { partialCount: 0 })), {}));
  assert.ok(!/partly unpublished/.test(none));
});

// ===========================================================================
// Lockouts — not a decision he got wrong
// ===========================================================================
t("A LOCKOUT THAT COST NOTHING DOES NOT READ AS A LOSS", () => {
  const h = txt(recapPage(LG(R([locked({ delta: 0 })])), {}));
  assert.match(h, /It cost nothing in the end/);
  assert.ok(!/actually cost/.test(h));
});

t("a lockout that did cost something says so", () => {
  const h = txt(recapPage(LG(R([locked({ delta: 4.2, couldHaveStarted: 16, hadToStart: 11.8 })])), {}));
  assert.match(h, /Being locked out actually cost 4\.2/);
});

t("AN UNMEASURABLE LOCKOUT SAYS SO RATHER THAN PRINTING A ZERO", () => {
  const h = recapPage(LG(R([locked({ delta: null })])), {});
  assert.match(txt(h), /not enough published yet to say what it cost/);
  assert.match(String(h), /class="tag unmeasured"[^>]*>—</, "an em dash, marked unmeasured");
  clean(h);
});

t("a lockout names up to three players and counts the rest", () => {
  const h = txt(recapPage(LG(R([locked({ players: ["A", "B", "C", "D", "E"] })])), {}));
  assert.match(h, /locked out — A, B, C and 2 more/);
});

t("THE TWO TOTALS ARE REPORTED SEPARATELY", () => {
  const h = txt(recapPage(LG(R([lineup(), locked()], { netLineup: -3.2, netLocked: 4.1, weeks: 2 })), {}));
  assert.match(h, /calls -3\.2 pts across 2 wk/);
  assert.match(h, /locked out \+4\.1/);
  assert.match(h, /a lockout is not a decision you got wrong/,
    "the reason the totals are separate has to be on the page");
});

// ===========================================================================
// Structure and degradation
// ===========================================================================
t("the row cap is six", () => {
  const rows = Array.from({ length: 9 }, (_, i) => lineup({ week: i + 1 }));
  const h = String(recapPage(LG(R(rows)), {}));
  assert.equal((h.match(/class="disc"/g) || []).length, 6);
});

t("DISCLOSURE IDS COME FROM THE WEEK, NOT THE ROW'S POSITION", () => {
  const h = String(recapPage(LG(R([lineup({ week: 4 }), locked({ week: 6 })])), {}));
  assert.match(h, /id="rc-l-4"/);
  assert.match(h, /id="rc-k-6"/);
  assert.ok(!/id="rc-l-0"|id="rc-k-1"/.test(h), "a positional id reopens a different week");
});

t("NOTHING GRADED RENDERS AN EXPLANATION, NOT A BLANK PAGE", () => {
  const h = recapPage(LG({ any: false, rows: [] }), {});
  assert.match(txt(h), /Nothing graded yet/);
  assert.match(txt(h), /lives in this browser on this device/,
    "the per-device caveat is the most likely reason it is empty");
  clean(h);
});

t("the per-device caveat is on the graded page too", () => {
  const h = txt(recapPage(LG(R([lineup()])), {}));
  assert.match(h, /log lives in this browser on this device/);
  assert.match(h, /a lineup set on your phone is not in it/);
});

t("results are described as re-scored at this league's rules, not the vendor's", () => {
  const h = txt(recapPage(LG(R([lineup()])), {}));
  assert.match(h, /re-scored at this league's own rules/);
  assert.match(h, /not the vendor's PPR total/);
});

t("no league at all degrades rather than throwing", () => {
  assert.match(txt(recapPage(null, {})), /No league selected/);
});

// ===========================================================================
// Boundaries the first cut of this suite did not reach.
//
// A phase 4 audit ran fifty mutations and fifteen lived. Eight of them were
// here, all on the graded path, and every one is a value of exactly zero or a
// sign being dropped - the cases a hand-written fixture never happens to pick.
// ===========================================================================
t("A CALLS TOTAL OF EXACTLY ZERO IS STILL REPORTED", () => {
  // `!r.netLineup` instead of `=== null` silently drops the whole total.
  const h = txt(recapPage(LG(R([lineup()], { netLineup: 0, netLocked: null, weeks: 4 })), {}));
  assert.match(h, /calls \+0\.0 pts across 4 wk/);
});

t("A LOCKOUT TOTAL OF EXACTLY ZERO IS STILL REPORTED", () => {
  // The common case: nothing was lost to lockouts. `!r.netLocked` drops the
  // figure while the footnote still promises two separate totals.
  const h = txt(recapPage(LG(R([locked()], { netLineup: null, netLocked: 0 })), {}));
  assert.match(h, /locked out \+0\.0/);
  assert.match(h, /totalled separately/);
});

t("A LOCKED-OUT PLAYER WHO SCORED EXACTLY ZERO IS STILL NAMED", () => {
  const h = txt(recapPage(LG(R([locked({ couldHaveStarted: 0, hadToStart: 4.2, delta: 0 })])), {}));
  assert.match(h, /Who you could not start scored 0\.0/);
});

t("...AND SO IS THE ONE YOU WERE STUCK WITH", () => {
  const h = txt(recapPage(LG(R([locked({ couldHaveStarted: 4.2, hadToStart: 0 })])), {}));
  assert.match(h, /Who you were stuck with scored 0\.0/);
});

t("A LOCKOUT THAT COST ZERO IS NOT THE SAME AS ONE THAT COULD NOT BE MEASURED", () => {
  // This distinction is the thing the port ADDED over ui.js, so it is exactly
  // what a mutation would take back out.
  const zero = String(recapPage(LG(R([locked({ delta: 0 })])), {}));
  assert.match(zero, /class="tag"[^>]*>\+0\.0</, "a measured zero carries its number");
  assert.ok(!/unmeasured/.test(zero));
  const none = String(recapPage(LG(R([locked({ delta: null })])), {}));
  assert.match(none, /class="tag unmeasured"[^>]*>—</);
});

t("A LOCKOUT NAMING FEWER THAN THREE PLAYERS COUNTS NO EXTRAS", () => {
  // Dropping Math.max(0, ...) prints "and -1 more" on most lockouts.
  const one = txt(recapPage(LG(R([locked({ players: ["Only Guy"] })])), {}));
  assert.match(one, /locked out — Only Guy/);
  assert.ok(!/more/.test(one), one);
  const three = txt(recapPage(LG(R([locked({ players: ["A", "B", "C"] })])), {}));
  assert.ok(!/more/.test(three), "exactly three is not 'and 0 more'");
});

t("THE VERDICT COLOUR FOLLOWS THE VERDICT", () => {
  const held = String(recapPage(LG(R([lineup({ delta: -2.4 })])), {}));
  assert.match(held, /class="tag good"/, "his lineup won; the tag should read as a win");
  const lost = String(recapPage(LG(R([lineup({ delta: 3.1 })])), {}));
  assert.ok(!/class="tag good"/.test(lost), "the suggestion won; the tag must not say otherwise");
});

t("THE TAG KEEPS ITS SIGN", () => {
  // n1(Math.abs(delta)) renders -3.4 as 3.4 and reverses the week's meaning
  // for anyone reading the tag rather than the sentence.
  const h = String(recapPage(LG(R([lineup({ delta: -3.4 })])), {}));
  assert.match(h, />-3\.4</, "a negative delta must render negative");
  const up = String(recapPage(LG(R([lineup({ delta: 3.4 })])), {}));
  assert.match(up, />\+3\.4</, "and a positive one must carry its plus");
});

t("EXACTLY LEVEL IS NOT DESCRIBED AS A COST", () => {
  const h = txt(recapPage(LG(R([lineup({ delta: 0, yours: 100, suggested: 100 })])), {}));
  assert.match(h, /scored the same/);
  assert.ok(!/cost you 0\.0/.test(h), "v1 printed a cost of zero and then caveated it");
});

console.log(`\nv2 recap: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

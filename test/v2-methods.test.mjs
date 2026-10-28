// THE METHODS PAGE.
//
// This page exists because constraint 4 of the rebuild split the old 748px
// footer in two, and "nothing is deleted" (decision 5) is a claim a test can
// actually hold. So most of what follows asserts that a specific sentence the
// original shipped still exists somewhere on the site.
//
// The other half asserts the SPLIT itself: a live per-load fact that belongs in
// the status strip must NOT also be stated here, because two copies of
// "kickoff locking is on" can disagree and the one on a methodology page will
// be the stale one.
import assert from "node:assert";
import { methodsPage, SECTIONS } from "../v2/methods-page.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', mdash: "—", ndash: "–",
  hellip: "…", times: "×", ge: "≥", sigma: "σ", rarr: "→" };
const txt = (html) => String(html)
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENT ? ENT[n] : m))
  .replace(/\s+/g, " ").trim();
const clean = (html) => assert.ok(
  !/\bundefined\b|\bNaN\b|\[object Object\]/.test(txt(html)),
  `leaked a placeholder: ${txt(html).slice(0, 200)}`);

const LG = (o = {}) => ({
  entry: { key: "joop", name: "Joop Squad" },
  teams: 14, rosteredCount: 196, faabLeft: 42,
  league: { settings: { playoff_week_start: 15 }, scoring_settings: { pass_td: 4, rec: 1 } },
  freeBest: { QB: { name: "A QB", pts: 14.9 }, RB: { name: "A RB", pts: 6.9 },
              WR: { name: "A WR", pts: 10.0 }, TE: { name: "A TE", pts: 9.6 },
              K: { name: "A K", pts: 8.1 }, DEF: { name: "A DEF", pts: 9.8 } },
  sigma: { QB: 6.1, RB: 4.2, WR: 4.0, TE: 3.3 },
  roster: [],
  ...o,
});

// ===========================================================================
// Structure
// ===========================================================================
t("every declared section is rendered with its anchor", () => {
  const h = String(methodsPage(LG(), {}));
  for (const [id] of SECTIONS) {
    assert.ok(h.includes(`id="${id}"`), `section ${id} is declared but not rendered`);
  }
  clean(h);
});

t("the contents list links to every section", () => {
  const h = String(methodsPage(LG(), {}));
  for (const [id] of SECTIONS) {
    assert.ok(h.includes(`#${id}"`), `no contents link to ${id}`);
  }
});

t("no league at all degrades rather than throwing", () => {
  assert.match(txt(methodsPage(null, {})), /No league selected/);
});

// ===========================================================================
// The measured halves — the reason this page is per-league at all
// ===========================================================================
t("REPLACEMENT LEVEL IS RENDERED PER POSITION FROM WHO IS ACTUALLY FREE", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /RB 6\.9/);
  assert.match(h, /DEF 9\.8/);
  assert.match(h, /actually free in this league right now/);
  assert.match(h, /not from a 12-team rule of thumb|not\s+from a 12-team/,
    "the whole point is that it is measured rather than assumed");
});

t("the VOR sentence keeps the 14-team-versus-8-team claim", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /14-team RB2 and an 8-team RB2 different things/);
});

t("MEASURED SIGMA IS RENDERED, WITH THE HALF-SIGMA RULE AND ITS FLOOR AND CAP", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /QB 6\.1/);
  assert.match(h, /half the σ/);
  assert.match(h, /floored at 1\.0 and capped at 2\.0/);
  assert.match(h, /Forced calls ignore the threshold/);
});

t("a league with nothing measured says so rather than rendering an empty list", () => {
  const h = txt(methodsPage(LG({ freeBest: {}, sigma: {} }), {}));
  assert.match(h, /No free players priced this load/);
  assert.match(h, /Not measured this load/);
});

// ===========================================================================
// The scoring claim — read, never asserted
// ===========================================================================
t("THE PASSING-TD WEIGHT IS READ FROM THE LEAGUE", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /This league pays 4\.0 for a passing touchdown/);
});

t("a different weight is reported as that league's, not as four", () => {
  const L = LG();
  L.league.scoring_settings.pass_td = 6;
  const h = txt(methodsPage(L, {}));
  assert.match(h, /pays 6\.0 for a passing touchdown/);
  assert.ok(!/pays 4\.0/.test(h));
});

t("AN UNREADABLE WEIGHT IS NOT QUOTED AT ALL", () => {
  const L = LG();
  delete L.league.scoring_settings;
  const h = txt(methodsPage(L, {}));
  assert.match(h, /could not be read this load, so it is not quoted/);
  assert.ok(!/pays .* for a passing touchdown/.test(h));
  clean(methodsPage(L, {}));
});

t("THE STALE 'BOTH YOUR LEAGUES' CLAIM IS GONE", () => {
  // ui.js:925 hardcoded "both your leagues pay 4". There are three leagues.
  const h = txt(methodsPage(LG(), {}));
  assert.ok(!/both your leagues/i.test(h));
});

t("the re-score is described as inspectable rather than asserted", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /re-scored at this league's actual\s+rules|re-scored at this league's actual rules/);
  assert.match(h, /never the vendor's own PPR total/);
});

// ===========================================================================
// Nothing deleted
// ===========================================================================
t("THE NOT-WIRED LIST KEEPS ALL THREE ORIGINAL ADMISSIONS", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /Kicker totals marked ≥ are floors/);
  assert.match(h, /kickers are never recommended off\s+the wire|never recommended off the wire/);
  assert.match(h, /defence row is a projection gap/);
  assert.match(h, /FAAB bid figures are deliberately absent, not missing/);
});

t("the defence row's admission keeps the never-asked distinction", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /it is not that it was\s+asked and the answer was noise|not that it was asked and the answer was noise/,
    "waivers.js carries a comment forbidding the flattering version of this");
});

t("the kickoff section keeps the daylight-saving claim", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /real daylight-saving rules/);
  assert.match(h, /never a fixed offset/);
});

t("the Vegas section keeps both the six-week horizon and the never-moves claim", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /six weeks ahead/);
  assert.match(h, /never move a projection/);
});

t("the usage section keeps measured-not-projected and blank-not-zero", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /measured, never\s+projected|measured, never projected/);
  assert.match(h, /blank rather than a zero/);
});

t("the consensus section keeps per-position and flag-not-vote", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /per position/);
  assert.match(h, /RB12 and a WR12 are not the same claim/);
  assert.match(h, /a flag, never a vote/);
});

// ===========================================================================
// The split — live facts stay in the status strip
// ===========================================================================
t("THE LIVE PER-LOAD FACTS ARE NOT RESTATED HERE", () => {
  const h = txt(methodsPage(LG(), {}));
  // status.js owns every one of these, and a second copy would be the stale one.
  assert.ok(!/Usage through week/i.test(h), "the through-week belongs to the status strip");
  // status.js's own sentence, which is the thing that must not be duplicated.
  // Methods is allowed to SAY that the state is live and where to read it -
  // "whether locking is on this load is a live fact" is the split working,
  // not a violation of it. What it may not do is assert the state.
  assert.ok(!/Kickoff locking is (on|off)/i.test(h),
    "that is status.js's claim; a second copy here would be the stale one");
  // Again the strip's claim, not the subject. Methods names "which clubs have
  // not filed" as a live fact it does not carry; it must not name the clubs.
  assert.ok(!/have not filed week/i.test(h));
  assert.ok(!/unavailable this load/i.test(h));
});

t("it says where those live facts actually live", () => {
  const h = txt(methodsPage(LG(), {}));
  assert.match(h, /status strip/);
});

t("EVERY CROSS-LINK CARRIES THE LEAGUE YOU ARE READING ABOUT", () => {
  // href("compare") without the key resolves to the FIRST league, so a
  // middle-click from #/bku/methods silently opens Joop.
  const L = LG();
  L.entry = { key: "bku", name: "Ball Knowers United" };
  const h = String(methodsPage(L, {}));
  const links = [...h.matchAll(/href="(#\/[^"]*)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 4, `only ${links.length} internal links: ${links.join(", ")}`);
  for (const href of links) {
    assert.match(href, /^#\/bku\//, `${href} does not carry the league being read`);
  }
  // and the specific one the mutation targeted
  assert.ok(links.some((x) => x === "#/bku/compare"),
    `no league-carrying compare link: ${links.join(", ")}`);
});

t("the two corrected claims stay corrected", () => {
  const h = txt(methodsPage(LG(), {}));
  // The display name is config, not a live read, and the page said otherwise.
  assert.match(h, /The name is the exception/);
  assert.match(h, /leagues\.json/);
  // The usage mirror is not the only thing that can be stale.
  assert.ok(!/the one number on this site that can be stale/.test(h));
  assert.match(h, /the schedule is cached too/);
});

console.log(`\nv2 methods: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

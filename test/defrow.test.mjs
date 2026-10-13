// The standing-defence row, all six copy branches, as TEXT.
//
// A presence assertion ("the section exists") passes on a block printing
// "undefined" in every sentence - the exact trap the vacancy work hit. These
// read the rendered string.
import { defRow, wireTally } from "../js/ui.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const BEST = { id:"jax", name:"Jacksonville", team:"JAX", pts:10.2, opponent:"@TEN" };
const D = (over = {}) => ({
  slot:"DEF", best:BEST,
  current:{ id:"phi", name:"Philadelphia", team:"PHI", pts:5.3, locked:false },
  empty:false, unresolved:false, unprojected:false, gap:4.9, actionable:true, ...over,
});

// Every branch goes through this, so no branch can ship the defects above.
const clean = (html, label) => {
  const s = text(html);
  for (const bad of ["undefined", "null", "NaN", "[object"]) {
    assert.ok(!s.includes(bad), `${label}: copy contains "${bad}" — ${s.slice(0, 160)}`);
  }
  assert.ok(s.length > 40, `${label}: copy is suspiciously short — "${s}"`);
  assert.ok(!/\ba (ankle|upgrade|empty|unresolved)\b/.test(s), `${label}: "a" before a vowel`);
  return s;
};

t("no row at all when there is nothing to say", () => {
  assert.strictEqual(defRow(null), "");
  assert.strictEqual(defRow(undefined), "");
});

t("ACTIONABLE: names both defences, the gap, and refuses to claim a matchup read", () => {
  const s = clean(defRow(D()), "actionable");
  assert.ok(s.includes("Stream Jacksonville"), s);
  assert.ok(s.includes("Philadelphia"), s);
  assert.ok(s.includes("+4.9"), s);
  assert.ok(s.includes("10.2") && s.includes("5.3"), s);
  // The honesty clause is load-bearing copy, not decoration.
  assert.ok(/projection gap, not a matchup read/i.test(s), s);
  assert.ok(!/\bcalm\b/.test(defRow(D())), "an actionable row must not be styled calm");
});

t("CALM: 'yours is better' still renders, and reads as nothing-to-do", () => {
  const html = defRow(D({ gap:-5.8, actionable:false,
    current:{ id:"phi", name:"Philadelphia", team:"PHI", pts:16.0, locked:false } }));
  const s = clean(html, "calm");
  assert.ok(html.includes("calm"), "a non-actionable row must carry the calm class");
  assert.ok(s.includes("better bet"), s);
  assert.ok(s.includes("-5.8"), s);
  // It has to say WHY it is here on a quiet week, or it reads as filler.
  assert.ok(/checked/i.test(s), s);
});

t("LOCKED: reports the gap and says Sleeper will refuse the swap", () => {
  const s = clean(defRow(D({ actionable:false,
    current:{ id:"phi", name:"Philadelphia", team:"PHI", pts:5.3, locked:true } })), "locked");
  assert.ok(s.includes("locked"), s);
  assert.ok(/refuse/i.test(s), s);
  assert.ok(s.includes("+4.9"), s);
});

t("UNPROJECTED: the gap is unknown rather than favourable", () => {
  const s = clean(defRow(D({ gap:null, unprojected:true, actionable:false,
    current:{ id:"phi", name:"Philadelphia", team:"PHI", pts:null, locked:false } })), "unprojected");
  assert.ok(/not priced/i.test(s), s);
  assert.ok(/unknown rather than favourable/i.test(s), s);
  // The dash, never a fabricated number.
  assert.ok(!/[+-]\d/.test(s), `a null gap must not print a signed number — ${s}`);
});

t("EMPTY SEAT: an empty seat is worth zero, and the row says so plainly", () => {
  const s = clean(defRow(D({ empty:true, current:null, gap:10.2, actionable:true })), "empty");
  assert.ok(/empty/i.test(s), s);
  assert.ok(s.includes("Jacksonville"), s);
  assert.ok(s.includes("10.2"), s);
});

t("UNRESOLVED: missing data is not reported as a bad defence", () => {
  const s = clean(defRow(D({ unresolved:true, current:null, gap:null, actionable:false })), "unresolved");
  assert.ok(/could not be resolved|could not look up/i.test(s), s);
  assert.ok(/Missing data is not a bad defence/i.test(s), s);
  assert.ok(!/[+-]\d/.test(s), `unresolved must not print a gap — ${s}`);
});

t("a defence name with a quote in it cannot break out of the markup", () => {
  const html = defRow(D({ best: { ...BEST, name:'X<script>"&' } }));
  assert.ok(!html.includes("<script>"), "unescaped name reached the DOM");
  assert.ok(html.includes("&lt;script&gt;"), "name should be escaped");
});

t("an opponent-less best defence does not render an empty 'vs'", () => {
  const s = clean(defRow(D({ best: { ...BEST, opponent:null } })), "no opponent");
  assert.ok(!/vs\s*\)/.test(s), s);
  assert.ok(!/\bvs\s*$/.test(s), s);
});

t("TIE: a dead heat is not a win for whoever you already own", () => {
  // The render fixture projects every defence identically, which is how this
  // branch was found: the gap-negative copy claimed "is the better bet" at
  // +0.0.
  const html = defRow(D({ gap:0, actionable:false,
    current:{ id:"phi", name:"Philadelphia", team:"PHI", pts:10.2, locked:false } }));
  const s = clean(html, "tie");
  assert.ok(html.includes("calm"), "a tie is not an action");
  assert.ok(/Nothing between them/i.test(s), s);
  assert.ok(!/better bet/i.test(s), s);
  assert.ok(!/[+-]0\.0/.test(s), `a tie must not print a signed zero — ${s}`);
});

t("ALL LOCKED: a Monday-evening row that says so rather than disappearing", () => {
  const s = clean(defRow(D({ allLocked:true, best:null, gap:null, actionable:false })),
                  "allLocked");
  assert.ok(/already played/i.test(s), s);
  assert.ok(/refuse/i.test(s), s);
  assert.ok(!/[+-]\d/.test(s), `no gap exists to print — ${s}`);
});

t("NO PROJECTIONS: an unpublished feed is not thirty-two worthless defences", () => {
  const s = clean(defRow(D({ noProjections:true, gap:0, actionable:false,
    best:{ id:"jax", name:"Jacksonville", team:"JAX", pts:0, opponent:null },
    current:{ id:"phi", name:"Philadelphia", team:"PHI", pts:0, locked:false } })),
    "noProjections");
  assert.ok(/not published|No defence projections/i.test(s), s);
  // It must NOT claim the two are evenly matched.
  assert.ok(!/both project/i.test(s), s);
  assert.ok(!/better bet/i.test(s), s);
});

t("the copy never calls his own rostered defence a free agent", () => {
  const s = clean(defRow(D()), "actionable");
  assert.ok(!/two free options/i.test(s), s);
  assert.ok(/nobody owns/i.test(s), s);
});

t("AUDIT: the wire tally counts actionable work, and only that", () => {
  // Deleting the defence term from the inline template left every suite green.
  const w = (def) => ({ upgrades:[1,2], risers:[3], def });
  assert.strictEqual(wireTally(w(null)), 3);
  assert.strictEqual(wireTally(w({ actionable:true })), 4);
  assert.strictEqual(wireTally(w({ actionable:false })), 3);
  assert.strictEqual(wireTally(null), 0);
  assert.strictEqual(wireTally({}), 0);
});

t("RE-AUDIT: an empty seat is not 'held'", () => {
  const s = clean(defRow(D({ allLocked:true, best:null, gap:null, actionable:false,
    empty:true, current:null })), "allLocked empty");
  assert.ok(/is empty/i.test(s), s);
  assert.ok(!/holding your/i.test(s), s);
});

console.log(`defrow  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// DIFFERENTIAL TEST: the lifted logic against the ORIGINAL ui.js.
//
// The v2-logic suite proves the new modules are self-consistent. It cannot
// prove they match what shipped - a ladder reordered in both the port and the
// test is green and wrong. This suite imports the original exported functions
// and asserts the new ones agree with them on the same inputs.
//
// It is deliberately coupled to ui.js and is EXPECTED TO BE DELETED at the
// swap, when ui.js stops being the reference implementation. Until then it is
// the only thing standing between a careful rewrite and a silent behaviour
// change.
import assert from "node:assert";
import { defRow, wireTally as wireTallyOriginal } from "../js/ui.js";
import { defVerdict } from "../v2/logic/defence.js";
import { wireTally } from "../v2/logic/wire.js";
import { defenceRow } from "../v2/wire-page.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

// A phrase that appears in the original's output for exactly one branch.
const SIGNATURE = {
  "no-projections": "No defence projections yet",
  "all-locked":     "Every free defence has already played",
  "empty":          "into your empty",
  "unresolved":     "starter could not be resolved",
  "unprojected":    "is not priced this week",
  "current-locked": "has already kicked off, so Sleeper will refuse",
  "marginal":       "Marginal:",
  "actionable":     "projection gap, not a",
  "tie":            "Nothing between them",
  "hold":           "is the better bet",
};

const base = () => ({
  slot: "DEF",
  current: { name: "Las Vegas", pts: 4.3 },
  best: { name: "Kansas City", pts: 9.2, opponent: "LV" },
  gap: 4.9,
});

// Each case is built to make the ladder EARN its order: later flags are left
// true as well, so a reordering changes the answer.
const CASES = {
  "no-projections": { noProjections: true, allLocked: true, empty: true, actionable: true },
  "all-locked":     { allLocked: true, empty: true, unresolved: true, best: null, actionable: true },
  "empty":          { empty: true, unresolved: true, actionable: true },
  "unresolved":     { unresolved: true, unprojected: true, actionable: true },
  "unprojected":    { unprojected: true, actionable: true, marginal: true },
  "current-locked": { current: { name: "Las Vegas", pts: 4.3, locked: true }, actionable: true, marginal: true },
  "marginal":       { marginal: true, actionable: true },
  "actionable":     { actionable: true },
  "tie":            { gap: 0 },
  "hold":           { gap: -2.1 },
};

for (const [kind, patch] of Object.entries(CASES)) {
  t(`defence ladder agrees with ui.js on "${kind}"`, () => {
    const d = { ...base(), ...patch };
    const mine = defVerdict(d).kind;
    const theirs = defRow(d);
    assert.strictEqual(mine, kind, `v2 classified this as "${mine}"`);
    assert.ok(theirs.includes(SIGNATURE[kind]),
      `ui.js did NOT produce the "${kind}" branch for this input.\n      got: ${theirs.slice(0, 160)}`);
    // And prove the signature is exclusive: no other branch's phrase appears.
    for (const [other, phrase] of Object.entries(SIGNATURE)) {
      if (other === kind) continue;
      assert.ok(!theirs.includes(phrase),
        `ui.js output for "${kind}" also contains the "${other}" signature - the test is not discriminating`);
    }
  });
}

t("defVerdict returns null exactly where defRow returns empty", () => {
  assert.strictEqual(defRow(null), "");
  assert.strictEqual(defVerdict(null), null);
});

t("counts agrees with the original's calm styling", () => {
  const withWork = { ...base(), actionable: true, counts: true };
  const quiet = { ...base(), gap: -2.1, counts: false };
  assert.ok(!defRow(withWork).includes("calm") && defVerdict(withWork).counts === true);
  assert.ok(defRow(quiet).includes("calm") && defVerdict(quiet).counts === false);
});

for (const w of [
  { upgrades: [1, 2], risers: [3], def: { counts: true } },
  { upgrades: [1, 2], risers: [3], def: { counts: false } },
  { upgrades: [], risers: [], def: { counts: true } },
  { upgrades: [1], risers: [] },
  {},
  null,
]) {
  t(`wireTally agrees with ui.js for ${JSON.stringify(w)}`, () => {
    assert.strictEqual(wireTally(w), wireTallyOriginal(w));
  });
}

// ---------------------------------------------------------------------------
// THE DEFENCE ROW'S COPY, branch by branch, against the original.
//
// The ladder's ORDER is already proven above. This proves the SENTENCES: ten
// branches of hand-written copy were retyped into v2/wire-page.js, and copy is
// what this project's render layer has actually caught - a missing article, a
// verdict a number does not support, "undefined" in every sentence under a
// passing presence assertion. Each branch must still say the thing that makes
// it that branch, and must not say any other branch's thing.
// ---------------------------------------------------------------------------
for (const [kind, patch] of Object.entries(CASES)) {
  t(`defence COPY agrees with ui.js on "${kind}"`, () => {
    const d = { ...base(), ...patch };
    const mine = defenceRow(d);
    assert.ok(mine.includes(SIGNATURE[kind]),
      `v2 did not produce the "${kind}" sentence.\n      got: ${mine.replace(/<[^>]+>/g, " ").slice(0, 200)}`);
    for (const [other, phrase] of Object.entries(SIGNATURE)) {
      if (other === kind) continue;
      assert.ok(!mine.includes(phrase),
        `the "${kind}" row also contains the "${other}" signature`);
    }
  });
}

t("the two refusals survive the port, word for word", () => {
  // Both are claims about what this tool will not do, and both were written
  // deliberately. A paraphrase is a different promise.
  const actionable = defenceRow({ ...base(), actionable: true, counts: true });
  assert.ok(actionable.includes("This is a projection gap, not a\n             matchup read.")
    || actionable.replace(/\s+/g, " ").includes("This is a projection gap, not a matchup read."),
    "the projection-gap refusal is missing or reworded");
});

t("a defence row never renders undefined, on any branch", () => {
  for (const patch of Object.values(CASES)) {
    const out = defenceRow({ ...base(), ...patch });
    assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(out),
      `leaked a placeholder: ${out.replace(/<[^>]+>/g, " ").slice(0, 160)}`);
  }
  assert.strictEqual(defenceRow(null), "");
});

console.log(`v2 differential: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

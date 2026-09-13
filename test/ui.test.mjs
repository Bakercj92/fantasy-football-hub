import { dayPlan, dayNote, visible } from "../js/ui.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

// The section registry lives inside render(), which needs a DOM. These are the
// keys it defines; the test asserts the two lists agree, which is the failure
// mode a typo in a plan would produce.
const REGISTRY = ["sched","calls","compare","recap","waivers","locked","lineup","bench","market"];
const DAYS = [0,1,2,3,4,5,6];

t("every key in every day plan exists in the section registry", () => {
  for (const d of DAYS) {
    for (const key of dayPlan(d)) {
      assert.ok(REGISTRY.includes(key), `day ${d} plans "${key}", which nothing renders`);
    }
  }
});

t("every section in the registry is reachable on at least one day", () => {
  const reachable = new Set(DAYS.flatMap((d) => dayPlan(d)));
  for (const key of REGISTRY) {
    assert.ok(reachable.has(key), `"${key}" is built but never planned — dead code at a public URL`);
  }
});

t("a day never plans the same section twice", () => {
  for (const d of DAYS) {
    const plan = dayPlan(d);
    assert.strictEqual(new Set(plan).size, plan.length, `day ${d} repeats a section`);
  }
});

t("REGRESSION: compare is reachable every day, because its control renders every day", () => {
  // Monday's plan once omitted it. The selector button renders on every row
  // regardless, so tapping it on a Monday grew the selection, fired a Sleeper
  // request per player, and painted nothing — with no clear button to escape.
  for (const d of DAYS) assert.ok(visible("compare", d), `compare unreachable on day ${d}`);
});

t("REGRESSION: the lockout block is reachable every day", () => {
  // Sunday and Monday only made a Thursday-night lockout invisible until the
  // following Sunday.
  for (const d of DAYS) assert.ok(visible("locked", d), `locked unreachable on day ${d}`);
});

t("the recap is genuinely day-gated to Tuesday and Wednesday", () => {
  assert.ok(visible("recap", 2) && visible("recap", 3));
  for (const d of [0,1,4,5,6]) assert.ok(!visible("recap", d), `recap must not show on day ${d}`);
});

t("the wire is available every day but leads on Tuesday and Wednesday", () => {
  for (const d of DAYS) assert.ok(visible("waivers", d));
  for (const d of [2,3]) {
    const plan = dayPlan(d);
    assert.ok(plan.indexOf("waivers") < plan.indexOf("lineup"),
      `on day ${d} the wire must sit above the reference tables`);
  }
});

t("the decision block leads on every day the recap does not", () => {
  for (const d of [0,1,4,5,6]) {
    const plan = dayPlan(d).filter((k) => k !== "sched");
    assert.strictEqual(plan[0], "calls", `day ${d} must open with the decision block`);
  }
});

t("every day has a note, and an unknown day falls back rather than throwing", () => {
  for (const d of DAYS) assert.ok(dayNote(d).length > 10);
  assert.ok(Array.isArray(dayPlan(99)) && dayPlan(99).length > 0);
});

console.log(`ui  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

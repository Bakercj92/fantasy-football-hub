// Which week is "now". The one trap in /state/nfl, pinned.
import { pricingWeek, gradedWeek } from "../js/sleeper.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

t("THE WAIVER-NIGHT TRAP, as measured live on 2026-10-06", () => {
  // display_week 4, week 5: week 4 is in the books, week 5 is what the claims
  // being submitted that evening are for. Pricing against 4 is the bug.
  const nfl = { display_week: 4, week: 5 };
  assert.strictEqual(pricingWeek(nfl), 5);
  assert.strictEqual(gradedWeek(nfl), 4);
});

t("mid-week the two agree, and the graded label goes quiet", () => {
  const nfl = { display_week: 6, week: 6 };
  assert.strictEqual(pricingWeek(nfl), 6);
  // Null, not 6: a label repeating the week already in the header is noise.
  assert.strictEqual(gradedWeek(nfl), null);
});

t("a missing week falls back to what Sleeper is showing", () => {
  assert.strictEqual(pricingWeek({ display_week: 3 }), 3);
  assert.strictEqual(gradedWeek({ display_week: 3 }), null);
});

t("week 0 is not a week - preseason must not price anything", () => {
  // ASSUMED, NOT MEASURED: the only /state/nfl payload this project has ever
  // captured is 2026-10-06. Worth checking against a live August payload.
  assert.strictEqual(pricingWeek({ week: 0, display_week: 0 }), 1);
  assert.strictEqual(gradedWeek({ week: 0, display_week: 0 }), null);
});

t("garbage in the payload does not produce a garbage week", () => {
  assert.strictEqual(pricingWeek({}), 1);
  assert.strictEqual(pricingWeek(null), 1);
  assert.strictEqual(pricingWeek({ week: "nonsense" }), 1);
  assert.strictEqual(pricingWeek({ week: 2.5 }), 1);
  assert.strictEqual(pricingWeek({ week: -3 }), 1);
  assert.strictEqual(gradedWeek(null), null);
});

t("a string week from the feed still works, because JSON is not a contract", () => {
  assert.strictEqual(pricingWeek({ week: "7", display_week: "6" }), 7);
  assert.strictEqual(gradedWeek({ week: "7", display_week: "6" }), 6);
});

t("REGRESSION: display_week never wins when both are present and differ", () => {
  // The literal reverted bug. If this fails, the wire is being priced against
  // a finished week again.
  for (const [shown, now] of [[4, 5], [1, 2], [17, 18]]) {
    assert.strictEqual(pricingWeek({ display_week: shown, week: now }), now);
  }
});

t("AUDIT B3: a LATER display_week is never labelled as being in the books", () => {
  // Season rollover: week 1 of the new season beside display_week 18 of the old
  // one. "Different" labelled a week that has not happened yet as complete.
  assert.strictEqual(gradedWeek({ week: 1, display_week: 18 }), null);
  assert.strictEqual(pricingWeek({ week: 1, display_week: 18 }), 1);
});

t("AUDIT B5: outside the regular season, defer to what Sleeper is showing", () => {
  // weekProjections() hardcodes season_type=regular, so pricing week 19 against
  // it empties `priced` and blanks the whole page - strictly worse than the
  // display_week read this replaced.
  assert.strictEqual(pricingWeek({ season_type:"post", week:19, display_week:18 }), 18);
  assert.strictEqual(pricingWeek({ season_type:"pre",  week:3,  display_week:1  }), 1);
  // ...and the regular season is unaffected.
  assert.strictEqual(pricingWeek({ season_type:"regular", week:5, display_week:4 }), 5);
});

t("AUDIT B5: no week beyond what the projections endpoint can answer", () => {
  assert.strictEqual(pricingWeek({ week: 22 }), 18);
  assert.strictEqual(pricingWeek({ season_type:"post", week:21, display_week:21 }), 18);
});

t("RE-AUDIT: the offseason prices the earlier week, not the one still displayed", () => {
  // February: Sleeper can show week 18 of the season just ended beside week 1
  // of the next. Preferring display_week fetched week 18 of the new season.
  assert.strictEqual(pricingWeek({ season_type:"off", week:1, display_week:18 }), 1);
  assert.strictEqual(pricingWeek({ season_type:"off", week:18, display_week:1 }), 1);
});

console.log(`sleeper  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

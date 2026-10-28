// The router is pure string handling, so it is testable without a browser.
import assert from "node:assert";
import { parse, href, resolve, navVisible, ROUTES, RECAP_NAV_DAYS } from "../v2/router.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
const KEYS = ["joop", "bku", "chop"];

t("empty hash lands on Today", () => {
  assert.deepStrictEqual(parse("", KEYS), { page: "today", league: null });
  assert.deepStrictEqual(parse("#", KEYS), { page: "today", league: null });
  assert.deepStrictEqual(parse("#/", KEYS), { page: "today", league: null });
});

t("global routes carry no league", () => {
  assert.deepStrictEqual(parse("#/today", KEYS), { page: "today", league: null });
  // Today is the only global route since phase 4 moved Methods under a league
  // (two of its sections are measurements of one league's roster, not prose).
  // Asserted through ROUTES rather than a second hardcoded page name, so this
  // keeps meaning something if the scopes move again.
  const globals = Object.entries(ROUTES).filter(([, r]) => r.scope === "global").map(([k]) => k);
  assert.deepStrictEqual(globals, ["today"]);
  for (const k of globals) {
    assert.deepStrictEqual(parse(`#/${k}`, KEYS), { page: k, league: null });
  }
});

t("league-scoped routes round-trip", () => {
  assert.deepStrictEqual(parse("#/joop/wire", KEYS), { page: "wire", league: "joop" });
  assert.strictEqual(href("wire", "joop"), "#/joop/wire");
  assert.strictEqual(href("today", "joop"), "#/today", "a global route never takes a league");
});

t("a trailing slash is not a different page", () => {
  assert.deepStrictEqual(parse("#/joop/wire/", KEYS), { page: "wire", league: "joop" });
});

t("an unknown league is rejected rather than silently rendering someone else's team", () => {
  assert.strictEqual(parse("#/notaleague/wire", KEYS), null);
});

t("an unknown page is rejected", () => {
  assert.strictEqual(parse("#/joop/banana", KEYS), null);
  assert.strictEqual(parse("#/banana", KEYS), null);
  assert.strictEqual(parse("#/a/b/c", KEYS), null);
});

t("a global page cannot be league-scoped", () => {
  // Was asserted through #/joop/methods until phase 4 made Methods
  // league-scoped. Today is the global route now, and the property under test
  // is unchanged: a league in front of a global page is not a URL.
  assert.strictEqual(parse("#/joop/today", KEYS), null);
});

t("methods is league-scoped, and its URL carries one", () => {
  assert.deepStrictEqual(parse("#/joop/methods", KEYS), { page: "methods", league: "joop" });
  assert.strictEqual(href("methods", "joop"), "#/joop/methods");
});

t("a league-scoped page with no league resolves to the active one, not a 404", () => {
  assert.deepStrictEqual(resolve(parse("#/wire", KEYS), KEYS, "bku"), { page: "wire", league: "bku" });
  assert.deepStrictEqual(resolve(parse("#/wire", KEYS), KEYS, null), { page: "wire", league: "joop" });
});

t("resolve leaves a complete route alone", () => {
  const r = { page: "wire", league: "chop" };
  assert.deepStrictEqual(resolve(r, KEYS, "joop"), r);
});

t("THE SOFT RECAP GATE: out of the nav except Tue/Wed, reachable every day", () => {
  assert.strictEqual(navVisible("recap", 2), true);
  assert.strictEqual(navVisible("recap", 3), true);
  for (const d of [0, 1, 4, 5, 6]) assert.strictEqual(navVisible("recap", d), false, `day ${d}`);
  // The point of "soft": the URL still parses on a Sunday.
  assert.deepStrictEqual(parse("#/joop/recap", KEYS), { page: "recap", league: "joop" });
  assert.deepStrictEqual([...RECAP_NAV_DAYS].sort(), [2, 3]);
});

t("every other page is always in the nav", () => {
  for (const p of Object.keys(ROUTES)) {
    if (p === "recap") continue;
    for (let d = 0; d < 7; d++) assert.strictEqual(navVisible(p, d), true, `${p} day ${d}`);
  }
});

t("every route declares a scope, a label and a subtitle", () => {
  for (const [k, r] of Object.entries(ROUTES)) {
    assert.ok(["global", "league"].includes(r.scope), `${k} scope`);
    assert.ok(r.label && r.sub && r.ico, `${k} metadata`);
  }
  assert.strictEqual(Object.keys(ROUTES).length, 6);
});

console.log(`v2 router: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

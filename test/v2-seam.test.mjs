// THE FETCH SEAM's base normalisation.
//
// Audit 2026-10-13 caught this against the real origin: a base with no
// trailing slash makes URL() treat the last segment as a FILE and drop it, so
//   "https://bakercj92.github.io/fantasy-football-hub" + "./data/usage.json"
// resolved to bakercj92.github.io/data/usage.json. leagues.json would fail
// loudly, but usage and vacancy 404 into a SILENT degraded mode - the page
// comes up looking almost right with four layers quietly missing. That is the
// exact failure the seam exists to prevent, reachable through the exact input
// the seam's own comment advertises.
import assert from "node:assert";
import { withSlash } from "../v2/pipeline.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

// Resolve the way dataFetch does, from a page served at /fantasy-football-hub/v2/.
const DOC = "https://bakercj92.github.io/fantasy-football-hub/v2/";
const resolve = (base, url) =>
  new URL(String(url).replace(/^\.\//, ""), new URL(withSlash(base), DOC)).toString();

t("withSlash leaves a correct base alone and repairs one without", () => {
  assert.strictEqual(withSlash("../"), "../");
  assert.strictEqual(withSlash(".."), "../");
  assert.strictEqual(withSlash("https://x.test/a/"), "https://x.test/a/");
  assert.strictEqual(withSlash("https://x.test/a"), "https://x.test/a/");
  assert.strictEqual(withSlash(""), "./");
  assert.strictEqual(withSlash(undefined), "./");
});

t("THE REGRESSION: an absolute origin with no trailing slash keeps its folder", () => {
  assert.strictEqual(
    resolve("https://bakercj92.github.io/fantasy-football-hub", "./data/usage_2026.json"),
    "https://bakercj92.github.io/fantasy-football-hub/data/usage_2026.json");
});

t("every base shape the seam advertises reaches the repo root", () => {
  for (const base of ["../", "..",
                      "https://bakercj92.github.io/fantasy-football-hub",
                      "https://bakercj92.github.io/fantasy-football-hub/",
                      "/fantasy-football-hub", "/fantasy-football-hub/"]) {
    for (const file of ["./leagues.json", "./data/usage_2026.json", "./data/vacancy_2026.json"]) {
      const got = new URL(resolve(base, file));
      assert.ok(got.pathname.startsWith("/fantasy-football-hub/"),
        `base ${base} + ${file} -> ${got.pathname}`);
      assert.ok(!got.pathname.includes("/v2/"),
        `base ${base} + ${file} resolved INSIDE v2 -> ${got.pathname}`);
    }
  }
});

t("a root-served page still resolves to itself", () => {
  const atRoot = (base, url) =>
    new URL(String(url).replace(/^\.\//, ""), new URL(withSlash(base), "https://x.test/")).toString();
  assert.strictEqual(atRoot("./", "./leagues.json"), "https://x.test/leagues.json");
});

console.log(`v2 seam: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

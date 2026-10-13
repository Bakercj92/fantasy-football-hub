// THE FREEZE GUARD.
//
// v2/pipeline.js is a COPY of js/app.js with four documented changes. A copy
// is only safe while the original is frozen, so this pins js/app.js by hash
// and fails the moment it moves.
//
// IF THIS TEST FAILS: app.js changed during the rebuild. Either revert that
// change, or re-run the transform (it lives in the session log for
// 2026-10-13 and in v2/pipeline.js's header, which lists every edit), diff
// the result against the current v2/pipeline.js, and re-pin below.
//
// It also asserts the four changes are still IN the copy - a later edit that
// quietly reinstates the decision-log writes or drops the fetch seam would
// otherwise be invisible until it corrupted something.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf-8");

t("js/app.js is frozen for the duration of the rebuild", () => {
  const pinned = read("../v2/.app-js-pin").trim();
  const actual = createHash("sha256").update(read("../js/app.js")).digest("hex");
  assert.strictEqual(actual, pinned,
    "js/app.js has changed since v2/pipeline.js was derived from it. Read this file's header.");
});

const pipeline = read("../v2/pipeline.js");

t("change 1: the data fetches go through the seam", () => {
  assert.ok(pipeline.includes('dataFetch("./leagues.json")'), "leagues.json");
  assert.ok(pipeline.includes("usage.load(state.season, { fetchImpl: dataFetch })"), "usage");
  assert.ok(pipeline.includes("vacancy.load(state.season, { fetchImpl: dataFetch })"), "vacancy");
  assert.ok(!/await fetch\("\.\/leagues\.json"\)/.test(pipeline), "a raw leagues.json fetch came back");
});

t("change 2: the decision log is still read-only", () => {
  assert.ok(/const LOG_ENABLED = false;/.test(pipeline), "the kill switch is missing");
  assert.ok(/LOG_ENABLED && recordLineup\(\{/.test(pipeline), "recordLineup is not gated");
  assert.ok(!/^\s*recordMissed\(\{/m.test(pipeline), "recordMissed is live again");
});

t("change 3: rendering is injected, not imported from ui.js", () => {
  assert.ok(!pipeline.includes('from "./ui.js"') && !pipeline.includes('from "../js/ui.js"'),
    "pipeline must not import the old render layer");
  assert.ok(pipeline.includes("hooks.paint(state, {"), "paint is not injected");
});

t("change 4: it exports start() and does not boot on import", () => {
  assert.ok(/export function start\(/.test(pipeline));
  assert.ok(!/^boot\(\);$/m.test(pipeline), "pipeline still boots on import");
});

t("every engine import points out of v2, never inside it", () => {
  const bad = [...pipeline.matchAll(/from "(\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(bad, [], `these should be ../js/: ${bad.join(", ")}`);
});

t("the engine modules - and ui.js, the reference - are untouched", () => {
  // Presentation-only means exactly this. If one of these moves, the rebuild
  // has quietly become an engine change.
  //
  // js/ui.js is pinned for a different reason: it is the reference
  // implementation for all ten lifted behaviours, and the differential suite
  // covers only two of them. Unpinned, the one file the port is judged
  // against was the one file that could move without failing anything.
  const pins = JSON.parse(read("../v2/.engine-pins.json"));
  for (const [file, want] of Object.entries(pins)) {
    const got = createHash("sha256").update(read(`../${file}`)).digest("hex");
    assert.strictEqual(got, want, `${file} changed - the rebuild is presentation-only`);
  }
});

console.log(`v2 pipeline sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

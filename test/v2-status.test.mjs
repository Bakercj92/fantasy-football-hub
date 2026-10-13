import assert from "node:assert";
import { statusModel } from "../v2/status.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

const healthy = () => ({
  schedule: { ok: true, stale: false },
  usage: { ok: true, throughWeek: 5, generatedAt: "2026-10-13T00:00:00Z" },
  usageFresh: { behind: false },
  unfiled: [],
  market: { ok: true, scrapedAt: "2026-10-12" },
});

t("a clean load is ok and says so", () => {
  const m = statusModel(healthy());
  assert.strictEqual(m.level, "ok");
  assert.match(m.summary, /checked out/);
});

t("NO SCHEDULE IS THE LOUDEST ROW: locking off makes every call suspect", () => {
  const m = statusModel({ ...healthy(), schedule: { ok: false, warning: "feed unreachable" } });
  assert.strictEqual(m.level, "bad");
  assert.match(m.summary, /locking is off/i);
  assert.match(m.rows.find((r) => r.key === "schedule").text, /locking is OFF/);
});

t("a cached schedule warns but does not read as an outage", () => {
  const m = statusModel({ ...healthy(), schedule: { ok: true, stale: true, warning: "cached" } });
  assert.strictEqual(m.level, "warn");
});

t("an unrecognised team is a join failure, never a bye", () => {
  const m = statusModel(healthy(), { unknown: ["XYZ"] });
  assert.strictEqual(m.level, "bad");
  assert.match(m.rows.find((r) => r.key === "unknown").text, /join failure, not a bye/);
});

t("clubs are named while they fit in a reader's head, counted past that", () => {
  const few = statusModel({ ...healthy(), unfiled: ["CIN", "DET"] });
  assert.match(few.rows.find((r) => r.key === "usage").text, /CIN and DET/);
  const many = statusModel({ ...healthy(), unfiled: ["A", "B", "C", "D", "E"] });
  assert.match(many.rows.find((r) => r.key === "usage").text, /5 clubs/);
});

t("a mirror behind upstream warns", () => {
  const m = statusModel({ ...healthy(), usageFresh: { behind: true } });
  assert.strictEqual(m.level, "warn");
  assert.match(m.rows.find((r) => r.key === "usage").text, /newer data since/);
});

t("no usage layer at all hides the metrics rather than guessing", () => {
  const m = statusModel({ ...healthy(), usage: { ok: false } });
  assert.match(m.rows.find((r) => r.key === "usage").text, /hidden rather than guessed/);
});

t("market still loading is not a warning", () => {
  const m = statusModel({ ...healthy(), market: null });
  assert.strictEqual(m.level, "ok");
  assert.strictEqual(m.rows.find((r) => r.key === "market").pending, true);
});

t("market failed IS a warning", () => {
  assert.strictEqual(statusModel({ ...healthy(), market: { ok: false } }).level, "warn");
});

t("several problems are counted, not listed in the summary", () => {
  const m = statusModel({ ...healthy(), schedule: { ok: false }, market: { ok: false } }, { unknown: ["XX"] });
  assert.match(m.summary, /3 things/);
  assert.strictEqual(m.level, "bad");
});

t("unpriced players surface, and zero does not", () => {
  assert.ok(statusModel(healthy(), { unpriced: 2 }).rows.some((r) => r.key === "unpriced"));
  assert.ok(!statusModel(healthy(), { unpriced: 0 }).rows.some((r) => r.key === "unpriced"));
});

console.log(`v2 status: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

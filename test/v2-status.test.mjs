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

t("A FOUR-MINUTE LAG IS NOT A WARNING", () => {
  // Seen live 2026-10-13: mirrored 16:54:07, upstream published 16:58:45.
  // checkFreshness sets `behind` on any difference at all, and the first cut
  // warned on all of it - a warning that fires on a four-minute lag is one
  // nobody reads by week 10.
  const m = statusModel({ ...healthy(), usageFresh: { behind: true, hours: 0 } });
  assert.strictEqual(m.level, "ok");
  assert.match(m.rows.find((r) => r.key === "usage").text, /Current/);
});

t("hours behind warns, in hours", () => {
  const m = statusModel({ ...healthy(), usageFresh: { behind: true, hours: 5 } });
  assert.strictEqual(m.level, "warn");
  assert.match(m.rows.find((r) => r.key === "usage").text, /5 hours behind/);
});

t("days behind warns in days, and says what to do", () => {
  const m = statusModel({ ...healthy(), usageFresh: { behind: true, hours: 50 } });
  assert.strictEqual(m.level, "warn");
  const t2 = m.rows.find((r) => r.key === "usage").text;
  assert.match(t2, /2 days behind/);
  assert.match(t2, /refresh the mirror/);
});

t("not behind at all says nothing about staleness", () => {
  const m = statusModel({ ...healthy(), usageFresh: { behind: false } });
  assert.strictEqual(m.level, "ok");
  assert.ok(!/behind|Current/.test(m.rows.find((r) => r.key === "usage").text));
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

// ===========================================================================
// THE SNAP-COUNTS ROW.
//
// snap_counts is its own nflverse release with its own publishing schedule, so
// a fresh overall stamp can sit over a mirror whose snap half never arrived.
// This row is the ONLY place on the site that distinguishes a missing column
// from a measured zero, and it went missing entirely in the phase 1 footer
// split before a phase 4 audit found it. Restored - and then shipped with no
// assertions, which let three mutations through including inverting the claim
// to "Those players took zero snaps", the exact opposite of what it exists to
// say. Pinned here.
// ===========================================================================
const snapsOut = () => ({
  ...healthy(),
  usage: { ok: true, throughWeek: 8, generatedAt: "2026-10-27T00:00:00Z",
    sources: { stats_player: { ok: true }, snap_counts: { ok: false } } },
});

t("A MIRROR WHOSE SNAP HALF NEVER PUBLISHED SAYS SO", () => {
  const m = statusModel(snapsOut());
  const row = m.rows.find((r) => r.key === "snaps");
  assert.ok(row, "the snap-counts outage produced no row at all");
  assert.strictEqual(row.level, "warn");
});

t("...AND SAYS IT IS MISSING DATA, NOT ZERO SNAPS", () => {
  const row = statusModel(snapsOut()).rows.find((r) => r.key === "snaps");
  assert.match(row.text, /missing data, not zero snaps/i,
    "this sentence is the whole reason the row exists");
  assert.ok(!/took zero snaps|are zero/i.test(row.text),
    "inverted to the opposite claim");
});

t("...and the summary names it rather than blaming the mirror generally", () => {
  const m = statusModel(snapsOut());
  assert.match(m.summary, /snap counts/i, m.summary);
});

t("a mirror with both halves published raises no snap row", () => {
  const ok = statusModel({ ...healthy(),
    usage: { ok: true, throughWeek: 8, generatedAt: "2026-10-27T00:00:00Z",
      sources: { stats_player: { ok: true }, snap_counts: { ok: true, rows: 9981 } } } });
  assert.ok(!ok.rows.some((r) => r.key === "snaps"));
  assert.strictEqual(ok.level, "ok");
});

t("an older mirror with no per-source block is not reported as a snap outage", () => {
  // `sources` is absent on a mirror built before the field existed. Absent is
  // not the same claim as published-and-failed.
  const m = statusModel(healthy());
  assert.ok(!m.rows.some((r) => r.key === "snaps"));
});

t("a snap outage cannot fire alongside 'no usage layer at all'", () => {
  const m = statusModel({ ...healthy(), usage: { ok: false } });
  assert.ok(m.rows.some((r) => r.key === "usage"));
  assert.ok(!m.rows.some((r) => r.key === "snaps"),
    "a mirror that did not load has no half to report on");
});

console.log(`v2 status: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

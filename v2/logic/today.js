// THE CROSS-LEAGUE ACTION LIST.
//
// The one rule this file exists to enforce: THERE IS NO CROSS-LEAGUE POINTS
// SCALE, and nothing here invents one.
//
// The obvious design is a single list ranked by "points at stake". There is no
// such field, and the things that would have to go in it are not the same kind
// of number: a lineup swap delta is projected, this week, and real; a waiver
// gap is projected, this week, and contingent on winning a claim; a riser is
// worth zero points by construction (ui.js:426-427 - he projects low, which is
// exactly why he is free); a vacancy claim is speculative and next week; a
// lockout cost is already sunk. Coercing those into one number is a modelling
// decision dressed as a layout, and this codebase refuses that move elsewhere
// in so many words: "No bid figure here, deliberately - a number we modelled
// would look like a number we measured" (ui.js:433-435).
//
// So: items are grouped into URGENCY CLASSES, then by league, and ranked ONLY
// within a league inside a class - where every number being compared is the
// same kind of number. Leagues are never ranked against each other; they come
// out in config order.

import { pairCalls } from "./calls.js";
import { signalRows } from "./signals.js";
import { defVerdict, DEF_ACTIONABLE_KINDS } from "./defence.js";
import { wireTally } from "./wire.js";

// ---------------------------------------------------------------------------
// WHEN A DECISION STOPS BEING AVAILABLE.
//
// Two hours. A lineup change has a hard deadline - kickoff - and after it
// Sleeper simply refuses, which is why `locked` exists at all. Two hours is
// long enough to still be useful on a Sunday morning and short enough that the
// class does not swell to contain every call in the week by Thursday.
// ---------------------------------------------------------------------------
export const LOCK_SOON_MS = 2 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// WHICH DAY CLAIMS PROCESS.
//
// Sleeper's `waiver_day_of_week` numbering is NOT generally resolved. Value 2
// is MEASURED as Wednesday, from Chris's own transaction history rather than
// from a published mapping: completed waiver transactions across weeks 2-5 in
// all three leagues (all set to 2) land at Wednesday 03:00 America/New_York -
// 33, 26 and 21 of them, against scattered singles on other days that are
// post-clear free-agent adds. Checked 2026-10-13 via
// api.sleeper.com/v1/league/<id>/transactions/<week>, reading `status_updated`
// on `type: "waiver", status: "complete"`.
//
// Nothing else is evidenced, so nothing else is claimed: an unmapped value
// yields null and the class is labelled for what is certain ("On the wire")
// rather than asserting a day it cannot prove. To settle another value, run
// the same query on a league that uses it.
//
// JS getDay(): 0 Sun .. 6 Sat.
// ---------------------------------------------------------------------------
export const WAIVER_DAY = { 2: 3 }; // sleeper value -> JS getDay()

export function waiverDay(league) {
  const v = league?.settings?.waiver_day_of_week;
  return WAIVER_DAY[v] ?? null;
}

/** Claims lead the page on the processing day AND the day before it, which is
 *  when the bid is actually placed. This is the rule the old day-plan already
 *  used - PLANS[2] and PLANS[3] in ui.js both put waivers at the top. */
export function claimsLead(leagues, day) {
  return leagues.some((L) => {
    const d = waiverDay(L.league);
    return d !== null && (day === d || day === (d + 6) % 7);
  });
}

const n = (v) => (typeof v === "number" ? v : null);

// ---------------------------------------------------------------------------
// Items, per league
// ---------------------------------------------------------------------------

/** The soonest kickoff among the players a call depends on, ignoring anyone
 *  already locked - a locked player's deadline has passed and the engine has
 *  already solved around him. Null when nothing in the call has a known time. */
export function callDeadline(pair) {
  const times = [pair.in, pair.out]
    .filter((p) => p && !p.locked && typeof p.game?.kickoffUTC === "number")
    .map((p) => p.game.kickoffUTC);
  return times.length ? Math.min(...times) : null;
}

function lineupItems(L) {
  if (!L?.calls?.actionable) return [];
  return pairCalls(L.calls).map((pair) => ({
    kind: "call",
    forced: pair.forced,
    delta: pair.delta,
    in: pair.in,
    out: pair.out,
    deadline: callDeadline(pair),
    // Forced first, then by size - SIGNED, not absolute. pairCalls pairs a
    // descending `entering` against an ascending `leaving` by index, so a
    // net-positive set diff can still throw off a negative pair; ranking by
    // magnitude put a -8 pairing above a +7 one. Both numbers are projected
    // points for THIS week in THIS league, comparable to each other and to
    // nothing else.
    sort: [pair.forced ? 0 : 1, -(pair.delta ?? 0)],
  }));
}

function claimItems(L) {
  const w = L?.waivers;
  if (!w?.any) return [];
  const items = (w.upgrades || []).map((p) => ({
    kind: "claim",
    player: p,
    gap: n(p.gap),
    slot: p.slot,
    over: p.over || null,
    sort: [0, -(n(p.gap) ?? 0)],
  }));
  // The standing defence seat, but only when it is reporting work. A row that
  // says "yours is fine" is information and belongs in watch, not here -
  // `counts` is the one field that decides, exactly as wireTally reads it.
  const d = defVerdict(w.def);
  if (d && DEF_ACTIONABLE_KINDS.has(d.kind) && w.def.counts) {
    items.push({ kind: "def", verdict: d, gap: n(d.gap), sort: [1, -(n(d.gap) ?? 0)] });
  }
  return items;
}

// Ids already named by an actionable class in this league. A player the page
// has just told you to sit must not reappear one screen down under a heading
// that says "Nothing to do" - and he does, systematically: signals.js fires a
// high-severity `absent` flag for a projected player who missed the last
// completed week, which is frequently the very player the forced call is about.
function actionableIds(L) {
  const ids = new Set();
  const add = (p) => p?.id && ids.add(String(p.id));
  for (const pair of L?.calls?.actionable ? pairCalls(L.calls) : []) { add(pair.in); add(pair.out); }
  for (const u of L?.waivers?.upgrades || []) { add(u); add(u.over); }
  return ids;
}

function watchItems(L, { exclude = new Set() } = {}) {
  const out = [];
  const sig = signalRows(L?.optimal, L?.roster);
  let dropped = sig.rest;
  for (const { p, f } of sig.shown) {
    if (exclude.has(String(p.id))) continue;
    out.push({ kind: "signal", player: p, flag: f, sort: [0, 0] });
  }
  const v = L?.vacancies;
  if (v?.any) {
    for (const row of v.vacancies || []) out.push({ kind: "vacancy", row, sort: [1, 0] });
    for (const row of v.promotions || []) out.push({ kind: "promotion", row, sort: [2, 0] });
  }
  for (const r of L?.waivers?.risers || []) {
    if (exclude.has(String(r.id))) continue;
    out.push({ kind: "riser", player: r, sort: [3, 0] });
  }
  // A defence seat that was checked and is fine is worth one quiet line - the
  // whole reason that row is ungated is that "nothing to do" is a result.
  const d = defVerdict(L?.waivers?.def);
  if (d && !(DEF_ACTIONABLE_KINDS.has(d.kind) && L.waivers.def.counts)) {
    out.push({ kind: "def-quiet", verdict: d, sort: [4, 0] });
  }
  // signalRows caps at SIGNALS_MAX and reports the remainder. Those were never
  // items here, so they have to be carried separately or the "N more" link
  // understates by exactly the signals the cap dropped.
  out.droppedSignals = dropped;
  return out;
}

const bySort = (a, b) =>
  (a.sort[0] - b.sort[0]) || (a.sort[1] - b.sort[1]);

// ---------------------------------------------------------------------------
// HOW MANY WATCH ITEMS BEFORE THE PAGE STOPS BEING A SUMMARY.
//
// Measured on the hostile fixture: uncapped, "Worth knowing" came out at 23
// rows across three leagues - longer than every actionable class combined,
// on a page whose entire job is to say what needs doing. That inverts it.
//
// This is the same rule the signals block already keeps for the same reason:
// "a block that lists a third of the roster is the roster table again with
// worse copy" (ui.js:502-504), capped there at 5 with the remainder counted.
// Four here, because this page carries three leagues rather than one, and the
// remainder is counted and linked rather than dropped.
// ---------------------------------------------------------------------------
export const WATCH_PER_LEAGUE = 4;

// Classes where everything is shown. Corrections and claims are already
// bounded by the engine - upgrades are capped at 4 in waivers.js, and a
// lineup has as many corrections as it has, all of them worth doing.
const UNCAPPED = new Set(["locking", "lineup", "claims"]);

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export function todayModel(state, { now = Date.now(), day = new Date().getDay() } = {}) {
  const order = (state?.cfg?.leagues || []).map((e) => e.key);
  const leagues = order.map((k) => state.leagues?.[k]).filter(Boolean);

  const buckets = { locking: [], lineup: [], claims: [], watch: [] };

  for (const L of leagues) {
    const key = L.entry.key, name = L.entry.name;
    const push = (bucket, items, extraHidden = 0) => {
      if (!items.length) return;
      const sorted = items.sort(bySort);
      const cap = UNCAPPED.has(bucket) ? sorted.length : WATCH_PER_LEAGUE;
      const shown = sorted.slice(0, cap);
      const hidden = sorted.slice(cap);
      buckets[bucket].push({
        key, name,
        items: shown,
        // The kinds behind the fold decide where "N more" points. Using the
        // FIRST VISIBLE item's kind sent a card of mostly-wire content to the
        // lineup page.
        hiddenKinds: [...new Set(hidden.map((i) => i.kind))],
        kinds: [...new Set(sorted.map((i) => i.kind))],
        more: hidden.length + extraHidden,
        total: sorted.length + extraHidden,
      });
    };

    // A correction is promoted out of "lineup" and into "locking soon" when
    // the game it depends on starts inside the window. It is the SAME item -
    // promotion by deadline, not a second source - so nothing is listed twice.
    const calls = lineupItems(L);
    const soon = [], later = [];
    for (const c of calls) {
      const urgent = c.deadline !== null && c.deadline - now <= LOCK_SOON_MS && c.deadline > now;
      (urgent ? soon : later).push(c);
    }
    push("locking", soon);
    push("lineup", later);
    push("claims", claimItems(L));
    const watch = watchItems(L, { exclude: actionableIds(L) });
    push("watch", watch, watch.droppedSignals || 0);
  }

  const lead = claimsLead(leagues, day);
  const order4 = lead
    ? ["locking", "claims", "lineup", "watch"]
    : ["locking", "lineup", "claims", "watch"];

  const claimsLabel = lead ? "Claims process today" : "On the wire";
  const META = {
    // Narrowed deliberately: promotion into this class only ever moves LINEUP
    // corrections, so the copy must not promise a property it does not apply
    // to claims. Extending promotion to claims is a real option and is in the
    // handoff, not silently assumed here.
    locking: ["Locking soon", "Lineup changes that stop being possible when the game starts."],
    lineup: ["Lineup corrections", "Worth points, and no deadline before Sunday."],
    // The second sentence is the page's own design, stated on every day rather
    // than only on claims days - five days a week it was dropping the line
    // that explains why nothing here is ranked against anything above it.
    claims: [claimsLabel,
      `${lead ? "Bids are due before processing." : "Claimable any day."} Upgrades first, ranked within a league by projection gap, then the standing defence seat. Nothing here is ranked against the lineup calls - a claim you might not win is not the same number as a swap you control.`],
    watch: ["Worth knowing", "Nothing to do. Read it or do not."],
  };

  const classes = order4.map((k) => {
    const [label, sub] = META[k];
    return {
      key: k, label, sub,
      leagues: buckets[k],
      // The count is what EXISTS, not what fits. A header reading 8 over four
      // visible rows and a "4 more" link is honest; one reading 4 is not.
      count: buckets[k].reduce((t, g) => t + g.total, 0),
      shown: buckets[k].reduce((t, g) => t + g.items.length, 0),
    };
  }).filter((c) => c.count > 0);

  return {
    classes,
    quiet: classes.length === 0,
    // Per-league tallies for the "all quiet" copy, so an empty page can still
    // say what it checked rather than just being blank.
    checked: leagues.map((L) => ({
      key: L.entry.key, name: L.entry.name,
      wire: wireTally(L.waivers),
      faabLeft: L.faabLeft,
    })),
    claimsLead: lead,
  };
}

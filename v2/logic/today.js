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
// Sleeper's `waiver_day_of_week` numbering is NOT generally resolved - checked
// 2026-10-13. Value 2 is measured as Wednesday, and all three of Chris's
// leagues are 2, which agrees with the hub's own existing copy ("Wednesday -
// claims process today"). Nothing else is evidenced, so nothing else is
// claimed: an unmapped value yields null and the class is labelled for what is
// certain ("On the wire") rather than asserting a day it cannot prove.
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
    // Forced first, then by size. Both are projected points for THIS week in
    // THIS league, so they are comparable to each other and to nothing else.
    sort: [pair.forced ? 0 : 1, -Math.abs(pair.delta ?? 0)],
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

function watchItems(L) {
  const out = [];
  for (const { p, f } of signalRows(L?.optimal, L?.roster).shown) {
    out.push({ kind: "signal", player: p, flag: f, sort: [0, 0] });
  }
  const v = L?.vacancies;
  if (v?.any) {
    for (const row of v.vacancies || []) out.push({ kind: "vacancy", row, sort: [1, 0] });
    for (const row of v.promotions || []) out.push({ kind: "promotion", row, sort: [2, 0] });
  }
  for (const r of L?.waivers?.risers || []) out.push({ kind: "riser", player: r, sort: [3, 0] });
  // A defence seat that was checked and is fine is worth one quiet line - the
  // whole reason that row is ungated is that "nothing to do" is a result.
  const d = defVerdict(L?.waivers?.def);
  if (d && !(DEF_ACTIONABLE_KINDS.has(d.kind) && L.waivers.def.counts)) {
    out.push({ kind: "def-quiet", verdict: d, sort: [4, 0] });
  }
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
    const push = (bucket, items) => {
      if (!items.length) return;
      const sorted = items.sort(bySort);
      const cap = UNCAPPED.has(bucket) ? sorted.length : WATCH_PER_LEAGUE;
      buckets[bucket].push({
        key, name,
        items: sorted.slice(0, cap),
        more: Math.max(0, sorted.length - cap),
        total: sorted.length,
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
    push("watch", watchItems(L));
  }

  const lead = claimsLead(leagues, day);
  const order4 = lead
    ? ["locking", "claims", "lineup", "watch"]
    : ["locking", "lineup", "claims", "watch"];

  const claimsLabel = lead ? "Claims process today" : "On the wire";
  const META = {
    locking: ["Locking soon", "These stop being possible when the game starts."],
    lineup: ["Lineup corrections", "Worth points, and no deadline before Sunday."],
    claims: [claimsLabel, lead
      ? "Bids are due before processing. Nothing here is ranked against the lineup calls above - a claim you might not win is not the same number as a swap you control."
      : "Claimable any day. Ranked within a league by projection gap."],
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

// waivers.js - who to claim, and why. Never how much to bid.
//
// THE DELIBERATE OMISSION
//
// Nothing in the free data stack supports a FAAB dollar figure. Trending-add
// counts and market values give ordering and urgency; a bid number would be
// our modelling wearing the costume of a measurement, and the one thing this
// tool is not allowed to do is present an invention as a reading. The old
// product's mock showed "bid $14" and that mock has been annotated as
// superseded so a future session cannot rebuild it by accident.
//
// EXCEPTION-BASED, LIKE EVERY OTHER BLOCK
//
// A free-agent list is not a waiver recommendation - Sleeper already shows a
// free-agent list, and better. This module answers two questions and stays
// silent when neither has an answer:
//
//   UPGRADES - is anyone free right now better THIS WEEK than somebody you are
//   currently starting, at a slot he could actually fill? That is a claim that
//   changes your lineup, measured against the same threshold the lineup solver
//   uses, so it cannot contradict it.
//
//   RISERS - is anyone free trending sharply upward in the usage that persists
//   (snaps, opportunities), regardless of this week's projection? That is the
//   claim you make BEFORE the projection catches up, and it is the only kind
//   of waiver move that ever wins a league.
//
// Pure: no fetch, no DOM, no clock.

import { canFill } from "./lineup.js";
import { threshold } from "./value.js";

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// KICKERS AND DEFENSES ARE NEVER RECOMMENDED OFF THE WIRE.
//
// Caught by rendering: the first version filled the whole block with four
// kickers, each "worth +6.0", and buried everything that mattered. Two
// independent reasons, either of which is sufficient:
//
//   * this app marks kicker totals as FLOORS, because the projection feed
//     carries no yardage-bonus field. Driving a roster move off a number the
//     page itself labels as incomplete is exactly the kind of confident
//     wrongness the rest of this codebase is built to avoid.
//   * market.js already excludes both positions from its disagreement list as
//     "streaming slots whose week-to-week ranking is close to noise". The same
//     fact makes a six-point projection gap between two kickers meaningless.
//
// Streaming a defense is a real move, but it is a matchup call, and this app
// has no matchup layer yet. When it has one, this is where that lands.
const NOT_WORTH_CLAIMING = new Set(["K", "DEF"]);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

// Everyone the projections priced who is not on any roster in this league,
// is not ruled out, and plays a position this league actually starts.
export function freeAgents(priced, rostered, slots) {
  const startable = new Set(slots.flatMap((s) => POSITIONS_FOR(s)));
  const out = [];
  for (const p of priced.values()) {
    if (rostered.has(p.id)) continue;
    if (p.startable === false) continue;
    if (typeof p.pts !== "number") continue;
    if (!startable.has(p.pos)) continue;
    if (NOT_WORTH_CLAIMING.has(p.pos)) continue;
    out.push(p);
  }
  return out;
}

// Which positions a slot can take. Derived from lineup.js's own eligibility so
// the two can never drift apart.
const ALL_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const POSITIONS_FOR = (slot) => ALL_POS.filter((pos) => canFill(slot, pos));

// Free agents who would actually change your lineup this week.
//
// The comparison is against the WEAKEST starter a given free agent could
// replace - not against your bench, and not against the roster average. And
// the gap has to clear the same measured half-sigma the start/sit calls use,
// so a claim this block recommends is a claim the lineup block would then act
// on. Two surfaces, one arithmetic.
export function upgrades(free, { starters = [], byId, slots, sigma }, limit = 4) {
  // AN UNRESOLVED STARTER IS NOT AN EMPTY SEAT.
  //
  // Sleeper writes "0" (or nothing) into a slot you have genuinely left empty,
  // and that seat really is worth zero points - anyone beats it. But a slot
  // holding a real player id we could not resolve means we lack data about
  // him, which is a different thing entirely. Treating it as zero would
  // recommend claiming someone "over" a starter we simply failed to look up -
  // the same missing-is-not-zero mistake that has now been caught in vor(),
  // in verdict(), and in the rest-of-season sum.
  const seated = slots.map((slot, i) => {
    const raw = starters[i];
    const empty = !raw || String(raw) === "0";
    const p = empty ? null : byId.get(String(raw));
    return { slot, p, empty, unresolved: !empty && !p };
  });
  const out = [];

  for (const fa of free) {
    let best = null;
    for (const { slot, p, empty, unresolved } of seated) {
      if (!canFill(slot, fa.pos)) continue;
      if (unresolved) continue;              // we don't know, so we don't claim
      // A locked player cannot be replaced this week, so a "claim him" line
      // pointing at that seat would be an instruction Sleeper refuses.
      if (p?.locked) continue;
      const cur = empty ? 0 : n(p?.pts);
      if (cur === null) continue;            // rostered but unprojected: unknown, not zero
      const gap = fa.pts - cur;
      const gate = threshold(sigma || {}, fa.pos, p?.pos);
      if (gap < gate) continue;
      if (!best || gap > best.gap) best = { slot, over: p || null, gap, gate };
    }
    if (best) out.push({ ...fa, ...best });
  }

  // ONE CLAIM PER SEAT.
  //
  // Rendering the first version produced four near-identical tight ends, all
  // "over Dead HeatA in your TE", separated by 0.3 points each. That is a
  // ranked free-agent list wearing a recommendation's clothes - precisely what
  // this block exists NOT to be, since Sleeper already has one and it is
  // better. A seat can only be filled once, so it gets one answer: the best
  // player available for it.
  const bySeat = new Map();
  for (const cand of out.sort((a, b) => b.gap - a.gap)) {
    const seat = `${cand.slot}:${cand.over?.id ?? "empty"}`;
    if (!bySeat.has(seat)) bySeat.set(seat, cand);
  }
  return [...bySeat.values()].slice(0, limit);
}

// Free agents whose USAGE is climbing, whether or not the projection has
// noticed yet.
//
// Requires a genuine recent window: a player with one game has no trend, and
// reporting one would be reading noise out loud. `minGames` is the whole
// season sample and `minRecent` the recent one - early in a season both gates
// keep this list empty, which is the correct output, not a failure.
export function risers(free, { trending = new Map(), throughWeek = null } = {},
                       { minGames = 3, staleAfter = 2, limit = 4 } = {}) {
  const out = [];
  for (const fa of free) {
    const u = fa.usage;
    if (!u || u.games < minGames) continue;

    // A QUARTERBACK HAS NO OPPORTUNITY NUMBER WORTH READING.
    // compare.js already returns null for QBs on both touch metrics; this had
    // no matching guard, so a rushing quarterback could surface as an
    // "opportunity riser" in superflex off a handful of scrambles.
    if (fa.pos === "QB") continue;

    // "HIS LAST THREE GAMES" HAS TO MEAN RECENTLY.
    //
    // The window is the last three ROWS, and nothing anchored it to the
    // calendar. A player who ramped up through week 5 and has not played
    // since was still reported in week 11 as "snap share up 36% over his last
    // three games" - a recommendation to claim someone six weeks absent, who
    // is free for exactly that reason. Two missed weeks and he is not a riser,
    // he is a story about the past.
    const last = u.weeks?.[u.weeks.length - 1]?.wk ?? null;
    if (throughWeek !== null && last !== null && throughWeek - last > staleAfter) continue;

    const snapJump = delta(u.snapPctRecent, u.snapPct);
    const oppJump  = delta(u.oppPerGameRecent, u.oppPerGame);
    // Both gates are proportional, not absolute: going from 20% to 30% of
    // snaps is the same story as 50% to 75%, and an absolute threshold would
    // only ever surface players who are already starters somewhere.
    const snapUp = snapJump !== null && snapJump >= 0.25 && (u.snapPctRecent ?? 0) >= 0.35;
    const oppUp  = oppJump  !== null && oppJump  >= 0.30 && (u.oppPerGameRecent ?? 0) >= 6;

    // THE INTENT GATE, AND WHY IT IS A GATE RATHER THAN A FOOTNOTE.
    //
    // Snaps and touches are what a player HAS BEEN GIVEN. Air-yards share is
    // what the offence is TRYING to give him, and it moves first: a receiver
    // running deeper routes on more of his team's throws is being featured
    // before a single one of them is caught. Attaching that to rows which had
    // already qualified on snaps would waste it - by then the box score has
    // said the same thing out loud and the league has read it.
    //
    // WOPR rides along because it is the weighted combination of target share
    // and air-yards share, so it catches the receiver whose usage grew on both
    // counts without either moving far enough alone.
    //
    // THE FLOORS ARE FLOORS, NOT CALIBRATION. 15% of a team's air yards is
    // roughly the point below which a receiver is a decoy, and 0.35 WOPR is
    // roughly a genuine second option. Neither is backtested, and neither
    // should be described as though it were - they exist to stop a proportional
    // jump off nothing from reading as a breakout, the same job the 0.35 snap
    // floor and the 6-touch floor already do above.
    const ayJump   = delta(u.ayShareRecent, u.ayShare);
    const woprJump = delta(u.woprRecent, u.wopr);
    const airUp  = ayJump   !== null && ayJump   >= 0.30 && (u.ayShareRecent ?? 0) >= 0.15;
    const woprUp = woprJump !== null && woprJump >= 0.30 && (u.woprRecent  ?? 0) >= 0.35;

    if (!snapUp && !oppUp && !airUp && !woprUp) continue;

    out.push({
      ...fa,
      snapJump: snapJump === null ? null : Math.round(snapJump * 100),
      oppJump:  oppJump  === null ? null : Math.round(oppJump * 100),
      // Only reported when the gate actually fired. A jump that did not clear
      // its floor is a number, not a finding, and printing it would let a
      // decoy's tripled-from-nothing air-yards share sit on the row looking
      // like the reason he is listed.
      ayJump:   airUp  ? Math.round(ayJump * 100) : null,
      woprJump: woprUp ? Math.round(woprJump * 100) : null,
      adds: trending.get(fa.id) ?? null,
      score: Math.max(
        snapUp ? snapJump : 0, oppUp ? oppJump : 0,
        airUp ? ayJump : 0, woprUp ? woprJump : 0,
      ),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

const delta = (recent, season) => {
  const r = n(recent), s = n(season);
  if (r === null || s === null || s <= 0) return null;
  return Math.round(((r - s) / s) * 1000) / 1000;
};

// The whole block, ready to render. `any` is what the UI gates on - this
// surface is silent unless one of the two questions has an answer.
export function waiverBoard(L, { trending = new Map(), throughWeek = null } = {}) {
  if (!L?.priced || !L?.rostered) return { any: false, upgrades: [], risers: [] };
  const free = freeAgents(L.priced, L.rostered, L.slots);
  const up = upgrades(free, L, 4);
  const ri = risers(free, { trending, throughWeek })
    .filter((p) => !up.some((u) => u.id === p.id));
  return {
    any: up.length > 0 || ri.length > 0,
    upgrades: up.map((p) => ({ ...p, gap: r1(p.gap), gate: r1(p.gate) })),
    risers: ri,
    freeCount: free.length,
  };
}

export { POSITIONS_FOR, delta };

// lineup.js - who should be starting, and what to change.

const ELIGIBLE = {
  QB:         ["QB"],
  RB:         ["RB"],
  WR:         ["WR"],
  TE:         ["TE"],
  K:          ["K"],
  DEF:        ["DEF"],
  FLEX:       ["RB", "WR", "TE"],
  REC_FLEX:   ["WR", "TE"],
  WRRB_FLEX:  ["RB", "WR"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

export const startingSlots = (rosterPositions) =>
  rosterPositions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");

const canFill = (slot, pos) => (ELIGIBLE[slot] || [slot]).includes(pos);

// Best legal lineup - EXACT, not greedy.
//
// The naive approach (fill each slot with the best player who fits) is
// wrong: seating a running back in FLEX can strand a better one who had
// nowhere else to go. This is a maximum-weight bipartite matching between
// players and slots, and because slot-eligibility forms a transversal
// matroid, processing players in descending points order and seating each
// via an augmenting path is PROVABLY optimal - no local search, no guard
// counter, no "converges in practice".
//
// An augmenting path lets an already-seated player shuffle to another
// legal empty slot to make room, which is exactly the case greedy misses.
// KICKOFF LOCKING lives in the third argument, and it is opt-in.
//
//   optimalLineup(slots, roster)          -> locks respected, nothing pinned
//   optimalLineup(slots, roster, frozen)  -> locks respected, frozen pinned
//   optimalLineup(slots, roster, null)    -> locks IGNORED (the counterfactual)
//
// The default respects locks on purpose. An earlier version made ignoring
// them the shorter call, which meant a caller who forgot the argument got an
// unenforceable lineup with no signal. Now forgetting is safe and the unsafe
// case has to be asked for by name.
//
// `frozen` is a Map of slot index -> the locked player already sitting there.
// Two separate solves is not waste: the difference between them is precisely
// the set of calls that were real but arrived too late, which is what
// missedCalls() reports and what the decision log wants to remember.
//
// Sleeper will refuse to move a player whose game has started, in either
// direction, so both directions are constrained here:
//   - a locked player already starting is pinned to his slot (frozen)
//   - a locked player on the bench is removed from the pool
export function optimalLineup(slots, players, frozen = new Map()) {
  const respectLocks = frozen != null;
  const pinned = new Set(
    respectLocks ? [...frozen.values()].filter(Boolean).map((p) => p.id) : []
  );

  // startable === false means ruled out, not merely projected low. Those
  // players are removed from the pool entirely rather than ranked last, so
  // no projection total can ever seat them.
  const pool = players
    .filter((p) => typeof p.pts === "number" && p.startable !== false)
    .filter((p) => !respectLocks || (!p.locked && !pinned.has(p.id)))
    .sort((a, b) => b.pts - a.pts);

  const seatOf = new Array(slots.length).fill(null); // slot index -> player
  const isFrozen = new Array(slots.length).fill(false);
  if (respectLocks) {
    for (const [i, p] of frozen) {
      if (i >= 0 && i < slots.length && p) { seatOf[i] = p; isFrozen[i] = true; }
    }
  }

  const seat = (player, visited) => {
    for (let i = 0; i < slots.length; i++) {
      if (isFrozen[i] || visited.has(i) || !canFill(slots[i], player.pos)) continue;
      visited.add(i);
      if (seatOf[i] === null || seat(seatOf[i], visited)) {
        seatOf[i] = player;
        return true;
      }
    }
    return false;
  };

  for (const player of pool) seat(player, new Set());

  return slots.map((slot, i) => ({ slot, player: seatOf[i] }));
}

// What to change, as a SET DIFFERENCE - who enters and who leaves.
//
// Never report per-slot swaps. One genuine change cascades through FLEX and
// SUPER_FLEX and renders as four instructions, three of which are
// bookkeeping. Chris reads "start X, sit Y" and nothing else.
export function decisions(currentStarterIds, optimal, byId, thresholdArg = 1.0) {
  const want = new Set(optimal.map((s) => s.player?.id).filter(Boolean));
  const have = new Set(currentStarterIds.filter((id) => id && id !== "0"));

  const entering = [...want].filter((id) => !have.has(id)).map((id) => byId.get(id)).filter(Boolean);
  const leaving  = [...have].filter((id) => !want.has(id)).map((id) => byId.get(id)).filter(Boolean);

  const gain =
    entering.reduce((s, p) => s + (p.pts || 0), 0) -
    leaving.reduce((s, p) => s + (p.pts || 0), 0);

  entering.sort((a, b) => (b.pts || 0) - (a.pts || 0));
  // Ruled-out players lead the list regardless of projection: they are the
  // urgent item, and pairing them first puts the best replacement opposite
  // the player who is definitely scoring zero.
  leaving.sort((a, b) => {
    const fa = a.startable === false ? 0 : 1, fb = b.startable === false ? 0 : 1;
    return fa !== fb ? fa - fb : (a.pts || 0) - (b.pts || 0);
  });

  // The threshold is per-position when a sigma table is supplied: the
  // noisier of the positions involved governs, because the question this
  // threshold answers is "could this gap be noise?" and the noisier player
  // is the one who decides that. A bare number still works, for tests and
  // for the case where variance has not been measured yet.
  const positions = [...new Set([...entering, ...leaving].map((p) => p.pos).filter(Boolean))];
  const threshold =
    typeof thresholdArg === "function" ? thresholdArg(positions)
    : typeof thresholdArg === "number" ? thresholdArg
    : 1.0;

  // A player who will not play is a HARD call: benching him is right even
  // though it lowers the projected total, because his real total is zero.
  // Hard calls bypass the threshold entirely - the threshold exists to
  // suppress noise between two players who might both actually play.
  const forced = leaving.filter((p) => p.startable === false);
  const actionable =
    forced.length > 0 || (gain >= threshold && entering.length > 0);

  return { entering, leaving, gain, forced, actionable, threshold };
}

// The calls that were real but arrived too late.
//
// `open` is the decision set with locks ignored; `actual` is the one we can
// still act on. A player who appears in `open`, is locked, and does not
// appear in `actual` is a change the tool would have told you to make if you
// had opened the page before his game started.
//
// This is deliberately NOT presented as an instruction - there is nothing to
// do about it. It is the raw material for the decision log: the point of
// recording it is that at the end of a season you can see what the lockouts
// actually cost, rather than assuming.
// A seated player who will not play is worth ZERO, not his projection.
//
// This is the same premise the rest of the module already runs on: the feed
// publishes a projection for a ruled-out player because that is what he would
// score IF he played, and he will not. Counting it here inverted the cost of
// the single most expensive kind of lockout - a ruled-out starter whose game
// has already begun. The constrained lineup pinned him and counted his
// phantom points, the unconstrained one dropped him and seated a real
// replacement, so the subtraction went NEGATIVE and Math.max(0, ...) reported
// the loss as costing nothing. Caught by the audit, not by the suite.
const lineupTotal = (seats) => seats.reduce(
  (s, x) => s + (x.player && x.player.startable !== false ? (x.player.pts || 0) : 0), 0);

export function missedCalls(open, actual, openLineup, actualLineup) {
  const blank = { entering: [], leaving: [], any: false, cost: 0 };
  if (!open?.actionable) return blank;

  const stillActionable = new Set(
    [...(actual?.entering || []), ...(actual?.leaving || [])].map((p) => p.id)
  );
  const entering = open.entering.filter((p) => p.locked && !stillActionable.has(p.id));
  const leaving  = open.leaving.filter((p) => p.locked && !stillActionable.has(p.id));

  // WHAT THE LOCKS COST, and nothing else.
  //
  // The first version of this reported open.gain - the whole unconstrained
  // decision's value - which on a real render read "the version without those
  // locks was worth about 47.5 more" when the locks themselves accounted for
  // a fraction of that. The rest was the forced injury call and other live
  // moves that are still perfectly available.
  //
  // The honest number is the difference between the two solved lineups: what
  // the best legal lineup would have scored with nothing locked, minus what
  // the best legal lineup scores now.
  const cost = (openLineup && actualLineup)
    ? Math.max(0, Math.round((lineupTotal(openLineup) - lineupTotal(actualLineup)) * 100) / 100)
    : 0;

  return { entering, leaving, any: entering.length > 0 || leaving.length > 0, cost };
}

export { ELIGIBLE, canFill };

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
export function optimalLineup(slots, players) {
  // startable === false means ruled out, not merely projected low. Those
  // players are removed from the pool entirely rather than ranked last, so
  // no projection total can ever seat them.
  const pool = players
    .filter((p) => typeof p.pts === "number" && p.startable !== false)
    .sort((a, b) => b.pts - a.pts);

  const seatOf = new Array(slots.length).fill(null); // slot index -> player

  const seat = (player, visited) => {
    for (let i = 0; i < slots.length; i++) {
      if (visited.has(i) || !canFill(slots[i], player.pos)) continue;
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

export { ELIGIBLE, canFill };

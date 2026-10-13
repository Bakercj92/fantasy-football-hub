// Bench derivation. Lived only inside benchTable() (ui.js:781-789): roster
// minus whoever is in a starting slot, sorted by projection descending, with
// a missing projection sorting last rather than as a zero.

/** Starter ids as strings, which is how Sleeper hands them over. */
export function starterIds(starters) {
  return new Set((starters || []).map(String));
}

export function benchOf(roster, starters) {
  const starting = starterIds(starters);
  return (roster || [])
    .filter((p) => !starting.has(p.id))
    .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
}

/** The lineup as [slot, player|undefined] pairs, in slot order.
 *  (ui.js:776) An unresolved id yields undefined and renders as an empty row -
 *  it must not be dropped, or the slots shift up. */
export function lineupPairs(slots, starters, byId) {
  return (slots || []).map((slot, i) => [slot, byId.get(String(starters[i]))]);
}

// THE SIGN CONVENTION, isolated.
//
// From ui.js:44-52: `spreadForTeam` is POSITIVE when the player's team is
// FAVOURED. Invert it in a rewrite and every Vegas sentence on the page lies
// confidently, with nothing to catch it - there was no unit test on this, and
// a reversed favourite reads perfectly well as English.

/**
 * @returns {{side:"favoured"|"underdog"|"pickem", by:number, total:number,
 *            implied:number, team:string}|null}
 */
export function vegasRead(p) {
  const v = p?.vegas;
  if (!v || typeof v.spread !== "number") return null;
  return {
    team: p.team,
    side: v.spread > 0 ? "favoured" : v.spread < 0 ? "underdog" : "pickem",
    by: Math.abs(v.spread),
    total: v.total,
    implied: v.implied,
  };
}

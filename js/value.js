// value.js - the part that makes this tool worth having.
//
// A projection says what a player scores. It does not say whether that is
// good, and "good" is entirely a function of league shape. 12 points from a
// running back is a fine week in a 14-team league where the best free RB
// projects 4, and a bench body in an 8-team league where the best free RB
// projects 11. Every mainstream tool ranks against a 12-team, 1QB baseline.
// Neither of Chris's leagues is that.
//
// So this file computes replacement level by MEASUREMENT, not by rule of
// thumb: it reads every roster in the league, works out who is actually
// free, and takes the best free player at each position. There is no
// constant to tune and no assumption to be wrong about - if the league
// changes shape, or eight managers stream defenses, the number moves.

// Who is rostered anywhere in this league.
export function rosteredIds(allRosters) {
  const ids = new Set();
  for (const r of allRosters) for (const p of r.players || []) ids.add(String(p));
  return ids;
}

// Replacement level per position: the best projected player nobody owns.
//
// `priced` is the whole projection universe already scored at this league's
// rules. Ruled-out players are skipped - a free player who will not play is
// not an available alternative to anything.
export function replacementLevels(priced, rostered) {
  const best = new Map();
  for (const p of priced.values()) {
    if (rostered.has(p.id)) continue;
    if (typeof p.pts !== "number") continue;
    if (p.startable === false) continue;
    const cur = best.get(p.pos);
    if (!cur || p.pts > cur.pts) best.set(p.pos, p);
  }
  const levels = {};
  for (const [pos, p] of best) levels[pos] = { pts: p.pts, name: p.name, id: p.id };
  return levels;
}

// Value over replacement, in this league, this week.
export const vor = (player, levels) =>
  typeof player?.pts === "number"
    ? Math.round((player.pts - (levels[player.pos]?.pts ?? 0)) * 100) / 100
    : null;

// How noisy is a position, measured live rather than assumed.
//
// The population is the starter-caliber pool: the top (teams x slots that
// this position can fill) projected players. Scoring the whole league's
// worth of fourth-string tight ends into the variance would make TE look
// wild when the part that matters is tight and flat.
export function positionSigma(priced, pos, poolSize) {
  const pts = [...priced.values()]
    .filter((p) => p.pos === pos && typeof p.pts === "number" && p.startable !== false)
    .map((p) => p.pts)
    .sort((a, b) => b - a)
    .slice(0, Math.max(2, poolSize));
  if (pts.length < 2) return null;
  const mean = pts.reduce((s, v) => s + v, 0) / pts.length;
  const varc = pts.reduce((s, v) => s + (v - mean) ** 2, 0) / (pts.length - 1);
  return Math.sqrt(varc);
}

// How many of a position start league-wide - the size of the pool that matters.
export function startingPool(slots, teams, pos) {
  const exact = slots.filter((s) => s === pos).length;
  const flex  = slots.filter((s) => s === "FLEX").length;
  const sflex = slots.filter((s) => s === "SUPER_FLEX").length;
  // Flex shares are how often each position actually wins a flex seat.
  // Deliberately coarse: the number only sizes a variance sample.
  const share = { RB: 0.45, WR: 0.45, TE: 0.10 }[pos] ?? 0;
  const sshare = { QB: 0.55, RB: 0.20, WR: 0.20, TE: 0.05 }[pos] ?? 0;
  return Math.round(teams * (exact + flex * share + sflex * sshare));
}

// The threshold below which a difference is not a decision.
//
// Half a sigma, floored at 1.0 and capped at 2.0. The floor exists because
// at quarterback half a sigma is under a point and the tool would nag about
// noise; the cap exists so a wild week at running back cannot silence a
// real call. Comparisons that span two positions take the LARGER threshold -
// not quadrature, because the question is "could this gap be noise", and the
// noisier of the two players governs that.
export const SIGMA_FLOOR = 1.0;
export const SIGMA_CAP = 2.0;

export function threshold(sigmaByPos, ...positions) {
  const vals = positions
    .filter(Boolean)
    .map((p) => sigmaByPos[p])
    .filter((s) => typeof s === "number")
    .map((s) => Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, 0.5 * s)));
  return vals.length ? Math.max(...vals) : SIGMA_FLOOR;
}

export function sigmaTable(priced, slots, teams) {
  const out = {};
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
    const s = positionSigma(priced, pos, startingPool(slots, teams, pos) || teams);
    if (s !== null) out[pos] = Math.round(s * 100) / 100;
  }
  return out;
}

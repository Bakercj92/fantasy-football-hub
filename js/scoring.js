// scoring.js - turn a projection into THIS league's points.
//
// Why this exists at all: the feed ships pts_ppr, and pts_ppr is wrong for
// both of Chris's leagues. It pays 6 for a passing touchdown where both
// leagues pay 4. Never display a vendor's fantasy total.
//
// The mechanism is deliberately dumb, and that is the point: Sleeper's
// scoring_settings keys and its projection stats keys are the SAME
// vocabulary (rec, rush_yd, pass_td, fum_lost...). So scoring a player is
// the dot product of the two objects over their shared keys. No mapping
// table to drift, no per-league branch, and a league that changes its
// scoring mid-season is handled by the next page load.

// Stat keys that are metadata, not production. They must never be scored
// even if a league happens to define a key with the same name.
const NOT_PRODUCTION = new Set([
  "gp", "adp_dd_ppr", "pos_adp_dd_ppr", "pts_ppr", "pts_half_ppr", "pts_std",
]);

export function rescore(stats, scoringSettings) {
  if (!stats || !scoringSettings) return null;
  let pts = 0;
  const contributions = [];
  for (const key of Object.keys(scoringSettings)) {
    if (NOT_PRODUCTION.has(key)) continue;
    const projected = stats[key];
    if (typeof projected !== "number") continue;
    const weight = scoringSettings[key];
    if (typeof weight !== "number" || weight === 0) continue;
    const points = projected * weight;
    if (points === 0) continue;
    pts += points;
    contributions.push({ key, projected, weight, points });
  }
  contributions.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { pts, contributions };
}

// Kickers are approximate and the page must say so.
//
// Joop pays 3.0 per field goal plus 0.1 per yard over 30. The projection
// feed carries no fgm_yds_over_30 field, so the yardage bonus cannot be
// computed - only the flat part can. The result is a FLOOR, not an
// estimate, and a floor presented as an estimate is a lie by omission.
export function isFloorOnly(pos, scoringSettings) {
  if (pos !== "K") return false;
  return Object.keys(scoringSettings).some((k) => /^fgm_\d/.test(k) || k === "fgmiss");
}

// Format-correct replacement level. THIS is the edge - see Phase 2.
// Stubbed at league-size-aware baselines for the skeleton so the shape is
// right; the measured version replaces the constants, not the callers.
export function replacementRank(pos, teams, rosterPositions) {
  const starters = rosterPositions.filter((s) => s !== "BN" && s !== "IR");
  const count = (p) => starters.filter((s) => s === p).length;
  const flex  = starters.filter((s) => s === "FLEX").length;
  const sflex = starters.filter((s) => s === "SUPER_FLEX").length;
  switch (pos) {
    case "QB":  return teams * (count("QB") + sflex * 0.55);
    case "RB":  return teams * (count("RB") + flex * 0.45);
    case "WR":  return teams * (count("WR") + flex * 0.45);
    case "TE":  return teams * (count("TE") + flex * 0.10);
    default:    return teams * Math.max(1, count(pos));
  }
}

// A player can be projected and still be unstartable.
//
// The feed keeps publishing a projection for a player who is ruled Out -
// George Kittle projected 11.7 in a fixture while carrying an Out tag, and
// the lineup solver happily started him over a healthy 8.6. A projection is
// a forecast of what he'd score IF he played. These designations mean he
// will not play, so his real projection is zero and no amount of forecast
// points should seat him.
//
// Questionable is NOT here on purpose: questionable players play most of the
// time, and benching every one of them would be its own kind of wrong.
const WILL_NOT_PLAY = new Set(["Out", "IR", "PUP", "Sus", "NA", "DNR", "Doubtful"]);

export const willNotPlay = (injuryStatus) => WILL_NOT_PLAY.has(String(injuryStatus || ""));

export { WILL_NOT_PLAY };

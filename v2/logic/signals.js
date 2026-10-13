// THE SIGNALS RANKING.
//
// signals.js (the engine) produces per-player flags. Everything about WHICH
// flags reach the page, in what order, and how many - lived in signalsBlock()
// (ui.js:481-523) with no unit test anywhere. Only the render harness saw it,
// which is the layer a presentation rewrite breaks first.
//
// Three behaviours here are easy to lose and expensive to lose:
//
//  1. ONE ROW PER PLAYER, and it is the first QUALIFYING flag, not the first
//     flag. The original `continue`s past a filtered flag and keeps scanning
//     the same player's remaining flags, breaking only once it has pushed.
//     Reading it as "take flags[0], then filter" drops players who have a
//     quiet flag first and a loud one second.
//
//  2. LOW SEVERITY IS DROPPED, EXCEPT A RESOLVED ABSENCE. ui.js:489-495: that
//     is the one case where "low" means the answer is reassuring rather than
//     the finding being small. Filtering it left the Murray case visible only
//     as a tooltip, which on a phone is no place at all.
//
//  3. DEDUPE SPANS OPTIMAL THEN ROSTER, in that order. A player in the
//     suggested lineup is seen first and his roster copy is skipped.

import { SIGNALS_MAX } from "./caps.js";

export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const UNRANKED = 9;
const NO_SIGMA = 99;

export function qualifies(f) {
  if (!f) return false;
  if (f.severity !== "low") return true;
  return f.kind === "absent" && !!f.resolution;
}

/** The first flag on this player that earns a row, or null. */
export function leadFlag(p) {
  for (const f of p?.flags || []) if (qualifies(f)) return f;
  return null;
}

/**
 * @param {Array} optimal - [{slot, player}] from optimalLineup()
 * @param {Array} roster
 * @returns {{shown: Array<{p:object,f:object}>, rest:number, total:number}}
 */
export function signalRows(optimal, roster, { max = SIGNALS_MAX } = {}) {
  const seen = new Set();
  const rows = [];

  for (const p of [...(optimal || []).map((s) => s?.player), ...(roster || [])]) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    const f = leadFlag(p);
    if (f) rows.push({ p, f });
  }

  // Most urgent first, then biggest disagreement.
  rows.sort((a, b) =>
    (SEVERITY_RANK[a.f.severity] ?? UNRANKED) - (SEVERITY_RANK[b.f.severity] ?? UNRANKED) ||
    (b.f.sigmas ?? NO_SIGMA) - (a.f.sigmas ?? NO_SIGMA));

  const shown = rows.slice(0, max);
  return { shown, rest: rows.length - shown.length, total: rows.length };
}

/** Chip label for a flag. (ui.js:471-479) */
export function chipLabel(f) {
  if (!f) return "";
  if (f.kind === "absent") return f.resolution?.kind === "starter" ? "BACK" : "DNP";
  if (f.kind === "thin") return "1G";
  return f.kind === "projection-high" ? "OVER" : "UNDER";
}

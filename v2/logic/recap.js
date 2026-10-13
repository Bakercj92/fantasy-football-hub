// THE RECAP VERDICT INVERSION.
//
// ui.js:555: `const took = row.delta <= 0`. The whole verdict copy hangs on
// it, and a zero delta counts as the lineup having held up - the two lineups
// agreed, so there was nothing to take. Get the comparison backwards, or make
// it strict, and the page confidently tells Chris he was wrong in exactly the
// weeks he was right.

import { RECAP_MAX, LOCKOUT_NAMES } from "./caps.js";

/** True when Chris's own lineup was at least as good as the suggestion. */
export const heldUp = (delta) => delta <= 0;

export function recapRows(r) {
  if (!r?.any) return [];
  return r.rows.slice(0, RECAP_MAX).map((row) =>
    row.kind === "lineup"
      ? {
          kind: "lineup",
          week: row.week,
          held: heldUp(row.delta),
          delta: row.delta,
          cost: Math.abs(row.delta),
          yours: row.yours,
          suggested: row.suggested,
          partial: !!row.partial,
          coverage: row.coverage,
        }
      : {
          kind: "locked",
          week: row.week,
          named: (row.players || []).slice(0, LOCKOUT_NAMES),
          more: Math.max(0, (row.players || []).length - LOCKOUT_NAMES),
          delta: row.delta,
          // A lockout that cost nothing is the common case and must not read
          // as a loss. null means it could not be measured at all.
          costly: row.delta !== null && row.delta > 0,
          couldHaveStarted: row.couldHaveStarted,
          hadToStart: row.hadToStart,
        });
}

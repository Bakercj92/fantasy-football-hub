// Caps and thresholds that were scattered through ui.js as bare literals.
//
// Every one of these was a magic number sitting inside a template string,
// which is how they get silently changed by a rewrite. They are named here,
// imported everywhere, and asserted in v2/test/caps.test.mjs against the
// values the original shipped with.

/** Signals block. A block that lists a third of the roster is the roster
 *  table again with worse copy - which is what the render harness caught the
 *  first version doing. (ui.js:508 `const MAX = 5`) */
export const SIGNALS_MAX = 5;

/** Recap rows. (ui.js:553 `r.rows.slice(0, 6)`) */
export const RECAP_MAX = 6;

/** Players named in a lockout row before the rest are counted.
 *  (ui.js:578 `row.players.slice(0, 3)`) */
export const LOCKOUT_NAMES = 3;

/** Market disagreement rows. (ui.js:833 `.slice(0, 5)`) */
export const MARKET_TOP = 5;

/** Clubs named in the usage footer while a reader can still hold them in
 *  their head; past that, count them. (ui.js:858) */
export const NAME_CLUBS_UPTO = 4;

/** Injury chip label falls back to the first three characters, uppercased.
 *  (ui.js:56) */
export const CHIP_FALLBACK_LEN = 3;

// THE REST-OF-SEASON TRI-STATE.
//
// ui.js:658 distinguishes `p.ros === undefined` (never fetched - still
// pulling) from `p.ros === null` (fetched, no data). Collapsing the two with
// a falsy check is how the surface stuck on "Pulling..." forever with no
// fetch in flight - documented at app.js:383-388, and the reason attachRos()
// re-attaches even when every id was already cached.

export const ROS_PENDING = "pending";
export const ROS_MISSING = "missing";
export const ROS_READY = "ready";

export function rosState(p) {
  if (p?.ros === undefined) return ROS_PENDING;
  if (p?.ros === null) return ROS_MISSING;
  return ROS_READY;
}

/** The compare panel is still waiting if ANY selected player has never been
 *  fetched. A player fetched and found empty is an answer, not a wait. */
export const anyPending = (players) =>
  (players || []).some((p) => rosState(p) === ROS_PENDING);

/** What the compare surface should show for a selection size.
 *  (ui.js:607-628) Note that one pick renders a panel rather than nothing:
 *  the clear button lives in it, and without it a selection is unescapable. */
export function compareMode(size) {
  if (size === 0) return "hidden";
  if (size === 1) return "one";
  return "full";
}

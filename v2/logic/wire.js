// THE WIRE HEADER COUNT.
//
// Extracted in the original for exactly the reason it is extracted again
// here: as an inline expression it was unreachable from any suite, and the
// audit found that deleting the defence term left every test passing while
// the render harness only ever PRINTED the number. (ui.js:374-382)
//
// The defence row is counted only when it has work in it. A standing row
// saying "nothing to do" is information, not a task - and so is a gap inside
// the projection feed's own precision.

export function wireTally(w) {
  if (!w) return 0;
  return (w.upgrades?.length || 0) + (w.risers?.length || 0) + (w.def?.counts ? 1 : 0);
}

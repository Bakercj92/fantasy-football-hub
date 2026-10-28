// THE RECAP PAGE.
//
// Ported from ui.js:549-607. The grading itself is js/memory.js plus the
// pipeline; logic/recap.js holds the one line everything here hangs on, and
// its header comment is worth reading before touching any sentence below.
//
// THIS PAGE READS THE DECISION LOG AND NEVER WRITES TO IT. memory.js:15 keys
// it `ffh.decisions.v1`, the live hub writes it on every load, and the two
// builds share an origin until the swap - so a half-built page writing there
// corrupts the history Tuesday's recap grades on, un-attributably. The kill
// switch is `LOG_ENABLED = false` in pipeline.js. Of the six routes this is
// the one that looks like it wants to write; it does not.
//
// THE GATE IS SOFT, AND IT IS NOT HERE. router.js:32-39 keeps Recap out of the
// nav except Tuesday and Wednesday while leaving the URL reachable every day,
// because a page you cannot get to on a Thursday is a page you cannot check.

import { esc } from "./shell.js";
import { recapRows } from "./logic/recap.js";
import { n1, sgn } from "./copy.js";

/** A lineup week: did his own lineup hold up, and what did the difference cost?
 *
 *  `held` is logic/recap.js's inversion, already applied. The two branches are
 *  NOT symmetrical on purpose: when the call would have won, the sentence is a
 *  single number, and when Chris's own lineup won, the copy says plainly that a
 *  call being wrong once does not make it a bad call. That caveat is the reason
 *  the threshold exists and it is load-bearing - without it this page reads as
 *  a scoreboard against the tool, and a tool that only ever looks wrong in
 *  hindsight gets switched off. (ui.js:563-568) */
function lineupRow(row) {
  const id = `rc-l-${esc(row.week)}`;
  // THREE STATES, NOT TWO. `held` is true for a tie as well as a win, which is
  // the right comparison for "was there anything to take" and the wrong one
  // for the verdict a reader sees: at exactly level the head said "your lineup
  // held up" with a +0.0 badge in the win colour, over a body correctly saying
  // there was nothing in it. Audit caught the head and the body disagreeing.
  const tie = row.delta === 0;
  const head = `<span class="dl"><b>Week ${esc(row.week)}</b>
    <span class="over">${tie
      ? "the two lineups scored the same"
      : row.held
        ? "your lineup held up"
        : "the suggested lineup would have scored more"}</span></span>
    <span class="tag${tie ? " unmeasured" : row.held ? " good" : ""}">${sgn(row.delta)}</span>`;

  const body = `You scored <b>${n1(row.yours)}</b>. The lineup this tool put in front of you
    scored <b>${n1(row.suggested)}</b>.
    ${!row.held
      ? `Worth ${n1(row.delta)} if you had taken it.`
      : row.delta === 0
        // EXACTLY LEVEL IS NOT A COST. v1 printed "would have cost you 0.0" here and then
        // caveated a call that was not wrong, which is a sentence about nothing.
        ? `The two lineups scored the same, so there was nothing in this one either way.`
        : `Taking the call would have cost you ${n1(row.cost)}. Projections are not results, and a
           call being wrong once does not make it a bad call &mdash; the threshold exists because
           single weeks are noisy.`}
    ${row.partial
      ? `<div class="mkt">Only ${Math.round((row.coverage || 0) * 100)}% of those players have
         published stats yet, so this week is partial and is left out of the totals above.</div>`
      : ""}`;

  return `<div class="disc">
    <button class="dischd" type="button" aria-expanded="false" aria-controls="${id}">${head}</button>
    <div class="discbody" id="${id}" hidden>${body}</div>
  </div>`;
}

/** A lockout week. NOT a decision he got wrong, and the copy must not imply it.
 *
 *  `delta === null` means it could not be measured; `costly` is the only
 *  branch that says a lockout actually cost anything. The common case is that
 *  it cost nothing, and that case reads as nothing. (ui.js:576-589) */
function lockedRow(row) {
  const id = `rc-k-${esc(row.week)}`;
  const unmeasured = row.delta === null;
  const names = row.named.map((n) => esc(n)).join(", ");
  const head = `<span class="dl"><b>Week ${esc(row.week)}</b>
    <span class="over">locked out &mdash; ${names}${
      row.more ? ` and ${row.more} more` : ""}</span></span>
    <span class="tag${unmeasured ? " unmeasured" : ""}">${unmeasured ? "—" : sgn(row.delta)}</span>`;

  const body = `${row.couldHaveStarted !== null
      ? `Who you could not start scored <b>${n1(row.couldHaveStarted)}</b>. ` : ""}
    ${row.hadToStart !== null
      ? `Who you were stuck with scored <b>${n1(row.hadToStart)}</b>. ` : ""}
    ${row.delta === null
      ? "There is not enough published yet to say what it cost."
      : row.costly
        ? `Being locked out actually cost <b>${n1(row.delta)}</b> that week.`
        : "It cost nothing in the end."}`;

  return `<div class="disc">
    <button class="dischd" type="button" aria-expanded="false" aria-controls="${id}">${head}</button>
    <div class="discbody" id="${id}" hidden>${body}</div>
  </div>`;
}

// THE UNGRADED COPY SAYS "a logged week", NOT "a week you opened the hub and
// set a lineup".
//
// LOG_ENABLED is false until the swap, so this build writes nothing at all - it
// grades the v1 hub's log through a shared origin. An instruction to open THIS
// page to populate it would be true today only by accident, and false forever
// once the swap flips the switch. So the sentence stays deliberately vague
// about how a week gets logged until there is one answer.
export function recapPage(L, state) {
  if (!L) return `<section class="card quiet"><div class="stub">No league selected.</div></section>`;

  const r = L.recap;
  const rows = recapRows(r);

  // NOTHING GRADED IS NOT AN ERROR, and on a route it has to say so. The
  // original rendered "" here, which was invisible at the bottom of a scroll
  // and is a blank page now.
  if (!rows.length) {
    return `<section class="card quiet">
      <h2>Nothing graded yet</h2>
      <div class="note">This page grades the calls this tool actually put in front of you,
        against what the players really scored. It needs two things: a logged week, and published
        results for that week from nflverse.
        <b>The log lives in this browser on this device</b>, so a lineup you set on your phone
        is not in it.</div>
    </section>`;
  }

  // TWO TOTALS, NEVER ONE. A lockout is not a decision he got wrong, so adding
  // it to the calls figure would charge him for Sleeper's rules. (ui.js:595-598)
  const tot = [
    r.netLineup === null ? "" : `calls ${sgn(r.netLineup)} pts across ${esc(r.weeks)} wk`,
    r.netLocked === null ? "" : `locked out ${sgn(r.netLocked)}`,
  ].filter(Boolean).join(" · ");

  return `<section class="card">
    <h2>Last week${tot ? ` <span class="ct">${tot}</span>` : ""}</h2>
    ${rows.map((row) => (row.kind === "lineup" ? lineupRow(row) : lockedRow(row))).join("")}
    <div class="note">Scored from real results, re-scored at this league's own rules &mdash; not
      the vendor's PPR total. Only weeks nflverse has actually published are graded.
      <b>This log lives in this browser on this device</b>, so a lineup set on your phone is not
      in it. Calls and lockouts are totalled separately &mdash; a lockout is not a decision you
      got wrong.${r.partialCount
        ? ` ${esc(r.partialCount)} week${r.partialCount > 1 ? "s are" : " is"} still partly
           unpublished and excluded from the totals.`
        : ""} Open a line for the numbers.</div>
  </section>`;
}

export { lineupRow, lockedRow };

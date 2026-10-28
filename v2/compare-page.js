// THE COMPARE PAGE.
//
// Ported from ui.js:607-684, which rendered nothing at all when the selection
// was empty. That was correct for a block sitting at the bottom of one long
// scroll - there is nothing to compare, so there is nothing to draw. It is
// wrong for a route: `#/joop/compare` is bookmarkable and reachable from the
// nav on every load, so the empty case is now the FIRST thing most readers
// will see here and it has to teach the control that fills it.
//
// THE SELECTION IS NOT OWNED HERE. It lives in pipeline.js state, keyed by
// league, because app.js re-solves and repaints every thirty seconds through a
// Sunday afternoon and a selection held in the DOM would not survive the first
// kickoff. router.js:15-17 says the same thing from the other side: the URL
// does not carry it either.

import { esc } from "./shell.js";
import { href } from "./router.js";
import { compare } from "../js/compare.js";
import { pairCalls } from "./logic/calls.js";
import { compareMode, anyPending } from "./logic/compare-state.js";
import { n1, injChip } from "./copy.js";

/** The clear button, which must survive every degraded branch below.
 *
 *  ui.js:620-626 records why: returning "" for a selection that no longer
 *  resolves took the clear button with it and stranded the reader with a
 *  selection and no way to dismiss it. Every early return on this page keeps
 *  this in hand. */
const clearBtn = `<button class="clr" data-clear type="button">clear</button>`;

const shell = (cls, inner) => `<section class="card ${cls}">${inner}</section>`;

// ---------------------------------------------------------------------------
// Nothing picked
// ---------------------------------------------------------------------------

/** THE TIGHTEST CALL, not the biggest one.
 *
 *  A compare surface is a second opinion, and the call that most wants one is
 *  the one the engine itself nearly refused to make. So this offers the
 *  SMALLEST positive margin among the real judgment calls.
 *
 *  Three exclusions, each for a reason:
 *    - `forced` calls are not judgments. A player ruled out scores zero
 *      whatever this table says, and offering to weigh him against his
 *      replacement invites the reader to re-litigate a decision Sleeper has
 *      already made for him.
 *    - a pair with a null on either side cannot be compared at all. Those are
 *      normal (an entry into an empty seat, a forced sit with nobody behind
 *      him - logic/calls.js) and compare() needs two players.
 *    - a non-positive delta is not a call this page is making.
 *
 *  Returns null when the league has no such pair, and the empty state then
 *  says so rather than inventing a pairing. */
export function tightestPair(L) {
  const c = L?.calls;
  if (!c?.actionable) return null;
  const usable = pairCalls(c).filter((p) =>
    p.in && p.out && !p.forced && typeof p.delta === "number" && p.delta > 0);
  if (!usable.length) return null;
  return usable.reduce((best, p) => (p.delta < best.delta ? p : best));
}

function emptyState(L) {
  const pair = tightestPair(L);
  const offer = pair
    ? `<div class="offer">
        <div class="note">Your closest call this week is <b>${esc(pair.in.name)}</b> over
          <b>${esc(pair.out.name)}</b>, by ${n1(pair.delta)}. That is the one a second opinion is
          worth most &mdash; the engine came nearest to leaving it alone.</div>
        <button class="go" type="button" data-cmp-pair="${esc(pair.in.id)},${esc(pair.out.id)}"
          >Compare those two &rarr;</button>
      </div>`
    : `<div class="note">There are no two-sided lineup calls in this league this week, so there is
        nothing obvious to put in front of you. Pick anyone.</div>`;

  return shell("quiet cmp-empty", `
    <h2>Nothing picked yet</h2>
    <div class="note">Tap the <span class="mono">&#9878;</span> beside any player on your
      <a href="${href("lineup", L?.entry?.key)}">lineup or bench</a> to put him here. Pick two for a
      head-to-head verdict, or more to rank a pool.</div>
    ${offer}`);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function heads(players) {
  return players.map((p) => `<td class="cp">
    <span class="cn">${esc(p.name)}</span><span class="pos">${esc(p.pos)}</span>${
    injChip(p.injury)}${
    p.locked ? ' <span class="lock" title="already kicked off">&#128274;</span>' : ""}</td>`).join("");
}

/** Each metric row carries its own note as a disclosure rather than a second
 *  always-visible row.
 *
 *  The id is derived from the metric KEY, not from the row's position. Both the
 *  status strip and setContent() carry open disclosures across a repaint by id
 *  (shell.js:168-173), and a positional id would reopen a different metric
 *  after a re-solve reordered the pool. */
function metricRows(c) {
  const ncol = c.players.length + 1;
  return c.rows.map((r) => {
    const id = `cmpn-${esc(r.key)}`;
    return `<tr class="mrow">
      <td class="ml"><button class="rowtog" type="button" aria-expanded="false"
        aria-controls="${id}">${esc(r.label)}</button></td>
      ${r.cells.map((cell) =>
        `<td class="cv${cell.best ? " win" : ""}">${esc(cell.text)}</td>`).join("")}
    </tr>
    <tr class="mnote" id="${id}" hidden><td colspan="${ncol}">${esc(r.note)}</td></tr>`;
  }).join("");
}

function headline(c) {
  if (c.mode === "head-to-head") {
    return `<div class="verdict${c.verdict.decisive ? " yes" : " tie"}">${esc(c.verdict.text)}</div>
      <div class="note">${esc(c.verdict.why)}</div>`;
  }
  // THE AXIS IS NAMED BECAUSE IT CHANGES. Two players who could take the same
  // seat are ranked on points, which is what the lineup solver on this site
  // uses, so the two surfaces cannot contradict each other; everything else
  // ranks on value over replacement. (js/compare.js:267-278) A pool ranked by
  // an unnamed axis is a league table with no column heading.
  return `<div class="verdict">Ranked by ${esc(c.axis ? c.axis.label.toLowerCase() : "projection")}</div>
    <div class="note">${c.players.length} players${c.mixed
      ? ` across ${esc(c.positions.join("/"))} &mdash; only numbers that mean the same thing in
         every one of those positions are shown.`
      : ` at ${esc(c.positions[0] || "")}.`}</div>`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function comparePage(L, state) {
  if (!L) return shell("quiet", `<div class="stub">No league selected.</div>`);

  // KEYED ON THE LEAGUE THIS ROUTE IS SHOWING, not on state.active. boot.js
  // keeps the two in step (readHash sets state.active from the URL), so they
  // agree today; reading the route's own league means a future caller that
  // renders two leagues cannot silently show one league's picks under the
  // other's heading.
  const sel = state?.selection?.[L.entry.key] || new Set();
  const mode = compareMode(sel.size);

  if (mode === "hidden") return emptyState(L);

  if (mode === "one") {
    const only = L.byId.get([...sel][0]);
    return shell("cmp one", `
      <h2>Compare ${clearBtn}</h2>
      <div class="note"><b>${esc(only?.name || "Player")}</b> picked. Choose at least one more
        &mdash; tap the <span class="mono">&#9878;</span> next to any player on your
        <a href="${href("lineup", L.entry.key)}">lineup or bench</a>.</div>`);
  }

  const c = compare([...sel], { byId: L.byId, sigma: L.sigma, slots: L.slots });

  // Fewer than two of the picked ids still resolve - a drop or a trade between
  // re-solves. (ui.js:620-626)
  if (c.mode === "empty") {
    return shell("cmp one", `
      <h2>Compare ${clearBtn}</h2>
      <div class="note">The players you picked are no longer on this roster.</div>`);
  }

  const dropped = c.droppedForMixing.length
    ? `<div class="frow warn"><b>Hidden because you are comparing across positions:</b>
        ${esc(c.droppedForMixing.join(", "))}. Consensus is published per position, so an RB12 and
        a WR12 are not the same claim &mdash; showing them side by side would invent a comparison
        that does not exist. Pick players at one position to see them.</div>`
    : "";

  // THE TRI-STATE, not a falsy check. `ros === undefined` has never been
  // fetched; `ros === null` was fetched and came back empty. Collapsing them
  // is how this surface stuck on "Pulling..." forever with no fetch in flight
  // (app.js:383-388), which is why logic/compare-state.js exists.
  const waiting = anyPending(c.players)
    ? `<div class="frow pending">Pulling rest-of-season&hellip;</div>` : "";

  const market = L.fcalc && !L.fcalc.ok
    ? `<div class="frow warn">Market values unavailable this load &mdash; the value and rank rows
        are hidden rather than guessed.</div>` : "";

  return shell("cmp", `
    <h2>Compare <span class="ct">${c.players.length}</span> ${clearBtn}</h2>
    ${headline(c)}
    <div class="scroll"><table class="cmpt">
      <thead><tr class="th"><td class="ml"></td>${heads(c.players)}</tr></thead>
      <tbody>${metricRows(c)}</tbody>
    </table></div>
    ${waiting}
    ${dropped}
    ${market}
    <div class="note sub">Tap a row label for what that number means and when it lies.</div>`);
}

export { clearBtn };

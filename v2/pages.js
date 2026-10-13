// Page renderers. Phase 1 ships the shell, so only Lineup has real content -
// it is here as the end-to-end proof that the fetch seam works: a lineup
// table can only be right if leagues.json, Sleeper, the schedule and the
// projections all arrived. The rest are honest stubs rather than fake
// screens, and name the phase that fills them.

import { esc } from "./shell.js";
import { lineupPairs, benchOf } from "./logic/roster.js";
import { chipLabel } from "./logic/signals.js";
import { leadFlag } from "./logic/signals.js";

const n1 = (v) => (typeof v === "number" ? v.toFixed(1) : "—");
const sgn = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : "—");

const kick = (ms) => typeof ms === "number"
  ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
  : "";

// THE INFORMATION, NOT THE COLUMN.
//
// Measured at 390px on 2026-10-13: keeping a full Opp column on a phone cost
// the player-name column 110px and wrapped a long name. But folding Opp
// outright loses the bye flag, the kickoff time and the lock - the three
// things that decide whether a change is even POSSIBLE, which matters far
// more on a phone than a three-letter opponent code does.
//
// So the opponent folds and its payload does not: a compact marker rides in
// the name cell and is shown only at the widths where the column is gone.
function nameMark(p) {
  if (p.locked) return ' <span class="nmark lock" title="already kicked off">&#128274;</span>';
  if (!p.opponent) return ' <span class="nmark bye">bye</span>';
  return "";
}

function playerRow(p, slot) {
  if (!p) return `<tr><td class="slot">${esc(slot)}</td>
    <td colspan="4" class="note">— empty —</td></tr>`;
  const f = leadFlag(p);
  const dead = p.startable === false;
  return `<tr${dead ? ' class="dead"' : ""}>
    <td class="slot">${esc(slot)}</td>
    <td class="nm">${esc(p.name)}<span class="pos">${esc(p.pos)}</span>${
      f ? ` <span class="pos">${esc(chipLabel(f))}</span>` : ""}${nameMark(p)}</td>
    <td class="fold-md">${esc(p.team || "")}</td>
    <td class="opp fold-sm">${p.opponent ? esc(p.opponent) : '<span class="bye">bye</span>'}${
      p.locked ? ' <span class="lock" title="already kicked off">&#128274;</span>'
               : p.game?.kickoffUTC ? `<span class="kick">${esc(kick(p.game.kickoffUTC))}</span>` : ""}</td>
    <td class="num fold-lg">${typeof p.vor === "number" ? sgn(p.vor) : ""}</td>
    <td class="pt">${p.hasProjection ? `${p.floorOnly ? "≥" : ""}${n1(p.pts)}` : '<span class="note">n/a</span>'}</td>
  </tr>`;
}

const HEAD = `<thead><tr><td class="slot"></td><td>Player</td>
  <td class="fold-md">Tm</td><td class="opp fold-sm">Opp</td>
  <td class="num fold-lg">VOR</td><td class="pt">Proj</td></tr></thead>`;

function lineupPage(L) {
  if (!L) return stub("No league selected.");
  const pairs = lineupPairs(L.slots, L.starters, L.byId);
  const bench = benchOf(L.roster, L.starters);
  return `
    <div class="cols">
      <section class="card flush">
        <h2>Starting</h2>
        <table>${HEAD}<tbody>${pairs.map(([s, p]) => playerRow(p, s)).join("")}</tbody></table>
      </section>
      <section class="card flush">
        <h2>Bench <span class="ct">${bench.length}</span></h2>
        <table>${HEAD}<tbody>${bench.map((p) => playerRow(p, "BN")).join("")}</tbody></table>
      </section>
    </div>
    <div class="card quiet">
      <div class="note"><b>Phase 1 of the rebuild.</b> This table is here to prove the data
      layer reaches the new shell intact &mdash; it is not the finished Lineup page. The calls
      block, the signals block, what is already locked, and the tap-to-expand columns arrive in
      phase 3. The hub you use is untouched and still at the old address.</div>
    </div>`;
}

const stub = (what, phase) => `
  <section class="card quiet">
    <div class="stub">${esc(what)}${phase ? `<br><br>Built in phase ${esc(phase)}.` : ""}</div>
  </section>`;

export function renderPage(route, state) {
  const L = route.league ? state.leagues[route.league] : null;
  switch (route.page) {
    case "lineup":  return lineupPage(L);
    case "today":   return stub("The cross-league action list — everything that needs doing in all three leagues, grouped by urgency.", 2);
    case "wire":    return stub("Claims, jobs that just opened, and the standing defence seat.", 3);
    case "compare": return stub("Any two players, measured the same way.", 4);
    case "recap":   return stub("Last week, graded at this league's own rules.", 4);
    case "methods": return stub("Where every number on this site comes from.", 4);
    default:        return stub("Not a page.");
  }
}

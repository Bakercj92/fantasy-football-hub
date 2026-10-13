// Page renderers. Phase 1 ships the shell, so only Lineup has real content -
// it is here as the end-to-end proof that the fetch seam works: a lineup
// table can only be right if leagues.json, Sleeper, the schedule and the
// projections all arrived. The rest are honest stubs rather than fake
// screens, and name the phase that fills them.

import { esc } from "./shell.js";
import { lineupPairs, benchOf } from "./logic/roster.js";
import { chipLabel, leadFlag } from "./logic/signals.js";
import { CHIP_FALLBACK_LEN } from "./logic/caps.js";

// Severity colour and tooltip, ported with the chip (js/ui.js:469,476-477).
const SEV_CLS = { high: "out", medium: "dbt", low: "q" };
const flagTitle = (f) =>
  f.text + (f.resolution ? ` \u2014 ${f.resolution.text}` : f.ask ? ` \u2014 ${f.ask}` : "");

const n1 = (v) => (typeof v === "number" ? v.toFixed(1) : "—");
const sgn = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : "—");

const kick = (ms) => typeof ms === "number"
  ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
  : "";

// Injury designation. Ported from js/ui.js:20-22,54-58 - missing from the
// first cut of this page entirely, so Questionable, Doubtful, IR and PUP were
// invisible on a lineup page whose whole job is start/sit. Only
// `startable === false` showed, as a greyed row.
const INJ = {
  Out: ["out", "OUT"], Doubtful: ["dbt", "DBT"], Questionable: ["q", "Q"],
  IR: ["ir", "IR"], PUP: ["pup", "PUP"], Sus: ["sus", "SUS"],
  COV: ["cov", "COV"], NA: ["out", "N/A"],
};
function injChip(s) {
  if (!s) return "";
  const [cls, label] = INJ[s] || ["q", String(s).slice(0, CHIP_FALLBACK_LEN).toUpperCase()];
  return ` <span class="chip ${cls}" title="${esc(s)}">${esc(label)}</span>`;
}

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
// The kickoff TIME is part of that payload and was left behind in the first
// cut: it lived only in the .opp cell, which is display:none at <=460px, so
// every phone width lost it with no substitute. On a phone, WHEN a player
// plays is what decides whether a change is still possible.
function nameMark(p) {
  if (p.locked) return ' <span class="nmark lock" title="already kicked off">&#128274;</span>';
  if (!p.opponent) return ' <span class="nmark bye">bye</span>';
  if (p.game?.kickoffUTC) return ` <span class="nmark kick">${esc(kick(p.game.kickoffUTC))}</span>`;
  return "";
}

function playerRow(p, slot) {
  if (!p) return `<tr><td class="slot">${esc(slot)}</td>
    <td colspan="5" class="note">— empty —</td></tr>`;
  const f = leadFlag(p);
  const dead = p.startable === false;
  return `<tr${dead ? ' class="dead"' : ""}>
    <td class="slot">${esc(slot)}</td>
    <td class="nm">${esc(p.name)}<span class="pos">${esc(p.pos)}</span>${
      f ? ` <span class="chip ${esc(SEV_CLS[f.severity] || "q")}" title="${esc(flagTitle(f))}">${
        esc(chipLabel(f))}</span>` : ""}${nameMark(p)}</td>
    <td class="fold-md">${esc(p.team || "")}</td>
    <td class="opp fold-sm">${p.opponent ? esc(p.opponent) : '<span class="bye">bye</span>'}${
      p.locked ? ' <span class="lock" title="already kicked off">&#128274;</span>'
               : p.game?.kickoffUTC ? `<span class="kick">${esc(kick(p.game.kickoffUTC))}</span>` : ""}</td>
    <td class="num fold-lg">${typeof p.vor === "number" ? sgn(p.vor) : ""}</td>
    <td class="pt">${p.hasProjection ? `${p.floorOnly ? "≥" : ""}${n1(p.pts)}` : '<span class="note">n/a</span>'}${injChip(p.injury)}</td>
  </tr>`;
}

const HEAD = `<thead><tr><td class="slot"></td><td>Player</td>
  <td class="fold-md">Tm</td><td class="opp fold-sm">Opp</td>
  <td class="num fold-lg">VOR</td><td class="pt">Proj</td></tr></thead>`;

function lineupPage(L) {
  if (!L) return stub("No league selected.");
  const pairs = lineupPairs(L.slots, L.starters, L.byId);
  const bench = benchOf(L.roster, L.starters);
  // NOT `.cols`. A six-column table needs the full content width - see the
  // measurement note on .cols in app.css. These stack at every width.
  return `
    <div class="stack">
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

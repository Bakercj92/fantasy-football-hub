// Page renderers. Phase 1 ships the shell, so only Lineup has real content -
// it is here as the end-to-end proof that the fetch seam works: a lineup
// table can only be right if leagues.json, Sleeper, the schedule and the
// projections all arrived. The rest are honest stubs rather than fake
// screens, and name the phase that fills them.

import { esc } from "./shell.js";
import { todayModel } from "./logic/today.js";
import { href } from "./router.js";
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


// ---------------------------------------------------------------------------
// TODAY
//
// What needs doing, across all three leagues, grouped by urgency class and
// then by league. The model (v2/logic/today.js) refuses to rank across
// leagues or to invent a shared points scale; this renders that refusal
// rather than papering over it, which is why there is no "total" anywhere on
// the page and why each class carries a sentence saying what its numbers are.
//
// Every item is a HEADLINE AND A LINK, never the full reasoning. The league
// page that owns the item is where the why lives - repeating it here would
// rebuild the old single-scroll page inside the new one.
// ---------------------------------------------------------------------------

const DEST = { call: "lineup", signal: "lineup", claim: "wire", def: "wire",
               "def-quiet": "wire", vacancy: "wire", promotion: "wire", riser: "wire" };

const tag = (text, cls = "") => `<span class="tag ${cls}">${esc(text)}</span>`;

function itemLine(it) {
  switch (it.kind) {
    case "call":
      return it.forced
        ? [`<b>Sit ${esc(it.out.name)}</b> &mdash; ruled ${esc(it.out.injury || "out")}${
             it.in ? `, start ${esc(it.in.name)}` : ""}`, tag("must", "must")]
        : [`<b>Start ${esc(it.in?.name ?? "\u2014")}</b>${
             it.out ? ` over ${esc(it.out.name)}` : ""}`, tag(sgn(it.delta), it.delta > 0 ? "good" : "")];
    case "claim":
      return [`<b>Claim ${esc(it.player.name)}</b> ${
        it.over ? `over ${esc(it.over.name)}` : `into your empty ${esc(it.slot)}`}`,
        tag(sgn(it.gap), it.gap > 0 ? "good" : "")];
    case "def":
      return [`<b>Stream ${esc(it.verdict.best.name)}</b> over ${esc(it.verdict.current.name)} at DEF`,
        tag(sgn(it.gap), it.gap > 0 ? "good" : "")];
    case "def-quiet":
      return [`Defence seat checked &mdash; ${esc(defQuietPhrase(it.verdict))}`, tag("ok")];
    case "signal":
      return [`<b>${esc(it.player.name)}</b> <span class="pos">${esc(it.player.pos)}</span> ${
        esc(it.flag.text)}`, tag(it.flag.severity === "high" ? "check" : "watch",
        it.flag.severity === "high" ? "warn" : "")];
    case "vacancy":
      return [`<b>${esc(it.row.nm)}</b> <span class="pos">${esc(it.row.tm)} ${esc(it.row.pos)}${
        it.row.rk}</span> &mdash; behind ${esc(it.row.over.nm)}`,
        tag(it.row.over.tier === "confirmed" ? "confirmed" : "watch",
            it.row.over.tier === "confirmed" ? "warn" : "")];
    case "promotion":
      return [`<b>${esc(it.row.nm)}</b> <span class="pos">${esc(it.row.tm)} ${esc(it.row.pos)}${
        it.row.rk}</span> &mdash; moved up ${it.row.climb}`, tag("depth")];
    case "riser":
      return [`<b>${esc(it.player.name)}</b> <span class="pos">${esc(it.player.pos)}</span> &mdash; being added fast`,
        tag("trending")];
    default:
      return ["", ""];
  }
}

function defQuietPhrase(v) {
  if (v.kind === "all-locked") return "every free defence has already played";
  if (v.kind === "no-projections") return "no defence projections published yet";
  if (v.kind === "tie") return "nothing between them";
  if (v.kind === "marginal") return "a gap inside the feed's own precision";
  if (v.kind === "current-locked") return "yours has already kicked off";
  if (v.kind === "unresolved" || v.kind === "unprojected") return "the seat could not be priced";
  return "yours is the better bet";
}

function todayPage(state) {
  const m = todayModel(state, { now: state.now, day: state.day ?? new Date().getDay() });

  if (m.quiet) {
    return `<section class="card quiet">
      <div class="stub"><b>Nothing to do in any league.</b></div>
      <div class="note">Checked all three: lineups solve to what you are already running, no free
      agent beats a starter, and no depth chart moved under anyone you own.
      ${m.checked.map((c) => `<br>${esc(c.name)} &mdash; ${c.wire} on the wire worth a look${
        c.faabLeft === null ? "" : `, $${c.faabLeft} FAAB left`}.`).join("")}</div>
    </section>`;
  }

  // THE ADVISORY CLASS IS FOLDED, AND THE ACTIONABLE ONES ARE NOT.
  //
  // Measured on the hostile fixture: "Worth knowing" ran 23 rows against 7
  // actionable ones. Capping it to four per league helped and did not fix the
  // shape of the problem - a page about what to do should not be mostly made
  // of things that are explicitly nothing to do. So it collapses. The count
  // is in the summary, so the page still says how much there is; it is one
  // tap, not a scroll, and it is the only class treated this way.
  const body = (c) => `
      <div class="cols">
        ${c.leagues.map((g) => `
          <div class="card lgcard">
            <h2><a class="lglink" href="${href(DEST[g.items[0].kind] || "lineup", g.key)}">${
              esc(g.name)}</a> <span class="ct">${g.total}</span></h2>
            ${g.items.map((it) => {
              const [text, chip] = itemLine(it);
              return `<a class="tline" href="${href(DEST[it.kind] || "lineup", g.key)}">
                <span class="tl">${text}</span>${chip}</a>`;
            }).join("")}
            ${g.more ? `<a class="tline more" href="${href(DEST[g.items[0].kind] || "wire", g.key)}">
              <span class="tl">${g.more} more</span>${tag("open")}</a>` : ""}
          </div>`).join("")}
      </div>`;

  return m.classes.map((c) => c.key === "watch"
    ? `<details class="clsx fold">
        <summary class="clsh">${esc(c.label)} <span class="ct">${c.count}</span>
          <span class="more">nothing to do &mdash; open if you want it</span></summary>
        <div class="note clssub">${esc(c.sub)}</div>
        ${body(c)}
      </details>`
    : `
    <section class="clsx">
      <h2 class="clsh">${esc(c.label)} <span class="ct">${c.count}</span></h2>
      <div class="note clssub">${esc(c.sub)}</div>
      <div class="cols">
        ${c.leagues.map((g) => `
          <div class="card lgcard">
            <h2><a class="lglink" href="${href(DEST[g.items[0].kind] || "lineup", g.key)}">${
              esc(g.name)}</a> <span class="ct">${g.total}</span></h2>
            ${g.items.map((it) => {
              const [text, chip] = itemLine(it);
              return `<a class="tline" href="${href(DEST[it.kind] || "lineup", g.key)}">
                <span class="tl">${text}</span>${chip}</a>`;
            }).join("")}
          </div>`).join("")}
      </div>
    </section>`).join("");
}

const stub = (what, phase) => `
  <section class="card quiet">
    <div class="stub">${esc(what)}${phase ? `<br><br>Built in phase ${esc(phase)}.` : ""}</div>
  </section>`;

export function renderPage(route, state) {
  const L = route.league ? state.leagues[route.league] : null;
  switch (route.page) {
    case "lineup":  return lineupPage(L);
    case "today":   return todayPage(state);
    case "wire":    return stub("Claims, jobs that just opened, and the standing defence seat.", 3);
    case "compare": return stub("Any two players, measured the same way.", 4);
    case "recap":   return stub("Last week, graded at this league's own rules.", 4);
    case "methods": return stub("Where every number on this site comes from.", 4);
    default:        return stub("Not a page.");
  }
}

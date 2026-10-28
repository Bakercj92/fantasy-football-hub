// Page dispatch, and the Today page.
//
// Each route's renderer owns its own module once it is more than a screen of
// markup - lineup-page.js, wire-page.js - and this file keeps the dispatch,
// Today, and the stubs for routes that are not built yet. The stubs are
// honest rather than fake screens, and name the phase that fills them.

import { esc } from "./shell.js";
import { todayModel } from "./logic/today.js";
import { lineupPage } from "./lineup-page.js";
import { wirePage } from "./wire-page.js";
import { comparePage } from "./compare-page.js";
import { recapPage } from "./recap-page.js";
import { methodsPage } from "./methods-page.js";
import { href } from "./router.js";
import { n1, sgn } from "./copy.js";


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

// Where a GROUP points. Not the first visible item's kind: a watch card of
// three signals and five hidden wire rows sent "5 more" to the lineup page.
// The majority kind across everything the group holds, with the hidden rows
// deciding their own link.
function destOf(kinds, fallback = "lineup") {
  const tally = {};
  for (const k of kinds || []) {
    const d = DEST[k];
    if (d) tally[d] = (tally[d] || 0) + 1;
  }
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : fallback;
}

const tag = (text, cls = "") => `<span class="tag ${cls}">${esc(text)}</span>`;

// Exported for test only, on the same reasoning ui.js:269-273 gives for
// defRow: every branch here is copy, copy is what this project's render layer
// has actually caught, and asserting the text of all nine branches is cheap in
// node and needs no browser. One of them crashed the entire page in review.
export function itemLine(it) {
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
      // AN EMPTY DEF SEAT HAS NO `current`. waivers.js:274 sets it null by
      // construction when the seat is empty, and `counts` stays true there
      // (`!current?.locked` is `!undefined`), so this row really does arrive
      // with current === null - and reading `.name` off it threw, replacing
      // the whole page with the error screen. Precisely the failure
      // defence.js's `requires` ladder was built to stop, one layer up.
      return it.verdict.kind === "empty"
        ? [`<b>Stream ${esc(it.verdict.best.name)}</b> into your empty DEF seat`,
           tag(sgn(it.gap), it.gap > 0 ? "good" : "")]
        : [`<b>Stream ${esc(it.verdict.best.name)}</b> over ${esc(it.verdict.current.name)} at DEF`,
           tag(sgn(it.gap), it.gap > 0 ? "good" : "")];
    case "def-quiet":
      return [`Defence seat checked &mdash; ${esc(defQuietPhrase(it.verdict))}`, tag("ok")];
    case "signal":
      return [`<b>${esc(it.player.name)}</b> <span class="pos">${esc(it.player.pos)}</span> ${
        esc(it.flag.text)}`, tag(it.flag.severity === "high" ? "check" : "watch",
        it.flag.severity === "high" ? "warn" : "")];
    case "vacancy":
      return [`<b>${esc(it.row.nm)}</b> <span class="pos">${esc(it.row.tm)} ${esc(it.row.pos)}${esc(it.row.rk)}</span> &mdash; behind ${esc(it.row.over.nm)}`,
        tag(it.row.over.tier === "confirmed" ? "confirmed" : "watch",
            it.row.over.tier === "confirmed" ? "warn" : "")];
    case "promotion":
      return [`<b>${esc(it.row.nm)}</b> <span class="pos">${esc(it.row.tm)} ${esc(it.row.pos)}${esc(it.row.rk)}</span> &mdash; moved up ${esc(it.row.climb)}`, tag("depth")];
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

  // A WEEK WITH NOTHING TO DO BUT SOMETHING TO READ IS NOT A BLANK PAGE.
  // `quiet` is only true when there are no classes at all, so a watch-only
  // week rendered as one closed fold and nothing else - no chevron, no visible
  // body, just a heading. The all-quiet card is shown whenever nothing is
  // ACTIONABLE, and the fold rides underneath it.
  const actionable = m.classes.filter((c) => c.key !== "watch");
  if (m.quiet || actionable.length === 0) {
    const quietCard = `<section class="card quiet">
      <div class="stub"><b>Nothing to do in any league.</b></div>
      <div class="note">Checked ${m.checked.length === 1 ? "it" : `all ${m.checked.length}`}: lineups
      solve to what you are already running, no free agent beats a starter, and no depth chart
      moved under anyone you own.
      ${m.checked.map((c) => `<br>${esc(c.name)} &mdash; ${c.wire} on the wire worth a look${
        c.faabLeft === null ? "" : `, $${esc(c.faabLeft)} FAAB left`}.`).join("")}</div>
    </section>`;
    return quietCard + m.classes.map(renderClass).join("");
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
            <h2><a class="lglink" href="${href(destOf(g.kinds), g.key)}">${
              esc(g.name)}</a> <span class="ct">${g.total}</span></h2>
            ${g.items.map((it) => {
              const [text, chip] = itemLine(it);
              return `<a class="tline" href="${href(DEST[it.kind] || "lineup", g.key)}">
                <span class="tl">${text}</span>${chip}</a>`;
            }).join("")}
            ${g.more ? `<a class="tline more" href="${href(destOf(g.hiddenKinds.length ? g.hiddenKinds : g.kinds), g.key)}">
              <span class="tl">${g.more} more</span>${tag("open")}</a>` : ""}
          </div>`).join("")}
      </div>`;

  return m.classes.map(renderClass).join("");

  function renderClass(c) {
    return c.key === "watch"
    ? `<details class="clsx" data-fold="watch">
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
            <h2><a class="lglink" href="${href(destOf(g.kinds), g.key)}">${
              esc(g.name)}</a> <span class="ct">${g.total}</span></h2>
            ${g.items.map((it) => {
              const [text, chip] = itemLine(it);
              return `<a class="tline" href="${href(DEST[it.kind] || "lineup", g.key)}">
                <span class="tl">${text}</span>${chip}</a>`;
            }).join("")}
          </div>`).join("")}
      </div>
    </section>`;
  }
}

const stub = (what, phase) => `
  <section class="card quiet">
    <div class="stub">${esc(what)}${phase ? `<br><br>Built in phase ${esc(phase)}.` : ""}</div>
  </section>`;

export function renderPage(route, state) {
  const L = route.league ? state.leagues[route.league] : null;
  switch (route.page) {
    case "lineup":  return lineupPage(L, state);
    case "today":   return todayPage(state);
    case "wire":    return wirePage(L, state);
    case "compare": return comparePage(L, state);
    case "recap":   return recapPage(L, state);
    case "methods": return methodsPage(L, state);
    default:        return stub("Not a page.");
  }
}

// THE LINEUP PAGE.
//
// Four things, in the order the original put them: what to change, what the
// projection and the measured usage disagree about, what stopped being
// possible, and then the roster itself as reference.
//
// THE CALLS BLOCK IS THE PAGE. Everything under it is reference, and the
// layout says so - the calls card is the only one on the site that carries
// the action colour.

import { esc } from "./shell.js";
import { href } from "./router.js";
import { lineupPairs, benchOf } from "./logic/roster.js";
import { signalRows, chipLabel, leadFlag } from "./logic/signals.js";
import { pairCalls } from "./logic/calls.js";
import { SIGNALS_MAX } from "./logic/caps.js";
import {
  n1, sgn, kick, injChip, SEV_CLS, flagTitle,
  vegasPhrase, usagePhrase, marketLine,
} from "./copy.js";

// ---------------------------------------------------------------------------
// What to change
// ---------------------------------------------------------------------------
function callsCard(L) {
  const c = L?.calls;
  if (!c) return "";

  if (!c.actionable) {
    return `<section class="card quiet">
      <div class="ok">✓ Lineup checked &mdash; nothing to change.</div>
      <div class="note">Best legal lineup is the one you already have${
        c.gain > 0 ? `, within ${n1(c.gain)} pt` : ""}. Threshold ${n1(c.threshold)} pt
        <span class="hint">(½σ for the positions involved, floor 1.0)</span>.</div>
    </section>`;
  }

  const pairs = pairCalls(c);
  const rows = pairs.map((pair, i) => {
    const { in: inP, out: outP, forced, delta } = pair;
    const head = forced
      ? `<b>Sit ${esc(outP.name)}</b> <span class="over">&mdash; ${
          outP.injury ? `ruled ${esc(outP.injury)}` : "not priced this week"}</span>${
          inP ? ` <span class="over">· start ${esc(inP.name)}</span>` : ""}`
      : `<b>Start ${esc(inP?.name ?? "—")}</b>${
          outP ? ` <span class="over">over ${esc(outP.name)}</span>` : ""}`;
    const tag = forced
      ? `<span class="tag must">must</span>`
      : `<span class="tag ${delta > 0 ? "good" : ""}">${sgn(delta)}</span>`;

    // FORCED CALLS IGNORE THE THRESHOLD, and the copy has to say why: the feed
    // still publishes a projection for a ruled-out player, because that is
    // what he would score if he played. He will not. (ui.js:701-706)
    // TWO KINDS OF FORCED CALL, AND THEY ARE NOT THE SAME SENTENCE.
    //
    // `forced` means startable === false, which happens two ways. A player
    // ruled out carries a designation AND a projection, and the sentence about
    // the feed still publishing one is the whole point of the block. A player
    // the feed has never heard of carries NEITHER - pipeline.js builds him
    // with injury null and pts null - and the ruled-out sentence rendered as
    // "is listed . The feed still publishes a projection for him (-)",
    // asserting a measurement that does not exist. That em dash is the exact
    // tell js/vacancy.js:199-201 exists to prevent.
    // COMPUTED ONLY WHEN FORCED. The first cut built this eagerly, and its
    // non-unpriced branch reads outP.name - which is null on a call INTO AN
    // EMPTY SEAT, where there is nobody leaving. That threw. `forced` is
    // false there, so the value was never used; it was evaluated anyway.
    const unpriced = forced && !outP.hasProjection;
    const forcedWhy = !forced ? "" : unpriced
      ? `The projection feed has no entry for <b>${esc(outP.name)}</b> at all, so this page
         cannot price him and treats him as unplayable rather than guessing. That is why this
         call ignores the threshold. Check the seat yourself before acting — missing
         data is not the same as a bad player.`
      : `${esc(outP.name)} is listed <b>${esc(outP.injury)}</b>. The feed still publishes a
         projection for him (${n1(outP.pts)}) because that is what he would score if he played
         &mdash; he will not, so his real total is zero. That is why this call ignores the
         threshold.`;
    const why = forced
      ? `${forcedWhy}
         ${inP ? `${esc(inP.name)} projects <b>${n1(inP.pts)}</b>${
           inP.opponent ? ` vs ${esc(inP.opponent)}` : ""}.` : ""}
         ${inP && vegasPhrase(inP) ? `<div class="veg">${vegasPhrase(inP)}</div>` : ""}`
      : `${esc(inP?.name)} projects <b>${n1(inP?.pts)}</b> at this league's scoring${
           inP?.opponent ? ` vs ${esc(inP.opponent)}` : ""}${
           inP?.injury ? ` · <span class="inj">${esc(inP.injury)}</span>` : ""}
         ${typeof inP?.vor === "number"
            ? `&mdash; that is <b>${sgn(inP.vor)}</b> over the best free ${esc(inP.pos)} in this league.`
            : "."}
         ${outP ? `${esc(outP.name)} projects <b>${n1(outP.pts)}</b>${
           outP.opponent ? ` vs ${esc(outP.opponent)}` : ""}${
           outP.injury ? ` · <span class="inj">${esc(outP.injury)}</span>` : ""}.` : ""}
         ${[vegasPhrase(inP), vegasPhrase(outP)].filter(Boolean)
            .map((t) => `<div class="veg">${t}</div>`).join("")}
         ${marketLine(inP, outP)}
         <div class="mono small">${(inP?.why || [])
            .map((w) => `${esc(w.key)} ${w.projected}×${w.weight}`).join(" · ")}</div>`;

    const id = `call-${i}`;
    return `<div class="disc${forced ? " hard" : ""}">
      <button class="dischd" aria-expanded="false" aria-controls="${id}">
        <span class="dl">${head}</span>${tag}</button>
      <div class="discbody" id="${id}" hidden>${why}</div>
    </div>`;
  }).join("");

  return `<section class="card act">
    <h2>⚠ ${pairs.length} thing${pairs.length > 1 ? "s" : ""} to do
      <span class="ct">${c.forced?.length ? `${c.forced.length} forced · ` : ""}net ${sgn(c.gain)} pts</span></h2>
    ${rows}
    <div class="note">Open a line for why. Threshold ${n1(c.threshold)} pt${
      c.forced?.length ? "; forced calls ignore it." : "."}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Worth a second look
//
// Built after three start/sit calls went wrong because one signal was read and
// the other ignored, in both directions. NOT day-gated: a lineup can be wrong
// on any day. The copy states the disagreement and stops - where the depth
// chart can settle it, that is shown as a fact about the chart, never as an
// instruction. (ui.js:449-523)
// ---------------------------------------------------------------------------
function signalsCard(L) {
  const { shown, rest } = signalRows(L?.optimal, L?.roster);
  if (!shown.length) return "";
  return `<section class="card">
    <h2>Worth a second look <span class="ct">${shown.length + rest}</span></h2>
    ${shown.map(({ p, f }) => `<div class="srow2">
      <div class="dl"><b>${esc(p.name)}</b><span class="pos">${esc(p.pos)}</span>
        <span class="over">${esc(f.text)}</span></div>
      ${f.resolution
        ? `<div class="note">${esc(f.resolution.text)}${
            f.resolution.asOf ? ` · depth chart ${esc(String(f.resolution.asOf).slice(0, 10))}` : ""}</div>`
        : f.ask ? `<div class="note">${esc(f.ask)}</div>` : ""}
    </div>`).join("")}
    ${rest > 0 ? `<div class="note">${rest} more, below the ${SIGNALS_MAX} shown.</div>` : ""}
    <div class="note">A projection forecasts this week; measured usage reports the last one.
      When they disagree this block says so &mdash; it does not pick a side.</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Too late this week. Never phrased as an instruction - there is nothing to do
// about it - and never shown when there are none. (ui.js:791-810)
// ---------------------------------------------------------------------------
function lockedCard(L) {
  const m = L?.missed;
  if (!m?.any) return "";
  const name = (p) => `${esc(p.name)} <span class="pos">${esc(p.pos)}</span>`;
  const bits = [];
  if (m.entering.length) bits.push(`could no longer start ${m.entering.map(name).join(", ")}`);
  if (m.leaving.length) bits.push(`could no longer sit ${m.leaving.map(name).join(", ")}`);
  // QUIET, NOT A WARNING. The block's own stance is that there is nothing to
  // do about any of this - it is "never phrased as an instruction". Giving it
  // the alert treatment makes the page shout about the one card a reader can
  // do nothing with, which is the opposite of what the copy says.
  return `<section class="card quiet">
    <h2>Too late this week <span class="ct">${m.entering.length + m.leaving.length}</span></h2>
    <div class="note">You ${bits.join(", and ")}. Their games had already kicked off, so Sleeper
      would refuse the change and the lineup below is solved around them.
      ${typeof m.cost === "number" && m.cost > 0
        ? `Being locked out cost about <b>${n1(m.cost)}</b> projected points this week.`
        : `The best legal lineup is worth the same either way, so this cost nothing.`}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// The roster tables.
//
// HYBRID ROWS. Name and projection are always visible; the team, opponent,
// kickoff and VOR fold out of the way as the viewport narrows and the whole
// row opens to a detail panel that carries all of it plus the measured usage
// and the Vegas read.
//
// The fold order is by VALUE, not by width convenience, and the opponent's
// payload - bye, lock, kickoff - rides inline with the name once its column
// is gone. Both were measured; see app.css.
//
// COLSPAN IS DERIVED, NOT TYPED. The original carried a hand-written colspan
// that went stale the moment a column was added (ui.js:738-743), and the v2
// port reintroduced the same defect in its first cut. One constant now.
// ---------------------------------------------------------------------------
const COLS = ["slot", "nm", "tm", "opp", "vor", "pt"];
const NCOLS = COLS.length;

const HEAD = `<thead><tr>
  <td class="slot"></td><td>Player</td>
  <td class="fold-md">Tm</td><td class="opp fold-sm">Opp</td>
  <td class="num fold-lg">VOR</td><td class="pt">Proj</td></tr></thead>`;

function nameMark(p) {
  if (p.locked) return ` <span class="nmark lock" title="Kicked off ${
    esc(kick(p.game?.kickoffUTC))} — Sleeper will not move him now">&#128274;</span>`;
  if (!p.opponent) return ' <span class="nmark bye">bye</span>';
  if (p.game?.kickoffUTC) return ` <span class="nmark kick">${esc(kick(p.game.kickoffUTC))}</span>`;
  return "";
}

function detailPanel(p) {
  const rows = [
    ["Team", esc(p.team || "—")],
    ["Opponent", p.opponent ? esc(p.opponent) : `<span class="bye">bye</span>`],
    ["Kickoff", p.game?.kickoffUTC
      ? `${esc(kick(p.game.kickoffUTC))}${p.locked ? " — already played" : ""}`
      : "—"],
    ["Projection", p.hasProjection
      ? `${p.floorOnly ? "≥" : ""}${n1(p.pts)}${p.floorOnly ? ' <span class="hint">(a floor — see Methods)</span>' : ""}`
      : `<span class="note">not priced this week</span>`],
    ["Over replacement", typeof p.vor === "number"
      ? `${sgn(p.vor)} <span class="hint">against the best free ${esc(p.pos)} in this league</span>`
      : "—"],
    // STARTABLE FIRST, INJURY SECOND. Keyed on injury alone, an unpriced
    // starter - injury null, startable false - printed "active" one card below
    // the same page telling you to sit him.
    ["Status", p.startable === false
      ? `${p.injury ? `${esc(p.injury)} — ` : ""}will not play${
          p.hasProjection ? "" : "; the feed has no entry for him"}`
      : p.injury ? esc(p.injury) : "active"],
  ];
  const market = p.market?.posRank
    ? `<div class="mkt">Consensus has him at <b>${esc(p.market.posRank)}</b>${
        p.market.grade ? ` (${esc(p.market.grade)})` : ""}. A flag, not a vote.</div>` : "";
  const veg = vegasPhrase(p) ? `<div class="veg">${vegasPhrase(p)}</div>` : "";
  return `<dl class="kv">${rows.map(([k, v]) =>
    `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${usagePhrase(p)}${veg}${market}`;
}

/** THE COMPARE CONTROL.
 *
 * IN THE NAME CELL, NOT A COLUMN OF ITS OWN. COLS/NCOLS above is derived
 * precisely because a hand-written colspan went stale when a column was added
 * (ui.js:738-743, and again in the v2 port), and a seventh column would also
 * spend width the player-name column cannot spare - app.css records a name
 * column collapsing to 59px, and keeping table-layout:auto below 560px is
 * constraint 5 of the rebuild. So this rides inside the cell that already
 * exists, which is also where the original pointed the reader: "tap the
 * balance next to any player in your lineup or on your bench" (ui.js:616).
 *
 * aria-pressed rather than a checkbox: it is a toggle on a thing, and the
 * pressed state is what the header count is counting. */
function cmpBtn(p, picked) {
  return ` <button class="cmpbtn${picked ? " on" : ""}" type="button" data-cmp="${esc(p.id)}"
    aria-pressed="${picked ? "true" : "false"}" title="${
    picked ? "Picked for Compare — tap again to remove" : "Add to Compare"}"
    >&#9878;</button>`;
}

function playerRows(p, slot, idPrefix, sel = null) {
  if (!p) {
    return `<tr class="prow empty"><td class="slot">${esc(slot)}</td>
      <td colspan="${NCOLS - 1}" class="note">— empty —</td></tr>`;
  }
  // THE ROW CHIP IS flags[0], NOT THE FIRST QUALIFYING FLAG.
  //
  // The signals CARD drops low severity except a resolved absence, which is
  // ui.js:495 and correct there. Applying that filter to the chip deleted the
  // thin-sample marker from both tables entirely: "only 1 game of usage" is
  // the one low-severity non-absent flag js/signals.js produces, and the flag
  // families are mutually exclusive on playedLast/played, so it is always that
  // player's ONLY flag. ui.js:752 read flags[0] unconditionally. The card and
  // the chip want different predicates and now have them.
  const f = p.flags?.[0] || null;
  const id = `${idPrefix}-${esc(p.id)}`;
  const dead = p.startable === false;
  return `<tr class="prow${dead ? " dead" : ""}${p.locked ? " locked" : ""}" data-row="${id}">
    <td class="slot">${esc(slot)}</td>
    <td class="nm"><button class="rowtog" aria-expanded="false" aria-controls="${id}">${
      esc(p.name)}</button><span class="pos">${esc(p.pos)}</span>${
      f ? ` <span class="chip ${esc(SEV_CLS[f.severity] || "q")}" title="${esc(flagTitle(f))}">${
        esc(chipLabel(f))}</span>` : ""}${nameMark(p)}${cmpBtn(p, !!sel?.has(String(p.id)))}</td>
    <td class="fold-md">${esc(p.team || "")}</td>
    <td class="opp fold-sm">${p.opponent ? esc(p.opponent) : '<span class="bye">bye</span>'}${
      p.locked ? ` <span class="lock" title="Kicked off ${esc(kick(p.game?.kickoffUTC))} — Sleeper will not move him now">&#128274;</span>`
               : p.game?.kickoffUTC ? `<span class="kick">${esc(kick(p.game.kickoffUTC))}</span>` : ""}</td>
    <td class="num fold-lg">${typeof p.vor === "number" ? sgn(p.vor) : ""}</td>
    <td class="pt">${p.hasProjection ? `${p.floorOnly ? "≥" : ""}${n1(p.pts)}`
      : '<span class="note">n/a</span>'}${injChip(p.injury)}</td>
  </tr>
  <tr class="pdet" id="${id}" hidden><td colspan="${NCOLS}">${detailPanel(p)}</td></tr>`;
}

function rosterTables(L, sel = null) {
  const pairs = lineupPairs(L.slots, L.starters, L.byId);
  const bench = benchOf(L.roster, L.starters);
  return `
    <section class="card flush">
      <h2>Starting</h2>
      <table>${HEAD}<tbody>${
        pairs.map(([s, p]) => playerRows(p, s, "st", sel)).join("")}</tbody></table>
    </section>
    ${bench.length ? `<section class="card flush">
      <h2>Bench <span class="ct">${bench.length}</span></h2>
      <table>${HEAD}<tbody>${
        bench.map((p) => playerRows(p, "BN", "bn", sel)).join("")}</tbody></table>
    </section>` : ""}`;
}

export function lineupPage(L, state) {
  if (!L) return `<section class="card quiet"><div class="stub">No league selected.</div></section>`;
  // Keyed on this route's league rather than state.active, for the reason
  // compare-page.js records at the same lookup.
  const sel = state?.selection?.[L.entry?.key] || null;
  return callsCard(L) + signalsCard(L) + lockedCard(L) + rosterTables(L, sel);
}

export { NCOLS, COLS, playerRows, detailPanel, callsCard, signalsCard, lockedCard };

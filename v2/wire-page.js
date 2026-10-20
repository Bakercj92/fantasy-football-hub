// THE WIRE.
//
// Three questions, in order of how much they are worth and how sure they are:
// who beats somebody you are starting, whose job just opened, and who is
// quietly getting the work before the projection notices.
//
// TWO SENTENCES THE ORIGINAL REPEATS AND THIS KEEPS VERBATIM, because both
// are claims about what this tool refuses to do:
//
//   "No bid figure here, deliberately - nothing in the free data supports one,
//    and a number we modelled would look like a number we measured."
//
//   "This is a projection gap, not a matchup read."
//
// Appearance condition: at least one free agent beats a current starter, or is
// trending sharply up in real usage, or a job opened. Otherwise the block does
// not exist - there is no browsable free-agent list here on purpose.

import { esc } from "./shell.js";
import { defVerdict } from "./logic/defence.js";
import { wireTally } from "./logic/wire.js";
import { n1, sgn, usagePhrase, vegasPhrase, injuryPhrase } from "./copy.js";

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
function upgradeRow(p, state, i) {
  const over = p.over
    ? `over <b>${esc(p.over.name)}</b> in your ${esc(p.slot)}`
    : `into your empty ${esc(p.slot)}`;
  const adds = state?.trending?.get(p.id);
  const id = `wu-${i}`;
  const why = `
    ${esc(p.name)} projects <b>${n1(p.pts)}</b> at this league's scoring${
      p.opponent ? ` vs ${esc(p.opponent)}` : ""}${
      typeof p.vor === "number" ? ` — <b>${sgn(p.vor)}</b> over the best free ${esc(p.pos)}` : ""}.
    ${p.over ? `${esc(p.over.name)} projects <b>${n1(p.over.pts)}</b>.` : ""}
    The gap clears the ${n1(p.gate)}-point threshold this league's own numbers set, which is the
    same gate the start/sit calls use — so if you claim him, the lineup page will tell you to
    start him.
    ${usagePhrase(p)}
    ${typeof adds === "number"
      ? `<div class="mkt">${adds.toLocaleString()} managers added him in the last 48 hours.</div>` : ""}
    ${vegasPhrase(p) ? `<div class="veg">${vegasPhrase(p)}</div>` : ""}`;
  return disc(id, `<b>Claim ${esc(p.name)}</b> <span class="over">${over}</span>`,
    `<span class="tag ${p.gap > 0 ? "good" : ""}">${sgn(p.gap)}</span>`, why);
}

// ---------------------------------------------------------------------------
// Trending up, not yet projected up.
//
// The one block on the wire whose number is deliberately NOT the reason to
// claim: he projects low, and that is exactly why he is still free.
// ---------------------------------------------------------------------------
function riserRow(p, i) {
  const bits = [];
  if (p.snapJump !== null && p.snapJump !== undefined) bits.push(`snap share up <b>${p.snapJump}%</b>`);
  if (p.oppJump !== null && p.oppJump !== undefined) bits.push(`touches up <b>${p.oppJump}%</b>`);
  // Named distinctly: air yards is what makes this a claim about NEXT week
  // rather than a summary of last week.
  if (p.ayJump != null) bits.push(`air-yards share up <b>${p.ayJump}%</b>`);
  if (p.woprJump != null) bits.push(`share of the passing game up <b>${p.woprJump}%</b>`);
  const id = `wr-${i}`;
  const why = `
    ${bits.length ? `${bits.join(", ")} over his last three games against his own season average.` : ""}
    ${usagePhrase(p)}
    This is the claim you make before the projection catches up — he projects only
    <b>${n1(p.pts)}</b> this week, which is exactly why he is still free.
    ${typeof p.adds === "number"
      ? `<div class="mkt">${p.adds.toLocaleString()} managers added him in the last 48 hours.</div>` : ""}`;
  return disc(id, `<b>${esc(p.name)}</b> <span class="over">${esc(p.pos)} · ${esc(p.team)} — trending up</span>`,
    `<span class="tag">${p.adds ? `+${p.adds.toLocaleString()}` : "usage"}</span>`, why);
}

// ---------------------------------------------------------------------------
// The standing defence seat. Present every week, including the weeks the
// answer is "yours is fine" - a quiet seat is quiet because it was checked.
// The ten-branch precedence lives in logic/defence.js and is tested against
// the original there; this is only the copy for each kind.
// ---------------------------------------------------------------------------
function defenceRow(d) {
  const v = defVerdict(d);
  if (!v) return "";
  const best = v.best
    ? `<b>${esc(v.best.name)}</b> (${n1(v.best.pts)}${
        v.best.opponent ? ` vs ${esc(v.best.opponent)}` : ""})`
    : "";
  const slot = esc(v.slot);
  let head, tag, why;

  switch (v.kind) {
    case "no-projections":
      head = `<b>No defence projections yet</b> <span class="over">for your ${slot}</span>`;
      tag = "—";
      why = `Sleeper has not published defence projections for this week, so every defence
             prices at zero and there is no comparison to make. This row will answer itself
             once the feed fills in.`;
      break;
    case "all-locked":
      head = `<b>Every free defence has already played</b> <span class="over">${
        v.kind === "all-locked" && (d.empty || d.unresolved)
          ? `and your ${slot} is ${d.empty ? "empty" : "unresolved"}`
          : `holding your ${slot}`}</span>`;
      tag = "—";
      why = `There is nothing claimable at defence this week — every free one has kicked off,
             so Sleeper would refuse the swap whatever the projections said. Checked, and
             nothing to do.`;
      break;
    case "empty":
      head = `<b>Stream ${esc(v.best.name)}</b> <span class="over">into your empty ${slot}</span>`;
      tag = n1(v.best.pts);
      why = `Your ${slot} seat is empty. ${best} is the best free defence at this league's scoring.`;
      break;
    case "unresolved":
      head = `<b>Check your ${slot}</b> <span class="over">starter could not be resolved</span>`;
      tag = "—";
      why = `Something is in your ${slot} that this page could not look up, so there is no gap to
             report. The best free defence is ${best}. Missing data is not a bad defence —
             look at the seat yourself before acting.`;
      break;
    case "unprojected":
      head = `<b>${esc(v.current.name)} is not priced this week</b> <span class="over">in your ${slot}</span>`;
      tag = "—";
      why = `The feed carries no projection for ${esc(v.current.name)}, so the gap against ${best}
             is unknown rather than favourable.`;
      break;
    case "current-locked":
      head = `<b>${esc(v.current.name)} is locked</b> <span class="over">in your ${slot}</span>`;
      tag = v.gap === null ? "—" : sgn(v.gap);
      why = `${best} projects ${v.gap === null ? "differently" : `<b>${sgn(v.gap)}</b>`}, but
             ${esc(v.current.name)} has already kicked off, so Sleeper will refuse the swap this
             week. Worth remembering for next week.`;
      break;
    case "marginal":
      head = `<b>Marginal: ${esc(v.best.name)} over ${esc(v.current.name)}</b> <span class="over">in your ${slot}</span>`;
      tag = sgn(v.gap);
      why = `${best} against <b>${esc(v.current.name)}</b> (${n1(v.current.pts)}) — ${sgn(v.gap)},
             which is inside the precision of the projection feed itself. Shown because this row is
             shown every week, not because it is worth a claim.`;
      break;
    case "actionable":
      head = `<b>Stream ${esc(v.best.name)}</b> <span class="over">over <b>${esc(v.current.name)}</b> in your ${slot}</span>`;
      tag = sgn(v.gap);
      why = `${best} against <b>${esc(v.current.name)}</b> (${n1(v.current.pts)}) — a gap of
             <b>${sgn(v.gap)}</b> at this league's scoring. <b>This is a projection gap, not a
             matchup read.</b> Nothing on this page measures the offence either defence is about to
             face — that question has never been asked here, rather than asked and answered.
             What the numbers do support is narrower: the defence you are starting projects lower
             than one nobody owns.`;
      break;
    case "tie":
      // A TIE IS A REAL OUTCOME, NOT A WIN. Caught by rendering: every defence
      // in the fixture projects identically, which produced "X is the better
      // bet ... +0.0" - a verdict the number does not support.
      head = `<b>Nothing between them</b> <span class="over">holding your ${slot}</span>`;
      tag = "0.0";
      why = `${esc(v.current.name)} and <b>${esc(v.best.name)}</b> both project
             <b>${n1(v.best.pts)}</b> at this league's scoring, so there is no case either way.
             Not a recommendation to hold — just the absence of a reason to move.`;
      break;
    default:
      head = `<b>${esc(v.current.name)} is the better bet</b> <span class="over">holding your ${slot}</span>`;
      tag = sgn(v.gap);
      why = `${esc(v.current.name)} projects <b>${n1(v.current.pts)}</b> against ${best}.
             Nothing to do — shown every week on purpose, so a quiet defence seat is quiet
             because it was checked, not because nothing looked.`;
  }

  return disc("wdef", head, `<span class="tag${v.counts ? " good" : ""}">${tag}</span>`, why,
    v.counts ? "" : " calm");
}

// ---------------------------------------------------------------------------
// Just came free.
//
// The only block here that can speak before a game is played, and the only one
// whose evidence is a document rather than a measurement. That difference is
// carried in the copy: every line says who is hurt, how hurt, and which week's
// report it came from, because a reader who cannot audit the claim has to take
// it on faith - and this is the one surface where being early means being less
// certain. (ui.js:176-262)
// ---------------------------------------------------------------------------
function vacancyCard(L) {
  const v = L?.vacancies;
  if (!v?.any) return "";

  const vac = (v.vacancies || []).map((p, i) => {
    // A player the projection feed has never heard of is the BEST case for
    // this block, not a gap in it.
    const proj = p.unprojected
      ? `The projection feed has no number for him yet, which is most of why he is still free.`
      : `He projects <b>${n1(p.pts)}</b> this week.`;
    const why = `
      <b>${esc(p.over.nm)}</b> is ${injuryPhrase(p.over)}${
        p.over.prac && p.over.prac !== p.over.st ? ` and did not practise` : ""}, on the week
      ${p.over.wk} report${p.stale ? " — last week's, which is the complete one" : ""}.
      ${esc(p.nm)} is next on ${esc(p.tm)}'s depth chart and unrostered here. ${proj}
      ${p.climb ? `<div class="mkt">He had already moved up ${p.climb} place${
        p.climb > 1 ? "s" : ""} in the last eight days.</div>` : ""}
      ${p.disagree
        ? `<div class="mkt"><b>The chart and the usage disagree.</b> ${esc(p.disagree.nm)} is
           ${esc(p.pos)}${esc(p.disagree.rk)} on paper but has been getting
           <b>${n1(p.disagree.opp)}</b> touches a game, and he is free too. In full PPR that is
           often the one worth having — neither number settles it.</div>` : ""}`;
    return disc(`vac-${i}`,
      `<b>Claim ${esc(p.nm)}</b> <span class="over">${esc(p.tm)} ${esc(p.pos)}${esc(p.rk)} — behind ${esc(p.over.nm)}</span>`,
      `<span class="tag ${p.over.tier === "confirmed" ? "warn" : ""}">${
        p.over.tier === "confirmed" ? "confirmed" : "watch"}</span>`, why);
  }).join("");

  const promo = (v.promotions || []).map((p, i) => disc(`promo-${i}`,
    `<b>${esc(p.nm)}</b> <span class="over">${esc(p.tm)} ${esc(p.pos)}${esc(p.rk)} — moved up ${esc(p.climb)}</span>`,
    `<span class="tag">depth</span>`,
    `${esc(p.tm)} moved him up ${p.climb} place${p.climb > 1 ? "s" : ""} in the last eight days with
     nobody hurt in front of him, which is a coaching decision rather than news — it is not
     reported anywhere and it reaches a box score a week from now.
     ${typeof p.opp === "number" ? `He is at <b>${n1(p.opp)}</b> touches a game.` : ""}
     ${p.unprojected ? `The projection feed still has no number for him.` : ""}`)).join("");

  // HOW MUCH OF THE LEAGUE HAS ACTUALLY FILED. nflverse ingests the practice
  // report club by club, so a Tuesday-evening build holds a nearly empty
  // current week beside a complete previous one. Rendering two clubs as though
  // they were thirty-two is the lie this sentence exists to prevent.
  const caveat = v.partial
    ? `Only <b>${v.teamsReported}</b> of 32 clubs have filed a week ${v.week} report so far, so
       this week's half of the list is incomplete — it fills in through Friday. `
    : "";

  // A PLAIN CARD, NOT AN ACTION CARD. The design system reserves the action
  // colour for the single thing on a page that IS the answer - on Lineup that
  // is the calls block, and it is one card. Giving both wire cards the same
  // treatment made two full-bleed gold panels covering the whole page, which
  // is not emphasis, it is wallpaper. The per-row tags carry the signal here,
  // exactly as they do on Today.
  return `<section class="card">
    <h2>◎ Just came free
      <span class="ct">${(v.vacancies?.length || 0) + (v.promotions?.length || 0)} worth a look</span></h2>
    ${vac}
    ${promo ? `<h3 class="subhd">Promoted, with nobody hurt</h3>${promo}` : ""}
    <div class="note">${caveat}Depth chart as of ${esc(String(v.depthAsOf || "").slice(0, 10))}.
      <b>No bid figure here either</b> — the same reason as the wire below.</div>
  </section>`;
}

// ---------------------------------------------------------------------------
function disc(id, head, tag, body, cls = "") {
  return `<div class="disc${cls}">
    <button class="dischd" aria-expanded="false" aria-controls="${esc(id)}">
      <span class="dl">${head}</span>${tag}</button>
    <div class="discbody" id="${esc(id)}" hidden>${body}</div>
  </div>`;
}

function waiverCard(L, state) {
  const w = L?.waivers;
  if (!w?.any) return "";
  const up = (w.upgrades || []).map((p, i) => upgradeRow(p, state, i)).join("");
  const ri = (w.risers || []).map((p, i) => riserRow(p, i)).join("");
  const def = defenceRow(w.def);

  const faab = typeof L.faabLeft === "number"
    ? `You have <b>$${esc(L.faabLeft)}</b> of FAAB left. <b>No bid figure here, deliberately</b>
       — nothing in the free data supports one, and a number we modelled would look like a
       number we measured. `
    : "";

  return `<section class="card">
    <h2>◎ The wire <span class="ct">${wireTally(w)} worth a look</span></h2>
    ${up}
    ${ri ? `<h3 class="subhd">Trending up, not yet projected up</h3>${ri}` : ""}
    ${def ? `<h3 class="subhd">Your defence, checked every week</h3>${def}` : ""}
    <div class="note">${faab}Open a line for why.</div>
  </section>`;
}

export function wirePage(L, state) {
  if (!L) return `<section class="card quiet"><div class="stub">No league selected.</div></section>`;
  const body = vacancyCard(L) + waiverCard(L, state);
  if (body) return body;
  // ONLY CLAIM WHAT WAS ACTUALLY MEASURED.
  //
  // "nobody's job opened" was asserted unconditionally, but the vacancy layer
  // fails SILENTLY by design - js/vacancy.js:71-77 returns ok:false and the
  // block simply disappears. On a load where that fetch 404s, the page was
  // reporting a check it had not run. ui.js made no claim at all here: the
  // block vanished. The sentence is assembled from what is actually in hand.
  const vacOut = !L.vacancies || L.vacancies.ok === false;
  const checked = ["no free agent beats anyone you are starting"];
  if (!vacOut) checked.push("nobody's job opened");
  checked.push("nobody is trending up sharply enough to be worth it");
  return `<section class="card quiet">
    <div class="ok">\u2713 Wire checked \u2014 nothing worth a claim.</div>
    <div class="note">${checked.slice(0, -1).join(", ")} and ${checked[checked.length - 1]}.
      ${vacOut ? `<b>The depth-chart layer did not load this time</b>, so whose job just opened
        was not checked at all \u2014 that is a gap in this answer, not a finding.` : ""}
      There is no browsable free-agent list here on purpose: a list you have to read is a list
      you will stop reading.</div>
  </section>`;
}

export { defenceRow, waiverCard, vacancyCard, upgradeRow, riserRow };

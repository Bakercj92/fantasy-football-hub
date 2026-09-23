import { compare } from "./compare.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n1 = (v) => (typeof v === "number" ? v.toFixed(1) : "—");
const sgn = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : "—");

export function setLoading(msg) {
  $("#app").innerHTML = `<div class="loading"><span class="spin"></span>${esc(msg)}…</div>`;
}

export function renderError(err) {
  $("#app").innerHTML = `<div class="err"><b>Couldn't load.</b>
    <div class="mono">${esc(err.message || err)}</div>
    <p>Everything here is fetched live. If Sleeper is unreachable there is nothing cached
    to fall back on — deliberately: a stale lineup is worse than no lineup.</p></div>`;
  console.error(err);
}

const INJ = {
  Out: ["out","OUT"], Doubtful: ["dbt","DBT"], Questionable: ["q","Q"],
  IR: ["ir","IR"], PUP: ["pup","PUP"], Sus: ["sus","SUS"], COV: ["cov","COV"], NA: ["out","N/A"],
};
// Kickoff, in the reader's own timezone. Chris is Eastern, so for him this
// renders the same wall-clock the feed publishes - but a reader in another
// zone gets their own, because the underlying value is a real UTC instant
// rather than a string with an offset baked into it.
const kickLabel = (ms) =>
  typeof ms === "number"
    ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
    : "";

const lockCell = (p) => {
  if (!p?.game || typeof p.game.kickoffUTC !== "number") return "";
  return p.locked
    ? `<span class="lock" title="Kicked off ${esc(kickLabel(p.game.kickoffUTC))} — Sleeper will not move him now">&#128274;</span>`
    : `<span class="kick">${esc(kickLabel(p.game.kickoffUTC))}</span>`;
};

// The Vegas read, as a sentence rather than a column. It belongs in the why
// behind a call, not in the reference table - the table is already six
// columns wide and this tool is meant to be quiet by default.
function vegasPhrase(p) {
  const v = p?.vegas;
  if (!v || typeof v.spread !== "number") return "";
  const side =
    v.spread > 0 ? `favoured by ${n1(v.spread)}`
    : v.spread < 0 ? `an underdog by ${n1(-v.spread)}`
    : "a pick'em";
  return `${esc(p.team)} is ${side} in a ${n1(v.total)}-point game — implied team total <b>${n1(v.implied)}</b>.`;
}

const chip = (s) => {
  if (!s) return "";
  const [cls, label] = INJ[s] || ["q", String(s).slice(0, 3).toUpperCase()];
  return `<span class="chip ${cls}" title="${esc(s)}">${esc(label)}</span>`;
};

// THE DAY-SHAPED PAGE.
//
// A fantasy week has five different moments and the old tool had one view for
// all of them. Chris asked for the page to be genuinely different depending on
// when he opens it, and this is where that lives.
//
// The plan is an ORDER, not a set of switches. Almost every block on this page
// already hides itself when it has nothing to say - that is the exception-based
// rule the rebuild is built on - so the day's job is to decide what sits at the
// top, not to suppress things arbitrarily. Two blocks are genuinely day-gated,
// and both for a reason you can state in a sentence:
//
//   recap    - Tuesday and Wednesday only. It grades a week that has finished
//              and been published. On Sunday there is nothing to grade, and a
//              scoreboard of last week's mistakes while you are setting this
//              week's lineup is a distraction, not information.
//   waivers  - every day, because a free agent is claimable every day, but it
//              rides at the top on Tuesday and Wednesday when claims process.
//
// This is also the standing guardrail for everything built from here on. The
// old rule - "a new surface must replace a named old one" - fires on none of
// the rebuild phases, because no old surfaces are left to retire. Its
// successor: A NEW SECTION MUST BE INVISIBLE BY DEFAULT AND MUST NAME THE
// CONDITION UNDER WHICH IT APPEARS. Every section below declares one.
// EVERY PLAN CONTAINS `compare` AND `locked`, AND THAT IS NOT AN OVERSIGHT.
//
// Monday's plan originally omitted compare. The selector button renders on
// every row regardless, so tapping it on a Monday marked the row, grew the
// selection, fired a Sleeper request per player - and painted nothing, with no
// clear button to escape. A control that is always present must always have
// somewhere to land.
//
// `locked` was Sunday and Monday only, which made a Thursday-night lockout
// invisible until the following Sunday. Both blocks hide themselves when they
// have nothing to say, so carrying them every day costs exactly nothing.
const PLANS = {
  0: ["sched", "calls", "compare", "locked", "lineup", "bench", "vacancy", "waivers", "market"], // Sunday
  1: ["sched", "calls", "locked", "compare", "lineup", "bench", "vacancy", "waivers", "market"], // Monday
  2: ["sched", "recap", "vacancy", "waivers", "calls", "compare", "locked", "lineup", "bench", "market"],
  3: ["sched", "vacancy", "waivers", "recap", "calls", "compare", "locked", "lineup", "bench", "market"],
  4: ["sched", "calls", "compare", "locked", "lineup", "bench", "vacancy", "waivers", "market"], // Thursday
  5: ["sched", "calls", "compare", "locked", "lineup", "bench", "vacancy", "waivers", "market"], // Friday
  6: ["sched", "calls", "compare", "locked", "lineup", "bench", "vacancy", "waivers", "market"], // Saturday
};

const DAY_NOTE = {
  0: "Sunday — lineup first, and anything already locked.",
  1: "Monday — what ran, and what is still claimable.",
  2: "Tuesday — last week graded, then the wire.",
  3: "Wednesday — claims process today.",
  4: "Thursday — check anyone in tonight's game before kickoff.",
  5: "Friday — quiet. Lineup and the wire.",
  6: "Saturday — quiet. Lineup and the wire.",
};

export const dayPlan = (day = new Date().getDay()) => PLANS[day] || PLANS[6];
export const dayNote = (day = new Date().getDay()) => DAY_NOTE[day] || "";
export function visible(section, day = new Date().getDay()) {
  return dayPlan(day).includes(section);
}

export function render(state, handlers) {
  const { onSwitch, onToggle, onClear } = handlers;
  const L = state.leagues[state.active];
  const day = state.day ?? new Date().getDay();

  const tabs = state.cfg.leagues.map((e) =>
    `<button class="tab${e.key === state.active ? " on" : ""}" data-k="${esc(e.key)}">${esc(e.name)}</button>`
  ).join("");

  // Every section is a function of (league, state). The day decides the order
  // and nothing else knows what day it is.
  const SECTIONS = {
    sched:   () => scheduleWarning(state, L),
    calls:   () => callsBlock(L),
    compare: () => compareBlock(L, state),
    recap:   () => recapBlock(L, state),
    vacancy: () => vacancyBlock(L, state),
    waivers: () => waiverBlock(L, state),
    locked:  () => lockedBlock(L),
    lineup:  () => lineupTable(L, state),
    bench:   () => benchTable(L, state),
    market:  () => marketBlock(L, state),
  };

  $("#app").innerHTML = `
    <header>
      <div class="title">Fantasy Football Hub</div>
      <div class="wk">Week ${state.week} · ${esc(state.season)}</div>
    </header>
    <nav class="tabs">${tabs}</nav>
    <div class="daynote">${esc(dayNote(day))}</div>
    ${dayPlan(day).map((key) => (SECTIONS[key] ? SECTIONS[key]() : "")).join("")}
    ${footer(L, state)}`;

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => onSwitch(b.dataset.k)));
  document.querySelectorAll(".call").forEach((el) =>
    el.addEventListener("click", () => el.classList.toggle("open")));
  // The compare selector sits inside a table row that is not itself clickable,
  // so the toggle handles its own click and stops it there.
  document.querySelectorAll("[data-sel]").forEach((el) =>
    el.addEventListener("click", (ev) => { ev.stopPropagation(); onToggle(el.dataset.sel); }));
  const clear = document.querySelector("[data-clear]");
  if (clear) clear.addEventListener("click", onClear);
  document.querySelectorAll(".mrow").forEach((el) =>
    el.addEventListener("click", () => el.classList.toggle("open")));
}

// ---------------------------------------------------------------------------
// Just came free. Appearance condition: somebody's job opened and the man next
// in line for it is still unrostered in THIS league, or the depth chart moved
// somebody up without an injury at all.
//
// This is the only block on the page that can speak before a game is played,
// and the only one whose evidence is a document rather than a measurement.
// That difference is carried in the copy: every line here says who is hurt,
// how hurt, and which week's report it came from, because a reader who cannot
// audit the claim has to take it on faith - and this is the one surface where
// being early means being less certain.
// ---------------------------------------------------------------------------
function vacancyBlock(L, state) {
  const v = L.vacancies;
  if (!v?.any) return "";

  // "Questionable, Ankle and did not practise" is accurate and reads like a
  // form. The status is a judgement and the injury is a body part, so they
  // join with a preposition rather than a comma.
  const inj = (o) => {
    if (!o.inj) return o.st;
    const w = String(o.inj).toLowerCase();
    // Ankle, oblique, illness, elbow, Achilles. Caught by rendering, which is
    // the only place a missing article was ever going to show up.
    return `${o.st} with ${/^[aeiou]/.test(w) ? "an" : "a"} ${w}`;
  };

  const vac = v.vacancies.map((p) => {
    // A player the projection feed has never heard of is the BEST case for
    // this block, not a gap in it - so the row says so plainly rather than
    // printing an em dash and hoping nobody asks.
    const proj = p.unprojected
      ? `The projection feed has no number for him yet, which is most of why he is still free.`
      : `He projects <b>${n1(p.pts)}</b> this week.`;
    return `<div class="call">
      <div class="line"><b>Claim ${esc(p.nm)}</b>
        <span class="over">${esc(p.tm)} ${esc(p.pos)}${p.rk} — behind ${esc(p.over.nm)}</span>
        <span class="delta">${p.over.tier === "confirmed" ? "confirmed" : "watch"}</span></div>
      <div class="why">
        <b>${esc(p.over.nm)}</b> is ${esc(inj(p.over))}${
          p.over.prac && p.over.prac !== p.over.st
            ? ` and did not practise` : ""}, on the week ${p.over.wk} report${
          p.stale ? " — last week's, which is the complete one" : ""}.
        ${esc(p.nm)} is next on ${esc(p.tm)}'s depth chart and unrostered here. ${proj}
        ${p.climb ? `<div class="mkt">He had already moved up ${p.climb} place${p.climb > 1 ? "s" : ""} in the last eight days.</div>` : ""}
        ${p.disagree
          ? `<div class="mkt"><b>The chart and the usage disagree.</b> ${esc(p.disagree.nm)} is
             ${esc(p.pos)}${p.disagree.rk} on paper but has been getting
             <b>${n1(p.disagree.opp)}</b> touches a game, and he is free too. In full PPR
             that is often the one worth having — neither number settles it.</div>`
          : ""}
      </div></div>`;
  }).join("");

  const promo = v.promotions.map((p) => `<div class="call">
      <div class="line"><b>${esc(p.nm)}</b>
        <span class="over">${esc(p.tm)} ${esc(p.pos)}${p.rk} — moved up ${p.climb}</span>
        <span class="delta">depth</span></div>
      <div class="why">
        ${esc(p.tm)} moved him up ${p.climb} place${p.climb > 1 ? "s" : ""} in the last eight
        days with nobody hurt in front of him, which is a coaching decision rather than news
        — it is not reported anywhere and it reaches a box score a week from now.
        ${typeof p.opp === "number" ? `He is at <b>${n1(p.opp)}</b> touches a game.` : ""}
        ${p.unprojected ? `The projection feed still has no number for him.` : ""}
      </div></div>`).join("");

  // HOW MUCH OF THE LEAGUE HAS ACTUALLY FILED.
  //
  // nflverse ingests the practice report club by club, so a Tuesday-evening
  // build holds a nearly empty current week beside a complete previous one.
  // Rendering two clubs as though they were thirty-two is the lie this
  // sentence exists to prevent.
  const caveat = v.partial
    ? `Only <b>${v.teamsReported}</b> of 32 clubs have filed a week ${v.week} report so far,
       so this week's half of the list is incomplete — it fills in through Friday.`
    : "";

  return `<section class="calls act vacancy">
    <div class="hd">◎ Just came free
      <span class="tot">${v.vacancies.length + v.promotions.length} worth a look</span></div>
    ${vac}
    ${promo ? `<div class="subhd">Promoted, with nobody hurt</div>${promo}` : ""}
    <div class="sub">${caveat}
      Depth chart as of ${esc(String(v.depthAsOf || "").slice(0, 10))}.
      <b>No bid figure here either</b> — the same reason as the wire below.</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Waivers. Appearance condition: at least one free agent either beats a
// current starter this week, or is trending sharply up in real usage.
// Otherwise this block does not exist. There is no browsable free-agent list
// here on purpose - Sleeper already has one, and a better one.
// ---------------------------------------------------------------------------
function waiverBlock(L, state) {
  const w = L.waivers;
  if (!w?.any) return "";

  const up = w.upgrades.map((p) => {
    const over = p.over
      ? `over <b>${esc(p.over.name)}</b> in your ${esc(p.slot)}`
      : `into your empty ${esc(p.slot)}`;
    const adds = state.trending?.get(p.id);
    return `<div class="call">
      <div class="line"><b>Claim ${esc(p.name)}</b>
        <span class="over">${over}</span>
        <span class="delta">${sgn(p.gap)}</span></div>
      <div class="why">
        ${esc(p.name)} projects <b>${n1(p.pts)}</b> at this league's scoring${
          p.opponent ? ` vs ${esc(p.opponent)}` : ""}${
          typeof p.vor === "number" ? ` — <b>${sgn(p.vor)}</b> over the best free ${esc(p.pos)}` : ""}.
        ${p.over ? `${esc(p.over.name)} projects <b>${n1(p.over.pts)}</b>.` : ""}
        The gap clears the ${n1(p.gate)}-point threshold this league's own numbers set,
        which is the same gate the start/sit calls use — so if you claim him, the lineup
        block above will tell you to start him.
        ${usagePhrase(p)}
        ${typeof adds === "number" ? `<div class="mkt">${adds.toLocaleString()} managers added him in the last 48 hours.</div>` : ""}
        ${vegasPhrase(p) ? `<div class="veg">${vegasPhrase(p)}</div>` : ""}
      </div></div>`;
  }).join("");

  const ri = w.risers.map((p) => {
    const bits = [];
    if (p.snapJump !== null) bits.push(`snap share up <b>${p.snapJump}%</b>`);
    if (p.oppJump !== null) bits.push(`touches up <b>${p.oppJump}%</b>`);
    // The leading pair, named distinctly: "air yards" is what makes this a
    // claim about next week rather than a summary of last week.
    if (p.ayJump != null) bits.push(`air-yards share up <b>${p.ayJump}%</b>`);
    if (p.woprJump != null) bits.push(`share of the passing game up <b>${p.woprJump}%</b>`);
    return `<div class="call">
      <div class="line"><b>${esc(p.name)}</b>
        <span class="over">${esc(p.pos)} · ${esc(p.team)} — trending up</span>
        <span class="delta">${p.adds ? `+${p.adds.toLocaleString()}` : "usage"}</span></div>
      <div class="why">
        ${bits.join(", ")} over his last three games against his own season average.
        ${usagePhrase(p)}
        This is the claim you make before the projection catches up — he projects only
        <b>${n1(p.pts)}</b> this week, which is exactly why he is still free.
        ${typeof p.adds === "number" ? `<div class="mkt">${p.adds.toLocaleString()} managers added him in the last 48 hours.</div>` : ""}
      </div></div>`;
  }).join("");

  const faab = typeof L.faabLeft === "number"
    ? `You have <b>$${L.faabLeft}</b> of FAAB left. <b>No bid figure here, deliberately</b> —
       nothing in the free data supports one, and a number we modelled would look like a
       number we measured.`
    : "";

  return `<section class="calls act waivers">
    <div class="hd">◎ The wire
      <span class="tot">${w.upgrades.length + w.risers.length} worth a look</span></div>
    ${up}
    ${ri ? `<div class="subhd">Trending up, not yet projected up</div>${ri}` : ""}
    <div class="sub">${faab} Tap a line for why.</div>
  </section>`;
}

// Usage, as a sentence, only when there is enough of it to mean something.
function usagePhrase(p) {
  const u = p?.usage;
  if (!u || !u.games) return "";
  const bits = [];
  if (typeof u.snapPct === "number") bits.push(`${Math.round(u.snapPct * 100)}% of snaps`);
  if (typeof u.oppPerGame === "number") bits.push(`${n1(u.oppPerGame)} touches a game`);
  if (typeof u.tgtShare === "number" && u.tgtShare > 0)
    bits.push(`${Math.round(u.tgtShare * 100)}% of targets`);
  if (!bits.length) return "";
  return `<div class="mkt">Measured usage over ${u.games} game${u.games > 1 ? "s" : ""}:
    ${bits.join(", ")}.</div>`;
}

// ---------------------------------------------------------------------------
// The Tuesday recap. Appearance condition: it is Tuesday or Wednesday AND
// there is at least one finished, published week with a recorded decision in
// it. Silent all the rest of the week, by Chris's decision - a running
// scoreboard while you are setting a lineup is a distraction.
// ---------------------------------------------------------------------------
function recapBlock(L, state) {
  const r = L.recap;
  if (!r?.any) return "";

  const rows = r.rows.slice(0, 6).map((row) => {
    if (row.kind === "lineup") {
      const took = row.delta <= 0;
      return `<div class="call">
        <div class="line"><b>Week ${row.week}</b>
          <span class="over">${took
            ? "your lineup held up"
            : "the suggested lineup would have scored more"}</span>
          <span class="delta${took ? " good" : ""}">${sgn(row.delta)}</span></div>
        <div class="why">
          You scored <b>${n1(row.yours)}</b>. The lineup this tool put in front of you
          scored <b>${n1(row.suggested)}</b>.
          ${took
            ? `Taking the call would have cost you ${n1(Math.abs(row.delta))}. Projections are
               not results, and a call being wrong once does not make it a bad call — the
               threshold exists because single weeks are noisy.`
            : `Worth ${n1(row.delta)} if you had taken it.`}
          ${row.partial
            ? `<div class="mkt">Only ${Math.round(row.coverage * 100)}% of those players have
               published stats yet, so this week is partial and is left out of the totals
               above.</div>` : ""}
        </div></div>`;
    }
    return `<div class="call">
      <div class="line"><b>Week ${row.week}</b>
        <span class="over">locked out — ${esc(row.players.slice(0, 3).join(", "))}</span>
        <span class="delta">${row.delta === null ? "—" : sgn(row.delta)}</span></div>
      <div class="why">
        ${row.couldHaveStarted !== null
          ? `Who you could not start scored <b>${n1(row.couldHaveStarted)}</b>.` : ""}
        ${row.hadToStart !== null
          ? `Who you were stuck with scored <b>${n1(row.hadToStart)}</b>.` : ""}
        ${row.delta !== null && row.delta > 0
          ? `Being locked out actually cost <b>${n1(row.delta)}</b> that week.`
          : `It cost nothing in the end.`}
      </div></div>`;
  }).join("");

  return `<section class="calls recap">
    <div class="hd">↩ Last week
      <span class="tot">${r.netLineup === null
        ? ""
        : `calls ${sgn(r.netLineup)} pts across ${r.weeks} wk`}${
        r.netLocked === null ? "" : ` · locked out ${sgn(r.netLocked)}`}</span></div>
    ${rows}
    <div class="sub">Scored from real results, re-scored at this league's own rules — not the
      vendor's PPR total. Only weeks nflverse has actually published are graded.
      <b>This log lives in this browser on this device</b>, so a lineup set on your phone is not
      in it. Calls and lockouts are totalled separately — a lockout is not a decision you got
      wrong.${r.partialCount ? ` ${r.partialCount} week${r.partialCount > 1 ? "s are" : " is"}
      still partly unpublished and excluded from the totals.` : ""} Tap a line for the numbers.</div>
  </section>`;
}

function compareBlock(L, state) {
  const sel = state.selection[state.active] || new Set();
  if (sel.size === 0) return "";

  if (sel.size === 1) {
    const only = L.byId.get([...sel][0]);
    return `<section class="cmp one">
      <div class="hd">Compare <button class="clr" data-clear>clear</button></div>
      <div class="sub">${esc(only?.name || "Player")} picked. Choose at least one more —
        tap the ⚖ next to any player in your lineup or on your bench.</div>
    </section>`;
  }

  const c = compare([...sel], { byId: L.byId, sigma: L.sigma, slots: L.slots });
  // Fewer than two of the selected ids still resolve - a drop or a trade
  // between re-solves. Returning "" here would take the clear button with it
  // and strand the selection with no way to dismiss it.
  if (c.mode === "empty") {
    return `<section class="cmp one">
      <div class="hd">Compare <button class="clr" data-clear>clear</button></div>
      <div class="sub">The players you picked are no longer on this roster.</div>
    </section>`;
  }

  const heads = c.players.map((p) =>
    `<td class="cp"><span class="cn">${esc(p.name)}</span><span class="pos">${esc(p.pos)}</span>${
      p.injury ? chip(p.injury) : ""}${p.locked ? '<span class="lock" title="already kicked off">&#128274;</span>' : ""}</td>`
  ).join("");

  const rows = c.rows.map((r) => `
    <tr class="mrow" title="tap for what this means">
      <td class="ml">${esc(r.label)}</td>
      ${r.cells.map((cell) => `<td class="cv${cell.best ? " win" : ""}">${esc(cell.text)}</td>`).join("")}
    </tr>
    <tr class="mnote"><td colspan="${c.players.length + 1}">${esc(r.note)}</td></tr>`).join("");

  const head = c.mode === "head-to-head"
    ? `<div class="verdict${c.verdict.decisive ? " yes" : " tie"}">${esc(c.verdict.text)}</div>
       <div class="sub">${esc(c.verdict.why)}</div>`
    : `<div class="verdict">Ranked by ${esc(c.axis ? c.axis.label.toLowerCase() : "projection")}</div>
       <div class="sub">${c.players.length} players${c.mixed
         ? ` across ${esc(c.positions.join("/"))} — only numbers that mean the same thing in every
            one of those positions are shown.` : ` at ${esc(c.positions[0] || "")}.`}</div>`;

  const dropped = c.droppedForMixing.length
    ? `<div class="frow warn"><b>Hidden because you are comparing across positions:</b>
        ${esc(c.droppedForMixing.join(", "))}. Consensus is published per position, so an RB12 and a
        WR12 are not the same claim — showing them side by side would invent a comparison that does
        not exist. Pick players at one position to see them.</div>`
    : "";

  const waiting = c.players.some((p) => p.ros === undefined)
    ? `<div class="frow pending">Pulling rest-of-season…</div>` : "";

  return `<section class="cmp">
    <div class="hd">Compare <span class="ct">${c.players.length}</span>
      <button class="clr" data-clear>clear</button></div>
    ${head}
    <div class="scroll"><table class="cmpt">
      <tr class="th"><td class="ml"></td>${heads}</tr>
      ${rows}
    </table></div>
    ${waiting}
    ${dropped}
    ${L.fcalc && !L.fcalc.ok
      ? `<div class="frow warn">Market values unavailable this load — the value and rank rows are
          hidden rather than guessed.</div>` : ""}
  </section>`;
}

function callsBlock(L) {
  const c = L.calls;
  if (!c.actionable) {
    return `<section class="calls quiet">
      <div class="ok">✓ Lineup checked — nothing to change.</div>
      <div class="sub">Best legal lineup is the one you already have${
        c.gain > 0 ? `, within ${n1(c.gain)} pt` : ""}. Threshold ${n1(c.threshold)} pt
        <span class="hint">(½σ for the positions involved, floor 1.0)</span>.</div>
    </section>`;
  }

  const pairs = [];
  const len = Math.max(c.entering.length, c.leaving.length);
  for (let i = 0; i < len; i++) pairs.push([c.entering[i] || null, c.leaving[i] || null]);

  const rows = pairs.map(([inP, outP]) => {
    const forced = outP && outP.startable === false;
    const delta = (inP?.pts ?? 0) - (outP?.pts ?? 0);
    const head = forced
      ? `<b>Sit ${esc(outP.name)}</b> <span class="over">— ruled ${esc(outP.injury || "out")}</span>${
          inP ? ` <span class="over">· start ${esc(inP.name)}</span>` : ""}`
      : `<b>Start ${esc(inP?.name ?? "—")}</b>${outP ? ` <span class="over">over ${esc(outP.name)}</span>` : ""}`;
    const tag = forced ? `<span class="delta forced">must</span>`
                       : `<span class="delta">${sgn(delta)}</span>`;
    const why = forced
      ? `${esc(outP.name)} is listed <b>${esc(outP.injury)}</b>. The feed still publishes a projection
         for him (${n1(outP.pts)}) because that is what he would score if he played — he will not, so
         his real total is zero. That is why this call ignores the threshold.
         ${inP ? `${esc(inP.name)} projects <b>${n1(inP.pts)}</b>${inP.opponent ? ` vs ${esc(inP.opponent)}` : ""}.` : ""}
         ${inP && vegasPhrase(inP) ? `<div class="veg">${vegasPhrase(inP)}</div>` : ""}`
      : `${esc(inP?.name)} projects <b>${n1(inP?.pts)}</b> at this league's scoring${
          inP?.opponent ? ` vs ${esc(inP.opponent)}` : ""}${inP?.injury ? ` · <span class="inj">${esc(inP.injury)}</span>` : ""}
         ${typeof inP?.vor === "number" ? `— that is <b>${sgn(inP.vor)}</b> over the best free ${esc(inP.pos)} in this league.` : "."}
         ${outP ? `${esc(outP.name)} projects <b>${n1(outP.pts)}</b>${outP.opponent ? ` vs ${esc(outP.opponent)}` : ""}${
           outP.injury ? ` · <span class="inj">${esc(outP.injury)}</span>` : ""}.` : ""}
         ${[vegasPhrase(inP), vegasPhrase(outP)].filter(Boolean).map((t) => `<div class="veg">${t}</div>`).join("")}
         ${marketLine(inP, outP)}
         <div class="mono small">${(inP?.why || []).map((w) => `${esc(w.key)} ${w.projected}×${w.weight}`).join(" · ")}</div>`;
    return `<div class="call${forced ? " hard" : ""}">
      <div class="line">${head}${tag}</div><div class="why">${why}</div></div>`;
  }).join("");

  const net = sgn(c.gain);
  return `<section class="calls act">
    <div class="hd">⚠ ${pairs.length} thing${pairs.length > 1 ? "s" : ""} to do
      <span class="tot">${c.forced?.length ? `${c.forced.length} forced · ` : ""}net ${net} pts</span></div>
    ${rows}
    <div class="sub">Tap a line for why. Threshold ${n1(c.threshold)} pt${
      c.forced?.length ? "; forced calls ignore it." : "."}</div>
  </section>`;
}

function marketLine(inP, outP) {
  const a = inP?.market, b = outP?.market;
  if (!a && !b) return "";
  const bits = [];
  if (a?.posRank) bits.push(`consensus has ${esc(inP.name)} at <b>${esc(a.posRank)}</b>${a.grade ? ` (${esc(a.grade)})` : ""}`);
  if (b?.posRank) bits.push(`${esc(outP.name)} at <b>${esc(b.posRank)}</b>${b.grade ? ` (${esc(b.grade)})` : ""}`);
  return bits.length ? `<div class="mkt">Market: ${bits.join(" · ")}.</div>` : "";
}

function row(p, slot, selected = false) {
  // The leading empty selector cell is NOT optional. The header is seven
  // columns with .sel first; without it the slot label renders under the
  // selector header and everything after shifts one column left. The colspan
  // was bumped 5->6 when the column was added and this cell was forgotten,
  // which the render sweep missed because it only ever inspected row 0.
  if (!p) return `<tr><td class="sel"></td><td class="slot">${esc(slot)}</td>` +
    `<td colspan="5" class="empty">— empty —</td></tr>`;
  const cls = [p.startable === false ? "dead" : "", p.locked ? "locked" : "", selected ? "picked" : ""]
    .filter(Boolean).join(" ");
  return `<tr${cls ? ` class="${cls}"` : ""}>
    <td class="sel"><button class="pick${selected ? " on" : ""}" data-sel="${esc(p.id)}"
      aria-pressed="${selected}" title="Compare ${esc(p.name)}">${selected ? "&#10003;" : "&#9878;"}</button></td>
    <td class="slot">${esc(slot)}</td>
    <td class="nm">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></td>
    <td class="tm">${esc(p.team)}</td>
    <td class="opp">${p.opponent ? esc(p.opponent) : '<span class="bye">bye</span>'}${lockCell(p)}</td>
    <td class="vor" title="points over the best free agent at this position in this league">${
      typeof p.vor === "number" ? sgn(p.vor) : ""}</td>
    <td class="pt">${p.hasProjection ? `${p.floorOnly ? "≥" : ""}${n1(p.pts)}` : '<span class="na">n/a</span>'}${chip(p.injury)}</td>
  </tr>`;
}

// EVERY header cell must carry its column's class.
//
// The table is `table-layout:fixed`, which takes all of its column widths from
// the FIRST row and ignores the widths on every row after it. Three of these
// cells had no class, so the .slot, .nm and .opp widths in the stylesheet were
// never applied to anything: the browser split the leftover space evenly and
// gave a player name 67 pixels at phone width, which broke "Starting
// Quarterback" across three lines mid-word. Present since Phase 1 and
// invisible until the Opp column grew a kickoff time.
const tableHead = `<tr class="th"><td class="sel"></td><td class="slot"></td><td class="nm">Player</td>
  <td class="tm">Tm</td><td class="opp">Opp</td>
  <td class="vor">VOR</td><td class="pt">Proj</td></tr>`;

function lineupTable(L, state) {
  const sel = state.selection[state.active] || new Set();
  const cur = L.slots.map((slot, i) => [slot, L.byId.get(String(L.starters[i]))]);
  return `<section class="block"><h2>Your lineup</h2>
    <table>${tableHead}${cur.map(([s, p]) => row(p, s, p ? sel.has(p.id) : false)).join("")}</table></section>`;
}

function benchTable(L, state) {
  const sel = state.selection[state.active] || new Set();
  const starting = new Set(L.starters.map(String));
  const bench = L.roster.filter((p) => !starting.has(p.id)).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
  if (!bench.length) return "";
  return `<section class="block"><h2>Bench <span class="ct">${bench.length}</span></h2>
    <table>${tableHead}${bench.map((p) => row(p, "BN", sel.has(p.id))).join("")}</table></section>`;
}

// The calls that stopped being possible. Never phrased as an instruction -
// there is nothing to do about them - and never shown when there are none.
function lockedBlock(L) {
  const m = L.missed;
  if (!m?.any) return "";
  const name = (p) => `${esc(p.name)} <span class="pos">${esc(p.pos)}</span>`;
  const bits = [];
  if (m.entering.length) bits.push(`could no longer start ${m.entering.map(name).join(", ")}`);
  if (m.leaving.length) bits.push(`could no longer sit ${m.leaving.map(name).join(", ")}`);
  return `<section class="block locked-out">
    <h2>Too late this week <span class="ct">${m.entering.length + m.leaving.length}</span></h2>
    <div class="frow">You ${bits.join(", and ")}. Their games had already kicked off, so
      Sleeper would refuse the change and the lineup above is solved around them.
      ${typeof m.cost === "number" && m.cost > 0
        ? `Being locked out cost about <b>${n1(m.cost)}</b> projected points this week.`
        : `The best legal lineup is worth the same either way, so this cost nothing.`}</div>
    <div class="frow mono small">Logged. Phase 5 reads this back to show what lockouts actually cost
      over a season rather than guessing.</div>
  </section>`;
}

// Two different failures, and they are not equally bad.
function scheduleWarning(state, L) {
  const out = [];
  const sc = state.schedule;
  if (sc && !sc.ok) {
    out.push(`<div class="frow warn"><b>No schedule.</b> ${esc(sc.warning)}</div>`);
  } else if (sc?.stale) {
    out.push(`<div class="frow warn"><b>Schedule is a cached copy.</b> ${esc(sc.warning)}</div>`);
  }
  if (L?.unknown?.length) {
    out.push(`<div class="frow warn"><b>Unrecognised team${L.unknown.length > 1 ? "s" : ""}:</b>
      ${esc(L.unknown.join(", "))}. Those players cannot be locked or priced against Vegas because
      their team code does not match the schedule feed. This is a join failure, not a bye —
      it needs fixing in the alias table.</div>`);
  }
  return out.length ? `<section class="calls sched-warn">${out.join("")}</section>` : "";
}

// Only rendered when there is actually a disagreement worth reading.
function marketBlock(L, state) {
  if (!state.market) return `<section class="block"><div class="pending">Loading consensus…</div></section>`;
  if (!state.market.ok) return "";
  const d = (L.disagreements || []).slice(0, 5);
  if (!d.length) return "";
  const rows = d.map((p) => {
    const dir = p.gap > 0 ? "we like him more" : "market likes him more";
    return `<tr><td class="nm">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></td>
      <td class="gp">ours ${esc(p.pos)}${p.ourRank} · consensus ${esc(p.pos)}${p.theirRank}${
        p.grade ? ` (${esc(p.grade)})` : ""}</td>
      <td class="dir ${p.gap > 0 ? "up" : "down"}">${esc(dir)} <span class="gapn">${
        p.gap > 0 ? "+" : ""}${p.gap}</span></td></tr>`;
  }).join("");
  return `<section class="block"><h2>Where we disagree with the market <span class="ct">${d.length}</span></h2>
    <table>${rows}</table>
    <div class="frow warn">Ranks are <b>within position</b>, against every player we priced —
    consensus publishes ECR on per-position pages, so cross-position comparison is meaningless.
    Kickers and defenses are excluded as streaming noise. Consensus never moves a number here: our
    projection is re-scored at your league's rules and measured against your league's real
    replacement level, where consensus is a 12-team default. A flag, not a vote.</div>
  </section>`;
}

// The mirror has to be able to say how old it is. This is the whole reason a
// build step is tolerable here at all: a derived copy that cannot lie about
// its own age is a mirror, and one that can is the bug class that bit the old
// project three times.
function usageFooter(state) {
  const u = state.usage;
  if (!u?.ok) {
    return `<div class="frow warn"><b>No usage layer this load.</b> Snap share, touches and
      target share are hidden rather than guessed.</div>`;
  }
  const src = u.sources || null;
  const snapsMissing = src && src.snap_counts && src.snap_counts.ok === false;
  const f = state.usageFresh;
  const stale = f?.behind
    ? ` <span class="warn">nflverse has published newer data since — about ${f.hours}
        hour${Math.abs(f.hours) === 1 ? "" : "s"} newer. Ask Claude to refresh the mirror.</span>`
    : f ? " Up to date with nflverse." : "";
  // Two sources, two claims. A fresh overall stamp over a file whose snap
  // half never arrived would say "up to date with nflverse" about something
  // that is missing a whole column, so the payload carries per-source status
  // and this says what is actually in it.
  return `<div class="frow"><b>Usage through week ${u.throughWeek}</b>, mirrored from nflverse
    ${u.generatedAt ? `on ${esc(String(u.generatedAt).slice(0, 10))}` : ""}.${stale}
    ${snapsMissing
      ? `<span class="warn">Snap counts did not publish for this build, so snap share is blank
         everywhere — that is missing data, not zero snaps.</span>`
      : ""}
    Snaps, touches and target share are MEASURED, never projected — and a player with no snap row
    keeps a blank, not a zero.</div>`;
}

function footer(L, state) {
  const missing = L.roster.filter((p) => !p.hasProjection).length;
  const lv = Object.entries(L.freeBest || {})
    .filter(([pos]) => ["QB","RB","WR","TE","K","DEF"].includes(pos))
    .map(([pos, v]) => `${pos} ${n1(v.pts)}`).join(" · ");
  const sg = Object.entries(L.sigma || {}).map(([p, s]) => `${p} ${n1(s)}`).join(" · ");
  return `<footer>
    <div class="frow"><b>${esc(L.entry.name)}</b> · ${L.teams} teams · ${L.rosteredCount} players rostered
      ${typeof L.faabLeft === "number" ? `· FAAB $${L.faabLeft} left ` : "· no FAAB in this league "}· playoffs wk ${L.league.settings?.playoff_week_start ?? "?"}</div>
    <div class="frow"><b>Replacement level</b>, measured from who is actually free in this league
      right now: ${esc(lv)}. VOR is a player's projection minus that. It is the number that makes a
      14-team RB2 and an 8-team RB2 different things.</div>
    <div class="frow"><b>Measured σ</b> ${esc(sg)} — the decision threshold is ½σ for the positions
      involved, floored at 1.0 and capped at 2.0.</div>
    <div class="frow">Projections are Sleeper's, <b>re-scored at this league's actual rules</b> —
      never the vendor's PPR total, which pays 6 for a passing TD where both your leagues pay 4.
      ${state.market?.ok ? `Consensus from FantasyPros via DynastyProcess, scraped ${esc(state.market.scrapeDate || "?")}.`
        : `<span class="warn">Consensus layer unavailable this load.</span>`}</div>
    ${missing ? `<div class="frow warn">${missing} rostered player${missing > 1 ? "s have" : " has"} no
      projection this week (bye, or absent from the feed). Excluded from the lineup solve.</div>` : ""}
    ${state.schedule?.ok ? `
    <div class="frow"><b>Kickoff locking is ${state.schedule.stale ? "on, from a cached schedule" : "on"}.</b> ${L.lockedCount
      ? `${L.lockedCount} rostered player${L.lockedCount > 1 ? "s are" : " is"} locked — ${
          L.lockedCount > 1 ? "their games have" : "his game has"} already started`
      : "No game on this roster has kicked off yet"} — locked players are pinned where they sit and can
      neither enter nor leave the lineup, because Sleeper would refuse it. Kickoffs come from the
      nflverse schedule and are converted from Eastern with the real daylight-saving rules for each
      date, never a fixed offset.</div>
    <div class="frow"><b>Vegas</b> spreads and totals come from the same feed, refreshed every five
      minutes. Books price roughly six weeks ahead, so later weeks legitimately show no line.
      They appear in the reasoning behind a call and never move a projection.</div>` : `
    <div class="frow warn"><b>Kickoff locking is OFF this load.</b> The schedule feed could not be
      reached, so no game time is known and nothing below is locked. A call here may be one Sleeper
      will refuse — check the kickoff before you act on it.</div>`}
    ${usageFooter(state)}
    <div class="frow warn"><b>Not wired yet:</b> kicker totals marked ≥ are floors. No matchup
      layer. FAAB bid figures are deliberately absent, not missing — nothing free supports one.</div>
    <div class="frow mono small">Live from api.sleeper.com, api.fantasycalc.com and
      raw.githubusercontent.com · everything but the usage mirror is fetched in your browser,
      and the mirror stamps the week it is good through ·
      <a href="https://sleeper.com" target="_blank" rel="noopener">open Sleeper ↗</a></div>
  </footer>`;
}

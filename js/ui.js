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

// WHICH SECTIONS ARE ALLOWED TO SPEAK TODAY.
//
// Phase D turns this into the real day-shaped page: a Tuesday view, a Thursday
// view, a Sunday view, each promoting and demoting what is already built. It
// is stubbed always-true now ON PURPOSE, so every section shipped before then
// declares its day rule at birth and Phase D fills in one function instead of
// re-wrapping five sections that never had one.
//
// The successor to the old "a new surface must replace a named old one" rule,
// which fires on none of the rebuild phases because there are no old surfaces
// left in this app to retire: A NEW SECTION MUST BE INVISIBLE BY DEFAULT AND
// MUST NAME THE CONDITION UNDER WHICH IT APPEARS. The condition for `compare`
// is below - two or more players selected. There is no way to reach it by
// accident and nothing to dismiss when you are not using it.
export function visible(_section, _day = new Date().getDay()) {
  return true;
}

export function render(state, handlers) {
  const { onSwitch, onToggle, onClear } = handlers;
  const L = state.leagues[state.active];
  const tabs = state.cfg.leagues.map((e) =>
    `<button class="tab${e.key === state.active ? " on" : ""}" data-k="${esc(e.key)}">${esc(e.name)}</button>`
  ).join("");

  $("#app").innerHTML = `
    <header>
      <div class="title">Fantasy Football Hub</div>
      <div class="wk">Week ${state.week} · ${esc(state.season)}</div>
    </header>
    <nav class="tabs">${tabs}</nav>
    ${scheduleWarning(state, L)}
    ${callsBlock(L)}
    ${visible("compare") ? compareBlock(L, state) : ""}
    ${lockedBlock(L)}
    ${lineupTable(L, state)}
    ${benchTable(L, state)}
    ${marketBlock(L, state)}
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
// The compare surface.
//
// Invisible until you select a player, which is the appearance condition this
// section declares (see visible() above). Metrics as rows, players as columns,
// because the metric list is data and grows - Phase B appends usage, 2027
// appends draft rows - and a table that grows downward survives that where one
// that grows sideways does not.
//
// The tool decides and the arithmetic sits behind a tap: the verdict is one
// line, and every metric row opens to say what the number means and why it is
// or is not allowed to be compared here.
// ---------------------------------------------------------------------------
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

function footer(L, state) {
  const missing = L.roster.filter((p) => !p.hasProjection).length;
  const lv = Object.entries(L.freeBest || {})
    .filter(([pos]) => ["QB","RB","WR","TE","K","DEF"].includes(pos))
    .map(([pos, v]) => `${pos} ${n1(v.pts)}`).join(" · ");
  const sg = Object.entries(L.sigma || {}).map(([p, s]) => `${p} ${n1(s)}`).join(" · ");
  return `<footer>
    <div class="frow"><b>${esc(L.entry.name)}</b> · ${L.teams} teams · ${L.rosteredCount} players rostered
      · FAAB $${L.faabLeft} left · playoffs wk ${L.league.settings?.playoff_week_start ?? "?"}</div>
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
    <div class="frow warn"><b>Not wired yet:</b> kicker totals marked ≥ are floors. No usage,
      matchup or waiver layer yet, and decision memory currently records only lockouts.</div>
    <div class="frow mono small">Live from api.sleeper.com and raw.githubusercontent.com ·
      no build step, the source is the site ·
      <a href="https://sleeper.com" target="_blank" rel="noopener">open Sleeper ↗</a></div>
  </footer>`;
}

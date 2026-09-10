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
const chip = (s) => {
  if (!s) return "";
  const [cls, label] = INJ[s] || ["q", String(s).slice(0, 3).toUpperCase()];
  return `<span class="chip ${cls}" title="${esc(s)}">${esc(label)}</span>`;
};

export function render(state, onSwitch) {
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
    ${callsBlock(L)}
    ${lineupTable(L)}
    ${benchTable(L)}
    ${marketBlock(L, state)}
    ${footer(L, state)}`;

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => onSwitch(b.dataset.k)));
  document.querySelectorAll(".call").forEach((el) =>
    el.addEventListener("click", () => el.classList.toggle("open")));
  document.querySelectorAll("details.fold").forEach(() => {});
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
         ${inP ? `${esc(inP.name)} projects <b>${n1(inP.pts)}</b>${inP.opponent ? ` vs ${esc(inP.opponent)}` : ""}.` : ""}`
      : `${esc(inP?.name)} projects <b>${n1(inP?.pts)}</b> at this league's scoring${
          inP?.opponent ? ` vs ${esc(inP.opponent)}` : ""}${inP?.injury ? ` · <span class="inj">${esc(inP.injury)}</span>` : ""}
         ${typeof inP?.vor === "number" ? `— that is <b>${sgn(inP.vor)}</b> over the best free ${esc(inP.pos)} in this league.` : "."}
         ${outP ? `${esc(outP.name)} projects <b>${n1(outP.pts)}</b>${outP.opponent ? ` vs ${esc(outP.opponent)}` : ""}${
           outP.injury ? ` · <span class="inj">${esc(outP.injury)}</span>` : ""}.` : ""}
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

function row(p, slot) {
  if (!p) return `<tr><td class="slot">${esc(slot)}</td><td colspan="5" class="empty">— empty —</td></tr>`;
  return `<tr${p.startable === false ? ' class="dead"' : ""}>
    <td class="slot">${esc(slot)}</td>
    <td class="nm">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></td>
    <td class="tm">${esc(p.team)}</td>
    <td class="opp">${p.opponent ? esc(p.opponent) : '<span class="bye">bye</span>'}</td>
    <td class="vor" title="points over the best free agent at this position in this league">${
      typeof p.vor === "number" ? sgn(p.vor) : ""}</td>
    <td class="pt">${p.hasProjection ? `${p.floorOnly ? "≥" : ""}${n1(p.pts)}` : '<span class="na">n/a</span>'}${chip(p.injury)}</td>
  </tr>`;
}

const tableHead = `<tr class="th"><td></td><td>Player</td><td class="tm">Tm</td><td>Opp</td>
  <td class="vor">VOR</td><td class="pt">Proj</td></tr>`;

function lineupTable(L) {
  const cur = L.slots.map((slot, i) => [slot, L.byId.get(String(L.starters[i]))]);
  return `<section class="block"><h2>Your lineup</h2>
    <table>${tableHead}${cur.map(([s, p]) => row(p, s)).join("")}</table></section>`;
}

function benchTable(L) {
  const starting = new Set(L.starters.map(String));
  const bench = L.roster.filter((p) => !starting.has(p.id)).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
  if (!bench.length) return "";
  return `<section class="block"><h2>Bench <span class="ct">${bench.length}</span></h2>
    <table>${tableHead}${bench.map((p) => row(p, "BN")).join("")}</table></section>`;
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
      <td class="gp">ours #${p.ourRank} · theirs #${p.theirRank}</td>
      <td class="dir ${p.gap > 0 ? "up" : "down"}">${esc(dir)}</td></tr>`;
  }).join("");
  return `<section class="block"><h2>Where we disagree with the market <span class="ct">${d.length}</span></h2>
    <table>${rows}</table>
    <div class="frow warn">Ranks are within your roster, not national. Consensus never moves a
    number here — our projection is re-scored at your league's rules and measured against your
    league's real replacement level; consensus is a 12-team default. This is a flag, not a vote.</div>
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
    <div class="frow warn"><b>Not wired yet:</b> kickoff locking — a starter whose game has begun can
      still raise an instruction Sleeper would refuse. Kicker totals marked ≥ are floors. No usage,
      matchup, waiver or decision-memory layer yet.</div>
    <div class="frow mono small">Live from api.sleeper.com · nothing here is cached or baked ·
      <a href="https://sleeper.com" target="_blank" rel="noopener">open Sleeper ↗</a></div>
  </footer>`;
}

// THE APP SHELL.
//
// Mounted ONCE. After that only [data-content] and [data-status] are written.
//
// This is not a micro-optimisation, it is a correctness requirement:
// app.js re-solves and repaints whenever a kickoff flips a lock - every 30
// seconds through a Sunday afternoon - and the original replaced the entire
// #app innerHTML each time. In a one-column document that merely flickered.
// In a shell with navigation it would also scroll-jump the reader mid-read at
// one o'clock, and close any open disclosure. So the chrome is inert and the
// content region is the only thing that moves.

import { ROUTES, href, navVisible } from "./router.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let el = null;

export function setLoading(msg) {
  document.querySelector("#root").innerHTML =
    `<div class="loading"><span class="spin"></span>${esc(msg)}…</div>`;
}

export function renderError(err) {
  document.querySelector("#root").innerHTML = `<div class="err"><b>Couldn't load.</b>
    <div class="mono">${esc(err?.message || err)}</div>
    <p>Everything here is fetched live. If Sleeper is unreachable there is nothing cached to
    fall back on &mdash; deliberately: a stale lineup is worse than no lineup.</p></div>`;
  console.error(err);
}

/** Build the chrome. Returns handles; call once. */
export function mount({ leagues, week, season, gradedWeek, day }) {
  const navItems = Object.entries(ROUTES).map(([key, r]) => ({ key, ...r }));

  const rail = navItems.map(({ key, label, ico }) =>
    `<button class="railbtn" data-nav="${key}" ${navVisible(key, day) ? "" : "hidden"}>
      <span class="ico" aria-hidden="true">${ico}</span><span>${esc(label)}</span></button>`).join("");

  const bottom = navItems.map(({ key, label, ico }) =>
    `<button class="navbtn" data-nav="${key}" ${navVisible(key, day) ? "" : "hidden"}>
      <span class="ico" aria-hidden="true">${ico}</span><span>${esc(label)}</span></button>`).join("");

  document.querySelector("#root").innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">Fantasy Football Hub</div>
        <div class="wk">Week ${esc(week)} · ${esc(season)}${
          gradedWeek ? ` · wk ${esc(gradedWeek)} graded` : ""}</div>
      </header>
      <div class="body">
        <nav class="rail" aria-label="Sections">
          <div class="sect">Hub</div>
          ${rail}
        </nav>
        <main class="main">
          <div data-status></div>
          <div data-leagues class="leagues">${leagues.map((l) =>
            `<button class="lg" data-league="${esc(l.key)}">${esc(l.name)}</button>`).join("")}</div>
          <div class="page-head">
            <h1 class="page-title" data-title></h1>
            <div class="page-sub" data-sub></div>
          </div>
          <div data-content></div>
        </main>
      </div>
      <nav class="navbar" aria-label="Sections">${bottom}</nav>
    </div>`;

  el = {
    content: document.querySelector("[data-content]"),
    status: document.querySelector("[data-status]"),
    leagues: document.querySelector("[data-leagues]"),
    title: document.querySelector("[data-title]"),
    sub: document.querySelector("[data-sub]"),
    navs: [...document.querySelectorAll("[data-nav]")],
    lgs: [...document.querySelectorAll("[data-league]")],
  };
  return el;
}

/** Wire navigation. Links are set as real hrefs on click so middle-click and
 *  copy-link behave; the router owns what happens next. */
export function wire({ onNav, onLeague }) {
  el.navs.forEach((b) => b.addEventListener("click", () => onNav(b.dataset.nav)));
  el.lgs.forEach((b) => b.addEventListener("click", () => onLeague(b.dataset.league)));
}

/** Reflect the current route in the chrome. Class and attribute changes only -
 *  nothing here rebuilds a node. */
export function setRoute(route, { day } = {}) {
  const r = ROUTES[route.page];
  el.navs.forEach((b) => {
    b.toggleAttribute("hidden", !navVisible(b.dataset.nav, day ?? new Date().getDay())
      && b.dataset.nav !== route.page);           // never hide the page you are on
    if (b.dataset.nav === route.page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  el.lgs.forEach((b) =>
    b.setAttribute("aria-current", String(b.dataset.league === route.league)));
  el.leagues.hidden = r.scope !== "league";
  el.title.textContent = r.label;
  el.sub.textContent = r.sub;
}

export function setContent(html) { el.content.innerHTML = html; }

export function setStatus(model) {
  const cls = model.level === "bad" ? "status has-bad" : model.level === "warn" ? "status has-warn" : "status";
  // Opened by default when something is wrong; a clean load stays folded.
  el.status.innerHTML = `
    <details class="${cls}" ${model.level === "ok" ? "" : "open"}>
      <summary><span class="dot"></span>${esc(model.summary)}<span class="more">details</span></summary>
      <div class="panel">${model.rows.map((r) =>
        `<div class="srow ${r.level === "ok" ? "" : r.level}">${r.text}</div>`).join("")}</div>
    </details>`;
}

export { href };

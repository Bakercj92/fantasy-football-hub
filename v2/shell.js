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

  // ANCHORS, NOT BUTTONS. A site whose navigation cannot be middle-clicked,
  // cmd-clicked or copied as a link is a document with click handlers. The
  // href is the whole mechanism: there is no navigation JavaScript at all,
  // the browser changes the hash and the router hears it.
  const item = (cls) => navItems.map(({ key, label, ico }) =>
    `<a class="${cls}" data-nav="${key}" href="${href(key)}" ${navVisible(key, day) ? "" : "hidden"}>
      <span class="ico" aria-hidden="true">${ico}</span><span>${esc(label)}</span></a>`).join("");
  const rail = item("railbtn"), bottom = item("navbtn");

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
            `<a class="lg" data-league="${esc(l.key)}" href="#/${esc(l.key)}/lineup">${esc(l.name)}</a>`).join("")}</div>
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

/** Nothing to wire for navigation - it is hrefs. Kept as the seam for the
 *  interactive handlers phases 3 and 4 bring (compare selection, disclosure
 *  rows), so those do not have to reach into the shell's internals. */
export function wire() {}

/** Reflect the current route in the chrome. Class and attribute changes only -
 *  nothing here rebuilds a node. */
export function setRoute(route, { day } = {}) {
  const r = ROUTES[route.page];
  el.navs.forEach((b) => {
    b.toggleAttribute("hidden", !navVisible(b.dataset.nav, day ?? new Date().getDay())
      && b.dataset.nav !== route.page);           // never hide the page you are on
    // A league-scoped link carries the league you are currently looking at, so
    // switching page keeps your team; a global link never carries one.
    b.setAttribute("href", href(b.dataset.nav, route.league));
    if (b.dataset.nav === route.page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  el.lgs.forEach((b) => {
    b.setAttribute("aria-current", String(b.dataset.league === route.league));
    // Switching league keeps the page you are on, rather than dumping you back
    // to a fixed one.
    b.setAttribute("href", href(r.scope === "league" ? route.page : "lineup", b.dataset.league));
  });
  el.leagues.hidden = r.scope !== "league";
  el.title.textContent = r.label;
  el.sub.textContent = r.sub;
}

export function setContent(html) { el.content.innerHTML = html; }

let statusSig = null;
export function setStatus(model) {
  // THE 30-SECOND REPAINT MUST NOT SHUT THIS UNDER THE READER. The kickoff
  // watcher repaints every half minute through a Sunday; rebuilding the
  // <details> each time collapsed a panel somebody had just opened. Skip the
  // rewrite when nothing changed, and carry the open state across when it did.
  const sig = JSON.stringify(model);
  if (sig === statusSig) return;
  const prev = el.status.querySelector("details");
  const wasOpen = prev ? prev.open : model.level !== "ok";
  statusSig = sig;
  const cls = model.level === "bad" ? "status has-bad" : model.level === "warn" ? "status has-warn" : "status";
  // Opened by default when something is wrong; a clean load stays folded.
  el.status.innerHTML = `
    <details class="${cls}" ${wasOpen ? "open" : ""}>
      <summary><span class="dot"></span>${esc(model.summary)}<span class="more">details</span></summary>
      <div class="panel">${model.rows.map((r) =>
        `<div class="srow ${r.level === "ok" ? "" : r.level}">${r.text}</div>`).join("")}</div>
    </details>`;
}

export { href };

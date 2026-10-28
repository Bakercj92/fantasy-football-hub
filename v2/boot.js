// v2 entry point. Wires the data pipeline to the shell and the router.
import { start, state } from "./pipeline.js";
import * as shell from "./shell.js";
import { statusModel } from "./status.js";
import { renderPage } from "./pages.js";
import { parse, resolve, go, onRoute, href, DEFAULT_ROUTE, ROUTES } from "./router.js";

// Where ./data/ and leagues.json live, relative to this document. Served from
// /v2/ that is one level up; an artifact copy overrides it with the Pages
// origin via the meta tag. Declared in the HTML so a reader can see it.
const base = document.querySelector('meta[name="ffh-data-base"]')?.content || "../";

let mounted = false;
let route = { page: DEFAULT_ROUTE, league: null };
const day = new Date().getDay();

// THE PIPELINE'S HANDLERS, HELD SO THE SHELL CAN BE WIRED ONCE.
//
// pipeline.js hands a fresh { onSwitch, onToggle, onClear } to every paint,
// and shell.wire() installs its listeners exactly once (shell.js:84-95 says
// why). Binding the first paint's object into the listener would be fine today
// because those closures are stable, and a trap the moment one of them starts
// capturing per-paint state. So the listener calls through this, and this is
// replaced on every paint.
let handlers = {};

function keys() { return (state.cfg?.leagues || []).map((l) => l.key); }

function readHash() {
  const parsed = parse(window.location.hash, keys());
  if (!parsed) { go(DEFAULT_ROUTE); return; }
  route = resolve(parsed, keys(), route.league || state.active);
  // Keep state.active in step so the pipeline's own handlers agree with the URL.
  if (route.league) state.active = route.league;
  paintRoute({ scrollTop: true });
}

/** What the header chip is counting, or null for no chip at all.
 *
 *  Keyed on the route's league rather than state.active so the count always
 *  belongs to the team whose name is on screen. */
function selectionModel() {
  const key = route.league || state.active;
  const sel = key ? state.selection?.[key] : null;
  const count = sel ? sel.size : 0;
  return count ? { count, href: href("compare", key) } : null;
}

function paintRoute({ scrollTop = false } = {}) {
  if (!mounted) return;
  shell.setRoute(route, { day });
  shell.setStatus(statusModel(state, state.leagues[route.league]));
  shell.setSelection(selectionModel());
  shell.setContent(renderPage(route, state), `${route.league || "-"}:${route.page}`);
  if (scrollTop) window.scrollTo(0, 0);
}

// The pipeline calls this on every re-solve, including the 30-second kickoff
// watcher through a Sunday afternoon. It must NOT remount the shell and must
// NOT move the scroll position: the reader may be halfway down the page.
function onPaint(_state, hooksIn) {
  if (hooksIn) handlers = hooksIn;
  if (!mounted) {
    shell.mount({
      leagues: state.cfg.leagues, week: state.week, season: state.season,
      gradedWeek: state.gradedWeek, day,
    });
    shell.wire({
      onToggle: (id) => handlers.onToggle?.(id),
      onClear: () => handlers.onClear?.(),
    });
    mounted = true;
    onRoute(readHash);
    readHash();
    return;
  }
  paintRoute();
}

start({
  base,
  loading: (msg) => shell.setLoading(msg),
  error: (err) => shell.renderError(err),
  paint: onPaint,
});

// Inspection handles for the render harness. The harness has to be able to
// assert that a LAYER ARRIVED rather than that the page merely painted -
// silent degradation is the failure mode that killed the /next/ plan - and it
// has to be able to force a repaint to prove the shell is inert.
window.__ffh_state = state;
window.__ffh_repaint = () => paintRoute();

export { ROUTES };

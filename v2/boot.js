// v2 entry point. Wires the data pipeline to the shell and the router.
import { start, state } from "./pipeline.js";
import * as shell from "./shell.js";
import { statusModel } from "./status.js";
import { renderPage } from "./pages.js";
import { parse, resolve, go, onRoute, DEFAULT_ROUTE, ROUTES } from "./router.js";

// Where ./data/ and leagues.json live, relative to this document. Served from
// /v2/ that is one level up; an artifact copy overrides it with the Pages
// origin via the meta tag. Declared in the HTML so a reader can see it.
const base = document.querySelector('meta[name="ffh-data-base"]')?.content || "../";

let mounted = false;
let route = { page: DEFAULT_ROUTE, league: null };
const day = new Date().getDay();

function keys() { return (state.cfg?.leagues || []).map((l) => l.key); }

function readHash() {
  const parsed = parse(window.location.hash, keys());
  if (!parsed) { go(DEFAULT_ROUTE); return; }
  route = resolve(parsed, keys(), route.league || state.active);
  // Keep state.active in step so the pipeline's own handlers agree with the URL.
  if (route.league) state.active = route.league;
  paintRoute({ scrollTop: true });
}

function paintRoute({ scrollTop = false } = {}) {
  if (!mounted) return;
  shell.setRoute(route, { day });
  shell.setStatus(statusModel(state, state.leagues[route.league]));
  shell.setContent(renderPage(route, state));
  if (scrollTop) window.scrollTo(0, 0);
}

// The pipeline calls this on every re-solve, including the 30-second kickoff
// watcher through a Sunday afternoon. It must NOT remount the shell and must
// NOT move the scroll position: the reader may be halfway down the page.
function onPaint() {
  if (!mounted) {
    shell.mount({
      leagues: state.cfg.leagues, week: state.week, season: state.season,
      gradedWeek: state.gradedWeek, day,
    });
    shell.wire();
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

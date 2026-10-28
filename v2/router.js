// THE ROUTER.
//
// Hash routes, because this publishes to GitHub Pages from a repo root with
// no server-side rewrite available - a real path would 404 on refresh.
//
// Two route shapes, deliberately not one:
//
//   #/today                         global - it is not about one league
//
// METHODS WAS GLOBAL AND IS NOW LEAGUE-SCOPED (phase 4). Two of its sections
// are measurements rather than prose: replacement level is derived from who is
// actually free in THAT league right now, and sigma is measured from that
// league's roster. A global page would have to drop them or lie about which
// league they describe.
//   #/joop/wire  #/bku/lineup       league-scoped
//
// Forcing a league key into the Today URL would be a lie: Today reads all
// three. So the league switcher appears on league-scoped routes only, and on
// Today each league's own heading is the way in.
//
// The router does NOT own the compare selection. app.js re-solves and
// repaints every 30 seconds on a Sunday, and selection lives in state for
// exactly that reason (app.js:24-27) - putting it in the URL would make a
// kickoff flip rewrite history.

export const ROUTES = {
  today:   { label: "Today",   ico: "◉", scope: "global", sub: "Everything that needs doing, across all three leagues." },
  lineup:  { label: "Lineup",  ico: "▤", scope: "league", sub: "Who is starting, who should be, and what is already locked." },
  wire:    { label: "Wire",    ico: "⇄", scope: "league", sub: "Claims, jobs that just opened, and the standing defence seat." },
  compare: { label: "Compare", ico: "⚖", scope: "league", sub: "Any two players, measured the same way." },
  recap:   { label: "Recap",   ico: "↩", scope: "league", sub: "Last week, graded at this league's own rules." },
  methods: { label: "Methods", ico: "ⓘ", scope: "league", sub: "Where every number on this site comes from." },
};

export const DEFAULT_ROUTE = "today";

/** Days the Recap tab is OFFERED in the nav. It stays reachable by URL on
 *  every other day - that is the "soft" in the soft gate. The original hid it
 *  outright (ui.js PLANS), on Chris's reasoning that a running scoreboard
 *  while you are setting a lineup is a distraction. The reasoning survives;
 *  the dead end does not. */
export const RECAP_NAV_DAYS = new Set([2, 3]); // Tuesday, Wednesday

export function navVisible(page, day = new Date().getDay()) {
  if (page === "recap") return RECAP_NAV_DAYS.has(day);
  return true;
}

/**
 * Parse a location hash. Returns null for anything unrecognised so the caller
 * can redirect rather than render an empty shell.
 * @returns {{page:string, league:(string|null)}|null}
 */
export function parse(hash, leagueKeys = []) {
  const raw = String(hash || "").replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!raw) return { page: DEFAULT_ROUTE, league: null };

  const parts = raw.split("/").filter(Boolean);

  if (parts.length === 1) {
    const r = ROUTES[parts[0]];
    // A league-scoped page named without a league is not an error worth a
    // 404 - it is somebody's bookmark from before the league moved. Send it
    // to the same page on the first league, which the caller resolves.
    if (!r) return null;
    // Both scopes return the same shape here, and that is the point: a
    // league-scoped page named without a league is NOT an error, it is a
    // bookmark from before the scope moved - #/methods is exactly that case
    // since phase 4 - and resolve() fills the league in. Written as a ternary
    // with two identical branches at first, which read as if the scopes still
    // diverged.
    return { page: parts[0], league: null };
  }

  if (parts.length === 2) {
    const [league, page] = parts;
    const r = ROUTES[page];
    if (!r || r.scope !== "league") return null;
    if (leagueKeys.length && !leagueKeys.includes(league)) return null;
    return { page, league };
  }

  return null;
}

/** The canonical hash for a route. */
export function href(page, league = null) {
  const r = ROUTES[page];
  if (!r) return `#/${DEFAULT_ROUTE}`;
  return r.scope === "league" && league ? `#/${league}/${page}` : `#/${page}`;
}

/** Fill in a missing league on a league-scoped route. */
export function resolve(route, leagueKeys, fallbackLeague) {
  if (!route) return { page: DEFAULT_ROUTE, league: null };
  const r = ROUTES[route.page];
  if (r.scope === "league" && !route.league) {
    return { page: route.page, league: fallbackLeague || leagueKeys[0] || null };
  }
  return route;
}

/** Subscribe to hash changes. Returns an unsubscribe function. */
export function onRoute(handler) {
  const fire = () => handler(window.location.hash);
  window.addEventListener("hashchange", fire);
  return () => window.removeEventListener("hashchange", fire);
}

export function go(page, league = null) {
  const next = href(page, league);
  if (window.location.hash !== next) window.location.hash = next;
}

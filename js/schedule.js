// schedule.js - kickoff times and the Vegas line, straight from the browser.
//
// WHY THERE IS NO BUILD STEP HERE. The brief assumed this file had to be
// mirrored by a weekly job, because nflverse release assets fail CORS. They
// do. But the SAME games.csv is published in-tree at
// raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv, which
// sends `access-control-allow-origin: *`. Verified 2026-09-10 byte-for-byte
// against the release asset: 7,548 rows each, identical headers, and the only
// 48 differing rows differ solely by "-0" vs "0" float rendering in
// spread_line. So the browser can have it directly.
//
// That matters beyond saving a build: spreads and totals move all week. A
// mirrored copy would be as fresh as last Tuesday. This is as fresh as five
// minutes (GitHub serves it max-age=300), which is the difference between a
// Sunday-morning read that is current and one that is three days stale.
//
// 511 KB over the wire gzipped, not the 2.1 MB the content-length suggests.

const SOURCE =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

const CACHE_KEY = "ffh.schedule.v1";

// ---------------------------------------------------------------------------
// Team abbreviations: the two feeds do not agree, and the disagreement is
// silent.
//
// Measured 2026-09-10 from the live Pages origin, comparing all 32 codes in
// each feed: they match on 31 and differ on exactly one. nflverse writes the
// Rams as "LA"; Sleeper writes "LAR". Nothing errors. Every Rams player -
// Stafford, Nacua, Kyren Williams, Adams, the LAR defence - would simply
// never find a game, which means never locking at kickoff and never showing a
// Vegas line, with no warning anywhere.
//
// The historical codes below are not needed today. They cost one line each
// and they are the same bug, so they are here pre-emptively rather than after
// a franchise moves and it takes an hour to find.
// ---------------------------------------------------------------------------
const TEAM_ALIASES = {
  LAR: "LA",   // Sleeper -> nflverse. The one that is live today.
  STL: "LA",
  OAK: "LV",
  SD:  "LAC",
  WSH: "WAS",
  JAC: "JAX",
  ARZ: "ARI",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
};

export const normTeam = (t) => {
  const s = String(t || "").trim().toUpperCase();
  return TEAM_ALIASES[s] || s;
};

// ---------------------------------------------------------------------------
// Eastern time, without a fixed offset.
//
// `gametime` in this feed is Eastern wall-clock. September kickoffs are EDT
// (UTC-4) and December kickoffs are EST (UTC-5), so subtracting a constant
// silently shifts every late-season lock by an hour - and a lock that is an
// hour late is exactly the failure this whole layer exists to prevent.
//
// Intl knows the real DST rules for every date. Ask it what the zone offset
// actually was at that instant rather than assuming one.
// ---------------------------------------------------------------------------

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// How far Eastern was from UTC at a given instant, in milliseconds.
function etOffsetMs(instantMs) {
  const parts = ET.formatToParts(new Date(instantMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  // hour12:false renders midnight as 24 in some engines and 00 in others.
  const hour = get("hour") % 24;
  const wallAsUTC = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    hour, get("minute"), get("second")
  );
  return wallAsUTC - instantMs;
}

// "2026-09-13" + "13:00" (Eastern) -> UTC epoch milliseconds.
//
// Two passes: treat the wall time as if it were UTC to get a starting
// instant, measure the offset there, correct. If the correction moved us
// across a DST boundary the offset changes, so measure once more and use
// that. NFL games are never scheduled inside the ambiguous 2 a.m. hour, so
// two passes is not an approximation here - it is exact.
export function etToUTC(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  const [h, mi] = String(timeStr).split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;

  const wallAsUTC = Date.UTC(y, mo - 1, d, h, mi);
  const first = etOffsetMs(wallAsUTC);
  let instant = wallAsUTC - first;
  const second = etOffsetMs(instant);
  if (second !== first) instant = wallAsUTC - second;
  return instant;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

// Quote-aware, because stadium and coach columns are free text and one comma
// inside quotes would shift every field after it by one - which would look
// like a data problem, not a parser problem, and cost an hour.
function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  const s = String(v ?? "").trim();
  if (s === "" || s === "NA") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

// game_id is the first column and is always "<season>_<week>_<away>_<home>",
// so we can drop 96% of the file with a string prefix test before doing any
// real parsing work. 7,548 rows in, 272 out.
export function parseSeason(csvText, season) {
  const lines = String(csvText).split("\n");
  const header = splitCSVLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

  for (const required of ["game_id", "season", "week", "gameday", "gametime",
                          "away_team", "home_team", "spread_line", "total_line"]) {
    if (!(required in col)) {
      throw new Error(`schedule: upstream CSV is missing the "${required}" column`);
    }
  }

  const prefix = `${season}_`;
  const games = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith(prefix)) continue;
    const f = splitCSVLine(line);
    if (String(f[col.season]).trim() !== String(season)) continue;

    const gameday = f[col.gameday].trim();
    const gametime = f[col.gametime].trim();

    // spread_line is the number of points the HOME team is favoured by.
    // Verified against week 1 moneylines: 2026_01_NE_SEA has spread_line 3
    // with home SEA at -166, and 2026_01_CHI_CAR has spread_line -3 with
    // away CHI at -162. Positive means the home side is laying points.
    const spread = num(f[col.spread_line]);
    // NOTE the source CSV also has a column literally named `total`, and it is
    // the FINAL COMBINED SCORE of a completed game, not the betting total.
    // This is `total_line` - the number books posted. Do not "fix" it to
    // col.total when a results layer arrives.
    const total = num(f[col.total_line]);
    const hasLine = spread !== null && total !== null;

    games.push({
      gameId: f[col.game_id].trim(),
      week: Number(f[col.week]),
      gameday,
      gametime,
      kickoffUTC: etToUTC(gameday, gametime),
      away: normTeam(f[col.away_team]),
      home: normTeam(f[col.home_team]),
      spread,
      total,
      hasLine,
      // Implied team totals. Sum back to the game total, and their difference
      // is the spread, which is the arithmetic identity worth remembering:
      //   home = total/2 + spread/2 , away = total/2 - spread/2
      homeImplied: hasLine ? total / 2 + spread / 2 : null,
      awayImplied: hasLine ? total / 2 - spread / 2 : null,
      homeML: col.home_moneyline != null ? num(f[col.home_moneyline]) : null,
      awayML: col.away_moneyline != null ? num(f[col.away_moneyline]) : null,
      roof: col.roof != null ? (f[col.roof] || "").trim() : "",
    });
  }
  return games;
}

// ---------------------------------------------------------------------------
// The object the rest of the app talks to
// ---------------------------------------------------------------------------

export function index(games, season) {
  const byTeam = new Map(); // team -> week -> game
  const byWeek = new Map(); // week -> [game]
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
    for (const t of [g.home, g.away]) {
      if (!byTeam.has(t)) byTeam.set(t, new Map());
      byTeam.get(t).set(g.week, g);
    }
  }
  return { season: String(season), games, byTeam, byWeek, ok: true, stale: false };
}

// One team's view of its own game: everything oriented so that "favoured"
// and "implied total" mean this team, not the home team.
//
// Returns null on a bye. See unknownTeams() for why "no game" and "code we
// don't recognise" must not be allowed to look the same.
export function teamGame(sched, team, week) {
  if (!sched?.ok || !team) return null;
  const key = normTeam(team);
  const g = sched.byTeam.get(key)?.get(Number(week));
  if (!g) return null;
  const isHome = g.home === key;
  return {
    game: g,
    opponent: isHome ? g.away : g.home,
    isHome,
    kickoffUTC: g.kickoffUTC,
    hasLine: g.hasLine,
    // Positive = this team is favoured by that many points.
    spreadForTeam: g.hasLine ? (isHome ? g.spread : -g.spread) : null,
    impliedTotal: g.hasLine ? (isHome ? g.homeImplied : g.awayImplied) : null,
    gameTotal: g.total,
    moneyline: isHome ? g.homeML : g.awayML,
    roof: g.roof,
  };
}

// Has this game started? Unknown kickoff is NOT treated as started - see the
// failure-mode note on load() below.
export const hasKickedOff = (kickoffUTC, now = Date.now()) =>
  typeof kickoffUTC === "number" && now >= kickoffUTC;

// Which of these team codes does the schedule not recognise at all?
//
// This exists because a bye and an unrecognised abbreviation both produce
// "no game", and that ambiguity is what would have hidden the LA/LAR
// mismatch. Every team plays in some week, so a code absent from the whole
// index is a join failure, never a bye - and the page says so out loud
// instead of quietly declining to lock those players.
export function unknownTeams(sched, teams) {
  if (!sched?.ok) return [];
  const bad = new Set();
  for (const t of teams) {
    if (!t) continue;
    if (!sched.byTeam.has(normTeam(t))) bad.add(String(t));
  }
  return [...bad].sort();
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

// Network first, last-good cache as the fallback, and an explicit warning if
// both fail.
//
// The market layer is an enrichment that may silently never arrive. This is
// NOT that: locking is a correctness feature, so its failure has to be
// visible. But the safe direction on failure is to lock NOTHING and say so,
// rather than to lock everything - a call the tool wrongly suppresses is
// invisible and lost, while an instruction Sleeper refuses is annoying and
// self-correcting. Loud and permissive beats quiet and wrong.
//
// Kickoff times, unlike lines, essentially never change once published, so a
// cached schedule is a genuinely good fallback for the locking half even when
// its spreads have gone stale.
export async function load(season, { fetchImpl = fetch, now = Date.now() } = {}) {
  let text = null;
  let netError = null;

  try {
    const r = await fetchImpl(SOURCE, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    text = await r.text();
  } catch (err) {
    netError = err;
  }

  if (text) {
    try {
      const games = parseSeason(text, season);
      if (games.length) {
        const built = index(games, season);
        built.fetchedAt = now;
        save(season, games, now);
        return built;
      }
      netError = new Error(`no ${season} rows in the schedule feed`);
    } catch (err) {
      netError = err;
    }
  }

  const cached = restore(season);
  if (cached) {
    const built = index(cached.games, season);
    built.stale = true;
    built.fetchedAt = cached.at;
    built.warning =
      "Schedule came from the last good copy on this device, not the live feed. " +
      "Kickoff times are reliable; the spreads and totals may be out of date.";
    return built;
  }

  return {
    ok: false,
    season: String(season),
    games: [],
    byTeam: new Map(),
    byWeek: new Map(),
    stale: false,
    error: netError,
    warning:
      "Could not reach the schedule feed and there is no cached copy on this " +
      "device, so nothing can be locked and no Vegas line is available. Check " +
      "kickoff times in Sleeper before acting on anything below.",
  };
}

// localStorage, wrapped everywhere. It throws outright in private windows and
// in some embedded contexts, and a storage failure must never take the page
// down with it.
function save(season, games, at) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ season: String(season), at, games }));
  } catch { /* storage unavailable or full - the page does not care */ }
}

function restore(season) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (String(parsed.season) !== String(season)) return null;
    if (!Array.isArray(parsed.games) || !parsed.games.length) return null;
    return parsed;
  } catch { return null; }
}

export { SOURCE, CACHE_KEY, splitCSVLine, TEAM_ALIASES };

// fantasycalc.js - the only cross-position market number in the free stack.
//
// WHY THIS EXISTS ALONGSIDE market.js
//
// market.js carries FantasyPros ECR, which is published on PER-POSITION pages.
// A kicker ranked 1 and a receiver ranked 4 are not on one scale, so ECR can
// never answer "start this RB or that WR" - the exact question a flex decision
// asks. That is a property of the source, not a bug we can fix downstream; see
// the Cameron Dicker note in market.js.
//
// FantasyCalc publishes a single trade-value scale across every position AND
// parameterises it to league shape. Verified live 2026-09-13 against both of
// Chris's leagues:
//
//   numQbs=1 numTeams=14 ppr=1  -> Josh Allen is overall #21
//   numQbs=2 numTeams=8  ppr=1  -> Josh Allen is overall #3
//
// Same player, same day, same site. That gap IS the superflex premium, and it
// is the number Ball Knowers has been missing - market.js was showing that
// league a 1QB consensus rank as if it meant something.
//
// Every row embeds `player.sleeperId`, so the join is an id lookup with no
// name matching anywhere. Verified: 0 of 198 rows missing it.
//
// Only QB/RB/WR/TE are published. Kickers and defenses are absent, which
// matches what the rest of the app already does with streaming slots.
//
// This layer NEVER moves a projection. Same rule as market.js: our
// format-correct projection is the opinion, this is the market, and the tool's
// job is to show where they disagree.

const ROOT = "https://api.fantasycalc.com/values/current";
const KEY  = "ffh:fcalc:v1:";
const TTL  = 6 * 3600 * 1000; // values drift over hours, not minutes

// League shape, read from what Sleeper says TODAY rather than from a constant.
// Ball Knowers changed shape mid-season once; a baked number was wrong for a
// month. This is the same rule leagues.json is built on.
export function leagueShape(league) {
  const slots = league?.roster_positions || [];
  const qb    = slots.filter((s) => s === "QB").length;
  const sflex = slots.filter((s) => s === "SUPER_FLEX").length;

  // FantasyCalc exposes exactly two settings: 1QB or superflex. A league with
  // any superflex slot is priced as superflex; there is no finer control, so
  // do not pretend otherwise by summing the slots.
  const numQbs = sflex > 0 ? 2 : 1;

  // Reception scoring straight from the league's own rules. FantasyCalc takes
  // 0, 0.5 or 1 - anything else snaps to the nearest of those, and an exact
  // tie (0.75, 0.25) snaps DOWN. Neither side of a tie is more correct; what
  // matters is that the choice is stable, because an unstable one would swap a
  // league's entire market board between page loads for no visible reason.
  const rec = Number(league?.scoring_settings?.rec ?? 0);
  const ppr = [0, 0.5, 1].reduce((best, v) =>
    Math.abs(v - rec) < Math.abs(best - rec) ? v : best, 0);

  const numTeams = Number(league?.total_rosters) || 12;

  return { numQbs, numTeams, ppr };
}

const urlFor = ({ numQbs, numTeams, ppr }) =>
  `${ROOT}?isDynasty=false&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;

const shapeKey = ({ numQbs, numTeams, ppr }) => `${KEY}${numQbs}-${numTeams}-${ppr}`;

// Returns { byId: Map(sleeperId -> row), ok, shape, error }.
//
// NEVER throws. Like the market layer, this is a late enrichment: the page is
// already correct and already painted without it, and if it never arrives the
// compare tool simply drops its market column rather than breaking.
export async function values(shape) {
  const cacheKey = shapeKey(shape);
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (hit && Date.now() - hit.at < TTL) {
      return { byId: new Map(hit.rows), ok: hit.rows.length > 0, shape, cached: true };
    }
  } catch { /* private window, cleared storage, quota - all survivable */ }

  try {
    const r = await fetch(urlFor(shape));
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error("unexpected payload shape");

    const pairs = [];
    for (const row of rows) {
      const sid = row?.player?.sleeperId;
      if (!sid) continue; // no id, no join - never fall back to name matching
      pairs.push([String(sid), {
        value:     num(row.value),
        overall:   num(row.overallRank),
        posRank:   num(row.positionRank),
        trend30:   num(row.trend30Day),
        rosterPct: num(row.maybeRosterPercent),
        tier:      num(row.maybeTier),
        name:      row.player.name || null,
        pos:       row.player.position || null,
      }]);
    }

    // Only cache a payload that actually parsed into something. Caching an
    // empty result - a schema change that drops player.sleeperId, say - would
    // pin "market values unavailable" on the page for the full six-hour TTL
    // with no retry, turning a transient upstream problem into an afternoon.
    if (pairs.length) {
      try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), rows: pairs })); } catch {}
    }
    return { byId: new Map(pairs), ok: pairs.length > 0, shape };
  } catch (err) {
    console.warn("fantasycalc layer unavailable:", err.message);
    return { byId: new Map(), ok: false, shape, error: err.message };
  }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export { urlFor, shapeKey };

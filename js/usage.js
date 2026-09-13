// usage.js - what players actually DID, as opposed to what they are projected
// to do. The loader for the one mirrored dataset in this app.
//
// WHY THIS IS THE ONE EXCEPTION TO "NO BUILD STEP"
//
// Everything else here is fetched live in the browser. nflverse ships weekly
// stats and snap counts as GitHub RELEASE assets, which redirect to
// release-assets.githubusercontent.com and send no CORS header. Re-verified
// from the live site on 2026-09-13: the api.github.com metadata call returns
// 200 in the browser, and the asset bytes fetch throws. So `build/usage.py`
// mirrors and trims them into `data/usage_<season>.json`, and this file reads
// that.
//
// The disease the rebuild cured was never "a build step" - it was a derived
// copy of the SOURCE going stale while tests stayed green, three times. A
// mirror of somebody else's dataset is a different animal, but only if it
// cannot lie about its own age. Hence:
//
//   * the payload stamps `through_week` and `generated_at`, and the page says
//     "usage through week N" rather than implying it is current;
//   * `checkFreshness()` asks api.github.com - which IS browser-readable -
//     when upstream last changed, and the page says so when the mirror is
//     behind. Silently stale becomes visibly stale, which is the whole
//     difference.
//
// Missing is NOT zero. A player with no snap row keeps null: "we did not
// measure this" and "he was not on the field" are different claims, and this
// project has already been bitten once by collapsing a bye into a zero.

const API = "https://api.github.com/repos/nflverse/nflverse-data/releases/tags/stats_player";

export async function load(season, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`./data/usage_${season}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const raw = await r.json();
    if (!raw?.p || !Array.isArray(raw.cols)) throw new Error("unexpected payload shape");
    return index(raw);
  } catch (err) {
    // No usage layer is a missing enrichment, not a broken page. Every metric
    // that depends on it simply drops out of the compare tool.
    console.warn("usage layer unavailable:", err.message);
    return { ok: false, byId: new Map(), error: err.message, throughWeek: null };
  }
}

// Turn the compact column-array payload into per-player aggregates.
export function index(raw) {
  const c = Object.fromEntries(raw.cols.map((name, i) => [name, i]));
  const byId = new Map();

  for (const [sid, p] of Object.entries(raw.p)) {
    const weeks = (p.w || []).map((row) => ({
      wk:        row[c.wk],
      snapPct:   row[c.off_pct],
      tgt:       row[c.tgt],
      rec:       row[c.rec],
      recYd:     row[c.rec_yd],
      tgtShare:  row[c.tgt_share],
      ayShare:   row[c.ay_share],
      wopr:      row[c.wopr],
      car:       row[c.car],
      rushYd:    row[c.rush_yd],
      att:       row[c.att],
      passYd:    row[c.pass_yd],
    }));
    if (!weeks.length) continue;
    // `actual` is what he really scored that week, already translated into
    // Sleeper's stat vocabulary by the build. That means scoring.js's rescore()
    // works on it unchanged - the same function, the same league settings, the
    // same arithmetic that priced the projection. No second vocabulary in the
    // browser, and no way for a recap to use different rules than the call it
    // is grading.
    byId.set(String(sid), {
      pos: p.pos, team: p.tm, weeks, actual: p.a || {}, ...aggregate(weeks),
    });
  }

  return {
    ok: byId.size > 0,
    byId,
    season: raw.season,
    throughWeek: raw.through_week ?? null,
    hasActuals: Array.isArray(raw.act_keys) && raw.act_keys.length > 0,
    sources: raw.sources || null,
    generatedAt: raw.generated_at || null,
    sourceUpdatedAt: raw.source_updated_at || null,
  };
}

// Season averages plus a recent-form window.
//
// `mean` skips nulls rather than treating them as zero, and reports how many
// values it actually had - a three-game average built from one game is not a
// three-game average, and the caller has to be able to tell.
function mean(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 1000) / 1000;
}

const RECENT = 3;

export function aggregate(weeks) {
  const recent = weeks.slice(-RECENT);
  const per = (rows, key) => mean(rows.map((w) => w[key]));

  // Opportunity is carries plus targets: the touches a player was actually
  // given, which is the part of a fantasy day a coach controls and efficiency
  // does not.
  //
  // MISSING IS NOT ZERO, AND THIS LINE GOT IT WRONG.
  //
  // The first version coerced a null carry or target to 0 before summing, so
  // the expression was ALWAYS finite and mean()'s null filter never fired: an
  // unmeasured week entered the average as a genuine zero-touch game. A player
  // with 16 and 19 touches plus one unmeasured week averaged 11.7 instead of
  // 17.5 - a third of his workload, gone.
  //
  // Worse than under-reporting, it MANUFACTURED TRENDS. The season window and
  // the last-three window hold different proportions of unmeasured rows, so a
  // gap early in the year inflated the riser jump and a recent one drove it
  // sharply negative - and this number feeds the waiver riser gate. A week
  // with neither figure contributes nothing; a week with one of them counts
  // the one it has.
  const opp = (rows) => mean(rows.map((w) => {
    const car = typeof w.car === "number" ? w.car : null;
    const tgt = typeof w.tgt === "number" ? w.tgt : null;
    if (car === null && tgt === null) return null;
    return (car ?? 0) + (tgt ?? 0);
  }));

  return {
    games:        weeks.length,
    gamesRecent:  recent.length,
    snapPct:      per(weeks, "snapPct"),
    snapPctRecent: per(recent, "snapPct"),
    tgtPerGame:   per(weeks, "tgt"),
    tgtPerGameRecent: per(recent, "tgt"),
    // Same rule: a week with no target figure is not a zero-target week, so it
    // does not drag the total. The count of games it is drawn from is `games`.
    tgtTotal:     weeks.reduce((s, w) => s + (typeof w.tgt === "number" ? w.tgt : 0), 0),
    tgtWeeks:     weeks.filter((w) => typeof w.tgt === "number").length,
    tgtShare:     per(weeks, "tgtShare"),
    tgtShareRecent: per(recent, "tgtShare"),
    wopr:         per(weeks, "wopr"),
    carPerGame:   per(weeks, "car"),
    oppPerGame:   opp(weeks),
    oppPerGameRecent: opp(recent),
    attPerGame:   per(weeks, "att"),
  };
}

// Is the mirror behind upstream?
//
// api.github.com allows cross-origin reads (60/hour unauthenticated, which is
// ample for a page one person opens), so the browser can learn the upstream
// file's mtime even though it can never download the file itself. Never
// throws, and a failure simply means no staleness claim is made either way -
// saying nothing is correct; guessing is not.
export async function checkFreshness(usage, { fetchImpl = fetch } = {}) {
  if (!usage?.ok || !usage.generatedAt) return null;
  try {
    const r = await fetchImpl(API);
    if (!r.ok) return null;
    const j = await r.json();
    const name = `stats_player_week_${usage.season}.csv`;
    const asset = (j.assets || []).find((a) => a.name === name);
    if (!asset?.updated_at) return null;
    const upstream = Date.parse(asset.updated_at);
    const mirrored = Date.parse(usage.generatedAt);
    if (!Number.isFinite(upstream) || !Number.isFinite(mirrored)) return null;
    return {
      upstream: asset.updated_at,
      mirrored: usage.generatedAt,
      behind: upstream > mirrored,
      hours: Math.round((upstream - mirrored) / 36e5),
    };
  } catch {
    return null;
  }
}

export { API, RECENT };

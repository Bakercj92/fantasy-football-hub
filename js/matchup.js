// matchup.js - how hard is this week's opponent, and is that question
// answerable yet.
//
// THE REASON THIS FILE IS MOSTLY A REFUSAL
//
// On 2026-09-23 a start/sit call was argued from a two-week defence ranking:
// "Lawrence draws New England, #29 of 32, while Shough draws Las Vegas, #26."
// The conclusion happened to be right for a different reason (form), but the
// ranking itself was measured afterwards and carries NO predictive signal at
// that sample size. Week 1 does not predict week 2:
//
//     QB  r = -0.041    signal share  0.0%
//     WR  r = -0.058    signal share  0.0%
//     TE  r = +0.071    signal share 12.8%
//     RB  r = +0.237    signal share 19.3%
//
// This is not a 2026 anomaly. The same decomposition over a FULL 2025 season
// found QB 41% / TE 25% / WR 21% / RB 9.7% - i.e. even with seventeen games
// per defence, most of the spread between defences is sampling noise, and at
// running back almost all of it is. A raw rank table is a machine for
// generating confident-sounding nonsense.
//
// So this module computes the table, then measures its own reliability and
// declines to speak when the measurement says it has nothing. That refusal is
// the feature. It self-corrects: as games accrue the signal share rises on its
// own and the layer starts talking, without anyone tuning a constant.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO
//
// 1. It never moves a projection. The vendor projection is already
//    matchup-adjusted; multiplying it again double-counts invisibly. This
//    layer produces CONTEXT and WORDS, never a new central number.
// 2. It never outranks a health signal. Whether a player is on the field is a
//    fact; how well he does is a claim. Callers apply health first.

// Below this share of variance, a difference between two defences is not
// distinguishable from noise and nothing is reported. 0.15 is inherited from
// the prior engine, where it muted RB on full-season 2025 data and passed
// QB/WR/TE - behaviour that was checked against a backtest rather than picked.
export const MIN_SIGNAL = 0.15;

export const POSITIONS = ["QB", "RB", "WR", "TE"];

// Fantasy points conceded, per position, per defence, per week.
//
// Re-scored at THIS league's rules from the mirror's own `actual` block, which
// is already in Sleeper's stat vocabulary. That matters: the table has to be
// denominated in the same points as the projection it will sit beside, or the
// comparison is between two different currencies.
//
// `rescore` is passed in rather than imported so this module stays pure and
// the caller keeps one scoring implementation.
export function concededByWeek(usage, scoringSettings, rescore) {
  if (!usage?.ok || !usage.byId?.size) return null;
  const cells = new Map();            // "POS|TEAM|WK" -> points
  const weeks = new Set();

  for (const p of usage.byId.values()) {
    if (!POSITIONS.includes(p.pos)) continue;
    for (const w of p.weeks) {
      // No opponent on the row means the mirror predates the `opp` column, or
      // the source row had none. Either way the player-week cannot be
      // attributed to a defence and must be dropped rather than guessed at -
      // attributing it to his CURRENT team's opponent is the traded-player
      // bug this column exists to prevent.
      if (!w.opp) continue;
      const actual = p.actual?.[String(w.wk)];
      if (!actual) continue;
      const scored = rescore(actual, scoringSettings);
      if (!scored || typeof scored.pts !== "number") continue;
      const key = `${p.pos}|${w.opp}|${w.wk}`;
      cells.set(key, (cells.get(key) || 0) + scored.pts);
      weeks.add(w.wk);
    }
  }
  if (!cells.size) return null;
  return { cells, weeks: [...weeks].sort((a, b) => a - b) };
}

// How much of the spread between defences is real?
//
// Variance decomposition, not a correlation: between-defence variance of the
// per-game mean, minus the share of it that the within-defence noise explains.
// A defence's mean over n games carries noise/n, so
//
//     signal = max(0, between - within/n)
//
// and the reported share is signal/between. Returns null for a position with
// fewer than two weeks, because one game per defence has no within-term at all
// and the decomposition is undefined - NOT zero, which would read as "measured
// and found to be noise" when nothing was measured.
export function reliability(conceded) {
  if (!conceded) return null;
  const out = {};
  for (const pos of POSITIONS) {
    const byTeam = new Map();
    for (const [key, pts] of conceded.cells) {
      const [p, team, wk] = key.split("|");
      if (p !== pos) continue;
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push({ wk: Number(wk), pts });
    }
    const series = [...byTeam.values()].filter((v) => v.length >= 2);
    if (series.length < 4) { out[pos] = null; continue; }

    const means = series.map((v) => v.reduce((s, x) => s + x.pts, 0) / v.length);
    const grand = means.reduce((s, v) => s + v, 0) / means.length;
    const between = means.reduce((s, v) => s + (v - grand) ** 2, 0) / means.length;

    let withinSum = 0, withinN = 0;
    for (const v of series) {
      const m = v.reduce((s, x) => s + x.pts, 0) / v.length;
      withinSum += v.reduce((s, x) => s + (x.pts - m) ** 2, 0);
      withinN += v.length - 1;
    }
    const within = withinN ? withinSum / withinN : 0;
    const n = series.reduce((s, v) => s + v.length, 0) / series.length;
    const signal = Math.max(0, between - within / n);
    out[pos] = {
      share: between > 0 ? signal / between : 0,
      between, within, gamesPerDefence: n, defences: series.length,
    };
  }
  return out;
}

// Per-defence, per-position: the shrunk multiplier against league average.
//
// Empirical Bayes. `k` is the position's measured signal share, so a position
// whose spread is noise collapses every defence to 1.0 and a position with real
// separation keeps it. `raw` is kept alongside so the size of the correction
// stays visible rather than being buried in the output.
export function table(usage, scoringSettings, rescore) {
  const conceded = concededByWeek(usage, scoringSettings, rescore);
  if (!conceded) return null;
  const rel = reliability(conceded);
  const byPos = {};

  for (const pos of POSITIONS) {
    const byTeam = new Map();
    for (const [key, pts] of conceded.cells) {
      const [p, team] = key.split("|");
      if (p !== pos) continue;
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(pts);
    }
    if (!byTeam.size) continue;
    const perGame = new Map();
    for (const [team, arr] of byTeam) {
      perGame.set(team, { mean: arr.reduce((s, v) => s + v, 0) / arr.length, games: arr.length });
    }
    const league = [...perGame.values()].reduce((s, v) => s + v.mean, 0) / perGame.size;
    const k = rel?.[pos]?.share ?? 0;
    const entries = new Map();
    for (const [team, v] of perGame) {
      const raw = league > 0 ? v.mean / league : 1;
      entries.set(team, {
        raw: round(raw),
        mult: round(1 + (raw - 1) * k),   // shrunk toward 1.0 by measured reliability
        perGame: round(v.mean),
        games: v.games,
      });
    }
    byPos[pos] = { league: round(league), k: round(k), entries };
  }
  return { byPos, reliability: rel, weeks: conceded.weeks };
}

// What to SAY about a matchup, or nothing.
//
// Returns null - not a neutral-looking rank - whenever the position's measured
// signal is below the gate. A caller that receives null must render nothing at
// all; rendering "average matchup" would be a claim the data cannot support.
export function read(tbl, pos, opponent) {
  if (!tbl?.byPos?.[pos] || !opponent) return null;
  const { entries, k } = tbl.byPos[pos];
  if (k < MIN_SIGNAL) {
    return {
      speaks: false,
      reason: `defence-vs-${pos} spread is ${(k * 100).toFixed(0)}% signal over ` +
              `${tbl.weeks.length} week(s) - below the ${(MIN_SIGNAL * 100).toFixed(0)}% ` +
              `gate, so no matchup claim is made`,
    };
  }
  const e = entries.get(opponent);
  if (!e) return null;
  const sorted = [...entries.entries()].sort((a, b) => b[1].mult - a[1].mult);
  const rank = sorted.findIndex(([t]) => t === opponent) + 1;
  const pct = Math.round((e.mult - 1) * 100);
  return {
    speaks: true,
    rank, of: sorted.length, mult: e.mult, raw: e.raw, games: e.games,
    // Deliberately hedged wording. The multiplier survived the gate; it is
    // still an estimate off a handful of games.
    text: pct === 0
      ? `${opponent} has been a neutral matchup for ${pos}s`
      : `${opponent} has allowed ${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than average to ${pos}s`,
  };
}

const round = (v) => Math.round(v * 1000) / 1000;

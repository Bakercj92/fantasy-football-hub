// compare.js - one compare tool, all positions, pool or head-to-head.
//
// The old product had SIX places to compare two players. The rebuild settled
// on exactly one, and this is it. The shape Chris chose: a ranked pool of N
// that collapses to a head-to-head when exactly two players are selected.
//
// THE METRIC LIST IS DATA, NOT CODE.
//
// Every row rendered by the compare surface comes from the METRICS array
// below. Phase B appends usage columns (snap share, targets, opportunity) by
// adding entries; the 2027 draft rows do the same. Nothing in the renderer
// knows the name of a single metric, so neither addition touches render code -
// and there is no dormant draft branch sitting in the app for eleven months
// waiting to rot, which is how the old product ended up with nine unreachable
// surfaces.
//
// THE CROSS-POSITION RULE IS LOAD-BEARING.
//
// A flex decision is "this RB or that WR". Some metrics answer that and some
// cannot: FantasyPros ECR is published per position, so an RB ranked 12 and a
// WR ranked 12 are not the same claim. Any metric marked crossPosition:false
// is DROPPED - not greyed, not footnoted - the moment the pool spans more than
// one position, because a number that looks comparable and isn't is worse than
// no number. FantasyCalc values are a single scale across positions, which is
// precisely why that layer was added for this tool.
//
// This file is pure: no fetch, no DOM, no clock. It is handed already-priced
// players and returns a structure. That is what makes it testable.

import { threshold } from "./value.js";
import { rescore } from "./scoring.js";
import { canFill } from "./lineup.js";

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const one = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---------------------------------------------------------------------------
// The metrics.
//
//   key           stable id, used by tests and by the selection UI
//   label         what Chris reads
//   get(p, ctx)   the number, or null when unavailable for this player
//   fmt(v, p)     display string
//   dir           "high" or "low" - which end wins
//   crossPosition can this number be compared between two positions at all
//   axis          may this metric rank the pool
//   note          the "why", shown behind a tap - never on the face of the row
// ---------------------------------------------------------------------------
export const METRICS = [
  {
    key: "vor", label: "Value over replacement", dir: "high",
    crossPosition: true, axis: true,
    get: (p) => n(p.vor),
    fmt: (v) => (v === null ? "—" : (v > 0 ? "+" : "") + one(v, 2)),
    note: "Points above the best player at this position nobody in this league owns — " +
          "measured live from the actual rosters, not a 12-team rule of thumb. " +
          "This is the only fair way to weigh a running back against a receiver.",
  },
  {
    key: "pts", label: "Projected", dir: "high",
    crossPosition: true, axis: true,
    get: (p) => n(p.pts),
    fmt: (v) => (v === null ? "—" : one(v, 2)),
    note: "Sleeper's projection re-scored at this league's own rules. " +
          "Comparable as raw points, but 12 points from a quarterback and 12 from a " +
          "tight end are worth very different things — that is what the row above is for.",
  },
  {
    key: "mktValue", label: "Market value", dir: "high",
    crossPosition: true, axis: false,
    get: (p) => n(p.fcalc?.value),
    fmt: (v) => (v === null ? "—" : v.toLocaleString()),
    note: "FantasyCalc trade value, priced for THIS league's exact shape — team count, " +
          "PPR, and superflex or not. One scale across every position.",
  },
  {
    key: "mktRank", label: "Market rank", dir: "low",
    crossPosition: true, axis: false,
    get: (p) => n(p.fcalc?.overall),
    fmt: (v) => (v === null ? "—" : "#" + v),
    note: "Overall rank on that same league-shaped scale. In superflex this moves " +
          "quarterbacks up enormously — Josh Allen is #3 in Ball Knowers and #21 in Joop.",
  },
  {
    key: "trend30", label: "30-day trend", dir: "high",
    crossPosition: true, axis: false,
    get: (p) => n(p.fcalc?.trend30),
    fmt: (v) => (v === null ? "—" : (v > 0 ? "+" : "") + v.toLocaleString()),
    note: "Which way the market has moved this player over thirty days. Direction and " +
          "urgency, not a projection.",
  },
  {
    key: "ros", label: "Rest of season", dir: "high",
    crossPosition: true, axis: false,
    get: (p) => n(p.ros?.total),
    fmt: (v, p) => (v === null ? "—" : `${one(v, 1)} over ${p.ros.weeks}w`),
    note: "Every remaining week's projection added up, from one Sleeper call per player. " +
          "Useful when the question is who to hold, not who to start.",
  },
  {
    key: "bye", label: "Bye week", dir: "low",
    crossPosition: true, axis: false,
    get: (p) => n(p.ros?.bye),
    fmt: (v) => (v === null ? "—" : "wk " + v),
    note: "A null week from Sleeper is a bye OR missing data, so this is only shown when " +
          "the schedule confirms it.",
  },
  {
    key: "implied", label: "Team total (Vegas)", dir: "high",
    crossPosition: true, axis: false,
    get: (p) => n(p.vegas?.implied),
    fmt: (v) => (v === null ? "—" : one(v, 1)),
    note: "How many points the betting market expects this player's TEAM to score. " +
          "Context for a close call — it never moves a projection. Books price about " +
          "six weeks out, so this is empty for most of the season.",
  },
  {
    key: "ecr", label: "Consensus (positional)", dir: "low",
    crossPosition: false, axis: false,
    get: (p) => posRankNumber(p.market?.posRank),
    fmt: (v, p) => (v === null ? "—" : p.market.posRank),
    note: "FantasyPros expert consensus. Published per position, so it is hidden the " +
          "moment you compare across positions — an RB12 and a WR12 are not the same claim.",
  },
  {
    key: "grade", label: "Start/sit grade", dir: null,
    crossPosition: false, axis: false,
    get: (p) => (p.market?.grade ? 1 : null),
    fmt: (_v, p) => p.market?.grade || "—",
    note: "FantasyPros' own letter grade for starting this player this week.",
  },
];

// The two assumptions the verdict rests on, made explicit so a future metric
// cannot quietly break them by flipping `axis` to true:
//   * an axis metric is HIGH-IS-BETTER, because verdict() reads a positive gap
//     as the first player leading;
//   * an axis metric is DENOMINATED IN POINTS, because threshold() returns a
//     points gate - testing "39 rank places >= 2.0 points" is nonsense.
// `mktRank` sits in the array one character away from axis:true, so this is a
// live hazard rather than a hypothetical. A test asserts it.
export const axisContractHolds = (metrics = METRICS) =>
  metrics.filter((m) => m.axis).every((m) => m.dir === "high");

export const posRankNumber = (posRank) => {
  const m = /(\d+)\s*$/.exec(String(posRank || ""));
  return m ? parseInt(m[1], 10) : null;
};

// ---------------------------------------------------------------------------
// Building a comparison.
// ---------------------------------------------------------------------------

// Which metrics are honest for this particular set of players.
//
// Two gates, in order. A metric is dropped when the pool spans positions and
// the metric cannot cross them; and dropped when not one selected player has
// a value for it, so an unreachable market layer or an unpriced game removes
// the column instead of printing a wall of dashes.
export function applicableMetrics(players, metrics = METRICS) {
  const positions = new Set(players.map((p) => p.pos).filter(Boolean));
  const mixed = positions.size > 1;
  return metrics.filter((m) => {
    if (mixed && !m.crossPosition) return false;
    return players.some((p) => m.get(p) !== null);
  });
}

// The ranking axis: the first axis-eligible metric every selected player has.
// VOR first because it is the only one that is fair across positions; points
// as the fallback when replacement level could not be measured.
export function rankingMetric(players, metrics = METRICS) {
  return metrics.find((m) => m.axis && players.every((p) => m.get(p) !== null)) || null;
}

// Could these two players be put in the SAME starting slot this week?
//
// This is the question that decides which axis is honest, and it is not a
// detail. The two axes answer different questions and the page was about to
// print both at once: the calls block eight lines above solves the lineup on
// raw projected points, so for a flex pair it could say "Start the QB, +8.0"
// while the compare block said "the RB by 7.5" - both defensible, neither
// reconcilable by a reader.
//
// The tiebreak is what the opportunity cost actually IS. For two players
// competing for one slot you already own, the cost of starting one is the
// other, so the honest axis is projected points - and that is exactly what the
// lineup solver uses, so the two agree. For everything else - hold, drop,
// trade, waiver - the cost is measured against the league's free pool, which
// is what value over replacement is for.
export function sharesASlot(a, b, slots = []) {
  return slots.some((slot) => canFill(slot, a.pos) && canFill(slot, b.pos));
}

// compare(ids, ctx) -> the whole structure the surface renders.
//
// ctx: { byId, sigma, slots }  - byId is the league's player map, sigma the
// measured per-position noise from value.js.
export function compare(ids, ctx) {
  const players = ids
    .map((id) => ctx.byId.get(String(id)))
    .filter(Boolean);

  if (players.length < 2) {
    return { mode: "empty", players, metrics: [], rows: [], axis: null, verdict: null };
  }

  const metrics = applicableMetrics(players);
  const positions = [...new Set(players.map((p) => p.pos).filter(Boolean))];
  const mixed = positions.length > 1;

  // A two-player comparison where both could take the same seat is a start/sit
  // question, and start/sit is decided on points - the same axis the lineup
  // solver on this page already uses, so the two cannot contradict each other.
  // Everything else ranks on value over replacement. See sharesASlot().
  const pts = METRICS.find((m) => m.key === "pts");
  const startSit = players.length === 2 && sharesASlot(players[0], players[1], ctx.slots);
  const axis = (startSit && players.every((p) => pts.get(p) !== null))
    ? pts
    : rankingMetric(players);

  const ranked = axis
    ? [...players].sort((a, b) => {
        const av = axis.get(a), bv = axis.get(b);
        return axis.dir === "low" ? av - bv : bv - av;
      })
    : players;

  const rows = metrics.map((m) => {
    const cells = ranked.map((p) => {
      const v = m.get(p);
      return { id: p.id, value: v, text: v === null ? "—" : m.fmt(v, p) };
    });
    const nums = cells.map((c) => c.value).filter((v) => typeof v === "number");
    const best = m.dir && nums.length > 1
      ? (m.dir === "low" ? Math.min(...nums) : Math.max(...nums))
      : null;
    // Only mark a winner when it is unambiguous. Every player tied on a metric
    // means nobody wins it, and highlighting all of them says nothing.
    const winners = best === null ? [] : cells.filter((c) => c.value === best);
    return {
      key: m.key, label: m.label, note: m.note, dir: m.dir,
      cells: cells.map((c) => ({ ...c, best: winners.length === 1 && c.value === best })),
    };
  });

  return {
    mode: players.length === 2 ? "head-to-head" : "pool",
    players: ranked, metrics, rows, axis, mixed, positions,
    startSit,
    verdict: players.length === 2 ? verdict(ranked[0], ranked[1], ctx, axis, startSit) : null,
    droppedForMixing: mixed
      ? METRICS.filter((m) => !m.crossPosition && players.some((p) => m.get(p) !== null))
               .map((m) => m.label)
      : [],
  };
}

// Head-to-head: is the gap a decision, or is it noise?
//
// THE GAP IS MEASURED ON THE RANKING AXIS, NOT ALWAYS ON RAW POINTS.
//
// First version of this function always subtracted raw projections while the
// pool above it was ordered by VOR. Across two positions those can disagree -
// a running back can lead on value-over-replacement while trailing on points -
// and the verdict would then name the player ranked first and quote the margin
// the OTHER one leads by. Plausible, well-formed, and backwards. Exactly the
// failure mode the lockout-cost bug had twice in Phase 3a, so it is worth
// saying out loud: a displayed number with no independent check is the
// riskiest thing in a changeset.
//
// Both candidate axes (VOR and projected points) are denominated in points, so
// the measured half-sigma gate from value.js is the right gate for either.
export function verdict(a, b, ctx, axis = null, startSit = false) {
  const metric = axis || METRICS.find((m) => m.key === "pts");
  const av = n(metric.get(a)), bv = n(metric.get(b));

  // NO FABRICATED ZERO. A player with no projection this week - on a bye, or
  // simply absent from the feed - has no number, and `null - 0` is not a gap,
  // it is the whole of the other player's projection wearing a gap's clothes.
  // The page builds real roster entries with pts:null and gives them a working
  // selector, so this is reachable, not theoretical. It is the same defect
  // that was just removed from vor(), and it does not get to live here either.
  if (av === null || bv === null) {
    const missing = av === null ? a : b;
    return {
      winner: null, metric: metric.key, gap: null,
      gate: one(threshold(ctx.sigma || {}, a.pos, b.pos), 2),
      decisive: false,
      text: "Can't compare",
      why: `${missing.name} has no projection this week — he is on a bye, or absent from the ` +
           `feed. There is no gap to measure, so this tool will not invent one.`,
    };
  }

  const gap = av - bv;                          // + means `a` leads, always
  const gate = threshold(ctx.sigma || {}, a.pos, b.pos);
  const decisive = Math.abs(gap) >= gate;
  const leader = gap >= 0 ? a : b;
  const basis = metric.key === "vor" ? "on value over replacement" : "on projected points";
  const frame = startSit
    ? ""
    : metric.key === "vor"
      ? " These two cannot take the same seat this week, so this is a hold-and-drop read, not a start/sit one."
      : "";

  return {
    winner: decisive ? leader.id : null,
    metric: metric.key,
    gap: one(gap, 2),
    gate: one(gate, 2),
    decisive,
    text: decisive
      ? `${leader.name} by ${one(Math.abs(gap), 1)}`
      : "Too close to call",
    why: decisive
      ? `${one(Math.abs(gap), 1)} ${basis} clears the ${one(gate, 1)}-point noise threshold for ` +
        `${[a.pos, b.pos].filter(Boolean).join("/")} this week.${frame}`
      : `${one(Math.abs(gap), 1)} ${basis} is inside the ${one(gate, 1)}-point noise threshold for ` +
        `${[a.pos, b.pos].filter(Boolean).join("/")}, so this week's numbers cannot separate them.${frame}`,
  };
}

// Rest-of-season from Sleeper's all-18-weeks call.
//
// RE-SCORED AT THE LEAGUE'S OWN RULES, NEVER THE VENDOR'S TOTAL.
//
// The first version summed `stats.pts_ppr`, which is the exact number
// scoring.js puts in NOT_PRODUCTION and the footer of this very page promises
// we never show: it pays 6 for a passing touchdown where both of Chris's
// leagues pay 4. Over fourteen remaining weeks that overstates a quarterback
// by roughly fifty points - decisive-sized in the superflex league, where
// quarterback hold-and-trade calls are the whole point of the row.
//
// The weekly payload carries the same stat vocabulary as the weekly
// projections, so the league's own scoring settings re-score it directly.
// That is also why this is per league rather than a single global cache: the
// same player's rest-of-season is a different number in each of them.
//
// A null week is a bye OR missing data and the two are indistinguishable in
// the payload, so the bye is only reported when the caller passes a schedule
// that confirms it. Weeks already played are excluded.
export function restOfSeason(weekRows, fromWeek, scoring, confirmedBye = null) {
  if (!weekRows || typeof weekRows !== "object" || !scoring) return null;
  let total = 0, weeks = 0;
  for (const [wk, row] of Object.entries(weekRows)) {
    const w = parseInt(wk, 10);
    if (!Number.isFinite(w) || w < fromWeek) continue;
    // An EMPTY stat object is missing data, not a zero-point week. rescore()
    // happily returns 0 for {}, which would drag a bye into the average as a
    // real performance. A week with no stat keys at all is skipped; a week
    // with keys that happen to sum to zero is a genuine zero and is kept.
    const stats = row?.stats;
    if (!stats || typeof stats !== "object" || Object.keys(stats).length === 0) continue;
    const scored = rescore(stats, scoring);
    if (!scored || typeof scored.pts !== "number") continue;
    total += scored.pts; weeks += 1;
  }
  if (!weeks) return null;
  return { total: one(total, 1), weeks, bye: confirmedBye, from: fromWeek };
}

// vacancy.js - work that just came free, and who is standing next to it.
//
// THE THIRD WAIVER QUESTION.
//
// waivers.js asks two things and both look BACKWARD. `upgrades()` compares
// this week's projections, which every manager in the league can also read.
// `risers()` reads snaps and opportunities, which only move after a box score
// everybody saw. In a 14-team league where replacement level is already
// rostered, neither can get there first - they can only confirm a claim
// somebody else has already made.
//
// This module asks the forward one: whose job just opened, and is the man who
// inherits it still free? The answer exists on Wednesday, days before the
// usage that will eventually prove it, and it needs no games to have been
// played at all - which is why this block has something to say in week 1,
// where `risers()` correctly has nothing.
//
// `build/vacancy.py` supplies the facts: who is absent and how absent, plus
// every skill player's depth-chart rank today and how it moved over a week.
// It deliberately does not name an inheritor, because who inherits is only
// interesting if he is FREE, and freedom is a property of a league, not of
// the NFL. That judgement lives here, where a roster exists and a test can
// see it.
//
// EXCEPTION-BASED, LIKE EVERY OTHER BLOCK.
//
// Sleeper already has a free-agent list and it is better than anything here.
// This surface stays silent unless a specific job opened and a specific free
// player is next in line for it. A ranked board of backups would be the old
// product's mistake with a new data source behind it.
//
// Pure: no fetch outside load(), no DOM, no clock.

import { canFill } from "./lineup.js";

// HOW HIGH AN ABSENCE HAS TO BE TO MEAN ANYTHING.
//
// Measured against the ABSENT player's own rank, not the inheritor's. A QB2
// going out frees nothing, because the QB1 in front of him still plays; a QB1
// going out hands his whole job to someone. The numbers differ by position
// because the number of players a real offence uses differs:
//
//   QB 1   one man plays; rank 2 is a spectator either way
//   RB 2   committees are normal, so the RB2 carries real work
//   WR 3   three-receiver sets are the base offence in 2026
//   TE 1   the TE2 is a blocker in most schemes
//
// This gate is what keeps the block quiet. Live on week 3, it is the reason
// NYJ's Kene Nwangwu - genuinely Out, genuinely a running back, and fourth on
// the chart - correctly produces nothing at all.
export const MATTERS_AT = { QB: 1, RB: 2, WR: 3, TE: 1 };

const NOT_WORTH_CLAIMING = new Set(["K", "DEF"]);
const ALL_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const POSITIONS_FOR = (slot) => ALL_POS.filter((pos) => canFill(slot, pos));

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function load(season, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`./data/vacancy_${season}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const raw = await r.json();
    if (!Array.isArray(raw?.absent) || !raw?.depth) throw new Error("unexpected payload shape");
    return index(raw);
  } catch (err) {
    // No vacancy layer is a missing enrichment, not a broken page - exactly
    // as with the usage mirror. The block disappears; nothing else changes.
    console.warn("vacancy layer unavailable:", err.message);
    return { ok: false, absent: [], depth: new Map(), byTeam: new Map(),
             week: null, coverage: {}, error: err.message };
  }
}

export function index(raw) {
  const depth = new Map(Object.entries(raw.depth).map(([id, d]) => [String(id), d]));

  // Every team's chart at every position, pre-sorted. Built once: the
  // inheritor search walks a position group per absence, and rebuilding it
  // per row would be quadratic in a file this shape.
  const byTeam = new Map();
  for (const [id, d] of depth) {
    const key = `${d.tm}:${d.pos}`;
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push({ id, ...d });
  }
  for (const list of byTeam.values()) list.sort((a, b) => a.rk - b.rk);

  return {
    ok: depth.size > 0,
    season: raw.season,
    week: raw.week,
    weeks: raw.weeks || [],
    coverage: raw.coverage || {},
    depthAsOf: raw.depth_asof,
    generatedAt: raw.generated_at,
    absent: raw.absent.map((a) => ({ ...a, id: String(a.id) })),
    depth,
    byTeam,
  };
}

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

// Is this player claimable in THIS league right now?
//
// Deliberately looser than waivers.js's freeAgents(), in the one way that
// matters. That function requires a projection, because it is comparing
// points. This one does not, because the whole premise of the block is
// getting there BEFORE the projection feed has noticed - a back who was
// third on the chart on Sunday may have no meaningful projection on
// Wednesday and still be the most valuable name on the wire. He is surfaced
// with `unprojected: true` rather than dropped, and the row says so.
function claimable(id, L, vacRow) {
  if (L.rostered?.has(id)) return null;
  if (NOT_WORTH_CLAIMING.has(vacRow.pos)) return null;

  const startable = new Set((L.slots || []).flatMap((s) => POSITIONS_FOR(s)));
  if (!startable.has(vacRow.pos)) return null;

  const p = L.priced?.get(id) || null;

  // THE TEAM-AUTHORITY TRAP, IMPORTED FROM THE SEASON PAGES.
  //
  // The depth chart is rebuilt weekly; Sleeper's team is live. When the two
  // disagree the player has moved since the build, and every fact this row
  // would assert - which offence, which starter he is behind, whose absence
  // he inherits - is about the wrong team. There is no safe way to patch
  // that up from here, so the row is dropped rather than guessed at.
  if (p?.team && vacRow.tm && p.team !== vacRow.tm) return null;

  // Ruled out himself: claiming a player who will not play this week to
  // cover a player who will not play this week is not an upgrade.
  if (p && p.startable === false) return null;

  return { priced: p, unprojected: !p };
}

// The usage read for one player, as a single comparable number.
//
// Opportunities - carries plus targets - because it is the one measure that
// spans a backfield and a receiver room, and because it is what a coach
// controls. Recent window, not season: the question is who has been getting
// the work lately, which is precisely what a season average washes out.
function touches(id, usage) {
  const u = usage?.byId?.get?.(id);
  if (!u) return null;
  return n(u.oppPerGameRecent) ?? n(u.oppPerGame) ?? null;
}

// Walk a team's position group and return the first man who is not himself
// absent. Returns null when the chart runs out.
//
// SKIPPING THE ABSENT INHERITOR IS NOT AN EDGE CASE.
//
// Week 3 of 2026 had it live on the first team checked: Michael Penix Jr. out
// with a knee, and the next quarterback on Atlanta's chart was Tua
// Tagovailoa - doubtful with an oblique. A block that named Tua as the claim
// would be recommending a player who is himself the subject of a row three
// lines further down. The search continues past him to whoever is actually
// expected to take the field.
function nextUp(chart, fromRank, absentIds) {
  for (const c of chart) {
    if (c.rk <= fromRank) continue;
    if (absentIds.has(c.id)) continue;
    return c;
  }
  return null;
}

/**
 * Jobs that just opened, and the free player standing next to each.
 *
 * @param L    the league: { priced, rostered, slots }
 * @param vac  an indexed vacancy payload
 * @param usage the usage mirror, for the cross-check (optional)
 */
export function vacancies(L, vac, { usage = null, limit = 4 } = {}) {
  if (!vac?.ok || !L?.rostered) return [];

  const absentIds = new Set(vac.absent.map((a) => a.id));
  const newest = Math.max(...vac.weeks, 0);
  const out = [];

  for (const a of vac.absent) {
    const mine = vac.depth.get(a.id);
    // Not on the depth chart at all: he may be a practice-squad body or a
    // player the chart has not caught up with. Either way there is no "next
    // man" to name, and inventing one from the position group's top would
    // claim the starter is out when he is not.
    if (!mine) continue;

    const matters = MATTERS_AT[a.pos];
    if (!matters || mine.rk > matters) continue;

    const chart = vac.byTeam.get(`${a.tm}:${a.pos}`) || [];
    const heir = nextUp(chart, mine.rk, absentIds);
    if (!heir) continue;

    const ok = claimable(heir.id, L, heir);
    if (!ok) continue;

    // THE CROSS-CHECK, AND WHY IT REPORTS RATHER THAN RESOLVES.
    //
    // A depth chart is a statement of intent published by a team that has
    // every reason to be vague. Usage is a record of what actually happened.
    // In full PPR they disagree in a specific, expensive way: the paper RB2
    // is often the early-down banger while the RB3 catches the passes, and
    // the second is worth more in this scoring than the first.
    //
    // So when the man with the most recent work is NOT the man the chart
    // promotes, both are named and the row says they disagree. Picking a
    // winner here would be this module claiming to know something neither
    // source knows - and the disagreement itself is the useful signal, which
    // is the same reasoning signals.js applies to projection-versus-form.
    //
    // QBs are excluded from the check: opportunities are carries plus
    // targets, which is meaningless for a passer. waivers.js guards the same
    // way for the same reason.
    let disagree = null;
    if (a.pos !== "QB" && usage) {
      let best = null;
      for (const c of chart) {
        if (c.id === a.id || absentIds.has(c.id)) continue;
        const t = touches(c.id, usage);
        if (t === null) continue;
        if (!best || t > best.t) best = { ...c, t };
      }
      if (best && best.id !== heir.id && claimable(best.id, L, best)) {
        disagree = { id: best.id, nm: best.nm, rk: best.rk, opp: r1(best.t) };
      }
    }

    out.push({
      id: heir.id,
      nm: heir.nm,
      pos: heir.pos,
      tm: heir.tm,
      rk: heir.rk,
      climb: heir.climb ?? null,
      pts: ok.priced ? n(ok.priced.pts) : null,
      unprojected: ok.unprojected,
      // The absence that created the opening, carried whole so the row can
      // state its own evidence rather than asserting a conclusion.
      over: {
        id: a.id, nm: a.nm, rk: mine.rk, wk: a.wk,
        st: a.st, prac: a.prac ?? null, inj: a.inj ?? null, tier: a.tier,
      },
      disagree,
      // A vacancy reported off last week's finished report is a FACT; one off
      // this week's partial report is a lead. The consumer must be able to
      // tell, so the week travels with the row.
      stale: a.wk < newest,
    });
  }

  // ONE CLAIM PER OPENING, AND THE STRONGEST EVIDENCE FIRST.
  //
  // Two absences on the same team at the same position resolve to the same
  // heir, and offering him twice is the four-near-identical-tight-ends bug
  // that waivers.js already learned. Confirmed beats watch, and a more
  // senior absence beats a junior one, so the surviving row is the one
  // carrying the best reason.
  const rank = (v) => (v.over.tier === "confirmed" ? 0 : 1) * 100 + v.over.rk;
  const seen = new Map();
  for (const v of out.sort((x, y) => rank(x) - rank(y))) {
    if (!seen.has(v.id)) seen.set(v.id, v);
  }
  return [...seen.values()].slice(0, limit);
}

/**
 * Players the depth chart promoted without anybody getting hurt.
 *
 * The quieter half. A coaching decision shows up here a week before it shows
 * up in a box score, and unlike an injury it is never reported as news.
 */
export function promotions(L, vac, { usage = null, limit = 3, exclude = new Set() } = {}) {
  if (!vac?.ok || !L?.rostered) return [];
  const absentIds = new Set(vac.absent.map((a) => a.id));
  const out = [];

  for (const [id, d] of vac.depth) {
    if (exclude.has(id) || absentIds.has(id)) continue;
    // `climb` is null - never 0 - for a player who was not on the chart a
    // week ago or who changed teams. That is an arrival, not a promotion,
    // and it is a different claim this function does not make.
    if (!d.climb || d.climb < 1) continue;

    const matters = MATTERS_AT[d.pos];
    if (!matters || d.rk > matters) continue;

    const ok = claimable(id, L, d);
    if (!ok) continue;

    out.push({
      id, nm: d.nm, pos: d.pos, tm: d.tm, rk: d.rk, climb: d.climb,
      pts: ok.priced ? n(ok.priced.pts) : null,
      unprojected: ok.unprojected,
      opp: r1(touches(id, usage)),
    });
  }

  // Biggest move first, then the most senior resulting job.
  return out
    .sort((a, b) => (b.climb - a.climb) || (a.rk - b.rk))
    .slice(0, limit);
}

/**
 * The whole block, ready to render. `any` is what the UI gates on.
 */
export function vacancyBoard(L, vac, { usage = null } = {}) {
  if (!vac?.ok || !L?.rostered) {
    return { any: false, vacancies: [], promotions: [], week: null, partial: false };
  }
  const vs = vacancies(L, vac, { usage });
  const ps = promotions(L, vac, { usage, exclude: new Set(vs.map((v) => v.id)) });

  // HOW COMPLETE IS THIS WEEK'S REPORT?
  //
  // nflverse ingests the practice report club by club as it is filed, so a
  // Tuesday-evening build holds a nearly empty current week beside a complete
  // previous one. A page that renders 2-of-32 teams as though it were the
  // league is lying by omission, and this is the flag that stops it.
  const cov = vac.coverage?.[String(vac.week)];
  const reported = cov?.teams_reported ?? null;

  return {
    any: vs.length > 0 || ps.length > 0,
    vacancies: vs,
    promotions: ps,
    week: vac.week,
    depthAsOf: vac.depthAsOf,
    teamsReported: reported,
    partial: reported !== null && reported < 32,
  };
}

export { POSITIONS_FOR, claimable, nextUp, touches };

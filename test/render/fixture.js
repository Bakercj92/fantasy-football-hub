// A HOSTILE fixture, not a realistic one.
//
// Chris's actual rosters would exercise almost none of this: one locked
// player, no Rams, no missing market entry, every position clean. A fixture
// built to look like his week puts nothing on most branches. So this one is
// built to put something on every branch at once.
const SEASON = "2026", WEEK = 1;

// --- the player universe ----------------------------------------------------
// Big enough that replacement level is actually measured rather than falling
// off the end of a short list.
const TEAMS = ["KC","BUF","SF","DAL","PHI","MIA","DET","BAL","CIN","MIN","GB","HOU","LAR","SEA","NE","ATL"];
const universe = [];
let seq = 1000;
function mk(pos, team, pts, extra = {}) {
  const id = String(++seq);
  universe.push({
    player_id: id, team,
    player: { first_name: extra.first || pos + seq, last_name: extra.last || "P" + seq,
              position: pos, injury_status: extra.injury || null },
    opponent: extra.opponent ?? "OPP",
    stats: extra.stats || ptsToStats(pos, pts),
    game_id: null,
  });
  return id;
}
// Turn a target point total into the raw stat line the app re-scores. Passing
// yards for QBs, receptions+yards for pass catchers, rushing for backs - so
// the scoring layer is genuinely exercised rather than handed a total.
function ptsToStats(pos, pts) {
  if (pos === "QB")  return { pass_yd: pts * 12, pass_td: 1, rush_yd: 10 };
  if (pos === "RB")  return { rush_yd: pts * 6, rec: 2, rec_yd: 14 };
  if (pos === "WR")  return { rec: pts / 3, rec_yd: pts * 5, rec_td: 0 };
  if (pos === "TE")  return { rec: pts / 3.5, rec_yd: pts * 4 };
  if (pos === "K")   return { fgm: 2, xpm: 2 };
  return { def_td: 0, pts_allow: 17, sack: 2 };
}

for (let i = 0; i < 26; i++) mk("QB", TEAMS[i % 16], 24 - i * 0.7);
for (let i = 0; i < 40; i++) mk("RB", TEAMS[i % 16], 20 - i * 0.4);
for (let i = 0; i < 46; i++) mk("WR", TEAMS[i % 16], 19 - i * 0.32);
for (let i = 0; i < 22; i++) mk("TE", TEAMS[i % 16], 13 - i * 0.45);
for (let i = 0; i < 14; i++) mk("K",  TEAMS[i % 16], 9 - i * 0.2);
for (const t of TEAMS) universe.push({
  player_id: t, team: t, player: { position: "DEF" }, opponent: "OPP",
  stats: { pts_allow: 17, sack: 2 }, game_id: null,
});

// --- the hostile roster -----------------------------------------------------
const H = {};
// A mixed-position pair with a genuine cross-position disagreement: the RB
// leads on value over replacement, the WR leads on raw points.
H.rbValue  = mk("RB", "KC",  11.0, { first: "Vor", last: "Leader" });
H.wrPoints = mk("WR", "BUF", 15.5, { first: "Points", last: "Leader" });
// Two receivers at the same position, so the per-position metrics come back.
H.wrA = mk("WR", "SF",  12.6, { first: "Same", last: "PosA" });
H.wrB = mk("WR", "DAL", 12.2, { first: "Same", last: "PosB" });
// A dead heat inside the noise threshold.
H.tieA = mk("TE", "PHI", 8.0, { first: "Dead", last: "HeatA" });
H.tieB = mk("TE", "MIA", 8.0, { first: "Dead", last: "HeatB" });
// Ruled out, but the feed still publishes a projection for him.
H.out = mk("RB", "DET", 16.0, { injury: "Out", first: "Ruled", last: "Out" });
// A Rams player: nflverse spells the team LA, Sleeper spells it LAR.
H.ram = mk("WR", "LAR", 13.4, { first: "Rams", last: "Alias" });
// A team code the schedule has never heard of - a join failure that must not
// be allowed to look like a bye.
H.bogus = mk("RB", "ZZZ", 10.2, { first: "Bogus", last: "Team" });
// No FantasyCalc entry at all: the market rows must go blank for him, not zero.
H.noMarket = mk("TE", "GB", 9.4, { first: "No", last: "Market" });
// Locked-and-bad starter and locked-and-good bench player (SEA and NE played
// the Wednesday opener in real 2026 week 1, so these lock against real data).
H.lockedBadStarter = mk("WR", "SEA", 5.1, { first: "Locked", last: "Bad" });
H.lockedGoodBench  = mk("RB", "NE", 17.8, { first: "Locked", last: "Good" });
// A clean live upgrade sitting on the bench.
H.upgrade = mk("WR", "BAL", 16.9, { first: "Live", last: "Upgrade" });
H.qb1 = mk("QB", "CIN", 21.5, { first: "Starting", last: "Quarterback" });
H.qb2 = mk("QB", "MIN", 19.2, { first: "Second", last: "Quarterback" });
H.k1  = mk("K",  "HOU", 8.4,  { first: "The", last: "Kicker" });

// A rostered id that is absent from the projections feed entirely: the app
// builds a real entry for him with pts:null and a working selector, so the
// compare tool must refuse to invent a gap rather than treating null as zero.
H.noProjection = "999999";
const myPlayers = [...Object.values(H), "KC"];
// Aligned to LEAGUES[].roster_positions, position by position. An earlier
// version was one short and slid a defense into the kicker slot, which made
// the wire offer four kickers "over KC" - a fixture bug that exposed a real
// one. "0" is how Sleeper marks a slot genuinely left empty.
// Joop:  QB RB RB WR WR WR TE FLEX K DEF
const starters14 = [H.qb1, H.rbValue, H.out, H.wrPoints, H.lockedBadStarter, H.ram,
                    H.tieA, H.bogus, H.k1, "KC"];
// BKU:   QB RB RB WR WR TE FLEX SUPER_FLEX K DEF
const starters8  = [H.qb1, H.rbValue, H.lockedGoodBench, H.wrPoints, H.wrA, H.tieA,
                    "0", H.qb2, H.k1, "KC"];

const SCORING = { rec: 1, pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6,
                  rec_yd: 0.1, rec_td: 6, fgm: 3, xpm: 1, sack: 1, pts_allow: 0, def_td: 6 };

const LEAGUES = {
  "1389373222666932224": {
    name: "Joop Squad", total_rosters: 14, scoring_settings: SCORING,
    roster_positions: ["QB","RB","RB","WR","WR","WR","TE","FLEX","K","DEF",
                       "BN","BN","BN","BN","BN","BN"],
    settings: { waiver_budget: 100, playoff_week_start: 15 },
  },
  "1393723474328981504": {
    name: "Ball Knowers United", total_rosters: 8, scoring_settings: SCORING,
    roster_positions: ["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","K","DEF",
                       "BN","BN","BN","BN","BN","BN"],
    settings: { waiver_budget: 100, playoff_week_start: 15 },
  },
};

// Other managers own enough that replacement level lands somewhere real.
function rostersFor(id, starters) {
  const teams = LEAGUES[id].total_rosters;
  const mine = { owner_id: "1135437440241680384", players: myPlayers, starters,
                 settings: { waiver_budget_used: 23 } };
  const taken = new Set(myPlayers);
  const others = [];
  const pool = universe.map((u) => u.player_id).filter((x) => !taken.has(x));
  let k = 0;
  for (let t = 1; t < teams; t++) {
    const ps = [];
    for (let n = 0; n < 8 && k < pool.length; n++, k++) ps.push(pool[k]);
    others.push({ owner_id: "owner" + t, players: ps, starters: ps.slice(0, 9),
                  settings: { waiver_budget_used: 0 } });
  }
  return [mine, ...others];
}

// FantasyCalc, league-shaped. The superflex board really does move QBs up -
// that is the property the layer exists for, so the fixture reproduces it
// rather than serving one board twice.
function fcalc(numQbs) {
  const rows = [];
  const ordered = universe
    .filter((u) => ["QB","RB","WR","TE"].includes(u.player.position))
    .filter((u) => u.player_id !== H.noMarket)   // deliberately absent
    .map((u) => {
      const pos = u.player.position;
      const base = (u.stats.pass_yd || 0) * 0.04 + (u.stats.rush_yd || 0) * 0.1 +
                   (u.stats.rec_yd || 0) * 0.1 + (u.stats.rec || 0);
      const boost = pos === "QB" ? (numQbs === 2 ? 2.6 : 0.7) : 1;
      return { u, score: base * boost };
    })
    .sort((a, b) => b.score - a.score);
  ordered.forEach(({ u, score }, i) => rows.push({
    player: { sleeperId: u.player_id, name: `${u.player.first_name} ${u.player.last_name}`,
              position: u.player.position },
    value: Math.round(score * 420),
    overallRank: i + 1,
    positionRank: ordered.filter((o, j) => j <= i && o.u.player.position === u.player.position).length,
    trend30Day: ((i * 37) % 500) - 250,
    maybeRosterPercent: 0.9, maybeTier: Math.ceil((i + 1) / 12),
  }));
  return rows;
}

// Season-long weeks for the rest-of-season call. Week 7 is a bye (null stats),
// which the app must NOT report as a bye unless the schedule confirms it.
// RAW stats, never a vendor total. The first version of this fixture served
// pts_ppr, which encoded the same wrong assumption the code had - so no
// scenario could have caught the app summing the vendor's number. A fixture
// that shares the code's assumptions cannot audit them.
function seasonWeeks(id) {
  const out = {};
  const seed = (Number(id) || 7) % 9;
  for (let w = 1; w <= 18; w++) {
    out[w] = w === 7
      ? { stats: {} }                                  // bye: no keys at all
      : { stats: { rush_yd: (60 + seed * 6 + (w % 4) * 10), rec: 2, rec_yd: 18, pass_td: 0 } };
  }
  return out;
}

// --- the usage mirror ------------------------------------------------------
//
// Keyed to THIS fixture's player ids so the whole chain can be exercised:
// snap share and touches into the compare tool, usage trends into the waiver
// risers, and real per-week actuals into the Tuesday recap.
//
// Deliberately uneven. A player with a null snap row in one week proves
// missing-is-not-zero survives the average; a free agent whose last three
// games jump proves the riser gate fires; another whose jump comes off a tiny
// base proves it does not.
const COLS = ["wk","off_pct","tgt","rec","rec_yd","tgt_share","ay_share","wopr","car","rush_yd","att","pass_yd"];

function usagePayload({ throughWeek = 3, generatedAt = "2026-09-15T09:00:00Z" } = {}) {
  const p = {};
  const put = (id, pos, tm, weeks, actuals) => { p[id] = { pos, tm, w: weeks, a: actuals || {} }; };
  const wk = (n, off, tgt, car, share) => [n, off, tgt, Math.round(tgt * 0.65), tgt * 11, share, null, null, car, car * 4, 0, 0];

  // Rostered players, so the compare tool has usage columns to show.
  put(H.rbValue, "RB", "KC",
      [wk(1,0.62,3,14,0.08), wk(2,null,4,16,0.09), wk(3,0.71,2,18,0.06)],
      { "1":{rush_yd:64,rec:2,rec_yd:14}, "2":{rush_yd:71,rec:3,rec_yd:22,rush_td:1}, "3":{rush_yd:88,rec:1,rec_yd:6} });
  put(H.wrPoints, "WR", "BUF",
      [wk(1,0.88,9,0,0.27), wk(2,0.91,11,0,0.31), wk(3,0.86,8,0,0.24)],
      { "1":{rec:6,rec_yd:81}, "2":{rec:8,rec_yd:112,rec_td:1}, "3":{rec:5,rec_yd:54} });
  put(H.wrA, "WR", "SF",
      [wk(1,0.74,6,0,0.18), wk(2,0.77,7,0,0.20), wk(3,0.79,6,0,0.19)],
      { "1":{rec:4,rec_yd:47}, "2":{rec:5,rec_yd:63}, "3":{rec:4,rec_yd:38} });
  put(H.wrB, "WR", "DAL",
      [wk(1,0.55,4,0,0.12), wk(2,0.58,5,0,0.14), wk(3,0.51,3,0,0.10)],
      { "1":{rec:3,rec_yd:31}, "2":{rec:4,rec_yd:52}, "3":{rec:2,rec_yd:19} });
  put(H.qb1, "QB", "CIN",
      [[1,1,0,0,0,null,null,null,3,12,34,268],[2,1,0,0,0,null,null,null,2,5,31,240],[3,1,0,0,0,null,null,null,4,19,38,312]],
      { "1":{pass_yd:268,pass_td:2,rush_yd:12}, "2":{pass_yd:240,pass_td:1,pass_int:1,rush_yd:5}, "3":{pass_yd:312,pass_td:3,rush_yd:19} });

  // FREE AGENTS. `RISER` climbs hard off a real base and must surface;
  // `TINY` triples a microscopic base and must not.
  // Genuinely UNROSTERED. rostersFor() hands the first 8 x (teams-1) of the
  // spare pool to the other managers, so a player picked off the front of that
  // pool is somebody else's and can never show up on the wire. Take from the
  // tail, the same way the app will see it.
  const taken = new Set(myPlayers);
  const spare = universe.map((u) => u.player_id).filter((x) => !taken.has(x));
  const free = spare.slice(8 * 13);                    // past the 14-team league's share
  const freeAt = (pos, from) => (from.find((id) =>
    universe.find((u) => u.player_id === id)?.player?.position === pos));
  RISER = freeAt("WR", free);
  TINY  = freeAt("RB", free) || freeAt("TE", free);
  // Flat for four weeks, then the starter ahead of him goes down. Season
  // average stays low, the last three are a different player entirely - which
  // is the whole reason the gate is proportional to the season, not absolute.
  put(RISER, "WR", "MIN",
      [wk(1,0.22,1,0,0.04), wk(2,0.19,2,0,0.05), wk(3,0.24,1,0,0.04),
       wk(4,0.71,8,0,0.24), wk(5,0.79,10,0,0.28), wk(6,0.83,9,0,0.26)],
      {});
  if (TINY) put(TINY, "RB", "ATL",
      [wk(1,0.03,0,1,0.01), wk(2,0.05,0,2,0.01), wk(3,0.11,1,3,0.02),
       wk(4,0.04,0,1,0.01), wk(5,0.06,0,2,0.01), wk(6,0.12,1,3,0.02)], {});

  return { season: 2026, through_week: throughWeek, weeks: [1,2,3],
           generated_at: generatedAt, source_updated_at: null,
           cols: COLS, act_keys: ["rec","rec_yd","rush_yd","pass_yd","pass_td","pass_int","rush_td","rec_td"],
           p };
}
let RISER = null, TINY = null;

// --- the vacancy layer ------------------------------------------------------
//
// HOSTILE, like everything else here. Chris's real week would light up one
// branch; this payload lights up all of them at once:
//
//   * a quarterback out whose BACKUP IS ALSO OUT, so the block has to walk
//     past him to the third man (the live Penix/Tua case from week 3)
//   * an heir the projection feed has never heard of, which is the best case
//     for this block and the one most likely to render as an em dash
//   * a depth chart and a usage read that name DIFFERENT men, so the
//     disagreement copy is exercised
//   * an absent player too deep on the chart to matter, which must produce
//     nothing at all
//   * a player whose Sleeper team contradicts the chart, which must be
//     DROPPED rather than reconciled
//   * a promotion with nobody hurt
//   * a partially-filed current week, so the "only N of 32 clubs" caveat runs
function vacancyPayload({ week = 2, teamsReported = 32 } = {}) {
  const taken = new Set(myPlayers);
  const spare = universe.filter((u) => !taken.has(u.player_id) && u.player.position !== "DEF");
  const free = new Set(spare.slice(8 * 13).map((u) => u.player_id));   // genuinely unrostered

  // THE HEIR MUST BE FREE; NOBODY ELSE ON THE CHART HAS TO BE.
  //
  // The first version of this fixture tried to build whole position groups out
  // of the free pool and produced an empty payload, because after a 14-team
  // league takes its 104 players the tail holds eight receivers and no backs
  // at all. But an absent STARTER is a player we are never claiming - he can
  // be rostered, and normally is. So the charts are built from the whole
  // universe and only the man who inherits is required to be free.
  const group = (team, pos) => universe.filter((u) => u.team === team && u.player.position === pos);
  const nameOf = (u) => `${u.player.first_name} ${u.player.last_name}`;

  const depth = {}, absent = [], usageRows = {};
  const put = (u, rk, climb = null) => {
    depth[u.player_id] = { tm: u.team, pos: u.player.position, rk, climb, nm: nameOf(u) };
    return u.player_id;
  };
  const hurt = (u, o = {}) => absent.push({
    id: u.player_id, wk: week, nm: nameOf(u), tm: u.team, pos: u.player.position,
    st: "Out", prac: null, inj: "Hamstring", tier: "confirmed", ...o,
  });

  // Find a team whose position group has a free member with `above` others
  // ranked ahead of him.
  const findChart = (pos, above, skip = new Set()) => {
    for (const u of spare) {
      if (u.player.position !== pos || !free.has(u.player_id) || skip.has(u.team)) continue;
      const g = group(u.team, pos);
      const i = g.findIndex((x) => x.player_id === u.player_id);
      if (i >= above) return { team: u.team, chart: g, heirAt: i };
    }
    return null;
  };

  const usedTeams = new Set();

  // 1. WR1 out AND WR2 out, so the block has to walk past a hurt heir.
  const a = findChart("WR", 2, usedTeams);
  if (a) {
    usedTeams.add(a.team);
    a.chart.forEach((u, i) => put(u, i + 1));
    hurt(a.chart[0], { inj: "Knee" });
    hurt(a.chart[1], { st: "Doubtful", inj: "Oblique" });
  }

  // 2. TE1 out, TE2 free and inheriting - with a THIRD man who has the
  //    touches, so the disagreement copy runs. Usage rows for him ride along.
  const b = findChart("TE", 1, usedTeams);
  if (b) {
    usedTeams.add(b.team);
    b.chart.forEach((u, i) => put(u, i + 1));
    hurt(b.chart[0], { inj: "Knee" });
    const rival = b.chart.find((u, i) => i > b.heirAt && free.has(u.player_id));
    if (rival) {
      // Measured, and higher than the man the chart promotes.
      usageRows[rival.player_id] = { pos: "TE", tm: b.team, w: [
        [1, 0.40, 5, 3, 55, 0.14, null, null, 0, 0, 0, 0],
        [2, 0.44, 6, 4, 61, 0.16, null, null, 0, 0, 0, 0],
        [3, 0.46, 7, 5, 70, 0.18, null, null, 0, 0, 0, 0]], a: {} };
      usageRows[b.chart[b.heirAt].player_id] = { pos: "TE", tm: b.team, w: [
        [1, 0.20, 1, 0, 8, 0.03, null, null, 0, 0, 0, 0],
        [2, 0.18, 1, 1, 11, 0.03, null, null, 0, 0, 0, 0],
        [3, 0.22, 2, 1, 14, 0.04, null, null, 0, 0, 0, 0]], a: {} };
    }
  }

  // 3. An absence too deep on the chart to free anything.
  const c = findChart("WR", 3, usedTeams);
  if (c) {
    usedTeams.add(c.team);
    c.chart.forEach((u, i) => put(u, i + 1));
    hurt(c.chart[c.chart.length - 1], { inj: "Ankle" });
  }

  // 4. A promotion with nobody hurt: a free tight end moved up two.
  const d = findChart("TE", 0, usedTeams);
  if (d) {
    usedTeams.add(d.team);
    put(d.chart[d.heirAt], 1, 2);
  }

  // 5. A chart row whose team contradicts Sleeper. Must be DROPPED, never
  //    reconciled - the season pages' oldest landmine.
  const e = findChart("WR", 1, usedTeams);
  if (e) {
    put(e.chart[0], 1);
    hurt(e.chart[0], { inj: "Foot" });
    depth[e.chart[e.heirAt].player_id] = {
      tm: "ZZZ", pos: "WR", rk: 2, climb: null, nm: nameOf(e.chart[e.heirAt]),
    };
  }

  return {
    season: 2026, week, weeks: [week - 1, week].filter((w) => w > 0),
    generated_at: "2026-09-15T09:00:00Z",
    depth_asof: "2026-09-15T06:02:00Z", depth_prior: "2026-09-07T06:02:00Z",
    sources: { depth_charts: { ok: true, rows: 500 }, injuries: { ok: true, rows: 200 },
               weekly_rosters: { ok: true, rows: 800 } },
    source_updated_at: { depth_charts: null, injuries: null },
    coverage: { [String(week)]: { teams_reported: teamsReported, rows: 200 },
                [String(week - 1)]: { teams_reported: 32, rows: 240 } },
    absent, depth,
    // Usage the cross-check needs, for the harness to merge into the mirror.
    // Kept here so the two fixtures cannot drift out of agreement about who
    // the disagreeing player is.
    __usage: usageRows,
  };
}

// A payload with nothing to say. The block must vanish, not render an empty
// shell with a heading and a zero count.
function vacancyEmpty() {
  const v = vacancyPayload();
  return { ...v, absent: [], depth: {}, __usage: {} };
}

// THE DISAGREEMENT, HAND-BUILT.
//
// The generated payload cannot produce this shape: after a 14-team league has
// taken its share, no club has three free players at one position, and the
// disagreeing man has to be a THIRD name below the heir. So this one uses ids
// the projection feed has never heard of - which is not a cheat but a second
// branch, because an unrostered, unprojected player is exactly the case this
// block exists to surface and the copy for him is different.
function vacancyDisagree() {
  const nm = (n) => ({ tm: "KC", pos: "RB", climb: null, nm: n });
  return {
    season: 2026, week: 2, weeks: [1, 2],
    generated_at: "2026-09-15T09:00:00Z",
    depth_asof: "2026-09-15T06:02:00Z", depth_prior: "2026-09-07T06:02:00Z",
    sources: { depth_charts:{ok:true,rows:500}, injuries:{ok:true,rows:200},
               weekly_rosters:{ok:true,rows:800} },
    coverage: { "2": { teams_reported: 32, rows: 200 }, "1": { teams_reported: 32, rows: 240 } },
    depth: {
      "vac-starter": { ...nm("Bell Cow"), rk: 1 },
      "vac-heir":    { ...nm("Paper Backup"), rk: 2, climb: 1 },
      "vac-rival":   { ...nm("Pass Catcher"), rk: 3 },
    },
    absent: [{ id: "vac-starter", wk: 2, nm: "Bell Cow", tm: "KC", pos: "RB",
               st: "Questionable", prac: "Did Not Participate In Practice",
               inj: "Ankle", tier: "watch" }],
    // The chart promotes the banger; the touches belong to the other man.
    __usage: {
      "vac-heir":  { pos:"RB", tm:"KC", w:[[1,0.35,1,1,6,0.03,null,null,7,28,0,0],
                                           [2,0.38,1,1,9,0.03,null,null,8,31,0,0],
                                           [3,0.41,2,1,11,0.04,null,null,9,36,0,0]], a:{} },
      "vac-rival": { pos:"RB", tm:"KC", w:[[1,0.30,6,5,44,0.17,null,null,3,12,0,0],
                                           [2,0.33,7,6,52,0.19,null,null,4,17,0,0],
                                           [3,0.36,8,7,61,0.21,null,null,5,23,0,0]], a:{} },
    },
  };
}

module.exports = { SEASON, WEEK, H, universe, LEAGUES, rostersFor, fcalc,
                   seasonWeeks, starters14, starters8, myPlayers,
                   usagePayload, vacancyPayload, vacancyEmpty, vacancyDisagree,
                   riser: () => RISER, tiny: () => TINY };

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

const myPlayers = [...Object.values(H), "KC"];
const starters14 = [H.qb1, H.rbValue, H.out, H.wrPoints, H.lockedBadStarter, H.tieA,
                    H.bogus, H.k1, "KC"];
const starters8  = [H.qb1, H.rbValue, H.wrPoints, H.wrA, H.tieA, H.ram, H.qb2, H.k1, "KC"];

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
function seasonWeeks(id) {
  const out = {};
  for (let w = 1; w <= 18; w++) {
    out[w] = w === 7 ? { stats: {} } : { stats: { pts_ppr: 8 + ((Number(id) || 7) % 9) + (w % 4) } };
  }
  return out;
}

module.exports = { SEASON, WEEK, H, universe, LEAGUES, rostersFor, fcalc,
                   seasonWeeks, starters14, starters8, myPlayers };

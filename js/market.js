// market.js - what everyone else thinks.
//
// This layer NEVER moves a number. Our projection, re-scored at the league's
// own rules and measured against this league's real replacement level, is
// the opinion. Consensus is the market. The tool's job is to show where the
// two disagree, not to average them into mush - an average of a
// format-correct number and a 12-team-default number is just a worse
// format-correct number.
//
// Source is DynastyProcess's republication of FantasyPros ECR, because
// FantasyPros' own robots.txt disallows /api/, /json/ and /ajax/ and their
// real API is paid. DynastyProcess ships it as a plain CSV on
// raw.githubusercontent, which is CORS-open and free.
//
// Caveat worth remembering: this is someone else's scraper. It is a "latest"
// overwrite with no dated archive, so it can go stale or die without notice.
// Everything here degrades to null rather than throwing - the page must
// work with no market layer at all.

const WEEKLY = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/fp_latest_weekly.csv";
const IDS    = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

const XWALK_KEY = "ffh:xwalk:v1";
const XWALK_TTL = 7 * 24 * 3600 * 1000; // the crosswalk drifts slowly

// Team abbreviations that differ between sources. Sleeper's spelling wins,
// because Sleeper ids are this app's spine.
const TEAM_ALIAS = { JAC:"JAX", LA:"LAR", WSH:"WAS", ARZ:"ARI", BLT:"BAL", HST:"HOU", CLV:"CLE", SL:"LAR", OAK:"LV", SD:"LAC" };
const team = (t) => TEAM_ALIAS[String(t || "").toUpperCase()] || String(t || "").toUpperCase();

// Minimal RFC4180-ish parser. The files carry quoted fields containing
// commas (player names, notes), so splitting on "," is not an option.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null; // "NA" and "" both become null
};

async function crosswalk() {
  try {
    const hit = JSON.parse(localStorage.getItem(XWALK_KEY) || "null");
    if (hit && Date.now() - hit.at < XWALK_TTL) return hit.map;
  } catch { /* private window, cleared storage, quota - all fine */ }

  const rows = parseCSV(await (await fetch(IDS)).text());
  const map = {};
  for (const r of rows) {
    if (r.fantasypros_id && r.sleeper_id) map[r.fantasypros_id] = r.sleeper_id;
  }
  try { localStorage.setItem(XWALK_KEY, JSON.stringify({ at: Date.now(), map })); } catch {}
  return map;
}

// Returns a Map keyed by SLEEPER id. Never throws.
export async function consensus() {
  try {
    const [map, text] = await Promise.all([crosswalk(), fetch(WEEKLY).then((r) => r.text())]);
    const out = new Map();
    let scraped = null;
    for (const r of parseCSV(text)) {
      scraped = scraped || r.scrape_date;
      // Defenses have no crosswalk entry - their Sleeper id IS the team.
      const isDef = /^(DST|DEF)$/i.test(r.pos || "") || /^dst$/i.test(r.page || "");
      const sid = isDef ? team(r.team) : map[r.fantasypros_id];
      if (!sid) continue;
      out.set(String(sid), {
        ecr: num(r.ecr),
        posRank: r.pos_rank || null,
        sd: num(r.sd),
        best: num(r.best),
        worst: num(r.worst),
        grade: r.start_sit_grade || null,
        delta: num(r.player_ecr_delta),   // + = falling in consensus
        owned: num(r.player_owned_avg),
        name: r.player_name || null,
      });
    }
    return { byId: out, scrapeDate: scraped, ok: out.size > 0 };
  } catch (err) {
    console.warn("market layer unavailable:", err.message);
    return { byId: new Map(), scrapeDate: null, ok: false, error: err.message };
  }
}

// Where our ranking and the market's disagree.
//
// Two corrections that matter more than they look:
//
// 1. Our side ranks by VOR, not by raw projected points. Within one roster
//    the comparison is cross-position - a quarterback against a wide
//    receiver - and raw points make every quarterback look like a stud.
//    Consensus ECR is already a cross-position number, so VOR is the only
//    like-for-like currency to put beside it.
//
// 2. The gap that counts as a disagreement scales with roster size. A gap
//    of 8 ranks is enormous inside a 16-player roster and unremarkable
//    inside a national top-200. Fixed thresholds imported from national
//    rankings are how a tool ends up either silent or screaming.
const ourValue = (p) => (typeof p.vor === "number" ? p.vor : p.pts);

export function disagreements(roster, market, minGap = null) {
  const ours = roster
    .filter((p) => typeof ourValue(p) === "number" && market.byId.has(p.id))
    .sort((a, b) => ourValue(b) - ourValue(a))
    .map((p, i) => ({ ...p, ourRank: i + 1 }));

  if (ours.length < 4) return [];
  const gate = minGap ?? Math.max(3, Math.ceil(ours.length / 5));

  const rankOf = new Map(
    [...ours]
      .sort((a, b) => (market.byId.get(a.id).ecr ?? 1e9) - (market.byId.get(b.id).ecr ?? 1e9))
      .map((p, i) => [p.id, i + 1])
  );

  return ours
    .map((p) => ({ ...p, theirRank: rankOf.get(p.id), gap: rankOf.get(p.id) - p.ourRank }))
    .filter((p) => Math.abs(p.gap) >= gate)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

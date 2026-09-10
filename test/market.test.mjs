import { parseCSV, disagreements } from "../js/market.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };

t("parseCSV handles quoted commas, escaped quotes and NA", () => {
  const rows = parseCSV('"a","b","c"\n"Smith, Jr.","say ""hi""",NA\n"x","y",3.5\n');
  assert.strictEqual(rows[0].a, "Smith, Jr.");
  assert.strictEqual(rows[0].b, 'say "hi"');
  assert.strictEqual(rows[0].c, "NA");
  assert.strictEqual(rows[1].c, "3.5");
});

t("parseCSV survives a missing trailing newline", () => {
  assert.strictEqual(parseCSV('"a"\n"z"').length, 1);
});

t("parseCSV keeps the real FantasyPros header shape", () => {
  const head = '"page","page_pos","scrape_date","fantasypros_id","player_name","pos","team","rank","ecr","sd","best","worst","player_positions","player_short_name","player_eligibility","player_page_url","player_filename","player_bye_week","player_owned_avg","player_opponent","player_opponent_id","player_ecr_delta","note","tag","recommendation","pos_rank","start_sit_grade","r2p_pts"';
  const line = '"qb","QB",2026-09-09,"17233","Lamar Jackson","QB","BAL",1,2.06,1.38,1,8,"QB","L. Jackson","QB","u","f","13",99.7,"at IND","IND",NA,NA,NA,NA,"QB1","A+","21.8"';
  const r = parseCSV(head + "\n" + line + "\n")[0];
  assert.strictEqual(r.fantasypros_id, "17233");
  assert.strictEqual(r.pos_rank, "QB1");
  assert.strictEqual(r.start_sit_grade, "A+");
  assert.strictEqual(r.ecr, "2.06");
});

// market fixture: byId keyed by sleeper id -> {posRank, grade}
const mkt = (pairs) => ({ ok: true, byId: new Map(pairs.map(([id, posRank]) => [id, { posRank, grade: null }])) });

// a priced universe: n players at a position, descending points
const universe = (spec) => {
  const m = new Map();
  for (const [pos, n] of Object.entries(spec))
    for (let i = 0; i < n; i++)
      m.set(`${pos}${i + 1}`, { id: `${pos}${i + 1}`, pos, pts: 30 - i * 0.1, startable: true, name: `${pos}${i + 1}` });
  return m;
};

t("cross-position ECR is NEVER used - a kicker cannot outrank a receiver", () => {
  // The live-site bug: consensus publishes per-position pages, so a kicker
  // with rank 1 floated above every skill player and dominated the list.
  const priced = universe({ WR: 120, K: 32 });
  const roster = [priced.get("WR40"), priced.get("K1")];
  const market = mkt([["WR40", "WR40"], ["K1", "K1"]]);
  const d = disagreements(roster, market, priced);
  assert.ok(!d.some((p) => p.pos === "K"), "kickers must be excluded entirely");
});

t("comparison is within position, our rank against their pos_rank", () => {
  const priced = universe({ RB: 80 });
  const roster = [priced.get("RB12")];
  const d = disagreements(roster, mkt([["RB12", "RB34"]]), priced);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].ourRank, 12);
  assert.strictEqual(d[0].theirRank, 34);
  assert.strictEqual(d[0].gap, 22, "positive gap means WE rank him higher");
});

t("pos_rank strings are parsed, not assumed numeric", () => {
  const priced = universe({ TE: 40 });
  const roster = [priced.get("TE5")];
  assert.strictEqual(disagreements(roster, mkt([["TE5", "TE28"]]), priced)[0].theirRank, 28);
  assert.strictEqual(disagreements(roster, mkt([["TE5", "garbage"]]), priced).length, 0);
  assert.strictEqual(disagreements(roster, mkt([["TE5", null]]), priced).length, 0);
});

t("the gate SCALES with how deep the market ranks that position", () => {
  // Same 8-rank gap: a real disagreement at TE, noise at WR.
  const te = universe({ TE: 40 });
  const wr = universe({ WR: 150 });
  const teMarket = mkt(Array.from({length:40},(_,i)=>[`TE${i+1}`,`TE${i+1}`]).concat([["TE5","TE13"]]));
  const wrMarket = mkt(Array.from({length:150},(_,i)=>[`WR${i+1}`,`WR${i+1}`]).concat([["WR5","WR13"]]));
  assert.strictEqual(disagreements([te.get("TE5")], teMarket, te).length, 1, "8 ranks at TE counts");
  assert.strictEqual(disagreements([wr.get("WR5")], wrMarket, wr).length, 0, "8 ranks at WR is noise");
});

t("our rank comes from the WHOLE priced universe, not just the roster", () => {
  // If our rank were roster-relative, a one-player roster would rank him #1
  // and manufacture a gap against any consensus rank at all.
  const priced = universe({ RB: 80 });
  const d = disagreements([priced.get("RB60")], mkt([["RB60", "RB58"]]), priced);
  assert.strictEqual(d.length, 0, "RB60 vs RB58 is agreement, not a 59-rank gap");
});

t("ruled-out players do not distort our positional ranking", () => {
  const priced = universe({ WR: 120 });
  priced.get("WR1").startable = false;
  const d = disagreements([priced.get("WR2")], mkt([["WR2", "WR2"]]), priced);
  assert.strictEqual(d.length, 0);
});

t("a missing priced universe returns nothing rather than throwing", () => {
  assert.deepStrictEqual(disagreements([{ id:"a", pos:"WR" }], mkt([["a","WR1"]]), null), []);
});

t("an unavailable market layer returns nothing rather than throwing", () => {
  const priced = universe({ WR: 20 });
  assert.deepStrictEqual(disagreements([priced.get("WR1")], { ok:false, byId:new Map() }, priced), []);
});

t("agreement produces no rows at all", () => {
  const priced = universe({ RB: 80 });
  const roster = [priced.get("RB3"), priced.get("RB20")];
  assert.strictEqual(disagreements(roster, mkt([["RB3","RB3"],["RB20","RB21"]]), priced).length, 0);
});

console.log(`\nmarket: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

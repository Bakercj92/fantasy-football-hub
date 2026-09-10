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

const mkt = (pairs) => ({ byId: new Map(pairs.map(([id, ecr]) => [id, { ecr, posRank: null }])) });

const R = (id, pos, pts, vor) => ({ id, pos, pts, vor, name: id.toUpperCase() });

t("disagreements compare ranks WITHIN the roster, never national ECR", () => {
  const roster = [R("a","WR",20,10), R("b","WR",15,6), R("c","WR",10,2), R("d","WR",9,1)];
  const d = disagreements(roster, mkt([["a",300],["b",200],["c",100],["d",50]]), 2);
  const a = d.find((p) => p.id === "a");
  assert.strictEqual(a.ourRank, 1);
  assert.strictEqual(a.theirRank, 4);
  assert.strictEqual(a.gap, 3);
});

t("our side ranks by VOR, not raw points - QBs must not outrank everyone", () => {
  // The QB scores the most points but is barely above a freely available QB.
  // A raw-points ranking calls him our #1; VOR correctly calls him our last.
  const roster = [
    R("qb","QB",24,0.4), R("rb","RB",16,9.5), R("wr","WR",14,7.2), R("te","TE",11,5.1),
  ];
  const d = disagreements(roster, mkt([["qb",1],["rb",2],["wr",3],["te",4]]), 1);
  const qb = d.find((p) => p.id === "qb");
  assert.strictEqual(qb.ourRank, 4, "VOR must rank the replaceable QB last");
  assert.strictEqual(qb.theirRank, 1);
});

t("falls back to raw points when VOR is unavailable", () => {
  const roster = [
    { id:"a", pos:"WR", pts:20, name:"A" }, { id:"b", pos:"WR", pts:15, name:"B" },
    { id:"c", pos:"WR", pts:10, name:"C" }, { id:"d", pos:"WR", pts:5, name:"D" },
  ];
  const d = disagreements(roster, mkt([["a",400],["b",300],["c",200],["d",100]]), 2);
  assert.strictEqual(d.find((p) => p.id === "a").ourRank, 1);
});

t("players the market has never heard of are skipped, not scored zero", () => {
  const roster = [R("k","RB",10,5), R("l","RB",9,4), R("m","RB",8,3), R("n","RB",7,2),
                  { id:"unknown", pos:"RB", pts:9, vor:4.5, name:"U" }];
  const d = disagreements(roster, mkt([["k",50],["l",40],["m",30],["n",20]]), 0);
  assert.ok(!d.some((p) => p.id === "unknown"));
});

t("the gap gate SCALES with roster size", () => {
  const small = Array.from({length:5}, (_,i) => R(`s${i}`,"WR",20-i,10-i));
  const big   = Array.from({length:20},(_,i) => R(`b${i}`,"WR",30-i,15-i*0.5));
  const rev = (rs) => mkt(rs.map((p,i) => [p.id, rs.length - i]));
  // Perfectly reversed rankings: gate must let the extremes through in both.
  assert.ok(disagreements(small, rev(small)).length > 0);
  assert.ok(disagreements(big,   rev(big)).length > 0);
  // ...but a 20-player roster demands a bigger gap than a 5-player one.
  assert.ok(Math.ceil(20/5) > Math.max(3, Math.ceil(5/5)) - 1);
});

t("a roster too small to rank meaningfully returns nothing", () => {
  const roster = [R("a","WR",20,9), R("b","WR",10,3)];
  assert.strictEqual(disagreements(roster, mkt([["a",9],["b",1]])).length, 0);
});

t("agreement produces no rows at all", () => {
  const roster = [R("a","WR",20,9), R("b","WR",15,6), R("c","WR",12,4), R("d","WR",10,2)];
  assert.strictEqual(disagreements(roster, mkt([["a",1],["b",2],["c",3],["d",4]])).length, 0);
});

console.log(`\nmarket: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

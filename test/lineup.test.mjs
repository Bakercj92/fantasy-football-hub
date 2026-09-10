// Real unit tests against the MODULE. Not against built HTML.
// The old project had 12,199 lines of suite, ~10,500 of which asserted
// against rendered markup and would not survive a rewrite. Not again.
import { optimalLineup, startingSlots, decisions } from "../js/lineup.js";
import { willNotPlay } from "../js/scoring.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); } };
const P = (id, pos, pts) => ({ id, pos, pts, name: id });
const total = (l) => l.reduce((s, x) => s + (x.player?.pts || 0), 0);

t("startingSlots drops BN/IR/TAXI", () => {
  assert.deepStrictEqual(startingSlots(["QB","RB","FLEX","BN","BN","IR"]), ["QB","RB","FLEX"]);
});

t("greedy trap: FLEX must not strand the better RB", () => {
  // Naive fill-in-order seats RB1 in QB-less FLEX... the classic failure is
  // seating the best RB in FLEX and leaving RB slot to a scrub.
  const slots = ["RB", "FLEX"];
  const players = [P("rb1","RB",20), P("rb2","RB",18), P("wr1","WR",5)];
  assert.strictEqual(total(optimalLineup(slots, players)), 38);
});

t("SUPER_FLEX takes a QB when that is the max", () => {
  const slots = ["QB", "SUPER_FLEX"];
  const players = [P("qb1","QB",25), P("qb2","QB",22), P("rb1","RB",10)];
  assert.strictEqual(total(optimalLineup(slots, players)), 47);
});

t("SUPER_FLEX takes a RB when the second QB is worse", () => {
  const slots = ["QB", "SUPER_FLEX"];
  const players = [P("qb1","QB",25), P("qb2","QB",4), P("rb1","RB",19)];
  assert.strictEqual(total(optimalLineup(slots, players)), 44);
});

t("augmenting path displaces a seated player to a legal empty slot", () => {
  // TE is the only one who can fill TE. If TE got seated in FLEX first,
  // a greedy solver strands the TE slot. The augmenting path must move him.
  const slots = ["TE", "FLEX"];
  const players = [P("te1","TE",15), P("rb1","RB",14)];
  const out = optimalLineup(slots, players);
  assert.strictEqual(out[0].player.id, "te1");
  assert.strictEqual(out[1].player.id, "rb1");
  assert.strictEqual(total(out), 29);
});

t("full Joop shape solves to the true optimum", () => {
  const slots = startingSlots(["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN","BN","BN","BN","BN"]);
  const players = [
    P("qb","QB",21), P("rb1","RB",17), P("rb2","RB",13), P("rb3","RB",12),
    P("wr1","WR",16), P("wr2","WR",14), P("wr3","WR",11),
    P("te","TE",9), P("k","K",8), P("def","DEF",7), P("bench","WR",2),
  ];
  // QB21 + RB 17,13 + WR 16,14 + TE9 + FLEX(best of rb3 12 / wr3 11)=12 + K8 + DEF7
  assert.strictEqual(total(optimalLineup(slots, players)), 21+17+13+16+14+9+12+8+7);
});

t("players with no projection are excluded, not scored as zero", () => {
  const out = optimalLineup(["RB"], [{ id:"x", pos:"RB", pts:null }, P("rb","RB",5)]);
  assert.strictEqual(out[0].player.id, "rb");
});

t("empty slot when nobody is eligible", () => {
  assert.strictEqual(optimalLineup(["DEF"], [P("rb","RB",9)])[0].player, null);
});

t("decisions report set difference, not per-slot churn", () => {
  const byId = new Map([["a",P("a","RB",10)],["b",P("b","RB",4)]]);
  const opt = [{ slot:"RB", player: byId.get("a") }];
  const d = decisions(["b"], opt, byId, 1.0);
  assert.deepStrictEqual(d.entering.map(p=>p.id), ["a"]);
  assert.deepStrictEqual(d.leaving.map(p=>p.id), ["b"]);
  assert.strictEqual(d.gain, 6);
  assert.strictEqual(d.actionable, true);
});

t("a sub-threshold gain is not actionable", () => {
  const byId = new Map([["a",P("a","RB",10.4)],["b",P("b","RB",10)]]);
  const d = decisions(["b"], [{ slot:"RB", player: byId.get("a") }], byId, 1.0);
  assert.strictEqual(d.actionable, false);
});

t("no change means nothing to report", () => {
  const byId = new Map([["a",P("a","RB",10)]]);
  const d = decisions(["a"], [{ slot:"RB", player: byId.get("a") }], byId, 1.0);
  assert.strictEqual(d.entering.length, 0);
  assert.strictEqual(d.actionable, false);
});

t("empty Sleeper starter slots ('0') are ignored", () => {
  const byId = new Map([["a",P("a","RB",10)]]);
  const d = decisions(["0","a"], [{ slot:"RB", player: byId.get("a") }], byId, 1.0);
  assert.strictEqual(d.leaving.length, 0);
});


// ---- ruled-out players ----------------------------------------------------

t("willNotPlay covers the designations that mean he is not playing", () => {
  for (const s of ["Out","IR","PUP","Sus","NA","Doubtful"]) assert.ok(willNotPlay(s), s);
});

t("Questionable is startable - benching every Q would be its own error", () => {
  assert.strictEqual(willNotPlay("Questionable"), false);
  assert.strictEqual(willNotPlay(null), false);
});

t("a ruled-out player is never seated, however high he projects", () => {
  const out = optimalLineup(["FLEX"], [
    { id:"kittle", pos:"TE", pts:11.7, startable:false },
    { id:"gainwell", pos:"RB", pts:8.6, startable:true },
  ]);
  assert.strictEqual(out[0].player.id, "gainwell");
});

t("a slot stays empty rather than seating a ruled-out player", () => {
  const out = optimalLineup(["TE"], [{ id:"kittle", pos:"TE", pts:11.7, startable:false }]);
  assert.strictEqual(out[0].player, null);
});

t("benching a ruled-out starter is actionable even at a POINTS LOSS", () => {
  const kittle = { id:"kittle", pos:"TE", pts:11.7, startable:false, name:"Kittle" };
  const sub    = { id:"sub",    pos:"TE", pts:4.0,  startable:true,  name:"Sub" };
  const byId = new Map([["kittle",kittle],["sub",sub]]);
  const d = decisions(["kittle"], [{ slot:"TE", player:sub }], byId, 1.0);
  assert.strictEqual(d.gain < 0, true, "this call costs projected points");
  assert.strictEqual(d.actionable, true, "and must still be raised");
  assert.deepStrictEqual(d.forced.map(p=>p.id), ["kittle"]);
});

t("ruled-out players lead the leaving list regardless of projection", () => {
  const hurt = { id:"hurt", pos:"WR", pts:18, startable:false, name:"Hurt" };
  const meh  = { id:"meh",  pos:"WR", pts:3,  startable:true,  name:"Meh" };
  const a = { id:"a", pos:"WR", pts:12, startable:true, name:"A" };
  const b = { id:"b", pos:"WR", pts:11, startable:true, name:"B" };
  const byId = new Map([["hurt",hurt],["meh",meh],["a",a],["b",b]]);
  const d = decisions(["hurt","meh"], [{slot:"WR",player:a},{slot:"WR",player:b}], byId, 1.0);
  assert.strictEqual(d.leaving[0].id, "hurt");
});

t("no forced calls means the threshold still governs", () => {
  const byId = new Map([["a",P("a","RB",10.4)],["b",P("b","RB",10)]]);
  byId.get("a").startable = true; byId.get("b").startable = true;
  const d = decisions(["b"], [{ slot:"RB", player: byId.get("a") }], byId, 1.0);
  assert.strictEqual(d.forced.length, 0);
  assert.strictEqual(d.actionable, false);
});

console.log(`\nlineup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

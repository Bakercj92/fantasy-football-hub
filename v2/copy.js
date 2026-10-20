// SENTENCES ABOUT A PLAYER.
//
// Every one of these is copy ported from js/ui.js, and copy is what this
// project's render layer has actually caught: "Questionable, Ankle and did not
// practise" reading like a form, "a ankle", a block printing "undefined" in
// every sentence while a presence assertion passed. They live together, away
// from layout, and each names the ui.js lines it came from so the port can be
// checked against the original rather than trusted.

import { esc } from "./shell.js";
import { vegasRead } from "./logic/vegas.js";
import { CHIP_FALLBACK_LEN } from "./logic/caps.js";

export const n1 = (v) => (typeof v === "number" ? v.toFixed(1) : "—");
export const sgn = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : "—");

/** Kickoff in the READER's timezone - the underlying value is a real UTC
 *  instant rather than a string with an offset baked in. (ui.js:29-33) */
export const kick = (ms) => typeof ms === "number"
  ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
  : "";

// (ui.js:20-22, 54-58)
const INJ = {
  Out: ["out", "OUT"], Doubtful: ["dbt", "DBT"], Questionable: ["q", "Q"],
  IR: ["ir", "IR"], PUP: ["pup", "PUP"], Sus: ["sus", "SUS"],
  COV: ["cov", "COV"], NA: ["out", "N/A"],
};
export function injChip(s) {
  if (!s) return "";
  const [cls, label] = INJ[s] || ["q", String(s).slice(0, CHIP_FALLBACK_LEN).toUpperCase()];
  return ` <span class="chip ${cls}" title="${esc(s)}">${esc(label)}</span>`;
}

export const SEV_CLS = { high: "out", medium: "dbt", low: "q" };
export const flagTitle = (f) =>
  f.text + (f.resolution ? ` — ${f.resolution.text}` : f.ask ? ` — ${f.ask}` : "");

/** The Vegas read as a sentence rather than a column. It belongs in the why
 *  behind a call, never in the reference table. (ui.js:41-52)
 *  The sign convention lives in logic/vegas.js and is tested there. */
export function vegasPhrase(p) {
  const v = vegasRead(p);
  if (!v) return "";
  const side = v.side === "favoured" ? `favoured by ${n1(v.by)}`
             : v.side === "underdog" ? `an underdog by ${n1(v.by)}`
             : "a pick'em";
  return `${esc(v.team)} is ${side} in a ${n1(v.total)}-point game — implied team total <b>${n1(v.implied)}</b>.`;
}

/** Usage, as a sentence, only when there is enough of it to mean something.
 *  (ui.js:525-540) Measured, never projected - a player with no snap row keeps
 *  a blank rather than a zero. */
export function usagePhrase(p) {
  const u = p?.usage;
  const m = p?.matchup?.speaks
    ? `<div class="mkt">${esc(p.matchup.text)}, over ${p.matchup.games} game${
        p.matchup.games > 1 ? "s" : ""}.</div>` : "";
  if (!u || !u.games) return m;
  const bits = [];
  if (typeof u.snapPct === "number") bits.push(`${Math.round(u.snapPct * 100)}% of snaps`);
  if (typeof u.oppPerGame === "number") bits.push(`${n1(u.oppPerGame)} touches a game`);
  if (typeof u.tgtShare === "number" && u.tgtShare > 0)
    bits.push(`${Math.round(u.tgtShare * 100)}% of targets`);
  if (!bits.length) return m;
  return `<div class="mkt">Measured usage over ${u.games} game${u.games > 1 ? "s" : ""}:
    ${bits.join(", ")}.</div>${m}`;
}

/** Consensus, as a flag rather than a vote. (ui.js:729-737) */
export function marketLine(inP, outP) {
  const a = inP?.market, b = outP?.market;
  if (!a && !b) return "";
  const bits = [];
  if (a?.posRank) bits.push(`consensus has ${esc(inP.name)} at <b>${esc(a.posRank)}</b>${a.grade ? ` (${esc(a.grade)})` : ""}`);
  if (b?.posRank) bits.push(`${esc(outP.name)} at <b>${esc(b.posRank)}</b>${b.grade ? ` (${esc(b.grade)})` : ""}`);
  return bits.length ? `<div class="mkt">Market: ${bits.join(" · ")}.</div>` : "";
}

/** "Questionable with an ankle" rather than "Questionable, Ankle".
 *  (ui.js:189-196) The article is the bit rendering caught. */
export function injuryPhrase(o) {
  if (!o?.inj) return esc(o?.st || "");
  const w = String(o.inj).toLowerCase();
  return `${esc(o.st)} with ${/^[aeiou]/.test(w) ? "an" : "a"} ${esc(w)}`;
}

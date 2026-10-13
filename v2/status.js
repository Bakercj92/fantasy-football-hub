// THE LIVE STATUS MODEL.
//
// This is the half of the old 748px footer that is NOT methodology. Every row
// here carries a value that changes per load and that changes whether a call
// on this page can be trusted:
//
//   - is the schedule there, and is kickoff locking therefore on
//   - did any team code fail to join the schedule feed
//   - how old is the usage mirror, and which clubs has it not ingested
//   - did the market layer arrive
//   - are there Vegas lines this week
//
// Burying these on a Methods page would mean reading a start/sit call with no
// indication that locking is off or that the mirror is a week behind. So this
// rides above the content on EVERY route, collapsed, and opens itself when
// anything in it is a warning.
//
// Pure: takes state, returns a model. No DOM, so it is unit tested.

import { NAME_CLUBS_UPTO } from "./logic/caps.js";

const listAnd = (xs) => (xs.length <= 1 ? (xs[0] || "")
  : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const RANK = { ok: 0, warn: 1, bad: 2 };

export function statusModel(state, L = null) {
  const rows = [];

  // --- the schedule, and therefore locking -------------------------------
  const sc = state.schedule;
  if (!sc || !sc.ok) {
    rows.push({ level: "bad", key: "schedule",
      text: `<b>No schedule this load.</b> Kickoff locking is OFF, so a call here may be one Sleeper will refuse. ${sc?.warning || ""}` });
  } else if (sc.stale) {
    rows.push({ level: "warn", key: "schedule",
      text: `<b>Schedule is a cached copy.</b> ${sc.warning || ""}` });
  } else {
    rows.push({ level: "ok", key: "schedule",
      text: `<b>Kickoff locking is on.</b> Locked players are pinned where they sit, because Sleeper would refuse the move.` });
  }

  // --- team codes that did not join --------------------------------------
  if (L?.unknown?.length) {
    rows.push({ level: "bad", key: "unknown",
      text: `<b>Unrecognised team${L.unknown.length > 1 ? "s" : ""}:</b> ${listAnd(L.unknown)}. Those players cannot be locked or priced against Vegas. A join failure, not a bye.` });
  }

  // --- players the solve could not price ---------------------------------
  if (typeof L?.unpriced === "number" && L.unpriced > 0) {
    rows.push({ level: "warn", key: "unpriced",
      text: `<b>${L.unpriced} rostered player${L.unpriced > 1 ? "s have" : " has"} no projection</b> this week and ${L.unpriced > 1 ? "are" : "is"} excluded from the solve.` });
  }

  // --- the usage mirror ---------------------------------------------------
  const u = state.usage;
  if (!u?.ok) {
    rows.push({ level: "warn", key: "usage",
      text: `<b>No usage layer this load.</b> Snap share, touches and target share are hidden rather than guessed.` });
  } else {
    const behind = state.usageFresh?.behind;
    const short = state.unfiled;
    let text = `<b>Usage through week ${u.throughWeek}</b>, mirrored from nflverse`;
    if (u.generatedAt) text += ` on ${String(u.generatedAt).slice(0, 10)}`;
    text += ".";
    if (short?.length) {
      text += ` ${short.length <= NAME_CLUBS_UPTO ? listAnd(short) : `${short.length} clubs`} ${short.length === 1 ? "has" : "have"} not filed week ${u.throughWeek} yet.`;
    }
    rows.push({ level: behind ? "warn" : "ok", key: "usage",
      text: behind ? `${text} <b>nflverse has published newer data since.</b>` : text });
  }

  // --- the market layer ---------------------------------------------------
  if (!state.market) {
    rows.push({ level: "ok", key: "market", pending: true, text: `Consensus still loading. Rank and value rows fill in when it arrives.` });
  } else if (!state.market.ok) {
    rows.push({ level: "warn", key: "market",
      text: `<b>Consensus unavailable this load.</b> Rank and value rows are hidden rather than guessed.` });
  } else {
    rows.push({ level: "ok", key: "market",
      text: `Consensus from FantasyPros via DynastyProcess${state.market.scrapedAt ? `, scraped ${String(state.market.scrapedAt).slice(0, 10)}` : ""}. A flag, never a vote — it does not move a projection.` });
  }

  const level = rows.reduce((worst, r) => (RANK[r.level] > RANK[worst] ? r.level : worst), "ok");
  return { level, rows, summary: summarise(level, rows) };
}

function summarise(level, rows) {
  if (level === "ok") return "Everything checked out this load";
  const loud = rows.filter((r) => r.level !== "ok");
  if (loud.length === 1) {
    if (loud[0].key === "schedule") return "Kickoff locking is off this load";
    if (loud[0].key === "unknown") return "A team code did not join the schedule";
    if (loud[0].key === "usage") return "The usage mirror needs a look";
    if (loud[0].key === "unpriced") return "Some players have no projection";
    if (loud[0].key === "market") return "Consensus is unavailable this load";
  }
  return `${loud.length} things worth knowing about this load`;
}

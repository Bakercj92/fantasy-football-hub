// memory.js - the decision log. A STUB, on purpose.
//
// Phase 5 owns decision memory properly: what you started, what the
// alternative was, and what it cost once the week finished scoring. None of
// that exists yet, and inventing it now would be guessing at a schema.
//
// What exists now is the one thing that cannot be reconstructed later: the
// calls that were live and became impossible because a game kicked off. That
// fact is only observable in the moment - by Tuesday, Sleeper shows the
// lineup you were stuck with and nothing anywhere remembers the lineup you
// would have set. So it gets written down as it happens, and Phase 5 reads it.
//
// Deliberately small. It records, it does not analyse.

const KEY = "ffh.decisions.v1";
const CAP = 400; // roughly two seasons of entries; old ones fall off the end.

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const write = (rows) => {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(-CAP))); return true; }
  catch { return false; }
};

const slim = (p) => ({
  id: p.id, name: p.name, pos: p.pos, team: p.team,
  pts: typeof p.pts === "number" ? p.pts : null,
  kickoffUTC: p.game?.kickoffUTC ?? null,
});

// One entry per league per week. Re-opening the page the same week overwrites
// rather than appending, because the same lockout observed twice is one
// lockout - and a log that double-counts is worse than no log.
export function recordMissed({ leagueKey, season, week, missed, at = Date.now() }) {
  if (!missed?.any) return null;
  const entry = {
    kind: "locked_out",
    leagueKey, season: String(season), week: Number(week), at,
    entering: missed.entering.map(slim),
    leaving: missed.leaving.map(slim),
    cost: typeof missed.cost === "number" ? missed.cost : null,
  };
  const rows = read().filter(
    (r) => !(r.kind === "locked_out" && r.leagueKey === leagueKey &&
             String(r.season) === entry.season && Number(r.week) === entry.week)
  );
  rows.push(entry);
  return write(rows) ? entry : null;
}

export const log = () => read();

export function clear() {
  try { localStorage.removeItem(KEY); return true; } catch { return false; }
}

export { KEY };

// ---------------------------------------------------------------------------
// PHASE E - the decision log proper, and the Tuesday recap.
//
// What the log is for: by Tuesday, Sleeper shows the lineup you were stuck
// with. Nothing anywhere remembers the lineup the tool suggested, or the one
// you would have set. That is only observable in the moment, so it is written
// down in the moment and read back once the week has actually scored.
//
// KNOWN AND ACCEPTED LIMIT: this is browser storage, on one device. A lineup
// set on the phone writes a log the laptop cannot see. Chris chose this over
// building a shared store, on the reasoning that he sets lineups at the
// laptop. The recap says so rather than implying it saw everything.
// ---------------------------------------------------------------------------

// What you were actually going to run, and what the tool would have run.
// One entry per league per week; re-opening the page the same week overwrites,
// because the same week observed twice is one week.
export function recordLineup({ leagueKey, season, week, started, suggested,
                               threshold = null, at = Date.now() }) {
  if (!leagueKey || !week) return null;
  const ids = (xs) => (xs || []).map((p) => (p && typeof p === "object" ? p.id : p))
                                .filter(Boolean).map(String);
  const entry = {
    kind: "lineup",
    leagueKey, season: String(season), week: Number(week), at,
    started: ids(started),
    suggested: ids(suggested),
    threshold: typeof threshold === "number" ? threshold : null,
  };
  // PRUNE FIRST, THEN DECIDE WHETHER TO WRITE.
  //
  // The first version returned early on agreement, BEFORE clearing the week's
  // existing row. So: at 10am the tool disagrees and the week is logged; Chris
  // takes the advice and fixes his lineup; at noon the two agree and nothing
  // is written - leaving the 10am row in place. Tuesday then grades him on a
  // lineup he did not run and tells him the suggestion would have scored more.
  // Exactly backwards, and it punished him for taking the advice.
  const rows = read().filter(
    (r) => !(r.kind === "lineup" && r.leagueKey === leagueKey &&
             String(r.season) === entry.season && Number(r.week) === entry.week)
  );

  // Nothing to learn from a week where the tool agreed with you - but the
  // pruned rows still have to be written, or the stale row survives.
  const sameSet = (a, b) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  if (sameSet(entry.started, entry.suggested)) {
    write(rows);
    return null;
  }

  rows.push(entry);
  return write(rows) ? entry : null;
}

// Score one set of player ids for one completed week, at THIS league's rules.
//
// Returns null - not zero - when the week is not fully mirrored. A recap built
// on a half-scored week would report a confident loss that is really a missing
// file, and this project's whole history of bugs is numbers that were wrong
// with a straight face.
export function scoreWeek(ids, week, { usage, scoring, rescore }) {
  if (!usage?.ok || !scoring || !ids?.length) return null;
  let total = 0, found = 0;
  for (const id of ids) {
    const act = usage.byId.get(String(id))?.actual?.[String(week)];
    if (!act) continue;                    // bye, benched, or not yet mirrored
    const scored = rescore(act, scoring);
    if (!scored || typeof scored.pts !== "number") continue;
    total += scored.pts; found += 1;
  }
  if (!found) return null;
  return { pts: Math.round(total * 10) / 10, scored: found, of: ids.length };
}

// The recap: what the calls you did and didn't take actually cost.
//
// Only weeks that have FINISHED and been mirrored are graded. `usage.throughWeek`
// is the authority on that, not the calendar - a Tuesday where nflverse has not
// published yet must produce no recap rather than a wrong one.
export function recap({ leagueKey, season, currentWeek, usage, scoring, rescore,
                        log: rows = read(), minCoverage = 0.8 }) {
  const through = usage?.throughWeek ?? 0;
  const out = [];

  for (const r of rows) {
    if (r.leagueKey !== leagueKey || String(r.season) !== String(season)) continue;
    if (r.week >= currentWeek || r.week > through) continue;   // not finished, or not mirrored

    if (r.kind === "lineup") {
      const mine = scoreWeek(r.started, r.week, { usage, scoring, rescore });
      const tool = scoreWeek(r.suggested, r.week, { usage, scoring, rescore });
      if (!mine || !tool) continue;
      const coverage = Math.min(mine.scored / mine.of, tool.scored / tool.of);
      out.push({
        kind: "lineup", week: r.week,
        yours: mine.pts, suggested: tool.pts,
        delta: Math.round((tool.pts - mine.pts) * 10) / 10,
        coverage,
        // `through_week` flips to N the moment ANY row for week N lands, so a
        // Tuesday-morning recap can be grading a week whose Monday-night player
        // has not been mirrored yet - and he silently drops out of the sum.
        // A partial row is still worth showing, clearly labelled, but it must
        // not be added into a headline number presented as a finding.
        partial: coverage < minCoverage,
      });
    }

    if (r.kind === "locked_out") {
      const entering = scoreWeek(r.entering.map((p) => p.id), r.week, { usage, scoring, rescore });
      const leaving  = scoreWeek(r.leaving.map((p) => p.id),  r.week, { usage, scoring, rescore });
      if (!entering && !leaving) continue;
      const complete = entering && leaving;
      out.push({
        kind: "locked_out", week: r.week,
        couldHaveStarted: entering?.pts ?? null,
        hadToStart: leaving?.pts ?? null,
        delta: complete ? Math.round((entering.pts - leaving.pts) * 10) / 10 : null,
        partial: !complete,
        players: [...r.entering, ...r.leaving].map((p) => p.name),
      });
    }
  }

  out.sort((a, b) => b.week - a.week);

  // TWO TOTALS, NOT ONE.
  //
  // "Calls you could have taken and didn't" and "moves that were already
  // impossible when you looked" are different facts about a season, and adding
  // them into a single headline number lets a lockout you could do nothing
  // about read as a decision you got wrong.
  const sum = (kind) => {
    const rs = out.filter((r) => r.kind === kind && !r.partial && typeof r.delta === "number");
    return rs.length ? Math.round(rs.reduce((s, r) => s + r.delta, 0) * 10) / 10 : null;
  };

  return {
    any: out.length > 0,
    rows: out,
    weeks: new Set(out.map((r) => r.week)).size,
    // Positive means the tool's calls would have scored more than what ran.
    netLineup: sum("lineup"),
    netLocked: sum("locked_out"),
    partialCount: out.filter((r) => r.partial).length,
  };
}

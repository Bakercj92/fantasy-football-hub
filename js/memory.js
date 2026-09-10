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

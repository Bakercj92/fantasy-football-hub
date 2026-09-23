// signals.js - when the two things this page knows disagree with each other.
//
// WHAT THIS EXISTS TO PREVENT
//
// On 2026-09-23, three start/sit calls were got wrong in two opposite ways
// inside one hour, and the pattern is the whole reason for this file.
//
//   * Trusting the PROJECTION over form: Herbert was projected 16.1 and
//     started over Young's 15.8. Herbert was averaging 10.6 on the season;
//     Young was averaging 27.8. The projection was seventeen points wrong
//     about which of them was the better play.
//
//   * Trusting FORM over the projection: Kyler Murray had five pass attempts
//     in week 1 and no week 2 row at all, so the box scores said "backup" and
//     he was benched. He was the starter, concussed early in week 1, and had
//     cleared protocol to start week 3. Sleeper's 17.2 projection knew that.
//     The box score could not - a completed game is structurally incapable of
//     containing next week's news.
//
// Neither source is the reliable one. They answer different questions:
//
//     projection  ->  is he playing this week, and in what role?   (forward)
//     usage/form  ->  how good has he been, and what was his role?  (backward)
//
// Every failure above came from using one of them to answer the other's
// question. So this module does not resolve the disagreement. It DETECTS it
// and hands it back with the specific thing a human needs to go and check.
// A detector that picked a winner would just be the same bug with an extra
// step.

// A projection small enough that a disagreement about it is not worth raising.
// Below this, everyone is a bench body and the flag is noise.
export const MIN_INTERESTING = 6;

// How far apart the two signals must be before it is worth saying. Expressed
// in sigma so it scales with how noisy the position actually is, measured
// live - a 5-point gap is a shrug at quarterback and a scandal at tight end.
export const DISAGREE_SIGMAS = 1.0;

// The flags, most urgent first. Order matters: callers render the first one.
export const KINDS = ["absent", "thin", "projection-high", "projection-low"];

/**
 * @param proj        this week's projection, already scored at league rules
 * @param usageEntry  the player's mirror entry (usage.byId.get(id)), or null
 * @param throughWeek the last week the mirror covers
 * @param sigma       measured sigma for this position, or null
 * @param injury      Sleeper injury_status, or null
 */
export function check({ proj, usageEntry, throughWeek, sigma, injury } = {}) {
  const flags = [];
  if (typeof proj !== "number" || proj < MIN_INTERESTING) return flags;
  if (!Number.isFinite(throughWeek) || throughWeek < 1) return flags;

  const weeks = usageEntry?.weeks ?? [];
  const playedLast = weeks.some((w) => w.wk === throughWeek);
  const played = weeks.length;

  // THE MURRAY FLAG.
  //
  // Projected to do something real, but absent from the most recent completed
  // week. This is the single highest-value thing on the page, because the two
  // explanations are opposite and the page cannot tell them apart:
  //
  //   (a) he is a backup the projection is wrong about  -> do not start him
  //   (b) he is a starter who was hurt and is now back  -> start him
  //
  // Murray was (b) and got benched as (a). So the flag's entire job is to
  // route the question to a source that can answer it, and to refuse to guess.
  // If this ever renders as a recommendation, the lesson has been lost.
  if (!playedLast) {
    flags.push({
      kind: "absent",
      severity: "high",
      text: played === 0
        ? `projected ${proj.toFixed(1)} but has no usage at all through week ${throughWeek}`
        : `projected ${proj.toFixed(1)} but did not play in week ${throughWeek}`,
      // Not advice. The question, and where the answer lives.
      ask: "returning starter or backup? the box score cannot tell you - check the depth chart",
      resolvable: false,
    });
  }

  // Thin sample: he played, but there is not enough of it to compare against.
  if (playedLast && played < 2) {
    flags.push({
      kind: "thin",
      severity: "low",
      text: `only ${played} game of usage - not enough to check the projection against`,
      resolvable: false,
    });
  }

  // THE HERBERT/YOUNG FLAG.
  //
  // Enough history to have an opinion, and the projection contradicts it by
  // more than the position's own noise. Says which way, and by how much, and
  // stops. Which one to believe depends on whether the player's ROLE changed,
  // and this module has no way to know that either.
  if (playedLast && played >= 2 && typeof usageEntry?.formPts === "number" && typeof sigma === "number") {
    const gap = proj - usageEntry.formPts;
    const sigmas = sigma > 0 ? Math.abs(gap) / sigma : 0;
    if (sigmas >= DISAGREE_SIGMAS) {
      flags.push({
        kind: gap > 0 ? "projection-high" : "projection-low",
        severity: "medium",
        text: `projected ${proj.toFixed(1)} but averaging ` +
              `${usageEntry.formPts.toFixed(1)} over ${played} games ` +
              `(${gap > 0 ? "+" : ""}${gap.toFixed(1)}, ${sigmas.toFixed(1)}σ)`,
        ask: gap > 0
          ? "has his role grown, or is the projection stale?"
          : "has his role shrunk, or is the projection seeing something the box score isn't?",
        gap: round(gap), sigmas: round(sigmas),
        resolvable: false,
      });
    }
  }

  return flags.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

// Season scoring average from the mirror's own actuals, at this league's rules.
//
// Attached to the usage entry so `check` has something to compare a projection
// against. Weeks the player did not appear in are ABSENT from the mirror
// entirely rather than present as zeros, so this is an average over games
// played - which is the right denominator for "how good has he been", and the
// wrong one for "what will he score", a question this file does not answer.
export function attachForm(usage, scoringSettings, rescore) {
  if (!usage?.ok) return usage;
  for (const p of usage.byId.values()) {
    const vals = [];
    for (const w of p.weeks) {
      const actual = p.actual?.[String(w.wk)];
      if (!actual) continue;
      const s = rescore(actual, scoringSettings);
      if (s && typeof s.pts === "number") vals.push(s.pts);
    }
    p.formPts = vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    p.formWeeks = vals.length;
  }
  return usage;
}

const round = (v) => Math.round(v * 100) / 100;

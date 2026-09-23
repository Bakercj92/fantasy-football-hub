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
// question. So this module does not resolve the disagreement FROM THE DATA
// THAT CAUSED IT. It detects it and hands it back with the specific thing a
// human needs to go and check. A detector that picked a winner off the same
// box scores would just be the same bug with an extra step.
//
// RESOLVING IT WITH THE RIGHT SOURCE IS A DIFFERENT MATTER.
//
// The `absent` flag's question was literally "check the depth chart", and
// `vacancy.js` now holds one - nflverse depth charts and injury reports, both
// forward-looking, both republished daily. When a caller passes that index in,
// the flag answers its own question instead of delegating it. Murray resolves
// to "QB1 on Minnesota's chart, absent in week 2 with a concussion, nothing
// filed against him for week 3", which is the whole answer.
//
// The distinction that keeps this honest: resolution reports what the depth
// chart SAYS. It still never says start or sit. `resolvable` goes true only
// when a real source answered; with no depth entry the flag keeps its question
// and stays unresolved, because an unanswered question is not a null result.

// A projection small enough that a disagreement about it is not worth raising.
// Below this, everyone is a bench body and the flag is noise.
export const MIN_INTERESTING = 6;

// How far apart the two signals must be before it is worth saying. Expressed
// in sigma so it scales with how noisy the position actually is, measured
// live - a 5-point gap is a shrug at quarterback and a scandal at tight end.
// Raised from 1.0 on 2026-09-23 after the render harness showed what 1.0
// actually produces: if projections are roughly unbiased, a one-sigma gate
// flags about a third of a roster, and a "worth a second look" list containing
// a third of your players is not a list, it is the page again. 1.5 is ~13% and
// still comfortably catches the case this was built for (Bryce Young at 2.0σ).
export const DISAGREE_SIGMAS = 1.5;

// Positions the usage mirror actually carries. build/usage.py keeps QB/RB/WR/TE
// and nothing else, so a kicker or a defence is not "missing from the mirror",
// it was never eligible for it - and flagging one as absent is a claim about a
// dataset that was never asked the question.
export const MIRRORED = new Set(["QB", "RB", "WR", "TE"]);

// The flags, most urgent first. Order matters: callers render the first one.
export const KINDS = ["absent", "thin", "projection-high", "projection-low"];

/**
 * @param proj        this week's projection, already scored at league rules
 * @param usageEntry  the player's mirror entry (usage.byId.get(id)), or null
 * @param throughWeek the last week the mirror covers
 * @param sigma       measured sigma for this position, or null
 * @param injury      Sleeper injury_status, or null
 * @param id           Sleeper player id - required to resolve an absence
 * @param vacancy      indexed vacancy payload (js/vacancy.js), or null. With
 *                     it, the `absent` flag answers its own question.
 */
export function check({ proj, usageEntry, throughWeek, sigma, injury, id, vacancy, pos } = {}) {
  const flags = [];
  pos = pos || usageEntry?.pos || null;
  if (typeof proj !== "number" || proj < MIN_INTERESTING) return flags;
  if (!Number.isFinite(throughWeek) || throughWeek < 1) return flags;

  const weeks = usageEntry?.weeks ?? [];
  const playedLast = weeks.some((w) => w.wk === throughWeek);
  const played = weeks.length;

  // MISSING IS NOT ABSENT, AND THIS BLOCK GOT IT WRONG.
  //
  // The first version raised a high-severity `absent` flag for anybody with no
  // mirror entry at all. The render harness showed what that produces: twelve
  // rows, eleven of them kickers, defences, and skill players the crosswalk
  // never matched, each announcing "projected 8.0 but has no usage at all".
  //
  // No mirror row means UNMEASURED. "He is not in a dataset that covers four
  // positions and joins on a third-party id map" and "he did not play" are
  // different claims, and only the second is worth interrupting for. The
  // signal this module exists to catch - Murray - is a player WITH history who
  // is missing the latest week. That shape stays; the other one goes quiet.
  if (!MIRRORED.has(pos)) return flags;
  if (played === 0) return flags;

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
    const flag = {
      kind: "absent",
      severity: "high",
      text: `projected ${proj.toFixed(1)} but did not play in week ${throughWeek}`,
      // Not advice. The question, and where the answer lives.
      ask: "returning starter or backup? the box score cannot tell you - check the depth chart",
      resolvable: false,
    };
    const answer = resolveAbsent({ id, vacancy });
    if (answer) {
      flag.resolvable = true;
      flag.resolution = answer;
      flag.severity = answer.kind === "ruled-out" ? "high"
                    : answer.kind === "starter"   ? "low" : "medium";
    }
    flags.push(flag);
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
export function formFor(usageEntry, scoringSettings, rescore) {
  if (!usageEntry?.weeks?.length) return null;
  const vals = [];
  for (const w of usageEntry.weeks) {
    const actual = usageEntry.actual?.[String(w.wk)];
    if (!actual) continue;
    const s = rescore(actual, scoringSettings);
    if (s && typeof s.pts === "number") vals.push(s.pts);
  }
  return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

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

// Answer the absent flag's question from the depth chart, or leave it open.
//
// Three things can be true of a player who is projected but missing from the
// last completed week, and they point in opposite directions:
//
//   ruled-out  he is on THIS week's injury report too. The projection is a
//              forecast of what he would score if he played, and he is not
//              going to. This is the only outcome that raises severity.
//   starter    he is first on his team's chart and nothing is filed against
//              him this week. The missed game was an absence, not a demotion -
//              which is exactly the Murray case, and exactly what benching him
//              got wrong.
//   backup     he is behind somebody. The projection is optimistic about a
//              role he does not have, and the man ahead of him is named.
//
// No depth entry means NO ANSWER, not "backup". A player missing from the
// chart is unmeasured, and the flag keeps its question.
export function resolveAbsent({ id, vacancy } = {}) {
  if (!id || !vacancy?.depth) return null;
  const entry = vacancy.depth[String(id)] || vacancy.depth.get?.(String(id));
  if (!entry || typeof entry.rk !== "number") return null;

  // An absence filed for the UPCOMING week outranks anything the chart says -
  // being first in line does not help if you are ruled out of the game.
  const week = vacancy.week;
  const rows = vacancy.absent || [];
  const thisWeek = rows.find((a) => String(a.id) === String(id) && a.wk === week);
  if (thisWeek && thisWeek.tier === "confirmed") {
    return {
      kind: "ruled-out",
      text: `${thisWeek.st}${thisWeek.inj ? ` (${thisWeek.inj})` : ""} for week ${week}`,
      asOf: vacancy.depthAsOf || null,
    };
  }

  const prior = rows.filter((a) => String(a.id) === String(id) && a.wk !== week)
                    .sort((a, b) => b.wk - a.wk)[0];
  const because = prior
    ? ` - the week ${prior.wk} absence was ${prior.st}${prior.inj ? `, ${prior.inj}` : ""}`
    : "";

  if (entry.rk === 1) {
    return {
      kind: "starter",
      text: `${entry.pos}1 on ${entry.tm}'s depth chart${because}, and nothing filed for week ${week}`,
      rank: 1, team: entry.tm, asOf: vacancy.depthAsOf || null,
    };
  }

  const ahead = Object.values(vacancy.depth || {})
    .filter((e) => e.tm === entry.tm && e.pos === entry.pos && e.rk < entry.rk)
    .sort((a, b) => b.rk - a.rk)[0];
  return {
    kind: "backup",
    text: `${entry.pos}${entry.rk} on ${entry.tm}'s depth chart` +
          (ahead?.nm ? `, behind ${ahead.nm}` : ""),
    rank: entry.rk, team: entry.tm, asOf: vacancy.depthAsOf || null,
  };
}

const round = (v) => Math.round(v * 100) / 100;

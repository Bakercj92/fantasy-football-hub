// THE METHODS PAGE.
//
// The STATIC half of the old 748px footer (ui.js:862-953), which was read past
// on every single load because it sat under everything on a single scroll and
// was ~1,000px tall on a phone. Constraint 4 of the rebuild splits it: the
// rows that change per load and change whether anything on the page can be
// trusted went to the always-visible status strip in phase 1 (status.js names
// the five), and what is left is here, addressable by anchor.
//
// NOTHING IS DELETED. Decision 5: methodology moves, it does not get dropped.
//
// PER-LEAGUE, because two of these sections are measurements rather than
// prose. Replacement level is derived from who is actually free in THIS league
// right now, and sigma is measured from THIS league's roster - a 14-team RB2
// and an 8-team RB2 are different things, which is the entire point of the
// section. A global page would have to either drop them or lie.

import { esc } from "./shell.js";
import { href } from "./router.js";
import { n1 } from "./copy.js";

const POS = ["QB", "RB", "WR", "TE", "K", "DEF"];

const SECTIONS = [
  ["league", "This league"],
  ["replacement", "Replacement level and VOR"],
  ["threshold", "The decision threshold"],
  ["projections", "Projections and scoring"],
  ["locking", "Kickoff locking"],
  ["vegas", "Vegas lines"],
  ["usage", "Measured usage"],
  ["notwired", "What is not wired yet"],
  ["sources", "Where the data comes from"],
];

const sec = (id, title, body) => `<section class="card meth" id="${id}">
  <h2>${esc(title)}</h2>${body}</section>`;

export function methodsPage(L, state) {
  if (!L) return `<section class="card quiet"><div class="stub">No league selected.</div></section>`;

  const toc = `<nav class="card quiet toc" aria-label="On this page">
    <h2>On this page</h2>
    <ul>${SECTIONS.map(([id, title]) =>
      `<li><a href="${href("methods", L.entry.key)}#${id}">${esc(title)}</a></li>`).join("")}</ul>
  </nav>`;

  // --- measured, not prose ------------------------------------------------
  const levels = POS
    .filter((pos) => L.freeBest?.[pos])
    .map((pos) => `<li><b>${pos}</b> ${n1(L.freeBest[pos].pts)}${
      L.freeBest[pos].name ? ` <span class="hint">${esc(L.freeBest[pos].name)}</span>` : ""}</li>`)
    .join("");

  const sigmas = Object.entries(L.sigma || {})
    .map(([pos, s]) => `<li><b>${esc(pos)}</b> ${n1(s)}</li>`).join("");

  // THE PASSING-TD WEIGHT IS READ, NOT ASSERTED.
  //
  // The original hardcoded "both your leagues pay 4" (ui.js:925). That was
  // true of two leagues and there are now three, and a hardcoded scoring claim
  // is exactly the sort of sentence that goes quietly wrong - a hand-pulled
  // readout on 2026-10-27 was built on a stale note about this very number and
  // every quarterback figure in it came out three points low. If the page is
  // going to make a claim about this league's scoring it can read it.
  const ptd = L.league?.scoring_settings?.pass_td;
  const ptdClaim = typeof ptd === "number"
    ? `This league pays <b>${n1(ptd)}</b> for a passing touchdown.`
    : `This league's passing-touchdown weight could not be read this load, so it is not quoted.`;

  return toc + [
    sec("league", "This league", `
      <dl class="kv">
        <dt>Name</dt><dd>${esc(L.entry.name)}</dd>
        <dt>Teams</dt><dd>${esc(L.teams)}</dd>
        <dt>Players rostered</dt><dd>${esc(L.rosteredCount)}</dd>
        <dt>FAAB left</dt><dd>${typeof L.faabLeft === "number"
          ? `$${esc(L.faabLeft)}` : "no FAAB in this league"}</dd>
        <dt>Playoffs begin</dt><dd>week ${esc(L.league?.settings?.playoff_week_start ?? "?")}</dd>
      </dl>
      <div class="note">Team count, players rostered, FAAB and the playoff week are read live
        from Sleeper on each load rather than configured here &mdash; a league changed shape
        mid-season once and a baked config was wrong for a month. <b>The name is the exception</b>:
        it is the display name from <span class="mono">leagues.json</span>, which is the only
        config this site has.</div>`),

    sec("replacement", "Replacement level and VOR", `
      <div class="note">Measured from who is <b>actually free in this league right now</b>, not
        from a 12-team rule of thumb:</div>
      <ul class="lvl">${levels || "<li>No free players priced this load.</li>"}</ul>
      <div class="note">VOR is a player's projection minus that number. It is what makes a
        14-team RB2 and an 8-team RB2 different things, and it is the only fair way to weigh a
        running back against a receiver &mdash; which is why the
        <a href="${href("compare", L.entry.key)}">compare tool</a> ranks a mixed pool on it.</div>`),

    sec("threshold", "The decision threshold", `
      <div class="note">Measured &sigma; for this league, per position:</div>
      <ul class="lvl">${sigmas || "<li>Not measured this load.</li>"}</ul>
      <div class="note">A lineup call has to clear <b>half the &sigma;</b> of the positions
        involved, floored at 1.0 and capped at 2.0. Below that the two lineups are not
        distinguishable and the page says nothing rather than inventing a decision.
        <b>Forced calls ignore the threshold</b>: a player who will not play scores zero whatever
        his projection says.</div>`),

    sec("projections", "Projections and scoring", `
      <div class="note">Projections are Sleeper's, <b>re-scored at this league's actual
        rules</b> &mdash; never the vendor's own PPR total. ${ptdClaim} The re-score is visible:
        open any call on the <a href="${href("lineup", L.entry.key)}">lineup page</a> and the
        bottom line of the panel lists each component, its projected value and the weight this
        league applies to it.</div>
      <div class="note">A projection is not a result. Everything on this site is a statement
        about the distribution of outcomes, and the only page that compares the two is
        <a href="${href("recap", L.entry.key)}">Recap</a>.</div>`),

    sec("locking", "Kickoff locking", `
      <div class="note">A player whose game has started is pinned where he sits and can neither
        enter nor leave the lineup, because Sleeper would refuse the move. Kickoffs come from the
        nflverse schedule and are converted from Eastern using the real daylight-saving rules for
        each date, never a fixed offset &mdash; a fixed offset is wrong for part of every
        season.</div>
      <div class="note">Whether locking is on <b>this load</b> is a live fact and lives in the
        status strip at the top of every page, not here. When the schedule feed cannot be
        reached, nothing is locked and a call may be one Sleeper will refuse.</div>`),

    sec("vegas", "Vegas lines", `
      <div class="note">Spreads and totals come from the same nflverse feed as the schedule,
        refreshed every five minutes. Books price roughly six weeks ahead, so a later week
        legitimately shows no line at all.</div>
      <div class="note"><b>They never move a projection.</b> A line appears in the reasoning
        behind a call &mdash; the implied team total in a panel &mdash; and nowhere else.</div>`),

    sec("usage", "Measured usage", `
      <div class="note">Snap share, touches and target share are <b>measured, never
        projected</b>. They are mirrored from nflverse, which publishes game by game, and a
        player with no snap row keeps a <b>blank rather than a zero</b> &mdash; missing data and
        zero snaps are different claims.</div>
      <div class="note">The second figure on a usage row is the last three games. A player on
        the way up and a player on the way out can share a season average, which is the whole
        reason both are shown.</div>
      <div class="note">Which week the mirror is good through, how far behind upstream it is and
        which clubs have not filed are live per-load facts and live in the status strip.</div>`),

    sec("notwired", "What is not wired yet", `
      <ul class="note gaps">
        <li>Kicker totals marked <b>&ge;</b> are floors, and kickers are never recommended off
          the wire for that reason.</li>
        <li>The defence row is a <b>projection gap</b>. Nothing on this site measures the offence
          a defence is about to face, so it ranks two defences by their own projections and
          nothing more. That question has never been asked here &mdash; it is not that it was
          asked and the answer was noise.</li>
        <li><b>FAAB bid figures are deliberately absent, not missing.</b> Nothing free supports
          one.</li>
      </ul>`),

    sec("sources", "Where the data comes from", `
      <div class="note">Live from <span class="mono">api.sleeper.com</span>,
        <span class="mono">api.fantasycalc.com</span> and
        <span class="mono">raw.githubusercontent.com</span>. Everything except the usage mirror
        is fetched in your browser as the page loads; the mirror is a build artefact that stamps
        the week it is good through, so it can be stale without the page being wrong about
        anything else. It is not the only thing that can: the schedule is cached too, and the
        status strip says so when it is serving a cached copy.</div>
      <div class="note">Consensus comes from FantasyPros via DynastyProcess. It is published
        <b>per position</b>, so an RB12 and a WR12 are not the same claim and the compare tool
        hides those rows rather than lining them up. It is a flag, never a vote: it does not move
        a projection.</div>
      <div class="note"><a href="https://sleeper.com" target="_blank" rel="noopener">open Sleeper
        &#8599;</a></div>`),
  ].join("");
}

export { SECTIONS };

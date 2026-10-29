# The render layer

Unit tests have never caught a real defect on this project on their own. Every
bug that mattered passed a green suite and was caught here, by putting the real
page in a real browser against real upstream bytes.

Phase A alone: this harness caught VOR silently equalling the raw projection
when no free agent exists (the compare tool's ranking axis, built on a number
that was not what its label said), and the player-name column collapsing to
59px on a phone — the identical Phase 3a failure, re-introduced by adding one
column and not re-measuring.

## Running it

Needs a container with Playwright and network access. The device's own shell
cannot reach api.sleeper.com or api.fantasycalc.com, and Chromium in the
container cannot reach anything, so:

1. Copy the site (index.html, app.css, leagues.json, js/) next to these files
   as `site/`.
2. `curl` the three upstream CSVs into `up/`, **under the names the harness
   actually reads**, which are not the upstream filenames:
   - nflverse `games.csv`            -> `up/games.csv` (schedule + Vegas lines)
   - DynastyProcess `fp_latest_weekly.csv` -> `up/fp.csv`  (FantasyPros ECR)
   - DynastyProcess `db_playerids.csv`     -> `up/ids.csv` (the crosswalk)

   This README used to list the upstream names only, and the harness dies with
   a bare ENOENT on the first route it serves. Cost a session two round-trips.
3. `npm i playwright` and `node harness.js` for the old page's scenario sweep,
   `node v2-render.js` for the v2 pages.

`measure.js` was deleted in phase 5. It measured the OLD DOM (`section.block
table`, `#app`) at four widths, and it hardcoded
`executablePath:"/opt/pw-browsers/chromium"` - the exact path `harness.js`
probes around because the versioned directory name changes with the container
image, so it had almost certainly stopped launching. Everything it existed for
now runs in `v2-render.js`, which measures the name cell at nine widths
(320-1440, the 560-900 band included) by counting real line boxes rather than
dividing a height. Recover it from git history if the old page ever needs
measuring again.

Sleeper and FantasyCalc are served from `fixture.js`; the CSVs are served as
the REAL bytes. Only the transport is local — the join, the Eastern-to-UTC
conversion and the spreads all run against production data.

## A green run is not proof the checks can see

Phase 5's audit (2026-10-29) mutation-tested the checks themselves, not only the pages. That found
eight checks that passed whatever the page did. The chip measurement and the phase 1 name-wrap probe
were both looking for a name that has lived inside `.rowtog` since phase 3. The variable guard was
reading computed styles, which never contain `var(`. Others were never shown that their knob had
applied. The harness and the 52 mutations are in `test/mutation/`. **When you add a check here, add
the mutation that should kill it there.**

## The fixture is hostile on purpose

Chris's actual rosters exercise almost none of this: one locked player, no
Rams, every position with a clean market entry. `fixture.js` puts something on
every branch at once — a locked-and-bad starter, a locked-and-good bench
player, a ruled-out starter the feed still projects, a Rams player (nflverse
spells the team LA, Sleeper spells it LAR), a team code the schedule has never
heard of, a player absent from FantasyCalc, a dead heat inside the noise
threshold, and a cross-position pair where the value leader and the points
leader are different players.

Keep the deliberate failure paths. The `fcalcOk:false` and `scheduleOk:false`
scenarios exist because a Phase 3a accident — a run with the schedule
unreachable — revealed the footer still announcing "Kickoff locking is on"
when nothing could lock. That accident is now a permanent scenario.

## The swap (phase 6): the subpath, and legacy.html

GitHub Pages serves this repo under `/fantasy-football-hub/`, never at an origin root. A page that
resolves its data one folder too high lands on `/` here and on the wrong place live, so the swap
checks pass `open({ prefix: "/fantasy-football-hub", pagePath: ... })` and the test server refuses
anything outside the prefix. **Assert on request paths (`dataHits`), not on "the layer arrived"**:
the usage and vacancy intercepts match any prefix and will serve the fixture to a page that asked
the wrong folder (mutants `P6-L2`, `P6-L3`).

The old hub lives at `legacy.html` in the repo root for two weeks after the swap — not a `legacy/`
folder, because `js/app.js` fetches document-relative and is frozen. `harness.js` now loads
`/legacy.html`; its JSON output was byte-identical to the `/` run on 2026-10-29.

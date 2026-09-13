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
2. `curl` the three upstream CSVs into `up/`:
   - nflverse `games.csv` (schedule + Vegas lines)
   - DynastyProcess `fp_latest_weekly.csv` (FantasyPros ECR)
   - DynastyProcess `db_playerids.csv` (the crosswalk)
3. `npm i playwright` and `node harness.js` for the scenario sweep,
   `node measure.js` for column-width measurement.

Sleeper and FantasyCalc are served from `fixture.js`; the CSVs are served as
the REAL bytes. Only the transport is local — the join, the Eastern-to-UTC
conversion and the spreads all run against production data.

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

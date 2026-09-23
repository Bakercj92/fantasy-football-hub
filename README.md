# Fantasy Football Hub

One page. Both leagues. It opens with what needs to change and says nothing when nothing does.

Replaces the Late-Round Tracker, which grew to 19 surfaces, 9 of them unreachable, and six
different places to compare two players. The teardown that led here is in the vault at
`Claude Brain/Projects/Fantasy-Football-Hub/2026-Rebuild-Teardown.md`.

## The four rules

1. **One surface per question.** A new surface must *replace* a named old one or it doesn't ship.
2. **Default empty.** If nothing needs a decision, the page says so in one line.
3. **Archive, don't unlink.** A page that loses its question leaves the product.
4. **Every number is current or labelled with its date.** No August data on a September page.

## How it works

There is **no build step for the app, and no `dist/`**. The source *is* the site. That is
deliberate: the old tool published a `dist/` copy, and three separate times the copy went stale
while every test stayed green. You cannot publish a stale copy of a file that has no copy.

Data is fetched **live in the browser** on every page open:

| Source | Gives |
|---|---|
| `api.sleeper.com/v1/state/nfl` | current week |
| `api.sleeper.com/projections/nfl/<season>/<week>` | the whole player universe - rows **embed** name, position, team, opponent and injury status, so this one call replaces the 5 MB player dump |
| `api.sleeper.com/v1/league/<id>` | scoring, roster slots, FAAB, playoff week - read live, never baked |
| `api.sleeper.com/v1/league/<id>/rosters` | your roster and current starters |

CORS on all of the above was verified by real `fetch()` from a GitHub Pages origin on 2026-09-10.

**Host rule: `api.sleeper.com`, never `api.sleeper.app`.** The `.app` host returns 200s with empty
rosters and stats-less projections - healthy-looking wrong data, which is worse than an error.

**Never send `order_by=ppr`.** It silently collapses `stats` to `{adp_dd_ppr}` only.

## The three ideas worth understanding

**1. The vendor's fantasy total is always wrong for these leagues.** The feed ships `pts_ppr`,
which pays 6 for a passing touchdown where both leagues pay 4. So nothing displays `pts_ppr`.
Instead `scoring.js` takes the dot product of the projection's `stats` and the league's
`scoring_settings` over their shared keys - Sleeper uses the same vocabulary for both, so there is
no mapping table to drift, and a mid-season scoring change is handled by the next page load.

**2. Decisions are a set difference, never a per-slot diff.** Verified live on 2026-09-10: the
solver seated Ball Knowers' quarterbacks and running backs in different slots than Chris had them,
across six positions - while the *set* of starters was identical. A per-slot comparison would have
reported six changes, all bookkeeping. As a set difference it correctly reported zero.

**3. Replacement level is measured, never assumed.** A projection says what a player scores. It
does not say whether that is *good*, and "good" is entirely a function of league shape. Every
mainstream tool ranks against a 12-team, 1QB baseline; neither of these leagues is that. So
`value.js` reads every roster in the league, works out who is genuinely free, and takes the best
free player at each position. There is no constant to tune. Measured live on 2026-09-10, week 1:

| Best free agent | Joop (14-team) | Ball Knowers (8-team SF) |
|---|---|---|
| RB | **5.59** (Perine) | **9.78** (Croskey-Merritt) |
| WR | **9.78** (Vele) | **12.86** (Coker) |
| TE | **8.56** (Waller) | **10.62** (Likely) |
| QB | 17.08 (Ward) | 17.08 (Ward) |

The same running back is worth about **four more points of value in Joop** than in Ball Knowers.
That gap is the entire reason this tool exists, and no consensus product will ever show it.

Note what fell out of the QB row: the best free quarterback projects 17.08, which is *higher* than
the starting Joop quarterback's 17.4 by only 0.3. In a 1QB 14-teamer the position is deep enough
to be nearly free. Nobody told the tool that; it measured it.

## Layout

```
index.html          the page
app.css             one token set - 19 tokens, no raw values outside :root
leagues.json        THE ONLY CONFIG. a league is a Sleeper id and a name.
js/sleeper.js       every live read
js/scoring.js       rescoring + startability
js/value.js         replacement level, VOR, measured per-position sigma
js/market.js        consensus (FantasyPros via DynastyProcess) - never moves a number
js/lineup.js        optimal lineup + what to change + kickoff locking
js/schedule.js      kickoff times and the Vegas line, fetched live - no build step
js/memory.js        decision log (a stub: records lockouts only, for Phase 5)
js/ui.js            rendering
js/app.js           wiring
test/               real unit tests against the MODULES, never against built HTML
data/               empty. reserved for the Phase 3b nflverse mirror (weekly stats,
                    snap counts, expected points). the SCHEDULE is NOT mirrored - see below.
dormant/            the JJ take corpus, retired from the pipeline, kept for possible revival
```

## Test

```bash
node test/run.mjs                # all suites: 79 assertions, 0 failures as of 2026-09-10
```

These test the **modules**, not rendered markup. The old project had 12,199 lines of suite of which
roughly 10,500 asserted against built HTML and would not have survived a rewrite. Not again.

## Two things the render pass caught that the tests did not

Kept here because both are the kind of bug only a rendered page reveals:

1. A `sed` cleanup deleted a whole CSS line that also carried `--bg`, `--surface` and `--raised`.
   Every remaining token still resolved; the page just quietly lost its dark theme and rendered
   near-white text on white. **No unit test would have caught this.** Render before believing.
2. The lineup solver started George Kittle while he was listed **Out**, because the feed still
   publishes a projection for a ruled-out player - that projection is what he *would* score if he
   played. `scoring.willNotPlay()` now removes those players from the pool entirely, and benching
   one is a **forced** call that ignores the point threshold, because a call that loses projected
   points is still right when the alternative is a guaranteed zero. Questionable is deliberately
   *not* on that list: questionable players usually play.

## Kickoff locking and Vegas (Phase 3a)

**The schedule needs no build step.** nflverse release assets fail CORS, which is why the original
plan had a weekly job mirroring `games.csv`. But the same file is published in-tree at
`raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`, which sends
`access-control-allow-origin: *`. Verified byte-for-byte against the release asset on 2026-09-10:
7,548 rows each, identical headers, and the only 48 differing rows differ solely by `-0` versus `0`
float rendering in `spread_line`. 511 KB gzipped, `max-age=300`.

That is better than a mirror rather than merely cheaper: spreads and totals move all week, so a
Tuesday mirror would be three days stale by Sunday morning.

**Kickoffs are converted from Eastern with the real DST rules**, never a fixed offset. `gametime`
is Eastern wall-clock, so September is UTC-4 and December is UTC-5; subtracting a constant would
shift every late-season lock by an hour. `Intl.DateTimeFormat` on `America/New_York` is asked what
the offset actually was at that instant. Brute-forced against `Intl` over 946 date/time pairs
spanning both 2026 and 2027 transitions: zero mismatches.

**A locked player is excluded from both sides of the decision.** Sleeper refuses to move a player
whose game has started in either direction, so a locked starter is pinned to his slot and a locked
bench player is removed from the pool. The tool solves around them and never raises an instruction
that would be refused.

**Two solves, deliberately.** The constrained lineup is what to do; the same solve with locks
ignored is the counterfactual. Their difference is the set of calls that were real and arrived too
late, shown as "too late this week" - never as an instruction, because there is nothing to do about
it - and written to `js/memory.js` for Phase 5 to read back.

**The Vegas read never moves a number.** Spread, game total and implied team total appear in the
reasoning behind a call and nowhere else. `spread_line` is the points the HOME team is favoured by,
confirmed against live moneylines. Books price about six weeks out, so most of the season
legitimately carries no line and the layer degrades to empty rather than to zero.

**Team codes disagree between the two feeds, silently.** All 32 match except one: nflverse writes
the Rams as `LA`, Sleeper writes `LAR`. Unaliased, every Rams player would simply never find a game
- no lock, no line, no error. `schedule.js` normalises, and `unknownTeams()` reports a code the
schedule does not recognise as a join failure rather than letting it look like a bye.

## The ten-minute cache, and why it is documented rather than solved

GitHub Pages serves `Cache-Control: max-age=600`, so a pushed change takes up to ten minutes to
reach a browser that already has the page. **This is known and accepted, not an oversight.**

A version query on the entry script does not actually fix it: `index.html` is served with the same
`max-age=600`, so a new `?v=` inside it cannot be seen until `index.html` itself has refreshed. The
window only matters in the minutes right after a push, and nobody pushes while setting a lineup.

The residual risk, raised in audit and worth writing down: within that window a returning browser
can pair a new module with an old `app.css`. If a deploy ever looks wrong immediately after a push,
hard-reload (Ctrl+Shift+R) before debugging anything.

## The compare tool (Phase A)

One compare surface, all positions, replacing the six the old product accumulated. A ranked pool
of N that collapses to a head-to-head at exactly two, rendered inline on the same page and
**invisible until you select someone** - tap the scales next to any player in your lineup or on
your bench.

**The metric list is data, not code.** `METRICS` in `js/compare.js` is an array of descriptors
(`key`, `label`, `get`, `fmt`, `dir`, `crossPosition`, `axis`, `note`). Nothing in the renderer
knows the name of a single metric, so Phase B's usage columns and the 2027 draft rows append as
entries. There is deliberately **no draft-mode code in `js/`** - a branch that cannot be exercised
for eleven months is how the old product ended up with nine unreachable surfaces.

**The cross-position rule is load-bearing.** A flex decision is "this RB or that WR". FantasyPros
ECR is published on per-position pages, so an RB12 and a WR12 are not the same claim - any metric
marked `crossPosition:false` is **dropped**, not greyed, the moment the pool spans positions, and
the surface says which ones it dropped and why. A number that looks comparable and isn't is worse
than no number.

**FantasyCalc (`js/fantasycalc.js`) is why this works at all.** It publishes one trade-value scale
across every position AND parameterises it to league shape. Verified live 2026-09-13: Josh Allen is
overall **#21** at `numQbs=1&numTeams=14` and **#3** at `numQbs=2&numTeams=8`. Same player, same
day, same site. That gap is the superflex premium, and Ball Knowers had been shown a 1QB consensus
rank as if it meant something. The shape is derived from what Sleeper says today, never baked.
Every row embeds `player.sleeperId`, so the join is an id lookup with no name matching.

**Which axis decides is not a detail.** Two players who could take the same starting slot are a
start/sit question, and start/sit is judged on projected points - the same axis the lineup solver
on this page already uses, so the two can never contradict each other. Everything else ranks on
value over replacement, and says so ("a hold-and-drop read, not a start/sit one"). Getting this
wrong meant the calls block could say "Start the QB, +8.0" while the compare block eight lines
below said "the RB by 7.5".

**Rest of season** is one Sleeper call per player, fetched only for players actually put into a
comparison - a 15-player roster would otherwise be 15 extra calls to answer a question nobody
asked. It is **re-scored at the league's own rules**, never the vendor's `pts_ppr`, and is cached
per league because it is a different number in each of them.

## The usage layer, and the one build step (Phase B)

**Everything on this page is fetched live in your browser except one file.** nflverse ships weekly
stats and snap counts as GitHub *release assets*, which redirect to a host that sends no CORS
header. Re-verified from the live site on 2026-09-13: the `api.github.com` metadata call returns
200 in the browser and the asset bytes throw. So `build/usage.py` mirrors and trims them into
`data/usage_2026.json`.

The disease the rebuild cured was never "a build step" — it was **a derived copy of the source
going stale while tests stayed green**, three times. A mirror of someone else's dataset is a
different animal, but only if it cannot lie about its own age. So:

- it writes **only** to `data/`. Nothing under `js/`, `index.html` or `app.css` is ever generated.
- it **trims**: four positions, twelve columns. A full 2025 season is 537 KB where the raw pair is
  ~11 MB by December.
- it **stamps** `through_week`, `generated_at`, and per-source status. The footer says "usage
  through week N", and says so separately for stats and snaps — a fresh overall stamp over a file
  whose snap half never arrived would otherwise claim to be current.
- `checkFreshness()` asks `api.github.com` — which *is* browser-readable — when upstream last
  changed, and the page says when the mirror is behind. **Silently stale becomes visibly stale**,
  which is the whole difference between a mirror and a liability.
- **no test asserts against its contents.** Tests assert on the loader.

The join is done once, at build time: `stats_player_week` is keyed by GSIS id and `snap_counts` by
PFR id, and neither is a Sleeper id. Resolving both here means the browser needs no second
crosswalk. Actuals are translated into **Sleeper's** stat vocabulary at build time too, so
`rescore()` grades a real week with the exact same function and settings that priced the projection.

**Missing is not zero, everywhere.** A player with no snap row keeps a blank. An unmeasured week is
skipped by the averages rather than entering as a zero-touch game — a bug that cost a third of a
player's workload and manufactured fake usage trends before it was caught.

## The wire (Phase C)

Two questions, and silence when neither has an answer. There is deliberately **no browsable
free-agent list** — Sleeper has one and it is better.

- **Upgrades** — is anyone free better *this week* than someone you are starting, at a seat he could
  actually fill? Measured against the same threshold the lineup solver uses, so a claim this block
  recommends is one the lineup block will then act on. One claim per seat, never four near-identical
  candidates for the same slot. Locked starters are never offered as seats.
- **Risers** — is anyone free trending sharply up in usage that persists, regardless of this week's
  projection? Proportional to his own season average, from a real base, and anchored to the current
  week so a player who has not appeared in six weeks cannot read as "up over his last three games".

**No FAAB dollar figure, anywhere, deliberately.** Nothing free supports one; a number we modelled
would look like a number we measured. Your remaining balance is shown and labelled as a balance.
Kickers and defenses are never recommended — their totals are floors here and their week-to-week
ranking is noise.

## The day-shaped page (Phase D)

A fantasy week has five different moments; the old tool had one view for all of them.
`PLANS` in `js/ui.js` maps each weekday to an ordered list of sections. It is an **order**, not a
set of switches — nearly every block already hides itself when it has nothing to say, so the day's
job is deciding what leads. Only the recap is genuinely day-gated (Tuesday and Wednesday), because
a scoreboard of last week's mistakes while you are setting this week's lineup is a distraction.

Every day carries `compare` and `locked`, and that is not an oversight: the compare selector renders
on every row regardless of day, so a plan without it strands the selection with no way out.

## Decision memory and the recap (Phase E)

What you ran versus what the tool suggested, written every load and overwritten within the week, so
the last thing recorded before kickoff is what gets graded. Silent when the two agree — and taking
the advice *clears* the earlier disagreement, so you are never graded on a lineup you fixed.

The recap grades only weeks that have **finished and been published**, scored from real results at
this league's own rules. Calls and lockouts are totalled **separately**: a lockout is not a decision
you got wrong. A week that is only partly mirrored is shown, labelled, and left out of the totals.

**This log lives in one browser on one device.** A lineup set on the phone is not in it. That is a
known and accepted limit, chosen over building a shared store, and the page says so rather than
implying it saw everything.

## Not wired yet (end of Phase E)

- ~~Kickoff locking~~ **DONE.** See above.
- ~~Variance thresholds~~ **DONE.** Per-position sigma, measured live from the starter-caliber
  pool. Threshold is half a sigma, floored at 1.0 and capped at 2.0; a comparison spanning two
  positions takes the larger, not quadrature - the question is "could this gap be noise", and the
  noisier player decides that.
- ~~Replacement level~~ **DONE and measured.**
- ~~Market cross-check~~ **DONE.** Consensus arrives as a late enrichment and re-renders; if it
  never arrives, nothing else changes. Our side ranks by VOR, not raw points, because within one
  roster the comparison is cross-position and raw points make every quarterback look like a stud.
  The disagreement gate scales with roster size.
- **Kicker totals** marked with a floor sign are floors - the feed carries no yardage-bonus field.
- **The usage layer** (snap share, target share, expected points) is Phase 3b, together with the
  weekly Python build that mirrors what the browser genuinely cannot reach. Those 2026 files do not
  exist until games are played.
- ~~One compare tool~~ **DONE.**
- ~~The usage layer~~ **DONE** (Phase B).
- ~~The waiver pool~~ **DONE** (Phase C).
- ~~The day-shaped page~~ **DONE** (Phase D).
- ~~Decision memory and the recap~~ **DONE** (Phase E).
- ~~**A matchup layer**~~ **PARTLY DONE (2026-09-23).** `js/matchup.js` builds defence-vs-position
  from the mirror's own actuals, re-scored at each league's rules, and then **measures whether the
  result means anything before reporting it.** On 2026 weeks 1-2 it refuses to speak about QB
  (0.0% signal), WR (0.0%) and TE (14.5%), and reports New York's run defence as "4% more than
  average" rather than "#8 of 32". The gate is `MIN_SIGNAL = 0.15` and the shrinkage is empirical
  Bayes on measured reliability, so the layer starts talking on its own as games accrue with no
  constant to tune.

  The reason for all that machinery: a two-week defence rank is noise. Split-half on 2026 weeks 1-2
  gives r = -0.04 (QB), -0.06 (WR), +0.07 (TE), +0.24 (RB). A full 2025 season gives 41/21/25/9.7%
  signal. A raw rank table is a machine for producing confident nonsense, and on 2026-09-23 it
  produced some.

  Still missing: game environment (implied totals, spread) as a second factor, and wiring into the
  compare and lineup surfaces. The module is tested and verified against the live mirror but nothing
  calls it yet.

- **`js/signals.js` — the projection/usage disagreement detector. DONE (2026-09-23).**
  Two sources answer two different questions: the projection knows who is playing *this* week, the
  mirror knows how good he has *been*. Using either for the other's question is how three start/sit
  calls went wrong in one hour. It flags `absent` (projected but missing from the last completed
  week - the Kyler Murray case), `thin`, and `projection-high`/`projection-low` past one measured
  sigma. It deliberately does not resolve any of them; the `absent` flag carries a question and a
  place to look, and a test asserts it contains no recommendation.

- **A matchup layer.** Defence-adjusted expectations are not built. Vegas appears only as context
  behind a call, and streaming a defence off the wire is deliberately not recommended without it.
- **Injury designations** come from Sleeper and lag the wire by hours; nflverse's 2026 injury file
  is 30 rows and its upstream ended after 2024.
- **The nudge.** A scheduled task can reach nflverse and api.github.com but has no route to Sleeper,
  so it can say "new usage data has published, ask Claude to refresh" and can never say anything
  about your roster.
- **A shared decision store.** Would fix the one-device limit above. Declined for now.
- **Depth charts** were considered and cut: a depth chart predicts usage, and Phase 3b measures it.

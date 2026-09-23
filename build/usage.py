#!/usr/bin/env python3
"""Mirror the one thing a browser genuinely cannot reach.

Everything else this app uses is fetched live in the browser. nflverse ships
its weekly stats and snap counts as GitHub RELEASE ASSETS, and those redirect
to release-assets.githubusercontent.com, which sends no CORS header - verified
again from the live site on 2026-09-13, where the api.github.com metadata call
returns 200 and the asset bytes fetch fails. So this is the single exception,
and it is kept as narrow as the exception deserves:

  * it writes ONLY to data/. No file under js/, index.html or app.css is ever
    generated. The source is still the site.
  * it TRIMS. The raw pair is ~11 MB by December; nobody should download that
    on a phone to find out a receiver's target share. Four positions and
    twelve columns bring a full season to roughly half a megabyte.
  * it STAMPS `generated_at`, `through_week` and the upstream asset's own
    `updated_at`. The page reads the stamp and says "usage through week N",
    and can ask api.github.com - which IS browser-readable - whether upstream
    has moved since. That is what turns silently stale into visibly stale,
    which is the whole difference between a mirror and a liability.
  * NO TEST asserts against its contents. Tests assert on the loader.

The join is done HERE, once, not in the browser. stats_player_week is keyed by
GSIS id and snap_counts by PFR id; neither is a Sleeper id, and this app's
spine is Sleeper ids. Resolving both at build time means the page needs no
second crosswalk - market.js already caches DynastyProcess's for consensus,
and one is enough.
"""
import csv, io, json, sys, urllib.request, datetime, os

REL   = "https://github.com/nflverse/nflverse-data/releases/download"
API   = "https://api.github.com/repos/nflverse/nflverse-data/releases/tags"
IDS   = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
KEEP  = {"QB", "RB", "WR", "TE"}

COLS = ["wk", "off_pct", "tgt", "rec", "rec_yd", "tgt_share", "ay_share",
        "wopr", "car", "rush_yd", "att", "pass_yd", "opp"]

# What a player ACTUALLY scored, translated into SLEEPER's stat vocabulary at
# build time rather than in the browser.
#
# scoring.js works because Sleeper's scoring_settings keys and its projection
# stats keys are the same words, so scoring a player is a dot product with no
# mapping table to drift. nflverse uses different words. Translating here keeps
# that property intact: the browser re-scores a real week at each league's own
# rules with the exact same function it uses for projections, and no second
# vocabulary ever reaches it.
#
# This is what makes the Tuesday recap an actual measurement instead of a
# decoration - "what the call cost" needs real points, at YOUR league's rules,
# and pts_ppr is the 6-point-passing-TD number both leagues forbid.
ACT = {
    "pass_yd":  ["passing_yards"],
    "pass_td":  ["passing_tds"],
    "pass_int": ["passing_interceptions"],
    "pass_2pt": ["passing_2pt_conversions"],
    "rush_yd":  ["rushing_yards"],
    "rush_td":  ["rushing_tds"],
    "rush_2pt": ["rushing_2pt_conversions"],
    "rec":      ["receptions"],
    "rec_yd":   ["receiving_yards"],
    "rec_td":   ["receiving_tds"],
    "rec_2pt":  ["receiving_2pt_conversions"],
    # Sleeper scores one fumble-lost key; nflverse splits it three ways.
    "fum_lost": ["sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost"],
    "st_td":    ["special_teams_tds"],
}


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def rows(url):
    return list(csv.DictReader(io.StringIO(get(url).decode("utf-8", "replace"))))


def num(v, d=None):
    try:
        f = float(v)
        return round(f, 3) if f == f else d     # NaN check
    except (TypeError, ValueError):
        return d


def asset_updated_at(tag, name):
    """The upstream file's own mtime. The page compares its stamp to this."""
    try:
        j = json.loads(get(f"{API}/{tag}").decode())
        for a in j.get("assets", []):
            if a.get("name") == name:
                return a.get("updated_at")
    except Exception as e:
        print(f"  (could not read upstream mtime: {e})", file=sys.stderr)
    return None


def build(season, out_path):
    print(f"Mirroring nflverse usage for {season}")

    print("  crosswalk…")
    gsis, pfr = {}, {}
    for r in rows(IDS):
        sid = (r.get("sleeper_id") or "").strip()
        if not sid:
            continue
        if r.get("gsis_id"):
            gsis[r["gsis_id"].strip()] = sid
        if r.get("pfr_id"):
            pfr[r["pfr_id"].strip()] = sid

    print("  weekly stats…")
    stats = rows(f"{REL}/stats_player/stats_player_week_{season}.csv")
    print("  snap counts…")
    snaps_ok = True
    try:
        snaps = rows(f"{REL}/snap_counts/snap_counts_{season}.csv")
    except Exception as e:
        # A missing snap file must not be able to hide behind a fresh overall
        # stamp. snap_counts is its OWN release with its own publishing
        # schedule, so "the mirror is current" is two claims, not one, and the
        # payload has to carry both or the page will say "up to date with
        # nflverse" over a file with every snap null.
        print(f"  (snap counts unavailable: {e})", file=sys.stderr)
        snaps, snaps_ok = [], False

    # Snap share, keyed (sleeper_id, week). A player with no snap row keeps a
    # null rather than a zero - "we don't know" and "did not play" are not the
    # same claim, and this app has been bitten by collapsing that distinction
    # before (a bye and an unknown team code both look like "no game").
    snap_pct = {}
    for r in snaps:
        # Explicit REG only. An absent column used to pass every row, which
        # would fold the postseason into season averages the moment nflverse
        # renamed or dropped the field.
        if str(r.get("game_type") or "REG").upper() != "REG":
            continue
        sid = pfr.get((r.get("pfr_player_id") or "").strip())
        if not sid:
            continue
        snap_pct[(sid, int(float(r["week"])))] = num(r.get("offense_pct"))

    players, weeks_seen, unmatched = {}, set(), 0
    for r in stats:
        if str(r.get("season_type") or "REG").upper() != "REG":
            continue
        if r.get("position") not in KEEP:
            continue
        sid = gsis.get((r.get("player_id") or "").strip())
        if not sid:
            unmatched += 1
            continue
        wk = int(float(r["week"]))
        weeks_seen.add(wk)
        p = players.setdefault(sid, {"pos": r["position"], "tm": r.get("team") or "", "w": []})
        p["tm"] = r.get("team") or p["tm"]          # latest team wins
        p["w"].append([
            wk,
            snap_pct.get((sid, wk)),
            num(r.get("targets"), 0),
            num(r.get("receptions"), 0),
            num(r.get("receiving_yards"), 0),
            num(r.get("target_share")),
            num(r.get("air_yards_share")),
            num(r.get("wopr")),
            num(r.get("carries"), 0),
            num(r.get("rushing_yards"), 0),
            num(r.get("attempts"), 0),
            num(r.get("passing_yards"), 0),
            # WHO HE PLAYED, per week, taken from the row itself.
            #
            # This is NOT derivable in the browser from `tm`. The payload keeps
            # only the LATEST team ("latest team wins", above), so a player who
            # changed teams would be scored against the wrong defence for every
            # week before the move - wrong opponent, and everything downstream
            # of it wrong too. The source row knows the right answer for that
            # week, so carry it. Same trap as the baked team column on the old
            # season pages.
            r.get("opponent_team") or None,
        ])
        act = {}
        for sleeper_key, cols in ACT.items():
            total = sum(num(r.get(c), 0) or 0 for c in cols)
            if total:
                act[sleeper_key] = round(total, 2)
        if act:
            p.setdefault("a", {})[str(wk)] = act

    for p in players.values():
        p["w"].sort(key=lambda x: x[0])

    payload = {
        "season": int(season),
        "through_week": max(weeks_seen) if weeks_seen else 0,
        "weeks": sorted(weeks_seen),
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                         .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source_updated_at": asset_updated_at("stats_player", f"stats_player_week_{season}.csv"),
        # Per-source, not one blanket claim. The page reports what is actually
        # in the file rather than implying both halves arrived.
        "sources": {
            "stats_player": {"ok": True, "rows": len(stats)},
            "snap_counts": {"ok": snaps_ok, "rows": len(snaps)},
        },
        "cols": COLS,
        "act_keys": sorted(ACT),
        "p": players,
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))

    kb = os.path.getsize(out_path) / 1024
    print(f"  {len(players)} players, weeks {payload['weeks']}, "
          f"{unmatched} stat rows with no Sleeper id, {kb:.0f} KB -> {out_path}")
    return payload


if __name__ == "__main__":
    season = sys.argv[1] if len(sys.argv) > 1 else "2026"
    out = sys.argv[2] if len(sys.argv) > 2 else f"data/usage_{season}.json"
    build(season, out)

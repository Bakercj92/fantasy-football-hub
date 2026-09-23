"""vacancy.py - who just lost their job, and who is next in line.

WHY THIS FILE EXISTS

The usage mirror is a LAGGING read. Snap share and opportunities only move
after a box score the whole league has seen, which is why `risers()` can never
get Chris to a player before his 14-team league does. The two signals that
genuinely lead are:

  * an injury / practice report, which lands Wednesday for a Sunday game
  * a depth-chart rank change, which nflverse republishes daily

Both are free, both are reachable from the same release host the mirror
already uses, and neither needs a single game to have been played - so this
block has an answer in week 1, where the usage block correctly has none.

WHAT IT DOES NOT DO

It does not decide who inherits. Emitting "Player B replaces Player A" here
would bake a judgement into a data file, where no test can see it and no
league context exists - and the right inheritor differs by league, because he
has to be FREE in that league to matter at all. This file emits facts:
who is absent, how absent, and what the depth chart says today versus a week
ago. js/vacancy.js joins that to the roster and makes the call.

Same guardrails as usage.py, for the same reasons:
  * writes ONLY to data/
  * per-source status, so a fresh overall stamp cannot hide a release that
    never published
  * trimmed hard - skill positions only, and the depth chart reduced to a
    rank plus a delta rather than 29 daily snapshots
  * the gsis -> sleeper join happens HERE, so the browser needs no crosswalk
"""

import csv, io, json, sys, urllib.request, datetime, os

REL = "https://github.com/nflverse/nflverse-data/releases/download"
API = "https://api.github.com/repos/nflverse/nflverse-data/releases/tags"

SKILL = {"QB", "RB", "WR", "TE"}

# A depth chart moves for boring reasons too. Comparing today against roughly
# a week ago is what separates "promoted" from "the file was regenerated".
CLIMB_WINDOW_DAYS = 8

# THE RESTING-PLAYER TRAP.
#
# The practice report is the earliest signal available, but it does not only
# carry injuries: a healthy veteran given Wednesday off is filed as "Did Not
# Participate In Practice" with the primary injury literally spelled
# "Not injury related - resting player". Treating that as a vacancy would put
# a starting running back's backup on the wire every week of the season, which
# is worse than silence - it teaches Chris to ignore the block.
NOT_AN_INJURY = "not injury related"

OUT_STATUSES = {"Out", "Doubtful"}
DNP = "Did Not Participate In Practice"


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def rows(url):
    return list(csv.DictReader(io.StringIO(get(url).decode("utf-8", "replace"))))


def asset_updated_at(tag, name):
    """Upstream's own publish time. Best-effort: api.github.com is reachable
    from some hosts and not others, and a missing stamp is not a failure."""
    try:
        j = json.loads(get(f"{API}/{tag}").decode("utf-8"))
        for a in j.get("assets", []):
            if a.get("name") == name:
                return a.get("updated_at")
    except Exception:
        return None
    return None


def build(season):
    status = {}

    def pull(tag, name):
        try:
            r = rows(f"{REL}/{tag}/{name}")
            status[tag] = {"ok": True, "rows": len(r)}
            return r
        except Exception as e:
            status[tag] = {"ok": False, "error": str(e)[:120]}
            return []

    roster = pull("weekly_rosters", f"roster_weekly_{season}.csv")
    inj = pull("injuries", f"injuries_{season}.csv")
    dc = pull("depth_charts", f"depth_charts_{season}.csv")

    # ---- crosswalk -------------------------------------------------------
    # nflverse's own weekly roster file carries gsis_id AND sleeper_id, so the
    # DynastyProcess crosswalk usage.py needs is not needed here. Take the
    # LATEST week a player appears in: a mid-season signing has no row in
    # week 1 and an early cut has a stale one.
    sleeper, name_of = {}, {}
    seen_wk = {}
    for r in roster:
        g, s = r.get("gsis_id"), r.get("sleeper_id")
        if not g:
            continue
        try:
            wk = int(r.get("week") or 0)
        except ValueError:
            wk = 0
        if wk < seen_wk.get(g, -1):
            continue
        seen_wk[g] = wk
        if s:
            sleeper[g] = s
        name_of[g] = r.get("full_name") or name_of.get(g, "")

    # ---- who is absent ---------------------------------------------------
    # TWO WEEKS, NOT ONE. THIS IS THE WHOLE POINT OF THE BLOCK.
    #
    # The first version took the highest week present and stopped. Run live on
    # a Wednesday morning it returned ONE player, because nflverse ingests the
    # practice report team by team as it is filed: week 3 held 22 rows from
    # two clubs while week 2's completed report - 44 Out, 6 Doubtful, whole
    # league - sat one row below and was thrown away.
    #
    # That is exactly backwards for the job. The run fires Tuesday evening,
    # when THIS week's report barely exists and LAST week's is complete, and
    # last week's is the one that pays: a starter who was Out on Sunday is a
    # backup who just played, and that backup is the claim. This week's
    # partial report is the early read that sharpens as the week goes on.
    #
    # So both weeks ship, each labelled with how much of the league had
    # actually reported when it was built. A consumer that treats a 2-of-32
    # report as league-wide is making a claim the data cannot support, and
    # `coverage` is what stops it.
    all_weeks = sorted({int(r["week"]) for r in inj if r.get("week", "").isdigit()})
    week = all_weeks[-1] if all_weeks else None
    keep_weeks = all_weeks[-2:]

    absent = []
    coverage = {}
    for wk in keep_weeks:
        wk_rows = [r for r in inj if r.get("week", "").isdigit() and int(r["week"]) == wk]
        coverage[str(wk)] = {
            "teams_reported": len({r["team"] for r in wk_rows if r.get("team")}),
            "rows": len(wk_rows),
        }
        for r in wk_rows:
            if r.get("position") not in SKILL:
                continue
            g = r.get("gsis_id")
            sid = sleeper.get(g)
            if not sid:
                continue

            report = (r.get("report_status") or "").strip()
            practice = (r.get("practice_status") or "").strip()
            p_inj = (r.get("report_primary_injury")
                     or r.get("practice_primary_injury") or "").strip()

            # Tier, strongest signal first.
            if report in OUT_STATUSES:
                tier = "confirmed"
            elif practice == DNP and p_inj and NOT_AN_INJURY not in p_inj.lower():
                tier = "watch"
            else:
                continue

            # THE STATUS AND THE REASON ARE TWO DIFFERENT FACTS.
            #
            # Collapsing them into one field hid the signal. A player can carry
            # report_status "Questionable" - which on its own is the weakest
            # word in the injury report, applied to half the league every week
            # - while having sat out practice entirely. It is the DNP that put
            # him in this list, and a row reading only "Questionable" invites
            # exactly the shrug that designation usually deserves.
            absent.append({
                "id": sid,
                "wk": wk,
                "nm": r.get("full_name"),
                "tm": r.get("team"),
                "pos": r.get("position"),
                "st": report or practice,
                "prac": practice or None,
                "inj": p_inj or None,
                "tier": tier,
            })

    # ---- the depth chart, today and a week ago ---------------------------
    # 550k rows of daily snapshots reduce to one rank per skill player plus a
    # delta. Dedupe within a snapshot: the file repeats a player across
    # formation slots (a WR is listed under more than one alignment) and only
    # his pos_rank matters here.
    skill_dc = [r for r in dc if r.get("pos_abb") in SKILL and r.get("gsis_id")]
    dts = sorted({r["dt"] for r in skill_dc})
    if not dts:
        return {"error": "no depth chart rows"}, status
    today = dts[-1]

    cutoff = (
        datetime.datetime.strptime(today, "%Y-%m-%dT%H:%M:%SZ")
        - datetime.timedelta(days=CLIMB_WINDOW_DAYS)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    prior_candidates = [d for d in dts if d <= cutoff]
    prior = prior_candidates[-1] if prior_candidates else dts[0]

    def snapshot(dt):
        out = {}
        for r in skill_dc:
            if r["dt"] != dt:
                continue
            g = r["gsis_id"]
            try:
                rank = int(r["pos_rank"])
            except (ValueError, TypeError):
                continue
            # Best (lowest) rank wins when a player appears twice.
            if g not in out or rank < out[g]["rank"]:
                out[g] = {"rank": rank, "tm": r["team"], "pos": r["pos_abb"]}
        return out

    now, then = snapshot(today), snapshot(prior)

    depth = {}
    for g, cur in now.items():
        sid = sleeper.get(g)
        if not sid:
            continue
        was = then.get(g)
        # A player who was not on the chart a week ago has no climb - he has an
        # arrival, which is a different claim and not one this field should
        # make. null, never 0.
        climb = (was["rank"] - cur["rank"]) if was and was["tm"] == cur["tm"] else None
        depth[sid] = {
            "tm": cur["tm"],
            "pos": cur["pos"],
            "rk": cur["rank"],
            "climb": climb,
            "nm": name_of.get(g) or "",
        }

    payload = {
        "season": season,
        "week": week,
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "depth_asof": today,
        "depth_prior": prior,
        "sources": status,
        "source_updated_at": {
            "depth_charts": asset_updated_at("depth_charts", f"depth_charts_{season}.csv"),
            "injuries": asset_updated_at("injuries", f"injuries_{season}.csv"),
        },
        "weeks": keep_weeks,
        "coverage": coverage,
        "absent": absent,
        "depth": depth,
    }
    return payload, status


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    out = sys.argv[2] if len(sys.argv) > 2 else "data/vacancy_2026.json"
    payload, status = build(season)

    # A build that lost a source must say so loudly rather than shipping a
    # confident-looking file with half the signal missing.
    bad = [k for k, v in status.items() if not v.get("ok")]
    if bad:
        print(f"FAILED sources: {bad}", file=sys.stderr)
        sys.exit(1)
    if not payload.get("depth"):
        print("FAILED: empty depth chart", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(
        f"wrote {out}  week={payload['week']}  "
        f"absent={len(payload[chr(39)+chr(39)] if False else payload['absent'])}  depth={len(payload['depth'])}  "
        f"asof={payload['depth_asof']} vs {payload['depth_prior']}  "
        f"{os.path.getsize(out)/1024:.0f} KB"
    )


if __name__ == "__main__":
    main()

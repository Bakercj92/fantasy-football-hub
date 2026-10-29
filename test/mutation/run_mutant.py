#!/usr/bin/env python3
"""Run ONE mutant in its own throwaway copy of the pristine tree.

The pristine tree is never written to, so there is nothing to restore and no
rolling backup to trust. Outcomes are four, never collapsed:
  APPLY-FAIL  the old string did not occur exactly once, or the served copy did
              not change - the mutation never reached the browser
  KILLED      at least one check FAILed
  SURVIVED    every selected check passed, with the same pass count as baseline
  CRASHED     the run died or the pass count moved without a FAIL (a skipped
              check is not a kill)
Usage: PRISTINE=/path/to/untouched/copy run_mutant.py <mutants.json> <id>
Run every `"baseline": true` entry first and write their pass counts to
$BC (default $RES/baseline_counts.json) as {"<SECTIONS>": n}; see README.md.
"""
import json, sys, os, shutil, subprocess, hashlib, re, time

HERE = os.path.dirname(os.path.abspath(__file__))
# A COPY of the repo that nothing writes to. Never point this at a working tree you edit.
PRISTINE = os.environ["PRISTINE"]
WORK = os.environ.get("WORK", "/tmp/ffh-mut/w")
RES = os.environ.get("RES", "/tmp/ffh-mut/results")
md5 = lambda p: hashlib.md5(open(p, "rb").read()).hexdigest()

muts = {m["id"]: m for m in json.load(open(sys.argv[1]))}
m = muts[sys.argv[2]]
wd = os.path.join(WORK, m["id"])
shutil.rmtree(wd, ignore_errors=True)
shutil.copytree(PRISTINE, wd, symlinks=True)
os.makedirs(RES, exist_ok=True)

def finish(outcome, detail="", fails=None, passed=None):
    r = {"id": m["id"], "outcome": outcome, "detail": detail, "fails": fails or [],
         "passed": passed, "note": m.get("note", ""), "sections": m.get("sections")}
    json.dump(r, open(os.path.join(RES, m["id"] + ".json"), "w"), indent=1)
    print(f'{m["id"]:<28} {outcome:<10} {detail}')
    shutil.rmtree(wd, ignore_errors=True)
    sys.exit(0)

edits = [] if m.get("baseline") else (m.get("edits") or [{"file": m["file"], "old": m["old"], "new": m["new"]}])
for e in edits:
    f = os.path.join(wd, e["file"])
    s = open(f).read()
    c = s.count(e["old"])
    if c != 1:
        finish("APPLY-FAIL", f'{e["file"]}: old string occurs {c} times')
    open(f, "w").write(s.replace(e["old"], e["new"], 1))
    if md5(f) == md5(os.path.join(PRISTINE, e["file"])):
        finish("APPLY-FAIL", f'{e["file"]}: bytes unchanged after replace')

R = os.path.join(wd, "test/render")
# Re-stage site/ from the MUTATED tree, then prove the mutation is what gets served.
subprocess.run(["node", "test/render/setup.mjs"], cwd=wd, capture_output=True, check=True)
for e in edits:
    if e["file"].startswith(("v2/", "js/")) or e["file"] in ("index.html", "legacy.html", "app.css", "leagues.json"):
        served = os.path.join(R, "site", e["file"])
        if md5(served) != md5(os.path.join(wd, e["file"])):
            finish("APPLY-FAIL", f'served copy of {e["file"]} is not the mutated file')
subprocess.run(["python3", os.path.join(HERE, "sectionize.py"), "v2-render.js", "v2-render.sec.js"],
               cwd=R, capture_output=True, check=True)
env = dict(os.environ, SECTIONS=m["sections"])
t0 = time.time()
p = subprocess.run(["node", "v2-render.sec.js"], cwd=R, env=env, capture_output=True, text=True,
                   timeout=1500)
out = p.stdout + p.stderr
open(os.path.join(RES, m["id"] + ".log"), "w").write(out)
fails = re.findall(r"^  FAIL (.*)$", out, re.M)
mm = re.search(r"v2 render: (\d+) passed, (\d+) failed", out)
try:
    bc = json.load(open(os.environ.get("BC", os.path.join(RES, "baseline_counts.json"))))
    parts = m["sections"].split("|")
    base = sum(bc[p] for p in parts) if all(p in bc for p in parts) else None
except FileNotFoundError:
    base = None
dt = f"{time.time()-t0:.0f}s"
if fails:
    finish("KILLED", f"{len(fails)} FAIL, {dt}: {fails[0][:90]}", fails, int(mm.group(1)) if mm else None)
if not mm:
    finish("CRASHED", f"no summary line, exit {p.returncode}, {dt}: {out.strip().splitlines()[-1][:120] if out.strip() else ''}")
passed = int(mm.group(1))
if base is not None and passed != base:
    finish("CRASHED", f"pass count {passed} != baseline {base} with no FAIL, {dt}", None, passed)
finish("SURVIVED", f"{passed} passed (baseline {base}), {dt}", None, passed)

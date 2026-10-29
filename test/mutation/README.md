# The mutation harness

Built for the phase 5 audit (2026-10-29), after two audits in a row lost time to the same two
mistakes. In phase 4, eight of fifteen re-runs reported as kills were really mutations that never
applied, because shell quoting ate `$` and `"`. And one mutation that timed out before its restore
was "verified" against a rolling backup that had already been overwritten, so it passed its own
integrity check with the mutation still in the file.

So this harness never edits a tree it later trusts:

- **Every mutant runs in its own throwaway copy** of a pristine tree (`$PRISTINE`). Nothing is
  restored afterwards because nothing that matters was ever touched.
- **The mutation lives in JSON, not in a shell string.** `old` must occur exactly once in the file,
  the bytes must differ afterwards, and the copy in `test/render/site/` that the browser is served
  must match the mutated file by md5. If any of those fails, the result is `APPLY-FAIL`. It is never
  counted as a kill.
- **There are four outcomes, not two.** `KILLED` means at least one check FAILed. `SURVIVED` means
  every selected check passed *and* the pass count matched the baseline. `CRASHED` means the run
  died, or the count moved without a FAIL (a check that was skipped has not killed anything). And
  `APPLY-FAIL`, as above.

`sectionize.py` rewrites a copy of `v2-render.js` so that `SECTIONS=<regex over the section
headers>` runs only those sections. The full sweep takes about four minutes and a single section
takes about ten seconds, which is what makes fifty mutants affordable. With `SECTIONS` unset the
rewritten file runs everything, exactly like the original.

## Running it

From a container that can run the render layer (see `test/render/README.md`):

    cp -r <repo> /tmp/pristine      # with test/render/up/ already fetched
    export PRISTINE=/tmp/pristine
    # 1. every "baseline": true entry first; their pass counts become the baseline
    # 2. then the mutants
    python3 test/mutation/run_mutant.py test/mutation/mutants.json <id>

Run the baselines first and write `{"<SECTIONS>": passCount}` to `$RES/baseline_counts.json`.
`SURVIVED` is only meaningful against that number. Two to three mutants in parallel is about what a
two-core container takes.

## What the phase 5 audit found with it

There were 63 mutant runs across three rounds, covering 52 distinct mutations. The first round turned up ten survivors, and none
of them was a product bug. Every one was a check that could not see what it was named after:

- the chip measurement pass found no name text on any row and passed by default
- the unresolved-variable guard searched computed styles, which can never contain the text `var(`
- the day matrix's waiver day was never set, so claims could not lead on any day
- the defence row's verdict and number were never read back
- the snaps "flagged" check was satisfied by a different row
- the no-budget knob was never shown to have applied

Every one of them now dies. Two survivors from the second round, a fat chip and a min-width chip,
exposed a failure mode none of the checks measured. The roster table scrolling *inside its own
wrapper* never shows up as document overflow, and it pushes the projection column off a phone. That
is now measured too.

`mutants.json` is the set that applies to the tree as of the audit commit. When the source moves,
`APPLY-FAIL` will say which entries need re-pointing. Re-point them; do not delete them.

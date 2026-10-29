#!/usr/bin/env python3
"""Make v2-render.js runnable one section at a time, WITHOUT editing the repo copy.

Every top-level `console.log("\\n<HEADER>")` becomes `__sec("\\n<HEADER>")`, and
every top-level block or for-loop (two-space indent, which is where every
open() lives) is prefixed `if (__S())`. Declarations between blocks still run,
so constants shared across sections (D_SUN, notThe404, QB...) still exist.
ok() is a no-op outside the selected sections. SECTIONS is a regex over the
header text; unset = everything (identical to the original file).

Usage: sectionize.py <in v2-render.js> <out>
"""
import re, sys

src = open(sys.argv[1]).read()
lines = src.split("\n")
out, n_sec, n_blk = [], 0, 0
in_iife = False
for ln in lines:
    if ln.startswith("(async () => {"):
        in_iife = True
        out.append(ln)
        out.append('  const __RX = process.env.SECTIONS ? new RegExp(process.env.SECTIONS) : null;')
        out.append('  let __cur = ""; const __S = () => !__RX || __RX.test(__cur);')
        out.append('  const __sec = (h) => { __cur = h; if (__S()) console.log(h); };')
        continue
    if in_iife and re.match(r'^  console\.log\("\\n', ln):
        out.append(ln.replace('  console.log(', '  __sec(', 1)); n_sec += 1; continue
    if in_iife and re.match(r'^  (\{\s*$|for \()', ln):
        out.append('  if (__S()) ' + ln[2:]); n_blk += 1; continue
    out.append(ln)
res = "\n".join(out)
# ok() must respect the selection too, for the few top-level ok() calls.
needle = "const ok = (name, cond, detail = \"\") => {"
assert res.count(needle) == 1, "ok() signature moved"
res = res.replace(needle, needle + "\n  if (typeof globalThis.__SKIP === 'function' && globalThis.__SKIP()) return;")
res = res.replace("  const __sec = (h) =>", "  globalThis.__SKIP = () => !__S();\n  const __sec = (h) =>", 1)
assert "globalThis.__SKIP = () =>" in res
open(sys.argv[2], "w").write(res)
print(f"sections={n_sec} blocks={n_blk}", file=sys.stderr)

// Every suite, one command. Exits non-zero if any suite fails.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const files = readdirSync(new URL(".", import.meta.url))
  .filter((f) => f.endsWith(".test.mjs")).sort();
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [new URL(f, import.meta.url).pathname], { stdio: "inherit" });
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} suite(s) FAILED` : `\nall ${files.length} suites green`);
process.exit(bad ? 1 : 0);

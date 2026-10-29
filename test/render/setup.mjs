// Make the render layer runnable from the repo.
//
// It was not. `site/` and `up/` were hand-staged by whoever last ran the
// harness, committed nowhere and gitignored nowhere, so every claim only
// rendering can establish - the ones that have caught every real defect on
// this project - was unreproducible from a clean checkout. The audit on
// 2026-10-13 called that the stale-copy failure class in a new hat, on a
// project that already keeps a freshness guard on dist/ for exactly that
// reason.
//
//   node test/render/setup.mjs      # stage site/ from THIS repo, fetch up/
//   node test/render/harness.js     # the scenario sweep (the old page)
//   node test/render/v2-render.js   # the v2 shell
//
// `measure.js` was deleted in phase 5: it measured the OLD DOM at four widths
// and hardcoded a Chromium path that stopped existing. v2-render.js measures
// nine widths (320-1440) with a real line-box count.
//
// Needs a container with network and `npm i playwright`. The device's own
// shell cannot reach api.sleeper.com and Chromium in the container cannot
// reach anything, which is why the harness intercepts every upstream host.
import { cp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const SITE = path.join(here, "site"), UP = path.join(here, "up");

// The harness serves a COPY, so it must say how old the copy is. Same reason
// the usage mirror stamps itself: a derived copy that cannot report its own
// age is the bug class that has bitten this project three times.
const STAMP = path.join(SITE, ".staged-at");

const UPSTREAM = {
  "games.csv": "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
  "fp.csv": "https://raw.githubusercontent.com/dynastyprocess/data/master/files/fp_latest_weekly.csv",
  "ids.csv": "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv",
};

const copy = ["index.html", "legacy.html", "app.css", "leagues.json", "js", "v2"];

await rm(SITE, { recursive: true, force: true });
await mkdir(SITE, { recursive: true });
for (const entry of copy) {
  await cp(path.join(repo, entry), path.join(SITE, entry), { recursive: true });
}
await writeFile(STAMP, `${new Date().toISOString()}\n`);
console.log(`site/ staged from ${repo}`);

await mkdir(UP, { recursive: true });
for (const [name, url] of Object.entries(UPSTREAM)) {
  const dest = path.join(UP, name);
  try {
    const existing = await stat(dest);
    if (Date.now() - existing.mtimeMs < 12 * 3600e3) {
      console.log(`up/${name} is fresh, keeping it`);
      continue;
    }
  } catch { /* not there yet */ }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${name}: ${r.status} ${r.statusText} from ${url}`);
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log(`up/${name} fetched`);
}
console.log("\nready. node test/render/v2-render.js");

// PHASE 1 RENDER CHECK for the v2 shell.
//
// Same interception contract as harness.js - Sleeper and FantasyCalc from the
// hostile fixture, the upstream CSVs as real bytes - but pointed at /v2/ and
// aimed at the three things phase 1 actually claims:
//
//   1. THE FETCH SEAM. ./leagues.json and ./data/*.json are document-relative
//      and the page now lives one folder down. If the seam is wrong the page
//      still renders, so this asserts the layers ARRIVED rather than that the
//      page looks fine - that silent-degradation failure is the whole reason
//      the /next/ plan was scrapped.
//   2. THE SHELL IS INERT. A repaint must not remount the chrome or move the
//      scroll, because the kickoff watcher repaints every 30s on a Sunday.
//   3. THE UNMEASURED BAND. 560-900px ran laptop column widths in a space too
//      small for them. 768 and 820 are now measured like everything else.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const F = require("./fixture.js");

const SITE = path.join(__dirname, "site"), UP = path.join(__dirname, "up");
const SHOTS = path.join(__dirname, "shots");
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".json":"application/json" };
const json = (route, body) => route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(body) });
const SIM = Date.UTC(2026, 8, 13, 17, 40, 0); // Sunday 13:40 ET

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(SITE, p);
      fs.readFile(f, (e, b) => e
        ? (rq.writeHead(404), rq.end("no"))
        : (rq.writeHead(200, { "content-type": MIME[path.extname(f)] || "text/plain" }), rq.end(b)));
    }).listen(0, "127.0.0.1", () => res(s));
  });
}

function chromePath() {
  const c = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium/chrome-linux/chrome",
    ...(() => { try { return fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-"))
      .map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`); } catch { return []; } })()]
    .filter(Boolean).filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
  return c[0];
}

// PHASE 5 - THE KNOB SET, PORTED FROM harness.js.
//
// Every scenario family the old harness had and this file did not was blocked
// on a missing PARAMETER, not a missing assertion: `SIM` was a module constant,
// so until now every one of these checks ran on a Sunday at 13:40 and no other
// day, against one usage payload, one vacancy payload and one week. The route
// handlers below are lifted from `harness.js`'s `run()`, which had already paid
// for the lessons recorded in their comments.
//
// EVERY DEFAULT REPRODUCES THE OLD BEHAVIOUR EXACTLY. 187 checks were measured
// against the six-knob version, and a default that shifts by a hair
// re-baselines all of them - which would hide more than any new scenario could
// prove. The one deliberate change is that `vacPayload` is now built ONCE and
// served to both routes, where before each route called `F.vacancyPayload()`
// separately; the generator is deterministic so the bytes are identical, and a
// single object is what stops the mirror and the vacancy layer drifting apart
// about who the disagreeing player is.
async function open({ width, height, hash = "", usageOk = true, vacancyOk = true,
                      scheduleOk = true, sim = SIM, settle = 900,
                      week = null, displayWeek = null, seedLog = null,
                      usage = null, vacancy = null, upstreamUpdatedAt = null,
                      defPts = null, trendingOk = true, noFaab = false,
                      waiverDay = null, fcalcOk = true }) {
  const server = await serve();
  const port = server.address().port;
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: "America/New_York" });
  await ctx.addInitScript(`{
    const REAL = Date.now.bind(Date), T0 = REAL(), SIM = ${sim};
    const OD = Date;
    window.Date = class extends OD { constructor(...a){ super(...(a.length?a:[Date.now()])); } static now(){ return SIM + (REAL()-T0); } };
    Object.setPrototypeOf(window.Date, OD);
    Date.now = () => SIM + (REAL() - T0);
  }`);
  // The decision log, written before any page script runs. Wrapped because
  // this script also runs on about:blank, where localStorage throws.
  //
  // THE PAGE UNDER TEST NEVER WRITES HERE - `LOG_ENABLED = false` in
  // pipeline.js - so seeding it is the only way to reach the graded layout,
  // and a scenario that seeds it is testing a READER of this key, not a
  // writer. See F.recapLog().
  if (seedLog) {
    await ctx.addInitScript(
      `try{localStorage.setItem("ffh.decisions.v1", ${JSON.stringify(JSON.stringify(seedLog))});}catch(e){}`);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const dataHits = [];
  await page.route("**://api.sleeper.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/v1/state/nfl") {
      // DISPLAY_WEEK AND WEEK MUST BE SEPARATELY SETTABLE. Served identical,
      // the one divergence that exists in the real payload - waiver night,
      // when display_week still names the week just finished while week has
      // advanced - is unreachable from here. Measured live 2026-10-06:
      // display_week 4, week 5. pipeline.js:130-134 records what reading the
      // wrong one did to the forward-looking half of the page.
      const wk = week || F.WEEK;
      return json(route, { season: F.SEASON, week: wk, display_week: displayWeek ?? wk });
    }
    if (p === "/v1/players/nfl/trending/add") {
      if (!trendingOk) return route.abort("failed");
      const r = F.riser(); return json(route, r ? [{ player_id: r, count: 8421 }] : []);
    }
    let m = p.match(/^\/v1\/league\/(\d+)$/);
    if (m) {
      const L = F.LEAGUES[m[1]];
      // A LOUD FAILURE, NOT A SPREAD OVER UNDEFINED. leagues.json is staged
      // from the repo and this fixture is hand-written, so the two can
      // disagree about which leagues the page loads - and `{...undefined}` is
      // a legal empty object, so the page then comes up almost right.
      if (!L) {
        throw new Error(
          `render fixture has no league ${m[1]} - leagues.json and fixture.js ` +
          `disagree about which leagues this page loads.`);
      }
      // A league with no FAAB budget at all. The wire renders the figure, so
      // its absence is a branch, not a missing number.
      //
      // THE WAIVER DAY, LIKEWISE. No fixture league carries
      // `waiver_day_of_week`, so claimsLead() was false on every day of the
      // week and the day matrix could only ever prove the Recap nav gate - the
      // one day-dependent ORDER on the site (claims above lineup on the
      // processing day and the day before) was unreachable from here. Phase 5
      // audit, caught by mutation: `claimsLead() -> false` passed all 27 day
      // checks. All three real leagues are set to 2 (Wednesday 03:00 ET).
      let settings = noFaab ? { playoff_week_start: 15 } : L.settings;
      if (waiverDay != null) settings = { ...settings, waiver_day_of_week: waiverDay };
      return json(route, { ...L, settings, league_id: m[1] });
    }
    m = p.match(/^\/v1\/league\/(\d+)\/rosters$/);
    if (m) {
      const S = { "1389373222666932224": F.starters14, "1393723474328981504": F.starters8,
                  "1403519228983754752": F.startersChop };
      return json(route, F.rostersFor(m[1], S[m[1]] || F.starters14));
    }
    if (/^\/projections\/nfl\/player\/(.+)$/.test(p)) return json(route, F.seasonWeeks(p.split("/").pop()));
    if (/^\/projections\/nfl\/\d+\/\d+$/.test(p)) {
      // EVERY DEFENCE IN THE FIXTURE PROJECTS IDENTICALLY, which makes the
      // standing-defence row a permanent dead heat and leaves its interesting
      // states unreachable. `defPts` rewrites sacks for named clubs, and a sack
      // is worth exactly 1 at this fixture's scoring while pts_allow is worth
      // 0, so the number asked for is the number projected.
      if (!defPts) return json(route, F.universe);
      return json(route, F.universe.map((e) => (
        e.player?.position === "DEF" && defPts[e.team] != null
          ? { ...e, stats: { ...e.stats, sack: defPts[e.team] } }
          : e)));
    }
    return json(route, []);
  });
  await page.route("**/leagues.json", (route) => { dataHits.push(route.request().url()); route.continue(); });
  const vacPayload = vacancy || F.vacancyPayload();
  await page.route("**/data/usage_*.json", (route) => {
    dataHits.push(route.request().url());
    if (!usageOk) return route.fulfill({ status: 404, body: "not found" });
    const base = usage || F.usagePayload();
    // The vacancy fixture carries the usage rows its cross-check needs, merged
    // here rather than duplicated, so the two cannot drift apart about who the
    // disagreeing player is.
    const extra = vacPayload.__usage || {};
    return json(route, Object.keys(extra).length ? { ...base, p: { ...base.p, ...extra } } : base);
  });
  await page.route("**/data/vacancy_*.json", (route) => {
    dataHits.push(route.request().url());
    if (!vacancyOk) return route.fulfill({ status: 404, body: "not found" });
    return json(route, vacPayload);
  });
  // api.github.com IS browser-readable cross-origin, which is the whole reason
  // the staleness check can exist when the asset bytes cannot be fetched.
  await page.route("**://api.github.com/**", (route) => json(route, {
    assets: [{ name: `stats_player_week_${F.SEASON}.csv`,
               updated_at: upstreamUpdatedAt || "2026-09-15T09:00:00Z" }] }));
  await page.route("**://api.fantasycalc.com/**", (route) => {
    // The deliberate failure path the README says to keep. Phase 5 recorded it
    // as a non-port; the audit disagreed - it is one launch, and it is the
    // only proof that Compare hides the value rows rather than guessing them.
    if (!fcalcOk) return route.abort("failed");
    const q = new URL(route.request().url()).searchParams;
    return json(route, F.fcalc(Number(q.get("numQbs")) || 1));
  });
  await page.route("**://raw.githubusercontent.com/**", (route) => {
    const u = route.request().url();
    if (!scheduleOk && u.includes("games.csv")) return route.abort("failed");
    const file = u.includes("games.csv") ? "games.csv" : u.includes("fp_latest_weekly") ? "fp.csv"
               : u.includes("db_playerids") ? "ids.csv" : null;
    if (!file) return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "text/csv", body: fs.readFileSync(path.join(UP, file)) });
  });

  await page.goto(`http://127.0.0.1:${port}/v2/${hash}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(settle);
  return { page, browser, server, errors, dataHits };
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  // ---- 1. the seam -------------------------------------------------------
  console.log("\nTHE FETCH SEAM (page at /v2/, data at the root)");
  {
    const { page, browser, server, errors, dataHits } = await open({ width: 1280, height: 900 });
    ok("no page errors", errors.length === 0, errors.join("\n       "));
    const roots = dataHits.map((u) => new URL(u).pathname);
    ok("leagues.json resolved to the ROOT, not /v2/",
      roots.includes("/leagues.json"), `requested: ${roots.join(", ")}`);
    ok("usage mirror resolved to the root",
      roots.some((p) => /^\/data\/usage_\d+\.json$/.test(p)), `requested: ${roots.join(", ")}`);
    ok("vacancy layer resolved to the root",
      roots.some((p) => /^\/data\/vacancy_\d+\.json$/.test(p)), `requested: ${roots.join(", ")}`);
    ok("nothing was requested from inside /v2/",
      !roots.some((p) => p.startsWith("/v2/")), `requested: ${roots.join(", ")}`);

    // The silent-degradation guard: assert the layers are PRESENT in state,
    // not merely that the page painted.
    const layers = await page.evaluate(() => {
      const s = window.__ffh_state;
      return s ? { usage: !!s.usage?.ok, vacancy: Array.isArray(s.vacancy?.absent), week: s.week,
                   leagues: Object.keys(s.leagues || {}).length } : null;
    });
    ok("the page exposes state for inspection", !!layers, "window.__ffh_state missing");
    if (layers) {
      ok("usage layer ARRIVED (not silently degraded)", layers.usage === true);
      ok("vacancy layer ARRIVED", layers.vacancy === true);
      ok("all three leagues loaded", layers.leagues === 3, `got ${layers.leagues}`);
    }
    await page.screenshot({ path: path.join(SHOTS, "v2-desktop-1280.png"), fullPage: true });
    await browser.close(); server.close();
  }

  // ---- 2. the shell is inert on repaint ----------------------------------
  console.log("\nTHE SHELL IS INERT ACROSS A REPAINT");
  {
    const { page, browser, server } = await open({ width: 1280, height: 900, hash: "#/joop/lineup" });
    await page.evaluate(() => {
      window.__shellNode = document.querySelector(".topbar");
      window.__railNode = document.querySelector(".rail");
      window.scrollTo(0, 240);
    });
    await page.evaluate(() => window.__ffh_repaint());
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({
      sameTopbar: window.__shellNode === document.querySelector(".topbar"),
      sameRail: window.__railNode === document.querySelector(".rail"),
      scroll: window.scrollY,
    }));
    ok("the top bar node survived the repaint", r.sameTopbar);
    ok("the nav rail node survived the repaint", r.sameRail);
    ok("the scroll position did not jump", r.scroll === 240, `scrollY=${r.scroll}`);
    await browser.close(); server.close();
  }

  // ---- 3. routing --------------------------------------------------------
  console.log("\nROUTING");
  {
    const { page, browser, server } = await open({ width: 1280, height: 900, hash: "#/bku/lineup" });
    const first = await page.evaluate(() => ({
      title: document.querySelector("[data-title]").textContent,
      active: [...document.querySelectorAll("[data-league]")].find((b) => b.getAttribute("aria-current") === "true")?.dataset.league,
      rows: document.querySelectorAll("[data-content] tbody tr").length,
    }));
    ok("a deep link opens the right page", first.title === "Lineup", `got "${first.title}"`);
    ok("...for the right league", first.active === "bku", `got "${first.active}"`);
    ok("...with real roster rows, so the seam fed it", first.rows > 5, `${first.rows} rows`);

    await page.evaluate(() => { window.location.hash = "#/joop/wire"; });
    await page.waitForTimeout(300);
    const second = await page.evaluate(() => ({
      title: document.querySelector("[data-title]").textContent,
      active: [...document.querySelectorAll("[data-league]")].find((b) => b.getAttribute("aria-current") === "true")?.dataset.league,
    }));
    ok("navigating changes the page", second.title === "Wire", `got "${second.title}"`);
    ok("...and the league", second.active === "joop", `got "${second.active}"`);

    await page.evaluate(() => { window.location.hash = "#/nonsense"; });
    await page.waitForTimeout(300);
    const redirected = await page.evaluate(() => window.location.hash);
    ok("a bad route redirects instead of blanking", redirected === "#/today", `got "${redirected}"`);

    // The soft gate: Sunday, so Recap is out of the nav but still reachable.
    await page.evaluate(() => { window.location.hash = "#/joop/recap"; });
    await page.waitForTimeout(300);
    const recap = await page.evaluate(() => ({
      title: document.querySelector("[data-title]").textContent,
      hiddenInNav: [...document.querySelectorAll(".railbtn")]
        .filter((b) => b.dataset.nav === "recap").every((b) => b.hasAttribute("hidden")),
    }));
    ok("SOFT GATE: Recap is reachable by URL on a Sunday", recap.title === "Recap", `got "${recap.title}"`);
    ok("...and is not hidden while you are standing on it", recap.hiddenInNav === false);
    await browser.close(); server.close();
  }

  // ---- 4. the status strip tells the truth -------------------------------
  console.log("\nTHE STATUS STRIP");
  {
    const { page, browser, server } = await open({ width: 1280, height: 900, scheduleOk: false });
    const s = await page.evaluate(() => {
      const d = document.querySelector(".status");
      return { bad: d?.classList.contains("has-bad"), open: d?.hasAttribute("open"),
               text: d?.textContent || "" };
    });
    ok("no schedule reads as bad, not a warning", s.bad === true);
    ok("...and opens itself rather than hiding under a disclosure", s.open === true);
    ok("...and says locking is off in those words", /locking is OFF/i.test(s.text));
    await page.screenshot({ path: path.join(SHOTS, "v2-status-degraded.png"), fullPage: false });
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({ width: 1280, height: 900, usageOk: false });
    const t = await page.evaluate(() => document.querySelector(".status")?.textContent || "");
    ok("a missing usage mirror is SURFACED, never silent", /No usage layer this load/.test(t));
    await browser.close(); server.close();
  }

  // ---- 5. widths, including the band nobody measured ---------------------
  console.log("\nCOLUMN WIDTHS (320-1280, including the unmeasured 560-900 band)");
  for (const w of [320, 360, 390, 560, 768, 820, 1024, 1280, 1440]) {
    const { page, browser, server, errors } = await open({ width: w, height: 900, hash: "#/joop/lineup" });
    const m = await page.evaluate(() => {
      const cell = document.querySelector("[data-content] tbody tr .nm");
      const doc = document.documentElement;
      if (!cell) return null;
      // Count real line boxes over the NAME text node. A height threshold is
      // not a wrap test: the cell also holds a position label, and row padding
      // is a design choice that would make every row look wrapped.
      //
      // THE NAME IS INSIDE THE ROW BUTTON, and has been since phase 3 made
      // every row open in place. This probe used to look for a text node that
      // was a direct child of the cell, found none on any row, and fell back
      // to "1 line" - so the wrap half of this check passed at every width
      // from phase 3 until the phase 5 audit, whatever the names did. Found by
      // mutation (word-break:break-all on .rowtog, names shredded, all green).
      // `found` is asserted below so a future DOM change fails loudly instead.
      const nameText = (c) => [...(c.querySelector(":scope > .rowtog") || c).childNodes]
        .find((n) => n.nodeType === 3 && n.textContent.trim());
      const textNode = nameText(cell);
      let lines = 1;
      if (textNode) {
        const r = document.createRange(); r.selectNodeContents(textNode);
        lines = r.getClientRects().length || 1;
      }
      // And the worst case on the page, not just the first row.
      let worst = 1, worstName = "", found = 0;
      for (const c of document.querySelectorAll("[data-content] tbody tr .nm")) {
        const tn = nameText(c);
        if (!tn) continue;
        found += 1;
        const rr = document.createRange(); rr.selectNodeContents(tn);
        const n = rr.getClientRects().length || 1;
        if (n > worst) { worst = n; worstName = tn.textContent.trim(); }
      }
      return {
        name: Math.round(cell.getBoundingClientRect().width),
        overflow: doc.scrollWidth - doc.clientWidth,
        lines, worst, worstName, found, cells: document.querySelectorAll("[data-content] tbody tr .nm").length,
      };
    });
    if (!m) { fail++; console.log(`  FAIL ${w}px: no lineup row rendered`); }
    else if (m.found === 0 || m.found < m.cells / 2) {
      fail++; console.log(`  FAIL ${w}px  the wrap probe found the name in only ${m.found} of ${m.cells} cells - it is measuring nothing`);
    }
    else {
      // The defect class this guards is the name column collapsing until a
      // long name shreds across many lines (6-10 at 59px, Phase 3a and again
      // in Phase A). Two lines at a word boundary on a 320px phone is not
      // that; four lines, or any wrap once there is room, is.
      const lineCap = w <= 360 ? 2 : 1;
      const good = m.name >= 110 && m.overflow <= 0 && m.worst <= lineCap;
      if (good) { pass++; console.log(`  ok   ${w}px  name=${m.name}px  no h-scroll  worst name ${m.worst} line(s), cap ${lineCap}`); }
      else { fail++; console.log(`  FAIL ${w}px  name=${m.name}px  h-overflow=${m.overflow}px  worst=${m.worst} lines, cap ${lineCap} ("${m.worstName}")`); }
    }
    ok(`${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
    if ([390, 768, 1280].includes(w)) {
      await page.screenshot({ path: path.join(SHOTS, `v2-${w}.png`), fullPage: true });
    }
    await browser.close(); server.close();
  }

  // ---- 6. the audit fixes ------------------------------------------------
  console.log("\nAUDIT FIXES");
  {
    const { page, browser, server } = await open({ width: 1280, height: 900, hash: "#/joop/lineup" });
    const cells = await page.evaluate(() => {
      // PER TABLE. The page has two, so counting thead cells across the whole
      // content region double-counts and compares 6 against 12.
      const bad = [];
      for (const tbl of document.querySelectorAll("[data-content] table")) {
        const head = tbl.querySelectorAll("thead td").length;
        for (const r of tbl.querySelectorAll("tbody tr")) {
          const span = [...r.children].reduce((n, c) => n + (c.colSpan || 1), 0);
          if (span !== head) bad.push(`${r.textContent.trim().slice(0, 24)}: ${span} vs ${head}`);
        }
      }
      return { bad };
    });
    ok("every row spans the same number of columns as its own table head",
      cells.bad.length === 0, cells.bad.join("; "));

    const inj = await page.evaluate(() =>
      [...document.querySelectorAll("[data-content] .pt .chip")].map((c) => c.textContent));
    ok("injury designations render on the lineup page", inj.length > 0, "no injury chips found");

    const nav = await page.evaluate(() => {
      const a = [...document.querySelectorAll(".railbtn")];
      return { allAnchors: a.every((n) => n.tagName === "A" && n.getAttribute("href")),
               hrefs: a.map((n) => n.getAttribute("href")) };
    });
    ok("navigation is real links, not click handlers", nav.allAnchors, JSON.stringify(nav.hrefs));
    ok("league-scoped links carry the league you are looking at",
      nav.hrefs.includes("#/joop/wire"), JSON.stringify(nav.hrefs));

    // the status disclosure must survive a repaint
    await page.evaluate(() => { document.querySelector(".status").open = true; });
    await page.evaluate(() => window.__ffh_repaint());
    await page.waitForTimeout(150);
    const stillOpen = await page.evaluate(() => document.querySelector(".status").open);
    ok("an opened status panel survives the 30-second repaint", stillOpen === true);
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({ width: 390, height: 844, hash: "#/joop/lineup" });
    const marks = await page.evaluate(() => {
      const vis = (el) => el && getComputedStyle(el).display !== "none";
      return {
        oppHidden: !vis(document.querySelector("[data-content] .opp")),
        kick: [...document.querySelectorAll("[data-content] .nmark.kick")].filter(vis).length,
        lock: [...document.querySelectorAll("[data-content] .nmark.lock")].filter(vis).length,
      };
    });
    ok("phone: the Opp column is folded", marks.oppHidden);
    ok("phone: kickoff times survive the fold, inline with the name", marks.kick > 0,
      `${marks.kick} inline kickoff marks`);
    ok("phone: lock markers survive the fold", marks.lock > 0, `${marks.lock} inline locks`);
    await page.screenshot({ path: path.join(SHOTS, "v2-phone-final.png"), fullPage: true });
    await browser.close(); server.close();
  }

  // ---- 7. Today ----------------------------------------------------------
  console.log("\nTODAY");
  {
    const { page, browser, server, errors } = await open({ width: 1280, height: 1000, hash: "#/today" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));
    const t = await page.evaluate(() => {
      const classes = [...document.querySelectorAll(".clsx")].map((sec) => ({
        label: sec.querySelector(".clsh").firstChild.textContent.trim().replace(/\s+$/, ""),
        count: Number(sec.querySelector(".clsh .ct").textContent),
        leagues: [...sec.querySelectorAll(".lgcard")].map((c) => ({
          name: c.querySelector(".lglink").textContent.trim(),
          rows: c.querySelectorAll(".tline").length,
          hrefs: [...c.querySelectorAll(".tline")].map((a) => a.getAttribute("href")),
        })),
      }));
      const sw = document.querySelector("[data-leagues]");
      const folds = [...document.querySelectorAll(".clsx")];
      const folded = {
        watch: folds.some((f) => f.tagName === "DETAILS" && !f.open
          && /worth knowing/i.test(f.querySelector(".clsh").textContent)),
        actionableOpen: folds.filter((f) => !/worth knowing/i.test(f.querySelector(".clsh").textContent))
          .every((f) => f.tagName === "SECTION"),
      };
      return { classes, folded, body: document.querySelector("[data-content]").textContent,
               // COMPUTED STYLE, not .hidden. The `hidden` attribute is only
               // display:none from the UA sheet and any display rule beats it:
               // the first version of this check asserted the property, passed,
               // and the switcher was on screen the whole time.
               leagueSwitcherHidden: getComputedStyle(sw).display === "none",
               switcherProp: sw.hidden,
               switcherBox: sw.getBoundingClientRect().height };
    });
    ok("Today renders urgency classes", t.classes.length > 0, JSON.stringify(t.classes).slice(0, 200));
    ok("the league switcher is ACTUALLY hidden on a cross-league page (not just .hidden)",
      t.leagueSwitcherHidden === true && t.switcherBox === 0,
      `computed-hidden=${t.leagueSwitcherHidden} prop=${t.switcherProp} height=${t.switcherBox}px`);
    ok("no class is an unreadable wall - watch is capped per league",
      t.classes.every((c) => c.leagues.every((l) => l.rows <= 6)),
      JSON.stringify(t.classes.map((c) => [c.label, c.leagues.map((l) => l.rows)])));
    // NOT a ratio assertion. How much there is to watch versus to do is a
    // property of the week, not of the code - a quiet week with plenty worth
    // knowing is a legitimate state. What IS assertable: the advisory class
    // is folded and the actionable ones are not.
    ok("the advisory class is folded, the actionable ones are open",
      t.folded.watch === true && t.folded.actionableOpen === true,
      JSON.stringify(t.folded));
    ok("every row links into the league that owns it",
      t.classes.every((c) => c.leagues.every((l) => l.hrefs.every((h) => /^#\/[a-z]+\//.test(h)))),
      JSON.stringify(t.classes[0]?.leagues?.[0]?.hrefs));
    ok("NO CROSS-LEAGUE TOTAL anywhere on the page",
      !/\b(total|combined|across all)\b/i.test(t.body), "the page claims a total");
    console.log("      classes: " + t.classes.map((c) => `${c.label} (${c.count})`).join(" | "));
    await page.screenshot({ path: path.join(SHOTS, "v2-today-desktop.png"), fullPage: true });
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({ width: 390, height: 844, hash: "#/today" });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const rows = [...document.querySelectorAll(".tline")];
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        rows: rows.length,
        shortestTap: Math.min(...rows.map((r) => Math.round(r.getBoundingClientRect().height))),
        tagsOnOneLine: rows.every((r) => {
          const tg = r.querySelector(".tag");
          return !tg || tg.getBoundingClientRect().height < 30;
        }),
      };
    });
    ok("phone: no horizontal scroll on Today", m.overflow <= 0, `${m.overflow}px`);
    ok("phone: every row is a thumb-sized tap target", m.shortestTap >= 40, `${m.shortestTap}px`);
    ok("phone: the number chip never wraps", m.tagsOnOneLine);
    await page.screenshot({ path: path.join(SHOTS, "v2-today-phone.png"), fullPage: true });
    await browser.close(); server.close();
  }

  // ---- 8. the phase-2 audit fixes ----------------------------------------
  console.log("\nPHASE 2 AUDIT FIXES");
  {
    const { page, browser, server } = await open({ width: 1280, height: 1000, hash: "#/today" });
    // The fold must survive the repaint storm: paint() fires on consensus,
    // three fcalc attachments, trending and the freshness check.
    await page.evaluate(() => {
      document.querySelector('details[data-fold="watch"]').open = true;
    });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__ffh_repaint());
      await page.waitForTimeout(80);
    }
    const stillOpen = await page.evaluate(() =>
      document.querySelector('details[data-fold="watch"]').open);
    ok("an opened fold survives repeated repaints", stillOpen === true);

    const dests = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll(".lgcard")) {
        const more = card.querySelector(".tline.more");
        if (!more) continue;
        out.push({ more: more.getAttribute("href"),
                   rows: [...card.querySelectorAll(".tline:not(.more)")].map((a) => a.getAttribute("href")) });
      }
      return out;
    });
    ok("'N more' never points somewhere no hidden row lives",
      dests.every((d) => /^#\/[a-z]+\/(wire|lineup)$/.test(d.more)), JSON.stringify(dests).slice(0, 220));

    const focus = await page.evaluate(() => {
      const a = document.querySelector(".tline");
      a.focus();
      const st = getComputedStyle(a, ":focus-visible");
      return { focused: document.activeElement === a, outline: st.outlineWidth };
    });
    ok("rows are keyboard focusable", focus.focused === true);

    const dupes = await page.evaluate(() => {
      const name = (el) => (el.querySelector("b")?.textContent || "").trim();
      const act = new Set();
      for (const sec of document.querySelectorAll("section.clsx"))
        for (const r of sec.querySelectorAll(".tline")) act.add(name(r));
      const watch = [];
      for (const d of document.querySelectorAll("details.clsx"))
        for (const r of d.querySelectorAll(".tline:not(.more)")) watch.push(name(r));
      return watch.filter((n) => n && act.has(n));
    });
    ok("nobody is told to sit above a heading that says nothing to do",
      dupes.length === 0, `duplicated: ${dupes.join(", ")}`);

    const leaked = await page.evaluate(() =>
      /\bundefined\b|\bNaN\b|\[object Object\]/.test(document.querySelector("[data-content]").textContent));
    ok("no placeholder leaked into the copy", leaked === false);
    await page.screenshot({ path: path.join(SHOTS, "v2-today-desktop.png"), fullPage: true });
    await browser.close(); server.close();
  }

  // ---- 9. the Lineup page ------------------------------------------------
  console.log("\nLINEUP");
  {
    const { page, browser, server, errors } = await open({ width: 1280, height: 1100, hash: "#/joop/lineup" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));

    const shape = await page.evaluate(() => {
      const bad = [];
      for (const tbl of document.querySelectorAll("[data-content] table")) {
        const head = tbl.querySelectorAll("thead td").length;
        for (const r of tbl.querySelectorAll("tbody tr")) {
          const span = [...r.children].reduce((n, c) => n + (c.colSpan || 1), 0);
          if (span !== head) bad.push(`${r.className}: ${span} vs ${head}`);
        }
      }
      return {
        bad,
        calls: !!document.querySelector(".card.act, .card.quiet .ok"),
        discs: document.querySelectorAll(".disc .dischd").length,
        rows: document.querySelectorAll(".prow:not(.empty)").length,
        dets: document.querySelectorAll(".pdet").length,
        hiddenDets: [...document.querySelectorAll(".pdet")].every((d) => d.hidden),
      };
    });
    ok("EVERY row spans its own table's head, detail rows included",
      shape.bad.length === 0, shape.bad.join("; "));
    ok("the calls block is on the page", shape.calls === true);
    ok("every player row has a detail row", shape.dets === shape.rows,
      `${shape.rows} rows, ${shape.dets} details`);
    ok("details start closed", shape.hiddenDets === true);

    // Open a roster row and read what came out.
    const opened = await page.evaluate(() => {
      const row = document.querySelector(".prow:not(.empty)");
      row.querySelector(".rowtog").click();
      const det = document.querySelector(".pdet");
      return {
        expanded: row.querySelector(".rowtog").getAttribute("aria-expanded"),
        visible: !det.hidden,
        keys: [...det.querySelectorAll("dt")].map((d) => d.textContent),
        leaked: /\bundefined\b|\bNaN\b|\[object Object\]/.test(det.textContent),
      };
    });
    ok("a roster row opens", opened.visible === true && opened.expanded === "true");
    ok("...and carries the folded columns, not a repeat of the row",
      ["Team", "Opponent", "Kickoff", "Projection"].every((k) => opened.keys.includes(k)),
      opened.keys.join(", "));
    ok("...with no placeholder leaked", opened.leaked === false);

    // It must survive the kickoff repaint, like everything else.
    await page.evaluate(() => window.__ffh_repaint());
    await page.waitForTimeout(150);
    const survived = await page.evaluate(() => {
      const det = document.querySelector(".pdet");
      return { visible: !det.hidden,
               expanded: document.querySelector(".rowtog").getAttribute("aria-expanded") };
    });
    ok("an opened row survives a re-solve at one o'clock",
      survived.visible === true && survived.expanded === "true", JSON.stringify(survived));

    // A call disclosure too.
    const call = await page.evaluate(() => {
      const b = document.querySelector(".disc .dischd");
      if (!b) return { none: true };
      b.click();
      const body = document.querySelector(`#${CSS.escape(b.getAttribute("aria-controls"))}`);
      return { open: !body.hidden, text: body.textContent.trim().slice(0, 80),
               leaked: /\bundefined\b|\bNaN\b/.test(body.textContent) };
    });
    ok("a call opens its reasoning", call.none || call.open === true);
    ok("...with no placeholder leaked", call.none || call.leaked === false, call.text);

    // Captured BEFORE the link test, which navigates on purpose.
    await page.screenshot({ path: path.join(SHOTS, "v2-lineup-desktop.png"), fullPage: true });

    // A link inside a row must stay a link, not get eaten by the row toggle.
    const linkSafe = await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#/joop/wire"; a.textContent = "x";
      const row = document.querySelectorAll(".prow:not(.empty)")[1];
      row.querySelector(".nm").appendChild(a);
      const before = row.querySelector(".rowtog").getAttribute("aria-expanded");
      a.click();
      return { sameToggle: before === row.querySelector(".rowtog").getAttribute("aria-expanded"),
               navigated: location.hash === "#/joop/wire" };
    });
    ok("a link inside a row is a link, not a toggle",
      linkSafe.sameToggle === true && linkSafe.navigated === true, JSON.stringify(linkSafe));

    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({ width: 390, height: 844, hash: "#/joop/lineup" });
    await page.evaluate(() => document.querySelector(".prow:not(.empty) .rowtog").click());
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const det = document.querySelector(".pdet");
      return { overflow: doc.scrollWidth - doc.clientWidth,
               detVisible: !det.hidden,
               detWidth: Math.round(det.getBoundingClientRect().width),
               // THE ROW is the tap target - the padding lives on the td, so
               // measuring the bare button under-reports it.
               tap: Math.round(document.querySelector(".prow:not(.empty)").getBoundingClientRect().height) };
    });
    ok("phone: no horizontal scroll with a row open", m.overflow <= 0, `${m.overflow}px`);
    ok("phone: the detail panel spans the table", m.detVisible && m.detWidth > 300, JSON.stringify(m));
    ok("phone: a roster row is a thumb-sized tap target", m.tap >= 40, `${m.tap}px`);
    await page.screenshot({ path: path.join(SHOTS, "v2-lineup-phone.png"), fullPage: true });
    await browser.close(); server.close();
  }

  // ---- 10. the Wire page -------------------------------------------------
  console.log("\nWIRE");
  {
    const { page, browser, server, errors } = await open({ width: 1280, height: 1200, hash: "#/joop/wire" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));
    const w = await page.evaluate(() => {
      const discs = [...document.querySelectorAll(".disc .dischd")];
      return {
        cards: [...document.querySelectorAll("[data-content] .card > h2")].map((h) => h.textContent.trim().split("\n")[0]),
        discs: discs.length,
        heads: discs.map((d) => d.querySelector(".dl").textContent.replace(/\s+/g, " ").trim()),
        subheads: [...document.querySelectorAll(".subhd")].map((h) => h.textContent.trim()),
        body: document.querySelector("[data-content]").textContent,
      };
    });
    ok("the wire has rows", w.discs > 0, JSON.stringify(w.cards));
    ok("THE BID REFUSAL SURVIVED", /No bid figure here, deliberately/.test(w.body));
    ok("the defence row says projection gap, not matchup read",
      !/\bStream\b/.test(w.body) || /projection gap, not a matchup read/.test(w.body)
      || /Nothing between them|better bet|already played|not priced|is locked|Marginal/.test(w.body));
    ok("no placeholder leaked anywhere on the wire",
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(w.body), w.body.slice(0, 200));

    // Every disclosure must open and say something.
    const opened = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll(".disc .dischd")) {
        b.click();
        const body = document.querySelector(`#${CSS.escape(b.getAttribute("aria-controls"))}`);
        out.push({ id: b.getAttribute("aria-controls"), open: body && !body.hidden,
                   len: body ? body.textContent.trim().length : 0 });
      }
      return out;
    });
    ok("every wire row opens", opened.every((o) => o.open), JSON.stringify(opened.filter((o) => !o.open)));
    ok("...and none opens to an empty panel",
      opened.every((o) => o.len > 40), JSON.stringify(opened.filter((o) => o.len <= 40)));
    ok("EMPHASIS STAYS SCARCE: at most one action card on any page",
      (await page.evaluate(() => document.querySelectorAll("[data-content] .card.act").length)) <= 1,
      "more than one card is claiming to be the answer");
    ok("every disclosure id is unique",
      new Set(opened.map((o) => o.id)).size === opened.length,
      JSON.stringify(opened.map((o) => o.id)));

    await page.screenshot({ path: path.join(SHOTS, "v2-wire-desktop.png"), fullPage: true });
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({ width: 390, height: 844, hash: "#/joop/wire" });
    await page.evaluate(() => document.querySelector(".disc .dischd")?.click());
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tap: Math.round(document.querySelector(".dischd").getBoundingClientRect().height),
    }));
    ok("phone: no horizontal scroll on the wire", m.overflow <= 0, `${m.overflow}px`);
    ok("phone: wire rows are thumb-sized", m.tap >= 40, `${m.tap}px`);
    await page.screenshot({ path: path.join(SHOTS, "v2-wire-phone.png"), fullPage: true });
    await browser.close(); server.close();
  }
  // A league with nothing on the wire must say so, not render a blank card.
  {
    const { page, browser, server } = await open({ width: 900, height: 700, hash: "#/joop/wire", vacancyOk: false });
    const t2 = await page.evaluate(() => document.querySelector("[data-content]").textContent);
    ok("a vacancy outage removes the block rather than breaking the page",
      !/Just came free/.test(t2) && t2.length > 40);
    await browser.close(); server.close();
  }

  // ---- 11. the phase-3 audit fixes ---------------------------------------
  console.log("\nPHASE 3 AUDIT FIXES");
  {
    const { page, browser, server } = await open({ width: 1100, height: 900, hash: "#/joop/wire" });
    const before = await page.evaluate(() => {
      const b = document.querySelector(".disc .dischd");
      b.click();
      return { id: b.getAttribute("aria-controls"), open: b.getAttribute("aria-expanded") };
    });
    await page.evaluate(() => { window.location.hash = "#/bku/wire"; });
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => {
      const b = document.querySelector(".disc .dischd");
      return b ? { id: b.getAttribute("aria-controls"), open: b.getAttribute("aria-expanded") } : null;
    });
    ok("OPEN STATE DOES NOT FOLLOW YOU INTO ANOTHER LEAGUE",
      !after || after.open !== "true",
      `opened ${before.id} in joop, ${after && after.id} came up open in bku`);

    // ...but it still survives a re-solve on the same page.
    await page.evaluate(() => document.querySelector(".disc .dischd").click());
    await page.evaluate(() => window.__ffh_repaint());
    await page.waitForTimeout(200);
    const same = await page.evaluate(() =>
      document.querySelector(".disc .dischd").getAttribute("aria-expanded"));
    ok("...and still survives a re-solve on the page you are on", same === "true");
    await browser.close(); server.close();
  }
  {
    // The unpriced-starter row: the copy defect that put a false sentence on
    // the page. The fixture carries a roster id the feed never priced.
    const { page, browser, server } = await open({ width: 1100, height: 900, hash: "#/joop/lineup" });
    const t3 = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll(".prow:not(.empty) .rowtog")) b.click();
      for (const d of document.querySelectorAll(".pdet")) out.push(d.textContent.replace(/\s+/g, " "));
      return { panels: out, body: document.querySelector("[data-content]").textContent.replace(/\s+/g, " ") };
    });
    ok("no panel says a ruled-out player is active",
      !t3.panels.some((p) => /will not play/.test(p) && /\bactive\b/.test(p)),
      t3.panels.find((p) => /will not play/.test(p) && /\bactive\b/.test(p)));
    ok("nothing on the page asserts a projection the feed never published",
      !/publishes a projection for him \( ?\u2014 ?\)/.test(t3.body) && !/is listed \./.test(t3.body));
    ok("no placeholder in any open detail panel",
      !t3.panels.some((p) => /\bundefined\b|\bNaN\b|\[object Object\]/.test(p)));
    await browser.close(); server.close();
  }

  // =========================================================================
  // PHASE 4 — Compare, Recap, Methods
  //
  // The control lives on the LINEUP page and the table lives on Compare, so
  // most of what is worth checking here is the hop between them. Two of these
  // guard things node cannot see at all: that tapping the balance does not
  // also open the row's detail panel (the controls and the row share a
  // delegated listener, and the row claimed the event first in the version
  // before this one), and that a comparison table scrolls inside its own box
  // rather than scrolling the document.
  // =========================================================================
  console.log("\nPHASE 4 — THE COMPARE CONTROL");
  {
    const { page, browser, server, errors } = await open({ width: 1100, height: 900, hash: "#/joop/lineup" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));

    const seed = await page.evaluate(() => ({
      btns: document.querySelectorAll(".prow [data-cmp]").length,
      rows: document.querySelectorAll(".prow:not(.empty)").length,
      chip: !!document.querySelector(".selchip"),
    }));
    ok("every real roster row carries the control", seed.btns === seed.rows,
      `${seed.btns} controls for ${seed.rows} rows`);
    ok("no chip while nothing is picked", seed.chip === false);

    // THE ORDERING BUG. The control sits inside .prow, whose own handler opens
    // the detail panel on a click anywhere in the row.
    const one = await page.evaluate(() => {
      const b = document.querySelector(".prow [data-cmp]");
      const row = b.closest(".prow");
      const panelId = row.querySelector(".rowtog").getAttribute("aria-controls");
      b.click();
      const fresh = document.querySelector(`[data-cmp="${b.dataset.cmp}"]`);
      return {
        pressed: fresh && fresh.getAttribute("aria-pressed"),
        on: fresh && fresh.classList.contains("on"),
        panelOpen: !document.getElementById(panelId).hidden,
        chip: document.querySelector(".selchip")?.textContent.replace(/\s+/g, " ").trim(),
      };
    });
    ok("the control marks itself pressed", one.pressed === "true" && one.on === true,
      `pressed=${one.pressed} on=${one.on}`);
    ok("TAPPING IT DOES NOT ALSO OPEN THE ROW", one.panelOpen === false,
      "the row's disclosure claimed the event before the selection did");
    ok("the header chip appears, and counts one", /1 picked/.test(one.chip || ""), one.chip);
    ok("...and says a single pick is not a comparison yet",
      /pick one more/.test(one.chip || ""), one.chip);

    const two = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".prow [data-cmp]")][1];
      b.click();
      return document.querySelector(".selchip")?.textContent.replace(/\s+/g, " ").trim();
    });
    ok("a second pick counts two, and drops the prompt",
      /2 picked/.test(two || "") && !/pick one more/.test(two || ""), two);

    // The selection lives in state, so a kickoff re-solve must not drop it.
    const survived = await page.evaluate(() => {
      window.__ffh_repaint();
      return {
        chip: document.querySelector(".selchip")?.textContent.replace(/\s+/g, " ").trim(),
        pressed: document.querySelectorAll('.prow [data-cmp][aria-pressed="true"]').length,
      };
    });
    ok("A SELECTION SURVIVES A RE-SOLVE", /2 picked/.test(survived.chip || ""), survived.chip);
    ok("...and the rows still show which two", survived.pressed === 2, `${survived.pressed} pressed`);

    // The chip's clear button lives in the chrome, outside [data-content].
    const cleared = await page.evaluate(() => {
      document.querySelector(".selclr").click();
      return {
        chip: !!document.querySelector(".selchip"),
        hidden: document.querySelector("[data-sel]").hidden,
        pressed: document.querySelectorAll('.prow [data-cmp][aria-pressed="true"]').length,
      };
    });
    ok("THE CHIP'S OWN CLEAR BUTTON WORKS, outside the content region",
      cleared.chip === false && cleared.hidden === true && cleared.pressed === 0,
      JSON.stringify(cleared));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 4 — THE COMPARISON");
  {
    const { page, browser, server, errors } = await open({ width: 1100, height: 900, hash: "#/joop/lineup" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));

    // Pick two, then follow the chip's own link rather than typing the URL -
    // that link is the only way most readers will reach this page.
    // ONE CLICK PER EVALUATE, RE-QUERYING EACH TIME.
    //
    // Every toggle repaints [data-content] wholesale (pipeline.js paint()), so
    // a node captured before the first click is detached by the second and its
    // click never reaches the delegated listener. Written the other way first,
    // and it looked exactly like a broken Compare page: the chip counted one,
    // the route rendered the single-pick panel, and the table was simply
    // absent. A real reader cannot hit it - the page they tap is the page in
    // front of them - but a test that batches clicks can.
    const names = [];
    for (const i of [0, 1]) {
      const picked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.prow:not(.dead) [data-cmp]:not([aria-pressed="true"])')][0];
        if (!b) return null;
        const name = b.closest(".prow").querySelector(".rowtog").textContent.trim();
        b.click();
        return name;
      });
      if (picked) names.push(picked);
      await page.waitForTimeout(120);
    }
    ok("two different players were picked", names.length === 2 && names[0] !== names[1],
      JSON.stringify(names));
    await page.evaluate(() => document.querySelector(".selchip").click());
    await page.waitForTimeout(300);

    const cmp = await page.evaluate(() => {
      const c = document.querySelector("[data-content]");
      const tbl = c.querySelector("table.cmpt");
      return {
        title: document.querySelector("[data-title]")?.textContent,
        hasTable: !!tbl,
        heads: [...c.querySelectorAll(".cmpt .cp .cn")].map((n) => n.textContent.trim()),
        mrows: c.querySelectorAll(".cmpt .mrow").length,
        notesClosed: [...c.querySelectorAll(".cmpt .mnote")].every((n) => n.hidden),
        verdict: c.querySelector(".verdict")?.textContent.replace(/\s+/g, " ").trim(),
        clear: !!c.querySelector("[data-clear]"),
        body: c.textContent.replace(/\s+/g, " "),
      };
    });
    ok("the chip's link lands on Compare", cmp.title === "Compare", `got "${cmp.title}"`);
    ok("...with a real comparison table", cmp.hasTable === true);
    ok("...headed by the two players actually picked",
      names.every((n) => cmp.heads.some((h) => n.includes(h) || h.includes(n))),
      `picked ${JSON.stringify(names)}, table shows ${JSON.stringify(cmp.heads)}`);
    ok("...with at least two metric rows", cmp.mrows >= 2, `${cmp.mrows} rows`);
    ok("metric notes start closed", cmp.notesClosed === true);
    ok("a verdict is stated", !!cmp.verdict, cmp.verdict);
    ok("the clear button is on the page", cmp.clear === true);
    ok("no placeholder leaked into the comparison",
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(cmp.body),
      cmp.body.slice(0, 160));

    const opened = await page.evaluate(() => {
      const b = document.querySelector(".cmpt .mrow .rowtog");
      if (!b) return { open: false, text: 0, missing: true };
      const id = b.getAttribute("aria-controls");
      b.click();
      const panel = document.getElementById(id);
      if (!panel) return { open: false, text: 0, missing: true };
      return { open: !panel.hidden, text: panel.textContent.replace(/\s+/g, " ").trim().length };
    });
    ok("A METRIC ROW OPENS WHAT THAT NUMBER MEANS", opened.open === true);
    ok("...and the note is not empty", opened.text > 40, `${opened.text} chars`);

    // Every row has to span its own table's head, detail rows included. The
    // colspan here is derived from the pool size, and ui.js records getting a
    // hand-written one wrong twice.
    const spans = await page.evaluate(() => {
      const t = document.querySelector("table.cmpt");
      if (!t) return { width: 0, bad: ["no comparison table rendered"] };
      const width = [...t.querySelectorAll("thead tr")][0].children.length;
      const bad = [];
      for (const tr of t.querySelectorAll("tbody tr")) {
        const n = [...tr.children].reduce((a, td) => a + (Number(td.getAttribute("colspan")) || 1), 0);
        if (n !== width) bad.push(`${tr.className}: ${n} vs ${width}`);
      }
      return { width, bad };
    });
    ok("EVERY COMPARISON ROW SPANS ITS OWN TABLE HEAD",
      spans.bad.length === 0, spans.bad.join("; "));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 4 — COMPARE AT WIDTH");
  for (const w of [320, 390, 560, 768, 820, 1100, 1440]) {
    const { page, browser, server, errors } = await open({ width: w, height: 900, hash: "#/joop/lineup" });
    // One click per evaluate, for the reason the section above records: a
    // batched second click lands on a node the repaint already detached, and
    // the sweep then silently measures the single-pick panel instead of a
    // table. Which is what it did, and three "ok"s were meaningless.
    for (const _ of [0, 1]) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.prow:not(.dead) [data-cmp]:not([aria-pressed="true"])')][0];
        if (b) b.click();
      });
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => { location.hash = "#/joop/compare"; });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const box = document.querySelector(".scroll");
      const tbl = document.querySelector("table.cmpt");
      // .mrow .ml, not ".cmpt .ml" - the first .ml in the table is the EMPTY
      // corner cell of the header row, whose height is the tallest player
      // heading. Measuring that read every two-line player name as a wrapped
      // metric label, which is how this assertion passed at four widths while
      // testing nothing.
      const label = document.querySelector(".mrow .ml");
      const labelBtn = document.querySelector(".mrow .ml .rowtog");
      const content = document.querySelector("[data-content]");
      return {
        pageOverflow: doc.scrollWidth - doc.clientWidth,
        boxScrolls: box ? box.scrollWidth > box.clientWidth : null,
        tableW: tbl ? Math.round(tbl.getBoundingClientRect().width) : null,
        contentW: content ? Math.round(content.getBoundingClientRect().width) : null,
        labelW: label ? Math.round(label.getBoundingClientRect().width) : null,
        // A wrapped inline element produces more than one client rect. The
        // stylesheet sets white-space:nowrap on this column precisely so a
        // metric name cannot break, so more than one rect means the rule is
        // not applying - which is the thing worth knowing.
        labelRects: labelBtn ? labelBtn.getClientRects().length : null,
        labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : null,
      };
    });
    ok(`${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
    // THE DOCUMENT MUST NOT SCROLL SIDEWAYS. A wide table is allowed; the page
    // is not. app.css records three fixed-layout fixes that all failed this.
    ok(`${w}px: the DOCUMENT does not scroll sideways`, m.pageOverflow <= 1,
      `overflowing by ${m.pageOverflow}px`);
    ok(`${w}px: there IS a comparison table to measure`, m.tableW !== null,
      "the sweep was measuring the single-pick panel, not a table");
    ok(`${w}px: the metric label column has not collapsed`, m.labelW !== null && m.labelW >= 60,
      `label column ${m.labelW}px`);
    ok(`${w}px: a metric label does not break across lines`, m.labelRects === 1,
      `${m.labelRects} client rects in a ${m.labelW}px column`);
    ok(`${w}px: the label column is not clipping its text`, m.labelClipped !== true,
      `label cell scrolls: ${m.labelW}px box`);
    if (w >= 1100) {
      ok(`${w}px: the table gets the full content width, not half of it`,
        m.tableW !== null && m.contentW !== null && m.tableW > m.contentW * 0.8,
        `table ${m.tableW}px inside ${m.contentW}px — a grid split it`);
    }
    await browser.close(); server.close();
  }

  console.log("\nPHASE 4 — RECAP");
  {
    const { page, browser, server, errors } = await open({ width: 1100, height: 900, hash: "#/joop/recap" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));
    const r = await page.evaluate(() => ({
      title: document.querySelector("[data-title]")?.textContent,
      body: document.querySelector("[data-content]").textContent.replace(/\s+/g, " ").trim(),
    }));
    ok("Recap is reachable and titled", r.title === "Recap", `got "${r.title}"`);
    // A FRESH BROWSER HAS NO LOG, so this is the state most readers meet first
    // and it has to explain itself rather than render blank. The GRADED layout
    // has no coverage here - it needs a seeded decision log plus published
    // stats for the fixture's invented players - and is covered in
    // test/v2-recap.test.mjs instead. Declared, not hidden.
    ok("an ungraded league explains itself rather than rendering blank",
      /Nothing graded yet/.test(r.body) && r.body.length > 120, r.body.slice(0, 160));
    ok("...and names the per-device log as the likely reason",
      /lives in this browser on this device/.test(r.body));
    ok("no placeholder leaked", !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.body),
      r.body.slice(0, 160));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 4 — METHODS");
  {
    const { page, browser, server, errors } = await open({ width: 1100, height: 900, hash: "#/joop/methods" });
    ok("no page errors", errors.length === 0, errors.join("\n       "));
    const r = await page.evaluate(() => {
      const c = document.querySelector("[data-content]");
      const secs = [...c.querySelectorAll("section.meth")].map((s) => s.id);
      const links = [...c.querySelectorAll(".toc a")].map((a) => a.getAttribute("href"));
      const dangling = links.filter((h) => {
        const id = String(h).split("#").pop();
        return !document.getElementById(id);
      });
      return {
        title: document.querySelector("[data-title]")?.textContent,
        leaguePicker: document.querySelector("[data-leagues]")?.hidden,
        secs, links, dangling,
        body: c.textContent.replace(/\s+/g, " "),
        levels: c.querySelector("#replacement .lvl")?.textContent.replace(/\s+/g, " ").trim(),
        sigmas: c.querySelector("#threshold .lvl")?.textContent.replace(/\s+/g, " ").trim(),
      };
    });
    ok("Methods is reachable and titled", r.title === "Methods", `got "${r.title}"`);
    ok("IT IS LEAGUE-SCOPED NOW, so the league picker is showing",
      r.leaguePicker === false, "the picker is hidden on a league-scoped route");
    ok("all nine sections rendered", r.secs.length === 9, r.secs.join(","));
    ok("NO CONTENTS LINK POINTS AT NOTHING", r.dangling.length === 0, r.dangling.join(", "));

    // The measured halves are the reason this page is per-league. If they
    // degraded, the page still looks fine - the silent-degradation failure.
    ok("MEASURED REPLACEMENT LEVELS ARRIVED", /\d/.test(r.levels || ""), r.levels);
    ok("MEASURED SIGMA ARRIVED", /\d/.test(r.sigmas || ""), r.sigmas);
    ok("the passing-TD weight is quoted from this league",
      /pays 4\.0 for a passing touchdown/.test(r.body),
      "expected the read value, not a hardcoded claim");
    ok("the stale 'both your leagues' claim is gone", !/both your leagues/i.test(r.body));

    // The split: a live per-load fact must not be restated on a methodology
    // page, because the copy here will be the stale one.
    ok("THE STATUS STRIP'S CLAIMS ARE NOT DUPLICATED HERE",
      !/Kickoff locking is (on|off)/i.test(r.body) && !/Usage through week/i.test(r.body));
    ok("no placeholder leaked", !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.body),
      r.body.slice(0, 160));
    await browser.close(); server.close();
  }

  for (const w of [390, 820]) {
    const { page, browser, server, errors } = await open({ width: w, height: 900, hash: "#/joop/methods" });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const first = document.querySelector("section.meth");
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        // An anchor jump must not land a heading under the sticky topbar.
        scrollMargin: first ? parseInt(getComputedStyle(first).scrollMarginTop, 10) : 0,
      };
    });
    ok(`${w}px: Methods does not scroll sideways`, m.overflow <= 1, `overflowing by ${m.overflow}px`);
    ok(`${w}px: an anchored section clears the sticky topbar`, m.scrollMargin >= 40,
      `scroll-margin-top ${m.scrollMargin}px`);
    ok(`${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }

  // =========================================================================
  // PHASE 5 — the rubric port.
  //
  // Everything below exists because the old harness proved it and this file
  // could not: not for want of an assertion, but for want of a knob. See
  // claude/hub-redesign-phase5-rubric-diff.md for the scenario-by-scenario
  // verdicts, including the four gaps recorded as deliberate non-ports.
  // =========================================================================

  // A DELIBERATE 404 IS NOT A DEFECT. `usageOk:false` and `vacancyOk:false`
  // fulfil the request with a 404, which Chromium logs as a console error - so
  // asserting "no errors" in a scenario whose entire point is a missing layer
  // asserts that the scenario did not happen. Caught on the first run of this
  // block: two outage scenarios failed their own no-errors check. Only the
  // deliberate status line is dropped; a pageerror or any other console error
  // still fails.
  const notThe404 = (es) => es.filter((e) => !/404 \(Not Found\)/.test(e));

  // Days of the simulated week. 2026-09-13 is a Sunday in America/New_York,
  // verified rather than assumed - the whole day matrix hangs off it.
  const D_SUN = Date.UTC(2026, 8, 13, 17, 40, 0);
  const D_MON = Date.UTC(2026, 8, 14, 14, 0, 0);
  const D_TUE = Date.UTC(2026, 8, 15, 14, 0, 0);
  const D_WED = Date.UTC(2026, 8, 16, 14, 0, 0);
  const D_THU = Date.UTC(2026, 8, 17, 14, 0, 0);

  console.log("\nPHASE 5 — THE GRADED RECAP (G3)");
  {
    const { page, browser, server, errors } = await open({
      width: 1100, height: 1200, hash: "#/joop/recap",
      week: 4, seedLog: F.recapLog(), usage: F.usageForRecap() });
    ok("no page errors", errors.length === 0, errors.join("\n       "));

    const r = await page.evaluate(() => {
      const c = document.querySelector("[data-content]");
      const tagOf = (id) => {
        const body = document.getElementById(id);
        if (!body) return null;
        const t = body.closest(".disc")?.querySelector(".tag");
        if (!t) return null;
        const cs = getComputedStyle(t);
        return { cls: t.className, text: t.textContent.trim(),
                 color: cs.color, bg: cs.backgroundColor, weight: cs.fontWeight };
      };
      return {
        title: document.querySelector("[data-title]")?.textContent,
        discs: c.querySelectorAll(".disc").length,
        ids: [...c.querySelectorAll(".discbody")].map((d) => d.id),
        totals: c.querySelector("h2 .ct")?.textContent.replace(/\s+/g, " ").trim(),
        heads: [...c.querySelectorAll(".disc .dl")].map((d) => d.textContent.replace(/\s+/g, " ").trim()),
        note: [...c.querySelectorAll(".note")].map((d) => d.textContent.replace(/\s+/g, " ").trim()).join(" "),
        tags: { l1: tagOf("rc-l-1"), l2: tagOf("rc-l-2"), l3: tagOf("rc-l-3"),
                k1: tagOf("rc-k-1"), k3: tagOf("rc-k-3") },
        body: c.textContent.replace(/\s+/g, " "),
      };
    });

    ok("Recap is titled", r.title === "Recap", `got "${r.title}"`);
    // THE EMPTY STATE IS NOT WHAT THIS SCENARIO IS FOR. If the seed failed to
    // land, recapPage renders "Nothing graded yet" and every text assertion
    // below would quietly be testing the wrong layout - the apply-failure
    // lesson from the phase 4 audit, applied to a fixture.
    ok("THE SEED LANDED — this is the GRADED layout, not the empty state",
      !/Nothing graded yet/.test(r.body) && r.discs === 5,
      `${r.discs} rows: ${r.ids.join(",")}`);
    ok("...with the five panel ids the page derives from the week",
      ["rc-l-1", "rc-l-2", "rc-l-3", "rc-k-1", "rc-k-3"].every((i) => r.ids.includes(i)),
      r.ids.join(","));
    ok("every disclosure id is unique", new Set(r.ids).size === r.ids.length, r.ids.join(","));
    // A LINEUP ROW AND A LOCKOUT ROW IN THE SAME WEEK MUST NOT COLLIDE. Both
    // ids are built from the week alone plus a one-letter prefix, so dropping
    // either prefix makes week 3 emit the same id twice - and setContent's
    // restore keys on that id, so it would reopen the wrong row.
    ok("the two week-3 rows carry DIFFERENT ids despite sharing a week",
      r.ids.includes("rc-l-3") && r.ids.includes("rc-k-3"), r.ids.join(","));

    // THREE VERDICT STATES. A tie is its own, because `heldUp` is `delta <= 0`
    // and at exactly level the head and the body can disagree - which is what
    // the phase 4 audit caught.
    ok("a week his own lineup won says so",
      r.heads.some((h) => /your lineup held up/.test(h)), r.heads.join(" | "));
    ok("a week the suggestion won says so",
      r.heads.some((h) => /the suggested lineup would have scored more/.test(h)), r.heads.join(" | "));
    ok("A DEAD LEVEL WEEK IS ITS OWN THIRD STATE",
      r.heads.some((h) => /the two lineups scored the same/.test(h)), r.heads.join(" | "));

    // THE SURVIVING PHASE 4 MUTATION, NOW RENDERED. netLocked is exactly 0
    // here, which is the common case, and `!r.netLocked` dropped the entire
    // total while the footnote below still promised two.
    ok("TWO TOTALS, and a lockout total of exactly ZERO still renders",
      /calls -8\.0 pts across 3 wk/.test(r.totals || "") && /locked out \+0\.0/.test(r.totals || ""),
      `.ct read: ${r.totals}`);

    // The tags, COMPUTED. Node can prove the class is emitted; only a browser
    // can prove the three states look different from one another.
    const t = r.tags;
    ok("`.tag.good` is emitted on the week he won", /\bgood\b/.test(t.l1?.cls || ""), t.l1?.cls);
    ok("`.tag.unmeasured` is emitted on the tie", /\bunmeasured\b/.test(t.l3?.cls || ""), t.l3?.cls);
    ok("the week the suggestion won carries a PLAIN tag",
      t.l2 && !/\bgood\b|\bunmeasured\b/.test(t.l2.cls), t.l2?.cls);
    ok("THE THREE TAG STATES COMPUTE TO THREE DIFFERENT COLOURS",
      t.l1 && t.l2 && t.l3 && new Set([t.l1.color, t.l2.color, t.l3.color]).size === 3,
      `good=${t.l1?.color} plain=${t.l2?.color} unmeasured=${t.l3?.color}`);
    ok("...and the good tag is filled, not merely recoloured",
      t.l1 && t.l1.bg !== t.l2.bg, `good bg=${t.l1?.bg} plain bg=${t.l2?.bg}`);
    ok("a lockout that cost exactly nothing shows a NUMBER, not a dash",
      t.k3 && t.k3.text === "+0.0" && !/unmeasured/.test(t.k3.cls), JSON.stringify(t.k3));
    ok("a lockout that could not be measured shows an em dash, quietly",
      t.k1 && t.k1.text === "—" && /\bunmeasured\b/.test(t.k1.cls), JSON.stringify(t.k1));
    ok("the footnote counts the partial weeks it excluded",
      /2 weeks are still partly\s*unpublished and excluded from the totals/.test(r.note.replace(/\s+/g, " ")),
      r.note.slice(0, 220));
    ok("no placeholder leaked into the graded page",
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.body), r.body.slice(0, 200));

    await page.screenshot({ path: path.join(SHOTS, "v2-recap-graded.png"), fullPage: true });

    // The disclosure, opened for real, and its body read back.
    const opened = await page.evaluate(() => {
      const b = document.querySelector('[aria-controls="rc-l-2"]');
      b.click();
      const p = document.getElementById("rc-l-2");
      return { open: !p.hidden, len: p.textContent.replace(/\s+/g, " ").trim().length,
               partial: /Only 50% of those players have\s*published stats yet/.test(
                 p.textContent.replace(/\s+/g, " ")),
               text: p.textContent.replace(/\s+/g, " ").trim().slice(0, 150) };
    });
    ok("A GRADED WEEK OPENS", opened.open === true);
    ok("...and the panel is not empty", opened.len > 80, `${opened.len} chars`);
    ok("...and a partially published week says so inside it, with its coverage",
      opened.partial === true, opened.text);

    // setContent's restore keys on the panel id (shell.js:225-231), so this is
    // the check that the week-derived id is stable across the 30-second
    // re-solve - the kickoff watcher repaints straight through a Tuesday.
    await page.evaluate(() => window.__ffh_repaint());
    await page.waitForTimeout(220);
    const survived = await page.evaluate(() => {
      const p = document.getElementById("rc-l-2");
      return { exists: !!p, open: p ? !p.hidden : false,
               expanded: document.querySelector('[aria-controls="rc-l-2"]')?.getAttribute("aria-expanded"),
               stillFive: document.querySelectorAll("[data-content] .disc").length };
    });
    ok("THE rc-l-2 PANEL SURVIVES setContent'S RESTORE ACROSS A REPAINT",
      survived.exists && survived.open === true && survived.expanded === "true",
      JSON.stringify(survived));
    ok("...and the repaint did not drop or duplicate a row",
      survived.stillFive === 5, `${survived.stillFive} rows after repaint`);
    await browser.close(); server.close();
  }

  // The graded layout at width. Constraint 3, and the failure class that has
  // bitten this project three times.
  console.log("\nPHASE 5 — THE GRADED RECAP AT WIDTH (G3)");
  for (const w of [320, 360, 390, 560, 768, 820, 1100, 1440]) {
    const { page, browser, server, errors } = await open({
      width: w, height: 1000, hash: "#/joop/recap",
      week: 4, seedLog: F.recapLog(), usage: F.usageForRecap() });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      // Open every row: a collapsed page cannot overflow, so measuring it
      // closed would pass at every width and prove nothing.
      for (const b of document.querySelectorAll("[data-content] .dischd")) b.click();
      const tags = [...document.querySelectorAll("[data-content] .disc .tag")];
      return {
        graded: !/Nothing graded yet/.test(document.querySelector("[data-content]").textContent),
        overflow: doc.scrollWidth - doc.clientWidth,
        rows: document.querySelectorAll("[data-content] .disc").length,
        // A tag is a short pill with a signed number in it; if it wraps, the
        // head has run out of room and the layout is broken, not tight.
        tagRects: Math.max(0, ...tags.map((t) => t.getClientRects().length)),
        tap: Math.min(...[...document.querySelectorAll("[data-content] .dischd")]
          .map((b) => Math.round(b.getBoundingClientRect().height))),
      };
    });
    ok(`${w}px: the graded layout rendered`, m.graded === true && m.rows === 5, `${m.rows} rows`);
    ok(`${w}px: the graded Recap does not scroll sideways, every row open`,
      m.overflow <= 1, `overflowing by ${m.overflow}px`);
    ok(`${w}px: a verdict tag does not wrap`, m.tagRects === 1, `${m.tagRects} client rects`);
    ok(`${w}px: a graded row is a thumb-sized tap target`, m.tap >= 40, `${m.tap}px`);
    ok(`${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
    if ([390, 1100].includes(w)) {
      await page.screenshot({ path: path.join(SHOTS, `v2-recap-graded-${w}.png`), fullPage: true });
    }
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE DAY MATRIX (G1)");
  // Until now every check in this file ran on a Sunday at 13:40, because SIM
  // was a constant. The Recap nav gate is the one day-dependent piece of
  // chrome (router.js RECAP_NAV_DAYS = Tue, Wed) and the soft gate means the
  // URL stays reachable on the other five days.
  for (const d of [
    { label: "Sunday", sim: D_SUN, day: 0, inNav: false },
    { label: "Monday", sim: D_MON, day: 1, inNav: false },
    { label: "Tuesday", sim: D_TUE, day: 2, inNav: true },
    { label: "Wednesday", sim: D_WED, day: 3, inNav: true },
    { label: "Thursday", sim: D_THU, day: 4, inNav: false },
  ]) {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 1000, hash: "#/today", sim: d.sim });
    const r = await page.evaluate(() => {
      const navs = [...document.querySelectorAll(".railbtn")];
      const classes = [...document.querySelectorAll(".clsx")];
      return {
        // THE SHIMMED CLOCK, READ THE WAY THE PAGE READS IT. `state.day` is an
        // optional INJECTION point (pages.js:111, router.js:44 both spell it
        // `state.day ?? new Date().getDay()`) and nothing sets it in normal
        // operation, so probing it returned undefined on all five days and the
        // check failed while the knob was working perfectly - the nav gate
        // below already differed between Sunday and Tuesday. Corrected to read
        // the Date the page actually sees.
        day: new Date().getDay(),
        recapHidden: navs.filter((b) => b.dataset.nav === "recap").every((b) => b.hasAttribute("hidden")),
        shown: navs.filter((b) => !b.hasAttribute("hidden")).map((b) => b.dataset.nav),
        classCount: classes.length,
        labels: classes.map((s) => s.querySelector(".clsh")?.textContent.replace(/\s+/g, " ").trim().slice(0, 40)),
        // The advisory class is a <details> and must be the LAST thing on the
        // page on every day, whatever the week's shape.
        lastIsAdvisory: classes.length > 0 && classes[classes.length - 1].tagName === "DETAILS",
      };
    });
    // THE KNOB HAS TO HAVE APPLIED. A clock shim that silently does nothing
    // makes all five of these scenarios one scenario, five times - and the
    // phase 4 audit's own lesson is that a mutation which fails to apply is
    // not a mutation that died.
    ok(`${d.label}: the simulated clock actually moved the day`,
      r.day === d.day, `page thinks getDay() is ${r.day}, expected ${d.day}`);
    ok(`${d.label}: Recap is ${d.inNav ? "offered" : "out of"} the nav`,
      r.recapHidden === !d.inNav, `hidden=${r.recapHidden}, nav shows ${r.shown.join(",")}`);
    ok(`${d.label}: Today still has something to say`, r.classCount > 0, r.labels.join(" | "));
    ok(`${d.label}: the advisory class is last on the page`, r.lastIsAdvisory === true,
      r.labels.join(" | "));
    ok(`${d.label}: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }
  // The soft gate, proved on a day the tab is gone rather than only on Sunday.
  {
    const { page, browser, server } = await open({
      width: 1280, height: 900, hash: "#/joop/recap", sim: D_THU });
    const r = await page.evaluate(() => ({
      title: document.querySelector("[data-title]")?.textContent,
      standingOnItAndVisible: [...document.querySelectorAll(".railbtn")]
        .filter((b) => b.dataset.nav === "recap").every((b) => !b.hasAttribute("hidden")),
    }));
    ok("SOFT GATE: Recap is still reachable by URL on a Thursday",
      r.title === "Recap", `got "${r.title}"`);
    ok("...and the tab un-hides itself while you are standing on it",
      r.standingOnItAndVisible === true);
    await browser.close(); server.close();
  }

  // THE CLASS ORDER, BY DAY. The rubric for G1 was "which urgency classes
  // Today renders and IN WHAT ORDER", and as first ported the five days above
  // render the same order, because no fixture league sets a waiver day and
  // claimsLead() is therefore false all week. Mutating claimsLead() to return
  // false passed all 27 checks. `waiverDay: 2` is the real setting on all
  // three leagues (Wednesday 03:00 ET), so claims lead on Tuesday - when the
  // bid is placed - and Wednesday, and nowhere else. Phase 5 audit.
  for (const d of [
    { label: "Sunday", sim: D_SUN, lead: false },
    { label: "Monday", sim: D_MON, lead: false },
    { label: "Tuesday", sim: D_TUE, lead: true },
    { label: "Wednesday", sim: D_WED, lead: true },
    { label: "Thursday", sim: D_THU, lead: false },
  ]) {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 1000, hash: "#/today", sim: d.sim, waiverDay: 2 });
    const heads = await page.evaluate(() => [...document.querySelectorAll(".clsx .clsh")]
      .map((h) => h.textContent.replace(/\s+/g, " ").trim()));
    const at = (rx) => heads.findIndex((h) => rx.test(h));
    const iClaims = at(/^(Claims process today|On the wire)\b/), iLineup = at(/^Lineup corrections\b/);
    ok(`${d.label}, waiver day set: both a claims and a lineup class are on the page to order`,
      iClaims >= 0 && iLineup >= 0, heads.join(" | "));
    ok(`${d.label}, waiver day set: claims ${d.lead ? "LEAD" : "follow"} the lineup calls`,
      d.lead ? iClaims < iLineup : iClaims > iLineup, heads.join(" | "));
    ok(`${d.label}, waiver day set: the claims class is called "${d.lead ? "Claims process today" : "On the wire"}"`,
      d.lead ? /^Claims process today\b/.test(heads[iClaims] || "") : /^On the wire\b/.test(heads[iClaims] || ""),
      heads[iClaims]);
    ok(`${d.label}, waiver day set: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE WAIVER-NIGHT WEEK (G2)");
  // Measured live on 2026-10-06: display_week 4 while week 5 had advanced.
  // pipeline.js:130-134 records that reading display_week here priced the
  // entire forward-looking half of the page against a finished week. Nothing
  // in this file could reach the divergence until the knob existed.
  for (const w of [1280, 390]) {
    const { page, browser, server, errors } = await open({
      width: w, height: 1000, hash: "#/joop/lineup", sim: D_TUE,
      week: 5, displayWeek: 4 });
    const r = await page.evaluate(() => ({
      stamp: document.querySelector(".wk")?.textContent.replace(/\s+/g, " ").trim(),
      week: window.__ffh_state?.week,
      graded: window.__ffh_state?.gradedWeek,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    ok(`${w}px: THE PAGE PRICES THE ADVANCED WEEK, not the one display_week names`,
      r.week === 5, `state.week=${r.week}`);
    ok(`${w}px: ...and still knows which week is the graded one`,
      r.graded === 4, `state.gradedWeek=${r.graded}`);
    ok(`${w}px: THE HEADER NAMES BOTH WEEKS SEPARATELY`,
      /Week 5/.test(r.stamp || "") && /wk 4 graded/.test(r.stamp || ""),
      `stamp read: "${r.stamp}"`);
    ok(`${w}px: the two-week stamp does not push the topbar sideways`,
      r.overflow <= 1, `overflowing by ${r.overflow}px`);
    ok(`${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }
  // And the ordinary case must NOT grow a second week.
  {
    const { page, browser, server } = await open({
      width: 1280, height: 900, hash: "#/joop/lineup", sim: D_TUE, week: 5 });
    const stamp = await page.evaluate(() =>
      document.querySelector(".wk")?.textContent.replace(/\s+/g, " ").trim());
    ok("with no divergence the header says ONE week, not 'wk 5 graded'",
      /Week 5/.test(stamp || "") && !/graded/.test(stamp || ""), `stamp read: "${stamp}"`);
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE REST OF THE STATUS STRIP (G4, G6)");
  // The snap-counts warning. Restored in phase 4 after the phase 1 footer
  // split dropped it; node covers the copy and nothing rendered it. It is the
  // only place on the site that distinguishes missing data from a measured
  // zero, and it fires UNDER a fresh overall stamp, which is the trap.
  {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 900, hash: "#/joop/lineup",
      usage: { ...F.usagePayload(),
               sources: { stats_player: { ok: true, rows: 900 },
                          snap_counts: { ok: false, rows: 0 } } } });
    const s = await page.evaluate(() => {
      const d = document.querySelector(".status");
      return { summary: d?.querySelector("summary")?.textContent.replace(/\s+/g, " ").trim(),
               text: (d?.textContent || "").replace(/\s+/g, " "),
               cls: d?.className || "" };
    });
    ok("THE SNAP-COUNTS WARNING RENDERS", /Snap counts did not publish for this build/.test(s.text),
      s.text.slice(0, 220));
    ok("...and says plainly that blank is missing data, not zero snaps",
      /missing data, not zero snaps/.test(s.text));
    // NOT "the summary names snaps". status.js:129 only promotes that sentence
    // when snaps is the FIRST loud row, and this fixture always carries a
    // louder one - the unrecognised team ZZZ - so the summary correctly reads
    // "2 things worth knowing about this load". Asserting the sentence made
    // this check a test of the fixture's sort order. What matters is that the
    // reader cannot miss it and that it has not replaced the stamp.
    ok("...and the strip is FLAGGED, so it is visible without expanding",
      /has-(warn|bad)/.test(s.cls || ""), `class: ${s.cls}`);
    // ...BUT THE STRIP IS ALWAYS FLAGGED ON THIS FIXTURE, by the unrecognised
    // team ZZZ, so the check above passes with the snaps row demoted to "ok".
    // The fixture-sort-order dependency had moved, not gone. Phase 5 audit,
    // caught by mutating the snaps row's level. Read the ROW's own level.
    const snapRow = await page.evaluate(() => {
      const r = [...document.querySelectorAll(".status .srow")]
        .find((d) => /Snap counts did not publish/.test(d.textContent));
      return r ? r.className : null;
    });
    ok("...and it is the SNAPS ROW ITSELF that carries the warning, not a neighbour",
      /\bwarn\b/.test(snapRow || ""), `snaps row class: ${snapRow}`);
    ok("...and the warning sits OVER A FRESH MIRROR STAMP, which is the trap",
      /Usage through week 3/.test(s.text) && /Snap counts did not publish/.test(s.text),
      s.text.slice(0, 260));
    ok("...while the mirror itself is NOT reported as missing",
      !/No usage layer this load/.test(s.text));
    ok("no page errors", errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }
  // Clubs that have not filed: named while a reader can hold them in their
  // head (NAME_CLUBS_UPTO = 4), counted past that. Two different sentences
  // and two live shapes - 2026-10-13's missing Monday-night game, and a
  // Thursday night where through_week has flipped with thirty clubs to play.
  {
    const { page, browser, server } = await open({
      width: 1280, height: 900, hash: "#/joop/lineup",
      usage: F.usagePayload({ shortClubs: ["KC", "CIN"] }) });
    const t = await page.evaluate(() =>
      document.querySelector(".status")?.textContent.replace(/\s+/g, " ") || "");
    ok("two unfiled clubs are NAMED", /KC and CIN|CIN and KC/.test(t), t.slice(0, 220));
    ok("...and the sentence agrees with itself about number", /have not filed week 3/.test(t),
      t.slice(0, 220));
    await browser.close(); server.close();
  }
  {
    const THIRTY = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
                    "HOU","IND","JAX","KC","LA","LAC","LV","MIA","MIN","NE","NO","NYG",
                    "NYJ","PIT","SEA","SF","TB","TEN"];
    const { page, browser, server } = await open({
      width: 1280, height: 900, hash: "#/joop/lineup",
      usage: F.usagePayload({ shortClubs: THIRTY }) });
    const t = await page.evaluate(() =>
      document.querySelector(".status")?.textContent.replace(/\s+/g, " ") || "");
    ok("thirty unfiled clubs are COUNTED, because naming them is not a sentence",
      /30 clubs have not filed/.test(t), t.slice(0, 220));
    ok("...and not one of them is named", !/ARI, ATL/.test(t), t.slice(0, 220));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE SIGNAL DISAGREEMENT (G7)");
  // Six states, opposite in meaning and identical in shape. Each drops the
  // LAST mirrored week from a rostered starter - which is what "projected to
  // play, did not play" looks like in the data - and then varies only what the
  // depth chart says about him. The old harness's own comment records why
  // these cannot be one scenario.
  const QB = F.H.qb1;
  const dropLastWeek = (id) => {
    const u = F.usagePayload();
    u.p[id] = { ...u.p[id], w: u.p[id].w.filter((r) => r[0] !== 3), a: { ...u.p[id].a } };
    delete u.p[id].a["3"];
    return u;
  };
  const vacWith = ({ depth = {}, absent = [] }) => {
    const v = F.vacancyPayload();
    return { ...v, depth: { ...v.depth, ...depth }, absent: [...(v.absent || []), ...absent] };
  };
  const SIG_STARTER = vacWith({
    depth: { [QB]: { tm: "CIN", pos: "QB", rk: 1, climb: 0, nm: "Starting Quarterback" },
             "sig-backup": { tm: "CIN", pos: "QB", rk: 2, climb: 0, nm: "The Understudy" } },
    absent: [{ id: QB, wk: 1, nm: "Starting Quarterback", tm: "CIN", pos: "QB",
               st: "Out", inj: "Concussion", tier: "confirmed" }],
  });
  const SIG_RULEDOUT = vacWith({
    depth: { [QB]: { tm: "CIN", pos: "QB", rk: 1, climb: 0, nm: "Starting Quarterback" } },
    absent: [{ id: QB, wk: 2, nm: "Starting Quarterback", tm: "CIN", pos: "QB",
               st: "Out", inj: "Hamstring", tier: "confirmed" }],
  });
  const SIG_BACKUP = vacWith({
    depth: { [QB]: { tm: "CIN", pos: "QB", rk: 2, climb: 0, nm: "Starting Quarterback" },
             "sig-ahead": { tm: "CIN", pos: "QB", rk: 1, climb: 0, nm: "The Actual Starter" } },
  });

  const sigRead = () => {
    const card = [...document.querySelectorAll("[data-content] .card")]
      .find((c) => /Worth a second look/.test(c.querySelector("h2")?.textContent || ""));
    if (!card) return { present: false };
    return {
      present: true,
      count: card.querySelectorAll(".srow2").length,
      lines: [...card.querySelectorAll(".srow2 .dl")].map((d) => d.textContent.replace(/\s+/g, " ").trim()),
      notes: [...card.querySelectorAll(".srow2 .note")].map((d) => d.textContent.replace(/\s+/g, " ").trim()),
      chips: [...card.closest("[data-content]").querySelectorAll(".nm .chip")]
        .map((c) => `${c.textContent.trim()}|${c.getAttribute("title") || ""}`),
      text: card.textContent.replace(/\s+/g, " ").trim(),
    };
  };

  const sigStates = [];
  for (const sc of [
    { label: "the chart says he is back", vacancy: SIG_STARTER, expect: /QB1 on CIN's depth chart/ },
    { label: "ruled out again this week", vacancy: SIG_RULEDOUT, expect: /Out \(Hamstring\) for week/ },
    { label: "genuinely a backup", vacancy: SIG_BACKUP, expect: /QB2 on CIN's depth chart/ },
    { label: "no depth entry at all — the question stays open", vacancy: null,
      expect: /returning starter or backup\?/ },
    { label: "no vacancy layer at all", vacancyOk: false, expect: /returning starter or backup\?/ },
  ]) {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 1100, hash: "#/joop/lineup",
      usage: dropLastWeek(QB),
      ...(sc.vacancy ? { vacancy: sc.vacancy } : {}),
      ...(sc.vacancyOk === false ? { vacancyOk: false } : {}) });
    const r = await page.evaluate(sigRead);
    sigStates.push({ label: sc.label, text: r.text || "" });
    ok(`SIGNALS, ${sc.label}: the block renders`, r.present === true,
      "no card headed 'Worth a second look'");
    ok(`SIGNALS, ${sc.label}: it names the absence as a measured fact`,
      /did not play in week/.test(r.text || ""), (r.text || "").slice(0, 200));
    ok(`SIGNALS, ${sc.label}: and says what the chart does or does not settle`,
      sc.expect.test(r.text || ""), (r.text || "").slice(0, 240));
    ok(`SIGNALS, ${sc.label}: no placeholder in any sentence`,
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.text || ""), (r.text || "").slice(0, 200));
    ok(`SIGNALS, ${sc.label}: no page errors beyond the deliberate outage`,
      notThe404(errors).length === 0, notThe404(errors).join("\n       "));
    if (sc.vacancy === SIG_STARTER) {
      await page.screenshot({ path: path.join(SHOTS, "v2-signals-back.png"), fullPage: true });
    }
    await browser.close(); server.close();
  }
  // THE META-ASSERTION. The vacancy scenarios once shipped as two labels over
  // one rendering, and the whole reason these five are separate is that they
  // are supposed to SAY different things. Four distinct renderings from five
  // scenarios is the honest expectation: "no depth entry" and "no vacancy
  // layer" reach the same open question by different routes.
  ok("THE FIVE SIGNAL STATES ARE NOT ALL THE SAME RENDERING",
    new Set(sigStates.map((s) => s.text)).size >= 4,
    sigStates.map((s) => `${s.label} -> ${s.text.slice(0, 60)}`).join("\n       "));
  // Genuine silence: with no mirror there is nothing to disagree WITH.
  {
    const { page, browser, server } = await open({
      width: 1280, height: 900, hash: "#/joop/lineup", usageOk: false });
    const r = await page.evaluate(sigRead);
    ok("SIGNALS: with no mirror at all the block is ABSENT, not empty",
      r.present === false, "a 'Worth a second look' card rendered with no usage layer");
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({
      width: 390, height: 900, hash: "#/joop/lineup",
      usage: dropLastWeek(QB), vacancy: SIG_STARTER });
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      present: !![...document.querySelectorAll("[data-content] .card h2")]
        .find((h) => /Worth a second look/.test(h.textContent)),
    }));
    ok("SIGNALS on a phone: the block is there", m.present === true);
    ok("SIGNALS on a phone: no horizontal scroll", m.overflow <= 1, `${m.overflow}px`);
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE VACANCY BLOCK (G8)");
  // Captured as TEXT, deliberately. Nearly every field in this block is
  // optional, so "the section exists" passes on a block reading "projected
  // undefined but did not play in week undefined".
  const vacRead = () => {
    const card = [...document.querySelectorAll("[data-content] .card")]
      .find((c) => /Just came free/.test(c.querySelector("h2")?.textContent || ""));
    if (!card) return { present: false };
    return {
      present: true,
      ct: card.querySelector("h2 .ct")?.textContent.replace(/\s+/g, " ").trim(),
      heads: [...card.querySelectorAll(".disc .dl")].map((d) => d.textContent.replace(/\s+/g, " ").trim()),
      subhd: [...card.querySelectorAll(".subhd")].map((h) => h.textContent.trim()),
      note: card.querySelector(".note")?.textContent.replace(/\s+/g, " ").trim(),
      text: card.textContent.replace(/\s+/g, " ").trim(),
    };
  };
  for (const sc of [
    { label: "a partially filed week carries the caveat", sim: D_WED, week: 4,
      vacancy: F.vacancyPayload({ week: 2, teamsReported: 2 }),
      must: /2 of 32|only 2/i, mustNot: null },
    { label: "a fully reported week carries NO caveat", sim: D_WED, week: 4,
      vacancy: F.vacancyPayload({ week: 2, teamsReported: 32 }),
      must: /Depth chart as of/, mustNot: /of 32 clubs|only \d+ of/i },
    { label: "the chart and the usage disagree, heir unprojected", sim: D_WED, week: 4,
      vacancy: F.vacancyDisagree(),
      must: /The chart and the usage disagree/, mustNot: null },
  ]) {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 1100, hash: "#/joop/wire",
      sim: sc.sim, week: sc.week, vacancy: sc.vacancy });
    const r = await page.evaluate(vacRead);
    ok(`VACANCY, ${sc.label}: the block renders`, r.present === true,
      "no card headed 'Just came free'");
    ok(`VACANCY, ${sc.label}: it says the thing`, sc.must.test(r.text || ""),
      (r.text || "").slice(0, 260));
    if (sc.mustNot) {
      ok(`VACANCY, ${sc.label}: and does not say the other thing`,
        !sc.mustNot.test(r.text || ""), (r.text || "").slice(0, 260));
    }
    ok(`VACANCY, ${sc.label}: no placeholder in any sentence`,
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.text || ""), (r.text || "").slice(0, 200));
    ok(`VACANCY, ${sc.label}: the bid refusal is restated here too`,
      /No bid figure here either/.test(r.text || ""), (r.text || "").slice(0, 200));
    ok(`VACANCY, ${sc.label}: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }
  // Silence, twice over, by two different routes.
  {
    const { page, browser, server } = await open({
      width: 1280, height: 900, hash: "#/joop/wire", sim: D_WED, week: 4,
      vacancy: F.vacancyEmpty() });
    const r = await page.evaluate(vacRead);
    const body = await page.evaluate(() =>
      document.querySelector("[data-content]").textContent.replace(/\s+/g, " "));
    ok("VACANCY with nothing to say: the block VANISHES rather than rendering a zero",
      r.present === false, `rendered with ct "${r.ct}"`);
    ok("...and the rest of the wire is still there", body.length > 200, `${body.length} chars`);
    await browser.close(); server.close();
  }
  {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 900, hash: "#/joop/wire", sim: D_WED, week: 4, vacancyOk: false });
    const r = await page.evaluate(vacRead);
    ok("VACANCY layer missing entirely: the block is absent and the page lives",
      r.present === false && notThe404(errors).length === 0, notThe404(errors).join("\n       "));
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({
      width: 390, height: 900, hash: "#/joop/wire", sim: D_WED, week: 4,
      vacancy: F.vacancyDisagree() });
    const m = await page.evaluate(() => {
      for (const b of document.querySelectorAll("[data-content] .dischd")) b.click();
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               present: !![...document.querySelectorAll("[data-content] .card h2")]
                 .find((h) => /Just came free/.test(h.textContent)) };
    });
    ok("VACANCY on a phone: the block is there", m.present === true);
    ok("VACANCY on a phone: no horizontal scroll with every row open",
      m.overflow <= 1, `${m.overflow}px`);
    await page.screenshot({ path: path.join(SHOTS, "v2-vacancy-phone.png"), fullPage: true });
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE STANDING DEFENCE (G9)");
  // Every defence in the fixture projects identically, so without defPts this
  // row is a permanent dead heat and its two interesting states were
  // unreachable. KC is the rostered defence in every fixture lineup; BUF is
  // free. The calm/actionable distinction is a CLASS, so a do-nothing row
  // styled like a claim passes any text check.
  // HEAD AND TAG ARE READ BACK. They were captured and never asserted, so
  // inverting the gap's sign ("-4.9" on a row telling you to stream) passed
  // here AND in node, and swapping the quiet verdict for "Nothing between
  // them" was caught only by v2-differential - the suite deleted at the swap.
  // Phase 5 audit. The free BUF projects 10.2 against KC's 5.3: +4.9.
  for (const sc of [
    { label: "the live 2026-10-06 leak (rostered 5.3, free 10.2)",
      defPts: { KC: 5.3, BUF: 10.2 }, calm: false,
      head: /^Stream BUF over KC in your DEF$/, tag: "+4.9" },
    { label: "yours is better — quiet, and still shown",
      defPts: { KC: 16.0 }, calm: true,
      head: /^KC is the better bet holding your DEF$/, tag: /^-\d+\.\d$/ },
  ]) {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 1100, hash: "#/joop/wire", sim: D_WED, week: 5, defPts: sc.defPts });
    const r = await page.evaluate(() => {
      const body = document.getElementById("wdef");
      const row = body?.closest(".disc");
      if (!row) return { present: false };
      const btn = row.querySelector(".dischd");
      btn.click();
      return {
        present: true,
        calm: row.classList.contains("calm"),
        head: row.querySelector(".dl")?.textContent.replace(/\s+/g, " ").trim(),
        tag: row.querySelector(".tag")?.textContent.trim(),
        tagCls: row.querySelector(".tag")?.className,
        why: document.getElementById("wdef")?.textContent.replace(/\s+/g, " ").trim(),
      };
    });
    ok(`DEF, ${sc.label}: the standing seat is on the page`, r.present === true,
      "no #wdef row rendered");
    ok(`DEF, ${sc.label}: it reads as ${sc.calm ? "settled" : "something to do"}`,
      r.calm === sc.calm, `calm=${r.calm}, head: ${r.head}`);
    ok(`DEF, ${sc.label}: the head names the right verdict and the right defences`,
      sc.head.test(r.head || ""), `head: ${r.head}`);
    ok(`DEF, ${sc.label}: the tag carries the gap, signed free-minus-yours`,
      typeof sc.tag === "string" ? r.tag === sc.tag : sc.tag.test(r.tag || ""), `tag: ${r.tag}`);
    ok(`DEF, ${sc.label}: the reasoning is not empty`, (r.why || "").length > 40,
      `${(r.why || "").length} chars`);
    ok(`DEF, ${sc.label}: it says projection gap, never a matchup read`,
      !/matchup/i.test(r.why || "") || /projection gap, not a matchup read/.test(r.why || ""),
      (r.why || "").slice(0, 200));
    ok(`DEF, ${sc.label}: no placeholder`,
      !/\bundefined\b|\bNaN\b/.test(`${r.head} ${r.why}`), `${r.head} | ${(r.why || "").slice(0, 120)}`);
    ok(`DEF, ${sc.label}: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({
      width: 390, height: 900, hash: "#/joop/wire", sim: D_WED, week: 5,
      defPts: { KC: 5.3, BUF: 10.2 } });
    const m = await page.evaluate(() => {
      document.querySelector('[aria-controls="wdef"]')?.click();
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               tap: Math.round(document.querySelector('[aria-controls="wdef"]')
                 ?.getBoundingClientRect().height || 0) };
    });
    ok("DEF on a phone: no horizontal scroll with the row open", m.overflow <= 1, `${m.overflow}px`);
    ok("DEF on a phone: the row is a thumb-sized tap target", m.tap >= 40, `${m.tap}px`);
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — CHOPPED (G12)");
  // leagues.json has carried this league since 2026-10-06 and nothing ever
  // PAINTED it. Nine slots rather than ten, no third receiver, no superflex,
  // and a $1000 FAAB budget - which is the property worth having, because the
  // wire renders the figure.
  for (const w of [1280, 390]) {
    const { page, browser, server, errors } = await open({
      width: w, height: 1100, hash: "#/chop/lineup", sim: D_WED, week: 5 });
    const r = await page.evaluate(() => ({
      active: [...document.querySelectorAll("[data-league]")]
        .find((b) => b.getAttribute("aria-current") === "true")?.dataset.league,
      // STARTING slots only. The page renders bench rows in the same table,
      // so counting every .slot compared 9 against 18 and the failure message
      // printed the answer: QB,RB,RB,WR,WR,TE,FLEX,K,DEF,BN,BN,...
      slots: [...document.querySelectorAll("[data-content] .prow .slot")]
        .map((s) => s.textContent.trim()).filter((s) => !/^(BN|IR)$/.test(s)),
      rows: document.querySelectorAll("[data-content] .prow:not(.empty)").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.querySelector("[data-content]").textContent.replace(/\s+/g, " "),
    }));
    ok(`${w}px: CHOPPED PAINTS AT ALL`, r.active === "chop", `active league: ${r.active}`);
    ok(`${w}px: nine starting slots, not Joop's ten`,
      r.slots.length === 9, `${r.slots.length}: ${r.slots.join(",")}`);
    ok(`${w}px: and no superflex seat`, !r.slots.some((s) => /super/i.test(s)), r.slots.join(","));
    ok(`${w}px: no placeholder on a league nothing had ever rendered`,
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.body), r.body.slice(0, 200));
    ok(`${w}px: Chopped does not scroll sideways`, r.overflow <= 1, `${r.overflow}px`);
    ok(`${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
    await browser.close(); server.close();
  }
  {
    const { page, browser, server } = await open({
      width: 1280, height: 1100, hash: "#/chop/wire", sim: D_WED, week: 5 });
    const t = await page.evaluate(() =>
      document.querySelector("[data-content]").textContent.replace(/\s+/g, " "));
    // THE FIGURE IS WHAT IS LEFT, NOT THE BUDGET. The wire renders remaining
    // FAAB - $977 here, from a $1000 budget with the fixture's $23 spent - and
    // the first cut of this check asserted the budget itself and failed
    // against correct output. Joop renders $77 from the same $23 spent, so the
    // property worth asserting is that THIS league's budget is the one being
    // read: a tenfold budget shows a tenfold figure, and Joop's never appears.
    ok("CHOPPED reads its OWN budget — ten times Joop's, minus the same spend",
      /\$9\d\d/.test(t) && !/\$77\b/.test(t),
      (t.match(/\$[\d,]+/g) || []).join(" ") || "no dollar figure at all");
    ok("...and the bid refusal still holds on a league with ten times the budget",
      /No bid figure here/.test(t));
    await browser.close(); server.close();
  }
  // A league with no FAAB budget at all is the other end of the same branch.
  {
    const { page, browser, server, errors } = await open({
      width: 1280, height: 1100, hash: "#/joop/wire", sim: D_WED, week: 5, noFaab: true });
    const t = await page.evaluate(() =>
      document.querySelector("[data-content]").textContent.replace(/\s+/g, " "));
    // THE KNOB HAS TO HAVE APPLIED. As first written, deleting the noFaab
    // branch from the route handler left both checks below green, because
    // "$77 of FAAB left" contains neither "undefined" nor "$NaN". Phase 5 audit.
    const faabLeft = await page.evaluate(() => window.__ffh_state?.leagues?.joop?.faabLeft);
    ok("NO-BUDGET KNOB APPLIED: the league really has no FAAB this load",
      faabLeft === null, `state.leagues.joop.faabLeft = ${faabLeft}`);
    ok("...and the wire drops the FAAB sentence instead of printing a figure",
      !/of FAAB left/.test(t) && !/\$\d/.test(t), (t.match(/[^.]*FAAB[^.]*/) || [""])[0].slice(0, 160));
    ok("a league with NO budget says nothing about FAAB rather than $undefined",
      !/\bundefined\b|\$NaN/.test(t), t.slice(0, 200));
    ok("...and the page still renders a wire", t.length > 200 && errors.length === 0,
      errors.join("\n       "));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE CHEAP GUARDS (G13, G14, G15)");
  {
    const { page, browser, server } = await open({
      width: 1280, height: 1100, hash: "#/joop/lineup" });
    // G13. A typo'd custom property renders TRANSPARENT rather than broken, so
    // nothing else on this page catches it - and phase 5 came within one
    // verbatim copy of shipping two: the root sheet's chip rule carries
    // var(--warn) and var(--bad), neither of which exists in v2/app.css.
    //
    // PHASE 5 AUDIT: AS FIRST WRITTEN THIS COULD NOT FAIL. It walked computed
    // styles for a value still containing `var(`, but a browser never reports
    // one: an undefined custom property is "invalid at computed-value time"
    // and resolves to the property's initial or inherited value - transparent
    // for a background, the parent's colour for text. Two typo'd names
    // (`--c-surfac` on .card, `--c-mutee` on .note) both passed. So the check
    // now reads the SOURCE: every `var(--x)` the stylesheet references must be
    // declared somewhere in it, unless the reference carries its own fallback.
    const vars = await page.evaluate(() => {
      const refs = new Set(), defined = new Set();
      const scan = (rules) => {
        for (const r of rules) {
          if (r.cssRules) scan(r.cssRules);
          if (!r.style) continue;
          for (let i = 0; i < r.style.length; i++) {
            if (r.style[i].startsWith("--")) defined.add(r.style[i]);
          }
          // cssText, not getPropertyValue: a longhand under a shorthand that
          // uses var() reads back EMPTY ("pending substitution"), so a per-
          // property scan silently skips `padding:1px var(--sp2)`.
          for (const m of r.style.cssText.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) if (!m[2]) refs.add(m[1]);
        }
      };
      let sheets = 0;
      for (const sh of document.styleSheets) {
        try { scan(sh.cssRules); sheets += 1; } catch { /* cross-origin: not ours */ }
      }
      for (const el of document.querySelectorAll("[style]")) {
        for (const m of el.getAttribute("style").matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) if (!m[2]) refs.add(m[1]);
      }
      const bad = [...refs].filter((n) => !defined.has(n));
      return { bad, count: bad.length, refs: refs.size, defined: defined.size, sheets,
               bodyBg: getComputedStyle(document.body).backgroundColor };
    });
    ok("the variable scan actually READ the stylesheet",
      vars.sheets > 0 && vars.refs > 20 && vars.defined > 20,
      `${vars.sheets} sheets, ${vars.refs} names referenced, ${vars.defined} declared`);
    ok("NO UNRESOLVED CUSTOM PROPERTY ANYWHERE ON THE PAGE",
      vars.count === 0, `${vars.count}: ${vars.bad.join(", ")}`);
    ok("...and the theme actually applied to the body",
      vars.bodyBg !== "rgba(0, 0, 0, 0)" && vars.bodyBg !== "transparent", vars.bodyBg);

    // G14. The injury chip. The class was emitted from phase 1 and this
    // stylesheet carried no rule for it until phase 5, so these rendered as
    // bare text on two shipped pages while Methods called it permanent.
    const chips = await page.evaluate(() => {
      const cs2 = [...document.querySelectorAll("[data-content] .chip")];
      return cs2.map((c) => {
        const s = getComputedStyle(c);
        return { text: c.textContent.trim(), title: c.getAttribute("title") || "",
                 bg: s.backgroundColor, radius: s.borderTopLeftRadius,
                 padX: s.paddingLeft, rects: c.getClientRects().length };
      });
    });
    ok("there ARE injury designations on this page to check", chips.length > 0,
      "no .chip rendered at all");
    ok("EVERY CHIP CARRIES ITS FULL STATUS AS A TITLE, not just the abbreviation",
      chips.every((c) => c.title.length > 0 && c.title.length >= c.text.length),
      JSON.stringify(chips.slice(0, 4)));
    ok("THE CHIP RULE APPLIES — a filled, rounded, padded badge, not bare text",
      chips.every((c) => c.bg !== "rgba(0, 0, 0, 0)" && parseFloat(c.radius) > 0
                         && parseFloat(c.padX) > 0),
      JSON.stringify(chips.slice(0, 4)));
    ok("...and no chip wraps inside the cell it sits in",
      chips.every((c) => c.rects === 1), JSON.stringify(chips.map((c) => c.rects)));
    await browser.close(); server.close();
  }
  {
    // G15. Inverting `.win` highlights the LOSER in every row, and it survived
    // fifty mutations in phase 4 because node can only see that the class was
    // emitted. Whether it computes to anything a reader can see is a browser
    // question.
    const { page, browser, server } = await open({
      width: 1100, height: 900, hash: "#/joop/lineup" });
    for (const _ of [0, 1]) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.prow:not(.dead) [data-cmp]:not([aria-pressed="true"])')][0];
        if (b) b.click();
      });
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => { location.hash = "#/joop/compare"; });
    await page.waitForTimeout(350);
    const w = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".cmpt .mrow")];
      const styleOf = (td) => {
        const s = getComputedStyle(td);
        return `${s.color}|${s.backgroundColor}|${s.fontWeight}`;
      };
      let winners = 0, rowsWithWin = 0, sameAsLoser = [];
      for (const tr of rows) {
        const cells = [...tr.querySelectorAll(".cv")];
        const win = cells.filter((c) => c.classList.contains("win"));
        const lose = cells.filter((c) => !c.classList.contains("win"));
        if (!win.length || !lose.length) continue;
        rowsWithWin += 1; winners += win.length;
        if (styleOf(win[0]) === styleOf(lose[0])) {
          sameAsLoser.push(`${tr.querySelector(".ml")?.textContent.trim()}: ${styleOf(win[0])}`);
        }
      }
      return { rows: rows.length, rowsWithWin, winners, sameAsLoser,
               manyWinners: rows.some((tr) =>
                 [...tr.querySelectorAll(".cv.win")].length > 1) };
    });
    ok("there are comparison rows with a winner and a loser to compare",
      w.rowsWithWin > 0, `${w.rows} metric rows, ${w.rowsWithWin} with a decided winner`);
    ok("A WINNING CELL COMPUTES DIFFERENTLY FROM A LOSING ONE",
      w.sameAsLoser.length === 0,
      `identical styling in: ${w.sameAsLoser.join("; ")}`);
    ok("...and no row crowns more than one winner",
      w.manyWinners === false, "a metric row highlighted both cells");
    await browser.close(); server.close();
  }

  {
    // G10, PORTED AFTER ALL. Phase 5 recorded FantasyCalc-unreachable as a
    // deliberate non-port; the audit disagreed, because the README's own rule
    // is "keep the deliberate failure paths", the old harness carried it, and
    // it is the only proof that Compare HIDES the value rows rather than
    // guessing them when the market layer does not arrive.
    const { page, browser, server, errors } = await open({
      width: 1100, height: 900, hash: "#/joop/lineup", fcalcOk: false });
    for (const _ of [0, 1]) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.prow:not(.dead) [data-cmp]:not([aria-pressed="true"])')][0];
        if (b) b.click();
      });
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => { location.hash = "#/joop/compare"; });
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => ({
      knob: window.__ffh_state?.leagues?.joop?.fcalc?.ok,
      warn: document.querySelector("[data-content] .frow.warn")?.textContent.replace(/\s+/g, " ").trim(),
      labels: [...document.querySelectorAll(".cmpt .mrow .ml")].map((m) => m.textContent.trim()),
      body: document.querySelector("[data-content]").textContent.replace(/\s+/g, " "),
    }));
    ok("FANTASYCALC DOWN: the knob applied - the market layer really failed",
      r.knob === false, `fcalc.ok = ${r.knob}`);
    ok("FANTASYCALC DOWN: Compare says so in plain words",
      /Market values unavailable this load/.test(r.warn || ""), r.warn || "no .frow.warn");
    ok("FANTASYCALC DOWN: the comparison still renders its other rows",
      r.labels.length >= 4 && r.labels.includes("Projected"), r.labels.join(", "));
    ok("FANTASYCALC DOWN: the value and rank rows are HIDDEN, not shown blank or guessed",
      !r.labels.some((l) => /^Market (value|rank)$/.test(l)), r.labels.join(", "));
    ok("FANTASYCALC DOWN: no placeholder leaked",
      !/\bundefined\b|\bNaN\b|\[object Object\]/.test(r.body), r.body.slice(0, 160));
    ok("FANTASYCALC DOWN: no page errors beyond the deliberate outage",
      errors.filter((e) => !/net::ERR_FAILED/.test(e)).length === 0,
      errors.filter((e) => !/net::ERR_FAILED/.test(e)).join("\n       "));
    await browser.close(); server.close();
  }

  console.log("\nPHASE 5 — THE CHIP MEASUREMENT PASS (G14)");
  // The reason phase 4 deferred this rule: a padded badge adds width INSIDE
  // the player-name cell on two pages that were already live and already
  // measured, and app.css:176 plus constraint 5 record a name column
  // collapsing to 59px with exactly that class of change. Measured on both
  // pages that emit a chip, at the four widths where it could bite.
  //
  // PHASE 5 AUDIT. As first committed, every measurement in this block was
  // vacuous: the name text node was looked for as a direct child of .nm, but
  // the name sits inside .rowtog, so every row hit `continue`, `narrowest`
  // stayed unset and passed as null, and `worst` stayed 1. Mutations making
  // the chip 120px wider or forcing a 150px min-width all passed. And Wire
  // emits no chip at all - it has no .nm cell - so that half measured an empty
  // page. Wire is replaced by Ball Knowers, which carries four chips and the
  // narrowest name column on the site (131px at 320), and each scenario now
  // has to FIND names and chips before its measurement counts.
  for (const hash of ["#/joop/lineup", "#/bku/lineup"]) {
    for (const w of [320, 360, 390, 560]) {
      const { page, browser, server, errors } = await open({ width: w, height: 1000, hash });
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        let worst = 1, worstName = "", narrowest = 9999, found = 0;
        for (const c of document.querySelectorAll("[data-content] .nm")) {
          narrowest = Math.min(narrowest, Math.round(c.getBoundingClientRect().width));
          const tn = [...(c.querySelector(":scope > .rowtog") || c).childNodes]
            .find((n) => n.nodeType === 3 && n.textContent.trim());
          if (!tn) continue;
          found += 1;
          const rr = document.createRange(); rr.selectNodeContents(tn);
          const n = rr.getClientRects().length || 1;
          if (n > worst) { worst = n; worstName = tn.textContent.trim(); }
        }
        return { overflow: doc.scrollWidth - doc.clientWidth,
                 worst, worstName,
                 narrowest: narrowest === 9999 ? null : narrowest, found,
                 cells: document.querySelectorAll("[data-content] .nm").length,
                 chips: document.querySelectorAll("[data-content] .nm .chip").length,
                 // The roster table's OWN width against its wrapper. The page
                 // lets a wide table scroll inside itself rather than scroll the
                 // document, so a fat chip never shows up as document overflow:
                 // it widens the table, which slides the projection column off
                 // a phone. Measured by the audit: a chip 104px wider left every
                 // other check here green while the table ran 415px in a 286px
                 // wrapper at 320 and 390. The fold design says name and
                 // projection are always visible, so on a phone it must fit.
                 tableOver: (() => { const t = document.querySelector("[data-content] table");
                   return t ? t.parentElement.scrollWidth - t.parentElement.clientWidth : null; })() };
      });
      const cap = w <= 360 ? 2 : 1;
      ok(`chip pass ${hash} ${w}px: THERE ARE CHIPS HERE TO MEASURE, and the probe found the names`,
        m.chips > 0 && m.found > 0 && m.found === m.cells,
        `${m.chips} chips, name found in ${m.found} of ${m.cells} cells`);
      ok(`chip pass ${hash} ${w}px: the badge did not collapse the name column`,
        m.narrowest !== null && m.narrowest >= 110, `narrowest name cell ${m.narrowest}px`);
      ok(`chip pass ${hash} ${w}px: and did not shred a long name`,
        m.worst <= cap, `worst ${m.worst} lines, cap ${cap} ("${m.worstName}")`);
      ok(`chip pass ${hash} ${w}px: and the roster table still fits without scrolling inside itself`,
        m.tableOver !== null && m.tableOver <= 1, `table overflows its wrapper by ${m.tableOver}px`);
      ok(`chip pass ${hash} ${w}px: and did not push the page sideways`,
        m.overflow <= 1, `overflowing by ${m.overflow}px`);
      ok(`chip pass ${hash} ${w}px: no page errors`, errors.length === 0, errors.join("\n       "));
      await browser.close(); server.close();
    }
  }

  console.log("\nPHASE 5 AUDIT — THE KICKOFF RE-SOLVE, FOR REAL (G16)");
  // Phase 5 recorded this as a non-port on the grounds that the repaint checks
  // "already exercise the effect of" the watcher. They do not: __ffh_repaint()
  // is paint() alone. The watcher's tick (pipeline.js:566-602) RELOADS every
  // league - new byId, new player objects - and must re-attach usage, market,
  // FantasyCalc, rest-of-season, waivers and the recap by hand, and its own
  // comment says what missing one costs: the layer "vanishes from the page at
  // the first kickoff of the afternoon and never returns". No layer of this
  // project's tests ran that path. It costs one real 30-second tick.
  {
    // Find a starter who has NOT kicked off at the default Sunday clock, then
    // put the clock 12 seconds before his kickoff, so the first tick (30s after
    // boot) lands after it.
    let kick = null, due = 0;
    {
      const { page, browser, server } = await open({ width: 1280, height: 900, hash: "#/joop/lineup" });
      ({ kick, due } = await page.evaluate(() => {
        const now = Date.now();
        const ks = (window.__ffh_state?.leagues?.joop?.roster || [])
          .filter((p) => !p.locked && p.game?.kickoffUTC)
          .map((p) => Number(p.game.kickoffUTC)).filter((t) => t > now).sort((a, b) => a - b);
        // Everyone in that slot locks together - four players share the
        // fixture's 4:25 window.
        return { kick: ks[0] ?? null, due: ks.filter((t) => t === ks[0]).length };
      }));
      await browser.close(); server.close();
    }
    ok("G16: the fixture has an unlocked starter with a kickoff still to come", kick !== null);
    if (kick !== null) {
      const { page, browser, server, errors } = await open({
        width: 1280, height: 900, hash: "#/joop/lineup", sim: kick - 12000 });
      const before = await page.evaluate(() => {
        window.__g16 = { byId: window.__ffh_state?.leagues?.joop?.byId, topbar: document.querySelector(".topbar") };
        const L = window.__ffh_state?.leagues?.joop;
        const n = (f) => (L?.roster || []).filter(f).length;
        return { locked: n((p) => p.locked), usage: n((p) => p.usage), market: n((p) => p.market),
                 fcalc: n((p) => p.fcalc), ros: n((p) => p.ros), waivers: !!L?.waivers?.any,
                 recap: !!L?.recap, lockIcons: document.querySelectorAll("[data-content] .nmark.lock").length };
      });
      await page.waitForTimeout(34000);
      const after = await page.evaluate(() => {
        const L = window.__ffh_state?.leagues?.joop;
        const n = (f) => (L?.roster || []).filter(f).length;
        return { locked: n((p) => p.locked), usage: n((p) => p.usage), market: n((p) => p.market),
                 fcalc: n((p) => p.fcalc), ros: n((p) => p.ros), waivers: !!L?.waivers?.any,
                 recap: !!L?.recap, lockIcons: document.querySelectorAll("[data-content] .nmark.lock").length,
                 reloaded: window.__g16.byId !== L?.byId,
                 sameTopbar: window.__g16.topbar === document.querySelector(".topbar") };
      });
      const d = `before ${JSON.stringify(before)}\n       after  ${JSON.stringify(after)}`;
      ok("G16: THE WATCHER FIRED — the league was actually reloaded, not just repainted",
        after.reloaded === true, d);
      ok(`G16: exactly the ${due} players in that kickoff window are now locked, in state AND on the page`,
        after.locked === before.locked + due && after.lockIcons === before.lockIcons + due, d);
      // (`ros` is attached only to players a comparison has asked about, so it
      // is zero on a fresh lineup and proves nothing here; Compare covers it.)
      for (const k of ["usage", "market", "fcalc"]) {
        ok(`G16: the ${k} layer was re-attached after the reload (${before[k]} players before)`,
          before[k] > 0 && after[k] === before[k], d);
      }
      ok("G16: the wire and the recap were rebuilt, not dropped",
        after.waivers === before.waivers && after.recap === before.recap && before.waivers, d);
      ok("G16: the shell survived the re-solve", after.sameTopbar === true);
      ok("G16: no page errors across the tick", errors.length === 0, errors.join("\n       "));
      await browser.close(); server.close();
    }
  }

  console.log(`\nv2 render: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

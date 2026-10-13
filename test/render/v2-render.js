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

async function open({ width, height, hash = "", usageOk = true, vacancyOk = true, scheduleOk = true }) {
  const server = await serve();
  const port = server.address().port;
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: "America/New_York" });
  await ctx.addInitScript(`{
    const REAL = Date.now.bind(Date), T0 = REAL(), SIM = ${SIM};
    const OD = Date;
    window.Date = class extends OD { constructor(...a){ super(...(a.length?a:[Date.now()])); } static now(){ return SIM + (REAL()-T0); } };
    Object.setPrototypeOf(window.Date, OD);
    Date.now = () => SIM + (REAL() - T0);
  }`);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const dataHits = [];
  await page.route("**://api.sleeper.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/v1/state/nfl") return json(route, { season: F.SEASON, week: F.WEEK, display_week: F.WEEK });
    if (p === "/v1/players/nfl/trending/add") { const r = F.riser(); return json(route, r ? [{ player_id: r, count: 8421 }] : []); }
    let m = p.match(/^\/v1\/league\/(\d+)$/);
    if (m) return json(route, { ...F.LEAGUES[m[1]], league_id: m[1] });
    m = p.match(/^\/v1\/league\/(\d+)\/rosters$/);
    if (m) {
      const S = { "1389373222666932224": F.starters14, "1393723474328981504": F.starters8,
                  "1403519228983754752": F.startersChop };
      return json(route, F.rostersFor(m[1], S[m[1]] || F.starters14));
    }
    if (/^\/projections\/nfl\/player\/(.+)$/.test(p)) return json(route, F.seasonWeeks(p.split("/").pop()));
    if (/^\/projections\/nfl\/\d+\/\d+$/.test(p)) return json(route, F.universe);
    return json(route, []);
  });
  await page.route("**/leagues.json", (route) => { dataHits.push(route.request().url()); route.continue(); });
  await page.route("**/data/usage_*.json", (route) => {
    dataHits.push(route.request().url());
    if (!usageOk) return route.fulfill({ status: 404, body: "not found" });
    const base = F.usagePayload(), extra = F.vacancyPayload().__usage || {};
    return json(route, Object.keys(extra).length ? { ...base, p: { ...base.p, ...extra } } : base);
  });
  await page.route("**/data/vacancy_*.json", (route) => {
    dataHits.push(route.request().url());
    if (!vacancyOk) return route.fulfill({ status: 404, body: "not found" });
    return json(route, F.vacancyPayload());
  });
  await page.route("**://api.github.com/**", (route) => json(route, {
    assets: [{ name: `stats_player_week_${F.SEASON}.csv`, updated_at: "2026-09-15T09:00:00Z" }] }));
  await page.route("**://api.fantasycalc.com/**", (route) => {
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
  await page.waitForTimeout(900);
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
  for (const w of [320, 360, 390, 560, 768, 820, 1024, 1280]) {
    const { page, browser, server, errors } = await open({ width: w, height: 900, hash: "#/joop/lineup" });
    const m = await page.evaluate(() => {
      const cell = document.querySelector("[data-content] tbody tr .nm");
      const doc = document.documentElement;
      if (!cell) return null;
      // Count real line boxes over the NAME text node. A height threshold is
      // not a wrap test: the cell also holds a position label, and row padding
      // is a design choice that would make every row look wrapped.
      const textNode = [...cell.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      let lines = 1;
      if (textNode) {
        const r = document.createRange(); r.selectNodeContents(textNode);
        lines = r.getClientRects().length || 1;
      }
      // And the worst case on the page, not just the first row.
      let worst = 1, worstName = "";
      for (const c of document.querySelectorAll("[data-content] tbody tr .nm")) {
        const tn = [...c.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (!tn) continue;
        const rr = document.createRange(); rr.selectNodeContents(tn);
        const n = rr.getClientRects().length || 1;
        if (n > worst) { worst = n; worstName = tn.textContent.trim(); }
      }
      return {
        name: Math.round(cell.getBoundingClientRect().width),
        overflow: doc.scrollWidth - doc.clientWidth,
        lines, worst, worstName,
      };
    });
    if (!m) { fail++; console.log(`  FAIL ${w}px: no lineup row rendered`); }
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

  console.log(`\nv2 render: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

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
  for (const w of [320, 360, 390, 560, 768, 820, 1024, 1280, 1440]) {
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

  console.log(`\nv2 render: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

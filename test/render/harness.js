const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const F = require("./fixture.js");

const SITE = path.join(__dirname, "site"), UP = path.join(__dirname, "up");
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".json":"application/json" };
const json = (route, body) => route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(body) });

// Simulated Sunday 2026-09-13, 13:40 ET - after the 1pm kickoffs.
const SIM = Date.UTC(2026, 8, 13, 17, 40, 0);
// Ten seconds before the real 1:00pm ET Sunday kickoffs. With the clock running
// at real speed from here, a 45-second wait genuinely crosses a kickoff and
// makes the 30-second re-solve fire for real.
const SIM_PRELOCK = Date.UTC(2026, 8, 13, 16, 59, 50);

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      const f = path.join(SITE, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : req.url.split("?")[0]);
      fs.readFile(f, (e, b) => e
        ? (rq.writeHead(404), rq.end("no"))
        : (rq.writeHead(200, { "content-type": MIME[path.extname(f)] || "text/plain" }), rq.end(b)));
    }).listen(0, "127.0.0.1", () => res(s));
  });
}

async function run({ label, width, height, fcalcOk = true, scheduleOk = true, select = [],
                     league = null, tz = "America/New_York", sim = SIM, settle = 700,
                     waitAfter = 0, usageOk = true, usage = null, upstreamUpdatedAt = null,
                     seedLog = null, week = null, trendingOk = true, noFaab = false,
                     vacancyOk = true, vacancy = null }) {
  const server = await serve();
  const port = server.address().port;
  // The Chromium path is not stable across containers - PLAYWRIGHT_BROWSERS_PATH
  // holds a versioned directory whose name changes with the image. A hardcoded
  // path cost a session two round-trips before anything rendered, so probe.
  const CANDIDATES = [
    process.env.CHROME_PATH,
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
    ...(() => { try {
      return fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-"))
        .map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`);
    } catch { return []; } })(),
  ].filter(Boolean).filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const browser = await chromium.launch(
    CANDIDATES.length ? { executablePath: CANDIDATES[0] } : {});
  const ctx = await browser.newContext({ viewport:{ width, height }, timezoneId: tz });
  await ctx.addInitScript(`{
    const REAL = Date.now.bind(Date), T0 = REAL(), SIM = ${sim};
    Date.now = () => SIM + (REAL() - T0);
    const OD = Date;
    window.Date = class extends OD { constructor(...a){ super(...(a.length?a:[Date.now()])); } static now(){ return SIM + (REAL()-T0); } };
    Object.setPrototypeOf(window.Date, OD);
  }`);
  if (seedLog) {
    await ctx.addInitScript(`try{localStorage.setItem("ffh.decisions.v1", ${JSON.stringify(JSON.stringify(seedLog))});}catch(e){}`);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // Chromium in this container cannot reach the internet, so EVERY upstream
  // host is intercepted. Sleeper and FantasyCalc come from the fixture;
  // nflverse and DynastyProcess are served as the REAL bytes fetched with
  // curl, so the join, the DST conversion and the spreads are all exercised
  // against production data and only the transport is local.
  await page.route("**://api.sleeper.com/**", (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (p === "/v1/state/nfl") {
      const wk = week || F.WEEK;
      return json(route, { season: F.SEASON, display_week: wk, week: wk });
    }
    if (p === "/v1/players/nfl/trending/add") {
      if (!trendingOk) return route.abort("failed");
      const r = F.riser();
      return json(route, r ? [{ player_id: r, count: 8421 }] : []);
    }
    let m = p.match(/^\/v1\/league\/(\d+)$/);
    if (m) {
      const L = F.LEAGUES[m[1]];
      const settings = noFaab ? { playoff_week_start: 15 } : L.settings;
      return json(route, { ...L, settings, league_id: m[1] });
    }
    m = p.match(/^\/v1\/league\/(\d+)\/rosters$/);
    if (m) return json(route, F.rostersFor(m[1], m[1] === "1389373222666932224" ? F.starters14 : F.starters8));
    if (/^\/projections\/nfl\/player\/(.+)$/.test(p)) return json(route, F.seasonWeeks(p.split("/").pop()));
    if (/^\/projections\/nfl\/\d+\/\d+$/.test(p)) return json(route, F.universe);
    return json(route, []);
  });
  // The usage mirror, served from the fixture rather than the repo copy so a
  // scenario can control what week it goes through and when it was built.
  const vacPayload = vacancy || F.vacancyPayload();
  await page.route("**/data/usage_*.json", (route) => {
    if (!usageOk) return route.fulfill({ status: 404, body: "not found" });
    const base = usage || F.usagePayload();
    // The vacancy fixture carries the usage rows its cross-check needs. They
    // are merged here rather than duplicated in usagePayload(), so the two
    // fixtures cannot drift apart about who the disagreeing player is.
    const extra = vacPayload.__usage || {};
    return json(route, Object.keys(extra).length
      ? { ...base, p: { ...base.p, ...extra } } : base);
  });
  // The vacancy layer. A 404 must remove the block, not break the page.
  await page.route("**/data/vacancy_*.json", (route) => {
    if (!vacancyOk) return route.fulfill({ status: 404, body: "not found" });
    return json(route, vacPayload);
  });
  // api.github.com IS browser-readable cross-origin - that is the whole reason
  // the staleness check can exist when the asset bytes cannot be fetched.
  await page.route("**://api.github.com/**", (route) => json(route, {
    assets: [{ name: `stats_player_week_${F.SEASON}.csv`,
               updated_at: upstreamUpdatedAt || "2026-09-15T09:00:00Z" }],
  }));
  await page.route("**://api.fantasycalc.com/**", (route) => {
    if (!fcalcOk) return route.abort("failed");
    const q = new URL(route.request().url()).searchParams;
    return json(route, F.fcalc(Number(q.get("numQbs")) || 1));
  });
  await page.route("**://raw.githubusercontent.com/**", (route) => {
    const u = route.request().url();
    if (!scheduleOk && u.includes("games.csv")) return route.abort("failed");
    const file = u.includes("games.csv") ? "games.csv"
               : u.includes("fp_latest_weekly") ? "fp.csv"
               : u.includes("db_playerids") ? "ids.csv" : null;
    if (!file) return route.abort("failed");
    return route.fulfill({ status:200, contentType:"text/csv", body: fs.readFileSync(path.join(UP, file)) });
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  if (league) { await page.click(`.tab[data-k="${league}"]`); await page.waitForTimeout(150); }
  for (const id of select) {
    await page.click(`[data-sel="${id}"]`);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(settle);
  if (waitAfter) await page.waitForTimeout(waitAfter);

  const report = await page.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() || null;
    const q = (s) => document.querySelector(s);
    const cmp = q(".cmp");
    const rows = [...document.querySelectorAll(".cmpt .mrow")].map((tr) => ({
      label: tr.querySelector(".ml")?.textContent.trim(),
      cells: [...tr.querySelectorAll(".cv")].map((td) => ({ t: td.textContent.trim(), win: td.classList.contains("win") })),
    }));
    const de = document.documentElement;
    return {
      hSlop: de.scrollWidth - de.clientWidth,
      cmpPresent: !!cmp,
      verdict: q(".cmp .verdict")?.textContent.trim() || null,
      verdictSub: q(".cmp .sub")?.textContent.trim().slice(0, 170) || null,
      headers: [...document.querySelectorAll(".cmpt .cp .cn")].map((e) => e.textContent.trim()),
      rows,
      droppedWarn: [...document.querySelectorAll(".cmp .warn")].map((e) => e.textContent.replace(/\s+/g," ").trim().slice(0,110)),
      tableCols: (() => { const t = q("section.block table"); return t ? t.rows[0].cells.length : 0; })(),
      emptyRow: (() => {
        const t = q("section.block table"); if (!t) return null;
        const tr = [...t.rows].find((r) => r.querySelector("td.empty"));
        if (!tr) return "none";
        return [...tr.cells].map((c) => c.className + (c.colSpan > 1 ? `:${c.colSpan}` : "")).join(",");
      })(),
      rowCellCounts: (() => {
        const t = q("section.block table"); if (!t) return [];
        return [...new Set([...t.rows].map((r) => [...r.cells].reduce((n, c) => n + c.colSpan, 0)))];
      })(),
      lockedCount: (document.body.innerText.match(/is locked|are locked/) || []).length,
      headerClasses: (() => { const t = q("table"); return t ? [...t.rows[0].cells].map((c) => c.className) : []; })(),
      nameColPx: Math.round(q("table .nm")?.getBoundingClientRect().width || 0),
      unresolvedVars: [...document.querySelectorAll("*")].some((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg.includes("var(");
      }),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      dayNote: txt(".daynote"),
      order: [...document.querySelectorAll("#app > section")].map((el) => el.className),
      // The vacancy block, captured the same way the wire is. Asserting only
      // that the section EXISTS would pass on a block rendering "undefined"
      // in every sentence - which is precisely the class of bug the copy in
      // here is most exposed to, since most of its fields are optional.
      // The signal-disagreement block. Captured as TEXT for the same reason
      // the vacancy block is: nearly every field in it is optional (a
      // resolution may be absent, an `ask` may be absent, the injury reason
      // may be absent), so "the section exists" would pass on a block reading
      // "projected undefined but did not play in week undefined".
      signalsHd: txt(".calls.signals .hd"),
      signalsLines: [...document.querySelectorAll(".calls.signals .call .line")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      signalsWhy: [...document.querySelectorAll(".calls.signals .call .why")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      signalChips: [...document.querySelectorAll("td.nm .chip")]
        .map((e) => `${e.textContent.trim()}|${e.getAttribute("title") || ""}`),
      vacancyHd: txt(".calls.vacancy .hd"),
      vacancyLines: [...document.querySelectorAll(".calls.vacancy .call .line")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      vacancyWhy: [...document.querySelectorAll(".calls.vacancy .call .why")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      vacancySub: txt(".calls.vacancy .sub"),
      vacancySubhd: txt(".calls.vacancy .subhd"),
      waivers: txt(".calls.waivers .hd"),
      waiverLines: [...document.querySelectorAll(".calls.waivers .call .line")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      recapHd: txt(".calls.recap .hd"),
      recapLines: [...document.querySelectorAll(".calls.recap .call .line")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      usageFooter: [...document.querySelectorAll("footer .frow")]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim())
        .filter((t) => /[Uu]sage/.test(t))[0] || null,
      bidMentions: (document.body.innerText.match(/bid \$\d/gi) || []).length,
      faabText: (document.body.innerText.match(/(FAAB[^.·\n]{0,24})/i) || [])[1] || null,
      dollarFigures: (document.body.innerText.match(/\$\d[\d,]*/g) || []),
      // Does recordLineup actually write a usable `suggested` list? It read
      // `.id` off the {slot, player} wrapper and produced [] every time.
      writtenLog: (() => {
        try {
          const rows = JSON.parse(localStorage.getItem("ffh.decisions.v1") || "[]");
          return rows.filter((r) => r.kind === "lineup")
            .map((r) => ({ wk: r.week, lg: r.leagueKey,
                           started: r.started.length, suggested: r.suggested.length }));
        } catch { return "unreadable"; }
      })(),
    };
  });

  await browser.close(); server.close();
  return { label, width, errors, ...report };
}

(async () => {
  const H = F.H;
  const SUN = Date.UTC(2026, 8, 13, 17, 40, 0);   // Sunday 13:40 ET
  const MON = Date.UTC(2026, 8, 14, 14, 0, 0);
  const TUE = Date.UTC(2026, 8, 15, 14, 0, 0);
  const WED = Date.UTC(2026, 8, 16, 14, 0, 0);
  const THU = Date.UTC(2026, 8, 17, 14, 0, 0);

  // A recorded decision from week 2, to be graded on Tuesday of week 4.
  const seedLog = [{
    kind: "lineup", leagueKey: "joop", season: "2026", week: 2,
    started: [H.wrB], suggested: [H.wrPoints], threshold: 1.6,
  }];

  // --- signal-disagreement fixtures ---------------------------------------
  // Each removes the LAST mirrored week from a rostered starter, which is what
  // "projected to play, did not play" looks like in the data, and then varies
  // only what the depth chart says about him. The four outcomes are opposite
  // in meaning and identical in shape, which is exactly why they need
  // separate scenarios rather than one.
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
  const QB = F.H.qb1;
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

  const scenarios = [
    { label:"laptop · mixed-position pair (RB vs WR)", width:1440, height:900,
      select:[H.rbValue, H.wrPoints] },
    { label:"laptop · same-position pair (WR vs WR)", width:1440, height:900,
      select:[H.wrA, H.wrB] },
    { label:"laptop · dead heat inside the threshold", width:1440, height:900,
      select:[H.tieA, H.tieB] },
    { label:"laptop · pool of five, mixed positions", width:1440, height:900,
      select:[H.rbValue, H.wrPoints, H.wrA, H.tieA, H.noMarket] },
    { label:"laptop · superflex league board", width:1440, height:900,
      league:"bku", select:[H.qb1, H.rbValue] },
    { label:"phone · mixed-position pair", width:390, height:844,
      select:[H.rbValue, H.wrPoints] },
    { label:"phone · pool of five", width:390, height:844,
      select:[H.rbValue, H.wrPoints, H.wrA, H.tieA, H.noMarket] },
    { label:"laptop · FantasyCalc unreachable", width:1440, height:900,
      fcalcOk:false, select:[H.rbValue, H.wrPoints] },
    { label:"laptop · no schedule at all", width:1440, height:900,
      scheduleOk:false, select:[H.wrA, H.wrB] },
    { label:"laptop · nothing selected (must be silent)", width:1440, height:900, select:[] },
    { label:"laptop · one selected (must prompt, not compare)", width:1440, height:900,
      select:[H.rbValue] },
    { label:"laptop · a player with no projection at all", width:1440, height:900,
      select:[H.rbValue, "999999"] },
    { label:"laptop · unknown team code in a comparison", width:1440, height:900,
      select:[H.bogus, H.wrA] },
    { label:"laptop · kickoff flips under an open page", width:1440, height:900,
      sim: SIM_PRELOCK, select:[H.rbValue, H.wrPoints], waitAfter: 45000 },

    // --- the day-shaped page ------------------------------------------------
    { label:"DAY Sunday", width:1440, height:900, sim: SUN },
    { label:"DAY Monday", width:1440, height:900, sim: MON },
    { label:"DAY Tuesday (recap + wire on top)", width:1440, height:900, sim: TUE,
      week: 4, seedLog },
    { label:"DAY Wednesday (wire first)", width:1440, height:900, sim: WED, week: 4, seedLog },
    { label:"DAY Thursday", width:1440, height:900, sim: THU, week: 4, seedLog },
    { label:"DAY Tuesday on a phone", width:390, height:844, sim: TUE, week: 4, seedLog },

    // --- the usage mirror ---------------------------------------------------
    { label:"USAGE mirror missing entirely", width:1440, height:900,
      usageOk:false, select:[H.rbValue, H.wrPoints] },
    { label:"USAGE mirror behind upstream", width:1440, height:900,
      upstreamUpdatedAt: "2026-09-15T21:00:00Z" },
    { label:"USAGE mirror up to date", width:1440, height:900,
      upstreamUpdatedAt: "2026-09-15T08:00:00Z" },

    // --- the wire -----------------------------------------------------------
    { label:"WIRE trending unreachable", width:1440, height:900, trendingOk:false },
    { label:"WIRE Tuesday, phone", width:390, height:844, sim: TUE, week: 4 },

    // --- the recap ----------------------------------------------------------
    { label:"RECAP week not published yet", width:1440, height:900, sim: TUE, week: 4,
      seedLog, usage: { ...F.usagePayload(), through_week: 1 } },
    { label:"FAAB a league with no budget at all", width:1440, height:900, noFaab: true },
    { label:"SNAPS did not publish this build", width:1440, height:900,
      usage: { ...F.usagePayload(),
               sources: { stats_player:{ok:true,rows:900}, snap_counts:{ok:false,rows:0} } } },
    { label:"DAY Monday, compare reachable", width:1440, height:900, sim: MON,
      select:[H.rbValue, H.wrPoints] },

    // --- the vacancy block --------------------------------------------------
    { label:"VACANCY partial week (only 2 of 32 clubs filed)",
      width:1440, height:900, sim: WED, week: 4,
      vacancy: F.vacancyPayload({ week: 2, teamsReported: 2 }) },
    { label:"VACANCY phone", width:390, height:844, sim: WED, week: 4,
      vacancy: F.vacancyPayload({ week: 2, teamsReported: 2 }) },
    { label:"VACANCY layer missing entirely", width:1440, height:900,
      sim: WED, week: 4, vacancyOk: false },
    { label:"VACANCY nothing to say (must be silent)", width:1440, height:900,
      sim: WED, week: 4, vacancy: F.vacancyEmpty() },
    { label:"VACANCY chart and usage disagree, heir unprojected",
      width:1440, height:900, sim: WED, week: 4, vacancy: F.vacancyDisagree() },
    { label:"VACANCY disagreement on a phone", width:390, height:844,
      sim: WED, week: 4, vacancy: F.vacancyDisagree() },
    // --- SIGNALS ------------------------------------------------------------
    { label:"SIGNALS absent, depth chart says he is back", width:1440, height:900,
      usage: dropLastWeek(QB), vacancy: SIG_STARTER, select:[] },
    { label:"SIGNALS absent, and ruled out again this week", width:1440, height:900,
      usage: dropLastWeek(QB), vacancy: SIG_RULEDOUT, select:[] },
    { label:"SIGNALS absent, and genuinely a backup", width:1440, height:900,
      usage: dropLastWeek(QB), vacancy: SIG_BACKUP, select:[] },
    { label:"SIGNALS absent with NO depth entry (question must stay open)", width:1440, height:900,
      usage: dropLastWeek(QB), select:[] },
    { label:"SIGNALS absent, no vacancy layer at all", width:1440, height:900,
      usage: dropLastWeek(QB), vacancyOk:false, select:[] },
    // Genuine silence: with no mirror there is nothing to disagree WITH, so
    // the block must not draw at all. (The base fixture's own players already
    // carry a real disagreement, so "default scenario" is not a silence test -
    // which is the trap the vacancy scenarios fell into: two labels, one
    // rendering.)
    { label:"SIGNALS no mirror at all (block must be absent)", width:1440, height:900,
      usageOk:false, select:[] },
    { label:"SIGNALS on a phone", width:390, height:844,
      usage: dropLastWeek(QB), vacancy: SIG_STARTER, select:[] },

    { label:"VACANCY fully-reported week (no caveat)", width:1440, height:900,
      sim: WED, week: 4, vacancy: F.vacancyPayload({ week: 2, teamsReported: 32 }) },
  ];
  const out = [];
  for (const s of scenarios) out.push(await run(s));
  console.log(JSON.stringify(out, null, 1));
})();

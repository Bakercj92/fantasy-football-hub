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
                     seedLog = null, week = null, trendingOk = true, noFaab = false }) {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
  await page.route("**/data/usage_*.json", (route) => {
    if (!usageOk) return route.fulfill({ status: 404, body: "not found" });
    return json(route, usage || F.usagePayload());
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
  ];
  const out = [];
  for (const s of scenarios) out.push(await run(s));
  console.log(JSON.stringify(out, null, 1));
})();

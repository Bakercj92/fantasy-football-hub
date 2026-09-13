const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const F = require("./fixture.js");

const SITE = path.join(__dirname, "site"), UP = path.join(__dirname, "up");
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".json":"application/json" };
const json = (route, body) => route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(body) });

// Simulated Sunday 2026-09-13, 13:40 ET - after the 1pm kickoffs.
const SIM = Date.UTC(2026, 8, 13, 17, 40, 0);

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

async function run({ label, width, height, fcalcOk = true, scheduleOk = true, select = [], league = null, tz = "America/New_York" }) {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport:{ width, height }, timezoneId: tz });
  await ctx.addInitScript(`{
    const REAL = Date.now.bind(Date), T0 = REAL(), SIM = ${SIM};
    Date.now = () => SIM + (REAL() - T0);
    const OD = Date;
    window.Date = class extends OD { constructor(...a){ super(...(a.length?a:[Date.now()])); } static now(){ return SIM + (REAL()-T0); } };
    Object.setPrototypeOf(window.Date, OD);
  }`);
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
    if (p === "/v1/state/nfl") return json(route, { season: F.SEASON, display_week: F.WEEK, week: F.WEEK });
    let m = p.match(/^\/v1\/league\/(\d+)$/);
    if (m) return json(route, { ...F.LEAGUES[m[1]], league_id: m[1] });
    m = p.match(/^\/v1\/league\/(\d+)\/rosters$/);
    if (m) return json(route, F.rostersFor(m[1], m[1] === "1389373222666932224" ? F.starters14 : F.starters8));
    if (/^\/projections\/nfl\/player\/(.+)$/.test(p)) return json(route, F.seasonWeeks(p.split("/").pop()));
    if (/^\/projections\/nfl\/\d+\/\d+$/.test(p)) return json(route, F.universe);
    return json(route, []);
  });
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
  await page.waitForTimeout(700);

  const report = await page.evaluate(() => {
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
      tableCols: (() => { const t = q("table"); return t ? t.rows[0].cells.length : 0; })(),
      headerClasses: (() => { const t = q("table"); return t ? [...t.rows[0].cells].map((c) => c.className) : []; })(),
      nameColPx: Math.round(q("table .nm")?.getBoundingClientRect().width || 0),
      unresolvedVars: [...document.querySelectorAll("*")].some((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg.includes("var(");
      }),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  await browser.close(); server.close();
  return { label, width, errors, ...report };
}

(async () => {
  const H = F.H;
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
  ];
  const out = [];
  for (const s of scenarios) out.push(await run(s));
  console.log(JSON.stringify(out, null, 1));
})();

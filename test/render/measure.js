const { chromium } = require("playwright");
const http=require("http"),fs=require("fs"),path=require("path");
const F=require("./fixture.js");
const SITE=path.join(__dirname,"site"),UP=path.join(__dirname,"up");
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json"};
const json=(r,b)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(b)});
const SIM=Date.UTC(2026,8,13,17,40,0);
const serve=()=>new Promise(res=>{const s=http.createServer((q,p)=>{const f=path.join(SITE,q.url==="/"?"index.html":q.url.split("?")[0]);fs.readFile(f,(e,b)=>e?(p.writeHead(404),p.end()):(p.writeHead(200,{"content-type":MIME[path.extname(f)]||"text/plain"}),p.end(b)));}).listen(0,"127.0.0.1",()=>res(s));});
(async()=>{
 const server=await serve(),port=server.address().port;
 const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
 for (const w of [560, 390, 360, 320]) {
  const ctx=await b.newContext({viewport:{width:w,height:844},timezoneId:"America/New_York"});
  await ctx.addInitScript(`{const R=Date.now.bind(Date),T=R(),S=${SIM};Date.now=()=>S+(R()-T);const O=Date;window.Date=class extends O{constructor(...a){super(...(a.length?a:[Date.now()]))}static now(){return S+(R()-T)}};Object.setPrototypeOf(window.Date,O);}`);
  const p=await ctx.newPage();
  await p.route("**://api.sleeper.com/**",r=>{const u=new URL(r.request().url()).pathname;
    if(u==="/v1/state/nfl")return json(r,{season:F.SEASON,display_week:F.WEEK,week:F.WEEK});
    let m=u.match(/^\/v1\/league\/(\d+)$/); if(m)return json(r,{...F.LEAGUES[m[1]],league_id:m[1]});
    m=u.match(/^\/v1\/league\/(\d+)\/rosters$/); if(m)return json(r,F.rostersFor(m[1],m[1]==="1389373222666932224"?F.starters14:F.starters8));
    if(/^\/projections\/nfl\/player\//.test(u))return json(r,F.seasonWeeks(u.split("/").pop()));
    if(/^\/projections\/nfl\/\d+\/\d+$/.test(u))return json(r,F.universe); return json(r,[]);});
  await p.route("**://api.fantasycalc.com/**",r=>json(r,F.fcalc(Number(new URL(r.request().url()).searchParams.get("numQbs"))||1)));
  await p.route("**://raw.githubusercontent.com/**",r=>{const u=r.request().url();
    const f=u.includes("games.csv")?"games.csv":u.includes("fp_latest_weekly")?"fp.csv":u.includes("db_playerids")?"ids.csv":null;
    return f?r.fulfill({status:200,contentType:"text/csv",body:fs.readFileSync(path.join(UP,f))}):r.abort("failed");});
  await p.goto(`http://127.0.0.1:${port}/`,{waitUntil:"networkidle"});
  await p.waitForTimeout(500);
  const out=await p.evaluate(()=>{
    const tables=[...document.querySelectorAll("section.block table")];
    const t=tables[0]; if(!t) return {none:true};
    const cols=[...t.rows[0].cells].map(c=>({cls:c.className,px:Math.round(c.getBoundingClientRect().width)}));
    // does any player name wrap to more than one line?
    const names=[...t.querySelectorAll("td.nm")].map(td=>{
      const lh=parseFloat(getComputedStyle(td).lineHeight)||20;
      return {text:td.textContent.trim().slice(0,26), lines:Math.round(td.getBoundingClientRect().height/lh), px:Math.round(td.getBoundingClientRect().width)};
    });
    const cs=(el,k)=>getComputedStyle(el)[k];
    const diag=[...t.rows[0].cells].map(c=>({cls:c.className,w:cs(c,'width'),pad:cs(c,'paddingLeft')+'/'+cs(c,'paddingRight'),disp:cs(c,'display')}));
    return {cols, diag, tableW:Math.round(t.getBoundingClientRect().width),
            appW:Math.round(document.querySelector('#app').getBoundingClientRect().width),
            appPad:cs(document.querySelector('#app'),'paddingLeft'),
            worst:names.sort((a,b)=>b.lines-a.lines)[0], maxLines:Math.max(...names.map(n=>n.lines)),
            hSlop:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  });
  console.log(`\n--- ${w}px ---`);
  console.log(' cols:', out.cols.map(c=>`${c.cls||'?'}=${c.px}`).join(' '));
  console.log(' worst name:', JSON.stringify(out.worst), '| maxLines', out.maxLines, '| hScroll', out.hSlop);
  console.log(' tableW', out.tableW, 'appW', out.appW, 'appPad', out.appPad);
  console.log(' diag:', JSON.stringify(out.diag));
  await ctx.close();
 }
 await b.close(); server.close();
})();

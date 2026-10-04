// Run the waypoint bot through a stage: node tools/botrun.mjs <url> <outdir> <waypoints.json> [maxFrames] [shotEvery] [god] [teleport]
import { chromium } from 'playwright';
import fs from 'fs';
const [,, url, outdir, wpFile, maxF = '20000', every = '600', god = '0', tele = '0'] = process.argv;
const wps = JSON.parse(fs.readFileSync(wpFile, 'utf8'));
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => logs.push('[timeout] __ready'));
await page.addScriptTag({ url: '/tools/bot.js' });
await page.evaluate(([w, g, t]) => { window.__game.manual = true; window.__bot.load(w, { god: g, teleport: t }); }, [wps, god === '1', tele === '1']);
const F = +maxF, E = +every;
let f = 0;
for (; f < F; f += 30) {
  const st = await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__game.advance(1); const B = window.__bot; const C = window.__CTX; return { done: B.done, i: B.i, mode: C.game.mode && C.game.mode.constructor.name, state: C.game.mode && C.game.mode.state }; });
  if (f % E === 0) { await page.evaluate(() => window.__game.renderOnce()); await page.screenshot({ path: `${outdir}/f${String(f).padStart(6, '0')}.png` }); }
  if (st.done || st.mode !== 'StageMode') { console.log('end at frame', f, JSON.stringify(st)); break; }
}
await page.evaluate(() => window.__game.renderOnce());
await page.screenshot({ path: `${outdir}/final.png` });
const res = await page.evaluate(() => { const B = window.__bot, C = window.__CTX, p = C.player; return { log: B.log, i: B.i, n: B.wps.length, skips: B.skips, hp: p ? p.hp : null, candies: C.save.data ? C.save.data.candies : 0, pos: p ? [p.pos.x, p.pos.y, p.pos.z].map((v) => +v.toFixed(1)) : null, stats: C.game.mode.stats, sd: C.save.data && C.game.mode.sd }; });
console.log(res.log.join('\n'));
console.log(JSON.stringify({ i: res.i, n: res.n, skips: res.skips, hp: res.hp, candies: res.candies, pos: res.pos, stats: res.stats, sd: res.sd }));
if (logs.length) console.log('--- console ---\n' + [...new Set(logs)].slice(0, 30).join('\n'));
await browser.close();

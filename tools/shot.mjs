// Usage: node tools/shot.mjs <url> <out.png> [waitMs] [width] [height] [evalJS]
import { chromium } from 'playwright';
const [,, url, out, waitMs='1500', w='960', h='540', evalJs=''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack||''}`));
await page.goto(url);
await page.waitForTimeout(+waitMs);
if (evalJs) { try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch(e) { logs.push('[evalerror] ' + e.message); } await page.waitForTimeout(500); }
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();

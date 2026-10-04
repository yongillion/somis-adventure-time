// Automated gameplay driver.
// Usage: node tools/play.mjs <url> <outdir> <script.json|inline-json> [w] [h]
// Script steps: ["wait",ms] ["frames",n] ["down",key] ["up",key] ["press",key] ["shot",name] ["eval",js] ["log",js]
import { chromium } from 'playwright';
import fs from 'fs';
const [,, url, outdir, scriptArg, w = '960', h = '540'] = process.argv;
const steps = JSON.parse(fs.existsSync(scriptArg) ? fs.readFileSync(scriptArg, 'utf8') : scriptArg);
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => logs.push('[timeout] __ready'));
await page.evaluate(() => { window.__game.manual = true; });
const out = [];
for (const st of steps) {
  const [op, a, b] = st;
  if (op === 'wait') await page.waitForTimeout(a);
  else if (op === 'frames') { await page.evaluate((n) => window.__game.advance(n), a); }
  else if (op === 'down') await page.keyboard.down(a);
  else if (op === 'up') await page.keyboard.up(a);
  else if (op === 'press') { await page.keyboard.down(a); await page.evaluate(() => window.__game.advance(2)); await page.keyboard.up(a); }
  else if (op === 'shot') { await page.evaluate(() => window.__game.renderOnce()); await page.screenshot({ path: `${outdir}/${a}.png` }); out.push(`shot ${a}`); }
  else if (op === 'eval') { const r = await page.evaluate(a); if (r !== undefined) out.push(`eval: ${JSON.stringify(r)}`); }
  else if (op === 'log') { const r = await page.evaluate(a); out.push(`${b || 'log'}: ${JSON.stringify(r)}`); }
}
console.log(out.join('\n'));
if (logs.length) console.log('--- console ---\n' + logs.slice(0, 40).join('\n'));
await browser.close();

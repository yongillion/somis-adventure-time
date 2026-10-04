// Sequence runner: steps the game manually, auto-advances dialogs, takes periodic screenshots.
// Usage: node tools/seq.mjs <url> <outdir> <frames> <shotEvery> [w] [h] [choice]
import { chromium } from 'playwright';
import fs from 'fs';
const [,, url, outdir, framesArg = '1200', everyArg = '120', w = '960', h = '540'] = process.argv;
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => logs.push('[timeout] __ready'));
await page.evaluate(() => { window.__game.manual = true; });
const frames = +framesArg, every = +everyArg;
let shot = 0;
const texts = [];
for (let f = 0; f < frames; f += 10) {
  const info = await page.evaluate(() => {
    const g = window.__game, C = window.__CTX;
    for (let i = 0; i < 10; i++) g.advance(1);
    const d = C.ui.dlg;
    let r = null;
    if (d) {
      d.t += 99; // finish typewriter
      if (d.shown >= d.full.length) { r = (d.seq[d.i].who || '') + ': ' + d.full; }
    }
    const cap = document.querySelector('.caption.on');
    return { dlg: r, cap: cap ? cap.textContent : null, mode: g.mode && g.mode.constructor.name };
  });
  if (info.dlg && texts[texts.length - 1] !== info.dlg) {
    texts.push(info.dlg);
    await page.evaluate(() => { window.__game.renderOnce(); });
    await page.screenshot({ path: `${outdir}/d${String(shot++).padStart(3, '0')}.png` });
    await page.evaluate(() => { const C = window.__CTX; const d = C.ui.dlg; if (d && d.waitChoice && d.choiceScreen) { const b = d.choices.querySelector('button'); if (b) b.click(); } else C.ui._dialogAdvance(); });
  }
  if (info.cap && texts[texts.length - 1] !== '[cap] ' + info.cap) texts.push('[cap] ' + info.cap);
  if (f % every === 0) {
    await page.evaluate(() => { window.__game.renderOnce(); });
    await page.screenshot({ path: `${outdir}/f${String(f).padStart(5, '0')}.png` });
  }
}
console.log(texts.join('\n'));
const mode = await page.evaluate(() => window.__game.mode && window.__game.mode.constructor.name);
console.log('final mode:', mode);
if (logs.length) console.log('--- console ---\n' + [...new Set(logs)].slice(0, 30).join('\n'));
await browser.close();

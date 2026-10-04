// Level overview: load a stage, freeze, and shoot from given camera views.
// Usage: node tools/overview.mjs <url> <outdir> '<json [[name,[px,py,pz],[tx,ty,tz],fov],...]>' [w] [h]
import { chromium } from 'playwright';
import fs from 'fs';
const [,, url, outdir, viewsArg, w = '960', h = '540'] = process.argv;
const views = JSON.parse(viewsArg);
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => logs.push('[timeout] __ready'));
await page.evaluate(() => { window.__game.manual = true; window.__game.advance(30); });
for (const [name, pos, tgt, fov] of views) {
  await page.evaluate(([pos, tgt, fov]) => {
    const C = window.__CTX; C.cam.mode = 'manual';
    C.camera.position.set(...pos); C.camera.target.set(...tgt); C.camera.fov = (fov || 50) * Math.PI / 180;
    C.env.update(0.016, C.camera.target, C.camera);
    window.__game.renderOnce();
  }, [pos, tgt, fov]);
  await page.screenshot({ path: `${outdir}/${name}.png` });
}
const info = await page.evaluate(() => { const C = window.__CTX; return { mode: C.game.mode.constructor.name, state: C.game.mode.state, enemies: C.level ? C.level.enemies.length : 0, ents: C.level ? C.level.entities.length : 0 }; });
console.log(JSON.stringify(info));
if (logs.length) console.log('--- console ---\n' + [...new Set(logs)].slice(0, 30).join('\n'));
await browser.close();

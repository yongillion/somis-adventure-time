// Visual tour: for a stage, place the player at each lantern (and the boss arena) and screenshot the gameplay camera.
// Usage: node tools/tour.mjs <stage> <outdir> [w] [h]
import { chromium } from 'playwright';
import fs from 'fs';
const [,, stage, outdir, w = '960', h = '540'] = process.argv;
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:8765/index.html?stage=${stage}&flags=seen:stage${stage}intro`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.evaluate(() => { window.__game.manual = true; window.__game.advance(20); });
const spots = await page.evaluate(() => {
  const C = window.__CTX, L = C.level;
  const out = [{ name: 'start', x: L.spawn.pos.x, y: L.spawn.pos.y, z: L.spawn.pos.z, yaw: L.spawn.yaw }];
  L.checkpoints.forEach((c, i) => { const rp = c.respawnPoint(); out.push({ name: 'lantern' + (i + 1), x: rp.x, y: rp.y + 0.1, z: rp.z, yaw: c.yaw }); });
  const b = C.game.mode.boss;
  if (b && b.arena) out.push({ name: 'arena', x: b.arena.x, y: b.arena.y + 0.2, z: b.arena.z + b.arena.r * 0.85, yaw: Math.PI });
  return out;
});
for (const s of spots) {
  await page.evaluate((s) => {
    const C = window.__CTX, p = C.player;
    p.place({ x: s.x, y: s.y, z: s.z }, s.yaw); p.invuln = 99;
    C.cam.snap(p);
    for (let i = 0; i < 40; i++) { window.__game.advance(1); p.invuln = 99; }
    window.__game.renderOnce();
  }, s);
  await page.screenshot({ path: `${outdir}/${s.name}.png` });
}
console.log(spots.map((s) => s.name).join(' '));
if (logs.length) console.log([...new Set(logs)].filter((l) => !l.includes('TUNNEL') && !l.includes('GPU stall')).slice(0, 10).join('\n'));
await browser.close();

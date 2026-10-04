// Per-stage CPU cost: update step time and render submit time (SwiftShader so render ms is pessimistic), draw calls, tris.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const stages = process.argv.slice(2).map(Number); if (!stages.length) stages.push(1, 2, 3, 4, 5, 6, 7, 8);
for (const n of stages) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`http://127.0.0.1:8765/index.html?stage=${n}&flags=seen:stage${n}intro`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const r = await page.evaluate(() => {
    const G = window.__game, C = window.__CTX; G.manual = true;
    G.advance(30);
    const out = [];
    // sample at spawn, each lantern
    const spots = [C.level.spawn.pos, ...C.level.checkpoints.map((c) => c.respawnPoint())];
    for (const s of spots) {
      C.player.place({ x: s.x, y: s.y + 0.1, z: s.z }, C.player.yaw); C.player.invuln = 99; C.cam.snap(C.player);
      G.advance(10);
      let t0 = performance.now(); for (let i = 0; i < 60; i++) { G.step(1 / 60); C.player.invuln = 99; } const upd = (performance.now() - t0) / 60;
      t0 = performance.now(); for (let i = 0; i < 5; i++) G.renderOnce(); const gl = C.renderer.gl; gl.finish(); const ren = (performance.now() - t0) / 5;
      out.push({ upd: +upd.toFixed(2), ren: +ren.toFixed(1), calls: C.renderer.stats.calls, ktris: Math.round(C.renderer.stats.tris / 1000) });
    }
    return out;
  });
  console.log('stage', n, r.map((o) => `upd ${o.upd}ms ren ${o.ren}ms calls ${o.calls} ${o.ktris}k`).join(' | '));
  await page.close();
}
await browser.close();

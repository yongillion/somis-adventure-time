// Validate lantern respawn points and puffy/cookie placements for every stage.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const warns = [];
  page.on('console', (m) => { if (m.text().includes('[level]')) warns.push(m.text()); });
  await page.goto(`http://127.0.0.1:8765/index.html?stage=${n}&flags=seen:stage${n}intro`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const r = await page.evaluate(() => {
    const C = window.__CTX, L = C.level, ph = C.physics;
    const bad = [];
    L.checkpoints.forEach((c, i) => {
      const rp = c.respawnPoint();
      const sx = rp.x, sz = rp.z;
      const fallback = Math.abs(rp.x - c.pos.x) < 1e-3 && Math.abs(rp.z - c.pos.z) < 1e-3;
      const g = ph.groundBelow(sx, rp.y + 1.0, sz, 3);
      if (fallback || !g || g.c.hazard || g.y < c.pos.y - 0.7) bad.push(`lantern${i + 1} respawn (${sx.toFixed(1)},${sz.toFixed(1)}) ground=${g ? g.y.toFixed(2) + ' ' + g.c.tag : 'NONE'}${fallback ? ' FALLBACK' : ''}`);
    });
    const ents = L.entities.filter((e) => e.constructor.name === 'PuffyCage').map((e) => e.idx).sort();
    const sp = L.spawn.pos; const g0 = ph.groundBelow(sp.x, sp.y + 1, sp.z, 3);
    if (!g0) bad.push('spawn has no ground');
    return { bad, puffies: ents, lanterns: L.checkpoints.length, enemies: L.enemies.length, ents: L.entities.length, candies: C.pickups.c.length, items: C.pickups.items.map((i) => i.kind + (i.id ? ':' + i.id : '')).join(',') };
  });
  console.log(`stage ${n}:`, JSON.stringify(r), warns.join(' | '));
  await page.close();
}
await browser.close();

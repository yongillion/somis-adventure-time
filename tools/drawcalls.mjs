// Draw-call breakdown at a stage location: node stage spotIndex (0=spawn, n=lantern n)
import { chromium } from 'playwright';
const [,, stage = '7', spot = '4'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://127.0.0.1:8765/index.html?stage=${stage}&flags=seen:stage${stage}intro&debug=1${process.env.NOBAKE ? "&nobake=1" : ""}`);
page.on("console", (m) => { if (m.text().includes("[bake]") || m.type() === "error") console.log(m.text()); });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const r = await page.evaluate((spot) => {
  const G = window.__game, C = window.__CTX; G.manual = true; G.advance(20);
  const spots = [C.level.spawn.pos, ...C.level.checkpoints.map((c) => c.respawnPoint())];
  const s = spots[spot];
  C.player.place({ x: s.x, y: s.y + 0.1, z: s.z }, C.player.yaw); C.player.invuln = 99; C.cam.snap(C.player);
  G.advance(10); G.renderOnce();
  const R = C.renderer, groups = new Map();
  const tops = new Map();
  for (const m of R._opaque.concat(R._transparent)) {
    // walk up to find a meaningful ancestor name
    let n = m, path = [];
    while (n && path.length < 6) { if (n.name) path.push(n.name); n = n.parent; }
    const key = path.slice(0, 2).reverse().join('/') || '(anon)';
    groups.set(key, (groups.get(key) || 0) + 1);
    const top = path[path.length - 1] || '(anon)';
    tops.set(top, (tops.get(top) || 0) + 1);
  }
  return { calls: R.stats.calls, top: [...tops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15), groups: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25) };
}, +spot);
console.log(JSON.stringify(r, null, 1));
await browser.close();

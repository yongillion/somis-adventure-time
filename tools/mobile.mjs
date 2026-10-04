// Mobile checks (Android emulation): portrait phones show the game turned by 90°,
// touch input is mapped into the turned frame, TOUCH enters fullscreen, leaving
// fullscreen pauses behind the TOUCH screen and a tap resumes.
// Usage: node tools/mobile.mjs [baseUrl] [outdir]
import { chromium } from 'playwright';
import fs from 'fs';
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const out = process.argv[3] || 'mobile-out';
fs.mkdirSync(out, { recursive: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

async function phone(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: UA });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tapEl = async (sel) => {
    const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel);
    if (!r) throw new Error('no element ' + sel);
    await page.touchscreen.tap(r[0], r[1]);
  };
  return { ctx, page, errs, touch, tapEl };
}
const local2screen = (o, lx, ly) => (o.rot === 90 ? [o.W - ly, lx] : o.rot === -90 ? [ly, o.H - lx] : [lx, ly]);

// ---------------------------------------------------------------- 1) portrait: full boot flow
{
  const { ctx, page, errs, tapEl } = await phone(412, 915);
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const o = await page.evaluate(async () => { const { Orient } = window.__orient || {}; return null; });
  void o;
  const st = await page.evaluate(() => {
    const app = document.getElementById('app'), r = app.getBoundingClientRect();
    const R = window.__CTX.renderer;
    return { rot: document.documentElement.classList.contains('rot'), tf: getComputedStyle(app).transform, rect: [r.left, r.top, r.width, r.height], cw: R.cssW, ch: R.cssH, hint: !!document.querySelector('.rotate-hint') };
  });
  check(st.rot, 'portrait phone: game layer is turned (class rot)');
  check(!st.hint, 'portrait phone: no "rotate your phone" screen');
  check(Math.round(st.cw) === 915 && Math.round(st.ch) === 412, `renderer is landscape ${st.cw}x${st.ch}`);
  check(Math.round(st.rect[2]) === 412 && Math.round(st.rect[3]) === 915, `turned layer covers the screen ${st.rect.map(Math.round)}`);
  await page.screenshot({ path: `${out}/p1_title.png` });
  // TOUCH -> fullscreen + menu
  await tapEl('.touch-prompt');
  await page.waitForTimeout(1200);
  const fs1 = await page.evaluate(() => ({ full: !!document.fullscreenElement, menu: !!document.querySelector('.title-menu') }));
  check(fs1.full, 'tap on TOUCH enters fullscreen');
  check(fs1.menu, 'tap on TOUCH opens the title menu');
  await page.screenshot({ path: `${out}/p2_menu.png` });
  // new game -> difficulty -> start
  await tapEl('.title-menu .btn');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/p3_diff.png` });
  await tapEl('.dcard');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/p4_opening.png` });
  // leave fullscreen during the opening: pause screen appears
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(1000);
  const ps = await page.evaluate(() => ({ overlay: !!document.querySelector('.pause-touch'), susp: !!window.__game.suspended, full: !!document.fullscreenElement }));
  check(ps.overlay && ps.susp && !ps.full, 'leaving fullscreen pauses behind the TOUCH screen');
  await page.screenshot({ path: `${out}/p5_pause.png` });
  await tapEl('.pause-touch .touch-prompt');
  await page.waitForTimeout(1000);
  const rs = await page.evaluate(() => ({ overlay: !!document.querySelector('.pause-touch'), susp: !!window.__game.suspended, full: !!document.fullscreenElement }));
  check(!rs.overlay && !rs.susp && rs.full, 'tap resumes and goes fullscreen again');
  check(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- 2) portrait: touch controls in a stage
for (const turn of [90, -90]) {
  const { ctx, page, errs, touch } = await phone(412, 915);
  await page.goto(base + 'index.html?stage=1&flags=seen:stage1intro');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  if (turn === -90) {
    // phone held the other way round: gravity flips the turn (motion sensors need https or localhost)
    const ok = await page.evaluate(() => {
      if (typeof DeviceMotionEvent === 'undefined') return false;
      for (let i = 0; i < 12; i++) window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: -9.6, y: 0.4, z: 0.5 } }));
      return true;
    });
    if (!ok) { console.log('SKIP phone turned -90 (no motion sensors on an insecure origin)'); await ctx.close(); continue; }
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2500);
  const o = await page.evaluate(async () => { const m = await import('./js/engine/orient.js'); const O = m.Orient; return { rot: O.rot, W: O.W, H: O.H, w: O.w, h: O.h }; });
  check(o.rot === turn, `phone turned ${turn}: layer rotation ${o.rot}`);
  // joystick: press in the left part of the landscape box, drag "right" in the game's frame
  const [sx, sy] = local2screen(o, o.w * 0.2, o.h * 0.65);
  const [ex, ey] = local2screen(o, o.w * 0.2 + 70, o.h * 0.65);
  await touch('touchStart', [[sx, sy]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[sx + (ex - sx) * k / 6, sy + (ey - sy) * k / 6]]);
  await page.waitForTimeout(250);
  const mv = await page.evaluate(() => ({ x: window.__CTX.input.move.x, y: window.__CTX.input.move.y, touch: window.__game.touchMode }));
  check(mv.touch, 'touch controls switched on');
  check(mv.x > 0.8 && Math.abs(mv.y) < 0.2, `joystick right in the turned frame -> move (${mv.x.toFixed(2)}, ${mv.y.toFixed(2)})`);
  await page.screenshot({ path: `${out}/s${turn}_joy.png` });
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  // joystick "up" (towards the top of the game picture)
  const [ux, uy] = local2screen(o, o.w * 0.2, o.h * 0.65 - 70);
  await touch('touchStart', [[sx, sy]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[sx + (ux - sx) * k / 6, sy + (uy - sy) * k / 6]]);
  await page.waitForTimeout(200);
  const mu = await page.evaluate(() => ({ x: window.__CTX.input.move.x, y: window.__CTX.input.move.y }));
  check(mu.y < -0.8 && Math.abs(mu.x) < 0.2, `joystick up in the turned frame -> move (${mu.x.toFixed(2)}, ${mu.y.toFixed(2)})`);
  await touch('touchEnd', []);
  // camera drag on the right side, to the right in the game's frame
  const [cx0, cy0] = local2screen(o, o.w * 0.7, o.h * 0.35);
  const [cx1, cy1] = local2screen(o, o.w * 0.7 + 60, o.h * 0.35);
  const yaw0 = await page.evaluate(() => window.__CTX.cam.userYaw);
  await touch('touchStart', [[cx0, cy0]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[cx0 + (cx1 - cx0) * k / 6, cy0 + (cy1 - cy0) * k / 6]]);
  await page.waitForTimeout(300);
  await touch('touchEnd', []);
  const yaw1 = await page.evaluate(() => window.__CTX.cam.userYaw);
  check(Math.abs(yaw1 - yaw0) > 0.05, `camera drag turns the camera (${yaw0?.toFixed?.(2)} -> ${yaw1?.toFixed?.(2)})`);
  // jump button (a DOM button inside the turned layer)
  const jb = await page.evaluate(() => { const b = document.querySelector('.tbtn-jump').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  const y0 = await page.evaluate(() => window.__CTX.player.pos.y);
  await touch('touchStart', [[jb[0], jb[1]]]);
  await page.waitForTimeout(200);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  const y1 = await page.evaluate(() => window.__CTX.player.pos.y);
  check(y1 > y0 + 0.3, `jump button works (${y0.toFixed(2)} -> ${y1.toFixed(2)})`);
  check(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- 3) landscape phone: no turn
{
  const { ctx, page, errs } = await phone(915, 412);
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ rot: document.documentElement.classList.contains('rot'), cw: window.__CTX.renderer.cssW, ch: window.__CTX.renderer.cssH }));
  check(!st.rot && st.cw === 915 && st.ch === 412, `landscape phone: not turned (${st.cw}x${st.ch})`);
  await page.screenshot({ path: `${out}/l1_title.png` });
  check(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await ctx.close();
}
// ---------------------------------------------------------------- 4) desktop window (mouse), even if tall: never turned, never forced fullscreen
{
  const ctx = await browser.newContext({ viewport: { width: 700, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(350, 600);
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({ rot: document.documentElement.classList.contains('rot'), full: !!document.fullscreenElement, menu: !!document.querySelector('.title-menu') }));
  check(!st.rot && !st.full && st.menu, `desktop: not turned, no fullscreen, menu opens (${JSON.stringify(st)})`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all mobile checks passed');
process.exit(fails ? 1 : 0);

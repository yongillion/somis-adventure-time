// ============================================================================
// stage6.js — 오로라 눈꽃 산 (Aurora Snowflake Mountain) · boss 눈보라 예티.
// A snowy night climb under the aurora, mostly toward -Z and upward.
// Sections:
//  A 눈꽃 마을 (village start, greeter, fox-melt ice grotto secret)
//  B 미끌미끌 얼음 연못 + 눈덩이 언덕 (ice surface, rolling-snowball hill gauntlet)
//  C 펭귄 쿠키 + 얼어붙은 강 (strong current: freeze floes with snowballs,
//    then slide under the 0.8 m gap of the big ice wall)
//  D 고드름 갤러리 (side-view gauntlet: icicle droppers, spike-trap waves, blinking ice)
//  E 기린 쿠키 + 높은 수정 스위치 (3 neck-only crystals open the ice gate) · owl quiz
//  F 눈보라 다리 (gusty blizzard bridge: wait in the shelters, jump in the calm)
//  G 얼음 첨탑 섬 (spire climb to the dove bubble) + hedgehog side island
//  H 무너지는 얼음 계단 → summit (lantern) → bridge → Yeti arena with 4 ice pillars
// ============================================================================
import { Vec3, clamp, TAU } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { TILE } from '../../engine/texgen.js';
import { CTX } from '../ctx.js';
import { Collider } from '../world/physics.js';
import { buildPlatform } from '../models/platforms.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CrystalSwitch } from '../systems/interact.js';
import { YetiBoss } from '../bosses/yeti.js';
import { stageIntro, puffyNpc, ctl, SOMI, meFace } from './common.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const ICE_PAL = { grass: 0xdcf4ff, grass2: 0xc4eaff, rim: 0xf4fcff };
const BED_PAL = { grass: 0x8492cc, grass2: 0x95a2da, rim: 0x9aa8d8 };

// ------------------------------------------------------------------ rolling snowballs down a slope (with spawn & shatter)
let SNOWBALL_MAT = null;
class SnowRoller {
  constructor(level, a, b, o = {}) {
    this.level = level;
    this.a = new Vec3(...a); this.b = new Vec3(...b);
    this.dir = new Vec3(this.b.x - this.a.x, this.b.y - this.a.y, this.b.z - this.a.z);
    this.L = this.dir.length(); this.dir.scale(1 / this.L);
    const hs = CTX.diff ? CTX.diff.hazardSpeed : 1;
    this.period = (o.period ?? 3.6) / hs; this.speed = (o.speed ?? 4.4) * hs; this.r = o.r ?? 0.8;
    this.t = (o.phase ?? 0) * this.period;
    this.yaw = Math.atan2(this.dir.x, this.dir.z);
    this.node = new Node('snowRoller');
    this.balls = [];
    if (!SNOWBALL_MAT) SNOWBALL_MAT = new Material({ color: 0xf6faff, rim: 0.45, spec: 0.15 });
  }
  _make() {
    const n = new Node('rollBall');
    const m = new Mesh(G.UNIT.sphere(), SNOWBALL_MAT);
    m.scale.set(this.r, this.r, this.r);
    n.add(m);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.9 + 0.4, b = Math.sin(i * 2.3) * 0.8;
      const l = new Mesh(G.UNIT.sphereLo(), SNOWBALL_MAT);
      const s = this.r * 0.36;
      l.scale.set(s, s, s);
      l.position.set(Math.cos(a) * Math.cos(b) * this.r * 0.8, Math.sin(b) * this.r * 0.8, Math.sin(a) * Math.cos(b) * this.r * 0.8);
      n.add(l);
    }
    this.node.add(n);
    return n;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.period) { this.t -= this.period; this.balls.push({ n: this._make(), d: 0, g: 0, roll: 0 }); }
    const p = CTX.player;
    const c = p ? { x: p.pos.x, y: p.pos.y + 0.55, z: p.pos.z } : null;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const bl = this.balls[i];
      if (bl.g < 0.55) { // grow & wobble at the top (telegraph)
        bl.g += dt;
        const k = Math.min(1, bl.g / 0.35);
        bl.n.scale.set(k, k, k);
        bl.n.position.set(this.a.x + Math.sin(bl.g * 40) * 0.04, this.a.y + this.r * k, this.a.z);
        continue;
      }
      bl.d += this.speed * dt;
      bl.roll += (this.speed / this.r) * dt;
      const x = this.a.x + this.dir.x * bl.d, y = this.a.y + this.dir.y * bl.d + this.r, z = this.a.z + this.dir.z * bl.d;
      bl.n.position.set(x, y, z);
      bl.n.rotation.set(bl.roll, this.yaw, 0);
      if (Math.random() < dt * 9) CTX.fx.dust({ x, y: y - this.r, z }, 1, 0.7);
      if (bl.d >= this.L) {
        CTX.fx.iceBurst({ x, y, z });
        CTX.fx.poof({ x, y, z }, [[1, 1, 1], [0.9, 0.95, 1]]);
        if (p && Math.hypot(p.pos.x - x, p.pos.z - z) < 12) sfx('crumble', { pitch: 1.4, vol: 0.4 });
        bl.n.removeFromParent();
        this.balls.splice(i, 1);
        continue;
      }
      if (c && !p.dead) {
        const dx = c.x - x, dy = c.y - y, dz = c.z - z, rr = this.r + 0.34;
        if (dx * dx + dy * dy + dz * dz < rr * rr) p.hurt(1, { x, y, z }, { hazard: true, knock: 7, up: 8 });
      }
    }
  }
}

// ------------------------------------------------------------------ river current: pushes swimmers back toward the near shore
class RiverCurrent {
  constructor(box, v) { this.box = box; this.v = v; this.t = 0; }
  update(dt) {
    this.t += dt;
    const b = this.box, p = CTX.player;
    // foam streaks drifting with the current (near the player only)
    if (p && Math.random() < dt * 14) {
      const x = clamp(p.pos.x + (Math.random() - 0.5) * 22, b.x0 + 0.5, b.x1 - 0.5), z = clamp(p.pos.z + (Math.random() - 0.5) * 18, b.z0 + 0.5, b.z1 - 0.5);
      if (Math.abs(p.pos.z - z) < 16) {
        const l = Math.hypot(this.v.x, this.v.z);
        CTX.particles.emit({ pos: { x, y: b.top + 0.06, z }, count: 1, dir: { x: this.v.x / l, y: 0, z: this.v.z / l }, spread: 0.05, speed: [l * 0.7, l * 1.1], life: [0.9, 1.5], size: [0.1, 0.18], sizeEnd: 0.5, color: [1, 1, 1], alpha: 0.7, tile: TILE.DOT, stretch: 0.25 });
      }
    }
    if (!p || (p.state !== 'swim' && p.state !== 'dive')) return;
    if (p.pos.x < b.x0 || p.pos.x > b.x1 || p.pos.z < b.z0 || p.pos.z > b.z1) return;
    p.pos.x += this.v.x * dt; p.pos.z += this.v.z * dt;
    if (!this._told || this.t - this._told > 14) { this._told = this.t; CTX.hud.toast('물살이 너무 세요! 펭귄의 눈덩이로 얼음 발판을 만들어 건너요', 'warn', 3.2); }
  }
}

// ------------------------------------------------------------------ bigger, longer-lasting ice floe (kid friendly)
class BigFloe {
  constructor(level, x, y, z) {
    this.level = level;
    this.node = buildPlatform('ice', 2.6, 2.6, 0.45, { round: true });
    this.node.position.set(x, y + 0.05, z);
    this.col = level.physics.add(new Collider({ type: 'cyl', x, y: y - 0.17, z, hx: 1.3, hy: 0.22, moving: true, tag: 'floe' }));
    this.x = x; this.y = y; this.z = z;
    this.t = 0; this.life = 9.5;
    CTX.fx.iceBurst({ x, y: y + 0.2, z });
    CTX.fx.sparkle({ x, y: y + 0.3, z }, [0.8, 0.95, 1], 10, 1.1);
    sfx('ice');
  }
  refresh() { this.t = Math.min(this.t, 0.4); this.node.visible = true; CTX.fx.sparkle({ x: this.x, y: this.y + 0.3, z: this.z }, [0.8, 0.95, 1], 6, 1); sfx('ice', { pitch: 1.2 }); }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 0.25);
    this.node.scale.set(k, 1, k);
    this.node.position.y = this.y + 0.05 + Math.sin(this.t * 2) * 0.03;
    const left = this.life - this.t;
    this.node.visible = left > 1.6 || Math.floor(this.t * 10) % 2 === 0;
    if (left <= 0) { this.level.physics.remove(this.col); this.dead = true; CTX.fx.iceBurst({ x: this.x, y: this.y + 0.1, z: this.z }); }
  }
}

// ------------------------------------------------------------------ blizzard gusts (warning → push; shelters are calm)
class Blizzard {
  constructor(o) {
    this.box = o.box; this.shelters = o.shelters || [];
    this.on = o.on ?? 2.0; this.off = o.off ?? 2.8; this.warn = o.warn ?? 0.9;
    this.push = o.push ?? 1.7; this.air = o.air ?? 8; this.cap = o.cap ?? 3.2;
    this.t = 0; this.state = 'calm'; this.warnCount = 0;
  }
  inBox(b, p) { return p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1 && (b.y0 === undefined || (p.y >= b.y0 && p.y <= b.y1)); }
  update(dt) {
    this.t += dt;
    const cyc = this.on + this.off, u = this.t % cyc;
    const blowing = u < this.on, warning = !blowing && u > cyc - this.warn;
    const p = CTX.player;
    const near = p && this.inBox({ ...this.box, x0: this.box.x0 - 8, x1: this.box.x1 + 8, z0: this.box.z0 - 10, z1: this.box.z1 + 10, y0: undefined }, p.pos);
    const st = blowing ? 'blow' : warning ? 'warn' : 'calm';
    if (st !== this.state) {
      this.state = st;
      if (near && st === 'warn') {
        sfx('wind', { vol: 0.45, pitch: 0.65 });
        if (this.warnCount++ < 3) CTX.fx.text(new Vec3(p.pos.x - 1.2, p.pos.y + 2.2, p.pos.z), '휘이잉~ 바람이 와요!', 'warn');
      }
      if (near && st === 'blow') sfx('wind', { vol: 0.9, pitch: 0.85 });
    }
    if (!near) return;
    const b = this.box;
    // particles: warning = a few flakes, blowing = strong streaks across the bridge
    const rate = st === 'blow' ? 70 : st === 'warn' ? 12 : 0;
    if (rate && Math.random() < dt * rate) {
      const z = clamp(p.pos.z + (Math.random() - 0.5) * 16, b.z0, b.z1);
      const pos = { x: b.x0 + Math.random() * 3, y: p.pos.y - 1 + Math.random() * 5, z };
      CTX.particles.emit({ pos, count: st === 'blow' ? 2 : 1, dir: { x: 1, y: -0.08, z: 0 }, spread: 0.08, speed: st === 'blow' ? [12, 17] : [5, 7], life: [0.9, 1.3], size: [0.1, 0.2], sizeEnd: 0.6, colors: [[1, 1, 1], [0.85, 0.92, 1]], alpha: 0.9, tile: TILE.SNOW, spin: [2, 5], stretch: st === 'blow' ? 0.3 : 0 });
    }
    if (st !== 'blow' || p.dead || !this.inBox(b, p.pos)) return;
    for (const s of this.shelters) if (this.inBox(s, p.pos)) return;
    const k = p.heavy ? 0.25 : 1;
    if (p.body.grounded) p.pos.x += this.push * k * dt;
    else if (p.vel.x < this.cap) p.vel.x = Math.min(this.cap, p.vel.x + this.air * k * dt);
  }
}

// ------------------------------------------------------------------ static decoration helpers
// a row of hanging icicles under an edge from (x0,z0) to (x1,z1) at height y (merged into the static 'deco' batch)
function icicleRow(L, x0, z0, x1, z1, y, n, seed = 1) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, h = Math.abs(Math.sin(i * 12.9898 + seed * 78.233)) % 1;
    const l = 0.45 + h * 0.9, r = 0.12 + l * 0.09;
    items.push({ geo: G.UNIT.cone(), matrix: G.trs(x0 + (x1 - x0) * t, y - l / 2 + 0.02, z0 + (z1 - z0) * t, Math.PI, 0, 0, r, l, r), color: h > 0.5 ? [0.82, 0.94, 1] : [0.9, 0.97, 1] });
  }
  L.lv.addStatic('deco', G.mergeGeometries(items));
}
// snowy cap on top of a wall block (slightly wider, rounded) + icicles along both long sides
function snowCap(L, x, top, z, w, d, o = {}) {
  L.block(x, top + 0.35, z, w + 0.3, 0.4, d + 0.3, { style: 'snow', round: 0.18 });
  if (o.icicles !== false) {
    const along = w >= d;
    const n = Math.max(3, Math.round((along ? w : d) / 0.8));
    if (along) { icicleRow(L, x - w / 2, z + d / 2 + 0.12, x + w / 2, z + d / 2 + 0.12, top - 0.02, n, x + z); if (o.back) icicleRow(L, x - w / 2, z - d / 2 - 0.12, x + w / 2, z - d / 2 - 0.12, top - 0.02, n, x - z); }
    else { icicleRow(L, x + w / 2 + 0.12, z - d / 2, x + w / 2 + 0.12, z + d / 2, top - 0.02, n, x + z); if (o.back) icicleRow(L, x - w / 2 - 0.12, z - d / 2, x - w / 2 - 0.12, z + d / 2, top - 0.02, n, x - z); }
  }
}
// a craggy ice cliff along z (several blocks of varied height), snow caps, crystals, pines
function iceCliff(L, x, z0, z1, base, top, w = 2.4, seed = 0) {
  const n = Math.max(2, Math.round(Math.abs(z1 - z0) / 6));
  for (let i = 0; i < n; i++) {
    const za = z0 + (z1 - z0) * (i / n), zb = z0 + (z1 - z0) * ((i + 1) / n), zc = (za + zb) / 2, d = Math.abs(zb - za) + 0.3;
    const h = Math.sin(i * 2.7 + seed) * 1.3, t = top + h, ww = w + Math.cos(i * 1.9 + seed) * 0.5;
    L.block(x + Math.sin(i * 3.1 + seed) * 0.3, t, zc, ww, t - base, d, { style: 'ice' });
    L.block(x + Math.sin(i * 3.1 + seed) * 0.3, t + 0.3, zc, ww + 0.3, 0.4, d - 0.2, { style: 'snow', round: 0.18 });
    L.prop(i % 2 ? 'snowPine' : 'iceCrystal', x, t + 0.5, zc + 0.8, { s: i % 2 ? 0.9 : 1.3, yaw: i + seed, collide: false });
  }
}

// ------------------------------------------------------------------ the stage
export default {
  build(L, stage) {
    const lv = L.lv;
    // the env's decorative distant-island ring is centered on the origin (stages.js has no `center` for this stage);
    // this stage is ~275 m long, so re-center the ring on the middle of the stage to keep the islands distant.
    if (CTX.env && CTX.env.distant && CTX.env._buildDistant) { CTX.env.distant.removeFromParent(); CTX.env._buildDistant(CTX.env.theme, 7, new Vec3(0, 0, -127)); }
    // ============================================================ A. 눈꽃 마을 (snowflake village)
    L.island(0, 0, 0, 11, { clear: [[0, 7.6, 2.4], [0, -5, 3], [-5.8, 3.2, 2.0], [6.9, 0.5, 1.9], [-7.4, -4.5, 2.6], [6.2, -6.6, 1.4], [-2.7, 4.4, 1.2], [2.8, 4.0, 1.0], [-4.9, -2.3, 1.0]], density: 1.0 });
    L.start(0, 0.3, 7.6, Math.PI);
    L.prop('igloo', -5.8, 0, 3.2, { yaw: 1.2, s: 1.1 });
    L.prop('igloo', 6.9, 0, 0.5, { yaw: -1.4 });
    L.prop('snowman', 4.6, 0, 4.6, { yaw: -0.5 });
    L.prop('snowman', -4.0, 0, -8.2, { yaw: 0.4, s: 0.9 });
    for (const sx of [-1.5, 1.5]) L.prop('candyCane', sx, 0, 9.4, { s: 1.2, yaw: sx > 0 ? 0.3 : -0.3 });
    for (const [x, z] of [[3.4, 6.6], [-3.2, 7.2], [1.2, 2.6], [4.0, 1.4], [-1.2, -1.6], [5.2, -3.8], [-6.2, -1.0], [2.4, -6.2]]) L.prop('frozenFlower', x, 0, z, { s: 1.1 });
    L.prop('snowPine', -8.6, 0, 1.6, { s: 1.25 }); L.prop('snowPine', 8.4, 0, 3.6, { s: 1.1 }); L.prop('snowPine', 7.6, 0, -4.4, { s: 1.3 });
    L.prop('iceCrystal', -6.4, 0, 6.2, { s: 1.2 }); L.prop('iceCrystal', 3.2, 0, -8.8, { s: 1.0, yaw: 2 });
    L.candyArc([-4.2, 0.9, 5.4], [-4.0, 0.9, 1.0], 5, 0.6);
    puffyNpc(L, -2.7, 0, 4.4, 1, [
      '안녕, 소미야! 나는 눈꽃 마을의 뭉실이야.',
      '연못의 얼음은 미끌미끌해. 멈추고 싶으면 미리미리 손을 떼야 해!',
      '언덕에서는 데굴데굴 굴러오는 큰 눈덩이를 조심해. 옆으로 피하거나 폴짝 넘어가!',
    ], { yaw: 0.6 });
    // fox secret: a tiny ice grotto sealed by an ice block
    const ICE = { style: 'ice' };
    L.block(-8.4, 1.45, -4.5, 0.6, 1.45, 2.8, ICE);
    L.block(-7.2, 1.45, -3.3, 1.8, 1.45, 0.4, ICE);
    L.block(-7.2, 1.45, -5.7, 1.8, 1.45, 0.4, ICE);
    L.block(-7.4, 1.95, -4.5, 2.6, 0.5, 2.8, { style: 'ice', round: 0.2 });
    L.ice(-5.95, 0, -4.5, { s: 1.3 });
    L.bigCandy(-7.5, 0.7, -4.5);
    L.prop('iceCrystal', -7.4, 1.95, -4.0, { s: 0.6 });
    L.prop('iceCrystal', -8.0, 1.95, -5.0, { s: 0.45, yaw: 1 });
    L.sign(-4.9, 0, -2.3, ['꽁꽁 언 얼음 문 안에서 뭔가 반짝여요!', '따뜻한 불이 있으면 녹일 수 있을 텐데... 여우의 여우불이라면 어떨까요?'], { icon: '?', yaw: 0.9 });
    L.candyRing(0, 0.9, 1.0, 2.6, 10);
    L.candyLine([0, 0.9, -3.4], [0, 0.9, -9.4], 6);
    L.puffy(0, 6.2, 0, -6.6, { thanks: [{ who: '뭉실이', text: '고마워! 너무 추워서 꽁꽁 얼어 버리는 줄 알았어. 꼭대기까지 힘내!', face: 'puffy0' }] });
    L.enemy('snowball', 3.6, 0, -2.8, { range: 2.5 });
    L.enemy('gloomy', -2.8, 0, -6.4, { range: 2.2 });
    L.enemy('hopper', 1.6, 0, -8.6, { range: 1.5, hard: true });
    L.bridge([0, 0, -10.4], [0, 0, -16.7], 2.4);
    L.candyLine([0, 0.9, -11.4], [0, 0.9, -15.8], 4);

    // ============================================================ B. 얼음 연못 + 눈덩이 언덕
    L.island(0, 0, -24.6, 8.4, { top: 'block:ice', surface: 'ice', pal: ICE_PAL, big: 5, small: 3, grass: false, clear: [[0, -16.4, 2.2], [0, -32.6, 3.2], [-2.4, -18.2, 1.2], [-2.2, -30.8, 1.2]] });
    L.sign(-2.4, 0, -18.2, ['꽁꽁 언 연못이에요! 얼음 위에서는 미끌미끌~', '멈추고 싶으면 조금 일찍 손을 떼요. 빙글빙글 스케이트도 재밌어요!'], { icon: '!', yaw: 0.2 });
    L.candyRing(-2.3, 0.9, -24.6, 1.9, 7);
    L.candyRing(2.3, 0.9, -24.6, 1.9, 7);
    L.candyRing(0, 0.9, -24.6, 5.4, 14);
    L.enemy('gloomy', -3.4, 0, -22.2, { range: 2 });
    L.enemy('gloomy', 3.4, 0, -27.2, { range: 2 });
    L.enemy('shield', 0, 0, -29.4, { range: 1.2, hard: true });
    // the hill: a 20 m snowy slope with two lanes of rolling snowballs and two safe nooks
    const H0 = -32.3, H1 = -52.8, HY = 4.5;
    const hillY = (z) => HY * (H0 - z) / (H0 - H1);
    L.ramp([0, 0, H0], [0, HY, H1], 5, { thick: 0.8 });
    const bank = (x, z0, z1) => L.ramp([x, hillY(z0) + 1.0, z0], [x, hillY(z1) + 1.0, z1], 1.0, { thick: 2.2 });
    bank(-3.0, H0, -38.3); bank(-3.0, -40.7, H1);
    bank(3.0, H0, -45.3); bank(3.0, -47.7, H1);
    L.block(-3.4, hillY(-39.5), -39.5, 1.8, 1.2, 2.4, { style: 'snow' });
    L.block(3.4, hillY(-46.5), -46.5, 1.8, 1.2, 2.4, { style: 'snow' });
    L.heart(-3.4, hillY(-39.5) + 0.9, -39.5);
    L.candy(3.4, hillY(-46.5) + 0.9, -46.5);
    L.candy(3.4, hillY(-46.5) + 1.5, -46.5);
    L._add(new SnowRoller(lv, [-1.2, hillY(-51.9), -51.9], [-1.2, hillY(-32.8) + 0.05, -32.8], { r: 0.8, speed: 4.4, period: 4.0, phase: 0 }));
    L._add(new SnowRoller(lv, [1.2, hillY(-51.9), -51.9], [1.2, hillY(-32.8) + 0.05, -32.8], { r: 0.8, speed: 4.4, period: 4.0, phase: 0.5 }));
    L.candyLine([-1.2, 1.4, -35.0], [-1.2, hillY(-43) + 0.9, -43], 4);
    L.candyLine([1.2, hillY(-44) + 0.9, -44], [1.2, hillY(-50.5) + 0.9, -50.5], 4);
    L.sign(-2.2, 0, -30.8, ['눈덩이 언덕이에요! 커다란 눈덩이가 데굴데굴 굴러와요.', '옆으로 피하거나 점프로 폴짝 넘어요. 언덕 옆 쉼터에서 잠깐 쉬어도 돼요!'], { icon: '!', yaw: 0 });

    // ============================================================ C. 펭귄 쿠키 + 얼어붙은 강
    L.island(0, 4.5, -60.6, 8.3, { clear: [[0, -53, 2.8], [-2.6, -56.6, 1.4], [0, -61, 1.6], [2.6, -62.8, 1.2], [-2.9, -65.4, 1.2], [0, -68, 3], [3.6, -54.0, 1], [-3.6, -54.0, 1], [-5.2, -60.0, 2]] });
    L.prop('snowman', -3.6, 4.5, -54.0, { yaw: 0.3 });
    L.prop('snowman', 3.6, 4.5, -54.0, { yaw: -0.3 });
    L.prop('igloo', -5.4, 4.5, -60.4, { yaw: 1.4, s: 1.05 });
    L.checkpoint(-2.6, 4.5, -56.6, { yaw: Math.PI });
    L.candyLine([0, 5.3, -54.2], [0, 5.3, -59.2], 4);
    L.cookie('penguin', 0, 5.4, -61.0);
    L.candyRing(0, 5.3, -61.0, 1.6, 8);
    L.sign(2.6, 4.5, -62.8, () => [
      ctl('펭귄으로 변신했다면: 특기 버튼을 꾹 누르고 있으면 배로 쭈욱~ 미끄러져요!', '펭귄으로 변신했다면: 특기(L 또는 C)를 꾹 누르고 있으면 배로 쭈욱~ 미끄러져요!'),
      '공격 버튼으로는 눈덩이를 던져요. 물에 던지면 동그란 얼음 발판이 생겨요!',
    ], { icon: '!', yaw: -0.3 });
    puffyNpc(L, -2.9, 4.5, -65.4, 4, [
      '이 강은 물살이 아주 세서 헤엄쳐서는 못 건너. 금방 떠내려가!',
      '펭귄 친구는 눈덩이를 던져서 물을 얼릴 수 있대. 얼음 발판을 폴짝폴짝 밟고 가 봐!',
      '강 한가운데 작은 바위섬에서 쉬어 가도 돼.',
    ], { yaw: 0.2 });
    L.enemy('hopper', 4.2, 4.5, -58.2, { range: 2 });
    L.enemy('shield', -4.4, 4.5, -62.0, { range: 1.6 });
    L.enemy('snowball', 3.6, 4.5, -65.6, { range: 1.5, hard: true });
    // river: shores, water, bed, cliffs, current, islet
    L.slab(-2, 4.5, -71.0, 36, 4.6);
    L.water(-2, 3.9, -84.5, 36, 22.4, 3.2, { color: 0xa8e4ff, deep: 0x4f7fd6 });
    L.slab(-2, 0.7, -84.5, 36, 22.4, { thick: 0.6, depth: 2, top: 'block:stone', pal: BED_PAL });
    iceCliff(L, -21.2, -72.6, -96.4, 0.4, 10.6, 2.6, 1);
    iceCliff(L, 17.2, -72.6, -96.4, 0.4, 10.6, 2.6, 4);
    for (const z of [-77, -84.5, -92]) L.block(-19.75, 9.8, z, 0.5, 9.0, 3.2, { style: 'ice', color: 0xe4f8ff, color2: 0xcdeeff, round: 0.25 });
    L.candyLine([-8, 5.3, -71.2], [8, 5.3, -71.2], 6);
    L.island(-2, 4.25, -84.5, 1.9, { big: 0, small: 1, grass: false, depth: 4, flat: true });
    L.candyRing(-2, 5.0, -84.5, 1.45, 6);
    L.puffy(1, -2, 4.25, -84.5, { thanks: [{ who: '뭉실이', text: '강 한가운데에 갇혀서 꼼짝도 못 했어. 얼음 발판으로 와 줘서 고마워!', face: 'puffy1' }] });
    L._add(new RiverCurrent({ x0: -20, x1: 16, z0: -95.7, z1: -73.3, top: 3.9 }, { x: 2.2, z: 4.4 }));
    const floes = [];
    lv.freezeWater = (x, top, z) => {
      for (const f of floes) if (!f.dead && Math.hypot(f.x - x, f.z - z) < 1.6) { f.refresh(); return; }
      const alive = floes.filter((f) => !f.dead);
      if (alive.length >= 5) { const o = alive[0]; o.t = Math.max(o.t, o.life - 0.3); }
      const f = new BigFloe(lv, x, top, z);
      floes.push(f);
      lv.add(f);
      if (floes.length > 12) floes.splice(0, floes.length - 12);
    };
    L.sign(1.6, 4.5, -71.8, ['물살이 아주 센 강이에요. 빠지면 떠내려가요!', '펭귄의 눈덩이를 물에 던져 얼음 발판을 만들고 폴짝폴짝 건너요.'], { icon: '!', yaw: 0 });
    L.candyArc([0, 5.0, -73.5], [0, 4.6, -79], 4, 1.2);
    L.candyArc([-1, 4.6, -87.5], [0, 5.0, -95], 4, 1.2);
    // far shore + the big ice wall with a low slide tunnel
    L.slab(-2, 4.5, -100.2, 36, 9);
    L.block(-10.45, 10.8, -102.7, 19.1, 6.3, 4, ICE);
    L.block(8.45, 10.8, -102.7, 15.1, 6.3, 4, ICE);
    L.block(0, 10.8, -102.7, 1.8, 5.5, 4, ICE);
    snowCap(L, -2, 10.8, -102.7, 36, 4);
    L.heart(-3.6, 5.4, -97.4);
    L.candyRing(-6, 5.3, -98.2, 1.4, 6);
    for (const [x, s] of [[-14, 1.3], [-8.5, 1.0], [-4, 1.4], [4.2, 1.2], [9.5, 1.4], [13.5, 1.0]]) L.prop('iceCrystal', x, 10.8, -102.4 + (s - 1.2), { s, yaw: x });
    for (const x of [-17, -11.5, 6.8, 12]) L.prop('snowPine', x, 10.8, -103.4, { s: 1.1, seed: Math.round(x) });
    L.sign(2.6, 4.5, -98.0, () => ['커다란 얼음 벽 아래에 아주 낮은 틈이 있어요.', ctl('펭귄으로 변신해서 특기 버튼을 꾹! 배 미끄럼으로 쏙 지나가요.', '펭귄으로 변신해서 특기(L 또는 C)를 꾹! 배 미끄럼으로 쏙 지나가요.')], { icon: 'arrow', yaw: 0 });
    L.candyLine([0, 4.9, -99.2], [0, 4.9, -100.4], 2);
    L.candyLine([0, 4.85, -101.4], [0, 4.85, -104.0], 3);
    L.enemy('gloomy', -6, 4.5, -98.2, { range: 2.4 });

    // ============================================================ D. 고드름 갤러리 (side view gauntlet)
    L.slab(0, 4.5, -113.0, 5.4, 16.6);
    L.slab(0, 4.5, -131.0, 5.4, 4.2);
    L.block(-3.3, 9.6, -118.9, 1.2, 5.1, 28.4, ICE);
    L.block(-0.85, 9.0, -118.4, 6.1, 1.0, 27.4, ICE);
    L.block(2.45, 5.0, -112.9, 0.5, 0.5, 15.6, ICE);
    L.block(2.45, 5.0, -131.0, 0.5, 0.5, 3.6, ICE);
    L.checkpoint(-1.7, 4.5, -106.2, { yaw: Math.PI });
    L.camZone(0, 6.5, -118.9, 7, 4.5, 14.4, { yaw: Math.PI / 2, pitch: 0.18, dist: 10.5, lockYaw: true, priority: 2 });
    L.sign(1.4, 4.5, -106.6, ['고드름 동굴이에요! 천장의 고드름은 밑을 지나가면 툭! 떨어져요.', '멈추지 말고 쪼르르 달려요. 뾰족 가시는 내려갔을 때 지나가요!'], { icon: '!', yaw: Math.PI / 2 });
    for (const [x, z] of [[-0.9, -108.4], [1.0, -109.6], [-0.9, -110.8], [1.0, -112.0], [-0.9, -113.2]]) L.dropper(x, 7.75, z, { ground: 4.5 });
    L.candyLine([0, 5.3, -107.6], [0, 5.3, -113.6], 5);
    [-115.2, -117.0, -118.8].forEach((z, i) => { for (const x of [-1.85, -0.6, 0.65, 1.9]) L.spikeTrap(x, 4.5, z, { period: 2.6, up: 0.42, phase: i * 0.3 }); });
    L.candyLine([0, 5.3, -116.1], [0, 5.3, -117.9], 2);
    L.blink('ice', 0, 4.5, -123.3, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0 });
    L.blink('ice', 0, 4.5, -126.9, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0.5 });
    L.candyArc([0, 5.3, -120.6], [0, 5.3, -123.3], 3, 1.0);
    L.candyArc([0, 5.3, -123.3], [0, 5.3, -126.9], 3, 1.2);
    L.candyArc([0, 5.3, -126.9], [0, 5.3, -129.6], 3, 1.0);
    L.block(-1.8, 6.4, -125.1, 1.8, 0.4, 2.2, ICE);
    L.puffy(2, -2.0, 6.4, -125.1, { thanks: [{ who: '뭉실이', text: '깜빡깜빡 얼음 위에서 여기까지 뛰어오다니! 정말 대단해!', face: 'puffy2' }] });
    L.enemy('shield', 0.4, 4.5, -120.4, { range: 0.4, hard: true });

    // ============================================================ E. 기린 쿠키 + 높은 수정 스위치
    L.island(0, 4.5, -140.6, 9, { clear: [[0, -132.6, 2.6], [0, -136, 1.6], [2.4, -137, 1.2], [3.2, -134.4, 1.2], [-5.4, -139.8, 1.6], [5.6, -142.6, 1.6], [-3.0, -146.4, 1.6], [6.6, -137.2, 1.4], [-6.6, -142.6, 1.8], [0, -148.6, 3.4]], density: 0.9 });
    L.checkpoint(3.2, 4.5, -134.4, { yaw: Math.PI });
    L.cookie('giraffe', 0, 5.4, -135.8);
    L.sign(2.4, 4.5, -137.0, () => [
      ctl('기린으로 변신! 특기 버튼을 누르면 목이 쭈욱~ 늘어나요.', '기린으로 변신! 특기(L 또는 C)를 누르면 목이 쭈욱~ 늘어나요.'),
      '높은 얼음 기둥 위의 수정 스위치 세 개를 모두 켜면 얼음 문이 열려요!',
    ], { icon: '!', yaw: -0.3 });
    const pillars = [[-5.4, -139.8], [5.6, -142.6], [-3.0, -146.4]];
    let lit = 0;
    pillars.forEach(([x, z], i) => {
      L.pillar(x, 8.5, z, 0.65, 4.0, ICE);
      const cs = L.crystal(x, 8.5, z, 'cs' + i, { mode: 'once', need: 'neck' });
      cs.onHit = function (info) {
        if (!(info.tags || []).includes('neck') && !this.on && !this._told) { this._told = true; CTX.hud.toast('너무 높아요! 기린의 긴 목으로 톡! 건드려 봐요', 'warn', 3); }
        return CrystalSwitch.prototype.onHit.call(this, info);
      };
      const dx = -x / Math.hypot(x, z + 140.6) * 0.95, dz = -(z + 140.6) / Math.hypot(x, z + 140.6) * 0.95;
      L.candyLine([x + dx, 5.6, z + dz], [x + dx, 8.6, z + dz], 4);
      lv.onSignal('cs' + i, (v) => {
        if (!v) return;
        lit++;
        if (lit < 3) CTX.hud.toast(`수정 스위치 ${lit}/3 반짝!`, 'good', 2.2);
        else {
          CTX.hud.toast('수정 스위치를 모두 켰어요! 얼음 문이 열려요', 'good', 3);
          if (CTX.audio) CTX.audio.jingle('secret');
          lv.setSignal('gateE', true);
          CTX.hud.pointAt(new Vec3(0, 6, -150.2), 4);
        }
      });
    });
    L.petEvent('owl', 6.6, 5.95, -137.2, {
      kind: 'quiz',
      lines: ['부엉부엉~ 나는 눈꽃 산의 부엉박사란다.', '내 수수께끼를 모두 맞히면 너의 친구가 되어 주마!'],
      questions: [
        { q: '소미가 모으고 있는, 세상에 색깔을 돌려주는 빛은 무엇일까?', choices: ['꿈빛', '별사탕', '눈송이'], answer: 0, right: '부엉! 정답이야. 꿈빛을 찾으면 색깔이 돌아온단다.', wrong: '흐음, 보스를 도와주면 나타나는 반짝이는 빛을 떠올려 보렴.' },
        { q: '「꿈 등불」을 켜면 어떤 일이 일어날까?', choices: ['눈이 펑펑 내려요', '주변에 색깔이 돌아와요', '모두 잠이 들어요'], answer: 1, right: '딩동댕! 등불 주변부터 색이 살아나지.', wrong: '등불을 켰을 때 주변이 어떻게 변했는지 생각해 보렴.' },
        { q: '회색 안개 방울에 갇혀 있는 귀여운 친구들의 이름은?', choices: ['꿀꿀이', '반짝이', '뭉실이'], answer: 2, right: '정답! 뭉실이들을 구해 줘서 고맙구나.', wrong: '동글동글 구름 같은 친구들이란다. 다시 골라 보렴.' },
      ],
      thanks: '부엉~ 똑똑한 친구로구나! 이제 내가 숨은 비밀을 찾아 줄게.',
    });
    L.pillar(6.6, 5.35, -137.2, 0.35, 0.85, { style: 'wood' });
    L.enemy('snowball', 4.2, 4.5, -139.6, { range: 2 });
    L.enemy('hopper', -3.8, 4.5, -136.4, { range: 2 });
    L.enemy('flyer', 0.6, 4.5, -143.4, { flyH: 2.6, range: 2.2 });
    L.enemy('charger', 2.6, 4.5, -147.0, { range: 1.5, hard: true });
    L.prop('snowman', -6.0, 4.5, -142.0, { yaw: 1.2 });
    L.puffy(4, -7.2, 4.5, -143.0, { hidden: true, thanks: [{ who: '뭉실이', text: '눈사람 뒤에 숨어 있었는데 들켰네! 찾아 줘서 고마워!', face: 'puffy4' }] });
    L.candyRing(0, 5.4, -141.4, 2.2, 8);
    // the ice wall & gate
    L.slab(0, 4.5, -150.2, 32, 3.2);
    L.block(-8.8, 11.5, -150.2, 14.4, 7.0, 2.0, ICE);
    L.block(8.8, 11.5, -150.2, 14.4, 7.0, 2.0, ICE);
    L.block(0, 11.5, -150.2, 3.2, 4.0, 2.0, ICE);
    L.gate(0, 4.5, -150.2, 0, 'gateE', { w: 3.2, h: 3.0 });
    snowCap(L, 0, 11.5, -150.2, 32, 2.0, { back: true });
    L.heart(-2.6, 5.4, -147.6);
    for (const [x, s] of [[-13.5, 1.3], [-9, 1.0], [-4.5, 1.2], [0, 1.5], [4.6, 1.1], [9.2, 1.3], [13.6, 1.0]]) L.prop('iceCrystal', x, 11.5, -150.2, { s, yaw: x * 0.7 });
    L.prop('candyCane', -2.3, 4.5, -148.6, { s: 1.3 });
    L.prop('candyCane', 2.3, 4.5, -148.6, { s: 1.3 });

    // ============================================================ F. 눈보라 다리 (blizzard bridge)
    L.slab(0, 4.5, -153.4, 6, 4.4);
    L.slab(0, 4.5, -159.0, 2.8, 6.8);
    L.block(1.55, 5.1, -159.0, 0.3, 0.6, 6.4, { style: 'snow' });
    L.slab(0.6, 4.8, -164.4, 4.6, 4.0);
    L.block(-1.4, 6.4, -164.4, 0.6, 1.6, 3.6, { style: 'snow' });
    L.slab(0, 4.8, -168.4, 2.6, 4.0);
    L.slab(0, 5.1, -174.4, 2.6, 3.2);
    L.slab(0.6, 5.1, -178.0, 4.6, 4.0);
    L.block(-1.4, 6.7, -178.0, 0.6, 1.6, 3.6, { style: 'snow' });
    L.slab(0, 5.1, -181.8, 2.6, 3.6);
    L.slab(0, 5.4, -187.0, 2.6, 2.0);
    L.prop('snowPine', 2.2, 4.8, -165.6, { s: 0.8 });
    L.prop('snowPine', 2.2, 5.1, -179.2, { s: 0.8 });
    for (const [z, y] of [[-158, 7.5], [-169, 8.2], [-180, 7.6]]) L.prop('cloudPuff', -9, y, z, { s: 2.6, collide: false });
    L.sign(-1.6, 4.5, -152.6, ['눈보라 다리예요! 휘이잉~ 소리가 나면 곧 센 바람이 불어요.', '눈 울타리 뒤 쉼터에서 바람을 피하고, 바람이 멈추면 달려요!'], { icon: '!', yaw: 0 });
    L._add(new Blizzard({
      box: { x0: -8, x1: 10, z0: -188.2, z1: -155.6, y0: 2, y1: 15 },
      shelters: [{ x0: -1.1, x1: 3.2, z0: -166.3, z1: -162.5, y0: 2, y1: 15 }, { x0: -1.1, x1: 3.2, z0: -179.9, z1: -176.1, y0: 2, y1: 15 }],
      on: 2.0, off: 2.8, warn: 0.9,
    }));
    L.candyLine([0, 5.3, -156.4], [0, 5.3, -161.6], 4);
    L.candyLine([0.8, 5.6, -163.4], [0.8, 5.6, -165.4], 2);
    L.candyLine([0, 5.6, -167.0], [0, 5.6, -169.8], 3);
    L.candyArc([0, 5.6, -170.4], [0, 5.9, -172.8], 3, 1.0);
    L.candyLine([0.8, 5.9, -177.0], [0.8, 5.9, -179.0], 2);
    L.candyArc([0, 5.9, -183.6], [0, 6.2, -186.0], 3, 1.0);
    L.enemy('flyer', 0.8, 4.8, -169.0, { flyH: 2.2, range: 1.2 });
    L.enemy('flyer', -0.6, 5.1, -182.0, { flyH: 2.4, range: 1.2, hard: true });

    // ============================================================ G. 얼음 첨탑 섬 (+ hedgehog side island)
    L.island(0, 5.4, -196.4, 8.8, { clear: [[0, -188.5, 2.4], [-3.0, -190.2, 1.4], [5.4, -199.6, 3.0], [2.8, -197.4, 1.6], [-7.8, -196.4, 2.2], [0, -204.4, 2.6], [3.6, -191.2, 1]] });
    L.checkpoint(-3.0, 5.4, -190.2, { yaw: Math.PI });
    L.pillar(5.4, 15.4, -199.6, 2.0, 10.0, ICE);
    const steps = [[2.8, 7.2, -197.0], [5.4, 9.0, -196.4], [7.9, 10.8, -197.4], [6.8, 12.6, -195.6]];
    for (const [x, y, z] of steps) { L.block(x, y, z, 1.6, 0.8, 1.6, { style: 'ice', round: 0.25 }); L.candy(x, y + 0.9, z); }
    L.prop('iceCrystal', 6.6, 15.4, -200.6, { s: 0.7 });
    L.petEvent('dove', 5.2, 16.7, -199.2, { kind: 'bubble', hits: 3, thanks: '구구~ 고마워! 나는 비둘기 구구야. 이제 내가 너를 포근하게 지켜 줄게!' });
    L.puffy(3, 4.5, 15.4, -199.0, { thanks: [{ who: '뭉실이', text: '이렇게 높은 얼음 첨탑 꼭대기까지! 오로라가 정말 가깝게 보이지?', face: 'puffy3' }] });
    L.bigCandy(6.2, 16.3, -200.2);
    L.sign(1.2, 5.4, -195.0, ['얼음 첨탑 꼭대기에서 누군가 도와 달라고 해요!', '반짝이는 얼음 계단을 폴짝폴짝 올라가 봐요.'], { icon: '?', yaw: 0.3 });
    L.enemy('charger', 1.6, 5.4, -201.6, { range: 1.5 });
    L.enemy('snowball', -3.6, 5.4, -199.6, { range: 2 });
    L.enemy('gloomy', 3.8, 5.4, -191.4, { range: 1.6 });
    L.candyRing(0, 6.2, -196.4, 2.4, 8);
    // hedgehog side island (west)
    L.bridge([-8.4, 5.4, -196.4], [-11.4, 5.4, -196.4], 2.0);
    L.candyLine([-8.8, 6.3, -196.4], [-11.0, 6.3, -196.4], 3);
    L.island(-15.5, 5.4, -196.4, 4.4, { big: 2, small: 3, clear: [[-15.5, -196.4, 1.4], [-12, -196.4, 1.4], [-19.2, -196.4, 1.4]] });
    L.cookie('hedgehog', -15.5, 6.3, -196.4);
    L.enemy('shield', -15.0, 5.4, -199.2, { range: 1.2 });
    L.enemy('hopper', -14.2, 5.4, -193.6, { range: 1.2 });
    L.block(-22.4, 5.4, -196.4, 5.2, 1.0, 1.8, { style: 'ice', round: 0.2 });
    L.spikes(-21.4, 5.4, -196.4, 3.2, 1.5);
    L.block(-21.6, 7.6, -196.4, 3.6, 0.5, 1.8, { style: 'ice', round: 0.2 });
    L.bigCandy(-24.0, 6.1, -196.4);
    L.candyLine([-20.2, 6.3, -196.4], [-22.6, 6.3, -196.4], 4);
    L.sign(-12.6, 5.4, -194.4, () => ['뾰족뾰족 얼음 가시 길 끝에 커다란 별사탕이 있어요!', ctl('고슴도치로 변신해서 특기 버튼을 누르면 가시 방패! 가시가 하나도 안 아파요.', '고슴도치로 변신해서 특기(L 또는 C)를 누르면 가시 방패! 가시가 하나도 안 아파요.')], { icon: '?', yaw: -0.6 });

    // ============================================================ H. 무너지는 얼음 계단 → 정상 → 보스
    const fall = [[0, 6.1, -207.0], [-1.6, 6.8, -210.0], [0.4, 7.5, -213.0], [1.8, 8.2, -216.0]];
    for (const [x, y, z] of fall) { L.falling('ice', x, y, z, 2.4, 2.4, 0.5, { delay: 0.75, respawn: 3 }); L.candy(x, y + 0.9, z); }
    L.sign(-2.2, 5.4, -203.8, ['얼음 계단은 밟으면 금방 무너져요!', '쉬지 말고 폴짝폴짝 올라가요. 떨어져도 금방 다시 생겨요.'], { icon: '!', yaw: 0.2 });
    L.enemy('flyer', -1.8, 7.0, -211.6, { flyH: 2.0, range: 1.2, hard: true });
    L.island(0, 8.9, -223.4, 5.8, { clear: [[0, -217.8, 2.4], [-2.4, -224.6, 1.4], [2.6, -225.2, 1.2], [0, -229, 2.6], [-1.6, -228.0, 1]], density: 0.9 });
    L.checkpoint(-2.4, 8.9, -224.6, { yaw: Math.PI });
    puffyNpc(L, 2.6, 8.9, -225.2, 5, [
      '저 다리 너머에 눈보라 예티가 있어. 원래는 다정한 친구였는데...',
      '예티가 땅을 앞발로 긁으면 곧 쿵쾅쿵쾅 달려와! 분홍 길을 잘 보고 피해!',
      '얼음 기둥 뒤에 숨으면 예티가 기둥에 쾅! 어지러워할 때 공격하면 돼.',
    ], { yaw: -0.4 });
    L.enemy('flyer', 0, 8.9, -221.4, { flyH: 2.4, range: 1.6 });
    L.enemy('charger', 2.2, 8.9, -227.0, { range: 1.0 });
    L.enemy('snowball', -2.0, 8.9, -221.0, { range: 1.0, hard: true });
    L.heart(1.2, 9.8, -219.6);
    L.candyRing(0, 9.8, -223.4, 2.2, 8);
    L.bridge([0, 8.9, -228.8], [0, 8.9, -237.2], 2.6);
    L.candyLine([0, 9.8, -229.8], [0, 9.8, -236.2], 5);
    L.sign(-1.8, 8.9, -228.2, ['이 다리 너머에서 쿵쿵 발소리가 들려요...', '꿈 등불이 켜져 있으니 걱정 마요. 힘내요, 소미!'], { icon: '!', yaw: 0 });
    // the arena with four ice pillars
    const AZ = -250.4, AY = 8.9;
    const arena = L.arena(0, AY, AZ, 14, { big: 9, small: 6 });
    stage.arena = arena;
    const PR = 0.95, PD = 6.8;
    const apillars = [];
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
      const x = Math.sin(a) * PD, z = AZ + Math.cos(a) * PD;
      L.pillar(x, AY + 3.6, z, PR, 3.6, ICE);
      L.prop('iceCrystal', x, AY + 3.6, z, { s: 0.75, yaw: a, collide: false });
      apillars.push([x, z, PR]);
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + 0.14;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.42) continue; // keep the bridge entrance clear
      const R = 12.7 + (i % 3) * 0.25;
      L.prop(i % 3 === 0 ? 'iceCrystal' : i % 3 === 1 ? 'snowPine' : 'snowRock', Math.sin(a) * R, AY, AZ + Math.cos(a) * R, { s: i % 3 === 1 ? 1.15 : 1.0, yaw: a * 3, collide: false });
    }
    L.camZone(0, AY + 5, AZ, 14.5, 7, 14.5, { pitch: 0.68, dist: 11.5, priority: 1 });
    stage.bossCtl = new YetiBoss(stage, {
      pos: [0, AY, AZ - 4.4], yaw: 0, arena, pillars: apillars,
      introLines: [
        { who: '눈보라 예티', text: '우워어어-! 추워... 마음이 꽁꽁 얼었어! 다 얼려 버릴 테다!', face: 'bossfog:yeti' },
        { who: SOMI, text: '예티야! 회색 안개 때문에 마음까지 얼어붙은 거지? 내가 따뜻하게 녹여 줄게!', face: meFace() },
        { who: '눈보라 예티', text: '눈보라를 받아라-! 우워어!', face: 'bossfog:yeti' },
      ],
      thanks: [
        ['boss', '우워... 머리가 맑아졌어. 몸도 마음도 포근해졌어.'],
        ['boss', '춥고 외로웠어... 아니, 그건 내 마음이 아니었어. 달빛 정원 쪽에서 차가운 슬픔이 불어오고 있어.'],
        [SOMI, '달빛 정원...? 거기에 누가 혼자 울고 있는 걸까?'],
        ['boss', '고마워, 꼬마 친구. 눈 장난은 이제 재미있게만 할게! 저기 꿈빛을 가져가렴.'],
      ],
    });
    L.killY(-24);
    void TAU;
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      shots: [
        [[18, 22, 24], [0, 2, -30], 3.0],
        [[-26, 20, -66], [0, 4, -96], 3.0],
        [[18, 20, -150], [0, 6, -178], 3.0],
        [[0, 22, -226], [0, 10, -252], 2.6],
      ],
      lines: [
        ['뭉실이', '어서 와, 소미야! 여기는 오로라가 반짝이는 눈꽃 산이야.', 'puffy2'],
        ['뭉실이', '그런데 산꼭대기의 예티가 회색 안개 때문에 눈보라를 일으키고 있어. 친구들도 안개 방울에 갇혀 버렸고...', 'puffy2'],
        [SOMI, '걱정 마! 꼭대기까지 올라가서 예티를 도와줄게!', 'me'],
        ['뭉실이', '고마워! 가는 길에 펭귄이랑 기린 쿠키도 찾아봐. 꼭 필요할 거야!', 'puffy2'],
      ],
      toast: '산꼭대기의 꿈빛을 찾아 출발~!',
    });
  },

  onCookie(id) {
    if (id === 'penguin') { CTX.hud.toast('펭귄으로 변신해서 강을 건너 봐요!', 'good', 3); CTX.hud.pointAt(new Vec3(0, 4.5, -72), 4); }
    if (id === 'giraffe') CTX.hud.toast('기린으로 변신해서 높은 수정 스위치를 켜 봐요!', 'good', 3);
    if (id === 'hedgehog') CTX.hud.toast('고슴도치의 가시 방패로 가시 길을 지나가 봐요!', 'good', 3);
  },
};

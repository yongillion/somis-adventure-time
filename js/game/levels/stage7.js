// ============================================================================
// stage7.js — 장난감 시계탑 (Toy Clock Tower) · boss 태엽 기사 클락.
// The toy-box town at the foot of a giant clock tower, then a vertical climb
// counter-clockwise around the tower ("always keep going right"):
//  A 장난감 상자 마을 (start, greeter, first enemies)
//  B 기찻길 컨베이어 (conveyor belt + toy crushers) → 장난감 놀이 섬 (woodpecker
//    target game) → 장난감 기차 (moving train car over a gap)
//  C 코끼리 씨앗 정원 (elephant cookie; water seeds → flower steps up a cliff)
//  D 시계탑 광장 (lion cookie; roar spins 3 pinwheels → the tower's gear stairs
//    slide out) + cow toy-house side area behind a breakable rock
//  E 남쪽 벽: 톱니바퀴 계단 (spinning gear platforms, moving saws)
//  F 동쪽 벽: 커다란 시계 (ride the clock-hand platforms up, puffy on the hub)
//  G 북쪽 벽: 카피바라 쾌속 구간 (conveyor + crushers, then a TIMER bridge with a
//    fast saw and a blinking laser — capybara's slow time makes it easy)
//  H 서쪽 벽: 별 대포 → 흔들 톱 → 빙글 막대 → 깜빡 블록 → tower top → boss
// Camera: one locked camera zone per tower face (+ diagonal corner zones), so
// the camera always stays outside the tower looking at the wall you climb.
// ============================================================================
import { Vec3, clamp, Ease, TAU } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { Collider } from '../world/physics.js';
import { buildPlatform } from '../models/platforms.js';
import { buildProp } from '../models/props.js';
import { ClockKnightBoss } from '../bosses/clockknight.js';
import { stageIntro, puffyNpc, ctl, SOMI, meFace } from './common.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const TZ = -97.3, HW = 9; // clock tower center z, half width (faces: S z=-88.3, N z=-106.3, E x=9, W x=-9)
const TOP = 44.0; // tower top height
const C_PINK = [0xffbfdc, 0xffd2e6], C_MINT = [0xb8f0d8, 0xcaf6e2], C_LAV = [0xd4c4ff, 0xe2d6ff], C_BUTTER = [0xfff0a8, 0xfff6c4], C_SKY = [0xbfe2ff, 0xd2ecff];

// ------------------------------------------------------------------ conveyor belt stripes (visual only)
let STRIPE_MAT = null;
class ConveyorStripes {
  // belt top-center (x,y,z), size w (x) × d (z), push {x,z} (m/s)
  constructor(x, y, z, w, d, push, color = 0xffe08a) {
    this.node = new Node('belt');
    if (!STRIPE_MAT) STRIPE_MAT = new Material({ color: 0xffffff, rim: 0.3, satField: true });
    this.alongZ = Math.abs(push.z) >= Math.abs(push.x);
    this.speed = this.alongZ ? push.z : push.x;
    this.len = this.alongZ ? d : w; this.wid = this.alongZ ? w : d;
    this.x = x; this.y = y; this.z = z;
    this.bars = [];
    const n = Math.max(2, Math.floor(this.len / 1.1));
    const mat = new Material({ color, rim: 0.3, spec: 0.3, satField: true });
    for (let i = 0; i < n; i++) {
      const m = new Mesh(G.UNIT.rbox(), mat);
      if (this.alongZ) m.scale.set(this.wid * 0.86, 0.05, 0.32); else m.scale.set(0.32, 0.05, this.wid * 0.86);
      this.node.add(m);
      this.bars.push({ m, u: (i + 0.5) / n });
    }
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    for (const b of this.bars) {
      b.u = (b.u + (this.speed * dt) / this.len + 1) % 1;
      const o = (b.u - 0.5) * this.len;
      if (this.alongZ) b.m.position.set(this.x, this.y + 0.03, this.z + o); else b.m.position.set(this.x + o, this.y + 0.03, this.z);
    }
  }
}

// ------------------------------------------------------------------ round spinning gear platform that can slide out of the wall
class GearPlatform {
  constructor(level, x, y, z, r, o = {}) {
    this.level = level;
    this.r = r; this.h = 0.6;
    this.home = new Vec3(x, y, z);
    this.from = o.from ? new Vec3(...o.from) : this.home.clone();
    this.k = o.signal ? 0 : 1; this.target = this.k;
    this.delay = o.delay || 0; this.wait = 0;
    this.speed = (o.speed ?? 0.7) * (CTX.diff ? CTX.diff.hazardSpeed : 1);
    this.yaw = o.yaw || 0;
    this.node = buildPlatform('gear', r * 2, r * 2, this.h);
    this.pos = new Vec3();
    this._place();
    this.col = level.physics.add(new Collider({ type: 'cyl', x: this.pos.x, y: this.pos.y - this.h / 2, z: this.pos.z, hx: r * 0.97, hy: this.h / 2, moving: true, tag: 'gear', owner: this }));
    if (o.signal) level.onSignal(o.signal, (v) => { if (v) { this.target = 1; this.wait = this.delay; } });
  }
  _place() { const e = Ease.outBack(clamp(this.k, 0, 1)); this.pos.set(this.from.x + (this.home.x - this.from.x) * e, this.from.y + (this.home.y - this.from.y) * e, this.from.z + (this.home.z - this.from.z) * e); }
  update(dt) {
    if (this.target > this.k) {
      if (this.wait > 0) this.wait -= dt;
      else {
        if (this.k === 0) { sfx('gear', { pitch: 0.9 + Math.random() * 0.2 }); CTX.fx.sparkle(this.home, [1, 0.9, 0.5], 8, 1.2); }
        this.k = Math.min(1, this.k + dt * 1.6);
      }
    }
    if (this.k >= 1) this.yaw += this.speed * dt;
    this._place();
    this.col.moveTo(this.pos.x, this.pos.y - this.h / 2, this.pos.z, this.yaw);
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
  }
}

// ------------------------------------------------------------------ clock hands (bars from the hub to the riding platforms)
class ClockHands {
  constructor(c, movers, x) {
    this.c = c; this.movers = movers;
    this.node = new Node('clockHands');
    const mat = new Material({ color: 0xff8fb8, spec: 0.4, rim: 0.4, satField: true });
    const tip = new Material({ color: 0xffd36b, spec: 0.5, rim: 0.4, satField: true });
    this.hands = movers.map((m, i) => {
      const piv = new Node('hand' + i);
      piv.position.set(x, c[1], c[2]);
      const bar = new Mesh(G.UNIT.rbox(), i ? tip : mat);
      bar.scale.set(0.22, 1, 0.5);
      piv.add(bar);
      this.node.add(piv);
      return { piv, bar, m };
    });
    const hub = new Mesh(G.UNIT.sphere(), tip);
    hub.scale.set(0.5, 0.75, 0.75);
    hub.position.set(x + 0.05, c[1], c[2]);
    this.node.add(hub);
  }
  update() {
    for (const h of this.hands) {
      const p = h.m.pos;
      const dy = p.y - 0.25 - this.c[1], dz = p.z - this.c[2];
      const L = Math.hypot(dy, dz);
      h.piv.rotation.x = Math.atan2(dz, dy);
      h.bar.scale.y = Math.max(0.5, L - 0.4);
      h.bar.position.y = (L - 0.4) / 2;
    }
  }
}

// ------------------------------------------------------------------ pendulum rope (thin chain from a pivot to a swinging saw)
class PendulumRope {
  constructor(pivot, saw) {
    this.p = new Vec3(...pivot); this.saw = saw;
    this.node = new Node('rope');
    this.bar = new Mesh(G.UNIT.cylinder(), new Material({ color: 0xc8c0e0, spec: 0.5, rim: 0.3, satField: true }));
    this.node.add(this.bar);
  }
  update() {
    const s = this.saw.pos, dx = s.x - this.p.x, dy = s.y - this.p.y, dz = s.z - this.p.z, L = Math.hypot(dx, dy, dz) || 1;
    this.bar.position.set((s.x + this.p.x) / 2, (s.y + this.p.y) / 2, (s.z + this.p.z) / 2);
    this.bar.rotation.set(Math.atan2(dz, dy), 0, 0); // rope swings in the y-z plane
    this.bar.scale.set(0.07, L, 0.07);
  }
}

// ------------------------------------------------------------------ timer bridge: planks appear while the switch's timer runs
class TimerBridge {
  constructor(L, sw, signal, planks) {
    const lv = L.lv;
    this.sw = sw; this.on = false; this.k = 0; this.t = 0;
    this.node = new Node('timerBridge');
    this.planks = planks.map(([x, y, z, w, d], i) => {
      const n = buildPlatform('candy', w, d, 0.5, { seed: i });
      n.position.set(x, y, z);
      this.node.add(n);
      const col = lv.physics.add(new Collider({ type: 'box', x, y: y - 0.25, z, hx: w / 2, hy: 0.25, hz: d / 2, tag: 'timerPlank' }));
      col.enabled = false;
      return { n, col, i, s: 0 };
    });
    lv.onSignal(signal, (v) => {
      this.on = v;
      if (v) { sfx('magic', { pitch: 1.3 }); for (const p of this.planks) CTX.fx.sparkle(p.n.position, [1, 0.85, 0.5], 4, 1.0); }
      else { sfx('crumble', { vol: 0.5, pitch: 1.4 }); }
    });
    this._apply(0);
  }
  _apply(dt) {
    for (const p of this.planks) {
      const want = this.on ? 1 : 0;
      p.s += ((want ? 1 : 0) - p.s) * Math.min(1, dt * (want ? 9 - p.i * 0.8 : 14));
      const vis = this.on || p.s > 0.05;
      p.col.enabled = this.on;
      // warning blink in the last 1.6 s of the timer
      const left = this.sw && this.sw.pressed ? this.sw.t : 99;
      const blink = this.on && left < 1.6 && Math.floor(this.t * 12) % 2 === 0;
      p.n.visible = true;
      const ghost = !vis;
      p.n.scale.set(ghost ? 1 : Math.max(0.05, p.s), ghost ? 0.3 : 1, ghost ? 1 : Math.max(0.05, p.s));
      p.n.traverse((m) => { if (m.isMesh) m.opacity = ghost ? 0.16 : blink ? 0.35 : 1; });
    }
  }
  update(dt) { this.t += dt; this._apply(dt); }
}

// ------------------------------------------------------------------ static decoration helpers
function clockFace(L, cx, cy, cz, R, facing, o = {}) {
  // facing: 'x' (+X) or 'z' (+Z). Cream dial, golden rim, colorful hour marks, hub.
  const items = [];
  const rotDisc = facing === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
  const off = (d) => (facing === 'x' ? [cx + d, cy, cz] : [cx, cy, cz + d]);
  items.push({ geo: G.cylinderGeo(R, R, 0.3, 48, 1, true), matrix: G.trs(...off(0.1), ...rotDisc), color: [1, 0.97, 0.9] });
  items.push({ geo: G.torusGeo(R + 0.1, 0.32, 10, 64), matrix: G.trs(...off(0.28), facing === 'x' ? 0 : 0, facing === 'x' ? Math.PI / 2 : 0, 0), color: [1, 0.8, 0.32] });
  const marks = [[1, 0.55, 0.72], [0.55, 0.8, 1], [0.6, 0.9, 0.62], [0.78, 0.65, 1]];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU, big = i % 3 === 0, rr = R - 0.75;
    const u = Math.sin(a) * rr, v = Math.cos(a) * rr;
    const pos = facing === 'x' ? [cx + 0.3, cy + v, cz - u] : [cx + u, cy + v, cz + 0.3];
    items.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(...pos, 0, 0, 0, big ? 0.42 : 0.26, big ? 0.42 : 0.26, big ? 0.42 : 0.26), color: marks[i % 4] });
  }
  if (o.hands) {
    for (const [ang, len, w, c] of [[o.hands[0], R * 0.55, 0.35, [1, 0.5, 0.65]], [o.hands[1], R * 0.82, 0.22, [0.45, 0.4, 0.75]]]) {
      const u = Math.sin(ang), v = Math.cos(ang);
      const pos = facing === 'x' ? [cx + 0.35, cy + v * len / 2, cz - u * len / 2] : [cx + u * len / 2, cy + v * len / 2, cz + 0.35];
      const rot = facing === 'x' ? [ang, 0, 0] : [0, 0, -ang];
      items.push({ geo: G.UNIT.box(), matrix: G.trs(...pos, ...rot, facing === 'x' ? 0.1 : w, len, facing === 'x' ? w : 0.1), color: c });
    }
    items.push({ geo: G.UNIT.sphere(), matrix: G.trs(...off(0.4), 0, 0, 0, 0.45, 0.45, 0.45), color: [1, 0.82, 0.35] });
  }
  L.lv.addStatic('deco', G.mergeGeometries(items));
}
function windowRow(L, face, y, xs) {
  // small dark rounded windows set (almost) flush into a tower face
  for (const u of xs) {
    if (face === 'S') L.block(u, y, TZ + HW + 0.04, 1.4, 1.9, 0.12, { style: 'tiles', color: 0x7a6ac8, color2: 0x8a7ad8, round: 0.05 });
    if (face === 'N') L.block(u, y, TZ - HW - 0.04, 1.4, 1.9, 0.12, { style: 'tiles', color: 0x7a6ac8, color2: 0x8a7ad8, round: 0.05 });
    if (face === 'E') L.block(HW + 0.04, y, u, 0.12, 1.9, 1.4, { style: 'tiles', color: 0x7a6ac8, color2: 0x8a7ad8, round: 0.05 });
    if (face === 'W') L.block(-HW - 0.04, y, u, 0.12, 1.9, 1.4, { style: 'tiles', color: 0x7a6ac8, color2: 0x8a7ad8, round: 0.05 });
  }
}

// ------------------------------------------------------------------ the stage
export default {
  build(L, stage) {
    const lv = L.lv;
    // keep the env's distant-island ring centered on this stage (no `center` in stages.js)
    if (CTX.env && CTX.env.distant && CTX.env._buildDistant) { CTX.env.distant.removeFromParent(); CTX.env._buildDistant(CTX.env.theme, 7, new Vec3(0, 0, -62)); }
    const TOY = (c) => ({ style: 'tiles', color: c[0], color2: c[1] });
    const CANDY = (c) => ({ style: 'candy', color: c[0], color2: c[1] });

    // ============================================================ A. 장난감 상자 마을
    L.island(0, 0, 0, 10, { clear: [[0, 6.5, 2.4], [0, -4, 2.6], [-2.6, 3.8, 1.2], [2.6, 3.4, 1.2], [5.4, -4.6, 1.4], [-5.2, -1.6, 1.6], [0, -9.5, 2.4]], density: 1.0 });
    L.start(0, 0.3, 6.5, Math.PI);
    L.block(-5.2, 1.2, -1.6, 2.0, 1.2, 2.0, CANDY(C_SKY));
    L.block(-5.2, 2.2, -1.6, 1.0, 1.0, 1.0, CANDY(C_PINK));
    L.prop('crayon', -7.2, 0, 2.4, { s: 1.6, yaw: 0.3 }); L.prop('pencil', 7.0, 0, 1.6, { s: 1.4, yaw: -0.4 });
    L.prop('giftBox', 6.2, 0, 4.4, { s: 1.3 }); L.prop('toyBall', 3.4, 0, 6.8, { s: 1.1 }); L.prop('topDeco', -3.6, 0, 6.6);
    L.prop('gearDeco', -7.4, 0, -4.8, { s: 1.2 }); L.prop('toyBlock', 4.0, 0, -7.4, { s: 1.2 });
    puffyNpc(L, -2.6, 0, 3.8, 3, [
      '여기는 장난감 상자 나라야! 저기 커다란 시계탑 보여?',
      '시계탑은 오른쪽으로, 오른쪽으로 빙글빙글 돌면서 올라가면 돼. 톱니바퀴랑 시곗바늘을 타고 말이야!',
    ], { yaw: 0.5 });
    L.sign(2.6, 0, 3.4, ['장난감 시계탑에 온 걸 환영해요!', '먼저 앞쪽의 움직이는 벨트 길을 지나가 봐요.'], { icon: '!', yaw: -0.3 });
    L.puffy(0, 5.4, 0, -4.6, { thanks: [{ who: '뭉실이', text: '고마워! 장난감들이 모두 회색이 돼서 슬펐어. 시계탑 꼭대기까지 힘내!', face: 'puffy0' }] });
    L.candyRing(0, 0.9, 1.0, 2.4, 10);
    L.candyLine([0, 0.9, -3.0], [0, 0.9, -8.6], 5);
    L.candyRing(-5.2, 2.9, -1.6, 0.7, 5);
    L.candyArc([5.6, 0.9, 2.6], [5.6, 0.9, -2.4], 5, 0.8);
    L.enemy('toysoldier', -3.4, 0, -6.0, { range: 2 });
    L.enemy('gloomy', 3.6, 0, -2.4, { range: 2.2 });
    L.enemy('hopper', 2.4, 0, -7.8, { range: 1.4, hard: true });

    // ============================================================ B1. 기찻길 컨베이어 + 장난감 쿵쿵이
    const belt1 = L.slab(0, 0, -16.2, 3.6, 13, { top: 'block:tiles', pal: { grass: 0x9a8ad8, grass2: 0xa898e0, rim: 0xc0b0f0 } });
    belt1.conv = { x: 0, z: 2.0 };
    L._add(new ConveyorStripes(0, 0, -16.2, 3.6, 13, { x: 0, z: 2.0 }));
    L.crusher(0, -13.8, 3.4, 0, { size: 3.2, wait: 1.7, phase: 0 });
    L.crusher(0, -18.8, 3.4, 0, { size: 3.2, wait: 1.7, phase: 0.5 });
    L.sign(-1.4, 0, -9.0, ['움직이는 벨트 길이에요! 뒤로 밀리니까 힘차게 달려요.', '쿵쿵 장난감 블록이 찡그리면 곧 내려와요. 올라갈 때 쏙 지나가요!'], { icon: '!', yaw: 0.2 });
    L.candyLine([0, 0.9, -10.6], [0, 0.9, -12.2], 2);
    L.candyLine([0, 0.9, -15.6], [0, 0.9, -17.0], 2);
    L.candyLine([0, 0.9, -20.4], [0, 0.9, -22.0], 2);

    // ============================================================ B2. 장난감 놀이 섬 (woodpecker targets)
    L.island(0, 0, -30, 7.6, { clear: [[0, -23, 2.2], [0, -37, 2.4], [-5.4, -33.4, 1.4], [-5.4, -35.8, 1.6], [0, -34.8, 1.6], [-4.6, -26.4, 1.2]], density: 0.9 });
    const targets = [[-5.6, 0, -30.2], [5.6, 0, -28.6], [4.2, 0, -34.8], [-2.8, 0, -36.0], [2.2, 0, -24.4]].map(([x, y, z]) => [x, y, z, Math.atan2(-x, -30 - z)]);
    const wp = L.petEvent('woodpecker', -4.6, 1.6, -26.4, {
      kind: 'targets', targets, time: 25,
      lines: ['콕콕! 나는 딱따구리 콕콕이야. 과녁 맞히기 놀이 할래?', '섬 곳곳의 과녁 다섯 개를 25초 안에 모두 맞혀 봐! 공격 버튼으로 톡톡!'],
      thanks: '콕콕콕! 대단해, 백발백중이야! 이제 내가 나쁜 먹구름이를 콕콕 쪼아 줄게!',
    });
    // workaround (shared petevents.js bug): PetEvent._resetTargets assigns `obj.done = false`, but the target object
    // only has a getter → TypeError in talk(). Give each target a harmless setter so the game can start/retry.
    for (const tg of wp.targets || []) {
      const d = Object.getOwnPropertyDescriptor(tg.obj, 'done');
      if (d && d.get && !d.set) Object.defineProperty(tg.obj, 'done', { get: d.get, set() {}, configurable: true, enumerable: true });
    }
    L.block(-4.6, 0.8, -26.4, 1.2, 0.8, 1.2, CANDY(C_BUTTER));
    L.block(0.4, 1.8, -34.6, 3.4, 1.8, 2.6, TOY(C_LAV));
    L.puffy(1, -0.5, 1.8, -34.6, { thanks: [{ who: '뭉실이', text: '장난감 블록 위에서 꼼짝도 못 했어. 꺼내 줘서 고마워!', face: 'puffy1' }] });
    L.spring(-5.0, 0, -32.8, { power: 17, style: 'flower' });
    L.block(-5.0, 4.6, -35.2, 2.2, 4.6, 2.2, CANDY(C_PINK));
    L.bigCandy(-5.0, 5.4, -35.2);
    L.heart(5.0, 0.9, -31.2);
    L.prop('giftBox', 6.0, 0, -32.6, { s: 1.2 }); L.prop('toyBall', -6.2, 0, -28.0); L.prop('crayon', 6.4, 0, -26.0, { s: 1.4 });
    L.candyRing(0, 0.9, -30, 3.0, 10);
    L.candyLine([-4.6, 0.9, -31.6], [-2.4, 0.9, -34.6], 3);
    L.candyLine([3.6, 0.9, -33.2], [5.0, 0.9, -29.6], 3);
    L.candyLine([2.4, 2.7, -34.6], [1.4, 2.7, -34.6], 2);
    L.enemy('toysoldier', 3.0, 0, -31.6, { range: 2 });
    L.enemy('gloomy', -2.6, 0, -29.0, { range: 2 });
    L.enemy('hopper', 3.4, 0, -26.2, { range: 1.5 });
    L.enemy('spiky', -1.2, 0, -32.6, { range: 1.5, hard: true });

    // ============================================================ B4. 장난감 기차 (moving train car over the gap)
    const train = L.mover('candy', 3.0, 4.0, 0.6, [[0, 0, -40.0], [0, 0, -46.6]], { speed: 2.4, wait: 1.5 });
    {
      const chim = buildProp('crayon', { seed: 3 }); chim.position.set(1.1, 0, 1.4); chim.scale.set(0.55, 0.55, 0.55); train.node.add(chim);
      for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) { const w = buildProp('toyBall', { seed: 1 }); w.position.set(x, -0.95, z); w.scale.set(0.8, 0.8, 0.8); train.node.add(w); }
    }
    L.sign(-1.3, 0, -36.8, ['장난감 기차가 칙칙폭폭 왔다 갔다 해요.', '기차가 오면 폴짝 올라타요!'], { icon: 'arrow', yaw: 0.2 });
    L.candyLine([0, 1.0, -41.0], [0, 1.0, -45.6], 3);

    // ============================================================ C. 코끼리 씨앗 정원
    L.island(0, 0, -55, 7, { clear: [[0, -48.4, 2.4], [0, -51.6, 1.4], [-3.4, -51.0, 1.2], [2.6, -53.6, 1.2], [0, -59.5, 1.8], [0, -61.5, 3]], density: 0.9 });
    L.cookie('elephant', 0, 0.9, -51.6);
    L.candyRing(0, 0.9, -51.6, 1.6, 8);
    L.checkpoint(-3.4, 0, -51.0, { yaw: Math.PI });
    L.sign(2.6, 0, -53.6, () => [
      ctl('코끼리로 변신! 특기 버튼을 누르면 코로 물을 촤아~ 뿌려요.', '코끼리로 변신! 특기(L 또는 C)를 누르면 코로 물을 촤아~ 뿌려요.'),
      '목마른 씨앗에 물을 주면 쑥쑥 자라서 커다란 꽃 발판이 돼요!',
    ], { icon: '!', yaw: -0.4 });
    L.seed(0, 0, -59.5, { h: 3.3, r: 1.2 });
    L.block(0, 5.6, -66.3, 12, 7.6, 8.6, CANDY(C_MINT));
    L.seed(1.6, 5.6, -68.4, { h: 3.4, r: 1.2 });
    L.seed(-4.0, 5.6, -65.2, { h: 3.4, r: 1.1 });
    L.block(-4.0, 10.6, -68.6, 3.2, 5.0, 3.2, CANDY(C_PINK));
    L.puffy(2, -4.6, 10.6, -69.2, { thanks: [{ who: '뭉실이', text: '선물 상자 꼭대기까지 꽃을 키워서 왔구나! 정말 똑똑해!', face: 'puffy2' }] });
    L.prop('giftBox', 4.4, 5.6, -64.4, { s: 1.1 }); L.prop('crayon', 5.0, 5.6, -69.4, { s: 1.2 });
    L.candyLine([0, 4.2, -59.5], [0, 6.4, -63.6], 3);
    L.candyLine([-1.6, 6.5, -63.4], [1.6, 6.5, -63.4], 4);
    L.candyRing(-4.0, 9.9, -65.2, 0.6, 4);
    L.candyLine([1.6, 9.9, -68.4], [0.6, 12.0, -72.0], 3);
    L.enemy('shooter', 4.4, 0, -57.2, { range: 0.4 });
    L.enemy('gloomy', -3.6, 0, -57.6, { range: 1.6 });
    L.enemy('hopper', 3.0, 5.6, -66.0, { range: 1.6 });
    L.enemy('gloomy', -1.4, 5.6, -63.4, { range: 1.2 });

    // ============================================================ D. 시계탑 광장 (lion, pinwheels, cow house)
    L.island(0, 11.2, -79.5, 9, { clear: [[0, -71.4, 2.4], [0, -74.6, 1.4], [-3.6, -74.0, 1.2], [2.4, -76.4, 1.2], [-4.6, -80.5, 1.4], [4.6, -80.5, 1.4], [0, -84.6, 1.4], [-8.4, -79.5, 2.2], [-7.2, -83.6, 1.4], [0, -88, 3]], density: 0.8 });
    L.cookie('lion', 0, 12.1, -74.6);
    L.checkpoint(-3.6, 11.2, -74.0, { yaw: Math.PI });
    L.sign(2.4, 11.2, -76.4, () => [
      '시계탑의 톱니바퀴 계단이 벽 속에 쏙 들어가 있어요.',
      ctl('사자로 변신해서 특기 버튼으로 어흥! 바람개비 세 개를 한꺼번에 돌려요!', '사자로 변신해서 특기(L 또는 C)로 어흥! 바람개비 세 개를 한꺼번에 돌려요!'),
    ], { icon: '?', yaw: -0.3 });
    const pins = [[-4.6, -80.5], [4.6, -80.5], [0, -84.6]];
    const pinOn = [false, false, false];
    let gearsOut = false;
    pins.forEach(([x, z], i) => {
      L.pinwheel(x, 11.2, z, 'pin' + i, { yaw: 0, dur: 7 });
      lv.onSignal('pin' + i, (v) => {
        pinOn[i] = v;
        if (v && !gearsOut && pinOn.every(Boolean)) {
          gearsOut = true;
          lv.setSignal('gears', true);
          if (CTX.audio) CTX.audio.jingle('secret');
          CTX.hud.toast('바람개비가 모두 돌아요! 톱니바퀴 계단이 나와요!', 'good', 3);
          CTX.hud.pointAt(new Vec3(-6.6, 13, -86.4), 4);
        } else if (v && !gearsOut) CTX.hud.toast(`바람개비 ${pinOn.filter(Boolean).length}/3 빙글빙글! 한꺼번에 세 개를 돌려야 해요`, 'warn', 2.4);
      });
    });
    puffyNpc(L, 3.4, 11.2, -84.8, 5, [
      '시계탑에 오르는 길은 계속 오른쪽, 오른쪽이야!',
      '톱니바퀴 → 커다란 시계 → 빠른 길 → 별 대포 순서로 올라가면 꼭대기야.',
      '떨어져도 걱정 마. 마지막으로 서 있던 곳 근처에서 다시 시작할 수 있어!',
    ], { yaw: -0.2 });
    L.enemy('toysoldier', 4.4, 11.2, -77.2, { range: 1.8 });
    L.enemy('toysoldier', -4.6, 11.2, -77.4, { range: 1.6 });
    L.enemy('shield', 2.0, 11.2, -82.2, { range: 1.4 });
    L.enemy('charger', -2.4, 11.2, -83.0, { range: 1.0, hard: true });
    L.candyRing(0, 12.1, -80.5, 2.0, 8);
    L.candyLine([-4.6, 12.1, -84.0], [-6.4, 12.1, -84.6], 3);
    L.heart(-1.4, 12.1, -86.4);
    // cow toy-house (west), door blocked by a rock (needs a strong animal)
    L.slab(-12.2, 11.2, -79.5, 7.4, 7.4, { top: 'block:tiles', pal: { grass: 0xffe2b8, grass2: 0xffecc8, rim: 0xffd09a } });
    const HOUSE = CANDY(C_BUTTER);
    L.block(-15.6, 14.8, -79.5, 0.6, 3.6, 7.4, HOUSE);
    L.block(-12.2, 14.8, -82.9, 7.4, 3.6, 0.6, HOUSE);
    L.block(-12.2, 14.8, -76.1, 7.4, 3.6, 0.6, HOUSE);
    L.block(-8.8, 14.8, -77.25, 0.6, 3.6, 2.9, HOUSE);
    L.block(-8.8, 14.8, -81.75, 0.6, 3.6, 2.9, HOUSE);
    L.block(-8.8, 14.8, -79.5, 0.6, 1.1, 1.6, HOUSE);
    L.block(-12.2, 15.5, -79.5, 8.2, 0.7, 8.2, CANDY(C_PINK));
    L.block(-12.2, 16.3, -79.5, 5.4, 0.8, 5.4, CANDY(C_PINK));
    L.prop('crayon', -14.2, 16.3, -81.2, { s: 0.8 });
    L.block(-8.46, 13.4, -77.1, 0.12, 1.1, 1.1, { style: 'tiles', color: 0x8fd8ff, color2: 0xa8e4ff });
    L.block(-8.46, 13.4, -81.9, 0.12, 1.1, 1.1, { style: 'tiles', color: 0x8fd8ff, color2: 0xa8e4ff });
    L.rock(-8.8, 11.2, -79.5, { size: 1.5 });
    L.cookie('cow', -12.6, 12.1, -79.5);
    L.bigCandy(-14.6, 11.9, -82.0);
    L.candyRing(-12.6, 12.0, -79.5, 1.2, 6);
    L.sign(-7.6, 11.2, -77.0, ['문 앞을 커다란 바위가 막고 있어요.', '힘센 친구(사자, 곰돌이, 캥거루)라면 쾅! 부술 수 있어요.'], { icon: '?', yaw: 1.2 });

    // ============================================================ the tower body (stacked toy blocks)
    const floors = [[10.5, 17.2, C_PINK], [17.2, 23.9, C_MINT], [23.9, 30.6, C_LAV], [30.6, 37.3, C_BUTTER], [37.3, TOP, C_SKY]];
    for (const [y0, y1, c] of floors) L.block(0, y1, TZ, HW * 2, y1 - y0, HW * 2, { ...TOY(c), round: 0.25 });
    L.block(0, 10.5, TZ, 16, 6.5, 16, { ...TOY([0xd8c8f0, 0xe4d8f6]), round: 0.3 });
    L.block(0, 4.0, TZ, 11, 5, 11, { ...TOY([0xc8b8ec, 0xd8ccf2]), round: 0.3 });
    L.block(0, -1.0, TZ, 6, 4, 6, { ...TOY([0xb8a8e4, 0xc8bcec]), round: 0.3 });
    windowRow(L, 'S', 21.5, [-5, 5]); windowRow(L, 'S', 26.5, [-5, 0, 5]);
    windowRow(L, 'E', 14.2, [-92, -102.6]); windowRow(L, 'E', 34.5, [-91, -97.3, -103.6]);
    windowRow(L, 'N', 15.0, [-5, 5]); windowRow(L, 'N', 22.0, [-6, 0, 6]); windowRow(L, 'N', 40.0, [-5, 0, 5]);
    windowRow(L, 'W', 14.6, [-92, -102]); windowRow(L, 'W', 22.6, [-92, -97.3, -102]); windowRow(L, 'W', 29.0, [-94, -100]);
    clockFace(L, 0, 36.8, TZ + HW + 0.02, 5.2, 'z', { hands: [-0.6, 1.9] });
    // roof trims & corner crayon spires on the top
    for (const [x, z] of [[-7.6, TZ + 7.6], [7.6, TZ + 7.6], [-7.6, TZ - 7.6], [7.6, TZ - 7.6]]) L.prop('crayon', x, TOP, z, { s: 1.4, yaw: x + z, collide: false });

    // ============================================================ E. 남쪽 벽: 톱니바퀴 계단
    const gz = TZ + HW + 1.95, gzIn = TZ + HW - 2.4;
    const gears = [[-6.6, 12.6], [-3.3, 14.0], [0.0, 15.4], [3.3, 16.8], [6.6, 18.2]];
    gears.forEach(([x, y], i) => L._add(new GearPlatform(lv, x, y, gz, 1.7, { from: [x, y, gzIn], signal: 'gears', delay: i * 0.35, speed: i % 2 ? -0.7 : 0.7 }), true));
    L.saw([[-1.65, 15.3, gz], [-1.65, 18.1, gz]], { r: 0.7, speed: 2.2, yaw: 0 });
    L.saw([[4.95, 18.1, gz], [4.95, 20.9, gz]], { r: 0.7, speed: 2.2, yaw: 0, phase: 0.5 });
    gears.forEach(([x, y]) => L.candy(x, y + 0.9, gz));
    L.sign(-6.2, 11.2, -82.6, ['빙글빙글 톱니바퀴 계단이에요! 오른쪽으로 폴짝폴짝 올라가요.', '위아래로 움직이는 톱날이 지나간 다음에 뛰어요!'], { icon: '!', yaw: 0.3 });
    L.camZone(0, 16, TZ + HW + 4.5, 13, 5.2, 4.5, { yaw: 0, pitch: 0.2, dist: 12.5, height: 1.8, lockYaw: true, priority: 2 });

    // ============================================================ F. 동쪽 벽: 커다란 시계 (ride the hands)
    L.block(11.2, 19.6, -90.15, 4.4, 1.4, 7.7, CANDY(C_SKY)); // SE corner ledge (x 9..13.4, z -86.3..-94)
    L.block(11.0, 19.6, -97.25, 4.0, 1.4, 6.5, CANDY(C_SKY)); // along the east face to under the clock (z -94..-100.5)
    L.checkpoint(12.2, 19.6, -88.0, { yaw: Math.PI });
    L.camZone(11.5, 20.5, -87.6, 3.6, 2.6, 3.6, { yaw: Math.PI / 4, pitch: 0.22, dist: 12, height: 1.8, lockYaw: true, priority: 3 });
    L.camZone(14, 25, -96.5, 5.5, 7.5, 7.5, { yaw: Math.PI / 2, pitch: 0.14, dist: 13, height: 2.0, lockYaw: true, priority: 2 });
    const CC = [9.0, 26.2, TZ], HR = 5.0, PX = 10.8, PER = 12;
    clockFace(L, 9.0, 26.2, TZ, 6.4, 'x');
    const handFn = (ph) => (t) => { const a = ph + (t * TAU) / PER; return [PX, CC[1] + Math.cos(a) * HR, CC[2] - Math.sin(a) * HR]; };
    const hA = L.mover('gear', 2.6, 2.6, 0.45, [handFn(Math.PI)(0)], { fn: handFn(Math.PI), round: true });
    const hB = L.mover('gear', 2.6, 2.6, 0.45, [handFn(0)(0)], { fn: handFn(0), round: true });
    L._add(new ClockHands(CC, [hA, hB], 9.3));
    L.block(10.9, 25.4, TZ, 3.0, 0.4, 3.4, CANDY(C_BUTTER));
    L.puffy(3, 10.4, 25.4, TZ + 0.5, { thanks: [{ who: '뭉실이', text: '시계 한가운데에 갇혀 있었어! 시곗바늘 타기 정말 신나지?', face: 'puffy3' }] });
    L.bigCandy(11.6, 26.3, TZ - 0.8);
    L.sign(12.4, 19.6, -94.6, ['커다란 시계의 바늘 끝에 발판이 있어요!', '발판이 내려오면 폴짝 올라타고, 꼭대기에서 오른쪽 땅으로 뛰어내려요.'], { icon: '!', yaw: Math.PI / 2 });
    L.enemy('shield', 11.4, 19.6, -91.6, { range: 1.0 });
    L.candyRing(10.8, 21.8, -97.3, 0.8, 5);
    L.candyLine([11.2, 20.5, -89.5], [11.2, 20.5, -95.0], 5);
    L.candyArc([10.8, 31.2, -99.5], [11.8, 31.4, -104.6], 4, 1.0);

    // ============================================================ G. 북쪽 벽: 카피바라 쾌속 구간
    L.block(11.8, 30.4, -105.6, 5.6, 1.2, 6.0, CANDY(C_PINK)); // NE corner landing (x 9..14.6, z -102.6..-108.6)
    L.checkpoint(13.4, 30.4, -103.6, { yaw: -Math.PI / 2 });
    L.cookie('capybara', 11.4, 31.3, -106.4);
    L.camZone(11.8, 31.5, -105.6, 3.4, 3.2, 3.4, { yaw: 3 * Math.PI / 4, pitch: 0.22, dist: 12, height: 1.8, lockYaw: true, priority: 3 });
    L.camZone(-1.5, 32, TZ - HW - 4.6, 13, 4.5, 4.6, { yaw: Math.PI, pitch: 0.2, dist: 12, height: 1.8, lockYaw: true, priority: 2 });
    L.sign(13.2, 30.4, -107.8, () => [
      '여기부터는 아주 빠른 장애물 길이에요!',
      ctl('카피바라로 변신해서 특기 버튼을 누르면 느긋~ 세상이 천천히 움직여요.', '카피바라로 변신해서 특기(L 또는 C)를 누르면 느긋~ 세상이 천천히 움직여요.'),
      '노란 스위치를 밟으면 잠깐 동안 다리가 생겨요. 다리가 깜빡이면 서둘러요!',
    ], { icon: '!', yaw: Math.PI });
    const belt2 = L.block(4.7, 30.4, -107.8, 8.6, 1.2, 3.0, CANDY(C_LAV));
    belt2.conv = { x: 2.2, z: 0 };
    L._add(new ConveyorStripes(4.7, 30.4, -107.8, 8.6, 3.0, { x: 2.2, z: 0 }, 0xff9ac8));
    L.crusher(6.8, -107.8, 34.2, 30.4, { size: 2.8, wait: 1.2, downWait: 0.8, phase: 0 });
    L.crusher(3.4, -107.8, 34.2, 30.4, { size: 2.8, wait: 1.2, downWait: 0.8, phase: 0.45 });
    const tsw = L.floorSwitch(1.3, 30.4, -107.8, 'bridgeG', { mode: 'timer', timer: 9 });
    const planks = [];
    for (let i = 0; i < 5; i++) planks.push([0.4 - 1.14 - i * 2.28, 30.4, -107.8, 2.28, 2.8]);
    L._add(new TimerBridge(L, tsw, 'bridgeG', planks));
    L.saw([[-1.0, 31.15, -107.8], [-10.0, 31.15, -107.8]], { r: 0.72, speed: 6.5, yaw: 0 });
    L.laser(-5.6, 31.0, -106.4, Math.PI, { length: 3.4, on: 0.9, off: 1.2 });
    L.candyLine([8.4, 31.2, -107.8], [2.0, 31.2, -107.8], 5);
    L.candyLine([-0.8, 31.8, -107.8], [-10.0, 31.8, -107.8], 5);
    L.heart(12.6, 31.3, -104.4);
    L.candyRing(11.8, 31.3, -105.6, 1.6, 6);

    // ============================================================ H. 서쪽 벽: 별 대포 → 꼭대기
    L.block(-13.4, 30.4, -105.2, 4.8, 1.2, 7.0, CANDY(C_MINT)); // NW landing (x -11..-15.8, z -101.7..-108.7)
    L.camZone(-13.4, 31.5, -105.6, 3.6, 3.2, 3.6, { yaw: -3 * Math.PI / 4, pitch: 0.22, dist: 12, height: 1.8, lockYaw: true, priority: 3 });
    L.camZone(-14, 38.7, -89.5, 6, 4.9, 8, { yaw: -Math.PI / 2, pitch: 0.16, dist: 12.5, height: 2.0, lockYaw: true, priority: 2 });
    L.cannon(-13.4, 30.4, -103.0, [-12.6, 37.7, -93.0], { time: 1.5 });
    L.sign(-12.0, 30.4, -106.8, ['별 대포에 쏙 들어가면 위쪽 선반까지 펑! 날아가요.'], { icon: 'arrow', yaw: -Math.PI / 2 });
    L.enemy('hopper', -14.4, 30.4, -107.6, { range: 0.8 });
    L.candyLine([-11.8, 31.3, -104.6], [-14.6, 31.3, -104.6], 4);
    L.block(-12.0, 37.6, -93.0, 6.0, 1.2, 4.4, CANDY(C_LAV)); // W2 ledge (x -9..-15, z -90.8..-95.2)
    L.enemy('toysoldier', -14.2, 37.6, -94.4, { range: 0.6 });
    const pend = L.saw([[-12.0, 38.8, -91.4]], { r: 0.75, yaw: Math.PI / 2, fn: (t) => { const a = Math.sin(t * 1.9) * 1.05; return [-12.0, 42.6 - Math.cos(a) * 3.8, -91.4 + Math.sin(a) * 3.8]; } });
    L._add(new PendulumRope([-12.0, 42.6, -91.4], pend));
    L.block(-12.0, 43.0, -91.4, 1.2, 0.5, 1.2, { style: 'metal', round: 0.2 });
    L.rotator('candy', -13.6, 38.9, -87.0, 6.4, 1.3, 0.5, { speed: 0.75 });
    L.blink('candy', -11.4, 40.6, -83.0, 2.2, 2.2, 0.5, { on: 2.6, off: 1.4, phase: 0 });
    L.blink('candy', -9.4, 42.3, -85.6, 2.2, 2.2, 0.5, { on: 2.6, off: 1.4, phase: 0.45 });
    L.sign(-10.4, 37.6, -94.6, ['흔들흔들 진자 톱을 피해서 빙글 막대에 올라타요!', '깜빡 블록을 밟고 올라가면 시계탑 꼭대기예요.'], { icon: '!', yaw: -Math.PI / 2 });
    L.candyLine([-12.0, 38.4, -95.0], [-12.0, 38.4, -91.0], 3);
    L.candy(-11.4, 41.5, -83.0); L.candy(-9.4, 43.2, -85.6);
    L.candyRing(-13.6, 39.8, -87.0, 2.4, 6);

    // ============================================================ tower top, eagle chase, boss
    L.checkpoint(3.0, TOP, -101.6, { yaw: Math.PI });
    puffyNpc(L, -3.0, TOP, -102.4, 0, [
      '시계탑 꼭대기에 왔어! 저 다리 건너에 태엽 기사 클락이 있어.',
      '클락이 창을 내리면 분홍 길에서 비켜! 빙글 돌기 전에 분홍 원이 꽉 차면 점프!',
      '태엽이 다 풀리면 등의 열쇠가 반짝여. 그때가 기회야!',
    ], { yaw: 0.2 });
    L.prop('giftBox', 6.8, TOP, -92.0, { s: 1.4 }); L.prop('toyBlock', -6.6, TOP, -92.6, { s: 1.4 }); L.prop('toyBall', 6.6, TOP, -98.6, { s: 1.3 });
    L.block(6.6, TOP + 1.6, -104.0, 2.2, 1.6, 1.6, TOY(C_PINK));
    L.puffy(4, 7.2, TOP, -105.6, { hidden: true, thanks: [{ who: '뭉실이', text: '장난감 블록 뒤에 꼭꼭 숨어 있었는데! 찾아 줘서 고마워!', face: 'puffy4' }] });
    L.enemy('toysoldier', 4.6, TOP, -95.4, { range: 1.6 });
    L.enemy('toysoldier', -4.4, TOP, -98.8, { range: 1.6 });
    L.enemy('flyer', 0, TOP, -96.0, { flyH: 2.4, range: 2 });
    L.enemy('gloomy', 2.4, TOP, -100.2, { range: 1.5, hard: true });
    L.enemy('flyer', -3.0, TOP, -92.0, { flyH: 2.6, range: 2, hard: true });
    L.candyRing(0, TOP + 0.9, -97.3, 3.2, 10);
    L.heart(-1.6, TOP + 0.9, -91.0);
    L.petEvent('eagle', -7.2, 12.6, -83.6, {
      kind: 'chase',
      perches: [[-7.2, 12.6, -83.6], [12.4, 21.0, -90.6], [12.6, 31.8, -107.6], [-13.4, 31.8, -108.0], [-13.0, 39.0, -93.0], [-5.6, 45.4, -90.6]],
      taunts: ['나 잡아 봐라~ 꼭대기에서 만나!', '헤헤, 여기야! 더 높이!', '조금만 더! 바람이 시원해~', '거의 다 왔어!', '꼭대기다! 이리 와!'],
      endLines: ['헉헉, 정말 끝까지 따라왔구나! 너 진짜 용감하다!'],
      thanks: '나는 아기 독수리 용감이야! 이제 내가 너의 공격에 용기를 불어넣어 줄게!',
    });
    L.bridge([0, TOP, TZ - HW + 0.2], [0, TOP, -110.8], 2.6);
    L.candyLine([0, TOP + 0.9, -106.8], [0, TOP + 0.9, -110.2], 3);
    L.sign(-1.8, TOP, -105.4, ['이 다리 너머가 태엽 기사 클락의 회중시계 무대예요.', '째깍째깍... 힘내요, 소미!'], { icon: '!', yaw: 0 });
    const AZ = -123.4;
    const arena = L.arena(0, TOP, AZ, 13, { depth: 4.5, big: 0, small: 0, top: 'top:candy', pal: { grass: 0xfff2dc, grass2: 0xffe8cc, rim: 0xffcf6a, earth: 0xe8b860, rock: 0xd8a050 } });
    stage.arena = arena;
    {
      const items = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU, big = i % 3 === 0, rr = 11.4;
        items.push({ geo: G.UNIT.cylinder(), matrix: G.trs(Math.sin(a) * rr, TOP + 0.03, AZ + Math.cos(a) * rr, 0, 0, 0, big ? 0.55 : 0.35, 0.06, big ? 0.55 : 0.35), color: big ? [1, 0.55, 0.72] : [0.55, 0.78, 1] });
      }
      items.push({ geo: G.torusGeo(12.9, 0.35, 10, 72), matrix: G.trs(0, TOP + 0.05, AZ, Math.PI / 2, 0, 0), color: [1, 0.8, 0.32] });
      lv.addStatic('deco', G.mergeGeometries(items));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + 0.2;
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.4) continue;
        L.prop(['gearDeco', 'crayon', 'giftBox', 'toyBlock'][i % 4], Math.sin(a) * 12.3, TOP, AZ + Math.cos(a) * 12.3, { s: 1.1, yaw: a * 2, collide: false });
      }
    }
    stage.bossCtl = new ClockKnightBoss(stage, {
      pos: [0, TOP, AZ - 4.0], yaw: 0, arena,
      introLines: [
        { who: '태엽 기사 클락', text: '째깍째깍! 시계탑 꼭대기에 들어온 침입자는 누구냐!', face: 'bossfog:clockknight' },
        { who: SOMI, text: '클락! 회색 안개 때문에 태엽이 엉켜 버린 거야. 내가 풀어 줄게!', face: meFace() },
        { who: '태엽 기사 클락', text: '기사의 이름으로! 돌격-!', face: 'bossfog:clockknight' },
      ],
      thanks: [
        ['boss', '째깍... 째깍... 시간이 멈춘 것 같았어. 이제야 태엽이 술술 풀리는구나.'],
        ['boss', '고맙다, 용감한 꼬마 기사. 달빛 꿈의 정원에 가 봐. 모든 안개는 거기서 시작됐어.'],
        [SOMI, '달빛 꿈의 정원...? 거기에 뭐가 있는데?'],
        ['boss', '그리고 그곳에서... 누군가 아주 오랫동안 혼자 울고 있어.'],
        ['boss', '자, 꿈빛을 가져가렴. 장난감 나라에 다시 색이 돌아올 거야!'],
      ],
    });
    L.killY(-22);
    void Ease;
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      shots: [
        [[16, 14, 18], [0, 2, -12], 3.0],
        [[-20, 16, -40], [0, 3, -62], 3.0],
        [[26, 30, -72], [6, 26, -97], 3.2],
        [[-8, 56, -84], [0, 44, -118], 2.6],
      ],
      lines: [
        ['뭉실이', '어서 와, 소미야! 여기는 장난감 상자 나라야.', 'puffy3'],
        ['뭉실이', '저기 커다란 시계탑 보이지? 꼭대기의 태엽 기사 클락이 회색 안개 때문에 시간을 멈춰 버렸어...', 'puffy3'],
        [SOMI, '그럼 내가 시계탑 꼭대기까지 올라가 볼게!', 'me'],
        ['뭉실이', '톱니바퀴랑 시곗바늘을 타고 올라가야 해. 가는 길에 코끼리, 사자, 카피바라 쿠키도 꼭 찾아봐!', 'puffy3'],
      ],
      toast: '시계탑 꼭대기의 꿈빛을 찾아 출발~!',
    });
  },

  onCookie(id) {
    if (id === 'elephant') CTX.hud.toast('코끼리로 변신해서 씨앗에 물을 뿌려 봐요!', 'good', 3);
    if (id === 'lion') CTX.hud.toast('사자로 변신해서 바람개비 앞에서 어흥! 해 봐요', 'good', 3);
    if (id === 'capybara') CTX.hud.toast('빠른 장애물 앞에서 카피바라의 느긋 타임을 써 봐요!', 'good', 3);
    if (id === 'cow') CTX.hud.toast('소의 돌진은 단단한 바위도 쾅! 부숴요', 'good', 3);
  },
};

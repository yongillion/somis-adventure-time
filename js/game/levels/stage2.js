// ============================================================================
// stage2.js — 노을 과일 협곡 (Sunset Fruit Canyon)
// Sections:
//  A 노을 목장 — landing ranch (greeter Puffy, first fog cage, first enemies)        z   8 .. -10
//  B 캥거루 쿠키 & 바위문 — kangaroo cookie, sparrow chase, rock gate in a cliff      z -15 .. -45
//  C 데굴데굴 바위 비탈 — boulder slope (timing gauntlet 1) with hiding nooks         z -45 .. -71
//  D 다람쥐 쿠키 & 바람 협곡 — squirrel cookie, glide sign, updraft canyon crossing   z -71 .. -106
//  E 과일 과수원 — orchard hub: ladybug spots, pig cookie, dig mounds, buried switch,  z -109 .. -133
//      side area (+X): hamster cookie, spike slot & mouse hole to a secret nook
//  F 쿵쿵 바위 골짜기 — crusher slot canyon (timing gauntlet 2) + falling planks     z -133 .. -172
//  G 휘잉 바람 다리 — rope bridge with crosswind gusts (timing gauntlet 3)           z -172 .. -209
//  H 별 대포 언덕 — twin timer crystals blow the fog off the star cannon (puzzle)     z -209 .. -226
//  I 호박 대장 arena (lantern + bridge before)                                       z -248 .. -296
// ============================================================================
import { Vec3, TAU, clamp } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { TILE } from '../../engine/texgen.js';
import { CTX } from '../ctx.js';
import { PAL } from '../fx.js';
import { Save } from '../save.js';
import { blockParts, pillarParts, slabParts } from '../world/terrain.js';
import { buildObject } from '../models/objects.js';
import { softGlowMaterial } from '../models/props.js';
import { Marker } from '../bosses/boss.js';
import { PumpkinBoss } from '../bosses/pumpkin.js';
import { stageIntro, puffyNpc, ctl, SOMI, meFace } from './common.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const distTo = (x, z) => { const p = CTX.player; return p ? Math.hypot(p.pos.x - x, p.pos.z - z) : 99; };

// mesa strata colors; bands sit at absolute heights (every 2.5 m) so all cliffs
// share the same "geology" stripes: rust, terracotta, peach, pale sand, ...
const STRATA = [[0xd9774f, 0xcf6d48], [0xec9763, 0xe28a59], [0xf6b47e, 0xefa771], [0xfcd29e, 0xf6c58f]];
const BAND = 2.5;
const bandCol = (yb) => STRATA[((Math.round(yb / BAND) % 4) + 4) % 4];
// visual strata bands of a box between bottom..top (no collider)
function strata(L, x, top, z, w, bottom, d, o = {}) {
  let y = top, first = true;
  while (y > bottom + 0.01) {
    const onB = Math.abs(y / BAND - Math.round(y / BAND)) < 0.004;
    const yb = Math.max(bottom, onB ? y - BAND : Math.floor(y / BAND) * BAND);
    const c = bandCol(yb);
    const inset = first ? (o.cap ?? 0.1) : (Math.round(yb / BAND) % 2 ? 0.05 : 0);
    L.lv.addParts(blockParts(x, y, z, Math.max(0.3, w - inset * 2), y - yb + 0.02, Math.max(0.3, d - inset * 2), { yaw: o.yaw || 0, color: c[0], color2: c[1], key: 'block:sand', round: o.round ?? 0.12 }));
    y = yb; first = false;
  }
}
// layered sandstone block: one box collider + strata visuals. top = top surface, h = height.
function mesa(L, x, top, z, w, h, d, o = {}) {
  const bottom = top - h;
  L.col({ type: 'box', x, y: (top + bottom) / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: o.yaw || 0, tag: 'block' });
  strata(L, x, top, z, w, bottom, d, o);
  if (o.root) rootUnder(L, x, bottom, z, w, d, o.root === true ? 10 : o.root);
}
// tapered rocky underside (like the islands') hanging below a cliff mass (visual only)
function rootUnder(L, x, yTop, z, w, d, depth = 12, taper = 0.28) {
  L.lv.addParts(slabParts(x, yTop + 0.02, z, w, d, { pal: L.pal, depth, taper, thick: 0.04 }).filter((p) => p.key === 'side'));
}
// a row of cliff columns between x0..x1 with uneven tops (single colliders each)
function cliffRow(L, x0, x1, top, z, d, o = {}) {
  const span = x1 - x0;
  const n = Math.max(1, Math.round(span / (o.seg ?? 3.6)));
  const w = span / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + w * (i + 0.5);
    const k = (o.seed ?? 1) * 5 + i * 3;
    const keep = o.keep !== undefined && Math.abs(cx - o.keep) < w * 0.75;
    const dh = keep ? 0 : [0.9, 0, 1.7, 0.4, 2.4, -0.4][k % 6];
    const dz = keep ? 0 : [0, 0.3, -0.25, 0.4, -0.35][k % 5];
    mesa(L, cx, top + dh, z + dz, w + 0.05, top + dh - (o.bottom ?? -3), d);
    if (!keep && k % 3 === 0) L.prop('cactusRound', cx + (k % 2 ? 0.6 : -0.6), top + dh, z + dz, { seed: k, s: 1.0 + (k % 4) * 0.1 });
  }
  if (o.root !== false) rootUnder(L, (x0 + x1) / 2, o.bottom ?? -3, z, span, d + 0.6, 14);
}
// decorative-only sandstone block (no collider) — supports, roots
function deco(L, x, top, z, w, h, d, o = {}) {
  const ci = o.ci ?? 1;
  L.lv.addParts(blockParts(x, top, z, w, h, d, { yaw: o.yaw || 0, color: o.color ?? STRATA[ci][0], color2: o.color2 ?? STRATA[ci][1], key: 'block:' + (o.style || 'sand'), round: o.round ?? 0.2 }));
}
// tall layered rock spire in the background (visual only): stacked strata discs
function spire(L, x, top, z, r, h = 34, seed = 1) {
  let y = top, i = 0;
  while (y > top - h) {
    const yb = Math.floor((y - 0.01) / BAND) * BAND;
    const c = bandCol(yb);
    const rr = r * (i === 0 ? 1.0 : 0.9 + 0.08 * Math.min(i, 5)) * (0.95 + ((seed * 7 + i * 3) % 5) * 0.025);
    L.lv.addParts(pillarParts(x, y, z, rr, y - yb + 0.03, { color: c[1], topColor: c[0], key: 'block:sand' }));
    y = yb; i++;
  }
  if (seed % 2) L.prop('cactusRound', x + r * 0.3, top, z - r * 0.2, { seed, s: 1.2, collide: false });
}
// alias kept for the section code below
const bgMesa = (L, x, top, z, w, d, h = 34) => spire(L, x, top, z, Math.max(w, d) * 0.5, h, Math.round(x + z));

// ============================================================================ custom gameplay pieces
// Rolling boulders: each boulder drops onto the top of the slope (shadow marker),
// rolls down the line a -> b and bursts into dust at the bottom.
class Boulders {
  constructor(L, a, b, o = {}) {
    this.lv = L.lv;
    this.a = new Vec3(...a); this.b = new Vec3(...b);
    const hs = CTX.diff ? CTX.diff.hazardSpeed : 1;
    this.r = o.r ?? 0.75;
    this.period = (o.period ?? 3) / hs;
    this.speed = (o.speed ?? 5) * hs;
    this.t = (o.phase ?? 0) * this.period;
    this.dropH = o.dropH ?? 7;
    this.dir = new Vec3().subVectors(this.b, this.a);
    this.len = this.dir.length();
    this.dir.scale(1 / this.len);
    this.node = new Node('boulders');
    this.geo = G.rockGeo(this.r, o.seed ?? 3, 0.16, 1);
    this.mat = new Material({ color: o.color ?? 0xd98f5c, rim: 0.32, spec: 0.06 });
    this.balls = [];
    this.pool = [];
    this.lv.extraShadows = this.lv.extraShadows || [];
  }
  _spawn() {
    const m = this.pool.pop() || new Mesh(this.geo, this.mat);
    m.visible = true;
    this.node.add(m);
    const sh = { x: this.a.x, y: this.a.y + this.dropH, z: this.a.z, size: this.r * 2.6, a: 0.34 };
    this.lv.extraShadows.push(sh);
    const fallT = Math.sqrt((2 * this.dropH) / 26);
    const mk = new Marker(this.lv, this.a.x, this.a.y, this.a.z, this.r + 0.4, fallT, { color: 0xff9a5a });
    this.balls.push({ m, sh, d: 0, y: this.a.y + this.dropH, vy: 0, state: 'drop', mk });
  }
  _remove(i) {
    const bl = this.balls[i];
    bl.m.removeFromParent(); bl.m.visible = false; this.pool.push(bl.m);
    const k = this.lv.extraShadows.indexOf(bl.sh);
    if (k >= 0) this.lv.extraShadows.splice(k, 1);
    if (bl.mk) bl.mk.dead = true;
    this.balls.splice(i, 1);
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.period) { this.t -= this.period; this._spawn(); }
    const p = CTX.player;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const bl = this.balls[i];
      let x, y, z;
      if (bl.state === 'drop') {
        bl.vy -= 26 * dt; bl.y += bl.vy * dt;
        x = this.a.x; z = this.a.z;
        if (bl.y <= this.a.y) {
          bl.y = this.a.y; bl.state = 'roll'; bl.mk = null;
          CTX.fx.dust({ x, y: this.a.y, z }, 10, 1.4);
          const dd = distTo(x, z);
          if (dd < 26) { sfx('crusher', { vol: 0.25 * (1 - dd / 26), pitch: 1.3 }); if (dd < 12) CTX.fx.shake(0.08, 0.15); }
        }
        y = bl.y;
        bl.m.rotation.y += dt * 2.5;
      } else {
        bl.d += this.speed * dt;
        x = this.a.x + this.dir.x * bl.d; y = this.a.y + this.dir.y * bl.d; z = this.a.z + this.dir.z * bl.d;
        bl.m.rotation.x += (this.speed / this.r) * dt * Math.sign(this.dir.z || 1);
        bl.m.rotation.z -= (this.speed / this.r) * dt * this.dir.x;
        if (Math.random() < dt * 9) CTX.fx.dust({ x, y, z }, 1, 0.7);
        if (bl.d >= this.len) {
          CTX.fx.dust({ x, y: y + 0.3, z }, 14, 1.6);
          CTX.fx.sparkle({ x, y: y + this.r, z }, PAL.peach, 8, 0.6);
          const dd = distTo(x, z);
          if (dd < 22) sfx('break', { vol: 0.5 * (1 - dd / 22), pitch: 0.8 });
          this._remove(i);
          continue;
        }
      }
      bl.m.position.set(x, y + this.r, z);
      bl.sh.x = x; bl.sh.y = y + this.r; bl.sh.z = z;
      if (p && !p.dead) {
        const cx = p.pos.x - x, cy = p.pos.y + 0.55 - (y + this.r), cz = p.pos.z - z;
        if (cx * cx + cy * cy + cz * cz < (this.r + 0.36) ** 2) p.hurt(1, { x, y, z }, { hazard: true, knock: 8, up: 8 });
      }
    }
  }
}

// Warm updraft: a column of rising sunset air. Lifts Somi (and refreshes her hover)
// while she is inside — jump in and float up!
class Updraft {
  constructor(L, x, z, y0, y1, o = {}) {
    this.x = x; this.z = z; this.y0 = y0; this.y1 = y1;
    this.r = o.r ?? 1.7; this.lift = o.lift ?? 4.4;
    this.t = Math.random() * 3;
    this.node = new Node('updraft');
    this.node.position.set(x, y0, z);
    const vent = new Mesh(G.circleGeo(1, 36), new Material({ color: 0x9a5a40, rim: 0.2 }));
    vent.scale.set(this.r * 0.8, 1, this.r * 0.8); vent.position.y = 0.03;
    const glow = new Mesh(G.ringGeo(0.72, 1.0, 40), new Material({ color: 0xffb070, unlit: true, transparent: true, opacity: 0.85, depthWrite: false, side: 'double' }));
    glow.scale.set(this.r, 1, this.r); glow.position.y = 0.05;
    this.glow = glow;
    const col = new Mesh(G.cylinderGeo(1, 1, 1, 28, 1, false).translate(0, 0.5, 0), softGlowMaterial(0xffe6b8, { opacity: 0.22, rim: 1.4, side: 'double' }));
    col.scale.set(this.r * 0.95, y1 - y0, this.r * 0.95);
    this.col = col;
    this.node.add(vent, glow, col);
    this.rings = [];
    const rm = new Material({ color: 0xfff2d8, unlit: true, transparent: true, blending: 'additive', depthWrite: false, side: 'double', fog: false });
    for (let i = 0; i < 4; i++) {
      const ring = new Mesh(G.torusGeo(1, 0.035, 6, 40), rm);
      ring.rotation.x = Math.PI / 2;
      this.node.add(ring);
      this.rings.push(ring);
    }
    this.inside = false;
  }
  update(dt) {
    this.t += dt;
    const H = this.y1 - this.y0;
    for (let i = 0; i < this.rings.length; i++) {
      const k = (this.t * 0.42 + i / this.rings.length) % 1;
      const ring = this.rings[i];
      ring.position.y = k * H;
      const s = this.r * (0.7 + 0.4 * k);
      ring.scale.set(s, s, s);
      ring.opacity = Math.sin(k * Math.PI) * 0.75;
    }
    this.glow.opacity = 0.65 + 0.25 * Math.sin(this.t * 4);
    if (Math.random() < dt * 12) {
      const a = Math.random() * TAU, rr = Math.random() * this.r * 0.8;
      CTX.particles.emit({ pos: { x: this.x + Math.sin(a) * rr, y: this.y0 + 0.2, z: this.z + Math.cos(a) * rr }, count: 1, dir: { x: 0, y: 1, z: 0 }, spread: 0.08, speed: [3.4, 5.2], life: [1.1, 1.6], size: [0.13, 0.22], sizeEnd: 0.7, colors: [[1, 0.78, 0.5], [1, 0.62, 0.42], [1, 0.92, 0.72]], alpha: 0.9, tile: TILE.LEAF, spin: [2, 5], wobble: 1.4 });
    }
    const p = CTX.player;
    if (!p || p.dead || p.locked) { this.inside = false; return; }
    const dx = p.pos.x - this.x, dz = p.pos.z - this.z;
    const inside = dx * dx + dz * dz < this.r * this.r && p.pos.y > this.y0 - 0.6 && p.pos.y < this.y1;
    if (inside && !this.inside) { sfx('wind', { vol: 0.45, pitch: 1.35 }); if (!Updraft.taught && CTX.hud) { Updraft.taught = true; CTX.hud.toast('따뜻한 바람을 타고 둥실둥실~!', 'good', 2.4); } }
    this.inside = inside;
    if (!inside) return;
    const k = clamp((this.y1 - p.pos.y) / 1.8, 0.12, 1);
    p.pos.y += this.lift * k * dt;
    if (p.vel.y < 0) p.vel.y = 0;
    p.body.grounded = false;
    p.flaps = p.maxFlaps(); p.hoverT = 0;
    if (Math.random() < dt * 10) CTX.fx.trail({ x: p.pos.x, y: p.pos.y + 0.2, z: p.pos.z }, [1, 0.9, 0.7], 0.25);
  }
}

// Crosswind gust zone: telegraphed by fans spinning up, then pushes the player
// sideways (like a conveyor) while she is inside the box.
class Gust {
  constructor(L, x, y, z, hx, hy, hz, push, o = {}) {
    this.box = { x, y, z, hx, hy, hz };
    this.push = push;
    const hs = CTX.diff ? CTX.diff.hazardSpeed : 1;
    this.on = (o.on ?? 2.0) * hs;
    this.off = (o.off ?? 2.8) / hs;
    this.warn = 0.95;
    this.t = (o.phase ?? 0) * (this.on + this.off);
    this.node = new Node('gust');
    const yaw = Math.atan2(push[0], push[1]);
    this.fans = (o.fans || []).map(([fx, fy, fz]) => { const f = buildObject('windFan'); f.root.position.set(fx, fy, fz); f.root.rotation.y = yaw; f.root.scale.set(1.25, 1.25, 1.25); this.node.add(f.root); return f; });
    this.spin = 0.05;
    this.was = false;
    const l = Math.hypot(push[0], push[1]) || 1;
    this.dir = { x: push[0] / l, y: 0, z: push[1] / l };
  }
  get gusting() { const u = this.t % (this.on + this.off); return u >= this.off; }
  get calmLeft() { const u = this.t % (this.on + this.off); return u >= this.off ? 0 : this.off - u; }
  update(dt) {
    this.t += dt;
    const u = this.t % (this.on + this.off);
    const gust = u >= this.off;
    const warn = !gust && u > this.off - this.warn;
    const target = gust ? 1 : warn ? 0.5 : 0.04;
    this.spin += (target - this.spin) * Math.min(1, dt * (gust ? 6 : 3));
    for (const f of this.fans) f.update(dt, this.spin);
    const b = this.box;
    const close = distTo(b.x, b.z) < 30;
    if (close && gust && Math.random() < dt * 34) {
      CTX.particles.emit({ pos: { x: b.x - this.dir.x * b.hx + (Math.random() * 2 - 1) * Math.abs(this.dir.z) * b.hx, y: b.y + (Math.random() * 2 - 1) * b.hy, z: b.z - this.dir.z * b.hz + (Math.random() * 2 - 1) * Math.abs(this.dir.x) * b.hz }, count: 1, dir: this.dir, spread: 0.04, speed: [9, 13], life: 0.55, size: 0.11, sizeEnd: 0.05, color: [1, 1, 1], alpha: 0.65, tile: TILE.GLOW, additive: true, stretch: 0.16 });
    }
    if (close && (gust || warn) && Math.random() < dt * (gust ? 8 : 3)) {
      CTX.particles.emit({ pos: { x: b.x - this.dir.x * b.hx, y: b.y + (Math.random() * 2 - 1) * b.hy * 0.8, z: b.z + (Math.random() * 2 - 1) * b.hz }, count: 1, dir: this.dir, spread: 0.25, speed: gust ? [6, 9] : [1.5, 2.5], life: [1.0, 1.4], size: [0.14, 0.22], sizeEnd: 0.8, colors: [[1, 0.72, 0.4], [0.95, 0.85, 0.45], [1, 0.6, 0.45]], alpha: 0.95, tile: TILE.LEAF, spin: [3, 7], wobble: 1.5 });
    }
    if (gust && !this.was && close) sfx('wind', { vol: 0.75 * (1 - distTo(b.x, b.z) / 30), pitch: 0.85 });
    this.was = gust;
    if (!gust) return;
    const p = CTX.player;
    if (!p || p.dead || p.locked) return;
    if (Math.abs(p.pos.x - b.x) < b.hx && Math.abs(p.pos.y + 0.5 - b.y) < b.hy && Math.abs(p.pos.z - b.z) < b.hz) {
      const k = p.heavy ? 0.3 : 1;
      p.pos.x += this.push[0] * k * dt; p.pos.z += this.push[1] * k * dt;
    }
  }
}

// A fog bubble locking something until all its signals are on at the same time.
class FogLock {
  constructor(L, x, y, z, signals, o = {}) {
    this.lv = L.lv;
    this.pos = new Vec3(x, y, z);
    this.node = new Node('fogLock');
    this.node.position.set(x, y, z);
    this.r = o.r ?? 1.35;
    this.bubble = new Mesh(G.UNIT.sphereHi(), new Material({ color: 0xa89cd0, spec: 0.8, rim: 1.0, transparent: true, opacity: 0.55, depthWrite: false }));
    this.bubble.scale.set(this.r, this.r * 0.95, this.r);
    this.bubble.position.y = this.r * 0.8;
    this.bubble.renderOrder = 55;
    this.node.add(this.bubble);
    this.col = L.col({ type: 'cyl', x, y: y + this.r, z, hx: this.r * 0.95, hy: this.r, tag: 'fogLock' });
    this.state = {};
    this.open = false;
    this.t = 0;
    this.onOpen = o.onOpen || null;
    for (const s of signals) { this.state[s] = false; this.lv.onSignal(s, (v) => { this.state[s] = v; this._check(); }); }
  }
  _check() {
    if (this.open) return;
    const vals = Object.values(this.state);
    if (vals.filter(Boolean).length === 1 && CTX.hud && !this._hinted) { this._hinted = true; CTX.hud.toast('하나 켜졌어요! 시간이 끝나기 전에 다른 수정도 쳐요!', 'warn', 2.6); }
    if (!vals.every(Boolean)) return;
    this.open = true;
    this.col.enabled = false;
    this.popT = 0;
    const c = new Vec3(this.pos.x, this.pos.y + this.r * 0.8, this.pos.z);
    CTX.fx.pop(c, PAL.rainbow);
    for (let i = 0; i < 6; i++) CTX.fx.fogPuff({ x: c.x + (Math.random() - 0.5) * 2, y: c.y + (Math.random() - 0.5) * 1.5, z: c.z + (Math.random() - 0.5) * 2 }, 2);
    CTX.fx.colorBloom(this.pos, [1, 0.75, 0.4], 4);
    sfx('pop'); sfx('magic', { pitch: 1.2 });
    if (CTX.audio) CTX.audio.jingle('secret');
    if (this.onOpen) this.onOpen(this);
  }
  update(dt) {
    this.t += dt;
    if (!this.open) {
      const s = 1 + Math.sin(this.t * 1.8) * 0.03;
      this.bubble.scale.set(this.r * s, this.r * 0.95 / s, this.r * s);
      if (Math.random() < dt * 3) CTX.fx.fogPuff({ x: this.pos.x + (Math.random() - 0.5) * this.r * 2, y: this.pos.y + Math.random() * this.r * 1.6, z: this.pos.z + (Math.random() - 0.5) * this.r * 2 }, 1);
    } else if (this.bubble.visible) {
      this.popT += dt;
      const k = this.popT / 0.25;
      this.bubble.scale.set(this.r * (1 + k * 0.6), this.r * (1 + k * 0.6), this.r * (1 + k * 0.6));
      this.bubble.opacity = Math.max(0, 1 - k);
      if (k >= 1) this.bubble.visible = false;
    }
  }
}

// hide a floor switch until something (a dig mound) reveals it
function buryFloorSwitch(sw) {
  sw._hidden = true;
  sw.node.visible = false;
  sw.col.enabled = false;
  const upd = sw.update.bind(sw);
  sw.update = (dt) => { if (!sw._hidden) upd(dt); };
  sw.reveal = () => {
    if (!sw._hidden) return;
    sw._hidden = false;
    sw.node.visible = true;
    sw.col.enabled = true;
    CTX.fx.sparkle(new Vec3(sw.pos.x, sw.pos.y + 0.4, sw.pos.z), PAL.gold, 18, 0.8);
    CTX.fx.colorBloom(sw.pos, [1, 0.85, 0.4], 2.5);
    if (CTX.hud) { CTX.hud.toast('흙 속에서 스위치가 나왔어요! 올라가서 꾹 밟아 봐요!', 'good', 3); CTX.hud.pointAt(new Vec3(sw.pos.x, sw.pos.y + 0.5, sw.pos.z), 4); }
  };
  return sw;
}

// ============================================================================
export default {
  build(L, stage) {
    const lv = L.lv;
    const pf = (i, text) => ({ thanks: [{ who: '뭉실이', text, face: 'puffy' + i }] });

    // ------------------------------------------------------------ A. 노을 목장 (sunset ranch landing)
    L.island(0, 0, 0, 10, { clear: [[0, 6.5, 3], [0, 0.5, 2.6], [0, -6, 2.6], [-2.8, 3.2, 1.6], [2.8, 2.6, 1.4], [5.2, -4.6, 1.8], [-4.8, -2.8, 2.6], [3.5, -7.5, 1.4], [-3, -6.5, 1.5]], density: 1.0 });
    L.start(0, 0.3, 6.5, Math.PI);
    puffyNpc(L, -2.8, 0, 3.2, 5, [
      ['뭉실이', '어서 와, 소미야! 여기는 해 질 녘 노을빛이 예쁜 과일 협곡이야.', 'puffy5'],
      ['뭉실이', '그런데 회색 안개 때문에 오렌지도, 호박도 다 시들시들해졌어...', 'puffy5'],
      ['뭉실이', '협곡 곳곳에 동물 쿠키가 숨어 있대! 새 친구로 변신하면 막힌 길도 뚫을 수 있을 거야.', 'puffy5'],
    ], { yaw: 0.5 });
    L.sign(2.8, 0, 2.6, () => ['동물 쿠키를 먹으면 새 친구로 변신할 수 있어요!', ctl('오른쪽 위 얼굴 버튼을 누르면 언제든지 친구를 바꿀 수 있어요.', '1번 키(또는 Tab)를 누르면 언제든지 친구를 바꿀 수 있어요.')], { icon: '!', yaw: -0.3 });
    // fruit stand: wooden counter with crates of oranges & pumpkins
    L.block(-4.8, 0.9, -2.8, 3.2, 0.9, 1.4, { style: 'wood', color: 0xe9a86a, color2: 0xd99256 });
    L.block(-4.8, 2.7, -3.4, 3.4, 0.25, 2.0, { style: 'candy', color: 0xff9a5a, color2: 0xfff0e0, round: 0.1 });
    deco(L, -6.35, 2.5, -3.4, 0.16, 1.6, 0.16, { style: 'wood', color: 0xc98b55, round: 0.05 });
    deco(L, -3.25, 2.5, -3.4, 0.16, 1.6, 0.16, { style: 'wood', color: 0xc98b55, round: 0.05 });
    L.prop('pumpkinDeco', -5.6, 0.9, -2.8, { s: 0.8, seed: 2 });
    L.prop('pumpkinDeco', -4.2, 0.9, -2.7, { s: 0.65, seed: 5 });
    L.prop('crateDeco', -6.9, 0, -1.6, { s: 0.8, seed: 1 });
    L.candyRing(-4.8, 1.6, -2.8, 0.9, 6);
    L.prop('hayBale', 6.2, 0, -3.2, { seed: 3, yaw: 0.4 });
    L.prop('hayBale', 6.6, 0, -5.4, { seed: 8, yaw: -0.3 });
    L.prop('hayBale', 6.4, 0.9, -4.3, { seed: 5, yaw: 1.2, s: 0.9 });
    for (const [x, z, y] of [[-7.6, 4.2, 0.6], [-6.2, 6.8, -0.4], [6.8, 4.8, 2.4], [8.4, 1.2, 1.7]]) L.prop('fence', x, 0, z, { yaw: y, seed: 2, color: 0xdca26c });
    L.prop('orangeTree', -7.2, 0, 1.0, { seed: 4, s: 1.1 });
    L.prop('orangeTree', 7.4, 0, -0.6, { seed: 6 });
    L.prop('barrel', 3.2, 0, -8.0, { seed: 1 });
    L.puffy(0, 5.0, 0, -4.4, pf(0, '고마워! 노을이 회색으로 변해서 너무 슬펐어... 협곡 끝까지 힘내!'));
    L.candyLine([0, 0.9, 4.6], [0, 0.9, 0.2], 5);
    L.candyArc([0.4, 0.9, -1.2], [0, 0.9, -8.8], 6, 1.0);
    L.enemy('gloomy', -2.6, 0, -6.2, { range: 2.2 });
    L.enemy('gloomy', 2.8, 0, -7.0, { range: 1.8, hard: true });
    L.enemy('hopper', -5.4, 0, -6.6, { range: 1.4 });
    L.bridge([0, 0, -9.7], [0, 0, -15.3], 2.4);
    L.candyLine([0, 0.9, -10.6], [0, 0.9, -14.4], 4);

    // ------------------------------------------------------------ B. 캥거루 쿠키 & 바위문
    L.island(0, 0, -24, 9, { clear: [[0, -16, 2.2], [0, -19.6, 2.2], [0, -24, 2.2], [0, -30, 2.6], [2.4, -21.6, 1.2], [2.4, -29.6, 1.2], [-6.4, -21.2, 1.8], [-6.4, -28.2, 1.8], [6.2, -27.4, 1.8], [6.4, -19.4, 1.8], [-3.6, -26.8, 1.3], [-7.2, -24.6, 1.4], [7.6, -23.8, 1.4]], density: 0.85 });
    L.pillar(0, 0.34, -19.6, 1.35, 1.0, { style: 'wood', color: 0xd99a62, topColor: 0xf0be86 });
    L.cookie('kangaroo', 0, 1.3, -19.6);
    L.candyRing(0, 1.0, -19.6, 1.9, 8);
    L.sign(2.4, 0, -21.6, () => ['캥거루는 힘이 아주 센 친구예요!', ctl('공격 버튼을 누르면 복싱 펀치! 단단한 바위도 퍽! 부서져요.', 'J(또는 X)를 누르면 복싱 펀치! 단단한 바위도 퍽! 부서져요.')], { icon: '!', yaw: -0.25 });
    // the cliff with a 3 x 2.5 m tunnel blocked by a big rock
    cliffRow(L, -17.5, -1.5, 7.5, -34.25, 4.5, { seed: 1, keep: -1.5, bottom: -6 });
    cliffRow(L, 1.5, 17.5, 7.5, -34.25, 4.5, { seed: 2, keep: 1.5, bottom: -6 });
    mesa(L, 0, 7.5, -34.25, 3.1, 5.0, 4.5);
    L.rock(0, 0, -34.25, { size: 2.45, drops: { candy: 6 } });
    L.sign(2.6, 0, -30.0, () => ['단단한 바위가 길을 꽉 막았어요!', ctl('힘센 친구로 변신해서 공격 버튼으로 퍽! (오른쪽 위 얼굴 버튼으로 변신)', '힘센 친구로 변신해서 공격 버튼으로 퍽! (1번 키 또는 Tab으로 변신)')], { icon: '?', yaw: -0.2 });
    L.prop('mesaPillar', -7.0, null, -35.0, { seed: 3, s: 0.9 });
    L.prop('mesaPillar', 12.2, null, -35.4, { seed: 6, s: 1.1 });
    L.prop('orangeTree', -7.2, 0, -24.6, { seed: 9, s: 1.05 });
    L.prop('orangeTree', 7.6, 0, -23.8, { seed: 2, s: 1.0 });
    L.prop('hayBale', -6.4, 0, -21.2, { seed: 3, yaw: 0.3 });
    L.prop('hayBale', -6.4, 0.9, -21.2, { seed: 6, s: 0.85, yaw: 1.1 });
    L.prop('hayBale', -6.4, 0, -28.2, { seed: 4 });
    L.prop('hayBale', -6.4, 0.9, -28.2, { seed: 7, s: 0.85, yaw: 0.8 });
    L.prop('barrel', 6.2, 0, -27.4, { seed: 5 });
    L.prop('barrel', 6.2, 0.92, -27.4, { seed: 8, s: 0.85 });
    L.prop('hayBale', 6.4, 0, -19.4, { seed: 1, yaw: 0.5 });
    L.prop('barrel', -3.6, 0, -26.8, { seed: 2 });
    L.candyLine([0, 0.9, -22.4], [0, 0.9, -28.8], 5);
    L.candyArc([-3.2, 0.9, -24], [-5.6, 0.9, -27.4], 4, 1.0);
    L.heart(-3.6, 1.6, -26.8);
    L.enemy('hopper', 3.2, 0, -25.4, { range: 2.4 });
    L.enemy('hopper', -3.0, 0, -22.0, { range: 2.0 });
    L.enemy('gloomy', 4.2, 0, -30.6, { range: 1.6 });
    L.enemy('hopper', -2.2, 0, -30.4, { range: 1.6, hard: true });
    // 짹짹이 — sparrow chase around the ranch trees
    L.petEvent('sparrow', -6.4, 1.95, -21.2, {
      kind: 'chase',
      perches: [[-6.4, 1.95, -21.2], [-6.4, 1.95, -28.2], [6.2, 1.85, -27.4], [6.4, 1.55, -19.4]],
      taunts: ['짹짹! 여기야~', '나 잡아 봐라~ 짹!', '거의 다 왔어! 짹짹!'],
      endLines: ['짹! 잡혔다! 너 정말 빠르구나!', '나는 참새 짹짹이야. 안개 때문에 혼자 무서웠는데, 같이 놀아 줘서 고마워!'],
      thanks: '이제부터 내가 같이 다닐게! 하늘에서 한 번 더 폴짝 뛸 수 있게 도와줄게. 짹짹!',
    });

    // ------------------------------------------------------------ C. 데굴데굴 바위 비탈 (boulder slope)
    L.slab(0, 0, -38.6, 6, 13, { thick: 0.8, depth: 6, taper: 0.5 });
    L.checkpoint(-2.2, 0, -41.0, { yaw: Math.PI });
    L.sign(2.2, 0, -42.6, () => ['데굴데굴! 커다란 바위가 굴러 내려와요.', '옆의 쏙 들어간 쉼터에 숨거나, 바위가 오면 폴짝 뛰어넘어요!'], { icon: '!', yaw: -0.3 });
    const rampA = [0, 0, -45], rampB = [0, 6, -71];
    const rampY = (z) => ((-45 - z) / 26) * 6;
    L.ramp(rampA, rampB, 3.6);
    // supporting ridge under the slope + side nooks
    for (let z = -48; z >= -69; z -= 4.2) deco(L, 0, rampY(z) - 0.75, z, 3.4, 9 + rampY(z), 4.4, { ci: 1 });
    for (const [side, z] of [[1, -52.5], [-1, -60], [1, -66.5]]) {
      const y = rampY(z);
      L.slab(side * 2.95, y, z, 2.3, 2.6, { thick: 0.6, depth: 3, taper: 0.4 });
      L.candyRing(side * 2.95, y + 0.9, z, 0.6, 4);
      L.prop('barrel', side * 3.6, y, z - 0.7, { seed: 3 + z, s: 0.8 });
    }
    L.boulders = L._add(new Boulders(L, [0, rampY(-69), -69], rampA, { r: 0.75, period: 3.2, speed: 5.0, dropH: 7.5 }));
    L.candyLine([0, 0.9, -46.5], [0, rampY(-68) + 0.9, -68], 9);
    // puffy 1 on a mesa pillar next to the left nook
    L.pillar(-6.3, 5.4, -60, 1.45, 14, { style: 'sand', color: STRATA[1][0], topColor: STRATA[3][0] });
    L.puffy(1, -6.3, 5.4, -60, pf(1, '바위가 데굴데굴 굴러서 무서웠어! 높은 곳까지 와 줘서 고마워!'));
    L.candyArc([-4.0, rampY(-60) + 1, -60], [-6.0, 6.3, -60], 4, 1.2);
    L.prop('cactusRound', -6.9, 5.4, -60.6, { seed: 2, s: 0.7 });
    // background mesas framing the slope
    bgMesa(L, -13, 9, -55, 6, 7);
    bgMesa(L, 12, 11, -62, 7, 6);
    bgMesa(L, -11, 4, -72, 5, 5);

    // ------------------------------------------------------------ D. 다람쥐 쿠키 & 바람 협곡 (squirrel + updraft canyon)
    L.island(0, 6, -78, 7.2, { clear: [[0, -71.5, 2.4], [0, -78.6, 2.4], [0, -84.5, 2.2], [3.0, -74.5, 1.4], [-2.6, -81.4, 1.2]], density: 0.8 });
    L.checkpoint(3.0, 6, -74.5, { yaw: Math.PI });
    L.cookie('squirrel', 0, 7.0, -78.6);
    L.candyRing(0, 6.9, -78.6, 1.4, 6);
    L.sign(-2.6, 6, -81.4, () => ['다람쥐는 하늘을 나는 날다람쥐 친구!', ctl('점프한 뒤 특기 버튼을 꾹~ 누르고 있으면 쭈욱 활공해요.', '점프한 뒤 특기 키(L 또는 C)를 꾹~ 누르고 있으면 쭈욱 활공해요.'), '아래에서 올라오는 따뜻한 바람을 타면 높이 둥실 떠올라요!'], { icon: '!', yaw: 0.25 });
    L.enemy('gloomy', -3.4, 6, -76.6, { range: 2.0 });
    L.enemy('hopper', 3.4, 6, -81.6, { range: 1.2 });
    L.island(0, 5.6, -89.6, 2.6, { big: 0, small: 0, grass: true });
    L.island(2.6, 5.0, -96.4, 2.4, { big: 0, small: 0, grass: true, clear: [[2.6, -96.4, 2]] });
    L.updraftA = L._add(new Updraft(L, 2.6, -96.4, 5.0, 11.8, { r: 1.7 }));
    // optional updraft from the first rock: sweets up in the sky
    L._add(new Updraft(L, -1.2, -90.0, 5.6, 10.6, { r: 1.2, lift: 3.6 }));
    L.candyRing(-1.2, 10.2, -90.0, 1.1, 8);
    L.bigCandy(-1.2, 11.4, -90.0);
    L.island(-0.8, 10.4, -103.6, 2.6, { big: 0, small: 1, grass: true });
    L.puffy(4, -2.5, 10.4, -104.3, { hidden: true, ...pf(4, '찾았다! 바람 위에 숨어 있었는데 어떻게 알았어? 숨바꼭질 대장이네!') });
    L.candyArc([0.4, 6.5, -85.0], [1.0, 6.5, -88.4], 3, 0.8);
    L.candyArc([1.4, 6.2, -90.8], [2.4, 5.9, -95.0], 4, 1.1);
    L.candyLine([2.6, 6.2, -96.4], [2.6, 11.0, -96.4], 5);
    L.candyArc([1.8, 11.6, -98.0], [-0.4, 11.3, -102.6], 4, 0.6);
    L.candyArc([-0.6, 11.3, -105.4], [-0.2, 10.9, -110.4], 4, 1.0);
    L.enemy('flyer', 1.0, 8.6, -92.6, { flyH: 0, range: 2.2, hard: true });
    // canyon walls far to the sides (background)
    bgMesa(L, -15, 6, -90, 6, 8, 34);
    bgMesa(L, 16, 9, -98, 7, 7, 34);
    bgMesa(L, -14, 12, -106, 5, 6, 34);
    bgMesa(L, 13, 3, -84, 5, 5, 30);

    // ------------------------------------------------------------ E. 과일 과수원 (fruit orchard hub)
    const EC = [0, 10, -121];
    L.island(0, 10, -121, 12, {
      clear: [[0, -110, 2.4], [0, -116.5, 2.6], [0, -123, 2.6], [0, -129, 2.6], [0, -133, 2.4], [-3, -112.6, 1.5], [3.2, -112.2, 1.5], [-2.6, -118.4, 1.2],
        [-7, -121.5, 1.4], [-9.2, -126.5, 1.4], [5.5, -122.5, 1.4], [2.6, -130.2, 1.4], [-4.2, -129.2, 1.6], [-2.4, -131.0, 1.2], [11, -121, 2.2], [-6.5, -114, 1.4], [8.2, -116.5, 3.0]],
      density: 0.55, big: 0,
    });
    L.checkpoint(-3.0, 10, -112.6, { yaw: Math.PI });
    puffyNpc(L, 3.2, 10, -112.2, 1, [
      ['뭉실이', '여기는 오렌지가 주렁주렁 열리는 과수원이야.', 'puffy1'],
      ['뭉실이', '무당벌레 점박이가 날개 점을 잃어버려서 울고 있대. 한번 이야기해 볼래?', 'puffy1'],
      ['뭉실이', '그리고 반짝반짝 흙더미가 보이면... 돼지 친구가 킁킁 파 보면 좋을 텐데!', 'puffy1'],
    ], { yaw: -0.4 });
    // orchard rows
    for (const x of [-9.2, -5.4, 5.4, 9.2]) for (const z of [-114.5, -120.0, -125.5]) {
      if (Math.hypot(x - 8.2, z + 116.5) < 3 || (x === -5.4 && z === -120.0)) continue;
      L.prop('orangeTree', x, 10, z + (x > 0 ? 0.6 : -0.4), { seed: Math.round(x * 3 - z), s: 0.95 + ((x * 7 + z) % 3) * 0.05 });
    }
    // little red barn (east)
    L.block(8.4, 12.4, -116.6, 3.6, 2.4, 3.0, { style: 'wood', color: 0xe8805a, color2: 0xd8704e });
    L.block(8.4, 13.1, -116.6, 3.6, 0.7, 3.0, { style: 'wood', color: 0xb8654a, color2: 0xa85a40, round: 0.25 });
    L.block(5.9, 11.1, -117.4, 1.3, 1.1, 1.3, { style: 'wood', color: 0xf3d27a, color2: 0xe9c066, round: 0.3 });
    L.prop('hayBale', 6.0, 10, -114.6, { seed: 2 });
    L.prop('pumpkinDeco', 4.0, 10, -127.6, { seed: 1 });
    L.prop('pumpkinDeco', 3.4, 10, -126.4, { seed: 3, s: 0.8 });
    L.prop('pumpkinDeco', -10.0, 10, -118.4, { seed: 4 });
    L.block(-6.6, 11.5, -128.8, 1.9, 1.5, 1.9, { style: 'wood', color: 0xf0c27a, color2: 0xe6b06a });
    L.prop('crateDeco', -7.9, 10, -128.4, { s: 0.8, seed: 3 });
    // pig cookie + dig mounds
    L.cookie('pig', 0, 11.0, -116.5);
    L.candyRing(0, 10.9, -116.5, 1.2, 6);
    L.sign(-2.6, 10, -118.4, () => ['반짝반짝 빛나는 흙더미가 보이나요?', ctl('돼지로 변신해서 흙더미 위에서 특기 버튼! 꿀꿀~ 땅을 파면 보물이 나와요.', '돼지로 변신해서 흙더미 위에서 특기 키(L 또는 C)! 꿀꿀~ 땅을 파면 보물이 나와요.')], { icon: '?', yaw: 0.3 });
    L.dig(-7.0, 10, -121.5, (pos) => { CTX.pickups.bigCandy(pos.x, pos.y + 0.6, pos.z); CTX.pickups.drop(pos, 4, 2); });
    L.dig(-9.2, 10, -126.5, (pos) => {
      // the cage pops up next to the mound, toward the middle of the orchard
      const p = CTX.player;
      let cx = -7.6, cz = -125.9;
      if (Math.hypot(p.pos.x - cx, p.pos.z - cz) < 1.3) { cx = -9.4; cz = -124.4; }
      L.puffy(2, cx, 10, cz, pf(2, '흙 속에 갇혀 있었어! 꿀꿀 파 줘서 고마워!'));
      CTX.fx.pop(new Vec3(pos.x, pos.y + 0.6, pos.z), PAL.rainbow);
      if (CTX.hud) CTX.hud.toast('흙 속에서 뭉실이가 나왔어요! 방울을 톡톡 깨 줘요!', 'good', 3);
    });
    L.dig(5.5, 10, -122.5, (pos) => { CTX.pickups.dropHeart(pos); CTX.pickups.drop(pos, 5, 2.2); });
    // the canyon gate: its switch is buried under the mound by the gate
    const gateSw = buryFloorSwitch(L.floorSwitch(2.6, 10, -130.2, 'orchardGate', { mode: 'once' }));
    L.dig(2.6, 10, -130.2, () => gateSw.reveal());
    L.gate(0, 10, -133.7, 0, 'orchardGate', { w: 3.4, h: 2.8 });
    L.sign(-2.4, 10, -131.0, () => ['문이 꼭 잠겼어요...', '문을 여는 스위치가 근처 흙 속에 숨어 있대요! 반짝이는 흙더미를 꿀꿀 파 봐요.'], { icon: '?', yaw: 0.15 });
    L.checkpoint(-4.2, 10, -129.2, { yaw: Math.PI });
    // 점박이 — ladybug lost her 7 spots in the orchard
    L.petEvent('ladybug', -6.5, 11.3, -114.0, {
      kind: 'collect', itemKind: 'spot', label: '점',
      items: [[-8.6, 10.9, -117.0], [-10.4, 10.9, -123.2], [-6.6, 12.35, -128.8], [8.6, 13.95, -116.6], [6.8, 10.9, -125.0], [-1.5, 13.1, -124.0], [8.8, 10.9, -127.6]],
      lines: ['흑흑... 나는 무당벌레 점박이야. 안개 바람에 내 날개 점이 일곱 개나 날아가 버렸어.', '빨간 점들이 과수원 여기저기에 떨어져 있을 거야. 높은 곳도 잘 찾아봐 줄래?'],
      thanks: '내 점이 다 돌아왔어! 이제 행운이 가득해! 먹구름이들이 별사탕을 더 많이 떨어뜨리게 도와줄게.',
    });
    L.block(-1.5, 12.2, -124.0, 1.5, 2.2, 1.5, { style: 'wood', color: 0xf0c27a, color2: 0xe6b06a });
    L.prop('barrel', -2.5, 10, -125.0, { s: 0.9, seed: 2 });
    L.candyLine([0, 10.9, -110.4], [0, 10.9, -114.4], 4);
    L.candyLine([0, 10.9, -119.0], [0, 10.9, -128.4], 7);
    L.candyRing(-6.6, 12.4, -128.8, 0.75, 5);
    L.enemy('gloomy', -3.6, 10, -122.6, { range: 2.6 });
    L.enemy('gloomy', 4.2, 10, -121.0, { range: 2.4 });
    L.enemy('hopper', -7.6, 10, -124.6, { range: 2.0 });
    L.enemy('shooter', -10.6, 10, -119.4, { range: 0.3, yaw: 1.2 });
    L.enemy('roller', 2.5, 10, -126.2, { range: 2.5 });
    L.enemy('charger', -5.0, 10, -117.0, { range: 2, hard: true });
    // --- side area (+X): hamster cookie, spike slot & mouse hole to a secret nook
    L.bridge([11.7, 10, -121], [16.3, 10, -121], 2.2);
    L.island(20.6, 10, -121, 4.6, { clear: [[20.6, -121, 1.6], [24.6, -121, 1.6], [18.8, -118.4, 1.2]], density: 0.7 });
    L.cookie('hamster', 20.6, 11.0, -121);
    L.candyRing(20.6, 10.9, -121, 1.3, 6);
    L.sign(18.8, 10, -118.4, () => ['햄스터는 데굴데굴 공 속에 쏙 들어가는 친구!', ctl('특기 버튼을 누르면 햄스터 볼! 가시 바닥도 아프지 않고 낮은 구멍도 쏙 지나가요.', '특기 키(L 또는 C)를 누르면 햄스터 볼! 가시 바닥도 아프지 않고 낮은 구멍도 쏙 지나가요.')], { icon: '!', yaw: -0.6 });
    // spike slot between tall cliffs (x 25 -> 33.5), then a 2m-thick wall with a 0.95m-high mouse hole
    L.slab(30.25, 10, -121, 10.5, 2.6, { thick: 0.7, depth: 5, under: true });
    // spike floor (top at 10.16) runs all the way through the mouse hole: only the hamster ball fits
    L.spikes(30.6, 9.8, -121, 11.0, 2.3);
    for (const [x, w, top] of [[26.6, 3.2, 17.4], [29.7, 3.1, 18.6], [32.4, 2.4, 17.2]]) {
      mesa(L, x, top, -118.25, w + 0.04, top - 6, 3.1);
      mesa(L, x, top - 0.6 + (x > 29 ? 1.2 : 0), -123.75, w + 0.04, top - 6.6 + (x > 29 ? 1.2 : 0), 3.1);
    }
    rootUnder(L, 34.0, 6, -121, 18.6, 10.2, 13);
    mesa(L, 34.5, 17.6, -121, 2.0, 6.6, 7.4);
    mesa(L, 34.5, 11.0, -123.2, 2.0, 5.0, 2.8);
    mesa(L, 34.5, 11.0, -118.8, 2.0, 5.0, 2.8);
    L.prop('cactusRound', 29.7, 18.6, -118.4, { seed: 3, s: 1.2 });
    L.prop('mesaPillar', 26.6, 17.4, -123.8, { seed: 5, s: 0.7 });
    // the secret nook (enclosed by tall cliffs, open sky)
    L.slab(38.6, 10, -121, 6.4, 7.4, { thick: 0.7, depth: 5 });
    mesa(L, 42.3, 18.2, -121, 1.4, 12.2, 9.6);
    mesa(L, 38.4, 17.4, -116.65, 9.2, 11.4, 1.3);
    mesa(L, 38.4, 17.0, -125.35, 9.2, 11.0, 1.3);
    L.prop('orangeTree', 41.2, 10, -124.0, { seed: 4, s: 0.85 });
    L.prop('hayBale', 36.6, 10, -124.2, { seed: 2 });
    L.puffy(3, 39.6, 10, -122.8, pf(3, '가시 길을 지나서 비밀 방까지 왔어? 데굴데굴 햄스터 최고야!'));
    L.bigCandy(38.0, 11.0, -119.4);
    L.candyRing(38.4, 10.9, -121, 1.6, 8);
    L.candyLine([26.0, 10.9, -121], [33.0, 10.9, -121], 6);
    L.cannon(40.3, 10, -119.0, [20.6, 10.4, -121], { time: 1.5 });
    L.camZone(32, 13, -121, 11, 7, 6.5, { yaw: -Math.PI / 2 + 0.25, pitch: 0.95, dist: 11.5, priority: 2 });

    // ------------------------------------------------------------ F. 쿵쿵 바위 골짜기 (crusher slot canyon)
    L.slab(0, 10, -146.45, 5.2, 29.3, { thick: 0.8, depth: 7, under: true });
    const zones = [['p', -133.5, -136.0], ['c', -136.0, -139.4], ['p', -139.4, -142.4], ['c', -142.4, -145.8], ['p', -145.8, -148.8], ['c', -148.8, -152.2], ['p', -152.2, -155.2], ['c', -155.2, -158.6], ['p', -158.6, -161.1]];
    const crushZ = [];
    zones.forEach(([k, z0, z1], i) => {
      const zc = (z0 + z1) / 2, d = z0 - z1 + 0.02;
      const inner = k === 'c' ? 1.62 : 2.6;
      const w = 8.5 - inner;
      for (const sd of [-1, 1]) {
        const top = 17.2 + [0.6, 0, 1.3, 0.3, 1.0, -0.2, 1.6, 0.4, 0.8][(i + (sd > 0 ? 3 : 0)) % 9];
        mesa(L, sd * (inner + w / 2), top, zc, w, top - 4, d);
      }
      if (k === 'c') crushZ.push(zc);
      else L.candyRing(0, 10.9, zc, 0.8, 5);
    });
    for (const sd of [-1, 1]) rootUnder(L, sd * 5.05, 4, -147.3, 6.9, 27.8, 12);
    // crushers don't block the camera (it looks down into the slot from above)
    crushZ.forEach((z, i) => { const c = L.crusher(0, z, 13.5, 10, { size: 2.9, phase: i * 0.27, wait: 1.5 }); c.col.camBlock = false; });
    for (const [x, z] of [[-5.5, -137], [6, -143], [-6.2, -151], [5.2, -157.5], [-3.8, -146]]) L.prop('cactusRound', x, 17.5, z, { seed: Math.round(z), s: 1.1 });
    L.prop('mesaPillar', 6.2, 17.5, -149.5, { seed: 2 });
    L.camZone(0, 13, -147.5, 6, 6, 14.5, { yaw: 0, pitch: 0.9, dist: 9.5, priority: 2 });
    L.sign(-1.9, 10, -134.8, () => ['쿵쿵 바위 골짜기예요! 바위 얼굴이 화난 표정을 지으면 곧 쿵! 떨어져요.', '넓은 쉼터에서 기다렸다가, 바위가 올라가면 재빨리 지나가요!'], { icon: '!', yaw: 0.2 });
    // falling planks
    for (const z of [-163.4, -166.4, -169.4]) L.falling('wood', 0, 10, z, 2.4, 2.4, 0.5, { delay: 0.6 });
    L.candyLine([0, 10.9, -162.2], [0, 10.9, -170.6], 6);
    L.enemy('flyer', 1.2, 12.4, -166.4, { flyH: 0, range: 1.6, hard: true });

    // ------------------------------------------------------------ G. 휘잉 바람 다리 (gusty rope bridge)
    L.island(0, 10, -177, 5, { clear: [[0, -173, 2], [0, -177, 2], [0, -181.5, 2], [2.8, -175, 1.2], [-2.6, -179.2, 1.2]], density: 0.8 });
    L.checkpoint(2.8, 10, -175, { yaw: Math.PI });
    L.sign(-2.6, 10, -179.2, () => ['바람 다리예요! 바람개비가 빙글빙글 빨라지면 곧 휘잉~ 바람이 불어요.', '바람이 멈추면 얼른 건너요. 동그란 바위 쉼터에서는 바람이 안 불어요!'], { icon: '!', yaw: 0.2 });
    L.heart(-2.0, 11.2, -175.6);
    L.enemy('hopper', 2.2, 10, -178.6, { range: 1.4 });
    const segs = [[-182.0, -188.0], [-192.4, -198.4], [-202.8, -209.3]];
    segs.forEach(([z0, z1], i) => {
      L.bridge([0, 10, z0], [0, 10, z1], 2.8);
      const zc = (z0 + z1) / 2;
      L.pillar(-4.6, 9.5, zc, 0.9, 7, { style: 'sand', color: STRATA[1][0], topColor: STRATA[3][0] });
      lv.gusts = lv.gusts || [];
      lv.gusts.push(L._add(new Gust(L, 1.6, 11.2, zc, 4.4, 2.6, 3.1, [2.0, 0], { phase: [0, 0.34, 0.67][i], fans: [[-4.6, 9.5, zc]] })));
      L.candyLine([0, 10.9, z0 - 1], [0, 10.9, z1 + 1], 3);
    });
    for (const z of [-190.2, -200.6]) {
      L.island(0, 10, z, 2.2, { big: 0, small: 0, grass: true });
      L.block(-1.6, 11.6, z, 0.7, 1.6, 2.4, { style: 'sand', color: STRATA[2][0], color2: STRATA[2][1], round: 0.3 });
      L.candyRing(0, 10.9, z, 0.7, 4);
    }
    L.enemy('flyer', 3.0, 12.4, -200.6, { flyH: 0, range: 1.4, hard: true });
    bgMesa(L, 14, 8, -186, 6, 6, 32);
    bgMesa(L, -14, 14, -196, 5, 7, 34);
    bgMesa(L, 15, 15, -207, 6, 5, 34);

    // ------------------------------------------------------------ H. 별 대포 언덕 (star cannon hill)
    L.island(0, 10, -217.5, 8.7, { clear: [[0, -209.6, 2.2], [0, -214, 2.4], [0, -223.4, 2.4], [-6, -214, 1.8], [6.5, -221.4, 1.4], [-2.5, -211.6, 1.2], [3.6, -211.2, 1.2]], density: 0.75 });
    L.sign(-2.5, 10, -211.6, () => ['회색 안개가 별 대포를 꽁꽁 감쌌어요!', '수정 스위치 두 개를 재빨리 연달아 치면 안개가 걷힐 거예요. 째깍째깍, 시간이 있어요!'], { icon: '?', yaw: 0.2 });
    puffyNpc(L, 3.6, 10, -211.2, 3, [
      ['뭉실이', '저 별 대포를 타면 슝~ 하고 건너편 언덕까지 날아갈 수 있어!', 'puffy3'],
      ['뭉실이', '높은 상자 위의 수정을 먼저 치고, 바로 대포 옆 수정으로 달려가 봐!', 'puffy3'],
    ], { yaw: -0.3 });
    L.block(-6, 12.4, -214, 2.0, 2.4, 2.0, { style: 'wood', color: 0xf0c27a, color2: 0xe6b06a });
    L.crystal(-6, 12.4, -214, 'canA', { mode: 'timer', timer: 8 });
    L.crystal(6.5, 10, -221.4, 'canB', { mode: 'timer', timer: 8 });
    const cannon = L.cannon(0, 10, -223.6, [0, 14.9, -254], { time: 1.7 });
    const lock = L._add(new FogLock(L, 0, 10, -223.6, ['canA', 'canB'], {
      onOpen: () => { if (CTX.hud) { CTX.hud.toast('안개가 걷혔어요! 별 대포에 쏙 들어가 봐요!', 'good', 3); CTX.hud.pointAt(new Vec3(0, 11, -223.6), 4); } },
    }));
    const cup = cannon.update.bind(cannon);
    cannon.update = (dt) => { if (!lock.open) { cannon.obj.update(dt); return; } cup(dt); };
    L.candyLine([0, 10.9, -209.6], [0, 10.9, -219.4], 6);
    L.candyArc([-4.6, 11, -212.8], [-6, 13.6, -214], 3, 0.8);
    L.candyArc([0, 13, -228], [0, 16, -246], 7, 4);
    L.prop('barrel', -7.4, 10, -216.2, { seed: 4 });
    L.prop('crateDeco', -4.6, 10, -216.0, { seed: 2, s: 0.8 });
    L.prop('orangeTree', 6.4, 10, -213.6, { seed: 7 });
    L.prop('hayBale', -6.8, 10, -220.4, { seed: 3, yaw: 0.6 });
    L.enemy('charger', 3.6, 10, -216.0, { range: 2 });
    L.enemy('roller', -3.4, 10, -219.6, { range: 2.2 });
    L.enemy('bomber', 5.2, 10, -218.0, { range: 1.2 });
    L.enemy('gloomy', -1.6, 10, -216.0, { range: 2.2, hard: true });
    L.enemy('bomber', -5.6, 10, -210.6, { range: 1.0, hard: true });
    bgMesa(L, -15, 13, -225, 6, 8, 34);
    bgMesa(L, 14, 9, -234, 7, 6, 32);
    bgMesa(L, -12, 18, -240, 5, 5, 36);

    // ------------------------------------------------------------ I. landing hill, bridge & 호박 대장 arena
    L.island(0, 14.5, -254, 6.2, { clear: [[0, -249, 2.6], [0, -254, 2.2], [0, -259.5, 2], [-2.8, -251, 1.3], [2.4, -258.2, 1.2]], density: 0.9 });
    L.checkpoint(-2.8, 14.5, -251, { yaw: Math.PI });
    L.sign(2.4, 14.5, -258.2, () => ['이 다리 너머에서 데굴데굴 쿵! 커다란 호박이 구르는 소리가 나요...', '호박 대장이 데굴데굴 구르다가 어지러워하면, 그때가 기회예요!'], { icon: '!', yaw: -0.2 });
    L.enemy('gloomy', -3.0, 14.5, -257.2, { range: 1.2 });
    L.heart(-1.6, 15.7, -256.6);
    L.heart(1.6, 15.7, -256.6);
    L.bridge([0, 14.5, -260.2], [0, 14.5, -268.6], 2.6);
    L.candyLine([0, 15.4, -261], [0, 15.4, -267.4], 5);
    const arena = L.arena(0, 14.5, -282, 14, { big: 10, small: 8 });
    stage.arena = arena;
    // pumpkin patch around the rim (walk-through) + outcrops and spires around the arena
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + 0.17;
      if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) > 0) continue; // keep the entrance clear
      const rr = 12.9 + (i % 2) * 0.5;
      L.prop(i % 4 === 1 ? 'cactusRound' : 'pumpkinDeco', Math.sin(a) * rr, 14.5, -282 + Math.cos(a) * rr, { seed: i, s: 0.9 + (i % 3) * 0.25, collide: false });
    }
    [[0.95, 18.6, 14.0, 3.2], [2.0, 19.5, 13.2, 3.6], [3.14, 19.0, 14.6, 3.0], [4.3, 19.4, 13.6, 3.4], [5.35, 18.6, 14.2, 3.0]].forEach(([a, d, y, r], i) => {
      const x = Math.sin(a) * d, z = -282 + Math.cos(a) * d;
      L.island(x, y, z, r, { big: 0, small: 1, grass: true, depth: 7 });
      L.prop(['orangeTree', 'hayBale', 'orangeTree', 'mesaPillar', 'orangeTree'][i], x, y, z, { seed: i + 3, s: i === 3 ? 1.2 : 1.05 });
      L.prop('pumpkinDeco', x + 1.2, y, z - 0.6, { seed: i, s: 1.6 });
    });
    for (let i = 0; i < 7; i++) {
      const a = 0.6 + (i / 7) * (TAU - 1.2);
      const d = 27 + (i % 3) * 3.5;
      spire(L, Math.sin(a) * d, 12 + (i % 4) * 3, -282 + Math.cos(a) * d, 2.4 + (i % 3) * 0.8, 40, i);
    }
    stage.bossCtl = new PumpkinBoss(stage, {
      pos: [0, 14.5, -286], yaw: 0, arena,
      introLines: [
        { who: '호박 대장', text: '데굴데굴~ 누구냐! 내 과수원에 함부로 들어온 꼬마가!', face: 'bossfog:pumpkin' },
        { who: SOMI, text: '호박 대장님! 회색 안개 때문에 마음이 뾰족해진 거죠? 제가 도와 드릴게요!', face: 'char:' + (Save.data ? Save.data.currentChar || 'cat' : 'cat') },
        { who: '호박 대장', text: '시끄럽다! 호박씨 폭탄 맛 좀 봐라! 데굴데굴 굴러서 납작하게 해 주마!', face: 'bossfog:pumpkin' },
      ],
      thanks: [
        ['boss', '후아~ 머리가 맑아졌어! 내가 왜 과일 친구들을 괴롭혔을까... 미안해.'],
        [SOMI, '괜찮아요! 안개 때문에 그랬던 거잖아요.'],
        ['boss', '그런데 안개 속에서 \'나도 여기 있어...\' 하는 작은 목소리가 들렸어. 누가 숨바꼭질을 하고 있는 걸까?'],
        ['boss', '자, 저 꿈빛을 가져가렴. 협곡에 노을빛이 다시 돌아올 거야!'],
      ],
    });
    L.killY(-25);
    void lv; void EC; void meFace;
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      // fly from the pumpkin arena back over the canyon to the ranch where Somi stands
      shots: [
        [[12, 30, -252], [0, 15, -283], 2.4, 50],
        [[-18, 24, -190], [0, 11, -214], 2.6, 52],
        [[18, 26, -100], [0, 10, -124], 2.6, 52],
        [[-16, 17, -38], [0, 3, -62], 2.4, 52],
        [[9, 9, 17], [0, 1, 0], 1.6, 52],
      ],
      lines: [
        ['뭉실이', '어서 와, 소미야! 여기는 노을빛 과일 협곡이야.', 'puffy5'],
        ['뭉실이', '회색 안개 때문에 오렌지도 호박도 시들시들... 협곡 끝의 호박 대장도 안개에 물들어 데굴데굴 화가 났대.', 'puffy5'],
        [SOMI, '걱정 마! 내가 꿈빛을 찾아서 노을빛을 되돌려 놓을게!', 'me'],
      ],
      toast: '협곡 끝의 꿈빛을 찾아 출발~!',
    });
  },

  // after a cookie dialog: point at what the new friend can do
  onCookie(id) {
    const hud = CTX.hud;
    if (!hud) return;
    if (id === 'kangaroo') { hud.toast('캥거루로 변신해서 바위문을 퍽! 부숴 봐요', 'good', 3); hud.pointAt(new Vec3(0, 1.5, -34.25), 5); }
    if (id === 'squirrel') hud.toast('다람쥐로 변신하면 협곡을 쭈욱~ 활공할 수 있어요', 'good', 3);
    if (id === 'pig') { hud.toast('돼지로 변신해서 반짝이는 흙더미를 파 봐요!', 'good', 3); hud.pointAt(new Vec3(-7, 10.5, -121.5), 4); }
    if (id === 'hamster') { hud.toast('햄스터 볼로 가시 골목을 데굴데굴 지나가 봐요!', 'good', 3); hud.pointAt(new Vec3(26, 10.5, -121), 4); }
  },
};

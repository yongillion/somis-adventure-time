// ============================================================================
// fx.js — visual effect presets (particles, rings, glows), hit-stop, flashes
// ============================================================================
import { CTX } from './ctx.js';
import { Vec3, rgb, rand, TAU, lerp, hsl } from '../engine/math.js';
import { TILE } from '../engine/texgen.js';
import { Mesh } from '../engine/scene.js';
import { Material } from '../engine/material.js';
import * as G from '../engine/geometry.js';

const C = (h) => rgb(h);
export const PAL = {
  white: [1, 1, 1], gold: C(0xffd84a), pink: C(0xff8fc4), sky: C(0x8fd8ff), mint: C(0x8ff0c4), lav: C(0xc4a8ff),
  peach: C(0xffc49a), red: C(0xff5a6a), orange: C(0xff9a3a), dust: C(0xf4ead8), gray: C(0xa8a2bc), fog: C(0x8d86a8),
  rainbow: [C(0xff7a9a), C(0xffb36b), C(0xffe36b), C(0x8ff07a), C(0x7ad8ff), C(0xa88aff), C(0xff9af0)],
};

class RingPool {
  constructor(scene, n = 24) {
    this.items = [];
    const geo = G.ringGeo(0.82, 1.0, 40);
    const geoS = G.torusGeo(1, 0.06, 6, 40);
    for (let i = 0; i < n; i++) {
      const m = new Mesh(geo, new Material({ color: 0xffffff, unlit: true, transparent: true, blending: 'additive', depthWrite: false, side: 'double', fog: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 0, r0: 0, r1: 0, active: false });
    }
    void geoS;
  }
  spawn(pos, color, r0, r1, dur, flat = true, up = 0) {
    let it = this.items.find((x) => !x.active) || this.items[0];
    it.active = true; it.t = 0; it.dur = dur; it.r0 = r0; it.r1 = r1;
    it.m.visible = true;
    it.m.position.set(pos.x, pos.y + 0.05, pos.z);
    it.m.rotation.set(flat ? 0 : Math.PI / 2, 0, 0);
    it.m.material.color = color.slice();
    it.up = up;
    return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) { it.active = false; it.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      const r = lerp(it.r0, it.r1, e);
      it.m.scale.set(r, 1, r);
      it.m.position.y += it.up * dt;
      it.m.opacity = (1 - k) * 0.95;
    }
  }
}

export class FX {
  constructor(scene) {
    this.rings = new RingPool(scene, 28);
    this.flashEl = null;
    this.texts = [];
  }
  get P() { return CTX.particles; }
  update(dt) { this.rings.update(dt); }

  // ---------------------------------------------------------------- movement
  dust(pos, n = 6, scale = 1) {
    this.P.emit({ pos, count: n, radius: 0.25 * scale, flatY: true, speed: [0.6 * scale, 1.8 * scale], upBias: 0.6, life: [0.35, 0.6], size: [0.28 * scale, 0.45 * scale], sizeEnd: 1.6, color: PAL.dust, alpha: 0.75, tile: TILE.PUFF, drag: 3, gravity: -0.6 });
  }
  landing(pos, k = 1) {
    this.P.emit({ pos, count: Math.round(8 * k), ring: true, ringUp: 0.15, speed: [2 * k, 3.5 * k], life: [0.3, 0.5], size: [0.3, 0.5], sizeEnd: 1.4, color: PAL.dust, alpha: 0.8, tile: TILE.PUFF, drag: 5 });
  }
  jumpPuff(pos) { this.P.emit({ pos, count: 5, ring: true, speed: [1.2, 2], life: [0.25, 0.4], size: [0.22, 0.35], sizeEnd: 1.3, color: PAL.white, alpha: 0.85, tile: TILE.PUFF, drag: 6 }); }
  flapPuff(pos, back) {
    this.P.emit({ pos, count: 2, dir: back, spread: 0.4, speed: [1, 2], life: [0.3, 0.45], size: [0.18, 0.3], sizeEnd: 1.8, color: PAL.white, alpha: 0.7, tile: TILE.PUFF, drag: 3 });
  }
  exhale(pos, dir) {
    this.P.emit({ pos, count: 6, dir, spread: 0.25, speed: [3, 6], life: [0.25, 0.45], size: [0.25, 0.4], sizeEnd: 1.8, color: PAL.white, alpha: 0.85, tile: TILE.PUFF, drag: 4 });
  }
  trail(pos, color = PAL.white, size = 0.3) {
    this.P.emit({ pos, count: 1, speed: 0.2, life: [0.25, 0.4], size: [size * 0.8, size], sizeEnd: 0.1, color, alpha: 0.8, tile: TILE.GLOW, additive: true });
  }
  speedLines(pos, dir) {
    this.P.emit({ pos, count: 1, dir: { x: -dir.x, y: 0, z: -dir.z }, spread: 0.1, speed: 6, life: 0.2, size: 0.18, sizeEnd: 0.05, color: PAL.white, alpha: 0.9, tile: TILE.GLOW, additive: true, stretch: 0.2 });
  }
  splash(pos, k = 1) {
    this.P.emit({ pos, count: Math.round(14 * k), upBias: 0.9, speed: [2.5 * k, 5 * k], life: [0.5, 0.8], size: [0.12, 0.22], sizeEnd: 0.5, color: C(0xd8f4ff), alpha: 0.95, tile: TILE.DROP, gravity: 14, stretch: 0.06 });
    this.rings.spawn(pos, C(0xbfefff), 0.3, 1.6 * k, 0.6);
  }
  bubbles(pos, n = 1) { this.P.emit({ pos, count: n, radius: 0.2, upBias: 1, speed: [0.5, 1.2], life: [0.6, 1.2], size: [0.08, 0.16], sizeEnd: 1, color: C(0xe8fbff), alpha: 0.8, tile: TILE.RING, gravity: -1.5, wobble: 1 }); }

  // ---------------------------------------------------------------- combat
  hit(pos, color = PAL.white, k = 1) {
    this.P.emit({ pos, count: 1, speed: 0, life: 0.16, size: 1.2 * k, sizeEnd: 0.4, color: PAL.white, alpha: 1, tile: TILE.GLOW, additive: true });
    this.P.emit({ pos, count: Math.round(7 * k), speed: [3, 6], life: [0.2, 0.4], size: [0.2, 0.32], sizeEnd: 0.1, color, alpha: 1, tile: TILE.SPARKLE, additive: true, drag: 4 });
    this.P.emit({ pos, count: Math.round(3 * k), speed: [1.5, 3], life: [0.4, 0.6], size: [0.18, 0.26], sizeEnd: 0.2, colors: [PAL.gold, PAL.pink], alpha: 1, tile: TILE.STAR, spin: [4, 8], gravity: 6 });
  }
  pop(pos, colors = PAL.rainbow) {
    // enemy purified: color burst + flowers
    this.P.emit({ pos, count: 1, speed: 0, life: 0.25, size: 2.2, sizeEnd: 0.5, color: PAL.white, alpha: 1, tile: TILE.GLOW, additive: true });
    this.P.emit({ pos, count: 14, speed: [3, 6], upBias: 0.4, life: [0.5, 0.9], size: [0.22, 0.34], sizeEnd: 0.2, colors, alpha: 1, tile: [TILE.STAR, TILE.HEART, TILE.SPARKLE], spin: [3, 8], gravity: 5, drag: 1.5 });
    this.P.emit({ pos, count: 6, speed: [1, 2.2], upBias: 0.5, life: [0.6, 1.0], size: [0.4, 0.6], sizeEnd: 1.4, color: C(0xe6e2f2), alpha: 0.7, tile: TILE.PUFF, drag: 3 });
    this.P.emit({ pos, count: 8, speed: [1.5, 3], upBias: 0.8, life: [1.0, 1.6], size: [0.18, 0.26], sizeEnd: 0.8, colors, alpha: 1, tile: TILE.PETAL, spin: [2, 5], gravity: 1.2, drag: 1.2, wobble: 2 });
    this.rings.spawn(pos, PAL.white, 0.2, 1.8, 0.4);
  }
  sparkle(pos, color = PAL.gold, n = 8, r = 0.4) {
    this.P.emit({ pos, count: n, radius: r, speed: [0.5, 2], life: [0.4, 0.8], size: [0.15, 0.3], sizeEnd: 0.05, color, alpha: 1, tile: TILE.SPARKLE, additive: true, spin: [1, 3] });
  }
  twinkle(pos, color = PAL.gold, r = 0.5) {
    this.P.emit({ pos, count: 1, radius: r, speed: 0.1, life: [0.5, 0.9], size: [0.12, 0.24], sizeEnd: 0.02, color, alpha: 1, tile: TILE.SPARKLE, additive: true, fadeIn: 0.3, sizeCurve: 'pop' });
  }
  candy(pos, color) {
    this.P.emit({ pos, count: 6, speed: [1.5, 3], life: [0.3, 0.5], size: [0.15, 0.24], sizeEnd: 0.05, colors: [color, PAL.white], alpha: 1, tile: TILE.SPARKLE, additive: true, drag: 3 });
    this.rings.spawn(pos, color, 0.1, 0.7, 0.3, false);
  }
  heal(pos) {
    this.P.emit({ pos, count: 6, radius: 0.4, upBias: 1, speed: [0.8, 1.6], life: [0.8, 1.2], size: [0.2, 0.3], sizeEnd: 0.6, color: C(0xff6a8f), alpha: 1, tile: TILE.HEART, gravity: -1, sizeCurve: 'pop' });
    this.sparkle(pos, C(0xffb3c9), 8, 0.5);
  }
  poof(pos, colors = [C(0xffd6ec), C(0xd6ecff), C(0xfff4c6)]) {
    this.P.emit({ pos, count: 14, radius: 0.3, speed: [1.5, 3.5], life: [0.5, 0.8], size: [0.5, 0.8], sizeEnd: 1.5, colors, alpha: 0.95, tile: TILE.PUFF, drag: 4 });
    this.P.emit({ pos, count: 14, speed: [2, 5], life: [0.5, 0.9], size: [0.2, 0.3], sizeEnd: 0.1, colors: PAL.rainbow, alpha: 1, tile: [TILE.STAR, TILE.SPARKLE], additive: true, drag: 2, spin: [3, 6] });
    this.rings.spawn(pos, C(0xfff0ff), 0.3, 2.2, 0.5, false);
  }
  shock(pos, r = 3, color = C(0xfff2c0)) {
    this.rings.spawn(pos, color, 0.4, r, 0.45);
    this.rings.spawn(pos, PAL.white, 0.2, r * 0.7, 0.35);
    this.P.emit({ pos, count: 14, ring: true, ringUp: 0.2, speed: [3, r * 2], life: [0.3, 0.5], size: [0.35, 0.55], sizeEnd: 1.5, color: PAL.dust, alpha: 0.8, tile: TILE.PUFF, drag: 4 });
  }
  wave(pos, r, color) { this.rings.spawn(pos, color, 0.3, r, 0.35, true); this.rings.spawn({ x: pos.x, y: pos.y + 0.6, z: pos.z }, color, 0.3, r * 0.9, 0.35, true); }
  boom(pos, r = 1.6) {
    this.P.emit({ pos, count: 1, speed: 0, life: 0.2, size: r * 2.2, sizeEnd: 0.5, color: C(0xfff4c0), alpha: 1, tile: TILE.GLOW, additive: true });
    this.P.emit({ pos, count: 12, speed: [2, 5], life: [0.4, 0.7], size: [0.5, 0.8], sizeEnd: 1.6, colors: [C(0xfff0e0), C(0xffd8b8)], alpha: 0.9, tile: TILE.PUFF, drag: 3 });
    this.P.emit({ pos, count: 10, speed: [4, 8], life: [0.3, 0.6], size: [0.18, 0.28], sizeEnd: 0.1, colors: [PAL.gold, PAL.orange], alpha: 1, tile: TILE.SPARKLE, additive: true, drag: 3 });
    this.rings.spawn(pos, C(0xffe0a0), 0.3, r * 1.4, 0.35);
  }
  fireBreath(pos, dir, spread = 0.18) {
    this.P.emit({ pos, count: 3, dir, spread, speed: [6, 9], life: [0.25, 0.4], size: [0.35, 0.5], sizeEnd: 1.6, colors: [C(0xffe066), C(0xff9a3a), C(0xff6a3a)], colorEnd: C(0xff4a2a), alpha: 0.95, tile: TILE.FLAME, additive: true, drag: 2.5 });
  }
  waterJet(pos, dir) {
    this.P.emit({ pos, count: 3, dir, spread: 0.08, speed: [8, 10], life: [0.35, 0.5], size: [0.16, 0.24], sizeEnd: 0.8, color: C(0xbfeaff), alpha: 0.95, tile: TILE.DROP, gravity: 9, stretch: 0.05 });
  }
  iceBurst(pos) { this.P.emit({ pos, count: 10, speed: [2, 4], life: [0.4, 0.7], size: [0.2, 0.3], sizeEnd: 0.1, colors: [C(0xd8f4ff), PAL.white], alpha: 1, tile: TILE.SNOW, spin: [2, 5], gravity: 4 }); }
  notes(pos, n = 3) { this.P.emit({ pos, count: n, radius: 0.3, upBias: 1, speed: [0.8, 1.5], life: [0.9, 1.3], size: [0.22, 0.3], sizeEnd: 0.4, colors: PAL.rainbow, alpha: 1, tile: TILE.NOTE, gravity: -0.5, wobble: 2, sizeCurve: 'pop' }); }
  zzz(pos) { this.P.emit({ pos, count: 1, upBias: 1, dir: { x: 0.3, y: 1, z: 0 }, spread: 0.2, speed: 0.6, life: 1.4, size: 0.2, sizeEnd: 0.4, color: C(0xe8e0ff), alpha: 0.9, tile: TILE.NOTE, sizeCurve: 'grow' }); }
  stunStars(pos) { this.P.emit({ pos, count: 1, radius: 0.4, speed: 0.4, life: 0.5, size: 0.2, sizeEnd: 0.05, color: PAL.gold, alpha: 1, tile: TILE.STAR, additive: true, spin: 6 }); }
  petals(pos, colors, n = 10) { this.P.emit({ pos, count: n, radius: 0.6, upBias: 0.8, speed: [1, 3], life: [1.2, 2], size: [0.16, 0.26], sizeEnd: 0.7, colors, alpha: 1, tile: TILE.PETAL, spin: [1, 4], gravity: 1.2, drag: 1, wobble: 2 }); }
  confetti(pos, n = 40) {
    this.P.emit({ pos, count: n, radius: 0.5, upBias: 0.9, speed: [4, 9], life: [1.4, 2.4], size: [0.12, 0.2], sizeEnd: 0.9, colors: PAL.rainbow, alpha: 1, tile: [TILE.CONFETTI, TILE.STAR, TILE.HEART], spin: [3, 9], gravity: 7, drag: 1.5, wobble: 2 });
  }
  colorBloom(pos, color, r = 6) {
    this.rings.spawn(pos, color, 0.5, r, 1.1);
    this.rings.spawn(pos, PAL.white, 0.3, r * 0.75, 0.9);
    this.P.emit({ pos: { x: pos.x, y: pos.y + 1, z: pos.z }, count: 1, speed: 0, life: 0.5, size: 5, sizeEnd: 1, color, alpha: 0.9, tile: TILE.GLOW, additive: true });
    this.P.emit({ pos, count: 26, ring: true, ringUp: 0.6, speed: [3, 7], life: [1.0, 1.8], size: [0.2, 0.32], sizeEnd: 0.6, colors: [color, PAL.white, ...PAL.rainbow], alpha: 1, tile: [TILE.PETAL, TILE.SPARKLE, TILE.STAR], spin: [2, 5], gravity: 1.5, drag: 1.2 });
  }
  beamSpark(pos, color) { this.P.emit({ pos, count: 2, radius: 0.15, speed: [0.5, 1.5], life: [0.2, 0.35], size: [0.15, 0.25], sizeEnd: 0.05, color, alpha: 1, tile: TILE.SPARKLE, additive: true }); }
  fogPuff(pos, n = 8) { this.P.emit({ pos, count: n, radius: 0.6, speed: [0.5, 1.5], life: [0.8, 1.4], size: [0.6, 1.0], sizeEnd: 1.6, color: PAL.fog, alpha: 0.6, tile: TILE.PUFF, drag: 1.5 }); }
  rainbowTrail(pos) { this.P.emit({ pos, count: 1, speed: 0.2, life: 0.6, size: 0.3, sizeEnd: 0.05, colors: PAL.rainbow, alpha: 1, tile: TILE.SPARKLE, additive: true }); }

  // ---------------------------------------------------------------- global
  shake(amount = 0.3, dur = 0.25) { if (CTX.cam) CTX.cam.shake(amount, dur); }
  hitStop(dur = 0.05) { CTX.hitStop = Math.max(CTX.hitStop, dur); }
  flash(color = '#ffffff', dur = 0.25, alpha = 0.7) {
    const el = document.getElementById('flash');
    if (!el) return;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = String(alpha);
    void el.offsetWidth;
    el.style.transition = `opacity ${dur}s ease-out`;
    el.style.opacity = '0';
  }
  // floating text in world (damage numbers, +XP)
  text(pos, str, cls = '') {
    if (CTX.hud) CTX.hud.floatText(pos, str, cls);
  }
}

export function hueColor(h, s = 0.75, l = 0.68) { return hsl(h, s, l); }
export { rand };

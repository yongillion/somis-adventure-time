// ============================================================================
// models/common.js — shared helpers for all procedural models
// Style: Kirby-like chibi. Round shapes, glossy toon, big tall-oval eyes,
// pink blush, tiny mouth. Every model is built from engine primitives.
// ============================================================================
import { Node, Mesh } from '../../engine/scene.js';
import * as G from '../../engine/geometry.js';
import { mat } from '../../engine/material.js';
import { TAU, PI, clamp, lerp } from '../../engine/math.js';

export { G };
export const UNIT = G.UNIT;

// ---------------------------------------------------------------- materials
// Glossy toon used by characters/items; Matte for environment
export const GLOSS = { spec: 0.32, rim: 0.42 };
export const SOFT = { spec: 0.12, rim: 0.38 };
export const MATTE = { spec: 0, rim: 0.22 };
export function M(color, opts = {}) { return mat(color, { ...SOFT, ...opts }); }
export function MG(color, opts = {}) { return mat(color, { ...GLOSS, ...opts }); }
export function MU(color, opts = {}) { return mat(color, { unlit: true, rim: 0, ...opts }); }
export function MGlow(color, opts = {}) { return mat(color, { unlit: true, transparent: true, blending: 'additive', depthWrite: false, opacity: 0.8, fog: false, ...opts }); }

// ---------------------------------------------------------------- parts
// add(parent, geometry|geoFn, material, { p:[x,y,z], r:[x,y,z], s:number|[x,y,z], name })
export function add(parent, geo, material, o = {}) {
  const g = typeof geo === 'function' ? geo() : geo;
  const m = new Mesh(g, material, o.name || '');
  if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
  if (o.s !== undefined) { if (Array.isArray(o.s)) m.scale.set(o.s[0], o.s[1], o.s[2]); else m.scale.set(o.s, o.s, o.s); }
  if (parent) parent.add(m);
  return m;
}
export function grp(parent, name = '', p = null, r = null) {
  const n = new Node(name);
  if (p) n.position.set(p[0], p[1], p[2]);
  if (r) n.rotation.set(r[0], r[1], r[2]);
  if (parent) parent.add(n);
  return n;
}
// ellipsoid helper: radii rx, ry, rz
export function ell(parent, material, p, rx, ry = rx, rz = rx, r = null, name = '') {
  return add(parent, UNIT.sphere, material, { p, s: [rx, ry, rz], r: r || undefined, name });
}
// point on sphere surface (radius R) at yaw (deg, 0 = +Z front, + = toward +X) and pitch (deg up)
export function onSphere(R, yawDeg, pitchDeg, out = [0, 0, 0]) {
  const y = (yawDeg * PI) / 180, p = (pitchDeg * PI) / 180;
  out[0] = Math.sin(y) * Math.cos(p) * R;
  out[1] = Math.sin(p) * R;
  out[2] = Math.cos(y) * Math.cos(p) * R;
  return out;
}
// rotation that makes local +Z point along sphere normal at (yaw,pitch)
export function faceRot(yawDeg, pitchDeg) { return [(-pitchDeg * PI) / 180, (yawDeg * PI) / 180, 0]; }

// ---------------------------------------------------------------- face
const EYE_BLACK = 0x2a1f3d;
// Kirby-style eyes: tall dark ovals with white top highlight + soft color bottom glint
export function makeEyes(head, o = {}) {
  const R = o.headR ?? 0.42;
  const yaw = o.yaw ?? 17, pitch = o.pitch ?? 6;
  const size = o.size ?? 1;
  const black = MG(o.color ?? EYE_BLACK, { rim: 0.15, spec: 0.5 });
  const white = MU(0xffffff);
  const glint = MU(o.glint ?? 0x6fa8ff);
  const eyes = [];
  for (const sd of [-1, 1]) {
    const pivot = grp(head, sd < 0 ? 'eyeL' : 'eyeR');
    const pos = onSphere(R * 0.985, yaw * sd, pitch);
    pivot.position.set(pos[0], pos[1], pos[2]);
    pivot.rotation.set(...faceRot(yaw * sd, pitch));
    const open = grp(pivot, 'open');
    ell(open, black, [0, 0, 0], 0.062 * size, 0.1 * size, 0.035 * size);
    ell(open, white, [0.012 * size * -sd, 0.045 * size, 0.026 * size], 0.026 * size, 0.034 * size, 0.012 * size);
    ell(open, glint, [0, -0.06 * size, 0.022 * size], 0.034 * size, 0.022 * size, 0.012 * size);
    // happy (^) eye: arc
    const happy = grp(pivot, 'happy');
    add(happy, () => G.cachedGeo('eyeArc', () => G.torusGeo(0.05, 0.016, 6, 12, PI)), black, { p: [0, -0.02 * size, 0.01], s: size });
    happy.visible = false;
    // closed / hurt (> <): two short bars
    const hurt = grp(pivot, 'hurt');
    const bar = () => G.cachedGeo('eyeBar', () => G.capsuleGeo(0.014, 0.06, 6, 3));
    add(hurt, bar, black, { p: [0, 0.018 * size, 0.01], r: [0, 0, (PI / 2) + 0.5 * sd], s: size });
    add(hurt, bar, black, { p: [0, -0.018 * size, 0.01], r: [0, 0, (PI / 2) - 0.5 * sd], s: size });
    hurt.visible = false;
    // sleep (flat line)
    const sleep = grp(pivot, 'sleep');
    add(sleep, () => G.cachedGeo('eyeArc', () => G.torusGeo(0.05, 0.016, 6, 12, PI)), black, { p: [0, 0.02 * size, 0.01], r: [0, 0, PI], s: size });
    sleep.visible = false;
    eyes.push({ pivot, open, happy, hurt, sleep });
  }
  let expr = 'normal';
  return {
    eyes,
    set(e) {
      if (e === expr) return;
      expr = e;
      for (const E of eyes) {
        E.open.visible = e === 'normal' || e === 'angry' || e === 'surprised' || e === 'sad';
        E.happy.visible = e === 'happy';
        E.hurt.visible = e === 'hurt';
        E.sleep.visible = e === 'sleep';
        const sc = e === 'surprised' ? 1.15 : 1;
        E.open.scale.set(sc, sc, sc);
        E.open.rotation.z = 0;
      }
      if (e === 'angry') { eyes[0].open.rotation.z = -0.25; eyes[1].open.rotation.z = 0.25; }
      if (e === 'sad') { eyes[0].open.rotation.z = 0.25; eyes[1].open.rotation.z = -0.25; }
    },
    blink(v) { // v: 1 open .. 0 closed
      for (const E of eyes) E.open.scale.y = Math.max(0.08, v) * (expr === 'surprised' ? 1.15 : 1);
    },
    get expr() { return expr; },
  };
}

export function makeCheeks(head, o = {}) {
  const R = o.headR ?? 0.42;
  const yaw = o.yaw ?? 34, pitch = o.pitch ?? -8;
  const m = MU(o.color ?? 0xff8fb0, { transparent: true, opacity: 0.85, depthWrite: false });
  const out = [];
  for (const sd of [-1, 1]) {
    const pos = onSphere(R * 1.0, yaw * sd, pitch);
    out.push(add(head, UNIT.sphere, m, { p: pos, r: faceRot(yaw * sd, pitch), s: [0.07 * (o.size ?? 1), 0.04 * (o.size ?? 1), 0.012], name: 'cheek' }));
  }
  return out;
}

// mouth: small. shapes: smile | open | o | flat | w | frown
export function makeMouth(head, o = {}) {
  const R = o.headR ?? 0.42;
  const pitch = o.pitch ?? -16;
  const dark = MG(o.color ?? 0x6b2b3b, { spec: 0.2, rim: 0 });
  const pivot = grp(head, 'mouth');
  const pos = onSphere(R * 0.99, 0, pitch);
  pivot.position.set(pos[0], pos[1] + (o.dy ?? 0), pos[2] + (o.dz ?? 0));
  pivot.rotation.set(...faceRot(0, pitch));
  const s = o.size ?? 1;
  const smile = add(pivot, () => G.cachedGeo('mouthArc', () => G.torusGeo(0.035, 0.011, 6, 10, PI)), dark, { r: [0, 0, PI], s });
  const open = ell(pivot, MG(0x8a2a40, { spec: 0.1, rim: 0 }), [0, -0.005, 0.0], 0.04 * s, 0.035 * s, 0.015);
  const tongue = ell(open, MU(0xff7a96), [0, -0.35, 0.3], 0.6, 0.45, 0.5);
  const oShape = ell(pivot, MG(0x8a2a40, { spec: 0.1, rim: 0 }), [0, 0, 0], 0.022 * s, 0.026 * s, 0.012);
  const w = grp(pivot, 'w');
  add(w, () => G.cachedGeo('mouthArcS', () => G.torusGeo(0.02, 0.009, 6, 10, PI)), dark, { p: [-0.019 * s, 0, 0], r: [0, 0, PI], s });
  add(w, () => G.cachedGeo('mouthArcS', () => G.torusGeo(0.02, 0.009, 6, 10, PI)), dark, { p: [0.019 * s, 0, 0], r: [0, 0, PI], s });
  const frown = add(pivot, () => G.cachedGeo('mouthArc', () => G.torusGeo(0.035, 0.011, 6, 10, PI)), dark, { p: [0, -0.02, 0], s: s * 0.8 });
  const shapes = { smile, open, o: oShape, w, frown };
  let cur = null;
  const api = {
    pivot,
    set(shape) {
      if (shape === cur) return;
      cur = shape;
      for (const k in shapes) shapes[k].visible = k === shape || (shape === 'flat' && k === 'smile');
      if (shape === 'flat') smile.scale.set(s, s * 0.3, s); else smile.scale.set(s, s, s);
      void tongue;
    },
  };
  api.set(o.shape || 'smile');
  return api;
}

// Somi's signature pink star ribbon (worn by every animal form)
export function makeRibbon(parent, o = {}) {
  const g = grp(parent, 'ribbon', o.p || [0, 0, 0], o.r || [0, 0, 0]);
  const s = o.s ?? 1;
  g.scale.set(s, s, s);
  const pink = MG(0xff5f9e, { spec: 0.4 });
  const pinkD = MG(0xe23f82, { spec: 0.3 });
  const gold = MG(0xffd23f, { spec: 0.6, emissive: 0x332200 });
  // two loops
  ell(g, pink, [-0.085, 0.01, 0], 0.085, 0.06, 0.04, [0, 0, 0.35]);
  ell(g, pink, [0.085, 0.01, 0], 0.085, 0.06, 0.04, [0, 0, -0.35]);
  // tails
  ell(g, pinkD, [-0.045, -0.06, -0.005], 0.025, 0.06, 0.02, [0, 0, -0.5]);
  ell(g, pinkD, [0.045, -0.06, -0.005], 0.025, 0.06, 0.02, [0, 0, 0.5]);
  // knot star
  add(g, UNIT.star, gold, { p: [0, 0.008, 0.035], s: 0.085 });
  return g;
}

// ---------------------------------------------------------------- utility
export function setFlash(root, v) { root.traverse((n) => { if (n.isMesh) n.flash = v; }); }
export function setOpacity(root, v) { root.traverse((n) => { if (n.isMesh) n.opacity = v; }); }
export function setTint(root, fn) { root.traverse((n) => { if (n.isMesh) fn(n); }); }

// critically-damped-ish spring for secondary motion
export class Spring {
  constructor(stiff = 120, damp = 10) { this.k = stiff; this.d = damp; this.x = 0; this.v = 0; }
  update(target, dt) {
    const a = (target - this.x) * this.k - this.v * this.d;
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  }
  kick(v) { this.v += v; }
}

// smooth approach for poses
export const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// simple cartoon "chain" (tail etc): returns array of nodes, each child of previous
export function chain(parent, material, segs, segLen, r0, r1, bend = [0.25, 0, 0], name = 'chain') {
  const nodes = [];
  let p = parent;
  for (let i = 0; i < segs; i++) {
    const t = i / Math.max(1, segs - 1);
    const r = lerp(r0, r1, t);
    const n = grp(p, name + i, i === 0 ? [0, 0, 0] : [0, segLen, 0], bend);
    ell(n, material, [0, segLen * 0.5, 0], r, segLen * 0.62, r);
    nodes.push(n);
    p = n;
  }
  return nodes;
}

export { clamp, lerp, TAU, PI };

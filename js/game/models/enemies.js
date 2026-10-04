// ============================================================================
// models/enemies.js — fog-infected enemies: cute grumpy creatures drained by
// the Gray Fog (lavender-gray bodies, angry-but-cute eyes + little brows, a dark
// fog wisp curling on top). When defeated they pop into colour (gameplay fx).
//
// export buildEnemy(type, variant?) -> {
//   root, update(dt, st), setFlash(v), setOpacity(v), height, radius, centerY,
//   flying (bool), muzzle? (Node: projectile origin), type, variant, bomb? (bomber) }
//   origin: feet centre (flyers: body centre, flying:true). Faces +Z.
//   st = { anim, t (s since anim start), speed (0..1) }
//   anims: idle, walk, run, windup (shake + red tint pulse), attack, hurt,
//          stun (dizzy spiral eyes + 3 orbiting stars), sleep (eyes closed, snot bubble),
//          friendly (charmed: happy eyes, blush, dancing), die (squash flat, then puff & fade), fly
//   variant: meadow | canyon | honey | jungle | sea | snow | toy | moon (themed accessory) | unknown -> none
//   muzzle on: shooter (cannon mouth), toysoldier (cork gun), bomber (bomb in hands; api.bomb = the held bomb Node),
//              jelly (under the bell), mushroom (cap top, spores), pumpkinling (mouth, seeds), snowball (twig hand)
//   types: ENEMY_TYPES, variants: ENEMY_VARIANTS (exported). Every enemy (+ any variant) is <= 30 meshes.
// export buildBomb() -> Node (round cloud-bomb with fizzing fuse; node.update(dt) animates the spark)
// export buildProjectile(kind) -> Node  kinds: fogball | seed | cork | snowball | ink | spore
//   (+Z = travel direction; node.update(dt) adds spin / pulse)
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import { rgb, Ease, Mat4 } from '../../engine/math.js';
import {
  G, UNIT, M, MG, MU, SOFT, add, grp, ell, onSphere, faceRot, makeEyes, Spring, approach, PI, TAU, lerp, clamp,
} from './common.js';

// ------------------------------------------------------------------ palette
export const FOG = {
  light: 0xc4bedc, mid: 0x9d95bc, dark: 0x7d7499, deep: 0x5b5276, ink: 0x463c5e, foot: 0x6b6288, pale: 0xe4e0f0,
};
const GLINT = 0xc7b6ff;
const EYE_BLACK = 0x2a1f3d;
const DEG = PI / 180;

// ------------------------------------------------------------------ geometry kit
const own = (color, opts = {}) => new Material({ color, ...SOFT, ...opts });
const VC = () => M(0xffffff, { vertexColors: true });
const glowMat = (c) => M(0x000000, { emissive: c, rim: -2.4, spec: 0, transparent: true, blending: 'additive', depthWrite: false, fog: false });
const cg = (key, fn) => G.cachedGeo('enemy:' + key, fn);
// inside-out sphere: only its far hemisphere renders, with normals facing the viewer -> a fresnel glow that
// sits *behind* the character (occluded by it), never washing over the face
const invSphereGeo = (key) => G.cachedGeo(key, () => {
  const g = G.sphereGeo(1, 28, 20);
  const n = g.attributes.normal.array; for (let i = 0; i < n.length; i++) n[i] = -n[i];
  const ix = g.index; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return g;
});

const hex = (c) => (Array.isArray(c) ? c : rgb(c));
const sc3 = (s) => (s === undefined ? [1, 1, 1] : Array.isArray(s) ? s : [s, s, s]);
function mat4(q) { const p = q.p || [0, 0, 0], r = q.r || [0, 0, 0], s = sc3(q.s); return G.trs(p[0], p[1], p[2], r[0], r[1], r[2], s[0], s[1], s[2]); }
function mul(a, b) { return Mat4.multiply(Mat4.create(), a, b); }
// merge [{ g, p, r, s, c, m (optional pre-matrix) }] into one cached vertex-coloured geometry
function merged(key, parts) {
  return cg(key, () => G.mergeGeometries(parts.map((q) => {
    const geo = q.g ? (typeof q.g === 'function' ? q.g() : q.g) : UNIT.sphere();
    const m = q.m ? mul(q.m, mat4(q)) : mat4(q);
    return { geo, matrix: m, color: hex(q.c ?? 0xffffff) };
  })));
}
const band = (a, b, ws = 26) => cg(`band:${a}:${b}:${ws}`, () => G.sphereGeo(1, ws, Math.max(2, Math.round((b - a) * 18)), 0, TAU, a * PI, (b - a) * PI));
const curve = (f, n = 14) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
// tube along a polyline, radius number | (u)=>r, rounded caps
function tubeGeo(pts, r, rs = 8, cap = 3) {
  const rf = typeof r === 'function' ? r : () => r;
  const n = pts.length;
  const nz = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; T.push(nz([b[0] - a[0], b[1] - a[1], b[2] - a[2]])); }
  let nn = nz(cr(T[0], Math.abs(T[0][1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
  for (let i = 0; i < n; i++) {
    if (i) { const d = nn[0] * T[i][0] + nn[1] * T[i][1] + nn[2] * T[i][2]; nn = nz([nn[0] - T[i][0] * d, nn[1] - T[i][1] * d, nn[2] - T[i][2] * d]); }
    N.push(nn); B.push(cr(T[i], nn));
  }
  const pos = [], nrm = [], idx = [];
  const ring = (c, t, nv, bv, rad, off, nd) => {
    const k = Math.sqrt(Math.max(0, 1 - nd * nd));
    for (let j = 0; j <= rs; j++) {
      const a = (j / rs) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const dx = nv[0] * ca + bv[0] * sa, dy = nv[1] * ca + bv[1] * sa, dz = nv[2] * ca + bv[2] * sa;
      pos.push(c[0] + dx * rad + t[0] * off, c[1] + dy * rad + t[1] * off, c[2] + dz * rad + t[2] * off);
      nrm.push(dx * k + t[0] * nd, dy * k + t[1] * nd, dz * k + t[2] * nd);
    }
  };
  const r0 = rf(0), r1 = rf(1);
  let rings = 0;
  for (let k = cap; k >= 1; k--) { const ph = (k / cap) * (PI / 2); ring(pts[0], T[0], N[0], B[0], r0 * Math.cos(ph), -r0 * Math.sin(ph), -Math.sin(ph)); rings++; }
  for (let i = 0; i < n; i++) { ring(pts[i], T[i], N[i], B[i], rf(i / (n - 1)), 0, 0); rings++; }
  for (let k = 1; k <= cap; k++) { const ph = (k / cap) * (PI / 2); ring(pts[n - 1], T[n - 1], N[n - 1], B[n - 1], r1 * Math.cos(ph), r1 * Math.sin(ph), Math.sin(ph)); rings++; }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < rs; j++) { const a = i * (rs + 1) + j, b = a + 1, c = a + rs + 2, d = a + rs + 1; idx.push(a, b, c, a, c, d); }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nrm, 3); g.setIndex(idx);
  G.fixWinding(g); g.computeBoundingSphere();
  return g;
}
// curling path in the YZ plane: starts straight up, curvature grows -> spiral curl (cartoon smoke wisp)
function curlPts(len, turns, n = 26, p = 1.8) {
  const pts = [[0, 0, 0]]; let z = 0, y = 0; const ds = len / (n - 1);
  for (let i = 1; i < n; i++) { const s = i / (n - 1), a = PI / 2 + turns * TAU * Math.pow(s, p); z += Math.cos(a) * ds; y += Math.sin(a) * ds; pts.push([0, y, z]); }
  return pts;
}
function leafOutline(w = 0.5, l = 1) { const o = []; for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; const c = Math.cos(a), s = Math.sin(a); o.push([w * s * (1 - 0.35 * Math.abs(c)) * 0.5, l * 0.5 * c]); } return o; }
const leafGeo = () => cg('leaf', () => G.puffyShapeGeo(leafOutline(), 0.05, 3, 0.6));

// ------------------------------------------------------------------ shared fog parts
// dark fog wisp (main curl + a small side curl), vertical gradient deep -> lavender
function swirlGeo() {
  return cg('swirl', () => {
    const a = tubeGeo(curlPts(0.3, 1.05), (u) => lerp(0.052, 0.012, Math.pow(u, 0.8)), 9, 3);
    const b = tubeGeo(curlPts(0.17, 0.95), (u) => lerp(0.032, 0.009, u), 8, 3);
    const g = G.mergeGeometries([
      { geo: a, matrix: G.trs(0, 0, 0, 0, 0.6, 0), color: [1, 1, 1] },
      { geo: b, matrix: G.trs(0.035, -0.01, 0.0, 0, -2.3, -0.35), color: [1, 1, 1] },
    ]);
    const lo = rgb(FOG.deep), hi = rgb(0x9488bd);
    g.colorBy((x, y) => { const t = clamp(y / 0.22, 0, 1); return [lerp(lo[0], hi[0], t), lerp(lo[1], hi[1], t), lerp(lo[2], hi[2], t)]; });
    return g;
  });
}
const swirlMat = () => MG(0xffffff, { vertexColors: true, spec: 0.3, rim: 0.5 });
// 3 dizzy stars on a unit ring (XZ plane)
function starsGeo() {
  return cg('stars3', () => G.mergeGeometries([0, 1, 2].map((i) => {
    const a = (i / 3) * TAU;
    return { geo: UNIT.star(), matrix: G.trs(Math.cos(a), 0, Math.sin(a), 0, -a + PI / 2, 0.3, 0.42, 0.42, 0.42), color: [1, 1, 1] };
  })));
}
// flat spiral (XY plane) for dizzy eyes, unit radius
function spiralGeo() {
  return cg('spiral', () => tubeGeo(curve((u) => { const a = u * PI * 4.2; const r = 0.12 + 0.88 * u; return [Math.cos(a) * r, Math.sin(a) * r, 0]; }, 40), 0.13, 6, 2));
}

// ------------------------------------------------------------------ face kit
// eyes (makeEyes, angry by default), merged brows, merged dizzy spirals, mouth, merged cheeks
function faceKit(E, head, o) {
  const R = o.R, yaw = o.yaw ?? 20, pitch = o.pitch ?? 8, size = o.size ?? 0.8;
  E.eyes = makeEyes(head, { headR: R, yaw, pitch, size, glint: o.glint ?? GLINT, color: o.eyeColor });
  const pivM = (sd) => { const p = onSphere(R * 0.985, yaw * sd, pitch), r = faceRot(yaw * sd, pitch); return G.trs(p[0], p[1], p[2], r[0], r[1], r[2]); };
  const key = E.type + (o.key || '');
  if (o.brows !== false) {
    const bt = o.browTilt ?? 0.42, bl = (o.browLen ?? 1) * size;
    const h = 0.128 * size, bz = Math.sqrt(Math.max(0, R * R - h * h)) - R * 0.985 + 0.006 * size;
    E.brows = add(head, () => merged('brows:' + key, [-1, 1].map((sd) => ({
      m: pivM(sd), g: UNIT.capsule, p: [sd * 0.012 * size, h, bz], r: [-Math.asin(Math.min(0.9, h / R)), 0, PI / 2 + sd * bt], s: [0.042 * size, 0.06 * bl, 0.03 * size],
    }))), MG(FOG.ink, { spec: 0.25 }));
    E.browRest = E.brows.position.y;
  }
  E.dizzy = add(head, () => merged('dizzy:' + key, [-1, 1].map((sd) => ({ m: pivM(sd), g: spiralGeo, p: [0, 0, 0.01 * size], r: [0, sd < 0 ? PI : 0, 0], s: [0.055 * size, 0.055 * size, 0.06 * size] }))), MG(EYE_BLACK, { spec: 0.4 }));
  E.dizzy.visible = false;
  // mouth
  const mp = o.mouthPitch ?? -14, ms = o.mouthSize ?? size * 0.9, mR = o.mouthR ?? R;
  const piv = grp(head, 'mouth', onSphere(mR * 0.99, 0, mp), faceRot(0, mp));
  const arc = add(piv, () => G.cachedGeo('mouthArc', () => G.torusGeo(0.035, 0.011, 6, 10, PI)), MG(0x5a2a44, { spec: 0.2, rim: 0 }), { s: ms });
  const open = ell(piv, MG(0x7a2a46, { spec: 0.15, rim: 0 }), [0, -0.008 * ms, 0], 0.04 * ms, 0.034 * ms, 0.014 * ms);
  E.mouthNode = piv;
  let cur = '';
  E.mouth = {
    set(sh) {
      if (sh === cur) return; cur = sh;
      arc.visible = sh === 'smile' || sh === 'frown' || sh === 'flat';
      open.visible = sh === 'open' || sh === 'o' || sh === 'wide';
      arc.rotation.z = sh === 'frown' ? 0 : PI;
      arc.position.y = sh === 'frown' ? -0.012 * ms : 0;
      arc.scale.set(ms, sh === 'flat' ? ms * 0.25 : ms, ms);
      const k = sh === 'o' ? 0.55 : sh === 'wide' ? 1.3 : 1;
      open.scale.set(0.04 * ms * k, 0.034 * ms * (sh === 'o' ? 0.8 : k), 0.014 * ms);
    },
  };
  E.mouth.set('frown');
  // cheeks (shown when friendly)
  const cy = o.cheekYaw ?? 38, cp = o.cheekPitch ?? -8, cs = (o.cheekSize ?? size) * 1.0;
  E.cheeks = add(head, () => merged('cheeks:' + key, [-1, 1].map((sd) => ({ p: onSphere(R * 1.0, cy * sd, cp), r: faceRot(cy * sd, cp), s: [0.07 * cs, 0.04 * cs, 0.012] }))),
    MU(0xff8fb0, { transparent: true, opacity: 0.85, depthWrite: false }));
  E.cheeks.visible = false;
}

// ------------------------------------------------------------------ variant accessories
// canonical sizes for a head of radius ~0.34; anchored on E.hatNode (top) or E.clipNode (side)
const ACC = {
  meadow: { kind: 'clip', build: () => merged('acc:meadow', [
    ...Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * TAU; return { p: [Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0], r: [0, 0, a], s: [0.045, 0.022, 0.012], c: 0xffffff }; }),
    { p: [0, 0, 0.012], s: [0.03, 0.03, 0.018], c: 0xffd23f },
  ]), mat: VC },
  sea: { kind: 'clip', build: () => cg('acc:sea', () => {
    const o = []; for (let i = 0; i < 40; i++) { const a = PI * 0.08 + (i / 39) * PI * 0.84; const r = 0.07 * (1 + 0.06 * Math.abs(Math.sin(a * 7))); o.push([Math.cos(a) * r, Math.sin(a) * r - 0.025]); }
    o.push([0.012, -0.045], [-0.012, -0.045]);
    const g = G.puffyShapeGeo(o.map((p) => [p[0] * 1.6, p[1] * 1.6]), 0.026, 4, 0.5);
    const a = rgb(0xffc2b3), b = rgb(0xff9a96);
    g.colorBy((x, y) => { const ang = Math.atan2(y + 0.04, x); return (Math.floor(ang / (PI / 7)) % 2) ? a : b; });
    return g;
  }), mat: VC },
  moon: { kind: 'clip', build: () => UNIT.star(), mat: () => MG(0xffe56b, { emissive: 0x8a6c10, spec: 0.6 }), s: 0.15, twinkle: true },
  canyon: { kind: 'hat', top: 0.11, build: () => merged('acc:canyon', [
    { g: () => cg('leafBrim', () => G.puffyShapeGeo(leafOutline(1.05, 1.15), 0.04, 3, 0.6)), r: [-PI / 2, 0, 0], p: [0, 0.012, 0], s: [0.36, 0.36, 0.5], c: 0x8cc152 },
    { p: [0, 0.07, 0], s: [0.13, 0.1, 0.12], c: 0xd9a66b },
    { g: UNIT.torus, p: [0, 0.035, 0], r: [PI / 2, 0, 0], s: [0.128, 0.118, 0.1], c: 0x7a4f33 },
    { g: leafGeo, p: [0.1, 0.07, 0.05], r: [0.3, 0.6, -0.9], s: [0.05, 0.09, 0.05], c: 0x6fb043 },
  ]), mat: VC },
  honey: { kind: 'hat', top: 0.1, build: () => merged('acc:honey', [
    { g: UNIT.hemi, p: [0, 0.0, 0], s: [0.17, 0.12, 0.17], c: 0xffb62e },
    ...[[30, 0.07], [110, 0.05], [200, 0.08], [290, 0.06]].map(([a, l]) => ({ p: [Math.sin(a * DEG) * 0.16, -l * 0.45, Math.cos(a * DEG) * 0.16], s: [0.026, l * 0.6, 0.026], c: 0xffa91e })),
    ...[[30, 0.07], [200, 0.08]].map(([a, l]) => ({ p: [Math.sin(a * DEG) * 0.16, -l * 0.95, Math.cos(a * DEG) * 0.16], s: 0.03, c: 0xffa91e })),
    { g: UNIT.cylinder, p: [0, 0.135, 0], s: [0.03, 0.04, 0.03], c: 0xd9861a },
  ]), mat: () => MG(0xffffff, { vertexColors: true, spec: 0.6, rim: 0.5 }) },
  jungle: { kind: 'hat', top: 0.08, build: () => merged('acc:jungle', [
    ...Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * TAU;
      return { g: leafGeo, p: [Math.sin(a) * 0.15, 0.07, Math.cos(a) * 0.15], r: [-0.5, a, 0], s: [0.17, 0.2, 0.15], c: i % 2 ? 0x5fae45 : 0x86c95a };
    }),
    { g: () => cg('thinTorusJ', () => G.torusGeo(1, 0.14, 8, 28)), r: [PI / 2, 0, 0], p: [0, 0.02, 0], s: [0.16, 0.16, 0.18], c: 0x7a5a3a },
  ]), mat: VC },
  snow: { kind: 'hat', top: 0.25, build: () => merged('acc:snow', [
    { g: UNIT.hemi, p: [0, 0.0, 0], s: [0.2, 0.24, 0.2], c: 0x6fb6d9 },
    { g: UNIT.torus, p: [0, 0.01, 0], r: [PI / 2, 0, 0], s: [0.192, 0.192, 0.2], c: 0xf2f6ff },
    { g: () => cg('thinTorusB', () => G.torusGeo(1, 0.1, 6, 28)), p: [0, 0.12, 0], r: [PI / 2, 0, 0], s: [0.17, 0.17, 0.1], c: 0xf2f6ff },
    { p: [0, 0.255, 0], s: 0.06, c: 0xffffff },
  ]), mat: VC },
  toy: { kind: 'hat', top: 0.11, build: () => merged('acc:toy', [
    ...[0, 1, 2, 3].map((i) => ({ g: () => cg('capSeg' + i, () => G.sphereGeo(1, 8, 6, (i * PI) / 2, PI / 2, 0, PI / 2)), s: [0.17, 0.12, 0.17], c: [0xff6b6b, 0xffd93f, 0x5ab4ff, 0x7ed36a][i] })),
    { g: UNIT.cylinder, p: [0, 0.006, 0.12], r: [0.15, 0, 0], s: [0.11, 0.012, 0.08], c: 0xff6b6b },
    { g: UNIT.cylinder, p: [0, 0.13, 0], s: [0.012, 0.03, 0.012], c: 0xb0b0c0 },
  ]), mat: VC, prop: true },
};
function buildAccessory(E, variant) {
  const A = ACC[variant];
  if (!A) return;
  const D = E.D;
  const clipMode = A.kind === 'clip' || D.headgear;
  const holder = clipMode ? grp(E.clipNode, 'acc') : grp(E.hatNode, 'acc');
  const s = clipMode ? (D.clipS ?? 1) * (A.kind === 'hat' ? 0.55 : 1) : (D.hatS ?? 1);
  holder.scale.set(s, s, s);
  if (clipMode && A.kind === 'hat') holder.rotation.set(0, 0, -0.35);
  const geoS = A.s ?? 1;
  const m = add(holder, A.build, A.mat(), { s: geoS });
  if (A.kind === 'clip' && variant === 'sea') m.rotation.set(0, 0, 0.2);
  if (A.prop && !clipMode) {
    E.prop = add(holder, () => merged('acc:prop', [
      { p: [0.075, 0, 0], r: [0.25, 0, 0], s: [0.075, 0.008, 0.024], c: 0xffd93f },
      { p: [-0.075, 0, 0], r: [-0.25, 0, 0], s: [0.075, 0.008, 0.024], c: 0x5ab4ff },
      { s: 0.018, c: 0xff6b6b },
    ]), VC(), { p: [0, 0.155, 0] });
  }
  if (A.twinkle) E.twinkle = m;
  if (A.kind === 'hat' && !clipMode && !D.swirlApart) E.swirlHolder.position.y += A.top * s;
  E.acc = holder;
}

// ------------------------------------------------------------------ rig
const ANIMS = ['idle', 'walk', 'run', 'windup', 'attack', 'hurt', 'stun', 'sleep', 'friendly', 'die', 'fly'];
class EnemyRig {
  constructor(type, D, variant) {
    this.type = type; this.D = D; this.variant = ACC[variant] ? variant : null;
    this.root = new Node('enemy-' + type);
    this.base = grp(this.root, 'base');
    this.body = grp(this.base, 'body', [0, D.bodyY ?? 0, 0]);
    this.feet = []; this.arms = []; this.tints = []; this.fx = [];
    this.opacity = 1; this.fade = 1; this._appliedOp = 1;
    this.T = Math.random() * 10; this.phase = Math.random() * TAU; this.flapPh = 0;
    this.blinkT = 0.5 + Math.random() * 2.5; this.blinkPhase = -1;
    this.sq = new Spring(190, 11);
    this.anim = '';
    this.k = D.height / 0.9;
    this.P = { lean: 0, roll: 0, yaw: 0, y: 0, z: 0, sy: 1, arm: 0.15, swing: 0, tint: 0, stars: 0, bubble: 0, cheeks: 0, brows: 1, spin: 0 };
    this.height = D.height; this.radius = D.radius; this.centerY = D.centerY; this.flying = !!D.flying;
  }
  tintMat(color, opts = {}) { const m = own(color, opts); this.tints.push(m); return m; }
  setFlash(v) { this.root.traverse((n) => { if (n.isMesh) n.flash = v; }); }
  setOpacity(v) { this.opacity = v; this._applyOpacity(true); }
  _applyOpacity(force) {
    const o = this.opacity * this.fade;
    if (!force && Math.abs(o - this._appliedOp) < 1e-4) return;
    this._appliedOp = o;
    this.root.traverse((n) => { if (n.isMesh) n.opacity = o * (n.userData.op ?? 1); });
  }
  update(dt, st = {}) {
    dt = clamp(dt, 0, 0.1);
    const D = this.D, P = this.P, k = this.k;
    const anim = ANIMS.includes(st.anim) ? st.anim : 'idle';
    const sp = clamp(st.speed ?? 0.7, 0, 1.6);
    this.animT = anim !== this.anim ? 0 : (this.animT || 0) + dt;
    const t = st.t ?? this.animT; // seconds since the anim started (falls back to our own clock)
    if (anim !== this.anim) {
      if (anim === 'hurt') this.sq.kick(-3.2);
      else if (anim === 'attack') this.sq.kick(1.6);
      else if (anim === 'friendly' || anim === 'stun') this.sq.kick(2.2);
      if (anim !== 'die') { this.fade = 1; this._applyOpacity(); }
      this.anim = anim;
    }
    this.T += dt;
    const T = this.T;
    const g = { lean: 0, roll: 0, yaw: 0, y: 0, z: 0, sy: 1, arm: 0.15, swing: 0, tint: 0, stars: 0, bubble: 0, cheeks: 0, brows: 1 };
    const S = { anim, t, sp, T, dt, expr: 'angry', mouth: 'frown', shake: 0, gait: 0, rate: 10, feet: 'stand', flap: 1 };
    const br = Math.sin(T * 2.4);
    switch (anim) {
      case 'idle': g.sy = 1 + 0.025 * br; g.roll = Math.sin(T * 1.1) * 0.04; g.arm = 0.15 + 0.06 * br; break;
      case 'walk': S.gait = 1; break;
      case 'run': S.gait = 2; S.mouth = 'open'; break;
      case 'fly':
        if (D.flying) S.gait = 1;
        else { g.arm = 1.3 + Math.sin(T * 17) * 0.35; S.mouth = 'o'; S.expr = 'surprised'; g.brows = 0; S.feet = 'dangle'; g.y = 0.03 * k; }
        break;
      case 'windup':
        g.sy = 0.86 + 0.02 * Math.sin(T * 31); g.lean = -0.12; S.shake = 0.016 * k; g.tint = 0.55 + 0.45 * Math.sin(T * 19);
        S.mouth = 'flat'; g.arm = 0.55; S.rate = 16; S.flap = 1.6;
        break;
      case 'attack': {
        const u = clamp(t / (D.attackDur ?? 0.5), 0, 1);
        const a = u < 0.28 ? Ease.outCubic(u / 0.28) : 1 - Ease.inOutSine((u - 0.28) / 0.72);
        g.lean = 0.34 * a; g.z = 0.16 * a * k; g.sy = 1 + 0.12 * a; g.arm = 0.15 + 1.1 * a; S.mouth = u < 0.85 ? 'open' : 'frown'; S.rate = 26; S.attackU = u; S.attackA = a;
        break;
      }
      case 'hurt': S.expr = 'hurt'; S.mouth = 'o'; g.lean = -0.3; g.z = -0.04 * k; g.sy = 0.88; g.brows = 0; g.arm = 1.1; S.rate = 18; S.feet = 'hop'; break;
      case 'stun': S.expr = 'dizzy'; S.mouth = 'o'; g.stars = 1; g.brows = 0; g.lean = Math.sin(T * 3.4) * 0.11; g.roll = Math.cos(T * 3.4) * 0.11; g.arm = 0.35 + Math.sin(T * 3.4) * 0.15; break;
      case 'sleep': S.expr = 'sleep'; S.mouth = 'o'; g.bubble = 1; g.brows = 0; g.sy = 0.94 + 0.04 * Math.sin(T * 1.7); g.lean = 0.1; g.roll = 0.07; g.arm = 0.05; S.flap = 0.35; break;
      case 'friendly':
        S.expr = 'happy'; S.mouth = 'open'; g.cheeks = 1; g.brows = 0;
        g.y = Math.abs(Math.sin(T * 6)) * 0.07 * k; g.roll = Math.sin(T * 3) * 0.16; g.yaw = Math.sin(T * 3) * 0.35;
        g.arm = 1.7 + Math.sin(T * 12) * 0.35; S.feet = 'dance';
        break;
      case 'die': S.expr = 'hurt'; S.mouth = 'o'; g.brows = 0; S.rate = 30; break;
      default: break;
    }
    // locomotion
    if (D.gait) D.gait(this, S, g);
    else if (S.gait) waddle(this, S, g);
    if (D.hook) D.hook(this, S, g);
    // smoothing
    const r = S.rate;
    for (const key of ['lean', 'roll', 'yaw', 'y', 'z', 'sy', 'arm', 'swing']) P[key] = approach(P[key], g[key], key === 'y' && S.fastY ? 40 : r, dt);
    P.tint = approach(P.tint, g.tint, 20, dt);
    P.stars = approach(P.stars, g.stars, 8, dt); P.bubble = approach(P.bubble, g.bubble, 5, dt);
    P.cheeks = approach(P.cheeks, g.cheeks, 10, dt); P.brows = approach(P.brows, g.brows, 14, dt);
    if (this.feet.length) footPose(this, S);
    // squash & stretch (volume-preserving) + spring
    const sq = this.sq.update(0, dt);
    let sy = P.sy * (1 + sq), sxz = 1 / Math.sqrt(Math.max(0.2, sy));
    // die: squash flat, then puff up & fade
    if (anim === 'die') {
      const u1 = clamp(t / 0.16, 0, 1), u2 = clamp((t - 0.2) / 0.26, 0, 1);
      sy = lerp(1, 0.3, Ease.outCubic(u1)); sxz = lerp(1, 1.42, Ease.outCubic(u1));
      if (u2 > 0) { sy = lerp(0.3, 1.35, Ease.outCubic(u2)); sxz = lerp(1.42, 1.8, Ease.outCubic(u2)); }
      this.fade = 1 - Ease.outQuad(u2);
      this._applyOpacity();
    }
    this.base.position.set(S.shake ? Math.sin(T * 71) * S.shake : 0, (D.baseY ?? 0) + P.y + (S.extraY || 0), P.z);
    this.base.rotation.set(P.lean, P.yaw, P.roll);
    this.base.scale.set(sxz, sy, sxz);
    // arms (nub pivots rotate up/out about z, swing about x)
    for (const a of this.arms) { a.node.rotation.set(-P.swing * a.sd * (a.swingK ?? 1), 0, a.sd * ((a.rest ?? 0) + P.arm * (a.k ?? 1))); }
    // fx: swirl, stars, bubble, cheeks, brows, tint
    if (this.swirl) {
      const wob = anim === 'windup' ? 0.25 : anim === 'friendly' ? 0.35 : 0.12;
      this.swirl.rotation.set(Math.sin(T * 1.9 + 1) * 0.08, T * 0.6, Math.sin(T * 1.7) * wob);
      const ss = anim === 'windup' ? 1.12 + 0.08 * Math.sin(T * 19) : anim === 'sleep' ? 0.9 : 1;
      this.swirl.scale.set(ss, ss * (anim === 'sleep' ? 0.85 : 1), ss);
    }
    if (this.stars) {
      this.stars.visible = P.stars > 0.03;
      const s = this.starsR * Math.min(1, P.stars * 1.2);
      this.stars.scale.set(s, s, s);
      this.stars.rotation.set(0.25 * Math.sin(T * 2), T * 4.2, 0.18);
    }
    if (this.bubble) {
      const b = P.bubble * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * 1.7 - 0.6)));
      this.bubble.visible = P.bubble > 0.05;
      this.bubble.scale.set(b * this.bubbleR, b * this.bubbleR, b * this.bubbleR);
    }
    if (this.cheeks) { this.cheeks.visible = P.cheeks > 0.05; const c = 0.3 + 0.7 * P.cheeks; this.cheeks.scale.set(c, c, 1); }
    if (this.brows) { this.brows.visible = P.brows > 0.5; this.brows.position.y = this.browRest - (anim === 'windup' ? 0.012 * k : 0); }
    for (const m of this.tints) { const e = m.emissive, v = P.tint; e[0] = 0.36 * v; e[1] = 0.025 * v; e[2] = 0.07 * v; }
    // face
    const ex = S.expr;
    if (this.eyes) {
      this.eyes.set(ex === 'dizzy' ? 'none' : ex);
      if (this.dizzy) { this.dizzy.visible = ex === 'dizzy'; if (ex === 'dizzy') this.dizzy.rotation.z = 0; }
      if (ex === 'angry' || ex === 'normal' || ex === 'surprised') {
        this.blinkT -= dt;
        if (this.blinkT <= 0 && this.blinkPhase < 0) { this.blinkPhase = 0; this.blinkT = 1.8 + Math.random() * 3.2; }
        if (this.blinkPhase >= 0) {
          this.blinkPhase += dt / 0.14;
          const v = this.blinkPhase < 0.5 ? 1 - this.blinkPhase * 2 : (this.blinkPhase - 0.5) * 2;
          this.eyes.blink(v);
          if (this.blinkPhase >= 1) { this.blinkPhase = -1; this.eyes.blink(1); }
        }
      }
    }
    if (this.mouth) this.mouth.set(S.mouth);
    if (this.prop) this.prop.rotation.y += dt * (anim === 'run' || anim === 'friendly' ? 26 : 12);
    if (this.twinkle) { const k = (this.twinkleS || (this.twinkleS = this.twinkle.scale.x)) * (1 + 0.12 * Math.sin(T * 4.5)); this.twinkle.scale.set(k, k, k); this.twinkle.rotation.z = Math.sin(T * 1.3) * 0.25; }
    if (D.post) D.post(this, S, P);
    for (const m of this.fx) { const o = m.userData.op ?? 1; m.opacity = this.opacity * this.fade * o; m.visible = o > 0.004 && m.opacity > 0.004; }
  }
}

// generic waddle on tiny feet
function waddle(E, S, g) {
  const k = E.k, run = S.gait === 2;
  const f = run ? 10 + 5 * S.sp : 6 + 3.5 * S.sp;
  E.phase += S.dt * f;
  const s = Math.sin(E.phase), c = Math.cos(E.phase);
  g.y += Math.abs(s) * (run ? 0.05 : 0.03) * k;
  g.roll += c * (run ? 0.1 : 0.08);
  g.lean += run ? 0.22 : 0.08;
  g.sy *= 1 - (1 - Math.abs(s)) * 0.05;
  g.swing = s * (run ? 0.9 : 0.55);
  g.arm = run ? 0.45 : 0.25;
  S.feet = 'walk';
}
function footPose(E, S) {
  const k = E.k;
  for (const f of E.feet) {
    const rest = f.rest;
    let x = rest[0], y = rest[1], z = rest[2], rx = 0;
    if (S.feet === 'walk') {
      const ph = E.phase + (f.sd < 0 ? 0 : PI);
      y += Math.max(0, Math.sin(ph)) * (S.gait === 2 ? 0.07 : 0.05) * k;
      z += Math.cos(ph) * (S.gait === 2 ? 0.09 : 0.065) * k;
      rx = -Math.cos(ph) * 0.35;
    } else if (S.feet === 'dangle') {
      y -= 0.03 * k; z += Math.sin(S.T * 9 + f.sd) * 0.03 * k; rx = 0.4 + Math.sin(S.T * 9 + f.sd) * 0.3;
    } else if (S.feet === 'dance') {
      const ph = S.T * 6 + (f.sd < 0 ? 0 : PI);
      y += Math.max(0, Math.sin(ph)) * 0.04 * k;
    } else if (S.feet === 'hop') {
      y += 0.02 * k; rx = -0.3;
    } else if (S.feet === 'paw' && f.sd > 0) {
      const ph = S.T * 13;
      y += (0.5 + 0.5 * Math.sin(ph)) * 0.035 * k; z += Math.cos(ph) * 0.07 * k; rx = -Math.cos(ph) * 0.5;
    }
    // feet counter the body squash so they stay planted
    f.node.position.set(x, y, z);
    f.node.rotation.x = rx;
  }
}

// ------------------------------------------------------------------ common builders
function addFeet(E, o) {
  const m = M(o.c ?? FOG.foot);
  for (const sd of [-1, 1]) {
    const node = grp(E.base, sd < 0 ? 'footL' : 'footR');
    ell(node, m, [0, o.h ?? 0.045, 0.012], o.s[0], o.s[1], o.s[2]);
    const rest = [sd * o.x, 0, o.z ?? 0.04];
    node.position.set(...rest);
    E.feet.push({ node, sd, rest });
  }
}
function addArms(E, o) {
  const m = o.mat || M(o.c ?? FOG.mid);
  for (const sd of [-1, 1]) {
    const node = grp(E.body, sd < 0 ? 'armL' : 'armR', [sd * o.x, o.y, o.z ?? 0.02]);
    if (o.len) ell(node, m, [sd * o.len * 0.5, 0, 0], o.len * 0.6, o.r, o.r);
    else ell(node, m, [sd * o.r * 0.75, -o.r * 0.25, 0], o.r, o.r * 0.9, o.r * 0.95);
    E.arms.push({ node, sd, rest: o.rest ?? 0, k: o.k ?? 1 });
  }
}
// swirl, stars, bubble, accessory anchors. top = [x,y,z] in body space; mouth = bubble spot
function addFogBits(E, o) {
  E.swirlHolder = grp(E.body, 'swirlHolder', o.top);
  E.swirl = add(E.swirlHolder, swirlGeo, swirlMat(), { s: o.swirlS ?? 1 });
  E.swirl.position.set(0, -0.02 * (o.swirlS ?? 1), 0);
  E.hatNode = grp(E.body, 'hat', o.hat?.p || o.top, o.hat?.r);
  E.clipNode = grp(E.body, 'clip', o.clip.p, o.clip.r);
  E.stars = add(E.body, starsGeo, MG(0xffe14d, { emissive: 0x4a3a00, spec: 0.5 }), { p: [o.top[0], o.top[1] + (o.starsY ?? 0.08), o.top[2]] });
  E.starsR = o.starsR ?? 0.26; E.stars.visible = false;
  E.bubble = add(E.body, UNIT.sphere, M(0xcfeeff, { transparent: true, opacity: 0.5, spec: 0.7, rim: 0.9, depthWrite: false }), { p: o.bubble });
  E.bubbleR = o.bubbleR ?? 0.08; E.bubble.visible = false;
}

// ------------------------------------------------------------------ types
const TYPES = {};
const T_ = (type, D) => { TYPES[type] = D; };

// cloud blob: main sphere + puffs (vertex coloured, lighter on top)
function cloudParts(R, extra = []) {
  const L = FOG.light, Mi = FOG.mid, Dk = FOG.dark;
  return [
    { g: UNIT.sphereHi, s: R, c: Mi },
    { p: [0, R * 0.62, -R * 0.1], s: R * 0.6, c: L },
    { p: [-R * 0.56, R * 0.4, -R * 0.08], s: R * 0.5, c: L },
    { p: [R * 0.56, R * 0.4, -R * 0.08], s: R * 0.5, c: L },
    { p: [-R * 0.84, -R * 0.08, -R * 0.06], s: R * 0.43, c: Mi },
    { p: [R * 0.84, -R * 0.08, -R * 0.06], s: R * 0.43, c: Mi },
    { p: [0, R * 0.3, -R * 0.58], s: R * 0.58, c: L },
    { p: [-R * 0.5, -R * 0.1, -R * 0.55], s: R * 0.48, c: Mi },
    { p: [R * 0.5, -R * 0.1, -R * 0.55], s: R * 0.48, c: Mi },
    { p: [-R * 0.42, -R * 0.55, 0.0], s: R * 0.42, c: Dk },
    { p: [R * 0.42, -R * 0.55, 0.0], s: R * 0.42, c: Dk },
    { p: [0, -R * 0.55, -R * 0.4], s: R * 0.45, c: Dk },
    ...extra,
  ];
}

// ---- gloomy 뭉게먹구름: fluffy cloud blob on tiny feet
T_('gloomy', {
  height: 0.9, radius: 0.42, centerY: 0.42, bodyY: 0.42,
  build(E) {
    const R = 0.33;
    add(E.body, () => merged('gloomy', cloudParts(R)), E.tintMat(0xffffff, { vertexColors: true }));
    faceKit(E, E.body, { R, yaw: 21, pitch: 6, size: 0.82 });
    addFeet(E, { x: 0.13, s: [0.085, 0.055, 0.105] });
    addArms(E, { x: R * 0.98, y: -R * 0.2, z: 0.06, r: 0.07, c: FOG.mid });
    addFogBits(E, { top: [0, R * 1.18, -0.03], clip: { p: onSphere(R * 1.02, -38, 52), r: faceRot(-38, 52) }, bubble: [0.1, -0.06, R * 0.95], starsR: 0.28 });
  },
});

// ---- hopper 통통먹구름: glossy jelly gumdrop that bounces (strong squash & stretch)
T_('hopper', {
  height: 0.8, radius: 0.4, centerY: 0.34,
  build(E) {
    const geo = cg('gumdrop', () => {
      const prof = [[0, 0], [0.26, 0.0], [0.345, 0.03], [0.385, 0.1], [0.385, 0.2], [0.355, 0.34], [0.29, 0.48], [0.19, 0.58], [0.08, 0.63], [0, 0.645]];
      const g = G.latheGeo(prof, 36);
      const lo = rgb(FOG.dark), hi = rgb(0xc9c1e6);
      g.colorBy((x, y) => { const t = clamp(y / 0.62, 0, 1); return [lerp(lo[0], hi[0], t), lerp(lo[1], hi[1], t), lerp(lo[2], hi[2], t)]; });
      return g;
    });
    const jm = E.tintMat(0xffffff, { vertexColors: true, spec: 0.75, rim: 0.65 });
    add(E.body, geo, jm);
    // shine decals
    add(E.body, () => merged('hopShine2', [{ p: onSphere(0.3, -42, 58), r: faceRot(-42, 58), s: [0.06, 0.036, 0.02] }, { p: onSphere(0.34, -58, 38), r: faceRot(-58, 38), s: [0.018, 0.018, 0.012] }]), MU(0xffffff, { transparent: true, opacity: 0.8, depthWrite: false }), { p: [0, 0.24, 0] });
    const head = grp(E.body, 'head', [0, 0.27, 0]);
    faceKit(E, head, { R: 0.375, yaw: 21, pitch: 6, size: 0.82, mouthPitch: -12 });
    addFogBits(E, { top: [0, 0.635, -0.02], clip: { p: [-0.2, 0.5, 0.14], r: [-0.5, -0.5, 0.35] }, bubble: [0.1, 0.22, 0.36], starsR: 0.26, starsY: 0.1 });
  },
  gait(E, S, g) {
    // hops: crouch -> launch -> airborne arc -> land squash
    const run = S.gait === 2, k = E.k;
    if (!S.gait) { // idle jiggle
      if (S.anim === 'idle') { g.sy = 1 + Math.sin(S.T * 5.2) * 0.04 * (0.6 + 0.4 * Math.sin(S.T * 0.7)); g.roll = Math.sin(S.T * 2.6) * 0.05; }
      E.hopU = 0;
      return;
    }
    const per = run ? 0.42 : 0.62;
    const prev = E.hopU ?? 0;
    E.hopU = (prev + S.dt / per) % 1;
    const u = E.hopU;
    if (u < prev) E.sq.kick(-2.2); // landed
    const air = u > 0.18 && u < 0.92;
    if (!air) { g.sy = u <= 0.18 ? 1 - 0.28 * Math.sin((u / 0.18) * PI * 0.5) : 0.85; g.y = 0; }
    else { const v = (u - 0.18) / 0.74; g.y = Math.sin(v * PI) * (run ? 0.26 : 0.2) * k; g.sy = 1 + 0.22 * Math.cos(v * PI) * (v < 0.5 ? 1 : 0.6); }
    g.lean = run ? 0.18 : 0.08;
    S.fastY = true;
    S.rate = 30;
  },
});

// ---- flyer 훨훨먹구름: small cloud with little bat wings (flying)
function batWingGeo() {
  return cg('batWing2', () => {
    // span along +x. Convex leading edge to the main tip, then 3 scalloped (concave) arcs back to the root
    const o = [];
    const lead = (u) => [0.33 * u, 0.06 + 0.12 * Math.sin(u * PI * 0.62)];
    for (let i = 0; i <= 10; i++) o.push(lead(i / 10));
    const tips = [[0.33, lead(1)[1]], [0.25, -0.02], [0.15, -0.05], [0.04, -0.04]];
    for (let k = 0; k < 3; k++) {
      const A = tips[k], B = tips[k + 1];
      for (let i = 1; i <= 8; i++) {
        const u = i / 8, x = lerp(A[0], B[0], u), y = lerp(A[1], B[1], u);
        const bulge = Math.sin(u * PI) * 0.035; // concave scallop: push toward the wing centre
        const cx = 0.17, cy = 0.06; const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy) || 1;
        o.push([x + (dx / l) * bulge, y + (dy / l) * bulge]);
      }
    }
    o.push([0.0, 0.0]);
    let cx = 0, cy = 0; for (const p of o) { cx += p[0]; cy += p[1]; } cx /= o.length; cy /= o.length;
    const g = G.puffyShapeGeo(o.map((p) => [p[0] - cx, p[1] - cy]), 0.02, 3, 0.5);
    g.rotate(PI / 2, 0, 0);
    g.translate(cx, 0, cy);
    const c0 = rgb(FOG.deep), c1 = rgb(0x8a7fb0);
    g.colorBy((x) => { const t = clamp(x / 0.33, 0, 1); return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]; });
    g.computeBoundingSphere();
    return g;
  });
}
T_('flyer', {
  height: 0.7, radius: 0.36, centerY: 0, bodyY: 0, flying: true,
  build(E) {
    const R = 0.24;
    add(E.body, () => merged('flyer', cloudParts(R).slice(0, 9)), E.tintMat(0xffffff, { vertexColors: true }));
    faceKit(E, E.body, { R, yaw: 22, pitch: 4, size: 0.62, mouthPitch: -16 });
    const wm = VC();
    E.wings = [];
    for (const sd of [-1, 1]) {
      const piv = grp(E.body, 'wing', [sd * R * 0.85, R * 0.25, -R * 0.25], [0, sd * 0.35, 0]);
      add(piv, batWingGeo, wm, { s: 0.9, r: sd < 0 ? [0, 0, PI] : undefined });
      E.wings.push({ piv, sd });
    }
    // tiny dangling feet
    for (const sd of [-1, 1]) {
      const node = grp(E.body, 'foot', [sd * 0.07, -R * 0.92, 0.02]);
      ell(node, M(FOG.foot), [0, -0.025, 0.01], 0.05, 0.035, 0.06);
      E.feet.push({ node, sd, rest: [sd * 0.07, -R * 0.92, 0.02], dangle: true });
    }
    addFogBits(E, { top: [0, R * 1.15, -0.02], swirlS: 0.75, clip: { p: onSphere(R * 1.02, -36, 50), r: faceRot(-36, 50) }, bubble: [0.07, -0.05, R * 0.95], bubbleR: 0.06, starsR: 0.2 });
  },
  clipS: 0.75, hatS: 0.72,
  gait(E, S, g) {
    const k = E.k, moving = S.gait > 0 || S.anim === 'attack';
    g.y += Math.sin(S.T * 2.2) * 0.04 * k;
    if (moving) { g.lean += 0.25; g.roll += Math.sin(S.T * 1.6) * 0.1; }
    if (S.anim === 'attack') { g.lean = 0.6 * (S.attackA || 0); g.z = 0.25 * (S.attackA || 0); g.y -= 0.12 * (S.attackA || 0); }
    S.feet = 'flyer';
  },
  post(E, S) {
    const hz = S.anim === 'sleep' ? 1.2 : S.anim === 'run' || S.anim === 'windup' ? 7 : S.anim === 'die' ? 0 : 4.5;
    E.flapPh += S.dt * hz * TAU;
    const a = S.anim === 'sleep' ? -0.9 : 0.25 + Math.sin(E.flapPh) * 0.75;
    for (const w of E.wings) w.piv.rotation.z = w.sd * a;
    for (const f of E.feet) f.node.rotation.x = 0.3 + Math.sin(S.T * 3 + f.sd) * 0.25;
  },
});

// ---- shooter 뿅뿅달팽이: snail whose shell is a little cannon
T_('shooter', {
  height: 0.9, radius: 0.42, centerY: 0.36, bodyY: 0,
  build(E) {
    const bm = E.tintMat(0xffffff, { vertexColors: true });
    add(E.body, () => merged('snailBody', [
      { g: UNIT.sphereHi, p: [0, 0.1, -0.04], s: [0.17, 0.11, 0.4], c: FOG.light },
      { p: [0, 0.18, 0.2], s: [0.15, 0.16, 0.15], c: FOG.light },
      { g: UNIT.sphereHi, p: [0, 0.3, 0.27], s: 0.19, c: 0xd2cce6 },
      { p: [0, 0.04, -0.04], s: [0.175, 0.045, 0.405], c: FOG.mid },
      ...[-1, 1].map((sd) => ({ g: () => cg('snailAnt' + sd, () => tubeGeo(curve((u) => [sd * 0.05 * u, 0.1 * u, 0.02 * u - 0.02 * u * u], 6), 0.012, 6, 2)), p: [sd * 0.06, 0.46, 0.26], c: FOG.mid })),
      ...[-1, 1].map((sd) => ({ p: [sd * 0.11, 0.565, 0.27], s: 0.026, c: FOG.dark })),
    ]), bm);
    // shell (spiral) — its own node so it can recoil
    E.shell = grp(E.body, 'shell', [0, 0.36, -0.12]);
    const SA = 0.21, SR = 0.26; // shell half-width, radius
    const spiral = (sd) => () => cg('shellSpiral' + sd, () => tubeGeo(curve((u) => {
      const a = u * PI * 3.0 + 0.6; const r = SR * 0.93 * (1 - u * 0.88);
      return [sd * (SA * Math.sqrt(Math.max(0, 1 - (r * r) / (SR * SR))) + 0.004), Math.sin(a) * r, Math.cos(a) * r];
    }, 44), (u) => lerp(0.022, 0.013, u), 6, 2));
    add(E.shell, () => merged('shell2', [
      { g: UNIT.sphereHi, s: [SA, SR, SR], c: 0xa08daf },
      { g: spiral(-1), c: 0x6e5d82 }, { g: spiral(1), c: 0x6e5d82 },
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.35, rim: 0.4 }));
    // cannon barrel poking out of the shell top, aimed forward
    E.barrel = grp(E.shell, 'barrel', [0, 0.16, 0.02], [-0.42, 0, 0]);
    const thinTorus = () => cg('thinTorus', () => G.torusGeo(1, 0.16, 8, 24));
    add(E.barrel, () => merged('barrel2', [
      { g: UNIT.cylinder, r: [PI / 2, 0, 0], p: [0, 0, 0.1], s: [0.07, 0.24, 0.07], c: 0x6a7090 },
      { g: thinTorus, p: [0, 0, 0.215], s: [0.078, 0.078, 0.11], c: 0x9ca2be },
      { g: thinTorus, p: [0, 0, 0.06], s: [0.076, 0.076, 0.09], c: 0x9ca2be },
      { g: UNIT.disc, r: [PI / 2, 0, 0], p: [0, 0, 0.2205], s: 0.052, c: 0x2a2638 },
    ]), MG(0xffffff, { vertexColors: true, spec: 0.55 }));
    E.muzzle = grp(E.barrel, 'muzzle', [0, 0, 0.25]);
    E.flash = add(E.muzzle, () => invSphereGeo('invSphere'), glowMat(0xd8c8ff), { s: 0.1 }); E.flash.userData.op = 0; E.fx.push(E.flash);
    const head = grp(E.body, 'head', [0, 0.3, 0.27]);
    faceKit(E, head, { R: 0.19, yaw: 25, pitch: 4, size: 0.58, mouthPitch: -22, browLen: 0.9, cheekYaw: 46 });
    addFogBits(E, { top: [0, 0.62, -0.16], swirlS: 0.8, hat: { p: [0, 0.47, 0.27] }, clip: { p: onSphere(0.2, -40, 40).map((v, i) => v + [0, 0.3, 0.27][i]), r: faceRot(-40, 40) }, bubble: [0.06, 0.24, 0.45], bubbleR: 0.06, starsR: 0.2, starsY: -0.12 });
    E.swirlHolder.position.set(0, 0.61, -0.17);
  },
  hatS: 0.55, clipS: 0.6, attackDur: 0.55, swirlApart: true,
  gait(E, S, g) {
    // slides on its foot: peristaltic squash along z, no stepping
    if (S.gait) { E.phase += S.dt * (S.gait === 2 ? 9 : 5); g.sy = 1 + Math.sin(E.phase) * 0.03; g.lean += 0.04; }
    if (S.anim === 'attack') { g.lean = -0.08 * (S.attackA || 0); g.z = -0.05 * (S.attackA || 0); g.sy = 1 - 0.06 * (S.attackA || 0); }
  },
  post(E, S) {
    const u = S.anim === 'attack' ? S.attackU : 1;
    const kick = S.anim === 'attack' ? Math.max(0, 1 - u / 0.35) : 0;
    E.shell.position.z = -0.12 - 0.07 * kick;
    E.shell.position.y = 0.36 + (S.gait ? Math.sin(E.phase) * 0.012 : 0);
    E.shell.rotation.x = -0.15 * kick + (S.anim === 'windup' ? Math.sin(S.T * 30) * 0.03 : 0);
    E.barrel.scale.set(1 + 0.25 * kick, 1 + 0.25 * kick, 1 - 0.3 * kick);
    E.flash.userData.op = S.anim === 'attack' ? Math.max(0, 1 - u / 0.25) : S.anim === 'windup' ? 0.35 + 0.3 * Math.sin(S.T * 19) : 0;
    const fs = 0.08 + 0.12 * (S.anim === 'attack' ? Math.min(1, u * 6) : 0.4);
    E.flash.scale.set(fs, fs, fs);
  },
});

// ---- spiky 가시먹구름: blob covered in soft spikes (can't be stomped)
T_('spiky', {
  height: 0.9, radius: 0.46, centerY: 0.42, bodyY: 0.42,
  build(E) {
    const R = 0.33;
    add(E.body, () => merged('spikyBody', [{ g: UNIT.sphereHi, s: R, c: FOG.mid }, { p: [0, -R * 0.4, 0.02], s: [R * 0.9, R * 0.6, R * 0.9], c: FOG.dark }]), E.tintMat(0xffffff, { vertexColors: true }));
    const spikes = [];
    const dirs = [];
    for (let i = 0; i < 34; i++) {
      const y = 1 - (i + 0.5) / 34 * 1.6, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
      const d = [Math.sin(a) * r, y, Math.cos(a) * r];
      if (d[2] > 0.42 && d[1] < 0.66 && d[1] > -0.55) continue; // keep the face clear
      if (d[1] < -0.45) continue;
      dirs.push(d);
    }
    const spikeGeo = () => cg('softSpike', () => {
      const g = tubeGeo(curve((u) => [0, u * 0.17, 0], 7), (u) => lerp(0.1, 0.036, Math.pow(u, 0.8)), 10, 3);
      const a = rgb(FOG.dark), b = rgb(0xcac3e4);
      g.colorBy((x, y) => { const t = clamp((y - 0.06) / 0.18, 0, 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; });
      return g;
    });
    for (const d of dirs) {
      const yaw = Math.atan2(d[0], d[2]), pitch = Math.asin(d[1]);
      spikes.push({ g: spikeGeo, p: [d[0] * R * 0.9, d[1] * R * 0.9, d[2] * R * 0.9], r: [PI / 2 - pitch, yaw, 0], s: 1 });
    }
    E.spikes = add(E.body, () => merged('spikes', spikes), E.tintMat(0xffffff, { vertexColors: true, spec: 0.3 }));
    faceKit(E, E.body, { R, yaw: 21, pitch: 4, size: 0.78 });
    addFeet(E, { x: 0.13, s: [0.085, 0.055, 0.105] });
    addFogBits(E, { top: [0, R * 1.45, -0.02], swirlS: 0.85, hat: { p: [0, R * 1.08, 0] }, clip: { p: onSphere(R * 1.05, -30, 30), r: faceRot(-30, 30) }, bubble: [0.1, -0.08, R * 0.95], starsR: 0.32, starsY: 0.05 });
  },
  hatS: 1.05,
  post(E, S) {
    const a = S.anim === 'attack' ? (S.attackA || 0) : S.anim === 'windup' ? 0.15 + 0.1 * Math.sin(S.T * 19) : S.anim === 'hurt' ? 0.3 : 0;
    const s = 1 + 0.18 * a;
    E.spikes.scale.set(s, s, s);
  },
});

// ---- shield 방패먹구름: blob holding a round wooden shield
T_('shield', {
  height: 1.0, radius: 0.44, centerY: 0.46, bodyY: 0.46,
  build(E) {
    const R = 0.34;
    add(E.body, () => merged('shieldBody', cloudParts(R).slice(0, 9)), E.tintMat(0xffffff, { vertexColors: true }));
    faceKit(E, E.body, { R, yaw: 20, pitch: 14, size: 0.78, mouthPitch: -2 });
    addFeet(E, { x: 0.13, s: [0.085, 0.055, 0.105] });
    // shield + the little arms holding it (one node: bash / raise)
    E.shieldNode = grp(E.body, 'shield', [0, -0.19, R * 0.98]);
    add(E.shieldNode, () => merged('shieldDisc', [
      { g: () => cg('shieldWood', () => { const g = G.cylinderGeo(1, 1, 1, 28, 1, true); g.colorBy((x) => (Math.floor((x + 1) * 2.5) % 2 ? rgb(0xb08a63) : rgb(0xa07a55))); return g; }), r: [PI / 2, 0, 0], s: [0.225, 0.05, 0.225] },
      { g: UNIT.torus, s: [0.222, 0.222, 0.18], c: 0x8c87a3 },
      { g: UNIT.sphereHi, p: [0, 0, 0.028], s: [0.066, 0.066, 0.036], c: 0xa9a4bf },
      ...[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * TAU + 0.3; return { p: [Math.cos(a) * 0.178, Math.sin(a) * 0.178, 0.027], s: [0.013, 0.013, 0.009], c: 0xc9c4dc }; }),
      ...[-1, 1].map((sd) => ({ p: [sd * 0.215, 0.03, -0.05], s: [0.068, 0.062, 0.068], c: FOG.mid })),
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.25 }));
    addFogBits(E, { top: [0, R * 1.18, -0.03], clip: { p: onSphere(R * 1.02, -38, 52), r: faceRot(-38, 52) }, bubble: [0.1, 0.0, R * 0.98], starsR: 0.28 });
  },
  hook(E, S, g) { if (S.anim === 'friendly') g.arm = 0; },
  post(E, S, P) {
    const n = E.shieldNode;
    let z = 0.34 * 0.98, y = -0.19, rx = 0;
    if (S.anim === 'attack') { const a = S.attackA || 0; z += 0.18 * a; rx = -0.15 * a; }
    else if (S.anim === 'windup') { z -= 0.05; y += 0.02; }
    else if (S.anim === 'walk' || S.anim === 'run') { y += Math.sin(E.phase * 2) * 0.012; }
    else if (S.anim === 'friendly') { y = -0.12 + Math.sin(S.T * 6) * 0.03; rx = 0.2; }
    else if (S.anim === 'sleep') { y = -0.24; rx = 0.3; }
    else if (S.anim === 'hurt' || S.anim === 'stun') { rx = 0.25; y = -0.22; }
    n.position.z = approach(n.position.z, z, 18, S.dt); n.position.y = approach(n.position.y, y, 12, S.dt);
    n.rotation.x = approach(n.rotation.x, rx, 12, S.dt);
  },
});

// ---- roller 데굴먹구름: round ball body that rolls when running
T_('roller', {
  height: 0.9, radius: 0.4, centerY: 0.42, bodyY: 0.42,
  build(E) {
    const R = 0.37;
    E.ball = grp(E.body, 'ball');
    add(E.ball, () => merged('rollerBall', [
      { g: () => band(0, 0.6), s: R, c: FOG.light },
      { g: () => band(0.6, 0.72), s: R * 1.004, c: 0x7f75a3 },
      { g: () => band(0.72, 1), s: R, c: FOG.mid },
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * TAU + PI / 8, y = Math.cos(0.66 * PI), r = Math.sin(0.66 * PI); return { p: [Math.sin(a) * r * R * 1.01, y * R * 1.01, Math.cos(a) * r * R * 1.01], r: [0.16 * PI, a, 0], s: [0.028, 0.028, 0.01], c: 0xd9d3ee }; }),
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.3, rim: 0.45 }), { r: [0, 0, 0] });
    const head = grp(E.ball, 'face', [0, 0.02, 0]);
    faceKit(E, head, { R: R * 1.0, yaw: 21, pitch: 12, size: 0.8, mouthPitch: -10 });
    addFeet(E, { x: 0.12, s: [0.08, 0.05, 0.1] });
    addFogBits(E, { top: [0, R * 0.98, -0.04], clip: { p: onSphere(R * 1.0, -40, 45), r: faceRot(-40, 45) }, bubble: [0.1, -0.02, R * 0.98], starsR: 0.28 });
    // the wisp & accessory ride on the ball
    E.ball.add(E.swirlHolder); E.ball.add(E.hatNode); E.ball.add(E.clipNode);
  },
  gait(E, S, g) {
    const k = E.k;
    if (S.gait === 2) { // roll!
      E.rollV = approach(E.rollV || 0, 9 + 6 * S.sp, 6, S.dt);
      E.phase += S.dt * 14;
      g.y += Math.abs(Math.sin(E.phase)) * 0.02 * k; g.lean += 0.05;
      S.feet = 'tuck';
      S.mouth = 'open';
    } else {
      E.rollV = approach(E.rollV || 0, 0, 5, S.dt);
      if (S.gait) waddle(E, S, g);
    }
  },
  post(E, S) {
    E.roll = (E.roll || 0) + S.dt * (E.rollV || 0);
    if ((E.rollV || 0) < 0.05) { const tgt = Math.round(E.roll / TAU) * TAU; E.roll = approach(E.roll, tgt, 6, S.dt); }
    E.ball.rotation.x = E.roll;
    const tuck = S.feet === 'tuck' ? 1 : 0;
    E.tuck = approach(E.tuck || 0, tuck, 12, S.dt);
    for (const f of E.feet) { f.node.scale.set(1 - E.tuck * 0.9, 1 - E.tuck * 0.9, 1 - E.tuck * 0.9); f.node.visible = E.tuck < 0.95; }
  },
});

// ---- bomber 펑펑먹구름: blob with tiny helmet, holds a cloud-bomb overhead
T_('bomber', {
  height: 0.95, radius: 0.4, centerY: 0.37, bodyY: 0.37, headgear: true, attackDur: 0.7,
  build(E) {
    const R = 0.3;
    add(E.body, () => merged('bomberBody', [
      ...cloudParts(R).slice(0, 1), ...cloudParts(R).slice(4, 12),
      { g: () => band(0, 0.34), r: [-0.2, 0, 0], s: R * 1.07, c: 0x7f8868 },
      { g: () => cg('thinTorus2', () => G.torusGeo(1, 0.09, 8, 30)), p: [0, Math.cos(0.34 * PI) * R * 1.07 * Math.cos(0.2), -Math.cos(0.34 * PI) * R * 1.07 * Math.sin(0.2)], r: [PI / 2 - 0.2, 0, 0], s: Math.sin(0.34 * PI) * R * 1.07, c: 0x6b7356 },
      { p: [0, R * 1.07, -R * 0.2], s: [0.045, 0.03, 0.045], c: 0x6b7356 },
    ]), E.tintMat(0xffffff, { vertexColors: true }));
    faceKit(E, E.body, { R, yaw: 21, pitch: 4, size: 0.74 });
    addFeet(E, { x: 0.12, s: [0.08, 0.05, 0.1] });
    addArms(E, { x: R * 0.72, y: R * 0.55, z: 0.02, r: 0.055, len: 0.16, c: FOG.mid, rest: 0 });
    E.bomb = buildBomb();
    E.bombHolder = grp(E.body, 'bombHold', [0, R + 0.17, 0.0]);
    E.bombHolder.add(E.bomb);
    E.bomb.scale.set(0.9, 0.9, 0.9);
    E.muzzle = grp(E.bombHolder, 'muzzle');
    addFogBits(E, { top: [0.16, R * 0.92, -0.08], swirlS: 0.7, clip: { p: onSphere(R * 1.05, 42, 34), r: faceRot(42, 34) }, bubble: [0.09, -0.05, R * 0.95], starsR: 0.26, starsY: 0.02 });
  },
  clipS: 0.85,
  hook(E, S, g) {
    // arms hold the bomb overhead
    g.arm = S.anim === 'friendly' ? g.arm : S.anim === 'hurt' || S.anim === 'stun' || S.anim === 'sleep' ? 0.6 : 1.85;
    g.swing *= 0.25;
  },
  post(E, S) {
    const h = E.bombHolder;
    let y = 0.47, z = 0, vis = true, sc = 1;
    if (S.anim === 'attack') {
      const u = S.attackU;
      if (u < 0.3) { z = -0.12 * Ease.outCubic(u / 0.3); y = 0.5; }
      else if (u < 0.4) { z = lerp(-0.12, 0.25, (u - 0.3) / 0.1); }
      else { vis = false; }
      if (u > 0.78) { vis = true; sc = Ease.outBack(clamp((u - 0.78) / 0.22, 0, 1)); z = 0; }
      for (const a of E.arms) a.node.rotation.x = u < 0.3 ? 0.6 * (u / 0.3) : u < 0.45 ? lerp(0.6, -1.4, (u - 0.3) / 0.15) : lerp(-1.4, 0, clamp((u - 0.45) / 0.4, 0, 1));
    } else if (S.anim === 'hurt' || S.anim === 'stun' || S.anim === 'sleep') { y = 0.44; z = -0.06; }
    else if (S.anim === 'windup') { y = 0.5 + Math.sin(S.T * 25) * 0.01; }
    else if (S.anim === 'friendly') { y = 0.47 + Math.abs(Math.sin(S.T * 6)) * 0.05; }
    h.position.set(0, approach(h.position.y, y, 16, S.dt), approach(h.position.z, z, 22, S.dt));
    h.visible = vis;
    h.scale.set(sc, sc, sc);
    E.bomb.update(S.dt);
  },
});

// ---- ghost 스르륵: translucent wavy-hem ghost cloud (flying, floaty)
function ghostGeo() {
  // per-instance (the hem ripples): dome + skirt with a wavy hem
  const NS = 32, NV = 14, R = 0.38, H = 0.42;
  const pos = new Float32Array((NS + 1) * (NV + 1) * 3), idx = [];
  const g = new G.Geometry();
  const build = (time) => {
    let o = 0;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NS; i++) {
        const ph = (i / NS) * TAU;
        let r, y;
        if (v <= 0.5) { const th = (v / 0.5) * (PI / 2); r = R * Math.sin(th); y = R * 0.92 * Math.cos(th); }
        else { const w = (v - 0.5) / 0.5; const hem = 0.06 * Math.sin(ph * 6 + time * 3.2) * w * w; r = R * (1 + 0.16 * w * w) + 0.02 * Math.sin(ph * 6 + time * 3.2) * w * w; y = -w * H + hem; }
        pos[o++] = Math.sin(ph) * r; pos[o++] = y; pos[o++] = Math.cos(ph) * r;
      }
    }
  };
  build(0);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NS; i++) { const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 2, d = a + NS + 1; idx.push(a, d, b, b, d, c); }
  g.setAttribute('position', pos, 3, true);
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.boundingSphere.radius *= 1.15;
  g.rebuild = (time) => { build(time); g.markDirty('position'); }; // normals stay from the rest shape (ripple is small)
  return g;
}
T_('ghost', {
  height: 1.0, radius: 0.42, centerY: 0, bodyY: 0, flying: true,
  build(E) {
    E.ghostGeo = ghostGeo();
    const gm = new Material({ color: 0xd2cbea, spec: 0.3, rim: 0.75, transparent: true, opacity: 0.8, depthWrite: false });
    E.tints.push(gm);
    E.ghostMesh = add(E.body, E.ghostGeo, gm, { p: [0, 0.05, 0] });
    E.ghostMesh.renderOrder = -1;
    const head = grp(E.body, 'head', [0, 0.05, 0]);
    faceKit(E, head, { R: 0.386, yaw: 22, pitch: 10, size: 0.76, mouthPitch: -8, mouthR: 0.39, glint: 0xe3dbff });
    // floaty translucent nub arms
    const am = M(0xd9d3f0, { transparent: true, opacity: 0.78, depthWrite: false, rim: 0.7 });
    addArms(E, { x: 0.4, y: -0.08, z: 0.04, r: 0.075, mat: am, rest: -0.4 });
    addFogBits(E, { top: [0, 0.415, -0.03], clip: { p: onSphere(0.37, -38, 50).map((v, i) => v + [0, 0.05, 0][i]), r: faceRot(-38, 50) }, bubble: [0.1, 0.0, 0.39], starsR: 0.28 });
  },
  gait(E, S, g) {
    const k = E.k;
    g.y += Math.sin(S.T * 1.7) * 0.06 * k;
    g.roll += Math.sin(S.T * 1.1) * 0.07;
    if (S.gait) { g.lean += S.gait === 2 ? 0.3 : 0.16; }
    if (S.anim === 'attack') { const a = S.attackA || 0; g.lean = 0.25 * a; g.z = 0.3 * a; g.sy = 1 + 0.2 * a; S.mouth = 'wide'; }
    if (S.anim === 'sleep') g.y -= 0.05;
  },
  post(E, S) {
    E.ghostGeo.rebuild(S.T * (S.gait === 2 ? 1.8 : 1));
    for (const a of E.arms) a.node.position.y = -0.08 + Math.sin(S.T * 2.2 + a.sd) * 0.025;
  },
});

// ---- big 왕먹구름: big tough gloomy with a tuft crown (3 HP)
T_('big', {
  height: 1.8, radius: 0.85, centerY: 0.84, bodyY: 0.84, attackDur: 0.65,
  build(E) {
    const R = 0.66;
    add(E.body, () => merged('bigBody', cloudParts(R)), E.tintMat(0xffffff, { vertexColors: true }));
    faceKit(E, E.body, { R, yaw: 20, pitch: 5, size: 1.45, browTilt: 0.5, browLen: 1.25, mouthSize: 1.4 });
    addFeet(E, { x: 0.26, s: [0.16, 0.1, 0.2], h: 0.085 });
    addArms(E, { x: R * 0.98, y: -R * 0.22, z: 0.1, r: 0.13 });
    // tuft crown: ring of dark fog tufts with dull-gold beads
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const pts = curve((u) => [Math.sin(a) * (0.13 + 0.06 * u), 0.2 * u, Math.cos(a) * (0.13 + 0.06 * u) - 0.0], 8);
      parts.push({ g: () => cg('bigTuft' + i, () => tubeGeo(pts, (u) => lerp(0.075, 0.02, u), 8, 2)), c: FOG.deep });
      parts.push({ p: [Math.sin(a) * 0.19, 0.215, Math.cos(a) * 0.19], s: 0.036, c: 0xd8c37a });
    }
    parts.push({ g: UNIT.torus, r: [PI / 2, 0, 0], p: [0, 0.03, 0], s: [0.17, 0.17, 0.25], c: 0xc9b26a });
    E.crown = add(E.body, () => merged('bigCrown', parts), MG(0xffffff, { vertexColors: true, spec: 0.35 }), { p: [0, R * 1.12, -0.06] });
    addFogBits(E, { top: [0.0, R * 1.12 + 0.06, -0.06], swirlS: 1.25, hat: { p: [0, R * 1.12, -0.06] }, clip: { p: onSphere(R * 1.02, -36, 46), r: faceRot(-36, 46) }, bubble: [0.2, -0.12, R * 0.95], bubbleR: 0.15, starsR: 0.5, starsY: 0.35 });
  },
  hatS: 1.7, clipS: 1.8,
  hook(E, S, g) {
    if (S.anim === 'attack') { const u = S.attackU; g.y = u < 0.35 ? Math.sin((u / 0.35) * PI) * 0.25 : 0; g.sy = u < 0.35 ? 1.1 : u < 0.5 ? 0.75 : 1; g.lean = 0.12; g.arm = 1.8; }
    if (S.gait) { g.roll *= 0.6; }
  },
  post(E, S) { E.crown.rotation.z = Math.sin(S.T * 1.7) * 0.04; },
});

// ---- charger 뿔먹구름: blob with two little horns; paws the ground, then charges
T_('charger', {
  height: 1.0, radius: 0.44, centerY: 0.44, bodyY: 0.44,
  build(E) {
    const R = 0.34;
    const horn = (sd) => () => cg('horn' + sd, () => tubeGeo(curve((u) => [sd * (0.0 + 0.1 * u + 0.03 * Math.sin(u * PI)), 0.12 * Math.sin(u * 1.3), 0.06 * u * u], 10), (u) => lerp(0.05, 0.012, Math.pow(u, 0.9)), 9, 3));
    add(E.body, () => merged('chargerBody', [
      ...cloudParts(R).slice(0, 12),
      ...[-1, 1].map((sd) => ({ g: horn(sd), p: [sd * R * 0.45, R * 0.82, R * 0.32], c: 0xf1e3c4 })),
      { p: [0, -R * 0.12, R * 0.9], s: [0.12, 0.085, 0.07], c: 0xb2a9cf },
      ...[-1, 1].map((sd) => ({ p: [sd * 0.04, -R * 0.11, R * 0.9 + 0.062], s: [0.018, 0.024, 0.01], c: FOG.deep })),
    ]), E.tintMat(0xffffff, { vertexColors: true }));
    faceKit(E, E.body, { R, yaw: 22, pitch: 12, size: 0.76, mouthPitch: -26, browTilt: 0.5 });
    addFeet(E, { x: 0.13, s: [0.09, 0.06, 0.11] });
    addArms(E, { x: R * 0.98, y: -R * 0.2, z: 0.06, r: 0.07 });
    // steam puffs from the snout (windup)
    E.steam = add(E.body, () => merged('steam3', [-1, 1].map((sd) => ({ p: [sd * 1.0, 0, 0], s: 0.42 }))), M(0xf4f2fb, { transparent: true, opacity: 0.85, depthWrite: false, rim: 0.6 }), { p: [0, -R * 0.15, R * 1.05] });
    E.steam.userData.op = 0; E.fx.push(E.steam);
    addFogBits(E, { top: [0, R * 1.18, -0.05], clip: { p: onSphere(R * 1.02, -46, 36), r: faceRot(-46, 36) }, bubble: [0.12, -0.02, R * 0.98], starsR: 0.3 });
  },
  hook(E, S, g) {
    if (S.anim === 'windup') { S.feet = 'paw'; g.lean = 0.16; g.sy = 0.9; S.shake = 0.008 * E.k; }
    if (S.anim === 'run') { g.lean += 0.15; S.mouth = 'flat'; }
  },
  post(E, S) {
    const on = S.anim === 'windup' || S.anim === 'run';
    const u = (S.T * 2.2) % 1;
    E.steam.userData.op = on ? (1 - u) * 0.9 : 0;
    const k = 0.085 + u * 0.09; // the two puffs grow and drift apart as they rise
    E.steam.scale.set(k, k, k);
    E.steam.position.set(0, -0.06 + u * 0.05, 0.36 + u * 0.08);
  },
});

// ---- jelly 해파리: pastel-grey jellyfish with dangling tentacles, pulsing (flying)
function jellyBellGeo() {
  return cg('jellyBell', () => {
    const prof = [];
    for (let i = 0; i <= 12; i++) { const th = (i / 12) * (PI / 2); prof.push([Math.sin(th) * 0.33, Math.cos(th) * 0.3]); }
    prof.reverse(); // bottom -> top
    const inner = [[0.0, 0.02], [0.24, 0.0], [0.3, -0.04]];
    const g = G.latheGeo([...inner, [0.335, -0.035], ...prof.slice(1)], 36);
    const lo = rgb(0xb3a9d4), hi = rgb(0xdcd5f2);
    g.colorBy((x, y) => { const t = clamp((y + 0.04) / 0.34, 0, 1); return [lerp(lo[0], hi[0], t), lerp(lo[1], hi[1], t), lerp(lo[2], hi[2], t)]; });
    return g;
  });
}
function jellyTentacles(n = 6, L = 0.48) {
  // per-instance dynamic tubes; rebuild(time, pulse)
  const RS = 6, NSEG = 12;
  const roots = Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU + 0.3; const rr = i % 2 ? 0.2 : 0.13; return [Math.sin(a) * rr, -0.03, Math.cos(a) * rr, a]; });
  const vcount = n * (NSEG + 1) * (RS + 1);
  const pos = new Float32Array(vcount * 3), nrm = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3), idx = [];
  const ca = rgb(0xbdb4dc), cb = rgb(0xe6e1f6);
  for (let t = 0; t < n; t++) {
    const base = t * (NSEG + 1) * (RS + 1);
    for (let i = 0; i < NSEG; i++) for (let j = 0; j < RS; j++) { const a = base + i * (RS + 1) + j, b = a + 1, c = a + RS + 2, d = a + RS + 1; idx.push(a, b, c, a, c, d); }
    for (let i = 0; i <= NSEG; i++) for (let j = 0; j <= RS; j++) { const o = (base + i * (RS + 1) + j) * 3; const u = i / NSEG; col[o] = lerp(ca[0], cb[0], u); col[o + 1] = lerp(ca[1], cb[1], u); col[o + 2] = lerp(ca[2], cb[2], u); }
  }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3, true); g.setAttribute('normal', nrm, 3, true); g.setAttribute('color', col, 3);
  g.setIndex(idx);
  g.rebuild = (time, pulse) => {
    for (let t = 0; t < n; t++) {
      const [rx, ry, rz, a] = roots[t];
      const len = L * (t % 2 ? 1 : 0.82);
      const base = t * (NSEG + 1) * (RS + 1);
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let i = 0; i <= NSEG; i++) {
        const u = i / NSEG;
        const w = Math.sin(time * 3 + u * 5 + t * 1.3) * 0.05 * u + Math.sin(time * 1.7 + t) * 0.02 * u;
        const out = (0.04 + pulse * 0.06) * u * (1 - u * 0.5);
        const cx = rx + dx * out + Math.cos(a) * w, cy = ry - u * len * (1 - pulse * 0.12), cz = rz + dz * out - Math.sin(a) * w;
        const r = lerp(0.022, 0.006, u);
        for (let j = 0; j <= RS; j++) {
          const ang = (j / RS) * TAU, s = Math.sin(ang), c = Math.cos(ang);
          const o = (base + i * (RS + 1) + j) * 3;
          pos[o] = cx + s * r; pos[o + 1] = cy; pos[o + 2] = cz + c * r;
          nrm[o] = s; nrm[o + 1] = 0; nrm[o + 2] = c;
        }
      }
    }
    g.markDirty('position'); g.markDirty('normal');
  };
  g.rebuild(0, 0);
  g.computeBoundingSphere();
  g.boundingSphere.radius *= 1.3;
  return g;
}
T_('jelly', {
  height: 0.9, radius: 0.36, centerY: 0, bodyY: 0.08, flying: true,
  build(E) {
    E.bell = grp(E.body, 'bell');
    const bm = new Material({ color: 0xffffff, vertexColors: true, spec: 0.5, rim: 0.75, transparent: true, opacity: 0.88, depthWrite: true });
    E.tints.push(bm);
    add(E.bell, jellyBellGeo, bm);
    // frilly rim
    add(E.bell, () => merged('jellyFrill', Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * TAU; return { p: [Math.sin(a) * 0.32, -0.04, Math.cos(a) * 0.32], s: [0.05, 0.03, 0.05], c: 0xc4bbe0 }; })), VC());
    E.tent = jellyTentacles();
    add(E.body, E.tent, M(0xffffff, { vertexColors: true, spec: 0.3, rim: 0.6 }));
    const head = grp(E.bell, 'head', [0, 0, 0]);
    faceKit(E, head, { R: 0.328, yaw: 22, pitch: 22, size: 0.66, mouthPitch: 6, mouthR: 0.332, cheekPitch: 10, glint: 0xe8e0ff });
    E.muzzle = grp(E.body, 'muzzle', [0, -0.12, 0.05]);
    addFogBits(E, { top: [0, 0.29, -0.02], swirlS: 0.85, clip: { p: onSphere(0.31, -44, 46), r: faceRot(-44, 46) }, bubble: [0.08, 0.06, 0.31], starsR: 0.26 });
    E.bell.add(E.swirlHolder); E.bell.add(E.hatNode); E.bell.add(E.clipNode);
  },
  hatS: 0.85, clipS: 0.85,
  gait(E, S, g) {
    const k = E.k;
    const rate = S.anim === 'run' ? 2.2 : S.anim === 'sleep' ? 0.6 : S.anim === 'windup' ? 3 : 1.3;
    E.pulsePh = (E.pulsePh || 0) + S.dt * rate * TAU;
    const p = Math.max(0, Math.sin(E.pulsePh));
    E.pulse = p;
    g.y += Math.sin(E.pulsePh - 1.2) * 0.05 * k;
    if (S.gait) g.lean += 0.12;
    if (S.anim === 'attack') { const a = S.attackA || 0; g.sy = 1 + 0.25 * a; g.y += 0.06 * a; }
  },
  post(E, S) {
    const p = E.pulse || 0;
    E.bell.scale.set(1 + 0.08 * p, 1 - 0.12 * p, 1 + 0.08 * p);
    E.tent.rebuild(S.T, p);
  },
});

// ---- mushroom 꼬마버섯: small grumpy mushroom minion
T_('mushroom', {
  height: 0.62, radius: 0.28, centerY: 0.3, bodyY: 0, headgear: true,
  build(E) {
    const capGeo = () => cg('mushCap', () => {
      const prof = [[0, 0.0], [0.18, 0.0], [0.255, 0.012], [0.275, 0.045], [0.265, 0.1], [0.22, 0.165], [0.14, 0.215], [0.0, 0.24]];
      const g = G.latheGeo(prof, 30);
      return g;
    });
    const spots = [[0, 72, 0.05], [50, 35, 0.04], [-55, 38, 0.042], [150, 40, 0.045], [-140, 45, 0.04], [95, 15, 0.03], [-95, 18, 0.03], [10, 30, 0.032]];
    add(E.body, () => merged('mushroom', [
      { g: UNIT.sphereHi, p: [0, 0.19, 0], s: [0.185, 0.18, 0.175], c: 0xe0d8ea },
      { g: capGeo, p: [0, 0.33, -0.01], c: 0xa98aab },
      { g: UNIT.disc, p: [0, 0.33, -0.01], r: [PI, 0, 0], s: 0.255, c: 0xc9bfd8 },
      ...spots.map(([yaw, pitch, r]) => { const d = onSphere(1, yaw, pitch); return { p: [d[0] * 0.25, 0.33 + 0.03 + d[1] * 0.19, d[2] * 0.25 - 0.01], r: faceRot(yaw, pitch), s: [r, r, 0.012], c: 0xece5f4 }; }),
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.22 }));
    const head = grp(E.body, 'head', [0, 0.19, 0]);
    faceKit(E, head, { R: 0.176, yaw: 24, pitch: -4, size: 0.47, mouthPitch: -30, browLen: 0.9, cheekYaw: 46, cheekPitch: -16 });
    addFeet(E, { x: 0.075, s: [0.055, 0.035, 0.065], h: 0.03 });
    addArms(E, { x: 0.165, y: 0.0, z: 0.02, r: 0.042, c: 0xd2c9df });
    E.muzzle = grp(E.body, 'muzzle', [0, 0.6, 0]);
    addFogBits(E, { top: [0.05, 0.555, -0.05], swirlS: 0.55, clip: { p: [-0.16, 0.5, 0.11], r: [-0.4, -0.7, 0.5] }, bubble: [0.05, 0.12, 0.17], bubbleR: 0.045, starsR: 0.2, starsY: 0.1 });
  },
  clipS: 0.6,
  hook(E, S, g) { if (S.anim === 'attack') { const a = S.attackA || 0; g.sy = 1 - 0.25 * a; g.lean = 0.05; } },
});

// ---- pumpkinling 꼬마호박: little pumpkin with leaf, glowing carved angry face
T_('pumpkinling', {
  height: 0.6, radius: 0.32, centerY: 0.27, bodyY: 0.26, headgear: true,
  build(E) {
    const geo = () => cg('pumpkin', () => {
      const g = G.sphereGeo(1, 40, 24);
      g.displace((v) => { const a = Math.atan2(v.x, v.z); const rib = 1 - 0.09 * Math.pow(Math.abs(Math.sin(a * 4)), 0.7); v.x *= rib; v.z *= rib; v.y *= 0.82 + 0.0 * rib; if (v.y > 0.7) v.y -= (v.y - 0.7) * 0.6; });
      g.computeVertexNormals();
      const a = rgb(0xd29872), b = rgb(0xb07c63);
      g.colorBy((x, y, z) => { const ang = Math.atan2(x, z); const t = Math.pow(Math.abs(Math.sin(ang * 4)), 0.5); return [lerp(a[0], b[0], 1 - t), lerp(a[1], b[1], 1 - t), lerp(a[2], b[2], 1 - t)]; });
      g.computeBoundingSphere();
      return g;
    });
    add(E.body, () => merged('pumpkinling', [
      { g: geo, s: [0.27, 0.27, 0.26] },
      { g: () => cg('pkStem', () => tubeGeo(curve((u) => [0.015 * u, 0.09 * u, -0.025 * u * u], 6), (u) => lerp(0.035, 0.025, u), 8, 2)), p: [0, 0.17, 0], c: 0x6f7a4f },
      { g: leafGeo, p: [0.07, 0.205, 0.02], r: [-1.1, 0.6, -0.3], s: [0.12, 0.16, 0.12], c: 0x8a9a74 },
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.25 }));
    const head = grp(E.body, 'head', [0, 0.0, 0]);
    faceKit(E, head, { R: 0.255, yaw: 23, pitch: 10, size: 0.6, mouthPitch: -20, glint: 0xfff4c0, eyeColor: 0xffb340 });
    // carved look: the eye shapes glow like candle-lit holes
    const glow = MU(0xffc54d);
    for (const eye of E.eyes.eyes) for (const grpN of [eye.open, eye.happy, eye.hurt, eye.sleep]) for (const c of grpN.children) if (c.material && c.material.color[0] > 0.9 && c.material.color[1] < 0.8) c.material = glow;
    // carved zigzag grin replaces the plain mouth
    const zig = [];
    for (let i = 0; i <= 8; i++) zig.push([-0.07 + i * 0.0175, i % 2 ? 0.006 : -0.004]);
    const grin = cg('grin', () => { const o = [...zig, [0.07, -0.006], [0.05, -0.03], [0.0, -0.04], [-0.05, -0.03], [-0.07, -0.006]]; return G.puffyShapeGeo(o, 0.008, 2, 0.6); });
    E.grin = add(E.mouthNode, grin, glow, { p: [0, -0.004, 0.0], s: [1, 1, 1] });
    E.mouthSetBase = E.mouth.set;
    const baseSet = E.mouth.set;
    E.mouth = { set(sh) { const carved = sh === 'frown' || sh === 'flat' || sh === 'open'; E.grin.visible = carved; E.grin.scale.set(sh === 'open' ? 1.15 : 1, sh === 'open' ? 1.6 : sh === 'flat' ? 0.7 : 1, 1); baseSet(carved ? '' : sh); } };
    addFeet(E, { x: 0.09, s: [0.065, 0.04, 0.075], h: 0.03, c: 0x6f5a66 });
    E.muzzle = grp(E.mouthNode, 'muzzle', [0, 0, 0.04]);
    addFogBits(E, { top: [-0.08, 0.2, -0.04], swirlS: 0.6, clip: { p: [0.16, 0.16, 0.12], r: [-0.4, 0.7, -0.5] }, bubble: [0.06, -0.06, 0.24], bubbleR: 0.05, starsR: 0.22, starsY: 0.12 });
  },
  clipS: 0.65,
});

// ---- snowball 눈뭉치: snowball with a face and twig arms; rolls when running
T_('snowball', {
  height: 0.7, radius: 0.34, centerY: 0.31, bodyY: 0.31,
  build(E) {
    E.ball = grp(E.body, 'ball');
    const geo = () => cg('snowLump', () => {
      const g = G.sphereGeo(1, 34, 22);
      g.displace((v) => { const n = Math.sin(v.x * 7.1 + 1.3) * Math.sin(v.y * 6.3 + 0.4) * Math.sin(v.z * 6.7 + 2.1); v.scale(1 + 0.045 * n); });
      g.computeVertexNormals();
      const a = rgb(0xf1eff9), b = rgb(0xc9c3e0);
      g.colorBy((x, y) => { const t = clamp(0.5 - y * 0.6, 0, 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; });
      g.computeBoundingSphere();
      return g;
    });
    add(E.ball, () => merged('snowball', [
      { g: geo, s: 0.3 },
      { p: [0.17, 0.16, -0.12], s: 0.08, c: 0xeeebf7 }, { p: [-0.2, 0.08, -0.13], s: 0.07, c: 0xe2def0 }, { p: [0.05, -0.22, -0.16], s: 0.075, c: 0xdcd7ec },
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.35, rim: 0.5 }));
    const head = grp(E.ball, 'face', [0, 0.0, 0]);
    faceKit(E, head, { R: 0.3, yaw: 21, pitch: 12, size: 0.68, mouthPitch: -8, glint: 0x9ec8ff });
    // twig arms
    const twig = (sd) => () => cg('twig' + sd, () => { const g = tubeGeo(curve((u) => [sd * 0.16 * u, 0.05 * u + 0.03 * Math.sin(u * PI), 0.01 * u], 6), (u) => lerp(0.016, 0.009, u), 6, 2); return g; });
    for (const sd of [-1, 1]) {
      const node = grp(E.body, sd < 0 ? 'armL' : 'armR', [sd * 0.27, 0.0, 0.02]);
      add(node, () => merged('twigArm' + sd, [{ g: twig(sd) }, { g: () => cg('twigF' + sd, () => tubeGeo(curve((u) => [sd * (0.1 + 0.04 * u), 0.04 + 0.05 * u, 0.0], 4), 0.008, 5, 2)) }]), M(0x8a6a58));
      E.arms.push({ node, sd, rest: -0.3, k: 0.8 });
    }
    E.muzzle = grp(E.arms[1].node, 'muzzle', [0.17, 0.08, 0.02]);
    addFogBits(E, { top: [0, 0.3, -0.04], swirlS: 0.7, clip: { p: onSphere(0.3, -40, 45), r: faceRot(-40, 45) }, bubble: [0.08, 0.0, 0.29], bubbleR: 0.06, starsR: 0.24 });
    E.ball.add(E.swirlHolder); E.ball.add(E.hatNode); E.ball.add(E.clipNode);
  },
  hatS: 0.85, clipS: 0.85,
  gait(E, S, g) {
    if (S.gait === 2) { E.rollV = approach(E.rollV || 0, 8 + 6 * S.sp, 6, S.dt); g.lean += 0.06; g.y += Math.abs(Math.sin(S.T * 14)) * 0.015; S.mouth = 'open'; }
    else {
      E.rollV = approach(E.rollV || 0, 0, 5, S.dt);
      if (S.gait) { E.phase += S.dt * (5 + 3 * S.sp); g.y += Math.abs(Math.sin(E.phase)) * 0.04 * E.k; g.roll += Math.cos(E.phase) * 0.1; g.swing = Math.sin(E.phase) * 0.5; g.sy *= 1 - 0.04 * (1 - Math.abs(Math.sin(E.phase))); }
    }
  },
  post(E, S) {
    E.roll = (E.roll || 0) + S.dt * (E.rollV || 0);
    if ((E.rollV || 0) < 0.05) { const tgt = Math.round(E.roll / TAU) * TAU; E.roll = approach(E.roll, tgt, 6, S.dt); }
    E.ball.rotation.x = E.roll;
    const tuck = S.gait === 2 ? 1 : 0;
    E.tuck = approach(E.tuck || 0, tuck, 10, S.dt);
    for (const a of E.arms) { const s = 1 - E.tuck * 0.9; a.node.scale.set(s, s, s); a.node.visible = E.tuck < 0.95; }
  },
});

// ---- toysoldier 태엽병정: wind-up toy soldier (key turning on its back) with a cork gun
T_('toysoldier', {
  height: 1.0, radius: 0.3, centerY: 0.5, bodyY: 0.0, headgear: true, attackDur: 0.5,
  build(E) {
    const coat = 0x8d84b8, dark = 0x55507a, trim = 0xd6c48a, skin = 0xeee2ea, white = 0xf1eef8;
    const thin = () => cg('thinTorus3', () => G.torusGeo(1, 0.12, 8, 26));
    add(E.body, () => merged('soldier2', [
      // jacket (rounded) + belt + buttons + cross belts + epaulettes
      { g: UNIT.rbox, p: [0, 0.37, 0], s: [0.3, 0.26, 0.24], c: coat },
      { g: () => band(0, 0.5), p: [0, 0.245, 0], r: [PI, 0, 0], s: [0.152, 0.07, 0.122], c: coat },
      { g: UNIT.cylinder, p: [0, 0.262, 0], s: [0.153, 0.032, 0.123], c: white },
      { g: UNIT.rbox, p: [0, 0.262, 0.118], s: [0.05, 0.036, 0.012], c: trim },
      ...[0.4, 0.33].map((y) => ({ p: [0, y, 0.121], s: [0.018, 0.018, 0.008], c: trim })),
      ...[-1, 1].map((sd) => ({ g: UNIT.box, p: [sd * 0.035, 0.37, 0.121], r: [0, 0, sd * 0.6], s: [0.026, 0.3, 0.006], c: white })),
      ...[-1, 1].map((sd) => ({ p: [sd * 0.15, 0.48, 0.0], s: [0.06, 0.028, 0.075], c: trim })),
      // big chibi head + rosy nose
      { g: UNIT.sphereHi, p: [0, 0.66, 0.0], s: [0.2, 0.19, 0.19], c: skin },
      // shako hat with gold band, visor, cockade and pompom
      { g: UNIT.cylinder, p: [0, 0.885, -0.01], s: [0.15, 0.17, 0.14], c: dark },
      { g: UNIT.disc, p: [0, 0.971, -0.01], s: [0.15, 1, 0.14], c: 0x4a4570 },
      { g: UNIT.cylinder, p: [0, 0.815, -0.005], s: [0.156, 0.032, 0.146], c: trim },
      { g: () => band(0, 0.5), p: [0, 0.8, 0.07], r: [0.15, 0, 0], s: [0.13, 0.02, 0.1], c: 0x3f3a5e },
      { g: thin, p: [0, 0.89, 0.137], s: [0.028, 0.028, 0.04], c: trim },
      { p: [0, 0.89, 0.137], s: [0.022, 0.022, 0.01], c: 0xd98aa0 },
      { p: [0, 0.995, -0.01], s: 0.042, c: 0xd9a6b7 },
    ]), E.tintMat(0xffffff, { vertexColors: true, spec: 0.28, rim: 0.4 }));
    const head = grp(E.body, 'head', [0, 0.66, 0]);
    faceKit(E, head, { R: 0.19, yaw: 23, pitch: -2, size: 0.52, mouthPitch: -27, browLen: 0.95, cheekYaw: 45, cheekPitch: -12 });
    // legs (stiff toy march)
    const lm = MG(0xffffff, { vertexColors: true, spec: 0.35 });
    E.legs = [];
    for (const sd of [-1, 1]) {
      const node = grp(E.base, sd < 0 ? 'legL' : 'legR', [sd * 0.072, 0.245, 0]);
      add(node, () => merged('soldierLeg2', [
        { g: UNIT.cylinder, p: [0, -0.1, 0], s: [0.05, 0.17, 0.05], c: dark },
        { g: UNIT.rbox, p: [0, -0.2, 0.022], s: [0.085, 0.07, 0.13], c: 0x2f2b44 },
      ]), lm);
      E.legs.push({ node, sd });
    }
    // arms: left swings, right holds the cork pop-gun
    for (const sd of [-1, 1]) {
      const node = grp(E.body, sd < 0 ? 'armL' : 'armR', [sd * 0.175, 0.45, 0.0]);
      const parts = [{ g: UNIT.capsule, p: [0, -0.07, 0], s: [0.075, 0.085, 0.075], c: coat }, { p: [0, -0.15, 0.0], s: 0.038, c: white }];
      if (sd > 0) {
        parts.push({ g: UNIT.cylinder, p: [0, -0.15, 0.1], r: [PI / 2, 0, 0], s: [0.026, 0.17, 0.026], c: 0x9a7a66 });
        parts.push({ g: UNIT.rbox, p: [0, -0.18, 0.015], s: [0.04, 0.075, 0.065], c: 0x7a5a48 });
        parts.push({ g: UNIT.cylinder, p: [0, -0.15, 0.19], r: [PI / 2, 0, 0], s: [0.034, 0.03, 0.034], c: 0xa9adc0 });
      }
      add(node, () => merged('soldierArm2' + sd, parts), E.tintMat(0xffffff, { vertexColors: true, spec: 0.3 }));
      E.arms.push({ node, sd, rest: 0.08, k: 0.2, swingK: sd > 0 ? 0 : 1 });
      if (sd > 0) { E.gunArm = node; E.muzzle = grp(node, 'muzzle', [0, -0.15, 0.23]); E.cork = add(node, UNIT.cylinder, M(0xd9a86c), { p: [0, -0.15, 0.215], r: [PI / 2, 0, 0], s: [0.025, 0.04, 0.025] }); }
    }
    // wind-up key on the back
    E.key = grp(E.body, 'key', [0, 0.38, -0.12]);
    add(E.key, () => merged('windKey3', [
      { g: UNIT.cylinder, r: [PI / 2, 0, 0], p: [0, 0, -0.05], s: [0.026, 0.1, 0.026] },
      ...[-1, 1].map((sd) => ({ g: thin, p: [sd * 0.075, 0, -0.11], r: [0, PI / 2, 0], s: [0.068, 0.062, 0.2] })),
      { p: [0, 0, -0.11], s: [0.034, 0.034, 0.034] },
    ]), MG(0xe0c878, { spec: 0.65 }));
    addFogBits(E, { top: [0.07, 0.975, -0.04], swirlS: 0.6, clip: { p: [-0.13, 0.86, 0.09], r: [-0.3, -0.5, 0.4] }, bubble: [0.05, 0.6, 0.19], bubbleR: 0.05, starsR: 0.22, starsY: 0.05 });
  },
  clipS: 0.62,
  gait(E, S, g) {
    // stiff toy march: legs swing from the hips, body ticks side to side
    if (S.gait) {
      const f = S.gait === 2 ? 9 + 4 * S.sp : 5.5 + 3 * S.sp;
      E.phase += S.dt * f;
      g.y += Math.abs(Math.sin(E.phase)) * 0.025 * E.k;
      g.roll += Math.cos(E.phase) * 0.06;
      g.lean += S.gait === 2 ? 0.12 : 0.03;
      g.swing = Math.sin(E.phase) * 0.7;
      S.march = Math.sin(E.phase) * (S.gait === 2 ? 0.6 : 0.45);
    }
    if (S.anim === 'friendly') S.march = Math.sin(S.T * 6) * 0.35;
    S.feet = 'none';
  },
  hook(E, S, g) { g.arm = S.anim === 'friendly' ? 1.2 : S.anim === 'hurt' ? 0.8 : 0.0; },
  post(E, S) {
    const m = S.march || 0;
    for (const l of E.legs) l.node.rotation.x = approach(l.node.rotation.x, l.sd * m, 20, S.dt);
    // aim the gun forward; recoil when shooting
    let aim = -1.45, rec = 0;
    if (S.anim === 'attack') { const u = S.attackU; rec = u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 0.4); }
    if (S.anim === 'windup') aim = -1.5 + Math.sin(S.T * 22) * 0.04;
    if (S.anim === 'sleep' || S.anim === 'stun' || S.anim === 'hurt') aim = -0.3;
    if (S.anim === 'friendly') aim = -2.6 + Math.sin(S.T * 6) * 0.3;
    E.gunArm.rotation.x = approach(E.gunArm.rotation.x, aim + rec * 0.45, 25, S.dt);
    E.cork.visible = !(S.anim === 'attack' && S.attackU > 0.1 && S.attackU < 0.85);
    const wind = S.anim === 'run' ? 10 : S.anim === 'walk' ? 6 : S.anim === 'sleep' ? 0.6 : S.anim === 'die' ? 0 : 2.4;
    E.key.rotation.z += S.dt * wind;
  },
});

// ------------------------------------------------------------------ public
export const ENEMY_TYPES = Object.keys(TYPES);
export const ENEMY_VARIANTS = Object.keys(ACC);

export function buildEnemy(type, variant) {
  const D = TYPES[type] || TYPES.gloomy;
  const t = TYPES[type] ? type : 'gloomy';
  const E = new EnemyRig(t, D, variant);
  D.build(E);
  if (E.variant) buildAccessory(E, E.variant);
  E.update(1 / 60, { anim: 'idle', t: 0 });
  const api = {
    root: E.root,
    update: (dt, st) => E.update(dt, st),
    setFlash: (v) => E.setFlash(v),
    setOpacity: (v) => E.setOpacity(v),
    height: D.height, radius: D.radius, centerY: D.centerY, flying: !!D.flying,
    type: t, variant: E.variant,
    rig: E,
  };
  if (E.muzzle) api.muzzle = E.muzzle;
  if (E.bomb) api.bomb = E.bomb;
  return api;
}

// round cloud-bomb with fuse + fizzing spark. Node with .update(dt)
export function buildBomb() {
  const root = new Node('bomb');
  add(root, () => merged('bomb', [
    { g: UNIT.sphereHi, s: 0.17, c: 0x51486f },
    ...[[20, 44], [110, 38], [200, 46], [290, 36]].map(([yaw, pitch]) => ({ p: onSphere(0.142, yaw, pitch), s: 0.06, c: 0x655b88 })),
    { g: () => band(0.47, 0.53), s: 0.172, c: 0x8a80ad },
    { p: onSphere(0.15, -35, 35), r: faceRot(-35, 35), s: [0.04, 0.026, 0.012], c: 0xd7d0ee },
    { g: UNIT.cylinder, p: [0, 0.175, 0], s: [0.055, 0.05, 0.055], c: 0x8e88a6 },
    { g: UNIT.torus, p: [0, 0.19, 0], r: [PI / 2, 0, 0], s: [0.058, 0.058, 0.1], c: 0xa9a3c2 },
    { g: () => cg('fuse', () => tubeGeo(curve((u) => [0.03 * Math.sin(u * 2.5), 0.07 * u, -0.02 * u], 8), 0.011, 6, 2)), p: [0, 0.2, 0], c: 0x8a6a58 },
  ]), MG(0xffffff, { vertexColors: true, spec: 0.45, rim: 0.45 }));
  const spark = add(root, () => cg('sparkStar', () => G.puffyShapeGeo(G.starOutline(6, 0.5, 0.2, 2), 0.08, 2, 0.6)), MU(0xffe066), { p: [0.018, 0.275, -0.02], s: 0.09 });
  let T = Math.random() * 5;
  root.update = (dt) => {
    T += dt;
    const f = 0.7 + 0.3 * Math.sin(T * 40) * Math.sin(T * 23);
    spark.scale.set(0.075 * f + 0.03, 0.075 * f + 0.03, 0.06);
    spark.rotation.z = T * 9;
  };
  root.userData.spark = spark;
  return root;
}

// projectiles (+Z = travel direction). Each Node has .update(dt) for spin/pulse.
export function buildProjectile(kind) {
  const root = new Node('proj-' + kind);
  let T = Math.random() * 5;
  let upd = null;
  switch (kind) {
    case 'seed': {
      const tear = () => cg('seedTear', () => {
        const o = []; for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; const c = Math.cos(a), sn = Math.sin(a); o.push([0.5 * sn * (0.62 - 0.3 * c), 0.62 * c]); }
        const g = G.puffyShapeGeo(o, 0.22, 4, 0.55);
        const a = rgb(0xf6ead0), b = rgb(0xd9bd86);
        g.colorBy((x, y) => { const r = Math.hypot(x / 0.3, y / 0.62); return r > 0.8 ? b : a; });
        return g;
      });
      const m = add(root, () => merged('projSeed3', [{ g: tear, r: [PI / 2, 0, 0], s: [0.18, 0.2, 0.13] }]), VC());
      upd = (dt) => { m.rotation.z += dt * 12; };
      break;
    }
    case 'cork': {
      add(root, () => merged('projCork', [
        { g: () => cg('corkBody', () => G.cylinderGeo(0.05, 0.062, 0.11, 18, 1, true)), r: [-PI / 2, 0, 0], c: 0xd9a86c },
        { g: UNIT.disc, p: [0, 0, 0.0555], r: [PI / 2, 0, 0], s: 0.05, c: 0xc28f55 },
        ...[[20, 0.2], [140, -0.3], [250, 0.1]].map(([a, z]) => ({ p: [Math.sin(a * DEG) * 0.056, Math.cos(a * DEG) * 0.056, z * 0.05], s: 0.008, c: 0xa87545 })),
      ]), VC());
      upd = (dt) => { root.children[0].rotation.z += dt * 8; };
      break;
    }
    case 'snowball': {
      const m = add(root, () => cg('projSnow', () => {
        const g = G.sphereGeo(0.13, 20, 14);
        g.displace((v) => { const n = Math.sin(v.x * 60) * Math.sin(v.y * 55 + 1) * Math.sin(v.z * 58 + 2); v.scale(1 + 0.06 * n); });
        g.computeVertexNormals();
        const a = rgb(0xffffff), b = rgb(0xc9d6f2);
        g.colorBy((x, y) => { const t = clamp(0.5 - y / 0.26, 0, 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; });
        g.computeBoundingSphere();
        return g;
      }), M(0xffffff, { vertexColors: true, spec: 0.3, rim: 0.55 }));
      upd = (dt) => { m.rotation.x += dt * 9; };
      break;
    }
    case 'ink': {
      add(root, () => merged('projInk', [
        { s: [0.11, 0.1, 0.11], c: 0x3e3560 },
        { g: UNIT.cone, p: [0, 0, -0.12], r: [-PI / 2, 0, 0], s: [0.085, 0.16, 0.08], c: 0x3e3560 },
        { p: onSphere(0.095, -30, 35), r: faceRot(-30, 35), s: [0.03, 0.02, 0.01], c: 0xb9b0e0 },
      ]), MG(0xffffff, { vertexColors: true, spec: 0.7, rim: 0.4 }));
      upd = () => { const s = 1 + Math.sin(T * 18) * 0.06; root.children[0].scale.set(1 / s, 1 / s, s); };
      break;
    }
    case 'spore': {
      const m = add(root, () => merged('projSpore', [
        { g: UNIT.sphereHi, s: 0.09, c: 0xc8b7e2 },
        ...Array.from({ length: 10 }, (_, i) => { const y = 1 - (i + 0.5) / 10 * 2, r = Math.sqrt(1 - y * y), a = i * 2.4; return { p: [Math.sin(a) * r * 0.09, y * 0.09, Math.cos(a) * r * 0.09], s: 0.024, c: 0xe2d6f4 }; }),
      ]), M(0xffffff, { vertexColors: true, spec: 0.2, rim: 0.6 }));
      const h = add(root, () => invSphereGeo('invSphere'), glowMat(0xb79cf0), { s: 0.13 });
      h.opacity = 0.55;
      upd = (dt) => { m.rotation.y += dt * 3; m.rotation.x += dt * 2; const s = 0.125 + 0.02 * Math.sin(T * 7); h.scale.set(s, s, s); };
      break;
    }
    default: { // fogball
      const m = add(root, () => merged('projFog', [
        { g: UNIT.sphereHi, s: 0.15, c: 0x7a7398 },
        { g: () => cg('fogballSwirl', () => tubeGeo(curve((u) => { const a = u * PI * 2.6; const r = 0.152; const y = lerp(-0.1, 0.12, u); const rr = Math.sqrt(Math.max(0, r * r - y * y)) + 0.004; return [Math.sin(a) * rr, y, Math.cos(a) * rr]; }, 40), 0.016, 6, 2)), c: 0xa99ccc },
        { p: onSphere(0.13, -30, 38), r: faceRot(-30, 38), s: [0.04, 0.026, 0.012], c: 0xe0d8f6 },
      ]), MG(0xffffff, { vertexColors: true, spec: 0.4, rim: 0.6 }));
      const h = add(root, () => invSphereGeo('invSphere'), glowMat(0x9a90c4), { s: 0.21 });
      h.opacity = 0.6;
      upd = (dt) => { m.rotation.y += dt * 6; m.rotation.z += dt * 2.5; const s = 0.2 + 0.025 * Math.sin(T * 9); h.scale.set(s, s, s); };
    }
  }
  root.update = (dt) => { T += dt; if (upd) upd(dt); };
  root.userData.kind = kind;
  return root;
}

// ============================================================================
// models/pets.js — 15 flying companion pets for Somi.
// Style: Kirby-like chibi critters — round glossy bodies, tall-oval eyes from
// makeEyes, pink blush, chunky readable silhouettes. Every pet is a small
// procedural rig:
//   root  (origin = body centre, faces +Z)
//    └ motion (hover bob, happy loop-the-loop, banking)
//       └ body (lean, squash & stretch) -> body mesh, face, wings, tail, extras
//
// export buildPet(id) -> { root, update(dt, st), setFlash(v), setOpacity(v), size, glow:[r,g,b] }
//   st = { anim: 'fly'|'idle'|'happy'|'ability'|'sleep'|'sad', t (s since anim start), speed (0..1) }
//   - wings flap procedurally (fast: bee/hummingbird/dragonfly, slow: butterfly/owl)
//   - happy   : loop-the-loop + happy eyes
//   - ability : emissive glow pulse + halo + wings held wide
//   - sleep   : eyes closed, wings folded, slow breathing (pet box UI)
//   - sad     : sad eyes, droopy wings, low hover
// Extra fields: id, name (Korean), head (Node carrying the face), wings (pivot Nodes), rig (PetRig).
// Also exported: PET_IDS (15 ids), PET_NAMES ({ id: '붕붕이', ... }).
// size = approx. body width across in metres (0.28-0.42); glow = signature colour (floats 0..1) for gameplay fx.
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import { rgb, Ease } from '../../engine/math.js';
import {
  G, UNIT, M, MG, MU, SOFT, add, grp, ell, onSphere, faceRot, makeEyes, makeCheeks, Spring, approach, PI, TAU, lerp, clamp,
} from './common.js';

// ------------------------------------------------------------------ kit
const own = (color, opts = {}) => new Material({ color, ...SOFT, ...opts }); // per-instance (emissive pulse)
const VC = () => M(0xffffff, { vertexColors: true });
const VCU = () => MU(0xffffff, { vertexColors: true });
const GLASS = (c = 0xeef8ff, op = 0.5) => M(c, { spec: 0.55, rim: 0.95, transparent: true, opacity: op, depthWrite: false });
// fresnel glow ball: bright core fading to nothing at the silhouette (negative rim), additive
const glowMat = (c) => M(0x000000, { emissive: c, rim: -2.4, spec: 0, transparent: true, blending: 'additive', depthWrite: false, fog: false });
const cg = (key, fn) => G.cachedGeo('pet:' + key, fn);
// inside-out sphere: only its far hemisphere renders, with normals facing the viewer -> a fresnel glow that
// sits *behind* the character (occluded by it), never washing over the face
const invSphereGeo = (key) => G.cachedGeo(key, () => {
  const g = G.sphereGeo(1, 28, 20);
  const n = g.attributes.normal.array; for (let i = 0; i < n.length; i++) n[i] = -n[i];
  const ix = g.index; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return g;
});

const hex = (c) => (Array.isArray(c) ? c : rgb(c));

// merge [{ g, p, r, s, c }] into one cached vertex-coloured geometry
function merged(key, parts) {
  return cg(key, () => G.mergeGeometries(parts.map((q) => {
    const s = q.s === undefined ? [1, 1, 1] : Array.isArray(q.s) ? q.s : [q.s, q.s, q.s];
    const p = q.p || [0, 0, 0], r = q.r || [0, 0, 0];
    const geo = q.g ? (typeof q.g === 'function' ? q.g() : q.g) : UNIT.sphere();
    return { geo, matrix: G.trs(p[0], p[1], p[2], r[0], r[1], r[2], s[0], s[1], s[2]), color: hex(q.c ?? 0xffffff) };
  })));
}

// sphere slice between polar fractions a..b (pole = +Y); used for crisp colour bands
const band = (a, b, ws = 22) => cg(`band:${a}:${b}:${ws}`, () => G.sphereGeo(1, ws, Math.max(2, Math.round((b - a) * 18)), 0, TAU, a * PI, (b - a) * PI));

// tube along a polyline, radius number | (u)=>r, rounded caps
function tubeGeo(pts, r, rs = 8, cap = 3) {
  const rf = typeof r === 'function' ? r : () => r;
  const n = pts.length;
  const nz = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(nz([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  }
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
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < rs; j++) {
    const a = i * (rs + 1) + j, b = a + 1, c = a + rs + 2, d = a + rs + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nrm, 3); g.setIndex(idx);
  G.fixWinding(g); g.computeBoundingSphere();
  return g;
}
// sample a parametric curve f(u)->[x,y,z] into n points
const curve = (f, n = 14) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
function chaikin(pts, it = 3) {
  let p = pts;
  for (let k = 0; k < it; k++) {
    const o = [];
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    p = o;
  }
  return p;
}
// radius of ellipsoid (radii S, unit R) along a yaw/pitch direction -> put face parts exactly on the surface
function surfR(S, yaw, pitch) { const d = onSphere(1, yaw, pitch); return 1 / Math.hypot(d[0] / S[0], d[1] / S[1], d[2] / S[2]); }

// ------------------------------------------------------------------ shapes
function birdWingOutline() {
  const out = [];
  for (let i = 0; i < 54; i++) {
    const th = (i / 54) * TAU, c = Math.cos(th), s = Math.sin(th);
    let y = 0.21 * (1 - 0.32 * c) * s;
    if (s < 0) y -= 0.085 * Math.pow(Math.abs(Math.sin(3 * (th - PI))), 0.75) * Math.sqrt(-s); // 3 feather lobes
    out.push([0.5 * c, y]);
  }
  return out;
}
function insectWingOutline() {
  const out = [];
  for (let i = 0; i < 40; i++) { const th = (i / 40) * TAU, c = Math.cos(th), s = Math.sin(th); out.push([0.5 * c, 0.2 * (1 + 0.3 * c) * s]); }
  return out;
}
// unit wing: span along +x (root at 0, tip at 1), chord along z (front +z), thickness along y
function wingGeo(kind, key, colorFn) {
  return cg('wing:' + kind + ':' + (key || ''), () => {
    const g = G.puffyShapeGeo(kind === 'bird' ? birdWingOutline() : insectWingOutline(), kind === 'bird' ? 0.075 : 0.03, 4, 0.55);
    g.rotate(PI / 2, 0, 0);
    g.translate(0.5, 0, 0);
    if (colorFn) g.colorBy((x, y, z) => hex(colorFn(x, z)));
    g.computeBoundingSphere();
    return g;
  });
}
function butterflyWingGeo() {
  return cg('wing:butterfly2', () => {
    const pink = rgb(0xff9fd2), lav = rgb(0xb79cff), rim = rgb(0x8f74e6);
    const lobe = (ctrl, depth) => {
      const pts = chaikin(ctrl, 3);
      let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
      const g = G.puffyShapeGeo(pts.map((p) => [p[0] - cx, p[1] - cy]), depth, 5, 0.5);
      // distance of each outline point from the root, for the pink->lavender gradient + violet rim
      let maxD = 0; for (const p of pts) maxD = Math.max(maxD, Math.hypot(p[0], p[1]));
      g.colorBy((x, y) => {
        const d = Math.hypot(x + cx, y + cy) / maxD;
        if (d > 0.86) return rim;
        const t = clamp(d / 0.86, 0, 1);
        return [lerp(pink[0], lav[0], t), lerp(pink[1], lav[1], t), lerp(pink[2], lav[2], t)];
      });
      return { geo: g, matrix: G.trs(cx, 0, cy, PI / 2, 0, 0, 1, 1, 1), color: [1, 1, 1] };
    };
    const parts = [
      lobe([[0, 0.02], [0.03, 0.105], [0.1, 0.175], [0.19, 0.2], [0.25, 0.15], [0.245, 0.06], [0.17, -0.005], [0.06, -0.02]], 0.011),
      lobe([[0.0, 0.0], [0.08, -0.01], [0.165, -0.045], [0.195, -0.115], [0.15, -0.18], [0.07, -0.175], [0.015, -0.09]], 0.01),
    ];
    for (const [x, z, r] of [[0.175, 0.11, 0.026], [0.105, 0.075, 0.018], [0.2, 0.05, 0.014], [0.12, -0.1, 0.024], [0.07, -0.05, 0.014]]) {
      parts.push({ geo: UNIT.sphereLo(), matrix: G.trs(x, 0, z, 0, 0, 0, r, 0.0125, r), color: rgb(0xffffff) });
    }
    return G.mergeGeometries(parts);
  });
}
function hookGeo() { // chunky hooked upper beak: rooted at the face, bulges forward, curls down and back
  return cg('hook2', () => {
    const pts = curve((u) => { const a = lerp(1.25, -1.45, u); return [0, -0.01 + 0.028 * Math.sin(a), 0.004 + 0.034 * Math.cos(a)]; }, 14);
    const g = tubeGeo(pts, (u) => lerp(0.024, 0.0045, Math.pow(u, 1.15)), 10, 3);
    g.scale(0.82, 1, 1);
    g.computeBoundingSphere();
    return g;
  });
}
// flat annulus sector in the XY plane (r0..r1, angles a0..a1)
function arcGeo(a0, a1, r0, r1, n = 18) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; for (const r of [r0, r1]) { pos.push(Math.cos(a) * r, Math.sin(a) * r, 0); nrm.push(0, 0, 1); } }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nrm, 3); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
function sparkleGeo() { return cg('sparkle4', () => G.puffyShapeGeo(G.starOutline(4, 0.5, 0.13, 4), 0.06, 3, 0.6)); }
function flameOutline() {
  const out = [];
  for (let i = 0; i < 40; i++) {
    const th = (i / 40) * TAU, c = Math.cos(th), s = Math.sin(th);
    // teardrop pointing +y with a wavy flick
    const r = 0.5 * (1 - 0.55 * Math.max(0, s)) + 0.03 * Math.sin(th * 3);
    out.push([r * c * 0.55, s > 0 ? s * 0.95 : s * 0.45]);
  }
  return out;
}

// ------------------------------------------------------------------ face parts
function petEyes(head, o) {
  const e = makeEyes(head, { headR: o.R, yaw: o.yaw, pitch: o.pitch, size: o.size, glint: o.glint, color: o.color });
  for (const E of e.eyes) E.pivot.remove(E.hurt); // pets never use the hurt (> <) eyes
  return e;
}
function miniMouth(head, R, pitch = -12, s = 0.55) {
  const pivot = grp(head, 'mouth', onSphere(R * 0.99, 0, pitch), faceRot(0, pitch));
  const arc = add(pivot, () => G.cachedGeo('mouthArc', () => G.torusGeo(0.035, 0.011, 6, 10, PI)), MG(0x6b2b3b, { spec: 0.2, rim: 0 }), { r: [0, 0, PI], s });
  const open = ell(pivot, MG(0x8a2a40, { spec: 0.1, rim: 0 }), [0, -0.006 * s, 0], 0.034 * s, 0.03 * s, 0.012);
  open.visible = false;
  let cur = '';
  const api = {
    pivot,
    set(sh) {
      if (sh === cur) return; cur = sh;
      arc.visible = sh === 'smile' || sh === 'frown' || sh === 'flat';
      open.visible = sh === 'open' || sh === 'o';
      arc.rotation.z = sh === 'frown' ? 0 : PI;
      arc.position.y = sh === 'frown' ? -0.014 * s : 0;
      arc.scale.set(s, sh === 'flat' ? s * 0.3 : s, s);
      const k = sh === 'o' ? 0.62 : 1;
      open.scale.set(0.034 * s * k, 0.03 * s * (sh === 'o' ? 0.85 : 1), 0.012);
    },
  };
  api.set('smile');
  return api;
}
function face(P, o) {
  const head = o.at || P.head, S = o.S || [1, 1, 1], R = o.R * (o.k ?? 1);
  const ey = o.eyeYaw ?? 22, ep = o.eyePitch ?? 12;
  P.eyes = petEyes(head, { R: R * surfR(S, ey, ep), yaw: ey, pitch: ep, size: o.eyeSize ?? 0.5, glint: o.glint, color: o.eyeColor });
  if (o.cheeks !== false) {
    const cy = o.cheekYaw ?? 42, cp = o.cheekPitch ?? -5;
    P.cheeks = makeCheeks(head, { headR: R * surfR(S, cy, cp), yaw: cy, pitch: cp, size: o.cheekSize ?? 0.55, color: o.cheekColor });
  }
  if (o.mouth) { const mp = o.mouth.pitch ?? -12; P.mouth = miniMouth(head, R * surfR(S, 0, mp), mp, o.mouth.size ?? 0.55); }
}
// bird beak: upper + hinged lower (opens for 'open' mouth)
function beak(P, o) {
  const pitch = o.pitch ?? -4;
  const piv = grp(P.head, 'beak', onSphere(o.at, 0, pitch), faceRot(0, pitch));
  const len = o.len ?? 0.05, w = o.w ?? 0.03, h = o.h ?? 0.022;
  const mU = MG(o.c, { spec: 0.4 }), mL = MG(o.c2 ?? o.c, { spec: 0.3 });
  if (o.kind === 'hook') add(piv, hookGeo, mU, { p: [0, h * 0.2, -0.006], s: [w / 0.026, h / 0.03, len / 0.05] });
  else add(piv, UNIT.cone, mU, { p: [0, h * 0.22, len * 0.42], r: [PI / 2, 0, 0], s: [w, len, h] });
  if (o.lower !== false) {
    P.jaw = grp(piv, 'jaw', [0, -h * 0.05, 0]);
    add(P.jaw, UNIT.cone, mL, { p: [0, -h * 0.28, len * 0.3], r: [PI / 2, 0, 0], s: [w * 0.78, len * (o.kind === 'hook' ? 0.5 : 0.66), h * 0.55] });
    if (o.dot) ell(P.jaw, M(o.dot), [0, -h * 0.42, len * 0.48], w * 0.3, h * 0.26, w * 0.26);
  }
  P.mouth = { set(sh) { P.mouthOpen = sh === 'open' ? 1 : sh === 'o' ? 0.5 : 0; } };
  P.beak = piv;
  return piv;
}
// bird wing pair on the body sides
function birdWings(P, o) {
  const geo = wingGeo('bird', P.id, o.colorFn);
  const m = own(0xffffff, { vertexColors: true });
  P.glowMats.push(m);
  for (const sd of [-1, 1]) {
    const piv = grp(P.body, sd < 0 ? 'wingL' : 'wingR', [sd * o.x, o.y ?? 0, o.z ?? -0.01]);
    const L = o.span * 1.14;
    add(piv, geo, m, { s: [L, L * (o.thick ?? 1), L * (o.chord ?? 1) * 1.08], r: sd < 0 ? [0, 0, PI] : undefined });
    P.wings.push({ pivot: piv, sd, sweep: o.sweep ?? 0.32, off: 0 });
  }
}
function insectWings(P, o) {
  const geo = wingGeo('insect');
  const m = GLASS(o.c ?? 0xeef8ff, o.op ?? 0.5);
  const pairs = o.pairs || [{ x: o.x, y: o.y, z: o.z, span: o.span, chord: o.chord, sweep: o.sweep ?? 0.45, off: 0 }];
  for (const w of pairs) {
    for (const sd of [-1, 1]) {
      const piv = grp(P.body, 'wing', [sd * w.x, w.y, w.z]);
      add(piv, geo, m, { s: [w.span, w.span * (o.thick ?? 0.5), w.chord / 0.4], r: sd < 0 ? [0, 0, PI] : undefined });
      P.wings.push({ pivot: piv, sd, sweep: w.sweep, off: w.off || 0, foldSweep: w.foldSweep, ampK: w.ampK });
    }
  }
}
// feather fan tail, pointing back (-z); parts merged
function fanTail(P, o) {
  const piv = grp(P.body, 'tail', o.p);
  const n = o.n ?? 3, parts = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5, yaw = k * (o.spread ?? 0.9);
    const len = o.len * 1.22 * (1 - Math.abs(k) * (o.taper ?? 0.25)), w = o.w * 1.12;
    parts.push({ p: [Math.sin(yaw) * len * 0.5, 0, -Math.cos(yaw) * len * 0.5], r: [0, yaw, 0], s: [w, w * 0.32, len * 0.5], c: typeof o.c === 'function' ? o.c(i, n) : o.c });
  }
  add(piv, merged('tail:' + P.id, parts), VC());
  P.tail = piv; P.tailRest = o.up ?? 0.35;
  piv.rotation.x = P.tailRest;
  return piv;
}
function glowHalo(P, parent, c, r, p = [0, 0, 0]) {
  const h = add(parent, () => invSphereGeo('invSphere'), glowMat(c), { p, s: r });
  h.userData.op = 0; h.visible = false;
  P.fx.push(h);
  return h;
}

// ------------------------------------------------------------------ rig
class PetRig {
  constructor(id, cfg) {
    this.id = id;
    this.name = cfg.name;
    this.cfg = cfg;
    this.root = new Node('pet-' + id);
    this.motion = grp(this.root, 'motion');
    this.body = grp(this.motion, 'body');
    this.head = this.body;
    this.wings = [];
    this.glowMats = [];
    this.fx = [];
    this.size = cfg.size;
    this.glow = cfg.glow;
    this._glowRGB = cfg.glow;
    this.opacity = 1;
    this.T = Math.random() * 10;
    this.phase = Math.random() * TAU;
    this.bobPh = Math.random() * TAU;
    this.blinkT = 0.6 + Math.random() * 2.5;
    this.blinkPhase = -1;
    this.loopA = 0;
    this.mouthOpen = 0;
    this.jaw = null;
    this.sq = new Spring(170, 9);
    this.tailSpring = new Spring(60, 6);
    this.anim = '';
    this.p = { lean: 0, roll: 0, hz: cfg.hz, amp: cfg.amp, base: cfg.base, fold: 0, spread: 0, bobA: 0.016, bobHz: 1.4, glow: 0, y: 0, z: 0, tail: 0, breath: 0 };
    this.mouth = { set() {} };
  }
  setFlash(v) { this.root.traverse((n) => { if (n.isMesh) n.flash = v; }); }
  setOpacity(v) {
    this.opacity = v;
    this.root.traverse((n) => { if (n.isMesh) n.opacity = v * (n.userData.op ?? 1); });
  }
  update(dt, st = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const cfg = this.cfg, p = this.p;
    const anim = st.anim || 'idle', sp = clamp(st.speed ?? 0.5, 0, 1.5);
    this.T += dt;
    const T = this.T;
    if (anim !== this.anim) { if (anim === 'happy' || anim === 'ability') this.sq.kick(2.2); this.anim = anim; this.animT = 0; } else this.animT = (this.animT || 0) + dt;
    const t = st.t ?? this.animT; // seconds since the anim started (falls back to our own clock)
    let hz = cfg.hz, amp = cfg.amp, base = cfg.base, fold = 0, spread = 0, lean = cfg.lean ?? 0.05, roll = 0;
    let bobA = cfg.bob ?? 0.016, bobHz = cfg.bobHz ?? 1.3, y = 0, z = 0, glow = 0, tail = 0, breath = 0;
    let expr = 'normal', mouth = 'smile', loop = 0;
    switch (anim) {
      case 'fly':
        lean = (cfg.flyLean ?? 0.3) * (0.45 + 0.65 * Math.min(sp, 1)); hz *= 1 + 0.35 * sp; amp *= 1.08;
        roll = Math.sin(T * 1.3) * 0.1; bobA *= 0.7; tail = -0.2;
        break;
      case 'happy': {
        expr = 'happy'; mouth = 'open'; hz *= 1.25; amp *= 1.1; bobHz = 2.4; bobA *= 1.4;
        const per = 1.6, u = (t % per) / per;
        loop = clamp(u / 0.46, 0, 1);
        y = Math.sin(loop * PI) * 0.09; z = -Math.sin(loop * TAU) * 0.04;
        break;
      }
      case 'ability':
        spread = 1; mouth = 'open'; glow = 0.6 + 0.4 * Math.sin(T * 8.5); hz *= 1.5; bobA *= 0.5; lean = -0.04;
        break;
      case 'sleep':
        expr = 'sleep'; mouth = cfg.sleepMouth || 'smile'; fold = 1; lean = cfg.sleepLean ?? 0.16; bobA = 0.006; bobHz = 0.42; y = -0.015; tail = -0.25; breath = 1;
        break;
      case 'sad':
        expr = 'sad'; mouth = 'frown'; hz *= 0.55; amp *= 0.5; base -= 0.3; lean = 0.2; bobA *= 0.5; bobHz = 0.6; y = -0.035; tail = -0.35;
        break;
      default: // idle hover
        roll = Math.sin(T * 0.9) * 0.05;
    }
    // smoothing
    const r = 9;
    p.lean = approach(p.lean, lean, r, dt); p.roll = approach(p.roll, roll, r, dt);
    p.hz = approach(p.hz, fold > 0 ? 0 : hz, 6, dt); p.amp = approach(p.amp, fold > 0 ? 0 : amp, 8, dt); p.base = approach(p.base, base, 8, dt);
    p.fold = approach(p.fold, fold, 7, dt); p.spread = approach(p.spread, spread, 9, dt);
    p.bobA = approach(p.bobA, bobA, 5, dt); p.bobHz = approach(p.bobHz, bobHz, 5, dt);
    p.y = approach(p.y, y, loop ? 30 : 6, dt); p.z = approach(p.z, z, loop ? 30 : 6, dt);
    p.glow = approach(p.glow, glow, glow > p.glow ? 14 : 6, dt);
    p.tail = approach(p.tail, tail, 6, dt); p.breath = approach(p.breath, breath, 4, dt);
    // loop-the-loop (nose-up backflip)
    if (loop > 0) this.loopA = -TAU * Ease.inOutSine(loop);
    else { const tgt = Math.round(this.loopA / TAU) * TAU; this.loopA = approach(this.loopA, tgt, 10, dt); if (Math.abs(this.loopA - tgt) < 1e-3) this.loopA = 0; }
    // wings
    this.phase += dt * p.hz * TAU;
    const style = cfg.style || 'bird';
    for (const w of this.wings) {
      const ph = this.phase + (w.off || 0);
      const wave = style === 'bird' ? Math.sin(ph + 0.4 * Math.sin(ph)) : Math.sin(ph);
      let a = p.base + p.amp * (w.ampK ?? 1) * wave;
      a = lerp(a, (w.spreadA ?? cfg.spreadA ?? 0.3) + Math.sin(T * 38 + (w.off || 0)) * 0.05, p.spread);
      a = lerp(a, w.foldA ?? cfg.foldA ?? -1.2, p.fold);
      w.pivot.rotation.z = w.sd * a;
      const sw = lerp(lerp(w.sweep, (w.spreadSweep ?? w.sweep * 0.35), p.spread), w.foldSweep ?? cfg.foldSweep ?? w.sweep, p.fold);
      w.pivot.rotation.y = w.sd * sw;
    }
    // body motion
    this.bobPh += dt * p.bobHz * TAU;
    const flapBob = style === 'butterfly' ? Math.cos(this.phase) * 0.022 * (p.amp / Math.max(cfg.amp, 0.01))
      : style === 'bird' ? -Math.cos(this.phase) * 0.007 * (p.amp / Math.max(cfg.amp, 0.01)) : 0;
    this.motion.position.set(0, p.y + Math.sin(this.bobPh) * p.bobA + flapBob, p.z);
    this.motion.rotation.set(this.loopA, 0, p.roll);
    this.body.rotation.x = p.lean;
    const sq = this.sq.update(0, dt);
    const br = Math.sin(T * 2.4) * 0.03 * p.breath;
    const fs = style === 'bird' ? Math.sin(this.phase) * 0.025 * (p.amp / Math.max(cfg.amp, 0.01)) : 0;
    this.body.scale.set(1 - sq * 0.4 - fs * 0.5 + br * 0.5, 1 + sq + fs + br, 1 - sq * 0.4 - fs * 0.5 + br * 0.5);
    // tail
    if (this.tail) {
      const wagT = anim === 'happy' ? Math.sin(T * 13) * 0.35 : Math.sin(T * 2.1) * 0.12;
      const tw = this.tailSpring.update(wagT, dt);
      this.tail.rotation.set(this.tailRest + p.tail + Math.sin(this.phase) * 0.06 * (p.amp > 0.05 ? 1 : 0), tw, 0);
    }
    // beak
    if (this.jaw) this.jaw.rotation.x = approach(this.jaw.rotation.x, 0.6 * this.mouthOpen, 18, dt);
    // face
    if (this.eyes) {
      this.eyes.set(expr);
      if (expr === 'normal' || expr === 'sad') {
        this.blinkT -= dt;
        if (this.blinkT <= 0 && this.blinkPhase < 0) { this.blinkPhase = 0; this.blinkT = 1.6 + Math.random() * 3; }
        if (this.blinkPhase >= 0) {
          this.blinkPhase += dt / 0.13;
          const v = this.blinkPhase < 0.5 ? 1 - this.blinkPhase * 2 : (this.blinkPhase - 0.5) * 2;
          this.eyes.blink(v);
          if (this.blinkPhase >= 1) { this.blinkPhase = -1; this.eyes.blink(1); }
        }
      }
      if (cfg.eyeTilt && (expr === 'normal')) { this.eyes.eyes[0].open.rotation.z = -cfg.eyeTilt; this.eyes.eyes[1].open.rotation.z = cfg.eyeTilt; }
    }
    this.mouth.set(mouth);
    // ability glow
    const g = p.glow;
    for (const m of this.glowMats) { m.emissive[0] = this._glowRGB[0] * g * 0.24; m.emissive[1] = this._glowRGB[1] * g * 0.24; m.emissive[2] = this._glowRGB[2] * g * 0.24; }
    if (this.halo) { this.halo.userData.op = g * 0.3; const s = this.haloR * (1 + 0.08 * Math.sin(T * 8.5)); this.halo.scale.set(s, s, s); }
    if (cfg.hook) cfg.hook(this, dt, st, T, anim);
    for (const m of this.fx) { const o = m.userData.op ?? 1; m.opacity = this.opacity * o; m.visible = o > 0.004 && this.opacity > 0.004; }
  }
}

// ------------------------------------------------------------------ pet definitions
const DEFS = {};
const def = (id, cfg, build, hook = null) => { DEFS[id] = { cfg: { id, ...cfg, hook }, build }; };
const BIRD = { style: 'bird', hz: 3.2, amp: 0.72, base: 0.12, foldA: -1.25, spreadA: 0.28, flyLean: 0.32 };

// spherical-cap colour patch on the unit body sphere: pole direction (yaw, pitch deg), angular radius th (fraction of PI)
const DEG = PI / 180;
const cap = (yaw, pitch, th, c, k = 1.012) => ({ g: () => band(0, th, 30), r: [PI / 2 - pitch * DEG, yaw * DEG, 0], s: k, c });
// round chubby bird body (unit space, scaled by R*S): sphere + crisp cap patches + feet, merged into one glowable mesh
function birdBody(P, o) {
  const R = o.R, S = o.S || [1, 1, 1];
  const parts = [{ g: UNIT.sphereHi, c: o.body }];
  if (o.belly) parts.push(cap(0, o.bellyPitch ?? -40, o.bellyTh ?? 0.26, o.belly, 1.008));
  for (const q of o.parts || []) parts.push(q);
  if (o.feet) for (const sd of [-1, 1]) parts.push({ p: [sd * 0.3, -0.95, 0.2], r: [0.2, 0, 0], s: [0.16, 0.08, 0.24], c: o.feet });
  const m = own(0xffffff, { vertexColors: true, ...(o.mat || {}) });
  P.glowMats.push(m);
  P.bodyMesh = add(P.body, merged('body:' + P.id, parts), m, { s: [R * S[0], R * S[1], R * S[2]] });
  P.R = R; P.S = S;
  P.halo = glowHalo(P, P.body, o.haloColor ?? o.glowHex ?? 0xffffff, 1); P.haloR = R * 1.75;
  return m;
}

// ---- 1. bee 붕붕이
def('bee', { name: '붕붕이', style: 'insect', hz: 17, amp: 0.5, base: 0.55, foldA: 0.1, foldSweep: 1.15, spreadA: 0.25, size: 0.3, glow: [1, 0.84, 0.25], bob: 0.02, bobHz: 1.7 }, (P) => {
  const R = 0.14, S = [1, 0.97, 1.08];
  const Y = 0xffd23f, K = 0x3d2e45;
  const bands = [[0, 0.5, Y], [0.5, 0.61, K], [0.61, 0.73, Y], [0.73, 0.84, K], [0.84, 1, Y]];
  const parts = bands.map(([a, b, c]) => ({ g: () => band(a, b), r: [PI / 2, 0, 0], s: [R * S[0], R * S[2], R * S[1]], c }));
  parts.push({ g: UNIT.cone, p: [0, -0.012, -R * S[2] - 0.016], r: [-PI / 2, 0, 0], s: [0.02, 0.05, 0.02], c: K }); // stinger
  parts.push({ g: UNIT.sphereLo, p: [0, -0.012, -R * S[2] + 0.004], s: [0.026, 0.024, 0.02], c: K });
  const m = own(0xffffff, { vertexColors: true, spec: 0.22, rim: 0.42 });
  P.glowMats.push(m);
  add(P.body, merged('body:bee', parts), m);
  face(P, { R, S, eyeYaw: 21, eyePitch: 11, eyeSize: 0.5, cheekYaw: 42, cheekPitch: -6, mouth: { pitch: -15, size: 0.5 } });
  // antennae (merged, springy)
  const ant = grp(P.body, 'antennae', onSphere(R * 0.95, 0, 52));
  const aparts = [];
  for (const sd of [-1, 1]) {
    const pts = curve((u) => [sd * (0.012 + 0.035 * u * u), 0.075 * Math.sin(u * 1.35), 0.012 + 0.03 * u], 10);
    aparts.push({ g: () => cg('beeAnt' + sd, () => tubeGeo(pts, 0.0055, 6, 2)), c: K });
    const e = pts[pts.length - 1];
    aparts.push({ p: e, s: 0.017, c: K });
  }
  add(ant, merged('ant:bee', aparts), VC());
  P.ant = ant;
  insectWings(P, { x: 0.035, y: R * 0.78, z: -R * 0.22, span: 0.12, chord: 0.075, sweep: 0.5, c: 0xeaf8ff, op: 0.55 });
  P.halo = glowHalo(P, P.body, 0xffc23a, 1); P.haloR = R * 1.8;
}, (P, dt, st, T) => {
  P.ant.rotation.x = Math.sin(T * 5.5) * 0.12 + (st.anim === 'sad' ? 0.5 : st.anim === 'sleep' ? 0.35 : 0);
});

// ---- 2. butterfly 나풀이
def('butterfly', { name: '나풀이', style: 'butterfly', hz: 2.5, amp: 0.78, base: 0.62, foldA: 1.42, foldSweep: 0, spreadA: 0.1, size: 0.4, glow: [1, 0.55, 0.85], bob: 0.012, bobHz: 1.0, flyLean: 0.18, lean: 0 }, (P) => {
  const Rh = 0.088;
  const head = grp(P.body, 'head', [0, 0.035, 0.055]);
  P.head = head;
  const parts = [
    { p: [0, 0.035, 0.055], s: Rh, c: 0xffd9ee },
    { p: [0, -0.012, -0.012], s: [0.036, 0.042, 0.05], c: 0x9a78c9 },
    { p: [0, -0.022, -0.075], s: [0.03, 0.032, 0.065], c: 0xa98ad6 },
  ];
  const m = own(0xffffff, { vertexColors: true });
  P.glowMats.push(m);
  add(P.body, merged('body:butterfly', parts), m);
  face(P, { R: Rh, at: head, eyeYaw: 24, eyePitch: 6, eyeSize: 0.44, cheekYaw: 44, cheekPitch: -10, cheekSize: 0.45, mouth: { pitch: -20, size: 0.45 } });
  // curly antennae
  const aparts = [];
  for (const sd of [-1, 1]) {
    const pts = curve((u) => {
      if (u < 0.7) { const v = u / 0.7; return [sd * 0.03 * v, 0.07 * v, 0.02 * v]; }
      const a = ((u - 0.7) / 0.3) * PI * 1.5;
      return [sd * (0.03 + 0.012 * Math.sin(a)), 0.07 + 0.016 * Math.sin(a) - 0.0, 0.02 - 0.016 + 0.016 * Math.cos(a)];
    }, 16);
    aparts.push({ g: () => cg('bfAnt' + sd, () => tubeGeo(pts, 0.0045, 6, 2)), c: 0x6f53a3 });
  }
  const ant = grp(head, 'ant', [0, Rh * 0.82, 0.01]);
  add(ant, merged('ant:butterfly', aparts), VC());
  P.ant = ant;
  // wings: fore+hind merged per side
  const wm = own(0xffffff, { vertexColors: true, spec: 0.25, rim: 0.5 });
  P.glowMats.push(wm);
  for (const sd of [-1, 1]) {
    const piv = grp(P.body, 'wing', [sd * 0.026, 0.0, -0.01]);
    add(piv, butterflyWingGeo(), wm, { s: 1.0, r: sd < 0 ? [0, 0, PI] : undefined });
    P.wings.push({ pivot: piv, sd, sweep: 0, off: 0 });
  }
  P.halo = glowHalo(P, P.body, 0xff7ac8, 1); P.haloR = 0.2;
}, (P, dt, st, T) => { P.ant.rotation.x = Math.sin(T * 2.5) * 0.12; });

// ---- 3. sparrow 짹짹이
def('sparrow', { name: '짹짹이', ...BIRD, size: 0.3, glow: [1, 0.72, 0.42] }, (P) => {
  const R = 0.145, S = [1.02, 0.96, 1];
  birdBody(P, {
    R, S, body: 0xc4905f, belly: 0xfff0db, feet: 0xff9f6b, glowHex: 0xffb070,
    parts: [
      cap(180, 52, 0.36, 0x8f5b3e), // chestnut crown
      cap(-58, 2, 0.1, 0xffffff), cap(58, 2, 0.1, 0xffffff), // white cheeks
    ],
  });
  face(P, { R, S, k: 1.012, eyeYaw: 21, eyePitch: 14, eyeSize: 0.5, cheekYaw: 47, cheekPitch: -6, cheekSize: 0.48 });
  beak(P, { at: R * 0.98, pitch: -1, c: 0xffb347, c2: 0xf09a30, len: 0.042, w: 0.026, h: 0.02 });
  birdWings(P, { x: R * 0.86, y: R * 0.02, z: -0.012, span: 0.125, colorFn: (x, z) => (x > 0.62 ? 0x7d4f33 : z < -0.06 ? 0x9a6845 : 0xb07a50) });
  fanTail(P, { p: [0, R * 0.05, -R * 0.88], len: 0.085, w: 0.03, c: (i) => (i === 1 ? 0x8f5b3e : 0x7d4f33), up: 0.45 });
});

// ---- 4. seagull 끼룩이
def('seagull', { name: '끼룩이', ...BIRD, hz: 2.8, amp: 0.78, size: 0.31, glow: [0.7, 0.88, 1] }, (P) => {
  const R = 0.15;
  birdBody(P, {
    R, S: [1, 0.96, 1.02], body: 0xfbfcff, feet: 0xffb23b, glowHex: 0x8fd0ff,
    parts: [cap(180, 22, 0.3, 0xc9d1df)], // grey mantle on the back
  });
  face(P, { R, S: [1, 0.96, 1.02], eyeYaw: 21, eyePitch: 13, eyeSize: 0.5, cheekYaw: 42, cheekPitch: -7 });
  beak(P, { at: R * 1.0, pitch: -2, c: 0xffcf3a, c2: 0xffc22a, len: 0.064, w: 0.03, h: 0.024, dot: 0xff4d4d });
  birdWings(P, { x: R * 0.86, y: R * 0.05, z: -0.012, span: 0.14, colorFn: (x, z) => (x > 0.7 ? 0x5d6679 : x > 0.6 && z < 0 ? 0xffffff : 0xb3bccb) });
  fanTail(P, { p: [0, R * 0.05, -R * 0.9], len: 0.08, w: 0.034, c: (i) => (i === 1 ? 0xffffff : 0xe9edf5), up: 0.4 });
});

// ---- 5. parrot 따라쟁이
def('parrot', { name: '따라쟁이', ...BIRD, hz: 3.0, size: 0.32, glow: [0.45, 1, 0.45] }, (P) => {
  const R = 0.148;
  birdBody(P, {
    R, S: [1, 0.98, 1], body: 0x4fcc5a, belly: 0xc9f26b, feet: 0x9a8a8f, glowHex: 0x7dff7a,
    parts: [cap(0, 58, 0.105, 0xffd23f, 1.016)], // golden forehead
  });
  face(P, { R, eyeYaw: 22, eyePitch: 14, eyeSize: 0.5, cheekYaw: 42, cheekPitch: -6 });
  beak(P, { at: R * 0.96, pitch: 0, kind: 'hook', c: 0xff9a2e, c2: 0xf07f1a, len: 0.06, w: 0.03, h: 0.032 });
  const band3 = (x) => (x < 0.36 ? 0xff4848 : x < 0.64 ? 0xffd23f : 0x3f86ff);
  birdWings(P, { x: R * 0.86, y: R * 0.04, z: -0.012, span: 0.135, colorFn: (x) => band3(x) });
  fanTail(P, { p: [0, -R * 0.05, -R * 0.86], n: 3, len: 0.15, w: 0.028, spread: 0.45, taper: 0.4, c: (i) => (i === 1 ? 0x3f86ff : 0xff4848), up: 0.15 });
  // head crest: three springy feathers
  const cr = grp(P.body, 'crest', onSphere(R * 0.9, 0, 62));
  const parts = [];
  for (let i = -1; i <= 1; i++) {
    const pts = curve((u) => [i * 0.012 + i * 0.02 * u, 0.06 * u * (1 - 0.15 * Math.abs(i)), -0.03 * u * u], 8);
    parts.push({ g: () => cg('parrotCrest' + i, () => tubeGeo(pts, (u) => lerp(0.012, 0.004, u), 7, 2)), c: i === 0 ? 0xffd23f : 0x4fcc5a });
  }
  add(cr, merged('crest:parrot', parts), VC());
  cr.rotation.x = -0.3;
  P.crest = cr;
}, (P, dt, st, T) => { P.crest.rotation.x = -0.3 + Math.sin(T * 6) * 0.08 + (st.anim === 'happy' ? Math.sin(T * 16) * 0.2 : 0); });

// ---- 6. owl 부엉박사
def('owl', { name: '부엉박사', ...BIRD, hz: 2.1, amp: 0.7, size: 0.33, glow: [0.85, 0.7, 1], bobHz: 1.0 }, (P) => {
  const R = 0.155, S = [1.03, 1, 0.97];
  const EY = 25, EP = 13;
  birdBody(P, {
    R, S, body: 0x9b6a49, belly: 0xf4e3c6, bellyPitch: -48, bellyTh: 0.24, feet: 0xffb84a, glowHex: 0xb58cff,
    parts: [
      cap(-EY, EP, 0.13, 0xf1dcbc, 1.014), cap(EY, EP, 0.13, 0xf1dcbc, 1.014), // facial discs
      ...[-1, 0, 1].map((i) => ({ p: onSphere(1.005, i * 15, -36 - (i === 0 ? 7 : 0)), r: faceRot(i * 15, -36), s: [0.1, 0.035, 0.03], c: 0xd8bc93 })), // chevrons
    ],
  });
  face(P, { R, S, k: 1.022, eyeYaw: EY, eyePitch: EP, eyeSize: 0.56, cheekYaw: 47, cheekPitch: -10, cheekSize: 0.46, glint: 0x8fb7ff });
  beak(P, { at: R * 0.99, pitch: -4, kind: 'hook', c: 0xffb340, c2: 0xf09a30, len: 0.04, w: 0.024, h: 0.024, lower: false });
  // little round glasses (rims + bridge)
  const gl = [];
  const er = R * surfR(S, EY, EP) * 1.022;
  for (const sd of [-1, 1]) gl.push({ g: () => cg('glassRim', () => G.torusGeo(1, 0.085, 8, 30)), p: onSphere(er + 0.012, sd * EY, EP), r: faceRot(sd * EY, EP), s: 0.058, c: 0xe8b84d });
  const bp = onSphere(er + 0.016, 0, EP + 3);
  gl.push({ g: () => cg('glassBridge', () => G.torusGeo(1, 0.3, 6, 12, PI)), p: bp, s: [0.016, 0.012, 0.02], c: 0xe8b84d });
  add(P.body, merged('glasses:owl', gl), MG(0xffffff, { vertexColors: true, spec: 0.7 }));
  // feathery ear tufts
  const tp = [];
  for (const sd of [-1, 1]) {
    const pos = onSphere(R * 0.88, sd * 38, 50);
    const pts = curve((u) => [pos[0] + sd * 0.035 * u, pos[1] + 0.07 * Math.sin(u * 1.2), pos[2] - 0.01 * u], 8);
    tp.push({ g: () => cg('owlTuft' + sd, () => tubeGeo(pts, (u) => lerp(0.03, 0.006, Math.pow(u, 0.8)), 9, 2)), c: 0x7d5238 });
  }
  add(P.body, merged('tufts:owl', tp), VC());
  birdWings(P, { x: R * 0.87, y: R * 0.0, z: -0.015, span: 0.14, colorFn: (x, z) => (x > 0.66 ? 0x6e4a33 : z < -0.07 ? 0x83583c : 0x9b6a49) });
  fanTail(P, { p: [0, -R * 0.2, -R * 0.86], len: 0.07, w: 0.036, c: 0x7d5238, up: 0.2 });
});

// ---- 7. ladybug 점박이
def('ladybug', { name: '점박이', style: 'insect', hz: 14, amp: 0.45, base: 0.45, foldA: 0.0, foldSweep: 1.3, spreadA: 0.3, size: 0.3, glow: [1, 0.38, 0.38], bob: 0.018 }, (P) => {
  const R = 0.135, Kc = 0x3a2e45;
  const under = [
    { p: [0, -0.03, -0.01], s: [R * 0.82, R * 0.6, R * 0.95], c: Kc },
    // head: dark hood with a cream face (crisp bands, pole forward)
    { g: () => band(0, 0.4), p: [0, -0.018, R * 0.78], r: [PI / 2 - 0.12, 0, 0], s: 0.088, c: 0xfff4ea },
    { g: () => band(0.4, 1), p: [0, -0.018, R * 0.78], r: [PI / 2 - 0.12, 0, 0], s: 0.088, c: Kc },
  ];
  for (const sd of [-1, 1]) under.push({ p: [sd * 0.05, -0.085, 0.03], s: [0.022, 0.016, 0.03], c: Kc }); // tiny feet
  const m = own(0xffffff, { vertexColors: true });
  P.glowMats.push(m);
  add(P.body, merged('body:ladybug', under), m);
  const head = grp(P.body, 'head', [0, -0.018, R * 0.78]);
  P.head = head;
  face(P, { R: 0.088, at: head, eyeYaw: 24, eyePitch: 10, eyeSize: 0.44, cheekYaw: 46, cheekPitch: -8, cheekSize: 0.42, mouth: { pitch: -18, size: 0.42 } });
  // antennae
  const ap = [];
  for (const sd of [-1, 1]) {
    const pts = curve((u) => [sd * (0.015 + 0.03 * u), 0.05 * Math.sin(u * 1.4), 0.02 * u], 8);
    ap.push({ g: () => cg('lbAnt' + sd, () => tubeGeo(pts, 0.005, 6, 2)), c: Kc });
    ap.push({ p: pts[pts.length - 1], s: 0.013, c: Kc });
  }
  const ant = grp(head, 'ant', [0, 0.07, 0.0]);
  add(ant, merged('ant:ladybug', ap), VC());
  P.ant = ant;
  // wings (under the shell)
  insectWings(P, { x: 0.02, y: 0.045, z: -0.02, span: 0.12, chord: 0.06, sweep: 0.55, c: 0xf2f7ff, op: 0.5 });
  // shell halves (elytra) with dots, hinged at the front-top
  const sm = own(0xffffff, { vertexColors: true, spec: 0.35, rim: 0.45 });
  P.glowMats.push(sm);
  P.shell = [];
  for (const sd of [-1, 1]) {
    const hinge = grp(P.body, 'shell', [sd * 0.004, 0.03, R * 0.55]);
    const cx = sd * R * 0.48, cz = -R * 0.6, a = R * 0.56, b = R * 0.78, c = R * 1.02;
    const parts = [{ p: [cx, -0.02, cz], s: [a, b, c], c: 0xff4747 }];
    for (const [yaw, pitch, rr] of [[30, 34, 0.026], [62, 8, 0.022], [28, -6, 0.02], [70, 52, 0.016]]) {
      const d = onSphere(1, sd * yaw, pitch);
      const dd = [d[0] * a, d[1] * b, d[2] * c];
      // dots biased to the back half
      const pp = [cx + dd[0], -0.02 + dd[1], cz + (dd[2] < 0 ? dd[2] : -dd[2])];
      const nrm = [d[0] / a, d[1] / b, (dd[2] < 0 ? d[2] : -d[2]) / c];
      const yawN = Math.atan2(nrm[0], nrm[2]), pitchN = Math.atan2(nrm[1], Math.hypot(nrm[0], nrm[2]));
      parts.push({ p: pp, r: [-pitchN, yawN, 0], s: [rr, rr, 0.008], c: Kc });
    }
    add(hinge, merged('shell:' + sd, parts), sm);
    P.shell.push({ hinge, sd });
  }
  P.halo = glowHalo(P, P.body, 0xff5a5a, 1); P.haloR = R * 1.8;
}, (P, dt, st, T, anim) => {
  const open = anim === 'sleep' ? 0 : anim === 'ability' ? 1.25 : 1;
  P.shellOpen = approach(P.shellOpen ?? 0, open, 8, dt);
  for (const s of P.shell) { s.hinge.rotation.z = s.sd * 0.55 * P.shellOpen; s.hinge.rotation.x = -0.32 * P.shellOpen + Math.sin(T * 9) * 0.02 * P.shellOpen; }
  const ws = Math.max(0.05, Math.min(1, P.shellOpen));
  for (const w of P.wings) { w.pivot.scale.set(ws, ws, ws); w.pivot.visible = P.shellOpen > 0.08; }
  P.ant.rotation.x = Math.sin(T * 4.5) * 0.1;
});

// ---- 8. dragonfly 쌩쌩이
def('dragonfly', { name: '쌩쌩이', style: 'insect', hz: 16, amp: 0.32, base: 0.08, foldA: 0.02, spreadA: 0.12, size: 0.42, glow: [0.35, 0.95, 1], bob: 0.02, bobHz: 1.2, flyLean: 0.12, lean: 0 }, (P) => {
  const Rh = 0.09, C1 = 0x55d9ec, C2 = 0x2f9fd0;
  const head = grp(P.body, 'head', [0, 0.02, 0.1]);
  P.head = head;
  const abd = curve((u) => [0, 0.01 + 0.03 * u * u, -0.03 - 0.27 * u], 12);
  const abdGeo = () => cg('dfAbd2', () => {
    const g = tubeGeo(abd, (u) => lerp(0.028, 0.014, u), 10, 3);
    const c1 = rgb(C1), c2 = rgb(C2);
    g.colorBy((x, y, z) => { const u = (-0.03 - z) / 0.27; return u > 0.08 && ((u * 6.5) % 1) > 0.72 ? c2 : c1; });
    return g;
  });
  const parts = [
    { p: [0, 0.02, 0.1], s: Rh, c: C1 },
    { p: [0, 0.005, 0.025], s: [0.046, 0.048, 0.055], c: 0x3fc0d8 },
    { g: abdGeo },
    { p: abd[11], s: 0.0145, c: C2 },
  ];
  const m = own(0xffffff, { vertexColors: true, spec: 0.3, rim: 0.45 });
  P.glowMats.push(m);
  add(P.body, merged('body:dragonfly', parts), m);
  face(P, { R: Rh, at: head, eyeYaw: 25, eyePitch: 9, eyeSize: 0.5, cheekYaw: 47, cheekPitch: -10, cheekSize: 0.45, mouth: { pitch: -20, size: 0.45 }, glint: 0x7fe0ff });
  insectWings(P, {
    c: 0xe0fbff, op: 0.48, thick: 0.4,
    pairs: [
      { x: 0.02, y: 0.04, z: 0.04, span: 0.19, chord: 0.045, sweep: -0.12, off: 0, foldSweep: -0.25 },
      { x: 0.02, y: 0.035, z: 0.0, span: 0.18, chord: 0.05, sweep: 0.28, off: PI * 0.55, foldSweep: 0.42 },
    ],
  });
  P.halo = glowHalo(P, P.body, 0x58e5ff, 1, [0, 0, 0.02]); P.haloR = 0.18;
});

// ---- 9. firefly 반짝이
def('firefly', { name: '반짝이', style: 'insect', hz: 12, amp: 0.5, base: 0.5, foldA: 0.1, foldSweep: 1.2, spreadA: 0.28, size: 0.3, glow: [0.82, 1, 0.3], bob: 0.02, bobHz: 1.1 }, (P) => {
  const Rh = 0.09;
  const head = grp(P.body, 'head', [0, 0.03, 0.07]);
  P.head = head;
  const parts = [
    { g: () => band(0, 0.42), p: [0, 0.03, 0.07], r: [PI / 2 - 0.15, 0, 0], s: Rh, c: 0xffd9b0 },
    { g: () => band(0.42, 1), p: [0, 0.03, 0.07], r: [PI / 2 - 0.15, 0, 0], s: Rh, c: 0x8a5a45 },
    { p: [0, 0.0, -0.01], s: [0.05, 0.048, 0.05], c: 0x5e3d33 },
    { g: UNIT.torus, p: [0, 0.0, -0.045], r: [-0.2, 0, 0], s: [0.055, 0.055, 0.07], c: 0x5e3d33 },
  ];
  const m = own(0xffffff, { vertexColors: true });
  P.glowMats.push(m);
  add(P.body, merged('body:firefly', parts), m);
  // glowing lantern abdomen (own material, always softly emissive)
  P.lampMat = own(0xe6ff70, { spec: 0.3, rim: 0.5, emissive: 0x3a5a00 });
  // the lantern tilts up behind the head so it peeks out even from the front
  P.lamp = ell(P.body, P.lampMat, [0, 0.025, -0.11], 0.085, 0.08, 0.095, [-0.45, 0, 0]);
  P.lampHalo = glowHalo(P, P.body, 0x9ee830, 0.14, [0, 0.03, -0.12]);
  face(P, { R: Rh, at: head, eyeYaw: 24, eyePitch: 8, eyeSize: 0.45, cheekYaw: 46, cheekPitch: -10, cheekSize: 0.44, mouth: { pitch: -19, size: 0.44 } });
  const ap = [];
  for (const sd of [-1, 1]) {
    const pts = curve((u) => [sd * (0.015 + 0.035 * u), 0.06 * Math.sin(u * 1.5), 0.03 * u - 0.012 * u * u], 9);
    ap.push({ g: () => cg('ffAnt' + sd, () => tubeGeo(pts, 0.005, 6, 2)), c: 0x5e3d33 });
    ap.push({ p: pts[pts.length - 1], s: 0.012, c: 0x5e3d33 });
  }
  const ant = grp(head, 'ant', [0, Rh * 0.8, 0.0]);
  add(ant, merged('ant:firefly', ap), VC());
  P.ant = ant;
  insectWings(P, { x: 0.03, y: 0.05, z: -0.02, span: 0.11, chord: 0.065, sweep: 0.55, c: 0xfff6dc, op: 0.5 });
  P.halo = glowHalo(P, P.body, 0xd8ff5a, 1); P.haloR = 0.19;
}, (P, dt, st, T, anim) => {
  const base = anim === 'sleep' ? 0.35 : anim === 'sad' ? 0.25 : 0.7;
  const pulse = base + 0.3 * Math.sin(T * (anim === 'sleep' ? 1.2 : 2.6)) + P.p.glow * 0.8;
  const e = P.lampMat.emissive;
  e[0] = 0.32 * pulse; e[1] = 0.48 * pulse; e[2] = 0.02 * pulse;
  P.lampHalo.userData.op = clamp(0.25 + pulse * 0.35, 0, 1);
  const s = 0.13 + 0.025 * pulse; P.lampHalo.scale.set(s, s, s);
  P.ant.rotation.x = Math.sin(T * 4) * 0.12;
});

// ---- 10. hummingbird 윙윙이
def('hummingbird', { name: '윙윙이', ...BIRD, style: 'insect', hz: 24, amp: 0.85, base: 0.25, foldA: -1.2, spreadA: 0.3, size: 0.28, glow: [0.25, 1, 0.82], lean: -0.32, flyLean: 0.1, bob: 0.014, bobHz: 1.6, sleepLean: 0.0 }, (P) => {
  const R = 0.112, S = [0.94, 0.94, 1.12];
  birdBody(P, {
    R, S, body: 0x22c2a5, belly: 0xd9fff3, bellyPitch: -62, bellyTh: 0.22, glowHex: 0x40ffd0, mat: { spec: 0.45, rim: 0.5 },
    parts: [cap(0, 64, 0.2, 0xff4fb0, 1.016), cap(180, 40, 0.24, 0x139f86)], // magenta crown, dark back
  });
  face(P, { R, S, eyeYaw: 22, eyePitch: 14, eyeSize: 0.46, cheekYaw: 44, cheekPitch: -4, cheekSize: 0.45 });
  beak(P, { at: R * surfR(S, 0, 2) * 0.97, pitch: 2, c: 0x3d3346, c2: 0x3d3346, len: 0.13, w: 0.009, h: 0.009, lower: false });
  birdWings(P, { x: R * 0.8, y: R * 0.22, z: -0.01, span: 0.12, chord: 0.8, sweep: 0.5, colorFn: (x) => (x > 0.68 ? 0xff6fbf : x > 0.4 ? 0x1bb39a : 0x22c2a5) });
  // motion-blur arcs: faint teal annulus sector sweeping the flap range
  const bm = M(0x7fe8d2, { unlit: true, transparent: true, opacity: 0.26, depthWrite: false, side: 'double', rim: 0, fog: false });
  P.blur = [];
  for (const sd of [-1, 1]) {
    const holder = grp(P.body, 'blur', [sd * R * 0.8, R * 0.22, -0.01], [0, sd * 0.5, 0]);
    const fan = add(holder, () => cg('blurArc', () => arcGeo(-0.6, 1.1, 0.45, 1.0)), bm, { s: 0.125, r: sd < 0 ? [0, PI, 0] : undefined });
    fan.userData.op = 1; P.fx.push(fan); P.blur.push(fan);
  }
  fanTail(P, { p: [0, -R * 0.15, -R * 1.0], n: 2, len: 0.075, w: 0.026, spread: 0.55, c: 0xff4fb0, up: -0.2 });
}, (P, dt, st, T) => {
  const k = clamp((P.p.hz - 6) / 16, 0, 1);
  for (const f of P.blur) f.userData.op = k * (0.8 + 0.2 * Math.sin(T * 50));
});

// ---- 11. dove 구구
def('dove', { name: '구구', ...BIRD, hz: 2.9, size: 0.31, glow: [1, 0.96, 0.78] }, (P) => {
  const R = 0.15;
  birdBody(P, { R, S: [1, 0.96, 1.02], body: 0xffffff, belly: 0xf7f4ff, feet: 0xff9fb2, glowHex: 0xfff2b0 });
  face(P, { R, S: [1, 0.96, 1.02], eyeYaw: 21, eyePitch: 13, eyeSize: 0.5, cheekYaw: 42, cheekPitch: -7 });
  beak(P, { at: R * 0.98, pitch: -2, c: 0xffa8b8, c2: 0xff95aa, len: 0.044, w: 0.026, h: 0.02, lower: false });
  // olive leaf sprig held in the beak
  const leaf = grp(P.beak, 'leaf', [0.0, -0.002, 0.03]);
  const lp = [
    { g: () => cg('twig', () => tubeGeo(curve((u) => [0.07 * u - 0.012, -0.004 * Math.sin(u * PI), 0.004 * u], 6), 0.0035, 5, 2)), c: 0x8a6b4a },
    { p: [0.03, 0.006, 0.0], r: [0.2, 0, 0.5], s: [0.026, 0.009, 0.012], c: 0x86c24c },
    { p: [0.055, -0.008, 0.0], r: [-0.2, 0, -0.45], s: [0.024, 0.009, 0.011], c: 0x9bd25a },
    { p: [0.064, 0.004, 0.002], r: [0, 0, 0.15], s: [0.022, 0.008, 0.01], c: 0x86c24c },
  ];
  add(leaf, merged('leaf:dove', lp), VC());
  P.leaf = leaf;
  birdWings(P, { x: R * 0.86, y: R * 0.05, z: -0.012, span: 0.14, colorFn: (x) => (x > 0.68 ? 0xd8d3ea : 0xffffff) });
  fanTail(P, { p: [0, R * 0.02, -R * 0.9], n: 4, len: 0.085, w: 0.03, spread: 1.0, c: (i) => (i === 1 || i === 2 ? 0xffffff : 0xefeaf8), up: 0.4 });
}, (P, dt, st, T) => { P.leaf.rotation.z = Math.sin(T * 3) * 0.08; });

// ---- 12. woodpecker 콕콕이
def('woodpecker', { name: '콕콕이', ...BIRD, hz: 3.3, size: 0.31, glow: [1, 0.33, 0.4] }, (P) => {
  const R = 0.148, K = 0x342d44;
  birdBody(P, {
    R, S: [1, 0.97, 1], body: K, feet: 0x8d8798, glowHex: 0xff5a6a,
    parts: [cap(0, -8, 0.36, 0xffffff), cap(180, 62, 0.24, 0xff3a4e)], // white face & front, red cap
  });
  face(P, { R, S: [1, 0.97, 1], k: 1.012, eyeYaw: 21, eyePitch: 12, eyeSize: 0.5, cheekYaw: 43, cheekPitch: -7 });
  beak(P, { at: R * 0.97, pitch: -1, c: 0x9993a8, c2: 0x857f95, len: 0.068, w: 0.03, h: 0.026 });
  // red crest tuft
  const cp = [];
  for (let i = 0; i < 3; i++) {
    const pts = curve((u) => [0, 0.05 * Math.sin(u * 1.4) * (1 - i * 0.15), -0.012 - (0.035 + i * 0.012) * u], 8);
    cp.push({ g: () => cg('wpCrest' + i, () => tubeGeo(pts, (u) => lerp(0.017, 0.004, u), 7, 2)), p: [0, -i * 0.006, -i * 0.012], c: 0xff3a4e });
  }
  const crest = grp(P.body, 'crest', onSphere(R * 0.9, 0, 58));
  add(crest, merged('crest:woodpecker', cp), VC());
  P.crest = crest;
  birdWings(P, { x: R * 0.86, y: R * 0.03, z: -0.012, span: 0.135, colorFn: (x, z) => ((Math.floor(x * 6.5) % 2 === 1 && z < 0.02) ? 0xffffff : K) });
  fanTail(P, { p: [0, -R * 0.05, -R * 0.88], len: 0.09, w: 0.03, c: K, up: 0.1 });
}, (P, dt, st, T, anim) => {
  // peck peck! (rapid nods while using ability, a little idle peck now and then)
  let peck = 0;
  if (anim === 'ability') peck = Math.max(0, Math.sin(T * 26)) * 0.4;
  else if (anim === 'idle') { const u = T % 4.2; if (u < 0.5) peck = Math.max(0, Math.sin(u * 32)) * 0.32; }
  P.body.rotation.x += peck;
  P.crest.rotation.x = Math.sin(T * 5) * 0.08 - peck * 0.5;
});

// ---- 13. canary 랄라
def('canary', { name: '랄라', ...BIRD, hz: 3.4, size: 0.3, glow: [1, 0.93, 0.35] }, (P) => {
  const R = 0.145;
  birdBody(P, { R, S: [1, 0.96, 1], body: 0xffe047, belly: 0xfff4a8, feet: 0xffa860, glowHex: 0xffe95a });
  face(P, { R, eyeYaw: 21, eyePitch: 13, eyeSize: 0.5, cheekYaw: 42, cheekPitch: -7 });
  beak(P, { at: R * 0.97, pitch: -1, c: 0xff9a3a, c2: 0xff8a2a, len: 0.045, w: 0.03, h: 0.022 });
  // little curl on the head
  const curl = grp(P.body, 'curl', onSphere(R * 0.95, 0, 70));
  add(curl, () => cg('canaryCurl', () => tubeGeo(curve((u) => { const a = u * PI * 1.6; return [0, 0.03 * Math.sin(a) + 0.02 * u, -0.025 * (1 - Math.cos(a)) + 0.01 * u]; }, 14), (u) => lerp(0.012, 0.005, u), 7, 2)), M(0xffd21f));
  P.curl = curl;
  birdWings(P, { x: R * 0.86, y: R * 0.03, z: -0.012, span: 0.13, colorFn: (x) => (x > 0.66 ? 0xf2bf16 : 0xffdc3a) });
  fanTail(P, { p: [0, R * 0.04, -R * 0.88], len: 0.08, w: 0.03, c: 0xf6c51c, up: 0.45 });
  // music notes (float up while singing)
  const nm = MU(0xff6fae, { transparent: true, opacity: 1, depthWrite: false });
  P.notes = [];
  for (let i = 0; i < 2; i++) {
    const n = add(P.root, () => merged('note', [
      { p: [0, 0, 0], r: [0, 0, 0.4], s: [0.022, 0.016, 0.012] },
      { g: UNIT.cylinder, p: [0.017, 0.035, 0], s: [0.0045, 0.07, 0.0045] },
      { g: UNIT.rbox, p: [0.03, 0.062, 0], r: [0, 0, -0.5], s: [0.026, 0.01, 0.008] },
    ]), nm, { s: 1 });
    n.userData.op = 0; n.visible = false; P.fx.push(n); P.notes.push(n);
  }
}, (P, dt, st, T, anim) => {
  const singing = anim === 'idle' || anim === 'happy' || anim === 'ability';
  if (singing && anim !== 'happy') { const s = Math.sin(T * 7.5); P.mouthOpen = Math.max(P.mouthOpen, s > 0.2 ? 0.75 : 0); }
  P.notes.forEach((n, i) => {
    const per = 1.6, u = ((T + i * per * 0.5) % per) / per;
    n.userData.op = singing ? Math.sin(u * PI) : 0;
    n.position.set((i ? 1 : -1) * (0.07 + u * 0.08) + Math.sin(u * 9 + i) * 0.015, 0.06 + u * 0.18, 0.06);
    n.rotation.z = Math.sin(u * 6 + i) * 0.3;
  });
  P.curl.rotation.x = Math.sin(T * 4) * 0.1;
});

// ---- 14. eagle 용감이
def('eagle', { name: '용감이', ...BIRD, hz: 2.7, amp: 0.8, size: 0.33, glow: [1, 0.78, 0.35], eyeTilt: 0.14 }, (P) => {
  const R = 0.155, B = 0x8a5a3c;
  birdBody(P, {
    R, S: [1.02, 0.97, 1], body: B, feet: 0xffc23a, glowHex: 0xffc060,
    parts: [
      cap(0, 42, 0.37, 0xffffff), // fluffy white head
      ...[[-24, 0.13], [0, 0.16], [24, 0.13]].map(([yaw, r]) => ({ p: onSphere(0.93, yaw, 72), s: r, c: 0xffffff })), // fluff tuft
    ],
  });
  face(P, { R, S: [1.02, 0.97, 1], k: 1.012, eyeYaw: 21, eyePitch: 15, eyeSize: 0.5, cheekYaw: 43, cheekPitch: -2 });
  beak(P, { at: R * 0.99, pitch: 1, kind: 'hook', c: 0xffc229, c2: 0xf0a817, len: 0.056, w: 0.03, h: 0.032 });
  birdWings(P, { x: R * 0.87, y: R * 0.0, z: -0.015, span: 0.15, colorFn: (x, z) => (x > 0.64 ? 0x5f3c27 : z < -0.06 ? 0x75492f : B) });
  fanTail(P, { p: [0, -R * 0.05, -R * 0.88], len: 0.085, w: 0.034, c: 0xffffff, up: 0.3 });
});

// ---- 15. phoenix 피닉스
def('phoenix', { name: '피닉스', ...BIRD, hz: 2.8, amp: 0.8, size: 0.36, glow: [1, 0.55, 0.18], eyeTilt: 0.06 }, (P) => {
  const R = 0.15;
  birdBody(P, { R, S: [1, 0.97, 1], body: 0xff5f3a, belly: 0xffc84a, feet: 0xffb43a, glowHex: 0xff8a2a, mat: { spec: 0.35, rim: 0.5, emissive: 0x2a0800 } });
  face(P, { R, eyeYaw: 21, eyePitch: 13, eyeSize: 0.5, cheekYaw: 42, cheekPitch: -6, glint: 0xffc35a });
  beak(P, { at: R * 0.98, pitch: 0, kind: 'hook', c: 0xffd23f, c2: 0xffb820, len: 0.05, w: 0.028, h: 0.028 });
  const flameCol = (x, y) => { const v = clamp((y + 0.45) / 1.4, 0, 1); return v < 0.35 ? [1, 0.93, 0.45] : v < 0.7 ? [1, 0.62, 0.15] : [1, 0.32, 0.2]; };
  const flameGeo = () => cg('flame', () => { const g = G.puffyShapeGeo(flameOutline(), 0.16, 4, 0.6); g.colorBy(flameCol); return g; });
  // crown crest: three little golden flames + a gem
  const crown = grp(P.body, 'crown', onSphere(R * 0.92, 0, 64));
  const cp = [];
  for (let i = -1; i <= 1; i++) cp.push({ g: flameGeo, p: [i * 0.022, 0.0, 0], r: [0, 0, -i * 0.35], s: [0.05, 0.05 * (i === 0 ? 1.25 : 1), 0.05] });
  add(crown, merged('crown:phoenix', cp), VCU());
  crown.rotation.x = -0.35;
  P.crown = crown;
  birdWings(P, { x: R * 0.86, y: R * 0.04, z: -0.012, span: 0.15, colorFn: (x, z) => (x > 0.66 ? 0xffc23a : z > 0.04 ? 0xff9a3a : 0xff5f3a) });
  // flame tail feathers (unlit, flickering)
  const tail = grp(P.body, 'tail', [0, -R * 0.05, -R * 0.82]);
  P.flames = [];
  for (let i = -1; i <= 1; i++) {
    const piv = grp(tail, 'flame', [i * 0.02, 0, 0], [-(PI / 2) + 0.45 - Math.abs(i) * 0.12, i * 0.45, 0]);
    add(piv, flameGeo, VCU(), { p: [0, 0.07, 0], s: [0.075, 0.13 - Math.abs(i) * 0.02, 0.075] });
    P.flames.push(piv);
  }
  P.tail = tail; P.tailRest = 0.15;
  P.tailGlow = glowHalo(P, tail, 0xff7a1a, 0.09, [0, 0.03, -0.08]);
  // legendary sparkles
  P.sparkles = [];
  for (let i = 0; i < 2; i++) {
    const s = add(P.motion, sparkleGeo, MU(i === 1 ? 0xfff3b0 : 0xffffff), { s: 0.04 });
    P.sparkles.push(s);
  }
}, (P, dt, st, T, anim) => {
  P.flames.forEach((f, i) => { const k = 1 + Math.sin(T * 13 + i * 2.1) * 0.1 + Math.sin(T * 21 + i) * 0.05; f.scale.set(1 / Math.sqrt(k), k, 1); f.rotation.z = Math.sin(T * 7 + i) * 0.08; });
  P.tailGlow.userData.op = 0.3 + 0.08 * Math.sin(T * 11) + P.p.glow * 0.25;
  P.crown.rotation.z = Math.sin(T * 6) * 0.05;
  const bm = P.glowMats[0];
  bm.emissive[0] += 0.12 + 0.04 * Math.sin(T * 9); bm.emissive[1] += 0.03;
  P.sparkles.forEach((s, i) => {
    const a = (i ? -1 : 1) * T * 1.6 + i * PI;
    const tw = Math.max(0, Math.sin(T * 4.5 + i * 2.2));
    const k = 0.012 + 0.03 * tw * (anim === 'sleep' ? 0.4 : 1) + P.p.glow * 0.015;
    s.position.set(Math.cos(a) * 0.24, 0.05 + Math.sin(a * 1.3 + i) * 0.07, Math.sin(a) * 0.2);
    s.rotation.set(0, -a, T * 2 + i);
    s.scale.set(k, k, k);
  });
});

// ------------------------------------------------------------------ public API
export const PET_IDS = Object.keys(DEFS);
export const PET_NAMES = Object.fromEntries(PET_IDS.map((k) => [k, DEFS[k].cfg.name]));

export function buildPet(id) {
  const d = DEFS[id] || DEFS.bee;
  const P = new PetRig(d.cfg.id, d.cfg);
  d.build(P);
  // pets made at rest: settle into idle pose so the first frame looks right
  P.update(1 / 60, { anim: 'idle', t: 0, speed: 0 });
  return {
    root: P.root,
    update: (dt, st) => P.update(dt, st),
    setFlash: (v) => P.setFlash(v),
    setOpacity: (v) => P.setOpacity(v),
    size: P.size,
    glow: P.glow.slice(),
    id: d.cfg.id,
    name: d.cfg.name,
    head: P.head,
    wings: P.wings.map((w) => w.pivot),
    rig: P,
  };
}

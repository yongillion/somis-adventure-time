// ============================================================================
// models/bosses.js — the 8 stage bosses of "소미의 어드벤처 타임".
//
//   buildBoss(id) -> Boss instance:
//     { root, update(dt, st), setFlash(v), setPurified(v), setOpacity(v), parts, height, radius,
//       centerY, flying, meshCount }
//   BOSS_IDS, BOSS_TIMING (key moments per anim), OCTO_YAW (tentacle directions), LANCE_LEN, fogColor
//   st = { anim, t, speed, ...extra }  — t (seconds since the anim started) is required.
//        extras: vy (mushking jumpAir), tentacle (octopus slam/stuck), hand 'L'|'R' (pumpkin vineWhip,
//        fogking handSlam), tongueLen (chameleon), boltLen (thundercloud strike)
//
// Every boss owns its materials (never the shared mat() cache) so purification
// (fog-gray <-> bright colors), hit flash and fades are per instance. New bosses
// start fogged: setPurified(0). While purified >= 0.5 the default face is friendly.
// Animation model: every anim is a pose function of `t` plus looping clocks.
// Switching anims (or restarting one: t jumps back) cross-fades from the current
// pose with a smoothstep blend, so gameplay can switch at any moment. Faces,
// turret eyes, cap/plume/cape use approach()/Spring secondary motion.
// All bosses: idle, hurt, defeated (+ their own list, see BOSS_TIMING).
// Origins: feet center facing +Z, except thundercloud (cloud center) and the
// chameleon 'cling' convention (see its class comment).
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { clamp, lerp, smoothstep, Ease, TAU, PI, rgb, RNG } from '../../engine/math.js';
import { UNIT, add, grp, ell, onSphere, faceRot, Spring, approach } from './common.js';

// ---------------------------------------------------------------- tiny math
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (t, a, b) => sat((t - a) / (b - a));
const win = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * PI));
const decay = (t, k, f, ph = 0) => Math.exp(-t * k) * Math.cos(t * f + ph);
const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ============================================================================
// Palette — per-boss owned materials with purification lerp
// ============================================================================
const SOFT = { spec: 0.14, rim: 0.4 };
const GLOSS = { spec: 0.36, rim: 0.42 };
const FOGT = rgb(0x8d86a8), FOGL = lum(FOGT);
// fog-infected version of a color: hue pulled to gray-lavender, value range compressed & darker
export function fogColor(c) {
  const l = lum(c);
  const L = 0.13 + 0.6 * l;
  const s = L / Math.max(l, 0.04);
  const k = 0.17; // keep a hint of the original hue so parts stay readable
  return [0, 1, 2].map((i) => clamp(lerp((FOGT[i] / FOGL) * L, c[i] * s, k), 0, 1));
}
function fogEmissive(e) { const l = lum(e) * 0.55; return [(FOGT[0] / FOGL) * l, (FOGT[1] / FOGL) * l, (FOGT[2] / FOGL) * l]; }

class Palette {
  constructor() { this.list = []; this.vsets = []; this.v = 0; }
  // o: material options + { gloss, pure (never fogs), fogC (explicit fog color), fogEm (explicit fog emissive) }
  mat(color, o = {}) {
    const { fogC, fogEm, pure, gloss, ...rest } = o;
    const m = new Material({ ...(gloss ? GLOSS : SOFT), ...rest, color });
    const e = { m, orig: m.color.slice(), origE: m.emissive.slice(), add: [0, 0, 0] };
    e.fog = fogC !== undefined ? rgb(fogC) : pure ? e.orig.slice() : fogColor(e.orig);
    e.fogE = fogEm !== undefined ? rgb(fogEm) : pure ? e.origE.slice() : fogEmissive(e.origE);
    m._pe = e;
    this.list.push(e);
    this._apply(e);
    return m;
  }
  // additive glow (unlit, translucent)
  glow(color, o = {}) {
    return this.mat(color, { unlit: true, rim: 0, spec: 0, transparent: true, blending: 'additive', depthWrite: false, opacity: 0.7, fog: false, ...o });
  }
  _apply(e) {
    const v = this.v, c = e.m.color, em = e.m.emissive;
    for (let i = 0; i < 3; i++) {
      c[i] = e.fog[i] + (e.orig[i] - e.fog[i]) * v;
      em[i] = e.fogE[i] + (e.origE[i] - e.fogE[i]) * v + e.add[i];
    }
  }
  set(v) {
    this.v = v;
    for (const e of this.list) this._apply(e);
    for (const s of this.vsets) this._applyV(s);
  }
  // extra emissive driven by animation (weak-point glow, charge flicker...)
  glowAdd(m, r, g = r, b = r) {
    const e = m._pe;
    if (e.add[0] === r && e.add[1] === g && e.add[2] === b) return;
    e.add[0] = r; e.add[1] = g; e.add[2] = b;
    this._apply(e);
  }
  // register a geometry whose vertex colors must purify too (merged / tube geometry)
  vcolors(geo, fogFn = fogColor) {
    const a = geo.attributes.color;
    const orig = new Float32Array(a.array), fog = new Float32Array(a.array.length);
    for (let i = 0; i < orig.length; i += 3) { const f = fogFn([orig[i], orig[i + 1], orig[i + 2]]); fog[i] = f[0]; fog[i + 1] = f[1]; fog[i + 2] = f[2]; }
    const s = { geo, a, orig, fog, v: -1 };
    this.vsets.push(s);
    this._applyV(s);
    return s;
  }
  _applyV(s) {
    if (s.v === this.v) return;
    s.v = this.v;
    const A = s.a.array, v = this.v;
    for (let i = 0; i < A.length; i++) A[i] = s.fog[i] + (s.orig[i] - s.fog[i]) * v;
    s.geo.markDirty('color');
  }
}

// merge [{geo, m:[px,py,pz,rx,ry,rz,sx,sy,sz], c:hex}] into one vertex-colored geometry
function mergeColored(items) {
  return G.mergeGeometries(items.map((it) => ({ geo: typeof it.geo === 'function' ? it.geo() : it.geo, matrix: G.trs(...it.m), color: it.c !== undefined ? rgb(it.c) : [1, 1, 1] })));
}
function mergePlain(items) {
  return G.mergeGeometries(items.map((it) => ({ geo: typeof it.geo === 'function' ? it.geo() : it.geo, matrix: G.trs(...it.m) })));
}

// ============================================================================
// TubeShape — tapered tube with rounded caps along a smooth curve (Catmull-Rom
// through control points, resampled by arc length, parallel-transport frames).
// Used for tentacles, vines, tails, lightning... dynamic (rebuilt per frame) or static.
// ============================================================================
export class TubeShape {
  constructor(o = {}) {
    this.n = o.n ?? 16; this.rs = o.rs ?? 10; this.capN = Math.max(2, o.capN ?? 3);
    this.baseCap = o.baseCap !== false;
    this.radius = o.radius || (() => 0.1);
    this.rScale = 1;
    this.up = o.up || [0, 1, 0];
    this.DS = o.ds ?? 6;
    this.linear = !!o.linear;
    this.nb = this.baseCap ? this.capN - 1 : 0;
    this.rings = this.nb + this.n + 1 + (this.capN - 1);
    this.vcount = this.rings * this.rs + 2;
    const idx = [], rs = this.rs;
    for (let i = 0; i < this.rings - 1; i++) for (let j = 0; j < rs; j++) {
      const j2 = (j + 1) % rs, a = i * rs + j, b = i * rs + j2, c = (i + 1) * rs + j2, d = (i + 1) * rs + j;
      idx.push(a, b, c, a, c, d);
    }
    const bp = this.rings * rs, tp = bp + 1, L = (this.rings - 1) * rs;
    for (let j = 0; j < rs; j++) { const j2 = (j + 1) % rs; idx.push(bp, j2, j); idx.push(L + j, L + j2, tp); }
    this.idx = idx;
    this.pos = new Float32Array(this.vcount * 3);
    this.nrm = new Float32Array(this.vcount * 3);
    this.ringU = new Float32Array(this.rings);
    for (let i = 0; i < this.rings; i++) this.ringU[i] = clamp((i - this.nb) / this.n, 0, 1);
    this.cosT = new Float32Array(rs); this.sinT = new Float32Array(rs);
    for (let j = 0; j < rs; j++) { this.cosT[j] = Math.cos((j / rs) * TAU); this.sinT[j] = Math.sin((j / rs) * TAU); }
    const n1 = this.n + 1;
    this.c = new Float32Array(n1 * 3); this.t = new Float32Array(n1 * 3); this.N = new Float32Array(n1 * 3); this.r = new Float32Array(n1);
    this.length = 0;
    this.dense = null; this.dlen = null;
  }
  update(ctrl) { this._sample(ctrl); this._frames(); this._fill(); return this; }
  _sample(ctrl) {
    const m = ctrl.length, segs = m - 1, DS = this.DS, nd = segs * DS + 1;
    if (!this.dense || this.dense.length < nd * 3) { this.dense = new Float32Array(nd * 3); this.dlen = new Float32Array(nd); }
    const D = this.dense, Ld = this.dlen;
    let k = 0;
    for (let s = 0; s < segs; s++) {
      const p1 = ctrl[s], p2 = ctrl[s + 1], p0 = s > 0 ? ctrl[s - 1] : null, p3 = s + 2 < m ? ctrl[s + 2] : null;
      const qMax = s === segs - 1 ? DS : DS - 1;
      for (let q = 0; q <= qMax; q++) {
        const u = q / DS, u2 = u * u, u3 = u2 * u;
        if (this.linear) for (let a = 0; a < 3; a++) D[k * 3 + a] = p1[a] + (p2[a] - p1[a]) * u;
        else for (let a = 0; a < 3; a++) {
          const P1 = p1[a], P2 = p2[a], P0 = p0 ? p0[a] : 2 * P1 - P2, P3 = p3 ? p3[a] : 2 * P2 - P1;
          D[k * 3 + a] = 0.5 * (2 * P1 + (-P0 + P2) * u + (2 * P0 - 5 * P1 + 4 * P2 - P3) * u2 + (-P0 + 3 * P1 - 3 * P2 + P3) * u3);
        }
        k++;
      }
    }
    Ld[0] = 0;
    for (let i = 1; i < nd; i++) { const ax = D[i * 3] - D[i * 3 - 3], ay = D[i * 3 + 1] - D[i * 3 - 2], az = D[i * 3 + 2] - D[i * 3 - 1]; Ld[i] = Ld[i - 1] + Math.sqrt(ax * ax + ay * ay + az * az); }
    const len = (this.length = Ld[nd - 1]);
    let j = 0;
    for (let i = 0; i <= this.n; i++) {
      const target = (i / this.n) * len;
      while (j < nd - 2 && Ld[j + 1] < target) j++;
      const seg = Ld[j + 1] - Ld[j] || 1e-6, f = clamp((target - Ld[j]) / seg, 0, 1);
      for (let a = 0; a < 3; a++) this.c[i * 3 + a] = D[j * 3 + a] + (D[(j + 1) * 3 + a] - D[j * 3 + a]) * f;
    }
  }
  _frames() {
    const n = this.n, c = this.c, T = this.t, N = this.N;
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
      const x = c[b * 3] - c[a * 3], y = c[b * 3 + 1] - c[a * 3 + 1], z = c[b * 3 + 2] - c[a * 3 + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      T[i * 3] = x / l; T[i * 3 + 1] = y / l; T[i * 3 + 2] = z / l;
    }
    let nx = this.up[0], ny = this.up[1], nz = this.up[2];
    for (let i = 0; i <= n; i++) {
      const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2];
      const d = nx * tx + ny * ty + nz * tz;
      let px = nx - tx * d, py = ny - ty * d, pz = nz - tz * d;
      let l = Math.sqrt(px * px + py * py + pz * pz);
      if (l < 1e-4) { if (Math.abs(tx) < 0.9) { px = 0; py = tz; pz = -ty; } else { px = -tz; py = 0; pz = tx; } l = Math.sqrt(px * px + py * py + pz * pz); }
      nx = px / l; ny = py / l; nz = pz / l;
      N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
    }
  }
  _fill() {
    const n = this.n, rs = this.rs, c = this.c, T = this.t, N = this.N, P = this.pos, Q = this.nrm, r = this.r, capN = this.capN;
    for (let i = 0; i <= n; i++) r[i] = Math.max(1e-4, this.radius(i / n) * this.rScale);
    const ds = Math.max(this.length / n, 1e-5);
    let ring = 0;
    const put = (cx, cy, cz, i, rad, kd, kt) => {
      const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let j = 0; j < rs; j++) {
        const ca = this.cosT[j], sa = this.sinT[j];
        const dx = nx * ca + bx * sa, dy = ny * ca + by * sa, dz = nz * ca + bz * sa;
        const o = (ring * rs + j) * 3;
        P[o] = cx + dx * rad; P[o + 1] = cy + dy * rad; P[o + 2] = cz + dz * rad;
        let mx = dx * kd + tx * kt, my = dy * kd + ty * kt, mz = dz * kd + tz * kt;
        const l = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
        Q[o] = mx / l; Q[o + 1] = my / l; Q[o + 2] = mz / l;
      }
      ring++;
    };
    // base cap
    if (this.baseCap) for (let k = capN - 1; k >= 1; k--) {
      const ph = (k / capN) * (PI / 2), s = Math.sin(ph), co = Math.cos(ph);
      put(c[0] - T[0] * r[0] * s, c[1] - T[1] * r[0] * s, c[2] - T[2] * r[0] * s, 0, r[0] * co, co, -s);
    }
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
      const slope = (r[b] - r[a]) / (ds * (b - a));
      put(c[i * 3], c[i * 3 + 1], c[i * 3 + 2], i, r[i], 1, -slope);
    }
    const e = n * 3;
    for (let k = 1; k <= capN - 1; k++) {
      const ph = (k / capN) * (PI / 2), s = Math.sin(ph), co = Math.cos(ph);
      put(c[e] + T[e] * r[n] * s, c[e + 1] + T[e + 1] * r[n] * s, c[e + 2] + T[e + 2] * r[n] * s, n, r[n] * co, co, s);
    }
    // poles
    const bp = this.rings * rs * 3, tp = bp + 3;
    P[bp] = c[0] - T[0] * r[0]; P[bp + 1] = c[1] - T[1] * r[0]; P[bp + 2] = c[2] - T[2] * r[0];
    Q[bp] = -T[0]; Q[bp + 1] = -T[1]; Q[bp + 2] = -T[2];
    P[tp] = c[e] + T[e] * r[n]; P[tp + 1] = c[e + 1] + T[e + 1] * r[n]; P[tp + 2] = c[e + 2] + T[e + 2] * r[n];
    Q[tp] = T[e]; Q[tp + 1] = T[e + 1]; Q[tp + 2] = T[e + 2];
  }
  // point/tangent at the end of the main body (before the cap)
  end(out = { p: [0, 0, 0], t: [0, 0, 1] }) {
    const e = this.n * 3;
    out.p[0] = this.c[e]; out.p[1] = this.c[e + 1]; out.p[2] = this.c[e + 2];
    out.t[0] = this.t[e]; out.t[1] = this.t[e + 1]; out.t[2] = this.t[e + 2];
    return out;
  }
  // sample center at u (0..1)
  at(u, out = [0, 0, 0]) {
    const f = clamp(u, 0, 1) * this.n, i = Math.min(this.n - 1, Math.floor(f)), k = f - i;
    for (let a = 0; a < 3; a++) out[a] = this.c[i * 3 + a] + (this.c[(i + 1) * 3 + a] - this.c[i * 3 + a]) * k;
    return out;
  }
  // per-vertex colors from fn(u, angle) -> [r,g,b]
  colors(fn) {
    const col = new Float32Array(this.vcount * 3), rs = this.rs;
    for (let i = 0; i < this.rings; i++) for (let j = 0; j < rs; j++) {
      const cc = fn(this.ringU[i], (j / rs) * TAU), o = (i * rs + j) * 3;
      col[o] = cc[0]; col[o + 1] = cc[1]; col[o + 2] = cc[2];
    }
    const b = this.rings * rs * 3, c0 = fn(0, 0), c1 = fn(1, 0);
    col[b] = c0[0]; col[b + 1] = c0[1]; col[b + 2] = c0[2]; col[b + 3] = c1[0]; col[b + 4] = c1[1]; col[b + 5] = c1[2];
    return col;
  }
}
function tubeGeo(ctrl, o) {
  const S = new TubeShape(o).update(ctrl);
  const g = new G.Geometry();
  g.setAttribute('position', S.pos, 3);
  g.setAttribute('normal', S.nrm, 3);
  if (o.color) g.setAttribute('color', S.colors(o.color), 3);
  g.setIndex(S.idx);
  g.computeBoundingSphere();
  return g;
}
// dynamic tube mesh
class Tube {
  constructor(B, parent, material, o = {}) {
    const S = (this.S = new TubeShape(o));
    const geo = (this.geo = new G.Geometry());
    geo.setAttribute('position', S.pos, 3, true);
    geo.setAttribute('normal', S.nrm, 3, true);
    if (o.color) { geo.setAttribute('color', S.colors(o.color), 3); B.pal.vcolors(geo); }
    geo.setIndex(S.idx);
    this.mesh = add(parent, geo, material, { name: o.name || 'tube' });
    this.mesh.frustumCulled = false;
  }
  set(ctrl) { this.S.update(ctrl); this.geo.markDirty('position'); this.geo.markDirty('normal'); return this; }
}

// ============================================================================
// Shared cached geometry
// ============================================================================
const GEO = {
  arc: () => G.cachedGeo('b:arc', () => G.torusGeo(1, 0.26, 8, 20, PI)),
  arcThin: () => G.cachedGeo('b:arcThin', () => G.torusGeo(1, 0.18, 8, 20, PI)),
  chev: () => G.cachedGeo('b:chev', () => {
    const cap = G.capsuleGeo(0.5, 1, 10, 4);
    return G.mergeGeometries([
      { geo: cap, matrix: G.trs(0, 0.29, 0, 0, 0, PI / 2 - 0.55, 0.34, 0.58, 0.34) },
      { geo: cap, matrix: G.trs(0, -0.29, 0, 0, 0, PI / 2 + 0.55, 0.34, 0.58, 0.34) },
    ]);
  }),
  spiral: () => G.cachedGeo('b:spiral', () => {
    const pts = [];
    for (let i = 0; i <= 44; i++) { const u = i / 44, a = u * 2.15 * TAU, r = 0.1 + 0.9 * u; pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]); }
    return tubeGeo(pts, { n: 64, rs: 6, radius: () => 0.13, capN: 2, up: [0, 0, 1] });
  }),
  wavy: () => G.cachedGeo('b:wavy', () => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const x = -1 + (2 * i) / 12; pts.push([x, Math.sin(x * PI * 2) * 0.2, 0]); }
    return tubeGeo(pts, { n: 32, rs: 6, radius: () => 0.12, capN: 2, up: [0, 0, 1] });
  }),
  dmouth: () => G.cachedGeo('b:dmouth', () => {
    const out = [];
    for (let i = 0; i <= 18; i++) { const a = PI + (i / 18) * PI; out.push([Math.cos(a), 0.12 + Math.sin(a) * 0.95]); }
    for (let i = 1; i < 8; i++) { const x = 1 - (2 * i) / 8; out.push([x, 0.12 + 0.06 * (1 - x * x)]); }
    return G.puffyShapeGeo(out, 0.3, 4, 0.6);
  }),
  drop: () => G.cachedGeo('b:drop', () => G.latheGeo([[0, -1], [0.45, -0.9], [0.72, -0.62], [0.8, -0.25], [0.66, 0.15], [0.38, 0.55], [0.14, 0.88], [0, 1.05]], 14)),
  bolt: () => G.cachedGeo('b:bolt', () => G.extrudeGeo([[-0.12, 1], [0.42, 1], [0.12, 0.25], [0.46, 0.25], [-0.2, -1], [0.02, -0.12], [-0.34, -0.12]], 0.22)),
};

// thin torus with exact radii (unit torus scaling would fatten the tube)
const ringG = (R, r, arc = TAU) => () => G.cachedGeo(`b:ring:${R}:${r}:${arc}`, () => G.torusGeo(R, r, 8, 36, arc));

// ============================================================================
// Boss face: Kirby-style tall oval eyes (cut-oval shapes + brows for grumpy/sad looks),
// expressions, mouth shapes, blush. All materials owned by the boss.
//   expressions: normal | angry | sad | surprised | tired | happy | hurt | dizzy | closed
//   mouths: smile | flat | frown | pout | grin | open | roar | o | wavy
// ============================================================================
const EYE_DARK = 0x2a1f3d;
// eye oval (w=0.6, h=1, depth 0.36) clipped by the line y = c + m*x (keeps the part below)
function cutEyeGeo(key, c, m) {
  return G.cachedGeo('b:eye' + key, () => {
    const N = 48, pts = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * TAU; pts.push([Math.cos(a) * 0.6, Math.sin(a)]); }
    const f = (p) => p[1] - (c + m * p[0]);
    const out = [];
    for (let i = 0; i < N; i++) {
      const A = pts[i], B = pts[(i + 1) % N], fa = f(A), fb = f(B);
      if (fa <= 0) out.push(A);
      if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
    }
    const dense = [];
    for (let i = 0; i < out.length; i++) {
      const A = out[i], B = out[(i + 1) % out.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]), k = Math.max(1, Math.ceil(L / 0.08));
      for (let j = 0; j < k; j++) dense.push([A[0] + ((B[0] - A[0]) * j) / k, A[1] + ((B[1] - A[1]) * j) / k]);
    }
    return G.puffyShapeGeo(dense, 0.36, 6, 1);
  });
}
const EYE_CUT = {
  angry: () => cutEyeGeo('A', 0.36, 0.8),
  focus: () => cutEyeGeo('F', 0.56, 0.4),
  sad: () => cutEyeGeo('S', 0.48, -0.55),
  tired: () => cutEyeGeo('H', 0.08, 0.04),
};
const EYE_HL = { // highlight placement (x * -sd, y) in units of h, per cut
  normal: [0.1, 0.42, 1], angry: [-0.12, 0.08, 0.8], focus: [0.0, 0.26, 0.9], sad: [0.13, 0.18, 0.85], tired: [0.06, -0.14, 0.7], surprised: [0.1, 0.42, 1],
};
function makeFace(B, parent, o) {
  const P = B.pal;
  const F = grp(parent, 'face', o.c || [0, 0, 0], o.rot || null);
  const R = o.R;
  const h = o.eyeH * 0.5, w = h * (o.eyeW ?? 0.6), d = h * 0.36;
  const dark = o.eyeMat || P.mat(o.eyeColor ?? EYE_DARK, { gloss: true, spec: 0.55, rim: 0.12, pure: true });
  const white = o.hlMat || P.mat(0xffffff, { unlit: true, pure: true });
  const glint = P.mat(o.glint ?? 0x6fb2ff, { unlit: true, fogC: o.glintFog ?? 0xa498cc });
  const browM = o.browMat || dark;
  const eyes = [];
  for (const sd of [-1, 1]) {
    const yaw = (o.eyeYaw ?? 20) * sd, pitch = o.eyePitch ?? 8;
    const pv = o.eyeParents ? grp(o.eyeParents[sd < 0 ? 0 : 1], sd < 0 ? 'eyeL' : 'eyeR') : grp(F, sd < 0 ? 'eyeL' : 'eyeR', onSphere(R * (o.eyeIn ?? 0.975), yaw, pitch), faceRot(yaw, pitch));
    if (o.eyeTilt) pv.rotation.z = -sd * o.eyeTilt;
    const open = grp(pv, 'open');
    const oval = ell(open, dark, [0, 0, 0], w, h, d, null, 'oval');
    const hl = ell(open, white, [-sd * w * 0.16, h * 0.42, d * 0.72], w * 0.44, h * 0.33, d * 0.38, null, 'hl');
    if (o.noHl) hl.visible = false;
    let gl = null;
    if (!o.noGlint) gl = ell(open, glint, [0, -h * 0.56, d * 0.6], w * 0.6, h * 0.25, d * 0.4, null, 'glint');
    const brow = grp(pv, 'brow', [0, h * 1.35, d * 0.5]);
    add(brow, UNIT.capsule, browM, { r: [0, 0, PI / 2], s: [w * 0.42, w * 1.0, w * 0.36] });
    brow.visible = false;
    const happy = add(pv, GEO.arc, dark, { p: [0, -h * 0.12, d * 0.2], s: [w * 1.02, w * 1.0, w * 0.7] });
    const hurt = add(pv, GEO.chev, dark, { p: [0, 0, d * 0.2], r: [0, sd < 0 ? 0 : PI, 0], s: [w * 1.2, h * 0.8, w * 0.8] });
    const dizzy = add(pv, GEO.spiral, dark, { p: [0, 0, d * 0.25], s: [w * 1.05, w * 1.05, w * 0.9] });
    const closed = add(pv, GEO.arc, dark, { p: [0, h * 0.1, d * 0.2], r: [0, 0, PI], s: [w * 0.95, w * 0.75, w * 0.7] });
    for (const m of [happy, hurt, dizzy, closed]) m.visible = false;
    eyes.push({ pv, open, oval, hl, gl, brow, happy, hurt, dizzy, closed, sd, bv: 0, br: 0, by: h * 1.35 });
  }
  // mouth
  const mw = o.mouthW ?? 0.1, mp = o.mouthPitch ?? -16;
  const mpv = grp(F, 'mouth', onSphere(R * (o.mouthIn ?? 0.985), 0, mp), faceRot(0, mp));
  const lineM = o.lineMat || P.mat(o.mouthColor ?? 0x5a2236, { spec: 0.2, rim: 0.05, pure: true });
  const inM = o.inMat || P.mat(0x7a2238, { spec: 0.15, rim: 0, pure: true });
  const tongueM = o.tongueMat || P.mat(0xff7f9c, { spec: 0.25 });
  const M = {};
  if (o.wideMouth) {
    // surface-following jaw line (wide lizard smile / frown hugging the head curvature)
    const wm = o.wideMouth, k = o.wideCurve ?? 5, rr = R * (o.mouthIn ?? 0.985) * 1.005, tr = o.wideThick ?? 0.035;
    const line = (dir) => { const pts = []; for (let i = 0; i <= 16; i++) { const u = -1 + i / 8; pts.push(onSphere(rr, u * wm, mp + dir * k * (1 - u * u) - (dir < 0 ? 0 : k * 0.5))); } return tubeGeo(pts, { n: 40, rs: 6, radius: () => tr, capN: 2 }); };
    M.smile = add(F, line(-1), lineM, { name: 'jawSmile' });
    M.frown = add(F, line(1), lineM, { name: 'jawFrown' });
    M.smile.userData.wide = true;
  } else {
    M.smile = add(mpv, GEO.arcThin, lineM, { r: [0, 0, PI], p: [0, mw * 0.4, 0], s: [mw, mw * 0.8, mw * 0.7] });
    M.frown = add(mpv, GEO.arcThin, lineM, { p: [0, -mw * 0.42, 0], s: [mw * 0.85, mw * 0.62, mw * 0.7] });
  }
  M.grin = grp(mpv, 'grin');
  add(M.grin, GEO.dmouth, inM, { s: [mw * 1.05, mw * 1.0, mw * 0.5] });
  ell(M.grin, tongueM, [0, -mw * 0.52, mw * 0.11], mw * 0.55, mw * 0.3, mw * 0.12);
  M.open = grp(mpv, 'open');
  ell(M.open, inM, [0, 0, 0], mw * 0.72, mw * 0.8, mw * 0.26);
  ell(M.open, tongueM, [0, -mw * 0.42, mw * 0.13], mw * 0.5, mw * 0.3, mw * 0.15);
  M.o = ell(mpv, inM, [0, 0, 0], mw * 0.34, mw * 0.4, mw * 0.17);
  M.wavy = add(mpv, GEO.wavy, lineM, { s: [mw * 0.95, mw * 1.0, mw * 0.7] });
  for (const k in M) M[k].visible = false;
  // blush
  const cheekM = P.mat(o.cheekColor ?? 0xff8fb0, { unlit: true, transparent: true, opacity: 0.82, depthWrite: false, fogC: 0xa59bc4 });
  const cheeks = [];
  if (o.cheekYaw !== false) for (const sd of [-1, 1]) {
    const yaw = (o.cheekYaw ?? 36) * sd, pitch = o.cheekPitch ?? -6, cs = o.cheekS ?? 0.12;
    cheeks.push(add(F, UNIT.sphere, cheekM, { p: onSphere(R * (o.cheekIn ?? 0.995), yaw, pitch), r: faceRot(yaw, pitch), s: [cs, cs * 0.6, cs * 0.16], name: 'cheek' }));
  }
  const BROW = { // [visible, roll (inner-down +), y in h]
    angry: [1, 0.55, 0.86], sad: [1, -0.42, 1.08], surprised: [1, -0.08, 1.58], focus: [1, 0.3, 1.0],
  };
  const face = {
    F, eyes, mouthPivot: mpv, M, cheeks, cheekM, h, w, d, mw,
    expr: '', mouth: '', mouthS: 1, lookX: 0, lookY: 0, T: 0, blinkT: 1.2, blinkP: -1, blinkOn: true,
    set(e) {
      if (e === this.expr) return;
      this.expr = e;
      const openish = e === 'normal' || e === 'angry' || e === 'sad' || e === 'surprised' || e === 'tired' || e === 'focus';
      for (const E of eyes) {
        E.open.visible = openish;
        E.happy.visible = e === 'happy';
        E.hurt.visible = e === 'hurt';
        E.dizzy.visible = e === 'dizzy';
        E.closed.visible = e === 'closed';
        const s = e === 'surprised' ? 1.14 : 1;
        E.open.scale.set(s, s, s);
        const cut = EYE_CUT[e];
        if (cut) {
          E.oval.geometry = cut();
          E.oval.scale.set(w / 0.6, h, h);
          E.oval.rotation.y = (e === 'sad' ? E.sd > 0 : E.sd < 0) ? PI : 0;
        } else {
          E.oval.geometry = UNIT.sphere();
          E.oval.scale.set(w, h, d);
          E.oval.rotation.y = 0;
        }
        const H = EYE_HL[e] || EYE_HL.normal;
        E.hl.position.set(-E.sd * H[0] * h, H[1] * h, d * 0.72);
        E.hl.scale.set(w * 0.44 * H[2], h * 0.33 * H[2], d * 0.38);
      }
    },
    setMouth(m) {
      if (m === this.mouth) return;
      this.mouth = m;
      for (const k in M) M[k].visible = false;
      const key = { smile: 'smile', flat: 'smile', frown: 'frown', pout: 'frown', grin: 'grin', open: 'open', roar: 'open', o: 'o', wavy: 'wavy' }[m] || 'smile';
      M[key].visible = true;
      if (!M.smile.userData.wide) {
        M.smile.scale.set(mw * (m === 'flat' ? 0.7 : 1), mw * (m === 'flat' ? 0.2 : 0.8), mw * 0.7);
        M.frown.scale.set(mw * (m === 'pout' ? 0.55 : 0.85), mw * (m === 'pout' ? 0.45 : 0.62), mw * 0.7);
      }
      const os = m === 'roar' ? (o.roarS ?? 1.45) : 1;
      M.open.scale.set(os, os, 1);
    },
    look(x, y) { this.lookX = x; this.lookY = y; },
    update(dt) {
      this.T += dt;
      const e = this.expr;
      for (const E of eyes) {
        const b = BROW[e];
        const tv = b ? b[0] : 0, tr = b ? b[1] * E.sd : 0, ty = (b ? b[2] : 1.35) * h;
        E.bv = approach(E.bv, tv, 16, dt); E.br = approach(E.br, tr, 16, dt); E.by = approach(E.by, ty, 16, dt);
        E.brow.visible = E.bv > 0.04;
        E.brow.scale.set(E.bv, E.bv, E.bv);
        E.brow.rotation.z = E.br; E.brow.position.y = E.by;
        if (E.dizzy.visible) E.dizzy.rotation.z = this.T * 6 * E.sd;
        E.open.position.x = this.lookX * w * 0.38; E.open.position.y = this.lookY * h * 0.22;
      }
      const openish = e === 'normal' || e === 'angry' || e === 'sad' || e === 'surprised' || e === 'focus';
      let bl = 1;
      if (openish && this.blinkOn) {
        this.blinkT -= dt;
        if (this.blinkT <= 0 && this.blinkP < 0) { this.blinkP = 0; this.blinkT = 2 + B.rng.next() * 3; }
        if (this.blinkP >= 0) {
          this.blinkP += dt / 0.16;
          bl = this.blinkP < 0.5 ? 1 - this.blinkP * 2 : (this.blinkP - 0.5) * 2;
          if (this.blinkP >= 1) { this.blinkP = -1; bl = 1; }
        }
      }
      const s = e === 'surprised' ? 1.14 : 1;
      for (const E of eyes) E.open.scale.y = s * Math.max(0.08, bl);
      mpv.scale.set(this.mouthS, this.mouthS, this.mouthS);
    },
  };
  return face;
}

// dizzy stars orbiting a point
function makeStars(B, parent, o = {}) {
  const g = grp(parent, 'stars', o.p || [0, 0, 0]);
  const m = B.pal.mat(0xffe04a, { gloss: true, spec: 0.5, emissive: 0x4a3200, pure: true });
  const n = o.n ?? 4, R = o.r ?? 0.6, S = o.size ?? 0.3;
  const stars = [];
  for (let i = 0; i < n; i++) stars.push(add(g, UNIT.star, m, { s: S, name: 'star' }));
  g.visible = false;
  const api = {
    g, amt: 0, R, S,
    update(dt, T, on) {
      this.amt = approach(this.amt, on ? 1 : 0, on ? 8 : 12, dt);
      g.visible = this.amt > 0.02;
      if (!g.visible) return;
      for (let i = 0; i < n; i++) {
        const a = T * 2.8 + (i / n) * TAU, st = stars[i];
        st.position.set(Math.cos(a) * this.R, Math.sin(a * 2 + i) * this.R * 0.1, Math.sin(a) * this.R * 0.75);
        st.rotation.set(0, 0, T * 3 + i);
        const s = this.S * this.amt * (0.85 + 0.15 * Math.sin(T * 8 + i * 2));
        st.scale.set(s, s, s);
      }
    },
  };
  return api;
}

// ============================================================================
// Boss base
// ============================================================================
class Boss {
  constructor(id) {
    this.id = id;
    this.root = new Node('boss-' + id);
    this.pal = new Palette();
    this.parts = {};
    this.rng = new RNG(hashStr(id) % 100000 + 7);
    this.T = 0; this.anim = ''; this.prevAnim = ''; this.lastT = 0; this.blend = 1; this.blendDur = 0.25;
    this.def = {}; this.cur = {}; this.from = {}; this.tg = {};
    this.flashV = 0; this.opExt = 1; this.opInt = 1;
    this.purified = 0;
    this.ex = 'angry'; this.mo = 'frown';
    this.meshes = [];
    this.blends = {};
    this.face = null;
  }
  finish(def) {
    this.def = def;
    Object.assign(this.cur, def); Object.assign(this.from, def); Object.assign(this.tg, def);
    this.root.traverse((n) => { if (n.isMesh) { this.meshes.push(n); if (n.userData.op === undefined) n.userData.op = 1; } });
    if (this.centerY === undefined) this.centerY = this.height * 0.5;
    if (this.flying === undefined) this.flying = false;
    this.setPurified(0);
    this.update(0, { anim: 'idle', t: 0 });
  }
  get meshCount() { return this.meshes.length; }
  get happy() { return this.purified >= 0.5; }
  setFlash(v) { this.flashV = v; for (const m of this.meshes) m.flash = v; }
  setOpacity(v) { this.opExt = clamp(v, 0, 1); this.applyOpacity(); }
  applyOpacity() { const o = this.opExt * this.opInt; for (const m of this.meshes) m.opacity = o * m.userData.op; }
  setPurified(v) { this.purified = clamp(v, 0, 1); this.pal.set(this.purified); }
  update(dt, st = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    const anim = st.anim || 'idle';
    const t = Math.max(0, st.t ?? 0);
    this.T += dt;
    if (anim !== this.anim || t < this.lastT - 0.05) {
      Object.assign(this.from, this.cur);
      this.prevAnim = this.anim; this.anim = anim; this.blend = 0;
      this.blendDur = this.blends[anim] ?? 0.25;
      this.onStart?.(anim, st);
    }
    this.lastT = t;
    this.blend = this.blendDur > 0 ? Math.min(1, this.blend + dt / this.blendDur) : 1;
    const tg = this.tg;
    Object.assign(tg, this.def);
    this.ex = this.happy ? 'normal' : 'angry'; this.mo = this.happy ? 'smile' : 'frown';
    this.pose(tg, anim, t, st, dt);
    const b = this.blend, w = b * b * (3 - 2 * b), cur = this.cur, from = this.from;
    for (const k in tg) cur[k] = from[k] + (tg[k] - from[k]) * w;
    this.apply(cur, dt, st, anim, t);
    if (this.face) { this.face.set(this.ex); this.face.setMouth(this.mo); this.face.update(dt); }
    this.applyOpacity();
  }
  pose() {}
  apply() {}
}

// ============================================================================
// 1) mushking — 킹 버섯돌이 (3.6 tall)
// parts: cap, face, crown (+ body, handL, handR)
// ============================================================================
class MushKing extends Boss {
  constructor() {
    super('mushking');
    const P = this.pal;
    const stemM = (this.mStem = P.mat(0xfff0da));
    const capM = (this.mCap = P.mat(0xf2463e, { gloss: true }));
    const spotM = P.mat(0xffffff, { gloss: true, spec: 0.22 });
    const gillM = P.mat(0xf2d0b0);
    const footM = P.mat(0xbd7348, { gloss: true });
    const gloveM = P.mat(0xffffff);
    const goldM = (this.mGold = P.mat(0xffc83a, { gloss: true, spec: 0.7, emissive: 0x2c1a00 }));
    const jewelM = P.mat(0xff5aa0, { gloss: true, spec: 0.8, emissive: 0x2a0016 });
    const jewelB = P.mat(0x5cc8ff, { gloss: true, spec: 0.8, emissive: 0x001a2a });
    this.capTop = 3.49;
    this.flip = grp(this.root, 'flip', [0, this.capTop, 0]);
    this.base = grp(this.flip, 'base', [0, -this.capTop, 0]);
    this.body = grp(this.base, 'body', [0, 0.24, 0]);
    this.parts.body = this.body;
    add(this.body, () => G.cachedGeo('mk:stem', () => G.latheGeo([[0, 0], [0.58, 0], [0.86, 0.08], [1.0, 0.3], [1.05, 0.62], [1.04, 1.0], [0.99, 1.4], [0.9, 1.75], [0.78, 2.02], [0.5, 2.2], [0, 2.26]], 30)), stemM, { name: 'stem' });
    // cap
    const RX = 1.75, RY = 1.2;
    this.cap = grp(this.body, 'cap', [0, 2.05, 0]);
    this.parts.cap = this.cap;
    add(this.cap, () => G.cachedGeo('mk:dome', () => {
      const pr = [];
      for (let k = 0; k <= 18; k++) { const e = ((-12 + (k / 18) * 102) * PI) / 180; pr.push([RX * Math.cos(e), RY * Math.sin(e)]); }
      pr[pr.length - 1][0] = 0;
      return G.latheGeo(pr, 40);
    }), capM, { name: 'capDome' });
    add(this.cap, () => G.cachedGeo('mk:gills', () => G.latheGeo([[0, 0.05], [0.7, -0.02], [1.3, -0.14], [1.62, -0.23], [RX * Math.cos(-12 * PI / 180), RY * Math.sin(-12 * PI / 180)]], 40)), gillM, { name: 'gills' });
    add(this.cap, () => G.cachedGeo('mk:spots', () => {
      const items = [];
      const sp = (yawD, elD, s) => {
        const y = (yawD * PI) / 180, e = (elD * PI) / 180;
        const x = RX * Math.cos(e) * Math.sin(y), py = RY * Math.sin(e), z = RX * Math.cos(e) * Math.cos(y);
        let nx = x / (RX * RX), ny = py / (RY * RY), nz = z / (RX * RX);
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        items.push({ geo: UNIT.sphere, m: [x * 0.985, py * 0.985, z * 0.985, -Math.asin(ny), Math.atan2(nx, nz), 0, s, s, s * 0.24] });
      };
      for (let i = 0; i < 5; i++) sp(i * 72, 16, 0.38);
      for (let i = 0; i < 5; i++) sp(36 + i * 72, 50, 0.27);
      return mergePlain(items);
    }), spotM, { name: 'spots' });
    // crown
    this.crown = grp(this.cap, 'crown', [0.05, RY - 0.12, 0.05], [0, 0.3, 0.14]);
    this.parts.crown = this.crown;
    add(this.crown, () => G.cachedGeo('mk:crownGold', () => {
      const items = [{ geo: () => G.cylinderGeo(0.5, 0.54, 0.34, 24, 1, true), m: [0, 0.17, 0, 0, 0, 0, 1, 1, 1] }];
      items.push({ geo: UNIT.torus, m: [0, 0.03, 0, PI / 2, 0, 0, 0.54, 0.54, 0.5] });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; items.push({ geo: UNIT.cone, m: [Math.sin(a) * 0.43, 0.46, Math.cos(a) * 0.43, -Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12, 0.2, 0.3, 0.2] }); }
      return mergePlain(items);
    }), goldM, { name: 'crownGold' });
    add(this.crown, () => G.cachedGeo('mk:crownJw', () => {
      const items = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; items.push({ geo: UNIT.sphere, m: [Math.sin(a) * 0.47, 0.64, Math.cos(a) * 0.47, 0, 0, 0, 0.11, 0.11, 0.11] }); }
      return mergePlain(items);
    }), jewelM, { name: 'crownJewels' });
    ell(this.crown, jewelB, [0, 0.18, 0.53], 0.13, 0.13, 0.06);
    // face
    this.face = makeFace(this, this.body, { c: [0, 0.92, 0], R: 1.06, eyeH: 0.7, eyeYaw: 19.5, eyePitch: 11, mouthW: 0.22, mouthPitch: -13.5, mouthIn: 1.015, cheekYaw: 40, cheekPitch: -3, cheekS: 0.19, cheekIn: 1.0 });
    this.parts.face = this.face.F;
    // arms
    this.armL = grp(this.body, 'armL', [-0.98, 0.98, 0.1]);
    this.armR = grp(this.body, 'armR', [0.98, 0.98, 0.1]);
    for (const [a, sd] of [[this.armL, -1], [this.armR, 1]]) {
      ell(a, stemM, [0, -0.2, 0], 0.15, 0.28, 0.15);
      const hand = grp(a, sd < 0 ? 'handL' : 'handR', [0, -0.46, 0.02]);
      ell(hand, gloveM, [0, 0, 0], 0.21, 0.2, 0.2);
      ell(hand, gloveM, [-sd * 0.15, 0.06, 0.08], 0.08, 0.1, 0.08);
      this.parts[sd < 0 ? 'handL' : 'handR'] = hand;
    }
    // feet
    this.legL = grp(this.base, 'legL', [-0.46, 0.4, 0.05]);
    this.legR = grp(this.base, 'legR', [0.46, 0.4, 0.05]);
    for (const leg of [this.legL, this.legR]) ell(leg, footM, [0, -0.17, 0.12], 0.33, 0.22, 0.45, null, 'foot');
    // spores (cap puff FX)
    this.sporeM = P.mat(0xfff0a0, { transparent: true, opacity: 0.85, depthWrite: false, rim: 0.55, spec: 0, emissive: 0x3a3008, fogC: 0xb3a8d6 });
    this.spores = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.4, up = 0.25 + 0.6 * (((i * 37) % 10) / 10);
      const dx = Math.sin(a) * (1 - up * 0.45), dy = up + 0.3, dz = Math.cos(a) * (1 - up * 0.45), l = Math.hypot(dx, dy, dz);
      const m = ell(this.cap, this.sporeM, [0, 0, 0], 1, 1, 1, null, 'spore');
      m.visible = false;
      this.spores.push({ m, dir: [dx / l, dy / l, dz / l], sz: 0.28 + 0.22 * (((i * 53) % 10) / 10), start: [Math.sin(a) * 1.2, 0.6 + up * 0.5, Math.cos(a) * 1.2] });
    }
    this.stars = makeStars(this, this.root, { n: 4, r: 0.9, size: 0.36 });
    this.capSpring = new Spring(110, 9);
    this.ph = 0;
    this.height = 3.9;
    this.radius = 1.75;
    this.blends = { land: 0.06, hurt: 0.06, stuck: 0.35, defeated: 0.6, jumpAir: 0.12, spore: 0.15 };
    this.finish({
      by: 0, sq: 0, lean: 0, roll: 0, twist: 0,
      capX: 0, capZ: 0, capY: 0, capS: 1, capSY: 1,
      aLz: -0.42, aRz: 0.42, aLx: 0, aRx: 0,
      lLx: 0, lRx: 0, lLy: 0, lRy: 0, lLz: 0, lRz: 0, legF: 0,
      tumble: 0, crownZ: 0, look: 0, lookY: 0, glow: 0, crownGlow: 0, mouthS: 1,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, br = Math.sin(T * 2.3), happy = this.happy;
    this.starsOn = false;
    switch (anim) {
      case 'walk': {
        const sp = clamp(st.speed ?? 0.7, 0, 1.5);
        this.ph += dt * (4 + 5 * sp);
        const s = Math.sin(this.ph), c = Math.cos(this.ph);
        tg.lLx = s * 0.6; tg.lRx = -s * 0.6;
        tg.lLy = Math.max(0, c) * 0.2; tg.lRy = Math.max(0, -c) * 0.2;
        tg.roll = s * 0.08; tg.by = Math.abs(c) * 0.07; tg.sq = -(1 - Math.abs(c)) * 0.03;
        tg.aLx = -s * 0.55; tg.aRx = s * 0.55; tg.aLz = -0.5; tg.aRz = 0.5;
        tg.lean = 0.04 + 0.05 * sp;
        tg.capZ = -s * 0.06; tg.capX = 0.02 + Math.abs(c) * 0.03;
        tg.look = 0;
        break;
      }
      case 'jumpCrouch': {
        const u = Ease.outCubic(ramp(t, 0, 0.35));
        tg.sq = -0.27 * u; tg.by = -0.04 * u;
        tg.aLz = lerp(-0.42, -0.25, u); tg.aRz = -tg.aLz; tg.aLx = 0.75 * u; tg.aRx = 0.75 * u;
        tg.lean = 0.12 * u; tg.capSY = 1 - 0.08 * u; tg.capX = 0.1 * u;
        if (t > 0.35) tg.roll = Math.sin(T * 45) * 0.012;
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'pout';
        break;
      }
      case 'jumpAir': {
        const vy = st.vy ?? 3, rising = vy > -1;
        tg.sq = rising ? 0.12 : 0.03;
        tg.aLz = -2.35 + Math.sin(T * 13) * 0.12; tg.aRz = 2.35 - Math.sin(T * 13 + 0.5) * 0.12;
        tg.lLx = 0.4; tg.lRx = -0.25; tg.lLy = 0.06; tg.lRy = 0.1;
        tg.capSY = rising ? 0.9 : 1.08; tg.capS = rising ? 0.98 : 1.03;
        tg.lean = rising ? -0.08 : 0.06;
        this.mo = rising ? 'open' : 'o';
        break;
      }
      case 'land': {
        const k = Math.exp(-t * 6.5);
        tg.sq = -0.34 * k * Math.cos(t * 16);
        tg.capSY = 1 + 0.14 * k * Math.cos(t * 16 + 0.8);
        tg.aLz = -0.42 - 1.0 * k; tg.aRz = 0.42 + 1.0 * k;
        tg.lean = 0.05 * k;
        this.mo = t < 0.3 ? 'open' : 'frown';
        if (happy) this.mo = t < 0.3 ? 'open' : 'smile';
        break;
      }
      case 'stuck': {
        tg.tumble = 1;
        tg.lLx = Math.sin(T * 10) * 0.75; tg.lRx = Math.sin(T * 10 + PI) * 0.75;
        tg.lLz = -0.3; tg.lRz = 0.3;
        tg.twist = Math.sin(T * 2.6) * 0.1;
        tg.aLz = -1.5 + Math.sin(T * 12) * 0.35; tg.aRz = 1.5 - Math.sin(T * 12 + 1) * 0.35;
        tg.glow = 0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(T * 5.5), 2);
        tg.sq = Math.sin(T * 10) * 0.02;
        this.ex = 'dizzy'; this.mo = 'wavy'; this.starsOn = true;
        break;
      }
      case 'spore': {
        const inh = Ease.inOutSine(ramp(t, 0, 0.45));
        if (t < 0.45) { tg.capS = 1 + 0.14 * inh; tg.capSY = 1 + 0.06 * inh; tg.sq = -0.1 * inh; }
        else if (t < 0.58) { const u = Ease.outCubic(ramp(t, 0.45, 0.58)); tg.capS = lerp(1.14, 0.9, u); tg.capSY = lerp(1.06, 0.82, u); tg.sq = lerp(-0.1, 0.1, u); }
        else { const k = decay(t - 0.58, 5, 14); tg.capS = 1 - 0.1 * k; tg.capSY = 1 - 0.18 * k; tg.sq = 0.1 * k; }
        tg.aLz = -0.42 - 0.6 * inh + (t > 0.45 ? -0.6 * win(t, 0.45, 1.0) : 0); tg.aRz = -tg.aLz;
        tg.lean = -0.06 * inh;
        this.mo = t < 0.45 ? 'pout' : t < 0.9 ? 'open' : happy ? 'smile' : 'frown';
        break;
      }
      case 'summon': {
        const up = Ease.outBack(ramp(t, 0, 0.35));
        tg.aLz = lerp(-0.42, -2.5, up); tg.aRz = -tg.aLz;
        const hp = ramp(t, 0.35, 0.62);
        tg.by = Math.sin(hp * PI) * 0.45;
        tg.sq = t < 0.35 ? 0.06 * up : t < 0.62 ? 0.1 : -0.26 * decay(t - 0.62, 6, 15);
        if (t > 0.62) { const wv = Math.sin(T * 9) * 0.22 * ramp(t, 0.62, 0.8); tg.aLz += wv; tg.aRz += wv; }
        tg.crownGlow = win(t, 0.25, 1.3);
        tg.lean = -0.08 * up;
        this.mo = 'open';
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5), a = Ease.outCubic(ramp(t, 0, 0.08));
        tg.lean = -0.32 * a * (0.3 + 0.7 * k); tg.sq = -0.16 * k * Math.cos(t * 15);
        tg.capX = -0.18 * k; tg.capSY = 1 + 0.1 * k * Math.cos(t * 15 + 1);
        tg.aLz = -1.5; tg.aRz = 1.5; tg.aLx = -0.3; tg.aRx = -0.3;
        tg.lLx = 0.25; tg.lRx = -0.15;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.by = -0.27; tg.legF = 0.55; tg.lLx = -1.0; tg.lRx = -1.0; tg.lLz = -0.15; tg.lRz = 0.15;
        tg.lean = -0.1 + Math.sin(T * 1.6) * 0.02; tg.roll = Math.sin(T * 1.2) * 0.04;
        tg.aLz = -0.35; tg.aRz = 0.35; tg.aLx = -0.4; tg.aRx = -0.4;
        tg.crownZ = 0.3; tg.capZ = 0.06; tg.sq = br * 0.015 - 0.04;
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: { // idle
        tg.sq = br * 0.02; tg.capY = br * 0.015;
        tg.capZ = Math.sin(T * 0.8) * 0.035; tg.capX = Math.sin(T * 0.6) * 0.02;
        tg.aLz = -0.42 - br * 0.07; tg.aRz = 0.42 + br * 0.07;
        tg.look = Math.sin(T * 0.45) * 0.5; tg.roll = Math.sin(T * 0.8) * 0.015;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    const tb = c.tumble;
    this.flip.rotation.z = tb * (PI - 0.42);
    this.flip.position.y = lerp(this.capTop, -0.3, tb) + Math.sin(tb * PI) * 0.8;
    this.base.rotation.set(c.lean - 0.0, c.twist, c.roll);
    this.body.position.y = 0.24 + c.by;
    const sy = 1 + c.sq, sxz = 1 - c.sq * 0.5;
    this.body.scale.set(sxz, sy, sxz);
    const wob = this.capSpring.update(-c.sq * 0.5, dt);
    this.cap.position.y = 2.05 + c.capY;
    this.cap.rotation.set(c.capX - 0.07, 0, c.capZ);
    this.cap.scale.set(c.capS, c.capS * c.capSY * (1 + wob * 0.25), c.capS);
    this.armL.rotation.set(c.aLx, 0, c.aLz); this.armR.rotation.set(c.aRx, 0, c.aRz);
    this.legL.position.set(-0.46, 0.4 + c.lLy, 0.05 + c.legF); this.legR.position.set(0.46, 0.4 + c.lRy, 0.05 + c.legF);
    this.legL.rotation.set(c.lLx, 0, c.lLz); this.legR.rotation.set(c.lRx, 0, c.lRz);
    this.crown.rotation.z = 0.14 + c.crownZ;
    const g = c.glow;
    this.pal.glowAdd(this.mStem, 0.5 * g, 0.36 * g, 0.14 * g);
    const cg = c.crownGlow;
    this.pal.glowAdd(this.mGold, 0.45 * cg, 0.35 * cg, 0.1 * cg);
    this.face.look(c.look, c.lookY);
    this.face.mouthS = c.mouthS;
    // spores
    const sp = anim === 'spore' ? (t - 0.47) / 1.25 : -1;
    const on = sp > 0 && sp < 1;
    if (on) this.sporeM.opacity = 0.85 * (1 - sp * sp);
    for (const s of this.spores) {
      s.m.visible = on;
      if (!on) continue;
      const d = 0.2 + 1.8 * Ease.outCubic(sp), sz = s.sz * (0.5 + 1.1 * sp);
      s.m.position.set(s.start[0] + s.dir[0] * d, s.start[1] + s.dir[1] * d + sp * 0.6, s.start[2] + s.dir[2] * d);
      s.m.scale.set(sz, sz, sz);
    }
    this.stars.g.position.set(lerp(0, -0.9, tb), lerp(4.1, 3.4, tb), 0);
    this.stars.update(dt, T, this.starsOn);
  }
}


// ============================================================================
// leaf outlines (star-shaped around origin, base at y=0 after translate)
// ============================================================================
function leafOutline(n = 40, lobes = 0, lobeAmt = 0.16, width = 0.5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let x = Math.cos(a) * width, y = Math.sin(a) * 0.6;
    if (y > 0) y *= 1 + 0.55 * Math.pow(y / 0.6, 2);
    if (lobes) { const k = 1 + lobeAmt * Math.cos((a - PI / 2) * lobes); x *= k; y *= k > 1 ? 1 + (k - 1) * 0.6 : k; }
    out.push([x, y]);
  }
  return out;
}
const LEAF = {
  small: () => G.cachedGeo('b:leafS', () => G.puffyShapeGeo(leafOutline(36, 0, 0, 0.42), 0.09, 4, 0.6).translate(0, 0.6, 0)),
  big: () => G.cachedGeo('b:leafB', () => G.puffyShapeGeo(leafOutline(60, 5, 0.17, 0.62), 0.1, 4, 0.6).translate(0, 0.6, 0)),
};

// ============================================================================
// 2) pumpkin — 호박 대장 (3.3 tall)
// parts: handL, handR, mouth (+ body)
// ============================================================================
const PK_REST_L = [-1.62, 1.02, 0.95], PK_REST_R = [1.62, 1.02, 0.95];
class Pumpkin extends Boss {
  constructor() {
    super('pumpkin');
    const P = this.pal;
    const bodyM = (this.mBody = P.mat(0xff8a2a, { vertexColors: true, gloss: true, spec: 0.28, rim: 0.36 }));
    const glowM = (this.mGlowFace = P.mat(0xffd65a, { unlit: true, fogC: 0xcbbcff }));
    const glowHl = P.mat(0xfff6d6, { unlit: true, fogC: 0xf2eeff });
    const glowDeep = P.mat(0xff9a30, { unlit: true, fogC: 0x9c88dc });
    const vineM = P.mat(0x4fae4a);
    const leafM = P.mat(0x5fc458, { gloss: true, spec: 0.2 });
    const leafD = P.mat(0x45a24c);
    const stemM = P.mat(0x8f7c3c, { gloss: true, spec: 0.2 });
    const bootM = P.mat(0x3f8f46, { gloss: true });
    this.base = grp(this.root, 'base');
    this.bodyP = grp(this.base, 'body', [0, 1.45, 0]);
    this.parts.body = this.bodyP;
    this.pk = add(this.bodyP, () => G.cachedGeo('pk:body', () => {
      const g = G.sphereGeo(1, 63, 32);
      const p = g.attributes.position.array, n = p.length / 3, col = new Float32Array(n * 3);
      // vertex colors are multipliers (hue comes from the owned material so purification stays per-instance)
      const cLobe = [1, 1, 1], cGroove = [0.82, 0.68, 0.62], cTop = [1.0, 1.08, 1.05], cBot = [0.9, 0.84, 0.84];
      for (let i = 0; i < n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        const phi = Math.atan2(x, z), rxz = Math.hypot(x, z);
        let gv = Math.pow((1 + Math.cos(9 * phi)) / 2, 5);
        const front = Math.exp(-Math.pow(phi / 0.32, 2)) * smoothstep(0.3, -0.6, y);
        const A = 0.09 * rxz * (1 - 0.7 * front);
        const r = 1 - A * gv + 0.015 * (1 - gv);
        const th = Math.acos(clamp(y, -1, 1));
        let dy = 0;
        if (th < 0.55) dy -= 0.24 * Math.pow(1 - th / 0.55, 2);
        if (th > PI - 0.45) dy += 0.12 * Math.pow(1 - (PI - th) / 0.45, 2);
        p[i * 3] = x * r; p[i * 3 + 1] = y + dy; p[i * 3 + 2] = z * r;
        const g2 = gv * (1 - 0.7 * front) * rxz;
        let c = [lerp(cLobe[0], cGroove[0], g2), lerp(cLobe[1], cGroove[1], g2), lerp(cLobe[2], cGroove[2], g2)];
        const tt = smoothstep(0.55, 0.95, y), bb = smoothstep(-0.3, -1, y);
        c = c.map((v, k) => lerp(lerp(v, cTop[k], tt * 0.6), cBot[k], bb * 0.5));
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      g.setAttribute('color', col, 3);
      g.smoothNormalsByPosition();
      g.computeBoundingSphere();
      return g;
    }), bodyM, { s: [1.45, 1.12, 1.4], name: 'pumpkin' });
    // carved glowing face
    this.face = makeFace(this, this.bodyP, {
      c: [0, 0, 0], R: 1.4, eyeH: 0.78, eyeW: 0.66, eyeYaw: 20, eyePitch: 13, eyeIn: 0.99,
      eyeMat: glowM, hlMat: glowHl, noGlint: true, browMat: glowM,
      mouthW: 0.42, mouthPitch: -17, mouthIn: 0.99, lineMat: glowM, inMat: glowM, tongueMat: glowDeep, cheekYaw: false, roarS: 1.15,
    });
    this.parts.mouth = this.face.mouthPivot;
    // stem hat + curly tendril + leaf
    this.stem = grp(this.bodyP, 'stem', [0, 0.84, -0.02], [-0.08, 0, 0.18]);
    add(this.stem, () => G.cachedGeo('pk:stem', () => G.latheGeo([[0.3, -0.12], [0.27, 0.05], [0.21, 0.25], [0.18, 0.45], [0.2, 0.58], [0.26, 0.66], [0.2, 0.72], [0, 0.73]], 14)), stemM, { name: 'stemHat' });
    add(this.stem, () => G.cachedGeo('pk:tendril', () => {
      const pts = [];
      for (let i = 0; i <= 30; i++) { const u = i / 30, a = u * 2.6 * TAU, r = 0.32 - 0.2 * u; pts.push([0.18 + Math.cos(a) * r + u * 0.35, 0.05 + u * 0.75, Math.sin(a) * r]); }
      return tubeGeo(pts, { n: 70, rs: 6, radius: (u) => 0.055 * (1 - u * 0.5), capN: 2 });
    }), vineM, { name: 'tendril' });
    add(this.stem, LEAF.small, leafM, { p: [-0.15, 0.12, 0.08], r: [0.5, 0.6, 1.05], s: [0.62, 0.62, 0.62], name: 'hatLeaf' });
    // legs
    this.legL = grp(this.base, 'legL', [-0.62, 0.48, 0.05]);
    this.legR = grp(this.base, 'legR', [0.62, 0.48, 0.05]);
    for (const leg of [this.legL, this.legR]) ell(leg, bootM, [0, -0.26, 0.1], 0.3, 0.22, 0.4, null, 'boot');
    // arms: vine tubes from leaf epaulettes to leaf hands
    this.arms = grp(this.base, 'arms');
    this.vines = []; this.hands = []; this.shoulders = [];
    for (const sd of [-1, 1]) {
      const S = [sd * 1.3, 1.62, 0.22];
      this.shoulders.push(S);
      const ep = grp(this.arms, 'epaulette', S, [0, sd * 1.25, 0]);
      add(ep, () => G.cachedGeo('pk:epaulette', () => mergePlain([0, 1, 2, 3].map((i) => ({ geo: LEAF.small, m: [0, -0.05, -0.05, -0.9, 0, ((i - 1.5) / 1.5) * 1.0, 0.42, 0.4, 0.5] })))), leafD, { name: 'epaulette' });
      this.vines.push(new Tube(this, this.arms, vineM, { n: 18, rs: 9, radius: (u) => 0.16 - 0.05 * u, name: 'vine' }));
      const vl = [];
      for (let k = 0; k < 2; k++) { const n = grp(this.arms, 'vineLeaf'); add(n, LEAF.small, leafM, { r: [PI / 2 - 0.5, 0, sd * (k ? -0.75 : 0.75)], s: [0.4, 0.36, 0.5] }); vl.push(n); }
      this.vineLeaves = this.vineLeaves || [];
      this.vineLeaves.push(vl);
      const hand = grp(this.arms, sd < 0 ? 'handL' : 'handR');
      add(hand, () => G.cachedGeo('pk:hand', () => mergePlain([-1, 0, 1].map((i) => ({ geo: LEAF.small, m: [0, 0.04, 0, 0, 0, -i * 0.58, 0.46, 0.5, 0.8] })))), leafM, { r: [PI / 2, 0, 0], name: 'leafHand' });
      ell(hand, leafD, [0, 0, 0], 0.19, 0.19, 0.19, null, 'palm');
      this.hands.push(hand);
      this.parts[sd < 0 ? 'handL' : 'handR'] = hand;
    }
    // leaf cape: big leaves glued onto the upper back, hanging down the surface
    this.capeLeaves = [];
    for (const [yawD, pitchD, rz, sc, m] of [[148, 48, -0.3, 0.85, leafD], [-148, 48, 0.3, 0.85, leafD], [180, 56, 0, 0.98, leafM]]) {
      const yr = (yawD * PI) / 180, pr = (pitchD * PI) / 180, A = 1.45, Bv = 1.12, C = 1.4;
      const px = A * Math.cos(pr) * Math.sin(yr), py = Bv * Math.sin(pr), pz = C * Math.cos(pr) * Math.cos(yr);
      let nx = px / (A * A), ny = py / (Bv * Bv), nz = pz / (C * C);
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const pv = grp(this.bodyP, 'capeLeaf', [px * 0.97, py * 0.97, pz * 0.97], [-Math.asin(ny), Math.atan2(nx, nz), 0]);
      const leaf = add(pv, LEAF.big, m, { r: [0.3, 0, PI + rz], s: [sc, sc, sc] });
      this.capeLeaves.push({ pv, leaf, rz, ph: yawD * 0.05 });
    }
    this.stars = makeStars(this, this.root, { n: 4, r: 1.0, size: 0.38, p: [0, 3.6, 0] });
    this.spin = 0; this.ph = 0;
    this.capeSpring = new Spring(60, 6);
    this.height = 3.4;
    this.radius = 1.6;
    this.blends = { hurt: 0.06, roll: 0.3, dizzy: 0.35, defeated: 0.6 };
    this._ctrl = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    this._end = { p: [0, 0, 0], t: [0, 0, 1] };
    this._pa = [0, 0, 0]; this._pb = [0, 0, 0];
    this.finish({
      by: 0, sq: 0, puff: 0, lean: 0, roll: 0, twist: 0, tuck: 0,
      hLx: PK_REST_L[0], hLy: PK_REST_L[1], hLz: PK_REST_L[2], hRx: PK_REST_R[0], hRy: PK_REST_R[1], hRz: PK_REST_R[2],
      lLx: 0, lRx: 0, lLy: 0, lRy: 0, legF: 0,
      capeLift: 0, stemTilt: 0, glow: 0, faceGlow: 0, mouthS: 1, look: 0, sink: 0,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, br = Math.sin(T * 2.1), happy = this.happy;
    this.starsOn = false;
    this.spinRate = 0;
    const handsRest = (k = 1) => {
      tg.hLy = PK_REST_L[1] + Math.sin(T * 2.1) * 0.06 * k; tg.hRy = PK_REST_R[1] + Math.sin(T * 2.1 + 0.6) * 0.06 * k;
    };
    switch (anim) {
      case 'walk': {
        const sp = clamp(st.speed ?? 0.7, 0, 1.5);
        this.ph += dt * (4.2 + 4.5 * sp);
        const s = Math.sin(this.ph), c = Math.cos(this.ph);
        tg.lLx = s * 0.65; tg.lRx = -s * 0.65; tg.lLy = Math.max(0, c) * 0.2; tg.lRy = Math.max(0, -c) * 0.2;
        tg.roll = s * 0.07; tg.by = Math.abs(c) * 0.07; tg.sq = -(1 - Math.abs(c)) * 0.025;
        tg.hLz = PK_REST_L[2] - s * 0.45; tg.hRz = PK_REST_R[2] + s * 0.45; tg.hLy = 1.0 + Math.max(0, -s) * 0.2; tg.hRy = 1.0 + Math.max(0, s) * 0.2;
        tg.lean = 0.05 + 0.04 * sp; tg.capeLift = 0.15 + 0.2 * sp; tg.stemTilt = -s * 0.08;
        break;
      }
      case 'rollStart': {
        const u = Ease.inOutSine(ramp(t, 0, 0.35));
        tg.tuck = u; tg.sq = -0.14 * win(t, 0, 0.5); tg.lean = 0.18 * u;
        tg.hLx = lerp(PK_REST_L[0], -1.15, u); tg.hLy = lerp(PK_REST_L[1], 1.5, u); tg.hLz = lerp(PK_REST_L[2], 0.2, u);
        tg.hRx = -tg.hLx; tg.hRy = tg.hLy; tg.hRz = tg.hLz;
        tg.capeLift = 0.4 * u;
        this.spinRate = 9 * Ease.inCubic(ramp(t, 0.25, 0.6));
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'grin';
        break;
      }
      case 'roll': {
        tg.tuck = 1; tg.capeLift = 0.45;
        tg.hLx = -1.15; tg.hLy = 1.5; tg.hLz = 0.2; tg.hRx = 1.15; tg.hRy = 1.5; tg.hRz = 0.2;
        this.spinRate = 6 + 8 * clamp(st.speed ?? 0.8, 0, 1.5);
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'grin';
        break;
      }
      case 'dizzy': {
        const a = T * 2.6;
        tg.lean = Math.cos(a) * 0.1; tg.roll = Math.sin(a) * 0.12; tg.sq = -0.05 + Math.sin(a * 2) * 0.02;
        tg.hLx = -1.55; tg.hLy = 0.75 + Math.sin(a) * 0.12; tg.hLz = 0.85; tg.hRx = 1.55; tg.hRy = 0.75 - Math.sin(a) * 0.12; tg.hRz = 0.85;
        tg.stemTilt = Math.sin(a) * 0.25; tg.glow = 0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(T * 5.5), 2);
        this.ex = 'dizzy'; this.mo = 'wavy'; this.starsOn = true;
        break;
      }
      case 'throwSeeds': {
        const wind = Ease.inOutSine(ramp(t, 0, 0.45));
        let shot = 0;
        for (const s0 of [0.5, 0.8, 1.1]) shot = Math.max(shot, win(t, s0 - 0.04, s0 + 0.16));
        const rec = ramp(t, 1.2, 1.5);
        tg.lean = (-0.16 * wind + 0.2 * shot) * (1 - rec);
        tg.puff = (0.08 * wind - 0.06 * shot) * (1 - rec);
        tg.sq = -0.08 * shot;
        tg.mouthS = 1 + 0.25 * shot;
        tg.hLx = -1.65; tg.hLy = 1.25 + 0.45 * wind - 0.25 * shot; tg.hLz = 0.75 + 0.35 * shot;
        tg.hRx = 1.65; tg.hRy = tg.hLy; tg.hRz = tg.hLz;
        if (rec > 0) { const u = Ease.inOutSine(rec); tg.hLx = lerp(-1.55, PK_REST_L[0], u); tg.hLy = lerp(tg.hLy, PK_REST_L[1], u); tg.hLz = lerp(tg.hLz, PK_REST_L[2], u); tg.hRx = -tg.hLx; tg.hRy = tg.hLy; tg.hRz = tg.hLz; }
        this.mo = t < 0.45 ? 'pout' : shot > 0.3 ? 'open' : happy ? 'smile' : 'frown';
        break;
      }
      case 'vineWhip': {
        const side = st.hand === 'L' ? -1 : 1;
        const wind = Ease.inOutSine(ramp(t, 0, 0.5));
        const sweep = Ease.inOutCubic(ramp(t, 0.5, 0.85));
        const back = Ease.inOutSine(ramp(t, 1.1, 1.5));
        const rest = side < 0 ? PK_REST_L : PK_REST_R;
        let hx, hy, hz;
        if (t < 0.5) { hx = lerp(rest[0], side * 1.9, wind); hy = lerp(rest[1], 2.7, wind); hz = lerp(rest[2], -1.5, wind); }
        else if (t < 1.1) {
          const a = lerp(side * 2.1, -side * 1.05, sweep) + (t > 0.85 ? -side * 0.08 * Math.sin(ramp(t, 0.85, 1.1) * PI) : 0);
          const R = 3.3 * (0.75 + 0.25 * Math.sin(sweep * PI)) + 0.25;
          hx = Math.sin(a) * R; hz = Math.cos(a) * R; hy = lerp(2.7, 1.05, Ease.outCubic(ramp(t, 0.5, 0.62)));
        } else {
          const a = -side * 1.05, R = 3.3 * 0.75 + 0.25;
          hx = lerp(Math.sin(a) * R, rest[0], back); hz = lerp(Math.cos(a) * R, rest[2], back); hy = lerp(1.05, rest[1], back);
        }
        if (side < 0) { tg.hLx = hx; tg.hLy = hy; tg.hLz = hz; } else { tg.hRx = hx; tg.hRy = hy; tg.hRz = hz; }
        tg.twist = side * (-0.22 * wind * (1 - sweep) + 0.28 * sweep * (1 - back));
        tg.lean = -0.06 * wind + 0.1 * win(t, 0.5, 1.0);
        tg.roll = -side * 0.06 * win(t, 0.4, 1.0);
        this.mo = t > 0.45 && t < 1.0 ? 'roar' : happy ? 'smile' : 'frown';
        break;
      }
      case 'summon': {
        const up = Ease.outBack(ramp(t, 0, 0.4));
        const wv = Math.sin(T * 8) * 0.25 * ramp(t, 0.4, 0.6);
        tg.hLx = lerp(PK_REST_L[0], -1.5, up) + wv; tg.hLy = lerp(PK_REST_L[1], 3.1, up); tg.hLz = lerp(PK_REST_L[2], 0.6, up);
        tg.hRx = lerp(PK_REST_R[0], 1.5, up) + wv; tg.hRy = tg.hLy; tg.hRz = tg.hLz;
        tg.sq = 0.06 * up - 0.2 * decay(Math.max(0, t - 0.6), 6, 14) * (t > 0.6 ? 1 : 0);
        tg.by = Math.sin(ramp(t, 0.35, 0.6) * PI) * 0.35;
        tg.faceGlow = win(t, 0.3, 1.3); tg.lean = -0.08 * up;
        this.mo = 'roar';
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5), a = Ease.outCubic(ramp(t, 0, 0.08));
        tg.lean = -0.3 * a * (0.3 + 0.7 * k); tg.sq = -0.15 * k * Math.cos(t * 15);
        tg.hLx = -2.0; tg.hLy = 2.0; tg.hLz = 0.2; tg.hRx = 2.0; tg.hRy = 2.0; tg.hRz = 0.2;
        tg.stemTilt = -0.3 * k; tg.capeLift = 0.3 * k;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.by = -0.3; tg.legF = 0.5; tg.lLx = -1.1; tg.lRx = -1.1; tg.lLy = -0.04; tg.lRy = -0.04;
        tg.lean = -0.08 + Math.sin(T * 1.5) * 0.02; tg.roll = Math.sin(T * 1.1) * 0.04;
        tg.hLx = -1.8; tg.hLy = 0.62; tg.hLz = 0.55; tg.hRx = 1.8; tg.hRy = 0.62; tg.hRz = 0.55;
        tg.stemTilt = 0.15; tg.faceGlow = 0.35;
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: {
        tg.sq = br * 0.02; handsRest(); tg.look = Math.sin(T * 0.5) * 0.4; tg.stemTilt = Math.sin(T * 0.9) * 0.05;
        tg.capeLift = 0.05 + Math.sin(T * 1.3) * 0.04;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    // body + roll
    this.spin += this.spinRate * dt;
    if (this.spinRate === 0) { const tgt = Math.round(this.spin / TAU) * TAU; this.spin = approach(this.spin, tgt, 6, dt); }
    const th = this.spin;
    const support = Math.sqrt(Math.pow(1.4 * Math.sin(th), 2) + Math.pow(1.12 * Math.cos(th), 2));
    const bodyY = lerp(1.45, support + 0.02, c.tuck);
    this.base.rotation.set(c.lean, c.twist, c.roll);
    this.bodyP.position.y = bodyY + c.by;
    this.bodyP.rotation.set(th, 0, 0);
    const sy = 1 + c.sq, sxz = (1 - c.sq * 0.5) * (1 + c.puff);
    this.bodyP.scale.set(sxz, sy, sxz);
    this.stem.rotation.z = 0.18 + c.stemTilt;
    // legs (retract when tucked)
    const lt = 1 - c.tuck;
    for (const [leg, sd, lx, ly] of [[this.legL, -1, c.lLx, c.lLy], [this.legR, 1, c.lRx, c.lRy]]) {
      leg.visible = lt > 0.05;
      leg.position.set(sd * 0.62 * (0.6 + 0.4 * lt), 0.48 + ly + (1 - lt) * 0.5, 0.05 + c.legF);
      leg.rotation.x = lx;
      leg.scale.set(lt, lt, lt);
    }
    // arms
    this.arms.position.y = c.by + (bodyY - 1.45);
    const hp = [[c.hLx, c.hLy, c.hLz], [c.hRx, c.hRy, c.hRz]];
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1, S = this.shoulders[i], H = hp[i];
      const vis = c.tuck < 0.92;
      this.vines[i].mesh.visible = vis; this.hands[i].visible = vis;
      for (const n of this.vineLeaves[i]) n.visible = vis;
      if (!vis) continue;
      const dx = H[0] - S[0], dy = H[1] - S[1], dz = H[2] - S[2], L = Math.hypot(dx, dy, dz) || 1;
      const k = this._ctrl;
      k[0][0] = S[0] - sd * 0.25; k[0][1] = S[1]; k[0][2] = S[2];
      k[1][0] = S[0] + sd * 0.32; k[1][1] = S[1] + 0.02; k[1][2] = S[2] + 0.06;
      const sag = 0.06 + 0.1 * Math.min(L, 3) + Math.sin(T * 2.3 + i) * 0.04;
      const wig = Math.sin(T * 3.1 + i * 2) * 0.06;
      k[2][0] = S[0] + dx * 0.5 + sd * 0.22; k[2][1] = S[1] + dy * 0.45 + sag * 0.6 + wig; k[2][2] = S[2] + dz * 0.5 + 0.08;
      k[3][0] = H[0]; k[3][1] = H[1]; k[3][2] = H[2];
      this.vines[i].set(k);
      const VS = this.vines[i].S;
      for (let j = 0; j < 2; j++) {
        const u = j ? 0.72 : 0.42, a = VS.at(u, this._pa), b = VS.at(u + 0.04, this._pb);
        const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2], tl = Math.hypot(tx, ty, tz) || 1;
        const n = this.vineLeaves[i][j];
        n.position.set(a[0], a[1], a[2]);
        n.rotation.set(-Math.asin(clamp(ty / tl, -1, 1)), Math.atan2(tx, tz), 0);
      }
      const e = VS.end(this._end);
      const hand = this.hands[i];
      hand.position.set(e.p[0], e.p[1], e.p[2]);
      hand.rotation.set(-Math.asin(clamp(e.t[1], -1, 1)), Math.atan2(e.t[0], e.t[2]), 0);
      const hs = 0.6 + 0.4 * (1 - c.tuck);
      hand.scale.set(hs, hs, hs);
    }
    // cape leaves: lean into the back, lifted by wind (walk / roll) with flutter
    const sway = this.capeSpring.update(-c.twist * 0.8 - c.roll * 0.5, dt);
    const lift = c.capeLift;
    for (const L of this.capeLeaves) {
      const flap = Math.sin(T * (lift > 0.6 ? 18 : 2.2) + L.ph) * (lift > 0.6 ? 0.14 : 0.035);
      L.leaf.rotation.set(0.42 - lift * 0.7 + flap, 0, PI + L.rz + sway * 0.25);
    }
    // face glow / weak point
    const fg = c.faceGlow;
    this.pal.glowAdd(this.mGlowFace, 0.25 * fg, 0.2 * fg, 0.1 * fg);
    const g = c.glow;
    this.pal.glowAdd(this.mBody, 0.42 * g, 0.3 * g, 0.12 * g);
    this.face.look(c.look, 0);
    this.face.mouthS = c.mouthS;
    this.stars.update(dt, T, this.starsOn);
  }
}

// ============================================================================
// 3) thundercloud — 우르릉 번개구름 (4.6 wide, floats; origin = cloud center)
// parts: core (+ body, bolt origin 'boltBase')
// st.boltLen: distance from cloud center down to the ground (strike bolt length, default 6)
// ============================================================================
const TC_PUFFS = [ // x, y, z, r, sy, dark?
  [0, 0, 0, 1.35, 1, 0], [-1.32, -0.18, -0.12, 1.0, 0.95, 0], [1.32, -0.18, -0.12, 1.0, 0.95, 0],
  [-1.95, -0.38, -0.25, 0.62, 0.9, 0], [1.95, -0.38, -0.25, 0.62, 0.9, 0],
  [-0.66, 0.98, -0.25, 0.84, 1, 0], [0.66, 0.98, -0.25, 0.84, 1, 0], [0, 1.12, -0.62, 0.78, 1, 0],
  [0, 0.25, -1.0, 1.15, 1, 0], [-1.1, 0.45, -0.85, 0.8, 1, 0], [1.1, 0.45, -0.85, 0.8, 1, 0],
  [0, -0.78, 0.15, 0.98, 0.62, 1], [-0.98, -0.84, 0.05, 0.72, 0.6, 1], [0.98, -0.84, 0.05, 0.72, 0.6, 1], [0, -0.8, -0.75, 0.9, 0.6, 1],
];
class ThunderCloud extends Boss {
  constructor() {
    super('thundercloud');
    const P = this.pal;
    const cloudM = (this.mCloud = P.mat(0xf7f6ff, { rim: 0.5, spec: 0.08, fogC: 0x75709a }));
    const cloudD = (this.mCloudD = P.mat(0xe2e2f6, { rim: 0.45, spec: 0.05, fogC: 0x5b5578 }));
    const hornM = (this.mHorn = P.mat(0xffd93a, { gloss: true, spec: 0.5, emissive: 0x3a2a00, fogC: 0xc2b68a, fogEm: 0x100c00 }));
    this.body = grp(this.root, 'body');
    this.parts.body = this.body;
    this.puffs = [];
    TC_PUFFS.forEach(([x, y, z, r, sy, dk], i) => {
      const m = ell(this.body, dk ? cloudD : cloudM, [x, y, z], r, r * sy, r, null, 'puff');
      this.puffs.push({ m, x, y, z, r, sy, ph: i * 1.7 });
    });
    this.topPuffs = [5, 6, 7].map((i) => this.puffs[i]);
    // face on the center puff
    this.face = makeFace(this, this.body, { c: [0, 0, 0], R: 1.35, eyeH: 0.74, eyeYaw: 21, eyePitch: 9, mouthW: 0.24, mouthPitch: -16, cheekYaw: 40, cheekPitch: -10, cheekS: 0.2 });
    // puffy cheeks (inflate when charging / blowing)
    this.cheeks = [];
    for (const sd of [-1, 1]) {
      const p = onSphere(1.18, 47 * sd, -17);
      const m = ell(this.body, cloudM, p, 0.42, 0.38, 0.38, null, 'cheekPuff');
      this.cheeks.push({ m, p });
    }
    // lightning-bolt horns
    this.horns = [];
    for (const sd of [-1, 1]) {
      const pv = grp(this.body, sd < 0 ? 'hornL' : 'hornR', [sd * 0.78, 1.62, 0.18], [0, 0, -sd * 0.38]);
      add(pv, GEO.bolt, hornM, { p: [0, 0.42, 0], r: [0, sd < 0 ? PI : 0, 0], s: [0.5, 0.52, 1.0] });
      this.horns.push({ pv, sd });
    }
    // core (weak point): star + glow, hidden under the top puffs
    const coreM = (this.mCore = P.mat(0xffe35a, { unlit: true, pure: true }));
    this.coreGlowM = P.glow(0xffd84a, { opacity: 0.0, pure: true });
    this.core = grp(this.body, 'core', [0, 1.3, -0.15]);
    this.parts.core = this.core;
    this.coreStar = add(this.core, UNIT.star, coreM, { s: 0.8, name: 'coreStar' });
    this.coreGlow = ell(this.core, this.coreGlowM, [0, 0, 0], 0.75, 0.75, 0.75, null, 'coreGlow');
    // charge sparks (little bolts flickering around the cloud)
    this.sparkM = P.mat(0xffe24a, { unlit: true, pure: true });
    this.sparks = [];
    for (let i = 0; i < 6; i++) { const m = add(this.body, GEO.bolt, this.sparkM, { s: 0.22, name: 'spark' }); m.visible = false; this.sparks.push(m); }
    // rain drops
    this.dropM = P.mat(0x7ccaff, { gloss: true, spec: 0.5, transparent: true, opacity: 0.9, depthWrite: false, fogC: 0x9b93c0 });
    this.drops = [];
    for (let i = 0; i < 10; i++) {
      const m = add(this.root, GEO.drop, this.dropM, { s: 0.13, name: 'drop' });
      m.visible = false;
      this.drops.push({ m, x: ((i * 0.618) % 1) * 3.4 - 1.7, z: (((i * 0.382) % 1) - 0.5) * 1.4, off: (i * 0.37) % 1 });
    }
    // sweat drop (tired)
    this.sweat = add(this.body, GEO.drop, this.dropM, { p: [1.05, 0.75, 0.75], r: [0, 0, 0.3], s: 0.16, name: 'sweat' });
    this.sweat.visible = false;
    // lightning strike bolt (dynamic zigzag tube + glow)
    this.boltBase = grp(this.root, 'boltBase', [0, -1.0, 0.25]);
    this.parts.boltBase = this.boltBase;
    this.boltCore = new Tube(this, this.root, P.mat(0xfffbe0, { unlit: true, pure: true }), { n: 40, rs: 6, radius: (u) => 0.13 * (1 - 0.3 * u), name: 'bolt', capN: 2, linear: true, ds: 6 });
    this.boltGlow = new Tube(this, this.root, P.mat(0xffd83a, { unlit: true, transparent: true, opacity: 0.75, depthWrite: false, pure: true }), { n: 40, rs: 8, radius: (u) => 0.3 * (1 - 0.3 * u), name: 'boltGlow', capN: 2, linear: true, ds: 6 });
    this.boltPts = [];
    for (let i = 0; i < 6; i++) this.boltPts.push([0, 0, 0]);
    this.boltSeed = 0;
    // rainbow (purified / defeated)
    this.rainbow = add(this.root, () => G.cachedGeo('tc:rainbow', () => {
      const cols = [0xff6b6b, 0xffa94d, 0xffe066, 0x7be07b, 0x6cc6ff, 0xb48cff];
      return mergeColored(cols.map((c, i) => ({ geo: () => G.torusGeo(1, 0.09, 6, 40, PI), m: [0, 0, 0, 0, 0, 0, 1 + i * -0.13, 1 + i * -0.13, 1], c })));
    }), P.mat(0xffffff, { vertexColors: true, unlit: true, pure: true, transparent: true, opacity: 0.9, depthWrite: false }), { p: [0, -0.4, -1.4], s: 3.4, name: 'rainbow' });
    this.rainbow.visible = false;
    this.stars = makeStars(this, this.root, { n: 4, r: 1.2, size: 0.4, p: [0, 2.3, 0] });
    this.height = 3.2;
    this.radius = 2.4;
    this.flying = true;
    this.centerY = 0; // origin is the cloud center
    this.blends = { strike: 0.05, hurt: 0.06, descend: 0.5, defeated: 0.7 };
    this.finish({
      by: 0, sq: 0, tilt: 0, lean: 0, yaw: 0, cheek: 0, hornDroop: 0, hornGlow: 0, bodyGlow: 0, part: 0, coreUp: 0, coreGlow: 0,
      rain: 0, sparks: 0, rainbow: 0, mouthS: 1, look: 0, lookY: 0, sweat: 0, deflate: 0,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, happy = this.happy;
    tg.by = Math.sin(T * 1.6) * 0.12;
    tg.tilt = Math.sin(T * 0.9) * 0.04;
    this.starsOn = false;
    switch (anim) {
      case 'charge': {
        const u = ramp(t, 0, 0.6);
        tg.cheek = 0.6 + 0.4 * u; tg.hornGlow = 0.4 + 0.6 * u * (0.75 + 0.25 * Math.sin(T * 30));
        tg.bodyGlow = u * (0.35 + 0.35 * Math.max(0, Math.sin(T * 23) * Math.sin(T * 7.3)));
        tg.sparks = u; tg.sq = Math.sin(T * 40) * 0.02 * u - 0.04 * u; tg.by += Math.sin(T * 37) * 0.03 * u;
        this.ex = 'angry'; this.mo = 'pout';
        break;
      }
      case 'strike': {
        const jolt = win(t, 0.1, 0.35);
        tg.sq = t < 0.12 ? -0.12 * ramp(t, 0, 0.12) : 0.14 * decay(t - 0.12, 7, 18);
        tg.by += 0.35 * jolt; tg.hornGlow = 1 - ramp(t, 0.3, 0.7); tg.bodyGlow = 0.9 * win(t, 0.08, 0.3);
        tg.cheek = 1 - ramp(t, 0.12, 0.3);
        this.ex = t < 0.12 ? 'angry' : t < 0.5 ? 'angry' : happy ? 'normal' : 'angry'; this.mo = t > 0.1 && t < 0.55 ? 'roar' : 'frown';
        break;
      }
      case 'rain': {
        tg.rain = 1; tg.hornDroop = 0.35; tg.sq = -0.03; tg.lookY = -0.6; tg.tilt += Math.sin(T * 2.2) * 0.03;
        this.ex = 'sad'; this.mo = 'wavy';
        break;
      }
      case 'descend': {
        const u = Ease.inOutSine(ramp(t, 0, 0.8));
        tg.by = -0.7 * u + Math.sin(T * 1.1) * 0.05; tg.deflate = u; tg.hornDroop = u; tg.part = u; tg.coreUp = u;
        tg.coreGlow = u * (0.6 + 0.4 * Math.sin(T * 6)); tg.sweat = u; tg.tilt = Math.sin(T * 0.8) * 0.08;
        this.ex = 'tired'; this.mo = 'open'; tg.mouthS = 0.75 + 0.1 * Math.sin(T * 5);
        this.starsOn = false;
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5);
        tg.sq = -0.16 * k * Math.cos(t * 16); tg.lean = -0.25 * k; tg.by += 0.25 * k; tg.tilt = 0.12 * k * Math.sin(t * 20);
        tg.hornDroop = 0.4 * k;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.by = -0.3 + Math.sin(T * 1.3) * 0.1; tg.tilt = Math.sin(T * 1.1) * 0.05; tg.rainbow = 1; tg.sq = 0.02 * Math.sin(T * 2);
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: {
        tg.look = Math.sin(T * 0.45) * 0.5;
        tg.hornGlow = 0.12 + 0.12 * Math.max(0, Math.sin(T * 2.3)) * Math.max(0, Math.sin(T * 9.1));
        tg.cheek = 0.15 + 0.1 * Math.sin(T * 1.6);
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    this.body.position.y = c.by;
    this.body.rotation.set(c.lean, c.yaw, c.tilt);
    const sy = (1 + c.sq) * (1 - 0.12 * c.deflate), sxz = (1 - c.sq * 0.5) * (1 + 0.04 * c.deflate);
    this.body.scale.set(sxz, sy, sxz);
    // breathing puffs; top puffs part to reveal the core
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i], b = 1 + Math.sin(T * 1.8 + p.ph) * 0.035;
      let x = p.x, y = p.y, z = p.z;
      if (i === 5 || i === 6) { x += Math.sign(p.x) * 0.55 * c.part; y -= 0.15 * c.part; }
      if (i === 7) { z -= 0.45 * c.part; y -= 0.1 * c.part; }
      p.m.position.set(x, y, z);
      p.m.scale.set(p.r * b, p.r * p.sy * b, p.r * b);
    }
    for (const ch of this.cheeks) { const k = 1 + 0.55 * c.cheek; ch.m.scale.set(0.42 * k, 0.38 * k, 0.38 * k); }
    for (const h of this.horns) h.pv.rotation.set(0.25 * c.hornDroop, 0, -h.sd * (0.38 + 0.55 * c.hornDroop));
    const hg = c.hornGlow;
    this.pal.glowAdd(this.mHorn, 0.75 * hg, 0.6 * hg, 0.15 * hg);
    const bg = c.bodyGlow;
    this.pal.glowAdd(this.mCloud, 0.5 * bg, 0.46 * bg, 0.22 * bg);
    this.pal.glowAdd(this.mCloudD, 0.42 * bg, 0.38 * bg, 0.16 * bg);
    // core
    this.core.position.set(0, 1.25 + 0.45 * c.coreUp, -0.15 + 0.2 * c.coreUp);
    this.coreStar.rotation.set(0, Math.sin(T * 1.5) * 0.5, Math.sin(T * 2) * 0.2);
    const cs = 0.8 * (1 + 0.12 * c.coreGlow * Math.sin(T * 9));
    this.coreStar.scale.set(cs, cs, cs);
    this.coreGlowM.opacity = 0.65 * c.coreGlow;
    this.coreGlow.visible = c.coreGlow > 0.02;
    const gs = 0.75 + 0.25 * Math.sin(T * 6);
    this.coreGlow.scale.set(gs, gs, gs);
    // sparks
    const sOn = c.sparks > 0.05;
    const slot = Math.floor(T * 14);
    for (let i = 0; i < this.sparks.length; i++) {
      const m = this.sparks[i];
      const r = this.rng.next();
      m.visible = sOn && ((slot + i * 3) % 4 !== 0);
      if (!m.visible) continue;
      if (slot !== m.userData.slot) {
        m.userData.slot = slot;
        const a = this.rng.next() * TAU, rr = 1 + this.rng.next() * 0.15;
        m.position.set(Math.cos(a) * 2.45 * rr, Math.sin(a) * 1.55 * rr + 0.25, 0.1 + this.rng.next() * 0.5);
        m.rotation.set(0, 0, a - PI / 2 + (this.rng.next() - 0.5) * 0.8);
        const sc = (0.32 + 0.18 * r) * c.sparks;
        m.scale.set(sc, sc, sc);
      }
    }
    // rain
    const rn = c.rain;
    this.dropM.opacity = 0.85 * Math.min(1, rn * 1.5);
    for (const d of this.drops) {
      d.m.visible = rn > 0.05;
      if (!d.m.visible) continue;
      const u = (T * 0.9 + d.off) % 1;
      d.m.position.set(d.x, -0.95 - u * 4.2 + c.by, d.z + 0.2);
      const k = 0.13 * Math.min(1, u * 6) * (1 - Math.max(0, u - 0.85) * 6);
      d.m.scale.set(k * 0.8, k * 1.25, k * 0.8);
    }
    this.sweat.visible = c.sweat > 0.3;
    if (this.sweat.visible) { const u = (T * 0.8) % 1; this.sweat.position.set(1.05, 0.8 - u * 0.5, 0.78); this.sweat.scale.set(0.16, 0.2, 0.16); }
    // strike bolt
    const len = st.boltLen ?? 6;
    const bon = anim === 'strike' && t > 0.1 && t < 0.42 && len > 0.5;
    this.boltCore.mesh.visible = this.boltGlow.mesh.visible = bon;
    if (bon) {
      const seed = Math.floor(T * 24);
      if (seed !== this.boltSeed) {
        this.boltSeed = seed;
        const n = this.boltPts.length;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), j = i === 0 || i === n - 1 ? 0 : 1;
          this.boltPts[i][0] = ((i % 2 ? 1 : -1) * (0.25 + this.rng.next() * 0.3)) * j;
          this.boltPts[i][1] = -1.0 + c.by - u * (len - 1.0 + c.by) + (this.rng.next() - 0.5) * 0.3 * j * (len / 6);
          this.boltPts[i][2] = 0.25 + (this.rng.next() - 0.5) * 0.25 * j;
        }
        this.boltCore.set(this.boltPts); this.boltGlow.set(this.boltPts);
      }
      this.boltGlow.mesh.userData.op = 0.7 + 0.3 * Math.sin(T * 60);
    }
    // rainbow
    this.rainbow.visible = c.rainbow > 0.03;
    if (this.rainbow.visible) { const k = 3.4 * Ease.outBack(clamp(c.rainbow, 0, 1)); this.rainbow.scale.set(k, k, k); this.rainbow.userData.op = c.rainbow; }
    this.face.look(c.look, c.lookY);
    this.face.mouthS = c.mouthS;
    this.stars.update(dt, T, this.starsOn);
  }
}

// ============================================================================
// 4) chameleon — 카멜레온 카멜 (3.1 tall)
// parts: tongue (Node; scale.z = tongue length, 1 unit at scale 1, extends along head +Z), tongueTip, head (+ body, eyeL, eyeR)
// st.tongueLen: reach for tongueOut / tongueStuck (default 7)
// cling convention: gameplay places the root at the foot of / on a wall with +Z = wall normal (toward
// the arena); the wall surface is the plane local z = -1.3. The chameleon hangs head-down with its
// belly on the wall (body spans y ~0.2..4.6, tail curled on top) and lifts its head to face +Z, so the
// tongue still shoots along +Z.
// ============================================================================
const CH_LEGS = [[-1, 1], [1, 1], [-1, -1], [1, -1]]; // [side, front(+1)/back(-1)]
class Chameleon extends Boss {
  constructor() {
    super('chameleon');
    const P = this.pal;
    const skin = (this.mSkin = P.mat(0x63cf66, { gloss: true, spec: 0.22 }));
    const belly = P.mat(0xf1ef8e);
    const spotM = P.mat(0xa6ef86);
    const crestM = (this.mCrest = P.mat(0xff9d5c, { gloss: true, spec: 0.3 }));
    const tongueM = (this.mTongue = P.mat(0xff73a6, { gloss: true, spec: 0.45 }));
    const sacM = P.mat(0xffb0c8);
    this.cling = grp(this.root, 'cling', [0, 1.35, 0]);
    this.base = grp(this.cling, 'base', [0, -1.35, 0]);
    this.parts.body = this.base;
    ell(this.base, skin, [0, 1.35, 0], 1.1, 0.95, 1.38, null, 'body');
    ell(this.base, belly, [0, 1.05, 0.12], 0.92, 0.66, 1.18, null, 'belly');
    add(this.base, () => G.cachedGeo('ch:spots', () => {
      const items = [];
      const pts = [[0.95, 1.55, 0.35, 0.22], [0.98, 1.25, -0.35, 0.26], [0.8, 1.85, -0.55, 0.18], [0.85, 1.75, 0.75, 0.15], [0.75, 1.15, 0.95, 0.15]];
      for (const sd of [-1, 1]) for (const [x, y, z, r] of pts) {
        const nx = (sd * x) / (1.1 * 1.1), ny = (y - 1.35) / (0.95 * 0.95), nz = z / (1.38 * 1.38), l = Math.hypot(nx, ny, nz);
        items.push({ geo: UNIT.sphere, m: [sd * x, y, z, -Math.asin(ny / l), Math.atan2(nx / l, nz / l), 0, r, r, r * 0.25] });
      }
      return mergePlain(items);
    }), spotM, { name: 'spots' });
    add(this.base, () => G.cachedGeo('ch:ridge', () => mergePlain([0, 1, 2, 3, 4, 5].map((i) => {
      const u = i / 5, z = 0.95 - u * 2.0, y = 1.35 + 0.95 * Math.sqrt(Math.max(0, 1 - (z / 1.38) ** 2)) - 0.04;
      return { geo: UNIT.cone, m: [0, y + 0.1, z, -0.35 * (z / 1.38), 0, 0, 0.13, 0.26 - 0.06 * Math.abs(u - 0.4), 0.13] };
    }))), crestM, { name: 'ridge' });
    // legs
    this.legs = [];
    for (const [sd, fr] of CH_LEGS) {
      const lp = grp(this.base, 'leg', [sd * 0.82, 0.92, fr * 0.72]);
      ell(lp, skin, [0, -0.32, 0], 0.27, 0.42, 0.27, null, 'legU');
      const foot = grp(lp, 'foot', [0, -0.72, 0.1]);
      add(foot, () => G.cachedGeo('ch:foot', () => mergePlain([{ geo: UNIT.sphere, m: [-0.13, 0, 0.08, 0, -0.3, 0, 0.17, 0.13, 0.27] }, { geo: UNIT.sphere, m: [0.13, 0, 0.08, 0, 0.3, 0, 0.17, 0.13, 0.27] }])), skin, { name: 'foot' });
      this.legs.push({ lp, foot, sd, fr });
    }
    // tail (dynamic spiral)
    this.tail = new Tube(this, this.base, skin, { n: 34, rs: 10, radius: (u) => 0.34 * (1 - u) + 0.075 * u, name: 'tail' });
    this.tailPts = [];
    for (let i = 0; i < 14; i++) this.tailPts.push([0, 0, 0]);
    // head
    this.neck = grp(this.base, 'neck', [0, 1.85, 0.95]);
    this.head = grp(this.neck, 'head');
    this.parts.head = this.head;
    const HC = [0, 0.3, 0.52];
    ell(this.head, skin, HC, 1.05, 0.92, 1.06, null, 'headMesh');
    ell(this.head, belly, [0, HC[1] - 0.5, HC[2] + 0.12], 0.68, 0.42, 0.66, null, 'throat');
    // casque crest (fin) on top
    add(this.head, () => G.cachedGeo('ch:crest', () => {
      const out = [];
      for (let i = 0; i < 44; i++) { const a = (i / 44) * TAU; let x = Math.cos(a) * 0.66, y = Math.sin(a) * 0.5; if (y > 0) { x -= y * 0.6; y *= 1.45; } out.push([x, y]); }
      return G.puffyShapeGeo(out, 0.24, 5, 0.6);
    }), crestM, { p: [0, HC[1] + 0.74, HC[2] - 0.4], r: [0, PI / 2, 0], s: [1.15, 1.15, 1.0], name: 'crest' });
    // turret eyes
    this.turrets = [];
    const eyeParents = [];
    for (const sd of [-1, 1]) {
      const yaw = 42 * sd, pitch = 22;
      const yr = (yaw * PI) / 180, pr = (pitch * PI) / 180;
      const base = [HC[0] + 1.05 * Math.cos(pr) * Math.sin(yr) * 0.82, HC[1] + 0.92 * Math.sin(pr) * 0.82, HC[2] + 1.06 * Math.cos(pr) * Math.cos(yr) * 0.82];
      const tb = grp(this.head, sd < 0 ? 'turretL' : 'turretR', base, faceRot(yaw + 6 * sd, pitch - 4));
      const tv = grp(tb, 'turret');
      ell(tv, skin, [0, 0, 0.14], 0.52, 0.52, 0.46, null, 'turretDome');
      add(tv, UNIT.torus, crestM, { p: [0, 0, 0.5], s: [0.29, 0.29, 0.55], name: 'eyeRing' });
      const ep = grp(tv, 'eyeMount', [0, 0, 0.555]);
      eyeParents.push(ep);
      this.turrets.push({ tb, tv, sd, ly: 0, lx: 0, ty: 0, tx: 0, next: 0 });
    }
    this.face = makeFace(this, this.head, {
      c: HC, R: 1.06, eyeParents, eyeH: 0.5, eyeW: 0.66, mouthW: 0.26, mouthPitch: -22, mouthIn: 0.965, cheekYaw: 36, cheekPitch: -12, cheekS: 0.17, cheekIn: 0.975,
      wideMouth: 30, wideCurve: 5, wideThick: 0.038,
    });
    this.parts.eyeL = eyeParents[0]; this.parts.eyeR = eyeParents[1];
    // throat sac
    this.sac = ell(this.head, sacM, [0, HC[1] - 0.72, HC[2] + 0.18], 0.42, 0.34, 0.42, null, 'sac');
    // tongue + tip
    const mouthPos = [0, HC[1] - 0.36, HC[2] + 0.86];
    this.tongue = grp(this.head, 'tongue', mouthPos);
    add(this.tongue, UNIT.cylinder, tongueM, { p: [0, 0, 0.5], r: [PI / 2, 0, 0], s: [0.14, 1, 0.14], name: 'tongueMesh' });
    this.tongueTip = grp(this.head, 'tongueTip', mouthPos);
    ell(this.tongueTip, tongueM, [0, 0, 0], 0.3, 0.27, 0.3, null, 'tipBall');
    this.tipGlowM = P.mat(0xff6fae, { unlit: true, transparent: true, opacity: 0, depthWrite: false, pure: true });
    this.tipGlow = ell(this.tongueTip, this.tipGlowM, [0, 0, 0], 0.55, 0.55, 0.55, null, 'tipGlow');
    this.parts.tongue = this.tongue; this.parts.tongueTip = this.tongueTip;
    this.mouthPos = mouthPos;
    this.stars = makeStars(this, this.head, { n: 4, r: 0.9, size: 0.3, p: [0, 1.5, 0.3] });
    this.sweat = add(this.head, GEO.drop, P.mat(0x8fd4ff, { gloss: true, spec: 0.5, fogC: 0xa8a2c8 }), { p: [0.85, 0.9, 0.6], r: [0, 0, 0.4], s: 0.14, name: 'sweat' });
    this.sweat.visible = false;
    this.ph = 0; this.tLen = 0;
    this.height = 3.2;
    this.radius = 1.6;
    this.blends = { hurt: 0.06, tongueOut: 0.06, cling: 0.45, defeated: 0.6, vanish: 0.15, appear: 0.05 };
    this.finish({
      by: 0, sq: 0, sway: 0, roll: 0, lean: 0, cling: 0,
      hx: 0, hy: 0, hz: 0, nz: 0, lookAll: 0, eyesFwd: 0,
      l0x: 0, l1x: 0, l2x: 0, l3x: 0, l0y: 0, l1y: 0, l2y: 0, l3y: 0, splay: 0,
      curl: 0.8, tailWag: 0, tongue: 0.12, sac: 0, tipGlow: 0, op: 1, eyeOp: 1, shimmer: 0, mouthS: 1, sweat: 0,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, br = Math.sin(T * 2.0), happy = this.happy;
    const L = st.tongueLen ?? 7;
    this.starsOn = false;
    tg.by = br * 0.02;
    switch (anim) {
      case 'walk': {
        const sp = clamp(st.speed ?? 0.7, 0, 1.5);
        this.ph += dt * (4 + 4.5 * sp);
        const s = Math.sin(this.ph), c = Math.cos(this.ph);
        tg.l0x = s * 0.55; tg.l3x = s * 0.55; tg.l1x = -s * 0.55; tg.l2x = -s * 0.55;
        tg.l0y = Math.max(0, c) * 0.22; tg.l3y = tg.l0y; tg.l1y = Math.max(0, -c) * 0.22; tg.l2y = tg.l1y;
        tg.sway = s * 0.1; tg.roll = c * 0.03; tg.by = Math.abs(c) * 0.05; tg.hy = -s * 0.08; tg.tailWag = -s * 0.35; tg.curl = 0.65;
        break;
      }
      case 'cling': {
        tg.cling = 1; tg.hx = -1.2; tg.splay = 0.85; tg.curl = 0.95; tg.tailWag = Math.sin(T * 1.3) * 0.25;
        tg.l0x = -0.35; tg.l1x = -0.35; tg.l2x = 0.45; tg.l3x = 0.45; tg.by = Math.sin(T * 2) * 0.02;
        tg.lookAll = Math.sin(T * 0.8) * 0.3;
        break;
      }
      case 'tongueWindup': {
        const u = Ease.inOutSine(ramp(t, 0, 0.45));
        tg.hx = -0.32 * u; tg.hz = -0.25 * u; tg.lean = -0.1 * u; tg.sq = -0.06 * u; tg.eyesFwd = 1; tg.curl = 0.8 + 0.2 * u;
        tg.sac = u * (0.75 + 0.25 * Math.sin(T * 14)); tg.tongue = 0.12;
        tg.l0x = -0.25 * u; tg.l1x = -0.25 * u;
        if (t > 0.45) tg.roll = Math.sin(T * 40) * 0.01;
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'pout';
        break;
      }
      case 'tongueOut': {
        const out = Ease.outCubic(ramp(t, 0, 0.18)), back = Ease.inOutSine(ramp(t, 0.45, 0.7));
        tg.tongue = Math.max(0.12, L * out * (1 - back));
        tg.hx = 0.06 * out * (1 - back); tg.hz = 0.35 * out * (1 - back); tg.lean = 0.03 * out * (1 - back); tg.eyesFwd = 1; tg.curl = 0.6;
        tg.sac = 0.2 * (1 - out);
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'open'; tg.mouthS = 1.15;
        break;
      }
      case 'tongueStuck': {
        const tug = Math.max(0, Math.sin(T * 5.5));
        tg.tongue = L; tg.hz = 0.25 - 0.3 * tug; tg.lean = -0.12 * tug; tg.hx = 0.05 + 0.08 * tug; tg.sq = -0.04 * tug; tg.eyesFwd = 1;
        tg.l0x = -0.45; tg.l1x = -0.45; tg.l2x = 0.25; tg.l3x = 0.25; tg.curl = 1; tg.tailWag = Math.sin(T * 9) * 0.25;
        tg.tipGlow = 0.6 + 0.4 * Math.sin(T * 7); tg.sweat = 1; tg.roll = Math.sin(T * 11) * 0.02;
        this.ex = 'hurt'; this.mo = 'open'; tg.mouthS = 1.15;
        break;
      }
      case 'vanish': {
        const u = ramp(t, 0, 0.85);
        tg.op = (1 - u) * (0.8 + 0.2 * Math.sin(T * 38)); tg.eyeOp = 1 - ramp(t, 0.9, 1.15); tg.shimmer = win(t, 0, 0.95);
        tg.lookAll = Math.sin(T * 2) * 0.3;
        this.mo = happy ? 'smile' : 'grin';
        break;
      }
      case 'appear': {
        const u = ramp(t, 0.15, 0.8);
        tg.op = u * (0.8 + 0.2 * Math.sin(T * 38)) + (u >= 1 ? 0.2 : 0); tg.eyeOp = ramp(t, 0, 0.15); tg.shimmer = win(t, 0.1, 0.95);
        this.mo = 'grin';
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5), a = Ease.outCubic(ramp(t, 0, 0.08));
        tg.lean = -0.25 * a * (0.3 + 0.7 * k); tg.sq = -0.12 * k * Math.cos(t * 15); tg.hx = -0.35 * k; tg.curl = 0.4; tg.tailWag = 0.3 * k * Math.sin(t * 25);
        tg.l0x = -0.4; tg.l1x = -0.4;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.by = -0.42 + br * 0.015; tg.lean = -0.05; tg.hx = -0.28; tg.hy = Math.sin(T * 0.9) * 0.15; tg.splay = 0.75; tg.curl = 1.15; tg.tailWag = Math.sin(T * 1.5) * 0.25;
        tg.l0x = -0.5; tg.l1x = -0.5; tg.l2x = 0.5; tg.l3x = 0.5; tg.shimmer = 0.3; tg.roll = Math.sin(T * 1.2) * 0.04;
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: {
        tg.curl = 0.82 + Math.sin(T * 0.7) * 0.08; tg.tailWag = Math.sin(T * 0.9) * 0.15; tg.hy = Math.sin(T * 0.4) * 0.12; tg.hz = br * 0.02;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    // cling: pitch the whole body head-down onto the wall behind (+90deg about X)
    this.cling.rotation.x = c.cling * (PI / 2);
    this.cling.position.y = 1.35 + 1.75 * c.cling;
    this.cling.position.z = 0.02 * c.cling;
    this.base.position.y = -1.35 + c.by;
    this.base.rotation.set(c.lean, c.sway, c.roll);
    const sy = 1 + c.sq, sxz = 1 - c.sq * 0.5;
    this.base.scale.set(sxz, sy, sxz);
    // legs
    const lx = [c.l0x, c.l1x, c.l2x, c.l3x], ly = [c.l0y, c.l1y, c.l2y, c.l3y];
    for (let i = 0; i < 4; i++) {
      const L = this.legs[i];
      L.lp.position.y = 0.92 + ly[i];
      L.lp.rotation.set(lx[i], 0, -L.sd * 1.05 * c.splay);
    }
    // tail spiral: heads back, then coils up and over itself
    const n = this.tailPts.length, curl = c.curl, len = 3.0;
    let th = 0.3, x = 0, y = 1.35, z = -1.15;
    const seg = len / (n - 1);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      this.tailPts[i][0] = x; this.tailPts[i][1] = y; this.tailPts[i][2] = z;
      const k = 0.15 + curl * (0.55 + 5.2 * Math.pow(u, 1.5));
      th += k * seg;
      z -= Math.cos(th) * seg; y += Math.sin(th) * seg;
      x += Math.sin(c.tailWag * (0.5 + u)) * seg * 0.45;
    }
    this.tail.set(this.tailPts);
    // head
    this.head.rotation.set(c.hx, c.hy, 0);
    this.neck.position.z = 0.95 + c.hz;
    // turret eyes: independent look-around (or locked forward)
    for (const tu of this.turrets) {
      if (T > tu.next) { tu.next = T + 0.6 + this.rng.next() * 1.6; tu.ty = (this.rng.next() - 0.5) * 0.9 - tu.sd * 0.22; tu.tx = (this.rng.next() - 0.5) * 0.7; }
      const fw = c.eyesFwd;
      const tyaw = lerp(tu.ty + c.lookAll, -tu.sd * 0.75, fw), tpit = lerp(tu.tx, 0.25, fw);
      tu.ly = approach(tu.ly, tyaw, 9, dt); tu.lx = approach(tu.lx, tpit, 9, dt);
      tu.tv.rotation.set(tu.lx, tu.ly, 0);
    }
    // throat sac
    const sc = 0.25 + 0.75 * c.sac;
    this.sac.scale.set(0.42 * (0.6 + 0.4 * sc) , 0.34 * sc + 0.02, 0.42 * (0.6 + 0.4 * sc));
    this.sac.position.y = 0.3 - 0.62 - 0.18 * c.sac;
    // tongue
    const tl = c.tongue;
    this.tongue.scale.set(1, 1, Math.max(0.01, tl));
    this.tongue.visible = tl > 0.2;
    this.tongueTip.position.set(this.mouthPos[0], this.mouthPos[1], this.mouthPos[2] + tl);
    this.tongueTip.visible = tl > 0.2;
    this.tipGlow.visible = c.tipGlow > 0.02;
    this.tipGlowM.opacity = 0.45 * c.tipGlow;
    const gs = 1 + 0.25 * c.tipGlow * Math.sin(T * 7);
    this.tipGlow.scale.set(0.55 * gs, 0.55 * gs, 0.55 * gs);
    this.pal.glowAdd(this.mTongue, 0.35 * c.tipGlow, 0.05 * c.tipGlow, 0.15 * c.tipGlow);
    // shimmer: rainbow-ish emissive sweep while (dis)appearing
    const sh = c.shimmer;
    if (sh > 0.01) { const hcol = [0.5 + 0.5 * Math.sin(T * 6), 0.5 + 0.5 * Math.sin(T * 6 + 2.1), 0.5 + 0.5 * Math.sin(T * 6 + 4.2)]; this.pal.glowAdd(this.mSkin, hcol[0] * 0.35 * sh, hcol[1] * 0.35 * sh, hcol[2] * 0.35 * sh); }
    else this.pal.glowAdd(this.mSkin, 0, 0, 0);
    // opacity (eyes vanish last)
    this.opInt = 1;
    const op = clamp(c.op, 0, 1), eop = clamp(c.eyeOp, 0, 1);
    for (const m of this.meshes) m.userData.op = op;
    for (const E of this.face.eyes) E.pv.traverse((n) => { if (n.isMesh) n.userData.op = Math.max(op, eop); });
    this.root.visible = Math.max(op, eop) * this.opExt > 0.004;
    this.sweat.visible = c.sweat > 0.3;
    if (this.sweat.visible) { const u = (T * 0.9) % 1; this.sweat.position.set(0.85, 0.95 - u * 0.4, 0.6); }
    this.face.mouthS = c.mouthS;
    this.stars.update(dt, T, this.starsOn);
  }
}

// ============================================================================
// 5) octopus — 문어 대왕 옥토 (head ~4 tall, 4.9 total)
// parts: tentacles[] (base Nodes, +Z = outward), tips[] (tip Nodes, follow the tentacle ends), head (+ mouth, crown)
// st.tentacle: index (0..5) used by slam / stuck. Tentacle i points outward at yaw OCTO_YAW[i] (deg, 0 = +Z front).
// ============================================================================
export const OCTO_YAW = [30, -30, 90, -90, 150, -150];
const OC_N = 9;
class Octopus extends Boss {
  constructor() {
    super('octopus');
    const P = this.pal;
    const headM = (this.mHead = P.mat(0xec86d6, { gloss: true, spec: 0.3 }));
    const spotM = P.mat(0xffc2ea, { gloss: true, spec: 0.2 });
    const goldM = P.mat(0xffcf45, { gloss: true, spec: 0.7, emissive: 0x2a1a00 });
    const pearlM = P.mat(0xfff8fb, { gloss: true, spec: 0.8, rim: 0.6 });
    this.base = grp(this.root, 'base');
    this.headP = grp(this.base, 'head');
    this.parts.head = this.headP;
    this.headMesh = add(this.headP, () => G.cachedGeo('oc:head', () => G.latheGeo([[0, 0.66], [1.0, 0.72], [1.45, 0.98], [1.72, 1.5], [1.83, 2.2], [1.8, 2.85], [1.62, 3.55], [1.25, 4.15], [0.7, 4.58], [0, 4.75]], 40)), headM, { name: 'headMesh' });
    add(this.headP, () => G.cachedGeo('oc:spots', () => {
      const items = [];
      for (const [yd, y, s] of [[60, 3.2, 0.32], [-55, 3.5, 0.26], [115, 2.6, 0.36], [-120, 2.9, 0.3], [170, 3.4, 0.34], [30, 4.0, 0.22], [-25, 4.15, 0.18], [90, 1.7, 0.25], [-95, 1.9, 0.28], [150, 1.6, 0.25], [-160, 2.2, 0.3]]) {
        const pr = [[0, 0.66], [1.0, 0.72], [1.45, 0.98], [1.72, 1.5], [1.83, 2.2], [1.8, 2.85], [1.62, 3.55], [1.25, 4.15], [0.7, 4.58], [0, 4.75]];
        let r = 0; for (let k = 0; k < pr.length - 1; k++) if (y >= pr[k][1] && y <= pr[k + 1][1]) r = lerp(pr[k][0], pr[k + 1][0], (y - pr[k][1]) / (pr[k + 1][1] - pr[k][1]));
        const a = (yd * PI) / 180, nx = Math.sin(a), nz = Math.cos(a);
        items.push({ geo: UNIT.sphere, m: [nx * r * 0.985, y, nz * r * 0.985, 0, a, 0, s, s, s * 0.22] });
      }
      return mergePlain(items);
    }), spotM, { name: 'spots' });
    this.face = makeFace(this, this.headP, { c: [0, 2.0, -0.2], R: 2.0, eyeH: 1.12, eyeW: 0.62, eyeYaw: 19, eyePitch: 4, eyeIn: 0.985, mouthW: 0.3, mouthPitch: -20, mouthIn: 0.99, cheekYaw: 36, cheekPitch: -9, cheekS: 0.3, cheekIn: 0.985 });
    this.parts.mouth = this.face.mouthPivot;
    this.lip = add(this.face.mouthPivot, UNIT.torus, P.mat(0xd96ab8, { gloss: true }), { s: [0.2, 0.22, 0.6], name: 'lip' });
    this.lip.visible = false;
    // pearl crown
    this.crown = grp(this.headP, 'crown', [0.15, 4.55, 0.05], [0.12, 0, -0.18]);
    this.crown.scale.set(1.45, 1.45, 1.45);
    this.parts.crown = this.crown;
    add(this.crown, () => G.cachedGeo('oc:crown', () => {
      const items = [{ geo: () => G.cylinderGeo(0.5, 0.56, 0.3, 24, 1, true), m: [0, 0.15, 0, 0, 0, 0, 1, 1, 1] }];
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; items.push({ geo: UNIT.cone, m: [Math.sin(a) * 0.45, 0.42, Math.cos(a) * 0.45, 0, 0, 0, 0.13, 0.26, 0.13] }); }
      return mergePlain(items);
    }), goldM, { name: 'crownGold' });
    add(this.crown, () => G.cachedGeo('oc:pearls', () => mergePlain([0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * TAU; return { geo: UNIT.sphere, m: [Math.sin(a) * 0.45, 0.58, Math.cos(a) * 0.45, 0, 0, 0, 0.1, 0.1, 0.1] }; }).concat([{ geo: UNIT.sphere, m: [0, 0.16, 0.56, 0, 0, 0, 0.13, 0.13, 0.08] }]))), pearlM, { name: 'pearls' });
    // tentacles
    this.tents = [];
    this.parts.tentacles = []; this.parts.tips = [];
    const cBody = [1, 1, 1], cUnder = rgb(0xffe1f2), cSuck = rgb(0xfff4fa);
    for (let i = 0; i < 6; i++) {
      const phi = (OCTO_YAW[i] * PI) / 180, R = [Math.sin(phi), 0, Math.cos(phi)], L = [-Math.cos(phi), 0, Math.sin(phi)];
      const m = P.mat(0xec86d6, { vertexColors: true, gloss: true, spec: 0.3 });
      const tube = new Tube(this, this.base, m, {
        n: 26, rs: 10, up: L, name: 'tentacle',
        radius: (u) => 0.44 * (1 - u) + 0.1 * u + 0.05 * Math.exp(-u * 12),
        color: (u, a) => { const under = Math.sin(a); if (under > 0.45) { const sk = (u * 10) % 1; return sk > 0.25 && sk < 0.75 && under > 0.75 ? [cSuck[0] / 0.93, cSuck[1] / 0.53, cSuck[2] / 0.84].map((v) => Math.min(v, 1.6)) : [cUnder[0] / 0.93, cUnder[1] / 0.53, cUnder[2] / 0.84].map((v) => Math.min(v, 1.6)); } return cBody; },
      });
      const baseN = grp(this.base, 'tentacle' + i, [R[0] * 1.2, 0.9, R[2] * 1.2], [0, phi, 0]);
      const tip = grp(this.base, 'tip' + i);
      this.parts.tentacles.push(baseN); this.parts.tips.push(tip);
      const pts = []; for (let k = 0; k <= OC_N; k++) pts.push([0, 0, 0]);
      this.tents.push({ tube, m, R, L, phi, pts, tip, i });
    }
    this.tipGlowM = P.mat(0xff5fa8, { transparent: true, opacity: 0, depthWrite: false, rim: 0.9, spec: 0, emissive: 0x401028, pure: true });
    this.tipGlow = ell(this.base, this.tipGlowM, [0, 0, 0], 0.5, 0.5, 0.5, null, 'tipGlow');
    this.tipGlow.visible = false;
    // ink blobs
    this.inkM = P.mat(0x3a2f58, { gloss: true, spec: 0.4, transparent: true, opacity: 0.9, depthWrite: false, pure: true });
    this.inks = [];
    for (let i = 0; i < 5; i++) { const m = ell(this.root, this.inkM, [0, 0, 0], 1, 1, 1, null, 'ink'); m.visible = false; this.inks.push({ m, d: i * 0.22, sx: (((i * 0.618) % 1) - 0.5) * 0.9, sy: (((i * 0.382) % 1) - 0.5) * 0.6, s: 0.3 + 0.12 * (i % 3) }); }
    // bubbles (submerge / emerge)
    this.bubM = P.mat(0xe6f6ff, { gloss: true, spec: 0.6, rim: 0.8, transparent: true, opacity: 0.55, depthWrite: false, fogC: 0xd8d4ee });
    this.bubbles = [];
    for (let i = 0; i < 6; i++) { const m = ell(this.root, this.bubM, [0, 0, 0], 1, 1, 1, null, 'bubble'); m.visible = false; this.bubbles.push({ m, a: i * 1.047 + 0.3, r: 1.6 + (i % 3) * 0.6, off: (i * 0.29) % 1 }); }
    this.stars = makeStars(this, this.root, { n: 5, r: 1.6, size: 0.45, p: [0, 5.6, 0] });
    this.sweat = add(this.headP, GEO.drop, P.mat(0x8fd4ff, { gloss: true, spec: 0.5, fogC: 0xa8a2c8 }), { p: [1.55, 3.3, 0.9], r: [0, 0, 0.4], s: 0.24, name: 'sweat' });
    this.sweat.visible = false;
    this.height = 4.9;
    this.radius = 1.85;
    this.reach = 4.6;
    this.blends = { hurt: 0.06, emerge: 0.05, submerge: 0.3, defeated: 0.7, stuck: 0.3 };
    const def = { by: 0, sq: 0, puff: 0, lean: 0, roll: 0, sink: 0, look: 0, lookY: 0, mouthS: 1, lip: 0, tipGlow: 0, sweat: 0, swim: 0 };
    for (let i = 0; i < 6; i++) Object.assign(def, { ['a' + i]: -0.95, ['b' + i]: 0.12, ['c' + i]: 0.9, ['r' + i]: 1, ['w' + i]: 0.2, ['y' + i]: 0 });
    this._tmp = [0, 0, 0];
    this.finish(def);
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, br = Math.sin(T * 1.7), happy = this.happy;
    const ti = clamp(st.tentacle | 0, 0, 5);
    tg.by = br * 0.06; tg.sq = br * 0.02;
    this.starsOn = false;
    // idle-ish tentacle defaults with phase offsets
    for (let i = 0; i < 6; i++) { tg['c' + i] = 0.9 + 0.35 * Math.sin(T * 1.3 + i * 1.1); tg['b' + i] = 0.12 + 0.05 * Math.sin(T * 0.9 + i * 2.3); }
    const slamPose = (i, k) => { tg['a' + i] = lerp(tg['a' + i], -0.32, k); tg['b' + i] = lerp(tg['b' + i], 0.02, k); tg['c' + i] = lerp(tg['c' + i], 0.25, k); tg['r' + i] = lerp(1, 1.3, k); tg['w' + i] = 0.05; };
    switch (anim) {
      case 'swim': {
        tg.swim = 1; tg.lean = 0.12; tg.by = Math.sin(T * 3.2) * 0.18;
        for (let i = 0; i < 6; i++) { tg['a' + i] = -0.55 + 0.35 * Math.sin(T * 3.2 + i * 0.5); tg['c' + i] = 0.6; tg['w' + i] = 0.35; }
        break;
      }
      case 'slam': {
        const i = ti;
        const up = Ease.inOutSine(ramp(t, 0, 0.55)), down = Ease.inCubic(ramp(t, 0.55, 0.7)), back = Ease.inOutSine(ramp(t, 1.3, 1.8));
        const sway = Math.sin(T * 5) * 0.06 * up;
        const side = Math.sign(OCTO_YAW[i]) * (Math.abs(OCTO_YAW[i]) < 120 ? 1 : -1);
        if (t < 0.55) { tg['a' + i] = lerp(-0.95, 0.6, up); tg['b' + i] = lerp(0.12, 0.11 + sway, up); tg['c' + i] = lerp(0.9, 0.55, up); tg['r' + i] = lerp(1, 1.25, up); tg['w' + i] = 0.12; tg['y' + i] = side * 0.75 * up; }
        else if (t < 1.3) { const k = down; tg['a' + i] = lerp(0.6, -0.32, k); tg['b' + i] = lerp(0.11, 0.02, k); tg['c' + i] = lerp(0.55, 0.25, k); tg['r' + i] = lerp(1.25, 1.3, k); tg['w' + i] = t > 0.7 ? 0.08 * decay(t - 0.7, 4, 20) : 0.1; tg['y' + i] = side * 0.75 * (1 - k); }
        else slamPose(i, 1 - back);
        const lean = (t < 0.55 ? -0.1 * up : t < 1.3 ? 0.12 * down : 0.12 * (1 - back));
        tg.lean = lean * Math.cos(this.tents[i].phi); tg.roll = -lean * Math.sin(this.tents[i].phi);
        tg.sq = t > 0.68 && t < 1.2 ? -0.08 * decay(t - 0.68, 5, 14) : tg.sq;
        this.mo = t > 0.5 && t < 1.0 ? 'open' : happy ? 'smile' : 'frown';
        this.ex = happy ? 'focus' : 'angry';
        break;
      }
      case 'stuck': {
        const i = ti;
        slamPose(i, 1);
        tg['w' + i] = 0.12 + 0.08 * Math.sin(T * 9);
        tg['a' + i] += Math.sin(T * 7) * 0.05;
        const tug = Math.max(0, Math.sin(T * 4.5));
        tg.lean = -0.1 * tug * Math.cos(this.tents[i].phi); tg.roll = 0.1 * tug * Math.sin(this.tents[i].phi);
        tg.tipGlow = 0.6 + 0.4 * Math.sin(T * 7); tg.sweat = 1; tg.sq = -0.04 * tug;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'ink': {
        const inh = Ease.inOutSine(ramp(t, 0, 0.45)), shot = win(t, 0.42, 0.75);
        tg.puff = 0.1 * inh * (1 - ramp(t, 0.45, 0.55)); tg.sq = -0.06 * inh + 0.08 * shot; tg.lean = -0.08 * inh + 0.12 * shot;
        tg.lip = Math.max(inh * (1 - ramp(t, 0.8, 1.1)), 0); tg.mouthS = 1 + 0.4 * shot;
        for (let i = 0; i < 6; i++) tg['c' + i] = 1.2 + 0.4 * inh;
        this.mo = 'o'; this.ex = happy ? 'focus' : 'angry';
        break;
      }
      case 'submerge': {
        const u = Ease.inCubic(ramp(t, 0, 1.0));
        tg.sink = 5.4 * u; tg.sq = 0.06 * u;
        for (let i = 0; i < 6; i++) { tg['a' + i] = lerp(-0.95, 0.6, Ease.outCubic(ramp(t, 0, 0.5))); tg['c' + i] = 0.5; tg['w' + i] = 0.4; }
        this.ex = 'closed'; this.mo = 'o';
        break;
      }
      case 'emerge': {
        const u = Ease.outBack(ramp(t, 0, 0.7));
        tg.sink = 5.4 * (1 - u); tg.sq = t > 0.55 ? -0.12 * decay(t - 0.55, 5, 14) : 0.1;
        for (let i = 0; i < 6; i++) { tg['a' + i] = lerp(0.8, -0.95, Ease.outCubic(ramp(t, 0.2, 0.9))); tg['c' + i] = lerp(0.4, 0.9, ramp(t, 0.4, 1)); tg['w' + i] = 0.3; }
        this.mo = 'open';
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5);
        tg.sq = -0.14 * k * Math.cos(t * 15); tg.lean = -0.2 * k; tg.by += 0.2 * k;
        for (let i = 0; i < 6; i++) { tg['c' + i] = 1.4 + 0.5 * k; tg['a' + i] = -0.95 + 0.4 * k; }
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.by = -0.15 + br * 0.04; tg.roll = Math.sin(T * 1.0) * 0.05; tg.lean = 0.04;
        for (let i = 0; i < 6; i++) { tg['a' + i] = -1.05; tg['c' + i] = 1.5 + 0.3 * Math.sin(T * 1.1 + i); tg['b' + i] = 0.18; tg['w' + i] = 0.12; }
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: {
        tg.look = Math.sin(T * 0.4) * 0.5;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    this.base.position.y = -c.sink;
    this.headP.position.y = c.by;
    this.headP.rotation.set(c.lean, 0, c.roll);
    const sy = 1 + c.sq, sxz = (1 - c.sq * 0.5) * (1 + c.puff);
    this.headP.scale.set(sxz, sy, sxz);
    // tentacles
    const ti = clamp(st.tentacle | 0, 0, 5);
    for (const tn of this.tents) {
      const i = tn.i, a0 = c['a' + i], bend = c['b' + i], curl = c['c' + i], reach = c['r' + i], wig = c['w' + i];
      const ph = tn.phi + c['y' + i], R = tn.R, Lv = tn.L;
      R[0] = Math.sin(ph); R[2] = Math.cos(ph); Lv[0] = -Math.cos(ph); Lv[2] = Math.sin(ph);
      tn.tube.S.up = Lv;
      const len = 3.7 * reach, seg = len / OC_N;
      let r = 1.18, y = 0.92 + c.by * 0.5, th = a0;
      const sw = c.swim;
      for (let k = 0; k <= OC_N; k++) {
        const u = k / OC_N;
        const lat = wig * Math.sin(T * 2.2 + u * 4 + i * 1.7) * u * 1.2;
        const p = tn.pts[k];
        p[0] = tn.R[0] * r + tn.L[0] * lat; p[1] = y; p[2] = tn.R[2] * r + tn.L[2] * lat;
        th += bend + curl * Math.pow(u, 2.2) * 0.75 + sw * 0.25 * Math.sin(T * 6 - u * 5 + i);
        r += Math.cos(th) * seg; y += Math.sin(th) * seg;
        const rad = 0.44 * (1 - u) + 0.1 * u;
        if (y < rad * 0.92) y = rad * 0.92;
      }
      tn.tube.set(tn.pts);
      const e = tn.tube.S.end(this._end || (this._end = { p: [0, 0, 0], t: [0, 0, 1] }));
      tn.tip.position.set(e.p[0], e.p[1], e.p[2]);
      tn.tip.rotation.set(-Math.asin(clamp(e.t[1], -1, 1)), Math.atan2(e.t[0], e.t[2]), 0);
      const g = anim === 'stuck' && i === ti ? c.tipGlow : 0;
      this.pal.glowAdd(tn.m, 0.4 * g, 0.05 * g, 0.2 * g);
    }
    // stuck tip glow
    this.tipGlow.visible = c.tipGlow > 0.03;
    if (this.tipGlow.visible) {
      const tp = this.tents[ti].tip.position;
      this.tipGlow.position.set(tp.x, tp.y, tp.z);
      const k = 0.5 * (1 + 0.22 * Math.sin(T * 7));
      this.tipGlow.scale.set(k, k, k);
      this.tipGlowM.opacity = 0.42 * c.tipGlow;
    }
    // ink blobs fly forward from the mouth
    const ip = anim === 'ink' ? (t - 0.45) / 0.9 : -1;
    for (const b of this.inks) {
      const u = ip - b.d * 0.25;
      b.m.visible = u > 0 && u < 1;
      if (!b.m.visible) continue;
      const d = 0.4 + 5.5 * Ease.outCubic(u), sc = b.s * (0.6 + 1.4 * u);
      b.m.position.set(b.sx * u * 2, 1.35 + c.by + b.sy * u * 2 - u * u * 1.2, 1.75 + d);
      b.m.scale.set(sc, sc, sc);
      b.m.userData.op = 1 - u * u;
    }
    // bubbles while sinking / rising
    const bon = anim === 'submerge' || anim === 'emerge';
    for (const b of this.bubbles) {
      b.m.visible = bon;
      if (!bon) continue;
      const u = (T * 0.8 + b.off) % 1, s = 0.12 + 0.2 * u;
      b.m.position.set(Math.sin(b.a + T * 0.5) * b.r, u * 2.2, Math.cos(b.a + T * 0.5) * b.r);
      b.m.scale.set(s, s, s);
    }
    this.lip.visible = c.lip > 0.1;
    if (this.lip.visible) { const k = 0.6 + 0.4 * c.lip; this.lip.scale.set(0.2 * k, 0.22 * k, 0.6); }
    this.sweat.visible = c.sweat > 0.3;
    if (this.sweat.visible) { const u = (T * 0.8) % 1; this.sweat.position.set(1.5, 3.4 - u * 0.5, 0.95); }
    this.face.look(c.look, c.lookY);
    this.face.mouthS = c.mouthS;
    this.stars.update(dt, T, this.starsOn);
  }
}

// ============================================================================
// 6) yeti — 눈보라 예티 (3.5 tall)
// parts: handL, handR (snowball rides in handR during throwWindup), mouth (+ body)
// ============================================================================
// fluffy fur ball: core ellipsoid + flattened, surface-aligned tufts (fibonacci distribution)
function fluffGeo(key, cx, cy, cz, rx, ry, rz, n, tuft, skipFn, depth = 0.6) {
  return G.cachedGeo(key, () => {
    const items = [{ geo: UNIT.sphere, m: [cx, cy, cz, 0, 0, 0, rx, ry, rz] }];
    const ga = PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * ga;
      const nx = Math.cos(a) * r, nz = Math.sin(a) * r;
      if (skipFn && skipFn(nx, y, nz)) continue;
      const s = tuft * (0.85 + 0.3 * ((i * 0.618) % 1));
      let gx = nx / rx, gy = y / ry, gz = nz / rz; const gl = Math.hypot(gx, gy, gz); gx /= gl; gy /= gl; gz /= gl;
      items.push({ geo: UNIT.sphere, m: [cx + nx * rx * 0.9, cy + y * ry * 0.9, cz + nz * rz * 0.9, -Math.asin(gy), Math.atan2(gx, gz), 0, s, s, s * depth] });
    }
    return mergePlain(items);
  });
}
class Yeti extends Boss {
  constructor() {
    super('yeti');
    const P = this.pal;
    const fur = (this.mFur = P.mat(0xf7faff, { rim: 0.5, spec: 0.06 }));
    const skin = P.mat(0xa9d8ff, { gloss: true, spec: 0.25 });
    const palm = P.mat(0x93c8f2, { gloss: true, spec: 0.2 });
    const hornM = P.mat(0xfff0cc, { gloss: true, spec: 0.4 });
    const snowM = P.mat(0xffffff, { rim: 0.6, spec: 0.1, fogC: 0xe6e3f2 });
    this.base = grp(this.root, 'base');
    this.torso = grp(this.base, 'torso', [0, 0.45, 0]);
    this.parts.body = this.torso;
    add(this.torso, () => fluffGeo('ye:body', 0, 1.12, 0, 1.22, 1.3, 1.08, 52, 0.38, (x, y, z) => z > 0.25 && y > -0.42 && y < 0.92 && Math.abs(x) < 0.72, 0.85), fur, { name: 'fur' });
    add(this.torso, () => G.cachedGeo('ye:tuft', () => mergePlain([[0, 0.25, 0.05, 0.3], [-0.2, 0.12, 0.12, 0.22], [0.22, 0.14, -0.05, 0.24]].map(([x, y, z, r]) => ({ geo: UNIT.sphere, m: [x, y, z, 0, 0, 0, r, r * 1.2, r] })))), fur, { p: [0.05, 2.3, 0.15], r: [0.2, 0, -0.25], name: 'cowlick' });
    // face plate
    ell(this.torso, skin, [0, 1.5, 0.48], 0.9, 0.72, 0.68, null, 'facePlate');
    this.face = makeFace(this, this.torso, { c: [0, 1.5, 0.48], R: 0.68, eyeH: 0.52, eyeW: 0.6, eyeYaw: 27, eyePitch: 12, eyeIn: 1.0, mouthW: 0.21, mouthPitch: -30, mouthIn: 1.0, cheekYaw: 50, cheekPitch: -14, cheekS: 0.16, cheekIn: 1.0 });
    this.parts.mouth = this.face.mouthPivot;
    // little curved horns
    for (const sd of [-1, 1]) {
      add(this.torso, () => G.cachedGeo('ye:horn', () => tubeGeo([[0, 0, 0], [0.12, 0.25, 0], [0.32, 0.42, 0.02], [0.5, 0.48, 0.05]], { n: 14, rs: 8, radius: (u) => 0.17 * (1 - u) + 0.05, capN: 3, baseCap: false })), hornM, { p: [sd * 0.62, 2.15, 0.25], r: [0, sd < 0 ? PI : 0, 0.15], name: 'horn' });
    }
    // arms: shoulder -> elbow -> hand
    this.arms = [];
    for (const sd of [-1, 1]) {
      const sh = grp(this.torso, sd < 0 ? 'shoulderL' : 'shoulderR', [sd * 1.25, 1.42, 0.12]);
      add(sh, () => fluffGeo('ye:upper', 0, -0.35, 0, 0.36, 0.5, 0.36, 14, 0.19, null, 0.85), fur, { name: 'upperArm' });
      const el = grp(sh, 'elbow', [0, -0.75, 0]);
      add(el, () => fluffGeo('ye:lower', 0, -0.32, 0, 0.33, 0.45, 0.33, 12, 0.18, null, 0.85), fur, { name: 'foreArm' });
      const hand = grp(el, sd < 0 ? 'handL' : 'handR', [0, -0.78, 0.05]);
      ell(hand, palm, [0, -0.1, 0.02], 0.5, 0.46, 0.4, null, 'mitten');
      ell(hand, palm, [-sd * 0.4, 0.05, 0.18], 0.17, 0.24, 0.17, null, 'thumb');
      ell(hand, fur, [0, 0.22, 0], 0.4, 0.2, 0.36, null, 'cuff');
      this.parts[sd < 0 ? 'handL' : 'handR'] = hand;
      this.arms.push({ sh, el, hand, sd });
    }
    this.snowball = ell(this.arms[1].hand, snowM, [0.05, -0.72, 0.18], 0.5, 0.5, 0.5, null, 'snowball');
    this.snowball.visible = false;
    // legs
    this.legs = [];
    for (const sd of [-1, 1]) {
      const hip = grp(this.base, sd < 0 ? 'legL' : 'legR', [sd * 0.62, 0.72, 0.05]);
      ell(hip, fur, [0, -0.2, 0], 0.42, 0.4, 0.42, null, 'leg');
      ell(hip, palm, [0, -0.52, 0.16], 0.42, 0.2, 0.56, null, 'foot');
      this.legs.push({ hip, sd });
    }
    // breath puffs (blow) / inhale streaks
    this.breathM = P.mat(0xe8f6ff, { rim: 0.7, spec: 0, transparent: true, opacity: 0.6, depthWrite: false, emissive: 0x182430, fogC: 0xd6d2ea });
    this.puffs = [];
    for (let i = 0; i < 9; i++) { const m = ell(this.root, this.breathM, [0, 0, 0], 1, 1, 1, null, 'breath'); m.visible = false; this.puffs.push({ m, off: i / 9, sx: Math.sin(i * 2.4) * 0.5, sy: Math.cos(i * 1.7) * 0.35 }); }
    this.stars = makeStars(this, this.torso, { n: 4, r: 1.1, size: 0.36, p: [0, 2.75, 0.1] });
    this.ph = 0;
    this.height = 3.5;
    this.radius = 1.6;
    this.blends = { hurt: 0.06, throw: 0.06, defeated: 0.6, stunned: 0.3 };
    this.finish({
      by: 0, sq: 0, puff: 0, lean: 0, twist: 0, roll: 0, sit: 0,
      sLx: 0, sLz: -0.25, eLx: -0.25, sRx: 0, sRz: 0.25, eRx: -0.25, hLx: 0, hRx: 0,
      lLx: 0, lRx: 0, lLy: 0, lRy: 0, snow: 0, breath: 0, inhale: 0, glow: 0, look: 0, mouthS: 1,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, br = Math.sin(T * 1.9), happy = this.happy;
    this.starsOn = false;
    tg.sq = br * 0.02;
    switch (anim) {
      case 'walk': case 'charge': {
        const run = anim === 'charge', sp = clamp(st.speed ?? (run ? 1 : 0.6), 0, 1.5);
        this.ph += dt * (run ? 7 + 4 * sp : 3.8 + 4 * sp);
        const s = Math.sin(this.ph), c = Math.cos(this.ph);
        const A = run ? 0.85 : 0.55;
        tg.lLx = s * A; tg.lRx = -s * A; tg.lLy = Math.max(0, c) * (run ? 0.3 : 0.22); tg.lRy = Math.max(0, -c) * (run ? 0.3 : 0.22);
        tg.by = Math.abs(c) * (run ? 0.16 : 0.1); tg.sq = -(1 - Math.abs(c)) * (run ? 0.06 : 0.04);
        tg.roll = s * (run ? 0.05 : 0.07); tg.twist = s * 0.12;
        if (run) { tg.lean = 0.38; tg.sLx = 0.9 + s * 0.6; tg.sRx = 0.9 - s * 0.6; tg.eLx = -0.9; tg.eRx = -0.9; tg.sLz = -0.35; tg.sRz = 0.35; this.ex = happy ? 'focus' : 'angry'; this.mo = 'grin'; }
        else { tg.lean = 0.08; tg.sLx = -s * 0.55; tg.sRx = s * 0.55; tg.eLx = -0.35; tg.eRx = -0.35; }
        break;
      }
      case 'throwWindup': {
        const u = Ease.inOutSine(ramp(t, 0, 0.55));
        tg.sRx = lerp(-0.2, 0.55, u); tg.sRz = lerp(0.42, 2.45, u); tg.eRx = lerp(-0.45, -0.55, u);
        tg.sLx = -0.5 * u; tg.sLz = -0.6 * u; tg.twist = -0.32 * u; tg.lean = -0.1 * u; tg.roll = 0.06 * u; tg.snow = Ease.outBack(ramp(t, 0.05, 0.4));
        if (t > 0.55) tg.sRz += Math.sin(T * 14) * 0.04;
        this.mo = 'pout';
        break;
      }
      case 'throw': {
        const u = Ease.outCubic(ramp(t, 0, 0.18)), back = Ease.inOutSine(ramp(t, 0.3, 0.6));
        tg.sRx = lerp(0.55, -1.55, u) * (1 - back) - 0.2 * back; tg.sRz = lerp(2.45, 0.45, u) * (1 - back) + 0.42 * back; tg.eRx = lerp(-0.55, -0.1, u) * (1 - back) - 0.45 * back;
        tg.sLx = -0.5 * (1 - u) + 0.45 * u * (1 - back); tg.sLz = -0.6 * (1 - back) - 0.42 * back;
        tg.twist = lerp(-0.32, 0.38, u) * (1 - back); tg.lean = lerp(-0.1, 0.22, u) * (1 - back); tg.roll = 0.06 * (1 - u);
        tg.snow = t < 0.15 ? 1 : 0;
        this.mo = t < 0.35 ? 'open' : happy ? 'smile' : 'frown';
        break;
      }
      case 'slam': {
        const up = Ease.inOutSine(ramp(t, 0, 0.5)), down = Ease.inCubic(ramp(t, 0.5, 0.62)), back = Ease.inOutSine(ramp(t, 1.0, 1.4));
        let sx, ex, le;
        if (t < 0.5) { sx = lerp(0, -2.9, up); ex = lerp(-0.25, -0.5, up); le = -0.15 * up; }
        else if (t < 1.0) { sx = lerp(-2.9, -1.15, down); ex = lerp(-0.5, -0.15, down); le = lerp(-0.15, 0.42, down); }
        else { sx = lerp(-1.15, 0, back); ex = lerp(-0.15, -0.25, back); le = lerp(0.42, 0, back); }
        tg.sLx = sx; tg.sRx = sx; tg.eLx = ex; tg.eRx = ex; tg.sLz = -0.2; tg.sRz = 0.2; tg.lean = le;
        tg.sq = t < 0.5 ? 0.08 * up : t < 1.0 ? -0.16 * decay(Math.max(0, t - 0.62), 5, 15) * (t > 0.62 ? 1 : 0) + 0.08 * (1 - down) : 0;
        tg.by = t > 0.62 && t < 1.0 ? -0.05 : 0;
        this.mo = t > 0.45 && t < 0.9 ? 'roar' : happy ? 'smile' : 'frown';
        break;
      }
      case 'inhale': {
        const u = Ease.inOutSine(ramp(t, 0, 0.8));
        tg.puff = 0.13 * u + Math.sin(T * 9) * 0.008 * u; tg.lean = -0.14 * u; tg.inhale = u;
        tg.sLz = -0.7 * u; tg.sRz = 0.7 * u; tg.sLx = -0.3 * u; tg.sRx = -0.3 * u;
        this.mo = 'o';
        break;
      }
      case 'blow': {
        const u = ramp(t, 0, 0.15);
        tg.puff = 0.13 * (1 - ramp(t, 0, 2.5)); tg.lean = 0.16 * u; tg.breath = u; tg.mouthS = 1.15;
        tg.sLz = -0.55; tg.sRz = 0.55; tg.sLx = 0.25; tg.sRx = 0.25; tg.roll = Math.sin(T * 30) * 0.008;
        this.mo = 'roar';
        break;
      }
      case 'stunned': {
        const a = T * 2.4;
        tg.sit = 1; tg.lean = -0.1 + Math.cos(a) * 0.07; tg.roll = Math.sin(a) * 0.09;
        tg.sLz = -0.55; tg.sRz = 0.55; tg.sLx = -0.3; tg.sRx = -0.3; tg.eLx = -0.2; tg.eRx = -0.2;
        tg.lLx = -1.35; tg.lRx = -1.35; tg.glow = 0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(T * 5.5), 2);
        this.ex = 'dizzy'; this.mo = 'wavy'; this.starsOn = true;
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5), a = Ease.outCubic(ramp(t, 0, 0.08));
        tg.lean = -0.3 * a * (0.3 + 0.7 * k); tg.sq = -0.14 * k * Math.cos(t * 15);
        tg.sLz = -1.3; tg.sRz = 1.3; tg.sLx = -0.4; tg.sRx = -0.4; tg.lLx = 0.2; tg.lRx = -0.15;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.sit = 1; tg.lean = -0.08 + Math.sin(T * 1.4) * 0.02; tg.roll = Math.sin(T * 1.1) * 0.03;
        tg.lLx = -1.35; tg.lRx = -1.35; tg.sLz = -0.45; tg.sLx = -0.25; tg.eLx = -0.3;
        tg.sRx = -2.6; tg.sRz = 0.55 + Math.sin(T * 7) * 0.25; tg.eRx = -0.4;
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: {
        tg.sLz = -0.42 - br * 0.04; tg.sRz = 0.42 + br * 0.04; tg.sLx = -0.2; tg.sRx = -0.2; tg.eLx = -0.45; tg.eRx = -0.45;
        tg.look = Math.sin(T * 0.5) * 0.5; tg.roll = Math.sin(T * 0.7) * 0.02;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    this.base.position.y = c.by - 0.42 * c.sit;
    this.base.rotation.set(c.lean, c.twist, c.roll);
    const sy = 1 + c.sq, sxz = (1 - c.sq * 0.5) * (1 + c.puff);
    this.torso.scale.set(sxz, sy * (1 + c.puff * 0.5), sxz);
    const A = this.arms;
    A[0].sh.rotation.set(c.sLx, 0, c.sLz); A[0].el.rotation.x = c.eLx;
    A[1].sh.rotation.set(c.sRx, 0, c.sRz); A[1].el.rotation.x = c.eRx;
    const Lg = this.legs;
    Lg[0].hip.rotation.x = c.lLx; Lg[1].hip.rotation.x = c.lRx;
    Lg[0].hip.position.set(-0.62, 0.72 + c.lLy + 0.15 * c.sit, 0.05 + 0.35 * c.sit); Lg[1].hip.position.set(0.62, 0.72 + c.lRy + 0.15 * c.sit, 0.05 + 0.35 * c.sit);
    // snowball in the right hand
    this.snowball.visible = c.snow > 0.05;
    if (this.snowball.visible) { const k = 0.48 * clamp(c.snow, 0, 1.2); this.snowball.scale.set(k, k, k); }
    // breath (blow) streams out of the mouth; inhale streams in
    const bOn = c.breath > 0.05 || c.inhale > 0.05;
    const mz = 1.35;
    for (const p of this.puffs) {
      p.m.visible = bOn;
      if (!bOn) continue;
      let u = (T * 1.6 + p.off) % 1;
      if (c.inhale > c.breath) u = 1 - u;
      const d = 0.3 + u * 4.2, spread = 0.15 + u * 0.9;
      p.m.position.set(p.sx * spread, 1.62 + c.by + p.sy * spread - u * 0.5, mz + d);
      const k = 0.2 + u * 0.55;
      p.m.scale.set(k, k, k);
      p.m.userData.op = Math.min(1, (1 - u) * 1.6) * Math.max(c.breath, c.inhale);
    }
    const g = c.glow;
    this.pal.glowAdd(this.mFur, 0.3 * g, 0.22 * g, 0.08 * g);
    this.face.look(c.look, 0);
    this.face.mouthS = c.mouthS;
    this.stars.update(dt, T, this.starsOn);
  }
}

// ============================================================================
// 7) clockknight — 태엽 기사 클락 (3.3 tall to helmet top, plume to ~3.65)
// parts: key, lance (pivot at the grip; lance points along its local +Z, length LANCE_LEN), lanceTip,
//        shoulderL, shoulderR (pauldrons), muzzleL, muzzleR (cannon mouths while shooting), chest (clock face)
// ============================================================================
export const LANCE_LEN = 3.0;
class ClockKnight extends Boss {
  constructor() {
    super('clockknight');
    const P = this.pal;
    const tin = (this.mTin = P.mat(0xb39cf2, { gloss: true, spec: 0.5, rim: 0.4 }));
    const silver = P.mat(0xe4e8f6, { gloss: true, spec: 0.65, rim: 0.45 });
    const gold = (this.mGold = P.mat(0xffc93c, { gloss: true, spec: 0.75, emissive: 0x2a1a00 }));
    const keyM = (this.mKey = P.mat(0xffc93c, { gloss: true, spec: 0.8, emissive: 0x2a1a00 }));
    const cream = P.mat(0xfff4e6);
    const dial = P.mat(0xfffcf2, { gloss: true, spec: 0.5 });
    const handM = P.mat(0xe8445a, { gloss: true, spec: 0.3 });
    const markM = P.mat(0x3d3566, { pure: true });
    const plumeM = (this.mPlume = P.mat(0xff6fa8, { rim: 0.5, spec: 0.1 }));
    const bootM = P.mat(0x6f5bd0, { gloss: true, spec: 0.4 });
    const lanceW = P.mat(0xfffafa, { gloss: true, spec: 0.5 });
    const lanceP = P.mat(0xff79ae, { gloss: true, spec: 0.4 });
    this.base = grp(this.root, 'base');
    this.body = grp(this.base, 'body', [0, 0.82, 0]);
    this.parts.body = this.body;
    // torso barrel + belt
    add(this.body, () => G.cachedGeo('ck:torso', () => G.latheGeo([[0, 0], [0.6, 0.03], [0.88, 0.2], [0.98, 0.58], [0.96, 0.98], [0.84, 1.24], [0.56, 1.38], [0, 1.42]], 32)), tin, { name: 'torso' });
    add(this.body, ringG(0.9, 0.075), gold, { p: [0, 0.3, 0], r: [PI / 2, 0, 0], name: 'belt' });
    ell(this.body, gold, [0, 0.28, 0.93], 0.16, 0.13, 0.08, null, 'buckle');
    // chest clock
    this.chest = grp(this.body, 'chest', [0, 0.78, 0.9]);
    this.parts.chest = this.chest;
    ell(this.chest, dial, [0, 0, 0], 0.46, 0.46, 0.1, null, 'dial');
    add(this.chest, ringG(0.46, 0.055), gold, { name: 'dialRim' });
    add(this.chest, () => G.cachedGeo('ck:marks', () => mergePlain(Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * TAU, big = i % 3 === 0; return { geo: UNIT.box, m: [Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0.08, 0, 0, -a, big ? 0.05 : 0.03, big ? 0.11 : 0.07, 0.03] }; }))), markM, { name: 'marks' });
    this.hourH = grp(this.chest, 'hourHand', [0, 0, 0.1]);
    add(this.hourH, UNIT.box, handM, { p: [0, 0.1, 0], s: [0.06, 0.22, 0.03] });
    this.minH = grp(this.chest, 'minuteHand', [0, 0, 0.12]);
    add(this.minH, UNIT.box, handM, { p: [0, 0.15, 0], s: [0.04, 0.32, 0.03] });
    ell(this.chest, gold, [0, 0, 0.13], 0.06, 0.06, 0.04, null, 'pin');
    // head: helmet with face window, visor, plume
    this.head = grp(this.body, 'head', [0, 1.36, 0]);
    this.parts.head = this.head;
    ell(this.head, silver, [0, 0.55, 0], 0.66, 0.64, 0.66, null, 'helmet');
    ell(this.head, cream, [0, 0.5, 0.36], 0.5, 0.42, 0.36, null, 'faceWindow');
    add(this.head, () => G.cachedGeo('ck:visor', () => G.torusGeo(1, 0.13, 8, 24, PI)), gold, { p: [0, 0.6, 0.6], r: [-0.25, 0, 0], s: [0.56, 0.42, 0.6], name: 'visor' });
    add(this.head, ringG(0.56, 0.07), gold, { p: [0, 0.1, 0], r: [PI / 2, 0, 0], name: 'collar' });
    this.face = makeFace(this, this.head, { c: [0, 0.48, 0.18], R: 0.56, eyeH: 0.36, eyeW: 0.62, eyeYaw: 22, eyePitch: 4, eyeIn: 1.0, mouthW: 0.12, mouthPitch: -22, mouthIn: 0.99, cheekYaw: 40, cheekPitch: -10, cheekS: 0.1, cheekIn: 0.99 });
    this.plume = grp(this.head, 'plume', [0, 1.15, -0.05]);
    add(this.plume, UNIT.cylinder, gold, { p: [0, 0.02, 0], s: [0.1, 0.16, 0.1], name: 'plumeHolder' });
    add(this.plume, () => G.cachedGeo('ck:plume', () => mergePlain([[0, 0.22, 0.05, 0.2], [0, 0.42, -0.08, 0.22], [0, 0.55, -0.3, 0.22], [0, 0.56, -0.54, 0.2], [0, 0.46, -0.74, 0.17], [0, 0.3, -0.86, 0.14]].map(([x, y, z, r]) => ({ geo: UNIT.sphere, m: [x, y, z, 0, 0, 0, r * 0.9, r, r * 1.15] })))), plumeM, { name: 'plumeFluff' });
    // pauldrons with hatches + pop-up cannons
    this.shoulders = [];
    for (const sd of [-1, 1]) {
      const sh = grp(this.body, sd < 0 ? 'shoulderL' : 'shoulderR', [sd * 0.98, 1.08, 0]);
      add(sh, UNIT.sphere, silver, { s: [0.44, 0.34, 0.44], name: 'pauldron' });
      add(sh, ringG(0.43, 0.05), gold, { r: [PI / 2, 0, 0], name: 'pauldronRim' });
      const cannon = grp(sh, 'cannon', [0, 0.1, 0]);
      add(cannon, UNIT.cylinder, P.mat(0x5a5180, { gloss: true, spec: 0.5 }), { p: [0, 0.18, 0], s: [0.13, 0.42, 0.13], name: 'barrel' });
      add(cannon, ringG(0.13, 0.035), gold, { p: [0, 0.38, 0], r: [PI / 2, 0, 0], name: 'barrelRim' });
      const muzzle = grp(cannon, sd < 0 ? 'muzzleL' : 'muzzleR', [0, 0.42, 0]);
      const flashM = P.mat(0xfff0a0, { unlit: true, transparent: true, opacity: 0.85, depthWrite: false, pure: true });
      const flash = ell(muzzle, flashM, [0, 0.12, 0], 0.22, 0.3, 0.22, null, 'muzzleFlash');
      flash.visible = false;
      const hinge = grp(sh, 'hatchHinge', [0, 0.36, -0.2]);
      add(hinge, () => G.cachedGeo('ck:hatch', () => G.cylinderGeo(0.2, 0.2, 0.05, 16, 1, true)), gold, { p: [0, 0.02, 0.2], name: 'hatch' });
      this.parts[sd < 0 ? 'shoulderL' : 'shoulderR'] = sh;
      this.parts[sd < 0 ? 'muzzleL' : 'muzzleR'] = muzzle;
      this.shoulders.push({ sh, cannon, hinge, muzzle, flash, flashM, sd });
    }
    // arms
    this.armL = grp(this.body, 'armL', [-0.98, 1.0, 0.05]);
    ell(this.armL, silver, [0, -0.32, 0], 0.17, 0.36, 0.17, null, 'armL');
    const hL = grp(this.armL, 'handL', [0, -0.72, 0.02]);
    ell(hL, gold, [0, 0, 0], 0.2, 0.2, 0.2, null, 'fistL');
    this.armR = grp(this.body, 'armR', [0.98, 1.0, 0.05]);
    ell(this.armR, silver, [0, -0.32, 0], 0.17, 0.36, 0.17, null, 'armR');
    const hR = grp(this.armR, 'handR', [0, -0.72, 0.02]);
    ell(hR, gold, [0, 0, 0], 0.2, 0.2, 0.2, null, 'fistR');
    this.parts.handL = hL; this.parts.handR = hR;
    // lance (in the right fist), points along local +Z
    this.lance = grp(hR, 'lance');
    this.parts.lance = this.lance;
    add(this.lance, UNIT.cylinder, gold, { p: [0, 0, -0.25], r: [PI / 2, 0, 0], s: [0.07, 0.75, 0.07], name: 'grip' });
    add(this.lance, () => G.cachedGeo('ck:vamplate', () => G.latheGeo([[0, -0.02], [0.42, 0.0], [0.36, 0.12], [0.12, 0.34], [0.1, 0.36]], 20)), gold, { p: [0, 0, 0.18], r: [PI / 2, 0, 0], name: 'vamplate' });
    add(this.lance, () => G.cachedGeo('ck:lance', () => G.latheGeo([[0.3, 0], [0.27, 0.6], [0.2, 1.4], [0.11, 2.2], [0.03, 2.65], [0, 2.7]], 18)), lanceW, { p: [0, 0, 0.3], r: [PI / 2, 0, 0], name: 'lanceCone' });
    add(this.lance, () => G.cachedGeo('ck:lanceStripe', () => {
      const pts = [];
      for (let i = 0; i <= 60; i++) { const u = i / 60, y = 0.05 + u * 2.45, r = lerp(0.3, 0.035, Math.pow(y / 2.7, 1.1)) + 0.012, a = u * 4.2 * TAU; pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
      return tubeGeo(pts, { n: 160, rs: 5, radius: (u) => 0.075 * (1 - u * 0.7), capN: 2 });
    }), lanceP, { p: [0, 0, 0.3], r: [PI / 2, 0, 0], name: 'lanceStripe' });
    this.lanceTip = grp(this.lance, 'lanceTip', [0, 0, LANCE_LEN]);
    this.parts.lanceTip = this.lanceTip;
    // legs (stiff toy legs)
    this.legs = [];
    for (const sd of [-1, 1]) {
      const hip = grp(this.base, sd < 0 ? 'legL' : 'legR', [sd * 0.4, 0.92, 0]);
      add(hip, UNIT.cylinder, silver, { p: [0, -0.36, 0], s: [0.17, 0.62, 0.17], name: 'leg' });
      ell(hip, bootM, [0, -0.72, 0.1], 0.27, 0.2, 0.38, null, 'boot');
      this.legs.push(hip);
    }
    // wind-up key on the back
    this.key = grp(this.body, 'key', [0, 0.95, -0.86]);
    this.parts.key = this.key;
    add(this.key, () => G.cachedGeo('ck:key', () => mergePlain([
      { geo: UNIT.cylinder, m: [0, 0, -0.35, PI / 2, 0, 0, 0.1, 0.7, 0.1] },
      { geo: UNIT.sphere, m: [0, 0, -0.72, 0, 0, 0, 0.19, 0.19, 0.14] },
      { geo: () => G.torusGeo(0.4, 0.13, 10, 28), m: [-0.5, 0, -0.85, 0, 0, 0, 1, 1, 1.15] },
      { geo: () => G.torusGeo(0.4, 0.13, 10, 28), m: [0.5, 0, -0.85, 0, 0, 0, 1, 1, 1.15] },
    ])), keyM, { name: 'keyMesh' });
    this.keyGlowM = P.mat(0xfff09a, { unlit: true, transparent: true, opacity: 0, depthWrite: false, pure: true });
    this.keyGlow = ell(this.key, this.keyGlowM, [0, 0, -0.85], 1.15, 0.62, 0.3, null, 'keyGlow');
    this.keyGlow.visible = false;
    this.stars = makeStars(this, this.head, { n: 4, r: 0.85, size: 0.3, p: [0, 1.45, 0] });
    this.plumeSpring = new Spring(80, 6);
    this.keyAng = 0; this.clockAng = 0; this.spin = 0; this.ph = 0; this.keyRate = 2.5;
    this.height = 3.3;
    this.radius = 1.3;
    this.blends = { hurt: 0.06, spin: 0.2, unwound: 0.5, defeated: 0.6, charge: 0.15 };
    this.finish({
      by: 0, sq: 0, lean: 0, roll: 0, twist: 0, hx: 0, hz: 0,
      aLx: 0, aLz: -0.25, aRx: -0.35, aRz: 0.3, lanceX: -1.45, lanceY: 0, lanceZ: 0,
      lLx: 0, lRx: 0, lLy: 0, lRy: 0, legF: 0, sit: 0,
      hatch: 0, cannon: 0, recL: 0, recR: 0, keyRate: 2.5, keyGlow: 0, clockRate: 1, spinRate: 0, tilt: 0,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, happy = this.happy;
    this.starsOn = false;
    const tick = Math.floor(T * 2) / 2; // tick-tock
    switch (anim) {
      case 'walk': {
        const sp = clamp(st.speed ?? 0.7, 0, 1.5);
        this.ph += dt * (4.5 + 4.5 * sp);
        const s = Math.sin(this.ph), c = Math.cos(this.ph);
        tg.lLx = s * 0.55; tg.lRx = -s * 0.55; tg.lLy = Math.max(0, c) * 0.12; tg.lRy = Math.max(0, -c) * 0.12;
        tg.roll = s * 0.13; tg.by = Math.abs(c) * 0.08; tg.twist = s * 0.08;
        tg.aLx = -s * 0.6; tg.aRx = -0.35 + s * 0.25; tg.keyRate = 4; tg.clockRate = 2;
        tg.hz = -s * 0.06;
        break;
      }
      case 'chargeWindup': {
        const u = Ease.inOutSine(ramp(t, 0, 0.4)), paw = t > 0.3 ? Math.max(0, Math.sin((t - 0.3) * 14)) : 0;
        tg.lean = -0.14 * u; tg.lanceX = lerp(-1.45, -0.05, u); tg.aRx = lerp(-0.35, -1.25, u); tg.aRz = lerp(0.3, 0.12, u);
        tg.lRx = -0.5 * paw; tg.lRy = 0.15 * paw; tg.keyRate = 4 + 20 * u; tg.clockRate = 6 * u + 1; tg.sq = -0.05 * u;
        tg.aLx = -0.3 * u;
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'pout';
        break;
      }
      case 'charge': {
        const sp = clamp(st.speed ?? 1, 0, 1.5);
        this.ph += dt * (10 + 4 * sp);
        const s = Math.sin(this.ph), c = Math.cos(this.ph);
        tg.lean = 0.3; tg.lanceX = -0.05; tg.aRx = -1.25; tg.aRz = 0.12; tg.aLx = 0.5 + s * 0.4;
        tg.lLx = s * 0.75; tg.lRx = -s * 0.75; tg.lLy = Math.max(0, c) * 0.2; tg.lRy = Math.max(0, -c) * 0.2;
        tg.by = Math.abs(c) * 0.12; tg.roll = s * 0.06; tg.keyRate = 26; tg.clockRate = 8;
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'grin';
        break;
      }
      case 'spin': {
        const u = ramp(t, 0, 0.45);
        tg.spinRate = 15 * Ease.inCubic(u); tg.aRz = 1.45; tg.aRx = 0; tg.lanceX = PI / 2; tg.lanceY = 0; tg.aLz = -1.45;
        tg.lLx = 0; tg.lRx = 0; tg.tilt = 0.08 * u; tg.keyRate = 30 * u + 4; tg.clockRate = 10;
        this.ex = happy ? 'focus' : 'angry'; this.mo = 'grin';
        break;
      }
      case 'shoot': {
        const open = Ease.outBack(ramp(t, 0, 0.25)), close = Ease.inOutSine(ramp(t, 0.95, 1.2));
        tg.hatch = open * (1 - close); tg.cannon = Ease.outCubic(ramp(t, 0.12, 0.32)) * (1 - Ease.inCubic(ramp(t, 0.85, 1.05)));
        tg.recL = Math.exp(-Math.max(0, t - 0.45) * 12) * (t >= 0.45 ? 1 : 0);
        tg.recR = Math.exp(-Math.max(0, t - 0.7) * 12) * (t >= 0.7 ? 1 : 0);
        tg.sq = -0.05 * (tg.recL + tg.recR); tg.lean = -0.06 * (tg.recL + tg.recR);
        tg.aLz = -0.55; tg.keyRate = 6;
        this.ex = happy ? 'focus' : 'angry'; this.mo = t > 0.4 && t < 0.85 ? 'open' : 'pout';
        break;
      }
      case 'unwound': {
        const u = Ease.inOutSine(ramp(t, 0, 0.8));
        tg.lean = 0.3 * u; tg.hx = 0.22 * u; tg.hz = 0.14 * u; tg.sq = -0.08 * u; tg.by = -0.06 * u;
        tg.aLx = 0.25 * u; tg.aLz = -0.12; tg.aRx = lerp(-0.35, 0.1, u); tg.aRz = 0.15; tg.lanceX = lerp(-1.45, 0.62, u);
        tg.keyRate = 2.2 * (1 - ramp(t, 0, 2.2)) + 0.25 * Math.max(0, Math.sin(T * 1.3)); tg.clockRate = 0;
        tg.keyGlow = ramp(t, 0.4, 1.0) * (0.65 + 0.35 * Math.sin(T * 6));
        this.ex = 'tired'; this.mo = 'o';
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5), a = Ease.outCubic(ramp(t, 0, 0.08));
        tg.lean = -0.28 * a * (0.3 + 0.7 * k); tg.sq = -0.12 * k * Math.cos(t * 15); tg.hx = -0.2 * k;
        tg.aLz = -1.3; tg.aRz = 1.0; tg.lanceX = -1.0; tg.keyRate = 12 * k; tg.clockRate = -4 * k;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.sit = 1; tg.lean = -0.08; tg.hz = Math.sin(T * 1.2) * 0.08; tg.lLx = -1.45; tg.lRx = -1.45;
        tg.aLz = -0.3; tg.aLx = -0.3; tg.aRx = 0.15; tg.aRz = 0.35; tg.lanceX = 0.2; tg.lanceY = 0.5;
        tg.keyRate = 1.4; tg.clockRate = 0.5;
        this.ex = 'happy'; this.mo = 'grin';
        break;
      }
      default: {
        tg.roll = Math.sin(tick * PI) * 0.03; tg.hz = -Math.sin(tick * PI) * 0.05; tg.by = Math.abs(Math.sin(T * PI)) * 0.025;
        tg.aLz = -0.25 - Math.sin(T * 2) * 0.04;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    this.spin += c.spinRate * dt;
    if (c.spinRate < 0.5) this.spin = approach(this.spin, Math.round(this.spin / TAU) * TAU, 5, dt);
    this.base.position.y = c.by - 0.55 * c.sit;
    this.base.rotation.set(c.lean, c.twist + this.spin, c.roll);
    this.body.rotation.set(c.tilt * Math.sin(this.spin * 0.25), 0, c.tilt * Math.cos(this.spin * 0.25));
    const sy = 1 + c.sq, sxz = 1 - c.sq * 0.5;
    this.body.scale.set(sxz, sy, sxz);
    this.head.rotation.set(c.hx, 0, c.hz);
    this.armL.rotation.set(c.aLx, 0, c.aLz); this.armR.rotation.set(c.aRx, 0, c.aRz);
    this.lance.rotation.set(c.lanceX - c.aRx, c.lanceY, 0);
    this.legs[0].rotation.x = c.lLx; this.legs[1].rotation.x = c.lRx;
    this.legs[0].position.set(-0.4, 0.92 + c.lLy + 0.1 * c.sit, 0.3 * c.sit); this.legs[1].position.set(0.4, 0.92 + c.lRy + 0.1 * c.sit, 0.3 * c.sit);
    // key & clock
    this.keyAng += c.keyRate * dt;
    this.key.rotation.z = this.keyAng;
    this.clockAng += c.clockRate * dt;
    this.minH.rotation.z = -this.clockAng * 1.2 - Math.floor(T) * 0.1 * (c.clockRate > 0.01 ? 1 : 0);
    this.hourH.rotation.z = -this.clockAng * 0.1 - 1.0;
    this.keyGlow.visible = c.keyGlow > 0.02;
    this.keyGlowM.opacity = 0.5 * c.keyGlow;
    const kg = 1 + 0.15 * Math.sin(T * 6);
    this.keyGlow.scale.set(1.15 * kg, 0.62 * kg, 0.3 * kg);
    this.pal.glowAdd(this.mKey, 0.8 * c.keyGlow, 0.62 * c.keyGlow, 0.15 * c.keyGlow);
    // plume secondary motion
    const pw = this.plumeSpring.update(-c.lean * 0.8 - c.by * 2 + (c.spinRate > 1 ? 0.6 : 0), dt);
    this.plume.rotation.set(pw * 0.5, 0, Math.sin(T * 2.2) * 0.04);
    // hatches & cannons
    for (const S of this.shoulders) {
      S.hinge.rotation.x = -1.9 * c.hatch;
      const rec = S.sd < 0 ? c.recL : c.recR;
      S.cannon.position.y = 0.1 + 0.36 * c.cannon - 0.1 * rec;
      S.cannon.scale.set(1, Math.max(0.05, c.cannon), 1);
      S.cannon.visible = c.cannon > 0.03;
      S.cannon.rotation.x = -0.35 * c.cannon;
      S.flash.visible = rec > 0.3;
      if (S.flash.visible) { const k = 0.6 + rec; S.flash.scale.set(0.22 * k, 0.3 * k, 0.22 * k); S.flashM.opacity = 0.9 * rec; }
    }
    this.stars.update(dt, T, this.starsOn);
  }
}

// ============================================================================
// 8) fogking — 회색 안개 (FINAL, 6.3 tall incl. crown; floats, origin at ground under its wisp tail)
// parts: handL, handR (floating hands), core (heart-star), eyes (eye group), head, crown
// st.hand: 'L' | 'R' for handSlam
// ============================================================================
const FK_PUFFS = [ // x, y, z, r, shade(0 dark,1 mid,2 light), role
  [0, 0.62, 0.05, 0.5, 0, 'tail'], [0.32, 1.05, 0.12, 0.62, 0, 'tail'], [-0.38, 1.12, -0.08, 0.64, 0, 'tail'], [0, 1.55, 0.18, 0.86, 1, 'tail'],
  [0, 2.15, 0.05, 1.22, 0, ''], [-0.88, 2.35, -0.12, 0.98, 1, ''], [0.88, 2.35, -0.12, 0.98, 1, ''], [0, 2.3, -0.75, 1.08, 0, ''],
  [0, 3.12, -0.25, 1.25, 1, ''], [-0.5, 2.86, 0.66, 0.72, 2, 'curtainL'], [0.52, 2.8, 0.68, 0.7, 1, 'curtainR'], [0.04, 3.42, 0.62, 0.64, 2, 'curtainT'],
  [-1.38, 3.38, -0.1, 0.88, 1, ''], [1.38, 3.38, -0.1, 0.88, 1, ''], [-2.0, 3.08, 0.0, 0.58, 2, ''], [2.0, 3.08, 0.0, 0.58, 2, ''],
  [-1.05, 4.18, -0.25, 0.62, 1, ''], [1.05, 4.18, -0.25, 0.62, 1, ''], [0, 4.15, -0.3, 0.95, 0, ''], [-1.2, 2.2, 0.35, 0.6, 2, ''], [1.15, 2.15, 0.4, 0.58, 2, ''],
  [0, 4.78, 0.05, 1.2, 1, 'head'], [-0.78, 5.0, -0.32, 0.78, 2, ''], [0.78, 5.0, -0.32, 0.78, 2, ''], [0, 5.42, -0.38, 0.86, 1, ''],
];
class FogKing extends Boss {
  constructor() {
    super('fogking');
    const P = this.pal;
    const shades = [P.mat(0xe4def9, { rim: 0.55, spec: 0.05, fogC: 0x433a63 }), P.mat(0xece7ff, { rim: 0.55, spec: 0.05, fogC: 0x52477a }), P.mat(0xf7f4ff, { rim: 0.6, spec: 0.08, fogC: 0x64598f })];
    this.shades = shades;
    const eyeM = (this.mEye = P.mat(0x4a3d7a, { unlit: true, fogC: 0xd2bdff }));
    const eyeHl = P.mat(0xffffff, { unlit: true, pure: true });
    const lineM = P.mat(0x5b4a8a, { unlit: true, fogC: 0xc7b2ff });
    const inM = P.mat(0x6c4a8e, { unlit: true, fogC: 0x9d84e0 });
    const crystalM = (this.mCrystal = P.mat(0xf5c8ff, { gloss: true, spec: 0.7, rim: 0.5, emissive: 0x30183a, fogC: 0x2d2350, fogEm: 0x160a2c }));
    const handM = shades[1];
    this.base = grp(this.root, 'base');
    this.body = grp(this.base, 'body');
    this.parts.body = this.body;
    this.pieces = [];
    FK_PUFFS.forEach(([x, y, z, r, sh, role], i) => {
      const m = ell(this.body, shades[sh], [x, y, z], r, r, r, null, 'fog');
      const dx = x, dy = y - 3.0, dz = z + 0.2, dl = Math.hypot(dx, dy, dz) || 1;
      this.pieces.push({ m, x, y, z, r, role, ph: i * 1.37, dir: [dx / dl, dy / dl * 0.6 + 0.5, dz / dl], delay: 0.1 + 0.9 * (1 - Math.min(1, dl / 3.2)) + ((i * 0.37) % 0.3) });
    });
    this.curtains = this.pieces.filter((p) => p.role.startsWith('curtain'));
    this.headPiece = this.pieces.find((p) => p.role === 'head');
    // misty halo
    this.mistM = P.mat(0xffffff, { transparent: true, opacity: 0.12, depthWrite: false, rim: 0.9, spec: 0, fogC: 0x9a8cd0 });
    this.mists = [];
    for (let i = 0; i < 4; i++) { const m = ell(this.body, this.mistM, [0, 0, 0], 1, 1, 1, null, 'mist'); this.mists.push({ m, a: i * 1.57 + 0.4, y: 1.2 + i * 1.1, r: 1.3 + (i % 2) * 0.5, s: 1.5 + (i % 3) * 0.3 }); }
    // face (head puff)
    this.head = grp(this.body, 'head', [0, 4.78, 0.05]);
    this.parts.head = this.head;
    this.face = makeFace(this, this.head, {
      c: [0, 0, 0], R: 1.2, eyeH: 0.82, eyeW: 0.64, eyeYaw: 23, eyePitch: 4, eyeIn: 0.99, eyeMat: eyeM, hlMat: eyeHl, noGlint: true, browMat: lineM,
      mouthW: 0.2, mouthPitch: -24, mouthIn: 0.99, lineMat: lineM, inMat: inM, tongueMat: inM, cheekYaw: 42, cheekPitch: -10, cheekS: 0.2, cheekColor: 0xffb3d6,
    });
    this.eyesNode = grp(this.head, 'eyes', [0, 0.08, 1.15]);
    this.parts.eyes = this.eyesNode;
    this.eyeGlowM = P.mat(0xd8c6ff, { unlit: true, transparent: true, opacity: 0.32, depthWrite: false, fogC: 0xb39cff });
    for (const sd of [-1, 1]) ell(this.head, this.eyeGlowM, onSphere(1.18, 23 * sd, 4), 0.42, 0.55, 0.12, faceRot(23 * sd, 4), 'eyeGlow');
    // crown of crystals
    this.crown = grp(this.head, 'crown', [0, 0.88, -0.2], [-0.12, 0, 0]);
    this.parts.crown = this.crown;
    add(this.crown, () => G.cachedGeo('fk:crown', () => mergePlain([0, 1, 2, 3, 4, 5, 6].map((i) => {
      const a = ((i - 3) / 3) * 1.25, big = i === 3 ? 1.35 : i === 2 || i === 4 ? 1.1 : 0.85;
      return { geo: () => G.cachedGeo('fk:crystal', () => G.crystalGeo(0.22, 0.7, 0.2, 6)), m: [Math.sin(a) * 0.82, 0.15 + Math.cos(a) * 0.12, Math.cos(a) * 0.55 - 0.35, -0.15, 0, -a * 0.45, big, big, big] };
    }))), crystalM, { name: 'crystals' });
    // floating hands
    this.hands = [];
    for (const sd of [-1, 1]) {
      const h = grp(this.root, sd < 0 ? 'handL' : 'handR');
      const hm = add(h, () => G.cachedGeo('fk:hand', () => mergePlain([
        { geo: UNIT.sphere, m: [0, 0, 0, 0, 0, 0, 0.85, 0.7, 0.55] },
        { geo: UNIT.sphere, m: [-0.52, 0.62, 0.05, 0, 0, 0.35, 0.3, 0.42, 0.3] },
        { geo: UNIT.sphere, m: [-0.18, 0.78, 0.05, 0, 0, 0.12, 0.3, 0.45, 0.3] },
        { geo: UNIT.sphere, m: [0.18, 0.78, 0.05, 0, 0, -0.12, 0.3, 0.45, 0.3] },
        { geo: UNIT.sphere, m: [0.52, 0.62, 0.05, 0, 0, -0.35, 0.3, 0.42, 0.3] },
        { geo: UNIT.sphere, m: [0.85, -0.1, 0.1, 0, 0, -0.9, 0.3, 0.42, 0.3] },
      ])), handM, { r: [0, sd < 0 ? PI : 0, 0], name: 'fogHand' });
      this.parts[sd < 0 ? 'handL' : 'handR'] = h;
      this.hands.push({ h, hm, sd });
    }
    // heart-star core (inside the chest, behind the curtain puffs)
    this.core = grp(this.body, 'core', [0, 3.0, 0.98]);
    this.parts.core = this.core;
    this.mCoreStar = P.mat(0xffd95a, { gloss: true, spec: 0.6, emissive: 0x201400, pure: true });
    this.mCoreHeart = P.mat(0xff7ab8, { gloss: true, spec: 0.6, emissive: 0x200810, pure: true });
    this.coreStar = add(this.core, UNIT.star, this.mCoreStar, { s: 1.1, name: 'coreStar' });
    this.coreHeart = add(this.core, UNIT.heart, this.mCoreHeart, { p: [0, -0.02, 0.12], s: 0.5, name: 'coreHeart' });
    this.coreGlowM = P.glow(0xffb0d8, { opacity: 0, pure: true });
    this.coreGlow = ell(this.core, this.coreGlowM, [0, 0, -0.42], 1.05, 1.05, 0.18, null, 'coreGlow');
    // tears + rain
    this.tearM = P.mat(0xbfe6ff, { gloss: true, spec: 0.6, transparent: true, opacity: 0.85, depthWrite: false, emissive: 0x102030, fogC: 0xb9a8f0 });
    this.tears = [];
    for (let i = 0; i < 6; i++) { const m = add(this.head, GEO.drop, this.tearM, { s: 0.14, name: 'tear' }); m.visible = false; this.tears.push({ m, sd: i % 2 ? 1 : -1, off: i / 6 }); }
    this.rain = [];
    for (let i = 0; i < 8; i++) { const m = add(this.root, GEO.drop, this.tearM, { s: 0.2, name: 'rain' }); m.visible = false; this.rain.push({ m, a: i * 0.785 + 0.3, r: 2.2 + (i % 3) * 0.9, off: (i * 0.37) % 1 }); }
    this.stars = makeStars(this, this.head, { n: 5, r: 1.5, size: 0.42, p: [0, 1.5, 0] });
    this.height = 6.3;
    this.radius = 2.4;
    this.flying = true; // floats on its wisp tail; origin stays at the ground
    this.centerY = 3.1;
    this.blends = { hurt: 0.06, dissolve: 0.3, defeated: 0.8, weak: 0.5, coreReveal: 0.3 };
    this.finish({
      by: 0, sq: 0, lean: 0, roll: 0, twist: 0, swell: 0, shake: 0, hx: 0, hz: 0,
      hLx: -3.1, hLy: 2.4, hLz: 0.9, hLr: 0.25, hLs: 1, hRx: 3.1, hRy: 2.4, hRz: 0.9, hRr: -0.25, hRs: 1,
      open: 0, coreGlow: 0.15, coreOut: 0, crownGlow: 0, tears: 0, rain: 0, diss: 0, mouthS: 1, look: 0, lookY: 0,
    });
  }
  pose(tg, anim, t, st, dt) {
    const T = this.T, happy = this.happy;
    this.starsOn = false;
    tg.by = Math.sin(T * 0.9) * 0.14;
    const hb = Math.sin(T * 1.1) * 0.15;
    tg.hLy = 2.4 + hb; tg.hRy = 2.4 - hb; tg.hLr = 0.25 + Math.sin(T * 0.7) * 0.08; tg.hRr = -0.25 - Math.sin(T * 0.8) * 0.08;
    this.ex = happy ? 'happy' : 'sad'; this.mo = happy ? 'smile' : 'frown';
    switch (anim) {
      case 'handSlam': {
        const sd = st.hand === 'L' ? -1 : 1, K = sd < 0 ? 'hL' : 'hR';
        const up = Ease.inOutSine(ramp(t, 0, 0.7)), down = Ease.inCubic(ramp(t, 0.7, 0.82)), back = Ease.inOutSine(ramp(t, 1.5, 2.1));
        let x, y, z, r, s;
        if (t < 0.7) { x = lerp(sd * 3.1, sd * 2.6, up); y = lerp(2.4, 6.4, up); z = lerp(0.9, 0.4, up); r = lerp(sd * 0.25, sd * -0.5, up); s = 1 + 0.15 * up; }
        else if (t < 1.5) { x = lerp(sd * 2.6, sd * 1.9, down); y = lerp(6.4, 0.55, down); z = lerp(0.4, 3.4, down); r = lerp(sd * -0.5, 0, down); s = 1.15; }
        else { x = lerp(sd * 1.9, sd * 3.1, back); y = lerp(0.55, 2.4, back); z = lerp(3.4, 0.9, back); r = lerp(0, sd * 0.25, back); s = lerp(1.15, 1, back); }
        tg[K + 'x'] = x; tg[K + 'y'] = y; tg[K + 'z'] = z; tg[K + 'r'] = r; tg[K + 's'] = s;
        if (t > 0.82 && t < 1.5) { tg.sq = -0.06 * decay(t - 0.82, 5, 14); tg[K + 's'] = 1.15 * (1 + 0.15 * decay(t - 0.82, 6, 18)); }
        tg.roll = -sd * 0.08 * win(t, 0.2, 1.6); tg.lean = 0.1 * win(t, 0.6, 1.6);
        this.ex = happy ? 'focus' : 'sad'; this.mo = t > 0.6 && t < 1.2 ? 'open' : this.mo;
        break;
      }
      case 'tearRain': {
        const sob = Math.max(0, Math.sin(T * 7));
        tg.tears = 1; tg.rain = ramp(t, 0.3, 0.8); tg.by += sob * 0.08; tg.sq = sob * 0.03; tg.hx = -0.12;
        tg.hLx = -2.2; tg.hLy = 3.6 + sob * 0.1; tg.hLz = 1.6; tg.hRx = 2.2; tg.hRy = 3.6 + sob * 0.1; tg.hRz = 1.6; tg.hLr = 0.8; tg.hRr = -0.8;
        this.ex = 'closed'; this.mo = 'wavy';
        break;
      }
      case 'roar': {
        const inh = Ease.inOutSine(ramp(t, 0, 0.4)), on = ramp(t, 0.4, 0.5) * (1 - ramp(t, 1.6, 2.0));
        tg.swell = 0.06 * inh * (1 - on) + 0.1 * on; tg.by += 0.3 * inh; tg.shake = on; tg.hx = -0.18 * on - 0.08 * inh;
        tg.hLx = lerp(-3.1, -3.6, on); tg.hLy = lerp(2.4, 4.6, on); tg.hLz = 1.2; tg.hRx = lerp(3.1, 3.6, on); tg.hRy = lerp(2.4, 4.6, on); tg.hRz = 1.2;
        tg.hLr = -0.6 * on + 0.25; tg.hRr = 0.6 * on - 0.25; tg.crownGlow = on; tg.mouthS = 1 + 0.35 * on;
        this.ex = on > 0.3 ? 'closed' : 'sad'; this.mo = on > 0.2 ? 'roar' : 'o';
        break;
      }
      case 'coreReveal': {
        const u = Ease.inOutSine(ramp(t, 0, 1.0));
        tg.open = u; tg.coreGlow = 0.15 + 0.85 * u; tg.coreOut = u; tg.lean = -0.12 * u;
        tg.hLx = -3.4; tg.hLy = 2.8; tg.hLz = 0.6; tg.hRx = 3.4; tg.hRy = 2.8; tg.hRz = 0.6; tg.hLr = -0.3; tg.hRr = 0.3;
        this.ex = 'surprised'; this.mo = 'o';
        break;
      }
      case 'weak': {
        tg.open = 1; tg.coreGlow = 0.7 + 0.3 * Math.sin(T * 5); tg.coreOut = 1; tg.by = -0.55 + Math.sin(T * 1.3) * 0.06; tg.lean = 0.1; tg.hx = 0.18;
        tg.hLx = -2.6; tg.hLy = 0.55; tg.hLz = 1.4; tg.hRx = 2.6; tg.hRy = 0.55; tg.hRz = 1.4; tg.hLr = 0.1; tg.hRr = -0.1; tg.hLs = 0.95; tg.hRs = 0.95;
        this.ex = 'tired'; this.mo = 'o'; this.starsOn = true;
        break;
      }
      case 'dissolve': {
        tg.open = 1; tg.coreGlow = 1; tg.coreOut = 1; tg.diss = t;
        this.ex = 'happy'; this.mo = 'smile';
        break;
      }
      case 'hurt': {
        const k = Math.exp(-t * 5);
        tg.sq = -0.08 * k * Math.cos(t * 15); tg.lean = -0.15 * k; tg.shake = 0.6 * k; tg.hx = -0.15 * k;
        tg.hLx = -3.5; tg.hLy = 3.2; tg.hRx = 3.5; tg.hRy = 3.2;
        this.ex = 'hurt'; this.mo = 'wavy';
        break;
      }
      case 'defeated': {
        tg.by = -0.45 + Math.sin(T * 0.9) * 0.08; tg.hx = 0.1; tg.hz = Math.sin(T * 0.7) * 0.06; tg.coreGlow = 0.5 + 0.2 * Math.sin(T * 2);
        tg.hLx = -0.95; tg.hLy = 2.5; tg.hLz = 1.9; tg.hRx = 0.95; tg.hRy = 2.5; tg.hRz = 1.9; tg.hLr = -0.5; tg.hRr = 0.5; tg.hLs = 0.75; tg.hRs = 0.75;
        this.ex = 'happy'; this.mo = 'smile';
        break;
      }
      default: {
        tg.look = Math.sin(T * 0.35) * 0.4; tg.lookY = -0.2;
      }
    }
  }
  apply(c, dt, st, anim, t) {
    const T = this.T;
    const sh = c.shake ? Math.sin(T * 45) * 0.04 * c.shake : 0;
    this.base.position.set(sh, c.by, 0);
    this.body.rotation.set(c.lean, c.twist, c.roll);
    const sy = 1 + c.sq + c.swell, sxz = 1 - c.sq * 0.5 + c.swell;
    this.body.scale.set(sxz, sy, sxz);
    this.head.rotation.set(c.hx, 0, c.hz);
    // fog puffs breathe, curtains part, dissolve scatters
    const dissolving = anim === 'dissolve';
    for (const p of this.pieces) {
      const b = 1 + Math.sin(T * 1.3 + p.ph) * 0.04;
      let x = p.x, y = p.y, z = p.z, s = p.r * b, op = 1;
      if (p.role === 'curtainL') { x -= 0.8 * c.open; y -= 0.15 * c.open; z -= 0.2 * c.open; s *= 1 - 0.15 * c.open; }
      if (p.role === 'curtainR') { x += 0.8 * c.open; y -= 0.2 * c.open; z -= 0.2 * c.open; s *= 1 - 0.15 * c.open; }
      if (p.role === 'curtainT') { y += 0.55 * c.open; z -= 0.25 * c.open; s *= 1 - 0.2 * c.open; }
      if (p.role === 'tail') { x += Math.sin(T * 1.6 + p.ph) * 0.12; }
      if (dissolving) {
        const u = clamp((c.diss - p.delay) / 1.2, 0, 1), e = Ease.outCubic(u);
        x += p.dir[0] * 1.8 * e; y += p.dir[1] * 1.8 * e; z += p.dir[2] * 1.8 * e; s *= 1 + 0.4 * e; op = 1 - u;
      }
      p.m.position.set(x, y, z);
      p.m.scale.set(s, s, s);
      p.m.userData.op = op;
      p.m.visible = op > 0.01;
    }
    // face, crown & hands fade with dissolve
    const hp = this.headPiece;
    this.head.position.set(hp.m.position.x, hp.m.position.y, hp.m.position.z);
    const headOp = hp.m.userData.op;
    this.head.traverse((n) => { if (n.isMesh && n !== this.crown.children[0]) n.userData.op = headOp; });
    const crownU = dissolving ? clamp((c.diss - 0.6) / 1.4, 0, 1) : 0;
    this.crown.position.y = 0.88 + 1.5 * Ease.outCubic(crownU);
    this.crown.children[0].userData.op = 1 - crownU;
    this.crown.visible = crownU < 0.99;
    this.pal.glowAdd(this.mCrystal, 0.4 * c.crownGlow, 0.15 * c.crownGlow, 0.5 * c.crownGlow);
    // mist halo
    for (const m of this.mists) {
      const a = m.a + T * 0.25;
      m.m.position.set(Math.cos(a) * m.r, m.y + Math.sin(T * 0.6 + m.a) * 0.2, Math.sin(a) * m.r * 0.4 - 0.9);
      m.m.scale.set(m.s, m.s * 0.8, m.s);
      m.m.userData.op = dissolving ? clamp(1 - c.diss / 1.5, 0, 1) : 1;
    }
    // hands
    const H = [[c.hLx, c.hLy, c.hLz, c.hLr, c.hLs], [c.hRx, c.hRy, c.hRz, c.hRr, c.hRs]];
    for (let i = 0; i < 2; i++) {
      const hd = this.hands[i], v = H[i];
      hd.h.position.set(v[0], v[1] + c.by, v[2]);
      hd.h.rotation.set(0.25, -hd.sd * 0.35, v[3]);
      hd.h.scale.set(v[4], v[4], v[4]);
      const hop = dissolving ? clamp(1 - (c.diss - 0.2) / 1.2, 0, 1) : 1;
      hd.hm.userData.op = hop;
      hd.h.visible = hop > 0.01;
    }
    // core
    const cg = c.coreGlow;
    this.core.position.set(0, 3.0 + (dissolving ? 0.6 * Ease.inOutSine(clamp(c.diss / 2.5, 0, 1)) : 0), 0.98 + 0.35 * c.coreOut);
    const grow = dissolving ? 1 + 0.6 * Ease.inOutSine(clamp((c.diss - 0.8) / 1.6, 0, 1)) : 1;
    const pulse = (1 + 0.08 * cg * Math.sin(T * 6)) * grow;
    this.core.scale.set(pulse, pulse, pulse);
    this.core.rotation.set(0, Math.sin(T * 0.8) * 0.25, Math.sin(T * 1.1) * 0.08);
    this.pal.glowAdd(this.mCoreStar, 0.32 * cg, 0.26 * cg, 0.04 * cg);
    this.pal.glowAdd(this.mCoreHeart, 0.34 * cg, 0.1 * cg, 0.2 * cg);
    this.coreGlowM.opacity = 0.5 * Math.max(0, cg - 0.2);
    this.coreGlow.visible = cg > 0.25;
    // tears stream down the cheeks; rain falls around
    for (const tr of this.tears) {
      tr.m.visible = c.tears > 0.05;
      if (!tr.m.visible) continue;
      const u = (T * 1.1 + tr.off) % 1;
      const p = onSphere(1.22, 23 * tr.sd, -14 - u * 40);
      tr.m.position.set(p[0] + tr.sd * u * 0.25, p[1] - u * u * 0.6, p[2] + 0.05);
      const k = 0.14 * Math.min(1, u * 5) * (1 - u * 0.4);
      tr.m.scale.set(k, k * 1.3, k);
    }
    for (const r of this.rain) {
      r.m.visible = c.rain > 0.05;
      if (!r.m.visible) continue;
      const u = (T * 0.75 + r.off) % 1;
      r.m.position.set(Math.cos(r.a) * r.r, 7.2 - u * 7.0, Math.sin(r.a) * r.r * 0.8 + 1.0);
      const k = 0.2 * Math.min(1, u * 6);
      r.m.scale.set(k * 0.8, k * 1.3, k * 0.8);
    }
    this.face.look(c.look, c.lookY);
    this.face.mouthS = c.mouthS;
    this.stars.update(dt, T, this.starsOn);
  }
}


// ============================================================================
// Gameplay sync data: durations / key moments (seconds of st.t). 'loop' anims
// can be held indefinitely. Positions are in the boss root's local space.
// ============================================================================
export const BOSS_TIMING = {
  mushking: {
    walk: { loop: true, note: 'st.speed 0..1.5 sets step rate' },
    jumpCrouch: { dur: 0.35, note: 'squash builds 0-0.35 then holds (trembles); launch any time after' },
    jumpAir: { loop: true, note: 'st.vy > -1 = rising stretch, else falling flutter' },
    land: { dur: 0.6, impact: 0 },
    stuck: { loop: true, weakPoint: 'stem/face pulses gold (parts.face)', note: 'flips cap-first into the ground over ~0.35s' },
    spore: { dur: 1.2, release: 0.47, note: 'spore puffs expand from the cap until ~1.7s' },
    summon: { dur: 1.3, spawn: 0.62 },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
  pumpkin: {
    walk: { loop: true },
    rollStart: { dur: 0.6, note: 'tucks 0-0.35; forward spin starts 0.25, full speed by 0.6 -> switch to roll' },
    roll: { loop: true, note: 'spins about X at 6+8*speed rad/s; legs/arms tucked' },
    dizzy: { loop: true, weakPoint: 'whole pumpkin pulses gold' },
    throwSeeds: { dur: 1.5, shots: [0.5, 0.8, 1.1], origin: 'parts.mouth' },
    vineWhip: { dur: 1.5, hit: [0.55, 0.85], frontAt: 0.7, reach: 3.5, note: 'st.hand L|R (default R); hand sweeps a ~3.3 radius arc behind-side -> front -> other side' },
    summon: { dur: 1.3, spawn: 0.6 },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
  thundercloud: {
    charge: { loop: true, note: 'builds over 0.6s (sparks, horn glow)' },
    strike: { dur: 0.6, hit: 0.12, bolt: [0.1, 0.42], origin: 'parts.boltBase', note: 'bolt length = st.boltLen (cloud center to ground, default 6)' },
    rain: { loop: true },
    descend: { loop: true, weakPoint: 'parts.core rises out of the parted top puffs and pulses', note: 'sinks 0.7 below origin over 0.8s' },
    hurt: { dur: 0.45 }, defeated: { loop: true, note: 'rainbow appears behind' },
  },
  chameleon: {
    walk: { loop: true },
    cling: { loop: true, note: 'head-down on a wall at local z=-1.3 (see class comment)' },
    tongueWindup: { dur: 0.45, note: 'then holds (throat sac pulses)' },
    tongueOut: { dur: 0.7, reachAt: 0.18, holdUntil: 0.45, note: 'tongue length = st.tongueLen (default 7) along head +Z (starts ~1.4 high, gently sloping down); parts.tongueTip follows' },
    tongueStuck: { loop: true, weakPoint: 'tongue tip glows pink (parts.tongueTip)' },
    vanish: { dur: 1.15, note: 'body fades 0-0.85 with shimmer, eyes linger to 1.15, then fully hidden' },
    appear: { dur: 0.8, note: 'eyes 0-0.15, body 0.15-0.8' },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
  octopus: {
    swim: { loop: true },
    slam: { dur: 1.8, impact: 0.7, downUntil: 1.3, note: 'st.tentacle i (0..5): rises beside the head 0-0.55 (tip ~4.7 high), slams 0.55-0.7 lying flat along OCTO_YAW[i], tip ~5.9 from center; parts.tips[i] is the tip' },
    stuck: { loop: true, weakPoint: 'tentacle st.tentacle glows pink with a pulsing tip bubble (parts.tips[i])' },
    ink: { dur: 1.1, release: 0.45, origin: 'parts.mouth', note: 'ink blobs fly ~6 along +Z over 0.9s' },
    submerge: { dur: 1.0, note: 'sinks 5.4 below the ground plane' },
    emerge: { dur: 0.9, note: 'rises from -5.4 with overshoot' },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
  yeti: {
    walk: { loop: true }, charge: { loop: true, note: 'running, st.speed sets cadence' },
    throwWindup: { dur: 0.55, note: 'snowball grows in parts.handR 0.05-0.4, then holds' },
    throw: { dur: 0.6, release: 0.15, origin: 'parts.handR' },
    slam: { dur: 1.4, impact: 0.62, note: 'both hands hit the ground ~1.5 in front, hold to 1.0' },
    inhale: { loop: true }, blow: { loop: true, origin: 'parts.mouth', note: 'breath stream ~4.5 along +Z' },
    stunned: { loop: true, weakPoint: 'fur pulses gold' },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
  clockknight: {
    walk: { loop: true },
    chargeWindup: { dur: 0.6, note: 'lance lowers 0-0.4, paws ground from 0.3, then holds' },
    charge: { loop: true, note: 'lance forward (+Z); parts.lanceTip ~3.4 ahead' },
    spin: { loop: true, note: 'spin ramps to 15 rad/s by 0.45; lance sweeps horizontally (tip radius ~4)' },
    shoot: { dur: 1.2, shots: [0.45, 0.7], origin: ['parts.muzzleL', 'parts.muzzleR'] },
    unwound: { loop: true, weakPoint: 'parts.key glows gold; key slows to a stop over ~2.2s' },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
  fogking: {
    handSlam: { dur: 2.1, impact: 0.82, downUntil: 1.5, note: 'st.hand L|R; hand rises to y~6.4 then slams at (+-1.9, 0.55, 3.4)' },
    tearRain: { loop: true, note: 'tear drops fall around (radius 2-4) from y~7' },
    roar: { dur: 2.0, active: [0.4, 1.6] },
    coreReveal: { dur: 1.0, note: 'chest puffs part, parts.core comes forward and glows; holds open' },
    weak: { loop: true, weakPoint: 'parts.core exposed & pulsing' },
    dissolve: { dur: 2.6, note: 'fog pieces scatter/fade (outer first), hands 0.2-1.4, crown 0.6-2.0; core stays glowing' },
    hurt: { dur: 0.45 }, defeated: { loop: true },
  },
};

// ============================================================================
// registry
// ============================================================================
const BUILDERS = {
  mushking: () => new MushKing(),
  pumpkin: () => new Pumpkin(),
  thundercloud: () => new ThunderCloud(),
  chameleon: () => new Chameleon(),
  octopus: () => new Octopus(),
  yeti: () => new Yeti(),
  clockknight: () => new ClockKnight(),
  fogking: () => new FogKing(),
};
export const BOSS_IDS = Object.keys(BUILDERS);
export function buildBoss(id) { return (BUILDERS[id] || BUILDERS.mushking)(); }

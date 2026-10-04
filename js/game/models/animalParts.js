// ============================================================================
// models/animalParts.js — part library for Somi's 30 animal forms.
// Importing this module registers extra part types into the CharacterRig
// registry (registerPart). It also exports helpers used by animals.js/somi.js:
//   - placement on the real head/body ellipsoids (onHead / onBody / fitFace)
//   - painted "skin" textures: equirectangular maps painted in 3D direction
//     space, so markings land exactly where designed on the sphere meshes
//   - cached procedural geometry (soft cones, tubes, puffy outlines, merges)
//   - per-frame animation helpers for special parts (wings, trunk, joey...)
// Conventions: head local space = origin at head center, +Z forward, +Y up.
// Left side of the character = -X (armL/legL/earL), right = +X.
// ============================================================================
import { registerPart } from './rig.js';
import { G, UNIT, M, MG, MU, add, grp, ell, onSphere, approach, PI, TAU, lerp, clamp } from './common.js';
import { Texture } from '../../engine/renderer.js';
import { makeCanvas } from '../../engine/texgen.js';
import { Material } from '../../engine/material.js';
import { rgb, mulberry32 } from '../../engine/math.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const SIDES = [[-1, 'L'], [1, 'R']];

// ---------------------------------------------------------------- vectors
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dirOf = (yaw, pitch) => onSphere(1, yaw, pitch, [0, 0, 0]);

// ---------------------------------------------------------------- materials
// soft toon with baked vertex colors (merged geometry)
export const MV = (o = {}) => M(0xffffff, { vertexColors: true, ...o });
export const MVG = (o = {}) => MG(0xffffff, { vertexColors: true, ...o });
// material from: Material | color number | rig.mats key | undefined (-> def)
export function pickMat(rig, m, def) {
  if (m === undefined || m === null) return def;
  if (typeof m === 'number') return M(m);
  if (typeof m === 'string') return rig.mats[m] || def;
  return m;
}

// ---------------------------------------------------------------- placement
// point on ellipsoid surface (radii rad) in direction (yaw,pitch), lifted along the
// true surface normal. Returns { p, n, r } where r rotates local +Z onto the normal.
export function onEll(rad, yaw, pitch, lift = 0) {
  const d = dirOf(yaw, pitch);
  const t = 1 / Math.hypot(d[0] / rad[0], d[1] / rad[1], d[2] / rad[2]);
  const n = vnorm([(d[0] * t) / (rad[0] * rad[0]), (d[1] * t) / (rad[1] * rad[1]), (d[2] * t) / (rad[2] * rad[2])]);
  const p = [d[0] * t + n[0] * lift, d[1] * t + n[1] * lift, d[2] * t + n[2] * lift];
  return { p, n, r: [-Math.asin(clamp(n[1], -1, 1)), Math.atan2(n[0], n[2]), 0] };
}
export const headRad = (rig) => { const P = rig.P; return [P.headR * P.headS[0], P.headR * P.headS[1], P.headR * P.headS[2]]; };
export const bodyRad = (rig) => { const P = rig.P; return [P.bodyR * P.bodyS[0], P.bodyR * P.bodyS[1], P.bodyR * P.bodyS[2]]; };
export const onHead = (rig, yaw, pitch, lift = 0) => onEll(headRad(rig), yaw, pitch, lift);
export const onBody = (rig, yaw, pitch, lift = 0) => onEll(bodyRad(rig), yaw, pitch, lift);

// Re-seat eyes / cheeks / mouth on the real head ellipsoid (for non-default heads)
export function fitFace(rig, o = {}) {
  if (o.eyeYaw !== undefined || o.eyePitch !== undefined || o.eyeLift !== undefined) {
    const yaw = o.eyeYaw ?? 17, pitch = o.eyePitch ?? 5, lift = o.eyeLift ?? 0;
    rig.eyes.eyes.forEach((E, i) => {
      const s = onHead(rig, yaw * (i ? 1 : -1), pitch, lift - 0.006);
      E.pivot.position.set(s.p[0], s.p[1], s.p[2]); E.pivot.rotation.set(s.r[0], s.r[1], 0);
    });
  }
  if ((o.cheekYaw !== undefined || o.cheekPitch !== undefined || o.cheekLift !== undefined) && rig.cheeks.length) {
    const yaw = o.cheekYaw ?? 33, pitch = o.cheekPitch ?? -10, lift = o.cheekLift ?? 0.002;
    rig.cheeks.forEach((c, i) => {
      const s = onHead(rig, yaw * (i ? 1 : -1), pitch, lift);
      c.position.set(s.p[0], s.p[1], s.p[2]); c.rotation.set(s.r[0], s.r[1], 0);
      if (o.cheekSize) c.scale.set(0.07 * o.cheekSize, 0.04 * o.cheekSize, 0.012);
    });
  }
  if (o.mouthPitch !== undefined || o.mouthLift !== undefined) {
    const s = onHead(rig, 0, o.mouthPitch ?? -17, o.mouthLift ?? -0.004);
    rig.mouth.pivot.position.set(s.p[0], s.p[1], s.p[2]); rig.mouth.pivot.rotation.set(s.r[0], s.r[1], 0);
  }
  if (o.mouthScale) { const k = o.mouthScale; rig.mouth.pivot.scale.set(k[0] ?? k, k[1] ?? k, 1); }
}

// Remap / extend the mouth shapes the rig requests. extra: { shapeName: Node } shown instead.
export function mouthStyle(rig, map = {}, extra = {}) {
  const api = rig.mouth, orig = api.set.bind(api);
  rig.mouthShape = 'smile';
  api.set = (s) => {
    rig.mouthShape = s;
    const m = map[s] ?? s;
    let custom = false;
    for (const k in extra) { const on = k === m; extra[k].visible = on; if (on) custom = true; }
    orig(custom ? '__none' : m);
  };
  for (const k in extra) extra[k].visible = false;
  api.set('smile');
}

// ---------------------------------------------------------------- texture painter
// Equirectangular map for UNIT.sphere-style UVs (u=0 at +Z going toward +X,
// canvas row 0 = bottom pole). Layers: { color, f(x,y,z) -> coverage 0..1 }
// evaluated on the unit direction, blended in order over `base`.
const texCache = new Map();
export function paintSphereTex(key, base, layers, W = 512, H = 256) {
  let tex = texCache.get(key);
  if (tex) return tex;
  const cv = makeCanvas(W, H), g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const b = rgb(base).map((v) => v * 255);
  const Ls = layers.filter(Boolean).map((l) => ({ f: l.f, c: l.color === undefined ? null : rgb(l.color).map((v) => v * 255), fc: l.fc }));
  const sinP = new Float32Array(W), cosP = new Float32Array(W);
  for (let i = 0; i < W; i++) { const ph = ((i + 0.5) / W) * TAU; sinP[i] = Math.sin(ph); cosP[i] = Math.cos(ph); }
  const tmp = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const th = (1 - (j + 0.5) / H) * PI, st = Math.sin(th), y = Math.cos(th);
    for (let i = 0; i < W; i++) {
      const x = st * sinP[i], z = st * cosP[i];
      let r = b[0], gg = b[1], bb = b[2];
      for (let k = 0; k < Ls.length; k++) {
        const L = Ls[k];
        if (L.fc) { // full color function: returns [r,g,b,a] (0..255, a 0..1) or null
          const c = L.fc(x, y, z, tmp);
          if (c && c[3] > 0) { r += (c[0] - r) * c[3]; gg += (c[1] - gg) * c[3]; bb += (c[2] - bb) * c[3]; }
          continue;
        }
        const a = L.f(x, y, z);
        if (a > 0) { const c = L.c; r += (c[0] - r) * a; gg += (c[1] - gg) * a; bb += (c[2] - bb) * a; }
      }
      const o = (j * W + i) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = new Texture(cv, { wrap: 'repeat', mipmaps: true });
  texCache.set(key, tex);
  return tex;
}
const texMats = new Map();
export function texMat(key, tex, opts = {}) {
  let m = texMats.get(key);
  if (!m) { m = new Material({ color: 0xffffff, spec: 0.12, rim: 0.38, map: tex, ...opts }); texMats.set(key, m); }
  return m;
}

// ---- 2D/3D signed distance helpers (unit-sphere units ~ radians; negative inside)
const AA = 0.012;
export const cover = (sd, aa = AA) => { const t = clamp01(0.5 - sd / (2 * aa)); return t * t * (3 - 2 * t); };
export const SD = {
  ell(u, v, cx, cy, rx, ry, rot = 0) {
    let x = u - cx, y = v - cy;
    if (rot) { const c = Math.cos(rot), s = Math.sin(rot); const t = x * c + y * s; y = -x * s + y * c; x = t; }
    return (Math.hypot(x / rx, y / ry) - 1) * Math.min(rx, ry);
  },
  circle: (u, v, cx, cy, r) => Math.hypot(u - cx, v - cy) - r,
  seg(u, v, ax, ay, bx, by, ra, rb = ra) {
    const pax = u - ax, pay = v - ay, bax = bx - ax, bay = by - ay;
    const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
    return Math.hypot(pax - bax * h, pay - bay * h) - (ra + (rb - ra) * h);
  },
  // iq heart: tip at (0,0), lobes at (+-0.25,0.75) r=0.354 -> top ~1.1, half width ~0.6
  heart(u, v) {
    const x = Math.abs(u), y = v;
    if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
    const m = 0.5 * Math.max(x + y, 0);
    return Math.sqrt(Math.min(x * x + (y - 1) * (y - 1), (x - m) * (x - m) + (y - m) * (y - m))) * Math.sign(x - y);
  },
  // iq 5-point star (points up), r = outer radius, rf = inner ratio (~0.45)
  star5(u, v, r, rf = 0.45) {
    const k1x = 0.809016994375, k1y = -0.587785252292, k2x = -k1x, k2y = k1y;
    let x = Math.abs(u), y = v;
    let dd = 2 * Math.max(k1x * x + k1y * y, 0); x -= dd * k1x; y -= dd * k1y;
    dd = 2 * Math.max(k2x * x + k2y * y, 0); x -= dd * k2x; y -= dd * k2y;
    x = Math.abs(x); y -= r;
    const bax = rf * -k1y - 0, bay = rf * k1x - 1;
    const h = clamp((x * bax + y * bay) / (bax * bax + bay * bay), 0, r);
    return Math.hypot(x - bax * h, y - bay * h) * Math.sign(y * bax - x * bay);
  },
  smin(a, b, k = 0.04) { const h = clamp01(0.5 + (0.5 * (b - a)) / k); return lerp(b, a, h) - k * h * (1 - h); },
};
// tangent frame at a direction: e = east (+X at front), n = north
function frameAt(yaw, pitch) {
  const c = dirOf(yaw, pitch);
  let e = vcross([0, 1, 0], c);
  if (Math.hypot(e[0], e[1], e[2]) < 1e-4) e = [1, 0, 0];
  e = vnorm(e);
  return { c, e, n: vcross(c, e) };
}
// layer from a 2D SDF in the (orthographic) tangent plane at (yaw,pitch)
export function tan2d(yaw, pitch, sdf, color, aa = AA, minDot = 0.05) {
  const F = frameAt(yaw, pitch);
  return {
    color, f: (x, y, z) => {
      if (x * F.c[0] + y * F.c[1] + z * F.c[2] < minDot) return 0;
      return cover(sdf(x * F.e[0] + y * F.e[1] + z * F.e[2], x * F.n[0] + y * F.n[1] + z * F.n[2]), aa);
    },
  };
}
export const blob = (yaw, pitch, rx, ry, rot, color) => tan2d(yaw, pitch, (u, v) => SD.ell(u, v, 0, 0, rx, ry, rot || 0), color);
// tapered polyline stroke on the sphere: pts [[yaw, pitch, radius], ...]
export function stroke(pts, color, aa = AA) {
  const P = pts.map(([yw, pt, r]) => [...dirOf(yw, pt), r]);
  let cx = 0, cy = 0, cz = 0;
  for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const C = vnorm([cx, cy, cz]);
  let reach = 0;
  for (const p of P) reach = Math.max(reach, Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]) + p[3]);
  const reach2 = (reach + 0.05) ** 2;
  return {
    color, f: (x, y, z) => {
      const dx0 = x - C[0], dy0 = y - C[1], dz0 = z - C[2];
      if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > reach2) return 0;
      let best = 1e9;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
        const pax = x - a[0], pay = y - a[1], paz = z - a[2];
        const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
        const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz) - (a[3] + (b[3] - a[3]) * h);
        if (dd < best) best = dd;
      }
      return cover(best, aa);
    },
  };
}
// region by a plain function returning signed distance
export const region = (sdf, color, aa = AA) => ({ color, f: (x, y, z) => cover(sdf(x, y, z), aa) });
const yawOf = (x, z) => Math.atan2(x, z);
// voronoi patches (giraffe): seeds on the sphere; gap = line width (radians)
function voronoiLayer(seeds, color, gap, mask) {
  return {
    color, f: (x, y, z) => {
      let d1 = -9, d2 = -9;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i], dd = x * s[0] + y * s[1] + z * s[2];
        if (dd > d1) { d2 = d1; d1 = dd; } else if (dd > d2) d2 = dd;
      }
      // convert to approx angular distances
      const a1 = Math.acos(clamp(d1, -1, 1)), a2 = Math.acos(clamp(d2, -1, 1));
      const edge = (a2 - a1) * 0.5; // distance to bisector ~
      let c = cover(gap - edge, 0.012);
      // round the patches: also shrink near far corners
      if (mask) c *= mask(x, y, z);
      return c;
    },
  };
}
function fibSeeds(n, seed, jitter = 0.25) {
  const rnd = mulberry32(seed), out = [];
  const ga = PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    out.push(vnorm([Math.cos(th) * r + (rnd() - 0.5) * jitter, y + (rnd() - 0.5) * jitter, Math.sin(th) * r + (rnd() - 0.5) * jitter]));
  }
  return out;
}

// ---------------------------------------------------------------- skins
// Painted head/body textures by name. Each def -> { base, layers, W?, H? }
const SKIN = {};
export function defineSkin(name, fn) { SKIN[name] = fn; }
export function skinMat(name, opts) {
  const key = 'skin:' + name;
  if (texMats.has(key)) return texMats.get(key);
  const def = SKIN[name]();
  return texMat(key, paintSphereTex(key, def.base, def.layers, def.W || 512, def.H || 256), opts || def.mat || {});
}
// handy: front lower-face patch (muzzle/cheeks) as union of ellipses in front tangent plane
export function facePatch(color, parts, aa) {
  return tan2d(0, 0, (u, v) => {
    let d = 1e9;
    for (const p of parts) d = SD.smin(d, SD.ell(u, v, p[0], p[1], p[2], p[3], p[4] || 0), p[5] ?? 0.05);
    return d;
  }, color, aa, 0.0);
}

// paint every registered skin now (call during a loading screen to avoid first-use hitches)
export function prewarmSkins(names = Object.keys(SKIN)) { for (const n of names) skinMat(n); }
// fast normals for displaced sphereGeo(ws, hs) meshes: smooth + weld the u-seam and poles (O(n))
export function sphereNormals(g, ws, hs) {
  g.computeVertexNormals();
  const n = g.attributes.normal.array, row = ws + 1;
  const avg = (ids) => {
    let x = 0, y = 0, z = 0;
    for (const i of ids) { x += n[i * 3]; y += n[i * 3 + 1]; z += n[i * 3 + 2]; }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of ids) { n[i * 3] = x / l; n[i * 3 + 1] = y / l; n[i * 3 + 2] = z / l; }
  };
  for (let j = 0; j <= hs; j++) avg([j * row, j * row + ws]);
  for (const j of [0, hs]) { const ids = []; for (let i = 0; i <= ws; i++) ids.push(j * row + i); avg(ids); }
  g.markDirty('normal');
  return g;
}
// ---------------------------------------------------------------- geometry
const geo = (key, fn) => () => G.cachedGeo('ap:' + key, fn);
// convex "soft cone": unit base radius at y=-0.5, rounded tip at +0.5
function softConeProfile(rows = 14, pw = 0.75) {
  const pr = [[0, -0.5], [1, -0.5], [1, -0.5]];
  for (let i = 1; i < rows; i++) { const t = i / rows; pr.push([Math.pow(1 - t, pw) * (1 + 0.25 * t * (1 - t)), t - 0.5]); }
  pr.push([0, 0.5]);
  return pr;
}
export const GEO = {
  softCone: geo('softCone', () => G.latheGeo(softConeProfile(14, 0.75), 16)),
  blunt: geo('blunt', () => G.latheGeo(softConeProfile(10, 0.45), 14)), // stubby horn / ossicone
  spike: geo('spike', () => G.latheGeo([[0, -0.5], [1, -0.5], [1, -0.5], [0.88, -0.25], [0.66, 0], [0.42, 0.2], [0.22, 0.36], [0.08, 0.46], [0, 0.5]], 8)),
  thinTorus: geo('thinTorus', () => G.torusGeo(1, 0.12, 8, 40)),
  halfTorus: geo('halfTorus', () => G.torusGeo(1, 0.16, 8, 24, PI)),
  hemiDown: geo('hemiDown', () => G.sphereGeo(1, 20, 8, 0, TAU, PI / 2, PI / 2)),
  disc: geo('disc', () => G.cylinderGeo(1, 1, 1, 20, 1, true)),
};
// soft cone with a colored tip (vertex colors). tipFrom = unit height (0..1) where tip color starts
export function tipConeGeo(base, tip, tipFrom = 0.62) {
  return G.cachedGeo(`ap:tipCone:${base}:${tip}:${tipFrom}`, () => {
    const g = G.latheGeo(softConeProfile(22, 0.75), 16);
    const cb = rgb(base), ct = rgb(tip);
    return g.colorBy((x, y) => { const t = clamp01(((y + 0.5) - tipFrom) / 0.05 + 0.5); return [lerp(cb[0], ct[0], t), lerp(cb[1], ct[1], t), lerp(cb[2], ct[2], t)]; });
  });
}
// open Catmull-Rom through 3D control points -> n samples
export function splinePts(ctrl, n = 40) {
  const out = [], m = ctrl.length - 1;
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * m, k = Math.min(m - 1, Math.floor(u)), t = u - k;
    const p0 = ctrl[Math.max(0, k - 1)], p1 = ctrl[k], p2 = ctrl[k + 1], p3 = ctrl[Math.min(m, k + 2)];
    const t2 = t * t, t3 = t2 * t;
    out.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
  }
  return out;
}
// piecewise-linear profile lookup: prof [[t, v], ...]
export const profile = (prof) => (t) => {
  for (let i = 1; i < prof.length; i++) if (t <= prof[i][0]) { const a = prof[i - 1], b = prof[i]; return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1)); }
  return prof[prof.length - 1][1];
};
// tube along a polyline; radius: number | fn(t) ; ends: rounded with spheres when cap='round'
// colorFn(t) -> [r,g,b] bakes per-ring vertex colors
export function tubeGeo(pts, radius, radial = 10, cap = 'flat', colorFn = null) {
  const n = pts.length;
  const rad = (i) => (typeof radius === 'function' ? radius(i / (n - 1)) : radius);
  const T = [];
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; T.push(vnorm(vsub(b, a))); }
  let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const pos = [], nrm = [], uv = [], idx = [], col = [];
  for (let i = 0; i < n; i++) {
    const t = T[i];
    N = vnorm(vsub(N, t.map((v) => v * vdot(N, t))));
    const B = vcross(t, N), r = rad(i);
    // slope of the radius along the path tilts normals (smooth shading on tapers)
    const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(n - 1, i + 1)];
    const ds = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]) || 1;
    const dr = (rad(Math.min(n - 1, i + 1)) - rad(Math.max(0, i - 1))) / ds;
    const c0 = colorFn ? colorFn(i / (n - 1)) : null;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), sn = Math.sin(a);
      const ox = N[0] * c + B[0] * sn, oy = N[1] * c + B[1] * sn, oz = N[2] * c + B[2] * sn;
      pos.push(pts[i][0] + ox * r, pts[i][1] + oy * r, pts[i][2] + oz * r);
      const nn = vnorm([ox - t[0] * dr, oy - t[1] * dr, oz - t[2] * dr]);
      nrm.push(nn[0], nn[1], nn[2]); uv.push(j / radial, i / (n - 1));
      if (c0) col.push(c0[0], c0[1], c0[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 2, d = a + radial + 1;
    idx.push(a, b, c, a, c, d);
  }
  if (cap === 'flat') {
    for (const [i, sg] of [[0, -1], [n - 1, 1]]) {
      const ctr = pos.length / 3, t = T[i], cc = colorFn ? colorFn(i / (n - 1)) : null;
      pos.push(pts[i][0], pts[i][1], pts[i][2]); nrm.push(t[0] * sg, t[1] * sg, t[2] * sg); uv.push(0.5, 0.5);
      if (cc) col.push(cc[0], cc[1], cc[2]);
      const b0 = pos.length / 3;
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j; pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); nrm.push(t[0] * sg, t[1] * sg, t[2] * sg); uv.push(0, 0);
        if (cc) col.push(cc[0], cc[1], cc[2]);
      }
      for (let j = 0; j < radial; j++) idx.push(ctr, b0 + j, b0 + j + 1);
    }
  }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nrm, 3); g.setAttribute('uv', uv, 2);
  if (colorFn) g.setAttribute('color', col, 3);
  g.setIndex(idx);
  G.fixWinding(g);
  g.computeBoundingSphere();
  if (cap === 'round') {
    const items = [{ geo: g }];
    for (const i of [0, n - 1]) {
      const r = rad(i);
      if (r > 1e-4) items.push({ geo: UNIT.sphereLo(), matrix: G.trs(pts[i][0], pts[i][1], pts[i][2], 0, 0, 0, r, r, r), color: colorFn ? colorFn(i / (n - 1)) : [1, 1, 1] });
    }
    const m = G.mergeGeometries(items);
    if (!colorFn) delete m.attributes.color;
    return m;
  }
  return g;
}
// closed Catmull-Rom outline through control points
export function smoothOutline(ctrl, per = 6) {
  const n = ctrl.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  return out;
}
// merge [geoFn|geo, [px,py,pz], [rx,ry,rz]|null, s|[sx,sy,sz], colorHex?]
export function mergeParts(items) {
  return G.mergeGeometries(items.map(([gg, p, r, s, c]) => {
    const sc = Array.isArray(s) ? s : [s ?? 1, s ?? 1, s ?? 1];
    return {
      geo: typeof gg === 'function' ? gg() : gg,
      matrix: G.trs(p[0], p[1], p[2], r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, sc[0], sc[1], sc[2]),
      color: c === undefined || c === null ? [1, 1, 1] : rgb(c),
    };
  }));
}

// ============================================================================
// EARS
// ============================================================================
// pointed ears (fox, squirrel, tiger, kangaroo, horse...). opts: size,h,w,d,yaw,pitch,
// splay,tilt,twist,mat,inner(false|mat),tip(mat color for dark tips),tipFrom,tuft(color)
registerPart('ears', 'pointy', (rig, o) => {
  const sz = o.size ?? 1, h = (o.h ?? 0.26) * sz, w = (o.w ?? 0.13) * sz, d = (o.d ?? 0.085) * sz;
  const baseCol = o.color ?? rig.spec.colors.body;
  const outerMat = o.tip !== undefined ? MV() : pickMat(rig, o.mat, rig.mats.plain);
  const outerGeo = o.tip !== undefined ? () => tipConeGeo(baseCol, o.tip, o.tipFrom ?? 0.6) : GEO.softCone;
  const inner = o.inner === false ? null : pickMat(rig, o.inner, rig.mats.accent);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 34) * sd, o.pitch ?? 50, -(o.sink ?? 0.035));
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(o.tilt ?? -0.12, (o.twist ?? 0) * sd, -(o.splay ?? 0.35) * sd);
    add(ear, outerGeo, outerMat, { p: [0, h * 0.5, 0], s: [w, h, d] });
    if (inner) add(ear, GEO.softCone, inner, { p: [0, h * (o.innerY ?? 0.43), d * 0.42], s: [w * (o.innerW ?? 0.6), h * (o.innerH ?? 0.72), d * 0.5] });
    if (o.tuft !== undefined) add(ear, GEO.softCone, M(o.tuft), { p: [sd * w * 0.08, h * 1.02, 0], r: [0, 0, -sd * 0.25], s: [w * 0.32, h * 0.38, d * 0.4] });
  }
});
// round ears placed with an outward lift (e.g. on top of a lion mane)
registerPart('ears', 'roundOut', (rig, o) => {
  const sz = o.size ?? 1;
  const outer = pickMat(rig, o.mat, rig.mats.plain), inner = o.inner === false ? null : pickMat(rig, o.innerMat, rig.mats.accent);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 40) * sd, o.pitch ?? 50, o.lift ?? 0);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(o.tilt ?? -0.1, sd * (o.twist ?? 0.35), -sd * (o.splay ?? 0.35));
    ell(ear, outer, [0, 0.05 * sz, 0], 0.12 * sz, 0.12 * sz, 0.07 * sz);
    if (inner) ell(ear, inner, [0, 0.05 * sz, 0.04 * sz], 0.075 * sz, 0.075 * sz, 0.04 * sz);
  }
});
// leaf ears sticking out sideways (cow, sheep, giraffe, pig-ish). opts: len,wid,yaw,pitch,droop,fwd
registerPart('ears', 'side', (rig, o) => {
  const sz = o.size ?? 1, len = (o.len ?? 0.14) * sz, wid = (o.wid ?? 0.07) * sz, th = (o.th ?? 0.035) * sz;
  const outer = pickMat(rig, o.mat, rig.mats.plain), inner = o.inner === false ? null : pickMat(rig, o.inner, rig.mats.accent);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 70) * sd, o.pitch ?? 24, -0.03);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(o.tilt ?? 0.15, sd * (o.fwd ?? -0.25), -sd * (o.droop ?? 0.35));
    // ear extends along local +X*sd; inner faces forward (+Z)
    ell(ear, outer, [sd * len * 0.92, 0, 0], len, wid, th);
    if (inner) ell(ear, inner, [sd * len * 1.0, 0, th * 0.55], len * 0.68, wid * 0.6, th * 0.55);
  }
});
// big flat elephant ears facing forward. opts: size, yaw, pitch
registerPart('ears', 'elephant', (rig, o) => {
  const sz = o.size ?? 1;
  const outer = pickMat(rig, o.mat, rig.mats.plain), inner = pickMat(rig, o.inner, rig.mats.accent);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 74) * sd, o.pitch ?? 10, -0.05);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(0.05, sd * 0.42, sd * 0.08);
    ell(ear, outer, [sd * 0.15 * sz, -0.02 * sz, -0.01], 0.2 * sz, 0.23 * sz, 0.04 * sz, [0, 0, -sd * 0.15]);
    ell(ear, inner, [sd * 0.155 * sz, -0.025 * sz, 0.022 * sz], 0.145 * sz, 0.17 * sz, 0.025 * sz, [0, 0, -sd * 0.15]);
  }
});
// koala: big round fluffy ears with white fluff
registerPart('ears', 'koala', (rig, o) => {
  const sz = o.size ?? 1, outer = pickMat(rig, o.mat, rig.mats.plain), fluff = pickMat(rig, o.inner, rig.mats.white);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 58) * sd, o.pitch ?? 36, -0.03);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(0, sd * 0.45, -sd * 0.25);
    ell(ear, outer, [sd * 0.07 * sz, 0.06 * sz, -0.01], 0.165 * sz, 0.15 * sz, 0.075 * sz);
    ell(ear, fluff, [sd * 0.075 * sz, 0.055 * sz, 0.04 * sz], 0.115 * sz, 0.1 * sz, 0.05 * sz);
    ell(ear, fluff, [sd * 0.17 * sz, 0.1 * sz, 0.035 * sz], 0.055 * sz, 0.05 * sz, 0.04 * sz);
    ell(ear, fluff, [sd * 0.155 * sz, 0.0, 0.04 * sz], 0.05 * sz, 0.045 * sz, 0.038 * sz);
  }
});
// monkey: big round side ears facing forward-outward with peach inner
registerPart('ears', 'monkey', (rig, o) => {
  const sz = o.size ?? 1, outer = pickMat(rig, o.mat, rig.mats.plain), inner = pickMat(rig, o.inner, rig.mats.accent);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 84) * sd, o.pitch ?? 8, -0.03);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(0, sd * 0.55, 0);
    ell(ear, outer, [sd * 0.075 * sz, 0, 0], 0.11 * sz, 0.12 * sz, 0.045 * sz);
    ell(ear, inner, [sd * 0.08 * sz, 0, 0.026 * sz], 0.075 * sz, 0.085 * sz, 0.03 * sz);
  }
});
// pig: triangular ears flopping forward
registerPart('ears', 'pig', (rig, o) => {
  const sz = o.size ?? 1, outer = pickMat(rig, o.mat, rig.mats.plain), inner = pickMat(rig, o.inner, rig.mats.accent);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 40) * sd, o.pitch ?? 46, -0.03);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(o.flop ?? 0.7, sd * -0.35, -sd * (o.splay ?? 0.95));
    add(ear, GEO.blunt, outer, { p: [0, 0.075 * sz, 0], s: [0.16 * sz, 0.17 * sz, 0.055 * sz] });
    add(ear, GEO.blunt, inner, { p: [0, 0.07 * sz, 0.024 * sz], s: [0.1 * sz, 0.12 * sz, 0.028 * sz] });
  }
});
// red panda: rounded-pointed ears, rust back, white rim, dark inner
registerPart('ears', 'redpanda', (rig, o) => {
  const sz = o.size ?? 1;
  const back = pickMat(rig, o.mat, rig.mats.plain), rim = pickMat(rig, o.rim, rig.mats.white), inner = pickMat(rig, o.inner, rig.mats.dark);
  for (const [sd] of SIDES) {
    const ear = sd < 0 ? rig.earL : rig.earR;
    const s = onHead(rig, (o.yaw ?? 42) * sd, o.pitch ?? 46, -0.035);
    ear.position.set(s.p[0], s.p[1], s.p[2]);
    ear.rotation.set(-0.1, 0, -sd * 0.5);
    add(ear, GEO.blunt, back, { p: [0, 0.085 * sz, -0.005], s: [0.13 * sz, 0.2 * sz, 0.08 * sz] });
    add(ear, GEO.blunt, rim, { p: [0, 0.083 * sz, 0.018 * sz], s: [0.112 * sz, 0.18 * sz, 0.055 * sz] });
    add(ear, GEO.blunt, inner, { p: [0, 0.07 * sz, 0.038 * sz], s: [0.07 * sz, 0.12 * sz, 0.03 * sz] });
  }
});

// ============================================================================
// SNOUTS / FACE PARTS
// ============================================================================
// pig: flat snout disc with two nostrils
registerPart('snout', 'pig', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -10;
  const s = onHead(rig, 0, pitch, -0.01);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  const m = pickMat(rig, o.mat, rig.mats.accent);
  ell(sn, m, [0, 0, 0.03 * sz], 0.115 * sz, 0.085 * sz, 0.06 * sz);
  const nm = MG(o.nostril ?? 0xd8607f, { spec: 0.2 });
  for (const sd of [-1, 1]) ell(sn, nm, [sd * 0.038 * sz, 0.004, 0.085 * sz], 0.017 * sz, 0.03 * sz, 0.012);
  rig.snout = sn;
  fitFace(rig, { mouthPitch: pitch - 17 });
});
// cow: big pink muzzle with nostrils, mouth on the muzzle
registerPart('snout', 'cow', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -20;
  const s = onHead(rig, 0, pitch, -0.03);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  const m = pickMat(rig, o.mat, rig.mats.accent);
  ell(sn, m, [0, 0, 0.04 * sz], 0.2 * sz, 0.125 * sz, 0.1 * sz);
  const nm = MG(o.nostril ?? 0xd96f8c, { spec: 0.2 });
  for (const sd of [-1, 1]) ell(sn, nm, [sd * 0.07 * sz, 0.035 * sz, 0.128 * sz], 0.024 * sz, 0.03 * sz, 0.012, [0.5, 0, sd * 0.3]);
  rig.snout = sn;
  // mouth sits on the muzzle front-bottom
  const mp = rig.mouth.pivot;
  sn.add(mp); mp.position.set(0, -0.045 * sz, 0.13 * sz); mp.rotation.set(0.35, 0, 0);
});
// penguin beak (upper + hinged lower); hides the regular mouth
registerPart('snout', 'beak', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -9;
  const s = onHead(rig, 0, pitch, -0.01);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  const m = MG(o.color ?? 0xffa63d, { spec: 0.35 });
  ell(sn, m, [0, 0.008, 0.035 * sz], 0.055 * sz, 0.034 * sz, 0.06 * sz, [0.12, 0, 0]);
  const low = grp(sn, 'beakLow', [0, -0.012 * sz, 0.01 * sz]);
  ell(low, M(o.color2 ?? 0xff9530), [0, -0.008 * sz, 0.024 * sz], 0.042 * sz, 0.022 * sz, 0.042 * sz);
  rig.snout = sn; rig.beakLow = low;
  rig.mouth.pivot.visible = false;
});
// dolphin: rounded beak snout (painted 2-tone) with smile
registerPart('snout', 'dolphin', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -16;
  const s = onHead(rig, 0, pitch, -0.05);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  // tapered bullet beak along +Z, baked two-tone (body color on top, white underside)
  const top = o.color ?? rig.spec.colors.body, low = o.under ?? 0xffffff;
  const g = G.cachedGeo(`ap:dolphinBeak:${top}:${low}`, () => {
    const gg = G.latheGeo([[0, -0.5], [1, -0.5], [1, -0.5], [0.97, -0.3], [0.88, -0.1], [0.74, 0.1], [0.56, 0.27], [0.36, 0.4], [0.16, 0.48], [0, 0.5]], 20);
    gg.rotate(PI / 2, 0, 0);
    const ct = rgb(top), cl = rgb(low);
    return gg.colorBy((x, y) => { const k = clamp01((-y + 0.05) / 0.25); return [lerp(ct[0], cl[0], k), lerp(ct[1], cl[1], k), lerp(ct[2], cl[2], k)]; });
  });
  add(sn, g, MV(), { p: [0, 0, 0.075 * sz], s: [0.105 * sz, 0.082 * sz, 0.2 * sz], name: 'beak' });
  rig.snout = sn;
  const mp = rig.mouth.pivot;
  sn.add(mp); mp.position.set(0, -0.03 * sz, 0.135 * sz); mp.rotation.set(0.35, 0, 0); mp.scale.set(1.35, 1.05, 1);
});
// elephant trunk: chain of segments, rig.trunkTip at the end (spray origin)
registerPart('snout', 'trunk', (rig, o) => {
  const pitch = o.pitch ?? -8;
  const s = onHead(rig, 0, pitch, -0.03);
  const base = grp(rig.head, 'trunk', s.p, [s.r[0] + (o.down ?? 1.75), 0, 0]);
  const m = pickMat(rig, o.mat, rig.mats.plain);
  const segs = o.segs ?? 5, len = o.len ?? 0.068, r0 = o.r0 ?? 0.072, r1 = o.r1 ?? 0.048;
  const bends = o.bends ?? [0.05, -0.12, -0.25, -0.38, -0.5];
  const nodes = [];
  let p = base;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1), r = lerp(r0, r1, t);
    const n = grp(p, 'trunk' + i, i === 0 ? [0, 0, 0] : [0, len, 0], [bends[i] ?? 0, 0, 0]);
    add(n, capSeg(r, len), m, {});
    nodes.push(n); p = n;
  }
  // flared tip + nostril
  const tipN = grp(p, 'trunkTip', [0, len * 1.05, 0]);
  ell(tipN, m, [0, -0.005, 0], r1 * 1.22, 0.03, r1 * 1.22);
  add(tipN, UNIT.sphere, MG(o.nostril ?? 0x6f5a86, { spec: 0.15 }), { p: [0, 0.022, 0.0], s: [r1 * 0.55, 0.012, r1 * 0.45] });
  rig.trunk = base; rig.trunkNodes = nodes; rig.trunkTip = tipN;
  fitFace(rig, { mouthPitch: o.mouthPitch ?? -30 });
});
// koala big dark oval nose
registerPart('snout', 'koala', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -6;
  const s = onHead(rig, 0, pitch, -0.02);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  ell(sn, MG(o.color ?? 0x4d4466, { spec: 0.45 }), [0, 0, 0.03], 0.078 * sz, 0.095 * sz, 0.055 * sz);
  rig.snout = sn;
  fitFace(rig, { mouthPitch: pitch - 22 });
});
// capybara: broad boxy-round muzzle with a big dark nose pad
registerPart('snout', 'capy', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -14;
  const s = onHead(rig, 0, pitch, -0.05);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  const m = pickMat(rig, o.mat, rig.mats.plain);
  add(sn, () => G.cachedGeo('ap:capyMuzzle', () => G.roundedBoxGeo(1, 1, 1, 0.42, 4)), m, { p: [0, 0, 0.055 * sz], s: [0.3 * sz, 0.19 * sz, 0.19 * sz] });
  ell(sn, MG(o.nose ?? 0x5a4036, { spec: 0.4 }), [0, 0.04 * sz, 0.148 * sz], 0.07 * sz, 0.034 * sz, 0.022 * sz);
  rig.snout = sn;
  const mp = rig.mouth.pivot;
  sn.add(mp); mp.position.set(0, -0.03 * sz, 0.143 * sz); mp.rotation.set(0.1, 0, 0); mp.scale.set(0.9, 0.9, 1);
});
// hedgehog / small pointy snout with ball nose
registerPart('snout', 'pointy', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -9;
  const s = onHead(rig, 0, pitch, -0.03);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  ell(sn, pickMat(rig, o.mat, rig.mats.belly), [0, 0, 0.045 * sz], 0.085 * sz, 0.07 * sz, 0.085 * sz);
  ell(sn, rig.mats.nose, [0, 0.012 * sz, 0.123 * sz], 0.034 * sz, 0.028 * sz, 0.026 * sz);
  rig.snout = sn;
  const mp = rig.mouth.pivot;
  sn.add(mp); mp.position.set(0, -0.04 * sz, 0.105 * sz); mp.rotation.set(0.6, 0, 0); mp.scale.set(0.85, 0.85, 1);
});
// generic muzzle with custom material + optional whiskers (lion, bear, giraffe, otter...)
registerPart('snout', 'muzzle2', (rig, o) => {
  const sz = o.size ?? 1, pitch = o.pitch ?? -13;
  const s = onHead(rig, 0, pitch, -0.03);
  const sn = grp(rig.head, 'snout', s.p, s.r);
  const m = pickMat(rig, o.mat, rig.mats.belly);
  if (o.puffs) { // two cheek puffs (cat-like)
    for (const sd of [-1, 1]) ell(sn, m, [sd * 0.05 * sz, -0.012 * sz, 0.03 * sz], 0.068 * sz, 0.054 * sz, 0.052 * sz);
  } else ell(sn, m, [0, 0, 0.03 * sz], (o.w ?? 0.115) * sz, (o.h ?? 0.08) * sz, (o.d ?? 0.075) * sz);
  ell(sn, rig.mats.nose, [0, (o.noseY ?? 0.03) * sz, (o.noseZ ?? 0.098) * sz], (o.noseW ?? 0.034) * sz, (o.noseH ?? 0.024) * sz, 0.022 * sz);
  if (o.whiskers) {
    const wm = M(o.whiskerColor ?? 0x8c7a86);
    const wg = () => G.cachedGeo('whisker', () => G.capsuleGeo(0.006, 0.12, 4, 2));
    for (const sd of [-1, 1]) for (const k of [-1, 1]) add(sn, wg, wm, { p: [0.125 * sd * sz, k * 0.016, 0.02], r: [0, 0, PI / 2 + k * 0.14 * sd] });
  }
  rig.snout = sn;
  const mp = rig.mouth.pivot;
  sn.add(mp); mp.position.set(0, (o.mouthY ?? -0.045) * sz, (o.mouthZ ?? 0.085) * sz); mp.rotation.set(0.35, 0, 0);
});

// ============================================================================
// TAILS
// ============================================================================
// generic chain of ellipsoid segments under parent. segs: [{len, r, rz?, m, bend:[x,y,z], k?}]
export function segChain(parent, segs, name = 'seg') {
  const nodes = [];
  let p = parent, prevLen = 0;
  segs.forEach((s, i) => {
    const n = grp(p, name + i, i === 0 ? [0, 0, 0] : [0, prevLen, 0], s.bend || [0, 0, 0]);
    ell(n, s.m, [0, s.len * 0.5, 0], s.r, s.len * (s.k ?? 0.62), s.rz ?? s.r);
    nodes.push(n); p = n; prevLen = s.len;
  });
  return nodes;
}
// smooth capsule segment spanning y=0..len (joint spheres at both ends)
export const capSeg = (r, len) => G.cachedGeo(`ap:capSeg:${r.toFixed(4)}:${len.toFixed(4)}`, () => G.capsuleGeo(r, len, 12, 4).translate(0, len / 2, 0));
// chain of capsules (smooth thin tails). segs: [{len, r, rz?, m, bend}]
export function capChain(parent, segs, name = 'seg') {
  const nodes = [];
  let p = parent, prevLen = 0;
  segs.forEach((s, i) => {
    const n = grp(p, name + i, i === 0 ? [0, 0, 0] : [0, prevLen, 0], s.bend || [0, 0, 0]);
    const m = add(n, capSeg(s.r, s.len), s.m, {});
    if (s.rz) m.scale.z = s.rz / s.r;
    nodes.push(n); p = n; prevLen = s.len;
  });
  return nodes;
}
// chain tail (fluffy ellipsoids, or smooth capsules with smooth:true)
// o: { angle, yaw, smooth, k, segs:[[len, r, bend, matKeyOrColor, rz?], ...], tip:{m, r}, spade, wave }
registerPart('tail', 'chain', (rig, o) => {
  rig.tail.rotation.x = -(o.angle ?? 1.9);
  if (o.yaw) rig.tail.rotation.y = o.yaw;
  if (o.roll) rig.tail.rotation.z = o.roll;
  const segs = o.segs.map(([len, r, bend, m, rz]) => ({ len, r, rz, bend: Array.isArray(bend) ? bend : [bend, 0, 0], m: pickMat(rig, m, rig.mats.plain), k: o.k }));
  const nodes = o.smooth ? capChain(rig.tail, segs, 'tail') : segChain(rig.tail, segs, 'tail');
  const last = nodes[nodes.length - 1], lastLen = segs[segs.length - 1].len;
  if (o.tip) ell(last, pickMat(rig, o.tip.m, rig.mats.belly), [0, lastLen * (o.tip.y ?? 1.0), 0], o.tip.r, o.tip.ry ?? o.tip.r * 1.15, o.tip.r);
  if (o.spade) {
    const sp = grp(last, 'spade', [0, lastLen * 0.95, 0]);
    add(sp, UNIT.heart, MG(o.spade, { spec: 0.35 }), { p: [0, 0.07, 0], r: [0, PI / 2, PI], s: [0.17, 0.17, 0.22] });
  }
  rig.tailNodes = nodes;
  rig.tailWave = { amp: o.wave ?? 0.12, freq: o.waveF ?? 2.2, rest: segs.map((s) => s.bend.slice()) };
});
// smooth plume tail (fox, squirrel): one tube mesh along a spline, baked tip color
// o: { pts: [[x,y,z],...] tail-local (+Y up, -Z back), r: [[t, radius], ...], tip, tipFrom, yaw, wave }
registerPart('tail', 'plume', (rig, o) => {
  rig.tail.rotation.set(0, o.yaw ?? 0, o.roll ?? 0);
  const base = o.color ?? rig.spec.colors.body, tip = o.tip ?? base;
  const key = `ap:plume:${JSON.stringify(o.pts)}:${JSON.stringify(o.r)}:${base}:${tip}:${o.tipFrom}`;
  const g = G.cachedGeo(key, () => {
    const pts = splinePts(o.pts, o.n ?? 40);
    const rf = profile(o.r);
    const cb = rgb(base), ct = rgb(tip), t0 = o.tipFrom ?? 2;
    return tubeGeo(pts, rf, 16, 'round', (t) => { const k = clamp01((t - t0) / 0.05); return [lerp(cb[0], ct[0], k), lerp(cb[1], ct[1], k), lerp(cb[2], ct[2], k)]; });
  });
  const n = grp(rig.tail, 'tail0');
  add(n, g, MV({ rim: 0.42 }), { name: 'plume' });
  rig.tailNodes = [n];
  rig.tailWave = { amp: o.wave ?? 0.08, freq: 2, rest: [[0, 0, 0]] };
});
// tuft tail: thin hanging tail ending in a tuft ball (cow, lion, giraffe, elephant)
registerPart('tail', 'tuft', (rig, o) => {
  rig.tail.rotation.x = -(o.angle ?? 2.5);
  const m = pickMat(rig, o.mat, rig.mats.plain), tm = pickMat(rig, o.tuft, rig.mats.dark);
  const n = o.segs ?? 3, len = o.len ?? 0.07, r = o.r ?? 0.022;
  const segs = [];
  for (let i = 0; i < n; i++) segs.push({ len, r, m, bend: [i === 0 ? 0 : (o.bend ?? 0.28), 0, 0] });
  const nodes = capChain(rig.tail, segs, 'tail');
  ell(nodes[n - 1], tm, [0, len * 1.1, 0], o.tr ?? 0.05, (o.tr ?? 0.05) * 1.3, o.tr ?? 0.05);
  rig.tailNodes = nodes;
  rig.tailWave = { amp: 0.16, freq: 2.4, rest: segs.map((s) => s.bend.slice()) };
});
// pig curly tail (helix tube)
registerPart('tail', 'curly', (rig, o) => {
  const g = G.cachedGeo('ap:curlyTail', () => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, a = t * TAU * 1.35, rr = 0.036 * (1 - 0.25 * t);
      pts.push([Math.cos(a) * rr - rr, Math.sin(a) * rr, -t * 0.07]);
    }
    return tubeGeo(pts, (t) => 0.016 * (1 - 0.35 * t), 8, 'round');
  });
  rig.tail.rotation.set(-0.3, 0, 0);
  add(rig.tail, g, pickMat(rig, o.mat, rig.mats.plain), { p: [0.036, 0.0, 0.0], s: o.size ?? 1 });
});
// shark tail fin (vertical crescent) on a short stalk
registerPart('tail', 'sharkfin', (rig, o) => {
  rig.tail.rotation.x = -(o.angle ?? 1.6);
  const m = pickMat(rig, o.mat, rig.mats.plain);
  const stalk = grp(rig.tail, 'tail0');
  ell(stalk, m, [0, 0.06, 0], 0.07, 0.09, 0.06);
  const fin = grp(stalk, 'tailFin', [0, 0.13, 0]);
  add(fin, GEO.softCone, m, { p: [0, 0.02, 0.08], r: [0.75, 0, 0], s: [0.035, 0.19, 0.1] });
  add(fin, GEO.softCone, m, { p: [0, 0.02, -0.06], r: [2.45, 0, 0], s: [0.035, 0.14, 0.09] });
  rig.tailNodes = [stalk];
  rig.tailFin = fin;
});
// dolphin fluke (horizontal) on a short stalk
registerPart('tail', 'fluke', (rig, o) => {
  rig.tail.rotation.x = -(o.angle ?? 1.75);
  const m = pickMat(rig, o.mat, rig.mats.plain);
  const stalk = grp(rig.tail, 'tail0');
  ell(stalk, m, [0, 0.06, 0], 0.065, 0.1, 0.055);
  const fin = grp(stalk, 'tailFin', [0, 0.14, 0]);
  for (const sd of [-1, 1]) ell(fin, m, [sd * 0.075, 0.03, 0], 0.095, 0.05, 0.022, [0, 0, sd * 0.55]);
  rig.tailNodes = [stalk];
  rig.tailFin = fin;
});
// rainbow horse tail (merged pastel strands)
const RAINBOW = [0xff9ec9, 0xffc48a, 0xfff08a, 0x9ee8b0, 0x9fd4ff, 0xc9a8ff];
registerPart('tail', 'rainbow', (rig, o) => {
  rig.tail.rotation.x = -(o.angle ?? 2.3);
  const g = G.cachedGeo('ap:rainbowTail', () => {
    const items = [];
    RAINBOW.forEach((c, i) => {
      const a = (i - 2.5) * 0.17;
      items.push([UNIT.sphere, [Math.sin(a) * 0.05, 0.13, Math.cos(a) * 0.012 - 0.01], [0.15 * (i % 2 ? 1 : -1), 0, a * 1.2], [0.05, 0.15, 0.045], c]);
      items.push([UNIT.sphere, [Math.sin(a) * 0.12, 0.25, 0.03 + (i % 2) * 0.01], [0.5, 0, a * 1.6], [0.04, 0.09, 0.038], c]);
    });
    return mergeParts(items);
  });
  const n = grp(rig.tail, 'tail0');
  add(n, g, MV(), {});
  rig.tailNodes = [n];
  rig.tailWave = { amp: 0.12, freq: 2, rest: [[0, 0, 0]] };
});

// ============================================================================
// BODIES / ARMS / LEGS
// ============================================================================
// sheep wool: cloud cluster of white spheres (merged)
registerPart('body', 'wool', (rig, spec) => {
  const R = bodyRad(rig);
  const key = 'ap:wool:' + R.map((v) => v.toFixed(3)).join(',');
  const g = G.cachedGeo(key, () => {
    const items = [[UNIT.sphere, [0, 0, 0], null, [R[0] * 0.92, R[1] * 0.92, R[2] * 0.92], 0xfffcf7]];
    const shades = [0xffffff, 0xfdf7ef, 0xfffaf4];
    const ring = (n, pitch, rr, k, off = 0) => {
      for (let i = 0; i < n; i++) {
        const yw = off + (i / n) * 360, d = dirOf(yw, pitch);
        items.push([UNIT.sphere, [d[0] * R[0] * k, d[1] * R[1] * k, d[2] * R[2] * k], null, rr, shades[i % 3]]);
      }
    };
    ring(7, 2, R[0] * 0.48, 0.74, 0);
    ring(5, 42, R[0] * 0.44, 0.7, 36);
    ring(5, -35, R[0] * 0.42, 0.66, 18);
    items.push([UNIT.sphere, [0, R[1] * 0.62, 0], null, R[0] * 0.45, 0xffffff]);
    return mergeParts(items);
  });
  rig.bodyMesh = add(rig.hips, g, MV({ rim: 0.45 }), { name: 'body' });
});
// flippers / fins
registerPart('arms', 'flipper', (rig, arm, sd, spec) => {
  const o = spec.arms, P = rig.P, m = pickMat(rig, o.mat, rig.mats.limb);
  if (o.fin) add(arm, GEO.softCone, m, { p: [sd * 0.01, -P.armL * 0.85, -0.015], r: [PI + 0.25, 0, -sd * 0.18], s: [0.035, P.armL * 1.7, 0.1] });
  else ell(arm, m, [sd * 0.012, -P.armL * 0.78, -0.005], o.w ?? 0.045, P.armL * (o.len ?? 1.12), o.d ?? 0.082, [0.12, 0, sd * 0.12]);
});
// boxing gloves (kangaroo)
registerPart('arms', 'glove', (rig, arm, sd, spec) => {
  const o = spec.arms, P = rig.P;
  ell(arm, rig.mats.limb, [0, -P.armL * 0.55, 0], P.armR * 0.9, P.armL * 0.75, P.armR * 0.9, null, 'armMesh');
  const gm = MG(o.color ?? 0xff4f63, { spec: 0.45 });
  add(arm, GEO.thinTorus, M(o.cuff ?? 0xffffff), { p: [0, -P.armL * 1.0, 0], r: [PI / 2, 0, 0], s: [P.armR * 0.95, P.armR * 0.95, P.armR * 1.6] });
  ell(arm, gm, [0, -P.armL * 1.42, 0.012], P.armR * 1.38, P.armR * 1.3, P.armR * 1.42, null, 'glove');
  ell(arm, gm, [-sd * P.armR * 0.95, -P.armL * 1.25, 0.03], P.armR * 0.55, P.armR * 0.7, P.armR * 0.6, null, 'thumb');
});
// sleeve + hand (Somi pajamas, or two-tone paws)
registerPart('arms', 'sleeve', (rig, arm, sd, spec) => {
  const o = spec.arms, P = rig.P;
  const sm = pickMat(rig, o.mat, rig.mats.limb), hm = pickMat(rig, o.hand, rig.mats.white);
  ell(arm, sm, [0, -P.armL * 0.62, 0], P.armR * 1.05, P.armL * 0.82, P.armR, null, 'armMesh');
  if (o.cuff !== undefined) add(arm, GEO.thinTorus, pickMat(rig, o.cuff, rig.mats.white), { p: [0, -P.armL * 1.18, 0], r: [PI / 2, 0, 0], s: [P.armR * 0.92, P.armR * 0.92, P.armR * 1.4] });
  ell(arm, hm, [0, -P.armL * 1.38, 0.005], P.armR * 0.86, P.armR * 0.86, P.armR * 0.86, null, 'hand');
});
// hooves: soft foot + dark flat-bottomed hoof
registerPart('legs', 'hoof', (rig, leg, sd, spec) => {
  const o = spec.legs, P = rig.P, F = P.footS;
  const hipAbs = P.hipY + P.legY; // leg pivot height
  const hm = MG(o.hoof ?? 0x6b4a3a, { spec: 0.25 });
  const hh = o.hh ?? 0.055;
  ell(leg, rig.mats.foot, [0, -hipAbs + hh + 0.035, 0.012], F[0] * 0.92, 0.075, F[2] * 0.82, null, 'foot');
  add(leg, UNIT.cylinder, hm, { p: [0, -hipAbs + hh * 0.5, 0.012], s: [F[0] * 0.9, hh, F[2] * 0.82], name: 'hoof' });
});
// big long feet (kangaroo)
registerPart('legs', 'bigfoot', (rig, leg, sd, spec) => {
  const o = spec.legs, P = rig.P, hipAbs = P.hipY + P.legY;
  ell(leg, rig.mats.limb, [0, -hipAbs * 0.45, -0.01], 0.085, hipAbs * 0.55, 0.09, null, 'thigh');
  ell(leg, rig.mats.foot, [0, -hipAbs + 0.055, 0.075], o.w ?? 0.085, 0.056, o.l ?? 0.19, null, 'foot');
});
// webbed / toed flat feet (frog, penguin): merged foot + toes, colors baked
registerPart('legs', 'webbed', (rig, leg, sd, spec) => {
  const o = spec.legs, P = rig.P, hipAbs = P.hipY + P.legY;
  const fc = o.color ?? spec.colors.foot ?? spec.colors.limb ?? spec.colors.body, tc = o.toe ?? fc;
  const g = G.cachedGeo(`ap:webfoot:${fc}:${tc}`, () => mergeParts([
    [UNIT.sphere, [0, 0, 0], null, [0.105, 0.048, 0.11], fc],
    [UNIT.sphere, [-0.06, -0.008, 0.075], [0, -0.45, 0], [0.034, 0.03, 0.04], tc],
    [UNIT.sphere, [0, -0.008, 0.095], null, [0.036, 0.031, 0.042], tc],
    [UNIT.sphere, [0.06, -0.008, 0.075], [0, 0.45, 0], [0.034, 0.03, 0.04], tc],
  ]));
  if (o.thigh) ell(leg, rig.mats.limb, [0, -hipAbs * 0.4, -0.01], 0.08, hipAbs * 0.5, 0.085);
  add(leg, g, MV(), { p: [0, -hipAbs + 0.046, 0.03], r: [0, sd * 0.25, 0], name: 'foot' });
});
// pant leg + slipper (Somi)
registerPart('legs', 'slipper', (rig, leg, sd, spec) => {
  const o = spec.legs, P = rig.P, hipAbs = P.hipY + P.legY;
  ell(leg, pickMat(rig, o.pants, rig.mats.limb), [0, -hipAbs * 0.4, 0], 0.085, hipAbs * 0.55, 0.085, null, 'pants');
  // slipper + sole + pom merged into one vertex-colored mesh (colors baked, cached)
  const cs = o.slipper ?? 0xf6f0ff, cl = o.sole ?? 0xffbfd8, cp = o.pom ?? 0xff7fb0;
  const g = G.cachedGeo(`ap:slipper:${cs}:${cl}:${cp}`, () => mergeParts([
    [UNIT.sphere, [0, 0.056, 0], null, [0.098, 0.06, 0.13], cs],
    [UNIT.sphere, [0, 0.022, 0], null, [0.1, 0.022, 0.132], cl],
    [UNIT.sphere, [0, 0.104, 0.085], null, [0.038, 0.034, 0.034], cp],
  ]));
  add(leg, g, MV(), { p: [0, -hipAbs, 0.03], name: 'foot' });
});

// ============================================================================
// EXTRAS
// ============================================================================
// high-res head/body spheres (smoother silhouettes, nicer painted skins)
registerPart('extra', 'hires', (rig) => {
  if (rig.headMesh) rig.headMesh.geometry = UNIT.sphereHi();
  if (rig.bodyMesh && rig.bodyMesh.geometry === UNIT.sphere()) rig.bodyMesh.geometry = UNIT.sphereHi();
});
// painted skins: { head: 'skinName', body: 'skinName', belly: 'skinName' }
registerPart('extra', 'skin', (rig, o) => {
  if (o.head) rig.headMesh.material = rig.mats.head = skinMat(o.head);
  if (o.body && rig.bodyMesh) rig.bodyMesh.material = rig.mats.body = skinMat(o.body);
});
// face refit
registerPart('extra', 'face', (rig, o) => fitFace(rig, o));
// collar around the neck junction + tag/bell
registerPart('extra', 'collar', (rig, o) => {
  const R = bodyRad(rig), y = o.y ?? 0.075, k = Math.sqrt(Math.max(0.05, 1 - (y / R[1]) ** 2));
  const rx = R[0] * k + (o.grow ?? 0.012), rz = R[2] * k + (o.grow ?? 0.012);
  const g = grp(rig.hips, 'collar', [0, y, o.z ?? 0.0], [o.tilt ?? 0.12, 0, 0]);
  const th = o.th ?? 0.028;
  add(g, GEO.thinTorus, MG(o.color ?? 0xff5470, { spec: 0.3 }), { r: [PI / 2, 0, 0], s: [rx, rz, th / 0.12] });
  const front = grp(g, 'collarFront', [0, -th * 0.5, rz + th * 0.5 + (o.tagZ ?? 0.03)], [-(o.tagTilt ?? 0.2), 0, 0]);
  if (o.tag === 'bell') {
    const gold = MG(o.tagColor ?? 0xffcc33, { spec: 0.6, emissive: 0x2a1a00 });
    ell(front, gold, [0, -0.045, 0.012], 0.052, 0.05, 0.05);
    add(front, GEO.thinTorus, gold, { p: [0, -0.014, 0.012], r: [PI / 2, 0, 0], s: [0.05, 0.05, 0.12] });
    ell(front, MG(0x7a5a2a, { spec: 0.2 }), [0, -0.08, 0.03], 0.016, 0.012, 0.012);
    rig.bell = front;
  } else if (o.tag) {
    const gold = MG(o.tagColor ?? 0xffcc33, { spec: 0.6, emissive: 0x2a1a00 });
    if (o.tag === 'star') add(front, UNIT.star, gold, { p: [0, -0.04, 0.012], s: 0.08 });
    else if (o.tag === 'heart') add(front, UNIT.heart, gold, { p: [0, -0.04, 0.012], s: 0.075 });
    else add(front, GEO.disc, gold, { p: [0, -0.038, 0.01], r: [PI / 2, 0, 0], s: [0.034, 0.014, 0.034] });
    rig.tag = front;
  }
  rig.collar = g;
});
// horns (cow stubby, dragon swept-back) on the head
registerPart('extra', 'horns', (rig, o) => {
  const m = MG(o.color ?? 0xfff0c8, { spec: 0.35 });
  const sz = o.size ?? 1;
  for (const [sd] of SIDES) {
    const s = onHead(rig, (o.yaw ?? 30) * sd, o.pitch ?? 60, -0.02);
    const h = grp(rig.head, 'horn' + (sd < 0 ? 'L' : 'R'), s.p, [o.back ?? -0.25, 0, -sd * (o.splay ?? 0.45)]);
    add(h, o.geo === 'cone' ? GEO.softCone : GEO.blunt, m, { p: [0, 0.06 * sz, 0], s: [0.05 * sz, 0.14 * sz, 0.05 * sz] });
    if (o.curve) add(h, GEO.softCone, m, { p: [0, 0.12 * sz, -0.03 * sz], r: [-0.8, 0, 0], s: [0.032 * sz, 0.08 * sz, 0.032 * sz] });
  }
});
// sheep curly horns: coiled tubes lying on the upper side of the head (facing outward-forward)
registerPart('extra', 'ramhorns', (rig, o) => {
  const m = M(o.color ?? 0xe8c99a, { spec: 0.2 });
  for (const [sd] of SIDES) {
    const g = G.cachedGeo('ap:ramhorn3:' + sd, () => {
      const pts = [];
      for (let i = 0; i <= 44; i++) {
        const t = i / 44, a = PI * 0.5 - sd * t * TAU * 1.05, rr = 0.078 * (1 - 0.72 * t);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr, t * 0.03]);
      }
      return tubeGeo(pts, (t) => 0.034 * (1 - 0.55 * t), 10, 'round');
    });
    const s = onHead(rig, (o.yaw ?? 52) * sd, o.pitch ?? 38, o.lift ?? 0.03);
    const h = grp(rig.head, 'horn' + (sd < 0 ? 'L' : 'R'), s.p, [s.r[0], s.r[1] - sd * (o.turn ?? 0.25), 0]);
    add(h, g, m, { s: o.size ?? 1 });
  }
});
// giraffe ossicones
registerPart('extra', 'ossicones', (rig, o) => {
  const stalk = pickMat(rig, o.mat, rig.mats.plain), ball = M(o.tip ?? 0xa86a3a);
  for (const [sd] of SIDES) {
    const s = onHead(rig, (o.yaw ?? 20) * sd, o.pitch ?? 66, -0.03);
    const h = grp(rig.head, 'ossicone' + (sd < 0 ? 'L' : 'R'), s.p, [-0.12, 0, -sd * 0.2]);
    add(h, UNIT.cylinder, stalk, { p: [0, 0.06, 0], s: [0.03, 0.13, 0.03] });
    ell(h, ball, [0, 0.135, 0], 0.045, 0.042, 0.045);
  }
});
// unicorn spiral horn (rig.horn = tip node)
registerPart('extra', 'unihorn', (rig, o) => {
  const g = G.cachedGeo('ap:unihorn', () => {
    const prof = [[0, 0], [1, 0], [1, 0]];
    const rows = 26;
    for (let i = 1; i < rows; i++) { const t = i / rows; prof.push([Math.pow(1 - t, 0.9) * (1 - 0.1 * t), t]); }
    prof.push([0, 1]);
    const gg = G.latheGeo(prof, 28);
    gg.displace((v) => {
      const r = Math.hypot(v.x, v.z); if (r < 1e-5) return;
      const a = Math.atan2(v.x, v.z), k = 1 + 0.13 * Math.sin(a * 2 - v.y * 24) * Math.min(1, v.y * 8) * (1 - v.y * 0.6);
      v.x *= k; v.z *= k;
    });
    gg.smoothNormalsByPosition(1e-4);
    const c1 = rgb(0xffd65a), c2 = rgb(0xfff2b0);
    gg.colorBy((x, y, z) => { const a = Math.atan2(x, z); const t = 0.5 + 0.5 * Math.sin(a * 2 - y * 24); return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; });
    gg.computeBoundingSphere();
    return gg;
  });
  const s = onHead(rig, 0, o.pitch ?? 46, -0.03);
  const h = grp(rig.head, 'hornBase', s.p, [(o.lean ?? 0.42), 0, 0]);
  const L = o.len ?? 0.3, W = o.w ?? 0.065;
  add(h, g, MVG({ emissive: 0x1a1000 }), { s: [W, L, W] });
  rig.horn = grp(h, 'horn', [0, L, 0]);
  rig.hornBase = h;
});
// unicorn rainbow mane: flowing locks down the back of the head + top tuft + forelock (merged)
registerPart('extra', 'mane', (rig, o) => {
  const Rr = headRad(rig);
  const g = G.cachedGeo('ap:mane3:' + Rr.join(','), () => {
    const items = [];
    // lock: ellipsoid elongated along the meridian (local Y after onEll rotation), lifted off the surface
    const lock = (yw, pt, len, w, c, lift = 0.55, roll = 0) => {
      const s = onEll(Rr, yw, pt, w * lift);
      items.push([UNIT.sphere, s.p, [s.r[0], s.r[1], roll], [w, len, w * 0.85], c]);
    };
    // top locks behind the horn, sweeping back
    lock(-10, 76, 0.085, 0.06, RAINBOW[0], 0.5, 0.15);
    lock(12, 80, 0.08, 0.058, RAINBOW[2], 0.5, -0.15);
    lock(180, 84, 0.09, 0.064, RAINBOW[4], 0.5);
    // flowing locks down the back, two staggered columns
    const col = [[180, 66], [180, 46], [180, 26], [180, 6]];
    col.forEach(([yw, pt], i) => {
      lock(yw - 14, pt, 0.11, 0.068, RAINBOW[(i + 1) % 6], 0.55, 0.12);
      lock(yw + 14, pt - 9, 0.11, 0.068, RAINBOW[(i + 3) % 6], 0.55, -0.12);
    });
    lock(180, -10, 0.09, 0.06, RAINBOW[5], 0.5);
    // one forelock curling to the side under the horn (stays above the eye line)
    const f = onEll(Rr, 20, 46, 0.03);
    items.push([UNIT.sphere, f.p, [f.r[0] + 0.35, f.r[1], -1.0], [0.045, 0.085, 0.04], RAINBOW[5]]);
    return mergeParts(items);
  });
  rig.mane = add(rig.head, g, MV({ spec: 0.22, rim: 0.45 }), { name: 'mane' });
});
// lion mane: ring of puffs around the face (merged)
registerPart('extra', 'lionmane', (rig, o) => {
  const Rr = headRad(rig);
  const c1 = o.color ?? 0xe8893c, c2 = o.color2 ?? 0xd9772e, c3 = o.color3 ?? 0xf29e4c;
  const g = G.cachedGeo(`ap:lionmane:${Rr.join(',')}:${c1}`, () => {
    const items = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const yw = Math.sin(a) * 76, pt = Math.cos(a) * 78; // ring around the face in yaw/pitch space
      const s = onEll(Rr, yw, pt, 0.0);
      items.push([UNIT.sphere, s.p, s.r, [0.135, 0.135, 0.11], i % 2 ? c1 : c3]);
    }
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * TAU;
      const s = onEll(Rr, 180 + Math.sin(a) * 48, Math.cos(a) * 50, 0.0);
      items.push([UNIT.sphere, s.p, s.r, [0.13, 0.13, 0.1], i % 2 ? c2 : c1]);
    }
    const b = onEll(Rr, 180, 0, -0.02);
    items.push([UNIT.sphere, b.p, b.r, [0.16, 0.16, 0.1], c2]);
    return mergeParts(items);
  });
  rig.mane = add(rig.head, g, MV({ rim: 0.45 }), { name: 'mane' });
});
// fins on head or body (shark/dolphin). rig.fin
const finOutline = () => smoothOutline([[0.5, -0.05], [0.42, 0.25], [0.18, 0.6], [-0.18, 0.95], [-0.28, 0.85], [-0.24, 0.45], [-0.36, 0.12], [-0.45, -0.05]], 6).map(([x, y]) => [x, y - 0.38]);
export const finGeo = () => G.cachedGeo('ap:finGeo', () => G.puffyShapeGeo(finOutline(), 0.16, 5, 0.6).translate(0, 0.38, 0));
registerPart('extra', 'fin', (rig, o) => {
  const m = pickMat(rig, o.mat, rig.mats.plain);
  const onHd = o.on !== 'body';
  const s = onHd ? onHead(rig, 180, o.pitch ?? 74, -0.05) : onBody(rig, 180, o.pitch ?? 35, -0.03);
  const fin = grp(onHd ? rig.head : rig.hips, 'fin', s.p, [o.lean ?? 0.15, 0, 0]);
  const sz = o.size ?? 1;
  // outline lies in XY with +X forward: rotate so +X -> +Z (forward)
  add(fin, finGeo, m, { r: [0, -PI / 2, 0], s: [(o.len ?? 0.3) * sz, (o.h ?? 0.3) * sz, (o.th ?? 0.22) * sz], name: 'finMesh' });
  rig.fin = fin;
});
// dragon wings: rig.wingL / rig.wingR (pivots at the upper back)
const wingOutline = () => smoothOutline([[0.02, 0.16], [0.35, 0.42], [0.72, 0.62], [0.98, 0.58], [0.86, 0.3], [0.74, 0.32], [0.66, 0.08], [0.52, 0.14], [0.42, -0.08], [0.28, 0.02], [0.06, -0.06]], 5).map(([x, y]) => [x - 0.42, y - 0.2]);
export const wingGeo = () => G.cachedGeo('ap:wingGeo', () => G.puffyShapeGeo(wingOutline(), 0.07, 4, 0.6).translate(0.42, 0.2, 0));
registerPart('extra', 'wings', (rig, o) => {
  const mem = MG(o.membrane ?? 0xffa3c7, { spec: 0.25, rim: 0.5 }), bone = pickMat(rig, o.bone, rig.mats.plain);
  const sz = o.size ?? 1, R = bodyRad(rig);
  for (const [sd] of SIDES) {
    // root low on the upper back, below the big head's back bulge
    const w = grp(rig.hips, 'wing' + (sd < 0 ? 'L' : 'R'), [sd * (o.x ?? 0.1), o.y ?? 0.05, -R[2] * (o.zk ?? 0.9)]);
    const inner = grp(w, 'wingInner', [0, 0, 0], [0, sd < 0 ? PI : 0, 0]); // left = right rotated about Y (no mirroring)
    const k = 0.5 * sz;
    add(inner, wingGeo, mem, { s: [k, k, 0.55 * sz], name: 'membrane' });
    // leading-edge bones: root -> wrist -> tip
    const P0 = [0.02 * k, 0.16 * k], P1 = [0.35 * k, 0.42 * k], P2 = [0.97 * k, 0.58 * k];
    for (const [a, b, r] of [[P0, P1, 0.028], [P1, P2, 0.022]]) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      ell(inner, bone, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0], L * 0.55, r * sz, r * sz, [0, 0, Math.atan2(dy, dx)]);
    }
    ell(inner, bone, [P1[0], P1[1], 0], 0.034 * sz, 0.034 * sz, 0.034 * sz);
    w.userData.sd = sd;
    if (sd < 0) rig.wingL = w; else rig.wingR = w;
  }
  rig.wingState = { spread: 0, flap: 0 };
});
// back spikes (dragon): merged soft cones along the spine of head + body
registerPart('extra', 'spines', (rig, o) => {
  const c = o.color ?? 0xffb3cf;
  const Hr = headRad(rig), Br = bodyRad(rig);
  const spike = (rad, yw, pt, h) => {
    const s = onEll(rad, yw, pt, -0.015);
    return [GEO.blunt, [s.p[0] + s.n[0] * h * 0.42, s.p[1] + s.n[1] * h * 0.42, s.p[2] + s.n[2] * h * 0.42], [s.r[0] + PI / 2, s.r[1], 0], [h * 0.7, h, h * 0.42], c];
  };
  const gH = G.cachedGeo(`ap:spinesH2:${Hr.join(',')}:${c}`, () => mergeParts([[78, 0.1], [56, 0.11], [34, 0.1], [12, 0.085]].map(([pt, h]) => spike(Hr, 180, pt, h))));
  const gB = G.cachedGeo(`ap:spinesB2:${Br.join(',')}:${c}`, () => mergeParts([[-8, 0.085], [-36, 0.07]].map(([pt, h]) => spike(Br, 180, pt, h))));
  add(rig.head, gH, MV({ spec: 0.2 }), { name: 'spinesHead' });
  add(rig.hips, gB, MV({ spec: 0.2 }), { name: 'spinesBody' });
});
// turtle shell: painted hexagon dome + rim (rig.shell)
registerPart('extra', 'shell', (rig, o) => {
  const R = bodyRad(rig);
  const sh = grp(rig.hips, 'shell', [0, o.y ?? 0.045, o.z ?? -0.1], [o.tilt ?? 0.12, 0, 0]);
  const sx = o.sx ?? R[0] * 1.34, sy = o.sy ?? R[1] * 1.3, sz = o.sz ?? R[2] * 1.12;
  add(sh, UNIT.sphereHi, skinMat(o.skin ?? 'turtleShell', { spec: 0.3, rim: 0.4 }), { s: [sx, sy, sz], name: 'shellDome' });
  add(sh, GEO.thinTorus, MG(o.rim ?? 0xffe08a, { spec: 0.3 }), { p: [0, 0, o.rimZ ?? 0.0], s: [sx * 0.985, sy * 0.985, 0.36], name: 'shellRim' });
  rig.shell = sh;
});
// hedgehog spikes: merged soft spikes on the back of head + body; rig.spikes (group)
function spikeField(rad, pts, len, cBase, cTip, key) {
  return G.cachedGeo(key, () => {
    const base = GEO.spike();
    const cb = rgb(cBase), ct = rgb(cTip);
    const col = base.clone().colorBy((x, y) => { const t = clamp01((y + 0.1) / 0.6); return [lerp(cb[0], ct[0], t), lerp(cb[1], ct[1], t), lerp(cb[2], ct[2], t)]; });
    return G.mergeGeometries(pts.map(([yw, pt, k]) => {
      const s = onEll(rad, yw, pt, -0.012);
      const h = len * (k ?? 1);
      return { geo: col, matrix: G.trs(s.p[0] + s.n[0] * h * 0.42, s.p[1] + s.n[1] * h * 0.42, s.p[2] + s.n[2] * h * 0.42, s.r[0] + PI / 2, s.r[1], 0, h * 0.5, h, h * 0.5) };
    }));
  });
}
registerPart('extra', 'quills', (rig, o) => {
  const cB = o.color ?? 0x9a6a4a, cT = o.tip ?? 0xd8b48a, len = o.len ?? 0.13;
  const Hr = headRad(rig), Br = bodyRad(rig);
  const hp = [], bp = [];
  const rnd = mulberry32(7);
  // head: back hemisphere rows
  for (let row = 0; row < 6; row++) {
    const pt = 82 - row * 17, n = [3, 7, 9, 10, 10, 9][row];
    const span = [60, 150, 205, 230, 230, 220][row];
    for (let i = 0; i < n; i++) {
      const yw = 180 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span) + (rnd() - 0.5) * 6;
      hp.push([yw, pt + (rnd() - 0.5) * 5, 0.85 + rnd() * 0.3]);
    }
  }
  for (let row = 0; row < 4; row++) {
    const pt = 55 - row * 25, n = [5, 7, 8, 7][row], span = [120, 190, 210, 200][row];
    for (let i = 0; i < n; i++) bp.push([180 + (i / (n - 1) - 0.5) * span + (rnd() - 0.5) * 8, pt + (rnd() - 0.5) * 6, 0.8 + rnd() * 0.25]);
  }
  const gH = spikeField(Hr, hp, len, cB, cT, `ap:quillsH:${Hr.join(',')}:${cB}`);
  const gB = spikeField(Br, bp, len * 0.9, cB, cT, `ap:quillsB:${Br.join(',')}:${cB}`);
  const mat = MV({ spec: 0.15, rim: 0.3 });
  const body = grp(rig.hips, 'spikes');
  add(body, gB, mat, { name: 'spikesBody' });
  const head = grp(rig.head, 'spikesHead');
  add(head, gH, mat, { name: 'spikesHeadMesh' });
  rig.spikes = body; rig.spikesHead = head;
});
// capybara yuzu (rig.yuzu)
registerPart('extra', 'yuzu', (rig, o) => {
  const s = onHead(rig, o.yaw ?? -12, o.pitch ?? 72, 0.035);
  const y = grp(rig.head, 'yuzu', s.p, [s.r[0] * 0.3, 0, (o.roll ?? 0.15)]);
  ell(y, MG(0xffb42e, { spec: 0.35 }), [0, 0.035, 0], 0.075, 0.066, 0.075);
  ell(y, MG(0x8a6a30, { spec: 0.1 }), [0, 0.1, 0], 0.012, 0.016, 0.012);
  ell(y, MG(0x6fcf5a, { spec: 0.3 }), [0.04, 0.108, 0.0], 0.045, 0.012, 0.024, [0, 0.3, -0.35]);
  rig.yuzu = y;
});
// kangaroo pouch + baby joey peeking out (rig.joey)
registerPart('extra', 'pouch', (rig, o) => {
  const R = bodyRad(rig);
  const pz = R[2] * 0.82;
  const pouch = grp(rig.hips, 'pouch', [0, o.y ?? -0.085, pz]);
  const pm = pickMat(rig, o.mat, rig.mats.belly);
  ell(pouch, pm, [0, 0, 0], 0.135, 0.095, 0.085);
  add(pouch, GEO.thinTorus, M(o.rim ?? 0xe8c49a), { p: [0, 0.07, 0.035], r: [PI / 2 - 0.55, 0, 0], s: [0.105, 0.06, 0.18] });
  const joey = grp(pouch, 'joey', [0, 0.055, 0.03]);
  const jm = pickMat(rig, o.joeyMat, rig.mats.plain);
  ell(joey, jm, [0, 0.04, 0], 0.07, 0.064, 0.064, null, 'joeyHead');
  for (const sd of [-1, 1]) add(joey, GEO.softCone, jm, { p: [sd * 0.035, 0.11, -0.01], r: [-0.1, 0, -sd * 0.25], s: [0.032, 0.08, 0.022] });
  const eg = G.cachedGeo('ap:joeyEyes', () => {
    const it = [];
    for (const sd of [-1, 1]) {
      it.push([UNIT.sphere, [sd * 0.026, 0, 0], null, [0.0135, 0.021, 0.01], 0x2a1f3d]);
      it.push([UNIT.sphere, [sd * 0.026 - 0.004, 0.008, 0.007], null, [0.0055, 0.0075, 0.004], 0xffffff]);
    }
    return mergeParts(it);
  });
  const eyes = add(joey, eg, MVG(), { p: [0, 0.05, 0.059], name: 'joeyEyes' });
  ell(joey, rig.mats.nose, [0, 0.03, 0.066], 0.012, 0.009, 0.008);
  rig.joey = joey; rig.joeyEyes = eyes; rig.pouch = pouch;
});
// belly bulge fitted to the actual body radii (for non-default bodyS)
registerPart('extra', 'belly', (rig, o) => {
  const R = bodyRad(rig);
  ell(rig.hips, pickMat(rig, o.mat, rig.mats.belly), [0, o.y ?? -0.02, R[2] * (o.z ?? 0.56)], R[0] * (o.w ?? 0.6), R[1] * (o.h ?? 0.72), R[2] * 0.5, null, 'belly');
});
// heart-shaped belly patch (bear)
registerPart('extra', 'heartBelly', (rig, o) => {
  const s = onBody(rig, 0, o.pitch ?? -8, o.lift ?? -0.035);
  add(rig.hips, UNIT.heart, pickMat(rig, o.mat, rig.mats.belly), { p: s.p, r: [s.r[0], s.r[1], 0], s: [o.size ?? 0.3, (o.size ?? 0.3) * 0.95, o.depth ?? 0.22], name: 'belly' });
});
// chubby cheek puffs (hamster / quokka); moves the blush onto them
// inverse of Euler YX rotation (R = Ry(ry) * Rx(rx)) applied to a vector
function invRotYX(v, rx, ry) {
  const cy = Math.cos(-ry), sy = Math.sin(-ry);
  const x = v[0] * cy + v[2] * sy, y = v[1], z = -v[0] * sy + v[2] * cy;
  const cx = Math.cos(-rx), sx = Math.sin(-rx);
  return [x, y * cx - z * sx, y * sx + z * cx];
}
// point on a rotated ellipsoid (center c, radii r, rotation [rx,ry]) along world direction d
export function onRotEll(c, r, rot, d) {
  const l = invRotYX(d, rot[0], rot[1]);
  const t = 1 / Math.hypot(l[0] / r[0], l[1] / r[1], l[2] / r[2]);
  return [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
}
registerPart('extra', 'cheekPuffs', (rig, o) => {
  const m = pickMat(rig, o.mat, rig.mats.belly);
  const yaw = o.yaw ?? 46, pitch = o.pitch ?? -20, sz = o.size ?? 1, sink = o.sink ?? 0.05;
  const r = [0.14 * sz, 0.12 * sz, 0.11 * sz];
  rig.cheekPuffs = [];
  SIDES.forEach(([sd], i) => {
    const s = onHead(rig, yaw * sd, pitch, -sink * sz);
    rig.cheekPuffs.push(ell(rig.head, m, s.p, r[0], r[1], r[2], s.r, 'cheekPuff'));
    // blush sits on the puff surface, facing mostly forward
    const d = vnorm([s.n[0] * 0.75, s.n[1] * 0.75 + 0.2, s.n[2] * 0.75 + 0.6]);
    const p = onRotEll(s.p, r, s.r, d);
    const c = rig.cheeks[i];
    if (c) { c.position.set(p[0], p[1], p[2]); c.rotation.set(-Math.asin(d[1]), Math.atan2(d[0], d[2]), 0); }
  });
});
// frog eye bumps: eyes move onto two bumps on top of the head
registerPart('extra', 'eyeBumps', (rig, o) => {
  const m = pickMat(rig, o.mat, rig.mats.plain);
  const yaw = o.yaw ?? 26, pitch = o.pitch ?? 34, br = o.r ?? 0.13;
  rig.eyes.eyes.forEach((E, i) => {
    const sd = i ? 1 : -1;
    const s = onHead(rig, yaw * sd, pitch, -br * 0.45);
    const b = ell(rig.head, m, s.p, br, br * 0.95, br * 0.9, null, 'eyeBump');
    // eye on the bump front, facing mostly forward
    const fwd = [Math.sin(sd * (o.eyeOut ?? 0.32)) * 0.95, 0.1, Math.cos(sd * (o.eyeOut ?? 0.32))];
    const nn = vnorm(fwd);
    E.pivot.position.set(s.p[0] + nn[0] * br * 0.87, s.p[1] + nn[1] * br * 0.87 + 0.005, s.p[2] + nn[2] * br * 0.87);
    E.pivot.rotation.set(-Math.asin(nn[1]), Math.atan2(nn[0], nn[2]), 0);
    void b;
  });
});
// sleepy eyelids (capybara): lids live in each eye's 'open' group
registerPart('extra', 'eyelids', (rig, o) => {
  const m = pickMat(rig, o.mat, rig.mats.plain);
  const lash = MG(0x3a2a35, { spec: 0.1 });
  const s = o.size ?? 1, cover = o.cover ?? 0.42;
  for (const E of rig.eyes.eyes) {
    // lid = skin cap covering the top part of the eye, barely above the eye surface; dark lash line at its edge
    const top = 0.1 * s, edge = top - cover * 0.2 * s;
    const ry = (top - edge) * 0.5 + 0.012 * s;
    const sd = E.pivot.name === 'eyeL' ? -1 : 1;
    const lid = grp(E.open, 'lid', [0, edge + ry, 0.0], [0, 0, -sd * (o.droop ?? 0.2)]);
    ell(lid, m, [0, 0, 0], 0.07 * s, ry, 0.041 * s);
    add(lid, GEO.halfTorus, lash, { p: [0, 0.004 * s, 0.016 * s], r: [0.25, 0, PI], s: [0.064 * s, ry * 0.95, 0.07] });
  }
});
// small tusks (elephant)
registerPart('extra', 'tusks', (rig, o) => {
  const m = MG(0xfffaf0, { spec: 0.4 });
  for (const [sd] of SIDES) {
    const s = onHead(rig, (o.yaw ?? 15) * sd, o.pitch ?? -27, -0.01);
    add(rig.head, GEO.softCone, m, { p: s.p, r: [s.r[0] + 1.25, s.r[1], -sd * 0.25], s: [0.022, 0.07, 0.022], name: 'tusk' });
  }
});
// sheep wool tuft on the head (merged)
registerPart('extra', 'woolTuft', (rig, o) => {
  const Rr = headRad(rig);
  const g = G.cachedGeo('ap:woolTuft:' + Rr.join(','), () => {
    const items = [];
    const pts = [[0, 58, 0.1], [-26, 52, 0.09], [26, 52, 0.09], [0, 76, 0.11], [-44, 64, 0.095], [44, 64, 0.095], [180, 74, 0.11], [130, 62, 0.1], [-130, 62, 0.1], [180, 50, 0.1], [90, 70, 0.09], [-90, 70, 0.09]];
    pts.forEach(([yw, pt, r], i) => { const s = onEll(Rr, yw, pt, r * 0.2); items.push([UNIT.sphere, s.p, s.r, [r, r * 0.92, r], i % 2 ? 0xfdf7ef : 0xffffff]); });
    return mergeParts(items);
  });
  rig.tuft = add(rig.head, g, MV({ rim: 0.45 }), { name: 'woolTuft' });
});
// teeth: rabbit buck teeth or shark grin, attached to the mouth
registerPart('extra', 'buckTeeth', (rig, o) => {
  const w = MG(0xffffff, { spec: 0.4, rim: 0.2 });
  const t = grp(rig.mouth.pivot, 'teeth', [0, o.y ?? -0.024, 0.006]);
  for (const sd of [-1, 1]) add(t, UNIT.rbox, w, { p: [sd * 0.0105, -0.012, 0], s: [0.019, 0.026, 0.01] });
  rig.teeth = t;
});
registerPart('extra', 'sharkGrin', (rig, o) => {
  const dark = MG(0x7a2440, { spec: 0.1, rim: 0 });
  const grin = grp(rig.mouth.pivot, 'grin', [0, 0.004, 0]);
  add(grin, GEO.hemiDown, dark, { s: [0.075, 0.045, 0.014] });
  ell(grin, MU(0xff7a96), [0, -0.03, 0.004], 0.035, 0.012, 0.006);
  const tg = G.cachedGeo('ap:sharkTeeth', () => mergeParts([-0.052, -0.026, 0, 0.026, 0.052].map((x) => [GEO.softCone, [x, -0.008, 0.01], [0, 0, PI], [0.012, 0.022, 0.006], 0xffffff])));
  add(grin, tg, MV({ spec: 0.3 }), {});
  mouthStyle(rig, { smile: 'grin', open: 'grin' }, { grin });
  // 'open' -> taller grin
  const api = rig.mouth, prev = api.set;
  api.set = (s) => { prev(s); grin.scale.y = s === 'open' ? 1.5 : 1; };
  api.set('smile');
});

// giraffe long neck: rig.neckExt (scale.y stretches the neck; neckUpdate keeps the head attached)
registerPart('extra', 'giraffeNeck', (rig, o) => {
  const P = rig.P;
  const y0 = o.y0 ?? 0.08, y1 = P.headY - (o.top ?? 0.2);
  const L = y1 - y0, r = o.r ?? 0.11;
  const ext = grp(rig.hips, 'neckExt', [0, y0, o.z ?? -0.01]);
  const m = o.skin ? skinMat(o.skin) : pickMat(rig, o.mat, rig.mats.body);
  add(ext, UNIT.cylinder, m, { p: [0, L / 2, 0], s: [r, L, r * 0.95], name: 'neckMesh' });
  if (o.mane !== undefined) add(ext, UNIT.sphere, M(o.mane), { p: [0, L * 0.55, -r * 0.9], s: [0.026, L * 0.52, 0.04], name: 'neckMane' });
  ext.userData.len = L;
  rig.neckExt = ext;
});
// extra-happy D-shaped open smile (quokka): replaces 'smile' and 'open'
registerPart('extra', 'happyMouth', (rig, o) => {
  const dark = MG(0x8a2a40, { spec: 0.1, rim: 0 });
  const w = o.w ?? 1, h = o.h ?? 1;
  const g = grp(rig.mouth.pivot, 'happy', [0, 0.008, 0]);
  add(g, GEO.hemiDown, dark, { s: [0.052 * w, 0.044 * h, 0.014] });
  ell(g, MU(0xff7a96), [0, -0.028 * h, 0.006], 0.026 * w, 0.012 * h, 0.006);
  mouthStyle(rig, { smile: 'happy', open: 'happy' }, { happy: g });
});
// plain remap of mouth shapes (e.g. rabbit { smile: 'w' })
registerPart('extra', 'mouthMap', (rig, o) => mouthStyle(rig, o.map || {}));

// ============================================================================
// ANIMATION HELPERS (call from spec.onUpdate)
// ============================================================================
export function tailWave(rig, dt, st) {
  const W = rig.tailWave; if (!W || !rig.tailNodes) return;
  const T = rig.time, a = st.anim;
  const amp = W.amp * (a === 'walk' || a === 'run' ? 1.6 : a === 'celebrate' ? 2 : a === 'swim' ? 2.2 : 1);
  const f = W.freq * (a === 'walk' || a === 'run' || a === 'swim' ? 2.2 : 1);
  rig.tailNodes.forEach((n, i) => {
    const r = W.rest[i] || [0, 0, 0];
    n.rotation.z = r[2] + Math.sin(T * f - i * 0.7) * amp * (0.4 + i * 0.3);
    n.rotation.x = r[0] + Math.sin(T * f * 0.7 - i * 0.5) * amp * 0.25;
  });
}
// dragon wings: fold at rest, flap in fly/hover/jump, spread in glide
export function wingsUpdate(rig, dt, st) {
  const S = rig.wingState; if (!S) return;
  const a = st.anim, T = rig.time;
  let spread = 0.15, amp = 0.08, f = 3;
  if (a === 'fly') { spread = 0.8; amp = 0.75; f = 14; }
  else if (a === 'hover') { spread = 0.85; amp = 0.65; f = 20; }
  else if (a === 'glide') { spread = 1; amp = 0.05; f = 3; }
  else if (a === 'jump' || a === 'airAttack') { spread = 0.75; amp = 0.55; f = 12; }
  else if (a === 'fall') { spread = 0.7; amp = 0.25; f = 9; }
  else if (a === 'walk' || a === 'run') { spread = 0.25; amp = 0.12; f = 8; }
  else if (a === 'celebrate') { spread = 0.8; amp = 0.4; f = 10; }
  else if (a === 'swim') { spread = 0.1; amp = 0.05; f = 3; }
  S.spread = approach(S.spread, spread, 8, dt);
  S.amp = approach(S.amp ?? amp, amp, 8, dt);
  S.ph = (S.ph ?? 0) + dt * f;
  const fl = Math.sin(S.ph) * S.amp;
  for (const w of [rig.wingL, rig.wingR]) {
    const sd = w.userData.sd;
    // y: sweep back when folded ; z: raise/lower (flap) ; x: tip back a little
    w.rotation.y = sd * lerp(0.62, 0.08, S.spread);
    w.rotation.z = sd * (lerp(0.62, 0.22, S.spread) + fl);
    w.rotation.x = lerp(-0.15, 0.05, S.spread);
  }
}
// elephant trunk sway / spray / ears flap
export function trunkUpdate(rig, dt, st) {
  const nodes = rig.trunkNodes; if (!nodes) return;
  const a = st.anim, T = rig.time;
  const spray = a === 'special' && st.specialKind === 'spray';
  const up = spray ? 1 : a === 'celebrate' ? 0.8 : a === 'surprised' ? 0.5 : 0;
  rig._trunkUp = approach(rig._trunkUp ?? 0, up, 8, dt);
  const sw = a === 'walk' || a === 'run' ? 0.25 : 0.12;
  const U = rig._trunkUp;
  nodes.forEach((n, i) => {
    const r = n.userData.rest;
    // raised (spray/celebrate): base lifts to point forward-up and the curl straightens into a hose
    const rx = i === 0 ? r.rx - 1.05 * U : r.rx * (1 - 0.9 * U) - 0.05 * U;
    n.rotation.x = rx + Math.sin(T * 2.1 - i * 0.6) * 0.06 * (1 - U * 0.7);
    n.rotation.z = r.rz + Math.sin(T * (a === 'walk' || a === 'run' ? 9 : 1.6) - i * 0.5) * sw * (0.3 + i * 0.2) * (1 - U * 0.8);
  });
  if (rig.earL && rig.spec.ears && rig.spec.ears.type === 'elephant') {
    const fl = Math.sin(T * (a === 'hover' || a === 'fly' ? 18 : 2.2)) * (a === 'hover' || a === 'fly' ? 0.45 : 0.08);
    rig.earL.rotation.y = rig.earL.userData.rest.ry - fl;
    rig.earR.rotation.y = rig.earR.userData.rest.ry + fl;
  }
}
// kangaroo joey: bob + blink + peek
export function joeyUpdate(rig, dt, st) {
  const j = rig.joey; if (!j) return;
  const T = rig.time, a = st.anim;
  const r = j.userData.rest;
  const hide = a === 'roll' || a === 'ball' || a === 'hurt' || a === 'pound';
  rig._joeyHide = approach(rig._joeyHide ?? 0, hide ? 1 : 0, 10, dt);
  j.position.y = r.py + Math.sin(T * 2.6) * 0.006 + (a === 'jump' || a === 'celebrate' ? 0.012 : 0) - rig._joeyHide * 0.07;
  j.rotation.z = Math.sin(T * 1.3) * 0.12;
  rig._joeyBlink = (rig._joeyBlink ?? 2) - dt;
  if (rig._joeyBlink < 0) rig._joeyBlink = 2 + Math.random() * 2.5;
  rig.joeyEyes.scale.y = rig._joeyBlink < 0.12 ? 0.15 : 1;
}
// penguin beak opens with the mouth shape
export function beakUpdate(rig, dt) {
  if (!rig.beakLow) return;
  const s = rig.mouthShape;
  const open = s === 'open' ? 0.55 : s === 'o' ? 0.35 : 0;
  rig.beakLow.rotation.x = approach(rig.beakLow.rotation.x, open, 20, dt);
}
// giraffe: keep head attached to the stretched neck
export function neckUpdate(rig) {
  const ext = rig.neckExt; if (!ext) return;
  const L = ext.userData.len, nr = rig.neck.userData.rest;
  rig.neck.position.y = nr.py + L * (ext.scale.y - 1);
}
// hedgehog: head spikes follow rig.spikes (scale / visibility), puff in ball/roll
export function spikesUpdate(rig, dt, st) {
  if (!rig.spikes) return;
  const a = st.anim;
  const k = a === 'roll' || a === 'ball' || (a === 'special' && st.specialKind === 'curl') ? 1.18 : a === 'hurt' ? 1.1 : 1;
  rig._spk = approach(rig._spk ?? 1, k, 12, dt);
  rig.spikes.scale.set(rig._spk, rig._spk, rig._spk);
  rig.spikesHead.visible = rig.spikes.visible;
  rig.spikesHead.scale.copy(rig.spikes.scale);
}
// generic fin / fluke swish (shark, dolphin) on top of the rig's tail wag
export function finUpdate(rig, dt, st) {
  const a = st.anim, T = rig.time;
  if (rig.tailFin) {
    const swim = a === 'swim' || a === 'dive';
    const k = swim ? 0.5 : a === 'walk' || a === 'run' ? 0.3 : 0.12;
    const isFluke = rig.spec.tail && rig.spec.tail.type === 'fluke';
    if (isFluke) rig.tailFin.rotation.x = Math.sin(T * (swim ? 9 : 3)) * k;
    else rig.tailFin.rotation.z = Math.sin(T * (swim ? 9 : 3)) * k;
  }
  if (rig.fin && rig.fin.userData.rest) rig.fin.rotation.z = Math.sin(T * 1.7) * 0.05;
}
// one-shot ribbon finishing: gold star on the back so the bow reads from behind
export function finishRibbon(rig) {
  const rb = rig.ribbon; if (!rb || rb.userData.backStar) return;
  const gold = MG(0xffd23f, { spec: 0.6, emissive: 0x332200 });
  const st = add(rb, UNIT.star, gold, { p: [0, 0.008, -0.035], r: [0, PI, 0], s: 0.075, name: 'ribbonStarBack' });
  rb.userData.backStar = st;
  st.userData.rest = { px: 0, py: 0.008, pz: -0.035, rx: 0, ry: PI, rz: 0, sx: 0.075, sy: 0.075, sz: 0.075 };
}

// ============================================================================
// SKIN DEFINITIONS (painted textures)
// ============================================================================
defineSkin('tigerHead', () => ({
  base: 0xffa04a,
  layers: [
    facePatch(0xfff8ee, [[0, -0.42, 0.42, 0.3], [-0.3, -0.3, 0.26, 0.2], [0.3, -0.3, 0.26, 0.2]]),
    blob(-22, 26, 0.07, 0.05, 0, 0xfff8ee), blob(22, 26, 0.07, 0.05, 0, 0xfff8ee),
    stroke([[0, 70, 0.045], [0, 50, 0.03], [0, 38, 0.004]], 0x3d2f4a),
    stroke([[-16, 72, 0.035], [-13, 54, 0.02], [-10, 44, 0.003]], 0x3d2f4a),
    stroke([[16, 72, 0.035], [13, 54, 0.02], [10, 44, 0.003]], 0x3d2f4a),
    ...[-1, 1].flatMap((sd) => [
      stroke([[sd * 82, 10, 0.04], [sd * 66, 6, 0.022], [sd * 56, 4, 0.003]], 0x3d2f4a),
      stroke([[sd * 84, -8, 0.035], [sd * 70, -10, 0.02], [sd * 61, -10, 0.003]], 0x3d2f4a),
      stroke([[sd * 110, 40, 0.045], [sd * 95, 30, 0.025], [sd * 86, 25, 0.004]], 0x3d2f4a),
    ]),
    ...[150, 180, 210].map((yw) => stroke([[yw, 74, 0.01], [yw, 50, 0.05], [yw, 20, 0.004]], 0x3d2f4a)),
    ...[130, 230].map((yw) => stroke([[yw, 30, 0.004], [yw, 15, 0.04], [yw, -5, 0.004]], 0x3d2f4a)),
  ],
}));
defineSkin('tigerBody', () => ({
  W: 256, H: 128,
  base: 0xffa04a,
  layers: [
    ...[60, 95, 130, 165, 195, 230, 265, 300].map((yw, i) => stroke([[yw, 72, 0.01], [yw + 6, 40, 0.06], [yw - 4, 5, 0.035], [yw, -25, 0.003]], 0x3d2f4a)),
  ],
}));
defineSkin('cowHead', () => ({
  base: 0xfffdf8,
  layers: [
    tan2d(-62, 38, (u, v) => SD.smin(SD.ell(u, v, 0, 0, 0.26, 0.21, 0.4), SD.ell(u, v, 0.12, -0.12, 0.12, 0.1), 0.06), 0x3f3652),
    tan2d(150, 30, (u, v) => SD.smin(SD.ell(u, v, 0, 0, 0.3, 0.24, -0.3), SD.ell(u, v, -0.2, 0.12, 0.12, 0.1), 0.06), 0x3f3652),
    blob(-150, 50, 0.16, 0.13, 0.5, 0x3f3652),
    blob(70, -30, 0.12, 0.1, 0.2, 0x3f3652),
  ],
}));
defineSkin('cowBody', () => ({
  W: 256, H: 128,
  base: 0xfffdf8,
  layers: [
    tan2d(110, 20, (u, v) => SD.smin(SD.ell(u, v, 0, 0, 0.36, 0.3, 0.3), SD.ell(u, v, 0.25, -0.2, 0.18, 0.14), 0.08), 0x3f3652),
    tan2d(-120, 40, (u, v) => SD.smin(SD.ell(u, v, 0, 0, 0.32, 0.26, -0.4), SD.ell(u, v, -0.2, -0.25, 0.15, 0.12), 0.08), 0x3f3652),
    blob(-50, -30, 0.2, 0.16, 0.3, 0x3f3652),
    blob(175, -40, 0.22, 0.18, 0, 0x3f3652),
    blob(40, 60, 0.16, 0.14, 0, 0x3f3652),
  ],
}));
const giraffeSeedsH = fibSeeds(46, 11, 0.18), giraffeSeedsB = fibSeeds(40, 5, 0.22);
defineSkin('giraffeHead', () => ({
  base: 0xffd968,
  layers: [voronoiLayer(giraffeSeedsH, 0xd08a45, 0.045, (x, y, z) => clamp01((0.3 - z) / 0.25) * clamp01((y + 0.5) / 0.3))],
}));
defineSkin('giraffeBody', () => ({
  W: 256, H: 128,
  base: 0xffd968,
  layers: [voronoiLayer(giraffeSeedsB, 0xd08a45, 0.06, (x, y, z) => clamp01((0.55 - z) / 0.25 + clamp01((y - 0.2) / 0.2)))],
}));
defineSkin('pandaHead', () => ({
  base: 0xffffff,
  layers: [
    blob(-23, -1, 0.135, 0.19, 0.5, 0x3d3650),
    blob(23, -1, 0.135, 0.19, -0.5, 0x3d3650),
  ],
}));
defineSkin('pandaBody', () => ({
  W: 256, H: 128,
  base: 0xffffff,
  layers: [region((x, y, z) => {
    // black band over the shoulders/upper back, white chest
    const yaw = Math.abs(yawOf(x, z));
    const band = 0.3 - y; // y > 0.3 -> inside
    const chest = (0.95 - yaw) * 0.5; // front chest stays white
    return Math.max(band, Math.min(chest, 0.75 - y) * 1.0, -1) ;
  }, 0x3d3650, 0.03)],
}));
defineSkin('penguinHead', () => ({
  base: 0x45558c,
  layers: [tan2d(0, 0, (u, v) => SD.heart(u / 1.25, (v + 0.66) / 1.12) * 1.1, 0xffffff, AA, 0.0)],
}));
defineSkin('sharkHead', () => ({
  base: 0x6aaee8,
  layers: [
    region((x, y, z) => { const yaw = Math.abs(yawOf(x, z)); return (y - (-0.12 - 0.42 * clamp01((yaw - 0.35) / 1.4))) * 1.0; }, 0xffffff, 0.02),
    ...[-1, 1].flatMap((sd) => [0, 1, 2].map((i) => stroke([[sd * (70 + i * 9), 12, 0.012], [sd * (68 + i * 9), 0, 0.014], [sd * (70 + i * 9), -12, 0.01]], 0x5590cc))),
  ],
}));
defineSkin('dolphinHead', () => ({
  base: 0x86d4ee,
  layers: [region((x, y, z) => { const yaw = Math.abs(yawOf(x, z)); return y - (-0.3 - 0.4 * clamp01((yaw - 0.4) / 1.2)); }, 0xffffff, 0.02)],
}));
defineSkin('foxHead', () => ({
  base: 0xff9a4a,
  layers: [facePatch(0xffffff, [[-0.3, -0.33, 0.27, 0.2, 0.3], [0.3, -0.33, 0.27, 0.2, -0.3], [0, -0.45, 0.22, 0.2]])],
}));
defineSkin('hamsterHead', () => ({
  base: 0xffb85a,
  layers: [
    facePatch(0xffffff, [[0, -0.52, 0.62, 0.42], [0, -0.08, 0.05, 0.14]]),
  ],
}));
defineSkin('redpandaHead', () => ({
  base: 0xe0703a,
  layers: [
    facePatch(0xffffff, [[-0.28, -0.3, 0.25, 0.2, 0.3], [0.28, -0.3, 0.25, 0.2, -0.3], [0, -0.38, 0.18, 0.2]]),
    blob(-24, 28, 0.075, 0.05, 0.2, 0xffffff), blob(24, 28, 0.075, 0.05, -0.2, 0xffffff),
    stroke([[-14, -6, 0.022], [-12, -22, 0.03], [-9, -36, 0.02]], 0xa04528),
    stroke([[14, -6, 0.022], [12, -22, 0.03], [9, -36, 0.02]], 0xa04528),
  ],
}));
defineSkin('monkeyHead', () => ({
  base: 0xa8714a,
  layers: [tan2d(0, 0, (u, v) => SD.heart(u / 1.08, (v + 0.6) / 0.98) * 1.0, 0xffd8b8, AA, 0.0)],
}));
defineSkin('koalaHead', () => ({ base: 0xb9bdcc, layers: [facePatch(0xffffff, [[0, -0.62, 0.26, 0.17]])] }));
defineSkin('hedgehogHead', () => ({
  base: 0x9a6a4a,
  layers: [tan2d(0, 0, (u, v) => {
    const face = SD.ell(u, v, 0, -0.12, 0.84, 0.78);
    const peak = -SD.ell(u, v, 0, 0.72, 0.16, 0.22); // widow's peak notch
    return Math.max(face, peak);
  }, 0xffe7c6, 0.02, -0.2)],
}));
defineSkin('otterHead', () => ({ base: 0x9c6b4c, layers: [facePatch(0xfff0dc, [[0, -0.4, 0.56, 0.36], [-0.28, -0.12, 0.2, 0.16], [0.28, -0.12, 0.2, 0.16]])] }));
defineSkin('kangarooHead', () => ({ base: 0xd99a5e, layers: [facePatch(0xfff0dc, [[0, -0.45, 0.3, 0.26]])] }));
defineSkin('squirrelHead', () => ({
  base: 0xd2784a,
  layers: [
    facePatch(0xffe9cc, [[-0.26, -0.33, 0.24, 0.19, 0.3], [0.26, -0.33, 0.24, 0.19, -0.3], [0, -0.42, 0.2, 0.2]]),
    blob(-17, 5, 0.095, 0.125, 0, 0xffe9cc), blob(17, 5, 0.095, 0.125, 0, 0xffe9cc),
  ],
}));
defineSkin('frogHead', () => ({
  base: 0x86d86c,
  layers: [
    region((x, y, z) => { const yaw = Math.abs(yawOf(x, z)); return y - (-0.35 - 0.25 * clamp01((yaw - 0.5) / 1.2)); }, 0xfff3a8, 0.03),
    blob(150, 40, 0.06, 0.05, 0, 0x6cc457), blob(200, 55, 0.05, 0.045, 0, 0x6cc457), blob(-160, 25, 0.045, 0.04, 0, 0x6cc457),
  ],
}));
defineSkin('sheepHead', () => {
  const F = dirOf(0, -12);
  return { base: 0xffdcc4, layers: [region((x, y, z) => 1.18 - Math.acos(clamp(x * F[0] + y * F[1] + z * F[2], -1, 1)), 0xfffaf2, 0.03)] };
});
defineSkin('lionHead', () => ({ base: 0xffcf66, layers: [region((x, y, z) => z + 0.15, 0xe0803a, 0.05)] }));
defineSkin('quokkaHead', () => ({ base: 0xd8aa7c, layers: [facePatch(0xfff1de, [[0, -0.42, 0.24, 0.2], [0, -0.2, 0.09, 0.1]])] }));
defineSkin('turtleHead', () => ({
  base: 0xa8e6a0,
  layers: [
    facePatch(0xf4fbd8, [[0, -0.6, 0.36, 0.22]]),
    blob(150, 55, 0.07, 0.06, 0, 0x8fd487), blob(205, 40, 0.06, 0.05, 0, 0x8fd487), blob(-150, 62, 0.05, 0.045, 0, 0x8fd487), blob(110, 30, 0.05, 0.04, 0, 0x8fd487), blob(-115, 35, 0.055, 0.045, 0, 0x8fd487),
  ],
}));
defineSkin('dogHead', () => ({
  base: 0xf3c98b,
  layers: [stroke([[0, 52, 0.05], [0, 30, 0.055], [0, 10, 0.07]], 0xfff4e0, 0.02)],
}));
defineSkin('turtleShell', () => {
  // hex plates on the back-facing dome (tangent plane at yaw 180)
  const F = frameAt(180, 0);
  const hexR = 0.36;
  const plate = rgb(0xd88a3c).map((v) => v * 255), light = rgb(0xf0b25a).map((v) => v * 255), line = rgb(0x9a5a2a).map((v) => v * 255);
  const out = [0, 0, 0, 0];
  return {
    base: 0xe09a48,
    layers: [{
      fc: (x, y, z) => {
        const dd = x * F.c[0] + y * F.c[1] + z * F.c[2];
        if (dd < -0.2) return null;
        const u = (x * F.e[0] + y * F.e[1] + z * F.e[2]) / hexR, v = (x * F.n[0] + y * F.n[1] + z * F.n[2]) / hexR;
        // axial hex coords (pointy-top)
        const q = (Math.sqrt(3) / 3) * u - (1 / 3) * v, r = (2 / 3) * v;
        let rx = Math.round(q), ry = Math.round(-q - r), rz = Math.round(r);
        const dx = Math.abs(rx - q), dy = Math.abs(ry - (-q - r)), dz = Math.abs(rz - r);
        if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
        const cu = Math.sqrt(3) * (rx + rz / 2), cv = 1.5 * rz;
        const lu = u - cu, lv = v - cv;
        // hex distance (pointy-top): max of projections
        const au = Math.abs(lu), av = Math.abs(lv);
        const hd = Math.max(au * 0.8660254 + av * 0.5, av) / 0.8660254 * 0.8660254;
        const edge = 0.86 - hd; // >0 inside plate
        const k = cover(-edge * hexR, 0.018);
        const shade = clamp01(hd / 0.86);
        const c = [lerp(light[0], plate[0], shade), lerp(light[1], plate[1], shade), lerp(light[2], plate[2], shade)];
        const fade = clamp01((dd + 0.2) / 0.3);
        out[0] = lerp(line[0], c[0], k); out[1] = lerp(line[1], c[1], k); out[2] = lerp(line[2], c[2], k); out[3] = fade;
        return out;
      },
    }],
  };
});
defineSkin('pajama', () => {
  const seeds = fibSeeds(22, 3, 0.15);
  return {
    base: 0xff9ec6,
    layers: seeds.map((s, i) => {
      const yaw = (Math.atan2(s[0], s[2]) * 180) / PI, pitch = (Math.asin(s[1]) * 180) / PI;
      const rot = i * 0.7;
      return tan2d(yaw, pitch, (u, v) => { const c = Math.cos(rot), sn = Math.sin(rot); return SD.star5(u * c + v * sn, -u * sn + v * c, 0.085, 0.5); }, 0xffe066, 0.01);
    }),
  };
});

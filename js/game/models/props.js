// ============================================================================
// models/props.js — static decoration props (mergeable) + instancing geometry
//
//   propParts(type, opts)  -> [{ geo, matrix (Float32Array16|null), color:[r,g,b], kind:'solid'|'glow', halo? }]
//   buildProp(type, opts)  -> Node (merged vertex-colored solid mesh + unlit glow mesh + soft halo mesh)
//   PROP_TYPES             -> { theme: [type, ...] }
//   PROP_INFO[type]        -> { theme, h (height m), r (footprint radius m), col (collision radius, 0 = walk-through) }
//   grassGeo(v) / flowerGeo(v) -> vertex-colored Geometry, origin at base (for InstancedMesh)
//   propMaterial(kind, wind)   -> shared material matching buildProp ('solid' | 'glow' | 'halo')
//   softGlowMaterial(color, o) -> additive fresnel-faded glow material (soft halos / beams)
//
// Origin: base center on the ground (y = 0 is ground contact), +Y up, front faces +Z.
// opts: s (uniform scale), seed (variant = seed % 4 picks a cached shape/color variant; the full seed adds a
// deterministic size + yaw jitter), color (main color override for types where it makes sense).
// Geometry is baked once per (type, seed % 4, color) and shared between all callers: never mutate part.geo
// (mergeGeometries copies it). Solid parts render with propMaterial('solid', part.wind); glow parts are unlit
// (propMaterial('glow')); parts flagged `halo:true` (kind 'glow') are soft light shells: render them with
// propMaterial('halo') (fresnel-faded additive) for best results. Registers the 'softGlow' shader on import.
// Shared helpers (tubeGeo, leafGeo, lumpGeo, latheD, prism*, outlines, palette) are exported for objects/platforms.
// ============================================================================
import * as G from '../../engine/geometry.js';
import { Node, Mesh } from '../../engine/scene.js';
import { mat } from '../../engine/material.js';
import { SHADERS } from '../../engine/shaders.js';
import { Mat4, RNG, rgb, TAU, PI, lerp, clamp, smoothstep, valueNoise3 } from '../../engine/math.js';

// ---------------------------------------------------------------- soft glow shader (registered at runtime)
// Additive, alpha = |N.V|^k (k = material.rim): bright core fading softly to the silhouette.
if (!SHADERS.softGlow) {
  SHADERS.softGlow = {
    vertex: `
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
#ifdef USE_VCOLOR
layout(location=2) in vec3 color;
#endif
#ifdef USE_INSTANCING
layout(location=4) in mat4 iMatrix;
layout(location=8) in vec4 iColor;
#endif
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vNormal;
out vec3 vWorld;
out vec4 vColor;
void main(){
#ifdef USE_INSTANCING
  mat4 m = uModel * iMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vNormal = normalize(mat3(m) * normal);
#else
  vec4 wp = uModel * vec4(position, 1.0);
  vNormal = normalize(uNormalMat * normal);
#endif
  vec4 c = vec4(1.0);
#ifdef USE_VCOLOR
  c.rgb = color;
#endif
#ifdef USE_INSTANCING
  c *= iColor;
#endif
  vColor = c;
  vWorld = wp.xyz;
  gl_Position = uProj * uView * wp;
}`,
    fragment: `
in vec3 vNormal;
in vec3 vWorld;
in vec4 vColor;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform float uRim;
uniform vec3 uCamPos;
uniform float uFlash;
out vec4 fragColor;
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float f = abs(dot(normalize(vNormal), V));
  float a = pow(f, max(uRim, 0.25));
  vec3 col = uColor * vColor.rgb + uEmissive;
  col = mix(col, vec3(1.0), uFlash);
  fragColor = vec4(col, a * uOpacity * vColor.a);
}`,
  };
}
export function softGlowMaterial(color = 0xffffff, o = {}) {
  return mat(color, { shader: 'softGlow', transparent: true, blending: 'additive', depthWrite: false, fog: false, rim: 1.7, opacity: 1, ...o });
}

// ---------------------------------------------------------------- palette + color utils
export const PAL = {
  grass: 0x8ad86a, grassD: 0x5cbf5e, grassL: 0xc4f08e,
  leaf: 0x7cd46e, leafD: 0x52b264, leafL: 0xaee98a,
  trunk: 0xc89068, trunkD: 0xa36f50, trunkL: 0xe3b48c,
  stone: 0xcfc8e2, stoneD: 0xaca4c8, stoneL: 0xe8e3f5,
  wood: 0xe8ae76, woodD: 0xc98b55, woodL: 0xf7d19c,
  white: 0xffffff, cream: 0xfff4e2,
  pink: 0xffaacd, pinkD: 0xff7fb1, pinkL: 0xffd6e8, red: 0xff6b7d, redD: 0xe8505f,
  peach: 0xffc6a0, orange: 0xffa457, orangeD: 0xf0843c,
  yellow: 0xffe46d, gold: 0xffcb3d, goldD: 0xe8a92a, honey: 0xffb92e,
  mint: 0x9fe8c9, teal: 0x5fd0c5, sky: 0xa6d8ff, blue: 0x78b6ff, lav: 0xc7b4ff, purple: 0xa98cf5,
  snow: 0xf7fbff, ice: 0xc4ecff, iceD: 0x92d2f2,
  sand: 0xffe4b5, sandD: 0xf3cb92,
  moon: 0xeee8ff, moonD: 0xcdc3f0, glowY: 0xfff2a8, glowC: 0xb9f6ff,
  dark: 0x4a3a52, eye: 0x2a1f3d,
};
const P = PAL;
export const col = (c) => (Array.isArray(c) ? c : rgb(c));
export const mixc = (a, b, t) => { a = col(a); b = col(b); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; };
export const lit = (c, t) => mixc(c, [1, 1, 1], t);
export const dim = (c, f) => { c = col(c); return [c[0] * f, c[1] * f, c[2] * f]; };
const vary = (c, rng, a = 0.06) => { const k = 1 + (rng.next() - 0.5) * 2 * a; c = col(c); return [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)]; };
function hstr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------------------------------------------------------------- transforms
export function mk(p, r, s) {
  const px = p ? p[0] : 0, py = p ? p[1] : 0, pz = p ? p[2] : 0;
  let rx = 0, ry = 0, rz = 0;
  if (typeof r === 'number') ry = r; else if (r) { rx = r[0]; ry = r[1]; rz = r[2]; }
  let sx = 1, sy = 1, sz = 1;
  if (typeof s === 'number') { sx = sy = sz = s; } else if (s) { sx = s[0]; sy = s[1]; sz = s[2]; }
  return G.trs(px, py, pz, rx, ry, rz, sx, sy, sz);
}
// rotation [rx, ry, 0] that turns local +Z toward unit vector n
export const faceN = (n) => [-Math.asin(clamp(n[1], -1, 1)), Math.atan2(n[0], n[2]), 0];
const nrm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---------------------------------------------------------------- primitive cache
const K = (k, fn) => G.cachedGeo('pp:' + k, fn);
export const sph = (ws = 12, hs = 8) => K(`sph${ws}x${hs}`, () => G.sphereGeo(1, ws, hs));
export const ico = (d = 1) => K(`ico${d}`, () => G.icoGeo(1, d));
export const hemi = (ws = 12, hs = 4) => K(`hemi${ws}x${hs}`, () => G.sphereGeo(1, ws, hs, 0, TAU, 0, PI / 2));
// cylinder radius 1 (bottom), top radius `top`, base at y=0, height 1
export const cyl = (rs = 10, top = 1, cap = true) => K(`cyl${rs}_${top}_${cap}`, () => G.cylinderGeo(top, 1, 1, rs, 1, cap).translate(0, 0.5, 0));
export const cone = (rs = 10) => K(`cone${rs}`, () => G.cylinderGeo(0, 1, 1, rs, 1, true).translate(0, 0.5, 0));
// torus R=1 in XY plane (tube radius r), arc from +X CCW
export const tor = (r = 0.25, rs = 6, ts = 16, arc = TAU) => K(`tor${r}_${rs}_${ts}_${arc.toFixed(4)}`, () => G.torusGeo(1, r, rs, ts, arc));
export const box = () => K('box', () => G.boxGeo(1, 1, 1));
export const rbox = (w = 1, h = 1, d = 1, r = 0.15, seg = 2) => K(`rbox${w}_${h}_${d}_${r}_${seg}`, () => G.roundedBoxGeo(w, h, d, r, seg));
export const disc = (seg = 16) => K(`disc${seg}`, () => G.circleGeo(1, seg));

// ---------------------------------------------------------------- geometry generators
// Tube along a polyline. rad: number | number[] | fn(t). o: { capStart, capEnd, round, prof(angle)->mult, phase }
export function tubeGeo(pts, rad, radial = 6, o = {}) {
  const n = pts.length;
  const R = (i) => (typeof rad === 'function' ? rad(i / (n - 1)) : Array.isArray(rad) ? rad[i] : rad);
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(nrm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  }
  let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  if (o.up) N = o.up;
  const fr = [];
  for (let i = 0; i < n; i++) {
    const t = T[i];
    const d = N[0] * t[0] + N[1] * t[1] + N[2] * t[2];
    N = nrm3([N[0] - t[0] * d, N[1] - t[1] * d, N[2] - t[2] * d]);
    fr.push([N, [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]]]);
  }
  const pos = [], nr = [], uv = [], idx = [];
  const ph = o.phase || 0;
  for (let i = 0; i < n; i++) {
    const [Nn, B] = fr[i], p = pts[i], r = R(i);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU + ph, c = Math.cos(a), s = Math.sin(a);
      const m = o.prof ? o.prof(a) : 1;
      const ox = Nn[0] * c + B[0] * s, oy = Nn[1] * c + B[1] * s, oz = Nn[2] * c + B[2] * s;
      pos.push(p[0] + ox * r * m, p[1] + oy * r * m, p[2] + oz * r * m);
      nr.push(ox, oy, oz); uv.push(j / radial, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 2, d = a + radial + 1;
    idx.push(a, b, c, a, c, d);
  }
  const cap = (i, dir) => {
    const p = pts[i], t = T[i], r = R(i);
    if (r <= 1e-5) return;
    const ext = o.round ? r * (o.round === true ? 0.75 : o.round) : 0;
    const ci = pos.length / 3;
    pos.push(p[0] + t[0] * ext * dir, p[1] + t[1] * ext * dir, p[2] + t[2] * ext * dir);
    nr.push(t[0] * dir, t[1] * dir, t[2] * dir); uv.push(0.5, dir > 0 ? 1 : 0);
    const base = i * (radial + 1);
    for (let j = 0; j < radial; j++) idx.push(ci, base + j, base + j + 1);
  };
  if (o.capStart !== false) cap(0, -1);
  if (o.capEnd !== false) cap(n - 1, 1);
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setAttribute('uv', uv, 2);
  g.setIndex(idx);
  G.fixWinding(g);
  if (o.smooth) g.smoothNormalsByPosition();
  g.computeBoundingSphere();
  return g;
}
// helical colored strips on a tube (crisp candy stripes). Returns array of geometries (strip k uses colors[k % len]).
export function stripeTubeGeos(pts, rad, strips = 6, turns = 2, sub = 2, colors = [[1, 0, 0], [1, 1, 1]]) {
  const n = pts.length;
  const T = [];
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; T.push(nrm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]])); }
  let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const fr = [];
  for (let i = 0; i < n; i++) {
    const t = T[i]; const d = N[0] * t[0] + N[1] * t[1] + N[2] * t[2];
    N = nrm3([N[0] - t[0] * d, N[1] - t[1] * d, N[2] - t[2] * d]);
    fr.push([N, [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]]]);
  }
  const out = [];
  for (let k = 0; k < strips; k++) {
    const pos = [], nr = [], idx = [];
    for (let i = 0; i < n; i++) {
      const [Nn, B] = fr[i], p = pts[i], tt = i / (n - 1);
      const r = typeof rad === 'function' ? rad(tt) : rad;
      for (let j = 0; j <= sub; j++) {
        const a = ((k + j / sub) / strips) * TAU + tt * turns * TAU;
        const c = Math.cos(a), s = Math.sin(a);
        const ox = Nn[0] * c + B[0] * s, oy = Nn[1] * c + B[1] * s, oz = Nn[2] * c + B[2] * s;
        pos.push(p[0] + ox * r, p[1] + oy * r, p[2] + oz * r); nr.push(ox, oy, oz);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sub; j++) {
      const a = i * (sub + 1) + j, b = a + 1, c = a + sub + 2, d = a + sub + 1;
      idx.push(a, b, c, a, c, d);
    }
    const g = new G.Geometry();
    g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setIndex(idx);
    G.fixWinding(g);
    g.setColor(col(colors[k % colors.length]));
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

// Leaf / blade / frond: grows along +Z from origin, lies in XZ with top facing +Y (before lift).
// o: segs, across, lift (initial elevation rad), bend (curvature, + bends tip down), thick, fold (cupping),
//    shape(t)->width factor, wave/waveF (side wiggle), cf(t,u,side)->[r,g,b] vertex color
export function leafGeo(len = 1, wid = 0.4, o = {}) {
  const segs = o.segs ?? 6, ac = o.across ?? 2;
  const lift = o.lift ?? 0.35, bend = o.bend ?? 0.7, thick = o.thick ?? 0.14, fold = o.fold ?? 0.14;
  const shape = o.shape || ((t) => Math.pow(Math.sin(PI * Math.min(1, Math.pow(t, 0.8))), 0.85));
  const wave = o.wave || 0, waveF = o.waveF || 2;
  const Pp = [], Tt = [];
  let y = 0, z = 0;
  const ds = len / segs;
  for (let i = 0; i <= segs; i++) {
    const th = lift - bend * (i / segs);
    Tt.push([Math.sin(th), Math.cos(th)]);
    Pp.push([0, y, z]);
    if (i < segs) { const tm = lift - bend * ((i + 0.5) / segs); y += Math.sin(tm) * ds; z += Math.cos(tm) * ds; }
  }
  const pos = [], nr = [], cl = [], idx = [];
  const cols = ac * 2 + 1;
  const shade = o.cf || ((t, u, side) => {
    const k = side ? 0.96 : (0.9 + 0.12 * (1 - Math.abs(u)) + 0.06 * t);
    return [k, k, k];
  });
  for (let side = 0; side < 2; side++) {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.5 * wid * Math.max(0, shape(t));
      const [ty, tz] = Tt[i];
      const Uy = tz, Uz = -ty;
      const wx = wave ? Math.sin(t * waveF * TAU) * wave * Math.min(1, t * 3) : 0;
      for (let k = 0; k < cols; k++) {
        const u = k / ac - 1;
        const th = thick * w * (1 - u * u);
        const off = fold * w * u * u + (side === 0 ? th : -th * 0.6);
        pos.push(Pp[i][0] + u * w + wx, Pp[i][1] + Uy * off, Pp[i][2] + Uz * off);
        nr.push(0, side === 0 ? Uy : -Uy, side === 0 ? Uz : -Uz);
        const c = shade(t, u, side);
        cl.push(c[0], c[1], c[2]);
      }
    }
    for (let i = 0; i < segs; i++) for (let k = 0; k < cols - 1; k++) {
      const a = base + i * cols + k, b = a + 1, c = a + cols + 1, d = a + cols;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setAttribute('color', cl, 3);
  g.setIndex(idx);
  G.fixWinding(g);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Lumpy smooth blob (bush / canopy / cloud): unit sphere with rounded lobes
export function lumpGeo(seed, o = {}) {
  const ws = o.ws ?? 14, hs = o.hs ?? 10, lobes = o.lobes ?? 7, amp = o.amp ?? 0.18, sharp = o.sharp ?? 3;
  const r = new RNG(seed * 131 + 17);
  const dirs = [];
  for (let k = 0; k < lobes; k++) {
    const yv = r.range(o.yMin ?? -0.3, o.yMax ?? 0.95), a = r.next() * TAU, s = Math.sqrt(1 - yv * yv);
    dirs.push([Math.cos(a) * s, yv, Math.sin(a) * s, r.range(0.7, 1)]);
  }
  const g = G.sphereGeo(1, ws, hs);
  g.displace((v) => {
    const l = v.length() || 1, x = v.x / l, y = v.y / l, z = v.z / l;
    let s = 0;
    for (const d of dirs) { const c = x * d[0] + y * d[1] + z * d[2]; if (c > 0) s = Math.max(s, Math.pow(c, sharp) * d[3]); }
    const rr = 1 + amp * (s - 0.5);
    v.set(x * rr, y * rr, z * rr);
    if (o.flat !== undefined && v.y < 0) v.y *= o.flat;
  });
  g.smoothNormalsByPosition();
  g.computeBoundingSphere();
  return g;
}
// Smooth boulder: displaced icosphere, flattened bottom
export function boulderGeo(seed, rough = 0.2, detail = 2) {
  const g = G.icoGeo(1, detail);
  g.displace((v) => {
    const n = valueNoise3(v.x * 1.3 + seed * 3.7, v.y * 1.3 + seed * 1.9, v.z * 1.3 - seed * 2.3);
    const n2 = valueNoise3(v.x * 2.9 - seed, v.y * 2.9 + seed * 0.7, v.z * 2.9 + seed * 1.3);
    v.scale(1 + (n - 0.5) * 2 * rough + (n2 - 0.5) * rough * 0.6);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
  });
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
// lathe with radial displacement f(angle, y, r) -> radius multiplier (angle 0 = +Z)
export function latheD(profile, seg = 16, f = null, fy = null) {
  const g = G.latheGeo(profile, seg);
  if (f || fy) {
    g.displace((v) => {
      const r = Math.hypot(v.x, v.z);
      const a = Math.atan2(v.x, v.z);
      if (f && r > 1e-6) { const k = f(a, v.y, r); v.x *= k; v.z *= k; }
      if (fy) v.y = fy(a, v.y, r);
    });
    g.smoothNormalsByPosition();
  }
  g.computeBoundingSphere();
  return g;
}
// flat-shaded prism body (radius 1 at y=0, `top` at y=1) and pyramid tip (radius `top` at y=0, apex y=1)
function facetGeo(pos, idx, nr) {
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setIndex(idx);
  G.fixWinding(g);
  const f = g.toFlat();
  f.computeBoundingSphere();
  return f;
}
export const prismBody = (sides = 6, top = 0.88) => K(`prB${sides}_${top}`, () => {
  const pos = [], nr = [], idx = [];
  for (let k = 0; k < 2; k++) for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU, r = k ? top : 1;
    pos.push(Math.sin(a) * r, k, Math.cos(a) * r); nr.push(Math.sin(a), 0, Math.cos(a));
  }
  pos.push(0, 0, 0); nr.push(0, -1, 0);
  const c = sides * 2;
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; idx.push(i, j, sides + j, i, sides + j, sides + i, c, j, i); }
  return facetGeo(pos, idx, nr);
});
export const prismTip = (sides = 6, top = 0.88) => K(`prT${sides}_${top}`, () => {
  const pos = [], nr = [], idx = [];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * TAU; pos.push(Math.sin(a) * top, 0, Math.cos(a) * top); nr.push(Math.sin(a), 0.3, Math.cos(a)); }
  pos.push(0, 1, 0); nr.push(0, 1, 0);
  for (let i = 0; i < sides; i++) idx.push(i, (i + 1) % sides, sides);
  return facetGeo(pos, idx, nr);
});
// bake facet shading into vertex colors (for unlit "glow" crystals that should keep their facets)
export function facetShade(g, c, lo = 0.72, hi = 1.12) {
  const L = nrm3([0.35, 0.85, 0.4]);
  c = col(c);
  g = g.clone();
  g.colorBy((x, y, z, nx, ny, nz) => { const k = lerp(lo, hi, clamp(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)); return [c[0] * k, c[1] * k, c[2] * k]; });
  return g;
}
// --- 2D outlines (XY plane) -------------------------------------------------
export function roundStarOutline(points = 5, rOut = 0.5, rIn = 0.26, n = 40, sharp = 1.6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = PI / 2 + (i / n) * TAU;
    const c = 0.5 + 0.5 * Math.cos(points * (a - PI / 2));
    const r = rIn + (rOut - rIn) * Math.pow(c, sharp);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}
export function gearOutline(teeth = 10, rOut = 0.5, rIn = 0.42, per = 8) {
  const out = [], n = teeth * per;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, f = ((a * teeth) / TAU) % 1;
    const k = smoothstep(0.08, 0.24, f) * (1 - smoothstep(0.52, 0.68, f));
    const r = rIn + (rOut - rIn) * k;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}
// pinched ellipse petal centered at origin, base toward -Y
export function petalOutline(len = 1, wid = 0.5, n = 18, pinch = 0.45) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const y = -Math.cos(a) * len * 0.5;
    const t = (y + len * 0.5) / len;
    const x = Math.sin(a) * wid * 0.5 * (pinch + (1 - pinch) * Math.pow(t, 0.55));
    out.push([x, y]);
  }
  return out;
}
// polygon with rounded corners
export function roundPoly(pts, r = 0.05, seg = 3) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d1 = nrm3([p0[0] - p1[0], p0[1] - p1[1], 0]), d2 = nrm3([p2[0] - p1[0], p2[1] - p1[1], 0]);
    const l1 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const rr = Math.min(r, l1 * 0.45, l2 * 0.45);
    const a = [p1[0] + d1[0] * rr, p1[1] + d1[1] * rr], b = [p1[0] + d2[0] * rr, p1[1] + d2[1] * rr];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]]);
    }
  }
  return out;
}
// crescent: outer circle (r0 at origin) minus inner circle (r1 at +off on X); opening toward +X
export function crescentOutline(r0 = 0.5, r1 = 0.42, off = 0.22, n = 16) {
  const x = (r0 * r0 - r1 * r1 + off * off) / (2 * off), y = Math.sqrt(Math.max(0, r0 * r0 - x * x));
  const ao = Math.atan2(y, x), ai = Math.atan2(y, x - off);
  const out = [];
  for (let i = 0; i <= n; i++) { const a = lerp(ao, TAU - ao, i / n); out.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
  for (let i = 1; i < n; i++) { const a = lerp(-ai, -(TAU - ai), i / n); out.push([off + Math.cos(a) * r1, Math.sin(a) * r1]); }
  return out;
}
export const puffy = (key, outline, depth, rings = 2) => K('puffy:' + key, () => G.puffyShapeGeo(outline(), depth, rings));
export const extr = (key, outline, depth = 1) => K('extr:' + key, () => G.extrudeGeo(outline(), depth));

// ---------------------------------------------------------------- shared sub-geometries
const bladeGeo = () => K('blade2', () => upNormals(leafGeo(1, 0.2, { segs: 3, across: 1, lift: 1.25, bend: 0.75, thick: 0.35, fold: 0.3 }), 0.4));
const leafS = () => K('leafS', () => leafGeo(1, 0.5, { segs: 4, across: 1, lift: 0.45, bend: 0.6 }));
const leafM = () => K('leafM', () => leafGeo(1, 0.5, { segs: 6, across: 2, lift: 0.55, bend: 0.9 }));
const petals5 = () => puffy('p5', () => G.flowerOutline(5, 0.5, 0.2, 20), 0.12, 1);
const petals6h = () => puffy('p6h', () => G.flowerOutline(6, 0.5, 0.22, 36), 0.12, 2);
const daisyP = () => puffy('daisy2', () => G.flowerOutline(12, 0.5, 0.12, 36), 0.1, 1);
const starS = () => puffy('starS', () => roundStarOutline(5, 0.5, 0.27, 20, 1.3), 0.15, 1);
const starP = () => puffy('starP', () => roundStarOutline(5, 0.5, 0.28, 30, 1.35), 0.17, 2);
const heartP = () => puffy('heartS', () => G.heartOutline(0.5, 18), 0.1, 1);
const dotG = () => sph(5, 3);

// ---------------------------------------------------------------- part builder
class PB {
  constructor() { this.S = []; this.Gl = []; this.H = []; this.stack = [Mat4.create()]; }
  get top() { return this.stack[this.stack.length - 1]; }
  push(p, r, s) { this.stack.push(Mat4.multiply(Mat4.create(), this.top, mk(p, r, s))); return this; }
  pop() { this.stack.pop(); return this; }
  // add(geo|fn, color, pos, rot (yaw number | [rx,ry,rz]), scale (num | [x,y,z]), { kind, cf(x,y,z,nx,ny,nz)->[r,g,b] })
  add(geo, color, p, r, s, o) {
    let g = typeof geo === 'function' ? geo() : geo;
    if (o && o.cf) { g = g.clone(); g.colorBy(o.cf); }
    const m = Mat4.multiply(Mat4.create(), this.top, mk(p, r, s));
    const kind = (o && o.kind) || 'solid';
    (kind === 'glow' ? this.Gl : kind === 'halo' ? this.H : this.S).push({ geo: g, matrix: m, color: col(color) });
    return this;
  }
  gl(geo, color, p, r, s, o = {}) { return this.add(geo, color, p, r, s, { ...o, kind: 'glow' }); }
  // soft light shell (fresnel additive). color is scaled down so it stays subtle in daylight
  ha(p, s, color, k = 0.2) { return this.add(ico(1), dim(color, k), p, 0, s, { kind: 'halo' }); }
}

// ---------------------------------------------------------------- common decorators
const shadeY = (lo = 0.86, hi = 1.06) => (x, y) => { const k = lerp(lo, hi, clamp(y * 0.5 + 0.5, 0, 1)); return [k, k, k]; };
function tuft(b, x, z, s = 1, color = P.grass, n = 4, seed = 1) {
  const r = new RNG(seed * 31 + 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.4, 0.4);
    const L = s * r.range(0.17, 0.28);
    b.add(bladeGeo, mixc(color, P.grassL, r.next() * 0.35), [x + Math.sin(a) * 0.035 * s, 0, z + Math.cos(a) * 0.035 * s], [0, a, 0], L);
  }
}
// cluster of sphere puffs approximating an ellipsoid (bushes, canopies, clouds, garlands)
function puffs(b, c0, R, n, color, seed, o = {}) {
  const r = new RNG(seed * 7 + 3);
  const geo = o.geo || sph(10, 7);
  const cf = o.cf || shadeY(o.lo ?? 0.84, o.hi ?? 1.08);
  const k = o.core ?? 0.8;
  if (k > 0) b.add(o.coreGeo || geo, color, c0, [0, r.next() * 6, 0], [R[0] * k, R[1] * k, R[2] * k], { cf });
  const y0 = o.yMax ?? 0.7, y1 = o.yMin ?? -0.25, out = o.out ?? 0.62;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = n > 1 ? lerp(y0, y1, i / (n - 1)) : y0;
    const a = i * 2.39996 + (o.phase ?? 0) + r.range(-0.2, 0.2);
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    const ps = r.range(o.pMin ?? 0.44, o.pMax ?? 0.56);
    const d = [Math.sin(a) * s, y, Math.cos(a) * s];
    const p = [c0[0] + d[0] * R[0] * out, c0[1] + d[1] * R[1] * out, c0[2] + d[2] * R[2] * out];
    b.add(geo, vary(color, r, o.vary ?? 0.05), p, [0, r.next() * 6, 0], [R[0] * ps, R[1] * ps, R[2] * ps], { cf });
    pts.push({ p, d, rad: [R[0] * ps, R[1] * ps, R[2] * ps] });
  }
  return pts;
}
// small flower head facing outward along normal n at point p
function flowerAt(b, p, n, size, petal, center, petGeo = petals5) {
  b.push(p, faceN(nrm3(n)), size);
  b.add(petGeo, petal);
  b.add(hemi(6, 2), center, [0, 0, 0.045], [PI / 2, 0, 0], [0.19, 0.13, 0.19]);
  b.pop();
}
// flowers placed on puff surfaces
function flowersOnPuffs(b, pts, every, size, colors, center = P.yellow) {
  pts.forEach((q, i) => {
    if (i % every !== 0 || q.d[1] < -0.2) return;
    const d = nrm3([q.d[0], q.d[1] * 0.6 + 0.2, q.d[2]]);
    flowerAt(b, [q.p[0] + d[0] * q.rad[0] * 0.92, q.p[1] + d[1] * q.rad[1] * 0.92, q.p[2] + d[2] * q.rad[2] * 0.92], d, size, colors[(i / every) % colors.length | 0], center);
  });
}
// polka dots on an ellipsoid (center c, radii rr) in given directions
function dotsOn(b, c, rr, dirs, size, color, kind) {
  for (const d0 of dirs) {
    const d = nrm3(d0);
    const p = [c[0] + d[0] * rr[0], c[1] + d[1] * rr[1], c[2] + d[2] * rr[2]];
    const n = nrm3([d[0] / rr[0], d[1] / rr[1], d[2] / rr[2]]);
    b.add(dotG, color, p, faceN(n), [size, size, size * 0.4], kind ? { kind } : undefined);
  }
}
const dirsUp = (n, y0, y1, seed, phase = 0) => {
  const r = new RNG(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + phase + r.range(-0.3, 0.3), y = r.range(y0, y1), s = Math.sqrt(1 - y * y);
    out.push([Math.sin(a) * s, y, Math.cos(a) * s]);
  }
  return out;
};
function stemPts(h, bx = 0, bz = 0, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push([bx * Math.sin(t * PI * 0.5), h * t, bz * t * t]); }
  return out;
}
// mushroom (stem + cap with dots). origin base. ~0.55 tall at s=1
const mStem = (lo) => K('mStem' + (lo ? 'L' : ''), () => latheD([[0, 0], [0.125, 0], [0.105, 0.07], [0.085, 0.2], [0.08, 0.31], [0, 0.33]], lo ? 6 : 8));
const mCap = (lo) => K('mCap' + (lo ? 'L' : ''), () => G.latheGeo([[0, 0.28], [0.2, 0.28], [0.275, 0.33], [0.27, 0.41], [0.2, 0.5], [0.09, 0.545], [0, 0.555]], lo ? 8 : 10));
function mushroom(b, x, z, s, capC, stemC, dotC, tilt = 0, yaw = 0, glowCap = false, seed = 1, nd = 5) {
  b.push([x, 0, z], [tilt, yaw, 0], s);
  const lo = s < 0.7;
  b.add(mStem(lo), stemC, null, null, null, { cf: shadeY(0.85, 1.05) });
  const capCf = glowCap
    ? (x2, y2, z2, nx, ny) => (ny < -0.35 ? mixc(capC, P.white, 0.55) : dim(capC, lerp(0.72, 1.12, clamp((y2 - 0.3) * 4, 0, 1))))
    : (x2, y2, z2, nx, ny) => (ny < -0.35 ? mixc(capC, P.cream, 0.75) : mixc(capC, [1, 1, 1], clamp((y2 - 0.33) * 1.1, 0, 0.25)));
  b.add(mCap(lo), [1, 1, 1], null, null, null, { cf: capCf, kind: glowCap ? 'glow' : 'solid' });
  if (nd) {
    const dirs = dirsUp(nd, 0.2, 0.75, seed);
    for (const d of dirs) {
      const p = [d[0] * 0.235, 0.41 + d[1] * 0.13, d[2] * 0.235];
      const n = nrm3([d[0], d[1] * 1.6 + 0.3, d[2]]);
      b.add(dotG, dotC, p, faceN(n), [0.05, 0.05, 0.022], glowCap ? { kind: 'glow' } : undefined);
    }
  }
  b.pop();
}
function trunk(b, h, r0, r1, color, lean = [0, 0], radial = 8) {
  const pts = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push([lean[0] * t * t, h * t, lean[1] * t * t]); }
  b.add(tubeGeo(pts, (t) => lerp(r0, r1, Math.pow(t, 0.7)) * (1 + 0.4 * Math.pow(1 - t, 8)), radial, { capStart: false }), color, null, null, null, { cf: shadeY(0.85, 1.05) });
}

// ---------------------------------------------------------------- definitions
const D = {};
function def(theme, type, o, build) { D[type] = { theme, build, ...o }; }

// ======================= generic =======================
const ROCKC = [P.stone, 0xd9d0c8, 0xc3cce2, 0xdccbd9];
def('generic', 'rock', { h: 0.72, r: 0.55, col: 0.5, color: true }, (b, c) => {
  const base = c.color || c.pick(ROCKC);
  b.add(boulderGeo(c.v + 1, 0.2), base, [0, 0.21, 0], [0, c.v * 1.3, 0], [0.56, 0.45, 0.5]);
  if (c.v % 2 === 1) b.add(ico(1), dim(base, 0.96), [0.5, 0.05, 0.28], [0.3, 1, 0], [0.16, 0.11, 0.14]);
});
def('generic', 'rockCluster', { h: 1.0, r: 0.85, col: 0.7, color: true }, (b, c) => {
  const base = c.color || c.pick(ROCKC);
  const r = c.rng;
  b.add(boulderGeo(c.v + 3, 0.2), base, [-0.18, 0.3, 0], [0, r.next() * 6, 0], [0.62, 0.62, 0.56]);
  b.add(boulderGeo(c.v + 5, 0.22, 1), dim(base, 0.96), [0.52, 0.16, 0.22], [0, r.next() * 6, 0], [0.36, 0.34, 0.34]);
  b.add(boulderGeo(c.v + 8, 0.25, 1), lit(base, 0.12), [0.22, 0.09, -0.48], [0, r.next() * 6, 0], [0.25, 0.21, 0.23]);
  tuft(b, -0.62, 0.4, 0.95, P.grass, 3, c.v);
});
def('generic', 'crystalCluster', { h: 1.25, r: 0.6, col: 0.45, color: true }, (b, c) => {
  const cc = col(c.color || c.pick([0xc3a6ff, 0x9fdcff, 0xffa8d8, 0x96f0d4]));
  b.add(boulderGeo(c.v + 21, 0.18, 1), P.stoneD, [0, 0.07, 0], [0, c.v, 0], [0.46, 0.2, 0.42]);
  const sh = [[0, 0, 0.8, 0.16, 0.05, 0], [0.2, 0.08, 0.5, 0.12, 0.5, 0.9], [-0.2, 0.05, 0.46, 0.115, 0.55, -1.6], [0.04, -0.2, 0.38, 0.1, 0.6, 3.3], [-0.06, 0.22, 0.3, 0.085, 0.75, -0.2], [0.24, -0.14, 0.26, 0.08, 0.8, 2.2]];
  sh.forEach(([x, z, h, r, tilt, yaw], i) => {
    const k = 0.92 + 0.16 * ((i * 37 + c.v * 11) % 7) / 7;
    b.push([x, 0.06, z], [tilt, yaw + c.v, 0]);
    b.add(prismBody(6), dim(lit(cc, 0.18), k), null, null, [r, h, r]);
    b.gl(facetShade(prismTip(6), lit(cc, 0.55), 0.78, 1.1), [1, 1, 1], [0, h, 0], null, [r, r * 2.2, r]);
    b.pop();
  });
});
def('generic', 'cloudPuff', { h: 1.15, r: 1.1, col: 0, ao: 0 }, (b, c) => {
  const r = c.rng;
  const shade = (x, y) => mixc([0.86, 0.87, 1.0], [1, 1, 1], smoothstep(-0.9, 0.5, y));
  const pf = [[0, 0.52, 0, 0.6], [-0.62, 0.36, 0.04, 0.44], [0.64, 0.38, -0.04, 0.46], [-0.28, 0.74, -0.08, 0.42], [0.3, 0.72, 0.1, 0.4], [0.06, 0.32, 0.4, 0.4], [-0.1, 0.32, -0.42, 0.4]];
  for (const [x, y, z, s] of pf) {
    const k = 1 + (r.next() - 0.5) * 0.12;
    b.add(sph(10, 7), P.white, [x * k, y, z * k], 0, [s * k, s * 0.88 * k, s * k], { cf: shade });
  }
});
const BUSHC = [P.leaf, 0x93de78, 0x6fd08c, 0xa0d96a];
def('generic', 'bush', { h: 0.85, r: 0.62, col: 0.5, color: true, wind: 0.025 }, (b, c) => {
  const g = col(c.color || c.pick(BUSHC));
  const pts = puffs(b, [0, 0.38, 0], [0.6, 0.48, 0.56], 4, g, c.v + 1, { geo: ico(1), yMax: 0.55, yMin: -0.25, phase: c.v, core: 0.78, out: 0.66 });
  if (c.v === 1 || c.v === 3) flowersOnPuffs(b, pts.slice(0, 3), 1, 0.2, [c.v === 1 ? P.pinkL : P.white]);
});
def('generic', 'mushroomDeco', { h: 0.6, r: 0.35, col: 0.2, color: true }, (b, c) => {
  const cc = col(c.color || c.pick([P.red, 0xff86ad, 0xff9a62, 0xc49bff]));
  mushroom(b, 0, 0, [1.1, 1.0, 1.05, 1.15][c.v], cc, P.cream, [1, 1, 1], 0.05, c.v, false, c.v + 1, 4);
  if (c.v !== 2) mushroom(b, 0.3, 0.16, 0.52, cc, P.cream, [1, 1, 1], -0.28, 1.2, false, c.v + 9, c.v === 3 ? 0 : 2);
  if (c.v === 3) mushroom(b, -0.24, 0.2, 0.38, cc, P.cream, [1, 1, 1], 0.3, -0.6, false, c.v + 3, 0);
});
def('generic', 'fence', { h: 0.82, r: 1.05, col: 0, dir: true, color: true }, (b, c) => {
  const wc = col(c.color || c.pick([0xfff6ea, P.wood, 0xffe2ee, 0xe6f4ff]));
  const pk = extr('picket', () => roundPoly([[-0.5, 0], [0.5, 0], [0.5, 0.76], [0, 1], [-0.5, 0.76]], 0.2, 2), 1);
  for (let i = 0; i < 5; i++) {
    const x = -0.9 + i * 0.45;
    b.add(pk, vary(wc, c.rng, 0.03), [x, 0, 0], [0, 0, (c.rng.next() - 0.5) * 0.06], [0.19, i % 2 ? 0.76 : 0.82, 0.08]);
  }
  for (const y of [0.25, 0.53]) b.add(box(), dim(wc, 0.9), [0, y, -0.06], 0, [2.04, 0.1, 0.05]);
});
def('generic', 'signPost', { h: 1.2, r: 0.35, col: 0.12, dir: true }, (b, c) => {
  const wc = col(c.pick([P.wood, 0xf0c08a, P.wood, 0xe5a46c]));
  b.add(cyl(8, 0.9), dim(wc, 0.88), [0, 0, 0], 0, [0.07, 1.1, 0.07]);
  b.add(sph(8, 6), P.pink, [0, 1.12, 0], 0, 0.085);
  const arrow = extr('arrowBoard', () => roundPoly([[-0.45, -0.14], [0.22, -0.14], [0.22, -0.22], [0.47, 0], [0.22, 0.22], [0.22, 0.14], [-0.45, 0.14]], 0.05, 2), 1);
  b.add(arrow, lit(wc, 0.15), [0.12, 0.9, 0.09], [0, 0, 0.04], [1, 1, 0.07]);
  b.add(starS, P.pink, [0.02, 0.9, 0.135], [0, 0, 0.1], [0.17, 0.17, 0.3]);
  if (c.v % 2 === 1) {
    b.add(arrow, lit(P.sky, 0.25), [-0.12, 0.62, 0.09], [0, PI, -0.05], [0.9, 0.95, 0.07]);
    b.add(heartP, P.red, [-0.04, 0.62, 0.135], 0, [0.15, 0.15, 0.3]);
  }
  tuft(b, 0.08, 0.08, 0.7, P.grass, 3, c.v);
});
def('generic', 'stoneArch', { h: 3.05, r: 1.5, col: 0, dir: true }, (b, c) => {
  const sc = col(c.pick([P.stone, 0xdcd2c8, 0xc8d0e6, 0xdccbd8]));
  const r = c.rng;
  for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) {
    b.add(rbox(0.64, 0.54, 0.62, 0.13, 1), vary(sc, r, 0.05), [sd * 1.12, 0.29 + k * 0.56, 0], [0, (r.next() - 0.5) * 0.14, 0]);
  }
  const R = 1.12, n = 5, sq = (a) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * PI + 0.025, a1 = ((k + 1) / n) * PI - 0.025, pts = [];
    for (let i = 0; i <= 3; i++) { const a = lerp(a0, a1, i / 3); pts.push([Math.cos(a) * R, 1.68 + Math.sin(a) * R, 0]); }
    b.add(tubeGeo(pts, k === 2 ? 0.34 : 0.3, 8, { prof: sq, phase: PI / 4, round: 0.25 }), vary(sc, r, 0.05));
  }
  const top = puffs(b, [0, 1.68 + R + 0.2, 0.0], [0.62, 0.22, 0.36], 3, P.grass, c.v + 3, { geo: ico(1), core: 0, yMax: 0.3, yMin: 0.0, out: 0.9, pMin: 0.55, pMax: 0.7 });
  flowersOnPuffs(b, top, 1, 0.15, [P.pinkL, P.white, P.yellow]);
  tuft(b, -1.45, 0.25, 1, P.grass, 3, 1); tuft(b, 1.42, 0.3, 1, P.grass, 3, 2);
});

// ======================= meadow =======================
const CANOPY = [0xffb6d6, 0xa6ecc8, 0xffcfa0, 0xcdb9ff, 0xfff0a0];
def('meadow', 'lollipopTree', { h: 3.6, r: 1.05, col: 0.2, color: true, wind: 0.012 }, (b, c) => {
  const cc = col(c.color || c.pick(CANOPY));
  const H = [3.5, 3.1, 3.9, 3.3][c.v], R = [1.0, 0.92, 1.08, 0.97][c.v];
  const cy = H - R;
  trunk(b, cy - R * 0.3, 0.16, 0.1, 0xd9a07a, [[0.06, -0.08, 0.1, 0][c.v], 0.05]);
  b.add(sph(18, 12), cc, [0, cy, 0], [0, c.v, 0], [R, R * 0.96, R], { cf: (x, y, z) => { const k = 0.9 + 0.16 * smoothstep(-1, 0.9, y + z * 0.15); return [k, k, k]; } });
  b.add(leafS, P.leaf, [0, cy + R * 0.94, 0], [0, 0.6 + c.v, 0], 0.3);
  b.add(leafS, P.leafL, [0, cy + R * 0.94, 0], [0, 3.6 + c.v, 0], 0.24);
  tuft(b, 0.14, 0.1, 1, P.grass, 4, c.v);
});
def('meadow', 'daisy', { h: 0.5, r: 0.2, col: 0, wind: 0.06 }, (b, c) => {
  const one = (x, z, h, s, yaw, tilt) => {
    const top = [x + Math.sin(yaw) * 0.05, h, z + Math.cos(yaw) * 0.05];
    b.add(tubeGeo([[x, 0, z], [lerp(x, top[0], 0.3), h * 0.5, lerp(z, top[2], 0.3)], top], 0.02, 5, { capStart: false }), P.leafD);
    b.push(top, [-(PI / 2) + tilt, yaw, 0], s);
    b.add(hemi(6, 2), P.leafD, [0, 0, -0.03], [-PI / 2, 0, 0], [0.12, 0.08, 0.12]);
    b.add(daisyP, P.white);
    b.add(hemi(7, 2), P.yellow, [0, 0, 0.03], [PI / 2, 0, 0], [0.17, 0.11, 0.17], { cf: shadeY(0.85, 1.1) });
    b.pop();
  };
  one(0, 0, 0.42, 0.36, 0, 0.8);
  if (c.v === 1 || c.v === 3) one(0.11, -0.07, 0.28, 0.29, 1.6, 0.85);
  if (c.v === 3) one(-0.11, 0.02, 0.2, 0.25, -1.6, 0.9);
  b.add(leafS, P.leaf, [0, 0.01, 0], [0, 0.8 + c.v, 0], 0.17);
  b.add(leafS, P.grass, [0, 0.01, 0], [0, 3.6 + c.v, 0], 0.15);
});
def('meadow', 'tulip', { h: 0.52, r: 0.18, col: 0, color: true, wind: 0.06 }, (b, c) => {
  const tc = col(c.color || c.pick([0xff6f86, 0xff9cc4, 0xffd75a, 0xc9a2ff]));
  const bud = K('tulipBud', () => {
    const g = G.latheGeo([[0, 0], [0.045, 0.008], [0.072, 0.04], [0.08, 0.085], [0.07, 0.12], [0.045, 0.14], [0, 0.128]], 12);
    g.displace((v) => {
      const a = Math.atan2(v.x, v.z), t = smoothstep(0.07, 0.14, v.y);
      const k = 1 + 0.16 * Math.cos(3 * a) * t;
      v.x *= k; v.z *= k; v.y += 0.028 * Math.max(0, Math.cos(3 * a)) * t;
    });
    g.smoothNormalsByPosition();
    return g;
  });
  const one = (x, z, h, s, yaw) => {
    const top = [x + Math.sin(yaw) * 0.03, h, z + Math.cos(yaw) * 0.03];
    b.add(tubeGeo([[x, 0, z], [lerp(x, top[0], 0.3), h * 0.5, lerp(z, top[2], 0.3)], top], 0.017, 4, { capStart: false }), P.leafD);
    b.add(bud, tc, [top[0], h - 0.01, top[2]], [0.1, yaw, 0], s * 1.15, { cf: (x2, y2) => { const k = 0.84 + 0.28 * smoothstep(0, 0.13, y2); return [k, k, k]; } });
  };
  one(0, 0, 0.38, 1, c.v);
  if (c.v % 2 === 1) one(0.09, -0.05, 0.27, 0.8, c.v + 2);
  const tl = K('tulipLeaf', () => leafGeo(1, 0.24, { segs: 5, across: 1, lift: 1.25, bend: 0.9, fold: 0.5 }));
  b.add(tl, P.leaf, [0, 0, 0], [0, 0.6 + c.v, 0], 0.3);
  b.add(tl, P.grass, [0, 0, 0], [0, 3.5 + c.v, 0], 0.26);
});
def('meadow', 'flowerBush', { h: 0.85, r: 0.6, col: 0.45, color: true, wind: 0.02 }, (b, c) => {
  const fc = col(c.color || c.pick([P.pink, 0xffffff, P.yellow, P.lav]));
  const g = c.pick([0x7fd46e, 0x84d878, 0x72cf86, 0x8fd46c]);
  const pts = puffs(b, [0, 0.36, 0], [0.58, 0.46, 0.54], 4, g, c.v + 11, { geo: ico(1), yMax: 0.55, yMin: -0.2, phase: c.v * 0.7, core: 0.78, out: 0.68, pMin: 0.48, pMax: 0.58 });
  const center = fc[0] > 0.95 && fc[1] > 0.9 && fc[2] < 0.6 ? 0xffa64d : P.yellow;
  flowersOnPuffs(b, pts, 1, 0.25, [fc, lit(fc, 0.35)], center);
});
def('meadow', 'bigFlower', { h: 1.55, r: 0.5, col: 0.15, color: true, wind: 0.02 }, (b, c) => {
  const pc = col(c.color || c.pick([0xff8fbf, 0xffb36b, 0xb99cff, 0x7fc8ff]));
  const pts = stemPts(1.18, 0.06, 0.12, 6);
  b.add(tubeGeo(pts, (t) => lerp(0.07, 0.05, t), 7, { capStart: false }), P.leafD);
  b.add(leafM, P.leaf, [0.01, 0.3, 0], [0, 1.2, 0], [0.55, 0.55, 0.62]);
  b.add(leafM, P.grass, [0.02, 0.55, 0.02], [0, -1.8, 0], [0.48, 0.48, 0.55]);
  const top = pts[pts.length - 1];
  b.push([top[0], top[1], top[2]], [-0.3, 0, 0]);
  b.add(hemi(10, 3), P.leafD, [0, 0, -0.05], [-PI / 2, 0, 0], [0.16, 0.11, 0.16]);
  b.add(petals6h, pc, [0, 0, 0], [0, 0, c.v * 0.3], 0.84, { cf: (x, y) => { const k = 0.86 + 0.24 * smoothstep(0.05, 0.42, Math.hypot(x, y)); return [k, k, k]; } });
  b.add(petals6h, lit(pc, 0.45), [0, 0, 0.05], [0, 0, c.v * 0.3 + PI / 6], 0.5);
  b.add(hemi(10, 3), 0xffd84d, [0, 0, 0.09], [PI / 2, 0, 0], [0.14, 0.08, 0.14], { cf: shadeY(0.8, 1.1) });
  b.pop();
});

// ======================= canyon =======================
def('canyon', 'mesaPillar', { h: 4.05, r: 1.2, col: 1.0 }, (b, c) => {
  const cols = [0xffa871, 0xffcfa0, 0xf2915f, 0xffe1bd, 0xffb27a];
  const hs = [0.95, 0.8, 0.85, 0.75, 0.7];
  let y = 0;
  const r = c.rng;
  for (let k = 0; k < 5; k++) {
    const R = lerp(1.18, 0.9, k / 4) * (1 + (r.next() - 0.5) * 0.06), h = hs[k], bv = 0.1;
    const sd = c.v * 10 + k;
    const g = latheD([[0, 0], [R - bv, 0], [R, bv], [R * 1.01, h * 0.5], [R, h - bv], [R - bv * 1.4, h], [0, h]], 16,
      (a, yy) => 1 + 0.07 * (valueNoise3(Math.sin(a) * 2 + sd, yy * 1.5, Math.cos(a) * 2) - 0.5) * 2);
    b.add(g, cols[(k + c.v) % 5], [(r.next() - 0.5) * 0.1, y, (r.next() - 0.5) * 0.1], [0, r.next() * 6, 0], 1, { cf: (x, yy) => { const kk = 0.9 + 0.12 * (yy / h); return [kk, kk, kk]; } });
    y += h - 0.02;
  }
  tuft(b, 0.1, 0.1, 1.2, 0x9ccf5a, 4, c.v); b.push([0, y - 0.02, 0]); tuft(b, 0.2, -0.1, 1, 0x9ccf5a, 3, c.v + 3); b.pop();
});
def('canyon', 'cactusRound', { h: 1.2, r: 0.45, col: 0.38, color: true }, (b, c) => {
  const cc = col(c.color || c.pick([0x8fd9a2, 0x7fd0b0, 0x9fdd8c, 0x86d6c0]));
  const ribs = (n, d) => (a) => 1 + d * Math.cos(n * a);
  const body = K('cactBody2', () => latheD([[0, 0], [0.26, 0.02], [0.37, 0.18], [0.4, 0.42], [0.36, 0.7], [0.24, 0.9], [0.1, 0.98], [0, 1.0]], 16, ribs(8, 0.06)));
  b.add(body, cc, [0, 0, 0], [0, c.v * 0.4, 0], 1, { cf: shadeY(0.86, 1.08) });
  const arm = K('cactArm', () => latheD([[0, 0], [0.12, 0.03], [0.15, 0.15], [0.12, 0.27], [0, 0.31]], 12, ribs(6, 0.07)));
  const sides = c.v % 2 ? [[1, 0.42, 1.05], [-1, 0.3, 0.85]] : [[1, 0.36, 1.0]];
  for (const [sd, y, s] of sides) {
    b.add(sph(7, 5), cc, [sd * 0.38, y, 0.05], 0, [0.13 * s, 0.12 * s, 0.12 * s]);
    b.add(arm, cc, [sd * (0.42 + 0.06 * s), y - 0.02, 0.05], [0, 0, -sd * 0.35], s);
  }
  b.push([0, 0.98, 0], [-PI / 2 + 0.25, 0, 0]);
  b.add(petals5, c.pick([P.pink, 0xffe066, 0xff8fa8, 0xfff2f8]), [0, 0, 0.02], [0, 0, 0.3], [0.3, 0.3, 0.5]);
  b.add(hemi(6, 2), P.yellow, [0, 0, 0.05], [PI / 2, 0, 0], [0.055, 0.04, 0.055]);
  b.pop();
  dotsOn(b, [0, 0.5, 0], [0.39, 0.46, 0.39], dirsUp(5, -0.4, 0.6, c.v + 4, 0.3), 0.028, 0xffffff);
});
def('canyon', 'orangeTree', { h: 3.1, r: 1.2, col: 0.2, wind: 0.012 }, (b, c) => {
  trunk(b, 2.0, 0.16, 0.1, P.trunk, [0.08, 0.04]);
  const cy = 2.25;
  const pts = puffs(b, [0, cy, 0], [1.1, 0.9, 1.05], 7, 0x74cc6a, c.v + 21, { geo: sph(9, 6), coreGeo: sph(12, 8), yMax: 0.65, yMin: -0.35, out: 0.62, pMin: 0.46, pMax: 0.58 });
  pts.forEach((q, i) => {
    if (q.d[1] < -0.3) return;
    const d = nrm3([q.d[0], q.d[1] * 0.5 + 0.1, q.d[2]]);
    const p = [q.p[0] + d[0] * q.rad[0] * 0.95, q.p[1] + d[1] * q.rad[1] * 0.9 - 0.05, q.p[2] + d[2] * q.rad[2] * 0.95];
    b.add(sph(7, 5), 0xffa040, p, 0, 0.14, { cf: shadeY(0.85, 1.12) });
    if (i % 2 === 0) b.add(leafS, P.leafD, [p[0], p[1] + 0.12, p[2]], [0, i * 1.7, 0], 0.11);
  });
  tuft(b, 0.1, 0.1, 1, 0x9ccf5a, 4, c.v);
});
def('canyon', 'pumpkinDeco', { h: 0.62, r: 0.38, col: 0.36, color: true }, (b, c) => {
  const pc = col(c.color || c.pick([0xffa04a, 0xffc06a, 0xfff1d8, 0xb5e39a]));
  const body = K('pumpkin', () => latheD([[0, 0.02], [0.18, 0], [0.3, 0.06], [0.36, 0.18], [0.35, 0.3], [0.28, 0.4], [0.12, 0.44], [0, 0.41]], 24,
    (a) => 1 - 0.1 * Math.pow(1 - Math.abs(Math.cos(3 * a)), 2.5)));
  const sh = [1, 0.9, 1.1, 0.95][c.v];
  b.add(body, pc, [0, 0, 0], [0, c.v * 0.5, 0], [1, sh, 1], { cf: shadeY(0.82, 1.08) });
  b.add(tubeGeo([[0, 0.38 * sh, 0], [0.01, 0.46 * sh, 0], [0.05, 0.53 * sh, 0.02]], [0.045, 0.04, 0.034], 6, { round: true }), 0x7c9a4a);
  b.add(leafS, P.leaf, [0.02, 0.42 * sh, 0], [0, 1.2 + c.v, 0], 0.22);
  const curl = [];
  for (let i = 0; i <= 10; i++) { const a = i * 0.7; curl.push([-0.04 - Math.cos(a) * 0.05 * (1 - i / 14), 0.43 * sh + i * 0.006, Math.sin(a) * 0.05 * (1 - i / 14)]); }
  b.add(tubeGeo(curl, 0.009, 4), 0x7cb04a);
});
def('canyon', 'hayBale', { h: 0.9, r: 0.5, col: 0.48 }, (b, c) => {
  const hc = col(c.pick([0xf7d779, 0xf5cc6a, 0xf9dd8a, 0xf2c95e]));
  const R = 0.45, L = 0.88, bv = 0.09;
  b.push([0, R - 0.02, 0], [0, c.v * 0.3, PI / 2]);
  b.add(latheD([[0, -L / 2], [R - bv, -L / 2], [R, -L / 2 + bv], [R, L / 2 - bv], [R - bv, L / 2], [0, L / 2]], 16,
    (a, y) => 1 + 0.025 * Math.sin(a * 9 + y * 20)), hc);
  for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) {
    b.add(K('ring' + k, () => G.ringGeo(0.08 + k * 0.11, 0.08 + k * 0.11 + 0.045, 16)), dim(hc, 0.8), [0, sd * (L / 2 + 0.003), 0], [sd > 0 ? 0 : PI, 0, 0], 1);
  }
  for (const y of [-0.2, 0.2]) b.add(cyl(16, 1, false), 0xc98b55, [0, y - 0.02, 0], 0, [R + 0.012, 0.04, R + 0.012]);
  b.pop();
  tuft(b, 0.45, 0.25, 0.9, 0xe9c35a, 3, c.v);
});
def('canyon', 'barrel', { h: 0.92, r: 0.4, col: 0.38 }, (b, c) => {
  const wc = col(c.pick([P.wood, 0xdf9f62, 0xeeb57c, 0xd99a66]));
  const g = latheD([[0, 0], [0.3, 0], [0.34, 0.05], [0.385, 0.3], [0.395, 0.46], [0.385, 0.62], [0.34, 0.87], [0.3, 0.92], [0.27, 0.9], [0, 0.9]], 16);
  b.add(g, wc, [0, 0, 0], 0, 1, { cf: (x, y, z) => { const a = Math.atan2(x, z); const k = 0.92 + 0.1 * (Math.floor(((a + PI) / TAU) * 16) % 2); return [k, k, k]; } });
  for (const [y, r] of [[0.17, 0.375], [0.75, 0.375]]) b.add(cyl(16, 1, false), 0xb9a6c8, [0, y, 0], 0, [r + 0.012, 0.06, r + 0.012]);
  b.add(disc(14), dim(wc, 0.82), [0, 0.905, 0], 0, 0.27);
});
def('canyon', 'crateDeco', { h: 0.9, r: 0.5, col: 0.5 }, (b, c) => {
  const wc = col(c.pick([P.wood, 0xf0bd84, 0xe2a066, 0xedb98a]));
  const S = 0.9;
  b.add(rbox(S, S, S, 0.07, 2), lit(wc, 0.05), [0, S / 2, 0]);
  const faces = [[[0, S / 2, S / 2], 0], [[S / 2, S / 2, 0], PI / 2], [[0, S / 2, -S / 2], PI], [[-S / 2, S / 2, 0], -PI / 2], [[0, S, 0], [-PI / 2, 0, 0]]];
  const dg = Math.hypot(S - 0.24, S - 0.24) - 0.06;
  faces.forEach(([p, r], i) => {
    b.push(p, r);
    b.add(box(), dim(wc, 0.78), [0, 0, 0.004], 0, [S - 0.2, S - 0.2, 0.012]);
    b.add(box(), lit(wc, 0.1), [0, 0, 0.018], [0, 0, (i % 2 ? 1 : -1) * PI / 4], [dg, 0.1, 0.03]);
    b.pop();
  });
});

// ======================= honey =======================
def('honey', 'sunflower', { h: 2.55, r: 0.5, col: 0.12, dir: true, wind: 0.012 }, (b, c) => {
  const H = [2.2, 2.05, 2.35, 2.15][c.v];
  const pts = stemPts(H, 0.05, 0.16, 7);
  b.add(tubeGeo(pts, (t) => lerp(0.075, 0.05, t), 7, { capStart: false }), 0x6cbf5a);
  const lf = K('sunLeaf', () => leafGeo(1, 0.62, { segs: 6, across: 2, lift: 0.5, bend: 1.1, shape: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.65)), 0.7) }));
  b.add(lf, P.leaf, [0.01, 0.55, 0.01], [0, 1.4, 0], 0.52);
  b.add(lf, 0x6fcf6a, [0.02, 0.95, 0.02], [0, -1.7, 0], 0.46);
  b.add(lf, P.leaf, [0.03, 1.35, 0.04], [0, 0.3, 0], 0.38);
  const top = pts[pts.length - 1];
  b.push([top[0], top[1] + 0.02, top[2] + 0.02], [-0.18, 0, 0]);
  b.add(hemi(10, 3), 0x5fb050, [0, 0, -0.05], [-PI / 2, 0, 0], [0.24, 0.12, 0.24]);
  const ring = puffy('sunP', () => G.flowerOutline(14, 0.5, 0.25, 56), 0.06, 1);
  b.add(ring, 0xffc93a, [0, 0, -0.02], [0, 0, 0.11], 0.92);
  b.add(ring, 0xffe066, [0, 0, 0.0], [0, 0, 0], 0.84);
  b.add(K('sunDisc', () => G.sphereGeo(1, 14, 4, 0, TAU, 0, PI / 2)), 0xa86a3c, [0, 0, 0.02], [PI / 2, 0, 0], [0.22, 0.07, 0.22],
    { cf: (x, y, z) => { const r = Math.hypot(x, z); const k = r > 0.82 ? 1.25 : (0.85 + 0.15 * ((Math.floor(r * 9)) % 2)); return [k, k * 0.95, k * 0.9]; } });
  if (c.v % 2 === 1) {
    const eye = K('sunEye', () => G.torusGeo(1, 0.28, 4, 8, PI));
    for (const sd of [-1, 1]) b.add(eye, 0x4a2a1c, [sd * 0.075, 0.03, 0.095], [0, 0, 0], 0.032);
    b.add(eye, 0x4a2a1c, [0, -0.04, 0.095], [0, 0, PI], 0.04);
    for (const sd of [-1, 1]) b.add(dotG, 0xff8fa8, [sd * 0.13, -0.025, 0.085], 0, [0.035, 0.022, 0.01]);
  }
  b.pop();
});
def('honey', 'beehive', { h: 1.25, r: 0.5, col: 0.42, dir: true }, (b, c) => {
  const hc = col(c.pick([0xf5c66a, 0xf0bb5a, 0xf7cf7c, 0xe9b65e]));
  b.add(cyl(8), P.woodD, [0, 0, 0], 0, [0.08, 0.36, 0.08]);
  b.add(latheD([[0, 0.34], [0.44, 0.34], [0.46, 0.38], [0.44, 0.42], [0, 0.42]], 14), P.wood);
  const prof = [[0, 0.4]];
  const bands = 6, Hh = 0.82;
  const rr = (y) => 0.42 * Math.sqrt(Math.max(0, 1 - Math.pow((y - 0.4) / (Hh * 1.03), 2.2)));
  for (let k = 0; k < bands; k++) {
    const y0 = 0.4 + (k / bands) * Hh, y1 = 0.4 + ((k + 1) / bands) * Hh;
    prof.push([rr(y0) * 0.94, y0 + 0.005], [rr((y0 + y1) / 2) * 1.04, (y0 + y1) / 2]);
  }
  prof.push([0.05, 0.4 + Hh], [0, 0.4 + Hh + 0.01]);
  b.add(latheD(prof, 16), hc, [0, 0, 0], 0, 1, { cf: (x, y, z) => { const r = Math.hypot(x, z) / Math.max(0.01, rr(y)); const k = 0.82 + 0.22 * smoothstep(0.93, 1.03, r); return [k, k, k * 0.95]; } });
  b.add(K('hiveDoor', () => G.circleGeo(1, 12)), 0x5a3a2a, [0, 0.52, 0.41], [PI / 2, 0, 0], [0.09, 1, 0.07]);
  b.add(box(), P.wood, [0, 0.46, 0.42], 0, [0.22, 0.03, 0.08]);
  b.add(tubeGeo([[0, 1.2, 0], [0, 1.27, 0]], 0.03, 6, { round: true }), P.woodD);
});
def('honey', 'honeyPot', { h: 0.62, r: 0.3, col: 0.25 }, (b, c) => {
  const pc = col(c.pick([0xf0a070, 0x8fc0f0, 0xfff0dc, 0xf5b58a]));
  b.add(latheD([[0, 0], [0.16, 0], [0.22, 0.04], [0.27, 0.17], [0.26, 0.3], [0.2, 0.39], [0.17, 0.42], [0.2, 0.44], [0.2, 0.47], [0.16, 0.475], [0, 0.46]], 10), pc, [0, 0, 0], 0, 1, { cf: shadeY(0.85, 1.05) });
  const hy = 0xffb51f;
  b.add(lumpGeo(c.v + 70, { ws: 10, hs: 6, lobes: 6, amp: 0.25 }), hy, [0, 0.47, 0], 0, [0.2, 0.06, 0.2]);
  for (const [a, l] of [[0.3, 0.12], [1.5, 0.2], [3.4, 0.1], [4.6, 0.16]]) {
    const x = Math.sin(a) * 0.205, z = Math.cos(a) * 0.205;
    b.add(tubeGeo([[x, 0.47, z], [x * 1.04, 0.46 - l * 0.5, z * 1.04], [x * 1.08, 0.46 - l, z * 1.08]], [0.035, 0.03, 0.028], 4, { round: true }), hy);
  }
  b.add(tubeGeo([[0, 0.3, 0], [0.12, 0.62, 0.05]], 0.016, 5, { round: true }), P.wood);
  b.add(latheD([[0, -0.06], [0.04, -0.06], [0.05, -0.03], [0.04, 0], [0.05, 0.03], [0.04, 0.06], [0, 0.065]], 8), P.woodL, [0.15, 0.68, 0.06], [0, 0, -0.36]);
  if (c.v % 2 === 0) b.add(heartP, P.red, [0, 0.24, 0.26], [-0.08, 0, 0], [0.16, 0.16, 0.25]);
});
def('honey', 'clover', { h: 0.34, r: 0.25, col: 0, wind: 0.05 }, (b, c) => {
  const leafl = K('cloverL', () => G.puffyShapeGeo(G.heartOutline(0.5, 14), 0.1, 1));
  const r = c.rng;
  const n = [4, 5, 4, 5][c.v];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.4, 0.4), d = r.range(0.05, 0.13), h = r.range(0.14, 0.26);
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    b.add(tubeGeo([[x * 0.3, 0, z * 0.3], [x, h, z]], 0.011, 4, { capStart: false }), P.leafD);
    const lc = mixc(0x6fcf63, 0x92dc72, r.next());
    const leaves = (c.v === 3 && i === 0) ? 4 : 3;
    for (let k = 0; k < leaves; k++) {
      b.push([x, h, z], [0, (k / leaves) * TAU + a, 0]);
      b.add(leafl, lc, [0, 0.008, 0.06], [-PI / 2 + 0.3, PI, 0], 0.15);
      b.pop();
    }
  }
  if (c.v % 2 === 0) {
    b.add(tubeGeo([[0, 0, 0], [0.02, 0.33, 0.01]], 0.01, 4, { capStart: false }), P.leafD);
    b.add(lumpGeo(c.v + 3, { ws: 8, hs: 6, lobes: 9, amp: 0.35, sharp: 6 }), 0xfff4f8, [0.02, 0.35, 0.01], 0, 0.055);
  }
});
def('honey', 'flowerArch', { h: 3.35, r: 1.55, col: 0, dir: true }, (b, c) => {
  const wc = 0xfff8f0, R = 1.3, y0 = 1.85;
  for (const sd of [-1, 1]) {
    b.add(cyl(8), wc, [sd * R, 0, 0], 0, [0.085, y0, 0.085]);
    b.add(cyl(8, 0.8), dim(wc, 0.95), [sd * R, 0, 0], 0, [0.18, 0.14, 0.18]);
  }
  const arc = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * PI; arc.push([Math.cos(a) * R, y0 + Math.sin(a) * R, 0]); }
  b.add(tubeGeo(arc, 0.07, 6), wc);
  // leafy garland: a bumpy tube winding over the arch and down both posts
  const path = [];
  for (let i = 0; i <= 8; i++) path.push([-R + Math.sin(i * 1.7) * 0.06, 0.25 + (i / 8) * (y0 - 0.25), Math.cos(i * 1.7) * 0.06]);
  for (let i = 1; i < 24; i++) { const a = PI - (i / 24) * PI; path.push([Math.cos(a) * R + Math.sin(i * 1.3) * 0.05, y0 + Math.sin(a) * R + Math.cos(i * 1.1) * 0.05, Math.sin(i * 1.9) * 0.07]); }
  for (let i = 8; i >= 0; i--) path.push([R + Math.sin(i * 1.5) * 0.06, 0.4 + (i / 8) * (y0 - 0.4), Math.cos(i * 1.5) * 0.06]);
  const n = path.length;
  b.add(tubeGeo(path, (t) => 0.15 * (0.6 + 0.65 * Math.pow(Math.abs(Math.sin(t * n * 1.1)), 0.5)) * (t < 0.05 || t > 0.95 ? 0.7 : 1), 6, { round: true }),
    c.pick([0x7fd46e, 0x86d878, 0x74cf72, 0x8ad86a]), null, null, null, { cf: (x, y, z, nx, ny) => { const k = 0.85 + 0.2 * (ny * 0.5 + 0.5); return [k, k, k]; } });
  const r = c.rng;
  const fcs = [[P.pink, P.white, P.yellow], [P.lav, P.pinkL, P.white], [P.peach, P.yellow, P.white], [P.pink, P.lav, P.sky]][c.v];
  for (let i = 2; i < n - 2; i += 2) {
    const p = path[i];
    const a = r.next() * TAU;
    const side = [Math.cos(a) * 0.9, Math.sin(a) * 0.9, r.range(-0.3, 0.3)];
    b.add(leafS, mixc(P.leaf, P.leafD, r.next() * 0.5), [p[0] + side[0] * 0.12, p[1] + side[1] * 0.12, p[2] + side[2] * 0.1], [0, Math.atan2(side[0], side[2]), 0], 0.24);
    if ((i / 2) % 2 === 0) {
      const out = nrm3([r.range(-0.25, 0.25), r.range(-0.1, 0.35), 1]);
      flowerAt(b, [p[0] + out[0] * 0.14, p[1] + out[1] * 0.14, p[2] + 0.14], out, r.range(0.27, 0.33), fcs[(i / 4 | 0) % 3], P.yellow);
    }
  }
});

// ======================= jungle =======================
def('jungle', 'palmTree', { h: 4.2, r: 1.8, col: 0.2, wind: 0.01 }, (b, c) => {
  const H = [3.9, 3.6, 4.1, 3.75][c.v], lean = [0.55, -0.45, 0.35, 0.6][c.v];
  const pts = [];
  const N = 16;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push([lean * Math.pow(t, 1.8), H * t, lean * 0.2 * t]); }
  b.add(tubeGeo(pts, (t) => lerp(0.21, 0.13, t) * (1 + 0.12 * Math.abs(Math.sin(t * 6 * PI))) * (1 + 0.35 * Math.pow(1 - t, 8)), 8, { capStart: false }), 0xd8a870, null, null, null,
    { cf: (x, y) => { const k = 0.9 + 0.12 * Math.abs(Math.sin((y / H) * 6 * PI)); return [k, k * 0.98, k * 0.95]; } });
  const top = pts[N];
  const frond = K('palmFrond2', () => leafGeo(1, 0.3, { segs: 10, across: 1, lift: 0.55, bend: 1.9, fold: 0.45, thick: 0.1,
    shape: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.6)), 0.6) * (0.72 + 0.28 * Math.abs(Math.cos(t * 20))) }));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + c.v * 0.4;
    b.add(frond, mixc(0x74d067, 0x4fb862, (i % 3) / 3), [top[0], top[1] - 0.04, top[2]], [0, a, 0], [2.0, 1.9, 2.1]);
  }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; b.add(sph(7, 5), 0x9a6a44, [top[0] + Math.sin(a) * 0.15, top[1] - 0.2, top[2] + Math.cos(a) * 0.15], 0, 0.13, { cf: shadeY(0.85, 1.1) }); }
  b.add(sph(7, 5), 0x7cc064, [top[0], top[1], top[2]], 0, [0.2, 0.14, 0.2]);
});
def('jungle', 'jungleTree', { h: 5.2, r: 2.0, col: 0.4, wind: 0.008 }, (b, c) => {
  const tr = latheD([[0, 0], [0.5, 0], [0.4, 0.2], [0.33, 0.6], [0.29, 1.6], [0.27, 2.6], [0.3, 3.3], [0.25, 3.7], [0, 3.75]], 12,
    (a, y) => 1 + 0.42 * Math.pow(0.5 + 0.5 * Math.cos(4 * a + c.v), 2) * Math.pow(Math.max(0, 1 - y / 1.1), 2) + 0.04 * Math.sin(a * 3 + y * 2));
  b.add(tr, 0xb98a62, [0, -0.02, 0], 0, 1, { cf: shadeY(0.85, 1.05) });
  const cy = 4.15;
  const pts = puffs(b, [0, cy, 0], [1.75, 1.25, 1.65], 7, 0x55bd68, c.v + 5, { geo: sph(9, 6), coreGeo: sph(12, 8), core: 0.74, yMax: 0.6, yMin: -0.3, out: 0.66, pMin: 0.44, pMax: 0.54, lo: 0.76, hi: 1.1 });
  const r = c.rng;
  pts.forEach((q, i) => {
    if (i % 2 === 1 || q.d[1] > 0.3) return;
    const x = q.p[0] + q.d[0] * 0.25, z = q.p[2] + q.d[2] * 0.25, y0 = q.p[1] - q.rad[1] * 0.5, len = r.range(1.1, 1.8);
    const vp = [];
    for (let k = 0; k <= 5; k++) { const t = k / 5; vp.push([x + Math.sin(t * 5 + i) * 0.05, y0 - t * len, z + Math.cos(t * 4 + i) * 0.05]); }
    b.add(tubeGeo(vp, 0.03, 4, { round: true }), 0x5aa84f);
    b.add(leafS, P.leaf, vp[2], [0, i * 2.1, 0], 0.2);
    b.add(leafS, P.leafL, vp[4], [0, i * 2.1 + 2.5, 0], 0.18);
    if (i % 4 === 0) flowerAt(b, [vp[5][0], vp[5][1] - 0.03, vp[5][2]], [q.d[0], -0.4, q.d[2]], 0.16, P.pink, P.yellow);
  });
});
def('jungle', 'giantLeaf', { h: 1.5, r: 0.9, col: 0, wind: 0.02 }, (b, c) => {
  const lf = K('giantLeaf3', () => leafGeo(1, 0.82, { segs: 8, across: 3, lift: 0.4, bend: 1.35, fold: 0.16, thick: 0.06,
    shape: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.5)), 0.7),
    cf: (t, u, side) => { const v = 1 - Math.abs(u); const k = side ? 0.9 : (0.9 + 0.22 * Math.pow(v, 6) + 0.06 * t); return [k * 0.98, k, k * 0.96]; } }));
  const one = (yaw, h, s, cc, lean) => {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const pts = [[0, 0, 0], [dx * lean * 0.25, h * 0.55, dz * lean * 0.25], [dx * lean, h, dz * lean]];
    b.add(tubeGeo(pts, [0.05, 0.042, 0.034], 6, { capStart: false }), 0x5cb35a);
    b.add(lf, cc, pts[2], [0, yaw, 0], s);
  };
  one(0.15 + c.v * 0.1, 1.15, 1.25, 0x63c86a, 0.3);
  one(2.25 + c.v * 0.15, 0.85, 1.05, 0x78d46e, 0.26);
  one(-2.05 - c.v * 0.1, 0.65, 0.92, 0x55bd70, 0.22);
  if (c.v % 2) one(PI + 0.3, 0.45, 0.75, 0x6fcf6a, 0.16);
});
def('jungle', 'fern', { h: 0.9, r: 0.65, col: 0, wind: 0.04 }, (b, c) => {
  const fr = K('fernFrond3', () => leafGeo(1, 0.32, { segs: 7, across: 1, lift: 1.3, bend: 2.5, fold: 0.2,
    shape: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.7)), 0.8) * (0.55 + 0.45 * Math.abs(Math.sin(t * 9 * PI))) }));
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + c.v * 0.5;
    const s = i % 2 ? 0.78 : 0.92;
    b.add(fr, mixc(0x5ccb6c, 0x86dc72, ((i * 3) % n) / n), [Math.sin(a) * 0.04, 0.02, Math.cos(a) * 0.04], [0, a, 0], [s, s * 1.05, s]);
  }
  b.add(ico(0), 0x5cb35a, [0, 0.04, 0], 0, [0.1, 0.06, 0.1]);
});
def('jungle', 'glowMushroom', { h: 0.8, r: 0.4, col: 0.2, color: true }, (b, c) => {
  const gc = col(c.color || c.pick([0x7ff4ff, 0xff9ef0, 0xb6a0ff, 0x9dffb0]));
  mushroom(b, 0, 0, 1.4, gc, 0xeee8ff, lit(gc, 0.7), 0.08, c.v, true, c.v + 1, 4);
  mushroom(b, 0.3, 0.12, 0.85, gc, 0xeee8ff, lit(gc, 0.7), -0.3, 1.4, true, c.v + 4, 2);
  mushroom(b, -0.22, 0.2, 0.55, gc, 0xeee8ff, lit(gc, 0.7), 0.35, -0.9, true, c.v + 7, 0);
  b.ha([0, 0.62, 0], [0.62, 0.44, 0.62], gc, 0.2);
  b.ha([0.32, 0.4, 0.12], 0.36, gc, 0.16);
});
def('jungle', 'log', { h: 0.65, r: 1.05, col: 0.35, dir: true }, (b, c) => {
  const R = 0.3, L = 2.0;
  b.push([0, R - 0.03, 0], [0, 0, PI / 2]);
  b.add(latheD([[0, -L / 2], [R * 0.96, -L / 2], [R, -L / 2 + 0.05], [R, L / 2 - 0.05], [R * 0.96, L / 2], [0, L / 2]], 12,
    (a, y) => 1 + 0.05 * Math.sin(a * 7 + y * 3) + 0.03 * Math.sin(y * 9)), 0xb07a52);
  for (const sd of [-1, 1]) {
    b.add(disc(12), 0xf2d29c, [0, sd * (L / 2 + 0.004), 0], [sd > 0 ? 0 : PI, 0, 0], R * 0.9);
    b.add(K('logRing', () => G.ringGeo(0.45, 0.55, 12)), 0xd9aa72, [0, sd * (L / 2 + 0.008), 0], [sd > 0 ? 0 : PI, 0, 0], R * 0.9);
  }
  b.pop();
  b.add(ico(1), 0x7fcf6a, [-0.3, R * 1.85, 0.02], 0, [0.4, 0.12, 0.24], { cf: shadeY(0.85, 1.1) });
  b.add(ico(1), 0x8ad870, [0.42, R * 1.85, -0.04], 0, [0.26, 0.1, 0.2], { cf: shadeY(0.85, 1.1) });
  if (c.v % 2 === 0) { mushroom(b, 0.65, 0.22, 0.32, 0xff8f6b, P.cream, [1, 1, 1], -0.9, 0.3, false, 2, 2); mushroom(b, 0.82, 0.25, 0.22, 0xff8f6b, P.cream, [1, 1, 1], -1.1, 0.6, false, 3, 0); }
  b.add(tubeGeo([[-0.2, R * 1.6, 0.18], [-0.12, R * 2.1, 0.32], [-0.05, R * 2.3, 0.4]], [0.045, 0.035, 0.03], 5, { round: true }), 0xa06c48);
  b.add(leafS, P.leaf, [-0.05, R * 2.3, 0.4], [0, 0.5, 0], 0.14);
});
def('jungle', 'stump', { h: 0.55, r: 0.5, col: 0.42 }, (b, c) => {
  b.add(latheD([[0, 0], [0.48, 0], [0.42, 0.07], [0.38, 0.2], [0.36, 0.42], [0.35, 0.5], [0, 0.5]], 14,
    (a, y) => 1 + 0.22 * Math.pow(0.5 + 0.5 * Math.cos(4 * a + c.v), 2) * Math.pow(Math.max(0, 1 - y / 0.45), 2) + 0.03 * Math.sin(a * 11)), 0xb98a62, null, null, null, { cf: shadeY(0.85, 1.05) });
  b.add(disc(14), 0xf3d6a2, [0, 0.505, 0], 0, 0.34);
  b.add(K('stRing', () => G.ringGeo(0.48, 0.58, 14)), 0xd9ac74, [0, 0.508, 0], 0, 0.34);
  b.add(K('stRing2', () => G.ringGeo(0.18, 0.26, 10)), 0xd9ac74, [0, 0.508, 0], 0, 0.34);
  if (c.v % 2 === 0) { b.add(tubeGeo([[0.1, 0.5, 0.05], [0.12, 0.62, 0.06]], 0.014, 4), P.leafD); b.add(leafS, P.leaf, [0.12, 0.6, 0.06], [0, 0.7, 0], 0.14); b.add(leafS, P.grass, [0.12, 0.6, 0.06], [0, 3.8, 0], 0.12); }
  else mushroom(b, 0.36, 0.12, 0.4, 0xff8f6b, P.cream, [1, 1, 1], -0.7, 1.2, false, 5, 2);
  tuft(b, -0.38, 0.25, 0.8, P.grass, 3, c.v);
});
def('jungle', 'bigBloom', { h: 0.62, r: 0.68, col: 0.45, dir: true, color: true }, (b, c) => {
  const pc = col(c.color || c.pick([0xff7f9e, 0xff9f6a, 0xc58bff, 0xff7fd0]));
  const pet = puffy('bloomPet2', () => petalOutline(1, 0.8, 14, 0.5), 0.12, 2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + PI / 5;
    b.push([0, 0.16, 0], [0, a, 0]);
    b.push([0, 0, 0.09], [-PI / 2 + 0.38, 0, 0]);
    b.add(pet, pc, [0, 0.34, 0], 0, [0.62, 0.68, 0.6], { cf: (x, y) => { const k = 0.88 + 0.2 * smoothstep(-0.5, 0.5, y); return [k, k, k]; } });
    for (const [dx, dy, s] of [[0, 0.44, 0.06], [-0.11, 0.3, 0.04]]) b.add(dotG, lit(pc, 0.75), [dx, dy, 0.06], 0, [s, s, s * 0.35]);
    b.pop(); b.pop();
  }
  b.add(latheD([[0.06, 0.12], [0.24, 0.12], [0.27, 0.21], [0.25, 0.28], [0.2, 0.29], [0, 0.26]], 12), 0xffe46d, null, null, null, { cf: shadeY(0.85, 1.08) });
  const face = [0, 0.3, 0.16];
  for (const sd of [-1, 1]) {
    b.add(sph(6, 5), P.eye, [face[0] + sd * 0.085, face[1], face[2]], [-0.55, 0, 0], [0.03, 0.045, 0.022]);
    b.add(dotG, 0xffffff, [face[0] + sd * 0.085 - 0.01, face[1] + 0.017, face[2] + 0.016], 0, 0.011);
    b.add(dotG, 0xff8fb0, [face[0] + sd * 0.16, face[1] - 0.04, face[2] - 0.02], [-0.5, sd * 0.4, 0], [0.04, 0.024, 0.012]);
  }
  b.add(K('bloomSmile', () => G.torusGeo(1, 0.3, 4, 8, PI)), 0x8a3a3a, [0, face[1] - 0.045, face[2] + 0.006], [-0.55, 0, PI], 0.035);
  for (let i = 0; i < 3; i++) b.add(leafS, mixc(P.leaf, P.leafD, i * 0.3), [0, 0.02, 0], [0, (i / 3) * TAU + 0.4, 0], [0.62, 0.42, 0.7]);
});

// ======================= sea =======================
const CORAL = [0xff8fa0, 0xc8a0ff, 0xffa66b, 0x8fd3ff];
def('sea', 'coral', { h: 1.0, r: 0.5, col: 0.2, color: true, wind: 0.01 }, (b, c) => {
  const cc = col(c.color || c.pick(CORAL));
  b.add(boulderGeo(c.v + 40, 0.2, 1), 0xd9c9b8, [0, 0.06, 0], 0, [0.34, 0.16, 0.3]);
  const r = new RNG(c.v * 17 + 3);
  if (c.v === 3) { // organ pipe coral
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU, d = i ? 0.2 : 0, h = r.range(0.5, 0.95) * (i ? 0.85 : 1.1);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      b.add(latheD([[0.085, 0], [0.1, h * 0.5], [0.12, h], [0.09, h + 0.02], [0.07, h - 0.02], [0, h - 0.02]], 9), vary(cc, r, 0.08), [x, 0.05, z], [Math.cos(a) * 0.15 * (d > 0), 0, -Math.sin(a) * 0.15 * (d > 0)]);
    }
    return;
  }
  const branch = (p, dir, len, rad, depth) => {
    const pts = [p];
    let d = dir;
    for (let k = 1; k <= 3; k++) {
      d = nrm3([d[0] + r.range(-0.2, 0.2), d[1] + 0.3, d[2] + r.range(-0.2, 0.2)]);
      const q = pts[k - 1];
      pts.push([q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]);
    }
    b.add(tubeGeo(pts, (t) => rad * (1 - t * 0.2), 5, { capStart: false }), vary(cc, r, 0.06));
    if (depth > 0) {
      const e = pts[3], n = depth === 2 ? 3 : 2;
      b.add(sph(5, 4), cc, e, 0, rad * 0.82);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + r.range(0, 2);
        branch(e, nrm3([d[0] + Math.sin(a) * 0.9, d[1] * 0.8, d[2] + Math.cos(a) * 0.9]), len * 0.8, rad * 0.8, depth - 1);
      }
    } else b.add(sph(6, 4), lit(cc, 0.35), pts[3], 0, rad * 1.2);
  };
  if (c.v === 2) { // brain coral lump + sprigs
    b.add(lumpGeo(c.v + 60, { ws: 14, hs: 9, lobes: 14, amp: 0.12, sharp: 8 }), cc, [0, 0.3, 0], 0, [0.4, 0.33, 0.38], { cf: (x, y, z) => { const k = 0.85 + 0.2 * Math.abs(Math.sin(x * 14 + Math.sin(z * 11) * 2)); return [k, k, k]; } });
    branch([0.26, 0.1, 0.12], [0.4, 1, 0.2], 0.42, 0.06, 1);
    return;
  }
  branch([0, 0.05, 0], [0, 1, 0], 0.36, 0.1, 2);
});
def('sea', 'seaweed', { h: 1.5, r: 0.3, col: 0, wind: 0.05 }, (b, c) => {
  const kelp = K('kelp', () => leafGeo(1, 0.2, { segs: 12, across: 1, lift: 1.45, bend: 0.5, thick: 0.25, fold: 0.1, wave: 0.07, waveF: 2.2,
    shape: (t) => Math.pow(Math.sin(PI * Math.min(1, 0.08 + t * 0.95)), 0.5),
    cf: (t, u, side) => { const k = (side ? 1.15 : 0.95) + 0.22 * t; return [k * 0.95, k, k]; } }));
  const r = c.rng;
  const n = [3, 4, 3, 5][c.v];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.3, 0.3), d = i ? 0.1 : 0;
    const s = r.range(0.95, 1.4) * (i ? 0.85 : 1.08);
    b.add(kelp, mixc(0x6fd8a4, 0x9be38a, r.next()), [Math.sin(a) * d, 0, Math.cos(a) * d], [0, a + PI / 2, 0], s);
  }
  for (let i = 0; i < 3; i++) b.add(ico(0), 0x9fe8b0, [r.range(-0.08, 0.08), r.range(0.3, 0.9), r.range(-0.06, 0.06)], 0, 0.04);
});
def('sea', 'shell', { h: 0.3, r: 0.3, col: 0, ao: 0, color: true }, (b, c) => {
  const sc = col(c.color || c.pick([0xffc0cc, 0xffd8b0, 0xfff0e6, 0xe0c8ff]));
  const g = K('scallop3', () => {
    const pos = [], idx = [], nT = 22, nR = 5, R = 0.5, ribs = 9;
    for (let i = 0; i <= nR; i++) for (let j = 0; j <= nT; j++) {
      const r = (i / nR) * R, th = PI * 0.08 + (j / nT) * PI * 0.84;
      const rib = 0.05 * Math.abs(Math.sin(((j / nT) * ribs) * PI)) * Math.pow(i / nR, 0.7);
      const y = 0.27 * Math.sqrt(Math.max(0, 1 - Math.pow(r / R, 2.2))) * (0.45 + 0.55 * Math.sin(th)) + rib;
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r - 0.22);
    }
    for (let i = 0; i < nR; i++) for (let j = 0; j < nT; j++) {
      const a = i * (nT + 1) + j, bb = a + 1, cc = a + nT + 2, d = a + nT + 1;
      idx.push(a, cc, d, a, bb, cc);
    }
    const base = pos.length / 3;
    pos.push(0, 0, -0.22);
    for (let j = 0; j <= nT; j++) { const th = PI * 0.08 + (j / nT) * PI * 0.84; pos.push(Math.cos(th) * R, 0, Math.sin(th) * R - 0.22); }
    for (let j = 0; j < nT; j++) idx.push(base, base + 1 + j, base + 1 + j + 1);
    const gg = new G.Geometry();
    gg.setAttribute('position', pos, 3); gg.setIndex(idx); gg.computeVertexNormals();
    gg.colorBy((x, y, z) => { const r = Math.hypot(x, z + 0.22) / 0.5; const k = 0.86 + 0.18 * r + (y > 0.03 ? 0.04 : 0); return [k, k, k]; });
    gg.computeBoundingSphere();
    return gg;
  });
  b.add(g, sc, [0, 0.03, 0.12], [-0.7, c.v * 1.3, 0], 0.95);
  b.add(sph(6, 4), dim(sc, 0.95), [0, 0.03, -0.1], [0, c.v * 1.3, 0], [0.08, 0.06, 0.06]);
});
def('sea', 'starfish', { h: 0.1, r: 0.24, col: 0, ao: 0, color: true }, (b, c) => {
  const sc = col(c.color || c.pick([0xffa070, 0xff8fb0, 0xffc06a, 0xc59cff]));
  const g = puffy('starfish', () => roundStarOutline(5, 0.5, 0.21, 40, 1.15), 0.14, 2);
  b.push([0, 0.04, 0], [-PI / 2, 0, c.v * 0.7]);
  b.add(g, sc, [0, 0, 0], 0, 0.48, { cf: (x, y, z) => { const k = 0.88 + 0.22 * smoothstep(0, 0.12, z); return [k, k, k]; } });
  for (let i = 0; i < 5; i++) {
    const a = PI / 2 + (i / 5) * TAU;
    for (const d of [0.07, 0.14]) b.add(sph(4, 3), lit(sc, 0.65), [Math.cos(a) * d, Math.sin(a) * d, 0.055 - d * 0.12], 0, [0.018, 0.018, 0.01]);
  }
  b.pop();
});
def('sea', 'sandcastle', { h: 1.3, r: 0.65, col: 0.6, dir: true }, (b, c) => {
  const sc = col(0xf9dca6), sd = col(0xf0c88e);
  b.add(lumpGeo(c.v + 80, { ws: 12, hs: 7, lobes: 6, amp: 0.15, flat: 0.1 }), sd, [0, 0.0, 0], 0, [0.7, 0.55, 0.62]);
  const tower = (x, z, r, h, y0) => {
    b.add(latheD([[0, y0], [r * 1.12, y0], [r, y0 + h * 0.5], [r * 0.92, y0 + h], [0, y0 + h]], 12, (a, y) => 1 + 0.02 * Math.sin(y * 40)), sc, [x, 0, z], null, null, { cf: shadeY(0.88, 1.05) });
    const n = Math.max(5, Math.round(r * 28));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      b.add(box(), lit(sc, 0.05), [x + Math.sin(a) * r * 0.86, y0 + h + r * 0.15, z + Math.cos(a) * r * 0.86], [0, a, 0], [r * 0.42, r * 0.4, r * 0.3]);
    }
  };
  tower(0, -0.05, 0.27, 0.72, 0.18);
  [[0.36, 0.2, 0.4], [-0.36, 0.18, 0.34], [0.05, 0.42, 0.28]].forEach(([x, z, h]) => tower(x, z, 0.15, h, 0.12));
  b.add(K('door', () => G.extrudeGeo(roundPoly([[-0.5, 0], [0.5, 0], [0.5, 0.6], [0, 1], [-0.5, 0.6]], 0.3, 3), 1)), 0x9a6a50, [0, 0.2, 0.22], 0, [0.16, 0.24, 0.04]);
  b.add(cyl(4), 0xfff8f0, [0, 0.98, -0.05], 0, [0.012, 0.32, 0.012]);
  b.add(extr('flag', () => [[0, 0], [0.22, -0.06], [0, -0.13]], 1), c.pick([P.pink, P.red, P.sky, P.lav]), [0.012, 1.29, -0.05], 0, [1, 1, 0.012]);
  b.add(heartP, 0xffc0d0, [0.3, 0.26, 0.38], [-0.3, 0.3, 0], [0.09, 0.09, 0.2]);
  b.add(starS, 0xffb070, [-0.32, 0.22, 0.4], [-0.4, -0.3, 0.3], [0.1, 0.1, 0.25]);
});
def('sea', 'beachUmbrella', { h: 2.3, r: 1.0, col: 0.1 }, (b, c) => {
  const cs = [[P.pink, P.white], [P.sky, P.white], [P.yellow, P.white], [P.lav, P.mint]][c.v];
  b.push([0, 0, 0], [0, c.v, 0.12]);
  b.add(cyl(6), 0xfff6ee, [0, 0, 0], 0, [0.04, 2.1, 0.04]);
  const prof = [[0.02, 2.36], [0.4, 2.28], [0.78, 2.1], [0.98, 1.95]];
  const n = 8;
  for (let i = 0; i < n; i++) {
    b.add(G.latheGeo(prof, 3, (i / n) * TAU, TAU / n), cs[i % 2]);
    b.add(G.latheGeo(prof.map(([r, y]) => [r * 0.99, y - 0.02]).reverse(), 3, (i / n) * TAU, TAU / n), dim(cs[i % 2], 0.85));
  }
  b.add(sph(8, 6), cs[0], [0, 2.38, 0], 0, 0.07);
  b.pop();
});
def('sea', 'lifebuoy', { h: 1.0, r: 0.4, col: 0.12, dir: true }, (b, c) => {
  b.add(cyl(8, 0.9), P.wood, [0, 0, -0.02], 0, [0.07, 0.95, 0.07]);
  b.add(sph(8, 5), P.woodL, [0, 0.95, -0.02], 0, [0.075, 0.05, 0.075]);
  const cs = [[0xff5f6f, 0xffffff], [0xff7f50, 0xffffff], [0xff6b9a, 0xffffff], [0x5fb0ff, 0xffffff]][c.v];
  const arc = tor(0.32, 8, 6, PI / 2);
  for (let k = 0; k < 4; k++) b.add(arc, cs[k % 2], [0, 0.6, 0.13], [0, 0, (k * PI) / 2 + PI / 4], 0.3);
  b.add(tubeGeo([[0, 0.9, -0.02], [0, 0.86, 0.13]], 0.012, 4), 0xf3e0c0);
});
def('sea', 'barnacleRock', { h: 1.0, r: 0.7, col: 0.6 }, (b, c) => {
  const rc = col(c.pick([0xb9c3dc, 0xc5bcd8, 0xaebdd2, 0xc8c4d8]));
  b.add(boulderGeo(c.v + 33, 0.18), rc, [0, 0.32, 0], [0, c.v, 0], [0.66, 0.68, 0.6]);
  const barn = K('barnacle', () => latheD([[0.07, 0], [0.06, 0.035], [0.035, 0.06], [0.022, 0.05], [0.02, 0.03]], 7));
  for (const d of dirsUp(5, -0.1, 0.7, c.v + 3, 0.6)) {
    const p = [d[0] * 0.6, 0.32 + d[1] * 0.6, d[2] * 0.55];
    const n = nrm3([d[0] / 0.66, d[1] / 0.68, d[2] / 0.6]);
    b.push(p, faceN(n));
    b.add(barn, 0xf3ecdc, [0, 0, -0.01], [PI / 2, 0, 0], 1.7);
    b.pop();
  }
  b.add(K('starfishS', () => G.puffyShapeGeo(roundStarOutline(5, 0.5, 0.2, 30, 1.15), 0.12, 1)), 0xff9a7a, [0.22, 0.42, 0.52], [-0.35, 0.3, 0.4], 0.26);
  tuft(b, -0.55, 0.3, 0.9, 0x4fc49a, 3, c.v);
});

// ======================= snow =======================
def('snow', 'snowPine', { h: 3.6, r: 1.1, col: 0.2, wind: 0.008 }, (b, c) => {
  b.add(cyl(8, 0.8), 0xa0704e, [0, 0, 0], 0, [0.14, 0.7, 0.14]);
  const tiers = [[0.45, 1.08, 1.15], [1.15, 0.9, 1.0], [1.8, 0.7, 0.9], [2.38, 0.48, 0.85]];
  const gc = c.pick([0x5fbf98, 0x58b89a, 0x67c39a, 0x55b08f]);
  tiers.forEach(([y, R, h], k) => {
    const tier = latheD([[0, 0], [R * 0.94, 0.02], [R, 0.08], [R * 0.62, h * 0.42], [R * 0.3, h * 0.75], [0, h]], 14, (a) => 1 + 0.06 * Math.cos(7 * a + k));
    b.add(tier, gc, [0, y, 0], [0, k, 0], 1, { cf: shadeY(0.85, 1.05) });
    const snow = latheD([[R * 0.82, 0.12], [R * 0.66, h * 0.36], [R * 0.33, h * 0.72], [0.0, h + 0.035]], 14, (a) => 1.06 + 0.02 * Math.cos(7 * a + k),
      (a, yy) => (yy < 0.2 ? yy - 0.09 * Math.max(0, Math.cos(5 * a + k * 1.3)) : yy));
    b.add(snow, P.snow, [0, y, 0], [0, k, 0], 1);
  });
  b.add(lumpGeo(c.v + 3, { ws: 12, hs: 6, lobes: 5, amp: 0.2, flat: 0.1 }), P.snow, [0, 0, 0], 0, [0.6, 0.3, 0.6]);
});
def('snow', 'snowman', { h: 1.65, r: 0.45, col: 0.42, dir: true }, (b, c) => {
  const sw = (x, y) => { const k = 0.88 + 0.14 * smoothstep(-1, 0.8, y); return [k * 0.97, k * 0.99, k]; };
  for (const [y, r] of [[0.36, 0.42], [0.9, 0.31], [1.3, 0.24]]) b.add(sph(12, 9), P.snow, [0, y, 0], 0, r, { cf: sw });
  const hy = 1.3, hr = 0.24;
  for (const sd of [-1, 1]) {
    b.add(sph(6, 4), P.eye, [sd * 0.08, hy + 0.04, hr * 0.92], [-0.2, sd * 0.3, 0], [0.032, 0.045, 0.025]);
    b.add(dotG, 0xffffff, [sd * 0.08 - 0.01, hy + 0.06, hr * 0.98], 0, 0.011);
    b.add(dotG, 0xffa0b8, [sd * 0.15, hy - 0.04, hr * 0.82], [0, sd * 0.6, 0], [0.04, 0.025, 0.012]);
  }
  b.add(cone(8), 0xff9a3c, [0, hy - 0.01, hr * 0.92], [PI / 2, 0, 0], [0.035, 0.14, 0.035]);
  for (let i = 0; i < 5; i++) { const a = -0.5 + i * 0.25; b.add(ico(0), P.dark, [Math.sin(a) * 0.09, hy - 0.09 - Math.cos(a * 2) * 0.012, hr * 0.9], 0, 0.014); }
  const sc = c.pick([P.red, P.sky, P.pink, P.lav]);
  b.add(tor(0.32, 5, 14), sc, [0, 1.11, 0], [PI / 2, 0, 0], [0.24, 0.24, 0.26]);
  b.add(rbox(0.1, 0.26, 0.04, 0.02, 1), sc, [0.12, 0.98, 0.22], [0.2, 0.3, 0.15]);
  for (let i = 0; i < 3; i++) b.add(dotG, P.dark, [0, 0.98 - i * 0.12, 0.3 - i * 0.004], [0.1, 0, 0], [0.03, 0.03, 0.015]);
  for (const sd of [-1, 1]) {
    const p0 = [sd * 0.27, 0.95, 0], p1 = [sd * 0.55, 1.12, 0.05], p2 = [sd * 0.62, 1.2, 0.06];
    b.add(tubeGeo([p0, p1, p2], 0.02, 4, { round: true }), 0x8a5a3c);
    b.add(tubeGeo([p1, [sd * 0.6, 1.06, 0.07]], 0.014, 4, { round: true }), 0x8a5a3c);
  }
  b.add(hemi(12, 4), sc, [0, hy + 0.1, 0], [-0.15, 0, 0.1], [0.215, 0.17, 0.215]);
  b.add(tor(0.3, 5, 12), lit(sc, 0.5), [0, hy + 0.11, 0], [PI / 2 - 0.15, 0, 0.1], [0.215, 0.215, 0.2]);
  b.add(ico(1), 0xffffff, [0.03, hy + 0.3, -0.03], 0, 0.06);
});
def('snow', 'iceCrystal', { h: 1.45, r: 0.5, col: 0.4, color: true }, (b, c) => {
  const ic = col(c.color || c.pick([0xbfefff, 0xcfe0ff, 0xb8fff0, 0xe0d0ff]));
  b.add(lumpGeo(c.v + 3, { ws: 10, hs: 6, lobes: 5, amp: 0.25, flat: 0.2 }), P.snow, [0, 0.02, 0], 0, [0.5, 0.24, 0.46]);
  const sh = [[0, 0, 1.0, 0.17, 0.05, 0], [0.18, 0.08, 0.62, 0.12, 0.42, 1.1], [-0.18, 0.06, 0.55, 0.12, 0.48, -1.5], [0.02, -0.18, 0.48, 0.1, 0.5, 3.2], [-0.1, 0.2, 0.36, 0.08, 0.65, -0.4]];
  sh.forEach(([x, z, h, r, tilt, yaw], i) => {
    b.push([x, 0.05, z], [tilt, yaw + c.v, 0]);
    const grad = (x2, y2) => { const k = lerp(0.88, 1.15, clamp(y2, 0, 1)); return [k, k, k]; };
    b.add(prismBody(6, 0.85), dim(ic, 1 - i * 0.02), null, null, [r, h, r], { cf: grad });
    b.add(prismTip(6, 0.85), lit(ic, 0.5), [0, h, 0], null, [r, r * 2.4, r]);
    b.pop();
  });
  b.ha([0, 0.7, 0], [0.6, 0.8, 0.6], ic, 0.14);
});
def('snow', 'igloo', { h: 1.3, r: 1.35, col: 1.2, dir: true }, (b, c) => {
  const R = 1.22;
  b.add(hemi(14, 5), 0xb8c8e8, [0, 0, 0], 0, R * 0.975);
  const rows = [[0, 0.3, 11], [0.3, 0.6, 10], [0.6, 0.9, 8], [0.9, 1.15, 6]];
  const r = c.rng;
  rows.forEach(([e0, e1, nb], k) => {
    for (let i = 0; i < nb; i++) {
      const a0 = ((i + (k % 2) * 0.5) / nb) * TAU, a1 = a0 + TAU / nb;
      if (k === 0 && Math.cos((a0 + a1) / 2) > 0.86) continue; // leave the entrance free
      const pos = [], idx = [], NU = 4, NV = 3;
      for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) {
        const fu = u / (NU - 1), fv = v / (NV - 1);
        const a = lerp(a0 + 0.014, a1 - 0.014, fu), e = lerp(e0 + 0.014, e1 - 0.014, fv);
        const inset = (u === 0 || u === NU - 1 || v === 0 || v === NV - 1) ? 0.985 : 1.012;
        pos.push(Math.sin(a) * Math.cos(e) * R * inset, Math.sin(e) * R * inset, Math.cos(a) * Math.cos(e) * R * inset);
      }
      for (let v = 0; v < NV - 1; v++) for (let u = 0; u < NU - 1; u++) { const q = v * NU + u; idx.push(q, q + 1, q + NU + 1, q, q + NU + 1, q + NU); }
      const g = new G.Geometry(); g.setAttribute('position', pos, 3); g.setIndex(idx); g.computeVertexNormals();
      const nn = g.attributes.normal.array, pp = g.attributes.position.array;
      if (nn[5 * 3] * pp[5 * 3] + nn[5 * 3 + 1] * pp[5 * 3 + 1] + nn[5 * 3 + 2] * pp[5 * 3 + 2] < 0) { for (let t = 0; t < idx.length; t += 3) { const tmp = g.index[t + 1]; g.index[t + 1] = g.index[t + 2]; g.index[t + 2] = tmp; } g.computeVertexNormals(); }
      b.add(g, mixc(P.snow, 0xdcecff, r.next() * 0.5));
    }
  });
  b.add(G.sphereGeo(1, 10, 3, 0, TAU, 0, PI / 2 - 1.15), P.snow, [0, 0, 0], 0, R * 1.0);
  // entrance tunnel (+Z): half-cylinder shell with arch rim and dark doorway
  const z0 = R * 0.62, L = 0.72;
  b.add(K('iglooTunnel', () => G.cylinderGeo(1, 1, 1, 10, 1, false, -PI / 2, PI)), P.snow, [0, 0, z0 + L / 2], [-PI / 2, 0, 0], [0.62, L, 0.62]);
  b.add(K('iglooDoor', () => G.circleGeo(1, 12)), 0x46507e, [0, 0, z0 + L - 0.02], [PI / 2, 0, 0], 0.52);
  b.add(K('iglooArch', () => G.torusGeo(1, 0.13, 6, 12, PI)), 0xffffff, [0, 0, z0 + L], 0, 0.6);
  b.add(lumpGeo(c.v + 9, { ws: 10, hs: 6, lobes: 5, amp: 0.3, flat: 0.1 }), P.snow, [-0.9, 0, 0.75], 0, [0.4, 0.18, 0.35]);
});
def('snow', 'snowRock', { h: 0.8, r: 0.55, col: 0.5 }, (b, c) => {
  const rc = col(c.pick([0xb6bcd8, 0xc1bbd6, 0xaab8d4, 0xbcc4dc]));
  b.add(boulderGeo(c.v + 12, 0.2), rc, [0, 0.22, 0], [0, c.v, 0], [0.56, 0.46, 0.5]);
  b.add(lumpGeo(c.v + 15, { ws: 12, hs: 7, lobes: 6, amp: 0.25, flat: 0.1 }), P.snow, [0.02, 0.52, 0], [0, c.v, 0], [0.44, 0.2, 0.4]);
  b.add(lumpGeo(c.v + 16, { ws: 10, hs: 6, lobes: 5, amp: 0.25, flat: 0.1 }), P.snow, [0.4, 0.0, 0.3], 0, [0.3, 0.12, 0.26]);
});
def('snow', 'frozenFlower', { h: 0.62, r: 0.25, col: 0, color: true }, (b, c) => {
  const fc = col(c.color || c.pick([0xc8eaff, 0xe0d0ff, 0xc8fff0, 0xffd8f0]));
  b.add(tubeGeo([[0, 0, 0], [0.02, 0.22, 0.01], [0.03, 0.42, 0.03]], 0.022, 5, { capStart: false }), 0x9fd8e8);
  for (const [y, a] of [[0.1, 0.6], [0.2, 3.6]]) { b.push([0.01, y, 0], [0.9, a, 0]); b.add(prismBody(4, 0.6), 0xb0e4f0, null, null, [0.05, 0.16, 0.03]); b.add(prismTip(4, 0.6), 0xd8f6ff, [0, 0.16, 0], null, [0.05, 0.08, 0.03]); b.pop(); }
  b.push([0.03, 0.43, 0.03], [-0.35, 0, 0]);
  const n = 6;
  for (let i = 0; i < n; i++) {
    b.push([0, 0, 0], [0, (i / n) * TAU, 0]);
    b.push([0, 0, 0.02], [0.8, 0, 0]);
    b.add(prismBody(4, 0.7), fc, null, null, [0.07, 0.14, 0.035], { cf: (x, y) => { const k = 0.9 + 0.2 * y; return [k, k, k]; } });
    b.add(prismTip(4, 0.7), lit(fc, 0.5), [0, 0.14, 0], null, [0.07, 0.1, 0.035]);
    b.pop(); b.pop();
  }
  b.gl(ico(1), lit(fc, 0.6), [0, 0.04, 0], 0, 0.055);
  b.ha([0, 0.06, 0], 0.26, fc, 0.2);
  b.pop();
});
def('snow', 'candyCane', { h: 1.55, r: 0.3, col: 0.1 }, (b, c) => {
  const cs = [[0xff5f6f, 0xffffff], [0x6fd08a, 0xffffff], [0xff8fc0, 0xffffff], [0x7fb8ff, 0xffffff]][c.v];
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push([0, i * 0.15, 0]);
  for (let i = 1; i <= 9; i++) { const a = (i / 9) * PI; pts.push([0.24 - Math.cos(a) * 0.24, 1.2 + Math.sin(a) * 0.24, 0]); }
  pts.push([0.48, 1.08, 0]);
  b.push([0, 0, 0], [0.06, c.v * 1.1, 0.04]);
  stripeTubeGeos(pts, 0.08, 6, 5, 2, cs).forEach((g) => b.add(g, [1, 1, 1]));
  b.add(sph(8, 5), cs[0], [0.48, 1.08, 0], 0, 0.08);
  b.pop();
  b.add(lumpGeo(c.v + 40, { ws: 10, hs: 6, lobes: 5, amp: 0.25, flat: 0.1 }), P.snow, [0, 0, 0], 0, [0.22, 0.12, 0.22]);
});

// ======================= toy =======================
const TOYC = [0xff7f8f, 0x7fb8ff, 0xffd84d, 0x7fd88f, 0xb89aff, 0xffa65c];
def('toy', 'toyBlock', { h: 0.9, r: 0.55, col: 0.5, color: true }, (b, c) => {
  const S = 0.88;
  const body = c.color || [0xfff6e8, 0xfff0f6, 0xf0f8ff, 0xfffbe8][c.v];
  b.add(rbox(S, S, S, 0.11, 2), body, [0, S / 2, 0]);
  const faces = [[[0, S / 2, S / 2 + 0.004], [0, 0, 0]], [[S / 2 + 0.004, S / 2, 0], [0, PI / 2, 0]], [[0, S / 2, -S / 2 - 0.004], [0, PI, 0]], [[-S / 2 - 0.004, S / 2, 0], [0, -PI / 2, 0]], [[0, S + 0.004, 0], [-PI / 2, 0, 0]]];
  const sym = ['A', 'heart', 'B', 'star', 'dot'];
  faces.forEach(([p, r], i) => {
    const fc = TOYC[(i + c.v) % TOYC.length];
    b.push(p, r);
    b.add(box(), fc, [0, 0, -0.01], 0, [0.66, 0.66, 0.04]);
    const w = 0xffffff, s2 = sym[(i + c.v) % sym.length];
    if (s2 === 'A') {
      b.add(box(), w, [-0.1, 0, 0.02], [0, 0, -0.38], [0.09, 0.46, 0.04]);
      b.add(box(), w, [0.1, 0, 0.02], [0, 0, 0.38], [0.09, 0.46, 0.04]);
      b.add(box(), w, [0, -0.06, 0.02], 0, [0.22, 0.08, 0.04]);
    } else if (s2 === 'B') {
      b.add(box(), w, [-0.1, 0, 0.02], 0, [0.09, 0.46, 0.04]);
      b.add(tor(0.32, 4, 10, PI), w, [-0.04, 0.11, 0.02], [0, 0, -PI / 2], [0.12, 0.11, 0.12]);
      b.add(tor(0.32, 4, 10, PI), w, [-0.04, -0.11, 0.02], [0, 0, -PI / 2], [0.14, 0.12, 0.12]);
    } else if (s2 === 'heart') b.add(heartP, w, [0, 0, 0.02], 0, [0.46, 0.46, 0.3]);
    else if (s2 === 'star') b.add(starS, w, [0, 0, 0.02], 0, [0.5, 0.5, 0.25]);
    else b.add(sph(8, 4), w, [0, 0, 0.01], 0, [0.17, 0.17, 0.05]);
    b.pop();
  });
});
def('toy', 'crayon', { h: 2.0, r: 0.25, col: 0.25, color: true }, (b, c) => {
  const cc = col(c.color || c.pick([0xff6f7f, 0x6fb0ff, 0x7fd47f, 0xb08fff]));
  b.push([0, 0, 0], [0.05, c.v, 0.04]);
  b.add(latheD([[0, 0], [0.2, 0], [0.22, 0.03], [0.22, 1.35], [0.2, 1.38], [0, 1.38]], 14), cc);
  b.add(cyl(14, 1, false), lit(cc, 0.6), [0, 0.22, 0], 0, [0.228, 0.95, 0.228]);
  for (const y of [0.3, 0.38, 1.05, 1.13]) b.add(cyl(14, 1, false), dim(cc, 0.75), [0, y, 0], 0, [0.232, 0.03, 0.232]);
  b.add(latheD([[0.2, 1.37], [0.19, 1.42], [0.075, 1.82], [0.05, 1.86], [0, 1.88]], 14), cc, [0, 0, 0], 0, 1, { cf: shadeY(0.88, 1.06) });
  b.pop();
});
def('toy', 'giftBox', { h: 0.95, r: 0.48, col: 0.45, color: true }, (b, c) => {
  const bc = col(c.color || c.pick([0xff9ec4, 0x8fc8ff, 0xa8e8b0, 0xc8a8ff]));
  const rc = c.pick([0xfff2a0, 0xffffff, 0xff7f9a, 0xffe066]);
  b.add(rbox(0.78, 0.6, 0.78, 0.07, 1), bc, [0, 0.3, 0]);
  b.add(rbox(0.86, 0.16, 0.86, 0.06, 1), lit(bc, 0.12), [0, 0.66, 0]);
  b.add(box(), rc, [0, 0.37, 0], 0, [0.15, 0.6, 0.795]);
  b.add(box(), rc, [0, 0.37, 0], 0, [0.795, 0.6, 0.15]);
  b.add(box(), rc, [0, 0.66, 0], 0, [0.15, 0.165, 0.875]);
  b.add(box(), rc, [0, 0.66, 0], 0, [0.875, 0.165, 0.15]);
  for (const sd of [-1, 1]) b.add(tor(0.38, 5, 10), rc, [sd * 0.13, 0.82, 0], [0, 0, sd * 0.5], [0.13, 0.11, 0.15]);
  b.add(ico(1), rc, [0, 0.77, 0], 0, 0.06);
});
def('toy', 'toyBall', { h: 0.8, r: 0.4, col: 0.4, color: true }, (b, c) => {
  const cs = c.color ? [col(c.color), [1, 1, 1]] : [[0xff7f8f, 0xffffff, 0x7fb8ff, 0xffd84d, 0xffffff, 0x7fd88f], [0xb89aff, 0xffd84d, 0xff9ec4, 0x7fe0d0, 0xffd84d, 0xffa65c], [0xff8fb8, 0xffffff], [0x7fb8ff, 0xffd84d, 0xffffff]][c.v];
  const n = 6;
  b.push([0, 0.39, 0], [0.3, c.v, 0.2]);
  for (let i = 0; i < n; i++) b.add(G.sphereGeo(1, 3, 10, (i / n) * TAU, TAU / n), cs[i % cs.length], null, null, 0.4);
  b.add(sph(8, 3), 0xffffff, [0, 0.39, 0], 0, [0.09, 0.02, 0.09]);
  b.pop();
});
def('toy', 'topDeco', { h: 1.0, r: 0.52, col: 0.35, color: true }, (b, c) => {
  const cs = c.color ? [col(c.color), [1, 1, 1], lit(c.color, 0.5)] : [[0xff7f8f, 0xffffff, 0x7fb8ff], [0xffd84d, 0xff9ec4, 0x7fd88f], [0xb89aff, 0xfff2a0, 0xff9ec4], [0x7fd0ff, 0xffffff, 0xffa65c]][c.v];
  b.push([0, 0, 0], [0.12, c.v, 0.1]);
  b.add(latheD([[0, 0], [0.04, 0.02], [0.2, 0.17], [0.38, 0.32]], 14), cs[0]);
  b.add(latheD([[0.38, 0.32], [0.48, 0.42], [0.5, 0.47], [0.48, 0.52]], 14), cs[1]);
  b.add(latheD([[0.48, 0.52], [0.36, 0.62], [0.18, 0.72], [0.07, 0.76], [0, 0.765]], 14), cs[2]);
  b.add(cyl(8), cs[1], [0, 0.74, 0], 0, [0.05, 0.2, 0.05]);
  b.add(sph(8, 6), cs[0], [0, 0.96, 0], 0, 0.075);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; b.add(starS, 0xffffff, [Math.sin(a) * 0.32, 0.6, Math.cos(a) * 0.32], [-0.72, a, 0], [0.15, 0.15, 0.2]); }
  b.pop();
});
def('toy', 'gearDeco', { h: 1.5, r: 0.75, col: 0.5, color: true, dir: true }, (b, c) => {
  const gc = col(c.color || c.pick([0x9fe8c9, 0xc7b4ff, 0xffd86b, 0xffaacd]));
  const gear = extr('gearDeco', () => gearOutline(10, 0.5, 0.41, 8), 1);
  b.add(gear, gc, [0, 0.7, 0], [0, 0, c.v * 0.1], [1.5, 1.5, 0.22], { cf: (x, y, z, nx, ny, nz) => { const k = Math.abs(nz) > 0.9 ? 1.04 : 0.86; return [k, k, k]; } });
  b.add(cyl(14), lit(gc, 0.45), [0, 0.7, -0.15], [PI / 2, 0, 0], [0.2, 0.3, 0.2]);
  b.add(sph(10, 6), 0xfff6e0, [0, 0.7, 0.16], 0, [0.09, 0.09, 0.04]);
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + c.v * 0.1; b.add(disc(12), dim(gc, 0.72), [Math.cos(a) * 0.38, 0.7 + Math.sin(a) * 0.38, 0.112], [PI / 2, 0, 0], 0.085); }
  if (c.v % 2 === 1) {
    const g2 = col(c.pick([0xffd86b, 0xffaacd, 0x9fe8c9, 0xc7b4ff]));
    b.add(gear, g2, [0.82, 0.38, -0.12], [0, 0, 0.2], [0.8, 0.8, 0.18], { cf: (x, y, z, nx, ny, nz) => { const k = Math.abs(nz) > 0.9 ? 1.04 : 0.86; return [k, k, k]; } });
    b.add(cyl(10), lit(g2, 0.4), [0.82, 0.38, -0.25], [PI / 2, 0, 0], [0.1, 0.27, 0.1]);
  }
});
def('toy', 'pencil', { h: 2.35, r: 0.25, col: 0.2, color: true }, (b, c) => {
  const pc = col(c.color || c.pick([0xffd84d, 0x8fc8ff, 0xff9ec4, 0xa8e8a0]));
  b.push([0, 0, 0], [0.22, c.v * 1.4, 0]);
  b.add(K('pencilTip', () => G.cylinderGeo(1, 0.25, 1, 6, 1, false).translate(0, 0.5, 0)), 0xf2c890, [0, 0.12, 0], 0, [0.18, 0.36, 0.18]);
  b.add(cone(6), 0x5a5468, [0, 0.13, 0], [PI, 0, 0], [0.05, 0.15, 0.05]);
  b.add(K('pencilHex', () => G.cylinderGeo(1, 1, 1, 6, 1, true).translate(0, 0.5, 0)), pc, [0, 0.48, 0], 0, [0.18, 1.55, 0.18], { cf: (x, y, z, nx, ny, nz) => { const a = Math.atan2(nx, nz); const k = 1.0 + 0.06 * Math.cos(6 * a); return [k, k, k]; } });
  b.add(cyl(12), 0xd8dce8, [0, 2.03, 0], 0, [0.175, 0.18, 0.175]);
  for (const y of [2.06, 2.15]) b.add(cyl(12, 1, false), 0xb8bcd0, [0, y, 0], 0, [0.18, 0.025, 0.18]);
  b.add(latheD([[0, 2.2], [0.17, 2.2], [0.17, 2.34], [0.12, 2.4], [0, 2.41]], 12), 0xff9eb8);
  b.pop();
});

// ======================= moon =======================
def('moon', 'moonFlower', { h: 0.8, r: 0.32, col: 0, color: true, wind: 0.04 }, (b, c) => {
  const fc = col(c.color || c.pick([0xeee6ff, 0xdcd0ff, 0xd0f0ff, 0xffe6f6]));
  const pts = stemPts(0.6, 0.04, 0.06, 5);
  b.add(tubeGeo(pts, 0.024, 5, { capStart: false }), 0x6fc0a0);
  b.add(leafS, 0x7cc8a8, [0.01, 0.12, 0], [0, 1.0, 0], 0.26);
  b.add(leafS, 0x6fbf9a, [0.02, 0.22, 0.01], [0, -2.2, 0], 0.24);
  const top = pts[4];
  b.push(top, [-(PI / 2) + 0.45, 0, 0]);
  const pet = puffy('moonPet', () => roundStarOutline(6, 0.5, 0.2, 30, 0.9), 0.12, 2);
  b.add(hemi(8, 3), 0x6fc0a0, [0, 0, -0.03], [-PI / 2, 0, 0], [0.08, 0.06, 0.08]);
  b.add(pet, fc, [0, 0, 0], 0, [0.5, 0.5, 0.6], { cf: (x, y) => { const k = 0.82 + 0.28 * smoothstep(0, 0.45, Math.hypot(x, y)); return [k, k, k]; } });
  b.add(puffy('moonPet1', () => roundStarOutline(6, 0.5, 0.2, 30, 0.9), 0.12, 1), lit(fc, 0.5), [0, 0, 0.04], [0, 0, PI / 6], [0.3, 0.3, 0.6]);
  b.gl(ico(1), 0xfff3b0, [0, 0, 0.07], 0, 0.065);
  b.ha([0, 0, 0.07], 0.28, [1, 0.95, 0.6], 0.24);
  b.pop();
});
def('moon', 'crystalTree', { h: 3.0, r: 1.0, col: 0.2, color: true }, (b, c) => {
  const cc = col(c.color || c.pick([0x9fe8ff, 0xd0b0ff, 0xffb0e0, 0xa8ffe0]));
  const tc = 0xdcd6f2;
  b.add(tubeGeo([[0, 0, 0], [0.05, 0.5, 0], [0.02, 1.0, 0.03], [-0.02, 1.5, 0]], (t) => lerp(0.2, 0.11, t) * (1 + 0.35 * Math.pow(1 - t, 6)), 7, { capStart: false }), tc, null, null, null, { cf: shadeY(0.88, 1.05) });
  const r = new RNG(c.v + 4);
  const ends = [[0.6, 2.3, 0.1], [-0.55, 2.2, 0.25], [-0.1, 2.25, -0.55], [0.05, 2.62, 0.05]];
  for (const e of ends) {
    const s = [-0.02, 1.4, 0];
    const m = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2 - 0.1, (s[2] + e[2]) / 2];
    b.add(tubeGeo([s, m, e], [0.1, 0.075, 0.055], 6, { round: true }), tc);
  }
  ends.forEach((e, i) => {
    for (let k = 0; k < 4; k++) {
      const yaw = (k / 4) * TAU + r.next(), tilt = k === 0 ? 0.1 : 0.75;
      const h = k === 0 ? 0.46 : r.range(0.24, 0.34), rr = k === 0 ? 0.11 : 0.08;
      const cc2 = mixc(cc, lit(cc, 0.5), (i + k) % 2 ? 0.5 : 0);
      b.push(e, [tilt, yaw, 0]);
      b.gl(facetShade(prismBody(6, 0.85), cc2, 0.7, 1.05), [1, 1, 1], null, null, [rr, h, rr]);
      b.gl(facetShade(prismTip(6, 0.85), lit(cc2, 0.4), 0.8, 1.1), [1, 1, 1], [0, h, 0], null, [rr, rr * 2.3, rr]);
      b.pop();
    }
  });
  b.ha([0, 2.35, 0], [1.1, 0.75, 1.1], cc, 0.2);
  b.add(lumpGeo(c.v + 7, { ws: 10, hs: 6, lobes: 5, amp: 0.25, flat: 0.1 }), 0xd8d0f0, [0, 0, 0], 0, [0.42, 0.15, 0.42]);
});
def('moon', 'starLamp', { h: 2.3, r: 0.3, col: 0.12 }, (b, c) => {
  const pc = 0xdcd6f2;
  b.add(latheD([[0, 0], [0.2, 0], [0.22, 0.05], [0.12, 0.12], [0.07, 0.25], [0, 0.25]], 12), pc);
  b.add(cyl(8, 0.7), pc, [0, 0.2, 0], 0, [0.055, 1.5, 0.055]);
  for (const y of [0.5, 1.2]) b.add(tor(0.35, 4, 12), lit(pc, 0.3), [0, y, 0], [PI / 2, 0, 0], 0.058);
  b.add(latheD([[0, 1.65], [0.04, 1.65], [0.13, 1.76], [0.12, 1.79], [0, 1.74]], 10), lit(pc, 0.2));
  const sc = c.pick([0xfff09a, 0xffe0f0, 0xd8f4ff, 0xfff6c8]);
  b.gl(starP, sc, [0, 2.02, 0], [0, 0, 0.1 * (c.v - 1.5)], [0.5, 0.5, 0.55], { cf: (x, y, z) => { const k = 0.88 + 0.22 * smoothstep(-0.1, 0.1, z); return [k, k, k]; } });
  b.ha([0, 2.02, 0], 0.55, sc, 0.26);
});
def('moon', 'archway', { h: 3.2, r: 1.45, col: 0, dir: true }, (b, c) => {
  const pc = col(0xece8fa), R = 1.15, y0 = 1.75;
  for (const sd of [-1, 1]) {
    b.add(latheD([[0, 0], [0.24, 0], [0.24, 0.12], [0.17, 0.18], [0.15, y0 - 0.15], [0.21, y0 - 0.08], [0.21, y0], [0, y0]], 12, (a, y) => (y > 0.2 && y < y0 - 0.2 ? 1 - 0.06 * Math.pow(1 - Math.abs(Math.cos(4 * a)), 2) : 1)), pc, [sd * R, 0, 0], null, null, { cf: shadeY(0.9, 1.04) });
  }
  const arc = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * PI; arc.push([Math.cos(a) * R, y0 + Math.sin(a) * R, 0]); }
  b.add(tubeGeo(arc, 0.13, 8), pc);
  const cres = K('crescent2', () => G.extrudeGeo(crescentOutline(0.5, 0.42, 0.22, 16), 0.14));
  b.gl(cres, 0xfff0a0, [0, y0 + R + 0.42, 0], [0, 0, 0.5], 0.62, { cf: (x, y, z, nx, ny, nz) => { const k = Math.abs(nz) > 0.9 ? 1.0 : 0.8; return [k, k, k]; } });
  b.ha([0, y0 + R + 0.4, 0], 0.52, [1, 0.95, 0.6], 0.22);
  for (const [a, s] of [[0.45, 0.22], [2.69, 0.22], [1.15, 0.15], [1.99, 0.15]]) {
    b.gl(starS, 0xfff6c8, [Math.cos(a) * (R + 0.22), y0 + Math.sin(a) * (R + 0.22), 0.05], [0, 0, a], [s, s, 0.4]);
  }
});
def('moon', 'whiteRose', { h: 0.72, r: 0.3, col: 0, color: true, wind: 0.04 }, (b, c) => {
  const rc = col(c.color || c.pick([0xfffaf6, 0xfff0f6, 0xf6f0ff, 0xfff6e8]));
  const cup = (key, rad, h, lobes, phase) => K(key, () => latheD([[0, 0], [rad * 0.6, h * 0.1], [rad * 0.95, h * 0.45], [rad, h * 0.8], [rad * 0.93, h], [rad * 0.85, h * 0.97]], 10,
    (a) => 1 + 0.12 * Math.cos(lobes * a + phase), (a, y) => (y > h * 0.7 ? y + 0.012 * Math.cos(lobes * a + phase) : y)));
  const rose = (p, s) => {
    b.push(p, [0.15, 0, 0], s);
    b.add(cup('rose1', 0.11, 0.1, 5, 0), rc, [0, 0, 0], 0, 1, { cf: shadeY(0.86, 1.05) });
    b.add(cup('rose2', 0.07, 0.11, 4, 1), mixc(rc, 0xffd0e0, 0.3), [0, 0.0, 0], [0, 0.6, 0], 1);
    b.add(sph(7, 5), mixc(rc, 0xffb8d0, 0.5), [0, 0.075, 0], 0, [0.035, 0.04, 0.035]);
    b.add(hemi(8, 2), 0x6fbf7a, [0, 0.014, 0], [PI, 0, 0], [0.065, 0.032, 0.065]);
    b.pop();
  };
  const st = stemPts(0.56, 0.03, 0.05, 5);
  b.add(tubeGeo(st, 0.018, 4, { capStart: false }), 0x5fae6a);
  rose(st[4], 1.45);
  if (c.v !== 0) { const s2 = stemPts(0.38, -0.08, -0.04, 4); b.add(tubeGeo(s2, 0.015, 4, { capStart: false }), 0x5fae6a); rose(s2[3], 1.1); }
  if (c.v === 3) { b.add(tubeGeo([[0.02, 0, 0], [0.1, 0.18, 0.08], [0.12, 0.3, 0.1]], 0.012, 4, { capStart: false }), 0x5fae6a); b.add(sph(7, 5), mixc(rc, 0xffc0d8, 0.3), [0.12, 0.33, 0.1], 0, [0.04, 0.055, 0.04]); }
  for (const [y, a] of [[0.15, 0.4], [0.28, 2.5], [0.4, -1.4]]) b.add(leafS, 0x6fbf7a, [0.01, y, 0.01], [0, a, 0], 0.16);
});
def('moon', 'cloudPillar', { h: 4.05, r: 0.8, col: 0.45 }, (b, c) => {
  const pc = col(c.pick([0xf2eeff, 0xfff4fa, 0xeef6ff, 0xf6f0ff]));
  b.add(latheD([[0, 0.25], [0.36, 0.25], [0.34, 2.0], [0.32, 3.4], [0, 3.4]], 24, (a, y) => 1 - 0.07 * Math.pow(1 - Math.abs(Math.cos(6 * a)), 2)), pc, [0, 0, 0], 0, 1, { cf: shadeY(0.88, 1.04) });
  b.add(latheD([[0, 3.3], [0.4, 3.32], [0.46, 3.42], [0.5, 3.5], [0, 3.5]], 14), lit(pc, 0.2));
  const shade = (x, y) => mixc([0.86, 0.86, 1.0], [1, 1, 1], smoothstep(-0.9, 0.5, y));
  const r = c.rng;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + r.next() * 0.4; const s = r.range(0.32, 0.42); b.add(sph(9, 6), 0xffffff, [Math.sin(a) * 0.42, 0.2, Math.cos(a) * 0.42], 0, [s, s * 0.82, s], { cf: shade }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + r.next() * 0.5; const s = r.range(0.3, 0.38); b.add(sph(9, 6), 0xffffff, [Math.sin(a) * 0.38, 3.62 + r.range(-0.05, 0.08), Math.cos(a) * 0.38], 0, [s, s * 0.8, s], { cf: shade }); }
  b.add(sph(10, 7), 0xffffff, [0, 3.78, 0], 0, [0.38, 0.28, 0.38], { cf: shade });
});
def('moon', 'floatLantern', { h: 0.62, r: 0.22, col: 0, color: true }, (b, c) => {
  const lc = col(c.color || c.pick([0xffd27a, 0xffb0a0, 0xffe6a0, 0xf8b8ff]));
  b.add(tubeGeo([[0, 0.0, 0], [0, 0.1, 0]], [0.008, 0.02], 4, { round: true }), 0xff7f7f);
  b.add(cyl(10), 0xd8604a, [0, 0.1, 0], 0, [0.09, 0.04, 0.09]);
  b.gl(latheD([[0, 0.12], [0.12, 0.13], [0.19, 0.24], [0.2, 0.34], [0.17, 0.46], [0.1, 0.53], [0, 0.54]], 14, (a) => 1 - 0.05 * Math.pow(1 - Math.abs(Math.cos(4 * a)), 2)), [1, 1, 1], null, null, null,
    { cf: (x, y) => { const t = smoothstep(0.12, 0.54, y); return mixc(lit(lc, 0.35), lc, t); } });
  b.add(cyl(10), 0xd8604a, [0, 0.52, 0], 0, [0.08, 0.04, 0.08]);
  b.add(tor(0.3, 4, 10), 0xd8604a, [0, 0.6, 0], 0, 0.04);
  b.ha([0, 0.33, 0], [0.44, 0.46, 0.44], lc, 0.28);
});

// ---------------------------------------------------------------- bake / cache
const _baked = new Map();
function aoTint(g, h) {
  const p = g.attributes.position.array, c = g.attributes.color.array;
  for (let i = 0; i < p.length / 3; i++) {
    const s = smoothstep(-0.02, h, p[i * 3 + 1]);
    c[i * 3] *= lerp(0.8, 1, s); c[i * 3 + 1] *= lerp(0.77, 1, s); c[i * 3 + 2] *= lerp(0.9, 1, s);
  }
  g.markDirty('color');
}
function bake(type, v, color) {
  const d = D[type];
  const key = type + '|' + v + '|' + (color == null ? '' : col(color).map((x) => x.toFixed(3)).join(','));
  let e = _baked.get(key);
  if (e) return e;
  const b = new PB();
  const ctx = { v, rng: new RNG((hstr(type) + v * 7919) >>> 0), color: color == null ? null : col(color), pick: (a) => a[v % a.length] };
  d.build(b, ctx);
  e = { solid: null, glow: null, halo: null, tris: 0 };
  if (b.S.length) { e.solid = G.mergeGeometries(b.S); if (d.ao !== 0) aoTint(e.solid, d.ao ?? 0.32); }
  if (b.Gl.length) e.glow = G.mergeGeometries(b.Gl);
  if (b.H.length) e.halo = G.mergeGeometries(b.H);
  let maxY = 0, maxR = 0;
  for (const g of [e.solid, e.glow]) {
    if (!g) continue;
    e.tris += g.index.length / 3;
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { maxY = Math.max(maxY, p[i + 1]); maxR = Math.max(maxR, Math.hypot(p[i], p[i + 2])); }
  }
  if (e.halo) e.tris += e.halo.index.length / 3;
  e.height = maxY; e.radius = maxR;
  _baked.set(key, e);
  return e;
}
const variantOf = (seed) => (seed === undefined || seed === null ? 0 : (((Math.floor(seed) % 4) + 4) % 4));
function jitter(type, opts) {
  const d = D[type];
  const s0 = opts.s ?? 1;
  if (opts.seed === undefined || opts.seed === null) return { s: s0, yaw: 0 };
  const r = new RNG(((Math.floor(opts.seed) * 2654435761) ^ hstr(type)) >>> 0);
  r.next();
  const s = s0 * (1 + (r.next() - 0.5) * 0.16);
  const yaw = d.dir ? (r.next() - 0.5) * 0.24 : r.next() * TAU;
  return { s, yaw };
}

// ---------------------------------------------------------------- materials
const SOLID = { vertexColors: true, spec: 0.1, rim: 0.32 };
export function propMaterial(kind = 'solid', wind = 0) {
  if (kind === 'glow') return mat(0xffffff, { vertexColors: true, unlit: true, rim: 0 });
  if (kind === 'halo') return softGlowMaterial(0xffffff, { vertexColors: true });
  return mat(0xffffff, wind ? { ...SOLID, wind } : SOLID);
}

// ---------------------------------------------------------------- public API
export const PROP_TYPES = {};
export const PROP_INFO = {};
for (const t in D) {
  const d = D[t];
  (PROP_TYPES[d.theme] || (PROP_TYPES[d.theme] = [])).push(t);
  PROP_INFO[t] = { theme: d.theme, h: d.h, r: d.r, col: d.col ?? 0, wind: d.wind || 0, color: !!d.color, dir: !!d.dir };
}

export function propParts(type, opts = {}) {
  if (!D[type]) { console.warn('propParts: unknown prop type ' + type); return []; }
  const d = D[type];
  const e = bake(type, variantOf(opts.seed), d.color ? opts.color : undefined);
  const j = jitter(type, opts);
  const ident = j.s === 1 && j.yaw === 0;
  const m = () => (ident ? null : G.trs(0, 0, 0, 0, j.yaw, 0, j.s, j.s, j.s));
  const out = [];
  if (e.solid) out.push({ geo: e.solid, matrix: m(), color: [1, 1, 1], kind: 'solid', wind: d.wind || 0 });
  if (e.glow) out.push({ geo: e.glow, matrix: m(), color: [1, 1, 1], kind: 'glow' });
  if (e.halo) out.push({ geo: e.halo, matrix: m(), color: [1, 1, 1], kind: 'glow', halo: true });
  return out;
}

export function buildProp(type, opts = {}) {
  if (!D[type]) { console.warn('buildProp: unknown prop type ' + type); type = 'rock'; }
  const d = D[type];
  const e = bake(type, variantOf(opts.seed), d.color ? opts.color : undefined);
  const j = jitter(type, opts);
  const root = new Node('prop-' + type);
  const inner = new Node('inner');
  inner.scale.set(j.s, j.s, j.s);
  inner.rotation.y = j.yaw;
  root.add(inner);
  if (e.solid) inner.add(new Mesh(e.solid, propMaterial('solid', d.wind || 0), 'solid'));
  if (e.glow) inner.add(new Mesh(e.glow, propMaterial('glow'), 'glow'));
  if (e.halo) inner.add(new Mesh(e.halo, propMaterial('halo'), 'halo'));
  root.userData.prop = { type, height: e.height * j.s, radius: e.radius * j.s, col: (d.col ?? 0) * j.s, tris: e.tris };
  return root;
}
export function propStats(type, seed) { const d = D[type]; const e = bake(type, variantOf(seed), undefined); return { tris: e.tris, height: e.height, radius: e.radius, theme: d.theme }; }

// ---------------------------------------------------------------- instancing geometries
// bend normals toward +Y so thin foliage is lit like the ground it grows from (no dark backsides)
function upNormals(g, k = 0.35) {
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i] * k, y = n[i + 1] * k + 1, z = n[i + 2] * k, l = Math.hypot(x, y, z) || 1;
    n[i] = x / l; n[i + 1] = y / l; n[i + 2] = z / l;
  }
  g.markDirty('normal');
  return g;
}
// grass tuft (variants 0..3), vertex colored darker base -> light tips, origin at base, ~0.2-0.36 tall
export function grassGeo(variant = 0) {
  const v = ((variant % 4) + 4) % 4;
  return K('grassI3_' + v, () => {
    const blade = leafGeo(1, 0.24, { segs: 3, across: 1, lift: 1.32, bend: 0.75, thick: 0.4, fold: 0.3,
      cf: (t, u, side) => mixc(col(0x78c860), col(0xd6f59a), Math.pow(t, 0.7)) });
    const r = new RNG(v * 97 + 3);
    const n = [5, 6, 4, 6][v], hh = [0.26, 0.36, 0.2, 0.3][v];
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r.range(-0.35, 0.35), L = hh * r.range(0.75, 1.15);
      items.push({ geo: blade, matrix: mk([Math.sin(a) * 0.035, 0, Math.cos(a) * 0.035], [0, a, 0], L), color: mixc([1, 1, 1], [0.9, 1, 0.85], r.next()) });
    }
    if (v === 3) items.push({ geo: G.puffyShapeGeo(G.flowerOutline(5, 0.5, 0.2, 15), 0.12, 1), matrix: mk([0.02, 0.27, 0.01], [-PI / 2 + 0.3, 0, 0], 0.08), color: [1, 1, 1] });
    return upNormals(G.mergeGeometries(items), 0.3);
  });
}
// small flower (variants: 0 daisy white/yellow, 1 pink 5-petal, 2 yellow buttercup, 3 lavender bells), origin at base, ~0.25 tall
export function flowerGeo(variant = 0) {
  const v = ((variant % 4) + 4) % 4;
  return K('flowerI3_' + v, () => {
    const foliage = [], heads = [];
    const h = [0.22, 0.2, 0.18, 0.24][v];
    const top = [0.02, h, 0.025];
    foliage.push({ geo: tubeGeo([[0, 0, 0], [0.008, h * 0.55, 0.005], top], 0.014, 4, { capStart: false }), matrix: null, color: col(0x5cb35e) });
    const lf = leafGeo(1, 0.5, { segs: 3, across: 1, lift: 0.55, bend: 0.8 });
    foliage.push({ geo: lf, matrix: mk([0, 0.02, 0], [0, 0.6 * v + 0.5, 0], 0.11), color: col(0x7ccf68) });
    foliage.push({ geo: lf, matrix: mk([0, 0.02, 0], [0, 0.6 * v + 3.4, 0], 0.09), color: col(0x8ad870) });
    if (v === 3) {
      const bell = G.latheGeo([[0, 0.05], [0.03, 0.045], [0.048, 0.02], [0.06, -0.015], [0.055, -0.025]], 8);
      heads.push({ geo: bell, matrix: mk(top, [0.45, 0, 0], 1.15), color: col(0xc8b0ff) });
      heads.push({ geo: bell, matrix: mk([top[0] - 0.05, top[1] - 0.05, top[2]], [0.5, 1.8, 0], 0.9), color: col(0xd8c4ff) });
      heads.push({ geo: G.sphereGeo(1, 6, 4), matrix: mk([top[0], top[1] - 0.012, top[2] + 0.01], 0, 0.016), color: col(0xfff6a0) });
    } else {
      const pc = [0xffffff, 0xff9ec8, 0xffe066][v], cc = [0xffd84d, 0xfff2a0, 0xffb84d][v];
      const pet = v === 0 ? G.puffyShapeGeo(G.flowerOutline(9, 0.5, 0.12, 27), 0.07, 1) : G.puffyShapeGeo(G.flowerOutline(5, 0.5, 0.2, 20), 0.13, 1);
      heads.push({ geo: pet, matrix: mk(top, [-(PI / 2) + 0.65, 0, 0], v === 0 ? 0.17 : 0.16), color: col(pc) });
      heads.push({ geo: G.sphereGeo(1, 6, 3, 0, TAU, 0, PI / 2), matrix: mk([top[0], top[1] + 0.01, top[2] + 0.01], [0.65, 0, 0], [0.03, 0.017, 0.03]), color: col(cc) });
    }
    return G.mergeGeometries([{ geo: upNormals(G.mergeGeometries(foliage), 0.35) }, { geo: G.mergeGeometries(heads) }]);
  });
}

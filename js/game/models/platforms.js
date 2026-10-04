// ============================================================================
// models/platforms.js — level platforms
//
//   buildPlatform(style, w, d, h = 0.6, opts) -> Node
//     origin at TOP center: walkable top surface is flat at y = 0, body extends down to y = -h,
//     footprint w (X) by d (Z). opts.round -> elliptic footprint; opts.color -> main color override;
//     opts.seed -> decoration variation; opts.stem (mushroom/lily: stem length below the body, default ~1.2).
//     Purely decorative bits (cloud puffs, icicles, crystal spikes, stems) may hang below -h or bulge a few cm
//     above the rim, never over the walkable top.
//   buildRainbowSegment(len) -> Node   1.4 wide (X), length along Z centered on origin, flat top at y = 0
//   buildCloudPad()          -> Node   1.6 Ø fluffy cloud, top at y = 0
//   PLATFORM_STYLES          -> list of styles
// Geometry is cached per (style, size, options) and shared between instances.
// ============================================================================
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { TAU, PI, lerp, clamp, smoothstep, RNG } from '../../engine/math.js';
import { SOFT, GLOSS } from './common.js';
import { tubeGeo, prismBody, prismTip, gearOutline, softGlowMaterial, col, mixc, lit, dim, mk, sph, ico } from './props.js';

export const PLATFORM_STYLES = ['cloud', 'leaf', 'wood', 'ice', 'gear', 'biscuit', 'bubble', 'stone', 'candy', 'crystal', 'lily', 'mushroom', 'moon'];

// ---------------------------------------------------------------- outlines (XZ plane, [x, z])
function rrectOutline(w, d, r, seg = 5) {
  r = Math.max(0.01, Math.min(r, w / 2 - 0.005, d / 2 - 0.005));
  const out = [];
  const cs = [[w / 2 - r, d / 2 - r, 0], [-(w / 2 - r), d / 2 - r, PI / 2], [-(w / 2 - r), -(d / 2 - r), PI], [w / 2 - r, -(d / 2 - r), 1.5 * PI]];
  for (const [cx, cz, a0] of cs) for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * (PI / 2); out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return subdivide(out, 0.45);
}
function ellipseOutline(w, d, n = 0) {
  if (!n) n = clamp(Math.round((PI * (w + d) / 2) / 0.22), 24, 72);
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([Math.cos(a) * w / 2, Math.sin(a) * d / 2]); }
  return out;
}
function subdivide(ol, maxLen) {
  const out = [];
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i], b = ol[(i + 1) % ol.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / maxLen));
    for (let k = 0; k < n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  return out;
}
function perimeter(ol) { let L = 0; for (let i = 0; i < ol.length; i++) { const a = ol[i], b = ol[(i + 1) % ol.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }
// evenly resample closed outline into n points (returns [{p:[x,z], n:[nx,nz]}])
function resample(ol, n) {
  const segs = [], cum = [0];
  for (let i = 0; i < ol.length; i++) { const a = ol[i], b = ol[(i + 1) % ol.length]; segs.push([a, b]); cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[cum.length - 1], out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * L;
    while (j < segs.length - 1 && cum[j + 1] < s) j++;
    const [a, b] = segs[j], t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    out.push({ p: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], n: [tz / l, -tx / l] });
  }
  // make normals outward
  const c = centroid(ol);
  for (const q of out) if (q.n[0] * (q.p[0] - c[0]) + q.n[1] * (q.p[1] - c[1]) < 0) { q.n[0] = -q.n[0]; q.n[1] = -q.n[1]; }
  return out;
}
function centroid(ol) { let x = 0, z = 0; for (const p of ol) { x += p[0]; z += p[1]; } return [x / ol.length, z / ol.length]; }
function outwardNormals(ol) {
  const n = ol.length, c = centroid(ol);
  return ol.map((p, i) => {
    const a = ol[(i - 1 + n) % n], b = ol[(i + 1) % n];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let nx = tz, nz = -tx;
    if (nx * (p[0] - c[0]) + nz * (p[1] - c[1]) < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  });
}
function insetOutline(ol, d) { const N = outwardNormals(ol); return ol.map((p, i) => [p[0] - N[i][0] * d, p[1] - N[i][1] * d]); }

// flat band following an outline (decal on top surfaces), between insets a and b, at height y
function outlineStrip(ol, a, b, y) {
  const N = outwardNormals(ol), n = ol.length, pos = [], nr = [], idx = [];
  for (let i = 0; i < n; i++) for (const ins of [a, b]) { pos.push(ol[i][0] - N[i][0] * ins, y, ol[i][1] - N[i][1] * ins); nr.push(0, 1, 0); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1); }
  const g = new G.Geometry(); g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setIndex(idx); G.fixWinding(g);
  return g;
}

// ---------------------------------------------------------------- slab: flat top at y=0, down to y=-h
// o: bevel, bevelBottom, steps, grooves:[y..] (side grooves), groove (depth), cf(x,y,z,part)->[r,g,b], flat (faceted)
function slabGeo(ol, h, o = {}) {
  const b = Math.min(o.bevel ?? 0.08, h * 0.45), bb = Math.min(o.bevelBottom ?? b, h * 0.45), steps = o.steps ?? 3;
  const n = ol.length, N = outwardNormals(ol), c = centroid(ol);
  const rings = [];
  for (let k = 0; k <= steps; k++) { const a = (k / steps) * (PI / 2); rings.push([b * (1 - Math.sin(a)), -b * (1 - Math.cos(a))]); }
  const gr = (o.grooves || []).filter((y) => y < -b - 0.04 && y > -(h - bb) + 0.04).sort((p, q) => q - p);
  const gd = o.groove ?? 0.03;
  for (const y of gr) rings.push([0, y + 0.02], [gd, y], [0, y - 0.02]);
  for (let k = 0; k <= steps; k++) { const a = (k / steps) * (PI / 2); rings.push([bb * (1 - Math.cos(a)), -(h - bb) - bb * Math.sin(a)]); }
  const cf = o.cf || (() => [1, 1, 1]);
  const mkGeo = (pos, nr, idx, part) => {
    const g = new G.Geometry();
    g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setIndex(idx);
    G.fixWinding(g);
    let out = g;
    if (part === 'side' && !o.flat) out.computeVertexNormals();
    if (o.flat) out = out.toFlat();
    out.colorBy((x, y, z) => cf(x, y, z, part));
    return out;
  };
  // side
  const sp = [], sn = [], si = [];
  rings.forEach(([ins, y]) => { for (let i = 0; i < n; i++) { sp.push(ol[i][0] - N[i][0] * ins, y, ol[i][1] - N[i][1] * ins); sn.push(N[i][0], 0, N[i][1]); } });
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n, a = r * n + i, bq = r * n + i2, cq = (r + 1) * n + i2, dq = (r + 1) * n + i;
    si.push(a, bq, cq, a, cq, dq);
  }
  const side = mkGeo(sp, sn, si, 'side');
  // caps
  const cap = (ins, y, up) => {
    const pos = [c[0], y, c[1]], nr = [0, up ? 1 : -1, 0], idx = [];
    for (let i = 0; i < n; i++) { pos.push(ol[i][0] - N[i][0] * ins, y, ol[i][1] - N[i][1] * ins); nr.push(0, up ? 1 : -1, 0); }
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
    return mkGeo(pos, nr, idx, up ? 'top' : 'bottom');
  };
  const top = cap(rings[0][0], 0, true), bot = cap(rings[rings.length - 1][0], -h, false);
  return G.mergeGeometries([{ geo: top }, { geo: side }, { geo: bot }]);
}

// ---------------------------------------------------------------- helpers
const m4 = (p, r, s) => mk(p, r, s);
const item = (geo, m, c) => ({ geo: typeof geo === 'function' ? geo() : geo, matrix: m || null, color: col(c ?? 0xffffff) });
const VC = (o = {}) => new Material({ color: 0xffffff, vertexColors: true, ...SOFT, ...o });
function tintY(g, lo, hi, y0, y1) {
  lo = col(lo); hi = col(hi);
  const p = g.attributes.position.array, c = g.attributes.color.array;
  for (let i = 0; i < p.length / 3; i++) {
    const t = smoothstep(y0, y1, p[i * 3 + 1]);
    c[i * 3] *= lerp(lo[0], hi[0], t); c[i * 3 + 1] *= lerp(lo[1], hi[1], t); c[i * 3 + 2] *= lerp(lo[2], hi[2], t);
  }
  g.markDirty('color');
  return g;
}
const baseOutline = (w, d, round, r = 0.3) => (round ? ellipseOutline(w, d) : rrectOutline(w, d, Math.min(r, w * 0.3, d * 0.3)));

// ---------------------------------------------------------------- styles
const S = {};

S.cloud = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 3);
  const rp = clamp(0.12 * Math.sqrt(w * d) + 0.16, 0.24, 0.55);
  const ol = baseOutline(w - rp * 1.1, d - rp * 1.1, o.round, Math.min(w, d) * 0.35);
  const items = [item(slabGeo(ol, h * 0.85, { bevel: Math.min(0.2, h * 0.3) }), null, 0xffffff)];
  const P = perimeter(ol), n = Math.max(8, Math.round(P / (rp * 1.2)));
  for (const q of resample(ol, n)) {
    const s = rp * r.range(0.9, 1.12);
    items.push(item(ico(1), m4([q.p[0] + q.n[0] * rp * 0.1, 0.04 - s * 0.82, q.p[1] + q.n[1] * rp * 0.1], [0, r.next() * 6, 0], [s, s * 0.82, s])));
  }
  const n2 = Math.max(6, Math.round(n * 0.5));
  for (const q of resample(ol, n2)) {
    const s = rp * r.range(1.0, 1.25);
    items.push(item(ico(1), m4([q.p[0] - q.n[0] * rp * 0.2, -h * 0.75, q.p[1] - q.n[1] * rp * 0.2], [0, r.next() * 6, 0], [s, s * 0.8, s])));
  }
  const nb = clamp(Math.round((w * d) / 2.5), 1, 6);
  for (let i = 0; i < nb; i++) {
    const s = Math.min(w, d) * r.range(0.22, 0.32);
    items.push(item(sph(10, 7), m4([r.range(-w * 0.25, w * 0.25), -h - s * 0.15, r.range(-d * 0.25, d * 0.25)], 0, [s, s * 0.55, s])));
  }
  const g = tintY(G.mergeGeometries(items), [0.84, 0.85, 1.0], [1, 1, 1], -h - 0.4, -0.05);
  return [{ geo: g, mat: VC({ rim: 0.45, spec: 0.05 }) }];
};

S.leaf = (w, d, h, o) => {
  const L = Math.max(w, d), Wd = Math.min(w, d), alongX = w > d;
  const th = Math.min(h, 0.22);
  const ol = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    // right side base->tip, left side tip->base
    const s = i < n / 2 ? i / (n / 2) : 1 - (i - n / 2) / (n / 2);
    const sd = i < n / 2 ? 1 : -1;
    const x = (Wd / 2) * Math.pow(Math.sin(PI * s), 0.55) * Math.pow(1 - s, 0.38) / 0.77;
    ol.push([sd * Math.min(Wd / 2, x), lerp(-L / 2, L / 2, s)]);
  }
  const lc = col(o.color ?? 0x7fd46e);
  const items = [item(slabGeo(ol, th, { bevel: 0.06, cf: (x, y, z, part) => (part === 'top' ? lit(lc, 0.06) : part === 'bottom' ? dim(lc, 0.75) : mixc(dim(lc, 0.8), lc, smoothstep(-th, 0, y))) }))];
  // midrib + veins
  items.push(item(tubeGeo([[0, 0.0, -L / 2 + 0.1], [0, 0.012, 0], [0, 0.0, L / 2 - 0.25]], [0.07, 0.05, 0.02], 5, { capStart: false }), null, lit(lc, 0.45)));
  const nv = Math.max(3, Math.round(L / 0.55));
  for (let i = 1; i <= nv; i++) {
    const z0 = lerp(-L / 2 + 0.2, L / 2 - 0.4, i / (nv + 1));
    const s = (z0 + L / 2) / L;
    const xw = (Wd / 2) * Math.pow(Math.sin(PI * s), 0.55) * Math.pow(1 - s, 0.38) / 0.77 * 0.82;
    for (const sd of [-1, 1]) items.push(item(tubeGeo([[0, 0.004, z0], [sd * xw * 0.55, 0.006, z0 + xw * 0.3], [sd * xw, 0.0, z0 + xw * 0.55]], [0.03, 0.022, 0.012], 4), null, lit(lc, 0.3)));
  }
  // stem
  const stem = o.stem ?? 0.9;
  if (stem > 0) items.push(item(tubeGeo([[0, -th * 0.5, -L / 2 + 0.15], [0, -th - stem * 0.3, -L / 2 - 0.1], [0, -th - stem, -L / 2 - 0.05]], [0.09, 0.08, 0.07], 6, { round: true }), null, dim(lc, 0.85)));
  let g = G.mergeGeometries(items);
  if (alongX) g = g.applyMatrix(G.trs(0, 0, 0, 0, PI / 2, 0));
  return [{ geo: g, mat: VC({ spec: 0.15 }) }];
};

S.wood = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 5);
  const wc = col(o.color ?? 0xe8ae76);
  const items = [];
  const pw = 0.34, np = Math.max(2, Math.round(d / pw)), ph = Math.min(0.16, h * 0.5);
  for (let i = 0; i < np; i++) {
    const z = -d / 2 + ((i + 0.5) / np) * d, wz = d / np - 0.04;
    let len = w - 0.02;
    if (o.round) len = w * Math.sqrt(Math.max(0.05, 1 - Math.pow(z / (d / 2), 2)));
    const c = mixc(wc, i % 2 ? lit(wc, 0.1) : dim(wc, 0.93), 0.6 + r.next() * 0.4);
    items.push(item(G.roundedBoxGeo(len, ph, wz, Math.min(0.04, wz * 0.3), 1), m4([r.range(-0.03, 0.03), -ph / 2, z]), c));
    for (const sd of [-1, 1]) items.push(item(sph(5, 3), m4([sd * (len / 2 - 0.12), 0.0, z], 0, [0.022, 0.012, 0.022]), 0x8a6a5a));
  }
  const bh = h - ph;
  if (bh > 0.05) {
    const xs = o.round ? [-w * 0.25, w * 0.25] : [-(w / 2 - 0.28), w / 2 - 0.28];
    if (w > 3.2 && !o.round) xs.push(0);
    for (const x of xs) {
      const dl = o.round ? d * Math.sqrt(Math.max(0.05, 1 - Math.pow(x / (w / 2), 2))) - 0.1 : d - 0.1;
      items.push(item(G.roundedBoxGeo(0.24, bh, dl, 0.05, 1), m4([x, -ph - bh / 2, 0]), dim(wc, 0.72)));
    }
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.12 }) }];
};

S.ice = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 7);
  const ic = col(o.color ?? 0xbfeaff);
  const ol = baseOutline(w, d, o.round, 0.3);
  const items = [item(slabGeo(ol, h, { bevel: 0.1, grooves: [-h * 0.45], groove: 0.02, cf: (x, y, z, part) => (part === 'top' ? mixc(ic, [1, 1, 1], 0.35) : part === 'bottom' ? dim(ic, 0.8) : mixc(dim(ic, 0.82), lit(ic, 0.25), smoothstep(-h, 0, y))) }))];
  // frost rim
  const P = perimeter(ol);
  for (const q of resample(ol, Math.max(6, Math.round(P / 0.75)))) {
    if (r.next() < 0.3) continue;
    const s = r.range(0.12, 0.2);
    items.push(item(ico(1), m4([q.p[0] - q.n[0] * 0.05, -0.04, q.p[1] - q.n[1] * 0.05], 0, [s, s * 0.35, s]), 0xffffff));
  }
  // icicles
  for (const q of resample(ol, Math.max(5, Math.round(P / 0.42)))) {
    if (r.next() < 0.25) continue;
    const L = r.range(0.18, 0.5), rr = r.range(0.05, 0.08);
    items.push(item(G.coneGeo(1, 1, 6), m4([q.p[0] - q.n[0] * 0.07, -h + 0.02 - L / 2, q.p[1] - q.n[1] * 0.07], [PI, r.next() * 6, 0], [rr, L, rr]), lit(ic, 0.35)));
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.55, rim: 0.55 }) }];
};

S.gear = (w, d, h, o) => {
  const R = w / 2;
  const gc = col(o.color ?? 0x9fe8c9);
  const teeth = clamp(Math.round(w * 4), 8, 28);
  const ol = gearOutline(teeth, R, R - Math.min(0.24, R * 0.16), 8).map(([x, y]) => [x, y]);
  const items = [item(slabGeo(ol, h, { bevel: 0.035, steps: 1, flat: true, cf: (x, y, z, part) => (part === 'top' ? lit(gc, 0.08) : part === 'bottom' ? dim(gc, 0.7) : dim(gc, 0.88)) }))];
  // top ring + hub (flush decals)
  items.push(item(G.ringGeo(R * 0.62, R * 0.7, 48), m4([0, 0.004, 0]), dim(gc, 0.82)));
  items.push(item(G.circleGeo(R * 0.2, 28), m4([0, 0.005, 0]), lit(gc, 0.45)));
  items.push(item(G.ringGeo(R * 0.2, R * 0.25, 28), m4([0, 0.006, 0]), 0xffcf4d));
  const nh = Math.max(4, Math.min(8, Math.round(R * 3)));
  for (let k = 0; k < nh; k++) { const a = (k / nh) * TAU; items.push(item(G.circleGeo(R * 0.1, 18), m4([Math.cos(a) * R * 0.43, 0.004, Math.sin(a) * R * 0.43]), dim(gc, 0.7))); }
  items.push(item(G.cylinderGeo(R * 0.16, R * 0.16, 0.6, 14, 1, true), m4([0, -h - 0.28, 0]), 0xb8bcd0));
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.3 }) }];
};

S.biscuit = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 11);
  const bc = col(o.color ?? 0xf3c47c);
  let ol = baseOutline(w, d, o.round, 0.22);
  const P = perimeter(ol);
  const ns = Math.max(12, Math.round(P / 0.26));
  const rs = resample(ol, ns * 3);
  ol = rs.map((q, i) => { const k = 0.035 * (0.5 + 0.5 * Math.cos((i / 3) * TAU)); return [q.p[0] - q.n[0] * k, q.p[1] - q.n[1] * k]; });
  const items = [item(slabGeo(ol, h, { bevel: 0.07, steps: 2, cf: (x, y, z, part) => (part === 'top' ? lit(bc, 0.04) : part === 'bottom' ? dim(bc, 0.78) : mixc(dim(bc, 0.85), bc, smoothstep(-h, -0.05, y))) }))];
  // docking holes
  const sx = 0.42, nx = Math.max(1, Math.floor((w - 0.4) / sx)), nz = Math.max(1, Math.floor((d - 0.4) / sx));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = (i - (nx - 1) / 2) * sx, z = (j - (nz - 1) / 2) * sx;
    if (o.round && Math.pow(x / (w / 2 - 0.2), 2) + Math.pow(z / (d / 2 - 0.2), 2) > 1) continue;
    items.push(item(G.circleGeo(0.04, 10), m4([x, 0.003, z]), dim(bc, 0.62)));
  }
  // cracks
  const nc = 2 + (w * d > 6 ? 1 : 0);
  for (let k = 0; k < nc; k++) {
    let x = r.range(-w * 0.3, w * 0.3), z = -d / 2 + 0.05;
    const pts = [[x, 0.004, z]];
    const steps = 6;
    for (let s = 1; s <= steps; s++) { z += (d * r.range(0.45, 0.7)) / steps; x += r.range(-0.25, 0.25); pts.push([x, 0.004, z]); }
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      items.push(item(G.boxGeo(1, 1, 1), m4([(a[0] + b[0]) / 2, 0.003, (a[2] + b[2]) / 2], [0, Math.atan2(b[0] - a[0], b[2] - a[2]), 0], [0.045, 0.006, L + 0.03]), dim(bc, 0.55)));
    }
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.15 }) }];
};

S.bubble = (w, d, h, o) => {
  const bc = col(o.color ?? 0xff9ed2);
  const ol = baseOutline(w, d, o.round, Math.min(0.5, Math.min(w, d) * 0.3));
  const body = slabGeo(ol, h, { bevel: Math.min(0.22, h * 0.4), steps: 4, cf: (x, y, z, part) => (part === 'top' ? lit(bc, 0.12) : mixc(dim(bc, 0.85), bc, smoothstep(-h, 0, y))) });
  const hi = [];
  const r = new RNG(o.seed ?? 2);
  // highlight streak along the top-left rim + inner bubbles
  const q = resample(ol, 24);
  const arc = [];
  for (let i = 9; i <= 14; i++) { const p = q[i]; arc.push([p.p[0] - p.n[0] * 0.12, -0.06, p.p[1] - p.n[1] * 0.12]); }
  hi.push(item(tubeGeo(arc, 0.035, 5, { round: true }), null, 0xffffff));
  for (let i = 0; i < clamp(Math.round(w * d), 3, 10); i++) {
    const s = r.range(0.05, 0.12);
    hi.push(item(sph(8, 6), m4([r.range(-w * 0.35, w * 0.35), r.range(-h * 0.8, -0.15), r.range(-d * 0.35, d * 0.35)], 0, s), 0xffffff));
  }
  return [
    { geo: body, mat: new Material({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, spec: 0.7, rim: 0.7 }), order: 2 },
    { geo: G.mergeGeometries(hi), mat: new Material({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.85, unlit: true }), order: 3 },
  ];
};

S.stone = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 13);
  const sc = col(o.color ?? 0xcfc8e2);
  const ol = baseOutline(w, d, o.round, 0.25);
  const gy = [];
  for (let y = -0.32; y > -h + 0.12; y -= 0.3) gy.push(y);
  const items = [item(slabGeo(ol, h, { bevel: 0.08, grooves: gy, groove: 0.035, cf: (x, y, z, part) => (part === 'top' ? dim(sc, 0.78) : part === 'bottom' ? dim(sc, 0.72) : mixc(dim(sc, 0.82), sc, smoothstep(-h, 0, y))) }))];
  // paving tiles on top (slightly raised, inset)
  const ts = clamp(Math.min(w, d) / 4.5, 0.68, 1.15), nx = Math.max(1, Math.round((w - 0.16) / ts)), nz = Math.max(1, Math.round((d - 0.16) / ts));
  const tw = (w - 0.16) / nx, td = (d - 0.16) / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = -w / 2 + 0.08 + (i + 0.5) * tw, z = -d / 2 + 0.08 + (j + 0.5) * td;
    if (o.round && Math.pow(x / (w / 2 - tw * 0.45), 2) + Math.pow(z / (d / 2 - td * 0.45), 2) > 1) continue;
    items.push(item(G.boxGeo(tw - 0.06, 0.04, td - 0.06), m4([x, -0.008, z]), mixc(sc, lit(sc, 0.25), r.next())));
  }
  // moss tufts at the rim
  const P = perimeter(ol);
  for (const q of resample(ol, Math.max(4, Math.round(P / 0.9)))) {
    if (r.next() < 0.45) continue;
    const s = r.range(0.14, 0.22);
    items.push(item(ico(1), m4([q.p[0] + q.n[0] * 0.03, -0.1, q.p[1] + q.n[1] * 0.03], [0, r.next() * 6, 0], [s, s * 0.7, s * 0.8]), mixc(0x7ccf68, 0x5cb862, r.next())));
    items.push(item(ico(1), m4([q.p[0] + q.n[0] * 0.05, -0.24, q.p[1] + q.n[1] * 0.05], [0, r.next() * 6, 0], [s * 0.55, s * 0.6, s * 0.5]), 0x6cc46a));
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.06 }) }];
};

S.candy = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 17);
  const cc = col(o.color ?? 0xff8fbf);
  const ol = baseOutline(w, d, o.round, 0.3);
  const top = 0.12;
  const items = [];
  // frosting top slab (slightly larger) + striped body below
  items.push(item(slabGeo(ol, top, { bevel: 0.05, bevelBottom: 0.03, cf: (x, y, z, part) => (part === 'top' ? lit(cc, 0.55) : lit(cc, 0.45)) })));
  const body = insetOutline(ol, 0.03);
  const n = body.length, N = outwardNormals(body);
  const P = perimeter(body), stripes = Math.max(8, Math.round(P / 0.32) & ~1);
  const cum = [0];
  for (let i = 0; i < n; i++) { const a = body[i], b = body[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const at = (s) => { s = ((s % P) + P) % P; let j = 0; while (j < n - 1 && cum[j + 1] < s) j++; const a = body[j], b = body[(j + 1) % n], t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(N[j][0], N[(j + 1) % n][0], t), lerp(N[j][1], N[(j + 1) % n][1], t)]; };
  const y0 = -top + 0.01, y1 = -h + 0.05, slant = (y0 - y1) * 0.8;
  for (let k = 0; k < stripes; k++) {
    const pos = [], nr = [], idx = [];
    const sub = 3;
    for (let j = 0; j <= sub; j++) for (const [y, off] of [[y0, 0], [y1, slant]]) {
      const s = ((k + j / sub) / stripes) * P + off;
      const q = at(s);
      pos.push(q[0], y, q[1]); nr.push(q[2], 0, q[3]);
    }
    for (let j = 0; j < sub; j++) { const a = j * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    const g = new G.Geometry(); g.setAttribute('position', pos, 3); g.setAttribute('normal', nr, 3); g.setIndex(idx); G.fixWinding(g);
    items.push(item(g, null, k % 2 ? 0xffffff : cc));
  }
  items.push(item(slabGeo(insetOutline(ol, 0.06), 0.06, { bevel: 0.03 }), m4([0, -h + 0.06, 0]), dim(cc, 0.85)));
  items.push(item(slabGeo(insetOutline(ol, 0.05), Math.max(0.05, h - top - 0.06), { bevel: 0.0, steps: 1 }), m4([0, -top, 0]), dim(cc, 0.7)));
  // frosting drips
  for (const q of resample(ol, Math.max(6, Math.round(perimeter(ol) / 0.45)))) {
    if (r.next() < 0.35) continue;
    const L = r.range(0.08, 0.22);
    items.push(item(tubeGeo([[q.p[0] + q.n[0] * 0.005, -0.05, q.p[1] + q.n[1] * 0.005], [q.p[0] + q.n[0] * 0.01, -0.06 - L, q.p[1] + q.n[1] * 0.01]], [0.06, 0.045], 6, { round: 0.9 }), null, lit(cc, 0.45)));
  }
  // sprinkles
  const sp = [0xff6f8f, 0x7fb8ff, 0xffd84d, 0x7fd88f, 0xb89aff, 0xffffff];
  const ns = Math.min(70, Math.round(w * d * 2.2));
  for (let i = 0; i < ns; i++) {
    const x = r.range(-w / 2 + 0.25, w / 2 - 0.25), z = r.range(-d / 2 + 0.25, d / 2 - 0.25);
    if (o.round && Math.pow(x / (w / 2 - 0.25), 2) + Math.pow(z / (d / 2 - 0.25), 2) > 1) continue;
    items.push(item(G.boxGeo(0.045, 0.025, 0.11), m4([x, 0.008, z], [0, r.next() * PI, 0]), sp[i % sp.length]));
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.25 }) }];
};

S.crystal = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 19);
  const cc = col(o.color ?? 0xc3a6ff);
  const ol = o.round ? ellipseOutline(w, d, 10) : (() => { const c = Math.min(0.35, w * 0.2, d * 0.2); return [[w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c], [-w / 2 + c, -d / 2], [w / 2 - c, -d / 2]]; })();
  const items = [item(slabGeo(ol, h * 0.75, { bevel: 0.08, steps: 1, flat: true, cf: (x, y, z, part) => (part === 'top' ? lit(cc, 0.18) : part === 'bottom' ? dim(cc, 0.7) : mixc(dim(cc, 0.78), lit(cc, 0.1), smoothstep(-h, 0, y))) }))];
  // facet inlay on top
  items.push(item(outlineStrip(ol, 0.2, 0.27, 0.004), null, lit(cc, 0.55)));
  if (Math.min(w, d) > 2.4) items.push(item(outlineStrip(ol.map(([x, z]) => [x * 0.45, z * 0.45]), 0.0, 0.06, 0.005), null, lit(cc, 0.45)));
  // inverted crystal cluster underneath
  const nc = clamp(Math.round(w * d * 1.2), 4, 18);
  for (let i = 0; i < nc; i++) {
    const x = r.range(-w * 0.38, w * 0.38), z = r.range(-d * 0.38, d * 0.38);
    const L = r.range(0.35, 0.9) * (1 - 0.5 * Math.hypot(x / w, z / d)), rr = r.range(0.1, 0.18);
    const yaw = r.next() * TAU, tilt = r.range(-0.2, 0.2);
    items.push(item(prismBody(6, 0.8), m4([x, -h * 0.7, z], [PI + tilt, yaw, 0], [rr, L * 0.4, rr]), dim(cc, 0.92)));
    const M = G.trs(x, -h * 0.7, z, PI + tilt, yaw, 0, 1, 1, 1);
    const tipM = new Float32Array(16);
    mulInto(tipM, M, G.trs(0, L * 0.4, 0, 0, 0, 0, rr, L * 0.6, rr));
    items.push(item(prismTip(6, 0.8), tipM, lit(cc, 0.3)));
  }
  // small crystals sprouting on the rim
  for (const q of resample(ol, Math.max(4, Math.round(perimeter(ol) / 1.1)))) {
    const L = r.range(0.25, 0.42), rr = 0.08;
    const M = G.trs(q.p[0] - q.n[0] * 0.05, -h * 0.6, q.p[1] - q.n[1] * 0.05, 2.5, Math.atan2(q.n[0], q.n[1]), 0, 1, 1, 1);
    const b = new Float32Array(16), t = new Float32Array(16);
    mulInto(b, M, G.trs(0, 0, 0, 0, 0, 0, rr, L * 0.5, rr)); mulInto(t, M, G.trs(0, L * 0.5, 0, 0, 0, 0, rr, L * 0.5, rr));
    items.push(item(prismBody(6, 0.8), b, cc), item(prismTip(6, 0.8), t, lit(cc, 0.45)));
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.55, rim: 0.5, emissive: dim(cc, 0.08) }) }];
};
function mulInto(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

S.lily = (w, d, h, o) => {
  const lc = col(o.color ?? 0x6fcf73);
  const th = Math.min(h, 0.16);
  const n = 48, notch = 0.32;
  const ol = [];
  for (let i = 0; i < n; i++) {
    const a = notch / 2 + (i / (n - 1)) * (TAU - notch);
    ol.push([Math.sin(a) * w / 2, Math.cos(a) * d / 2]);
  }
  ol.push([0, -0.0 + d * 0.06]);
  const items = [item(slabGeo(ol, th, { bevel: 0.05, steps: 2, cf: (x, y, z, part) => {
    if (part !== 'top') return part === 'bottom' ? dim(lc, 0.7) : mixc(dim(lc, 0.75), lit(lc, 0.1), smoothstep(-th, 0, y));
    const rr = Math.hypot(x / (w / 2), z / (d / 2));
    return mixc(lit(lc, 0.25), lc, smoothstep(0.0, 0.9, rr));
  } }))];
  // raised rim + veins
  const rim = [];
  for (let i = 0; i < n; i++) { const a = notch / 2 + (i / (n - 1)) * (TAU - notch); rim.push([Math.sin(a) * (w / 2 - 0.04), 0.0, Math.cos(a) * (d / 2 - 0.04)]); }
  items.push(item(tubeGeo(rim, 0.05, 5, { round: true }), null, lit(lc, 0.1)));
  const nv = clamp(Math.round(w * 3), 8, 20);
  for (let k = 0; k < nv; k++) {
    const a = notch + (k / (nv - 1)) * (TAU - notch * 2);
    items.push(item(tubeGeo([[0, 0.004, d * 0.03], [Math.sin(a) * w * 0.22, 0.006, Math.cos(a) * d * 0.22], [Math.sin(a) * (w / 2 - 0.12), 0.002, Math.cos(a) * (d / 2 - 0.12)]], [0.03, 0.025, 0.012], 4), null, lit(lc, 0.35)));
  }
  const stem = o.stem ?? 1.2;
  if (stem > 0) items.push(item(tubeGeo([[0, -th * 0.5, 0], [0.08, -th - stem * 0.5, 0.05], [0.02, -th - stem, -0.05]], [0.09, 0.08, 0.07], 6, { round: true }), null, dim(lc, 0.75)));
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.2 }) }];
};

S.mushroom = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 23);
  const cc = col(o.color ?? 0xff6f86);
  const flat = 0.72;
  // unit-radius cap, scaled to w/2, d/2
  const prof = [[0, -h * 0.85], [0.3, -h * 0.82], [0.62, -h * 0.72], [0.86, -h * 0.66], [0.98, -h * 0.55], [1.02, -h * 0.4], [1.0, -h * 0.25], [0.93, -h * 0.1], [0.82, -0.02], [flat, 0], [0, 0]];
  const cap = G.latheGeo(prof, 40);
  cap.colorBy((x, y, z, nx, ny) => (y < -h * 0.66 + 0.02 && ny < -0.2 ? col(0xfff0e0) : mixc(dim(cc, 0.9), lit(cc, 0.08), smoothstep(-h * 0.6, 0, y))));
  const items = [item(cap, m4(null, 0, [w / 2, 1, d / 2]))];
  // gills
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    items.push(item(G.boxGeo(1, 1, 1), m4([Math.sin(a) * (w / 2) * 0.6, -h * 0.74, Math.cos(a) * (d / 2) * 0.6], [-0.18, a, 0], [0.025, 0.045, Math.min(w, d) * 0.2]), 0xf5dcc8));
  }
  // spots on the dome
  const ns = clamp(Math.round(w * d * 1.4), 6, 22);
  for (let i = 0; i < ns; i++) {
    const a = r.next() * TAU, t = r.range(0.0, 1.0);
    const rr = lerp(0.8, 1.0, t), y = lerp(-0.04, -h * 0.42, t);
    const nrm = [Math.sin(a) * lerp(0.45, 0.95, t), lerp(0.9, 0.3, t), Math.cos(a) * lerp(0.45, 0.95, t)];
    const l = Math.hypot(...nrm);
    const s = r.range(0.1, 0.18) * clamp(Math.min(w, d) / 2.5, 0.7, 1.4);
    items.push(item(sph(8, 5), m4([Math.sin(a) * rr * (w / 2), y, Math.cos(a) * rr * (d / 2)], [-Math.asin(nrm[1] / l), Math.atan2(nrm[0], nrm[2]), 0], [s, s, s * 0.3]), 0xffffff));
  }
  for (let i = 0; i < Math.round(w * d * 0.35); i++) {
    const a = r.next() * TAU, rr = r.range(0.2, 0.6);
    const s = r.range(0.08, 0.13);
    items.push(item(G.circleGeo(1, 14), m4([Math.sin(a) * rr * (w / 2), 0.004, Math.cos(a) * rr * (d / 2)], 0, s), 0xffffff));
  }
  const stem = o.stem ?? 1.2;
  if (stem > 0) {
    const sr = Math.min(w, d) * 0.22;
    items.push(item(G.latheGeo([[0, -h - stem], [sr * 1.25, -h - stem], [sr * 1.05, -h - stem + 0.15], [sr, -h - stem * 0.5], [sr * 0.95, -h * 0.75], [0, -h * 0.75]], 16), null, 0xfff1e0));
  }
  return [{ geo: G.mergeGeometries(items), mat: VC({ spec: 0.22, rim: 0.4 }) }];
};

S.moon = (w, d, h, o) => {
  const r = new RNG(o.seed ?? 29);
  const mc = col(o.color ?? 0xe0d8ff);
  const ol = baseOutline(w, d, o.round, Math.min(0.6, Math.min(w, d) * 0.3));
  const items = [item(slabGeo(ol, h, { bevel: Math.min(0.18, h * 0.3), steps: 3, cf: (x, y, z, part) => (part === 'top' ? lit(mc, 0.1) : part === 'bottom' ? dim(mc, 0.78) : mixc(dim(mc, 0.85), mc, smoothstep(-h, 0, y))) }))];
  // craters on top (flush decals) and sides
  const nc = clamp(Math.round(w * d * 0.6), 2, 10);
  for (let i = 0; i < nc; i++) {
    const x = r.range(-w * 0.35, w * 0.35), z = r.range(-d * 0.35, d * 0.35), s = r.range(0.14, 0.3);
    if (o.round && Math.pow(x / (w * 0.4), 2) + Math.pow(z / (d * 0.4), 2) > 1) continue;
    items.push(item(G.circleGeo(s, 16), m4([x, 0.003, z]), dim(mc, 0.78)));
    items.push(item(G.ringGeo(s, s * 1.22, 16), m4([x, 0.004, z]), lit(mc, 0.5)));
  }
  for (const q of resample(ol, Math.max(4, Math.round(perimeter(ol) / 1.2)))) {
    if (r.next() < 0.4) continue;
    const s = r.range(0.08, 0.14);
    items.push(item(sph(10, 6), m4([q.p[0] + q.n[0] * 0.0, -h * r.range(0.35, 0.65), q.p[1] + q.n[1] * 0.0], [-0, Math.atan2(q.n[0], q.n[1]), 0], [s, s, s * 0.35]), dim(mc, 0.82)));
  }
  const halo = G.icoGeo(1, 2);
  return [
    { geo: G.mergeGeometries(items), mat: VC({ spec: 0.2, rim: 0.6, emissive: [0.1, 0.09, 0.17] }) },
    { geo: halo, mat: softGlowMaterial([0.2, 0.18, 0.34], { rim: 2.4 }), matrix: [0, -h * 0.5, 0, w * 0.6, h * 1.2, d * 0.6] },
  ];
};

// ---------------------------------------------------------------- public API
const _cache = new Map();
export function buildPlatform(style, w = 3, d = 3, h = 0.6, opts = {}) {
  if (!S[style]) { console.warn('buildPlatform: unknown style ' + style); style = 'stone'; }
  w = Math.max(0.4, +w || 3); d = Math.max(0.4, +d || w); h = Math.max(0.08, +h || 0.6);
  opts = opts || {};
  if (style === 'gear') d = w;
  const r2 = (v) => Math.round(v * 100) / 100;
  const key = [style, r2(w), r2(d), r2(h), !!opts.round, opts.color ?? '', opts.seed ?? '', opts.stem ?? ''].join('|');
  let parts = _cache.get(key);
  if (!parts) {
    parts = S[style](w, d, h, opts);
    for (const p of parts) if (!p.geo.boundingSphere) p.geo.computeBoundingSphere();
    _cache.set(key, parts);
  }
  const root = new Node('platform-' + style);
  for (const p of parts) {
    const m = new Mesh(p.geo, p.mat, style);
    if (p.matrix) { const [x, y, z, sx, sy, sz] = p.matrix; m.position.set(x, y, z); m.scale.set(sx, sy, sz); }
    if (p.order) m.renderOrder = p.order;
    root.add(m);
  }
  root.userData.platform = { style, w, d, h, round: !!opts.round };
  return root;
}

const RAINBOW = [0xff8f9e, 0xffb877, 0xffe680, 0x9ae6a0, 0x8fcfff, 0xc7a8ff];
export function buildRainbowSegment(len = 2) {
  len = Math.max(0.1, +len || 2);
  const key = 'rainbow|' + (Math.round(len * 100) / 100);
  let g = _cache.get(key);
  if (!g) {
    const W = 1.4, bw = W / 6, th = 0.14, items = [];
    RAINBOW.forEach((c, i) => {
      const x = -W / 2 + (i + 0.5) * bw;
      const edge = i === 0 || i === 5;
      const geo = edge ? G.roundedBoxGeo(bw, th, len, 0.05, 2) : G.boxGeo(bw, th, len);
      items.push(item(geo, m4([x, -th / 2, 0]), c));
    });
    for (const sd of [-1, 1]) items.push(item(tubeGeo([[sd * (W / 2 + 0.02), 0.0, -len / 2], [sd * (W / 2 + 0.02), 0.0, len / 2]], 0.045, 6, { capStart: false, capEnd: false }), null, 0xffffff));
    const n = Math.max(1, Math.round(len / 0.7));
    for (let k = 0; k < n; k++) {
      const z = -len / 2 + ((k + 0.5) / n) * len;
      items.push(item(G.puffyShapeGeo(G.flowerOutline(4, 0.5, 0.12, 24), 0.05, 1), m4([((k % 3) - 1) * 0.42, -th - 0.05, z], [PI / 2, 0, 0], 0.16), 0xffffff));
    }
    g = G.mergeGeometries(items);
    _cache.set(key, g);
  }
  const root = new Node('rainbowSegment');
  root.add(new Mesh(g, new Material({ color: 0xffffff, vertexColors: true, ...GLOSS, spec: 0.25, emissive: [0.12, 0.1, 0.12] }), 'rainbow'));
  root.userData.platform = { style: 'rainbow', w: 1.4, d: len, h: 0.14 };
  return root;
}

export function buildCloudPad() {
  let g = _cache.get('cloudPad');
  if (!g) {
    const r = new RNG(77), items = [];
    items.push(item(slabGeo(ellipseOutline(1.25, 1.25, 28), 0.3, { bevel: 0.12 }), null, 0xffffff));
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r.range(-0.1, 0.1), s = r.range(0.24, 0.3);
      items.push(item(ico(1), m4([Math.cos(a) * 0.62, 0.04 - s * 0.8, Math.sin(a) * 0.62], [0, r.next() * 6, 0], [s, s * 0.8, s])));
    }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; items.push(item(sph(10, 7), m4([Math.cos(a) * 0.3, -0.32, Math.sin(a) * 0.3], 0, [0.36, 0.22, 0.36]))); }
    g = tintY(G.mergeGeometries(items), [1.0, 0.86, 0.95], [1, 1, 1], -0.5, -0.05);
    _cache.set('cloudPad', g);
  }
  const root = new Node('cloudPad');
  root.add(new Mesh(g, new Material({ color: 0xffffff, vertexColors: true, ...SOFT, rim: 0.5 }), 'cloud'));
  root.userData.platform = { style: 'cloudPad', w: 1.6, d: 1.6, h: 0.3, round: true };
  return root;
}

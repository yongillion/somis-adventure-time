// ============================================================================
// terrain.js — static level geometry generators (Kirby-like floating islands)
// All functions return { parts: [{key, geo, matrix, color}] } in WORLD space
// where key selects the batched material (see level.js STATIC_MATS).
// ============================================================================
import * as G from '../../engine/geometry.js';
import { rgb, mixColor, valueNoise3, valueNoise2, clamp, lerp, TAU, Vec3, Mat4 } from '../../engine/math.js';

const C = (h) => (Array.isArray(h) ? h : rgb(h));

// world-space planar UVs (call on geometry already in world space)
export function worldUV(geo, scale = 0.25) {
  const p = geo.attributes.position.array, n = geo.attributes.normal.array;
  const cnt = p.length / 3;
  const uv = new Float32Array(cnt * 2);
  for (let i = 0; i < cnt; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]), az = Math.abs(n[i * 3 + 2]);
    if (ay >= ax && ay >= az) { uv[i * 2] = x * scale; uv[i * 2 + 1] = z * scale; }
    else if (ax >= az) { uv[i * 2] = z * scale; uv[i * 2 + 1] = y * scale; }
    else { uv[i * 2] = x * scale; uv[i * 2 + 1] = y * scale; }
  }
  geo.setAttribute('uv', uv, 2);
  return geo;
}

function transformed(geo, m) { const g = geo.clone(); g.applyMatrix(m); return g; }

// ---------------------------------------------------------------------------
// Round floating island. top surface at y (world). r radius.
export function islandParts(x, y, z, r, o = {}) {
  const pal = o.pal;
  const depth = o.depth ?? Math.min(14, 3 + r * 0.9);
  const seg = Math.min(56, Math.max(16, Math.round(10 + r * 3.2)));
  const seed = o.seed ?? Math.round(x * 13 + z * 7);
  const lip = 0.45;
  const capProf = [[r, -lip], [r * 1.005, -lip * 0.45], [r * 0.99, -0.07], [r * 0.955, 0.0], [r * 0.8, 0.035], [r * 0.45, 0.06], [0, 0.07]];
  if (o.flat) capProf.splice(3, 4, [r * 0.955, 0], [0, 0]);
  const cap = G.latheGeo(capProf, seg);
  const grass = C(pal.grass), grass2 = C(pal.grass2 ?? pal.grass), rim = C(pal.rim ?? pal.grass);
  cap.colorBy((px, py, pz, nx, ny) => {
    const n = valueNoise2(px * 0.35 + seed, pz * 0.35 - seed);
    const base = mixColor(grass, grass2, clamp(n * 1.4 - 0.2, 0, 1));
    return ny < 0.55 ? mixColor(rim, base, Math.max(0, ny)) : base;
  });
  const capW = transformed(cap, G.trs(x, y, z));
  worldUV(capW, 0.22);
  // underside
  const D = depth;
  const prof = [[0, -D], [r * 0.18, -D * 0.9], [r * 0.42, -D * 0.68], [r * 0.66, -D * 0.42], [r * 0.86, -D * 0.18], [r * 0.97, -lip - 0.25], [r * 0.995, -lip + 0.02]];
  const under = G.latheGeo(prof, seg);
  const earth = C(pal.earth), rock = C(pal.rock);
  under.displace((v) => {
    const t = clamp(-v.y / D, 0, 1);
    if (t < 0.06) return;
    const n = valueNoise3(v.x * 0.3 + seed, v.y * 0.4, v.z * 0.3 - seed) - 0.5;
    const k = 1 + n * 0.45 * Math.min(1, t * 3);
    v.x *= k; v.z *= k;
    v.y += (valueNoise3(v.x * 0.2, seed, v.z * 0.2) - 0.5) * 0.8 * t;
  });
  under.computeVertexNormals();
  under.colorBy((px, py) => {
    const t = clamp(-py / D, 0, 1);
    const band = 0.5 + 0.5 * Math.sin(py * 2.2 + seed);
    const c = mixColor(earth, rock, Math.min(1, t * 1.3));
    return mixColor(c, mixColor(c, [1, 1, 1], 0.12), band * 0.5).map((v, i) => v * (1 - t * 0.18));
  });
  const underW = transformed(under, G.trs(x, y, z));
  return [
    { key: o.top || 'top:grass', geo: capW },
    { key: 'side', geo: underW },
  ];
}

// Rectangular floating slab (rounded) with tapered rocky underside. top at y.
export function slabParts(x, y, z, w, d, o = {}) {
  const pal = o.pal;
  const yaw = o.yaw || 0;
  const thick = o.thick ?? 0.7;
  const depth = o.depth ?? Math.min(8, 2 + Math.min(w, d) * 0.6);
  const seed = o.seed ?? Math.round(x * 5 + z * 11);
  const r = Math.min(o.round ?? 0.3, w / 2, d / 2, thick / 2);
  const top = G.roundedBoxGeo(w, thick, d, r, 3);
  const grass = C(pal.grass), grass2 = C(pal.grass2 ?? pal.grass), rim = C(pal.rim ?? pal.grass);
  const m = G.trs(x, y - thick / 2, z, 0, yaw, 0);
  const topW = transformed(top, m);
  topW.colorBy((px, py, pz, nx, ny) => {
    const n = valueNoise2(px * 0.35 + seed, pz * 0.35);
    const base = mixColor(grass, grass2, clamp(n * 1.4 - 0.2, 0, 1));
    return ny < 0.6 ? mixColor(rim, base, Math.max(0, ny) * 0.8) : base;
  });
  worldUV(topW, 0.22);
  const parts = [{ key: o.top || 'top:grass', geo: topW }];
  if (o.under !== false) {
    const ug = G.roundedBoxGeo(w * 0.97, depth, d * 0.97, Math.min(0.4, w * 0.2, d * 0.2), 2);
    const earth = C(pal.earth), rock = C(pal.rock);
    ug.displace((v) => {
      const t = clamp((depth / 2 - v.y) / depth, 0, 1);
      const taper = lerp(1, o.taper ?? 0.35, t * t);
      const n = valueNoise3(v.x * 0.5 + seed, v.y * 0.5, v.z * 0.5) - 0.5;
      v.x *= taper * (1 + n * 0.25 * t); v.z *= taper * (1 + n * 0.25 * t);
    });
    ug.computeVertexNormals();
    const um = G.trs(x, y - thick - depth / 2 + 0.05, z, 0, yaw, 0);
    const uw = transformed(ug, um);
    const yTop = y - thick;
    uw.colorBy((px, py) => {
      const t = clamp((yTop - py) / depth, 0, 1);
      return mixColor(earth, rock, Math.min(1, t * 1.3)).map((c) => c * (1 - t * 0.15));
    });
    parts.push({ key: 'side', geo: uw });
  }
  return parts;
}

// Solid block (rounded box). top at y, extends h down.
export function blockParts(x, y, z, w, h, d, o = {}) {
  const r = Math.min(o.round ?? 0.18, w / 2, h / 2, d / 2);
  const g = G.roundedBoxGeo(w, h, d, r, 2);
  const gw = transformed(g, G.trs(x, y - h / 2, z, 0, o.yaw || 0, 0));
  const c = C(o.color ?? 0xffffff), c2 = C(o.color2 ?? o.color ?? 0xffffff);
  const seed = o.seed ?? 3;
  gw.colorBy((px, py, pz, nx, ny) => {
    const n = valueNoise2(px * 0.6 + seed, pz * 0.6 + py * 0.4);
    const base = mixColor(c, c2, n);
    return ny > 0.6 ? base : base.map((v) => v * 0.94);
  });
  worldUV(gw, o.uvScale ?? 0.5);
  return [{ key: o.key || 'block:stone', geo: gw }];
}

// Cylinder pillar / round platform. top at y
export function pillarParts(x, y, z, r, h, o = {}) {
  const seg = Math.min(40, Math.max(12, Math.round(8 + r * 6)));
  const rr = Math.min(0.2, r * 0.3);
  const prof = [[0, -h], [r * 0.96, -h], [r, -h + rr * 0.6], [r, -rr], [r * 0.97, -rr * 0.25], [r - rr, 0], [0, 0]];
  const g = G.latheGeo(prof, seg);
  const gw = transformed(g, G.trs(x, y, z));
  const c = C(o.color ?? 0xffffff), top = C(o.topColor ?? o.color ?? 0xffffff);
  gw.colorBy((px, py, pz, nx, ny) => (ny > 0.7 ? top : c.map((v) => v * (0.9 + 0.1 * Math.sin(py * 3)))));
  worldUV(gw, o.uvScale ?? 0.4);
  return [{ key: o.key || 'block:stone', geo: gw }];
}

// Sloped walkway from A to B (centers of top surface ends), width w.
export function rampParts(ax, ay, az, bx, by, bz, w, o = {}) {
  const dx = bx - ax, dz = bz - az, dy = by - ay;
  const L = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const slope = Math.atan2(dy, L);
  const len3 = Math.hypot(L, dy);
  const thick = o.thick ?? 0.6;
  const g = G.roundedBoxGeo(w, thick, len3 + 0.02, Math.min(0.18, thick / 2), 2);
  // rotate about X so that +Z goes up the slope: pitch = -slope
  const cx = (ax + bx) / 2, cz = (az + bz) / 2, cy = (ay + by) / 2;
  const nx = -Math.sin(slope) * Math.sin(yaw), ny = Math.cos(slope), nz = -Math.sin(slope) * Math.cos(yaw);
  const m = G.trs(cx - nx * thick / 2, cy - ny * thick / 2, cz - nz * thick / 2, -slope, yaw, 0);
  const gw = transformed(g, m);
  const c = C(o.color ?? 0xffffff);
  gw.colorBy((px, py, pz, x2, ny2) => (ny2 > 0.5 ? c : c.map((v) => v * 0.85)));
  worldUV(gw, 0.3);
  return { parts: [{ key: o.key || 'top:grass', geo: gw }], yaw, L, slope };
}

// Plank bridge between A and B (top surface)
export function bridgeParts(ax, ay, az, bx, by, bz, w = 1.8, o = {}) {
  const dx = bx - ax, dz = bz - az, dy = by - ay;
  const L = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const n = Math.max(2, Math.round(L / 0.55));
  const items = [];
  const wood = C(o.color ?? 0xd8a070), wood2 = C(o.color2 ?? 0xc08858), rope = C(o.rope ?? 0xf0e0c0);
  const plank = G.cachedGeo('br:plank', () => G.roundedBoxGeo(1, 0.16, 0.46, 0.06, 2));
  const sag = o.sag ?? Math.min(0.5, L * 0.03);
  const yAt = (t) => ay + dy * t - Math.sin(t * Math.PI) * sag;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = ax + dx * t, pz = az + dz * t, py = yAt(t) - 0.08;
    const tilt = Math.atan2(yAt(Math.min(1, t + 0.01)) - yAt(Math.max(0, t - 0.01)), L * 0.02);
    const g = transformed(plank, G.trs(px, py, pz, -tilt, yaw + (i % 2 ? 0.03 : -0.03), 0, w, 1, (L / n) * 1.6));
    g.setColor(i % 3 === 0 ? wood2 : wood);
    worldUV(g, 0.5);
    items.push({ key: 'block:wood', geo: g });
  }
  // posts & ropes
  const post = G.cachedGeo('br:post', () => G.cylinderGeo(0.07, 0.08, 1, 8, 1, true));
  const ropeG = G.cachedGeo('br:rope', () => G.cylinderGeo(0.035, 0.035, 1, 6, 1, false));
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  for (const sd of [-1, 1]) {
    for (const t of [0, 1]) {
      const px = ax + dx * t + rx * sd * (w / 2), pz = az + dz * t + rz * sd * (w / 2), py = (t ? by : ay);
      const g = transformed(post, G.trs(px, py + 0.35, pz, 0, 0, 0, 1, 1.0, 1));
      g.setColor(wood2);
      items.push({ key: 'deco', geo: g });
    }
    const segs = 8;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const p0 = new Vec3(ax + dx * t0 + rx * sd * (w / 2), yAt(t0) + 0.75 + Math.sin(t0 * Math.PI) * sag * 0.3, az + dz * t0 + rz * sd * (w / 2));
      const p1 = new Vec3(ax + dx * t1 + rx * sd * (w / 2), yAt(t1) + 0.75 + Math.sin(t1 * Math.PI) * sag * 0.3, az + dz * t1 + rz * sd * (w / 2));
      items.push({ key: 'deco', geo: segmentGeo(ropeG, p0, p1, rope) });
    }
  }
  return { parts: items, yaw, L };
}

// place a unit cylinder (height 1 along Y, centered) between two points
export function segmentGeo(unitCyl, a, b, color) {
  const d = new Vec3().subVectors(b, a);
  const len = d.length();
  const mid = new Vec3().addVectors(a, b).scale(0.5);
  const yaw = Math.atan2(d.x, d.z);
  const pitch = Math.acos(clamp(d.y / (len || 1), -1, 1));
  const m = G.trs(mid.x, mid.y, mid.z, pitch, yaw, 0, 1, len, 1);
  const g = transformed(unitCyl, m);
  if (color) g.setColor(color);
  return g;
}

// Stairs from A to B (steps of blocks)
export function stairsParts(ax, ay, az, bx, by, bz, w, steps, o = {}) {
  const parts = [], cols = [];
  const dx = bx - ax, dz = bz - az, dy = by - ay;
  const yaw = Math.atan2(dx, dz);
  const L = Math.hypot(dx, dz);
  const stepL = L / steps;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const top = ay + dy * ((i + 1) / steps);
    const h = Math.max(0.4, top - (o.base ?? (ay - 0.6)));
    const x = ax + dx * t, z = az + dz * t;
    parts.push(...blockParts(x, top, z, w, h, stepL + 0.02, { yaw, color: o.color, color2: o.color2, key: o.key || 'block:stone' }));
    cols.push({ x, top, z, w, h, d: stepL, yaw });
  }
  return { parts, cols };
}

export { Mat4 };

// ============================================================================
// geometry.js — Geometry container + procedural primitive builders
// All builders return indexed geometry with position/normal/uv (and color when merged)
// ============================================================================
import { Vec3, Mat4, TAU, PI, clamp, lerp, valueNoise3 } from './math.js';

let geoId = 0;

export class Geometry {
  constructor() {
    this.id = ++geoId;
    this.attributes = {};
    this.index = null;
    this.boundingSphere = null;
    this.drawMode = 4; // gl.TRIANGLES
    this._gpu = null; // renderer-owned GPU handles
    this.version = 0;
  }
  setAttribute(name, array, itemSize, dynamic = false) {
    if (!(array instanceof Float32Array)) array = new Float32Array(array);
    this.attributes[name] = { array, itemSize, dynamic, version: 0 };
    this.version++;
    return this;
  }
  markDirty(name) { if (this.attributes[name]) this.attributes[name].version++; }
  setIndex(arr) {
    if (!arr) { this.index = null; return this; }
    let max = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    this.index = max > 65535 ? new Uint32Array(arr) : new Uint16Array(arr);
    this.version++;
    return this;
  }
  get vertexCount() { const p = this.attributes.position; return p ? p.array.length / 3 : 0; }
  computeBoundingSphere() {
    const p = this.attributes.position.array;
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const c = new Vec3((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2);
    let r2 = 0;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - c.x, dy = p[i + 1] - c.y, dz = p[i + 2] - c.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > r2) r2 = d;
    }
    this.boundingSphere = { center: c, radius: Math.sqrt(r2) };
    this.bbox = { min: new Vec3(minx, miny, minz), max: new Vec3(maxx, maxy, maxz) };
    return this.boundingSphere;
  }
  computeVertexNormals() {
    const pos = this.attributes.position.array;
    const n = new Float32Array(pos.length);
    const idx = this.index;
    const addFace = (a, b, c) => {
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
      const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      n[a * 3] += nx; n[a * 3 + 1] += ny; n[a * 3 + 2] += nz;
      n[b * 3] += nx; n[b * 3 + 1] += ny; n[b * 3 + 2] += nz;
      n[c * 3] += nx; n[c * 3 + 1] += ny; n[c * 3 + 2] += nz;
    };
    if (idx) for (let i = 0; i < idx.length; i += 3) addFace(idx[i], idx[i + 1], idx[i + 2]);
    else for (let i = 0; i < pos.length / 3; i += 3) addFace(i, i + 1, i + 2);
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    this.setAttribute('normal', n, 3);
    return this;
  }
  // weld vertices by position then compute smooth normals (useful after merges of lathe seams)
  smoothNormalsByPosition(eps = 1e-4) {
    this.computeVertexNormals();
    const pos = this.attributes.position.array, nrm = this.attributes.normal.array;
    const map = new Map();
    const key = (i) => `${Math.round(pos[i * 3] / eps)},${Math.round(pos[i * 3 + 1] / eps)},${Math.round(pos[i * 3 + 2] / eps)}`;
    const cnt = pos.length / 3;
    for (let i = 0; i < cnt; i++) {
      const k = key(i);
      let e = map.get(k);
      if (!e) { e = [0, 0, 0, []]; map.set(k, e); }
      e[0] += nrm[i * 3]; e[1] += nrm[i * 3 + 1]; e[2] += nrm[i * 3 + 2]; e[3].push(i);
    }
    for (const e of map.values()) {
      const l = Math.hypot(e[0], e[1], e[2]) || 1;
      for (const i of e[3]) { nrm[i * 3] = e[0] / l; nrm[i * 3 + 1] = e[1] / l; nrm[i * 3 + 2] = e[2] / l; }
    }
    this.markDirty('normal');
    return this;
  }
  toFlat() {
    // de-index and set face normals
    const pos = this.attributes.position.array;
    const uv = this.attributes.uv ? this.attributes.uv.array : null;
    const col = this.attributes.color ? this.attributes.color.array : null;
    const idx = this.index || Array.from({ length: pos.length / 3 }, (_, i) => i);
    const np = new Float32Array(idx.length * 3), nn = new Float32Array(idx.length * 3);
    const nu = uv ? new Float32Array(idx.length * 2) : null;
    const nc = col ? new Float32Array(idx.length * 3) : null;
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = idx[i + k];
        np[(i + k) * 3] = pos[v * 3]; np[(i + k) * 3 + 1] = pos[v * 3 + 1]; np[(i + k) * 3 + 2] = pos[v * 3 + 2];
        if (nu) { nu[(i + k) * 2] = uv[v * 2]; nu[(i + k) * 2 + 1] = uv[v * 2 + 1]; }
        if (nc) { nc[(i + k) * 3] = col[v * 3]; nc[(i + k) * 3 + 1] = col[v * 3 + 1]; nc[(i + k) * 3 + 2] = col[v * 3 + 2]; }
      }
      const a = i * 3, b = (i + 1) * 3, c = (i + 2) * 3;
      const e1x = np[b] - np[a], e1y = np[b + 1] - np[a + 1], e1z = np[b + 2] - np[a + 2];
      const e2x = np[c] - np[a], e2y = np[c + 1] - np[a + 1], e2z = np[c + 2] - np[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { nn[a + k * 3] = nx; nn[a + k * 3 + 1] = ny; nn[a + k * 3 + 2] = nz; }
    }
    const g = new Geometry();
    g.setAttribute('position', np, 3);
    g.setAttribute('normal', nn, 3);
    if (nu) g.setAttribute('uv', nu, 2);
    if (nc) g.setAttribute('color', nc, 3);
    return g;
  }
  applyMatrix(m) {
    const p = this.attributes.position.array;
    const v = new Vec3();
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMat4(m); p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z; }
    if (this.attributes.normal) {
      const nm = new Float32Array(9); Mat4.normalMat3(nm, m);
      const n = this.attributes.normal.array;
      for (let i = 0; i < n.length; i += 3) {
        const x = n[i], y = n[i + 1], z = n[i + 2];
        let nx = nm[0] * x + nm[3] * y + nm[6] * z, ny = nm[1] * x + nm[4] * y + nm[7] * z, nz = nm[2] * x + nm[5] * y + nm[8] * z;
        const l = Math.hypot(nx, ny, nz) || 1;
        n[i] = nx / l; n[i + 1] = ny / l; n[i + 2] = nz / l;
      }
      this.markDirty('normal');
    }
    this.markDirty('position');
    this.boundingSphere = null;
    return this;
  }
  translate(x, y, z) { return this.applyMatrix(Mat4.fromTranslation(Mat4.create(), x, y, z)); }
  scale(x, y = x, z = x) { const m = Mat4.create(); m[0] = x; m[5] = y; m[10] = z; return this.applyMatrix(m); }
  rotate(rx, ry, rz) { return this.applyMatrix(Mat4.composeEuler(Mat4.create(), 0, 0, 0, rx, ry, rz, 1, 1, 1)); }
  setColor(c) {
    const n = this.vertexCount, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    return this.setAttribute('color', a, 3);
  }
  // per-vertex color by function(x,y,z,nx,ny,nz) -> [r,g,b]
  colorBy(fn) {
    const p = this.attributes.position.array, nr = this.attributes.normal ? this.attributes.normal.array : null;
    const n = p.length / 3, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], nr ? nr[i * 3] : 0, nr ? nr[i * 3 + 1] : 1, nr ? nr[i * 3 + 2] : 0);
      a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2];
    }
    return this.setAttribute('color', a, 3);
  }
  displace(fn) {
    const p = this.attributes.position.array;
    const v = new Vec3();
    for (let i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]);
      fn(v);
      p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z;
    }
    this.markDirty('position');
    this.boundingSphere = null;
    return this;
  }
  clone() {
    const g = new Geometry();
    for (const k in this.attributes) { const a = this.attributes[k]; g.setAttribute(k, new Float32Array(a.array), a.itemSize, a.dynamic); }
    if (this.index) g.index = this.index.slice();
    g.drawMode = this.drawMode;
    return g;
  }
}

// ---------------------------------------------------------------------------
// helper to build from arrays
function build(pos, nrm, uv, idx) {
  const g = new Geometry();
  g.setAttribute('position', pos, 3);
  if (nrm) g.setAttribute('normal', nrm, 3);
  if (uv) g.setAttribute('uv', uv, 2);
  if (idx) g.setIndex(idx);
  if (!nrm) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
export function boxGeo(w = 1, h = 1, d = 1) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const pos = [], nrm = [], uv = [], idx = [];
  const face = (o, u, v, n, uw, vh) => {
    const b = pos.length / 3;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const su = i * 2 - 1, sv = j * 2 - 1;
      pos.push(o[0] + u[0] * su + v[0] * sv, o[1] + u[1] * su + v[1] * sv, o[2] + u[2] * su + v[2] * sv);
      nrm.push(n[0], n[1], n[2]);
      uv.push(i * uw, j * vh);
    }
    idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
  };
  face([hx, 0, 0], [0, 0, -hz], [0, hy, 0], [1, 0, 0], d, h);
  face([-hx, 0, 0], [0, 0, hz], [0, hy, 0], [-1, 0, 0], d, h);
  face([0, hy, 0], [hx, 0, 0], [0, 0, -hz], [0, 1, 0], w, d);
  face([0, -hy, 0], [hx, 0, 0], [0, 0, hz], [0, -1, 0], w, d);
  face([0, 0, hz], [hx, 0, 0], [0, hy, 0], [0, 0, 1], w, h);
  face([0, 0, -hz], [-hx, 0, 0], [0, hy, 0], [0, 0, -1], w, h);
  return build(pos, nrm, uv, idx);
}

function ticks(h, r, seg) {
  if (r <= 1e-5) return [-h, h];
  r = Math.min(r, h);
  const out = [];
  for (let k = 0; k <= seg; k++) out.push(-(h - r) - r * Math.cos((k / seg) * (PI / 2)));
  const start = h - r > 1e-5 ? seg : seg - 1;
  for (let k = start; k >= 0; k--) out.push((h - r) + r * Math.cos((k / seg) * (PI / 2)));
  return out;
}

// Rounded box (Minkowski box+sphere). uv in world-ish units for tiling textures.
export function roundedBoxGeo(w = 1, h = 1, d = 1, r = 0.15, seg = 3) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  r = Math.min(r, hx, hy, hz);
  const ix = hx - r, iy = hy - r, iz = hz - r;
  const pos = [], nrm = [], uv = [], idx = [];
  const tx = ticks(hx, r, seg), ty = ticks(hy, r, seg), tz = ticks(hz, r, seg);
  // face: axis (0,1,2), sign, u-axis, v-axis
  const faces = [
    [0, 1, 2, 1, tz, ty, -1, 1], [0, -1, 2, 1, tz, ty, 1, 1],
    [1, 1, 0, 2, tx, tz, 1, -1], [1, -1, 0, 2, tx, tz, 1, 1],
    [2, 1, 0, 1, tx, ty, 1, 1], [2, -1, 0, 1, tx, ty, -1, 1],
  ];
  const half = [hx, hy, hz], inner = [ix, iy, iz];
  const p = [0, 0, 0];
  for (const [ax, sg, ua, va, tu, tv, us, vs] of faces) {
    const base = pos.length / 3;
    const nu = tu.length, nv = tv.length;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        p[ax] = half[ax] * sg; p[ua] = tu[i] * us; p[va] = tv[j] * vs;
        // project
        const cx = clamp(p[0], -ix, ix), cy = clamp(p[1], -iy, iy), cz = clamp(p[2], -iz, iz);
        let ox = p[0] - cx, oy = p[1] - cy, oz = p[2] - cz;
        let l = Math.hypot(ox, oy, oz);
        let nx, ny, nz;
        if (l < 1e-6) { nx = ax === 0 ? sg : 0; ny = ax === 1 ? sg : 0; nz = ax === 2 ? sg : 0; l = 0; }
        else { nx = ox / l; ny = oy / l; nz = oz / l; }
        const px = cx + nx * r, py = cy + ny * r, pz = cz + nz * r;
        pos.push(px, py, pz); nrm.push(nx, ny, nz);
        const uu = [px, py, pz][ua], vv = [px, py, pz][va];
        uv.push(uu * us, vv);
      }
    }
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i, b = a + 1, c = a + nu + 1, e = a + nu;
      idx.push(a, b, c, a, c, e);
    }
  }
  // fix winding: verify first triangle faces outward; if not, flip all
  const g = build(pos, nrm, uv, idx);
  fixWinding(g);
  return g;
}

// Ensure each triangle's geometric normal agrees with stored vertex normals.
export function fixWinding(g) {
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array, idx = g.index;
  if (!idx) return g;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1x = pos[b * 3] - pos[a * 3], e1y = pos[b * 3 + 1] - pos[a * 3 + 1], e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3], e2y = pos[c * 3 + 1] - pos[a * 3 + 1], e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const nx = nrm[a * 3] + nrm[b * 3] + nrm[c * 3], ny = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1], nz = nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  g.version++;
  return g;
}

export function sphereGeo(r = 0.5, ws = 24, hs = 16, phiStart = 0, phiLen = TAU, thetaStart = 0, thetaLen = PI) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let y = 0; y <= hs; y++) {
    const v = y / hs;
    const th = thetaStart + v * thetaLen;
    for (let x = 0; x <= ws; x++) {
      const u = x / ws;
      const ph = phiStart + u * phiLen;
      const nx = Math.sin(th) * Math.sin(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.cos(ph);
      pos.push(nx * r, ny * r, nz * r); nrm.push(nx, ny, nz); uv.push(u, 1 - v);
    }
  }
  for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) {
    const a = y * (ws + 1) + x, b = a + 1, c = a + ws + 2, d = a + ws + 1;
    // a (top-left), d (below a)
    if (y !== 0 || thetaStart > 0) idx.push(a, d, b);
    if (y !== hs - 1 || thetaStart + thetaLen < PI) idx.push(b, d, c);
  }
  return build(pos, nrm, uv, idx);
}

export function cylinderGeo(rt = 0.5, rb = 0.5, h = 1, rs = 20, hsg = 1, capped = true, phiStart = 0, phiLen = TAU) {
  const pos = [], nrm = [], uv = [], idx = [];
  const slope = (rb - rt) / h;
  for (let y = 0; y <= hsg; y++) {
    const v = y / hsg, r = lerp(rt, rb, v), py = h / 2 - v * h;
    for (let x = 0; x <= rs; x++) {
      const u = x / rs, ph = phiStart + u * phiLen;
      const s = Math.sin(ph), c = Math.cos(ph);
      pos.push(r * s, py, r * c);
      const l = Math.hypot(1, slope);
      nrm.push(s / l, slope / l, c / l);
      uv.push(u, 1 - v);
    }
  }
  for (let y = 0; y < hsg; y++) for (let x = 0; x < rs; x++) {
    const a = y * (rs + 1) + x, b = a + 1, c = a + rs + 2, d = a + rs + 1;
    idx.push(a, d, b, b, d, c);
  }
  if (capped) {
    const cap = (top) => {
      const r = top ? rt : rb; if (r <= 0) return;
      const py = top ? h / 2 : -h / 2, ny = top ? 1 : -1;
      const center = pos.length / 3;
      pos.push(0, py, 0); nrm.push(0, ny, 0); uv.push(0.5, 0.5);
      for (let x = 0; x <= rs; x++) {
        const ph = phiStart + (x / rs) * phiLen, s = Math.sin(ph), c = Math.cos(ph);
        pos.push(r * s, py, r * c); nrm.push(0, ny, 0); uv.push(0.5 + s * 0.5, 0.5 + c * 0.5);
      }
      for (let x = 0; x < rs; x++) {
        const a = center + 1 + x, b = a + 1;
        if (top) idx.push(center, a, b); else idx.push(center, b, a);
      }
    };
    cap(true); cap(false);
  }
  const g = build(pos, nrm, uv, idx);
  return fixWinding(g);
}

export function coneGeo(r = 0.5, h = 1, rs = 20, capped = true) { return cylinderGeo(0.0001, r, h, rs, 1, capped); }

export function capsuleGeo(r = 0.5, len = 1, rs = 16, cs = 6) {
  // vertical capsule centered at origin, total height len + 2r
  const prof = [];
  for (let i = 0; i <= cs; i++) { const a = -PI / 2 + (i / cs) * (PI / 2); prof.push([Math.cos(a) * r, -len / 2 + Math.sin(a) * r]); }
  for (let i = 0; i <= cs; i++) { const a = (i / cs) * (PI / 2); prof.push([Math.cos(a) * r, len / 2 + Math.sin(a) * r]); }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  return latheGeo(prof, rs);
}

// profile: [[r, y], ...] listed bottom->top; outward normal = rotate tangent clockwise
export function latheGeo(profile, seg = 24, phiStart = 0, phiLen = TAU) {
  const n = profile.length;
  const pn = [];
  for (let i = 0; i < n; i++) {
    const p = profile[i];
    const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(n - 1, i + 1)];
    let dr = next[0] - prev[0], dy = next[1] - prev[1];
    // handle duplicates for sharp corners
    if (i > 0 && i < n - 1) {
      if (Math.abs(p[0] - prev[0]) < 1e-7 && Math.abs(p[1] - prev[1]) < 1e-7) { dr = next[0] - p[0]; dy = next[1] - p[1]; }
      else if (Math.abs(p[0] - next[0]) < 1e-7 && Math.abs(p[1] - next[1]) < 1e-7) { dr = p[0] - prev[0]; dy = p[1] - prev[1]; }
    }
    let nr = dy, ny = -dr;
    const l = Math.hypot(nr, ny) || 1;
    pn.push([nr / l, ny / l]);
  }
  const pos = [], nrm = [], uv = [], idx = [];
  // accumulate v by profile length
  const lens = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const total = lens[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= seg; j++) {
      const ph = phiStart + (j / seg) * phiLen, s = Math.sin(ph), c = Math.cos(ph);
      const r = profile[i][0];
      pos.push(r * s, profile[i][1], r * c);
      nrm.push(pn[i][0] * s, pn[i][1], pn[i][0] * c);
      uv.push(j / seg, lens[i] / total);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 2, d = a + seg + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = build(pos, nrm, uv, idx);
  return fixWinding(g);
}

export function torusGeo(R = 0.5, r = 0.15, rs = 12, ts = 32, arc = TAU) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= rs; j++) for (let i = 0; i <= ts; i++) {
    const u = (i / ts) * arc, v = (j / rs) * TAU;
    const cx = Math.cos(u) * R, cy = Math.sin(u) * R;
    const x = (R + r * Math.cos(v)) * Math.cos(u), y = (R + r * Math.cos(v)) * Math.sin(u), z = r * Math.sin(v);
    pos.push(x, y, z);
    const nx = x - cx, ny = y - cy, nz = z, l = Math.hypot(nx, ny, nz) || 1;
    nrm.push(nx / l, ny / l, nz / l);
    uv.push(i / ts, j / rs);
  }
  for (let j = 1; j <= rs; j++) for (let i = 1; i <= ts; i++) {
    const a = (ts + 1) * j + i - 1, b = (ts + 1) * (j - 1) + i - 1, c = (ts + 1) * (j - 1) + i, d = (ts + 1) * j + i;
    idx.push(a, b, d, b, c, d);
  }
  const g = build(pos, nrm, uv, idx);
  return fixWinding(g);
}

export function planeGeo(w = 1, d = 1, sw = 1, sd = 1) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= sd; j++) for (let i = 0; i <= sw; i++) {
    pos.push((i / sw - 0.5) * w, 0, (j / sd - 0.5) * d); nrm.push(0, 1, 0); uv.push((i / sw) * w, (j / sd) * d);
  }
  for (let j = 0; j < sd; j++) for (let i = 0; i < sw; i++) {
    const a = j * (sw + 1) + i, b = a + 1, c = a + sw + 2, e = a + sw + 1;
    idx.push(a, e, c, a, c, b);
  }
  return build(pos, nrm, uv, idx);
}

export function circleGeo(r = 0.5, seg = 32) {
  const pos = [0, 0, 0], nrm = [0, 1, 0], uv = [0.5, 0.5], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, s = Math.sin(a), c = Math.cos(a);
    pos.push(s * r, 0, c * r); nrm.push(0, 1, 0); uv.push(0.5 + s * 0.5, 0.5 + c * 0.5);
  }
  for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
  return fixWinding(build(pos, nrm, uv, idx));
}

// Ring (annulus) lying in XZ plane
export function ringGeo(rIn = 0.4, rOut = 0.5, seg = 32) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, s = Math.sin(a), c = Math.cos(a);
    pos.push(s * rIn, 0, c * rIn, s * rOut, 0, c * rOut);
    nrm.push(0, 1, 0, 0, 1, 0);
    uv.push(i / seg, 0, i / seg, 1);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  return fixWinding(build(pos, nrm, uv, idx));
}

// --------------------------------------------------------------------------
// 2D outlines (XY plane) — must be star-shaped around origin for puffyShapeGeo
export function starOutline(points = 5, rOuter = 0.5, rInner = 0.23, subdiv = 3) {
  const out = [];
  const n = points * 2;
  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = PI / 2 + (i / n) * TAU;
    const r = i % 2 === 0 ? rOuter : rInner;
    corners.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    for (let k = 0; k < subdiv; k++) { const t = k / subdiv; out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); }
  }
  // round tips slightly
  return out;
}
export function heartOutline(size = 0.5, seg = 48) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * TAU;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([(x / 17) * size, (y / 17) * size + size * 0.12]);
  }
  return out;
}
export function circleOutline(r = 0.5, seg = 32) {
  const out = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * TAU; out.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return out;
}
// Polygon outline with wobble (cloud / flower)
export function flowerOutline(petals = 5, rOuter = 0.5, rInner = 0.3, seg = 60) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    const r = rInner + (rOuter - rInner) * Math.pow(Math.abs(Math.cos((a * petals) / 2)), 0.7);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

// Inflated "pillow" shape from a star-shaped outline: front faces +Z
export function puffyShapeGeo(outline, depth = 0.2, rings = 5, pow = 0.5) {
  outline = ensureCCW(outline);
  const n = outline.length;
  const pos = [], idx = [];
  // front rings k=0..rings (k=rings collapses to center), back mirrored
  const sides = [1, -1];
  const ringStart = [];
  for (const sd of sides) {
    const start = pos.length / 3;
    ringStart.push(start);
    for (let k = 0; k < rings; k++) {
      const th = (k / rings) * (PI / 2);
      const s = Math.cos(th);
      const z = depth * Math.pow(Math.sin(th), pow) * sd;
      for (let i = 0; i < n; i++) pos.push(outline[i][0] * s, outline[i][1] * s, z);
    }
    pos.push(0, 0, depth * sd); // center
  }
  for (let si = 0; si < 2; si++) {
    const sd = sides[si], start = ringStart[si];
    const center = start + rings * n;
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        const a = start + k * n + i, b = start + k * n + i2;
        if (k < rings - 1) {
          const c = start + (k + 1) * n + i2, d = start + (k + 1) * n + i;
          if (sd > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
        } else {
          if (sd > 0) idx.push(a, b, center); else idx.push(a, center, b);
        }
      }
    }
  }
  // Stitch ring0 front/back are at z=0 (same positions) -> shared edge; normals averaged via weld
  const g = new Geometry();
  g.setAttribute('position', pos, 3);
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld outline normals between front and back (both z=0)
  const nrm = g.attributes.normal.array;
  for (let i = 0; i < n; i++) {
    const a = ringStart[0] + i, b = ringStart[1] + i;
    const nx = nrm[a * 3] + nrm[b * 3], ny = nrm[a * 3 + 1] + nrm[b * 3 + 1], nz = nrm[a * 3 + 2] + nrm[b * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[a * 3] = nrm[b * 3] = nx / l; nrm[a * 3 + 1] = nrm[b * 3 + 1] = ny / l; nrm[a * 3 + 2] = nrm[b * 3 + 2] = nz / l;
  }
  // uv: planar
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3] + 0.5; uv[i * 2 + 1] = pos[i * 3 + 1] + 0.5; }
  g.setAttribute('uv', uv, 2);
  fixWinding(g);
  g.computeBoundingSphere();
  return g;
}

// Flat extrusion of a simple polygon (ear clipping) — front +Z
export function extrudeGeo(outline, depth = 0.1) {
  outline = ensureCCW(outline);
  const tri = triangulate(outline);
  const n = outline.length, hz = depth / 2;
  const pos = [], nrm = [], uv = [], idx = [];
  for (const sd of [1, -1]) {
    const b = pos.length / 3;
    for (const p of outline) { pos.push(p[0], p[1], hz * sd); nrm.push(0, 0, sd); uv.push(p[0] + 0.5, p[1] + 0.5); }
    for (let i = 0; i < tri.length; i += 3) {
      if (sd > 0) idx.push(b + tri[i], b + tri[i + 1], b + tri[i + 2]);
      else idx.push(b + tri[i], b + tri[i + 2], b + tri[i + 1]);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = outline[i], c = outline[(i + 1) % n];
    const ex = c[0] - a[0], ey = c[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    const nx = ey / l, ny = -ex / l;
    const b = pos.length / 3;
    pos.push(a[0], a[1], hz, c[0], c[1], hz, c[0], c[1], -hz, a[0], a[1], -hz);
    for (let k = 0; k < 4; k++) nrm.push(nx, ny, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = build(pos, nrm, uv, idx);
  return fixWinding(g);
}

export function polyArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
}
export function ensureCCW(poly) { return polyArea(poly) < 0 ? poly.slice().reverse() : poly; }

export function triangulate(poly) {
  // ear clipping; ensures CCW
  const pts = poly.map((p) => [p[0], p[1]]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const ids = pts.map((_, i) => i);
  if (area < 0) ids.reverse();
  const out = [];
  const isEar = (i0, i1, i2) => {
    const a = pts[i0], b = pts[i1], c = pts[i2];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr <= 1e-12) return false;
    for (const k of ids) {
      if (k === i0 || k === i1 || k === i2) continue;
      const p = pts[k];
      const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
      const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
      if (d1 >= 0 && d2 >= 0 && d3 >= 0) return false;
    }
    return true;
  };
  let guard = 0;
  while (ids.length > 3 && guard++ < 10000) {
    let found = false;
    for (let i = 0; i < ids.length; i++) {
      const i0 = ids[(i + ids.length - 1) % ids.length], i1 = ids[i], i2 = ids[(i + 1) % ids.length];
      if (isEar(i0, i1, i2)) { out.push(i0, i1, i2); ids.splice(i, 1); found = true; break; }
    }
    if (!found) break;
  }
  if (ids.length === 3) out.push(ids[0], ids[1], ids[2]);
  return out;
}

// faceted crystal (bipyramid)
export function crystalGeo(r = 0.3, hTop = 0.6, hBot = 0.3, sides = 6) {
  const pos = [0, hTop, 0, 0, -hBot, 0];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * TAU; pos.push(Math.sin(a) * r, 0, Math.cos(a) * r); }
  const idx = [];
  for (let i = 0; i < sides; i++) {
    const a = 2 + i, b = 2 + ((i + 1) % sides);
    idx.push(0, a, b, 1, b, a);
  }
  const g = new Geometry();
  g.setAttribute('position', pos, 3);
  g.setIndex(idx);
  g.computeVertexNormals();
  const f = g.toFlat();
  fixWindingFlat(f);
  f.computeBoundingSphere();
  return f;
}
function fixWindingFlat(g) {
  // for de-indexed convex shapes centered at origin: flip triangles whose normal points inward
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 9) {
    const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    if (cx * n[i] + cy * n[i + 1] + cz * n[i + 2] < 0) {
      for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
      for (let k = 0; k < 9; k++) n[i + k] = -n[i + k];
    }
  }
}

export function icoGeo(r = 0.5, detail = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  verts = verts.map(norm);
  for (let d = 0; d < detail; d++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      const va = verts[a], vb = verts[b];
      verts.push(norm([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
      cache.set(k, verts.length - 1);
      return verts.length - 1;
    };
    const nf = [];
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  const pos = [], nrm = [], idx = [];
  for (const v of verts) { pos.push(v[0] * r, v[1] * r, v[2] * r); nrm.push(v[0], v[1], v[2]); }
  for (const f of faces) idx.push(f[0], f[1], f[2]);
  const g = build(pos, nrm, null, idx);
  return fixWinding(g);
}

// Rock: displaced icosphere, flat shaded
export function rockGeo(r = 0.5, seed = 1, rough = 0.25, detail = 1) {
  const g = icoGeo(r, detail);
  g.displace((v) => {
    const n = valueNoise3(v.x * 2.1 + seed * 7.1, v.y * 2.1 + seed * 3.3, v.z * 2.1 - seed * 1.7);
    v.scale(1 + (n - 0.5) * 2 * rough);
    v.y *= 0.8;
  });
  const f = g.toFlat();
  f.computeBoundingSphere();
  return f;
}

// --------------------------------------------------------------------------
// Merge geometries with transforms and colors -> single geometry with color attribute
// items: [{ geo, matrix?, color?:[r,g,b] }]
export function mergeGeometries(items, { withUV = true } = {}) {
  let vcount = 0, icount = 0;
  for (const it of items) { vcount += it.geo.vertexCount; icount += it.geo.index ? it.geo.index.length : it.geo.vertexCount; }
  const pos = new Float32Array(vcount * 3), nrm = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3);
  const uv = withUV ? new Float32Array(vcount * 2) : null;
  const idx = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
  let vo = 0, io = 0;
  const v = new Vec3(), nm = new Float32Array(9);
  for (const it of items) {
    const g = it.geo, m = it.matrix || null;
    const p = g.attributes.position.array, n = g.attributes.normal ? g.attributes.normal.array : null;
    const c = g.attributes.color ? g.attributes.color.array : null, u = g.attributes.uv ? g.attributes.uv.array : null;
    const tint = it.color || [1, 1, 1];
    if (m) Mat4.normalMat3(nm, m);
    const vc = p.length / 3;
    for (let i = 0; i < vc; i++) {
      v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      if (m) v.applyMat4(m);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (n) {
        let x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2];
        if (m) {
          const nx = nm[0] * x + nm[3] * y + nm[6] * z, ny = nm[1] * x + nm[4] * y + nm[7] * z, nz = nm[2] * x + nm[5] * y + nm[8] * z;
          const l = Math.hypot(nx, ny, nz) || 1; x = nx / l; y = ny / l; z = nz / l;
        }
        nrm[(vo + i) * 3] = x; nrm[(vo + i) * 3 + 1] = y; nrm[(vo + i) * 3 + 2] = z;
      }
      const cr = c ? c[i * 3] : 1, cg = c ? c[i * 3 + 1] : 1, cb = c ? c[i * 3 + 2] : 1;
      col[(vo + i) * 3] = cr * tint[0]; col[(vo + i) * 3 + 1] = cg * tint[1]; col[(vo + i) * 3 + 2] = cb * tint[2];
      if (uv && u) { uv[(vo + i) * 2] = u[i * 2]; uv[(vo + i) * 2 + 1] = u[i * 2 + 1]; }
    }
    if (g.index) { for (let i = 0; i < g.index.length; i++) idx[io + i] = g.index[i] + vo; io += g.index.length; }
    else { for (let i = 0; i < vc; i++) idx[io + i] = vo + i; io += vc; }
    vo += vc;
  }
  const g = new Geometry();
  g.setAttribute('position', pos, 3);
  g.setAttribute('normal', nrm, 3);
  g.setAttribute('color', col, 3);
  if (uv) g.setAttribute('uv', uv, 2);
  g.index = idx;
  g.computeBoundingSphere();
  return g;
}

// convenience to build a transform matrix
export function trs(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return Mat4.composeEuler(Mat4.create(), px, py, pz, rx, ry, rz, sx, sy, sz);
}

// Shared unit geometries (cached) for model building
const _cache = new Map();
export function cachedGeo(key, fn) {
  let g = _cache.get(key);
  if (!g) { g = fn(); _cache.set(key, g); }
  return g;
}
export const UNIT = {
  sphere: () => cachedGeo('sphere', () => sphereGeo(1, 20, 14)),
  sphereHi: () => cachedGeo('sphereHi', () => sphereGeo(1, 28, 20)),
  sphereLo: () => cachedGeo('sphereLo', () => sphereGeo(1, 12, 8)),
  hemi: () => cachedGeo('hemi', () => sphereGeo(1, 20, 8, 0, TAU, 0, PI / 2)),
  cylinder: () => cachedGeo('cylinder', () => cylinderGeo(1, 1, 1, 16, 1, true)),
  cone: () => cachedGeo('cone', () => coneGeo(1, 1, 16, true)),
  capsule: () => cachedGeo('capsule', () => capsuleGeo(0.5, 1, 14, 5)),
  box: () => cachedGeo('box', () => boxGeo(1, 1, 1)),
  rbox: () => cachedGeo('rbox', () => roundedBoxGeo(1, 1, 1, 0.2, 3)),
  torus: () => cachedGeo('torus', () => torusGeo(1, 0.25, 10, 28)),
  star: () => cachedGeo('star', () => puffyShapeGeo(starOutline(5, 0.5, 0.25, 3), 0.18, 5, 0.6)),
  heart: () => cachedGeo('heart', () => puffyShapeGeo(heartOutline(0.5, 48), 0.2, 5, 0.6)),
  disc: () => cachedGeo('disc', () => circleGeo(1, 32)),
  plane: () => cachedGeo('plane', () => planeGeo(1, 1, 1, 1)),
};

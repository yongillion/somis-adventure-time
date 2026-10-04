// ============================================================================
// physics.js — collision world for a kinematic platformer.
// Colliders: 'box' (yaw-rotated), 'cyl' (vertical cylinder), 'ramp' (box with
// sloped top along local +Z). Characters are vertical cylinders (feet origin).
// ============================================================================
import { clamp } from '../../engine/math.js';

let cid = 0;
export class Collider {
  constructor(o) {
    this.id = ++cid;
    this.type = o.type || 'box';
    this.x = o.x || 0; this.y = o.y || 0; this.z = o.z || 0; // center
    this.hx = o.hx ?? 0.5; this.hy = o.hy ?? 0.5; this.hz = o.hz ?? 0.5; // half extents (cyl: hx = radius)
    this.setYaw(o.yaw || 0);
    this.top0 = o.top0; this.top1 = o.top1; // ramp tops (world y) at local -Z / +Z ends
    this.solid = o.solid ?? true;
    this.oneWay = !!o.oneWay;
    this.enabled = o.enabled ?? true;
    this.surface = o.surface || 'normal'; // normal | ice | bouncy | sticky | conveyor
    this.bounce = o.bounce || 0;
    this.conv = o.conv || null; // {x,z}
    this.climbable = !!o.climbable;
    this.hazard = o.hazard || null; // 'spike' etc: hurts on contact
    this.moving = !!o.moving;
    this.dx = 0; this.dy = 0; this.dz = 0; this.dyaw = 0;
    this.owner = o.owner || null;
    this.tag = o.tag || '';
    this.onStand = o.onStand || null;
    this.onHeadBump = o.onHeadBump || null;
    this.camBlock = o.camBlock ?? true;
  }
  setYaw(y) { this.yaw = y; this.cos = Math.cos(y); this.sin = Math.sin(y); }
  get top() { return this.type === 'ramp' ? Math.max(this.top0, this.top1) : this.y + this.hy; }
  get bottom() { return this.y - this.hy; }
  // move a dynamic collider, recording deltas for riders
  moveTo(x, y, z, yaw = this.yaw) {
    this.dx += x - this.x; this.dy += y - this.y; this.dz += z - this.z; this.dyaw += yaw - this.yaw;
    this.px = this.x; this.pz = this.z;
    if (this.type === 'ramp') { const d = y - this.y; this.top0 += d; this.top1 += d; }
    this.x = x; this.y = y; this.z = z;
    if (yaw !== this.yaw) this.setYaw(yaw);
  }
  // local coords of world point
  local(x, z, out) {
    const dx = x - this.x, dz = z - this.z;
    out[0] = dx * this.cos - dz * this.sin;
    out[1] = dx * this.sin + dz * this.cos;
    return out;
  }
  rampTopLocal(lz) { return this.top0 + (this.top1 - this.top0) * ((clamp(lz, -this.hz, this.hz) + this.hz) / (2 * this.hz)); }
  // top surface height at world (x,z) if inside footprint (+margin), else null
  topAt(x, z, margin = 0) {
    if (this.type === 'cyl') {
      const dx = x - this.x, dz = z - this.z;
      return dx * dx + dz * dz <= (this.hx + margin) * (this.hx + margin) ? this.y + this.hy : null;
    }
    const L = this.local(x, z, _l);
    if (Math.abs(L[0]) > this.hx + margin || Math.abs(L[1]) > this.hz + margin) return null;
    return this.type === 'ramp' ? this.rampTopLocal(L[1]) : this.y + this.hy;
  }
  inside(x, z, margin = 0) { return this.topAt(x, z, margin) !== null; }
}
const _l = [0, 0];

export class PhysicsWorld {
  constructor() {
    this.statics = [];
    this.dynamics = [];
    this.grid = new Map();
    this.cell = 6;
    this.waters = [];
    this.triggers = [];
    this.killY = -40;
    this._q = [];
    this._stamp = 0;
  }
  add(c) {
    if (!(c instanceof Collider)) c = new Collider(c);
    if (c.moving) this.dynamics.push(c);
    else { this.statics.push(c); this._insert(c); }
    return c;
  }
  remove(c) {
    let i = this.dynamics.indexOf(c);
    if (i >= 0) { this.dynamics.splice(i, 1); return; }
    i = this.statics.indexOf(c);
    if (i >= 0) { this.statics.splice(i, 1); this._rebuild(); }
  }
  clear() { this.statics.length = 0; this.dynamics.length = 0; this.grid.clear(); this.waters.length = 0; this.triggers.length = 0; }
  _extent(c) {
    if (c.type === 'cyl') return c.hx;
    return Math.hypot(c.hx, c.hz);
  }
  _insert(c) {
    const e = this._extent(c), s = this.cell;
    const x0 = Math.floor((c.x - e) / s), x1 = Math.floor((c.x + e) / s);
    const z0 = Math.floor((c.z - e) / s), z1 = Math.floor((c.z + e) / s);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 73856093 ^ j * 19349663;
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(c);
    }
  }
  _rebuild() { this.grid.clear(); for (const c of this.statics) this._insert(c); }
  // candidate colliders near (x,z) within radius r
  query(x, z, r = 1) {
    const out = this._q; out.length = 0;
    const stamp = ++this._stamp;
    const s = this.cell;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s), z1 = Math.floor((z + r) / s);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const arr = this.grid.get(i * 73856093 ^ j * 19349663);
      if (!arr) continue;
      for (const c of arr) if (c._qs !== stamp) { c._qs = stamp; out.push(c); }
    }
    for (const c of this.dynamics) out.push(c);
    return out;
  }
  // begin-of-frame: clear dynamic deltas (platform movers then call moveTo)
  beginFrame() { for (const c of this.dynamics) { c.dx = 0; c.dy = 0; c.dz = 0; c.dyaw = 0; c.px = c.x; c.pz = c.z; c.prevYaw = c.yaw; } }

  // highest walkable top at (x,z) that is <= y + up and >= y - down
  groundBelow(x, y, z, down = 100, up = 0.05, margin = 0) {
    let best = -Infinity, bestC = null;
    for (const c of this.query(x, z, 0.5)) {
      if (!c.enabled || !c.solid) continue;
      const t = c.topAt(x, z, margin);
      if (t === null || t > y + up || t < y - down) continue;
      if (t > best) { best = t; bestC = c; }
    }
    return bestC ? { y: best, c: bestC } : null;
  }
  // point inside any solid?
  solidAt(x, y, z) {
    for (const c of this.query(x, z, 0.5)) {
      if (!c.enabled || !c.solid || c.oneWay) continue;
      const t = c.topAt(x, z, 0);
      if (t !== null && y < t - 0.02 && y > c.y - c.hy) return c;
    }
    return null;
  }

  // ------------------------------------------------------------------ character motion
  // body: { pos:Vec3, vel:Vec3, r, h, stepUp, snapDown, margin, grounded, ground, dropThrough }
  carry(b) {
    const c = b.ground;
    if (!b.grounded || !c || !c.moving) return;
    if (c.dyaw) {
      const cx = c.x - c.dx, cz = c.z - c.dz; // pivot at previous center
      const dx = b.pos.x - cx, dz = b.pos.z - cz;
      const co = Math.cos(c.dyaw), si = Math.sin(c.dyaw);
      b.pos.x = cx + dx * co + dz * si;
      b.pos.z = cz - dx * si + dz * co;
      if (b.onCarryYaw) b.onCarryYaw(c.dyaw);
    }
    b.pos.x += c.dx; b.pos.y += c.dy; b.pos.z += c.dz;
  }
  moveBody(b, dt) {
    const v = b.vel;
    const maxD = Math.max(Math.abs(v.x), Math.abs(v.z), Math.abs(v.y) * 0.6) * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(maxD / (b.r * 0.45))));
    const sdt = dt / steps;
    b.hitWall = false; b.hitCeil = false; b.landed = false; b.wallC = null; b.ceilC = null;
    for (let s = 0; s < steps; s++) {
      b.pos.x += v.x * sdt; b.pos.z += v.z * sdt;
      this._walls(b);
      const prevY = b.pos.y;
      b.pos.y += v.y * sdt;
      this._vertical(b, prevY);
    }
  }
  _walls(b) {
    const feet = b.pos.y, head = b.pos.y + b.h;
    const cands = this.query(b.pos.x, b.pos.z, b.r + 0.5);
    for (let pass = 0; pass < 2; pass++) {
      for (const c of cands) {
        if (!c.enabled || !c.solid || c.oneWay) continue;
        if (head <= c.y - c.hy + 0.02) continue;
        let nx = 0, nz = 0, pen = 0;
        if (c.type === 'cyl') {
          const top = c.y + c.hy;
          if (feet + b.stepUp >= top) continue;
          const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
          const d = Math.hypot(dx, dz), R = c.hx + b.r;
          if (d >= R) continue;
          if (d > 1e-6) { nx = dx / d; nz = dz / d; } else { nx = 1; nz = 0; }
          pen = R - d;
        } else {
          const L = c.local(b.pos.x, b.pos.z, _l);
          const lx = L[0], lz = L[1];
          if (Math.abs(lx) > c.hx + b.r || Math.abs(lz) > c.hz + b.r) continue;
          const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
          const top = c.type === 'ramp' ? c.rampTopLocal(qz) : c.y + c.hy;
          if (feet + b.stepUp >= top) continue;
          const ox = lx - qx, oz = lz - qz;
          const d2 = ox * ox + oz * oz;
          let px, pz;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            if (d >= b.r) continue;
            px = ox / d; pz = oz / d; pen = b.r - d;
          } else {
            const penX = c.hx - Math.abs(lx), penZ = c.hz - Math.abs(lz);
            if (penX < penZ) { px = Math.sign(lx) || 1; pz = 0; pen = penX + b.r; } else { px = 0; pz = Math.sign(lz) || 1; pen = penZ + b.r; }
          }
          nx = px * c.cos + pz * c.sin; nz = -px * c.sin + pz * c.cos;
        }
        b.pos.x += nx * pen; b.pos.z += nz * pen;
        const vn = b.vel.x * nx + b.vel.z * nz;
        if (vn < 0) { b.vel.x -= vn * nx; b.vel.z -= vn * nz; }
        b.hitWall = true; b.wallC = c; b.wallNx = nx; b.wallNz = nz;
      }
    }
  }
  _vertical(b, prevY) {
    const x = b.pos.x, z = b.pos.z;
    const cands = this.query(x, z, 0.6);
    if (b.vel.y <= 0) {
      const snap = b.grounded ? (b.snapDown ?? 0.32) : 0.02;
      let best = -Infinity, bestC = null;
      for (const c of cands) {
        if (!c.enabled || !c.solid) continue;
        const t = c.topAt(x, z, b.margin ?? 0.1);
        if (t === null) continue;
        if (t > b.pos.y + b.stepUp) continue;
        if (t < b.pos.y - snap) continue;
        if (c.oneWay && (prevY < t - 0.08 || b.dropThrough)) continue;
        if (t > best) { best = t; bestC = c; }
      }
      if (bestC) {
        if (!b.grounded) { b.landed = true; b.landVel = b.vel.y; }
        b.pos.y = best;
        b.vel.y = 0;
        b.grounded = true; b.ground = bestC;
      } else { b.grounded = false; b.ground = null; }
    } else {
      b.grounded = false; b.ground = null;
      const head = b.pos.y + b.h, prevHead = prevY + b.h;
      for (const c of cands) {
        if (!c.enabled || !c.solid || c.oneWay) continue;
        const bottom = c.y - c.hy;
        if (prevHead > bottom + 0.05 || head <= bottom) continue;
        if (!c.inside(x, z, -b.r * 0.35)) continue;
        let ny = bottom - b.h;
        // squeezed against a descending ceiling: never push the feet below the floor we stand on
        let floor = -Infinity;
        for (const g of cands) {
          if (g === c || !g.enabled || !g.solid) continue;
          const t = g.topAt(x, z, 0.05);
          if (t !== null && t <= prevY + 0.05 && t > floor) floor = t;
        }
        if (ny < floor) { ny = floor; b.squished = c; }
        b.pos.y = ny;
        b.vel.y = 0;
        b.hitCeil = true; b.ceilC = c;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ water / triggers
  addWater(w) { this.waters.push(w); return w; } // {x,z,hx,hz | r, top, bottom}
  waterAt(x, y, z) {
    for (const w of this.waters) {
      if (w.enabled === false) continue;
      if (y > w.top || y < w.bottom) continue;
      if (w.r !== undefined) { if (Math.hypot(x - w.x, z - w.z) > w.r) continue; }
      else if (Math.abs(x - w.x) > w.hx || Math.abs(z - w.z) > w.hz) continue;
      return w;
    }
    return null;
  }
  addTrigger(t) { t.inside = false; this.triggers.push(t); return t; } // {x,y,z,hx,hy,hz,onEnter,onExit,onStay,once}
  updateTriggers(p, dt) {
    for (const t of this.triggers) {
      if (t.enabled === false || t.done) continue;
      const inside = Math.abs(p.x - t.x) <= t.hx && Math.abs(p.y - t.y) <= t.hy && Math.abs(p.z - t.z) <= t.hz;
      if (inside && !t.inside) { t.inside = true; if (t.onEnter) t.onEnter(t); if (t.once) t.done = true; }
      else if (!inside && t.inside) { t.inside = false; if (t.onExit) t.onExit(t); }
      if (inside && t.onStay) t.onStay(t, dt);
    }
  }

  // ------------------------------------------------------------------ raycast (segment a->b)
  // returns fraction 0..1 of first hit or 1 if clear
  raycast(ax, ay, az, bx, by, bz, filter = null) {
    let best = 1;
    const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), minz = Math.min(az, bz), maxz = Math.max(az, bz);
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2, r = Math.hypot(maxx - minx, maxz - minz) / 2 + 1;
    for (const c of this.query(cx, cz, r)) {
      if (!c.enabled || !c.solid || c.oneWay) continue;
      if (filter && !filter(c)) continue;
      const t = this._rayCollider(c, ax, ay, az, bx, by, bz);
      if (t < best) best = t;
    }
    return best;
  }
  _rayCollider(c, ax, ay, az, bx, by, bz) {
    const top = c.type === 'ramp' ? Math.max(c.top0, c.top1) : c.y + c.hy;
    const bot = c.y - c.hy;
    if (c.type === 'cyl') {
      const dx = bx - ax, dz = bz - az, fx = ax - c.x, fz = az - c.z;
      const A = dx * dx + dz * dz, Bq = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - c.hx * c.hx;
      let t0 = 0, t1 = 1;
      if (A < 1e-9) { if (C > 0) return 1; }
      else {
        const disc = Bq * Bq - 4 * A * C;
        if (disc < 0) return 1;
        const sq = Math.sqrt(disc);
        t0 = Math.max(0, (-Bq - sq) / (2 * A)); t1 = Math.min(1, (-Bq + sq) / (2 * A));
        if (t0 > t1) return 1;
      }
      // y slab
      const dy = by - ay;
      let y0 = 0, y1 = 1;
      if (Math.abs(dy) < 1e-9) { if (ay < bot || ay > top) return 1; }
      else { let u = (bot - ay) / dy, v = (top - ay) / dy; if (u > v) [u, v] = [v, u]; y0 = u; y1 = v; }
      const s = Math.max(t0, y0), e = Math.min(t1, y1);
      return s <= e && s >= 0 && s <= 1 ? s : 1;
    }
    // box (ramp treated as box) in local space
    const A = c.local(ax, az, [0, 0]), B = c.local(bx, bz, [0, 0]);
    const o = [A[0], ay, A[1]], d = [B[0] - A[0], by - ay, B[1] - A[1]];
    const mn = [-c.hx, bot, -c.hz], mx = [c.hx, top, c.hz];
    let tmin = 0, tmax = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return 1; continue; }
      let u = (mn[i] - o[i]) / d[i], v = (mx[i] - o[i]) / d[i];
      if (u > v) [u, v] = [v, u];
      tmin = Math.max(tmin, u); tmax = Math.min(tmax, v);
      if (tmin > tmax) return 1;
    }
    return tmin;
  }
}

// ============================================================================
// hazards.js — obstacle gauntlet pieces (Super Meat Boy flavor, kid-friendly):
// saws, spike strips, spike traps, crushers, firebars, lasers, wind zones,
// rolling balls, falling icicles, fog goo.
// ============================================================================
import { Vec3, clamp, TAU, Ease, distPointSegXZ } from '../../engine/math.js';
import { Mesh, Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { Collider } from '../world/physics.js';
import { buildObject } from '../models/objects.js';
import { PAL } from '../fx.js';

const HS = () => (CTX.diff ? CTX.diff.hazardSpeed : 1);
function hurtPlayer(from, o = {}) { const p = CTX.player; if (p && !p.dead) p.hurt(1, from, { hazard: true, ...o }); }
function playerCenter() { const p = CTX.player; return { x: p.pos.x, y: p.pos.y + 0.55, z: p.pos.z }; }

// ------------------------------------------------------------------ saw blade
export class Saw {
  // path: [[x,y,z],...] centers; o: {r, speed, yaw (blade facing), spin}
  constructor(level, path, o = {}) {
    this.obj = buildObject('saw', { r: o.r ?? 0.8, speed: o.spin ?? 9 });
    this.node = this.obj.root;
    this.path = path.map((p) => new Vec3(p[0], p[1], p[2]));
    this.r = o.r ?? 0.8;
    this.speed = (o.speed ?? 3) * HS();
    this.t = (o.phase ?? 0) * 100;
    this.pos = this.path[0].clone();
    this.node.rotation.y = o.yaw ?? 0;
    this.loop = !!o.loop;
    this.fn = o.fn || null;
    this.lens = []; this.total = 0;
    const n = this.path.length;
    for (let i = 0; i < (this.loop ? n : n - 1); i++) { const l = this.path[i].distanceTo(this.path[(i + 1) % n]); this.lens.push(l); this.total += l; }
    this.autoFace = o.yaw === undefined;
    this.node.position.copy(this.pos);
  }
  update(dt) {
    this.t += dt;
    const n = this.path.length;
    if (this.fn) { const r = this.fn(this.t); this.pos.set(r[0], r[1], r[2]); }
    else if (n > 1 && this.total > 0) {
      let d = (this.t * this.speed) % (this.loop ? this.total : this.total * 2);
      if (!this.loop && d > this.total) d = this.total * 2 - d;
      for (let i = 0; i < this.lens.length; i++) {
        if (d <= this.lens[i] || i === this.lens.length - 1) {
          this.pos.lerpVectors(this.path[i], this.path[(i + 1) % n], clamp(d / this.lens[i], 0, 1));
          if (this.autoFace) { const a = this.path[i], b = this.path[(i + 1) % n]; this.node.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2; }
          break;
        }
        d -= this.lens[i];
      }
    }
    this.node.position.copy(this.pos);
    this.obj.update(dt);
    const c = playerCenter();
    const dx = c.x - this.pos.x, dy = c.y - this.pos.y, dz = c.z - this.pos.z;
    const rr = this.r + 0.32;
    if (dx * dx + dy * dy + dz * dz < rr * rr) hurtPlayer(this.pos, { knock: 7, up: 7 });
    if (Math.random() < dt * 6) CTX.fx.sparkle({ x: this.pos.x, y: this.pos.y - this.r * 0.8, z: this.pos.z }, [1, 0.9, 0.7], 1, 0.1);
  }
}

// ------------------------------------------------------------------ static spike strip (collider hazard)
export class SpikeStrip {
  constructor(level, x, y, z, w, d, o = {}) {
    this.obj = buildObject('spikeStrip', { w, d });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.node.rotation.y = o.yaw || 0;
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y + 0.18, z, hx: w / 2, hy: 0.18, hz: d / 2, yaw: o.yaw || 0, hazard: 'spike', tag: 'spikes', noSafe: true }));
    this.col.noSafe = true;
  }
  update(dt) { this.obj.update(dt); }
}

// ------------------------------------------------------------------ periodic spike trap
export class SpikeTrap {
  constructor(level, x, y, z, o = {}) {
    this.obj = buildObject('spikeTrap');
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.s = o.s ?? 1;
    this.node.scale.set(this.s, 1, this.s);
    this.x = x; this.y = y; this.z = z;
    this.period = (o.period ?? 2.4) / HS(); this.up = o.up ?? 0.45; this.t = (o.phase ?? 0) * this.period;
    this.raised = 0;
  }
  update(dt) {
    this.t += dt;
    const u = (this.t % this.period) / this.period;
    // 0..0.15 warn shake, 0.15..0.15+up raised, then lowered
    let target = 0, warn = false;
    if (u < 0.12) warn = true;
    else if (u < 0.12 + this.up) target = 1;
    this.raised += (target - this.raised) * Math.min(1, dt * (target > this.raised ? 30 : 10));
    this.obj.setRaised(this.raised);
    this.node.position.x = this.x + (warn ? Math.sin(this.t * 80) * 0.03 : 0);
    if (warn && Math.random() < dt * 20) CTX.fx.dust({ x: this.x, y: this.y, z: this.z }, 1, 0.4);
    this.obj.update(dt);
    if (this.raised > 0.6) {
      const p = CTX.player;
      const h = 0.5 * this.s;
      if (Math.abs(p.pos.x - this.x) < h + 0.25 && Math.abs(p.pos.z - this.z) < h + 0.25 && p.pos.y < this.y + 0.7 && p.pos.y > this.y - 0.3) hurtPlayer({ x: this.x, y: this.y, z: this.z }, { up: 10, knock: 3 });
    }
  }
}

// ------------------------------------------------------------------ crusher (thwomp)
export class Crusher {
  // x,z position; top: resting top height (block bottom at top), bottom: ground y it slams onto
  constructor(level, x, z, top, bottom, o = {}) {
    this.obj = buildObject('crusher');
    this.node = this.obj.root;
    this.size = o.size ?? 2;
    this.node.scale.set(this.size / 2, this.size / 2, this.size / 2);
    this.node.rotation.y = o.yaw || 0;
    this.x = x; this.z = z; this.top = top; this.bottom = bottom;
    this.y = top; // y = bottom face height
    this.state = 'up'; this.t = (o.phase ?? 0) * 3;
    this.wait = (o.wait ?? 1.4) / HS(); this.downWait = o.downWait ?? 1.0;
    const hs = this.size / 2;
    this.col = level.physics.add(new Collider({ type: 'box', x, y: this.y + hs, z, hx: hs, hy: hs, hz: hs, moving: true, tag: 'crusher', camBlock: false }));
    this.trigger = o.trigger ?? false; // slam when player below
    this.node.position.set(x, this.y + hs, z);
  }
  update(dt) {
    this.t += dt;
    const hs = this.size / 2;
    const p = CTX.player;
    const under = Math.abs(p.pos.x - this.x) < hs + 0.3 && Math.abs(p.pos.z - this.z) < hs + 0.3 && p.pos.y < this.y && p.pos.y > this.bottom - 0.5;
    if (this.state === 'up') {
      this.obj.setFace(this.t > this.wait - 0.5 ? 'angry' : 'sleep');
      if (this.t > this.wait - 0.35 && this.t < this.wait) this.node.position.x = this.x + Math.sin(this.t * 70) * 0.05;
      if (this.t >= this.wait && (!this.trigger || under)) { this.state = 'down'; this.t = 0; this.v = 0; }
    } else if (this.state === 'down') {
      this.v += 60 * dt;
      this.y -= this.v * dt;
      if (under && p.pos.y + 1.0 > this.y) hurtPlayer({ x: this.x, y: this.y, z: this.z }, { knock: 8, up: 4 });
      if (this.y <= this.bottom) {
        this.y = this.bottom; this.state = 'downWait'; this.t = 0;
        CTX.fx.shock({ x: this.x, y: this.bottom, z: this.z }, this.size * 1.5);
        const d = Math.hypot(p.pos.x - this.x, p.pos.z - this.z);
        if (d < 14) CTX.fx.shake(0.3 * (1 - d / 14), 0.25);
        if (CTX.audio && d < 22) CTX.audio.sfx('crusher', { vol: 1 - d / 22 });
      }
    } else if (this.state === 'downWait') {
      if (this.t >= this.downWait) { this.state = 'rise'; this.t = 0; }
    } else if (this.state === 'rise') {
      this.y = Math.min(this.top, this.y + 3.2 * HS() * dt);
      if (this.y >= this.top) { this.state = 'up'; this.t = 0; }
    }
    this.col.moveTo(this.x, this.y + hs, this.z);
    this.node.position.set(this.state === 'up' ? this.node.position.x : this.x, this.y + hs, this.z);
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ firebar (rotating chain)
export class Firebar {
  constructor(level, x, y, z, o = {}) {
    this.n = o.n ?? 6; this.sp = o.spacing ?? 0.55;
    this.obj = buildObject('firebar', { n: this.n, spacing: this.sp });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.speed = (o.speed ?? 1.6) * HS() * (o.dir ?? 1);
    this.ang = o.phase ?? 0;
    this.double = !!o.double;
  }
  update(dt) {
    this.ang += this.speed * dt;
    this.node.rotation.y = this.ang;
    this.obj.update(dt);
    const c = playerCenter();
    const dx = Math.cos(-this.ang), dz = Math.sin(-this.ang);
    // ball i at local +X * i*sp -> world: rotate by yaw ang
    const wx = Math.cos(this.ang), wz = -Math.sin(this.ang);
    void dx; void dz;
    if (Math.abs(c.y - this.pos.y) > 0.9) return;
    for (let i = 1; i < this.n; i++) {
      const bx = this.pos.x + wx * i * this.sp, bz = this.pos.z + wz * i * this.sp;
      if ((c.x - bx) ** 2 + (c.z - bz) ** 2 < 0.55 * 0.55) { hurtPlayer({ x: bx, y: this.pos.y, z: bz }); return; }
      if (this.double) {
        const b2x = this.pos.x - wx * i * this.sp, b2z = this.pos.z - wz * i * this.sp;
        if ((c.x - b2x) ** 2 + (c.z - b2z) ** 2 < 0.55 * 0.55) { hurtPlayer({ x: b2x, y: this.pos.y, z: b2z }); return; }
      }
    }
  }
}

// ------------------------------------------------------------------ laser beam (on/off cycle, optional sweep)
export class Laser {
  constructor(level, x, y, z, yaw, o = {}) {
    this.obj = buildObject('laserEmitter');
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.yaw = yaw; this.yaw0 = yaw;
    this.len = o.length ?? 10;
    this.on = o.on ?? 2; this.off = o.off ?? 1.6;
    this.on /= HS(); this.off /= HS();
    this.t = (o.phase ?? 0) * (this.on + this.off);
    this.sweep = o.sweep || 0; this.sweepSpeed = (o.sweepSpeed ?? 0.8) * HS();
    this.always = !!o.always;
  }
  update(dt) {
    this.t += dt;
    if (this.sweep) this.yaw = this.yaw0 + Math.sin(this.t * this.sweepSpeed) * this.sweep;
    this.node.rotation.y = this.yaw;
    const cyc = this.on + this.off;
    const u = this.always ? 0 : this.t % cyc;
    const active = this.always || u < this.on;
    const warn = !active && u > cyc - 0.6;
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    let len = this.len;
    const ph = CTX.physics;
    const f = ph.raycast(this.pos.x + dx * 0.4, this.pos.y, this.pos.z + dz * 0.4, this.pos.x + dx * this.len, this.pos.y, this.pos.z + dz * this.len);
    len = Math.max(0.5, this.len * f);
    this.obj.setBeam(active || warn, warn ? 0.01 : len);
    if (warn) this.obj.setBeam(true, Math.min(len, 0.6 + Math.sin(this.t * 40) * 0.3));
    this.obj.update(dt);
    if (active) {
      const c = playerCenter();
      if (Math.abs(c.y - this.pos.y) < 0.75) {
        const d = distPointSegXZ(c.x, c.z, this.pos.x, this.pos.z, this.pos.x + dx * len, this.pos.z + dz * len);
        if (d < 0.38) hurtPlayer({ x: c.x - dz * 0.1, y: this.pos.y, z: c.z + dx * 0.1 }, { knock: 5, up: 7 });
      }
      if (Math.random() < dt * 10) CTX.fx.sparkle({ x: this.pos.x + dx * len, y: this.pos.y, z: this.pos.z + dz * len }, [1, 0.6, 0.8], 2, 0.15);
    }
  }
}

// ------------------------------------------------------------------ wind zone (pushes player; heavy animals resist)
export class WindZone {
  constructor(level, x, y, z, hx, hy, hz, force, o = {}) {
    this.box = { x, y, z, hx, hy, hz };
    this.force = new Vec3(force[0], force[1], force[2]);
    this.node = new Node('wind');
    this.fan = o.fan !== false ? buildObject('windFan') : null;
    if (this.fan) {
      this.fan.root.position.set(o.fanPos ? o.fanPos[0] : x - force[0] / (Math.hypot(force[0], force[2]) || 1) * hx, o.fanPos ? o.fanPos[1] : y - hy, o.fanPos ? o.fanPos[2] : z - force[2] / (Math.hypot(force[0], force[2]) || 1) * hz);
      this.fan.root.rotation.y = Math.atan2(force[0], force[2]);
      this.node.add(this.fan.root);
    }
    this.on = o.on ?? 0; this.off = o.off ?? 0; this.t = 0;
    this.active = true;
    this.signal = o.signal || null;
    if (this.signal) { this.active = false; level.onSignal(this.signal, (v) => { this.active = v; }); }
  }
  update(dt) {
    this.t += dt;
    let on = this.active;
    if (this.on > 0) on = on && (this.t % (this.on + this.off)) < this.on;
    if (this.fan) this.fan.update(dt, on ? 1 : 0.05);
    if (!on) return;
    const b = this.box;
    // streak particles
    if (Math.random() < dt * 12) {
      const pos = { x: b.x + (Math.random() * 2 - 1) * b.hx, y: b.y + (Math.random() * 2 - 1) * b.hy, z: b.z + (Math.random() * 2 - 1) * b.hz };
      const l = this.force.length() || 1;
      CTX.particles.emit({ pos, count: 1, dir: { x: this.force.x / l, y: this.force.y / l, z: this.force.z / l }, spread: 0.05, speed: [6, 9], life: 0.5, size: 0.12, sizeEnd: 0.05, color: [1, 1, 1], alpha: 0.6, tile: 0, additive: true, stretch: 0.15 });
    }
    const p = CTX.player;
    if (Math.abs(p.pos.x - b.x) < b.hx && Math.abs(p.pos.y + 0.5 - b.y) < b.hy && Math.abs(p.pos.z - b.z) < b.hz) {
      const k = p.heavy ? 0.15 : 1;
      p.vel.x += this.force.x * k * dt; p.vel.z += this.force.z * k * dt;
      p.vel.y += this.force.y * k * dt;
      if (this.force.y > 0 && p.vel.y > this.force.y * 0.6) p.vel.y = this.force.y * 0.6;
      if (this.force.y > 0) { p.body.grounded = false; }
    }
  }
}

// ------------------------------------------------------------------ rolling balls (spawner along a path)
export class Roller {
  constructor(level, a, b, o = {}) {
    this.level = level;
    this.a = new Vec3(...a); this.b = new Vec3(...b);
    this.period = (o.period ?? 3) / HS(); this.t = (o.phase ?? 0) * this.period;
    this.speed = (o.speed ?? 5) * HS();
    this.r = o.r ?? 0.7;
    this.balls = [];
    this.node = new Node('rollers');
    this.style = o.style || 'rock';
    this.color = o.color ?? 0xb8aac8;
  }
  _make() {
    const m = new Mesh(G.rockGeo(this.r, Math.random() * 100, 0.15, 1), new Material({ color: this.color, rim: 0.3 }));
    if (this.style === 'snow') m.material = new Material({ color: 0xf4f8ff, rim: 0.4, spec: 0.2 });
    this.node.add(m);
    return m;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.period) { this.t -= this.period; this.balls.push({ m: this._make(), d: 0 }); }
    const L = this.a.distanceTo(this.b);
    const dir = new Vec3().subVectors(this.b, this.a).normalize();
    const c = playerCenter();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const bl = this.balls[i];
      bl.d += this.speed * dt;
      const p = new Vec3().copy(this.a).addScaled(dir, bl.d);
      bl.m.position.set(p.x, p.y + this.r, p.z);
      bl.m.rotation.x += this.speed / this.r * dt * Math.sign(dir.z || 1);
      bl.m.rotation.z -= this.speed / this.r * dt * dir.x;
      if (bl.d > L) {
        bl.m.position.y -= (bl.d - L) * 3;
        if (bl.d > L + 4) { bl.m.removeFromParent(); this.balls.splice(i, 1); }
        continue;
      }
      if ((c.x - p.x) ** 2 + (c.y - p.y - this.r) ** 2 + (c.z - p.z) ** 2 < (this.r + 0.35) ** 2) hurtPlayer({ x: p.x, y: p.y, z: p.z }, { knock: 8, up: 8 });
      if (Math.random() < dt * 10) CTX.fx.dust(p, 1, 0.6);
    }
  }
}

// ------------------------------------------------------------------ falling icicle / rock (drops when player passes under)
export class Dropper {
  constructor(level, x, y, z, o = {}) {
    this.home = new Vec3(x, y, z);
    this.pos = this.home.clone();
    const ice = (o.style || 'ice') === 'ice';
    this.node = new Mesh(G.coneGeo(0.35, 1.2, 8, true), new Material({ color: ice ? 0xcff0ff : 0xa89ab8, spec: ice ? 0.5 : 0, rim: 0.5, transparent: ice, opacity: ice ? 0.9 : 1 }));
    this.node.rotation.x = Math.PI;
    this.node.position.copy(this.pos);
    this.state = 'idle'; this.t = 0; this.v = 0;
    this.ground = o.ground ?? (y - 8);
  }
  update(dt) {
    this.t += dt;
    const p = CTX.player;
    if (this.state === 'idle') {
      if (Math.hypot(p.pos.x - this.home.x, p.pos.z - this.home.z) < 1.6 && p.pos.y < this.home.y && p.pos.y > this.ground - 1) { this.state = 'shake'; this.t = 0; }
    } else if (this.state === 'shake') {
      this.node.position.x = this.home.x + Math.sin(this.t * 60) * 0.05;
      if (this.t > 0.45) { this.state = 'fall'; this.t = 0; this.v = 0; }
    } else if (this.state === 'fall') {
      this.v += 25 * dt;
      this.pos.y -= this.v * dt;
      this.node.position.set(this.home.x, this.pos.y, this.home.z);
      const c = playerCenter();
      if (Math.hypot(c.x - this.home.x, c.z - this.home.z) < 0.6 && Math.abs(c.y - (this.pos.y - 0.4)) < 0.8) hurtPlayer(this.pos);
      if (this.pos.y < this.ground) { CTX.fx.iceBurst({ x: this.home.x, y: this.ground + 0.3, z: this.home.z }); this.state = 'gone'; this.t = 0; this.node.visible = false; }
    } else if (this.state === 'gone') {
      if (this.t > 2.5) { this.pos.copy(this.home); this.node.position.copy(this.home); this.node.visible = true; this.node.scale.set(0.01, 0.01, 0.01); this.state = 'grow'; this.t = 0; }
    } else if (this.state === 'grow') {
      const k = Math.min(1, this.t / 0.5); this.node.scale.set(k, k, k);
      if (k >= 1) this.state = 'idle';
    }
  }
}

// ------------------------------------------------------------------ fog goo (hazard floor patch)
export class FogGoo {
  constructor(level, x, y, z, w, d) {
    const m = new Mesh(G.roundedBoxGeo(w, 0.2, d, 0.1, 2), new Material({ color: 0x6a5a8a, spec: 0.4, rim: 0.5, emissive: 0x1a1030 }));
    m.position.set(x, y + 0.05, z);
    this.node = m;
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y + 0.05, z, hx: w / 2, hy: 0.1, hz: d / 2, hazard: 'goo', tag: 'goo' }));
    this.col.noSafe = true;
    this.box = { x, y, z, w, d };
  }
  update(dt) {
    if (Math.random() < dt * 4) CTX.fx.fogPuff({ x: this.box.x + (Math.random() - 0.5) * this.box.w, y: this.box.y + 0.3, z: this.box.z + (Math.random() - 0.5) * this.box.d }, 1);
  }
}
void PAL; void TAU; void Ease;

// ============================================================================
// movers.js — dynamic platforms: moving (path / function), rotating, falling,
// blinking (timed), springs, conveyors, temporary ice floes.
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Vec3, clamp, lerp, TAU, Ease } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { Collider } from '../world/physics.js';
import { buildPlatform } from '../models/platforms.js';
import { buildObject } from '../models/objects.js';

function platformNode(style, w, d, h, round) {
  return buildPlatform(style, w, d, h, { round });
}
function colliderFor(x, y, z, w, d, h, round, yaw = 0, extra = {}) {
  if (round) return new Collider({ type: 'cyl', x, y: y - h / 2, z, hx: w / 2, hy: h / 2, moving: true, ...extra });
  return new Collider({ type: 'box', x, y: y - h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw, moving: true, ...extra });
}

// ------------------------------------------------------------------ moving platform
export class MovingPlatform {
  // path: [[x,y,z],...] (top-center positions) ; o: {speed, wait, loop, phase, fn(t)->[x,y,z], stand (start on stand), yawSpeed}
  constructor(level, style, w, d, h, path, o = {}) {
    this.level = level;
    this.path = path.map((p) => new Vec3(p[0], p[1], p[2]));
    this.o = o;
    this.speed = (o.speed ?? 2.5) * (CTX.diff ? CTX.diff.hazardSpeed : 1);
    this.wait = o.wait ?? 0.6;
    this.round = !!o.round;
    this.h = h; this.w = w; this.d = d;
    this.node = platformNode(style, w, d, h, this.round);
    const p0 = this.path[0];
    this.col = level.physics.add(colliderFor(p0.x, p0.y, p0.z, w, d, h, this.round, o.yaw || 0, { surface: o.surface, tag: 'mover', owner: this }));
    this.node.position.copy(p0);
    this.node.rotation.y = o.yaw || 0;
    // segment lengths
    this.lens = [];
    this.total = 0;
    const n = this.path.length;
    const segs = o.loop ? n : n - 1;
    for (let i = 0; i < segs; i++) { const l = this.path[i].distanceTo(this.path[(i + 1) % n]); this.lens.push(l); this.total += l; }
    this.t = (o.phase ?? 0) * (this.total / this.speed + this.wait * (o.loop ? n : 2));
    this.active = !o.stand;
    this.yaw = o.yaw || 0;
    this.pos = p0.clone();
  }
  posAt(t, out) {
    const o = this.o;
    if (o.fn) { const r = o.fn(t); return out.set(r[0], r[1], r[2]); }
    const n = this.path.length;
    if (n === 1) return out.copy(this.path[0]);
    const travel = this.total / this.speed;
    if (o.loop) {
      const cycle = travel + this.wait * n;
      let u = t % cycle;
      for (let i = 0; i < n; i++) {
        const segT = this.lens[i] / this.speed;
        if (u < this.wait) return out.copy(this.path[i]);
        u -= this.wait;
        if (u < segT) return out.lerpVectors(this.path[i], this.path[(i + 1) % n], Ease.inOutSine(u / segT));
        u -= segT;
      }
      return out.copy(this.path[0]);
    }
    // ping-pong
    const cycle = (travel + this.wait) * 2;
    let u = t % cycle;
    let forward = true;
    if (u >= travel + this.wait) { u -= travel + this.wait; forward = false; }
    if (u < this.wait) return out.copy(forward ? this.path[0] : this.path[n - 1]);
    u -= this.wait;
    let dist = (u / travel) * this.total;
    if (!forward) dist = this.total - dist;
    for (let i = 0; i < n - 1; i++) {
      if (dist <= this.lens[i] || i === n - 2) {
        const k = clamp(dist / (this.lens[i] || 1), 0, 1);
        return out.lerpVectors(this.path[i], this.path[i + 1], n === 2 ? Ease.inOutSine(k) : k);
      }
      dist -= this.lens[i];
    }
    return out;
  }
  update(dt) {
    if (!this.active) {
      const p = CTX.player;
      if (p && p.body.grounded && p.body.ground === this.col) this.active = true; else return;
    }
    this.t += dt;
    this.posAt(this.t, this.pos);
    if (this.o.yawSpeed) this.yaw += this.o.yawSpeed * dt;
    this.col.moveTo(this.pos.x, this.pos.y - this.h / 2, this.pos.z, this.yaw);
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
  }
}

// ------------------------------------------------------------------ rotating platform (spins around its center)
export class RotatingPlatform {
  constructor(level, style, x, y, z, w, d, h, o = {}) {
    this.node = platformNode(style, w, d, h, false);
    this.node.position.set(x, y, z);
    this.yaw = o.yaw || 0;
    this.speed = (o.speed ?? 0.8) * (CTX.diff ? CTX.diff.hazardSpeed : 1);
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y - h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: this.yaw, moving: true, tag: 'rotator' }));
    this.h = h;
  }
  update(dt) {
    this.yaw += this.speed * dt;
    this.col.moveTo(this.col.x, this.col.y, this.col.z, this.yaw);
    this.node.rotation.y = this.yaw;
  }
}

// ------------------------------------------------------------------ falling platform
export class FallingPlatform {
  constructor(level, style, x, y, z, w, d, h, o = {}) {
    this.level = level;
    this.home = new Vec3(x, y, z);
    this.node = platformNode(style || 'biscuit', w, d, h, !!o.round);
    this.node.position.copy(this.home);
    this.h = h;
    this.col = level.physics.add(colliderFor(x, y, z, w, d, h, !!o.round, 0, { tag: 'falling', surface: 'crumble', owner: this }));
    this.state = 'idle'; this.t = 0;
    this.delay = o.delay ?? 0.55;
    this.respawn = o.respawn ?? 3;
    this.vy = 0;
    this.pos = this.home.clone();
  }
  update(dt) {
    const p = CTX.player;
    this.t += dt;
    if (this.state === 'idle') {
      if (p && p.body.grounded && p.body.ground === this.col) { this.state = 'shake'; this.t = 0; if (CTX.audio) CTX.audio.sfx('crumble', { vol: 0.5 }); }
    } else if (this.state === 'shake') {
      const k = this.t / this.delay;
      this.node.position.set(this.home.x + Math.sin(this.t * 60) * 0.05 * k, this.home.y, this.home.z + Math.cos(this.t * 55) * 0.05 * k);
      if (Math.random() < dt * 20) CTX.fx.dust({ x: this.home.x + (Math.random() - 0.5), y: this.home.y - this.h, z: this.home.z + (Math.random() - 0.5) }, 1, 0.5);
      if (this.t >= this.delay) { this.state = 'fall'; this.t = 0; this.vy = 0; }
    } else if (this.state === 'fall') {
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      this.col.moveTo(this.pos.x, this.pos.y - this.h / 2, this.pos.z);
      this.node.position.copy(this.pos);
      if (this.t > 0.6) this.col.enabled = false;
      if (this.t > this.respawn) { this.state = 'return'; this.t = 0; this.pos.copy(this.home); this.col.moveTo(this.home.x, this.home.y - this.h / 2, this.home.z); this.node.position.copy(this.home); this.node.scale.set(0.01, 0.01, 0.01); }
    } else if (this.state === 'return') {
      const k = Math.min(1, this.t / 0.4);
      const s = Ease.outBack(k);
      this.node.scale.set(s, s, s);
      if (k >= 1) {
        // don't re-enable while the player overlaps
        this.col.enabled = true; this.state = 'idle'; this.t = 0;
      }
    }
  }
}

// ------------------------------------------------------------------ blinking platform (timed on/off)
export class BlinkPlatform {
  constructor(level, style, x, y, z, w, d, h, o = {}) {
    this.node = platformNode(style || 'bubble', w, d, h, !!o.round);
    this.node.position.set(x, y, z);
    this.col = level.physics.add(colliderFor(x, y, z, w, d, h, !!o.round, 0, { tag: 'blink' }));
    this.col.moving = false;
    level.physics.remove(this.col); level.physics.dynamics.push(this.col); // keep in dynamic list (enable toggles)
    this.on = o.on ?? 2.5; this.off = o.off ?? 1.5;
    const hs = CTX.diff ? CTX.diff.hazardSpeed : 1;
    this.on /= hs; this.off /= hs;
    this.t = (o.phase ?? 0) * (this.on + this.off);
    this.inv = !!o.inv;
  }
  update(dt) {
    this.t += dt;
    const cyc = this.on + this.off;
    const u = this.t % cyc;
    const visible = u < this.on;
    const warn = visible && u > this.on - 0.7;
    this.col.enabled = visible;
    this.node.visible = visible && !(warn && Math.floor(u * 14) % 2 === 0);
    const s = visible ? (u < 0.2 ? Ease.outBack(u / 0.2) : 1) : 0;
    this.node.scale.set(s, s, s);
  }
}

// ------------------------------------------------------------------ spring pad
export class Spring {
  constructor(level, x, y, z, o = {}) {
    this.obj = buildObject('springPad', { style: o.style || 'mushroom' });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.power = o.power ?? 17;
    this.col = level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.25, z, hx: 0.6, hy: 0.25, surface: 'bouncy', bounce: this.power, owner: this, tag: 'spring' }));
    this.col.moving = false;
  }
  onBounce() { this.obj.bounce(1.2); if (CTX.audio) CTX.audio.sfx('bounce'); CTX.fx.sparkle({ x: this.node.position.x, y: this.node.position.y + 0.5, z: this.node.position.z }, [1, 0.8, 0.9], 8, 0.5); }
  update(dt) { this.obj.update(dt); }
}

// ------------------------------------------------------------------ temporary ice floe (penguin snowball on water)
export class IceFloe {
  constructor(level, x, y, z) {
    this.node = buildPlatform('ice', 1.8, 1.8, 0.4, { round: true });
    this.node.position.set(x, y + 0.05, z);
    this.col = level.physics.add(new Collider({ type: 'cyl', x, y: y - 0.15, z, hx: 0.9, hy: 0.2, moving: true, surface: 'ice', tag: 'floe' }));
    this.t = 0; this.y = y;
    CTX.fx.iceBurst({ x, y: y + 0.2, z });
    if (CTX.audio) CTX.audio.sfx('ice');
  }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 0.25);
    this.node.scale.set(k, 1, k);
    this.node.position.y = this.y + 0.05 + Math.sin(this.t * 2) * 0.03;
    const left = 7 - this.t;
    if (left < 1.2) this.node.visible = Math.floor(this.t * 10) % 2 === 0;
    if (left <= 0) { CTX.physics.remove(this.col); this.node.removeFromParent(); this.dead = true; }
  }
}
void Node; void lerp; void TAU;

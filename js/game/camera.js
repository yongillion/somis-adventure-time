// ============================================================================
// camera.js — platformer camera: designer zones + gentle user rotation,
// vertical dead-zone, look-ahead, collision pull-in, shake.
// ============================================================================
import { Vec3, damp, dampAngle, clamp, angleDiff, lerp } from '../engine/math.js';
import { CTX } from './ctx.js';

export class CameraController {
  constructor(camera) {
    this.cam = camera;
    this.def = { yaw: 0, pitch: 0.5, dist: 8.4, fov: 50, height: 1.0 };
    this.cur = { ...this.def };
    this.want = { ...this.def };
    this.userYaw = 0;
    this.userPitch = 0;
    this.zones = [];
    this.zone = null;
    this.focus = new Vec3();
    this.baseY = 0;
    this.look = new Vec3();
    this.shakeAmt = 0; this.shakeDur = 0; this.shakeT = 0;
    this.mode = 'follow';
    this.distFrac = 1;
    this.collide = true;
    this._tmp = new Vec3();
    this.override = null; // {pos, target} for scripted shots
    this.boss = null; // focus helper during boss fights {pos:Vec3, weight (fraction 0..1 toward the boss), y?: fn -> boss center height}
    this.off = new Vec3(); // smoothed framing offset (boss fights)
  }
  setDefaults(d) { Object.assign(this.def, d); }
  setZones(z) { this.zones = z || []; this.zone = null; }
  shake(a, d) { this.shakeAmt = Math.max(this.shakeAmt, a); this.shakeDur = Math.max(d, 0.05); this.shakeT = d; }

  _pickZone(p) {
    let best = null;
    for (const z of this.zones) {
      if (Math.abs(p.x - z.x) <= z.hx && Math.abs(p.y - z.y) <= z.hy && Math.abs(p.z - z.z) <= z.hz) {
        if (!best || (z.priority || 0) >= (best.priority || 0)) best = z;
      }
    }
    return best;
  }

  snap(player) {
    this.off.set(0, 0, 0);
    this._updateWant(player);
    Object.assign(this.cur, this.want);
    this.userYaw = 0; this.userPitch = 0;
    this.focus.set(player.pos.x, player.pos.y, player.pos.z);
    this.baseY = player.pos.y;
    this.look.set(0, 0, 0);
    this.distFrac = 1;
    this._apply(0);
  }
  _updateWant(player) {
    const z = this._pickZone(player.pos);
    if (z !== this.zone) {
      this.zone = z;
      if (z && z.lockYaw) this.userYaw = 0;
    }
    const src = z || this.def;
    this.want.yaw = src.yaw ?? this.def.yaw;
    this.want.pitch = src.pitch ?? this.def.pitch;
    this.want.dist = src.dist ?? this.def.dist;
    this.want.fov = src.fov ?? this.def.fov;
    this.want.height = src.height ?? this.def.height;
  }

  update(dt, player, input) {
    if (this.mode !== 'follow') { this._shakeOnly(dt); return; }
    this._updateWant(player);
    // user rotation
    const locked = this.zone && this.zone.lockYaw;
    if (!locked && input) {
      this.userYaw += input.cam.x * 2.4 * dt + (input.camDragPx || 0) * 0.0065;
      this.userPitch = clamp(this.userPitch + input.cam.y * 1.2 * dt, -0.25, 0.45);
    } else this.userYaw = damp(this.userYaw, 0, 3, dt);
    const lam = 2.6;
    this.cur.yaw = dampAngle(this.cur.yaw, this.want.yaw, lam, dt);
    this.cur.pitch = damp(this.cur.pitch, this.want.pitch, lam, dt);
    this.cur.dist = damp(this.cur.dist, this.want.dist, lam, dt);
    this.cur.fov = damp(this.cur.fov, this.want.fov, lam, dt);
    this.cur.height = damp(this.cur.height, this.want.height, lam, dt);
    // focus tracking
    const p = player.pos;
    const v = player.vel;
    this.look.x = damp(this.look.x, v.x * 0.28, 3, dt);
    this.look.z = damp(this.look.z, v.z * 0.28, 3, dt);
    this.focus.x = damp(this.focus.x, p.x + this.look.x, 7, dt);
    this.focus.z = damp(this.focus.z, p.z + this.look.z, 7, dt);
    const grounded = player.body.grounded || player.state === 'swim' || player.state === 'climb';
    if (grounded) this.baseY = damp(this.baseY, p.y, 5, dt);
    else {
      if (p.y > this.baseY + 2.4) this.baseY = damp(this.baseY, p.y - 2.4, 9, dt);
      if (p.y < this.baseY - 0.6) this.baseY = damp(this.baseY, p.y + 0.6, 10, dt);
      if (player.state === 'hover' || player.state === 'fly') this.baseY = damp(this.baseY, p.y - 0.8, 1.5, dt);
    }
    this.focus.y = this.baseY;
    // boss framing: a smoothed offset toward the boss (fraction of the distance, capped), also upward for tall/flying bosses
    let ox = 0, oy = 0, oz = 0;
    if (this.boss && this.boss.pos) {
      const w = this.boss.weight ?? 0.3;
      ox = (this.boss.pos.x - p.x) * w; oz = (this.boss.pos.z - p.z) * w;
      const ol = Math.hypot(ox, oz), mx = this.boss.max ?? 4.5;
      if (ol > mx) { ox *= mx / ol; oz *= mx / ol; }
      const by = this.boss.y ? this.boss.y() : this.boss.pos.y;
      if (by > p.y + 2.2) oy = Math.min(3, (by - p.y - 2.2) * 0.45);
    }
    this.off.x = damp(this.off.x, ox, 2.5, dt); this.off.y = damp(this.off.y, oy, 2.0, dt); this.off.z = damp(this.off.z, oz, 2.5, dt);
    this._apply(dt);
  }

  _apply(dt) {
    const c = this.cam, cur = this.cur;
    const yaw = cur.yaw + this.userYaw, pitch = clamp(cur.pitch + this.userPitch, -0.2, 1.35);
    const tx = this.focus.x + this.off.x, ty = this.focus.y + cur.height + this.off.y, tz = this.focus.z + this.off.z;
    let dist = cur.dist;
    const ox = Math.sin(yaw) * Math.cos(pitch), oy = Math.sin(pitch), oz = Math.cos(yaw) * Math.cos(pitch);
    // collision pull-in
    if (this.collide && CTX.physics) {
      const fx = tx + ox * dist, fy = ty + oy * dist, fz = tz + oz * dist;
      const f = CTX.physics.raycast(tx, ty, tz, fx, fy, fz, (cc) => cc.camBlock !== false && cc.hy > 0.3);
      const want = f < 1 ? Math.max(0.25, f - 0.06) : 1;
      if (want < this.distFrac) this.distFrac = want; else this.distFrac = damp(this.distFrac, want, 2.5, dt);
      dist *= this.distFrac;
    }
    c.fov = (cur.fov * Math.PI) / 180;
    c.position.set(tx + ox * dist, ty + oy * dist, tz + oz * dist);
    c.target.set(tx, ty, tz);
    this._shakeOnly(dt);
  }
  _shakeOnly(dt) {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / this.shakeDur) * this.shakeAmt * (CTX.settingsShake === false ? 0.25 : 1);
      const t = performance.now() * 0.05;
      const sx = Math.sin(t * 1.7) * k, sy = Math.cos(t * 2.3) * k * 0.8, sz = Math.sin(t * 1.3 + 1) * k;
      this.cam.position.x += sx; this.cam.position.y += sy; this.cam.position.z += sz;
      this.cam.target.x += sx * 0.5; this.cam.target.y += sy * 0.5; this.cam.target.z += sz * 0.5;
    }
  }
  // camera-relative basis (for movement input)
  basis() {
    const yaw = this.cur.yaw + this.userYaw;
    return { fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw), yaw };
  }
}
void angleDiff;

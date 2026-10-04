// ============================================================================
// projectiles.js — pooled projectiles for player, pets and enemies
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Vec3, clamp } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { buildProjModel } from '../models/projmodels.js';
import { PAL } from '../fx.js';

const ENEMY_MODEL_KINDS = new Set(['seed', 'snowball']);

class Proj {
  constructor() { this.pos = new Vec3(); this.vel = new Vec3(); this.alive = false; this.hitSet = new Set(); }
}

export class Projectiles {
  constructor(scene) {
    this.root = new Node('projectiles');
    scene.add(this.root);
    this.list = [];
    this.pools = new Map();
  }
  _model(kind) {
    let pool = this.pools.get(kind);
    if (!pool) { pool = []; this.pools.set(kind, pool); }
    const n = pool.pop() || buildProjModel(kind);
    n.visible = true;
    n.userData.kind = kind;
    this.root.add(n);
    return n;
  }
  _release(p) {
    if (p.node) { p.node.removeFromParent(); p.node.visible = false; const pool = this.pools.get(p.modelKey || p.kind); if (pool) pool.push(p.node); p.node = null; }
  }
  clear() {
    if (this._updating) { this._clearPending = true; for (const p of this.list) p.alive = false; return; }
    for (const p of this.list) this._kill(p);
    this.list.length = 0;
  }

  // o: { kind, pos, vel, life, dmg, tags, team, r, gravity, bounce, pierce, ground, boom, spin, boomerang, homing, onHit, knock, slow, scale, stun }
  spawn(o) {
    const p = new Proj();
    p.alive = true;
    p.kind = o.kind || 'puff';
    // enemies use the bigger, readable enemy models for kinds shared with player shots
    p.modelKey = (o.team === 'enemy' && ENEMY_MODEL_KINDS.has(p.kind)) ? 'e:' + p.kind : p.kind;
    p.node = this._model(p.modelKey);
    p.pos.copy(o.pos);
    p.vel.copy(o.vel);
    p.life = o.life ?? 1;
    p.age = 0;
    p.dmg = o.dmg ?? 1;
    p.tags = o.tags || [];
    p.team = o.team || 'player';
    p.r = o.r ?? 0.3;
    p.gravity = o.gravity ?? 0;
    p.bounce = o.bounce ?? 0;
    p.pierce = !!o.pierce;
    p.ground = !!o.ground;
    p.boom = o.boom || 0;
    p.spin = o.spin ?? 0;
    p.boomerang = o.boomerang || null; // {owner, range, speed, out:true}
    p.homing = o.homing || 0;
    p.onHit = o.onHit || null;
    p.knock = o.knock ?? 4;
    p.slow = !!o.slow;
    p.stun = o.stun || 0;
    p.trail = o.trail || null;
    p.scale = o.scale ?? 1;
    p.from = o.from || 'player';
    p.reflectable = o.reflectable ?? true;
    p.startPos = p.pos.clone();
    p.hitSet.clear();
    p.node.scale.set(p.scale, p.scale, p.scale);
    p.node.position.copy(p.pos);
    p.node.rotation.set(0, Math.atan2(p.vel.x, p.vel.z), 0);
    this.list.push(p);
    return p;
  }

  update(dt) {
    this._updating = true;
    try { this._update(dt); } finally { this._updating = false; }
    if (this._clearPending) { this._clearPending = false; this.clear(); }
  }
  _update(dt) {
    const ph = CTX.physics, player = CTX.player, level = CTX.level;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p) continue;
      p.age += dt;
      if (!p.alive || p.age > p.life) { this._kill(p, false); this.list.splice(i, 1); continue; }
      // motion
      if (p.boomerang) {
        const b = p.boomerang;
        const owner = b.owner;
        if (b.out) {
          if (p.pos.distXZ(p.startPos) > b.range || p.age > b.range / b.speed + 0.1) { b.out = false; p.hitSet.clear(); }
        } else {
          const tx = owner.pos.x - p.pos.x, ty = owner.pos.y + 0.6 - p.pos.y, tz = owner.pos.z - p.pos.z;
          const d = Math.hypot(tx, ty, tz);
          if (d < 0.6) { p.alive = false; continue; }
          const sp = b.speed * 1.15;
          p.vel.set(tx / d * sp, ty / d * sp, tz / d * sp);
          p.life = p.age + 2;
        }
      }
      if (p.homing && p.team === 'player') {
        const t = level.nearestEnemy(p.pos.x, p.pos.y, p.pos.z, 9);
        if (t) {
          const tx = t.pos.x - p.pos.x, ty = t.pos.y + t.centerY - p.pos.y, tz = t.pos.z - p.pos.z;
          const d = Math.hypot(tx, ty, tz) || 1, sp = p.vel.length();
          p.vel.x += (tx / d * sp - p.vel.x) * Math.min(1, p.homing * dt);
          p.vel.y += (ty / d * sp - p.vel.y) * Math.min(1, p.homing * dt);
          p.vel.z += (tz / d * sp - p.vel.z) * Math.min(1, p.homing * dt);
        }
      }
      p.vel.y -= p.gravity * dt;
      const nx = p.pos.x + p.vel.x * dt, ny = p.pos.y + p.vel.y * dt, nz = p.pos.z + p.vel.z * dt;
      // world collision
      let blocked = false;
      if (p.ground) {
        const gnd = ph.groundBelow(nx, ny + 0.6, nz, 1.6);
        if (gnd) { p.pos.set(nx, gnd.y + 0.15, nz); p.vel.y = 0; }
        else { p.pos.set(nx, ny, nz); }
        const wall = ph.solidAt(nx, p.pos.y + 0.1, nz);
        if (wall) blocked = true;
      } else {
        const s = ph.solidAt(nx, ny, nz);
        if (s) blocked = true;
        else p.pos.set(nx, ny, nz);
      }
      if (blocked) {
        if (p.bounce > 0) {
          p.bounce--;
          // reflect: figure axis (vertical if we came from above)
          const top = ph.groundBelow(nx, p.pos.y + 0.05, nz, 0.4);
          if (top && p.vel.y < 0) { p.vel.y = Math.abs(p.vel.y) * 0.65 + 2; }
          else { p.vel.x = -p.vel.x * 0.8; p.vel.z = -p.vel.z * 0.8; }
          if (CTX.audio) CTX.audio.sfx('bounce', { vol: 0.3, pitch: 1.3 });
        } else if (!p.boomerang) { p.alive = false; this._impact(p); }
      }
      if (p.pos.y < level.killY) p.alive = false;
      if (p.alive && !p.boomerang && ph.waters.length && p.vel.y < 0) {
        const w = ph.waterAt(p.pos.x, p.pos.y, p.pos.z);
        if (w && p.pos.y < w.top - 0.05) {
          p.alive = false;
          CTX.fx.splash({ x: p.pos.x, y: w.top, z: p.pos.z }, 0.35);
          if (p.tags.includes('ice') && p.team === 'player' && level.freezeWater) level.freezeWater(p.pos.x, w.top, p.pos.z);
        }
      }
      // hits
      if (p.alive) {
        if (p.team === 'player') {
          const info = { dmg: p.dmg * (p.from === 'player' && CTX.pet ? CTX.pet.dmgMul() : 1), tags: p.tags, dir: { x: p.vel.x, z: p.vel.z }, kind: 'proj', knock: p.knock, from: p.from, slow: p.slow, stun: p.stun, proj: p };
          const n = level.hit(p.pos.x, p.pos.y, p.pos.z, p.r, info, p.hitSet);
          if (n > 0) {
            CTX.fx.hit(p.pos, PAL.gold, 0.7);
            if (p.onHit) p.onHit(p);
            if (!p.pierce && !p.boomerang) { p.alive = false; this._impact(p); }
          }
        } else if (player && !player.dead) {
          const dx = player.pos.x - p.pos.x, dy = player.pos.y + 0.55 - p.pos.y, dz = player.pos.z - p.pos.z;
          const rr = p.r + 0.45;
          if (dx * dx + dy * dy + dz * dz < rr * rr) {
            if (player.ability && player.ability.reflects && p.reflectable) {
              p.team = 'player'; p.vel.scale(-1.3); p.hitSet.clear(); p.from = 'reflect';
              CTX.fx.hit(p.pos, PAL.sky, 0.8);
              if (CTX.audio) CTX.audio.sfx('block');
            } else {
              player.hurt(p.dmg, p.pos);
              p.alive = false; this._impact(p);
            }
          }
          // pet decoy / reflect by others could go here
        }
      }
      if (!p.alive) { this._kill(p, false); this.list.splice(i, 1); continue; }
      // visual
      const n = p.node;
      n.position.copy(p.pos);
      if (p.spin) { n.rotation.y += p.spin * dt; n.rotation.x += p.spin * 0.3 * dt; }
      else { n.rotation.y = Math.atan2(p.vel.x, p.vel.z); n.rotation.x = -Math.atan2(p.vel.y, Math.hypot(p.vel.x, p.vel.z)); }
      if (n.update) n.update(dt);
      if (p.trail && Math.random() < dt * 30) CTX.fx.trail(p.pos, p.trail, 0.22);
      // fade near end
      if (p.life - p.age < 0.15 && !p.boomerang) { const k = clamp((p.life - p.age) / 0.15, 0, 1); n.scale.set(p.scale * k, p.scale * k, p.scale * k); }
    }
  }
  _impact(p) {
    if (p.boom) {
      CTX.fx.boom(p.pos, p.boom);
      CTX.fx.shake(0.12, 0.2);
      if (CTX.audio) CTX.audio.sfx('explode', { vol: 0.6 });
      if (p.team === 'player') CTX.level.hit(p.pos.x, p.pos.y, p.pos.z, p.boom, { dmg: p.dmg, tags: p.tags, kind: 'boom', knock: 6, from: p.from }, p.hitSet);
      else if (CTX.player && CTX.player.pos.distanceTo(p.pos) < p.boom + 0.4) CTX.player.hurt(p.dmg, p.pos);
    } else if (p.tags.includes('ice')) CTX.fx.iceBurst(p.pos);
    else CTX.fx.sparkle(p.pos, PAL.white, 4, 0.2);
    if (p.tags.includes('ice') && p.team === 'player') {
      // freeze water surface into an ice floe
      const w = CTX.physics.waterAt(p.pos.x, p.pos.y - 0.3, p.pos.z);
      if (w && CTX.level.freezeWater) CTX.level.freezeWater(p.pos.x, w.top, p.pos.z);
    }
  }
  _kill(p) {
    if (p.boomerang && p.boomerang.owner) p.boomerang.owner.boomOut = Math.max(0, (p.boomerang.owner.boomOut || 1) - 1);
    this._release(p);
  }
}

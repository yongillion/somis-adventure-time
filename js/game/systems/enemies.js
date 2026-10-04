// ============================================================================
// enemies.js — fog-creature enemies: AI behaviors, damage, defeat (purify)
// ============================================================================
import { Vec3, clamp, damp, dampAngle, TAU, rand, angleDiff } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { buildEnemy } from '../models/enemies.js';
import { PAL } from '../fx.js';

export const ENEMY_DEF = {
  gloomy: { hp: 1, speed: 1.6, chase: 2.3, sight: 6, ai: 'walker', candy: 2 },
  hopper: { hp: 1, speed: 0, sight: 8, ai: 'hopper', candy: 2 },
  flyer: { hp: 1, speed: 2.2, sight: 8, ai: 'flyer', candy: 2 },
  shooter: { hp: 2, speed: 0.6, sight: 11, ai: 'shooter', candy: 3, proj: 'fogball' },
  spiky: { hp: 2, speed: 1.4, chase: 1.8, sight: 6, ai: 'walker', candy: 3, spiky: true },
  shield: { hp: 2, speed: 1.3, chase: 2.0, sight: 7, ai: 'walker', candy: 3, shield: true },
  roller: { hp: 2, speed: 4.5, sight: 9, ai: 'roller', candy: 3 },
  bomber: { hp: 2, speed: 1.0, sight: 11, ai: 'bomber', candy: 3, proj: 'bomb' },
  ghost: { hp: 2, speed: 1.4, sight: 10, ai: 'ghost', candy: 3 },
  big: { hp: 4, speed: 1.2, chase: 2.4, sight: 7, ai: 'walker', candy: 6, heavy: true },
  charger: { hp: 2, speed: 1.2, sight: 9, ai: 'charger', candy: 3 },
  jelly: { hp: 1, speed: 0.8, sight: 6, ai: 'jelly', candy: 2 },
  mushroom: { hp: 1, speed: 1.9, chase: 2.6, sight: 14, ai: 'walker', candy: 1 },
  pumpkinling: { hp: 1, speed: 0, sight: 14, ai: 'hopper', candy: 1 },
  snowball: { hp: 1, speed: 4, sight: 12, ai: 'roller', candy: 1 },
  toysoldier: { hp: 2, speed: 1.3, sight: 11, ai: 'shooter', candy: 3, proj: 'cork', walks: true },
};

const _v = new Vec3();

export class Enemy {
  constructor(type, x, y, z, o = {}) {
    const D = ENEMY_DEF[type] || ENEMY_DEF.gloomy;
    this.type = type;
    this.D = D;
    this.rig = buildEnemy(type, o.variant);
    this.node = this.rig.root;
    this.pos = new Vec3(x, y, z);
    this.vel = new Vec3();
    this.home = new Vec3(x, y, z);
    this.yaw = o.yaw ?? rand(0, TAU);
    this.flying = !!this.rig.flying || D.ai === 'flyer' || D.ai === 'ghost' || D.ai === 'jelly';
    this.radius = this.rig.radius || 0.42;
    this.height = this.rig.height || 0.9;
    this.centerY = this.flying ? 0 : (this.rig.centerY || this.height / 2);
    this.shadowSize = this.radius * 2.3;
    this.maxHp = Math.max(1, Math.round(D.hp * (o.hpMul || 1)));
    this.hp = this.maxHp;
    this.alive = true;
    this.body = { pos: this.pos, vel: this.vel, r: this.radius * 0.85, h: this.height * 0.9, stepUp: 0.3, snapDown: 0.4, margin: 0.02, grounded: false, ground: null };
    this.state = 'patrol'; this.st = 0;
    this.anim = 'idle'; this.animT = 0;
    this.patrol = o.patrol || null; // array of [x,z] points
    this.pi = 0;
    this.range = o.range ?? 4; // wander radius
    this.dir = rand(0, TAU);
    this.cool = rand(0.5, 2);
    this.stunT = 0; this.charmT = 0; this.sleepT = 0; this.hurtT = 0; this.slowT = 0;
    this.speedMul = (CTX.diff ? CTX.diff.enemySpeed : 1) * (o.speed || 1);
    this.noFall = o.noFall ?? true;
    this.dying = 0;
    this.onDefeat = o.onDefeat || null;
    this.boss = false;
    this.flyH = o.flyH ?? 2.2;
    this.phase = rand(0, TAU);
    this.canSwallow = type !== 'big';
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
    if (this.flying) { this.pos.y += this.flyH; this.home.y = this.pos.y; }
    this.visible = true;
  }
  get friendly() { return this.charmT > 0; }
  hurtTest(x, y, z, r) {
    if (!this.alive || this.dying) return false;
    if (this.type === 'ghost' && this.fade < 0.4) return false;
    const cy = this.pos.y + this.centerY;
    const dx = x - this.pos.x, dy = y - cy, dz = z - this.pos.z;
    const rr = r + this.radius;
    return dx * dx + dy * dy * 0.7 + dz * dz < rr * rr;
  }
  damage(info) {
    if (!this.alive || this.dying) return false;
    if (info.dmg <= 0) {
      if (info.stun) this.stun(info.stun);
      if (info.knock) this._knock(info, 0.5);
      return true;
    }
    // shield blocks frontal non-heavy hits
    if (this.D.shield && !(info.tags || []).includes('heavy') && info.kind !== 'pound' && info.kind !== 'stomp' && this.stunT <= 0) {
      const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      const dx = (info.dir ? -info.dir.x : 0), dz = (info.dir ? -info.dir.z : 0);
      const l = Math.hypot(dx, dz) || 1;
      if ((f.x * dx + f.z * dz) / l > 0.35) {
        CTX.fx.hit({ x: this.pos.x + f.x * 0.5, y: this.pos.y + this.centerY, z: this.pos.z + f.z * 0.5 }, PAL.white, 0.8);
        if (CTX.audio) CTX.audio.sfx('block');
        this._knock(info, 0.6);
        this.rig.update(0, { anim: 'hurt', t: 0 });
        return true;
      }
    }
    let dmg = info.dmg;
    if (this.sleepT > 0) { dmg *= 1.5; this.sleepT = 0; }
    this.hp -= dmg;
    this.hurtT = 0.3;
    this.rig.setFlash(1);
    this.flashT = 0.12;
    CTX.fx.hit({ x: this.pos.x, y: this.pos.y + this.centerY, z: this.pos.z }, PAL.white, 0.9);
    if (CTX.audio) CTX.audio.sfx('hit', { pitch: 0.9 + Math.random() * 0.2 });
    if (info.slow) this.slowT = 3;
    if (info.stun) this.stun(info.stun);
    this._knock(info, 1);
    if (this.hp <= 0) this.die(info);
    else if (this.state === 'patrol' || this.state === 'idle') { this.state = 'chase'; this.st = 0; }
    return true;
  }
  _knock(info, k) {
    let dx = info.dir ? info.dir.x : this.pos.x - CTX.player.pos.x, dz = info.dir ? info.dir.z : this.pos.z - CTX.player.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const kn = (info.knock ?? 5) * k * (this.D.heavy ? 0.4 : 1);
    this.vel.x = dx / l * kn; this.vel.z = dz / l * kn;
    if (!this.flying) this.vel.y = Math.max(this.vel.y, 3.5 * k);
    this.knockT = 0.25;
  }
  die(info) {
    this.dying = 0.001;
    this.state = 'die'; this.st = 0;
    CTX.fx.hitStop(0.05);
    if (CTX.pet && CTX.pet.onEnemyDefeated) CTX.pet.onEnemyDefeated(this, info);
    if (this.onDefeat) this.onDefeat(this);
    if (CTX.level.onEnemyDefeated) CTX.level.onEnemyDefeated(this);
  }
  _finishDeath() {
    this.alive = false;
    this.dead = true;
    const c = { x: this.pos.x, y: this.pos.y + this.centerY, z: this.pos.z };
    CTX.fx.pop(c);
    if (CTX.audio) CTX.audio.sfx('pop', { pitch: 0.95 + Math.random() * 0.15 });
    const luck = CTX.pet ? CTX.pet.luck() : 0;
    let n = this.D.candy + (Math.random() < luck ? 2 : 0);
    if (CTX.pickups) CTX.pickups.drop(new Vec3(c.x, this.pos.y, c.z), n, 2.5);
    const hr = (CTX.diff ? CTX.diff.heartRate : 0.2) * (1 + luck);
    if (CTX.pickups && Math.random() < hr && CTX.player && CTX.player.hp < CTX.player.maxHp) CTX.pickups.dropHeart(new Vec3(c.x, this.pos.y, c.z));
    if (luck > 0 && Math.random() < luck && CTX.pet && CTX.pet.onLuckyDrop) CTX.pet.onLuckyDrop();
    this.node.removeFromParent();
  }
  stun(t) { if (!this.alive || this.dying) return; this.stunT = Math.max(this.stunT, t); this.state = 'stun'; this.st = 0; }
  charm(t) { if (!this.alive || this.dying) return; this.charmT = t; CTX.fx.heal({ x: this.pos.x, y: this.pos.y + this.height, z: this.pos.z }); }
  sleep(t) { if (!this.alive || this.dying) return; this.sleepT = t; }
  swallow() { // frog tongue
    if (!this.alive) return;
    this.alive = false; this.dead = true;
    CTX.fx.sparkle({ x: this.pos.x, y: this.pos.y + this.centerY, z: this.pos.z }, PAL.white, 6, 0.3);
    if (CTX.pickups) CTX.pickups.drop(new Vec3(this.pos.x, this.pos.y, this.pos.z), this.D.candy, 1.5);
    if (CTX.pet && CTX.pet.onEnemyDefeated) CTX.pet.onEnemyDefeated(this, { kind: 'swallow' });
    if (this.onDefeat) this.onDefeat(this);
    if (CTX.level.onEnemyDefeated) CTX.level.onEnemyDefeated(this);
    this.node.removeFromParent();
  }
  pull(to) { const dx = to.x - this.pos.x, dz = to.z - this.pos.z, l = Math.hypot(dx, dz) || 1; this.vel.x = dx / l * 8; this.vel.z = dz / l * 8; this.knockT = 0.3; }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (!this.alive) return;
    const p = CTX.player;
    const ph = CTX.physics;
    // far away: freeze (cheap)
    const dxp = p.pos.x - this.pos.x, dzp = p.pos.z - this.pos.z, dyp = p.pos.y - this.pos.y;
    const distP = Math.hypot(dxp, dzp);
    if (distP > 55 && !this.boss) { this.node.visible = false; return; }
    this.node.visible = true;
    this.st += dt; this.animT += dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.rig.setFlash(0); }
    if (this.dying) {
      this.dying += dt;
      this._anim('die');
      this.rig.update(dt, { anim: 'die', t: this.dying, speed: 0 });
      if (this.dying > 0.42) this._finishDeath();
      return;
    }
    const sp = this.D.speed * this.speedMul * (this.slowT > 0 ? 0.45 : 1);
    if (this.slowT > 0) this.slowT -= dt;
    if (this.charmT > 0) this.charmT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.knockT > 0) this.knockT -= dt;
    // decoy target
    const decoy = CTX.level.decoy && CTX.level.decoy.alive ? CTX.level.decoy.pos : null;
    const target = decoy || p.pos;
    const tdx = target.x - this.pos.x, tdz = target.z - this.pos.z, td = Math.hypot(tdx, tdz);
    const canSee = !p.dead && (decoy || (distP < this.D.sight && Math.abs(dyp) < 4.5));
    let anim = 'idle';
    let moveX = 0, moveZ = 0, moving = false;
    if (this.stunT > 0) {
      this.stunT -= dt; anim = 'stun';
      if (this.stunT <= 0) { this.state = 'patrol'; }
    } else if (this.sleepT > 0) {
      this.sleepT -= dt; anim = 'sleep';
      if (Math.random() < dt * 0.8) CTX.fx.zzz({ x: this.pos.x, y: this.pos.y + this.height + 0.2, z: this.pos.z });
    } else if (this.charmT > 0) {
      anim = 'friendly';
      if (this.st > 1.5) { this.dir = rand(0, TAU); this.st = 0; }
      if (!this.flying) { moveX = Math.sin(this.dir) * 0.6; moveZ = Math.cos(this.dir) * 0.6; moving = true; }
      if (Math.random() < dt * 1.5) CTX.fx.notes({ x: this.pos.x, y: this.pos.y + this.height, z: this.pos.z }, 1);
    } else if (this.knockT > 0) {
      anim = 'hurt';
    } else {
      const r = this[this.D.ai](dt, sp, canSee, tdx, tdz, td);
      anim = r.anim; moveX = r.mx || 0; moveZ = r.mz || 0; moving = !!r.moving;
    }
    // movement integration
    if (this.flying) {
      if (this.knockT > 0) { this.vel.x = damp(this.vel.x, 0, 4, dt); this.vel.z = damp(this.vel.z, 0, 4, dt); }
      else if (!this.customFly) { this.vel.x = damp(this.vel.x, moveX, 4, dt); this.vel.z = damp(this.vel.z, moveZ, 4, dt); }
      this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;
      if (Math.abs(moveX) + Math.abs(moveZ) > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(moveX, moveZ), 6, dt);
      else if (canSee && this.charmT <= 0) this.yaw = dampAngle(this.yaw, Math.atan2(tdx, tdz), 4, dt);
    } else {
      if (this.knockT > 0) { this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt); }
      else { this.vel.x = moveX; this.vel.z = moveZ; }
      this.vel.y -= 30 * dt;
      if (this.vel.y < -20) this.vel.y = -20;
      // ledge check
      if (this.noFall && this.body.grounded && moving && this.knockT <= 0) {
        const l = Math.hypot(moveX, moveZ) || 1;
        const ax = this.pos.x + moveX / l * (this.radius + 0.25), az = this.pos.z + moveZ / l * (this.radius + 0.25);
        const g = ph.groundBelow(ax, this.pos.y + 0.4, az, 1.0);
        if (!g || g.c.hazard) { this.vel.x = 0; this.vel.z = 0; this.dir += Math.PI * (0.6 + Math.random() * 0.8); this.blocked = true; }
      }
      ph.moveBody(this.body, dt);
      if (this.body.hitWall && moving) { this.dir += Math.PI * (0.5 + Math.random()); this.blocked = true; }
      if (moving && Math.hypot(moveX, moveZ) > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(moveX, moveZ), 8, dt);
      if (this.pos.y < CTX.level.killY) { this.alive = false; this.dead = true; this.node.removeFromParent(); return; }
    }
    // contact damage / stomp
    if (!p.dead && this.charmT <= 0 && this.stunT <= 0 && this.sleepT <= 0) this._contact(p);
    else if (!p.dead) this._stompOnly(p);
    this._anim(anim);
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
    this.rig.update(dt, { anim: this.anim, t: this.animT, speed: Math.hypot(this.vel.x, this.vel.z) / 3 });
  }
  _anim(a) { if (a !== this.anim) { this.anim = a; this.animT = 0; } }
  _contact(p) {
    const cy = this.pos.y + this.centerY;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const hd = Math.hypot(dx, dz);
    const py = p.pos.y;
    // stomp from above
    if (p.vel.y < -1.5 && py > this.pos.y + this.height * 0.45 + (this.flying ? -this.height * 0.5 : 0) && hd < this.radius + 0.35 && py < this.pos.y + this.height + 0.6 + (this.flying ? this.height * 0.5 : 0)) {
      if (this.D.spiky && !(p.ability && p.ability.invulnerable && p.ability.invulnerable(p, {}))) { p.hurt(CTX.diff.enemyDmg, { x: this.pos.x, y: cy, z: this.pos.z }); return; }
      this.damage({ dmg: 1 * (CTX.pet ? CTX.pet.dmgMul() : 1), kind: 'stomp', tags: [], knock: 1, dir: { x: 0, z: 0 } });
      p.bounce(10.5);
      CTX.fx.landing(p.pos, 0.6);
      if (CTX.audio) CTX.audio.sfx('bounce');
      return;
    }
    const rr = this.radius + 0.38;
    const dy = (p.pos.y + 0.55) - cy;
    if (hd < rr && Math.abs(dy) < this.height * 0.5 + 0.55) {
      p.hurt(CTX.diff.enemyDmg, { x: this.pos.x, y: cy, z: this.pos.z });
    }
  }
  _stompOnly(p) {
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    if (p.vel.y < -1.5 && p.pos.y > this.pos.y + this.height * 0.45 && Math.hypot(dx, dz) < this.radius + 0.35 && p.pos.y < this.pos.y + this.height + 0.6) {
      this.damage({ dmg: 1, kind: 'stomp', tags: [], knock: 1, dir: { x: 0, z: 0 } });
      p.bounce(10.5);
    }
  }

  // ------------------------------------------------------------------ AI behaviors
  _wander(dt, sp) {
    if (this.patrol && this.patrol.length) {
      const t = this.patrol[this.pi];
      const dx = t[0] - this.pos.x, dz = t[1] - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.4) { this.pi = (this.pi + 1) % this.patrol.length; this.waitT = 0.6; }
      if (this.waitT > 0) { this.waitT -= dt; return { anim: 'idle', mx: 0, mz: 0 }; }
      return { anim: 'walk', mx: dx / (d || 1) * sp, mz: dz / (d || 1) * sp, moving: true };
    }
    const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
    if (Math.hypot(hx, hz) > this.range) this.dir = Math.atan2(hx, hz) + rand(-0.4, 0.4);
    this.cool -= dt;
    if (this.cool <= 0) { this.cool = rand(1.5, 3.5); this.pausing = Math.random() < 0.35; if (!this.pausing) this.dir += rand(-1.5, 1.5); }
    if (this.pausing) return { anim: 'idle', mx: 0, mz: 0 };
    return { anim: 'walk', mx: Math.sin(this.dir) * sp, mz: Math.cos(this.dir) * sp, moving: true };
  }
  walker(dt, sp, canSee, tdx, tdz, td) {
    if (canSee && td > 0.5) {
      const cs = (this.D.chase || sp) * this.speedMul * (this.slowT > 0 ? 0.45 : 1);
      this.state = 'chase';
      if (this.D.heavy && this.st > 2.5 && td < 6) { // big: occasional charge
        if (this.st < 3.1) return { anim: 'windup', mx: 0, mz: 0 };
        if (this.st < 3.9) return { anim: 'run', mx: tdx / td * cs * 2.6, mz: tdz / td * cs * 2.6, moving: true };
        this.st = 0;
      }
      return { anim: cs > 2.2 ? 'run' : 'walk', mx: tdx / td * cs, mz: tdz / td * cs, moving: true };
    }
    this.state = 'patrol';
    return this._wander(dt, sp);
  }
  hopper(dt, sp, canSee, tdx, tdz, td) {
    if (this.body.grounded) {
      this.cool -= dt;
      if (this.cool <= 0) {
        this.cool = rand(1.0, 1.7) / Math.max(0.6, this.speedMul);
        let dx, dz;
        if (canSee) { dx = tdx / (td || 1); dz = tdz / (td || 1); }
        else { const a = rand(0, TAU); dx = Math.sin(a); dz = Math.cos(a); const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z; if (Math.hypot(hx, hz) > this.range) { const l = Math.hypot(hx, hz); dx = hx / l; dz = hz / l; } }
        // don't hop off ledges
        const g = CTX.physics.groundBelow(this.pos.x + dx * 2, this.pos.y + 1, this.pos.z + dz * 2, 2);
        if (!g) { dx = -dx; dz = -dz; }
        this.vel.y = 8.5; this.hopDir = { x: dx * 3.2 * this.speedMul, z: dz * 3.2 * this.speedMul };
        this.body.grounded = false;
        this.yaw = Math.atan2(dx, dz);
        return { anim: 'attack', mx: this.hopDir.x, mz: this.hopDir.z, moving: true };
      }
      return { anim: this.cool < 0.35 ? 'windup' : 'idle', mx: 0, mz: 0 };
    }
    const h = this.hopDir || { x: 0, z: 0 };
    return { anim: 'attack', mx: h.x, mz: h.z, moving: false };
  }
  flyer(dt, sp, canSee, tdx, tdz, td) {
    this.customFly = true;
    const p = CTX.player;
    if (this.state === 'swoop') {
      if (this.st < 0.5) { this.vel.set(0, 0, 0); return { anim: 'windup' }; }
      if (this.st < 1.3) {
        const tx = this.swoopT.x - this.pos.x, ty = this.swoopT.y - this.pos.y, tz = this.swoopT.z - this.pos.z;
        const d = Math.hypot(tx, ty, tz) || 1, s = 7 * this.speedMul;
        this.vel.set(tx / d * s, ty / d * s, tz / d * s);
        if (d < 0.5) this.st = 1.3;
        return { anim: 'attack' };
      }
      this.vel.y = damp(this.vel.y, (this.home.y - this.pos.y) * 1.5, 3, dt);
      this.vel.x = damp(this.vel.x, 0, 2, dt); this.vel.z = damp(this.vel.z, 0, 2, dt);
      if (this.st > 2.6) { this.state = 'patrol'; this.st = 0; this.cool = rand(1.5, 2.5); }
      return { anim: 'fly' };
    }
    this.cool -= dt;
    if (canSee && this.cool <= 0 && td < 7) { this.state = 'swoop'; this.st = 0; this.swoopT = new Vec3(p.pos.x, p.pos.y + 0.5, p.pos.z); }
    const t = this.animT + this.phase;
    const cx = this.home.x + Math.sin(t * 0.6) * this.range * 0.6, cz = this.home.z + Math.cos(t * 0.5) * this.range * 0.6;
    this.vel.x = damp(this.vel.x, (cx - this.pos.x) * 1.2, 2, dt);
    this.vel.z = damp(this.vel.z, (cz - this.pos.z) * 1.2, 2, dt);
    this.vel.y = damp(this.vel.y, (this.home.y + Math.sin(t * 2) * 0.3 - this.pos.y) * 2, 3, dt);
    if (Math.hypot(this.vel.x, this.vel.z) > 0.2) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 4, dt);
    return { anim: 'fly' };
  }
  shooter(dt, sp, canSee, tdx, tdz, td) {
    if (canSee) {
      this.yaw = dampAngle(this.yaw, Math.atan2(tdx, tdz), 5, dt);
      this.cool -= dt;
      if (this.cool < 0.6 && this.cool > 0) return { anim: 'windup' };
      if (this.cool <= 0) {
        this.cool = rand(2.0, 2.8) / Math.max(0.7, this.speedMul);
        this._shoot(this.D.proj || 'fogball', 7.5);
        return { anim: 'attack' };
      }
      if (this.D.walks && td > 5) return { anim: 'walk', mx: tdx / td * sp, mz: tdz / td * sp, moving: true };
      return { anim: 'idle' };
    }
    return this.D.walks ? this._wander(dt, sp) : { anim: 'idle' };
  }
  _shoot(kind, speed) {
    const p = CTX.player;
    const m = this.rig.muzzle ? this.rig.muzzle.getWorldPosition(_v) : _v.set(this.pos.x + Math.sin(this.yaw) * 0.5, this.pos.y + this.centerY + 0.2, this.pos.z + Math.cos(this.yaw) * 0.5);
    const tx = p.pos.x - m.x, ty = p.pos.y + 0.55 - m.y, tz = p.pos.z - m.z;
    const d = Math.hypot(tx, ty, tz) || 1;
    CTX.projectiles.spawn({ kind, pos: m.clone(), vel: new Vec3(tx / d * speed, ty / d * speed, tz / d * speed), team: 'enemy', dmg: CTX.diff.enemyDmg, life: 3, r: 0.3, spin: 0 });
    if (CTX.audio) CTX.audio.sfx('shoot', { pitch: 0.7, vol: 0.5 });
  }
  roller(dt, sp, canSee, tdx, tdz, td) {
    if (this.patrol && this.patrol.length) {
      const r = this._wander(dt, sp);
      return { ...r, anim: 'run' };
    }
    if (canSee && this.state !== 'roll') { this.state = 'roll'; this.st = 0; this.rollDir = Math.atan2(tdx, tdz); }
    if (this.state === 'roll') {
      if (this.st < 0.5) return { anim: 'windup' };
      if (this.st > 3 || this.blocked) { this.state = 'patrol'; this.st = 0; this.blocked = false; return { anim: 'stun' }; }
      return { anim: 'run', mx: Math.sin(this.rollDir) * sp, mz: Math.cos(this.rollDir) * sp, moving: true };
    }
    return this._wander(dt, sp * 0.3);
  }
  bomber(dt, sp, canSee, tdx, tdz, td) {
    if (canSee) {
      this.yaw = dampAngle(this.yaw, Math.atan2(tdx, tdz), 5, dt);
      this.cool -= dt;
      if (this.cool <= 0) {
        this.cool = rand(2.4, 3.2) / Math.max(0.7, this.speedMul);
        this.throwT = 0.25;
        return { anim: 'attack' };
      }
      if (this.throwT > 0) {
        this.throwT -= dt;
        if (this.throwT <= 0) {
          const p = CTX.player;
          const T = 1.1;
          const sx = this.pos.x, sy = this.pos.y + this.height, sz = this.pos.z;
          const vx = (p.pos.x - sx) / T, vz = (p.pos.z - sz) / T, vy = (p.pos.y - sy) / T + 0.5 * 16 * T;
          CTX.projectiles.spawn({ kind: 'bomb', pos: new Vec3(sx, sy, sz), vel: new Vec3(vx, vy, vz), team: 'enemy', dmg: CTX.diff.enemyDmg, life: 3, r: 0.35, gravity: 16, boom: 1.5, spin: 4 });
          if (CTX.audio) CTX.audio.sfx('throw', { pitch: 0.8 });
        }
        return { anim: 'attack' };
      }
      if (td < 4) return { anim: 'walk', mx: -tdx / td * sp, mz: -tdz / td * sp, moving: true };
      return { anim: 'idle' };
    }
    return this._wander(dt, sp);
  }
  ghost(dt, sp, canSee, tdx, tdz, td) {
    this.customFly = true;
    this.fade = 0.55 + 0.45 * Math.sin(this.animT * 1.4 + this.phase);
    this.rig.setOpacity(Math.max(0.15, this.fade * 0.85));
    const p = CTX.player;
    if (canSee) {
      const tx = p.pos.x - this.pos.x, ty = p.pos.y + 0.8 - this.pos.y, tz = p.pos.z - this.pos.z, d = Math.hypot(tx, ty, tz) || 1;
      const s = sp * 0.9;
      this.vel.x = damp(this.vel.x, tx / d * s, 2, dt); this.vel.y = damp(this.vel.y, ty / d * s, 2, dt); this.vel.z = damp(this.vel.z, tz / d * s, 2, dt);
      return { anim: 'fly' };
    }
    const t = this.animT + this.phase;
    this.vel.x = damp(this.vel.x, Math.sin(t * 0.5) * 0.8, 2, dt); this.vel.z = damp(this.vel.z, Math.cos(t * 0.4) * 0.8, 2, dt);
    this.vel.y = damp(this.vel.y, (this.home.y + Math.sin(t) * 0.4 - this.pos.y), 2, dt);
    return { anim: 'fly' };
  }
  charger(dt, sp, canSee, tdx, tdz, td) {
    if (this.state === 'charge') {
      if (this.st < 0.75) { this.yaw = dampAngle(this.yaw, this.chDir, 10, dt); return { anim: 'windup' }; }
      const s = 8.5 * this.speedMul;
      if (this.blocked || this.st > 2.0) {
        this.blocked = false;
        if (this.body.hitWall) { this.stun(1.6); CTX.fx.hit({ x: this.pos.x, y: this.pos.y + 0.6, z: this.pos.z }, PAL.white, 1); CTX.fx.shake(0.1, 0.15); }
        this.state = 'patrol'; this.st = 0;
        return { anim: 'idle' };
      }
      if (Math.random() < dt * 20) CTX.fx.dust(this.pos, 1, 0.7);
      return { anim: 'run', mx: Math.sin(this.chDir) * s, mz: Math.cos(this.chDir) * s, moving: true };
    }
    this.blocked = false;
    if (canSee && td < 9) { this.state = 'charge'; this.st = 0; this.chDir = Math.atan2(tdx, tdz); return { anim: 'windup' }; }
    return this._wander(dt, sp);
  }
  jelly(dt, sp, canSee, tdx, tdz, td) {
    this.customFly = true;
    const t = this.animT + this.phase;
    this.vel.y = damp(this.vel.y, (this.home.y + Math.sin(t * 1.3) * 1.2 - this.pos.y) * 2, 3, dt);
    const tx = canSee ? tdx / (td || 1) * sp * 0.5 : Math.sin(t * 0.3) * 0.4, tz = canSee ? tdz / (td || 1) * sp * 0.5 : Math.cos(t * 0.3) * 0.4;
    this.vel.x = damp(this.vel.x, tx, 2, dt); this.vel.z = damp(this.vel.z, tz, 2, dt);
    if (this.home.distXZ(this.pos) > this.range + 2) { this.vel.x += (this.home.x - this.pos.x) * dt; this.vel.z += (this.home.z - this.pos.z) * dt; }
    return { anim: Math.sin(t * 2.5) > 0.6 ? 'attack' : 'fly' };
  }
}

// helper used by builder: spawn honoring difficulty-only enemies
export function spawnEnemy(level, type, x, y, z, o = {}) {
  if (o.hard && CTX.diff && !CTX.diff.extraEnemies) return null;
  if (o.veryhard && CTX.diff && CTX.diff.id !== 'veryhard') return null;
  const e = new Enemy(type, x, y, z, o);
  level.enemies.push(e);
  level.add(e);
  return e;
}
void clamp; void angleDiff;

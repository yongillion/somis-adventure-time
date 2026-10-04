// ============================================================================
// pet.js — pet companion: follows Somi, grants a power that levels up with use
// ============================================================================
import { bakeTree } from '../../engine/bake.js';
import { Vec3, damp, dampAngle, TAU, rgb } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { buildPet } from '../models/pets.js';
import { PET_BY_ID, petLevel, MAX_PET_LEVEL } from '../data/pets.js';
import { Save } from '../save.js';
import { PAL } from '../fx.js';

export class Pet {
  constructor(id) {
    this.id = id;
    this.def = PET_BY_ID[id];
    this.rig = buildPet(id);
    bakeTree(this.rig.root);
    this.node = this.rig.root;
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.yaw = 0;
    this.t = 0;
    this.anim = 'fly'; this.animT = 0;
    this.abilityT = 0;
    this.timer = 0;
    this.shieldReady = true; this.shieldT = 0;
    this.acc = 0; // generic accumulator for xp-by-time/distance
    this.candyAcc = 0;
    this.lastPos = new Vec3();
    this.side = 1;
  }
  get xp() { return (Save.data && Save.data.pets[this.id]) ? Save.data.pets[this.id].xp : 0; }
  get lv() { return petLevel(this.xp); }
  v() { return this.def.val[this.lv]; }
  place(p) { this.pos.set(p.x - 0.8, p.y + 1.6, p.z - 0.6); this.lastPos.copy(this.pos); this.node.position.copy(this.pos); }

  // ------------------------------------------------------------------ xp
  gainXp(n, silent = false) {
    if (!Save.data || !Save.data.pets[this.id]) return;
    const before = this.lv;
    Save.data.pets[this.id].xp += n;
    const after = this.lv;
    if (!silent && n > 0) CTX.fx.text({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, `+${n} XP`, 'xp');
    if (after > before) {
      this.happy(1.6);
      CTX.fx.confetti(this.pos, 24);
      CTX.fx.sparkle(this.pos, rgb(this.def.color), 20, 0.6);
      if (CTX.audio) CTX.audio.jingle('levelup');
      if (CTX.hud) CTX.hud.toast(`${this.def.name} 레벨 업! Lv${after}${after >= MAX_PET_LEVEL ? ' (최고 레벨!)' : ''}`, 'pet', 3);
      Save.write();
    }
    if (CTX.hud) CTX.hud.setPet(this.id, this.xp);
  }
  happy(t = 1) { this.anim = 'happy'; this.animT = 0; this.happyT = t; }
  ability(t = 0.7) { this.abilityT = t; }

  // ------------------------------------------------------------------ queried by player / systems
  bonus(kind) {
    const pw = this.def.power, v = this.v();
    if (kind === 'flaps' && pw === 'flutter') return v;
    if (kind === 'flutter' && pw === 'flutter') return Math.min(1, v * 0.25);
    if (kind === 'airJumps' && pw === 'airjump') return this.lv >= 4 ? 2 : 1;
    if (kind === 'speed' && pw === 'speed') return v;
    if (kind === 'hoverTime' && pw === 'flutter') return v * 0.4;
    return 0;
  }
  airJumpPower() { return this.def.power === 'airjump' ? this.v() : 0.8; }
  dmgMul() { return this.def.power === 'power' ? 1 + this.v() : 1; }
  luck() { return this.def.power === 'luck' ? this.v() : 0; }
  magnetRadius() { return this.def.power === 'magnet' ? this.v() : 0; }
  lightRadius() { return this.def.power === 'light' ? this.v() : 0; }
  tryBlock() {
    if (this.def.power !== 'shield' || !this.shieldReady) return false;
    this.shieldReady = false; this.shieldT = this.v();
    this.ability(1);
    CTX.fx.hit(CTX.player.center, PAL.white, 1.3);
    CTX.fx.sparkle(this.pos, PAL.white, 14, 0.5);
    if (CTX.audio) CTX.audio.sfx('shield');
    if (CTX.hud) CTX.hud.toast(`${this.def.name}가 지켜줬어요!`, 'pet');
    this.gainXp(3);
    return true;
  }
  tryRevive() {
    if (this.def.power !== 'revive') return 0;
    const v = this.v();
    this.ability(2);
    this.gainXp(10);
    return v >= 99 ? CTX.player.maxHp : v;
  }
  canGlide(p, held, dt) {
    if (this.def.power !== 'glide' || !held) return false;
    this.glideT = (this.glideT || 0) + dt;
    if (this.glideT > this.v()) return false;
    this.acc += dt;
    if (this.acc > 1) { this.acc = 0; this.gainXp(1, true); }
    this.ability(0.2);
    return true;
  }
  // ------------------------------------------------------------------ hooks
  onFlap(nUsed) { if (this.def.power === 'flutter' && nUsed > CTX.diff.flaps) { this.ability(0.4); this.gainXp(1, true); } }
  onAirJump() { if (this.def.power === 'airjump') { this.ability(0.5); this.gainXp(1, true); CTX.fx.sparkle(CTX.player.pos, PAL.white, 6, 0.3); } }
  onAttack() {
    if (this.def.power !== 'echo') return;
    const e = CTX.level.nearestEnemy(this.pos.x, this.pos.y, this.pos.z, 10);
    const f = CTX.player.facing();
    let dx = f.x, dy = 0, dz = f.z;
    if (e) { dx = e.pos.x - this.pos.x; dy = e.pos.y + e.centerY - this.pos.y; dz = e.pos.z - this.pos.z; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
    CTX.projectiles.spawn({ kind: 'feather', pos: this.pos.clone(), vel: new Vec3(dx * 14, dy * 14, dz * 14), life: 0.9, dmg: this.v(), r: 0.3, from: 'pet', homing: 4, onHit: () => this.gainXp(1, true) });
    this.ability(0.3);
  }
  onCandy(c) { if (this.def.power === 'magnet' && c.magnet) { this.candyAcc++; if (this.candyAcc >= 5) { this.candyAcc = 0; this.gainXp(1, true); } } }
  onEnemyDefeated() { if (this.def.power === 'power') { this.gainXp(1, true); this.ability(0.4); } }
  onLuckyDrop() { if (this.def.power === 'luck') { this.gainXp(2, true); this.ability(0.5); } }
  onGhostUsed() { if (this.def.power === 'light') { this.gainXp(2, true); this.ability(0.5); } }
  onSecretFound() { if (this.def.power === 'reveal') { this.gainXp(3); this.ability(0.8); } }

  // ------------------------------------------------------------------ update
  update(dt) {
    const p = CTX.player;
    if (!p) return;
    this.t += dt; this.animT += dt;
    const f = p.facing();
    // follow point: behind and to the side, above shoulder
    const sx = -f.z * this.side, sz = f.x * this.side;
    const tx = p.pos.x - f.x * 0.9 + sx * 0.75, tz = p.pos.z - f.z * 0.9 + sz * 0.75;
    const ty = p.pos.y + 1.55 + Math.sin(this.t * 2.6) * 0.12;
    const d = Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z);
    if (d > 14) { this.place(p.pos); }
    const k = d > 4 ? 6 : 3.2;
    this.pos.x = damp(this.pos.x, tx, k, dt);
    this.pos.y = damp(this.pos.y, ty, k, dt);
    this.pos.z = damp(this.pos.z, tz, k, dt);
    const mv = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
    if (mv > 0.002) this.yaw = dampAngle(this.yaw, Math.atan2(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z), 6, dt);
    else this.yaw = dampAngle(this.yaw, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z), 3, dt);
    this.lastPos.copy(this.pos);
    if (p.grounded) this.glideT = 0;
    this._power(dt, mv);
    // anim
    if (this.abilityT > 0) { this.abilityT -= dt; if (this.anim !== 'ability' && this.anim !== 'happy') { this.anim = 'ability'; this.animT = 0; } }
    else if (this.anim === 'ability') { this.anim = 'fly'; this.animT = 0; }
    if (this.happyT > 0) { this.happyT -= dt; if (this.happyT <= 0) { this.anim = 'fly'; this.animT = 0; } }
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
    this.rig.update(dt, { anim: this.anim, t: this.animT, speed: mv / Math.max(dt, 1e-3) / 6 });
    if (this.def.power === 'light' && Math.random() < dt * 6) CTX.fx.twinkle(this.pos, [0.85, 1, 0.5], 0.3);
    if (this.id === 'phoenix' && Math.random() < dt * 10) CTX.fx.trail({ x: this.pos.x, y: this.pos.y - 0.1, z: this.pos.z }, [1, 0.6, 0.25], 0.18);
  }
  _power(dt, mv) {
    const p = CTX.player;
    const pw = this.def.power, v = this.v();
    switch (pw) {
      case 'regen':
        if (p.hp < p.maxHp && !p.dead) {
          this.timer += dt;
          if (this.timer >= v) {
            this.timer = 0;
            p.heal(1);
            this.ability(0.8);
            CTX.fx.text({ x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z }, '+1 ♥');
            this.gainXp(3);
          }
        } else this.timer = Math.min(this.timer, v * 0.5);
        break;
      case 'speed':
        this.acc += mv;
        if (this.acc > 40) { this.acc = 0; this.gainXp(1, true); }
        break;
      case 'shield':
        if (!this.shieldReady) { this.shieldT -= dt; if (this.shieldT <= 0) { this.shieldReady = true; CTX.fx.sparkle(this.pos, PAL.white, 8, 0.3); } }
        break;
      case 'peck': {
        this.timer += dt;
        if (this.timer >= v) {
          const e = CTX.level.nearestEnemy(p.pos.x, p.pos.y + 0.5, p.pos.z, 4.5);
          if (e) {
            this.timer = 0;
            this.pos.set(e.pos.x, e.pos.y + e.centerY + 0.4, e.pos.z);
            e.damage({ dmg: 1 * (this.lv >= 4 ? 1.5 : 1), tags: [], kind: 'peck', knock: 2, from: 'pet', dir: { x: e.pos.x - p.pos.x, z: e.pos.z - p.pos.z } });
            this.ability(0.4);
            CTX.fx.text({ x: e.pos.x, y: e.pos.y + e.height + 0.3, z: e.pos.z }, '콕!');
            this.gainXp(1, true);
          } else this.timer = v * 0.7;
        }
        break;
      }
      case 'lullaby': {
        this.timer += dt;
        if (this.timer >= v) {
          let n = 0;
          for (const e of CTX.level.enemies) if (e.alive && !e.boss && e.pos.distanceTo(p.pos) < 6 + this.lv) { e.sleep(3 + this.lv * 0.6); n++; }
          if (n > 0) {
            this.timer = 0;
            this.ability(1.2);
            CTX.fx.notes(this.pos, 6);
            if (CTX.audio) CTX.audio.sfx('chime', { pitch: 1.3 });
            this.gainXp(n);
          } else this.timer = v * 0.85;
        }
        break;
      }
      case 'reveal': {
        this.timer += dt;
        if (this.timer >= 6) {
          this.timer = 0;
          if (CTX.level.reveal) {
            const n = CTX.level.reveal(this.pos, v, 7, true);
            if (n > 0) this.ability(0.8);
          }
        }
        break;
      }
      case 'light':
        if (CTX.level.dark) { this.acc += dt; if (this.acc > 30) { this.acc = 0; this.gainXp(1, true); } }
        break;
      case 'revive':
        this.acc += dt; if (this.acc > 60) { this.acc = 0; this.gainXp(1, true); }
        break;
      default: break;
    }
  }
}
void TAU;

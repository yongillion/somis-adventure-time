// ============================================================================
// bosses/pumpkin.js — 호박 대장 (stage 2). A grumpy pumpkin general:
//  · throwSeeds — puffs his cheeks (wind-up) and spits 3 aimed pumpkin seeds
//  · vineWhip   — raises a vine arm (green ring telegraph) and sweeps a low
//                 arc around himself → jump over the vine!
//  · roll       — tucks in (rollStart), then rolls toward Somi, bouncing off the
//                 arena edge; the last crash leaves him DIZZY (weak ×2, ~3 s)
//  · summon     — (phase 2+) calls little pumpkinlings
// ============================================================================
import { Vec3, clamp, lerp, TAU, Ease } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { PAL } from '../fx.js';
import { BossController } from './boss.js';
import { buildProjectile } from '../models/enemies.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ramp = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

// The pumpkin seed projectile (the enemy 'seed' model; see report: the shared
// projectile pool resolves 'seed' to the hamster's tiny seed, so we fly our own).
class SeedShot {
  constructor(boss, from, vel) {
    this.boss = boss;
    this.level = boss.level;
    this.node = buildProjectile('seed');
    this.node.scale.set(3.4, 3.4, 3.4);
    this.pos = from.clone();
    this.vel = vel;
    this.t = 0;
    this.life = 3.2;
    this.node.position.copy(this.pos);
    this.level.add(this);
  }
  kill(fx = true) {
    if (this.dead) return;
    this.dead = true;
    if (fx) CTX.fx.sparkle(this.pos, PAL.peach, 5, 0.3);
  }
  update(dt) {
    if (this.dead) return;
    this.t += dt;
    this.vel.y -= 5 * dt;
    this.pos.addScaled(this.vel, dt);
    this.node.position.copy(this.pos);
    this.node.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    if (this.node.update) this.node.update(dt);
    if (Math.random() < dt * 40) CTX.fx.trail(this.pos, [1, 0.92, 0.6], 0.22);
    const p = CTX.player;
    if (p && !p.dead) {
      const dx = p.pos.x - this.pos.x, dy = p.pos.y + 0.55 - this.pos.y, dz = p.pos.z - this.pos.z;
      if (dx * dx + dy * dy + dz * dz < 0.72 * 0.72) {
        if (p.ability && p.ability.reflects) { this.vel.scale(-1); CTX.fx.hit(this.pos, PAL.sky, 0.7); sfx('block'); }
        else { p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, this.pos, { knock: 5, up: 5 }); this.kill(); return; }
      }
    }
    if (this.t > this.life || this.pos.y < this.boss.ground - 0.4 || CTX.physics.solidAt(this.pos.x, this.pos.y, this.pos.z)) this.kill();
  }
}

export class PumpkinBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'pumpkin', name: '호박 대장', hp: 46, music: 'boss', title: '노을 협곡의 데굴데굴 호박 장군', introDist: 9.5, outroDist: 8, hitInvuln: 0.5, ...o });
    this.patterns = [
      ['throwSeeds', 'roll', 'walk', 'vineWhip', 'roll'],
      ['walk', 'vineWhip', 'throwSeeds', 'roll', 'summon', 'walk', 'vineWhip', 'roll'],
      ['walk', 'vineWhip', 'throwSeeds', 'roll', 'summon', 'walk', 'vineWhip', 'throwSeeds', 'roll'],
    ];
    this.seeds = [];
    this.hand = 'R';
    this.sleepAnim = 'idle';
    this.rollDir = new Vec3(0, 0, 1);
  }
  // ---------------------------------------------------------------- hit spheres
  spheres() {
    const x = this.pos.x, z = this.pos.z, y = this.pos.y;
    if (this.mode === 'roll' && this.rollSt === 'go') return [{ x, y: y + 1.3, z, r: 1.4, mul: 1 }];
    return [{ x, y: y + 1.45, z, r: 1.5, mul: 1 }, { x, y: y + 2.75, z, r: 0.55, mul: 1 }];
  }
  shadow() { return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 3.8 }; }
  // a dizzy window can only take so much: then he snaps out of it (keeps the fight ~1.5–3 min for kids)
  onHurt(info, dmg) { if (this.mode === 'dizzy') { this.winDmg = (this.winDmg || 0) + dmg; if (this.winDmg >= this.maxHp * 0.28) this.bonked = true; } }
  async introPose(dir) {
    this.play('summon');
    await dir.wait(0.6);
    CTX.fx.shake(0.35, 0.7);
    sfx('bossRoar', { pitch: 1.15 });
    for (let i = 0; i < 6; i++) CTX.fx.fogPuff({ x: this.pos.x + (Math.random() - 0.5) * 3, y: this.pos.y + 2.8, z: this.pos.z + (Math.random() - 0.5) * 3 }, 3);
    await dir.wait(0.9);
    this.play('idle');
  }
  onFightStart() { this.setMode('idle'); this.weakMul = 1; this.contact = true; this.rollSt = null; }
  onReset() { this._clearSeeds(); this.weakMul = 1; this.contact = true; this.rollSt = null; this.pos.y = this.ground; }
  defeat() { this._clearSeeds(); return super.defeat(); }
  _clearSeeds() { for (const s of this.seeds) s.kill(false); this.seeds.length = 0; }
  mouth() {
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    return new Vec3(this.pos.x + f.x * 1.45, this.pos.y + 1.2, this.pos.z + f.z * 1.45);
  }
  // ---------------------------------------------------------------- brain
  // mode entry flag (robust to hit-stop frames where dt = 0)
  setMode(m) { super.setMode(m); this.fresh = true; }
  think(dt) {
    const p = this.player;
    this.enter = !!this.fresh; this.fresh = false;
    this.seeds = this.seeds.filter((s) => !s.dead);
    switch (this.mode) {
      case 'idle': {
        this.play('idle');
        this.weakMul = 1; this.contact = true;
        this.facePlayer(4, dt);
        if (this.mt > [0.85, 0.65, 0.5][this.phase - 1]) this.setMode(this.nextFromPattern());
        break;
      }
      case 'walk': {
        // stomp over toward Somi (ends early once she is in vine reach)
        const tp = this.toPlayer();
        if (tp.d > 3.3) { this.walkToward(p.pos.x, p.pos.z, [2.3, 2.7, 3.1][this.phase - 1], dt); this.play('walk', { speed: 1.2 }); }
        else { this.play('idle'); this.facePlayer(5, dt); }
        if (this.mt > 3.0 || (tp.d <= 3.3 && this.mt > 0.5)) this.setMode('idle');
        break;
      }
      case 'throwSeeds': {
        if (this.enter) { this.play('throwSeeds'); this.restartAnim(); this._shots = 0; sfx('charge', { pitch: 1.35, vol: 0.7 }); }
        this.facePlayer(6, dt);
        const times = [0.5, 0.8, 1.1];
        while (this._shots < 3 && this.mt >= times[this._shots]) { this._spit(this._shots); this._shots++; }
        if (this.mt > 1.6) this.setMode('idle');
        break;
      }
      case 'vineWhip': {
        // too far for the vine? spit seeds instead
        if (this.enter && this._whipLeft == null && this.toPlayer().d > 6.0) { this.setMode('throwSeeds'); break; }
        this._whip(dt);
        break;
      }
      case 'roll': this._roll(dt); break;
      case 'dizzy': {
        const dur = [3.4, 3.0, 2.6][this.phase - 1];
        if (this.enter) {
          this.play('dizzy');
          this.winDmg = 0; this.bonked = false;
          sfx('quake', { vol: 0.6 });
          CTX.fx.dust(this.pos, 16, 2.2);
          if (!this._taught) { this._taught = true; CTX.hud.toast('호박 대장이 어지러워해요! 지금 공격해요!', 'good', 3); }
        }
        this.contact = false;
        this.weakMul = 2;
        if (Math.random() < dt * 4) CTX.fx.stunStars(new Vec3(this.pos.x, this.pos.y + 3.3, this.pos.z));
        if (this.mt > dur || this.bonked) {
          this.weakMul = 1; this.contact = true;
          this.play(this.bonked ? 'hurt' : 'idle'); this.restartAnim();
          if (this.bonked) CTX.fx.text(new Vec3(this.pos.x, this.pos.y + 3.4, this.pos.z), '앗 따가워! 정신이 번쩍!', 'crit');
          sfx('whoosh', { pitch: 0.7 });
          this.setMode('recover');
        }
        break;
      }
      case 'recover': {
        if (this.mt > 0.45 && this.anim === 'hurt') this.play('idle');
        this.facePlayer(3, dt);
        if (this.mt > 0.6) this.setMode('idle');
        break;
      }
      case 'summon': {
        if (this.enter) { this.play('summon'); this.restartAnim(); this._summoned = false; sfx('magic', { pitch: 0.7 }); }
        if (this.mt > 0.6 && !this._summoned) { this._summoned = true; this.summon('pumpkinling', this.phase >= 3 ? 3 : 2, { max: 3, dist: 3.0 }); }
        if (this.mt > 1.4) this.setMode('idle');
        break;
      }
      default: this.setMode('idle');
    }
    if (this.mode !== 'roll') this.pos.y = this.ground;
  }

  // ---------------------------------------------------------------- attacks
  _spit(i) {
    const p = this.player;
    const from = this.mouth();
    const sp = [9.5, 10.5, 11.5][this.phase - 1];
    // aim at Somi (slight lead on the last seed)
    const lead = i === 2 ? 0.25 : 0;
    const tx = p.pos.x + p.vel.x * lead, ty = p.pos.y + 0.5, tz = p.pos.z + p.vel.z * lead;
    const dx = tx - from.x, dy = ty - from.y, dz = tz - from.z, d = Math.hypot(dx, dz) || 1;
    const T = d / sp;
    const mk = (yawOff) => {
      const c = Math.cos(yawOff), s = Math.sin(yawOff);
      const vx = (dx * c + dz * s) / d * sp, vz = (-dx * s + dz * c) / d * sp;
      const vy = dy / T + 0.5 * 5 * T;
      this.seeds.push(new SeedShot(this, from, new Vec3(vx, vy, vz)));
    };
    mk(0);
    if (this.phase >= 3 && i === 2) { mk(0.35); mk(-0.35); }
    sfx('shoot', { pitch: 0.75 + i * 0.08 });
    CTX.fx.dust(from, 3, 0.5);
  }
  // the vine arm sweep: local hand angle over the anim time (mirrors the model's pose)
  _whipAngle(t, side) {
    const sweep = Ease.inOutCubic(ramp(t, 0.5, 0.85));
    return { a: lerp(side * 2.1, -side * 1.05, sweep), R: 3.3 * (0.75 + 0.25 * Math.sin(sweep * Math.PI)) + 0.45 };
  }
  _whip(dt) {
    const p = this.player;
    if (this.enter) {
      this.hand = this.hand === 'R' ? 'L' : 'R';
      this.play('vineWhip', { hand: this.hand });
      this.restartAnim();
      this._whipHit = false;
      this._whipLeft = this._whipLeft ?? (this.phase >= 2 ? 1 : 0);
      this.marker(this.pos.x, this.pos.z, 4.1, 0.6, { color: 0x6ad86a });
      sfx('charge', { pitch: 0.9, vol: 0.6 });
    }
    const t = this.mt;
    if (t < 0.45) this.facePlayer(5, dt);
    if (t > 0.48 && !this._whooshed) { this._whooshed = true; sfx('whoosh', { pitch: 0.75 }); }
    if (t >= 0.5 && t <= 0.9 && !this._whipHit && p && !p.dead) {
      const side = this.hand === 'L' ? -1 : 1;
      const a0 = this._whipAngle(Math.max(0.5, t - dt), side).a, cur = this._whipAngle(t, side);
      const lo = Math.min(a0, cur.a) - 0.22, hi = Math.max(a0, cur.a) + 0.22;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      const pa = wrap(Math.atan2(dx, dz) - this.yaw);
      if (d > 0.6 && d < cur.R + 0.5 && pa >= lo && pa <= hi && p.pos.y < this.ground + 1.05) {
        this._whipHit = true;
        p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, this.pos, { knock: 8, up: 7 });
      }
      if (Math.random() < dt * 30) {
        const wa = cur.a + this.yaw;
        CTX.fx.dust({ x: this.pos.x + Math.sin(wa) * cur.R, y: this.ground + 0.1, z: this.pos.z + Math.cos(wa) * cur.R }, 1, 0.7);
      }
    }
    if (t > 1.45) {
      this._whooshed = false;
      if (this._whipLeft > 0) { this._whipLeft--; this.mt = 0; this.fresh = true; return; }
      this._whipLeft = null;
      this.setMode('idle');
    }
  }
  _roll(dt) {
    const a = this.arena;
    const maxR = a.r - this.radius * 0.8 - 0.5;
    if (this.enter) {
      this.rollSt = 'start';
      this.play('rollStart');
      this.restartAnim();
      this.edgeHits = 0;
      this.maxBounces = [1, 1, 2][this.phase - 1];
      sfx('charge', { pitch: 0.65 });
      CTX.fx.dust(this.pos, 8, 1.4);
    }
    if (this.rollSt === 'start') {
      this.facePlayer(7, dt);
      this.pos.x += Math.sin(this.mt * 70) * 0.02;
      if (this.mt > 0.62) {
        const tp = this.toPlayer();
        this.rollDir.set(tp.dx, 0, tp.dz);
        this.rollSt = 'go'; this.rollT = 0;
        this.play('roll', { speed: 1 });
        sfx('roll', { pitch: 0.7 });
        CTX.fx.dust(this.pos, 12, 1.8);
      }
      return;
    }
    // rolling
    this.rollT += dt;
    const sp = [8.6, 9.6, 10.6][this.phase - 1];
    this.pos.x += this.rollDir.x * sp * dt;
    this.pos.z += this.rollDir.z * sp * dt;
    this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
    if (Math.random() < dt * 22) CTX.fx.dust(this.pos, 1, 1.0);
    if (Math.random() < dt * 4) sfx('roll', { pitch: 0.7 + Math.random() * 0.1, vol: 0.4 });
    const dx = this.pos.x - a.x, dz = this.pos.z - a.z, d = Math.hypot(dx, dz);
    if (d >= maxR && dx * this.rollDir.x + dz * this.rollDir.z > 0) {
      const nx = dx / d, nz = dz / d;
      this.pos.x = a.x + nx * maxR; this.pos.z = a.z + nz * maxR;
      this.edgeHits++;
      CTX.fx.shake(0.3, 0.3);
      CTX.fx.dust(this.pos, 14, 2.0);
      CTX.fx.hit(new Vec3(this.pos.x + nx * 1.4, this.pos.y + 1.2, this.pos.z + nz * 1.4), PAL.white, 1.2);
      sfx('crusher', { pitch: 1.1, vol: 0.7 });
      if (this.edgeHits > this.maxBounces || this.rollT > 7) {
        // bonk! dizzy right there
        this.rollSt = null;
        this.yaw = Math.atan2(-nx, -nz);
        this.setMode('dizzy');
        return;
      }
      // bounce: reflect, then lean toward Somi again
      const dot = this.rollDir.x * nx + this.rollDir.z * nz;
      let rx = this.rollDir.x - 2 * dot * nx, rz = this.rollDir.z - 2 * dot * nz;
      const tp = this.toPlayer();
      rx = rx * 0.35 + tp.dx * 0.65; rz = rz * 0.35 + tp.dz * 0.65;
      if (rx * nx + rz * nz > -0.2) { rx -= nx * 0.8; rz -= nz * 0.8; }
      const l = Math.hypot(rx, rz) || 1;
      this.rollDir.set(rx / l, 0, rz / l);
      sfx('bounce', { pitch: 0.6 });
    }
    this.pos.y = this.ground;
  }
}
void TAU;

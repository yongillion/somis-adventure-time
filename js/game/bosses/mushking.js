// ============================================================================
// bosses/mushking.js — 킹 버섯돌이 (stage 1). Teaches the boss basics:
// walks toward you, crouches and JUMPS onto your spot (ground marker), the
// landing makes a shock ring to jump over; after some landings his cap gets
// stuck in the ground (big damage chance!). Rains spores; summons minions.
// ============================================================================
import { Vec3, clamp, lerp } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { BossController } from './boss.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };

export class MushKingBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'mushking', name: '킹 버섯돌이', hp: 40, music: 'boss', title: '들판의 버섯 임금님', introDist: 9, ...o });
    this.patterns = [
      ['walk', 'jump', 'jump', 'spore', 'walk', 'jump', 'jump'],
      ['jump', 'summon', 'jump', 'jump', 'spore', 'walk', 'jump'],
      ['jump', 'jump', 'spore', 'summon', 'jump', 'jump', 'jump', 'spore'],
    ];
    this.jumps = 0;
    this.sleepAnim = 'idle';
  }
  spheres() {
    const x = this.pos.x, z = this.pos.z, y = this.pos.y;
    if (this.mode === 'stuck') return [{ x, y: y + 1.9, z, r: 1.7, mul: 1 }];
    return [{ x, y: y + 1.1, z, r: 1.15, mul: 1 }, { x, y: y + 2.7, z, r: 1.55, mul: 1 }];
  }
  async introPose(dir) {
    this.play('summon');
    await dir.wait(0.6);
    CTX.fx.shake(0.35, 0.7);
    sfx('bossRoar');
    for (let i = 0; i < 6; i++) CTX.fx.fogPuff({ x: this.pos.x + (Math.random() - 0.5) * 3, y: this.pos.y + 3, z: this.pos.z + (Math.random() - 0.5) * 3 }, 3);
    await dir.wait(1.0);
    this.play('idle');
  }
  onFightStart() { this.setMode('idle'); this.jumps = 0; }
  onReset() { this.jumps = 0; this.weakMul = 1; this.contact = true; }
  think(dt) {
    const p = this.player;
    const sp = [1.7, 2.1, 2.5][this.phase - 1];
    switch (this.mode) {
      case 'idle': {
        this.play('idle');
        this.facePlayer(4, dt);
        if (this.mt > [0.9, 0.6, 0.4][this.phase - 1]) this.setMode(this.nextFromPattern());
        break;
      }
      case 'walk': {
        const tp = this.toPlayer();
        if (tp.d > 2.4) { this.walkToward(p.pos.x, p.pos.z, sp, dt); this.play('walk', { speed: 1 }); }
        else { this.play('idle'); this.facePlayer(5, dt); }
        if (this.mt > 2.4) this.setMode('idle');
        break;
      }
      case 'jump': {
        // crouch (telegraph) -> leap to the player's spot -> land with a shock ring
        if (!this.jump) {
          const a = this.arena;
          let tx = p.pos.x, tz = p.pos.z;
          const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz), mx = a.r - 2.2;
          if (d > mx) { tx = a.x + dx / d * mx; tz = a.z + dz / d * mx; }
          const crouch = [0.85, 0.7, 0.55][this.phase - 1];
          this.jump = { from: this.pos.clone(), tx, tz, crouch, air: 1.0, t: 0, landed: false };
          this.jump.mark = this.marker(tx, tz, 2.3, crouch + 1.0);
          this.play('jumpCrouch');
          sfx('charge', { pitch: 0.7 });
        }
        const J = this.jump;
        J.t += dt;
        if (J.t < J.crouch) {
          this.face(Math.atan2(J.tx - this.pos.x, J.tz - this.pos.z), 8, dt);
          this.pos.x = J.from.x + Math.sin(J.t * 60) * 0.03;
        } else if (J.t < J.crouch + J.air) {
          const k = (J.t - J.crouch) / J.air;
          if (this.anim !== 'jumpAir') { this.play('jumpAir'); sfx('jump', { pitch: 0.5 }); CTX.fx.dust(this.pos, 10, 2); }
          this.pos.x = lerp(J.from.x, J.tx, k);
          this.pos.z = lerp(J.from.z, J.tz, k);
          this.pos.y = this.ground + Math.sin(k * Math.PI) * 6.2;
          this.animExtra = { vy: Math.cos(k * Math.PI) * 6 };
          this.contact = k < 0.15 || k > 0.75;
        } else if (!J.landed) {
          J.landed = true;
          this.pos.set(J.tx, this.ground, J.tz);
          this.contact = true;
          this.play('land');
          this.jumps++;
          CTX.fx.shake(0.5, 0.45);
          CTX.fx.shock(this.pos, 3.5);
          sfx('crusher', { pitch: 0.8 });
          this.shock(J.tx, J.tz, { maxR: [9, 10.5, 12][this.phase - 1], speed: [7, 8, 9][this.phase - 1] });
          // squash anyone right under
          if (p && Math.hypot(p.pos.x - J.tx, p.pos.z - J.tz) < 2.2 && p.pos.y < this.ground + 2) p.hurt(CTX.diff.bossDmg, this.pos, { knock: 9, up: 9 });
          const stuck = this.phase === 1 ? this.jumps % 2 === 0 : this.phase === 2 ? this.jumps % 2 === 0 || Math.random() < 0.25 : this.jumps % 3 === 0;
          J.stuck = stuck;
        } else if (J.t > J.crouch + J.air + 0.45) {
          this.jump = null;
          if (J.stuck) this.setMode('stuck'); else this.setMode('idle');
        }
        break;
      }
      case 'stuck': {
        const dur = [3.6, 3.0, 2.5][this.phase - 1];
        if (this.mt < dt * 1.5) {
          this.play('stuck');
          sfx('quake', { vol: 0.7 });
          CTX.fx.dust(this.pos, 16, 2.2);
          if (!this._taught) { this._taught = true; CTX.hud.toast('버섯 모자가 땅에 꽂혔어요! 지금 공격해요!', 'good', 3); }
        }
        this.contact = false;
        this.weakMul = 2;
        if (Math.random() < dt * 4) CTX.fx.stunStars(new Vec3(this.pos.x, this.pos.y + 0.6, this.pos.z));
        if (this.mt > dur) {
          this.weakMul = 1; this.contact = true;
          this.play('land');
          CTX.fx.dust(this.pos, 12, 2);
          sfx('whoosh', { pitch: 0.6 });
          this.setMode('recover');
        }
        break;
      }
      case 'recover': {
        if (this.mt > 0.7) this.setMode('idle');
        break;
      }
      case 'spore': {
        if (this.mt < dt * 1.5) { this.play('spore'); sfx('magic', { pitch: 0.6 }); }
        if (this.mt > 0.47 && !this._spored) {
          this._spored = true;
          const n = [6, 8, 10][this.phase - 1];
          for (let i = 0; i < n; i++) {
            let x, z;
            if (i < 2) { x = p.pos.x + (Math.random() - 0.5) * 1.5; z = p.pos.z + (Math.random() - 0.5) * 1.5; }
            else { const q = this.randomArenaPoint(1.5, 0.85); x = q.x; z = q.z; }
            this.fall('spore', x, z, { delay: 0.3 + i * 0.16, speed: 4.2, height: 8, r: 0.6, scale: 2.0 });
          }
          CTX.fx.fogPuff({ x: this.pos.x, y: this.pos.y + 3.6, z: this.pos.z }, 8);
        }
        if (this.mt > 1.6) { this._spored = false; this.setMode('idle'); }
        break;
      }
      case 'summon': {
        if (this.mt < dt * 1.5) { this.play('summon'); }
        if (this.mt > 0.62 && !this._summoned) { this._summoned = true; this.summon('mushroom', this.phase >= 3 ? 3 : 2, { max: 3, dist: 2.8 }); }
        if (this.mt > 1.4) { this._summoned = false; this.setMode('idle'); }
        break;
      }
      default: this.setMode('idle');
    }
    this.pos.y = this.mode === 'jump' && this.jump && !this.jump.landed && this.jump.t >= this.jump.crouch ? this.pos.y : this.ground;
  }
  shadow() { return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 3.4 }; }
}
void clamp;

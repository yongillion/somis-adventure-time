// ============================================================================
// bosses/clockknight.js — 태엽 기사 클락 (stage 7, on top of the toy clock tower).
// A wind-up toy knight whose spring got tangled by the Gray Fog. Every attack is
// telegraphed; after about three attacks his spring runs down → UNWOUND:
// he slumps, the big key on his back glows (weak ×2 for ~3.5 s; the key itself
// takes even more). Attacks:
//  · walk    — stiff tick-tock march toward you
//  · charge  — lowers the lance (lane marker on the floor), dashes across the
//              arena to the rim (phase 2+: turns and charges again)
//  · spin    — arms out, a pink circle fills up around him → one fast lance
//              sweep at head height: JUMP when the circle is full! (2 sweeps in
//              phase 2+), then he's a little dizzy
//  · shoot   — shoulder hatches pop up, corks fly at you (more volleys later)
//  · summon  — (phase 2+) two wind-up toy soldiers march out
// ============================================================================
import { Vec3, clamp } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { BossController } from './boss.js';
import { LaneMarker } from './yeti.js';
import { spawnEnemy } from '../systems/enemies.js';
import { PAL } from '../fx.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const bossDmg = () => (CTX.diff ? CTX.diff.bossDmg : 1);

export class ClockKnightBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'clockknight', name: '태엽 기사 클락', hp: 62, music: 'boss', title: '시계탑 꼭대기의 태엽 기사', introDist: 8.5, outroDist: 8, camWeight: 0.4, ...o });
    this.patterns = [
      ['walk', 'shoot', 'charge', 'spin', 'unwound', 'walk', 'charge', 'shoot', 'spin', 'unwound'],
      ['charge', 'spin', 'summon', 'shoot', 'unwound', 'charge', 'shoot', 'spin', 'unwound'],
      ['charge', 'spin', 'shoot', 'unwound', 'summon', 'charge', 'spin', 'shoot', 'unwound'],
    ];
    this.taught = {};
    this.fx = [];
    this.sleepAnim = 'idle';
  }
  get ph() { return this.phase - 1; }
  teach(key, text, kind = 'warn') { if (this.taught[key]) return; this.taught[key] = true; CTX.hud.toast(text, kind, 3.2); }
  track(e) { this.fx.push(e); if (this.fx.length > 30) this.fx = this.fx.filter((x) => !x.dead); return e; }
  clearFx() { for (const e of this.fx) { if (e.kill) e.kill(); else e.dead = true; } this.fx.length = 0; }
  edgeDist(x, z, dx, dz, m = 2.0) {
    const a = this.arena, R = a.r - m;
    const ox = x - a.x, oz = z - a.z;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R;
    const disc = b * b - c;
    return disc > 0 ? Math.max(0.3, -b + Math.sqrt(disc)) : 0.3;
  }
  partPos(name) { const n = this.rig.parts[name]; n.updateWorldFromRoot(); return n.getWorldPosition(new Vec3()); }

  // ---------------------------------------------------------------- body
  spheres() {
    const x = this.pos.x, z = this.pos.z, y = this.pos.y;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const slump = this.mode === 'unwound' ? 0.25 : 0;
    const s = [
      { x, y: y + 1.35 - slump, z, r: 1.2, mul: 1 },
      { x, y: y + 2.55 - slump, z, r: 0.8, mul: 1 },
      { x: x - fx * 1.25, y: y + 1.75 - slump, z: z - fz * 1.25, r: 0.65, mul: this.mode === 'unwound' ? 1.5 : 1, key: true },
    ];
    if (this.mode === 'charge' && this.ch && this.ch.run) s.push({ x: x + fx * 3.2, y: y + 0.9, z: z + fz * 3.2, r: 0.6, mul: 1 });
    return s;
  }
  shadow() { return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 3.0 }; }
  async introPose(dir) {
    this.play('chargeWindup');
    sfx('gear', { pitch: 0.8 });
    await dir.wait(0.7);
    sfx('bossRoar', { pitch: 1.25 });
    sfx('horn', { pitch: 0.9, vol: 0.6 });
    CTX.fx.shake(0.3, 0.7);
    for (let i = 0; i < 8; i++) CTX.fx.sparkle(new Vec3(this.pos.x + (Math.random() - 0.5) * 2, this.pos.y + 1 + Math.random() * 2, this.pos.z + (Math.random() - 0.5) * 2), PAL.gold, 4, 0.4);
    await dir.wait(1.0);
    this.play('idle');
  }
  onFightStart() { this.setMode('idle'); this.pi = 0; this.weakMul = 1; this.contact = true; this.armored = false; }
  onReset() { this.clearFx(); this.ch = null; this.sp = null; this.chargeAgain = false; this.quickSpin = false; this.closeT = 0; this.hugCd = 0; this.weakMul = 1; this.contact = true; this.yaw = this.o.yaw ?? 0; }
  defeat() { this.clearFx(); return super.defeat(); }
  setMode(m) {
    if (this.lane) { this.lane.kill(); this.lane = null; }
    if (this.ring) { this.ring.dead = true; this.ring = null; }
    super.setMode(m);
  }
  onHurt(info) {
    if (this.mode === 'unwound' && this._lastSphere && this._lastSphere.key && !this.taught.key) this.teach('key', '태엽 열쇠를 맞히면 더 큰 효과가 있어요!', 'good');
    void info;
  }

  // ---------------------------------------------------------------- brain
  think(dt) {
    const p = this.player, ph = this.ph;
    this._hugTick(dt);
    switch (this.mode) {
      case 'idle': {
        this.play('idle');
        this.facePlayer(4, dt);
        if (this._antiHug()) break;
        if (this.mt > [0.8, 0.6, 0.45][ph]) this.setMode(this.nextFromPattern());
        break;
      }
      case 'walk': {
        if (this._antiHug()) break;
        const tp = this.toPlayer();
        if (tp.d > 3.0) { this.walkToward(p.pos.x, p.pos.z, [1.7, 2.1, 2.5][ph], dt); this.play('walk', { speed: 0.9 }); }
        else { this.play('idle'); this.facePlayer(5, dt); }
        if (Math.random() < dt * 3) sfx('gear', { pitch: 1.6, vol: 0.25 });
        if (this.mt > 2.2 || (tp.d <= 3.0 && this.mt > 0.6)) this.setMode('idle');
        break;
      }
      case 'charge': this._charge(dt); break;
      case 'spin': this._spin(dt); break;
      case 'shoot': this._shoot(dt); break;
      case 'summon': this._summon(dt); break;
      case 'unwound': {
        const dur = [3.8, 3.4, 3.0][ph];
        if (this.mt < dt * 1.5) {
          this.play('unwound'); this.restartAnim();
          sfx('gear', { pitch: 0.5 });
          sfx('whoosh', { pitch: 0.5 });
          CTX.fx.dust(this.pos, 10, 1.6);
          this.teach('unwound', '태엽이 다 풀렸어요! 반짝이는 열쇠를 지금 공격해요!', 'good');
        }
        this.weakMul = 2; this.contact = false;
        if (Math.random() < dt * 4) {
          const k = this.partPos('key');
          CTX.fx.twinkle(k, PAL.gold, 0.6);
        }
        if (this.mt > dur) { this.weakMul = 1; this.contact = true; this.setMode('rewind'); }
        break;
      }
      case 'rewind': {
        // he winds himself up again: the key spins fast, sparks fly
        if (this.mt < dt * 1.5) { this.play('chargeWindup'); this.restartAnim(); sfx('gear', { pitch: 1.3 }); sfx('timer', { pitch: 1.5 }); }
        if (Math.random() < dt * 12) CTX.fx.sparkle(this.partPos('key'), PAL.gold, 2, 0.4);
        if (this.mt > 0.9) { this.play('idle'); this.setMode('idle'); }
        break;
      }
      case 'dizzy': {
        if (this.mt < dt * 1.5) { this.play('idle'); }
        if (Math.random() < dt * 5) CTX.fx.stunStars(new Vec3(this.pos.x + (Math.random() - 0.5) * 0.8, this.pos.y + 3.2, this.pos.z + (Math.random() - 0.5) * 0.8));
        if (this.mt > [1.1, 0.9, 0.7][ph]) this.setMode('idle');
        break;
      }
      default: this.setMode('idle');
    }
    this.pos.y = this.ground;
  }

  // hugging him for a while → a quick (still telegraphed) lance spin pushes you back out
  _hugTick(dt) {
    const p = this.player;
    this.hugCd = Math.max(0, (this.hugCd || 0) - dt);
    if (!p || p.dead || this.mode === 'unwound' || this.mode === 'dizzy' || this.mode === 'rewind') { this.closeT = 0; return; }
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    this.closeT = d < 3.2 ? (this.closeT || 0) + dt : Math.max(0, (this.closeT || 0) - dt * 0.5);
  }
  _antiHug() {
    if (this.closeT > [1.7, 1.4, 1.1][this.ph] && this.hugCd <= 0) {
      this.closeT = 0; this.hugCd = 6.5; this.quickSpin = true;
      this.setMode('spin');
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- charge
  _charge(dt) {
    const ph = this.ph;
    const windT = [1.15, 0.95, 0.8][ph], lockT = windT - 0.3;
    if (this.mt < dt * 1.5 || !this.ch) {
      const n = this.chargeAgain ? 1 : 0;
      this.chargeAgain = false;
      this.ch = { run: false, dir: this.toPlayer().yaw, t: 0, n };
      this.lane = new LaneMarker(this.level, 0xff6a9a);
      this.track(this.lane);
      this.play('chargeWindup'); this.restartAnim();
      sfx('charge', { pitch: 0.8 });
      sfx('gear', { pitch: 1.4, vol: 0.5 });
      this.teach('charge', '클락이 창을 내렸어요! 분홍 길에서 옆으로 비켜요!');
    }
    const C = this.ch;
    if (!C.run) {
      if (this.mt < lockT) { C.dir = this.toPlayer().yaw; this.face(C.dir, 9, dt); } else this.face(C.dir, 14, dt);
      const dx = Math.sin(C.dir), dz = Math.cos(C.dir);
      if (this.lane) this.lane.set(this.pos.x + dx * 1.0, this.ground, this.pos.z + dz * 1.0, C.dir, this.edgeDist(this.pos.x + dx, this.pos.z + dz, dx, dz, 1.6), 3.0);
      if (this.mt > 0.3 && Math.random() < dt * 10) CTX.fx.dust({ x: this.pos.x + dx * 0.5, y: this.ground, z: this.pos.z + dz * 0.5 }, 1, 0.9);
      if (this.mt >= windT) {
        C.run = true; C.t = 0; this.yaw = C.dir;
        this.play('charge', { speed: 1.4 });
        sfx('dash', { pitch: 0.7 });
        sfx('horn', { pitch: 1.2, vol: 0.5 });
      }
      return;
    }
    C.t += dt;
    const dx = Math.sin(C.dir), dz = Math.cos(C.dir);
    const sp = [12, 13.5, 15][ph] * Math.min(1, 0.4 + C.t * 4);
    this.pos.x += dx * sp * dt; this.pos.z += dz * sp * dt;
    this.yaw = C.dir;
    if (Math.random() < dt * 30) CTX.fx.dust({ x: this.pos.x, y: this.ground, z: this.pos.z }, 1, 1.1);
    const a = this.arena, maxR = a.r - this.radius * 0.8 - 0.6;
    const ox = this.pos.x - a.x, oz = this.pos.z - a.z;
    // stop at the rim (only when actually heading outward — a charge may start right at the rim)
    if ((Math.hypot(ox, oz) >= maxR && ox * dx + oz * dz > 0) || C.t > 2.6) {
      CTX.fx.shake(0.3, 0.3);
      CTX.fx.dust({ x: this.pos.x + dx, y: this.ground + 0.3, z: this.pos.z + dz }, 14, 1.6);
      sfx('crusher', { pitch: 1.3, vol: 0.6 });
      // phase 2+: turn around and charge once more
      if (this.phase >= 2 && C.n === 0) { this.chargeAgain = true; this.ch = null; this.setMode('charge'); return; }
      this.ch = null;
      this.setMode('dizzy');
    }
  }

  // ---------------------------------------------------------------- spin (lance sweep — jump!)
  _spin(dt) {
    const p = this.player, ph = this.ph;
    const sweeps = this.phase >= 2 && !this.quickSpin ? 2 : 1;
    const windT = [0.95, 0.8, 0.7][ph];
    if (this.mt < dt * 1.5 || !this.sp) {
      this.sp = { n: 0, stage: 'wind', t: 0 };
      this.play('spin'); this.restartAnim();
      this.ring = this.marker(this.pos.x, this.pos.z, 4.9, windT, { color: 0xff6a9a });
      sfx('charge', { pitch: 1.1 });
      this.teach('spin', '클락이 빙글 돌려고 해요! 분홍 원이 꽉 차면 점프!');
    }
    const S = this.sp;
    S.t += dt;
    if (S.stage === 'wind') {
      // arms out, holding still (anim time pinned at 0 = no spin yet)
      this.animT = 0;
      this.facePlayer(2, dt);
      if (S.t >= (S.n === 0 ? windT : 0.45)) { S.stage = 'sweep'; S.t = 0; this.restartAnim(); sfx('spin', { pitch: 0.8 }); sfx('whoosh', { pitch: 0.7 }); }
    } else if (S.stage === 'sweep') {
      // the lance whips around at head height between t≈0.28 and 0.66
      if (S.t > 0.28 && S.t < 0.66 && p && !p.dead) {
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        if (d > 0.8 && d < 4.9 && p.pos.y < this.ground + 1.25) p.hurt(bossDmg(), { x: this.pos.x, y: this.pos.y + 1.4, z: this.pos.z }, { knock: 8, up: 7 });
      }
      if (S.t > 0.25 && S.t < 0.6 && Math.random() < dt * 30) {
        const tip = this.partPos('lanceTip');
        CTX.fx.trail(tip, [1, 0.85, 0.95], 0.35);
      }
      if (S.t > 0.66) {
        this.play('idle');
        S.n++;
        if (S.n < sweeps) {
          S.stage = 'wind'; S.t = 0; this.play('spin'); this.restartAnim();
          this.ring = this.marker(this.pos.x, this.pos.z, 4.9, 0.45 + 0.25, { color: 0xff6a9a });
        } else if (this.quickSpin) { this.sp = null; this.quickSpin = false; this.setMode('idle'); } else { this.sp = null; this.setMode('dizzy'); }
      }
    }
  }

  // ---------------------------------------------------------------- shoot corks
  _shoot(dt) {
    const p = this.player, ph = this.ph;
    const vols = [1, 2, 3][ph];
    if (this.mt < dt * 1.5) { this.vol = 0; this.shotT = 0; this.play('shoot'); this.restartAnim(); sfx('gear', { pitch: 1.6, vol: 0.5 }); this.teach('shoot', '어깨에서 코르크가 퐁퐁! 옆으로 피하거나 점프해요'); }
    this.facePlayer(3, dt);
    const t = this.animT;
    const fire = (side, k) => {
      const m = this.partPos(side < 0 ? 'muzzleL' : 'muzzleR');
      const n = this.phase >= 3 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const lead = 0.3 * k;
        const tx = p.pos.x + p.vel.x * lead, tz = p.pos.z + p.vel.z * lead;
        const a = Math.atan2(tx - m.x, tz - m.z) + (i - (n - 1) / 2) * 0.32;
        const d = Math.hypot(tx - m.x, tz - m.z);
        const T = clamp(d / 9, 0.45, 1.3);
        this.lob('cork', m, new Vec3(m.x + Math.sin(a) * d, p.pos.y + 0.4, m.z + Math.cos(a) * d), T, { r: 0.35, scale: 1.8, gravity: 14 });
      }
      sfx('shoot', { pitch: 0.75 });
      sfx('pop', { pitch: 0.8 });
    };
    if (t >= 0.45 && this.shotT < 1) { this.shotT = 1; fire(-1, 1); }
    if (t >= 0.7 && this.shotT < 2) { this.shotT = 2; fire(1, 1.4); }
    if (t > 1.2) {
      if (this._antiHug()) return;
      this.vol++;
      if (this.vol < vols) { this.shotT = 0; this.play('shoot'); this.restartAnim(); }
      else this.setMode('idle');
    }
  }

  // ---------------------------------------------------------------- summon toy soldiers
  _summon(dt) {
    if (this.mt < dt * 1.5) { this.play('chargeWindup'); this.restartAnim(); sfx('horn', { pitch: 1.0 }); this._summoned = false; this.teach('summon', '태엽 병정들이 나타났어요! 톡톡 쳐서 착하게 만들어 줘요'); }
    if (!this._summoned && this.mt > 0.6) {
      this._summoned = true;
      const alive = this.minions.filter((m) => m.alive).length;
      for (const s of [-1, 1]) {
        if (alive >= 2) break;
        const a = this.yaw + s * 1.3, d = 3.2;
        let x = this.pos.x + Math.sin(a) * d, z = this.pos.z + Math.cos(a) * d;
        const A = this.arena, ax = x - A.x, az = z - A.z, ad = Math.hypot(ax, az), mx = A.r - 1.8;
        if (ad > mx) { x = A.x + ax / ad * mx; z = A.z + az / ad * mx; }
        const e = spawnEnemy(this.level, 'toysoldier', x, this.ground + 0.2, z, { variant: 'toy', range: 5, yaw: this.yaw });
        if (e) { CTX.fx.poof(new Vec3(x, this.ground + 0.6, z)); this.minions.push(e); }
      }
      sfx('magic', { pitch: 1.2 });
    }
    if (this.mt > 1.3) this.setMode('idle');
  }
}

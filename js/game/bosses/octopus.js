// ============================================================================
// bosses/octopus.js — 문어 대왕 옥토 (stage 5). A big octopus sitting in the
// pool at the arena center. Attacks:
//  slam   — turns so one tentacle (OCTO_YAW[i]) points at the player while a
//           pink line telegraphs the hit; the tentacle rises and slams down
//           along the line (jump or step aside). Every ~2nd slam the tentacle
//           gets STUCK: its tip glows pink and takes x2 damage (~3 s).
//  ink    — lobs ink blobs onto ground markers around the player.
//  submerge/emerge — sinks into the pool (bubbles, whirlpool pushes the player
//           out), then bursts up with a shock ring to jump over (phase 3: two).
// Phase 2+: two slams in a row; phase 3 adds more submerges and shorter aims.
// ============================================================================
import { Vec3, TAU, clamp } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { BossController, Marker } from './boss.js';
import { OCTO_YAW } from '../models/bosses.js';
import { PAL } from '../fx.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const DEG = Math.PI / 180;
const TIP_R = 5.9; // tentacle tip distance from the center when slammed (BOSS_TIMING)
const LINE_R0 = 1.0, LINE_R1 = 6.6; // slam hit zone along the line
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// glowing ground stripe telegraph (+ chevrons sliding outward)
const chevronGeo = () => G.extrudeGeo([[0, 0.5], [0.55, -0.12], [0.34, -0.3], [0, 0.12], [-0.34, -0.3], [-0.55, -0.12]], 0.02).rotate(Math.PI / 2, 0, 0);
class LineMarker {
  constructor(level, color = 0xff6a9a) {
    this.node = new Node('octoLine');
    const mk = (op) => { const m = new Material({ color, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }); m.opacity = op; return m; };
    const band = () => G.cachedGeo('olm:band', () => G.planeGeo(1, 1, 1, 1));
    this.band = new Mesh(band(), mk(0.35)); this.edgeL = new Mesh(band(), mk(0.8)); this.edgeR = new Mesh(band(), mk(0.8));
    this.chev = [0, 1, 2].map(() => new Mesh(G.cachedGeo('olm:chev', chevronGeo), mk(0.9)));
    for (const m of [this.band, this.edgeL, this.edgeR, ...this.chev]) { m.renderOrder = 7; this.node.add(m); }
    this.t = 0; this.locked = false;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.len = 1; this.w = 1.7;
    level.add(this);
  }
  set(x, y, z, yaw, len, w = 1.7) { this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.len = len; this.w = w; }
  update(dt) {
    this.t += dt;
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw), rx = dz, rz = -dx, L = this.len, w = this.w;
    const cx = this.x + dx * L / 2, cz = this.z + dz * L / 2, y = this.y + 0.07;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (this.locked ? 24 : 11));
    this.band.position.set(cx, y, cz); this.band.rotation.y = this.yaw; this.band.scale.set(w, 1, L); this.band.opacity = (this.locked ? 0.45 : 0.28) + 0.18 * pulse;
    for (const [e, sd] of [[this.edgeL, -1], [this.edgeR, 1]]) { e.position.set(cx + rx * sd * w / 2, y + 0.005, cz + rz * sd * w / 2); e.rotation.y = this.yaw; e.scale.set(0.1, 1, L); e.opacity = 0.55 + 0.4 * pulse; }
    this.chev.forEach((c, i) => { const u = (this.t * 1.3 + i / 3) % 1; c.position.set(this.x + dx * L * u, y + 0.012, this.z + dz * L * u); c.rotation.y = this.yaw; const s = w * 0.5; c.scale.set(s, 1, s); c.opacity = Math.sin(u * Math.PI) * 0.9; });
  }
  kill() { this.dead = true; }
}

export class OctopusBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'octopus', name: '문어 대왕 옥토', hp: 54, music: 'boss', title: '수정 바다의 임금님', introDist: 11, outroDist: 10.5, camWeight: 0.22, centerY: 2.4, radius: 1.9, ...o });
    this.poolR = o.poolR ?? 3.3;
    this.patterns = [
      ['slam', 'ink', 'slam', 'slam', 'ink', 'slam'],
      ['slam2', 'ink', 'submerge', 'slam', 'ink', 'slam2'],
      ['submerge', 'slam2', 'ink', 'submerge', 'slam2', 'ink'],
    ];
    this.sleepAnim = 'submerge'; // waits under the water until the player arrives
    this.sunk = true;
    this.slams = 0; this.lastStuck = 0;
    this.sl = null;
    this.tipPos = new Vec3();
    this.fxList = [];
    this.noClamp = true; // stays in its pool
  }

  // ---------------------------------------------------------------- hit volumes
  spheres() {
    if (this.sunk) return [];
    const x = this.pos.x, y = this.pos.y, z = this.pos.z;
    // the squishy head only takes half damage; the stuck tentacle tip is the real weak spot (x2 there)
    const out = [{ x, y: y + 2.5, z, r: 1.95, mul: this.mode === 'stuck' ? 0.25 : 0.5, head: true }];
    if (this.mode === 'stuck') out.unshift({ x: this.tipPos.x, y: this.tipPos.y, z: this.tipPos.z, r: 0.95, mul: 1 });
    return out;
  }
  onHurt() {
    // a gentle hint after a few hits on the bouncy head
    if (!this._lastSphere || !this._lastSphere.head || this.mode === 'stuck') return;
    this._headHits = (this._headHits || 0) + 1;
    if (this._headHits === 4 && !this._headHint) { this._headHint = true; CTX.hud.toast('말랑말랑 머리는 별로 안 아파요. 바닥에 쾅! 붙은 다리 끝을 노려 봐요!', 'warn', 3.2); }
  }
  hurtTest(x, y, z, r) { if (this.sunk) return false; return super.hurtTest(x, y, z, r); }
  _contact(p) {
    if (!this.contact || this.sunk) return;
    const sx = this.pos.x, sy = this.pos.y + 2.5, sz = this.pos.z;
    const dx = p.pos.x - sx, dz = p.pos.z - sz, hd = Math.hypot(dx, dz), dy = p.pos.y + 0.55 - sy;
    if (hd < 2.25 && Math.abs(dy) < 2.45) p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, { x: sx, y: sy, z: sz }, { knock: 8, up: 6 });
  }
  shadow() { if (this.sunk || this.state === 'sleep') return null; return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 4.6 }; }

  // ---------------------------------------------------------------- flow hooks
  async introPose(dir) {
    this.play('emerge');
    this.sunk = false;
    this._splash(1.6);
    sfx('splash'); sfx('bossRoar');
    CTX.fx.shake(0.4, 0.8);
    await dir.wait(1.1);
    this.play('ink');
    await dir.wait(1.0);
    this.play('idle');
  }
  onFightStart(quick) {
    this._cleanup();
    this.weakMul = 1; this.contact = true; this.armored = false;
    this.lastStuck = this.fightT; this.slams = 0; this.pi = 0;
    if (quick) { this.quietEmerge = true; this.setMode('emerge'); }
    else { this.sunk = false; this.setMode('idle'); }
    if (!this._hinted) { this._hinted = true; setTimeout(() => CTX.hud.toast('분홍 줄 위로 다리가 쾅! 옆으로 피하거나 폴짝 뛰어요!', 'warn', 3.2), 600); }
  }
  onReset() { this._cleanup(); this.sunk = true; this.weakMul = 1; this.contact = true; this.sl = null; this.yaw = 0; }
  // defer by one boss update: BossController.defeat() clears projectiles, which crashes
  // Projectiles.update() when the killing blow is a player projectile
  defeat() {
    if (this.dying || this._defeatPending) return;
    this._defeatPending = true;
    this._cleanup(); this.sunk = false; this.weakMul = 1; this.contact = false;
  }
  update(dt) {
    if (this._defeatPending) { this._defeatPending = false; super.defeat(); }
    super.update(dt);
  }
  _cleanup() { for (const f of this.fxList) { if (f.kill) f.kill(); else f.dead = true; } this.fxList.length = 0; this.line = null; }
  _track(f) { this.fxList.push(f); return f; }
  _splash(k = 1) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      CTX.fx.splash({ x: this.pos.x + Math.sin(a) * this.poolR * 0.7, y: this.ground + 0.1, z: this.pos.z + Math.cos(a) * this.poolR * 0.7 }, k);
    }
  }

  // ---------------------------------------------------------------- brain
  think(dt) {
    const p = this.player, ph = this.phase;
    if (this.fxList.length > 30) this.fxList = this.fxList.filter((f) => !f.dead);
    switch (this.mode) {
      case 'idle': {
        this.play(ph >= 2 && Math.sin(this.fightT * 0.7) > 0.4 ? 'swim' : 'idle');
        this.facePlayer(2.2, dt);
        if (this.mt > [1.0, 0.75, 0.55][ph - 1]) {
          const m = this.nextFromPattern();
          this.forceStuck = this.fightT - this.lastStuck > 8; // a weak moment at least every ~10 s
          this.setMode(this.forceStuck && m === 'ink' ? 'slam' : m);
        }
        break;
      }
      case 'slam':
      case 'slam2': this._slam(dt); break;
      case 'stuck': {
        const dur = [3.4, 3.0, 2.6][ph - 1];
        const S = this.sl;
        if (this.mt < dt * 1.5) {
          this.play('stuck', { tentacle: S.i });
          this.lastStuck = this.fightT;
          sfx('quake', { vol: 0.7 });
          CTX.fx.sparkle(this.tipPos, PAL.gold, 14, 0.7);
          if (!this._taught) { this._taught = true; CTX.hud.toast('다리가 바닥에 붙었어요! 반짝이는 다리 끝을 마구마구 공격해요!', 'good', 3.2); }
        }
        this.weakMul = 2;
        if (Math.random() < dt * 5) CTX.fx.stunStars(new Vec3(this.pos.x, this.pos.y + 5.2, this.pos.z));
        if (Math.random() < dt * 7) CTX.fx.twinkle(this.tipPos, [1, 0.55, 0.85], 0.6);
        if (this.mt > dur) {
          this.weakMul = 1;
          this.play('slam', { tentacle: S.i });
          this.animT = 1.3; // tentacle pulls back (slam 1.3 -> 1.8)
          sfx('whoosh', { pitch: 0.6 });
          this.setMode('recover');
        }
        break;
      }
      case 'recover': {
        if (this.mt > 0.55) { this.sl = null; this.setMode('idle'); }
        break;
      }
      case 'ink': {
        if (this.mt < dt * 1.5) { this.play('ink'); sfx('bubble', { pitch: 0.6 }); this._inked = false; }
        this.facePlayer(3, dt);
        if (!this._inked && this.mt >= 0.45) { this._inked = true; this._shootInk([3, 5, 6][ph - 1]); }
        if (this.mt > 1.7) this.setMode('idle');
        break;
      }
      case 'submerge': {
        if (this.mt < dt * 1.5) { this.play('submerge'); sfx('dive'); this._splash(1.0); }
        if (this.mt > 0.55) { this.sunk = true; this.contact = false; }
        if (this.mt > 1.0) this.setMode('under');
        break;
      }
      case 'under': {
        this.play('submerge');
        this.sunk = true; this.contact = false;
        if (this.mt < dt * 1.5) this._track(new Marker(this.level, this.pos.x, this.ground, this.pos.z, this.poolR + 0.6, [1.6, 1.3, 1.1][ph - 1] + 0.4, { color: 0x8ad8ff }));
        if (Math.random() < dt * 14) { const a = Math.random() * TAU, r = Math.random() * this.poolR; CTX.fx.bubbles({ x: this.pos.x + Math.sin(a) * r, y: this.ground + 0.1, z: this.pos.z + Math.cos(a) * r }, 2); }
        this._whirlpool(dt);
        if (this.mt > [1.6, 1.3, 1.1][ph - 1]) this.setMode('emerge');
        break;
      }
      case 'emerge': {
        if (this.mt < dt * 1.5) { this.play('emerge'); this._splash(1.4); sfx('splash'); this._r1 = this._r2 = false; this.yaw = this.toPlayer().yaw; }
        this._whirlpool(dt);
        if (this.mt > 0.35) { this.sunk = false; this.contact = true; }
        if (!this.quietEmerge) {
          if (this.mt > 0.55 && !this._r1) { this._r1 = true; this._ring(); }
          if (ph >= 3 && this.mt > 1.2 && !this._r2) { this._r2 = true; this._ring(); }
        }
        if (this.mt > 1.7) { this.quietEmerge = false; this.setMode(ph >= 3 ? 'slam' : 'idle'); }
        break;
      }
      default: this.setMode('idle');
    }
    this.pos.y = this.ground;
  }

  _ring() {
    this.shock(this.pos.x, this.pos.z, { maxR: this.arena ? this.arena.r - 0.4 : 13, speed: 6.5, r0: this.poolR - 0.6 });
    CTX.fx.shake(0.45, 0.4);
    CTX.fx.shock(this.pos, 4);
    sfx('crusher', { pitch: 0.7 });
  }
  // while under water the pool swirls: gently push Somi out of it
  _whirlpool(dt) {
    const p = this.player;
    if (!p || p.dead || !this.sunk) return;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 0.01;
    if (d < this.poolR + 0.3 && p.pos.y < this.ground + 1.2) {
      p.pos.x += dx / d * 5 * dt; p.pos.z += dz / d * 5 * dt;
      if (!this._whirlT) { this._whirlT = true; CTX.hud.toast('소용돌이가 빙글빙글! 웅덩이 밖으로 밀려나요', 'warn', 2.2); }
    }
  }
  _shootInk(n) {
    const p = this.player, a = this.arena;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const from = new Vec3(this.pos.x + fx * 2.1, this.pos.y + 1.6, this.pos.z + fz * 2.1);
    for (let i = 0; i < n; i++) {
      let x = p.pos.x, z = p.pos.z;
      if (i > 0) { const ang = Math.random() * TAU, r = 1.6 + Math.random() * 2.6; x += Math.sin(ang) * r; z += Math.cos(ang) * r; }
      // keep inside the arena and outside the pool
      const dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz) || 1;
      if (d > a.r - 1.2) { x = a.x + dx / d * (a.r - 1.2); z = a.z + dz / d * (a.r - 1.2); }
      if (d < this.poolR + 1) { x = a.x + dx / d * (this.poolR + 1); z = a.z + dz / d * (this.poolR + 1); }
      const T = 1.0 + i * 0.14;
      this._track(new Marker(this.level, x, this.ground, z, 0.9, T, { color: 0x9a7ad8 }));
      this.lob('ink', from, new Vec3(x, this.ground + 0.2, z), T, { scale: 2.8, r: 0.45 });
    }
    sfx('shoot', { pitch: 0.55 });
    CTX.fx.fogPuff({ x: from.x, y: from.y, z: from.z }, 5);
  }

  // ---------------------------------------------------------------- slam
  _pickTentacle() {
    const tp = this.toPlayer();
    // the tentacles needing the least turn, a little random so different arms are used
    const list = [0, 1, 2, 3, 4, 5].map((i) => ({ i, d: Math.abs(wrap(tp.yaw - OCTO_YAW[i] * DEG - this.yaw)) })).sort((A, B) => A.d - B.d);
    const pick = list[Math.random() < 0.65 ? 0 : 1];
    return pick.i;
  }
  _startSlam(second) {
    const ph = this.phase;
    const i = this._pickTentacle();
    this.slams++;
    let stuck;
    if (this.forceStuck) stuck = !second && this.mode === 'slam2' ? false : true;
    else if (ph === 1) stuck = this.slams % 2 === 0;
    else if (this.mode === 'slam2') stuck = second && (ph === 2 || Math.random() < 0.7);
    else stuck = Math.random() < 0.5;
    if (stuck) this.forceStuck = false;
    this.sl = { i, phi: OCTO_YAW[i] * DEG, stage: 'aim', t: 0, second, stuck, hit: false };
    this.play(ph >= 2 ? 'swim' : 'idle');
    if (this.line) this.line.kill();
    this.line = this._track(new LineMarker(this.level));
    sfx('charge', { pitch: 0.7 });
  }
  _slam(dt) {
    const p = this.player, ph = this.phase;
    if (!this.sl) this._startSlam(false);
    const S = this.sl;
    S.t += dt;
    const aimT = (S.second ? 0.4 : [0.75, 0.6, 0.48][ph - 1]);
    if (S.stage === 'aim') {
      const want = this.toPlayer().yaw - S.phi;
      this.face(want, 4.0, dt);
    }
    const dir = this.yaw + S.phi, dx = Math.sin(dir), dz = Math.cos(dir);
    if (this.line) { this.line.set(this.pos.x + dx * LINE_R0, this.ground, this.pos.z + dz * LINE_R0, dir, LINE_R1 - LINE_R0); this.line.locked = S.stage !== 'aim'; }
    if (S.stage === 'aim') {
      if (S.t >= aimT) { S.stage = 'slam'; S.t = 0; this.play('slam', { tentacle: S.i }); this.restartAnim(); sfx('whoosh', { pitch: 0.55 }); }
      return;
    }
    // stage 'slam' (anim time == S.t): rises 0-0.55, hits at 0.7, lies flat until 1.3
    this.tipPos.set(this.pos.x + dx * TIP_R, this.ground + 0.65, this.pos.z + dz * TIP_R);
    if (S.t >= 0.7 && !S.hit) {
      S.hit = true;
      if (this.line) { this.line.kill(); this.line = null; }
      CTX.fx.shake(0.35, 0.3);
      sfx('crusher', { pitch: 0.85 });
      for (let r = 1.5; r <= 6.2; r += 0.9) CTX.fx.dust({ x: this.pos.x + dx * r, y: this.ground, z: this.pos.z + dz * r }, 3, 1.2);
      CTX.fx.splash({ x: this.tipPos.x, y: this.ground + 0.1, z: this.tipPos.z }, 1.0);
      this.shock(this.tipPos.x, this.tipPos.z, { maxR: 3.0, speed: 6, r0: 0.4 });
      if (p && !p.dead) {
        const vx = p.pos.x - this.pos.x, vz = p.pos.z - this.pos.z;
        const along = vx * dx + vz * dz, perp = vx * dz - vz * dx;
        if (along > LINE_R0 - 0.2 && along < LINE_R1 && Math.abs(perp) < 1.05 && p.pos.y < this.ground + 1.3) {
          const sx = Math.sign(perp) || 1;
          p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, { x: p.pos.x - dz * sx, y: p.pos.y, z: p.pos.z + dx * sx }, { knock: 7, up: 8 });
        }
      }
    }
    if (S.t >= 1.0 && S.stuck) { this.setMode('stuck'); return; }
    if (S.t >= 1.78) {
      if (this.mode === 'slam2' && !S.second) this._startSlam(true);
      else { this.sl = null; this.setMode('idle'); }
    }
  }
}
void clamp;

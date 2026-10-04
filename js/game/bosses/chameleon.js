// ============================================================================
// bosses/chameleon.js — 카멜레온 카멜 (stage 4). A hide-and-seek boss:
// vanishes, peeks out somewhere else (eyes first), then aims its long tongue
// along a glowing pink ground line. If the tongue hits one of the arena's tree
// pillars it gets STUCK: the tip glows pink and Kamel takes x2 damage (~3 s).
// It also walks around and spits seeds (aimed fan). Phase 2+: two tongue shots
// in a row and shorter wind-ups. Appear spots are biased so a pillar often sits
// between Kamel and the player ("hide behind a tree!"), with a pity timer so a
// weak moment comes every ~9-12 s.
// ============================================================================
import { Vec3, TAU, Ease, clamp } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { BossController, Marker } from './boss.js';
import { PAL } from '../fx.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const MOUTH_Z = 2.72; // mouth distance in front of the root while the tongue is out (see BOSS_TIMING)
const MOUTH_Y = 1.61;
const TONGUE_SLOPE = 0.09; // tongue height drops ~0.09 m per m of length
const TONGUE_MAX = 7.2;

// ------------------------------------------------------------------ ground line telegraph
const chevronGeo = () => G.extrudeGeo([[0, 0.5], [0.55, -0.12], [0.34, -0.3], [0, 0.12], [-0.34, -0.3], [-0.55, -0.12]], 0.02).rotate(Math.PI / 2, 0, 0);
export class LineMarker {
  constructor(level, color = 0xff6a9a) {
    this.node = new Node('lineMarker');
    const mk = (op) => { const m = new Material({ color, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }); m.opacity = op; return m; };
    this.band = new Mesh(G.cachedGeo('lm:band', () => G.planeGeo(1, 1, 1, 1)), mk(0.35));
    this.band.renderOrder = 7;
    this.edgeL = new Mesh(G.cachedGeo('lm:band', () => G.planeGeo(1, 1, 1, 1)), mk(0.8));
    this.edgeR = new Mesh(G.cachedGeo('lm:band', () => G.planeGeo(1, 1, 1, 1)), mk(0.8));
    this.edgeL.renderOrder = 7; this.edgeR.renderOrder = 7;
    this.end = new Mesh(G.cachedGeo('lm:ring', () => G.ringGeo(0.62, 1.0, 36)), mk(0.9));
    this.end.renderOrder = 7;
    this.chev = [];
    for (let i = 0; i < 3; i++) { const c = new Mesh(G.cachedGeo('lm:chev', chevronGeo), mk(0.9)); c.renderOrder = 7; this.chev.push(c); }
    this.node.add(this.band, this.edgeL, this.edgeR, this.end, ...this.chev);
    this.t = 0; this.len = 1; this.w = 0.9; this.locked = false; this.big = false;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0;
    level.add(this);
  }
  set(x, y, z, yaw, len, w = 0.9) { this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.len = Math.max(0.3, len); this.w = w; }
  update(dt) {
    this.t += dt;
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw), rx = dz, rz = -dx;
    const L = this.len, w = this.w;
    const cx = this.x + dx * L / 2, cz = this.z + dz * L / 2, y = this.y + 0.07;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (this.locked ? 26 : 12));
    this.band.position.set(cx, y, cz); this.band.rotation.y = this.yaw; this.band.scale.set(w, 1, L);
    this.band.opacity = (this.locked ? 0.42 : 0.26) + 0.18 * pulse;
    for (const [e, sd] of [[this.edgeL, -1], [this.edgeR, 1]]) {
      e.position.set(cx + rx * sd * w / 2, y + 0.005, cz + rz * sd * w / 2); e.rotation.y = this.yaw; e.scale.set(0.09, 1, L); e.opacity = 0.55 + 0.4 * pulse;
    }
    const er = this.big ? 0.9 + 0.15 * pulse : 0.55;
    this.end.position.set(this.x + dx * L, y + 0.01, this.z + dz * L); this.end.scale.set(er, 1, er); this.end.opacity = 0.6 + 0.4 * pulse;
    this.chev.forEach((c, i) => {
      const u = ((this.t * 1.4 + i / 3) % 1);
      c.position.set(this.x + dx * L * u, y + 0.012, this.z + dz * L * u); c.rotation.y = this.yaw;
      const s = w * 0.55; c.scale.set(s, 1, s); c.opacity = Math.sin(u * Math.PI) * 0.9;
    });
  }
  kill() { this.dead = true; }
}

export class ChameleonBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'chameleon', name: '카멜레온 카멜', hp: 50, music: 'boss', title: '정글의 숨바꼭질 대장', introDist: 8.5, outroDist: 7.5, camWeight: 0.25, ...o });
    this.pillars = (o.pillars || []).map((p) => ({ x: p.x, z: p.z, r: p.r ?? 0.95 }));
    this.patterns = [
      ['tongue', 'spit', 'vanish', 'walk', 'vanish', 'spit', 'tongue', 'vanish'],
      ['vanish', 'spit', 'tongue2', 'vanish', 'walk', 'vanish2', 'spit'],
      ['vanish2', 'spit', 'tongue2', 'vanish2', 'walk', 'vanish', 'spit'],
    ];
    this.sleepAnim = 'vanish'; // hides in plain sight until the player arrives
    this.hidden = true;
    this.lastStuck = 0;
    this.tg = null;
    this.tipPos = new Vec3();
    this.camPos = this.pos.clone();
    this.camFocus = { pos: this.camPos, weight: this.o.camWeight ?? 0.25 };
    this.fxList = [];
  }

  // ---------------------------------------------------------------- hit volumes
  spheres() {
    if (this.hidden) return [];
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const x = this.pos.x, y = this.pos.y, z = this.pos.z;
    const out = [
      { x: x - fx * 0.1, y: y + 1.3, z: z - fz * 0.1, r: 1.2, mul: 1 },
      { x: x + fx * 1.45, y: y + 2.05, z: z + fz * 1.45, r: 0.95, mul: 1 },
    ];
    if (this.mode === 'stuck') out.push({ x: this.tipPos.x, y: this.tipPos.y, z: this.tipPos.z, r: 0.8, mul: 1 });
    return out;
  }
  hurtTest(x, y, z, r) { if (this.hidden) return false; return super.hurtTest(x, y, z, r); }
  shadow() { if (this.hidden || this.state === 'sleep') return null; return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 3.2 }; }

  // ---------------------------------------------------------------- flow hooks
  async introPose(dir) {
    this.hidden = false;
    this.play('appear');
    sfx('magic', { pitch: 0.7 });
    for (let i = 0; i < 8; i++) CTX.fx.petals({ x: this.pos.x + (Math.random() - 0.5) * 3, y: this.pos.y + 1.5 + Math.random(), z: this.pos.z + (Math.random() - 0.5) * 3 }, [[0.5, 0.9, 0.5], [0.7, 1, 0.6]], 3);
    await dir.wait(1.0);
    this.play('tongueWindup');
    sfx('charge', { pitch: 1.2 });
    await dir.wait(0.6);
    this.play('tongueOut', { tongueLen: 5 });
    sfx('whoosh', { pitch: 1.3 });
    CTX.fx.shake(0.3, 0.4);
    await dir.wait(0.9);
    this.play('idle');
  }
  onFightStart(quick) {
    this._cleanup();
    this.weakMul = 1; this.contact = true; this.armored = false;
    this.lastStuck = this.fightT;
    this.pi = 0;
    if (quick) { this.hidden = true; this.next = 'tongue'; this.pickSpot(true); this.setMode('appear'); }
    else { this.hidden = false; this.setMode('idle'); }
    if (!this._hinted) { this._hinted = true; setTimeout(() => CTX.hud.toast('분홍 줄로 혀가 쭉! 나무 기둥 뒤에 숨으면 혀가 기둥에 붙어요!', 'warn', 3.4), 600); }
  }
  onReset() { this._cleanup(); this.hidden = true; this.weakMul = 1; this.contact = true; this.tg = null; this.camPos.copy(this.pos); }
  // defer the defeat by one boss update: BossController.defeat() clears all projectiles, which crashes
  // Projectiles.update() when the killing blow comes from a player projectile (clear() inside its loop)
  defeat() {
    if (this.dying || this._defeatPending) return;
    this._defeatPending = true;
    this._cleanup(); this.hidden = false; this.weakMul = 1; this.contact = false;
  }
  update(dt) {
    if (this._defeatPending) { this._defeatPending = false; super.defeat(); }
    super.update(dt);
  }
  _cleanup() {
    for (const f of this.fxList) { if (f.kill) f.kill(); else f.dead = true; }
    this.fxList.length = 0;
    this.line = null;
  }
  _track(f) { this.fxList.push(f); return f; }

  // ---------------------------------------------------------------- tongue geometry
  mouthAt(yaw) { return { x: this.pos.x + Math.sin(yaw) * MOUTH_Z, z: this.pos.z + Math.cos(yaw) * MOUTH_Z }; }
  // reach along yaw from the mouth: stops at the first pillar (stick!) or TONGUE_MAX
  reach(yaw) {
    const m = this.mouthAt(yaw), dx = Math.sin(yaw), dz = Math.cos(yaw);
    let len = TONGUE_MAX, pillar = null;
    for (const P of this.pillars) {
      const px = P.x - m.x, pz = P.z - m.z;
      const t = px * dx + pz * dz;
      if (t < 0) continue;
      const h = Math.abs(px * dz - pz * dx), R = P.r + 0.26;
      if (h >= R) continue;
      const s = t - Math.sqrt(R * R - h * h);
      if (s > 0.25 && s < len) { len = s; pillar = P; }
    }
    return { len, pillar, mx: m.x, mz: m.z, dx, dz };
  }
  // pick a spot to re-appear; shielded = a pillar sits between Kamel and the player
  pickSpot(shielded) {
    const p = this.player, a = this.arena;
    const okSpot = (x, z) => {
      if (Math.hypot(x - a.x, z - a.z) > a.r - 2.6) return false;
      if (Math.hypot(x - p.pos.x, z - p.pos.z) < 4.8) return false;
      for (const P of this.pillars) if (Math.hypot(x - P.x, z - P.z) < P.r + 2.0) return false;
      return true;
    };
    for (let tries = 0; tries < 60; tries++) {
      let x, z;
      if (shielded && this.pillars.length && tries < 40) {
        const ps = this.pillars.slice().sort((A, B) => Math.hypot(A.x - p.pos.x, A.z - p.pos.z) - Math.hypot(B.x - p.pos.x, B.z - p.pos.z));
        const P = ps[Math.min(ps.length - 1, Math.floor(Math.random() * 2))];
        const ang = Math.atan2(P.x - p.pos.x, P.z - p.pos.z) + (Math.random() - 0.5) * 0.3;
        const off = P.r + 4.2 + Math.random() * 1.8;
        x = P.x + Math.sin(ang) * off; z = P.z + Math.cos(ang) * off;
        if (!okSpot(x, z)) continue;
        // the tongue aimed at the player must hit that pillar first
        const yaw = Math.atan2(p.pos.x - x, p.pos.z - z);
        const save = { x: this.pos.x, z: this.pos.z };
        this.pos.x = x; this.pos.z = z;
        const r = this.reach(yaw);
        this.pos.x = save.x; this.pos.z = save.z;
        if (!r.pillar) continue;
      } else {
        const ang = Math.random() * TAU, d = 5.5 + Math.random() * 3.2;
        x = p.pos.x + Math.sin(ang) * d; z = p.pos.z + Math.cos(ang) * d;
        if (!okSpot(x, z)) continue;
      }
      this.pos.x = x; this.pos.z = z;
      return true;
    }
    const q = this.randomArenaPoint(2, 0.6);
    this.pos.x = q.x; this.pos.z = q.z;
    return false;
  }
  _pushFromPillars() {
    for (const P of this.pillars) {
      const dx = this.pos.x - P.x, dz = this.pos.z - P.z, d = Math.hypot(dx, dz), m = P.r + 1.7;
      if (d < m && d > 1e-4) { this.pos.x = P.x + dx / d * m; this.pos.z = P.z + dz / d * m; }
    }
  }

  // ---------------------------------------------------------------- brain
  think(dt) {
    const p = this.player;
    const ph = this.phase;
    // smooth camera focus (Kamel teleports around)
    this.camPos.x += (this.pos.x - this.camPos.x) * Math.min(1, dt * 2.5);
    this.camPos.z += (this.pos.z - this.camPos.z) * Math.min(1, dt * 2.5);
    this.camPos.y = this.pos.y;
    if (this.fxList.length > 24) this.fxList = this.fxList.filter((f) => !f.dead);
    switch (this.mode) {
      case 'idle': {
        this.play('idle');
        this.facePlayer(4, dt);
        if (this.mt > [0.9, 0.7, 0.5][ph - 1]) {
          const m = this.nextFromPattern();
          // pity: make sure a weak moment (tongue stuck in a pillar) comes regularly
          const pity = this.fightT - this.lastStuck > 11;
          if (m === 'vanish' || m === 'vanish2' || pity) {
            this.next = (m === 'vanish2' || (pity && ph >= 2)) ? 'tongue2' : 'tongue';
            this.forceShield = pity;
            this.setMode('vanish');
          } else this.setMode(m);
        }
        break;
      }
      case 'walk': {
        const tp = this.toPlayer();
        if (tp.d > 5.4) { this.walkToward(p.pos.x, p.pos.z, [1.9, 2.3, 2.7][ph - 1], dt); this._pushFromPillars(); this.play('walk', { speed: 1.0 }); }
        else { this.play('idle'); this.facePlayer(6, dt); }
        if (this.mt > 2.6 || (tp.d <= 5.4 && this.mt > 0.7)) this.setMode(ph >= 2 ? 'tongue2' : 'tongue');
        break;
      }
      case 'spit': {
        const n = [3, 4, 5][ph - 1];
        if (this.mt < dt * 1.5) { this.play('tongueWindup'); sfx('charge', { pitch: 1.35 }); this._spits = 0; }
        this.facePlayer(6, dt);
        if (this._spits < n && this.mt > 0.6 + this._spits * 0.24) { this._spitSeed(this._spits, n); this._spits++; }
        if (this.mt > 0.6 + n * 0.24 + 0.45) this.setMode('idle');
        break;
      }
      case 'vanish': {
        if (this.mt < dt * 1.5) {
          this.play('vanish'); sfx('magic', { pitch: 0.75 }); this.contact = false;
          CTX.fx.petals({ x: this.pos.x, y: this.pos.y + 1.6, z: this.pos.z }, [[0.45, 0.9, 0.5], [0.7, 1, 0.55], [1, 0.95, 0.6]], 10);
        }
        if (this.mt > 0.55) this.hidden = true;
        if (this.mt > 1.2) {
          const bias = [0.75, 0.6, 0.5][ph - 1];
          const shield = this.forceShield || Math.random() < bias;
          this.forceShield = false;
          this.pickSpot(shield);
          this.yaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          this.setMode('hidden');
        }
        break;
      }
      case 'hidden': {
        this.play('vanish');
        const dur = [0.9, 0.75, 0.6][ph - 1];
        if (this.mt < dt * 1.5) {
          this._track(new Marker(this.level, this.pos.x, this.ground, this.pos.z, 1.5, dur + 0.7, { color: 0x8affb0 }));
        }
        if (Math.random() < dt * 10) CTX.fx.petals({ x: this.pos.x + (Math.random() - 0.5) * 2, y: this.pos.y + 0.4 + Math.random() * 1.4, z: this.pos.z + (Math.random() - 0.5) * 2 }, [[0.45, 0.9, 0.5], [0.7, 1, 0.55]], 1);
        if (this.mt > dur) this.setMode('appear');
        break;
      }
      case 'appear': {
        const eyes = [0.7, 0.55, 0.45][ph - 1];
        if (this.mt < dt * 1.5) { this.play('appear'); sfx('pop', { pitch: 1.4 }); this.yaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z); }
        if (this.mt < eyes) this.animT = Math.min(this.animT, 0.15); // eyes peek out first
        this.facePlayer(6, dt);
        if (this.mt > eyes + 0.3) this.hidden = false;
        if (this.mt > eyes + 0.65) { this.contact = true; this.setMode(this.next || 'tongue'); this.next = null; }
        break;
      }
      case 'tongue':
      case 'tongue2': this._tongue(dt); break;
      case 'stuck': {
        const dur = [3.4, 3.0, 2.6][ph - 1];
        if (this.mt < dt * 1.5) {
          this.play('tongueStuck', { tongueLen: this.tg ? this.tg.len : 4 });
          this.lastStuck = this.fightT;
          sfx('bounce', { pitch: 0.6 });
          CTX.fx.shake(0.2, 0.25);
          CTX.fx.sparkle(this.tipPos, PAL.gold, 14, 0.6);
          if (!this._taught) { this._taught = true; CTX.hud.toast('혀가 나무에 쏙 붙었어요! 반짝이는 혀 끝을 마구마구 공격해요!', 'good', 3.2); }
        }
        this.contact = false;
        this.weakMul = 2;
        if (Math.random() < dt * 5) CTX.fx.stunStars(new Vec3(this.pos.x + Math.sin(this.yaw) * 1.4, this.pos.y + 3.0, this.pos.z + Math.cos(this.yaw) * 1.4));
        if (Math.random() < dt * 6) CTX.fx.twinkle(this.tipPos, [1, 0.55, 0.8], 0.5);
        if (this.mt > dur) {
          this.weakMul = 1;
          this.play('tongueOut', { tongueLen: this.tg ? this.tg.len : 4 });
          this.animT = 0.45;
          sfx('whoosh', { pitch: 0.8 });
          this.setMode('retract');
        }
        break;
      }
      case 'retract': {
        this.contact = true;
        if (this.mt > 0.45) { this.tg = null; this.next = ph >= 2 ? 'tongue2' : 'tongue'; this.setMode(Math.random() < 0.6 ? 'vanish' : 'idle'); }
        break;
      }
      default: this.setMode('idle');
    }
    this.pos.y = this.ground;
  }

  _spitSeed(i, n) {
    const p = this.player;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const from = new Vec3(this.pos.x + fx * 2.3, this.pos.y + 1.75, this.pos.z + fz * 2.3);
    const base = Math.atan2(p.pos.x - from.x, p.pos.z - from.z);
    const a = base + (i - (n - 1) / 2) * 0.24;
    const d = Math.max(2, Math.hypot(p.pos.x - from.x, p.pos.z - from.z));
    const sp = 8.5, T = d / sp, g = 6;
    const vy = (p.pos.y + 0.5 - from.y) / T + 0.5 * g * T;
    this.shoot('seed', from, new Vec3(Math.sin(a) * sp, vy, Math.cos(a) * sp), { gravity: g, scale: 3.4, r: 0.34, life: 2.6, spin: 6 });
    this.play('tongueWindup'); this.restartAnim(); this.animT = 0.3;
    sfx('shoot', { pitch: 1.5, vol: 0.8 });
  }

  // tongue attack: wind-up with a tracking line -> lock -> shoot -> stick or retract
  _startTongue(chained) {
    this.tg = { stage: 'windup', t: 0, chained, chain: !chained && this.mode === 'tongue2' ? 1 : 0, len: TONGUE_MAX, pillar: null };
    this.play('tongueWindup');
    this.restartAnim();
    sfx('charge', { pitch: chained ? 1.3 : 1.1 });
    if (this.line) this.line.kill();
    this.line = this._track(new LineMarker(this.level));
  }
  _tongue(dt) {
    const p = this.player, ph = this.phase;
    if (!this.tg) this._startTongue(false);
    const S = this.tg;
    S.t += dt;
    const windup = S.chained ? 0.55 : [0.95, 0.75, 0.62][ph - 1];
    const lockAt = windup - [0.38, 0.32, 0.28][ph - 1];
    if (S.stage === 'windup') {
      if (S.t < lockAt) this.facePlayer(7, dt);
      const r = this.reach(this.yaw);
      S.len = r.len; S.pillar = r.pillar;
      if (this.line) { this.line.set(r.mx, this.ground, r.mz, this.yaw, r.len); this.line.locked = S.t >= lockAt; this.line.big = !!r.pillar; }
      if (S.t >= windup) {
        S.stage = 'out'; S.t = 0; S.hit = false; S.impact = false;
        this.play('tongueOut', { tongueLen: S.len });
        sfx('whoosh', { pitch: 1.35 });
        sfx('bite', { pitch: 0.8, vol: 0.6 });
      }
      return;
    }
    // stage 'out'
    const r = this.reach(this.yaw);
    const ext = S.len * Ease.outCubic(clamp(S.t / 0.18, 0, 1));
    this.tipPos.set(r.mx + r.dx * ext, this.ground + MOUTH_Y - TONGUE_SLOPE * ext, r.mz + r.dz * ext);
    if (!S.hit && S.t > 0.04 && S.t < 0.45 && !p.dead) {
      const vx = p.pos.x - r.mx, vz = p.pos.z - r.mz;
      const along = clamp(vx * r.dx + vz * r.dz, 0, ext);
      const qx = r.mx + r.dx * along, qz = r.mz + r.dz * along;
      const dd = Math.hypot(p.pos.x - qx, p.pos.z - qz);
      const topY = this.ground + MOUTH_Y - TONGUE_SLOPE * along + 0.15;
      if (dd < 0.8 && p.pos.y < topY && p.pos.y > this.ground - 1) {
        const sx = (p.pos.x - qx) || r.dz, sz = (p.pos.z - qz) || -r.dx;
        if (p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, { x: p.pos.x - sx, y: p.pos.y, z: p.pos.z - sz }, { knock: 7, up: 7 })) S.hit = true;
      }
    }
    if (S.t >= 0.18 && !S.impact) {
      S.impact = true;
      if (S.pillar && !S.hit) { CTX.fx.hit(this.tipPos, PAL.pink, 1.2); CTX.fx.shake(0.15, 0.2); sfx('hit', { pitch: 0.7 }); }
    }
    if (S.t >= 0.24 && this.line) { this.line.kill(); this.line = null; }
    if (S.t >= 0.45 && S.pillar && !S.hit) { this.setMode('stuck'); return; }
    if (S.t >= 0.72) {
      if (S.chain > 0) this._startTongue(true);
      else { this.tg = null; this.setMode('idle'); }
    }
  }
}
void Mesh;

// ============================================================================
// bosses/yeti.js — 눈보라 예티 (stage 6, aurora summit).
// A big fluffy snow yeti fogged by the Gray Fog. Attacks (all telegraphed):
//  · throw   — winds up a snowball, lobs it at a ground marker; it bursts into
//              a small shock ring. 'throw2' = two in a row.
//  · roll    — a huge snowball lands in front of him and ROLLS along a marked
//              lane (jump over it / step aside).
//  · slam    — both hands hit the ground: shock ring to jump over + icicles
//              falling on pink markers.
//  · blow    — inhale (puffs up) → blizzard breath that pushes you away and
//              blows little snowballs. Hide behind an ice pillar (wind shadow)
//              or be a heavy animal (bear...) to stand firm.
//  · charge  — paws the ground while a lane marker points at you, then runs
//              straight. Into an ICE PILLAR → stunned (weak ×2, long) ·
//              into the arena wall → bonk (weak ×2, short).
//  · summon  — throws two snowballs that pop into little snowball critters.
// Opts (besides BossController's): pillars: [[x, z, r], ...] (arena ice pillars).
// ============================================================================
import { Vec3, clamp, lerp, TAU } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { TILE } from '../../engine/texgen.js';
import { CTX } from '../ctx.js';
import { BossController } from './boss.js';
import { spawnEnemy } from '../systems/enemies.js';
import { PAL } from '../fx.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const bossDmg = () => (CTX.diff ? CTX.diff.bossDmg : 1);
let SNOW_MAT = null, ICE_MAT = null;
const snowMat = () => SNOW_MAT || (SNOW_MAT = new Material({ color: 0xf6faff, rim: 0.5, spec: 0.18 }));
const iceMat = () => ICE_MAT || (ICE_MAT = new Material({ color: 0xc8f0ff, spec: 0.6, rim: 0.6, transparent: true, opacity: 0.92 }));

// ------------------------------------------------------------------ lane telegraph (charge / rolling snowball path) — also used by clockknight.js
export class LaneMarker {
  constructor(level, color = 0xff6a9a) {
    this.node = new Node('laneMarker');
    const m = () => new Material({ color, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false });
    this.plane = new Mesh(G.UNIT.plane(), m());
    this.plane.renderOrder = 7;
    this.node.add(this.plane);
    this.dots = [];
    for (let i = 0; i < 4; i++) {
      const d = new Mesh(G.UNIT.disc(), m());
      d.renderOrder = 7;
      this.node.add(d);
      this.dots.push(d);
    }
    this.t = 0; this.len = 1; this.w = 1.6; this.fade = 1; this.dying = false;
    level.add(this);
  }
  set(x, y, z, yaw, len, w = 1.6) {
    this.node.position.set(x, y + 0.07, z);
    this.node.rotation.y = yaw;
    this.len = Math.max(0.5, len); this.w = w;
    this.plane.scale.set(w, 1, this.len);
    this.plane.position.z = this.len / 2;
  }
  kill() { this.dying = true; }
  update(dt) {
    this.t += dt;
    if (this.dying) { this.fade -= dt * 4; if (this.fade <= 0) { this.dead = true; return; } }
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 14);
    this.plane.opacity = (0.16 + 0.2 * pulse) * this.fade;
    this.dots.forEach((d, i) => {
      const u = ((this.t * 0.9 + i / this.dots.length) % 1);
      d.position.set(0, 0.01, u * this.len);
      const s = this.w * 0.32 * (1 - u * 0.4);
      d.scale.set(s, 1, s);
      d.opacity = (0.75 - u * 0.5) * this.fade;
    });
  }
}

// ------------------------------------------------------------------ big snowball (lobbed → burst, or lobbed → roll)
class BigSnowball {
  // o: { T, R, roll: {dx, dz, speed} | null, onLand(ball) }
  constructor(boss, from, to, o = {}) {
    this.boss = boss;
    this.R = o.R ?? 0.9;
    this.T = o.T ?? 1.0;
    this.from = from.clone();
    this.to = new Vec3(to.x, boss.ground, to.z);
    this.roll = o.roll || null;
    this.onLand = o.onLand || null;
    this.burst = o.burst ?? true;
    this.arc = o.arc ?? (2.2 + this.from.distanceTo(this.to) * 0.18);
    this.node = new Node('bigSnowball');
    this.ball = new Node('ballSpin');
    this.node.add(this.ball);
    const m = new Mesh(G.UNIT.sphere(), snowMat());
    m.scale.set(this.R, this.R, this.R);
    this.ball.add(m);
    for (let i = 0; i < 5; i++) {
      const a = i * 2.39, b = Math.sin(i * 1.7) * 0.9;
      const lump = new Mesh(G.UNIT.sphereLo(), snowMat());
      const s = this.R * (0.32 + 0.08 * Math.sin(i * 3.1));
      lump.scale.set(s, s, s);
      lump.position.set(Math.cos(a) * Math.cos(b) * this.R * 0.82, Math.sin(b) * this.R * 0.82, Math.sin(a) * Math.cos(b) * this.R * 0.82);
      this.ball.add(lump);
    }
    this.node.position.copy(this.from);
    this.node.scale.set(0.5, 0.5, 0.5);
    this.t = 0; this.state = 'fly';
    this.mark = boss.marker(this.to.x, this.to.z, this.R + 0.45, this.T);
    if (this.roll) {
      this.lane = new LaneMarker(boss.level, 0xff8ab4);
      const len = boss.edgeDist(this.to.x, this.to.z, this.roll.dx, this.roll.dz);
      this.lane.set(this.to.x, boss.ground, this.to.z, Math.atan2(this.roll.dx, this.roll.dz), len, this.R * 2);
      boss.track(this.lane);
    }
    boss.level.add(this);
    boss.track(this);
    this.hitDone = false;
  }
  kill() { this.dead = true; if (this.lane) this.lane.kill(); if (this.mark) this.mark.dead = true; }
  update(dt) {
    this.t += dt;
    const B = this.boss;
    if (this.state === 'fly') {
      const k = clamp(this.t / this.T, 0, 1);
      const s = 0.5 + 0.5 * Math.min(1, k * 3);
      this.node.scale.set(s, s, s);
      this.node.position.set(lerp(this.from.x, this.to.x, k), lerp(this.from.y, this.to.y + this.R, k) + Math.sin(k * Math.PI) * this.arc, lerp(this.from.z, this.to.z, k));
      this.ball.rotation.x += dt * 6;
      if (k >= 1) this.land();
    } else if (this.state === 'roll') {
      const R = this.roll;
      const sp = R.speed * (CTX.diff ? CTX.diff.hazardSpeed : 1);
      this.node.position.x += R.dx * sp * dt;
      this.node.position.z += R.dz * sp * dt;
      this.node.rotation.y = Math.atan2(R.dx, R.dz);
      this.ball.rotation.x += (sp / this.R) * dt;
      if (Math.random() < dt * 20) CTX.fx.dust({ x: this.node.position.x, y: B.ground, z: this.node.position.z }, 1, 0.9);
      const x = this.node.position.x, z = this.node.position.z;
      const a = B.arena;
      if (Math.hypot(x - a.x, z - a.z) > a.r - this.R - 0.3 || B.pillarAt(x, z, this.R) || this.t > 6) this.shatter(true);
    }
    // hurt the player on touch
    const p = CTX.player;
    if (!this.dead && !this.hitDone && p && !p.dead && this.state !== 'done') {
      const c = this.node.position;
      const dx = p.pos.x - c.x, dy = p.pos.y + 0.55 - c.y, dz = p.pos.z - c.z;
      const rr = this.R * this.node.scale.x + 0.38;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        if (p.hurt(bossDmg(), { x: c.x, y: c.y, z: c.z }, { knock: 8, up: 8 })) { this.hitDone = true; if (this.state === 'fly') this.land(); }
      }
    }
  }
  land() {
    const B = this.boss;
    this.node.position.set(this.to.x, B.ground + this.R, this.to.z);
    this.node.scale.set(1, 1, 1);
    if (this.mark) this.mark.dead = true;
    CTX.fx.dust({ x: this.to.x, y: B.ground, z: this.to.z }, 12, 1.6);
    sfx('land', { pitch: 0.6, vol: 0.9 });
    const d = CTX.player ? Math.hypot(CTX.player.pos.x - this.to.x, CTX.player.pos.z - this.to.z) : 99;
    if (d < 14) CTX.fx.shake(0.25 * (1 - d / 14), 0.25);
    if (this.onLand) this.onLand(this);
    if (this.roll) { this.state = 'roll'; this.t = 0; sfx('roll', { pitch: 0.6 }); return; }
    this.shatter(this.burst);
  }
  shatter(ring) {
    if (this.state === 'done') return;
    this.state = 'done';
    const c = this.node.position;
    CTX.fx.iceBurst({ x: c.x, y: c.y, z: c.z });
    CTX.fx.poof({ x: c.x, y: c.y, z: c.z }, [[1, 1, 1], [0.9, 0.95, 1]]);
    CTX.fx.sparkle({ x: c.x, y: c.y, z: c.z }, PAL.white, 8, this.R);
    sfx('crumble', { pitch: 1.3, vol: 0.7 });
    if (ring) this.boss.shock(c.x, c.z, { maxR: 3.6, speed: 5.5, h: 0.45, color: 0xe8f6ff });
    this.kill();
  }
}

// ------------------------------------------------------------------ icicle falling onto a marker
class Icicle {
  constructor(boss, x, z, delay) {
    this.boss = boss;
    this.x = x; this.z = z; this.g = boss.ground;
    this.delay = delay; this.h = 9; this.y = this.g + this.h; this.v = 0;
    this.node = new Node('icicle');
    const cone = new Mesh(G.UNIT.cone(), iceMat());
    cone.scale.set(0.42, 1.5, 0.42);
    cone.rotation.x = Math.PI;
    this.node.add(cone);
    const cap = new Mesh(G.UNIT.sphereLo(), snowMat());
    cap.scale.set(0.46, 0.22, 0.46);
    cap.position.y = 0.72;
    this.node.add(cap);
    this.node.position.set(x, this.y, z);
    this.node.visible = false;
    this.t = 0;
    this.mark = boss.marker(x, z, 0.95, delay + 0.55);
    boss.level.add(this);
    boss.track(this);
  }
  kill() { this.dead = true; if (this.mark) this.mark.dead = true; }
  update(dt) {
    this.t += dt;
    if (this.t < this.delay) return;
    this.node.visible = true;
    this.v += 34 * dt;
    this.y -= this.v * dt;
    this.node.position.set(this.x, this.y, this.z);
    const p = CTX.player;
    if (p && !p.dead) {
      const dx = p.pos.x - this.x, dz = p.pos.z - this.z;
      if (dx * dx + dz * dz < 0.95 * 0.95 && p.pos.y + 1.0 > this.y - 0.75 && p.pos.y < this.y + 0.8) { p.hurt(bossDmg(), { x: this.x, y: this.y, z: this.z }, { knock: 6, up: 6 }); this.land(); return; }
    }
    if (this.y - 0.75 <= this.g) this.land();
  }
  land() {
    if (this.dead) return;
    CTX.fx.iceBurst({ x: this.x, y: this.g + 0.4, z: this.z });
    CTX.fx.sparkle({ x: this.x, y: this.g + 0.4, z: this.z }, [0.8, 0.95, 1], 8, 0.6);
    sfx('crystal', { pitch: 0.7 + Math.random() * 0.2, vol: 0.6 });
    this.kill();
  }
}

// ============================================================================
export class YetiBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'yeti', name: '눈보라 예티', hp: 58, music: 'boss', title: '오로라 산꼭대기의 눈보라 대장', introDist: 10, outroDist: 9, camWeight: 0.4, ...o });
    this.pillars = (o.pillars || []).map((p) => ({ x: p[0], z: p[1], r: p[2] ?? 0.95 }));
    this.patterns = [
      ['throw', 'walk', 'charge', 'slam', 'throw', 'charge', 'walk', 'blow', 'charge'],
      ['charge', 'throw2', 'slam', 'charge', 'summon', 'blow', 'roll', 'charge', 'slam'],
      ['charge', 'slam', 'roll', 'charge', 'blow', 'throw2', 'charge', 'summon', 'slam', 'charge'],
    ];
    this.fxEnts = [];
    this.taught = {};
    this.stunDur = 3;
    this.sleepAnim = 'idle';
  }
  // ---------------------------------------------------------------- helpers
  track(e) { this.fxEnts.push(e); if (this.fxEnts.length > 40) this.fxEnts = this.fxEnts.filter((x) => !x.dead); return e; }
  clearFx() { for (const e of this.fxEnts) { if (e.kill) e.kill(); e.dead = true; } this.fxEnts.length = 0; }
  teach(key, text, kind = 'warn') { if (this.taught[key]) return; this.taught[key] = true; CTX.hud.toast(text, kind, 3.2); }
  get ph() { return this.phase - 1; }
  pillarAt(x, z, r = 0) { for (const pl of this.pillars) if (Math.hypot(x - pl.x, z - pl.z) < pl.r + r) return pl; return null; }
  // distance from (x,z) along (dx,dz) to the arena rim (minus a margin)
  edgeDist(x, z, dx, dz) {
    const a = this.arena, R = a.r - 0.8;
    const ox = x - a.x, oz = z - a.z;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R;
    const disc = b * b - c;
    return disc > 0 ? Math.max(0.5, -b + Math.sqrt(disc)) : 0.5;
  }
  // first pillar hit along a lane (for telegraph length)
  laneLen(x, z, dx, dz, w) {
    let len = this.edgeDist(x, z, dx, dz);
    for (const pl of this.pillars) {
      const px = pl.x - x, pz = pl.z - z;
      const t = px * dx + pz * dz;
      if (t <= 0 || t > len) continue;
      const off = Math.abs(px * dz - pz * dx);
      if (off < pl.r + w) len = Math.min(len, Math.max(0.5, t - Math.sqrt(Math.max(0, (pl.r + w) ** 2 - off * off))));
    }
    return len;
  }
  // is the player hidden behind a pillar as seen from the yeti?
  sheltered(p) {
    const x0 = this.pos.x, z0 = this.pos.z, dx = p.pos.x - x0, dz = p.pos.z - z0, L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    for (const pl of this.pillars) {
      const px = pl.x - x0, pz = pl.z - z0;
      const t = px * ux + pz * uz;
      if (t <= 0 || t > L) continue;
      if (Math.abs(px * uz - pz * ux) < pl.r + 0.45) return true;
    }
    return false;
  }
  avoidPillars() {
    for (const pl of this.pillars) {
      const dx = this.pos.x - pl.x, dz = this.pos.z - pl.z, d = Math.hypot(dx, dz) || 1, min = pl.r + 1.35;
      if (d < min) { this.pos.x = pl.x + dx / d * min; this.pos.z = pl.z + dz / d * min; }
    }
  }
  handPos() { const h = this.rig.parts.handR; h.updateWorldFromRoot(); return h.getWorldPosition(new Vec3()); }
  mouthPos() { const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; return new Vec3(this.pos.x + f.x * 1.45, this.pos.y + 1.75, this.pos.z + f.z * 1.45); }
  clampToArena(x, z, m = 1.6) {
    const a = this.arena, dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz), mx = a.r - m;
    return d > mx ? { x: a.x + dx / d * mx, z: a.z + dz / d * mx } : { x, z };
  }
  summonAt(x, z) {
    const alive = this.minions.filter((m) => m.alive).length;
    if (alive >= 3) return;
    const e = spawnEnemy(this.level, 'snowball', x, this.ground + 0.2, z, { variant: 'snow', range: 6, yaw: this.yaw });
    if (e) { CTX.fx.poof(new Vec3(x, this.ground + 0.6, z)); this.minions.push(e); sfx('magic', { pitch: 1.1 }); }
  }

  // ---------------------------------------------------------------- body
  spheres() {
    const x = this.pos.x, z = this.pos.z, y = this.pos.y;
    const sit = this.mode === 'stunned' ? 0.42 : 0;
    return [{ x, y: y + 1.35 - sit, z, r: 1.45, mul: 1 }, { x, y: y + 2.6 - sit, z, r: 1.05, mul: 1 }];
  }
  shadow() { return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 3.8 }; }
  async introPose(dir) {
    this.play('inhale');
    sfx('whoosh', { pitch: 0.5 });
    await dir.wait(1.0);
    this.play('blow');
    sfx('wind', { pitch: 0.8 });
    sfx('bossRoar', { pitch: 0.85 });
    CTX.fx.shake(0.35, 1.1);
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    for (let i = 0; i < 4; i++) {
      CTX.particles.emit({ pos: this.mouthPos(), count: 14, dir: { x: f.x, y: 0.05, z: f.z }, spread: 0.35, speed: [6, 11], life: [0.6, 1.1], size: [0.14, 0.3], sizeEnd: 0.6, colors: [[1, 1, 1], [0.85, 0.93, 1]], alpha: 0.95, tile: TILE.SNOW, spin: [1, 4] });
      await dir.wait(0.25);
    }
    await dir.wait(0.3);
    this.play('idle');
  }
  onFightStart() { this.setMode('idle'); this.pi = 0; this.th = null; this.weakMul = 1; this.contact = true; }
  onReset() { this.clearFx(); this.th = null; this.ch = null; this.weakMul = 1; this.contact = true; this.yaw = this.o.yaw ?? 0; }
  defeat() { this.clearFx(); return super.defeat(); }
  setMode(m) { if (this.mode === 'charge' && this.lane) { this.lane.kill(); this.lane = null; } super.setMode(m); }

  // ---------------------------------------------------------------- brain
  think(dt) {
    const p = this.player;
    const ph = this.ph;
    const near = p && !p.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 3.3;
    this.closeT = near && (this.mode === 'idle' || this.mode === 'walk' || this.mode === 'recover') ? (this.closeT || 0) + dt : Math.max(0, (this.closeT || 0) - dt * 0.5);
    switch (this.mode) {
      case 'idle': {
        this.play('idle');
        this.facePlayer(4, dt);
        // too close for too long → a quick slam to push the player back (not more often than every ~6 s)
        if (this.closeT > [1.6, 1.3, 1.0][ph] && this.fightT - (this.lastSlamT || -99) > 6) { this.closeT = 0; this.setMode('slam'); break; }
        if (this.mt > [0.9, 0.65, 0.45][ph]) this.setMode(this.nextFromPattern());
        break;
      }
      case 'walk': {
        const tp = this.toPlayer();
        if (tp.d > 3.6) { this.walkToward(p.pos.x, p.pos.z, [1.7, 2.1, 2.5][ph], dt); this.play('walk', { speed: 0.9 }); }
        else { this.play('idle'); this.facePlayer(5, dt); }
        if (this.mt > 2.2 || (tp.d <= 3.6 && this.mt > 0.8)) this.setMode('idle');
        break;
      }
      case 'throw': case 'throw2': case 'roll': case 'summon': this._throw(dt); break;
      case 'slam': this._slam(dt); break;
      case 'blow': this._blow(dt); break;
      case 'charge': this._charge(dt); break;
      case 'stunned': {
        if (this.mt < dt * 1.5) { this.play('stunned'); this.restartAnim(); }
        this.weakMul = 2; this.contact = false;
        if (Math.random() < dt * 5) CTX.fx.stunStars(new Vec3(this.pos.x + (Math.random() - 0.5), this.pos.y + 3.0, this.pos.z + (Math.random() - 0.5)));
        if (this.mt > this.stunDur) {
          this.weakMul = 1; this.contact = true;
          this.play('idle');
          sfx('whoosh', { pitch: 0.6 });
          CTX.fx.dust(this.pos, 12, 2.2);
          this.setMode('recover');
        }
        break;
      }
      case 'recover': { this.play('idle'); if (this.mt > 0.6) this.setMode('idle'); break; }
      default: this.setMode('idle');
    }
    this.pos.y = this.ground;
    if (this.mode !== 'charge') this.avoidPillars();
  }

  // ---------------------------------------------------------------- throw / roll / summon
  _throw(dt) {
    const p = this.player, ph = this.ph;
    if (!this.th || this.mt < dt * 1.5) {
      const count = this.mode === 'throw2' ? 2 : 1;
      this.th = { n: 0, count, stage: 'wind', t: 0, released: false };
      this.play('throwWindup'); this.restartAnim();
      sfx('charge', { pitch: 1.25, vol: 0.6 });
      if (this.mode === 'roll') this.teach('roll', '커다란 눈덩이가 데굴데굴! 분홍 길을 피하거나 점프해요!');
      if (this.mode === 'summon') this.teach('summon', '눈덩이 친구들이 튀어나와요! 톡톡 쳐서 착하게 만들어 줘요');
    }
    const T = this.th;
    T.t += dt;
    const wind = (T.n === 0 ? [0.95, 0.8, 0.65] : [0.6, 0.5, 0.45])[ph];
    if (T.stage === 'wind') {
      this.facePlayer(5, dt);
      if (T.t > wind) { T.stage = 'throw'; T.t = 0; T.released = false; this.play('throw'); this.restartAnim(); }
    } else {
      if (!T.released && T.t >= 0.15) { T.released = true; this._release(); }
      if (T.t > 0.6) {
        T.n++;
        if (T.n < T.count) { T.stage = 'wind'; T.t = 0; this.play('throwWindup'); this.restartAnim(); }
        else { this.th = null; this.setMode('idle'); }
      }
    }
    void p;
  }
  _release() {
    const p = this.player, ph = this.ph, from = this.handPos();
    sfx('throw', { pitch: 0.6 });
    if (this.mode === 'roll') {
      const tp = this.toPlayer();
      const l = this.clampToArena(this.pos.x + tp.dx * 3.2, this.pos.z + tp.dz * 3.2, 2.5);
      new BigSnowball(this, from, l, { T: 0.6, R: 1.05, arc: 1.6, roll: { dx: tp.dx, dz: tp.dz, speed: [6.0, 7.0, 8.0][ph] } });
    } else if (this.mode === 'summon') {
      const tp = this.toPlayer();
      for (const s of [-1, 1]) {
        const a = tp.yaw + s * 0.55;
        const t = this.clampToArena(this.pos.x + Math.sin(a) * 4.5, this.pos.z + Math.cos(a) * 4.5, 2);
        new BigSnowball(this, from, t, { T: 0.8, R: 0.5, burst: false, onLand: (b) => this.summonAt(b.to.x, b.to.z) });
      }
    } else {
      const lead = [0.25, 0.35, 0.45][ph];
      const t = this.clampToArena(p.pos.x + p.vel.x * lead, p.pos.z + p.vel.z * lead, 1.4);
      new BigSnowball(this, from, t, { T: [1.05, 0.95, 0.85][ph], R: 0.9 });
    }
  }

  // ---------------------------------------------------------------- slam
  _slam(dt) {
    const p = this.player, ph = this.ph;
    if (this.mt < dt * 1.5) {
      this.play('slam'); this.restartAnim();
      sfx('charge', { pitch: 0.75 });
      this.slamDone = false;
      this.lastSlamT = this.fightT;
      this.teach('slam', '쿵! 땅이 흔들려요. 점프해서 충격파를 넘고, 고드름 표시를 피해요!');
    }
    if (this.mt < 0.42) this.facePlayer(3.5, dt);
    if (!this.slamDone && this.mt >= 0.62) {
      this.slamDone = true;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const ix = this.pos.x + fx * 1.6, iz = this.pos.z + fz * 1.6;
      CTX.fx.shake(0.55, 0.5);
      CTX.fx.shock({ x: ix, y: this.ground, z: iz }, 3.6, [0.85, 0.95, 1]);
      CTX.fx.dust({ x: ix, y: this.ground, z: iz }, 16, 2);
      sfx('crusher', { pitch: 0.7 });
      this.shock(ix, iz, { maxR: [10, 11.5, 13][ph], speed: [7, 8, 9][ph], color: 0xdff4ff });
      if (Math.hypot(p.pos.x - ix, p.pos.z - iz) < 1.9 && p.pos.y < this.ground + 1.6) p.hurt(bossDmg(), { x: ix, y: this.ground, z: iz }, { knock: 9, up: 9 });
      const n = [3, 4, 6][ph];
      for (let i = 0; i < n; i++) {
        let x, z;
        for (let k = 0; k < 8; k++) {
          if (i < 2) { x = p.pos.x + (Math.random() - 0.5) * 2.4; z = p.pos.z + (Math.random() - 0.5) * 2.4; }
          else { const q = this.randomArenaPoint(2.5, 0.85); x = q.x; z = q.z; }
          const c = this.clampToArena(x, z, 1.2); x = c.x; z = c.z;
          if (!this.pillarAt(x, z, 0.6)) break;
        }
        new Icicle(this, x, z, 0.45 + i * 0.24);
      }
    }
    if (this.mt > 1.5) this.setMode('idle');
  }

  // ---------------------------------------------------------------- inhale → blizzard blow
  _blow(dt) {
    const p = this.player, ph = this.ph;
    const inT = [1.3, 1.1, 0.95][ph], blowT = [2.6, 3.0, 3.4][ph];
    if (this.mt < dt * 1.5) {
      this.play('inhale'); this.restartAnim();
      sfx('whoosh', { pitch: 0.55, vol: 0.8 });
      this.blowOn = false; this.puffT = 0.4;
      this.teach('blow', '예티가 숨을 크게 들이쉬어요! 얼음 기둥 뒤에 숨으면 눈보라를 피할 수 있어요');
    }
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    if (this.mt < inT) {
      this.facePlayer(3, dt);
      // snow streams into the mouth
      if (Math.random() < dt * 16) {
        const a = this.yaw + (Math.random() - 0.5) * 1.6, d = 4 + Math.random() * 3;
        const m = this.mouthPos();
        const s = { x: m.x + Math.sin(a) * d, y: m.y + (Math.random() - 0.3) * 2, z: m.z + Math.cos(a) * d };
        CTX.particles.emit({ pos: s, count: 1, vel: { x: (m.x - s.x) * 1.6, y: (m.y - s.y) * 1.6, z: (m.z - s.z) * 1.6 }, speed: 0, life: 0.55, size: 0.16, sizeEnd: 0.4, color: [0.92, 0.97, 1], alpha: 0.9, tile: TILE.SNOW, spin: [1, 3] });
      }
    } else if (this.mt < inT + blowT) {
      if (!this.blowOn) { this.blowOn = true; this.play('blow'); this.restartAnim(); sfx('wind', { pitch: 0.75, vol: 1 }); CTX.fx.shake(0.18, blowT * 0.9); }
      this.facePlayer(0.85, dt);
      // breath particles (visual cone)
      const m = this.mouthPos();
      if (Math.random() < dt * 40) CTX.particles.emit({ pos: m, count: 2, dir: { x: f.x, y: -0.02, z: f.z }, spread: 0.32, speed: [8, 13], life: [0.7, 1.1], size: [0.12, 0.26], sizeEnd: 0.5, colors: [[1, 1, 1], [0.85, 0.93, 1]], alpha: 0.9, tile: TILE.SNOW, spin: [1, 4] });
      // push the player away (unless sheltered by a pillar)
      if (p && !p.dead) {
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
        const cosA = (dx * f.x + dz * f.z) / d;
        if (d < 17 && cosA > 0.5 && !this.sheltered(p)) {
          const k = (p.heavy ? 0.22 : 1) * clamp(1.15 - d / 17, 0.35, 1);
          const ux = dx / d, uz = dz / d;
          if (p.body.grounded) { p.pos.x += ux * 3.6 * k * dt; p.pos.z += uz * 3.6 * k * dt; }
          else { p.vel.x += ux * 11 * k * dt; p.vel.z += uz * 11 * k * dt; }
          if (p.heavy && !this.taught.heavy) this.teach('heavy', '무거운 친구는 눈보라에도 끄떡없어요!', 'good');
        }
      }
      // little snowballs riding the wind
      this.puffT -= dt;
      if (this.puffT <= 0) {
        this.puffT = [0.55, 0.4, 0.3][ph];
        const a = this.yaw + (Math.random() - 0.5) * 0.9;
        const sp = 8 + Math.random() * 2;
        this.shoot('snowball', m, new Vec3(Math.sin(a) * sp, -0.6, Math.cos(a) * sp), { r: 0.32, scale: 2.4, gravity: 2.5, life: 2.3 });
      }
    } else if (this.mt < inT + blowT + 1.2) {
      // out of breath (a good moment to hit him)
      if (this.blowOn) { this.blowOn = false; this.play('idle'); sfx('whoosh', { pitch: 1.2, vol: 0.4 }); }
      if (Math.random() < dt * 6) CTX.fx.dust({ x: this.mouthPos().x, y: this.pos.y + 1.6, z: this.mouthPos().z }, 1, 0.5);
    } else this.setMode('idle');
  }

  // ---------------------------------------------------------------- charge
  _charge(dt) {
    const p = this.player, ph = this.ph;
    const windT = [1.2, 1.0, 0.85][ph], lockT = windT - 0.32;
    if (this.mt < dt * 1.5 || !this.ch) {
      this.ch = { run: false, dir: this.toPlayer().yaw, t: 0 };
      this.lane = new LaneMarker(this.level, 0xff6a9a);
      this.track(this.lane);
      this.play('charge', { speed: 0 }); this.restartAnim();
      sfx('charge', { pitch: 0.6 });
      this.teach('charge', '예티가 돌진하려고 해요! 얼음 기둥 뒤에 숨으면 기둥에 쾅! 부딪혀요', 'warn');
    }
    const C = this.ch;
    const dx = Math.sin(C.dir), dz = Math.cos(C.dir);
    if (!C.run) {
      if (this.mt < lockT) { C.dir = this.toPlayer().yaw; this.face(C.dir, 9, dt); }
      else this.face(C.dir, 14, dt);
      this.animExtra = { speed: 0 };
      if (this.lane) this.lane.set(this.pos.x + dx * 1.2, this.ground, this.pos.z + dz * 1.2, C.dir, this.laneLen(this.pos.x + dx * 1.2, this.pos.z + dz * 1.2, dx, dz, 1.2), 3.4);
      if (Math.random() < dt * 14) CTX.fx.dust({ x: this.pos.x - dx * 0.6, y: this.ground, z: this.pos.z - dz * 0.6 }, 1, 1.2);
      if (this.mt >= windT) {
        C.run = true; C.t = 0;
        this.yaw = C.dir;
        this.play('charge', { speed: 1.5 });
        sfx('dash', { pitch: 0.55 });
        sfx('bossRoar', { pitch: 1.2, vol: 0.6 });
        CTX.fx.shake(0.15, 0.2);
      }
      return;
    }
    C.t += dt;
    const sp = [10, 11.5, 13][ph] * Math.min(1, 0.35 + C.t * 4);
    this.pos.x += dx * sp * dt; this.pos.z += dz * sp * dt;
    this.yaw = C.dir;
    if (Math.random() < dt * 30) CTX.fx.dust({ x: this.pos.x, y: this.ground, z: this.pos.z }, 1, 1.3);
    if (Math.random() < dt * 8) CTX.fx.shake(0.06, 0.08);
    // ice pillar → big bonk, long stun
    const pl = this.pillarAt(this.pos.x, this.pos.z, 1.2);
    if (pl) {
      const ox = this.pos.x - pl.x, oz = this.pos.z - pl.z, od = Math.hypot(ox, oz) || 1;
      this.pos.x = pl.x + ox / od * (pl.r + 1.45); this.pos.z = pl.z + oz / od * (pl.r + 1.45);
      CTX.fx.shake(0.6, 0.5);
      CTX.fx.hitStop(0.12);
      CTX.fx.iceBurst({ x: pl.x, y: this.ground + 2.2, z: pl.z });
      CTX.fx.iceBurst({ x: pl.x, y: this.ground + 1.2, z: pl.z });
      CTX.fx.sparkle({ x: pl.x, y: this.ground + 2.5, z: pl.z }, [0.8, 0.95, 1], 18, 1.2);
      sfx('crusher', { pitch: 0.9 });
      sfx('crystal', { pitch: 0.6 });
      this.stunDur = [3.4, 3.0, 2.6][ph];
      this.teach('stun', '쾅! 예티가 얼음 기둥에 부딪혀 어질어질~ 지금 마구 공격해요!', 'good');
      this.setMode('stunned');
      return;
    }
    // arena wall → small bonk
    const a = this.arena, maxR = a.r - this.radius * 0.8 - 0.4;
    const wx = this.pos.x - a.x, wz = this.pos.z - a.z;
    // only bonk when actually running outward (a charge may start right at the rim after an earlier bonk)
    if (Math.hypot(wx, wz) >= maxR - 0.05 && wx * dx + wz * dz > 0) {
      CTX.fx.shake(0.4, 0.35);
      CTX.fx.dust({ x: this.pos.x + dx, y: this.ground + 0.5, z: this.pos.z + dz }, 16, 2);
      sfx('crusher', { pitch: 1.1, vol: 0.8 });
      this.stunDur = [1.9, 1.6, 1.4][ph];
      this.teach('bonk', '예티가 벽에 쿵! 잠깐 어지러워해요. 얼른 공격해요!', 'good');
      this.setMode('stunned');
      return;
    }
    if (C.t > 3.2) this.setMode('idle');
    void p;
  }
}
void TAU;

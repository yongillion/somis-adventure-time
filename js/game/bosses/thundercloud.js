// ============================================================================
// bosses/thundercloud.js — 우르릉 번개구름 (stage 3). A lonely storm cloud that
// floats ~5.4 m above the arena (origin = cloud center):
//  · drift   — glides after Somi, staying a few steps away so she can see it
//  · strike  — charge (sparks + a yellow ring under Somi) → lightning bolt on the
//              marked spot + a shock ring to jump over. 1 / 2 / 3 bolts in a row
//              by phase, each one re-aimed at Somi's new spot
//  · rain    — sad rain: fog drops fall inside a blue circle under the cloud
//              while it slowly follows Somi (step out of the circle!)
//  · tired   — after big attacks it gets tired and sinks down right in front of
//              Somi: the golden core peeks out (weak ×2, ~3.5 s; you can even
//              bounce on top of it). While high, hits only do ×0.6.
// ============================================================================
import { Vec3, clamp, lerp, TAU, Ease } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { PAL } from '../fx.js';
import { BossController } from './boss.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const C = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

const HIGH = 5.4;   // cloud center above the arena floor while flying
const LOW = 2.4;    // ... while tired (the model also sinks its body 0.7)

export class ThunderCloudBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'thundercloud', name: '우르릉 번개구름', hp: 48, music: 'boss', title: '해바라기 언덕의 외톨이 먹구름', introDist: 10, outroDist: 9, centerY: 0, radius: 2.3, hitInvuln: 0.5, ...o });
    this.h = HIGH;
    this.pos.y = this.ground + HIGH;
    this.home.y = this.pos.y;
    this.node.position.copy(this.pos);
    this.patterns = [
      ['strike', 'tired', 'rain', 'strike', 'tired'],
      ['strike', 'rain', 'tired', 'strike', 'tired'],
      ['strike', 'rain', 'tired', 'strike', 'tired'],
    ];
    this.sleepAnim = 'idle';
    this.live = [];        // live falling drops / shock rings / markers (cleared on reset/defeat)
    this.tgt = { x: this.pos.x, z: this.pos.z };
    this.boltsLeft = 0;
    this.taught = {};
    // the rain zone: a soft blue circle that follows the cloud
    this.rainZone = new Node('rainZone');
    this.rainRing = new Mesh(G.ringGeo(0.9, 1.0, 56), new Material({ color: 0x6cc4ff, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }));
    this.rainDisc = new Mesh(G.circleGeo(1, 56), new Material({ color: 0x8fd4ff, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }));
    this.rainRing.renderOrder = 7; this.rainDisc.renderOrder = 7;
    this.rainRing.opacity = 0; this.rainDisc.opacity = 0;
    this.rainZone.add(this.rainRing, this.rainDisc);
    this.rainZone.visible = false;
    this.level.root.add(this.rainZone);
    this.rainK = 0; this.rainOn = false; this.rainR = 3.1;
  }
  get ph() { return this.phase - 1; }
  onHurt(info, dmg) {
    if (this.mode === 'tired') { this.winDmg = (this.winDmg || 0) + dmg; if (this.winDmg >= this.maxHp * 0.28) this.bonked = true; }
  }

  // ---------------------------------------------------------------- hit spheres
  // high: the whole cloud (×0.6). tired: the sunk body (×1) + the golden core on top (×1.5); weakMul ×2 on top.
  spheres() {
    const x = this.pos.x, z = this.pos.z, y = this.pos.y;
    const low = HIGH - this.h; // 0 (high) .. 3 (fully down)
    if (low > 1.2) return [{ x, y: y - 0.7, z, r: 1.95, mul: 1 }, { x, y: y + 1.0, z, r: 0.9, mul: 1.5 }];
    return [{ x, y: y - 0.1, z, r: 2.1, mul: 0.6 }];
  }
  shadow() { const low = clamp((HIGH - this.h) / (HIGH - LOW), 0, 1); return { x: this.pos.x, y: this.ground + 0.4, z: this.pos.z, size: 5.6 - 1.2 * low }; }
  // touching hurts only while it crackles (charge/strike); a tired cloud is a bouncy cushion
  _contact(p) {
    if (this.mode === 'tired' && this.weakMul > 1) {
      for (const s of this.spheres()) {
        const hd = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (p.vel.y < -2 && p.pos.y > s.y + s.r * 0.35 && hd < s.r + 0.25 && p.pos.y < s.y + s.r + 0.9) {
          p.bounce(11);
          CTX.fx.landing(p.pos, 0.6);
          this._lastSphere = s;
          this.damage({ dmg: 1, kind: 'stomp', tags: [], dir: { x: 0, z: 0 } });
          sfx('bounce', { pitch: 0.8 });
          return;
        }
      }
      return;
    }
    if (this.mode === 'charge' || this.mode === 'zap') super._contact(p);
  }
  async introPose(dir) {
    this.play('charge');
    sfx('charge', { pitch: 1.1 });
    await dir.wait(0.9);
    this.play('strike', { boltLen: this.pos.y - this.ground });
    this.restartAnim();
    sfx('lightning');
    sfx('bossRoar', { pitch: 0.85 });
    CTX.fx.shake(0.45, 0.7);
    const g = { x: this.pos.x, y: this.ground + 0.1, z: this.pos.z };
    CTX.fx.shock(g, 3.2, C(0xfff27a));
    CTX.fx.sparkle(g, PAL.gold, 12, 1.0);
    await dir.wait(1.0);
    this.play('idle');
  }
  onFightStart() { this._calm(); this.setMode('idle'); this.mt = -0.6; }
  onReset() { this._calm(); this.h = HIGH; this.pos.y = this.ground + HIGH; this._clearFx(); }
  defeat() { this._clearFx(); this.rainOn = false; return super.defeat(); }
  _calm() { this.weakMul = 1; this.contact = true; this.rainOn = false; this.boltsLeft = 0; }
  _clearFx() {
    for (const f of this.live) { f.dead = true; if (f.marker) f.marker.dead = true; }
    this.live.length = 0;
  }
  _track(f) { this.live.push(f); return f; }
  _toast(key, text, kind = 'warn', dur = 2.8) { if (this.taught[key]) return; this.taught[key] = true; CTX.hud.toast(text, kind, dur); }
  // keep the target spot inside the arena (so the cloud can float above it)
  _inArena(x, z, m = 2.2) {
    const a = this.arena;
    if (!a) return { x, z };
    const dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz), max = a.r - m;
    return d > max ? { x: a.x + dx / d * max, z: a.z + dz / d * max } : { x, z };
  }
  _glide(x, z, maxSp, k, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return 0;
    const s = Math.min(d, Math.min(maxSp, d * k) * dt);
    this.pos.x += dx / d * s; this.pos.z += dz / d * s;
    return d - s;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    super.update(dt);
    // the rain circle fades in/out under the cloud
    this.rainK = clamp(this.rainK + (this.rainOn && this.state === 'fight' ? 1 : -1) * dt * 3, 0, 1);
    this.rainZone.visible = this.rainK > 0.01;
    if (this.rainZone.visible) {
      const R = this.rainR * (0.85 + 0.15 * this.rainK);
      this.rainZone.position.set(this.pos.x, this.ground + 0.07, this.pos.z);
      this.rainZone.scale.set(R, 1, R);
      const pulse = 0.5 + 0.5 * Math.sin(this.st * 7);
      this.rainRing.opacity = this.rainK * (0.55 + 0.35 * pulse);
      this.rainDisc.opacity = this.rainK * 0.2;
    }
  }
  _anim(dt) {
    // after the fight the friendly cloud floats to a comfy height
    if (this.state === 'defeat' || this.state === 'done') {
      this.h += (3.9 - this.h) * Math.min(1, dt * 1.5);
      this.pos.y = this.ground + this.h;
    }
    super._anim(dt);
  }

  // ---------------------------------------------------------------- brain
  think(dt) {
    const p = this.player;
    const ph = this.ph;
    this.live = this.live.filter((f) => !f.dead);
    const enter = !!this.fresh; this.fresh = false;
    switch (this.mode) {
      case 'idle': {
        // drift: hover a few steps away from Somi, facing her
        if (enter) this.play('idle');
        this.weakMul = 1;
        this._approachH(HIGH, dt);
        const tp = this.toPlayer();
        let ux = -tp.dx, uz = -tp.dz;
        if (tp.d < 0.5 && this.arena) { const ax = this.arena.x - p.pos.x, az = this.arena.z - p.pos.z, al = Math.hypot(ax, az) || 1; ux = ax / al; uz = az / al; }
        const k = this._inArena(p.pos.x + ux * 4.2, p.pos.z + uz * 4.2, 2.6);
        this._glide(k.x, k.z, [2.4, 2.8, 3.2][ph], 1.6, dt);
        this.facePlayer(4, dt);
        if (this.mt > [1.0, 0.8, 0.65][ph]) this.setMode(this.nextFromPattern());
        break;
      }
      case 'strike': {
        this.boltsLeft = [1, 2, 3][ph];
        this.firstBolt = true;
        this.setMode('charge');
        break;
      }
      case 'charge': {
        if (enter) {
          const t = this._inArena(p.pos.x, p.pos.z, 2.0);
          this.tgt = t;
          this.chargeT = this.firstBolt ? [1.2, 1.05, 0.95][ph] : [0.9, 0.8, 0.72][ph];
          this.firstBolt = false;
          this.mark = this._track(this.marker(t.x, t.z, 1.75, this.chargeT + 0.15, { color: 0xffd23a }));
          this.play('charge');
          sfx('charge', { pitch: 1.25, vol: 0.8 });
          this._toast('strike', '노란 동그라미에 번개가 떨어져요! 얼른 피해요!');
        }
        this._approachH(HIGH, dt);
        // glide over the marked spot, arriving just before the bolt
        const left = Math.max(0.05, this.chargeT - this.mt);
        const d = Math.hypot(this.tgt.x - this.pos.x, this.tgt.z - this.pos.z);
        this._glide(this.tgt.x, this.tgt.z, Math.max(3, d / left * 1.6), 6, dt);
        this.facePlayer(5, dt);
        if (Math.random() < dt * 10) CTX.fx.beamSpark(new Vec3(this.pos.x + (Math.random() - 0.5) * 3.6, this.pos.y - 1.2, this.pos.z + (Math.random() - 0.5) * 2), PAL.gold);
        if (this.mt >= this.chargeT) { this.pos.x = this.tgt.x; this.pos.z = this.tgt.z; this.setMode('zap'); }
        break;
      }
      case 'zap': {
        if (enter) { this.play('strike', { boltLen: this.pos.y - this.ground }); this.restartAnim(); this.zapped = false; }
        if (!this.zapped && this.mt >= 0.12) { this.zapped = true; this._impact(this.tgt.x, this.tgt.z); }
        if (this.mt > 0.55) {
          this.boltsLeft--;
          this.setMode(this.boltsLeft > 0 ? 'charge' : 'idle');
        }
        break;
      }
      case 'rain': {
        const dur = [3.4, 4.0, 4.6][ph];
        if (enter) {
          this.play('rain'); this.restartAnim();
          this.rainOn = true; this.dropT = 0.6;
          sfx('rain');
          this._toast('rain', '먹구름 아래 파란 동그라미 밖으로 피해요!');
        }
        this._approachH(HIGH, dt);
        // the rain circle slowly follows Somi (slower than she runs)
        if (this.mt > 0.4) { const k = this._inArena(p.pos.x, p.pos.z, 2.6); this._glide(k.x, k.z, [1.5, 1.9, 2.3][ph], 3, dt); }
        this.facePlayer(3, dt);
        this.dropT -= dt;
        if (this.mt < dur && this.dropT <= 0) {
          this.dropT = [0.34, 0.27, 0.22][ph];
          this._drop();
        }
        if (this.mt > dur) this.rainOn = false;
        if (this.mt > dur + 0.5) this.setMode('idle');
        break;
      }
      case 'tired': {
        const dur = [3.8, 3.4, 3.0][ph];
        if (enter) {
          // plop down next to Somi: on the cloud's side if she looks its way, otherwise right in front of her
          const tp = this.toPlayer();
          let ux = -tp.dx, uz = -tp.dz;
          const f = p.facing ? p.facing() : { x: 0, z: -1 };
          if (tp.d < 0.3 || f.x * ux + f.z * uz < 0) { ux = f.x; uz = f.z; }
          this.land = this._inArena(p.pos.x + ux * 2.7, p.pos.z + uz * 2.7, 2.5);
          this.play('descend'); this.restartAnim();
          this.rainOn = false;
          this.winDmg = 0; this.bonked = false;
          sfx('whoosh', { pitch: 0.55 });
          this._toast('tired', '번개구름이 지쳐서 내려왔어요! 지금 톡톡 때려요! 반짝이는 별은 더 아파해요!', 'good', 3.4);
        }
        this.contact = false;
        const u = Ease.inOutSine(clamp(this.mt / 0.9, 0, 1));
        this.h = lerp(HIGH, LOW, u);
        this._glide(this.land.x, this.land.z, 7, 4, dt);
        this.facePlayer(2.5, dt);
        this.weakMul = this.mt > 0.5 ? 2 : 1;
        if (Math.random() < dt * 3) CTX.fx.stunStars(new Vec3(this.pos.x, this.pos.y + 1.7, this.pos.z));
        if (Math.random() < dt * 2) CTX.fx.zzz(new Vec3(this.pos.x + 1.2, this.pos.y + 1.0, this.pos.z + 0.6));
        if (this.mt > 0.9 + dur || this.bonked) this.setMode('rise');
        break;
      }
      case 'rise': {
        if (enter) {
          this.play(this.bonked ? 'hurt' : 'idle'); this.restartAnim(); this.weakMul = 1;
          this.riseFrom = this.h;
          sfx('whoosh', { pitch: 0.9 });
          CTX.fx.fogPuff({ x: this.pos.x, y: this.pos.y - 1, z: this.pos.z }, 6);
          if (this.bonked) CTX.fx.text(new Vec3(this.pos.x, this.pos.y + 2.2, this.pos.z), '아야야! 우르릉~', 'crit');
        }
        if (this.mt > 0.45 && this.anim === 'hurt') this.play('idle');
        this.contact = true;
        const u = Ease.inOutSine(clamp(this.mt / 0.9, 0, 1));
        this.h = lerp(this.riseFrom ?? LOW, HIGH, u);
        this.facePlayer(3, dt);
        if (this.mt > 1.0) { this.h = HIGH; this.bonked = false; this.setMode('idle'); }
        break;
      }
      default: this.setMode('idle');
    }
    this.pos.y = this.ground + this.h;
  }
  // mode entry flag (robust to hit-stop frames where dt = 0)
  setMode(m) { super.setMode(m); this.fresh = true; }
  _approachH(target, dt) { this.h += (target - this.h) * Math.min(1, dt * 4); }

  // ---------------------------------------------------------------- attacks
  _impact(x, z) {
    const p = this.player;
    const g = { x, y: this.ground + 0.1, z };
    if (p && !p.dead && Math.hypot(p.pos.x - x, p.pos.z - z) < 1.75 + 0.3 && p.pos.y < this.ground + 3.6) {
      p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, g, { knock: 8, up: 8 });
    }
    this._track(this.shock(x, z, { maxR: [4.2, 5.0, 5.8][this.ph], speed: [5.6, 6.0, 6.4][this.ph], color: 0xfff27a, r0: 1.0 }));
    sfx('lightning');
    CTX.fx.shake(0.35, 0.35);
    CTX.fx.flash('#fffbe0', 0.12, 0.16);
    CTX.fx.shock(g, 2.4, C(0xfff27a));
    CTX.fx.sparkle(g, PAL.gold, 10, 0.9);
    CTX.fx.dust(g, 8, 1.4);
    CTX.fx.hit(new Vec3(x, this.ground + 0.6, z), PAL.white, 1.3);
  }
  _drop() {
    // a random spot inside the rain circle under the cloud
    const a = Math.random() * TAU, rr = this.rainR * Math.sqrt(Math.random()) * 0.92;
    const x = this.pos.x + Math.sin(a) * rr, z = this.pos.z + Math.cos(a) * rr;
    const height = Math.max(2.5, this.h - 1.1);
    this._track(this.fall('fogball', x, z, { delay: 0.3, speed: 6.5, height, r: 0.55, scale: 2.6, markColor: 0x6cc4ff }));
    if (Math.random() < 0.3) sfx('bubble', { pitch: 0.7 + Math.random() * 0.3, vol: 0.5 });
  }
}

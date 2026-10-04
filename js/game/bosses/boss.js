// ============================================================================
// bosses/boss.js — boss fight framework: arena, controller base class
// (HP/phases/damage/contact/stomp), intro & defeat (purify) sequences, and
// shared attack helpers (shock rings, ground telegraphs, falling things,
// minions, projectiles). Each boss in bosses/<id>.js extends BossController.
// ============================================================================
import { Vec3, clamp, lerp, TAU, Ease, dampAngle, rgb } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { Collider } from '../world/physics.js';
import { buildBoss } from '../models/bosses.js';
import { spawnEnemy } from '../systems/enemies.js';
import { DreamLight } from '../systems/interact.js';
import { softGlowMaterial } from '../models/props.js';
import { PAL } from '../fx.js';
import { Save } from '../save.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const RETRY_HEAL = { normal: 0.35, hard: 0.5, veryhard: 1 };

// ------------------------------------------------------------------ arena
// Round boss island with an invisible wall ring (enabled during the fight) and a
// soft fog curtain. Returns { x, y, z, r, setWalls(on), curtain }.
export function buildArena(L, x, y, z, r, o = {}) {
  L.island(x, y, z, r, { density: o.density ?? 0.35, big: o.big ?? Math.round(r * 0.55), small: o.small ?? Math.round(r * 0.6), clear: [[x, z, r * 0.78], ...(o.clear || [])], depth: o.depth ?? 12, top: o.top, pal: o.pal, flat: true });
  const level = L.lv;
  const walls = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const c = level.physics.add(new Collider({ type: 'box', x: x + Math.sin(a) * (r + 0.25), y: y + 4, z: z + Math.cos(a) * (r + 0.25), hx: (TAU * r) / N * 0.62, hy: 4.5, hz: 0.3, yaw: a, tag: 'arenaWall', camBlock: false }));
    c.enabled = false;
    walls.push(c);
  }
  // boundary marker: a soft glowing ring on the ground (fog wisps are emitted while active)
  const ringMesh = new Mesh(G.ringGeo(0.965, 1.0, 72), new Material({ color: o.curtainColor ?? 0xc8b8f0, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }));
  ringMesh.position.set(x, y + 0.05, z);
  ringMesh.scale.set(r + 0.3, 1, r + 0.3);
  ringMesh.renderOrder = 8;
  ringMesh.visible = false;
  level.root.add(ringMesh);
  const curtain = ringMesh;
  const A = {
    x, y, z, r, walls, curtain, on: false, k: 0,
    setWalls(on) { A.on = on; for (const c of walls) c.enabled = on; if (on) curtain.visible = true; },
    update(dt) {
      A.k += ((A.on ? 1 : 0) - A.k) * Math.min(1, dt * 2.5);
      curtain.opacity = A.k * (0.55 + 0.25 * Math.sin(performance.now() * 0.004));
      curtain.visible = A.k > 0.01;
      if (A.on && Math.random() < dt * 14) {
        const a = Math.random() * TAU;
        CTX.fx.fogPuff({ x: x + Math.sin(a) * (r + 0.6), y: y + 0.3 + Math.random() * 1.8, z: z + Math.cos(a) * (r + 0.6) }, 1);
      }
    },
  };
  level.add({ update: (dt) => A.update(dt) });
  return A;
}

// ------------------------------------------------------------------ attack helpers
// expanding shock ring on the ground; jump over it
export class ShockRing {
  constructor(level, x, y, z, o = {}) {
    this.x = x; this.y = y; this.z = z;
    this.r = o.r0 ?? 0.6; this.maxR = o.maxR ?? 9; this.speed = o.speed ?? 7; this.w = o.w ?? 0.45; this.h = o.h ?? 0.55;
    this.dmg = o.dmg ?? (CTX.diff ? CTX.diff.bossDmg : 1);
    this.node = new Mesh(G.ringGeo(0.86, 1.0, 56), new Material({ color: o.color ?? 0xfff0c8, unlit: true, transparent: true, blending: 'additive', depthWrite: false, side: 'double', fog: false }));
    this.node.position.set(x, y + 0.08, z);
    this.node.renderOrder = 6;
    this.inner = new Mesh(G.cylinderGeo(1, 1, 1, 56, 1, false), softGlowMaterial(o.color ?? 0xffe0b0, { opacity: 0.8, rim: 0.6, side: 'double' }));
    this.inner.position.y = 0.0;
    this.node.add(this.inner);
    level.add(this);
    this.hitDone = false;
  }
  update(dt) {
    this.r += this.speed * dt;
    const k = this.r / this.maxR;
    this.node.scale.set(this.r, 1, this.r);
    this.inner.scale.set(1, this.h / 1, 1);
    this.inner.position.y = this.h / 2;
    this.node.material.opacity = 1 - k * 0.6;
    this.inner.material.opacity = (1 - k) * 0.7;
    if (Math.random() < dt * 30) {
      const a = Math.random() * TAU;
      CTX.fx.dust({ x: this.x + Math.sin(a) * this.r, y: this.y, z: this.z + Math.cos(a) * this.r }, 1, 0.8);
    }
    const p = CTX.player;
    if (!this.hitDone && p && !p.dead) {
      const d = Math.hypot(p.pos.x - this.x, p.pos.z - this.z);
      if (Math.abs(d - this.r) < this.w + 0.3 && p.pos.y < this.y + this.h && p.pos.y > this.y - 1.2) {
        if (p.hurt(this.dmg, { x: this.x, y: this.y, z: this.z }, { knock: 7, up: 8 })) this.hitDone = true;
      }
    }
    if (this.r >= this.maxR) this.dead = true;
  }
}

// pulsing ground telegraph (circle) — warns where something will land
export class Marker {
  constructor(level, x, y, z, r, dur, o = {}) {
    this.node = new Node('marker');
    const ring = new Mesh(G.ringGeo(0.82, 1.0, 40), new Material({ color: o.color ?? 0xff6a9a, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }));
    const disc = new Mesh(G.circleGeo(1, 40), new Material({ color: o.color ?? 0xff6a9a, unlit: true, transparent: true, depthWrite: false, side: 'double', fog: false }));
    ring.renderOrder = 7; disc.renderOrder = 7;
    this.node.add(ring, disc);
    this.ring = ring; this.disc = disc;
    this.node.position.set(x, y + 0.06, z);
    this.r = r; this.dur = dur; this.t = 0;
    this.node.scale.set(r, 1, r);
    level.add(this);
  }
  update(dt) {
    this.t += dt;
    const k = clamp(this.t / this.dur, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (8 + k * 14));
    this.ring.opacity = 0.55 + 0.4 * pulse;
    this.disc.opacity = 0.12 + 0.28 * k;
    this.disc.scale.set(k, 1, k);
    if (this.t >= this.dur) this.dead = true;
  }
  move(x, z) { this.node.position.x = x; this.node.position.z = z; }
}

// something falling from the sky onto a marked spot (spore, rock, icicle, raindrop...)
export class FallingThing {
  constructor(level, kind, x, y, z, o = {}) {
    this.level = level;
    this.x = x; this.z = z; this.gy = y;
    this.h = o.height ?? 9; this.speed = o.speed ?? 7; this.delay = o.delay ?? 0.8;
    this.r = o.r ?? 0.7;
    this.dmg = o.dmg ?? (CTX.diff ? CTX.diff.bossDmg : 1);
    this.marker = new Marker(level, x, y, z, this.r + 0.25, this.delay + this.h / this.speed, { color: o.markColor });
    this.node = CTX.projectiles ? CTX.projectiles._model(kind === 'seed' || kind === 'snowball' ? 'e:' + kind : kind) : new Node();
    if (this.node.parent) this.node.removeFromParent();
    this.node.scale.set(o.scale ?? 1.6, o.scale ?? 1.6, o.scale ?? 1.6);
    this.node.position.set(x, y + this.h, z);
    this.node.visible = false;
    this.t = 0; this.y = y + this.h;
    this.kindName = kind;
    this.onLand = o.onLand || null;
    this.spin = o.spin ?? 2;
    level.add(this);
  }
  update(dt) {
    this.t += dt;
    if (this.t < this.delay) return;
    this.node.visible = true;
    this.y -= this.speed * dt;
    this.node.position.set(this.x, this.y, this.z);
    this.node.rotation.y += this.spin * dt;
    if (this.node.update) this.node.update(dt);
    const p = CTX.player;
    if (p && !p.dead) {
      const dx = p.pos.x - this.x, dz = p.pos.z - this.z, dy = p.pos.y + 0.55 - this.y;
      if (dx * dx + dz * dz < (this.r + 0.35) ** 2 && Math.abs(dy) < this.r + 0.5) { p.hurt(this.dmg, { x: this.x, y: this.y, z: this.z }); this.land(); return; }
    }
    if (this.y <= this.gy + 0.2) this.land();
  }
  land() {
    if (this.dead) return;
    this.dead = true;
    this.marker.dead = true;
    CTX.fx.sparkle({ x: this.x, y: this.gy + 0.3, z: this.z }, PAL.white, 6, 0.4);
    CTX.fx.dust({ x: this.x, y: this.gy, z: this.z }, 6, 1);
    if (this.onLand) this.onLand(this);
  }
  dispose() { if (this.node) this.node.removeFromParent(); }
}

// ------------------------------------------------------------------ controller base
export class BossController {
  // o: { id, name, pos:[x,y,z], yaw, hp, arena, music, centerY, radius, intro: [dialog lines] }
  constructor(stage, o) {
    this.stage = stage;
    this.level = stage.level;
    this.o = o;
    this.id = o.id;
    this.name = o.name;
    this.rig = buildBoss(o.id);
    this.node = this.rig.root;
    this.level.root.add(this.node);
    this.pos = new Vec3(...o.pos);
    this.home = this.pos.clone();
    this.yaw = o.yaw ?? 0;
    this.arena = o.arena;
    this.ground = o.arena ? o.arena.y : this.pos.y;
    this.maxHp = Math.max(4, Math.round(o.hp * (CTX.diff ? CTX.diff.bossHp : 1)));
    this.hp = this.maxHp;
    this.phase = 1;
    this.state = 'sleep'; this.st = 0;
    this.mode = 'idle'; this.mt = 0;
    this.anim = 'idle'; this.animT = 0; this.animExtra = {};
    this.alive = true; this.boss = true; this.canSwallow = false; this.dying = 0; this.flying = !!this.rig.flying;
    this.centerY = o.centerY ?? this.rig.centerY ?? this.rig.height * 0.5;
    this.radius = o.radius ?? this.rig.radius ?? 1.4;
    this.height = this.rig.height ?? 3;
    this.invulnT = 0; this.flashT = 0;
    this.weakMul = 1; // damage multiplier right now (weak moments)
    this.armored = false; // blocks all damage (shows a "tink")
    this.contact = true; // touching hurts
    this.stompable = true;
    this.minions = [];
    this.timesWoken = 0;
    this.pattern = [];
    this.pi = 0;
    this.fightT = 0;
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
    this.rig.setPurified(0);
    this.rig.update(0, { anim: 'idle', t: 0 });
    stage.boss = this;
    this.level.enemies.push(this);
    this.level.boss = this;
    this.camFocus = { pos: this.pos, weight: o.camWeight ?? 0.3, y: () => this.pos.y + this.centerY };
  }
  get friendly() { return false; }
  get hpFrac() { return this.hp / this.maxHp; }
  get player() { return CTX.player; }

  // ---------------------------------------------------------------- enemy interface (player attacks)
  spheres() { return [{ x: this.pos.x, y: this.pos.y + this.centerY, z: this.pos.z, r: this.radius, mul: 1 }]; }
  hurtTest(x, y, z, r) {
    if (this.state !== 'fight' || this.dying) return false;
    for (const s of this.spheres()) {
      const dx = x - s.x, dy = y - s.y, dz = z - s.z, rr = r + s.r;
      if (dx * dx + dy * dy + dz * dz < rr * rr) { this._lastSphere = s; return true; }
    }
    return false;
  }
  damage(info) {
    if (this.state !== 'fight' || this.dying) return false;
    if (this.invulnT > 0) return true;
    if (this.armored || (info.dmg <= 0)) {
      if (this.armored) { CTX.fx.hit(this.center(), PAL.white, 0.7); sfx('block', { vol: 0.7 }); this.onBlocked && this.onBlocked(info); }
      return true;
    }
    const mul = (this._lastSphere ? this._lastSphere.mul : 1) * this.weakMul;
    let dmg = Math.max(0.5, info.dmg) * mul;
    if (info.kind === 'stomp') dmg = 1 * this.weakMul;
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnT = this.o.hitInvuln ?? 0.4;
    this.flashT = 0.12;
    this.rig.setFlash(1);
    const c = this._lastSphere ? { x: this._lastSphere.x, y: this._lastSphere.y, z: this._lastSphere.z } : this.center();
    CTX.fx.hit(c, mul > 1 ? PAL.gold : PAL.pink, mul > 1 ? 1.5 : 1.1);
    sfx('bossHit', { pitch: 0.9 + Math.random() * 0.2 });
    if (mul > 1) { CTX.fx.hitStop(0.06); CTX.fx.text(new Vec3(c.x, c.y + 1, c.z), '크리티컬!', 'crit'); }
    CTX.hud.bossSet(this.hpFrac);
    this.onHurt && this.onHurt(info, dmg);
    // phases
    const ph = this.hpFrac <= 0.34 ? 3 : this.hpFrac <= 0.67 ? 2 : 1;
    if (ph > this.phase) { this.phase = ph; this.onPhase && this.onPhase(ph); this._phaseFx(); }
    if (this.hp <= 0) this.defeat();
    return true;
  }
  stun() { /* bosses shrug off stuns */ }
  charm() {} sleep() {} pull() {} swallow() {}
  center() { return new Vec3(this.pos.x, this.pos.y + this.centerY, this.pos.z); }
  _phaseFx() {
    sfx('bossRoar');
    CTX.fx.shake(0.4, 0.5);
    CTX.fx.wave(new Vec3(this.pos.x, this.pos.y + 0.2, this.pos.z), 6, [1, 0.7, 0.8]);
    CTX.hud.toast(this.phase === 3 ? '보스가 마지막 힘을 내고 있어요! 조금만 더!' : '보스가 화가 났어요! 조심해요!', 'warn', 2.4);
  }

  // ---------------------------------------------------------------- flow
  wake() {
    if (this.state !== 'sleep') return;
    this.timesWoken++;
    this.state = 'intro'; this.st = 0;
    if (this.arena) this.arena.setWalls(true);
    CTX.cam.boss = this.camFocus;
    const first = this.timesWoken === 1 && !(Save.data && Save.flag('bossSeen:' + this.id));
    if (first) {
      this.stage.runCutscene(async (dir) => {
        await this.introCutscene(dir);
      }).then(() => this._startFight());
    } else this._startFight(true);
  }
  async introCutscene(dir) {
    // generic intro: look at the boss, roar, name banner
    dir.letterbox(true);
    const c = this.center();
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const d = this.o.introDist ?? 8;
    dir.shot([c.x + f.x * d * 1.2 + f.z * 2, c.y + 0.5, c.z + f.z * d * 1.2 - f.x * 2], [c.x, c.y, c.z], 46);
    dir.camTo([c.x + f.x * d + f.z * 1.2, c.y + 0.9, c.z + f.z * d - f.x * 1.2], [c.x, c.y + 0.2, c.z], 2.2);
    await dir.wait(1.0);
    if (CTX.audio) { CTX.audio.stopMusic(0.3); CTX.audio.jingle('bossIntro'); }
    this.play('roar');
    await this.introPose(dir);
    CTX.hud.show(true);
    CTX.hud.banner(this.name, this.o.title || '회색 안개에 물든 꿈나라의 친구', 2.6);
    await dir.wait(2.0);
    if (this.o.introLines) await dir.say(this.o.introLines);
    dir.letterbox(false);
    if (Save.data) { Save.flag('bossSeen:' + this.id, true); Save.write(); }
  }
  async introPose(dir) { CTX.fx.shake(0.35, 0.8); sfx('bossRoar'); await dir.wait(1.2); }
  _startFight(quick = false) {
    this.state = 'fight'; this.st = 0; this.fightT = 0;
    this.mode = 'idle'; this.mt = 0;
    if (CTX.audio) CTX.audio.playMusic(this.o.music || 'boss', { restart: true });
    CTX.hud.bossShow(this.name, this.hpFrac);
    if (quick) CTX.hud.banner(this.name, '다시 도전!', 1.6);
    this.invulnT = 0.8;
    this.onFightStart && this.onFightStart(quick);
  }
  onPlayerRespawn() {
    // retry: reset position, heal some HP, wait for the player to come back in
    if (this.state === 'defeat' || this.state === 'done') return;
    const heal = RETRY_HEAL[CTX.diff ? CTX.diff.id : 'normal'] ?? 0.35;
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * heal);
    this.phase = this.hpFrac <= 0.34 ? 3 : this.hpFrac <= 0.67 ? 2 : 1;
    this.pos.copy(this.home);
    this.state = 'sleep'; this.st = 0; this.mode = 'idle'; this.mt = 0;
    this.weakMul = 1; this.armored = false; this.contact = true;
    for (const m of this.minions) if (m.alive) { m.alive = false; m.dead = true; m.node.removeFromParent(); }
    this.minions.length = 0;
    if (this.arena) this.arena.setWalls(false);
    CTX.hud.bossShow(null);
    CTX.cam.boss = null;
    this.clearAttacks();
    if (CTX.projectiles) CTX.projectiles.clear();
    if (CTX.audio) CTX.audio.playMusic(this.stage.musicId || 'meadow');
    this.onReset && this.onReset();
  }
  async defeat() {
    if (this.dying) return;
    this.dying = 1;
    this.state = 'defeat';
    CTX.hud.bossShow(null);
    for (const m of this.minions) if (m.alive && !m.dying) m.die({});
    this.clearAttacks();
    if (CTX.projectiles) CTX.projectiles.clear();
    CTX.fx.hitStop(0.25);
    CTX.fx.flash('#ffffff', 0.6, 0.8);
    sfx('bossDown');
    if (CTX.audio) CTX.audio.stopMusic(0.6);
    await this.stage.runCutscene(async (dir) => { await this.defeatCutscene(dir); }, { hideHud: true });
    this.state = 'done';
    if (this.arena) this.arena.setWalls(false);
    CTX.cam.boss = null;
    if (CTX.audio) CTX.audio.playMusic(this.stage.musicId || 'meadow');
    this.afterDefeat();
  }
  async defeatCutscene(dir) {
    dir.letterbox(true);
    this.rig.setFlash(0); this.flashT = 0;
    const c = this.center();
    const p = this.player;
    // the boss staggers, fog bursts out of it
    this.play('hurt');
    const cx = c.x, cz = c.z;
    const dx = p.pos.x - cx, dz = p.pos.z - cz, dl = Math.hypot(dx, dz) || 1;
    const camD = this.o.outroDist ?? 7.5;
    dir.shot([cx + dx / dl * camD + dz / dl * 2.5, c.y + 1.2, cz + dz / dl * camD - dx / dl * 2.5], [cx, c.y, cz], 46);
    for (let i = 0; i < 12; i++) {
      CTX.fx.fogPuff({ x: cx + (Math.random() - 0.5) * 2.5, y: c.y + (Math.random() - 0.3) * 2, z: cz + (Math.random() - 0.5) * 2.5 }, 2);
      if (i % 3 === 0) { CTX.fx.hit({ x: cx + (Math.random() - 0.5) * 2, y: c.y + Math.random(), z: cz + (Math.random() - 0.5) * 2 }, PAL.white, 1.4); sfx('pop', { pitch: 0.7 + i * 0.05 }); }
      await dir.wait(0.16);
    }
    // purification: colors return to the boss
    sfx('colorBloom');
    CTX.fx.colorBloom(new Vec3(cx, this.pos.y + 0.2, cz), rgb(this.stage.def.color), 7);
    CTX.fx.flash('#ffffff', 0.6, 0.55);
    await dir.tween(1.6, (k) => this.rig.setPurified(k));
    this.play('defeated');
    if (CTX.audio) CTX.audio.jingle('victory');
    CTX.fx.confetti(new Vec3(cx, c.y + 1.5, cz), 40);
    await dir.wait(1.6);
    if (this.o.thanks) await dir.say(this.o.thanks.map((l) => (Array.isArray(l) ? { who: l[0] === 'boss' ? this.name : l[0], text: l[1], face: l[2] || (l[0] === 'boss' ? 'boss:' + this.id : 'char:' + p.charId) } : l)));
    dir.letterbox(false);
  }
  afterDefeat() {
    // the dream light appears in the middle of the arena
    const a = this.arena || { x: this.home.x, y: this.ground, z: this.home.z };
    const lx = this.o.lightPos ? this.o.lightPos[0] : a.x, lz = this.o.lightPos ? this.o.lightPos[2] : a.z;
    const ly = this.o.lightPos ? this.o.lightPos[1] : a.y;
    const dl = new DreamLight(this.level, lx, ly, lz, this.stage.def.color, () => this.stage.stageClear());
    this.level.add(dl);
    dl.show();
    sfx('star');
    CTX.hud.toast('꿈빛이 나타났어요! 꿈빛을 만져 봐요!', 'good', 3.2);
    CTX.hud.pointAt(new Vec3(lx, ly + 1, lz), 6);
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.st += dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.rig.setFlash(0); }
    const p = this.player;
    if (this.state === 'sleep') {
      this.play(this.sleepAnim || 'idle');
      if (this.arena && p && !p.dead) {
        const d = Math.hypot(p.pos.x - this.arena.x, p.pos.z - this.arena.z);
        if (d < this.arena.r * (this.o.wakeFrac ?? 0.72) && Math.abs(p.pos.y - this.arena.y) < 3) this.wake();
      }
    } else if (this.state === 'fight') {
      if (dt <= 0) { this._anim(0); return; } // hit-stop: freeze (keeps "first frame of a mode" checks valid)
      this.fightT += dt;
      this.mt += dt;
      this.think(dt);
      if (p && !p.dead) this._contact(p);
      this._clampArena();
      this.minions = this.minions.filter((m) => m.alive);
    }
    this._anim(dt);
  }
  visualTick(dt) {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.rig.setFlash(0); }
    this._anim(dt);
  }
  _anim(dt) {
    this.animT += dt;
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
    this.rig.update(dt, { anim: this.anim, t: this.animT, ...this.animExtra });
  }
  play(anim, extra = null) {
    if (anim !== this.anim) { this.anim = anim; this.animT = 0; }
    if (extra) this.animExtra = extra; else if (extra === null && this._lastExtraAnim !== anim) this.animExtra = {};
    this._lastExtraAnim = anim;
  }
  restartAnim() { this.animT = 0; }
  setMode(m) { this.mode = m; this.mt = 0; }
  nextFromPattern() {
    const pat = this.patterns ? this.patterns[this.phase - 1] || this.patterns[this.patterns.length - 1] : ['idle'];
    const m = pat[this.pi % pat.length];
    this.pi++;
    return m;
  }
  think() {}
  shadow() { return { x: this.pos.x, y: this.pos.y + (this.flying ? 0 : 0.2), z: this.pos.z, size: this.radius * 2.6 }; }
  _contact(p) {
    if (!this.contact) return;
    const c = this.spheres();
    for (const s of c) {
      const dx = p.pos.x - s.x, dz = p.pos.z - s.z;
      const hd = Math.hypot(dx, dz);
      const py = p.pos.y;
      // stomp from above
      if (this.stompable && p.vel.y < -2 && py > s.y + s.r * 0.35 && hd < s.r + 0.2 && py < s.y + s.r + 0.9) {
        p.bounce(11);
        CTX.fx.landing(p.pos, 0.6);
        this._lastSphere = s;
        this.damage({ dmg: 1, kind: 'stomp', tags: [], dir: { x: 0, z: 0 } });
        sfx('bounce');
        return;
      }
      const dy = (py + 0.55) - s.y;
      if (hd < s.r + 0.35 && Math.abs(dy) < s.r + 0.5) {
        p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, { x: s.x, y: s.y, z: s.z }, { knock: 8, up: 6 });
        return;
      }
    }
  }
  _clampArena() {
    if (!this.arena || this.noClamp) return;
    const a = this.arena;
    const dx = this.pos.x - a.x, dz = this.pos.z - a.z, d = Math.hypot(dx, dz);
    const max = a.r - this.radius * 0.8 - 0.4;
    if (d > max) { this.pos.x = a.x + dx / d * max; this.pos.z = a.z + dz / d * max; this.hitEdge = true; } else this.hitEdge = false;
  }
  // ---------------------------------------------------------------- helpers for subclasses
  toPlayer() { const p = this.player; const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z; const d = Math.hypot(dx, dz) || 1; return { dx: dx / d, dz: dz / d, d, yaw: Math.atan2(dx, dz) }; }
  face(yaw, rate, dt) { this.yaw = dampAngle(this.yaw, yaw, rate, dt); }
  facePlayer(rate, dt) { this.face(this.toPlayer().yaw, rate, dt); }
  walkToward(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const s = Math.min(d, speed * dt);
    this.pos.x += dx / d * s; this.pos.z += dz / d * s;
    this.face(Math.atan2(dx, dz), 6, dt);
    return d;
  }
  _track(e) { (this.attacks || (this.attacks = [])).push(e); if (this.attacks.length > 80) this.attacks = this.attacks.filter((a) => !a.dead); return e; }
  clearAttacks() {
    for (const a of this.attacks || []) { a.dead = true; if (a.marker) a.marker.dead = true; if (a.node) a.node.visible = false; }
    this.attacks = [];
  }
  shock(x, z, o = {}) { return this._track(new ShockRing(this.level, x, this.ground, z, o)); }
  marker(x, z, r, dur, o) { return this._track(new Marker(this.level, x, this.ground, z, r, dur, o)); }
  fall(kind, x, z, o = {}) { return this._track(new FallingThing(this.level, kind, x, this.ground, z, o)); }
  shoot(kind, from, vel, o = {}) {
    return CTX.projectiles.spawn({ kind, pos: from.clone ? from.clone() : new Vec3(from.x, from.y, from.z), vel, team: 'enemy', dmg: CTX.diff ? CTX.diff.bossDmg : 1, life: o.life ?? 3, r: o.r ?? 0.4, gravity: o.gravity ?? 0, spin: o.spin ?? 0, boom: o.boom || 0, scale: o.scale ?? 1.4, bounce: o.bounce ?? 0, reflectable: o.reflectable ?? true, ground: !!o.ground });
  }
  lob(kind, from, to, T, o = {}) {
    const g = o.gravity ?? 16;
    const vx = (to.x - from.x) / T, vz = (to.z - from.z) / T, vy = (to.y - from.y) / T + 0.5 * g * T;
    return this.shoot(kind, from, new Vec3(vx, vy, vz), { ...o, gravity: g, life: T + 0.6 });
  }
  summon(type, n = 2, o = {}) {
    const alive = this.minions.filter((m) => m.alive).length;
    const max = o.max ?? 3;
    let made = 0;
    for (let i = 0; i < n && alive + made < max; i++) {
      const a = this.yaw + (i - (n - 1) / 2) * 0.9 + Math.PI * (o.behind ? 1 : 0);
      const d = o.dist ?? 2.6;
      let x = this.pos.x + Math.sin(a) * d, z = this.pos.z + Math.cos(a) * d;
      if (this.arena) { const ax = x - this.arena.x, az = z - this.arena.z, ad = Math.hypot(ax, az); const mx = this.arena.r - 1.5; if (ad > mx) { x = this.arena.x + ax / ad * mx; z = this.arena.z + az / ad * mx; } }
      const e = spawnEnemy(this.level, type, x, this.ground + 0.2, z, { variant: o.variant || this.stage.def.theme, range: 6, yaw: this.yaw });
      if (e) { e.speedMul *= o.speed ?? 1; CTX.fx.poof(new Vec3(x, this.ground + 0.6, z)); this.minions.push(e); made++; }
    }
    if (made) sfx('magic', { pitch: 0.8 });
    return made;
  }
  randomArenaPoint(minR = 0, maxFrac = 0.8) {
    const a = this.arena;
    const ang = Math.random() * TAU, d = minR + Math.random() * (a.r * maxFrac - minR);
    return { x: a.x + Math.sin(ang) * d, z: a.z + Math.cos(ang) * d };
  }
  dispose() {}
}
void lerp; void Ease;

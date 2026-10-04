// ============================================================================
// interact.js — interactive level objects: checkpoints, Puffy cages, switches,
// gates, doors, crates, breakables, element puzzles (fire/water/wind/ice/light),
// cannons, NPCs & signs, grapple points, dig spots, ghost platforms, water,
// dream light goal, talk prompts.
// ============================================================================
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { Vec3, clamp, TAU, Ease, lerp, rgb } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { Collider } from '../world/physics.js';
import { buildObject } from '../models/objects.js';
import { buildPlatform } from '../models/platforms.js';
import { buildPuffy } from '../models/npcs.js';
import { PAL } from '../fx.js';
import { IceFloe } from './movers.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const near = (pos, r) => { const p = CTX.player; if (!p) return false; const dx = p.pos.x - pos.x, dy = p.pos.y + 0.5 - pos.y, dz = p.pos.z - pos.z; return dx * dx + dy * dy + dz * dz < r * r; };
const has = (info, tag) => (info.tags || []).includes(tag);

// ------------------------------------------------------------------ checkpoint lantern (꿈 등불)
export class Checkpoint {
  constructor(level, x, y, z, o = {}) {
    this.level = level;
    this.obj = buildObject('lantern', { color: o.color ?? 0xffd36b });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.yaw = o.yaw ?? 0;
    this.lit = false;
    this.radius = o.radius ?? 30;
    this.index = level.checkpoints.length;
    level.checkpoints.push(this);
    level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.6, z, hx: 0.35, hy: 0.6, tag: 'lantern' }));
    this.onLit = o.onLit || null;
  }
  update(dt) {
    this.obj.update(dt);
    if (!this.lit && near({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, 1.9)) this.light();
    if (this.lit && Math.random() < dt * 3) CTX.fx.twinkle({ x: this.pos.x, y: this.pos.y + 1.4, z: this.pos.z }, [1, 0.9, 0.5], 0.6);
  }
  // a safe spot next to the lantern: prefer the facing direction, else any side with solid ground
  respawnPoint() {
    const ph = this.level.physics;
    for (const da of [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI * 0.75, -Math.PI * 0.75]) {
      for (const d of [1.2, 0.9, 1.6]) {
        const a = this.yaw + da;
        const x = this.pos.x + Math.sin(a) * d, z = this.pos.z + Math.cos(a) * d;
        const g = ph.groundBelow(x, this.pos.y + 1.2, z, 2.0);
        if (g && !g.c.hazard && !g.c.moving && Math.abs(g.y - this.pos.y) < 0.7) {
          // keep a little margin from edges: all four neighbours must have ground too
          let ok = true;
          for (const [ox, oz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) { const g2 = ph.groundBelow(x + ox, this.pos.y + 1.2, z + oz, 2.0); if (!g2) { ok = false; break; } }
          if (ok) return new Vec3(x, g.y + 0.1, z);
        }
      }
    }
    return new Vec3(this.pos.x, this.pos.y + 1.3, this.pos.z);
  }
  light(silent = false) {
    if (this.lit) return;
    this.lit = true;
    this.obj.setLit(true);
    const p = CTX.player;
    p.setCheckpoint(this.respawnPoint(), this.yaw);
    // GRIS-like color bloom around the lantern
    CTX.env.addSpot(this.pos.x, this.pos.y, this.pos.z, this.radius);
    const n = this.level.checkpoints.filter((c) => c.lit).length, tot = this.level.checkpoints.length;
    CTX.env.setSkySat(0.5 + 0.5 * (n / Math.max(1, tot + 1)));
    if (!silent) {
      CTX.fx.colorBloom(this.pos, rgb(this.level.restoreColor ?? 0xff8fc4), 6);
      sfx('checkpoint');
      if (CTX.audio) CTX.audio.sfx('colorBloom', { vol: 0.6 });
      if (CTX.hud) CTX.hud.toast('꿈 등불이 켜졌어요! 색깔이 돌아와요', 'good');
      if (p.hp < p.maxHp) p.heal(p.maxHp - p.hp, true);
    }
    if (this.onLit) this.onLit(this);
  }
}

// ------------------------------------------------------------------ Puffy in a fog cage (rescue)
export class PuffyCage {
  constructor(level, idx, x, y, z, o = {}) {
    this.level = level;
    this.idx = idx;
    this.pos = new Vec3(x, y, z);
    this.puffy = buildPuffy(o.color ?? idx % 6);
    this.node = new Node('puffyCage');
    this.node.position.copy(this.pos);
    this.node.add(this.puffy.root);
    this.cage = buildObject('cage');
    this.node.add(this.cage.root);
    this.hits = o.hits ?? 3;
    this.state = 'caged'; this.t = 0;
    this.rescued = o.rescued || false;
    this.hidden = !!o.hidden;
    this.hit = level.addHittable({ pos: new Vec3(x, y + 0.6, z), r: 0.8, onHit: (info) => this.onHit(info) });
    this.col = level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.7, z, hx: 0.65, hy: 0.7, tag: 'cage' }));
    if (this.rescued) { this.cage.root.visible = false; this.state = 'free'; this.col.enabled = false; this.hit.enabled = false; this.puffy.setOpacity(0.4); }
    if (this.hidden) {
      this.node.traverse((n) => { if (n.isMesh) n.opacity = 0.25; });
      level.secrets.push({ pos: this.pos, kind: 'puffy', reveal: () => this.reveal(), get done() { return this._done; } });
    }
    this._done = this.rescued;
    this.dialog = o.thanks || null;
  }
  reveal() { if (!this.hidden) return; this.hidden = false; this.node.traverse((n) => { if (n.isMesh) n.opacity = 1; }); CTX.fx.sparkle(new Vec3(this.pos.x, this.pos.y + 0.8, this.pos.z), PAL.gold, 14, 0.8); }
  onHit(info) {
    if (this.state !== 'caged') return false;
    if (this.hidden) this.reveal();
    this.hits -= info.dmg >= 2 ? 2 : 1;
    this.cage.hit();
    sfx('crystal', { pitch: 1.2 });
    if (this.hits <= 0) this.free();
    return true;
  }
  free() {
    this.state = 'freeing'; this.t = 0;
    this.cage.break();
    this.col.enabled = false;
    this.hit.enabled = false;
    sfx('cage');
    CTX.fx.pop(new Vec3(this.pos.x, this.pos.y + 0.7, this.pos.z), PAL.rainbow);
    this._done = true;
    if (this.level.onPuffyRescued) this.level.onPuffyRescued(this);
  }
  update(dt) {
    this.t += dt;
    this.cage.update(dt);
    let anim = 'sad';
    if (this.state === 'freeing') {
      anim = 'cheer';
      if (this.t > 2.2) { this.state = 'leaving'; this.t = 0; }
    } else if (this.state === 'leaving') {
      anim = 'happy';
      this.puffy.root.position.y += dt * (2 + this.t * 4);
      this.puffy.setOpacity(Math.max(0, 1 - this.t));
      if (Math.random() < dt * 20) CTX.fx.twinkle({ x: this.pos.x, y: this.pos.y + this.puffy.root.position.y + 0.3, z: this.pos.z }, PAL.gold, 0.3);
      if (this.t > 1.2) { this.state = 'free'; this.puffy.root.visible = false; }
    } else if (this.state === 'free') { anim = 'idle'; }
    else if (near(this.pos, 4) && Math.random() < dt * 0.6 && !this.hidden) CTX.fx.notes({ x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z }, 1);
    if (this.state === 'caged') {
      const p = CTX.player;
      this.puffy.root.rotation.y = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) * 0.6;
    }
    this.puffy.update(dt, { anim, t: this.t });
  }
}

// ------------------------------------------------------------------ floor switch
export class FloorSwitch {
  // signal: channel name; o.toggle (stay), o.heavy (needs heavy animal or crate), o.timer
  constructor(level, x, y, z, signal, o = {}) {
    this.level = level;
    this.obj = buildObject('floorSwitch', { color: o.color });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.signal = signal;
    this.mode = o.mode || 'hold'; // hold | once | timer
    this.timer = o.timer ?? 6;
    this.heavy = !!o.heavy;
    this.crateOnly = !!o.crate; // only crates press it (o.crate: true)
    this.pressed = false; this.t = 0;
    this.col = level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.08, z, hx: 0.6, hy: 0.08, tag: 'switch' }));
    level.signal(signal);
  }
  _pressedNow() {
    const p = CTX.player;
    const onIt = p.body.grounded && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 0.8 && Math.abs(p.pos.y - this.pos.y) < 0.6;
    if (onIt && this.crateOnly && !this._crateHint) { this._crateHint = true; if (CTX.hud) CTX.hud.toast('이 스위치는 상자처럼 무거운 물건을 올려야 해요!', 'warn', 2.6); }
    if (!onIt) this._crateHint = false;
    if (onIt && !this.crateOnly && (!this.heavy || p.heavy)) return true;
    for (const c of this.level.crates || []) if (Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) < 0.8 && Math.abs(c.pos.y - this.pos.y) < 0.6) return true;
    return false;
  }
  update(dt) {
    const now = this._pressedNow();
    if (this.heavy && !now) {
      const p = CTX.player;
      const onIt = p.body.grounded && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 0.8 && Math.abs(p.pos.y - this.pos.y) < 0.6;
      if (onIt && !this._hinted) { this._hinted = true; if (CTX.hud) CTX.hud.toast('무거운 친구(곰돌이, 코끼리, 소, 사자)나 상자가 필요해요!', 'warn'); }
      if (!onIt) this._hinted = false;
    }
    if (this.mode === 'hold') {
      if (now !== this.pressed) { this.pressed = now; this.obj.setPressed(now); this.level.setSignal(this.signal, now); sfx('switch', { pitch: now ? 1.1 : 0.8 }); }
    } else if (this.mode === 'once') {
      if (now && !this.pressed) { this.pressed = true; this.obj.setPressed(true); this.level.setSignal(this.signal, true); sfx('switch'); CTX.fx.sparkle(this.pos, PAL.gold, 10, 0.5); }
    } else if (this.mode === 'timer') {
      if (now && !this.pressed) { this.pressed = true; this.t = this.timer; this.obj.setPressed(true); this.level.setSignal(this.signal, true); sfx('switch'); }
      if (this.pressed) {
        this.t -= dt;
        if (Math.floor(this.t * 2) !== Math.floor((this.t + dt) * 2)) sfx('timer', { vol: 0.5 });
        if (this.t <= 0 && !now) { this.pressed = false; this.obj.setPressed(false); this.level.setSignal(this.signal, false); sfx('switch', { pitch: 0.7 }); }
      }
    }
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ crystal switch (hit to toggle)
export class CrystalSwitch {
  constructor(level, x, y, z, signal, o = {}) {
    this.level = level;
    this.obj = buildObject('crystalSwitch');
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.signal = signal;
    this.mode = o.mode || 'toggle'; // toggle | once | timer
    this.timer = o.timer ?? 8;
    this.on = false; this.t = 0;
    this.need = o.need || null; // required tag (fire, water, light, ...) or null
    level.signal(signal);
    level.addHittable({ pos: new Vec3(x, y + 0.95, z), r: 0.55, onHit: (info) => this.onHit(info) });
    level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.5, z, hx: 0.3, hy: 0.5, tag: 'cswitch' }));
    if (o.on) { this.on = true; this.obj.setOn(true); level.setSignal(signal, true); }
  }
  onHit(info) {
    if (this.need && !has(info, this.need)) { this.obj.hit(); return true; }
    if (this.cool > 0) return false;
    this.cool = 0.35;
    this.obj.hit();
    if (this.mode === 'once' && this.on) return true;
    this.on = this.mode === 'toggle' ? !this.on : true;
    if (this.mode === 'timer') this.t = this.timer;
    this.obj.setOn(this.on);
    this.level.setSignal(this.signal, this.on);
    sfx('switch', { pitch: this.on ? 1.2 : 0.9 });
    CTX.fx.sparkle(new Vec3(this.pos.x, this.pos.y + 1, this.pos.z), this.on ? [1, 0.6, 0.9] : [0.6, 0.8, 1], 10, 0.4);
    return true;
  }
  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (this.mode === 'timer' && this.on) {
      this.t -= dt;
      if (Math.floor(this.t * 2) !== Math.floor((this.t + dt) * 2)) sfx('timer', { vol: 0.5 });
      if (this.t <= 0) { this.on = false; this.obj.setOn(false); this.level.setSignal(this.signal, false); }
    }
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ gate (opens on signal)
export class Gate {
  constructor(level, x, y, z, yaw, signal, o = {}) {
    this.obj = buildObject('gate', { w: o.w ?? 3, h: o.h ?? 2.5 });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.node.rotation.y = yaw;
    this.w = o.w ?? 3; this.h = o.h ?? 2.5;
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y + this.h / 2, z, hx: this.w / 2, hy: this.h / 2, hz: 0.25, yaw, tag: 'gate', camBlock: false }));
    this.open = 0; this.target = 0;
    this.invert = !!o.invert;
    level.onSignal(signal, (v) => { this.target = (v !== this.invert) ? 1 : 0; sfx('gateOpen', { pitch: this.target ? 1 : 0.8 }); });
    if (this.invert) { this.target = 1; this.open = 1; }
    this.count = o.count || 0; // number of signals needed (handled by level.counter)
  }
  update(dt) {
    this.open += (this.target - this.open) * Math.min(1, dt * 3);
    this.obj.setOpen(this.open);
    this.col.enabled = this.open < 0.6;
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ locked door (needs key)
export class LockDoor {
  constructor(level, x, y, z, yaw, keyId, o = {}) {
    this.obj = buildObject('lockDoor', { w: o.w ?? 2.4, h: o.h ?? 3 });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.node.rotation.y = yaw;
    this.pos = new Vec3(x, y, z);
    this.w = o.w ?? 2.4;
    this.keyId = keyId;
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y + 1.5, z, hx: this.w / 2 + 0.2, hy: 1.6, hz: 0.3, yaw, tag: 'door', camBlock: false }));
    this.open = 0; this.opening = false;
  }
  update(dt) {
    const pk = CTX.pickups;
    if (!this.opening && near({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 2.6)) {
      if (pk && pk.keys[this.keyId]) {
        this.opening = true; delete pk.keys[this.keyId];
        sfx('unlock'); sfx('door');
        CTX.fx.sparkle(new Vec3(this.pos.x, this.pos.y + 1.4, this.pos.z), PAL.gold, 16, 0.8);
        if (CTX.hud) { CTX.hud.setKey(false); CTX.hud.toast('찰칵! 문이 열렸어요', 'good'); }
      } else if (!this._hinted) { this._hinted = true; if (CTX.hud) CTX.hud.toast('잠겨 있어요. 열쇠를 찾아봐요!', 'warn'); }
    }
    if (!near({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 4)) this._hinted = false;
    if (this.opening && this.open < 1) { this.open = Math.min(1, this.open + dt * 0.8); this.obj.setOpen(this.open); if (this.open > 0.5) this.col.enabled = false; }
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ pushable crate
export class Crate {
  constructor(level, x, y, z) {
    this.level = level;
    this.obj = buildObject('crate');
    this.node = this.obj.root;
    this.pos = new Vec3(x, y, z);
    this.vel = new Vec3();
    this.node.position.copy(this.pos);
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y + 0.5, z, hx: 0.5, hy: 0.5, hz: 0.5, moving: true, tag: 'crate' }));
    this.body = { pos: this.pos, vel: this.vel, r: 0.45, h: 0.95, stepUp: 0.24, snapDown: 0.25, margin: -0.2, grounded: false }; // can climb onto floor switches (0.16)
    (level.crates || (level.crates = [])).push(this);
    this.home = this.pos.clone();
  }
  update(dt) {
    const p = CTX.player;
    // push when player walks into it
    const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z;
    const ad = Math.max(Math.abs(dx), Math.abs(dz));
    let push = false;
    if (ad < 0.95 && Math.abs(p.pos.y - this.pos.y) < 0.5 && p.inputMag > 0.3) {
      const f = p.facing();
      if (Math.abs(dx) > Math.abs(dz)) { if (Math.sign(dx) === Math.sign(f.x) && Math.abs(f.x) > 0.5) { this.vel.x = Math.sign(dx) * 2.2; this.vel.z = 0; push = true; } }
      else if (Math.sign(dz) === Math.sign(f.z) && Math.abs(f.z) > 0.5) { this.vel.z = Math.sign(dz) * 2.2; this.vel.x = 0; push = true; }
    }
    if (!push) { this.vel.x = 0; this.vel.z = 0; }
    this.vel.y -= 25 * dt;
    // temporarily disable own collider while moving
    this.col.enabled = false;
    this.level.physics.moveBody(this.body, dt);
    this.col.enabled = true;
    if (push && Math.random() < dt * 8) { CTX.fx.dust(this.pos, 1, 0.6); }
    if (push && !this._sfxT) { sfx('crumble', { vol: 0.2, pitch: 1.5 }); this._sfxT = 0.3; }
    if (this._sfxT) { this._sfxT -= dt; if (this._sfxT <= 0) this._sfxT = 0; }
    if (this.pos.y < this.level.killY) { this.pos.copy(this.home); this.vel.set(0, 0, 0); CTX.fx.poof(this.pos); }
    this.col.moveTo(this.pos.x, this.pos.y + 0.5, this.pos.z);
    this.node.position.copy(this.pos);
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ breakable rock / crate / cracked floor
export class Breakable {
  // kind: 'rock' (needs heavy), 'crate' (any), 'floor' (needs pound); drops: fn or {candy:n, heart, item:[...] }
  constructor(level, kind, x, y, z, o = {}) {
    this.level = level;
    this.kind = kind;
    this.pos = new Vec3(x, y, z);
    this.drops = o.drops || null;
    const size = o.size ?? (kind === 'rock' ? 1.5 : 1);
    if (kind === 'floor') {
      this.node = buildPlatform('biscuit', o.w ?? 2.4, o.d ?? 2.4, 0.5, {});
      this.node.position.set(x, y, z);
      this.col = level.physics.add(new Collider({ type: 'box', x, y: y - 0.25, z, hx: (o.w ?? 2.4) / 2, hy: 0.25, hz: (o.d ?? 2.4) / 2, tag: 'crackedFloor', owner: this }));
      this.col.noSafe = true;
    } else {
      this.obj = buildObject(kind === 'rock' ? 'breakRock' : 'breakCrate');
      this.node = this.obj.root;
      this.node.position.set(x, y, z);
      this.node.scale.set(size / (kind === 'rock' ? 1.5 : 1), size / (kind === 'rock' ? 1.5 : 1), size / (kind === 'rock' ? 1.5 : 1));
      this.col = level.physics.add(new Collider({ type: 'box', x, y: y + size / 2, z, hx: size / 2, hy: size / 2, hz: size / 2, yaw: o.yaw || 0, tag: kind }));
      this.hit = level.addHittable({ pos: new Vec3(x, y + size / 2, z), r: size * 0.6, onHit: (info) => this.onHit(info) });
    }
    this.broken = false;
    this.hint = o.hint ?? true;
  }
  onHit(info) {
    if (this.broken) return false;
    const heavy = has(info, 'heavy') || info.kind === 'pound' || info.kind === 'rush' || info.kind === 'boom';
    if (this.kind === 'rock' && !heavy) {
      this.obj.hit && this.obj.hit();
      sfx('block', { vol: 0.5 });
      if (this.hint && !this._hinted && CTX.hud) { this._hinted = true; CTX.hud.toast('단단한 바위예요! 힘센 친구(소, 곰돌이, 캥거루, 사자)로 부숴봐요', 'warn', 3.2); }
      return true;
    }
    this.breakIt();
    return true;
  }
  onPound() { if (this.kind === 'floor') this.breakIt(); }
  breakIt() {
    if (this.broken) return;
    this.broken = true;
    if (this.obj && this.obj.break) this.obj.break();
    else if (this.node) { this.node.visible = false; CTX.fx.boom(this.pos, 1.4); }
    this.col.enabled = false;
    if (this.hit) this.hit.enabled = false;
    sfx('break');
    CTX.fx.shake(0.15, 0.2);
    CTX.fx.dust(this.pos, 10, 1.4);
    const d = this.drops;
    if (d) {
      if (typeof d === 'function') d(this);
      else {
        if (d.candy && CTX.pickups) CTX.pickups.drop(new Vec3(this.pos.x, this.pos.y + 0.5, this.pos.z), d.candy, 2);
        if (d.heart && CTX.pickups) CTX.pickups.dropHeart(new Vec3(this.pos.x, this.pos.y + 0.5, this.pos.z));
      }
    }
    if (this.onBreak) this.onBreak(this);
  }
  update(dt) { if (this.obj) this.obj.update(dt); }
}

// ------------------------------------------------------------------ element puzzles
export class ElementBlock {
  // kind: 'thorns' (fire burns), 'ice' (fire melts)
  constructor(level, kind, x, y, z, o = {}) {
    this.kind = kind;
    this.pos = new Vec3(x, y, z);
    if (kind === 'thorns') this.obj = buildObject('thornVine', { w: o.w ?? 2, h: o.h ?? 2.5 });
    else this.obj = buildObject('iceBlock', { s: o.s ?? 1.2 });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.node.rotation.y = o.yaw || 0;
    const w = kind === 'thorns' ? (o.w ?? 2) : (o.s ?? 1.2), h = kind === 'thorns' ? (o.h ?? 2.5) : (o.s ?? 1.2), d = kind === 'thorns' ? 0.8 : (o.s ?? 1.2);
    this.col = level.physics.add(new Collider({ type: 'box', x, y: y + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: o.yaw || 0, hazard: kind === 'thorns' ? 'thorn' : null, tag: kind }));
    this.hit = level.addHittable({ pos: new Vec3(x, y + h / 2, z), r: Math.max(w, h) * 0.55, onHit: (info) => this.onHit(info) });
    this.done = false;
    this.onClear = o.onClear || null;
  }
  onHit(info) {
    if (this.done) return false;
    if (has(info, 'fire')) {
      this.done = true;
      if (this.kind === 'thorns') this.obj.burn(); else this.obj.melt();
      this.col.enabled = false; this.hit.enabled = false;
      sfx(this.kind === 'thorns' ? 'fire' : 'water');
      CTX.fx.sparkle(this.pos, [1, 0.6, 0.3], 14, 1);
      if (this.onClear) this.onClear(this);
      return true;
    }
    if (!this._hinted && CTX.hud) { this._hinted = true; CTX.hud.toast(this.kind === 'thorns' ? '가시덩굴이에요. 불을 쓰는 친구가 있으면 태울 수 있어요!' : '꽁꽁 언 얼음이에요. 불로 녹여 볼까요?', 'warn', 3.2); }
    return true;
  }
  update(dt) { this.obj.update(dt); }
}

export class Torch {
  constructor(level, x, y, z, signal, o = {}) {
    this.level = level;
    this.obj = buildObject('torch');
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.lit = false;
    this.signal = signal;
    level.addHittable({ pos: new Vec3(x, y + 1.3, z), r: 0.6, onHit: (info) => this.onHit(info) });
    level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.6, z, hx: 0.2, hy: 0.6, tag: 'torch' }));
    this.obj.setLit(!!o.lit);
    if (o.lit) this.setLit(true, true);
    this.group = o.group || null;
  }
  onHit(info) {
    if (this.lit) return false;
    if (!has(info, 'fire')) { if (!this._hinted && CTX.hud) { this._hinted = true; CTX.hud.toast('횃불이에요. 불꽃으로 켤 수 있어요!', 'warn'); } return true; }
    this.setLit(true);
    return true;
  }
  setLit(v, silent = false) {
    this.lit = v;
    this.obj.setLit(v);
    if (!silent) { sfx('fire', { pitch: 1.4 }); CTX.fx.sparkle(new Vec3(this.pos.x, this.pos.y + 1.4, this.pos.z), [1, 0.7, 0.3], 10, 0.4); }
    if (this.signal) this.level.setSignal(this.signal, v);
    if (this.group) this.group.check();
  }
  update(dt) { this.obj.update(dt); }
}
// group of torches -> one signal when all lit
export class TorchGroup {
  constructor(level, signal, torches) {
    this.level = level; this.signal = signal; this.torches = torches;
    for (const t of torches) t.group = this;
    this.done = false;
  }
  check() {
    if (this.done) return;
    if (this.torches.every((t) => t.lit)) { this.done = true; this.level.setSignal(this.signal, true); if (CTX.audio) CTX.audio.jingle('secret'); }
  }
  update() {}
}

export class SeedSprout {
  constructor(level, x, y, z, o = {}) {
    this.obj = buildObject('seedSprout', { h: o.h ?? 2.5, r: o.r ?? 1.2 });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.h = o.h ?? 2.5; this.r = o.r ?? 1.2;
    this.growth = 0; this.water = 0;
    this.col = level.physics.add(new Collider({ type: 'cyl', x, y: y + this.h - 0.15, z, hx: this.r, hy: 0.15, moving: true, tag: 'flower', enabled: false }));
    this.col.enabled = false;
    this.stem = level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.4, z, hx: 0.3, hy: 0.4, tag: 'sprout' }));
    level.addHittable({ pos: new Vec3(x, y + 0.5, z), r: 1.0, onHit: (info) => this.onHit(info) });
    this.grown = false;
  }
  onHit(info) {
    if (this.grown) return false;
    if (has(info, 'water')) { this.water += 0.12; CTX.fx.sparkle(new Vec3(this.pos.x, this.pos.y + 0.6, this.pos.z), [0.6, 0.9, 1], 3, 0.4); return true; }
    if (!this._hinted && CTX.hud) { this._hinted = true; CTX.hud.toast('목마른 씨앗이에요. 물을 주면 쑥쑥 자랄 거예요!', 'warn', 3); }
    return true;
  }
  update(dt) {
    if (!this.grown && this.water > 0) {
      this.growth = Math.min(1, this.growth + this.water);
      this.water = 0;
      if (this.growth >= 1) {
        this.grown = true; sfx('magic', { pitch: 1.3 }); if (CTX.audio) CTX.audio.jingle('secret');
        CTX.fx.petals(new Vec3(this.pos.x, this.pos.y + this.h, this.pos.z), PAL.rainbow, 20);
      }
    }
    this.vis = (this.vis || 0) + (this.growth - (this.vis || 0)) * Math.min(1, dt * 4);
    this.obj.setGrowth(this.vis);
    this.col.enabled = this.vis > 0.95;
    this.obj.update(dt);
  }
}

export class Pinwheel {
  constructor(level, x, y, z, signal, o = {}) {
    this.level = level;
    this.obj = buildObject('pinwheel');
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.node.rotation.y = o.yaw || 0;
    this.pos = new Vec3(x, y, z);
    this.signal = signal;
    this.speed = 0; this.dur = o.dur ?? 7; this.t = 0;
    level.signal(signal);
    level.addHittable({ pos: new Vec3(x, y + 1, z), r: 0.9, onHit: (info) => this.onHit(info) });
  }
  onHit(info) {
    if (has(info, 'wind') || info.kind === 'roar') { this.t = this.dur; this.speed = 1; this.level.setSignal(this.signal, true); sfx('wind'); return true; }
    this.speed = Math.max(this.speed, 0.15);
    if (!this._hinted && CTX.hud) { this._hinted = true; CTX.hud.toast('바람개비예요. 바람을 일으키는 친구(여우, 사자)가 필요해요!', 'warn', 3); }
    return true;
  }
  update(dt) {
    if (this.t > 0) { this.t -= dt; if (this.t <= 0) { this.level.setSignal(this.signal, false); } }
    this.speed += ((this.t > 0 ? 1 : 0) - this.speed) * Math.min(1, dt * 1.5);
    this.obj.update(dt, this.speed);
  }
}

// ------------------------------------------------------------------ star cannon (launch to target)
export class Cannon {
  constructor(level, x, y, z, target, o = {}) {
    this.obj = buildObject('starCannon');
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.target = new Vec3(...target);
    this.flight = o.time ?? 1.6;
    const dx = this.target.x - x, dz = this.target.z - z;
    this.yaw = Math.atan2(dx, dz);
    this.obj.aim(this.yaw, 0.7);
    this.state = 'idle'; this.t = 0;
    // low base so players can simply walk in (top 0.3 < step-up height)
    level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.15, z, hx: 0.7, hy: 0.15, tag: 'cannonbase' }));
  }
  update(dt) {
    this.t += dt;
    const p = CTX.player;
    if (this.state === 'idle') {
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < 1.0 && Math.abs(p.pos.y - (this.pos.y + 0.6)) < 0.9 && !p.dead) {
        this.state = 'load'; this.t = 0;
        p.locked = true; p.vel.set(0, 0, 0);
        p.node.visible = false;
        sfx('cannon', { vol: 0.3, pitch: 1.4 });
      }
    } else if (this.state === 'load') {
      p.pos.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      if (this.t > 0.55) {
        this.state = 'cool'; this.t = 0;
        this.obj.fire();
        sfx('cannon');
        CTX.fx.boom(new Vec3(this.pos.x + Math.sin(this.yaw) * 1, this.pos.y + 1.4, this.pos.z + Math.cos(this.yaw) * 1), 1.2);
        CTX.fx.shake(0.2, 0.2);
        const T = this.flight;
        const sy = this.pos.y + 1.2;
        const g = 30;
        const vx = (this.target.x - this.pos.x) / T, vz = (this.target.z - this.pos.z) / T;
        const vy = (this.target.y - sy) / T + 0.5 * g * T;
        p.pos.set(this.pos.x, sy, this.pos.z);
        p.node.visible = true;
        p.locked = false;
        p.launch(vx, vy, vz, T);
        p.yaw = this.yaw;
        p.cannonT = T; // disable air control briefly
      }
    } else if (this.state === 'cool') { if (this.t > 1.5) this.state = 'idle'; }
    if (p.cannonT > 0) { p.cannonT -= dt; if (Math.random() < dt * 30) CTX.fx.rainbowTrail(p.center); }
    this.obj.update(dt);
  }
}

// ------------------------------------------------------------------ NPC / sign (talk prompt)
export class Talker {
  // kind: 'puffy' | 'sign' | node; lines: array of [speaker, text] or function
  constructor(level, kind, x, y, z, lines, o = {}) {
    this.level = level;
    this.pos = new Vec3(x, y, z);
    this.lines = lines;
    this.o = o;
    this.node = new Node('talker');
    this.node.position.copy(this.pos);
    if (kind === 'puffy') { this.rig = buildPuffy(o.color ?? 0); this.node.add(this.rig.root); this.speaker = o.name || '뭉실이'; this.face = 'puffy' + (o.color ?? 0); this.talkY = 0.9; }
    else if (kind === 'sign') { this.obj = buildObject('signBoard', { icon: o.icon || '!' }); this.node.add(this.obj.root); this.speaker = '표지판'; this.face = null; this.talkY = 1.6; }
    else if (kind && kind.root) { this.rig = kind; this.node.add(kind.root); this.speaker = o.name || ''; this.face = o.face || null; this.talkY = o.talkY ?? 1.2; }
    this.node.rotation.y = o.yaw || 0;
    this.r = o.r ?? 2.2;
    this.t = 0;
    this.auto = !!o.auto; // auto-trigger when near (once)
    this.done = false;
    if (kind === 'sign') level.physics.add(new Collider({ type: 'cyl', x, y: y + 0.6, z, hx: 0.25, hy: 0.6, tag: 'sign' }));
  }
  update(dt) {
    this.t += dt;
    const p = CTX.player;
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const close = d < this.r && Math.abs(p.pos.y - this.pos.y) < 2;
    if (this.rig) {
      if (close && this.rig.root) this.node.rotation.y += (Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.node.rotation.y) * Math.min(1, dt * 4);
      this.rig.update(dt, { anim: this.talking ? 'talk' : (close ? 'wave' : 'idle'), t: this.t });
    }
    if (this.obj) this.obj.update(dt);
    const ui = CTX.ui;
    if (close && !this.talking && ui && !ui.busy()) {
      if (this.auto && !this.done) { this.talk(); return; }
      CTX.hud.setPrompt(new Vec3(this.pos.x, this.pos.y + this.talkY + 0.6, this.pos.z), CTX.game.touchMode ? '공격 버튼: 이야기' : '공격(J/X): 이야기');
      this._prompting = true;
      if (CTX.input.pressed('attack') || CTX.input.pressed('confirm') && !CTX.input.pressed('jump')) { CTX.input.consume('attack'); this.talk(); }
    } else if (this._prompting) { this._prompting = false; CTX.hud.setPrompt(null); }
    p.nearTalker = close ? this : (p.nearTalker === this ? null : p.nearTalker);
  }
  talk() {
    this.done = true;
    this.talking = true;
    CTX.hud.setPrompt(null);
    this._prompting = false;
    const lines = typeof this.lines === 'function' ? this.lines() : this.lines;
    const seq = lines.map((l) => (Array.isArray(l) ? { who: l[0] || this.speaker, text: l[1], face: l[2] ?? this.face } : { who: this.speaker, text: l, face: this.face }));
    CTX.ui.dialog(seq).then(() => { this.talking = false; if (this.o.after) this.o.after(this); });
  }
}

// ------------------------------------------------------------------ grapple points (frog hook / monkey swing)
export class GrapplePoint {
  constructor(level, x, y, z, o = {}) {
    this.pos = new Vec3(x, y, z);
    this.node = new Node('grapple');
    const ring = new Mesh(G.torusGeo(0.42, 0.09, 8, 24), new Material({ color: o.color ?? 0x7ad86a, spec: 0.4, rim: 0.5 }));
    const glow = new Mesh(G.sphereGeo(0.28, 12, 8), new Material({ color: 0xfff4a0, unlit: true }));
    const leaf = new Mesh(G.coneGeo(0.12, 0.3, 6), new Material({ color: 0x5fc860 }));
    leaf.position.set(0, 0.5, 0);
    this.node.add(ring, glow, leaf);
    this.node.position.copy(this.pos);
    this.ring = ring; this.glow = glow;
    this.t = Math.random() * 6;
    level.grapples.push(this);
  }
  update(dt) {
    this.t += dt;
    this.ring.rotation.y = this.t * 0.8;
    const p = CTX.player;
    const usable = p && (p.charId === 'frog' || p.charId === 'monkey') && this.pos.distanceTo(p.pos) < 10;
    const s = usable ? 1 + Math.sin(this.t * 5) * 0.12 : 0.85;
    this.glow.scale.set(s, s, s);
    this.glow.material.color = usable ? [1, 0.95, 0.5] : [0.85, 0.82, 0.7];
  }
}

// ------------------------------------------------------------------ dig spot (pig)
export class DigSpot {
  constructor(level, x, y, z, reward, o = {}) {
    this.level = level;
    this.pos = new Vec3(x, y, z);
    this.reward = reward; // fn(pos) or {candy:n} or {cookie:id} or {puffy:...}
    this.node = new Node('dig');
    const mound = new Mesh(G.sphereGeo(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new Material({ color: o.color ?? 0xb08860, rim: 0.2 }));
    mound.scale.set(1, 0.4, 1);
    this.node.add(mound);
    this.mound = mound;
    this.node.position.copy(this.pos);
    this.done = false;
    this.t = Math.random() * 5;
    level.digSpots.push(this);
    level.secrets.push({ pos: this.pos, kind: 'dig', reveal: () => {}, get done() { return this._d; }, _d: false, spot: this });
  }
  dig() {
    if (this.done) return false;
    this.done = true;
    this.mound.scale.set(1.1, 0.12, 1.1);
    CTX.fx.dust(this.pos, 14, 1.4);
    if (CTX.audio) CTX.audio.jingle('secret');
    const r = this.reward;
    const pos = new Vec3(this.pos.x, this.pos.y + 0.3, this.pos.z);
    if (typeof r === 'function') r(pos);
    else if (r && r.candy) CTX.pickups.drop(pos, r.candy, 2.5);
    else if (r && r.cookie) CTX.pickups.cookie(r.cookie, pos.x, pos.y + 0.8, pos.z);
    else if (r && r.heart) CTX.pickups.dropHeart(pos);
    for (const s of this.level.secrets) if (s.spot === this) s._d = true;
    return true;
  }
  update(dt) {
    this.t += dt;
    if (!this.done && Math.random() < dt * 2.5) CTX.fx.twinkle({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, [1, 0.9, 0.5], 0.5);
  }
}

// ------------------------------------------------------------------ ghost platform (visible/solid near light: firefly pet, unicorn, foxfire)
export class GhostPlatform {
  constructor(level, x, y, z, w, d, o = {}) {
    this.level = level;
    this.node = buildPlatform(o.style || 'crystal', w, d, 0.4, { round: !!o.round });
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.col = level.physics.add(new Collider({ type: o.round ? 'cyl' : 'box', x, y: y - 0.2, z, hx: w / 2, hy: 0.2, hz: d / 2, moving: true, tag: 'ghost' }));
    this.col.enabled = false;
    this.vis = 0;
    this.revealT = 0;
    level.ghosts.push(this);
    this.node.traverse((n) => { if (n.isMesh) n.opacity = 0.08; });
  }
  reveal(t = 10) { this.revealT = Math.max(this.revealT, t); }
  update(dt) {
    if (this.revealT > 0) this.revealT -= dt;
    const p = CTX.player;
    let lit = this.revealT > 0;
    const lr = CTX.pet ? CTX.pet.lightRadius() : 0;
    if (lr > 0 && this.pos.distanceTo(CTX.pet.pos) < lr) lit = true;
    if (p.buffs && p.buffs.foxfire && this.pos.distanceTo(p.pos) < 5) lit = true;
    if (p.charId === 'unicorn' && this.pos.distanceTo(p.pos) < 4.5) lit = true;
    const target = lit ? 1 : 0;
    this.vis += (target - this.vis) * Math.min(1, dt * 5);
    const solid = this.vis > 0.5;
    if (solid !== this.col.enabled) {
      // don't remove the floor from under the player abruptly: allow a grace period
      if (!solid && p.body.ground === this.col) { this._grace = (this._grace || 0) + dt; if (this._grace < 0.8) return this._apply(); }
      this._grace = 0;
      this.col.enabled = solid;
      if (solid && CTX.pet && CTX.pet.onGhostUsed) CTX.pet.onGhostUsed();
    }
    this._apply();
  }
  _apply() {
    const o = 0.1 + this.vis * 0.85;
    this.node.traverse((n) => { if (n.isMesh) n.opacity = o; });
  }
}

// ------------------------------------------------------------------ water volume with surface mesh
export class Water {
  constructor(level, x, top, z, w, d, depth = 4, o = {}) {
    this.w = level.physics.addWater({ x, z, hx: w / 2, hz: d / 2, top, bottom: top - depth });
    const geo = G.planeGeo(w, d, Math.max(2, Math.round(w / 1.5)), Math.max(2, Math.round(d / 1.5)));
    const m = new Mesh(geo, new Material({ shader: 'water', color: o.color ?? 0x7ad8f0, transparent: true, opacity: 0.82, uniforms: { uDeep: rgb(o.deep ?? 0x3aa8d8), uWaveAmp: 0.06 }, satField: true }));
    m.position.set(x, top, z);
    m.renderOrder = 3;
    this.node = m;
    this.top = top;
    this.x = x; this.z = z; this.hw = w / 2; this.hd = d / 2;
    level.waterVolumes = level.waterVolumes || [];
    level.waterVolumes.push(this);
  }
  update() {}
}

// ------------------------------------------------------------------ the Dream Light (stage goal after boss)
export class DreamLight {
  constructor(level, x, y, z, color, onGet) {
    this.obj = buildObject('dreamLight', { color });
    this.node = this.obj.root;
    this.node.position.set(x, y, z);
    this.pos = new Vec3(x, y, z);
    this.onGet = onGet;
    this.got = false;
    this.node.visible = false;
    this.active = false;
  }
  show() { this.active = true; this.node.visible = true; this.node.scale.set(0.01, 0.01, 0.01); this.t = 0; CTX.fx.colorBloom(this.pos, [1, 1, 1], 5); }
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const s = Math.min(1, Ease.outBack(Math.min(1, this.t / 0.8)));
    this.node.scale.set(s, s, s);
    this.obj.update(dt);
    if (Math.random() < dt * 8) CTX.fx.twinkle({ x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z }, [1, 1, 0.8], 0.9);
    if (!this.got && this.t > 1 && near({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 1.8)) { this.got = true; if (this.onGet) this.onGet(this); }
  }
}

// ------------------------------------------------------------------ freeze water helper (penguin snowball)
export function installFreeze(level) {
  level.freezeWater = (x, top, z) => {
    level.add(new IceFloe(level, x, top, z));
  };
}
void clamp; void TAU; void lerp;

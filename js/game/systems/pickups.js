// ============================================================================
// pickups.js — star candies (instanced), big candies, hearts, animal cookies,
// keys. Handles collection, magnet, drops with bounce, grabbing (tongue/neck).
// ============================================================================
import { Node, InstancedMesh, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import { Vec3, rgb, TAU, clamp } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { buildObject, starCandyGeo } from '../models/objects.js';
import { buildAnimalHead } from '../models/animals.js';
import { CHAR_BY_ID } from '../data/characters.js';

const CANDY_COLORS = [0xffd84a, 0xff8fc4, 0x8fd8ff, 0x9af07a, 0xc8a0ff, 0xffb06a].map(rgb);
const MAX_CANDY = 900;

export class Pickups {
  constructor(level) {
    this.level = level;
    this.root = new Node('pickups');
    level.root.add(this.root);
    this.c = []; // candies
    this.items = [];
    this.inst = new InstancedMesh(starCandyGeo(0xffffff), new Material({ vertexColors: true, spec: 0.5, rim: 0.5, emissive: 0x201810 }), MAX_CANDY, 'candies');
    this.inst.frustumCulled = false;
    this.root.add(this.inst);
    this.t = 0;
    this.count = 0; // collected in this stage
    this.keys = {};
    this.onCookie = null;
  }
  // ------------------------------------------------------------------ spawners
  candy(x, y, z, o = {}) {
    if (this.c.length >= MAX_CANDY) return null;
    const c = { pos: new Vec3(x, y, z), base: y, col: CANDY_COLORS[o.color ?? (this.c.length % CANDY_COLORS.length)], alive: true, ph: Math.random() * TAU, vel: null, delay: 0, hidden: !!o.hidden, value: 1 };
    this.c.push(c);
    return c;
  }
  candyLine(a, b, n, o = {}) { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); this.candy(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, o); } }
  candyArc(a, b, n, h = 2, o = {}) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.candy(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * h, a[2] + (b[2] - a[2]) * t, o);
    }
  }
  candyRing(x, y, z, r, n, o = {}) { for (let i = 0; i < n; i++) { const a = (i / n) * TAU; this.candy(x + Math.sin(a) * r, y, z + Math.cos(a) * r, o); } }
  candyGrid(x, y, z, nx, nz, sp = 1, o = {}) { for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.candy(x + (i - (nx - 1) / 2) * sp, y, z + (j - (nz - 1) / 2) * sp, o); }
  // drop candies with physics (from enemies, dig spots)
  drop(pos, n, spread = 3) {
    for (let i = 0; i < n; i++) {
      const c = this.candy(pos.x, pos.y + 0.5, pos.z);
      if (!c) return;
      const a = Math.random() * TAU, s = spread * (0.4 + Math.random() * 0.6);
      c.vel = new Vec3(Math.sin(a) * s, 6 + Math.random() * 3, Math.cos(a) * s);
      c.delay = 0.35;
      c.life = 12;
    }
  }
  item(kind, x, y, z, o = {}) {
    let obj, r = 0.8;
    if (kind === 'bigCandy') { obj = buildObject('bigCandy'); r = 0.9; }
    else if (kind === 'heart') { obj = buildObject('heartItem'); r = 0.85; }
    else if (kind === 'key') { obj = buildObject('key'); r = 0.9; }
    else if (kind === 'cookie') {
      obj = buildObject('cookieBase');
      const head = buildAnimalHead(o.id);
      head.scale.set(0.55, 0.55, 0.55);
      head.position.set(0, 0.24, 0);
      (obj.top || obj.root).add(head);
      obj.head = head;
      r = 1.0;
    }
    const it = { kind, obj, pos: new Vec3(x, y, z), base: y, r, alive: true, ph: Math.random() * TAU, id: o.id, hidden: !!o.hidden, vel: null, delay: 0, owned: !!o.owned };
    obj.root.position.copy(it.pos);
    this.root.add(obj.root);
    if (it.owned) { obj.root.traverse((n) => { if (n.isMesh) n.opacity = 0.35; }); }
    if (it.hidden) { obj.root.traverse((n) => { if (n.isMesh) n.opacity = 0.18; }); this.level.secrets.push({ pos: it.pos, kind, item: it, reveal: () => this.revealItem(it), get done() { return !it.alive; } }); }
    this.items.push(it);
    return it;
  }
  bigCandy(x, y, z, o) { return this.item('bigCandy', x, y, z, o); }
  heart(x, y, z, o) { return this.item('heart', x, y, z, o); }
  key(id, x, y, z, o = {}) { return this.item('key', x, y, z, { ...o, id }); }
  cookie(id, x, y, z, o = {}) {
    const owned = CTX.save && CTX.save.hasChar(id);
    return this.item('cookie', x, y, z, { ...o, id, owned });
  }
  dropHeart(pos) {
    const it = this.item('heart', pos.x, pos.y + 0.6, pos.z);
    it.vel = new Vec3((Math.random() - 0.5) * 2, 6, (Math.random() - 0.5) * 2); it.delay = 0.3; it.life = 10;
    return it;
  }
  revealItem(it) {
    if (!it.hidden) return;
    it.hidden = false;
    it.obj.root.traverse((n) => { if (n.isMesh) n.opacity = it.owned ? 0.35 : 1; });
    CTX.fx.sparkle(it.pos, [1, 0.9, 0.5], 16, 0.8);
  }

  // ------------------------------------------------------------------ grabbing (tongue / neck)
  grabAt(pt, r) {
    let got = false;
    for (const c of this.c) {
      if (!c.alive) continue;
      if ((c.pos.x - pt.x) ** 2 + (c.pos.y - pt.y) ** 2 + (c.pos.z - pt.z) ** 2 < r * r) { this._collectCandy(c); got = true; }
    }
    for (const it of this.items) {
      if (!it.alive) continue;
      if ((it.pos.x - pt.x) ** 2 + (it.pos.y - pt.y) ** 2 + (it.pos.z - pt.z) ** 2 < (r + 0.3) ** 2) { this._collectItem(it); got = true; }
    }
    return got;
  }

  // ------------------------------------------------------------------ collect
  _collectCandy(c, value = 1) {
    c.alive = false;
    this.count += value;
    CTX.fx.candy(c.pos, c.col);
    if (CTX.audio) CTX.audio.sfx(value > 1 ? 'coinBig' : 'coin', { pitch: 1 + ((this.count % 8) * 0.02) });
    if (CTX.save && CTX.save.data) { CTX.save.data.candies += value; CTX.save.data.totalCandies = (CTX.save.data.totalCandies || 0) + value; }
    if (CTX.hud) CTX.hud.setCandies(CTX.save && CTX.save.data ? CTX.save.data.candies : this.count);
    // every 100 candies collected in a stage -> heal a heart
    const before = Math.floor((this.count - value) / 100), after = Math.floor(this.count / 100);
    if (after > before && CTX.player) { CTX.player.heal(1); if (CTX.hud) CTX.hud.toast('별사탕 100개! 하트 회복!', 'good'); }
    if (CTX.pet && CTX.pet.onCandy) CTX.pet.onCandy(c);
  }
  _collectItem(it) {
    if (!it.alive) return;
    const p = CTX.player;
    switch (it.kind) {
      case 'bigCandy': it.alive = false; this._collectCandy({ pos: it.pos, col: CANDY_COLORS[0], alive: true }, 10); break;
      case 'heart':
        if (p.hp >= p.maxHp && !it.force) { // still collect but give candies
          it.alive = false; this._collectCandy({ pos: it.pos, col: CANDY_COLORS[1], alive: true }, 3);
        } else { it.alive = false; p.heal(1); }
        break;
      case 'key':
        it.alive = false;
        this.keys[it.id] = true;
        CTX.fx.sparkle(it.pos, [1, 0.85, 0.3], 14, 0.6);
        if (CTX.audio) CTX.audio.sfx('key');
        if (CTX.hud) { CTX.hud.toast('열쇠를 찾았어요!', 'good'); CTX.hud.setKey(true); }
        break;
      case 'cookie':
        it.alive = false;
        CTX.fx.poof(it.pos);
        CTX.fx.confetti(it.pos, 30);
        if (it.owned) { this._collectCandy({ pos: it.pos, col: CANDY_COLORS[0], alive: true }, 5); }
        else if (this.onCookie) this.onCookie(it.id, it);
        break;
      default: it.alive = false;
    }
    if (!it.alive) { it.obj.root.removeFromParent(); }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.t += dt;
    const p = CTX.player;
    const pc = p ? { x: p.pos.x, y: p.pos.y + 0.55, z: p.pos.z } : null;
    const magR = CTX.pet ? CTX.pet.magnetRadius() : 0;
    const inst = this.inst;
    let n = 0;
    const T = this.t;
    for (let i = 0; i < this.c.length; i++) {
      const c = this.c[i];
      if (!c.alive) continue;
      if (c.vel) {
        c.delay -= dt; c.life -= dt;
        c.vel.y -= 22 * dt;
        c.pos.x += c.vel.x * dt; c.pos.y += c.vel.y * dt; c.pos.z += c.vel.z * dt;
        const g = CTX.physics.groundBelow(c.pos.x, c.pos.y + 0.3, c.pos.z, 0.6);
        if (g && c.vel.y < 0 && c.pos.y < g.y + 0.3) { c.pos.y = g.y + 0.3; c.vel.y *= -0.45; c.vel.x *= 0.7; c.vel.z *= 0.7; if (Math.abs(c.vel.y) < 1) { c.vel = null; c.base = c.pos.y; } }
        if (c.life <= 0 || c.pos.y < this.level.killY) { c.alive = false; continue; }
      }
      if (pc && (!c.delay || c.delay <= 0)) {
        const dx = pc.x - c.pos.x, dy = pc.y - c.pos.y, dz = pc.z - c.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.75 * 0.75 * 1.3) { this._collectCandy(c); continue; }
        if (magR > 0 && d2 < magR * magR) {
          const d = Math.sqrt(d2);
          const k = Math.min(1, dt * (8 + 10 / d));
          c.pos.x += dx * k; c.pos.y += dy * k; c.pos.z += dz * k; c.base = c.pos.y; c.magnet = true;
        }
      }
      const bob = c.vel || c.magnet ? 0 : Math.sin(T * 2.4 + c.ph) * 0.08;
      const s = c.hidden ? 0.5 : 1;
      inst.setTransformAt(n, c.pos.x, c.pos.y + bob, c.pos.z, 0.25, T * 2.2 + c.ph, 0, 0.95 * s);
      inst.setColorAt(n, c.col[0], c.col[1], c.col[2], c.hidden ? 0.4 : 1);
      n++;
    }
    inst.count = n;
    inst.needsUpdate = true;
    // items
    for (const it of this.items) {
      if (!it.alive) continue;
      it.ph += dt;
      if (it.vel) {
        it.delay -= dt; it.life -= dt;
        it.vel.y -= 20 * dt;
        it.pos.addScaled(it.vel, dt);
        const g = CTX.physics.groundBelow(it.pos.x, it.pos.y + 0.4, it.pos.z, 0.8);
        if (g && it.vel.y < 0 && it.pos.y < g.y + 0.45) { it.pos.y = g.y + 0.45; it.vel.y *= -0.4; it.vel.x *= 0.6; it.vel.z *= 0.6; if (Math.abs(it.vel.y) < 1) { it.vel = null; it.base = it.pos.y; } }
        if (it.life <= 0) { it.alive = false; it.obj.root.removeFromParent(); continue; }
      }
      const bob = it.vel ? 0 : Math.sin(it.ph * 2.2) * 0.12;
      it.obj.root.position.set(it.pos.x, it.pos.y + bob, it.pos.z);
      if (it.kind === 'cookie') it.obj.root.rotation.y = Math.sin(it.ph * 1.2) * 0.6;
      it.obj.update(dt);
      if (it.kind === 'cookie' && !it.hidden && Math.random() < dt * 4) CTX.fx.twinkle(it.pos, [1, 0.9, 0.5], 0.7);
      if (pc && (!it.delay || it.delay <= 0) && !it.hidden) {
        const dx = pc.x - it.pos.x, dy = pc.y - it.pos.y, dz = pc.z - it.pos.z;
        if (dx * dx + dy * dy + dz * dz < it.r * it.r) this._collectItem(it);
      } else if (pc && it.hidden) {
        const dx = pc.x - it.pos.x, dy = pc.y - it.pos.y, dz = pc.z - it.pos.z;
        if (dx * dx + dy * dy + dz * dz < it.r * it.r) { this.revealItem(it); this._collectItem(it); }
      }
    }
  }
  remaining() { return this.c.filter((c) => c.alive).length; }
}
void Mesh; void clamp; void CHAR_BY_ID;

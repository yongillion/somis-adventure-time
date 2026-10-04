// ============================================================================
// builder.js — LevelBuilder DSL used by stage scripts.
// Conventions: y arguments are TOP-SURFACE heights; yaw in radians.
// ============================================================================
import { Vec3, RNG, TAU, rgb, clamp } from '../../engine/math.js';
import { Collider } from './physics.js';
import { islandParts, slabParts, blockParts, pillarParts, rampParts, bridgeParts, stairsParts } from './terrain.js';
import { propParts, PROP_INFO } from '../models/props.js';
import { THEMES } from './env.js';
import { spawnEnemy } from '../systems/enemies.js';
import { MovingPlatform, RotatingPlatform, FallingPlatform, BlinkPlatform, Spring } from '../systems/movers.js';
import { Saw, SpikeStrip, SpikeTrap, Crusher, Firebar, Laser, WindZone, Roller, Dropper, FogGoo } from '../systems/hazards.js';
import { PetEvent } from '../systems/petevents.js';
import { buildArena } from '../bosses/boss.js';
import {
  Checkpoint, PuffyCage, FloorSwitch, CrystalSwitch, Gate, LockDoor, Crate, Breakable, ElementBlock, Torch, TorchGroup,
  SeedSprout, Pinwheel, Cannon, Talker, GrapplePoint, DigSpot, GhostPlatform, Water, DreamLight, installFreeze,
} from '../systems/interact.js';

const BLOCK_COLORS = {
  stone: [0xd8d0e0, 0xc4bcd4], wood: [0xe0a878, 0xcf9466], candy: [0xffc8e0, 0xffe0ee], brick: [0xf0b8a0, 0xe0a890],
  crystal: [0xc8e8ff, 0xe0d0ff], metal: [0xd0d4e8, 0xb8bcd4], tiles: [0xfff0f8, 0xe8e0ff], cloud: [0xffffff, 0xf0f0ff],
  ice: [0xd8f4ff, 0xc0e8ff], bark: [0xb08060, 0x9a7050], sand: [0xffe8c0, 0xf8dca8], snow: [0xffffff, 0xeef4ff],
};
export const DECOR_SETS = {
  meadow: { big: ['lollipopTree', 'lollipopTree', 'flowerBush', 'bush'], small: ['daisy', 'tulip', 'mushroomDeco', 'rock'], treeColors: [0xffa8c8, 0x9ae09a, 0xffd0a0, 0xb8e8ff] },
  canyon: { big: ['orangeTree', 'cactusRound', 'mesaPillar', 'hayBale'], small: ['pumpkinDeco', 'barrel', 'rock', 'crateDeco'] },
  honey: { big: ['sunflower', 'sunflower', 'beehive', 'flowerBush'], small: ['clover', 'honeyPot', 'daisy', 'tulip'] },
  jungle: { big: ['palmTree', 'jungleTree', 'giantLeaf', 'bigBloom'], small: ['fern', 'glowMushroom', 'stump', 'log'] },
  sea: { big: ['palmTree', 'beachUmbrella', 'coral', 'barnacleRock'], small: ['shell', 'starfish', 'seaweed', 'sandcastle'] },
  snow: { big: ['snowPine', 'snowPine', 'iceCrystal', 'snowman'], small: ['snowRock', 'frozenFlower', 'candyCane', 'iceCrystal'] },
  toy: { big: ['crayon', 'toyBlock', 'giftBox', 'pencil'], small: ['toyBall', 'topDeco', 'toyBlock', 'giftBox'] },
  moon: { big: ['crystalTree', 'starLamp', 'cloudPillar', 'moonFlower'], small: ['moonFlower', 'whiteRose', 'floatLantern', 'crystalCluster'] },
};

export class LevelBuilder {
  constructor(level, themeName) {
    this.lv = level;
    this.themeName = themeName;
    this.theme = THEMES[themeName];
    this.pal = this.theme.ground;
    this.decor = DECOR_SETS[themeName] || DECOR_SETS.meadow;
    this.rng = new RNG(1234);
    this.topKey = { meadow: 'top:grass', canyon: 'top:sand', honey: 'top:grass', jungle: 'top:grass', sea: 'top:sand', snow: 'top:snow', toy: 'top:candy', moon: 'top:moon' }[themeName] || 'top:grass';
  }
  get ph() { return this.lv.physics; }
  col(o) { return this.ph.add(new Collider(o)); }

  // ------------------------------------------------------------------ terrain
  island(x, y, z, r, o = {}) {
    const pal = { ...this.pal, ...(o.pal || {}) };
    const depth = o.depth ?? Math.min(14, 3 + r * 0.9);
    this.lv.addParts(islandParts(x, y, z, r, { pal, depth, top: o.top || this.topKey, seed: o.seed, flat: o.flat }));
    const c = this.col({ type: 'cyl', x, y: y - 1.5, z, hx: r * 0.975, hy: 1.5, surface: o.surface, tag: o.tag || 'island' });
    this.col({ type: 'cyl', x, y: y - 3 - depth * 0.2, z, hx: r * 0.6, hy: depth * 0.2, tag: 'under', camBlock: false });
    if (o.deco !== false) this.decorate(x, y, z, r, o);
    return c;
  }
  slab(x, y, z, w, d, o = {}) {
    const pal = { ...this.pal, ...(o.pal || {}) };
    this.lv.addParts(slabParts(x, y, z, w, d, { pal, yaw: o.yaw || 0, thick: o.thick, depth: o.depth, top: o.top || this.topKey, under: o.under, taper: o.taper, round: o.round }));
    const c = this.col({ type: 'box', x, y: y - (o.thick ?? 0.7) / 2 - 0.4, z, hx: w / 2, hy: (o.thick ?? 0.7) / 2 + 0.4, hz: d / 2, yaw: o.yaw || 0, surface: o.surface, tag: o.tag || 'slab' });
    if (o.deco) this.decorateRect(x, y, z, w, d, o);
    return c;
  }
  block(x, y, z, w, h, d, o = {}) {
    const style = o.style || 'stone';
    const cols = BLOCK_COLORS[style] || BLOCK_COLORS.stone;
    this.lv.addParts(blockParts(x, y, z, w, h, d, { yaw: o.yaw || 0, color: o.color ?? cols[0], color2: o.color2 ?? cols[1], key: 'block:' + style, round: o.round, uvScale: o.uvScale }));
    return this.col({ type: 'box', x, y: y - h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: o.yaw || 0, surface: o.surface || (style === 'ice' ? 'ice' : 'normal'), climbable: !!o.climbable, tag: o.tag || 'block', oneWay: !!o.oneWay });
  }
  pillar(x, y, z, r, h, o = {}) {
    const style = o.style || 'stone';
    const cols = BLOCK_COLORS[style] || BLOCK_COLORS.stone;
    this.lv.addParts(pillarParts(x, y, z, r, h, { color: o.color ?? cols[1], topColor: o.topColor ?? o.color ?? cols[0], key: 'block:' + style }));
    return this.col({ type: 'cyl', x, y: y - h / 2, z, hx: r, hy: h / 2, surface: o.surface, tag: o.tag || 'pillar' });
  }
  ramp(a, b, w, o = {}) {
    const style = o.style;
    const key = style ? 'block:' + style : (o.top || this.topKey);
    const color = o.color ?? (style ? (BLOCK_COLORS[style] || BLOCK_COLORS.stone)[0] : this.pal.grass);
    const r = rampParts(a[0], a[1], a[2], b[0], b[1], b[2], w, { key, color, thick: o.thick });
    this.lv.addParts(r.parts);
    const lo = Math.min(a[1], b[1]);
    const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2;
    const thick = o.thick ?? 0.6;
    return this.col({ type: 'ramp', x: cx, z: cz, y: (Math.max(a[1], b[1]) + lo - thick) / 2, hx: w / 2, hy: (Math.max(a[1], b[1]) - lo + thick) / 2, hz: r.L / 2, yaw: r.yaw, top0: a[1], top1: b[1], tag: 'ramp' });
  }
  bridge(a, b, w = 1.8, o = {}) {
    const r = bridgeParts(a[0], a[1], a[2], b[0], b[1], b[2], w, o);
    this.lv.addParts(r.parts);
    const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2;
    const sag = o.sag ?? Math.min(0.5, r.L * 0.03);
    if (Math.abs(a[1] - b[1]) < 0.05 && sag < 0.15) return this.col({ type: 'box', x: cx, y: a[1] - 0.15, z: cz, hx: w / 2, hy: 0.15, hz: r.L / 2, yaw: r.yaw, tag: 'bridge' });
    // approximate sagging bridge with two ramps meeting at middle
    const mid = [cx, (a[1] + b[1]) / 2 - sag, cz];
    const ya = r.yaw;
    const half = r.L / 2;
    const mk = (p0, p1) => {
      const ccx = (p0[0] + p1[0]) / 2, ccz = (p0[2] + p1[2]) / 2;
      const lo = Math.min(p0[1], p1[1]), hi = Math.max(p0[1], p1[1]);
      return this.col({ type: 'ramp', x: ccx, z: ccz, y: (hi + lo - 0.3) / 2, hx: w / 2, hy: (hi - lo + 0.3) / 2, hz: half / 2, yaw: ya, top0: p0[1], top1: p1[1], tag: 'bridge' });
    };
    mk(a, mid); mk(mid, b);
    return null;
  }
  stairs(a, b, w, steps, o = {}) {
    const s = stairsParts(a[0], a[1], a[2], b[0], b[1], b[2], w, steps, { ...o, key: 'block:' + (o.style || 'stone'), color: o.color ?? (BLOCK_COLORS[o.style || 'stone'])[0], color2: (BLOCK_COLORS[o.style || 'stone'])[1] });
    this.lv.addParts(s.parts);
    for (const c of s.cols) this.col({ type: 'box', x: c.x, y: c.top - c.h / 2, z: c.z, hx: c.w / 2, hy: c.h / 2, hz: c.d / 2, yaw: c.yaw, tag: 'stairs' });
  }
  wall(x, y, z, w, h, d, o = {}) { return this.block(x, y, z, w, h, d, { style: 'stone', ...o }); }

  // ------------------------------------------------------------------ decoration
  groundY(x, z, fromY = 200, what = '') {
    const g = this.ph.groundBelow(x, fromY, z, 400);
    if (!g && what) console.warn(`[level] no ground under ${what} at (${x}, ${z})`);
    return g ? g.y : null;
  }
  gy(x, z, what) { const y = this.groundY(x, z, 200, what || 'object'); return y ?? 0; }
  prop(type, x, y, z, o = {}) {
    if (y === null || y === undefined) { y = this.groundY(x, z, o.from ?? 200); if (y === null) return; }
    const info = PROP_INFO[type];
    if (!info) return;
    const parts = propParts(type, { seed: o.seed ?? Math.round(x * 3 + z * 7), color: o.color });
    const s = o.s ?? 1;
    this.lv.addPropParts(parts, x, y, z, o.yaw ?? 0, s);
    if (info.col > 0 && o.collide !== false) {
      this.col({ type: 'cyl', x, y: y + info.h * s * 0.5, z, hx: info.col * s, hy: info.h * s * 0.5, tag: 'prop', camBlock: info.h * s > 2.5 });
    }
  }
  // scatter decor on an island: big props near the rim, small ones anywhere, grass/flowers instanced
  decorate(x, y, z, r, o = {}) {
    const rng = new RNG(Math.round(x * 31 + z * 17 + r * 7) >>> 0);
    const D = this.decor;
    const density = o.density ?? 1;
    const nBig = o.big ?? Math.floor(r * 0.45 * density);
    const clear = o.clear || []; // [[x,z,r], ...] keep-out circles
    const ok = (px, pz, rad) => clear.every((c) => Math.hypot(px - c[0], pz - c[1]) > c[2] + rad);
    for (let i = 0; i < nBig; i++) {
      const a = rng.range(0, TAU), d = r * rng.range(0.72, 0.9);
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (!ok(px, pz, 1.5)) continue;
      const type = rng.pick(D.big);
      const color = D.treeColors ? rng.pick(D.treeColors) : undefined;
      this.prop(type, px, y, pz, { seed: rng.int(0, 99), yaw: rng.range(0, TAU), color, s: rng.range(0.85, 1.15) });
    }
    const nSmall = o.small ?? Math.floor(r * 0.9 * density);
    for (let i = 0; i < nSmall; i++) {
      const a = rng.range(0, TAU), d = r * Math.sqrt(rng.range(0.15, 0.85));
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (!ok(px, pz, 0.8)) continue;
      this.prop(rng.pick(D.small), px, y, pz, { seed: rng.int(0, 99), yaw: rng.range(0, TAU), s: rng.range(0.8, 1.2), collide: false });
    }
    if (o.grass !== false) this.grass(x, y, z, r * 0.92, Math.floor(r * r * 0.9 * density * (o.grassDensity ?? 1)), { flowers: o.flowers ?? 0.25 });
  }
  decorateRect(x, y, z, w, d, o = {}) {
    const rng = new RNG(Math.round(x * 13 + z * 29) >>> 0);
    const n = Math.floor(w * d * 0.6 * (o.grassDensity ?? 1));
    for (let i = 0; i < n; i++) {
      const px = x + rng.range(-w / 2 + 0.3, w / 2 - 0.3), pz = z + rng.range(-d / 2 + 0.3, d / 2 - 0.3);
      this._grassAt(px, y, pz, rng, o.flowers ?? 0.2);
    }
  }
  grass(x, y, z, r, n, o = {}) {
    if (this.themeName === 'toy' || this.themeName === 'moon' || this.themeName === 'snow') n = Math.floor(n * 0.35);
    const rng = new RNG(Math.round(x * 7 + z * 13 + n) >>> 0);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), d = r * Math.sqrt(rng.next());
      this._grassAt(x + Math.sin(a) * d, y, z + Math.cos(a) * d, rng, o.flowers ?? 0.25);
    }
  }
  _grassAt(px, y, pz, rng, flowerChance) {
    const gy = this.ph.groundBelow(px, y + 0.5, pz, 1.5);
    if (!gy) return;
    const flower = rng.next() < flowerChance;
    const tint = this.themeName === 'snow' ? [0.9, 0.95, 1.05] : this.themeName === 'canyon' ? [1.15, 0.95, 0.7] : this.themeName === 'moon' ? [0.9, 0.85, 1.15] : this.themeName === 'toy' ? [1.1, 0.85, 1.05] : this.themeName === 'jungle' ? [0.8, 1.0, 0.85] : null;
    this.lv.instGrass.push({ kind: flower ? 'f' : 'g', v: rng.int(0, 3), x: px, y: gy.y, z: pz, yaw: rng.range(0, TAU), s: rng.range(0.8, 1.25) * (flower ? 1 : 1.1), tint: flower ? null : tint });
  }

  // ------------------------------------------------------------------ gameplay objects
  _add(e, pre = false) { return pre ? this.lv.addPre(e) : this.lv.add(e); }
  checkpoint(x, y, z, o = {}) { return this._add(new Checkpoint(this.lv, x, y ?? this.gy(x, z, 'checkpoint'), z, { color: this.theme.restoreColor, ...o })); }
  puffy(idx, x, y, z, o = {}) {
    const rescued = !!(this.stage && this.stage.isPuffyRescued && this.stage.isPuffyRescued(idx));
    return this._add(new PuffyCage(this.lv, idx, x, y ?? this.gy(x, z, 'puffy ' + idx), z, { ...o, rescued }));
  }
  candy(x, y, z, o) { return this.pickups.candy(x, y, z, o); }
  candyLine(a, b, n, o) { return this.pickups.candyLine(a, b, n, o); }
  candyArc(a, b, n, h, o) { return this.pickups.candyArc(a, b, n, h, o); }
  candyRing(x, y, z, r, n, o) { return this.pickups.candyRing(x, y, z, r, n, o); }
  bigCandy(x, y, z, o) { return this.pickups.bigCandy(x, y, z, o); }
  heart(x, y, z, o) { return this.pickups.heart(x, y, z, o); }
  cookie(id, x, y, z, o) { return this.pickups.cookie(id, x, y, z, o); }
  key(id, x, y, z, o) { return this.pickups.key(id, x, y, z, o); }
  enemy(type, x, y, z, o = {}) {
    if (y === null || y === undefined) y = this.groundY(x, z, o.from ?? 200, 'enemy ' + type) ?? 0;
    return spawnEnemy(this.lv, type, x, y, z, { variant: o.variant ?? this.themeName, ...o });
  }
  // dynamic platforms (updated before player)
  mover(style, w, d, h, path, o = {}) { return this._add(new MovingPlatform(this.lv, style, w, d, h, path, o), true); }
  rotator(style, x, y, z, w, d, h, o = {}) { return this._add(new RotatingPlatform(this.lv, style, x, y, z, w, d, h, o), true); }
  falling(style, x, y, z, w, d, h = 0.5, o = {}) { return this._add(new FallingPlatform(this.lv, style, x, y, z, w, d, h, o), true); }
  blink(style, x, y, z, w, d, h = 0.5, o = {}) { return this._add(new BlinkPlatform(this.lv, style, x, y, z, w, d, h, o), true); }
  spring(x, y, z, o = {}) { return this._add(new Spring(this.lv, x, y ?? this.gy(x, z, 'object'), z, o)); }
  // hazards
  saw(path, o = {}) { return this._add(new Saw(this.lv, path, o)); }
  spikes(x, y, z, w, d, o = {}) { return this._add(new SpikeStrip(this.lv, x, y ?? this.gy(x, z, 'object'), z, w, d, o)); }
  spikeTrap(x, y, z, o = {}) { return this._add(new SpikeTrap(this.lv, x, y ?? this.gy(x, z, 'object'), z, o)); }
  crusher(x, z, top, bottom, o = {}) { return this._add(new Crusher(this.lv, x, z, top, bottom, o), true); }
  firebar(x, y, z, o = {}) { return this._add(new Firebar(this.lv, x, y, z, o)); }
  laser(x, y, z, yaw, o = {}) { return this._add(new Laser(this.lv, x, y, z, yaw, o)); }
  wind(x, y, z, hx, hy, hz, force, o = {}) { return this._add(new WindZone(this.lv, x, y, z, hx, hy, hz, force, o)); }
  roller(a, b, o = {}) { return this._add(new Roller(this.lv, a, b, o)); }
  dropper(x, y, z, o = {}) { return this._add(new Dropper(this.lv, x, y, z, o)); }
  goo(x, y, z, w, d) { return this._add(new FogGoo(this.lv, x, y, z, w, d)); }
  // puzzles & interactables
  floorSwitch(x, y, z, signal, o = {}) { return this._add(new FloorSwitch(this.lv, x, y ?? this.gy(x, z, 'object'), z, signal, o)); }
  crystal(x, y, z, signal, o = {}) { return this._add(new CrystalSwitch(this.lv, x, y ?? this.gy(x, z, 'object'), z, signal, o)); }
  gate(x, y, z, yaw, signal, o = {}) { return this._add(new Gate(this.lv, x, y ?? this.gy(x, z, 'object'), z, yaw, signal, o)); }
  door(x, y, z, yaw, keyId, o = {}) { return this._add(new LockDoor(this.lv, x, y ?? this.gy(x, z, 'object'), z, yaw, keyId, o)); }
  crate(x, y, z) { return this._add(new Crate(this.lv, x, y ?? this.gy(x, z, 'object'), z)); }
  rock(x, y, z, o = {}) { return this._add(new Breakable(this.lv, 'rock', x, y ?? this.gy(x, z, 'object'), z, o)); }
  breakCrate(x, y, z, o = {}) { return this._add(new Breakable(this.lv, 'crate', x, y ?? this.gy(x, z, 'object'), z, o)); }
  crackedFloor(x, y, z, o = {}) { return this._add(new Breakable(this.lv, 'floor', x, y, z, o)); }
  thorns(x, y, z, o = {}) { return this._add(new ElementBlock(this.lv, 'thorns', x, y ?? this.gy(x, z, 'object'), z, o)); }
  ice(x, y, z, o = {}) { return this._add(new ElementBlock(this.lv, 'ice', x, y ?? this.gy(x, z, 'object'), z, o)); }
  torch(x, y, z, signal, o = {}) { return this._add(new Torch(this.lv, x, y ?? this.gy(x, z, 'object'), z, signal, o)); }
  torchGroup(signal, torches) { return this._add(new TorchGroup(this.lv, signal, torches)); }
  seed(x, y, z, o = {}) { return this._add(new SeedSprout(this.lv, x, y ?? this.gy(x, z, 'object'), z, o)); }
  pinwheel(x, y, z, signal, o = {}) { return this._add(new Pinwheel(this.lv, x, y ?? this.gy(x, z, 'object'), z, signal, o)); }
  cannon(x, y, z, target, o = {}) { return this._add(new Cannon(this.lv, x, y ?? this.gy(x, z, 'object'), z, target, o)); }
  npc(kind, x, y, z, lines, o = {}) { return this._add(new Talker(this.lv, kind, x, y ?? this.gy(x, z, 'object'), z, lines, o)); }
  sign(x, y, z, lines, o = {}) { return this._add(new Talker(this.lv, 'sign', x, y ?? this.gy(x, z, 'object'), z, lines, o)); }
  grapple(x, y, z, o = {}) { return this._add(new GrapplePoint(this.lv, x, y, z, o)); }
  dig(x, y, z, reward, o = {}) { return this._add(new DigSpot(this.lv, x, y ?? this.gy(x, z, 'object'), z, reward, o)); }
  ghost(x, y, z, w, d, o = {}) { return this._add(new GhostPlatform(this.lv, x, y, z, w, d, o), true); }
  water(x, top, z, w, d, depth = 4, o = {}) { return this._add(new Water(this.lv, x, top, z, w, d, depth, o)); }
  dreamLight(x, y, z, color, onGet) { return this._add(new DreamLight(this.lv, x, y ?? this.gy(x, z, 'object'), z, color, onGet)); }
  petEvent(id, x, y, z, o = {}) { return new PetEvent(this.stage, this.lv, id, x, y ?? this.gy(x, z, 'object') + 0.9, z, o); }
  arena(x, y, z, r, o = {}) { return buildArena(this, x, y, z, r, o); }
  trigger(x, y, z, hx, hy, hz, onEnter, o = {}) { return this.ph.addTrigger({ x, y, z, hx, hy, hz, onEnter, once: o.once ?? true, onExit: o.onExit, onStay: o.onStay }); }
  freeze() { installFreeze(this.lv); }

  // ------------------------------------------------------------------ camera / misc
  start(x, y, z, yaw = 0) { this.lv.spawn.pos.set(x, y, z); this.lv.spawn.yaw = yaw; }
  camZone(x, y, z, hx, hy, hz, o) { this.lv.camZones.push({ x, y, z, hx, hy, hz, ...o }); }
  killY(y) { this.lv.killY = y; }
}
void Vec3; void rgb; void clamp;

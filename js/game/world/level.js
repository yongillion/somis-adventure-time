// ============================================================================
// level.js — a loaded stage: static batched geometry, physics, entities,
// hittables (things that react to attacks), secrets, camera zones.
// ============================================================================
import { Node, Mesh, InstancedMesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { Vec3, Mat4 } from '../../engine/math.js';
import { makeDetailTexture } from '../../engine/texgen.js';
import { PhysicsWorld } from './physics.js';
import { CTX } from '../ctx.js';
import { softGlowMaterial, grassGeo, flowerGeo } from '../models/props.js';

const TEX_FOR = {
  'top:grass': 'grass', 'top:sand': 'sand', 'top:snow': 'snow', 'top:stone': 'stone', 'top:cloud': 'cloud', 'top:candy': 'candy',
  'top:tiles': 'tiles', 'top:wood': 'wood', 'top:crystal': 'crystal', 'top:moon': 'crystal', 'top:metal': 'metal',
  'block:stone': 'stone', 'block:wood': 'wood', 'block:candy': 'candy', 'block:brick': 'brick', 'block:crystal': 'crystal',
  'block:metal': 'metal', 'block:tiles': 'tiles', 'block:cloud': 'cloud', 'block:ice': 'crystal', 'block:bark': 'bark', 'block:sand': 'sand', 'block:snow': 'snow',
};
const texCache = new Map();
function detailTex(kind) {
  let t = texCache.get(kind);
  if (!t) { t = makeDetailTexture(kind, 256, 3); texCache.set(kind, t); }
  return t;
}
const matCache = new Map();
export function staticMaterial(key) {
  let m = matCache.get(key);
  if (m) return m;
  if (key === 'side') m = new Material({ vertexColors: true, rim: 0.14, satField: true });
  else if (key === 'deco') m = new Material({ vertexColors: true, spec: 0.1, rim: 0.32, satField: true });
  else if (key === 'decoGlow') m = new Material({ vertexColors: true, unlit: true, rim: 0 });
  else if (key === 'halo') m = softGlowMaterial(0xffffff, { vertexColors: true });
  else if (key === 'water') m = new Material({ vertexColors: true, rim: 0.4, transparent: true, opacity: 0.8, satField: true });
  else {
    const tex = TEX_FOR[key] || 'stone';
    const shiny = key === 'block:ice' || key === 'block:crystal' || key === 'top:crystal' || key === 'block:candy' || key === 'top:candy';
    m = new Material({ vertexColors: true, map: detailTex(tex), rim: key.startsWith('top') ? 0.18 : 0.24, satField: true, spec: shiny ? 0.28 : 0 });
  }
  matCache.set(key, m);
  return m;
}

export class Level {
  constructor(def = {}) {
    this.def = def;
    this.root = new Node('level');
    this.physics = new PhysicsWorld();
    this.statics = new Map();
    this.entities = [];
    this.pre = []; // updated before the player (moving platforms)
    this.enemies = [];
    this.hittables = [];
    this.checkpoints = [];
    this.camZones = [];
    this.spawn = { pos: new Vec3(0, 2, 0), yaw: 0 };
    this.secrets = [];
    this.grapples = [];
    this.digSpots = [];
    this.lights = []; // dark-area light sources
    this.instGrass = [];
    this.time = 0;
    this.signals = new Map(); // channel -> {value, listeners}
    this.killY = def.killY ?? -26;
    this.darkZones = [];
    this.ghosts = [];
    this.windZones = [];
    this.boss = null;
  }
  // ------------------------------------------------------------------ statics
  addStatic(key, geo) {
    let arr = this.statics.get(key);
    if (!arr) { arr = []; this.statics.set(key, arr); }
    arr.push(geo);
  }
  addParts(parts) { for (const p of parts) this.addStatic(p.key, p.geo); }
  // add prop parts (from props.js propParts) at world transform
  addPropParts(parts, x, y, z, yaw = 0, s = 1) {
    const base = G.trs(x, y, z, 0, yaw, 0, s, s, s);
    for (const p of parts) {
      const m = p.matrix ? Mat4.multiply(Mat4.create(), base, p.matrix) : base;
      const g = p.geo.clone();
      g.applyMatrix(m);
      const key = p.kind === 'glow' ? (p.halo ? 'halo' : 'decoGlow') : 'deco';
      this.addStatic(key, g);
    }
  }
  // ------------------------------------------------------------------ entities
  add(e) { this.entities.push(e); if (e.node && !e.node.parent) this.root.add(e.node); return e; }
  addPre(e) { this.pre.push(e); if (e.node && !e.node.parent) this.root.add(e.node); return e; }
  remove(e) {
    let i = this.entities.indexOf(e); if (i >= 0) this.entities.splice(i, 1);
    i = this.pre.indexOf(e); if (i >= 0) this.pre.splice(i, 1);
    i = this.enemies.indexOf(e); if (i >= 0) this.enemies.splice(i, 1);
    if (e.node) e.node.removeFromParent();
  }
  addHittable(h) { this.hittables.push(h); return h; }
  removeHittable(h) { const i = this.hittables.indexOf(h); if (i >= 0) this.hittables.splice(i, 1); }
  // signals: switch/gate wiring
  signal(ch) {
    let s = this.signals.get(ch);
    if (!s) { s = { value: false, count: 0, listeners: [] }; this.signals.set(ch, s); }
    return s;
  }
  setSignal(ch, v) {
    const s = this.signal(ch);
    if (s.value === v) return;
    s.value = v;
    for (const l of s.listeners) l(v);
  }
  onSignal(ch, fn) { this.signal(ch).listeners.push(fn); }

  // ------------------------------------------------------------------ attacks
  // info: { dmg, tags:[], dir:{x,z}, kind:'melee'|'proj'|..., knock, from:'player'|'pet' }
  hit(x, y, z, r, info, already = null) {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive || (already && already.has(e))) continue;
      if (e.hurtTest(x, y, z, r)) {
        if (e.damage(info)) { n++; if (already) already.add(e); }
      }
    }
    for (const h of this.hittables) {
      if (h.enabled === false || (already && already.has(h))) continue;
      const p = h.pos;
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      const rr = r + (h.r ?? 0.5);
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      if (h.onHit(info) !== false) { n++; if (already) already.add(h); }
    }
    return n;
  }
  nearestEnemy(x, y, z, maxD = 10, filter = null) {
    let best = null, bd = maxD * maxD;
    for (const e of this.enemies) {
      if (!e.alive || e.friendly) continue;
      if (filter && !filter(e)) continue;
      const d = (e.pos.x - x) ** 2 + (e.pos.y + e.centerY - y) ** 2 + (e.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  // ------------------------------------------------------------------ finalize
  finalize(scene) {
    const CH = 48;
    for (const [key, geos] of this.statics) {
      const mat = staticMaterial(key);
      // chunk by XZ cell for frustum culling
      const chunks = new Map();
      for (const g of geos) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        const c = g.boundingSphere.center;
        const k = Math.floor(c.x / CH) + ',' + Math.floor(c.z / CH);
        let arr = chunks.get(k);
        if (!arr) { arr = []; chunks.set(k, arr); }
        arr.push(g);
      }
      for (const arr of chunks.values()) {
        // split very large chunks to stay below 65k vertices where possible
        let batch = [], verts = 0;
        const flush = () => {
          if (!batch.length) return;
          const merged = G.mergeGeometries(batch.map((geo) => ({ geo })), { withUV: !!mat.map });
          const m = new Mesh(merged, mat, 'static-' + key);
          m.matrixAutoUpdate = false;
          this.root.add(m);
          batch = []; verts = 0;
        };
        for (const g of arr) {
          if (verts + g.vertexCount > 60000) flush();
          batch.push(g); verts += g.vertexCount;
        }
        flush();
      }
    }
    this.statics.clear();
    // instanced grass/flowers
    if (this.instGrass.length) {
      const byKey = new Map();
      for (const it of this.instGrass) {
        const k = it.kind + it.v;
        let a = byKey.get(k);
        if (!a) { a = []; byKey.set(k, a); }
        a.push(it);
      }
      const gm = new Material({ vertexColors: true, rim: 0.2, wind: 0.12, satField: true });
      const fm = new Material({ vertexColors: true, rim: 0.25, wind: 0.1, satField: true, spec: 0.08 });
      for (const [k, arr] of byKey) {
        const it0 = arr[0];
        const geo = it0.kind === 'g' ? grassGeo(it0.v) : flowerGeo(it0.v);
        // chunk instances spatially too
        const chunks = new Map();
        for (const it of arr) {
          const ck = Math.floor(it.x / 32) + ',' + Math.floor(it.z / 32);
          let c = chunks.get(ck); if (!c) { c = []; chunks.set(ck, c); } c.push(it);
        }
        for (const list of chunks.values()) {
          const im = new InstancedMesh(geo, it0.kind === 'g' ? gm : fm, list.length, 'inst-' + k);
          list.forEach((it, i) => { im.setTransformAt(i, it.x, it.y, it.z, 0, it.yaw, 0, it.s); if (it.tint) im.setColorAt(i, it.tint[0], it.tint[1], it.tint[2], 1); });
          im.count = list.length;
          im.matrixAutoUpdate = false;
          this.root.add(im);
        }
      }
      this.instGrass.length = 0;
    }
    this.root.traverse((n) => { if (!n.matrixAutoUpdate) { n.updateMatrix(); } });
    this.physics._rebuild();
    scene.add(this.root);
  }

  // ------------------------------------------------------------------ update
  updatePre(dt) {
    this.time += dt;
    for (let i = 0; i < this.pre.length; i++) this.pre[i].update(dt);
  }
  update(dt) {
    const E = this.entities;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.dead) { this.remove(e); i--; continue; }
      e.update(dt);
    }
  }
  dispose() {
    for (const e of [...this.entities, ...this.pre]) if (e.dispose) e.dispose();
    this.root.removeFromParent();
    this.physics.clear();
    if (CTX.renderer) CTX.renderer.releaseTree(this.root);
  }
}

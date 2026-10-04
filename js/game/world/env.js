// ============================================================================
// env.js — stage environment themes: sky, lighting, fog, cloud sea,
// ambient particles, distant floating islands; saturation (color restore).
// ============================================================================
import { Mesh, Node, InstancedMesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { rgb, Vec3, lerp, clamp, TAU, RNG, mixColor } from '../../engine/math.js';
import { TILE } from '../../engine/texgen.js';
import { CTX } from '../ctx.js';

const C = (h) => rgb(h);

export const THEMES = {
  meadow: {
    sky: { zenith: 0x6fb2ff, horizon: 0xffe2f0, bottom: 0xf6e6ff, exp: 0.55, swirl: 0.6, stars: 0, sunGlow: 0xfff0c8, sunSize: 0.0035 },
    sun: [0.45, 0.75, 0.35], sunColor: 0xfff6e8, skyLight: 0xcde0ff, groundLight: 0xd8c4b0, shade: 0xc0b8e8, rim: 0xffffff,
    fog: 0xf6e6f6, fogNear: 45, fogFar: 170, hfog: [-6, -34],
    sea: { color: 0xfff8fc, shadow: 0xe6d8f0, y: -36 },
    ground: { grass: 0x8ee07a, grass2: 0xb0ec8a, earth: 0xc99a72, rock: 0xc4b2a8, rim: 0x6fcf6a },
    particles: 'petals', petalColors: [0xffb3d1, 0xfff0a8, 0xffffff, 0xd8b8ff],
    restoreColor: 0xff6b8a, music: 'meadow', distantIslands: 0x9ad88a,
  },
  canyon: {
    sky: { zenith: 0x6676d8, horizon: 0xffb27a, bottom: 0xffd2b0, exp: 0.5, swirl: 0.55, stars: 0.15, sunGlow: 0xffc890, sunSize: 0.006 },
    sun: [-0.55, 0.42, 0.3], sunColor: 0xffe2c0, skyLight: 0xd8c4f0, groundLight: 0xe8b890, shade: 0xc8a8d8, rim: 0xffe0c0,
    fog: 0xffd0b4, fogNear: 45, fogFar: 165, hfog: [-6, -34],
    sea: { color: 0xffe4d0, shadow: 0xf0b8a8, y: -36 },
    ground: { grass: 0xf2c88a, grass2: 0xffd8a0, earth: 0xe08a5c, rock: 0xd87a58, rim: 0xe0a870 },
    particles: 'dust', petalColors: [0xffb070, 0xffd890, 0xff9a7a],
    restoreColor: 0xff9a3a, music: 'canyon', distantIslands: 0xe89a70,
  },
  honey: {
    sky: { zenith: 0x7ac6ff, horizon: 0xfff4b8, bottom: 0xfff4d8, exp: 0.6, swirl: 0.5, stars: 0, sunGlow: 0xfff0a0, sunSize: 0.004 },
    sun: [0.3, 0.8, 0.45], sunColor: 0xfff8d8, skyLight: 0xd8ecff, groundLight: 0xe8d898, shade: 0xc8c0e0, rim: 0xffffe0,
    fog: 0xfff4d0, fogNear: 45, fogFar: 170, hfog: [-6, -34],
    sea: { color: 0xfffbe8, shadow: 0xf4e4b0, y: -36 },
    ground: { grass: 0xb8e86a, grass2: 0xd4f080, earth: 0xd8a868, rock: 0xd8c098, rim: 0x9ad860 },
    particles: 'pollen', petalColors: [0xffe84a, 0xffffff, 0xffc84a],
    restoreColor: 0xffd84a, music: 'honey', distantIslands: 0xc8e070,
  },
  jungle: {
    sky: { zenith: 0x24486e, horizon: 0x8ad8b4, bottom: 0x5a9a8a, exp: 0.6, swirl: 0.65, stars: 0.4, sunGlow: 0xd0ffd8, sunSize: 0.003 },
    sun: [0.35, 0.65, -0.5], sunColor: 0xe0ffe8, skyLight: 0x9ad8c8, groundLight: 0x6a9a70, shade: 0x8aa8c8, rim: 0xd0ffe0,
    fog: 0x6ab89a, fogNear: 35, fogFar: 140, hfog: [-6, -30],
    sea: { color: 0xa8e0c8, shadow: 0x6aa898, y: -34 },
    ground: { grass: 0x5cc86a, grass2: 0x7ad87a, earth: 0x8a6a4a, rock: 0x8a9a88, rim: 0x48b058 },
    particles: 'fireflies', petalColors: [0xd8ff6a, 0xa8ffb0, 0xffffa0],
    restoreColor: 0x5fd86a, music: 'jungle', distantIslands: 0x4a9a6a,
  },
  sea: {
    sky: { zenith: 0x3a9aff, horizon: 0xc8f4ff, bottom: 0x9ad8f0, exp: 0.55, swirl: 0.45, stars: 0, sunGlow: 0xffffff, sunSize: 0.004 },
    sun: [0.4, 0.78, 0.3], sunColor: 0xfffcf0, skyLight: 0xc8e8ff, groundLight: 0xe8e0c0, shade: 0xa8c0e8, rim: 0xe8ffff,
    fog: 0xc8eeff, fogNear: 50, fogFar: 180, hfog: [-6, -30],
    sea: { color: 0x7ad8f0, shadow: 0x3aa8d8, y: -2.2, water: true },
    ground: { grass: 0xfff0c8, grass2: 0xfff8d8, earth: 0xe8c890, rock: 0xb8c8d0, rim: 0xffe8b0 },
    particles: 'bubbles', petalColors: [0xffffff, 0xbfefff, 0x8fe8ff],
    restoreColor: 0x4aa8ff, music: 'sea', distantIslands: 0x8ad0a0,
  },
  snow: {
    sky: { zenith: 0x141a48, horizon: 0x6a78d0, bottom: 0x3a3a80, exp: 0.5, swirl: 0.4, stars: 1.0, sunGlow: 0xc8d8ff, sunSize: 0.004, aurora: 1.0, aurora1: 0x5affb0, aurora2: 0xa86aff },
    sun: [-0.3, 0.7, 0.45], sunColor: 0xe0e8ff, skyLight: 0xa8b8ff, groundLight: 0x8890c8, shade: 0x9aa0e0, rim: 0xd8e8ff,
    fog: 0x5a64b8, fogNear: 45, fogFar: 160, hfog: [-6, -32],
    sea: { color: 0x9aa8e8, shadow: 0x5a64a8, y: -36 },
    ground: { grass: 0xf4f8ff, grass2: 0xe8f0ff, earth: 0x9aa8d8, rock: 0xa8b0d0, rim: 0xffffff },
    particles: 'snow', petalColors: [0xffffff, 0xd8e8ff],
    restoreColor: 0x6a6aff, music: 'snow', distantIslands: 0xd0d8ff,
  },
  toy: {
    sky: { zenith: 0x5a3aa0, horizon: 0xffb8e0, bottom: 0xd8a8f0, exp: 0.5, swirl: 0.7, stars: 0.5, sunGlow: 0xffd8f0, sunSize: 0.005 },
    sun: [0.5, 0.6, 0.4], sunColor: 0xfff0f8, skyLight: 0xe0c8ff, groundLight: 0xd0a8d8, shade: 0xb8a0e8, rim: 0xffe8ff,
    fog: 0xe0b8ec, fogNear: 45, fogFar: 160, hfog: [-6, -32],
    sea: { color: 0xf4d8ff, shadow: 0xc8a0e0, y: -36 },
    ground: { grass: 0xffd0e8, grass2: 0xffe4f0, earth: 0xb890d8, rock: 0xc8b0e0, rim: 0xffb8dc },
    particles: 'confetti', petalColors: [0xff8fc4, 0x8fd8ff, 0xffe36b, 0x8ff0a8, 0xc8a0ff],
    restoreColor: 0xb06aff, music: 'toy', distantIslands: 0xd8a8f0,
  },
  moon: {
    sky: { zenith: 0x080a26, horizon: 0x3a2a72, bottom: 0x1a1440, exp: 0.45, swirl: 0.8, stars: 1.4, sunGlow: 0xfff8e0, sunSize: 0.012, aurora: 0.35, aurora1: 0xff9af0, aurora2: 0x8ad8ff },
    sun: [0.25, 0.62, -0.75], sunColor: 0xe8e8ff, skyLight: 0x9a9ae0, groundLight: 0x6a5aa8, shade: 0x9088d8, rim: 0xf0e8ff,
    fog: 0x2a2060, fogNear: 45, fogFar: 160, hfog: [-6, -32],
    sea: { color: 0x6a5aa8, shadow: 0x2a2060, y: -36 },
    ground: { grass: 0xe8e4ff, grass2: 0xf4f0ff, earth: 0x8a80c8, rock: 0xa8a0d8, rim: 0xd8d0ff },
    particles: 'motes', petalColors: [0xffffff, 0xffe8a8, 0xd8c8ff, 0xffc8f0],
    restoreColor: 0xfff8e8, music: 'moon', distantIslands: 0x9a90d8,
  },
  // non-stage scenes
  title: null, map: null, room: null,
};
THEMES.title = { ...THEMES.meadow, sky: { ...THEMES.meadow.sky, zenith: 0x7a9aff, horizon: 0xffd6ec, swirl: 0.9, stars: 0.25 }, particles: 'motes', music: 'title' };
THEMES.map = { ...THEMES.meadow, sky: { ...THEMES.meadow.sky, zenith: 0x8aa8ff, horizon: 0xffe8f4, swirl: 0.8 }, particles: 'motes', music: 'map' };
THEMES.room = {
  ...THEMES.moon, fog: 0x1a1a40, fogNear: 30, fogFar: 120, particles: 'none', music: 'opening',
  sky: { ...THEMES.moon.sky, swirl: 0.3 },
};

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.root = new Node('env');
    scene.add(this.root);
    this.theme = null;
    this.ambientT = 0;
    this.spots = []; // saturation restore spots {x,y,z,r,target,cur}
    this.baseSat = 1; this.baseSatTarget = 1;
    this.skySat = 1; this.skySatTarget = 1;
    this.followPos = new Vec3();
  }
  clear() {
    this.root.clearChildren();
    this.spots.length = 0;
    this.sea = null;
  }
  apply(themeName, opts = {}) {
    this.clear();
    const T = typeof themeName === 'string' ? THEMES[themeName] : themeName;
    this.theme = T;
    const R = CTX.renderer, g = R.globals;
    const sky = T.sky;
    this.scene.sky = {
      uniforms: {
        uZenith: C(sky.zenith), uHorizon: C(sky.horizon), uBottom: C(sky.bottom), uSkyExp: sky.exp ?? 0.55,
        uSunGlow: C(sky.sunGlow ?? 0xfff0c8), uSunSize: sky.sunSize ?? 0.004, uStars: sky.stars ?? 0,
        uAurora: sky.aurora ?? 0, uAurora1: C(sky.aurora1 ?? 0x5affb0), uAurora2: C(sky.aurora2 ?? 0xa86aff), uSwirl: sky.swirl ?? 0.5,
      },
    };
    const sd = new Vec3(T.sun[0], T.sun[1], T.sun[2]).normalize();
    g.uSunDir.set([sd.x, sd.y, sd.z]);
    g.uSunColor.set(C(T.sunColor));
    g.uSkyColor.set(C(T.skyLight));
    g.uGroundColor.set(C(T.groundLight));
    g.uShadeTint.set(C(T.shade));
    g.uRimColor.set(C(T.rim));
    g.uFogColor.set(C(T.fog));
    g.uFog.set([T.fogNear, T.fogFar, T.hfog[0], T.hfog[1]]);
    R.clearColor = C(sky.horizon);
    R.touchGlobals();
    // saturation
    this.baseSat = this.baseSatTarget = opts.sat ?? 1;
    this.skySat = this.skySatTarget = opts.skySat ?? Math.max(0.45, this.baseSat);
    // cloud sea / ocean
    if (T.sea && opts.sea !== false) this._buildSea(T.sea);
    if (opts.distant !== false) this._buildDistant(T, opts.distantSeed || 7, opts.center || new Vec3());
    this.particleKind = opts.particles ?? T.particles;
    this.particleRate = opts.particleRate ?? 1;
    this.updateGlobals();
  }
  _buildSea(s) {
    if (s.water) {
      const m = new Mesh(G.planeGeo(900, 900, 80, 80), new Material({
        shader: 'water', color: s.color, transparent: true, opacity: 0.86, depthWrite: true,
        uniforms: { uDeep: C(s.shadow), uWaveAmp: 0.18 }, satField: true, fog: true,
      }));
      m.position.y = s.y; m.frustumCulled = false; m.renderOrder = 2;
      this.root.add(m);
      this.sea = m;
      // deep floor below so it's not see-through to sky
      const floor = new Mesh(G.planeGeo(900, 900, 1, 1), new Material({ color: s.shadow, unlit: true, fog: true }));
      floor.position.y = s.y - 14; floor.frustumCulled = false;
      this.root.add(floor);
    } else {
      const m = new Mesh(G.planeGeo(1400, 1400, 1, 1), new Material({ shader: 'cloudsea', color: s.color, uniforms: { uShadow: C(s.shadow) }, fog: false }));
      m.position.y = s.y; m.frustumCulled = false;
      this.root.add(m);
      this.sea = m;
    }
  }
  rebuildDistant(center, minR = 150, seed = 7) {
    if (this.distant) this.distant.removeFromParent();
    this._buildDistant(this.theme, seed, center, minR);
  }
  _buildDistant(T, seed, center, minR = 150) {
    // ring of far floating islands (silhouettes softened by fog)
    const rng = new RNG(seed);
    const col = C(T.distantIslands ?? 0xa8c8a0);
    const earth = C(T.ground.earth);
    const items = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rng.range(-0.15, 0.15);
      const d = rng.range(minR, minR + 80);
      const r = rng.range(8, 22);
      const y = rng.range(-14, 26);
      const top = G.cylinderGeo(r, r * 0.92, r * 0.18, 18, 1, true);
      items.push({ geo: top, matrix: G.trs(center.x + Math.sin(a) * d, y, center.z + Math.cos(a) * d), color: col });
      const under = G.coneGeo(r * 0.9, r * 1.4, 14, false);
      items.push({ geo: under, matrix: G.trs(center.x + Math.sin(a) * d, y - r * 0.78, center.z + Math.cos(a) * d, Math.PI, 0, 0), color: earth });
      // little tree blobs
      for (let k = 0; k < 3; k++) {
        const bx = rng.range(-r * 0.6, r * 0.6), bz = rng.range(-r * 0.6, r * 0.6), br = rng.range(r * 0.12, r * 0.22);
        items.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(center.x + Math.sin(a) * d + bx, y + br * 0.9, center.z + Math.cos(a) * d + bz, 0, 0, 0, br, br, br), color: col.map((v) => Math.min(1, v * 1.08)) });
      }
    }
    const geo = G.mergeGeometries(items, { withUV: false });
    const m = new Mesh(geo, new Material({ color: 0xffffff, vertexColors: true, rim: 0.3, satField: false, fog: true }));
    m.frustumCulled = false;
    this.root.add(m);
    this.distant = m;
  }

  // ------------------------------------------------------------------ saturation (GRIS-like color return)
  addSpot(x, y, z, r, instant = false) {
    const s = { x, y, z, r, cur: instant ? r : 0 };
    this.spots.push(s);
    return s;
  }
  setBaseSat(v, instant = false) { this.baseSatTarget = v; if (instant) this.baseSat = v; }
  setSkySat(v, instant = false) { this.skySatTarget = v; if (instant) this.skySat = v; }
  updateGlobals() {
    const g = CTX.renderer.globals;
    g.uBaseSat = this.baseSat;
    g.uSkySat = this.skySat;
    // pick the 8 spots nearest to the camera focus
    const arr = g.uSatSpots;
    arr.fill(0);
    const f = this.followPos;
    const list = this.spots.length > 8 ? this.spots.slice().sort((a, b) => ((a.x - f.x) ** 2 + (a.z - f.z) ** 2) - ((b.x - f.x) ** 2 + (b.z - f.z) ** 2)).slice(0, 8) : this.spots;
    list.forEach((s, i) => { arr[i * 4] = s.x; arr[i * 4 + 1] = s.y; arr[i * 4 + 2] = s.z; arr[i * 4 + 3] = s.cur; });
    CTX.renderer.touchGlobals();
  }

  update(dt, focus, camera) {
    this.ambientT += dt;
    if (focus) this.followPos.copy(focus);
    this.baseSat += (this.baseSatTarget - this.baseSat) * (1 - Math.exp(-1.2 * dt));
    this.skySat += (this.skySatTarget - this.skySat) * (1 - Math.exp(-1.0 * dt));
    for (const s of this.spots) if (s.cur < s.r) s.cur = Math.min(s.r, s.cur + dt * Math.max(8, s.r * 0.55));
    this.updateGlobals();
    if (this.sea && this.sea.material.shader !== 'water' && focus) { this.sea.position.x = focus.x; this.sea.position.z = focus.z; }
    if (this.distant && focus) { /* distant islands are static around the stage center */ }
    this._ambient(dt, focus, camera);
  }
  _ambient(dt, focus, camera) {
    if (!focus || !CTX.particles || this.particleKind === 'none') return;
    const P = CTX.particles;
    const T = this.theme;
    const cols = (T.petalColors || [0xffffff]).map(C);
    this._acc = (this._acc || 0) + dt * this.particleRate * (CTX.lowSpec ? 0.5 : 1);
    const k = this.particleKind;
    const rate = { petals: 6, dust: 5, pollen: 7, fireflies: 5, bubbles: 4, snow: 18, confetti: 5, motes: 7 }[k] || 4;
    while (this._acc > 1 / rate) {
      this._acc -= 1 / rate;
      const a = Math.random() * TAU, d = 2 + Math.random() * 16;
      const pos = { x: focus.x + Math.sin(a) * d, y: focus.y + (Math.random() * 8 - 1), z: focus.z + Math.cos(a) * d };
      switch (k) {
        case 'petals': P.emit({ pos, count: 1, dir: { x: 0.6, y: -0.3, z: 0.2 }, spread: 0.4, speed: [0.8, 1.6], life: [4, 6], size: [0.12, 0.2], sizeEnd: 1, colors: cols, alpha: 0.95, fadeIn: 0.1, tile: TILE.PETAL, spin: [1, 3], wobble: 1.5 }); break;
        case 'dust': P.emit({ pos, count: 1, dir: { x: 1, y: 0.1, z: 0.3 }, spread: 0.3, speed: [0.6, 1.2], life: [3, 5], size: [0.08, 0.14], sizeEnd: 1, colors: cols, alpha: 0.7, fadeIn: 0.2, tile: TILE.LEAF, spin: [1, 3], wobble: 1 }); break;
        case 'pollen': P.emit({ pos, count: 1, speed: [0.1, 0.4], life: [3, 5], size: [0.06, 0.12], sizeEnd: 1, colors: cols, alpha: 1, fadeIn: 0.3, tile: TILE.SPARKLE, additive: true, wobble: 1.5, gravity: -0.05 }); break;
        case 'fireflies': P.emit({ pos: { x: pos.x, y: focus.y + Math.random() * 4, z: pos.z }, count: 1, speed: [0.2, 0.5], life: [3, 5], size: [0.12, 0.2], sizeEnd: 0.6, colors: cols, alpha: 1, fadeIn: 0.3, tile: TILE.GLOW, additive: true, wobble: 2.5 }); break;
        case 'bubbles': P.emit({ pos: { x: pos.x, y: focus.y - 1 + Math.random() * 3, z: pos.z }, count: 1, upBias: 1, speed: [0.3, 0.7], life: [3, 5], size: [0.08, 0.18], sizeEnd: 1.1, colors: cols, alpha: 0.75, fadeIn: 0.2, tile: TILE.RING, gravity: -0.2, wobble: 1.5 }); break;
        case 'snow': P.emit({ pos: { x: pos.x, y: focus.y + 5 + Math.random() * 5, z: pos.z }, count: 1, dir: { x: 0.2, y: -1, z: 0.1 }, spread: 0.2, speed: [0.8, 1.4], life: [5, 7], size: [0.06, 0.13], sizeEnd: 1, colors: cols, alpha: 0.95, fadeIn: 0.1, tile: TILE.SNOW, spin: [0.5, 2], wobble: 1.2 }); break;
        case 'confetti': P.emit({ pos: { x: pos.x, y: focus.y + 4 + Math.random() * 4, z: pos.z }, count: 1, dir: { x: 0, y: -1, z: 0 }, spread: 0.3, speed: [0.5, 1], life: [4, 6], size: [0.08, 0.13], sizeEnd: 1, colors: cols, alpha: 0.95, fadeIn: 0.1, tile: [TILE.CONFETTI, TILE.STAR], spin: [2, 5], wobble: 1.5 }); break;
        case 'motes': P.emit({ pos, count: 1, speed: [0.05, 0.3], life: [3, 6], size: [0.06, 0.14], sizeEnd: 0.5, colors: cols, alpha: 1, fadeIn: 0.35, tile: TILE.SPARKLE, additive: true, wobble: 1, gravity: -0.08 }); break;
        default: break;
      }
    }
  }
}
void InstancedMesh; void lerp; void clamp; void mixColor;

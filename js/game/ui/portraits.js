// ============================================================================
// portraits.js — render character/pet/NPC portraits from the 3D models into
// data-URL images for menus, HUD and dialogs (cached).
// ============================================================================
import { Scene, Camera } from '../../engine/scene.js';
import { CTX } from '../ctx.js';
import { buildAnimal } from '../models/animals.js';
import { buildPet } from '../models/pets.js';
import { buildPuffy, buildWhale, buildNoa } from '../models/npcs.js';
import { buildSomiGirl } from '../models/somi.js';
import { buildBoss } from '../models/bosses.js';

const cache = new Map();
let canvas = null;

const LIGHT = {
  uSunDir: [0.35, 0.7, 0.62], uSunColor: [1, 0.98, 0.94], uSkyColor: [0.85, 0.9, 1], uGroundColor: [0.75, 0.68, 0.72],
  uShadeTint: [0.82, 0.78, 0.95], uRimColor: [1, 1, 1], uFogColor: [1, 1, 1], uFog: [1000, 2000, -1000, -2000],
};

function withPortraitLighting(fn) {
  const g = CTX.renderer.globals;
  const saved = {};
  for (const k in LIGHT) { saved[k] = Array.from(g[k]); g[k].set(LIGHT[k]); }
  const sat = g.uBaseSat; g.uBaseSat = 1;
  CTX.renderer.touchGlobals();
  try { return fn(); } finally {
    for (const k in saved) g[k].set(saved[k]);
    g.uBaseSat = sat;
    CTX.renderer.touchGlobals();
  }
}

function render(build, camSetup, key, size = 160, update = null) {
  if (cache.has(key)) return cache.get(key);
  const R = CTX.renderer;
  const scene = new Scene();
  const obj = build();
  const node = obj.root || obj;
  scene.add(node);
  if (update) update(obj);
  const cam = new Camera(camSetup.fov ?? 30, 0.05, 50);
  cam.position.set(...camSetup.pos);
  cam.target.set(...camSetup.target);
  const S = size * 2;
  const img = withPortraitLighting(() => R.renderToImageData(scene, cam, S, S));
  if (!canvas) canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(img.data, S, S), 0, 0);
  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  const o = out.getContext('2d');
  o.imageSmoothingQuality = 'high';
  o.drawImage(canvas, 0, 0, size, size);
  const url = out.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function charPortrait(id, mode = 'face') {
  return render(() => buildAnimal(id), mode === 'face'
    ? { pos: [0.55, 1.05, 2.3], target: [0, 0.82, 0], fov: 28 }
    : { pos: [0.9, 1.0, 3.4], target: [0, 0.62, 0], fov: 30 }, 'char:' + id + ':' + mode, mode === 'face' ? 160 : 220,
  (rig) => { for (let i = 0; i < 3; i++) rig.update(0.016, { anim: 'idle', t: 0, speed: 0 }); });
}
export function petPortrait(id) {
  return render(() => buildPet(id), { pos: [0.35, 0.12, 1.15], target: [0, 0, 0], fov: 30 }, 'pet:' + id, 140,
    (p) => { for (let i = 0; i < 3; i++) p.update(0.016, { anim: 'idle', t: 0.4, speed: 0 }); });
}
export function npcPortrait(kind) {
  if (kind === 'somi') return render(() => buildSomiGirl(), { pos: [0.4, 1.05, 2.2], target: [0, 0.85, 0], fov: 28 }, 'npc:somi', 160, (r) => r.update(0.016, { anim: 'idle', t: 0 }));
  if (kind === 'whale') return render(() => buildWhale(), { pos: [2.4, 1.0, 8.6], target: [0.35, 0.45, 2.6], fov: 30 }, 'npc:whale2', 160, (r) => r.update(0.016, { anim: 'idle', t: 0 }));
  if (kind === 'noa') return render(() => buildNoa(), { pos: [0, 0.45, 1.6], target: [0, 0.36, 0], fov: 30 }, 'npc:noa', 160, (r) => r.update(0.016, { anim: 'idle', t: 0 }));
  if (kind === 'noaGray') return render(() => { const n = buildNoa(); n.setGray(1); return n; }, { pos: [0, 0.45, 1.6], target: [0, 0.36, 0], fov: 30 }, 'npc:noaGray', 160, (r) => r.update(0.016, { anim: 'cry', t: 0 }));
  if (kind.startsWith('puffy')) { const i = +kind.slice(5) || 0; return render(() => buildPuffy(i), { pos: [0, 0.35, 1.5], target: [0, 0.26, 0], fov: 30 }, 'npc:' + kind, 140, (r) => r.update(0.016, { anim: 'idle', t: 0 })); }
  if (kind.startsWith('bossfog:')) {
    const id = kind.slice(8);
    return render(() => { const b = buildBoss(id); b.setPurified(0); return b; }, { pos: [3, 2.6, 7.5], target: [0, 1.8, 0], fov: 34 }, 'npc:' + kind, 160, (b) => b.update(0.016, { anim: 'idle', t: 1 }));
  }
  if (kind.startsWith('boss:')) {
    const id = kind.slice(5);
    return render(() => { const b = buildBoss(id); b.setPurified(1); return b; }, { pos: [3, 2.6, 7.5], target: [0, 1.8, 0], fov: 34 }, 'npc:' + kind, 160, (b) => b.update(0.016, { anim: 'defeated', t: 1 }));
  }
  return '';
}

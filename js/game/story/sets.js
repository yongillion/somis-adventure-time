// ============================================================================
// sets.js — standalone 3D sets for cutscenes: Somi's bedroom (night / dawn),
// the memory sky (Noa's story), the ending sky flight.
// Each builder returns { update(dt), dispose(), focus, ...actors }.
// ============================================================================
import { Vec3, TAU, rgb, lerp } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { Level } from '../world/level.js';
import { LevelBuilder } from '../world/builder.js';
import { THEMES } from '../world/env.js';
import { buildAnimal } from '../models/animals.js';
import { buildSomiGirl } from '../models/somi.js';
import { buildWhale, buildNoa, buildPuffy } from '../models/npcs.js';
import { MGlow, MU } from '../models/common.js';
import { softGlowMaterial } from '../models/props.js';

export const DAWN = {
  ...THEMES.meadow,
  sky: { zenith: 0x8cc4ff, horizon: 0xffd0c4, bottom: 0xffe6da, exp: 0.5, swirl: 0.35, stars: 0.12, sunGlow: 0x806050, sunSize: 0 },
  sun: [0.45, 0.6, 0.65], sunColor: 0xfff0e4, skyLight: 0xdcd8ff, groundLight: 0xf0d8c8, shade: 0xc8b8e8, rim: 0xffffff,
  fog: 0xffe4e0, fogNear: 60, fogFar: 200, particles: 'none',
};
export const NIGHT_ROOM = {
  ...THEMES.room,
  sky: { ...THEMES.moon.sky, swirl: 0.45, stars: 1.6, aurora: 0.25, sunSize: 0, sunGlow: 0x2a2450 },
  sun: [0.25, 0.55, -0.8], sunColor: 0xf4ecff, skyLight: 0xb8b0f0, groundLight: 0x9a88c8, shade: 0xa8a0e0, rim: 0xfff0ff,
  fog: 0x241c58, fogNear: 40, fogFar: 160,
};
export const MEMORY_SKY = {
  ...THEMES.moon,
  sky: { zenith: 0x0a0c30, horizon: 0x40307a, bottom: 0x1c1648, exp: 0.5, swirl: 0.9, stars: 1.8, sunGlow: 0xfff0d8, sunSize: 0.0, aurora: 0.5, aurora1: 0xffa8e8, aurora2: 0x8ad8ff },
  particles: 'motes', fog: 0x2a2266, fogNear: 50, fogFar: 180,
};

const SHADOW = (x, y, z, s, a = 0.32) => CTX.shadows.push(x, y + 0.02, z, s, 0.16, 0.1, 0.3, a, 0, 14);

function glowBall(parent, color, r, pos, halo = 2.6) {
  const n = new Node('glowball');
  n.position.set(...pos);
  const core = new Mesh(G.UNIT.sphere(), MU(color));
  core.scale.set(r, r, r);
  const h = new Mesh(G.UNIT.sphere(), softGlowMaterial(color, { opacity: 0.85, rim: 1.4 }));
  h.scale.set(r * halo, r * halo, r * halo);
  n.add(core, h);
  parent.add(n);
  n.userData.halo = h;
  return n;
}

// ------------------------------------------------------------------ Somi's bedroom
export function buildRoom(o = {}) {
  const morning = !!o.morning;
  const level = new Level({ killY: -100 });
  CTX.level = level; CTX.physics = level.physics;
  CTX.env.apply(morning ? DAWN : NIGHT_ROOM, { sat: 1, skySat: 1, particles: 'none', sea: false, distant: false });
  const L = new LevelBuilder(level, 'moon');
  const WALL = { style: 'tiles', color: morning ? 0xfff0f8 : 0xf6e0ff, color2: morning ? 0xffe6f2 : 0xeed4fa, round: 0.03 };
  const WOOD = { style: 'wood', color: 0xffd2a6, color2: 0xf2bb8a, round: 0.06 };
  // floor / walls / ceiling (window hole in the back wall: x -0.4..2.0, y 1.0..3.0)
  L.block(0, 0, 0, 9.4, 0.4, 7.8, { style: 'wood', color: 0xf0c294, color2: 0xe0a978, round: 0.03, uvScale: 0.7 });
  L.block(-2.5, 4.4, -3.75, 4.2, 4.4, 0.25, WALL);
  L.block(3.3, 4.4, -3.75, 2.6, 4.4, 0.25, WALL);
  L.block(0.8, 1.0, -3.75, 2.4, 1.0, 0.25, WALL);
  L.block(0.8, 4.4, -3.75, 2.4, 1.4, 0.25, WALL);
  L.block(-4.75, 4.4, 0, 0.25, 4.4, 7.8, WALL);
  L.block(4.75, 4.4, 0, 0.25, 4.4, 7.8, WALL);
  L.block(0, 4.65, 0, 9.8, 0.25, 8.0, { style: 'tiles', color: morning ? 0xfff6fb : 0xf2e6ff, round: 0.02 });
  // skirting boards
  L.block(-2.5, 0.22, -3.58, 4.2, 0.2, 0.08, WOOD);
  L.block(-4.58, 0.22, 0, 0.08, 0.2, 7.6, WOOD);
  L.block(4.58, 0.22, 0, 0.08, 0.2, 7.6, WOOD);
  // window frame + sill
  L.block(-0.47, 3.1, -3.6, 0.16, 2.2, 0.36, WOOD);
  L.block(2.07, 3.1, -3.6, 0.16, 2.2, 0.36, WOOD);
  L.block(0.8, 3.12, -3.6, 2.7, 0.16, 0.36, WOOD);
  L.block(0.8, 1.04, -3.45, 2.9, 0.12, 0.6, WOOD);
  // curtains
  const CUR = { style: 'cloud', color: morning ? 0xffc6dc : 0xff9ec8, color2: morning ? 0xffd6e6 : 0xffb6d4, round: 0.08 };
  L.block(-0.9, 3.35, -3.42, 0.62, 2.9, 0.2, CUR);
  L.block(2.5, 3.35, -3.42, 0.62, 2.9, 0.2, CUR);
  L.block(0.8, 3.55, -3.42, 3.9, 0.3, 0.24, { ...CUR, color: 0xffd0e4 });
  // bed
  L.block(-3.3, 0.5, 0.6, 2.4, 0.5, 3.8, { ...WOOD, color: 0xffc89e });
  L.block(-3.3, 1.65, -1.27, 2.4, 1.65, 0.22, { ...WOOD, color: 0xffb98a, round: 0.1 });
  L.block(-3.3, 1.0, 2.47, 2.4, 1.0, 0.18, { ...WOOD, color: 0xffb98a, round: 0.08 });
  L.block(-3.3, 0.8, 0.6, 2.2, 0.3, 3.6, { style: 'cloud', color: 0xffffff, color2: 0xf6f2ff, round: 0.12 });
  L.block(-3.3, 0.9, 1.25, 2.32, 0.14, 2.3, { style: 'candy', color: 0xffa6cc, color2: 0xffbcd8, round: 0.06 });
  L.block(-3.3, 1.02, -0.62, 1.5, 0.26, 0.72, { style: 'cloud', color: 0xfff8fc, round: 0.12 });
  // nightstand + shelf + toy chest
  L.block(-1.45, 0.78, -3.0, 0.8, 0.78, 0.7, { ...WOOD, color: 0xfad0a8 });
  L.block(-2.6, 2.2, -3.38, 2.6, 0.12, 0.5, WOOD);
  L.block(3.55, 0.75, -2.7, 1.5, 0.75, 0.95, { style: 'candy', color: 0x9ad4ff, color2: 0xb8e2ff, round: 0.1 });
  L.prop('toyBlock', 3.2, 0.75, -2.7, { s: 0.32, seed: 1, collide: false });
  L.prop('toyBlock', 3.75, 0.75, -2.55, { s: 0.28, seed: 2, collide: false, yaw: 0.5 });
  L.prop('toyBall', 2.6, 0, 1.8, { s: 0.45, seed: 1, collide: false });
  L.prop('giftBox', 3.6, 0, 1.2, { s: 0.45, seed: 3, collide: false, yaw: 0.4 });
  L.prop('crayon', 1.9, 0, 2.6, { s: 0.22, seed: 2, collide: false, yaw: 1.2 });
  level.finalize(CTX.scene);
  const root = new Node('roomSet');
  CTX.scene.add(root);
  // rug
  const rug = new Mesh(G.circleGeo(1, 40), new Material({ color: morning ? 0xffd2e6 : 0xffbad8, rim: 0.1 }));
  rug.position.set(0.7, 0.012, 0.8); rug.scale.set(1.75, 1, 1.45);
  const rug2 = new Mesh(G.ringGeo(0.78, 0.86, 40), new Material({ color: 0xffffff }));
  rug2.position.set(0.7, 0.016, 0.8); rug2.scale.set(1.75, 1, 1.45);
  root.add(rug, rug2);
  // glowing wall stars
  const starMat = new Material({ color: 0xfff2a0, emissive: morning ? 0x302810 : 0x8a7420, spec: 0.3, rim: 0.4 });
  const wallStars = [[-3.8, 3.4, -3.6], [-2.9, 3.9, -3.6], [-1.4, 3.3, -3.6], [3.4, 3.6, -3.6], [4.1, 2.9, -3.6], [-4.6, 3.2, -1.8], [-4.6, 3.8, 0.4], [-4.6, 3.0, 2.0], [4.6, 3.5, 0.2], [4.6, 2.7, 1.6]];
  wallStars.forEach((p, i) => {
    const m = new Mesh(G.UNIT.star(), starMat);
    m.position.set(p[0], p[1], p[2]);
    const s = 0.16 + (i % 3) * 0.05;
    m.scale.set(s, s, s * 0.6);
    if (Math.abs(p[0]) > 4.5) m.rotation.y = p[0] > 0 ? -Math.PI / 2 : Math.PI / 2;
    root.add(m);
  });
  // star mobile over the bed
  const mobile = new Node('mobile');
  mobile.position.set(-3.3, 4.5, 0.9);
  const strMat = new Material({ color: 0xffffff, unlit: true });
  const mStars = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const len = 0.6 + (i % 2) * 0.35;
    const s = new Mesh(G.UNIT.cylinder(), strMat);
    s.position.set(Math.sin(a) * 0.55, -len / 2, Math.cos(a) * 0.55);
    s.scale.set(0.008, len, 0.008);
    const st = new Mesh(G.UNIT.star(), new Material({ color: [0xffe066, 0xffa6d0, 0xa6dcff, 0xc8a6ff, 0xa6f0c0][i], emissive: 0x302010, spec: 0.4, rim: 0.5 }));
    st.position.set(Math.sin(a) * 0.55, -len - 0.12, Math.cos(a) * 0.55);
    st.scale.set(0.22, 0.22, 0.14);
    mobile.add(s, st);
    mStars.push(st);
  }
  const ring = new Mesh(G.torusGeo(0.55, 0.02, 6, 32), new Material({ color: 0xffd0a0 }));
  ring.rotation.x = Math.PI / 2;
  mobile.add(ring);
  root.add(mobile);
  // nightstand lamp
  const lamp = new Node('lamp');
  lamp.position.set(-1.45, 0.78, -3.0);
  const lampBase = new Mesh(G.UNIT.cylinder(), new Material({ color: 0xffffff, spec: 0.3 }));
  lampBase.scale.set(0.09, 0.32, 0.09); lampBase.position.y = 0.16;
  lamp.add(lampBase);
  const bulb = glowBall(lamp, morning ? 0xfff4e0 : 0xffe2a0, 0.16, [0, 0.42, 0], 3.2);
  root.add(lamp);
  // plushies on the shelf
  const plush = [];
  [['rabbit', -3.5], ['bear', -2.6], ['sheep', -1.7]].forEach(([id, x], i) => {
    const r = buildAnimal(id);
    r.root.position.set(x, 2.2, -3.3);
    r.root.scale.set(0.3, 0.3, 0.3);
    r.root.rotation.y = (i - 1) * 0.25;
    root.add(r.root);
    plush.push(r);
  });
  // moon + star sparkles outside
  const moon = glowBall(root, morning ? 0xfffaf0 : 0xfff2c4, 2.4, [5, 7.5, -42], 2.2);
  if (morning) moon.userData.halo.material = softGlowMaterial(0xffffff, { opacity: 0.5, rim: 1.6 });
  // a few big twinkly stars around the moon (seen through the window)
  const skyStars = [];
  if (!morning) {
    const pts = [[-6, 9, -46], [12, 12, -48], [-14, 5, -40], [9, 3.5, -44], [-2, 14, -50], [18, 6.5, -46], [-10, 12.5, -52]];
    pts.forEach((pp, i) => {
      const m = new Mesh(G.UNIT.star(), new Material({ color: 0xfff6d0, emissive: 0xb8a060, unlit: true }));
      m.position.set(...pp);
      const s = 0.55 + (i % 3) * 0.2;
      m.scale.set(s, s, s * 0.5);
      root.add(m);
      const hh = new Mesh(G.UNIT.sphere(), softGlowMaterial(0xfff0c0, { opacity: 0.7, rim: 1.5 }));
      hh.position.set(...pp); hh.scale.set(s * 2.6, s * 2.6, s * 2.6);
      root.add(hh);
      skyStars.push({ m, hh, s, ph: i * 1.7 });
    });
  }
  // actors
  const somi = buildSomiGirl();
  root.add(somi.root);
  somi.root.position.set(0.8, 0, -2.55);
  somi.root.rotation.y = Math.PI;
  const whale = buildWhale();
  whale.root.position.set(-40, 10, -34);
  whale.root.scale.set(1.0, 1.0, 1.0);
  root.add(whale.root);
  let t = 0;
  const S = {
    root, level, somi, whale, moon, plush, skyStars, focus: new Vec3(0, 1.5, 0), extra: [],
    update(dt) {
      t += dt;
      if (S.tick) S.tick(dt);
      mobile.rotation.y = t * 0.25;
      for (const st of skyStars) { const k = 1 + Math.sin(t * 2.4 + st.ph) * 0.18; st.hh.scale.set(st.s * 2.6 * k, st.s * 2.6 * k, st.s * 2.6 * k); st.m.rotation.z = Math.sin(t + st.ph) * 0.2; }
      mStars.forEach((s, i) => { s.rotation.y = t * 0.8 + i; });
      const k = 1 + Math.sin(t * 2.1) * 0.06;
      bulb.userData.halo.scale.set(0.5 * k, 0.5 * k, 0.5 * k);
      plush.forEach((p, i) => p.update(dt, { anim: 'sit', t: t + i, speed: 0 }));
      CTX.shadows.begin();
      if (somi.root.visible) SHADOW(somi.root.position.x, 0, somi.root.position.z, 0.9);
      for (const e of S.extra) if (e.root.visible && e.root.position.y < 0.6) SHADOW(e.root.position.x, 0, e.root.position.z, 0.9);
    },
    dispose() { root.removeFromParent(); level.dispose(); CTX.level = null; },
  };
  return S;
}

// ------------------------------------------------------------------ memory sky (Noa's story)
export function buildMemorySet(n) {
  const forest = n >= 4;
  const level = new Level({ killY: -100 });
  CTX.level = level; CTX.physics = level.physics;
  CTX.env.apply(MEMORY_SKY, { sat: forest ? lerp(0.85, 0.35, (n - 4) / 3) : 1, skySat: 1, particleRate: 1.2, sea: true, distant: !forest });
  const root = new Node('memorySet');
  CTX.scene.add(root);
  const stars = [];
  let noaHome = new Vec3(0, 2.2, 0);
  if (forest) {
    const L = new LevelBuilder(level, 'jungle');
    L.island(0, 0, 0, 9, { density: 0.8, clear: [[0, 0, 2.5]], depth: 10 });
    L.prop('jungleTree', -4.5, 0, -3.5, { seed: 2 });
    L.prop('jungleTree', 4.8, 0, -2.6, { seed: 5, s: 0.9 });
    L.prop('glowMushroom', 1.6, 0, 1.2, { seed: 1 });
    L.prop('glowMushroom', -1.8, 0, 1.6, { seed: 3, s: 0.8 });
    L.prop('fern', 2.4, 0, -1.2, { seed: 1 });
    L.prop('fern', -2.6, 0, -0.8, { seed: 2 });
    level.finalize(CTX.scene);
    noaHome = new Vec3(0, 0.05, 0);
  } else {
    level.finalize(CTX.scene);
  }
  // sky stars (bigger "friends" for n 2-3)
  const big = n === 2 || n === 3;
  const cols = [0xfff0a0, 0xffd6f0, 0xd6ecff, 0xfff6d8];
  for (let i = 0; i < (forest ? 10 : 18); i++) {
    const a = (i / (forest ? 10 : 18)) * TAU + 0.3;
    const d = forest ? 14 + (i % 3) * 3 : 4.5 + (i % 4) * 1.6;
    const y = forest ? 12 + (i % 4) * 2.5 : 2.2 + Math.sin(i * 1.7) * 2.6;
    const m = new Mesh(G.UNIT.star(), new Material({ color: cols[i % 4], emissive: 0x6a5a20, spec: 0.5, rim: 0.5 }));
    const s = (big ? 0.55 : 0.32) + (i % 3) * 0.12;
    m.scale.set(s, s, s * 0.6);
    m.position.set(Math.sin(a) * d, y, Math.cos(a) * d - (forest ? 6 : 1));
    const h = new Mesh(G.UNIT.sphere(), softGlowMaterial(cols[i % 4], { opacity: 0.55, rim: 1.8 }));
    h.scale.set(s * 1.5, s * 1.5, s * 1.5);
    h.position.copy(m.position);
    root.add(m, h);
    stars.push({ m, h, ph: i * 1.3, s });
  }
  const noa = buildNoa();
  noa.root.position.copy(noaHome);
  if (forest) noa.root.scale.set(1.2, 1.2, 1.2);
  root.add(noa.root);
  let t = 0;
  const S = {
    root, level, noa, stars, focus: new Vec3(0, 1, 0), noaHome, forest, extra: [],
    update(dt) {
      t += dt;
      if (S.tick) S.tick(dt);
      for (const s of stars) {
        const k = 1 + Math.sin(t * 2 + s.ph) * 0.12;
        s.m.rotation.z = Math.sin(t * 0.8 + s.ph) * 0.2;
        s.h.scale.set(s.s * 1.5 * k, s.s * 1.5 * k, s.s * 1.5 * k);
      }
      CTX.shadows.begin();
      if (forest) SHADOW(noa.root.position.x, 0, noa.root.position.z, 0.7, 0.25);
      for (const e of S.extra) if (e.root && e.root.visible) SHADOW(e.root.position.x, 0, e.root.position.z, 0.9);
    },
    dispose() { root.removeFromParent(); level.dispose(); CTX.level = null; },
  };
  return S;
}

// ------------------------------------------------------------------ ending sky flight
export function buildSkyFlight(charId) {
  const level = new Level({ killY: -100 });
  CTX.level = level; CTX.physics = level.physics;
  CTX.env.apply({ ...THEMES.title, sky: { ...THEMES.moon.sky, swirl: 0.9, stars: 1.6, aurora: 0.7, aurora1: 0xffa8e8, aurora2: 0x8affd8 }, particles: 'motes', fog: 0x2a2266, fogNear: 60, fogFar: 220 }, { sat: 1, skySat: 1, particleRate: 1.5, distant: false });
  level.finalize(CTX.scene);
  const root = new Node('flightSet');
  CTX.scene.add(root);
  const whale = buildWhale();
  whale.setFogged(0);
  root.add(whale.root);
  const rider = buildAnimal(charId || 'cat');
  root.add(rider.root);
  const noa = buildNoa();
  noa.setGray(0);
  root.add(noa.root);
  const puffies = [];
  for (let i = 0; i < 6; i++) {
    const p = buildPuffy(i);
    root.add(p.root);
    puffies.push(p);
  }
  let t = 0;
  const S = {
    root, level, whale, rider, noa, puffies, focus: new Vec3(), t: 0, ride: true,
    update(dt) {
      t += dt; S.t = t;
      if (S.tick) S.tick(dt);
      // whale glides forward along a gentle curve; rider sits on its back
      const wp = whale.root.position;
      if (S.ride) {
        whale.root.updateWorldFromRoot && whale.root.updateWorldFromRoot();
        const yaw = whale.root.rotation.y;
        const bx = Math.sin(yaw) * 0.6, bz = Math.cos(yaw) * 0.6;
        rider.root.position.set(wp.x + bx, wp.y + 1.55 * whale.root.scale.y + Math.sin(t * 1.6) * 0.04, wp.z + bz);
        rider.root.rotation.y = yaw;
      }
      puffies.forEach((p, i) => {
        const a = t * 0.6 + (i / 6) * TAU;
        p.root.position.set(wp.x + Math.sin(a) * 4.2, wp.y + 1.2 + Math.sin(t * 1.3 + i) * 0.6, wp.z + Math.cos(a) * 4.2);
        p.root.rotation.y = a + Math.PI / 2;
        p.update(dt, { anim: 'happy', t: t + i });
      });
      S.focus.copy(wp);
    },
    dispose() { root.removeFromParent(); level.dispose(); CTX.level = null; },
  };
  return S;
}
void rgb;

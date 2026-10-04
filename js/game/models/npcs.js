// ============================================================================
// models/npcs.js — story NPCs: Puffy (뭉실이, Dreamland residents), the Star
// Whale (별고래) and Noa (노아, the lost little star). Same Kirby-like style:
// makeEyes eyes, blush, glossy toon materials.
//
// export buildPuffy(colorIndex) -> { root, update(dt,{anim,t}), setFlash(v), setOpacity(v), height, radius, centerY, starTip }
//   ~0.55 tall, origin at feet. colorIndex 0 white-pink, 1 mint, 2 butter yellow, 3 sky blue, 4 lavender, 5 peach
//   anims: idle, happy (bounce), talk, sad (droopy, in cage), wave, cheer (jumping, arms up)
// export buildWhale() -> { root, update, setFlash, setOpacity, setFogged(v), length, height, radius, centerY }
//   ~9 long, origin at body centre, faces +Z. anims: swim (undulation + tail beats), idle, sleep, happy
//   setFogged(v) 0..1 lerps to grey & dim (swallowed by the fog)
// export buildNoa() -> { root, update, setFlash, setOpacity, setGray(v), height, radius, centerY }
//   ~0.7 tall, origin at the bottom (floats above it). anims: idle (float), cry, happy, hug (arms open), sleep
//   setGray(v) 0..1: 0 = bright glowing star (emissive + halo), 1 = grey & dim (lonely)
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import { rgb, Ease } from '../../engine/math.js';
import {
  G, UNIT, M, MG, MU, add, grp, ell, onSphere, makeEyes, makeCheeks, makeMouth, Spring, approach, PI, TAU, lerp, clamp,
} from './common.js';

// ------------------------------------------------------------------ kit
const glowMat = (c) => M(0x000000, { emissive: c, rim: -2.4, spec: 0, transparent: true, blending: 'additive', depthWrite: false, fog: false });
const cg = (key, fn) => G.cachedGeo('npc:' + key, fn);
// inside-out sphere: only its far hemisphere renders, with normals facing the viewer -> a fresnel glow that
// sits *behind* the character (occluded by it), never washing over the face
const invSphereGeo = (key) => G.cachedGeo(key, () => {
  const g = G.sphereGeo(1, 28, 20);
  const n = g.attributes.normal.array; for (let i = 0; i < n.length; i++) n[i] = -n[i];
  const ix = g.index; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return g;
});

const hex = (c) => (Array.isArray(c) ? c : rgb(c));
function merged(key, parts) {
  return cg(key, () => G.mergeGeometries(parts.map((q) => {
    const s = q.s === undefined ? [1, 1, 1] : Array.isArray(q.s) ? q.s : [q.s, q.s, q.s];
    const p = q.p || [0, 0, 0], r = q.r || [0, 0, 0];
    const geo = q.g ? (typeof q.g === 'function' ? q.g() : q.g) : UNIT.sphere();
    return { geo, matrix: G.trs(p[0], p[1], p[2], r[0], r[1], r[2], s[0], s[1], s[2]), color: hex(q.c ?? 0xffffff) };
  })));
}
const curve = (f, n = 14) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
function tubeGeo(pts, r, rs = 8, cap = 3) {
  const rf = typeof r === 'function' ? r : () => r;
  const n = pts.length;
  const nz = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; T.push(nz([b[0] - a[0], b[1] - a[1], b[2] - a[2]])); }
  let nn = nz(cr(T[0], Math.abs(T[0][1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
  for (let i = 0; i < n; i++) {
    if (i) { const d = nn[0] * T[i][0] + nn[1] * T[i][1] + nn[2] * T[i][2]; nn = nz([nn[0] - T[i][0] * d, nn[1] - T[i][1] * d, nn[2] - T[i][2] * d]); }
    N.push(nn); B.push(cr(T[i], nn));
  }
  const pos = [], nrm = [], idx = [];
  const ring = (c, t, nv, bv, rad, off, nd) => {
    const k = Math.sqrt(Math.max(0, 1 - nd * nd));
    for (let j = 0; j <= rs; j++) {
      const a = (j / rs) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const dx = nv[0] * ca + bv[0] * sa, dy = nv[1] * ca + bv[1] * sa, dz = nv[2] * ca + bv[2] * sa;
      pos.push(c[0] + dx * rad + t[0] * off, c[1] + dy * rad + t[1] * off, c[2] + dz * rad + t[2] * off);
      nrm.push(dx * k + t[0] * nd, dy * k + t[1] * nd, dz * k + t[2] * nd);
    }
  };
  const r0 = rf(0), r1 = rf(1);
  let rings = 0;
  for (let k = cap; k >= 1; k--) { const ph = (k / cap) * (PI / 2); ring(pts[0], T[0], N[0], B[0], r0 * Math.cos(ph), -r0 * Math.sin(ph), -Math.sin(ph)); rings++; }
  for (let i = 0; i < n; i++) { ring(pts[i], T[i], N[i], B[i], rf(i / (n - 1)), 0, 0); rings++; }
  for (let k = 1; k <= cap; k++) { const ph = (k / cap) * (PI / 2); ring(pts[n - 1], T[n - 1], N[n - 1], B[n - 1], r1 * Math.cos(ph), r1 * Math.sin(ph), Math.sin(ph)); rings++; }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < rs; j++) { const a = i * (rs + 1) + j, b = a + 1, c = a + rs + 2, d = a + rs + 1; idx.push(a, b, c, a, c, d); }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3); g.setAttribute('normal', nrm, 3); g.setIndex(idx);
  G.fixWinding(g); g.computeBoundingSphere();
  return g;
}
// blink helper (same timing as the animal rig)
function blinker() {
  let tmr = 0.6 + Math.random() * 2.5, ph = -1;
  return (eyes, dt, can) => {
    if (!can) { ph = -1; return; }
    tmr -= dt;
    if (tmr <= 0 && ph < 0) { ph = 0; tmr = 1.8 + Math.random() * 3.2; }
    if (ph >= 0) {
      ph += dt / 0.14;
      const v = ph < 0.5 ? 1 - ph * 2 : (ph - 0.5) * 2;
      eyes.blink(v);
      if (ph >= 1) { ph = -1; eyes.blink(1); }
    }
  };
}
// drop expression meshes a character never uses (keeps the mesh budget ≤ 30)
function trimFace(eyes, mouth) {
  for (const E of eyes.eyes) E.pivot.remove(E.hurt); // '> <' eyes unused by these NPCs
  const w = mouth.pivot.getByName('w'); if (w) mouth.pivot.remove(w); // 'w' mouth unused
}
function opacityApi(obj) {
  obj.opacity = 1;
  obj.setOpacity = (v) => { obj.opacity = v; obj.root.traverse((n) => { if (n.isMesh) n.opacity = v * (n.userData.op ?? 1); }); };
  obj.setFlash = (v) => { obj.root.traverse((n) => { if (n.isMesh) n.flash = v; }); };
  obj.syncFx = (list) => { for (const m of list) { const o = m.userData.op ?? 1; m.opacity = obj.opacity * o; m.visible = o > 0.004 && m.opacity > 0.004; } };
}

// ============================================================================
// Puffy 뭉실이
// ============================================================================
const PUFFY_COLORS = [
  { body: 0xfff1f6, top: 0xffffff, limb: 0xffc9dd, cheek: 0xff8fb0 },   // 0 white-pink
  { body: 0xc8f3e1, top: 0xe4fbf1, limb: 0x8fd9bb, cheek: 0xff9fb8 },   // 1 mint
  { body: 0xfff0a6, top: 0xfff8d2, limb: 0xffd36e, cheek: 0xff9a9a },   // 2 butter yellow
  { body: 0xcde7ff, top: 0xe8f4ff, limb: 0x95c6f4, cheek: 0xff9fc0 },   // 3 sky blue
  { body: 0xe4daff, top: 0xf2edff, limb: 0xbfaaf3, cheek: 0xff98c4 },   // 4 lavender
  { body: 0xffdcc6, top: 0xffeee2, limb: 0xffb48f, cheek: 0xff8f9f },   // 5 peach
];
export const PUFFY_COLOR_COUNT = PUFFY_COLORS.length;

export function buildPuffy(colorIndex = 0) {
  const ci = ((Math.floor(Number(colorIndex)) || 0) % PUFFY_COLORS.length + PUFFY_COLORS.length) % PUFFY_COLORS.length;
  const C = PUFFY_COLORS[ci];
  const R = 0.19, CY = 0.24;
  const P = { root: new Node('puffy-' + ci) };
  opacityApi(P);
  const base = grp(P.root, 'base');
  const body = grp(base, 'body', [0, CY, 0]);
  // fluffy cloud body (puffs lighter on top)
  add(body, () => merged('puffyBody' + ci, [
    { g: UNIT.sphereHi, s: R, c: C.body },
    { p: [0, R * 0.62, -R * 0.08], s: R * 0.6, c: C.top },
    { p: [-R * 0.55, R * 0.42, -R * 0.06], s: R * 0.5, c: C.top },
    { p: [R * 0.55, R * 0.42, -R * 0.06], s: R * 0.5, c: C.top },
    { p: [-R * 0.82, -R * 0.02, -R * 0.08], s: R * 0.44, c: C.body },
    { p: [R * 0.82, -R * 0.02, -R * 0.08], s: R * 0.44, c: C.body },
    { p: [0, R * 0.25, -R * 0.6], s: R * 0.58, c: C.top },
    { p: [-R * 0.5, -R * 0.15, -R * 0.52], s: R * 0.48, c: C.body },
    { p: [R * 0.5, -R * 0.15, -R * 0.52], s: R * 0.48, c: C.body },
    { p: [0, -R * 0.52, -R * 0.2], s: [R * 0.75, R * 0.5, R * 0.6], c: C.body },
  ]), M(0xffffff, { vertexColors: true, spec: 0.18, rim: 0.45 }));
  // face
  const eyes = makeEyes(body, { headR: R, yaw: 22, pitch: 4, size: 0.5 });
  makeCheeks(body, { headR: R, yaw: 42, pitch: -10, size: 0.52, color: C.cheek });
  const mouth = makeMouth(body, { headR: R, pitch: -16, size: 0.62 });
  trimFace(eyes, mouth);
  // tiny arms + feet
  const arms = [];
  for (const sd of [-1, 1]) {
    const a = grp(body, sd < 0 ? 'armL' : 'armR', [sd * R * 0.9, -R * 0.1, R * 0.36]);
    ell(a, M(C.limb), [sd * 0.055, 0, 0], 0.066, 0.043, 0.046);
    arms.push({ node: a, sd });
  }
  const feet = [];
  for (const sd of [-1, 1]) {
    const f = grp(base, 'foot', [sd * 0.075, 0, 0.03]);
    ell(f, M(C.limb), [0, 0.028, 0.008], 0.052, 0.034, 0.062);
    feet.push({ node: f, sd });
  }
  // antenna with a little star (springy)
  const ant = grp(body, 'antenna', [0, R * 1.12, -0.02]);
  const antPts = curve((u) => [0.012 * Math.sin(u * PI), 0.11 * u, 0.025 * u * u], 8);
  add(ant, () => cg('puffyAnt', () => tubeGeo(antPts, (u) => lerp(0.011, 0.007, u), 6, 2)), M(C.limb));
  const star = grp(ant, 'star', antPts[antPts.length - 1]);
  add(star, UNIT.star, MG(0xffe14d, { emissive: 0x5a4300, spec: 0.55 }), { s: 0.085, p: [0, 0.03, 0] });
  P.starTip = star;
  // tears for 'sad'
  const tearMat = M(0x9fd6ff, { transparent: true, opacity: 0.85, spec: 0.7, rim: 0.6, depthWrite: false });
  const tears = [-1, 1].map((sd) => { const t = add(body, UNIT.sphere, tearMat); t.userData.op = 0; t.userData.sd = sd; return t; });
  const blink = blinker();
  const antSpring = new Spring(60, 5), antSpringZ = new Spring(60, 5), sq = new Spring(170, 9);
  let T = Math.random() * 10, last = '', prevY = 0;
  const pose = { y: 0, sy: 1, lean: 0, roll: 0, aL: 0.3, aR: 0.3, axL: 0, axR: 0, droop: 0 };
  P.update = (dt, st = {}) => {
    dt = clamp(dt, 0, 0.1);
    const anim = st.anim || 'idle';
    T += dt;
    if (anim !== last) { if (anim === 'happy' || anim === 'cheer') sq.kick(2); last = anim; }
    let y = 0, sy = 1 + Math.sin(T * 2.6) * 0.025, lean = 0, roll = Math.sin(T * 1.2) * 0.04;
    let aL = 0.35, aR = 0.35, axL = 0, axR = 0, droop = 0, expr = 'normal', mo = 'smile', rate = 12, tearOn = 0;
    switch (anim) {
      case 'happy': {
        const u = (T * 2.4) % 1; y = Math.sin(u * PI) * 0.09; sy = u < 0.12 || u > 0.9 ? 0.86 : 1.07;
        expr = 'happy'; mo = 'open'; aL = aR = 1.0 + Math.sin(T * 12) * 0.2; rate = 22;
        break;
      }
      case 'talk': mo = Math.sin(T * 15) > -0.1 ? 'open' : 'smile'; aR = 0.8 + Math.sin(T * 4) * 0.35; axR = -0.3; roll = Math.sin(T * 2) * 0.07; sy = 1 + Math.sin(T * 7.5) * 0.02; break;
      case 'sad': expr = 'sad'; mo = 'frown'; droop = 1; sy = 0.9 + Math.sin(T * 1.3) * 0.015; lean = 0.16; roll = Math.sin(T * 0.8) * 0.06; aL = aR = 0.05; tearOn = 1; break;
      case 'wave': expr = 'happy'; mo = 'open'; aR = 1.55 + Math.sin(T * 11) * 0.38; aL = 0.3; roll = -0.08 + Math.sin(T * 5.5) * 0.03; break;
      case 'cheer': {
        const u = (T * 2.2) % 1; y = Math.max(0, Math.sin(u * PI)) * 0.16; sy = u < 0.1 ? 0.82 : 1 + 0.12 * Math.cos(u * PI);
        expr = 'happy'; mo = 'open'; aL = aR = 1.45 + Math.sin(T * 13) * 0.22; rate = 24;
        break;
      }
      default: aL = 0.35 + Math.sin(T * 2.6) * 0.06; aR = aL;
    }
    pose.y = approach(pose.y, y, rate, dt); pose.sy = approach(pose.sy, sy, rate, dt);
    pose.lean = approach(pose.lean, lean, 8, dt); pose.roll = approach(pose.roll, roll, 8, dt);
    pose.aL = approach(pose.aL, aL, 14, dt); pose.aR = approach(pose.aR, aR, 14, dt);
    pose.axL = approach(pose.axL, axL, 10, dt); pose.axR = approach(pose.axR, axR, 10, dt);
    pose.droop = approach(pose.droop, droop, 5, dt);
    const s = sq.update(0, dt);
    const syy = pose.sy * (1 + s), sxz = 1 / Math.sqrt(Math.max(0.3, syy));
    base.position.y = pose.y;
    base.rotation.set(pose.lean, 0, pose.roll);
    base.scale.set(sxz, syy, sxz);
    arms[0].node.rotation.set(pose.axL, 0, -pose.aL); arms[1].node.rotation.set(pose.axR, 0, pose.aR);
    for (const f of feet) { f.node.position.y = anim === 'cheer' || anim === 'happy' ? Math.max(0, -pose.y * 0.0) : 0; f.node.rotation.x = pose.y > 0.02 ? 0.35 : 0; }
    // antenna follows motion with a springy lag, droops when sad
    const vy = (pose.y - prevY) / Math.max(dt, 1e-3); prevY = pose.y;
    antSpring.kick(clamp(-vy * 0.25, -2, 2) * dt * 60 * 0.02);
    const a = antSpring.update(pose.droop * 1.0 + Math.sin(T * 2.1) * 0.06, dt);
    const az = antSpringZ.update(-pose.roll * 1.5 + Math.sin(T * 1.7) * 0.05, dt);
    ant.rotation.set(a, 0, az);
    star.rotation.set(0, Math.sin(T * 1.4) * 0.4, Math.sin(T * 2.3) * 0.15);
    // face
    eyes.set(expr);
    blink(eyes, dt, expr === 'normal' || expr === 'sad');
    mouth.set(mo);
    // tears roll down the cheeks when sad
    for (const tr of tears) {
      const u = ((T * 0.8 + (tr.userData.sd > 0 ? 0.5 : 0)) % 1);
      tr.userData.op = tearOn * (u < 0.85 ? 1 : (1 - u) / 0.15) * pose.droop;
      const p = onSphere(R * 1.02, tr.userData.sd * 26, -4 - u * 40);
      tr.position.set(p[0], p[1], p[2] + 0.005);
      const k = 0.016 + 0.006 * u; tr.scale.set(k, k * 1.25, k);
    }
    P.syncFx(tears);
  };
  P.height = 0.55; P.radius = 0.24; P.centerY = CY; P.colorIndex = ci;
  P.update(1 / 60, { anim: 'idle' });
  return P;
}

// ============================================================================
// Star Whale 별고래 — continuous body bent on the CPU (smooth undulation)
// ============================================================================
// body radius profile along z (head +z). [z, r]
const WHALE_PROF = [[4.0, 0.0], [3.92, 0.55], [3.7, 0.98], [3.3, 1.32], [2.7, 1.6], [1.9, 1.78], [0.9, 1.82], [-0.2, 1.68], [-1.3, 1.38], [-2.3, 1.0], [-3.1, 0.66], [-3.8, 0.42], [-4.35, 0.3], [-4.7, 0.22]];
const W_SX = 1.06, W_SY = 0.9; // cross-section squash (a little wider than tall)
function profR(z) {
  const P = WHALE_PROF;
  if (z >= P[0][0]) return 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    if (z <= a[0] && z >= b[0]) { const u = (a[0] - z) / (a[0] - b[0]); const s = u * u * (3 - 2 * u); return lerp(a[1], b[1], (u + s) * 0.5); }
  }
  return P[P.length - 1][1];
}
// lathe of the profile around +z; returns geometry + per-vertex rest data
function whaleBodyGeo() {
  const NA = 44, prof = [];
  // densify the profile
  for (let z = 4.0; z >= -4.75; z -= 0.125) prof.push([z, profR(z)]);
  const NZ = prof.length;
  const pos = new Float32Array(NZ * (NA + 1) * 3), nrm = new Float32Array(NZ * (NA + 1) * 3), col = new Float32Array(NZ * (NA + 1) * 3);
  const idx = [];
  for (let i = 0; i < NZ; i++) {
    const [z, r] = prof[i];
    const zp = prof[Math.max(0, i - 1)][0], zn = prof[Math.min(NZ - 1, i + 1)][0];
    const drdz = (profR(zn) - profR(zp)) / ((zn - zp) || 1);
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * TAU; // a=0 top
      const sx = Math.sin(a), cy = Math.cos(a);
      const o = (i * (NA + 1) + j) * 3;
      pos[o] = sx * r * W_SX; pos[o + 1] = cy * r * W_SY; pos[o + 2] = z;
      let nx = sx / W_SX, ny = cy / W_SY, nzz = -drdz; const l = Math.hypot(nx, ny, nzz) || 1;
      if (r < 1e-4) { nx = 0; ny = 0; nzz = z > 0 ? 1 : -1; }
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nzz / l;
      // top darker -> sides lighter (luminance only; hue comes from the material colour)
      const up = cy; const lum = 0.78 + 0.22 * (1 - Math.max(0, up)) * 0.9;
      col[o] = lum; col[o + 1] = lum; col[o + 2] = lum;
    }
  }
  for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 2, d = a + NA + 1; idx.push(a, d, b, b, d, c); }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3, true); g.setAttribute('normal', nrm, 3, true); g.setAttribute('color', col, 3, true);
  g.setIndex(idx);
  G.fixWinding(g);
  return g;
}
// belly: front-bottom strip of the hull, slightly outside, with throat grooves
function whaleBellyGeo() {
  const NA = 22, zs = [];
  for (let z = 3.55; z >= -2.6; z -= 0.125) zs.push(z);
  const NZ = zs.length, A0 = PI * 0.62, A1 = PI * 1.38;
  const pos = new Float32Array(NZ * (NA + 1) * 3), nrm = new Float32Array(NZ * (NA + 1) * 3), col = new Float32Array(NZ * (NA + 1) * 3), idx = [];
  for (let i = 0; i < NZ; i++) {
    const z = zs[i], r = profR(z) * 1.012;
    const fade = clamp((3.55 - z) / 0.6, 0, 1) * clamp((z + 2.6) / 1.2, 0, 1);
    for (let j = 0; j <= NA; j++) {
      const u = j / NA, a = lerp(A0, A1, u);
      // narrower toward the ends so the belly is an oval patch
      const half = (A1 - A0) / 2 * (0.35 + 0.65 * Math.sqrt(fade));
      const aa = PI + (a - PI) * (half / ((A1 - A0) / 2));
      const sx = Math.sin(aa), cy = Math.cos(aa);
      const o = (i * (NA + 1) + j) * 3;
      pos[o] = sx * r * W_SX; pos[o + 1] = cy * r * W_SY; pos[o + 2] = z;
      const l = Math.hypot(sx / W_SX, cy / W_SY) || 1;
      nrm[o] = sx / W_SX / l; nrm[o + 1] = cy / W_SY / l; nrm[o + 2] = 0;
      const groove = z > -0.6 && Math.abs(Math.sin((u - 0.5) * PI * 7)) < 0.18 ? 0.86 : 1; // soft throat grooves
      col[o] = groove; col[o + 1] = groove; col[o + 2] = groove;
    }
  }
  for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 2, d = a + NA + 1; idx.push(a, d, b, b, d, c); }
  const g = new G.Geometry();
  g.setAttribute('position', pos, 3, true); g.setAttribute('normal', nrm, 3, true); g.setAttribute('color', col, 3);
  g.setIndex(idx);
  G.fixWinding(g);
  return g;
}
// fluke (horizontal tail): two rounded lobes with a centre notch, lying in XZ (lobes trail toward -z).
// It is merged into the bent hull so it beats with the tail.
function flukeGeo() {
  const lobe = (sd) => Array.from({ length: 19 }, (_, i) => {
    const u = i / 18;
    return [sd * (0.25 + 1.55 * Math.sin(u * PI * 0.5)), -0.1 - 0.95 * Math.sin(u * PI) * (0.65 + 0.35 * u) + 0.25 * u * u];
  });
  const pts = [[0, 0.18], ...lobe(1),
    [1.75, -0.12], [1.2, -0.42], [0.55, -0.62], [0.18, -0.5], [0, -0.38], [-0.18, -0.5], [-0.55, -0.62], [-1.2, -0.42], [-1.75, -0.12],
    ...lobe(-1).reverse()];
  const cy = -0.25; // star-shaped about (0, cy)
  const g = G.puffyShapeGeo(pts.map((p) => [p[0], p[1] - cy]), 0.16, 4, 0.55);
  g.translate(0, cy, 0);
  g.rotate(PI / 2, 0, 0); // XY -> XZ (outline y -> z), thickness -> y
  return g;
}
function whaleFinGeo() {
  return cg('whaleFin', () => {
    const o = [];
    for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; const c = Math.cos(a), s = Math.sin(a); o.push([0.5 * c * (1 + 0.15 * c), 0.2 * s * (1 - 0.45 * c)]); }
    const g = G.puffyShapeGeo(o, 0.08, 4, 0.55);
    g.rotate(PI / 2, 0, 0); g.translate(0.5, 0, 0);
    g.computeBoundingSphere();
    return g;
  });
}
// column-major 4x4 multiply (o = a * b)
function mul4(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
// matrix placing a flat puffy star (faces +Z) on the hull: normal rotated about the body axis by `ang` (0 = up)
function hullStarMatrix(p, ang, sxy, sz) {
  const m = mul4(new Float32Array(16), G.trs(0, 0, 0, 0, 0, ang, 1, 1, 1), G.trs(0, 0, 0, -PI / 2, 0, 0, sxy, sxy, sz));
  m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
  return m;
}
// bendable mesh data: keeps rest positions/normals and writes bent ones in place every frame
function bendable(geo) {
  for (const k of ['position', 'normal', 'color']) if (geo.attributes[k]) geo.attributes[k].dynamic = true;
  return { geo, p: geo.attributes.position.array.slice(), n: geo.attributes.normal.array.slice() };
}

export function buildWhale() {
  const W = { root: new Node('starWhale') };
  opacityApi(W);
  const rig = grp(W.root, 'rig');
  // per-instance materials (fog lerps them)
  const BODY_HEAD = rgb(0x2f4fb8), BODY_TAIL = rgb(0x7b54c8), BELLY = rgb(0xe8f1ff), BELLY_E = rgb(0x5a6a9a), STAR = rgb(0xfff7d6);
  const FOG_BODY = rgb(0x6c6880), FOG_BELLY = rgb(0x9a97a8), FIN = [0.27, 0.4, 0.85];
  const bodyMat = new Material({ color: 0xffffff, vertexColors: true, spec: 0.16, rim: 0.5 });
  const bellyMat = new Material({ color: 0xffffff, vertexColors: true, spec: 0.2, rim: 0.35 });
  const starMat = new Material({ color: 0xffffff, vertexColors: true, unlit: true, rim: 0 });
  const glowM = new Material({ color: 0xffd98a, vertexColors: true, unlit: true, rim: 0, transparent: true, blending: 'additive', depthWrite: false, fog: false, opacity: 0.5 });
  // ---- hull + fluke (one continuous mesh, bent on the CPU)
  const hull = bendable(G.mergeGeometries([
    { geo: whaleBodyGeo(), color: [1, 1, 1] },
    { geo: flukeGeo(), matrix: G.trs(0, 0, -4.55, 0, 0, 0, 1.25, 1, 1.25), color: [0.82, 0.82, 0.82] },
  ], { withUV: false }));
  const lum = hull.geo.attributes.color.array.slice(); // luminance only; hue below
  add(rig, hull.geo, bodyMat).frustumCulled = false;
  // body hue: blue at the head -> violet toward the tail; fog lerps toward grey
  const hueCols = new Float32Array(lum.length), fogCols = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i += 3) {
    const u = clamp((2.5 - hull.p[i + 2]) / 7, 0, 1), L = lum[i];
    for (let k = 0; k < 3; k++) { hueCols[i + k] = lerp(BODY_HEAD[k], BODY_TAIL[k], u) * L * 1.12; fogCols[i + k] = FOG_BODY[k] * L * 1.1; }
  }
  // ---- glowing pale belly (bent)
  const belly = bendable(whaleBellyGeo());
  add(rig, belly.geo, bellyMat).frustumCulled = false;
  // ---- star spots on the back + a soft additive star-shaped glow behind each (bent, twinkling)
  const stars = [];
  const rnd = (() => { let sd = 7; return () => ((sd = (sd * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 46; i++) {
    const z = lerp(3.0, -4.1, Math.pow(rnd(), 0.95));
    const a = (rnd() - 0.5) * PI * 0.62; // around the top of the back
    const r = profR(z);
    if (r < 0.3) continue;
    const sx = Math.sin(a), cy = Math.cos(a);
    stars.push({
      p: [sx * r * W_SX * 1.01, cy * r * W_SY * 1.01, z], ang: -Math.atan2(sx / W_SX, cy / W_SY),
      size: lerp(0.1, 0.26, rnd()) * (r > 1 ? 1 : 0.75), tw: rnd() * TAU, sp: 1.5 + rnd() * 2.5,
    });
  }
  for (const [x, z] of [[0.9, -4.85], [-0.9, -4.85], [1.4, -5.0], [-1.4, -5.0], [0.45, -5.15], [-0.45, -5.15]]) { // on the fluke
    stars.push({ p: [x, 0.16, z], ang: 0, size: 0.13, tw: rnd() * TAU, sp: 2 + rnd() * 2 });
  }
  const starB = bendable(G.mergeGeometries(stars.map((st) => ({ geo: UNIT.star(), matrix: hullStarMatrix(st.p, st.ang, st.size, st.size * 0.6), color: STAR })), { withUV: false }));
  add(rig, starB.geo, starMat).frustumCulled = false;
  const glowB = bendable(G.mergeGeometries(stars.map((st) => ({ geo: UNIT.star(), matrix: hullStarMatrix([st.p[0] * 0.998, st.p[1] * 0.998, st.p[2]], st.ang, st.size * 2, st.size * 0.3), color: [1, 1, 1] })), { withUV: false }));
  const glowMesh = add(rig, glowB.geo, glowM);
  glowMesh.frustumCulled = false;
  const vPerStar = UNIT.star().vertexCount;
  // ---- head attachments (the head region does not bend): eyes, cheeks, smile, fins
  const head = grp(rig, 'head');
  // makeEyes places eyes on a sphere around an anchor: pick the anchor on the midline so the eye lands on the hull
  const EZ = 3.3, EA = 0.84;
  const er = profR(EZ);
  const ep = [Math.sin(EA) * er * W_SX, Math.cos(EA) * er * W_SY, EZ];
  let en = [Math.sin(EA) / W_SX, Math.cos(EA) / W_SY, (profR(EZ - 0.05) - profR(EZ + 0.05)) / 0.1];
  { const l = Math.hypot(...en); en = en.map((v) => v / l); }
  const d = ep[0] / en[0];
  const anchor = [0, ep[1] - en[1] * d, ep[2] - en[2] * d];
  const eyeNode = grp(head, 'eyeAnchor', anchor);
  const eyeYaw = (Math.atan2(ep[0], ep[2] - anchor[2]) * 180) / PI;
  const eyePitch = (Math.asin((ep[1] - anchor[1]) / d) * 180) / PI;
  const eyes = makeEyes(eyeNode, { headR: d * 1.004, yaw: eyeYaw, pitch: eyePitch, size: 3.8, glint: 0x8fd0ff });
  makeCheeks(eyeNode, { headR: d, yaw: eyeYaw + 10, pitch: eyePitch - 18, size: 3.2, color: 0xff9ec4 });
  // smile on the front of the head: z on the hull where the cross-section radius matches
  const zAt = (rho) => { let lo = 2.6, hi = 4.0; for (let k = 0; k < 32; k++) { const mid = (lo + hi) / 2; if (profR(mid) > rho) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const smilePts = curve((u) => { const x = lerp(-0.95, 0.95, u); const y = -0.5 - 0.24 * (1 - Math.pow(x / 0.95, 2)); return [x, y, zAt(Math.hypot(x / W_SX, y / W_SY)) + 0.012]; }, 20);
  add(head, () => cg('whaleSmile2', () => tubeGeo(smilePts, (u) => 0.052 * (1 - Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.55), 8, 3)), MG(0x2a2a5a, { spec: 0.2, rim: 0 }));
  const mouthOpen = ell(head, MG(0x5a2a5a, { spec: 0.1, rim: 0 }), [0, -0.78, zAt(0.78 / W_SY) - 0.04], 0.42, 0.24, 0.1, [0.62, 0, 0]); // happy
  mouthOpen.visible = false;
  const fins = [];
  for (const sd of [-1, 1]) {
    const r = profR(1.2);
    const piv = grp(head, 'fin', [sd * r * W_SX * 0.86, -r * W_SY * 0.45, 1.2], [0, sd * 0.35, 0]);
    const fm = new Material({ color: FIN, spec: 0.25, rim: 0.5 });
    add(piv, whaleFinGeo, fm, { s: [1.9, 1.5, 1.6], r: sd < 0 ? [0, 0, PI] : undefined });
    fins.push({ piv, sd, mat: fm });
  }
  // ---- fog
  let fog = 0, fogApplied = -1;
  const applyFog = () => {
    if (Math.abs(fog - fogApplied) < 1e-4) return;
    fogApplied = fog;
    const col = hull.geo.attributes.color.array;
    for (let i = 0; i < col.length; i++) col[i] = lerp(hueCols[i], fogCols[i], fog);
    hull.geo.markDirty('color');
    bellyMat.color = [0, 1, 2].map((k) => lerp(BELLY[k], FOG_BELLY[k], fog));
    bellyMat.emissive = BELLY_E.map((v) => v * (1 - fog));
    for (const f of fins) f.mat.color = [0, 1, 2].map((k) => lerp(FIN[k], FOG_BODY[k], fog));
    glowMesh.userData.op = 1 - fog * 0.92;
  };
  W.setFogged = (v) => { fog = clamp(v, 0, 1); applyFog(); };
  applyFog();
  // ---- bending: vertical travelling wave, amplitude grows toward the tail
  const bend = { A: 0.12, ph: 0, k: 0.55 };
  const spineY = (z) => { const wz = clamp((1.2 - z) / 6, 0, 1); return bend.A * wz * wz * Math.sin(bend.ph - z * bend.k); };
  // the spine curve is sampled once per frame into a small z-table; vertices interpolate it (no trig per vertex)
  const BENT = [hull, belly, starB, glowB];
  let zMin = Infinity, zMax = -Infinity;
  for (const b of BENT) for (let i = 2; i < b.p.length; i += 3) { if (b.p[i] < zMin) zMin = b.p[i]; if (b.p[i] > zMax) zMax = b.p[i]; }
  zMin -= 0.05; zMax += 0.05;
  const ZT = 160, zStep = (zMax - zMin) / ZT, invStep = 1 / zStep;
  const tDy = new Float32Array(ZT + 2), tC = new Float32Array(ZT + 2), tS = new Float32Array(ZT + 2);
  const buildSpine = () => {
    for (let k = 0; k <= ZT + 1; k++) {
      const z = zMin + k * zStep;
      const slope = (spineY(z + 0.05) - spineY(z - 0.05)) / 0.1;
      const ang = Math.atan(slope);
      tDy[k] = spineY(z); tC[k] = Math.cos(ang); tS[k] = Math.sin(ang);
    }
  };
  const bendInto = (b) => {
    const src = b.p, srcN = b.n, dst = b.geo.attributes.position.array, dstN = b.geo.attributes.normal.array;
    for (let i = 0; i < src.length; i += 3) {
      const y = src[i + 1], z = src[i + 2];
      const t = (z - zMin) * invStep, k = t | 0, f = t - k;
      const dy = tDy[k] + (tDy[k + 1] - tDy[k]) * f, c = tC[k] + (tC[k + 1] - tC[k]) * f, s = tS[k] + (tS[k + 1] - tS[k]) * f;
      // rotate (y,z) about the spine point so cross-sections stay perpendicular to the spine
      dst[i + 1] = dy + y * c; dst[i + 2] = z - y * s;
      const ny = srcN[i + 1], nz = srcN[i + 2];
      dstN[i + 1] = ny * c + nz * s; dstN[i + 2] = -ny * s + nz * c;
    }
    b.geo.markDirty('position'); b.geo.markDirty('normal');
  };
  const blink = blinker();
  let T = Math.random() * 10;
  const pose = { A: 0.12, w: 1.3, roll: 0, pitch: 0, y: 0, fin: 0.2, finHz: 0.6, twk: 1, open: 0 };
  W.update = (dt, st = {}) => {
    dt = clamp(dt, 0, 0.1);
    const anim = st.anim || 'idle';
    T += dt;
    let A = 0.1, w = 1.1, roll = Math.sin(T * 0.4) * 0.03, pitch = 0, y = Math.sin(T * 0.5) * 0.12, fin = 0.25, finHz = 0.5, expr = 'normal', twk = 1, open = 0;
    switch (anim) {
      case 'swim': A = 0.32; w = 1.6; pitch = Math.sin(T * 1.6 - 0.8) * 0.035; y = Math.sin(T * 1.6) * 0.18; fin = 0.45; finHz = 0.8; break;
      case 'sleep': A = 0.035; w = 0.5; expr = 'sleep'; y = Math.sin(T * 0.35) * 0.08; fin = 0.1; finHz = 0.25; twk = 0.55; roll = 0.06; break;
      case 'happy': A = 0.38; w = 2.6; expr = 'happy'; open = 1; roll = Math.sin(T * 1.8) * 0.12; y = Math.abs(Math.sin(T * 2.6)) * 0.35; fin = 0.7; finHz = 1.6; twk = 1.5; break;
      default: break; // idle: gentle hover
    }
    pose.A = approach(pose.A, A, 2, dt); pose.w = approach(pose.w, w, 2, dt);
    pose.roll = approach(pose.roll, roll, 3, dt); pose.pitch = approach(pose.pitch, pitch, 3, dt); pose.y = approach(pose.y, y, 3, dt);
    pose.fin = approach(pose.fin, fin, 3, dt); pose.finHz = approach(pose.finHz, finHz, 2, dt); pose.twk = approach(pose.twk, twk, 3, dt);
    pose.open = approach(pose.open, open, 8, dt);
    bend.A = pose.A; bend.ph += dt * pose.w * TAU * 0.5;
    rig.position.y = pose.y; rig.rotation.set(pose.pitch, 0, pose.roll);
    // distant/background whales (st.lod = n) re-bend only every n-th frame
    W._lodN = (W._lodN || 0) + 1;
    if (!st.lod || W._lodN % st.lod === 0) { buildSpine(); for (const b of BENT) bendInto(b); }
    // twinkle (per-star vertex colours)
    const sc = starB.geo.attributes.color.array, gc = glowB.geo.attributes.color.array;
    for (let s = 0; s < stars.length; s++) {
      const S = stars[s];
      const tw = clamp(0.78 + 0.22 * Math.sin(T * S.sp * pose.twk + S.tw), 0, 1) * (1 - fog * 0.12);
      const r = lerp(STAR[0], 0.84, fog) * tw, g = lerp(STAR[1], 0.82, fog) * tw, b = lerp(STAR[2], 0.9, fog) * tw, gk = tw * tw * (1 - fog);
      for (let v = s * vPerStar * 3, e = v + vPerStar * 3; v < e; v += 3) { sc[v] = r; sc[v + 1] = g; sc[v + 2] = b; gc[v] = gk; gc[v + 1] = gk; gc[v + 2] = gk; }
    }
    starB.geo.markDirty('color'); glowB.geo.markDirty('color');
    for (const f of fins) { f.piv.rotation.z = f.sd * (-0.25 + Math.sin(T * pose.finHz * TAU) * pose.fin); f.piv.rotation.x = Math.sin(T * pose.finHz * TAU + 1) * pose.fin * 0.3; }
    eyes.set(expr);
    blink(eyes, dt, expr === 'normal');
    mouthOpen.visible = pose.open > 0.1;
    mouthOpen.scale.set(0.42, 0.24 * pose.open, 0.1);
    W.syncFx([glowMesh]);
  };
  W.length = 9.0; W.height = 3.4; W.radius = 2.2; W.centerY = 0;
  W.update(1 / 60, { anim: 'idle' });
  return W;
}

// ============================================================================
// Noa 노아 — the lost little star
// ============================================================================
// puffy core: rounded pentagon blob (the five points are separate lobes so arms/legs can bend)
function noaCoreGeo() {
  return cg('noaCore3', () => {
    const o = [];
    const N = 80, rIn = 0.2, rOut = 0.235;
    for (let i = 0; i < N; i++) {
      const a = PI / 2 + (i / N) * TAU;
      const k = (1 + Math.cos(5 * (a - PI / 2))) / 2;
      const r = rIn + (rOut - rIn) * k;
      o.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return G.puffyShapeGeo(o, 0.175, 9, 0.5);
  });
}
// a chubby rounded star point (lobe) pointing +y; thickest at its root (origin)
function noaLobeGeo() {
  return cg('noaLobe4', () => {
    const o = [];
    for (let i = 0; i < 48; i++) {
      const a = -PI / 2 + (i / 48) * TAU, c = Math.cos(a), s = Math.sin(a);
      // y from -0.35 (root, inside the core) to 1 (tip); width tapers with a rounded tip
      const y = s > 0 ? s : s * 0.35;
      const t = clamp((y + 0.35) / 1.35, 0, 1);
      const w = 0.56 * Math.pow(1 - t, 0.6) * (1 - 0.1 * t) + 0.05;
      o.push([c * w, y]);
    }
    const g = G.puffyShapeGeo(o, 0.46, 8, 0.48);
    g.computeBoundingSphere();
    return g;
  });
}

export function buildNoa() {
  const N = { root: new Node('noa') };
  opacityApi(N);
  const CY = 0.36;
  const base = grp(N.root, 'base', [0, CY, 0]);
  const yellow = rgb(0xffcc2e), gray = rgb(0xa8a3b6);
  const bodyMat = new Material({ color: 0xffcc2e, spec: 0.35, rim: 0.45, emissive: 0x2a1c00 });
  // core body + five point lobes (top = static head point, sides = arms, bottom = legs)
  add(base, noaCoreGeo, bodyMat);
  const lobe = (name, angDeg, len, w) => {
    const a = (angDeg * PI) / 180;
    const piv = grp(base, name, [Math.cos(a) * 0.165, Math.sin(a) * 0.165, 0], [0, 0, a - PI / 2]);
    add(piv, noaLobeGeo, bodyMat, { s: [w, len, 0.33] });
    return piv;
  };
  const top = lobe('top', 90, 0.2, 0.23);
  const armL = lobe('armL', 90 + 72, 0.19, 0.22);
  const armR = lobe('armR', 90 - 72, 0.19, 0.22);
  const legL = lobe('legL', 90 + 144, 0.19, 0.22);
  const legR = lobe('legR', 90 - 144, 0.19, 0.22);
  const rest = { aL: armL.rotation.z, aR: armR.rotation.z, lL: legL.rotation.z, lR: legR.rotation.z, top: top.rotation.z };
  // face (front of the puffy core): approximate sphere for the face parts
  const FR = 0.4;
  const face = grp(base, 'face', [0, 0.0, 0.17 - FR]);
  const eyes = makeEyes(face, { headR: FR, yaw: 11.5, pitch: 5, size: 0.66 });
  makeCheeks(face, { headR: FR * 0.996, yaw: 20, pitch: -3.5, size: 0.55, color: 0xff8f86 });
  const mouth = makeMouth(face, { headR: FR, pitch: -7, size: 0.66 });
  trimFace(eyes, mouth);
  // little shine on the top point
  add(base, UNIT.sphere, MU(0xffffff, { transparent: true, opacity: 0.75, depthWrite: false }), { p: [-0.05, 0.23, 0.12], r: [0, 0, 0.5], s: [0.025, 0.04, 0.01] });
  // glow halo (bright state)
  const halo = add(base, () => invSphereGeo('invSphere'), glowMat(0xffc840), { s: 0.45 });
  halo.userData.op = 0.6;
  const halo2 = add(base, () => invSphereGeo('invSphere'), glowMat(0xfff0a8), { s: 0.38 });
  halo2.userData.op = 0.5;
  // tears (cry)
  const tearMat = M(0x9fd6ff, { transparent: true, opacity: 0.9, spec: 0.7, rim: 0.6, depthWrite: false });
  const tears = [-1, 1].map((sd) => { const t = add(face, UNIT.sphere, tearMat); t.userData.op = 0; t.userData.sd = sd; return t; });
  // sparkles (happy)
  const sparkleGeo = () => cg('noaSparkle', () => G.puffyShapeGeo(G.starOutline(4, 0.5, 0.13, 4), 0.06, 3, 0.6));
  const sparkles = [0, 1].map((i) => { const s = add(N.root, sparkleGeo, MU(i === 1 ? 0xfff3b0 : 0xffffff, { transparent: true, opacity: 1, depthWrite: false }), { s: 0.05 }); s.userData.op = 0; return s; });
  // state
  let grayV = 0;
  const applyGray = () => {
    const c = [lerp(yellow[0], gray[0], grayV), lerp(yellow[1], gray[1], grayV), lerp(yellow[2], gray[2], grayV)];
    bodyMat.color = c;
    const e = 1 - grayV;
    bodyMat.emissive = [0.2 * e, 0.12 * e, 0.0];
  };
  N.setGray = (v) => { grayV = clamp(v, 0, 1); applyGray(); };
  applyGray();
  const blink = blinker();
  const sq = new Spring(160, 9);
  let T = Math.random() * 10, last = '', animT = 0;
  const pose = { y: 0, roll: 0, lean: 0, yaw: 0, aL: 0, aR: 0, lL: 0, lR: 0, shake: 0, spin: 0 };
  N.update = (dt, st = {}) => {
    dt = clamp(dt, 0, 0.1);
    const anim = st.anim || 'idle';
    T += dt;
    if (anim !== last) { if (anim === 'happy' || anim === 'hug') sq.kick(2.2); last = anim; animT = 0; } else animT += dt;
    const t = st.t ?? animT;
    let y = 0.06 + Math.sin(T * 1.8) * 0.04, roll = Math.sin(T * 1.1) * 0.08, lean = 0, yaw = 0;
    let aL = Math.sin(T * 1.8) * 0.12, aR = -Math.sin(T * 1.8) * 0.12, lL = Math.sin(T * 1.8 + 1) * 0.1, lR = -Math.sin(T * 1.8 + 1) * 0.1;
    let shake = 0, expr = 'normal', mo = 'smile', tearOn = 0, spark = 0, spin = 0;
    switch (anim) {
      case 'cry':
        expr = 'sad'; mo = Math.sin(T * 9) > 0 ? 'open' : 'frown'; shake = 1; y = 0.03 + Math.sin(T * 2.2) * 0.015;
        aL = -0.95 + Math.sin(T * 14) * 0.12; aR = 0.95 - Math.sin(T * 14 + 1) * 0.12; // little arms rub the eyes
        lL = 0.15; lR = -0.15; tearOn = 1; roll = 0;
        break;
      case 'happy': {
        expr = 'happy'; mo = 'open'; spark = 1;
        const u = (T * 1.8) % 1; y = 0.08 + Math.abs(Math.sin(u * PI)) * 0.14; spin = (t % 2.2) < 0.7 ? Ease.inOutSine((t % 2.2) / 0.7) * TAU : 0;
        aL = 0.6 + Math.sin(T * 12) * 0.2; aR = -0.6 - Math.sin(T * 12) * 0.2; lL = Math.sin(T * 10) * 0.35; lR = -Math.sin(T * 10 + 1) * 0.35;
        break;
      }
      case 'hug': expr = 'happy'; mo = 'open'; aL = 0.85 + Math.sin(T * 3) * 0.05; aR = -0.85 - Math.sin(T * 3) * 0.05; lean = 0.12; lL = 0.12; lR = -0.12; roll = 0; y = 0.07 + Math.sin(T * 2) * 0.02; break;
      case 'sleep': expr = 'sleep'; mo = 'o'; y = 0.02 + Math.sin(T * 0.9) * 0.02; roll = 0.32 + Math.sin(T * 0.9) * 0.03; aL = -0.25; aR = 0.25; lL = -0.1; lR = 0.1; break;
      default: break;
    }
    pose.y = approach(pose.y, y, 10, dt); pose.roll = approach(pose.roll, roll, 6, dt); pose.lean = approach(pose.lean, lean, 6, dt); pose.yaw = approach(pose.yaw, yaw, 6, dt);
    pose.aL = approach(pose.aL, aL, 12, dt); pose.aR = approach(pose.aR, aR, 12, dt); pose.lL = approach(pose.lL, lL, 10, dt); pose.lR = approach(pose.lR, lR, 10, dt);
    pose.shake = approach(pose.shake, shake, 10, dt);
    if (spin > 0) pose.spin = spin; else { const tg = Math.round(pose.spin / TAU) * TAU; pose.spin = approach(pose.spin, tg, 8, dt); }
    const s = sq.update(0, dt);
    const sy = 1 + s + Math.sin(T * 2.6) * 0.02, sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    const jitter = pose.shake * Math.sin(T * 47) * 0.012;
    base.position.set(jitter, CY + pose.y, 0);
    base.rotation.set(pose.lean, pose.yaw + pose.spin, pose.roll + pose.shake * Math.sin(T * 31) * 0.04);
    base.scale.set(sxz, sy, sxz);
    armL.rotation.z = rest.aL + pose.aL; armR.rotation.z = rest.aR + pose.aR;
    top.rotation.z = rest.top + Math.sin(T * 1.6) * 0.05 * (1 - pose.shake);
    legL.rotation.z = rest.lL + pose.lL; legR.rotation.z = rest.lR + pose.lR;
    eyes.set(expr);
    blink(eyes, dt, expr === 'normal' || expr === 'sad');
    mouth.set(mo);
    // tears
    for (const tr of tears) {
      const u = ((T * 1.1 + (tr.userData.sd > 0 ? 0.45 : 0)) % 1);
      tr.userData.op = tearOn * (u < 0.8 ? 1 : (1 - u) / 0.2);
      const p = onSphere(FR * 1.01, tr.userData.sd * 13.5, -2 - u * 13);
      tr.position.set(p[0] + tr.userData.sd * u * 0.02, p[1], p[2] + 0.004);
      const k = 0.014 + 0.007 * u; tr.scale.set(k, k * 1.3, k);
    }
    // glow
    const bright = 1 - grayV;
    halo.userData.op = bright * (0.45 + 0.1 * Math.sin(T * 2.2)) * (anim === 'sleep' ? 0.6 : 1);
    halo2.userData.op = bright * (0.35 + 0.08 * Math.sin(T * 3.1));
    const hs = 0.45 + 0.03 * Math.sin(T * 2.2); halo.scale.set(hs, hs, hs);
    // sparkles
    sparkles.forEach((sp, i) => {
      const a = (i ? -1 : 1) * T * 1.7 + i * PI;
      const tw = Math.max(0, Math.sin(T * 5 + i * 2.1));
      sp.userData.op = spark * tw * bright + spark * tw * 0.4 * grayV;
      sp.position.set(Math.cos(a) * 0.42, CY + pose.y + Math.sin(a * 1.3) * 0.18, Math.sin(a) * 0.3);
      const k = 0.03 + 0.04 * tw; sp.scale.set(k, k, k); sp.rotation.set(0, -a, T * 2);
    });
    N.syncFx([halo, halo2, ...tears, ...sparkles]);
  };
  N.height = 0.72; N.radius = 0.36; N.centerY = CY;
  N.update(1 / 60, { anim: 'idle' });
  return N;
}

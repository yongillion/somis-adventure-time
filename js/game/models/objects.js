// ============================================================================
// models/objects.js — interactive / animated level objects
//
//   buildObject(type, opts) -> { root, type, update(dt), ...methods }
//     Gameplay owns `root` (position / rotation / scale); every animation runs on child nodes.
//     Call update(dt) every frame (windFan / pinwheel: update(dt, speed)).
//   starCandyGeo(color = gold) -> vertex-colored Geometry for InstancedMesh (origin center, ~0.33 wide).
//     Pass 0xffffff and use InstancedMesh.setColorAt for per-instance candy colors.
//   OBJECT_TYPES -> list of supported types
//
// Origins follow docs/SPEC-props.md ("base" = bottom center on the ground, "center" = geometric center).
// Methods / extra fields (beyond the spec table):
//   lantern       setLit(bool) 0.6s, .lit                       cage        hit(), break(), .broken, .hits (root hidden after shatter)
//   floorSwitch   setPressed(bool), .pressed                    crystalSwitch setOn(bool), hit(), .on
//   gate          setOpen(t), .open, .w, .h                     lockDoor    setOpen(t) (lock pops 0..0.3, doors swing away from +Z)
//   springPad     bounce(k=1)                                   starCannon  aim(yaw, pitch), fire(), .muzzle (Node at the barrel mouth)
//   saw           .r, .speed (opts.speed rad/s)                 spikeTrap   setRaised(t), .raised
//   crusher       setFace('sleep'|'angry'), .face               firebar     .balls (ball i at x = i * spacing; ball 0 sits on the pivot)
//   laserEmitter  setBeam(on, length) (beam starts at z≈0.3, grows quickly), .on, .length
//   windFan       update(dt, speed), setSpeed(s)                pinwheel    update(dt, speed)
//   breakRock     hit() shake, break(), .broken                 breakCrate  break(), .broken
//   thornVine     burn(), .burnt                                iceBlock    melt(), .melted
//   torch         setLit(bool), .lit                            seedSprout  setGrowth(t), .growth (t=1: flower top exactly at y = h, radius r)
//   drum          hit(), .color                                 target      hit(), setDone(), .done
//   mailbox       open(), close(), .opened                      nest        setEggs(n 0..3) (opts.eggs)
//   bell          ring(k=1)                                     dreamLight  .orb (floating orb Node)
//   cookieBase    .top (Node on the cookie top for the animal head)
// Breakables / burn / melt hide `root` when their animation ends.
// ============================================================================
import { Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { Ease, TAU, PI, lerp, clamp, smoothstep, RNG, moveToward, valueNoise2 } from '../../engine/math.js';
import { M, MG, MU, MGlow, add, grp, Spring, setOpacity, SOFT, GLOSS } from './common.js';
import {
  tubeGeo, leafGeo, lumpGeo, boulderGeo, latheD, prismBody, prismTip, roundStarOutline, petalOutline,
  roundPoly, softGlowMaterial, col, mixc, lit as lighten, dim, mk, faceN, sph, ico, cyl, tor, box, rbox, disc,
} from './props.js';

// ---------------------------------------------------------------- helpers
const K = (k, fn) => G.cachedGeo('ob:' + k, fn);
const pmat = (color, o = {}) => new Material({ color, ...SOFT, ...o });
const pmatG = (color, o = {}) => new Material({ color, ...GLOSS, ...o });
const lerpC = (m, a, b, t, key = 'color') => { a = col(a); b = col(b); const o = m[key]; o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); };
const setE = (m, c, k = 1) => { const a = col(c); m.emissive[0] = a[0] * k; m.emissive[1] = a[1] * k; m.emissive[2] = a[2] * k; };
const GLOWM = (c, o) => softGlowMaterial(c, o);
const glowInst = (c, o = {}) => new Material({ shader: 'softGlow', transparent: true, blending: 'additive', depthWrite: false, fog: false, rim: 1.7, opacity: 1, color: c, ...o });
const m4 = (p, r, s) => mk(p, r, s);
const merge = (items) => G.mergeGeometries(items.map((it) => ({ geo: typeof it.geo === 'function' ? it.geo() : it.geo, matrix: it.m || null, color: col(it.c ?? 0xffffff) })));
const VCs = (o = {}) => M(0xffffff, { vertexColors: true, ...o });
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const starGeo = () => K('star', () => G.puffyShapeGeo(roundStarOutline(5, 0.5, 0.27, 40, 1.4), 0.2, 3));
const starFlat = () => K('starFlat', () => G.puffyShapeGeo(roundStarOutline(5, 0.5, 0.27, 20, 1.3), 0.12, 1));
const sparkGeo = () => K('spark4', () => G.puffyShapeGeo(roundStarOutline(4, 0.5, 0.1, 32, 3), 0.05, 1));
const heartGeo = () => K('heart', () => G.puffyShapeGeo(G.heartOutline(0.5, 40), 0.22, 4));
const heartFlat = () => K('heartFlat', () => G.puffyShapeGeo(G.heartOutline(0.5, 20), 0.1, 1));
const colored = (g, fn) => { g = g.clone(); g.colorBy(fn); return g; };
function rot(n, x, y, z) { n.rotation.set(x, y, z); return n; }
// flying debris helper: pieces [{node, v:[x,y,z], w:[x,y,z]}]
function debris(pieces, dt, g = 9) {
  for (const p of pieces) {
    p.v[1] -= g * dt;
    p.node.position.x += p.v[0] * dt; p.node.position.y += p.v[1] * dt; p.node.position.z += p.v[2] * dt;
    p.node.rotation.x += p.w[0] * dt; p.node.rotation.y += p.w[1] * dt; p.node.rotation.z += p.w[2] * dt;
  }
}

const B = {};

// ============================================================================ lantern (checkpoint "꿈 등불")
B.lantern = (o) => {
  const root = new Node('lantern');
  const lc = col(o.color ?? 0xffd36b);
  const S0 = 0xb5b0c6, S1 = 0xfff2e6, T0 = 0x9c97b0, T1 = 0xffb6d2;
  const mStone = pmat(S0), mTrim = pmat(T0, { spec: 0.25 });
  const mCrys = pmatG(0xa29dbb, { emissive: 0x0c0a14, spec: 0.5 });
  const body = grp(root, 'body');
  add(body, K('lanPed', () => latheD([[0, 0], [0.36, 0], [0.38, 0.05], [0.36, 0.12], [0.22, 0.16], [0.16, 0.24], [0.14, 0.78], [0.2, 0.84], [0.27, 0.9], [0.27, 0.96], [0, 0.96]], 16)), mStone, { name: 'stone' });
  add(body, tor(0.3, 6, 18), mTrim, { p: [0, 0.2, 0], r: [PI / 2, 0, 0], s: 0.19 });
  add(body, tor(0.3, 6, 18), mTrim, { p: [0, 0.82, 0], r: [PI / 2, 0, 0], s: 0.17 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + PI / 4;
    add(body, cyl(6), mTrim, { p: [Math.sin(a) * 0.2, 0.95, Math.cos(a) * 0.2], s: [0.024, 0.42, 0.024] });
  }
  add(body, K('lanRoof', () => latheD([[0, 1.34], [0.3, 1.34], [0.31, 1.38], [0.22, 1.45], [0.1, 1.53], [0.02, 1.57], [0, 1.575]], 16)), mStone);
  add(body, starFlat(), mTrim, { p: [0, 1.64, 0], s: [0.14, 0.14, 0.3] });
  const piv = grp(root, 'crystal', [0, 1.15, 0]);
  const crys = add(piv, K('lanCrys', () => G.crystalGeo(0.105, 0.17, 0.17, 6)), mCrys);
  const starM = MU(lc);
  const star = add(piv, starGeo(), starM, { s: 0.001 });
  const core = add(star, sph(10, 7), MU(lighten(lc, 0.75)), { p: [0, 0, 0.06], s: [0.12, 0.12, 0.06] });
  void core;
  const halo = add(piv, ico(2), glowInst(dim(lc, 0.55)), { s: 0.5 });
  halo.visible = false;
  const ring = add(root, tor(0.08, 6, 24), MGlow(lc), { p: [0, 1.15, 0], r: [PI / 2, 0, 0], s: 0.1 });
  ring.visible = false;
  let isLit = !!o.lit, k = isLit ? 1 : 0, t = Math.random() * 5, burst = 0, spinV = 0;
  const api = {
    root, type: 'lantern',
    get lit() { return isLit; },
    setLit(v) { v = !!v; if (v && !isLit) { burst = 1; spinV = 14; } isLit = v; },
    update(dt) {
      t += dt;
      k = moveToward(k, isLit ? 1 : 0, dt / 0.6);
      const e = Ease.inOutSine(k);
      lerpC(mStone, S0, S1, e); lerpC(mTrim, T0, T1, e);
      lerpC(mCrys, 0xa29dbb, lighten(lc, 0.4), e); lerpC(mCrys, [0.05, 0.04, 0.08], dim(lc, 0.35), e, 'emissive');
      piv.position.y = 1.15 + Math.sin(t * 2) * 0.025;
      spinV = moveToward(spinV, 0, dt * 18);
      piv.rotation.y += dt * (0.8 + spinV);
      const cs = clamp(1 - Ease.inCubic(clamp(k * 1.6, 0, 1)), 0, 1);
      crys.visible = cs > 0.01; crys.scale.set(cs, cs, cs);
      const ss = k > 0.2 ? Ease.outBack(clamp((k - 0.2) / 0.8, 0, 1)) * 0.36 : 0.001;
      star.visible = k > 0.2; star.scale.set(ss, ss, ss);
      halo.visible = k > 0.05;
      halo.opacity = e * (0.6 + 0.2 * Math.sin(t * 3));
      const hs = 0.46 + 0.05 * Math.sin(t * 3);
      halo.scale.set(hs, hs, hs);
      if (burst > 0) {
        burst = Math.max(0, burst - dt * 1.4);
        ring.visible = burst > 0;
        const rs = 0.2 + (1 - burst) * 1.6;
        ring.scale.set(rs, rs, rs); ring.opacity = burst;
      }
    },
  };
  api.update(0);
  return api;
};

// ============================================================================ cage (fog bubble cage)
B.cage = (o) => {
  const root = new Node('cage');
  const inner = grp(root, 'inner');
  const fogC = 0x8a83a6, fogL = 0xb7b0cf;
  add(inner, K('cageBase', () => latheD([[0, 0], [0.56, 0], [0.6, 0.04], [0.58, 0.1], [0.5, 0.14], [0, 0.14]], 18)), M(0x7d7698));
  add(inner, tor(0.25, 6, 20), M(fogL), { p: [0, 0.13, 0], r: [PI / 2, 0, 0], s: 0.5 });
  const R = 0.56, cy = 0.69;
  const bubbleM = pmatG(0xc9c2e6, { transparent: true, opacity: 0.32, depthWrite: false, spec: 0.7, rim: 0.7 });
  const bubble = add(inner, sph(24, 16), bubbleM, { p: [0, cy, 0], s: R });
  bubble.renderOrder = 2;
  const shine = add(inner, K('cageShine', () => G.torusGeo(1, 0.07, 5, 12, PI * 0.45)), MU(0xffffff, { transparent: true, opacity: 0.8 }), { p: [0, cy, 0], r: [0.2, 0.6, 1.9], s: R * 0.86 });
  shine.renderOrder = 3;
  const bars = grp(inner, 'bars');
  const barM = M(fogC);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + PI / 6, pts = [];
    for (let k = 0; k <= 8; k++) { const e = -PI / 2 + 0.25 + (k / 8) * (PI - 0.4); pts.push([Math.sin(a) * Math.cos(e) * R * 1.03, cy + Math.sin(e) * R * 1.03, Math.cos(a) * Math.cos(e) * R * 1.03]); }
    add(bars, K('cageBar' + i, () => tubeGeo(pts, 0.04, 6, { round: true })), barM);
  }
  const fog = grp(inner, 'fogTop', [0, cy + R - 0.04, 0]);
  const fogM = M(0x9f98bb);
  for (const [x, y, z, s] of [[0, 0.04, 0, 0.15], [0.12, 0.01, 0.04, 0.11], [-0.11, 0.02, -0.04, 0.11], [0.02, 0.0, 0.13, 0.1], [-0.03, 0.01, -0.13, 0.1], [0.02, 0.13, 0, 0.08]]) add(fog, ico(1), fogM, { p: [x, y, z], s });
  const swirl = [];
  for (let i = 0; i <= 14; i++) { const a = i * 0.55, r = 0.09 * (1 - i / 18); swirl.push([Math.cos(a) * r, 0.17 + i * 0.008, Math.sin(a) * r]); }
  add(fog, K('cageSwirl2', () => tubeGeo(swirl, 0.025, 5, { round: true })), M(0x6f6890));
  // cracks
  const crackM = MU(0xffffff);
  const cracks = [grp(inner, 'crack1'), grp(inner, 'crack2')];
  const crackPath = (yaw, pitch, seed, len) => {
    const r = new RNG(seed); const pts = []; let a = yaw, e = pitch;
    for (let k = 0; k <= 5; k++) { pts.push([Math.sin(a) * Math.cos(e) * R * 1.005, cy + Math.sin(e) * R * 1.005, Math.cos(a) * Math.cos(e) * R * 1.005]); a += r.range(-0.25, 0.25) * len; e += (k % 2 ? 0.18 : -0.12) * len; }
    return tubeGeo(pts, 0.012, 3);
  };
  const cg = (k, ...a) => K('cageCrack' + k, () => crackPath(...a));
  add(cracks[0], cg(1, 0.1, 0.25, 3, 1), crackM); add(cracks[0], cg(2, 0.3, 0.2, 5, 0.7), crackM);
  add(cracks[1], cg(3, -0.5, -0.1, 7, 1.1), crackM); add(cracks[1], cg(4, 0.9, 0.45, 9, 0.9), crackM); add(cracks[1], cg(5, -0.2, 0.6, 11, 0.8), crackM);
  cracks.forEach((c) => (c.visible = false));
  // shards for the break
  const shardG = K('shard', () => G.crystalGeo(0.09, 0.05, 0.05, 3));
  const shards = [];
  const shardM = pmatG(0xd8d2f0, { transparent: true, opacity: 0.85, spec: 0.8 });
  const rr = new RNG(42);
  for (let i = 0; i < 14; i++) {
    const a = rr.next() * TAU, e = rr.range(-0.8, 1.2);
    const n = add(root, shardG, shardM, { p: [0, 0, 0], s: rr.range(0.8, 1.6) });
    n.visible = false;
    shards.push({ node: n, d: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)], v: [0, 0, 0], w: [rr.range(-9, 9), rr.range(-9, 9), rr.range(-9, 9)] });
  }
  const puffs = [];
  for (let i = 0; i < 6; i++) { const n = add(root, ico(1), M(0xb3acc9), { s: 0.1 }); n.visible = false; puffs.push(n); }
  const sq = new Spring(160, 9), wob = new Spring(120, 6);
  let hits = 0, broken = false, bt = -1, t = Math.random() * 6;
  const api = {
    root, type: 'cage', get broken() { return broken; }, get hits() { return hits; },
    hit() {
      if (broken) return;
      hits++; sq.kick(-3.2); wob.kick(5);
      cracks[0].visible = hits >= 1; cracks[1].visible = hits >= 2;
      for (const m of [bubble]) m.flash = 0.6;
    },
    break() {
      if (broken) return;
      broken = true; bt = 0;
      inner.visible = false;
      for (const s of shards) {
        s.node.visible = true;
        s.node.position.set(s.d[0] * R, cy + s.d[1] * R, s.d[2] * R);
        const sp = 2.5 + Math.random() * 2.5;
        s.v = [s.d[0] * sp, s.d[1] * sp + 2.5, s.d[2] * sp];
      }
      puffs.forEach((p, i) => { const a = (i / puffs.length) * TAU; p.visible = true; p.position.set(Math.sin(a) * 0.3, cy + 0.2, Math.cos(a) * 0.3); p.userData.v = [Math.sin(a) * 1.6, 1.2, Math.cos(a) * 1.6]; });
    },
    update(dt) {
      t += dt;
      if (!broken) {
        const s = sq.update(0, dt), w = wob.update(0, dt);
        inner.scale.set(1 - s * 0.08, 1 + s * 0.12, 1 - s * 0.08);
        inner.rotation.z = w * 0.03 + Math.sin(t * 1.3) * 0.01;
        fog.rotation.y = t * 0.6;
        fog.position.y = cy + R - 0.04 + Math.sin(t * 2.2) * 0.02;
        if (bubble.flash > 0) bubble.flash = Math.max(0, bubble.flash - dt * 3);
        return;
      }
      if (bt < 0) return;
      bt += dt;
      debris(shards, dt, 7);
      const f = clamp(1 - (bt - 0.3) / 0.5, 0, 1);
      shardM.opacity = 0.85 * f;
      puffs.forEach((p) => {
        const v = p.userData.v; p.position.x += v[0] * dt; p.position.y += v[1] * dt; p.position.z += v[2] * dt;
        const s = 0.1 + bt * 0.4; p.scale.set(s, s, s); p.opacity = f;
      });
      if (bt > 0.85) { root.visible = false; bt = -1; }
    },
  };
  return api;
};

// ============================================================================ floorSwitch
B.floorSwitch = (o) => {
  const root = new Node('floorSwitch');
  add(root, K('fsBase', () => latheD([[0, 0], [0.58, 0], [0.6, 0.04], [0.58, 0.11], [0.5, 0.13], [0, 0.13]], 24)), M(0xc9c3dc));
  add(root, tor(0.18, 6, 24), MG(0xffcf4d, { spec: 0.5 }), { p: [0, 0.125, 0], r: [PI / 2, 0, 0], s: 0.5 });
  const btn = grp(root, 'button', [0, 0.11, 0]);
  const C0 = 0xff8fbf, C1 = 0x8fe6b0;
  const bm = pmatG(C0);
  add(btn, K('fsBtn', () => latheD([[0, 0], [0.45, 0], [0.47, 0.05], [0.44, 0.12], [0.36, 0.14], [0, 0.14]], 24)), bm);
  const em = pmat(0xffffff, { spec: 0.3 });
  add(btn, starFlat(), em, { p: [0, 0.145, 0], r: [-PI / 2, 0, 0], s: [0.46, 0.46, 0.25] });
  const glow = add(root, tor(0.12, 6, 28), MGlow(C1), { p: [0, 0.14, 0], r: [PI / 2, 0, 0], s: 0.56 });
  glow.visible = false;
  const sp = new Spring(260, 16);
  let pressed = false, k = 0, t = 0;
  return {
    root, type: 'floorSwitch', get pressed() { return pressed; },
    setPressed(v) { v = !!v; if (v !== pressed) sp.kick(v ? -1.2 : 1.2); pressed = v; },
    update(dt) {
      t += dt;
      const y = sp.update(pressed ? -0.085 : 0, dt);
      btn.position.y = 0.11 + y;
      k = moveToward(k, pressed ? 1 : 0, dt * 5);
      lerpC(bm, C0, C1, k);
      lerpC(em, 0xffffff, 0xfff6a0, k);
      setE(em, 0xfff2a0, k * 0.35);
      glow.visible = k > 0.02; glow.opacity = k * (0.6 + 0.3 * Math.sin(t * 5));
    },
  };
};

// ============================================================================ crystalSwitch
B.crystalSwitch = (o) => {
  const root = new Node('crystalSwitch');
  const stone = M(0xd9d3ea);
  add(root, K('csPed', () => latheD([[0, 0], [0.3, 0], [0.32, 0.06], [0.24, 0.12], [0.15, 0.2], [0.12, 0.62], [0.18, 0.7], [0.26, 0.76], [0.25, 0.8], [0, 0.78]], 16)), stone);
  add(root, tor(0.3, 6, 18), MG(0xffcf4d), { p: [0, 0.7, 0], r: [PI / 2, 0, 0], s: 0.17 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const n = grp(root, '', [Math.sin(a) * 0.17, 0.76, Math.cos(a) * 0.17], [0.55, a, 0]);
    add(n, prismBody(5, 0.7), M(0xc8c0e8), { s: [0.05, 0.16, 0.05] });
    add(n, prismTip(5, 0.7), M(0xe6e0ff), { p: [0, 0.16, 0], s: [0.05, 0.08, 0.05] });
  }
  const orbP = grp(root, 'orb', [0, 1.0, 0]);
  const OFF = 0x5fb0ff, ON = 0xff6fc0;
  const om = pmatG(OFF, { spec: 0.8, rim: 0.6, emissive: 0x10203a });
  const orb = add(orbP, sph(20, 14), om, { s: 0.2 });
  const coreM = MU(0xffffff);
  const core = add(orbP, starFlat(), coreM, { s: [0.15, 0.15, 0.3] });
  add(orbP, sph(8, 6), MU(0xffffff), { p: [-0.07, 0.08, 0.15], s: [0.04, 0.03, 0.02] });
  const halo = add(orbP, ico(2), glowInst(OFF), { s: 0.42 });
  const pop = new Spring(200, 10);
  let on = !!o.on, k = on ? 1 : 0, t = Math.random() * 5;
  return {
    root, type: 'crystalSwitch', get on() { return on; },
    setOn(v) { v = !!v; if (v !== on) pop.kick(4); on = v; },
    hit() { pop.kick(6); orb.flash = 0.8; },
    update(dt) {
      t += dt;
      k = moveToward(k, on ? 1 : 0, dt * 4);
      lerpC(om, OFF, ON, k); lerpC(om, [0.06, 0.12, 0.23], [0.25, 0.06, 0.16], k, 'emissive');
      lerpC(halo.material, OFF, ON, k);
      const s = 1 + pop.update(0, dt) * 0.12;
      orbP.scale.set(s, s, s);
      orbP.position.y = 1.0 + Math.sin(t * 2.2) * 0.03;
      core.rotation.y = t * 1.5;
      orb.rotation.y = t * 0.4;
      halo.opacity = 0.55 + 0.2 * Math.sin(t * 3);
      if (orb.flash > 0) orb.flash = Math.max(0, orb.flash - dt * 3);
    },
  };
};

// ============================================================================ gate (bars sink into the ground)
B.gate = (o) => {
  const w = num(o.w, 3), h = num(o.h, 2.5);
  const root = new Node('gate');
  const stone = M(0xd5cfe6), gold = MG(0xffcf4d, { spec: 0.5 });
  for (const sd of [-1, 1]) {
    const x = sd * (w / 2 + 0.12);
    add(root, rbox(0.42, h + 0.25, 0.42, 0.1, 2), stone, { p: [x, (h + 0.25) / 2, 0] });
    add(root, rbox(0.52, 0.16, 0.52, 0.07, 1), M(0xe8e3f6), { p: [x, h + 0.3, 0] });
    add(root, sph(10, 7), gold, { p: [x, h + 0.48, 0], s: 0.13 });
  }
  add(root, K(`gateBeam${w}_${h}`, () => tubeGeo([[-w / 2 - 0.1, h + 0.12, 0], [-w / 4, h + 0.3, 0], [0, h + 0.36, 0], [w / 4, h + 0.3, 0], [w / 2 + 0.1, h + 0.12, 0]], 0.09, 8, { round: true })), M(0xe8e3f6));
  add(root, starFlat(), gold, { p: [0, h + 0.4, 0.06], s: [0.34, 0.34, 0.35] });
  const bars = grp(root, 'bars');
  const n = Math.max(3, Math.round(w / 0.36));
  const barM = M(0xb59cf0), tipM = MG(0xffcf4d, { spec: 0.5 });
  const barG = K(`gateBar${h}`, () => latheD([[0, -0.05], [0.065, -0.05], [0.065, h - 0.22], [0.08, h - 0.2], [0.08, h - 0.15], [0, h - 0.15]], 10));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) / n) * w;
    add(bars, barG, barM, { p: [x, 0, 0] });
    add(bars, K('gateTip', () => G.crystalGeo(0.09, 0.16, 0.05, 6)), tipM, { p: [x, h - 0.12, 0] });
  }
  for (const y of [0.45, h * 0.62]) add(bars, rbox(w - 0.05, 0.1, 0.1, 0.04, 1), M(0x9f86dd), { p: [0, y, 0] });
  let open = 0;
  const api = {
    root, type: 'gate', w, h, get open() { return open; },
    setOpen(t) { open = clamp(num(t, 0), 0, 1); bars.position.y = -Ease.inOutSine(open) * (h + 0.1); bars.visible = open < 0.999; },
    update() {},
  };
  api.setOpen(num(o.open, 0));
  return api;
};

// ============================================================================ lockDoor
B.lockDoor = (o) => {
  const w = num(o.w, 2.4), h = num(o.h, 3);
  const root = new Node('lockDoor');
  const R = w / 2, hr = Math.max(0.5, h - R);
  const stone = M(0xd5cfe6);
  // frame: pillars + arch
  for (const sd of [-1, 1]) add(root, rbox(0.4, hr + 0.05, 0.5, 0.1, 2), stone, { p: [sd * (R + 0.2), (hr + 0.05) / 2, 0] });
  const arc = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * PI; arc.push([Math.cos(a) * (R + 0.2), hr + Math.sin(a) * (R + 0.2), 0]); }
  add(root, K(`ldArc${w}_${h}`, () => tubeGeo(arc, 0.22, 8, { round: true, prof: (a) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25), phase: PI / 4 })), stone);
  add(root, starFlat(), MG(0xffcf4d), { p: [0, hr + R + 0.2, 0.2], s: [0.36, 0.36, 0.4] });
  // door leaves
  const wood = M(0xb88cd8), woodD = M(0x9a70c0), gold = MG(0xffcf4d, { spec: 0.5 });
  const leafOutline = () => {
    const pts = [[0, 0], [R, 0], [R, hr + R * 0.98]];
    for (let i = 1; i <= 8; i++) { const a = PI / 2 + (i / 8) * (PI / 2); pts.push([R + Math.cos(a) * R * 0.98, hr + Math.sin(a) * R * 0.98]); }
    return pts;
  };
  const leafG = K(`ldLeaf${w}_${h}`, () => G.extrudeGeo(leafOutline(), 0.14));
  const leaves = [];
  for (const sd of [-1, 1]) {
    const hinge = grp(root, sd < 0 ? 'leafL' : 'leafR', [sd * R, 0, 0]);
    const inner = grp(hinge, '', [0, 0, 0], [0, sd < 0 ? 0 : PI, 0]);
    add(inner, leafG, wood, { p: [0, 0, sd < 0 ? 0 : 0] });
    for (let k = 1; k < 3; k++) add(inner, box(), woodD, { p: [(k / 3) * R, (hr + R * 0.6) / 2, sd < 0 ? 0.075 : -0.075], s: [0.03, hr + R * 0.5, 0.02] });
    for (const y of [0.5, hr - 0.2]) add(inner, box(), gold, { p: [R * 0.5, y, sd < 0 ? 0.08 : -0.08], s: [R * 0.9, 0.08, 0.03] });
    add(inner, sph(8, 6), gold, { p: [R * 0.85, hr * 0.5, sd < 0 ? 0.1 : -0.1], s: 0.06 });
    leaves.push({ hinge, sd });
  }
  // padlock
  const lock = grp(root, 'lock', [0, hr * 0.55, 0.16]);
  const lockM = MG(0xffcf4d, { spec: 0.6, emissive: 0x221800 });
  add(lock, rbox(0.5, 0.42, 0.18, 0.1, 2), lockM);
  add(lock, K('shackle', () => G.torusGeo(0.15, 0.04, 6, 14, PI)), MG(0xd8dcef, { spec: 0.6 }), { p: [0, 0.2, 0] });
  for (const sd of [-1, 1]) add(lock, cyl(6), MG(0xd8dcef), { p: [sd * 0.15, 0.12, 0], s: [0.04, 0.09, 0.04] });
  add(lock, starFlat(), M(0x7a4fb0), { p: [0, 0.0, 0.095], s: [0.2, 0.2, 0.2] });
  let open = 0, t = 0;
  const api = {
    root, type: 'lockDoor', w, h, get open() { return open; },
    setOpen(v) { open = clamp(num(v, 0), 0, 1); },
    update(dt) {
      t += dt;
      const lk = clamp(open / 0.3, 0, 1);
      const ls = lk < 0.5 ? 1 + Math.sin(lk * 40) * 0.05 * (lk * 2) : Math.max(0, 1 - Ease.inBack((lk - 0.5) * 2));
      lock.visible = ls > 0.01; lock.scale.set(ls, ls, ls);
      lock.rotation.z = lk < 0.5 ? Math.sin(lk * 50) * 0.1 : 0;
      const d = Ease.inOutCubic(clamp((open - 0.25) / 0.75, 0, 1));
      for (const L of leaves) L.hinge.rotation.y = -L.sd * d * 1.75;
    },
  };
  api.update(0);
  return api;
};

// ============================================================================ key
B.key = (o) => {
  const root = new Node('key');
  const piv = grp(root, 'spin');
  const tilt = grp(piv, 'tilt', [0, 0, 0], [0, 0, -0.35]);
  const gold = MG(0xffcf3d, { spec: 0.7, rim: 0.5, emissive: 0x2a1a00 });
  add(tilt, starGeo(), gold, { p: [0, 0.14, 0], s: [0.32, 0.32, 0.42] });
  add(tilt, starFlat(), MG(0xff7fb4, { spec: 0.7 }), { p: [0, 0.14, 0.05], s: [0.13, 0.13, 0.22] });
  add(tilt, sph(8, 6), MU(0xffffff), { p: [-0.06, 0.2, 0.08], s: [0.03, 0.02, 0.012] });
  add(tilt, tubeGeo([[0, 0.02, 0], [0, -0.3, 0]], 0.034, 8, { round: true }), gold);
  add(tilt, tor(0.3, 5, 12), gold, { p: [0, 0.0, 0], r: [PI / 2, 0, 0], s: 0.05 });
  add(tilt, rbox(0.12, 0.06, 0.05, 0.02, 1), gold, { p: [0.07, -0.2, 0] });
  add(tilt, rbox(0.09, 0.06, 0.05, 0.02, 1), gold, { p: [0.055, -0.28, 0] });
  add(piv, ico(1), GLOWM(0xffd75a, { opacity: 0.32 }), { s: 0.34 });
  const sparks = [];
  for (let i = 0; i < 3; i++) sparks.push(add(root, sparkGeo(), MU(0xfffbe0), { s: 0.08 }));
  let t = Math.random() * 6;
  return {
    root, type: 'key',
    update(dt) {
      t += dt;
      piv.rotation.y = t * 2.2;
      piv.position.y = Math.sin(t * 2.6) * 0.06;
      sparks.forEach((s, i) => {
        const a = t * 1.5 + (i / 3) * TAU, p = (t * 1.1 + i * 0.37) % 1;
        s.position.set(Math.cos(a) * 0.3, Math.sin(a * 1.3) * 0.18, Math.sin(a) * 0.3);
        const k = Math.sin(p * PI) * 0.09; s.scale.set(k, k, k); s.rotation.z = t * 3;
      });
    },
  };
};

// ============================================================================ springPad
B.springPad = (o) => {
  const style = o.style === 'flower' ? 'flower' : 'mushroom';
  const root = new Node('springPad');
  const body = grp(root, 'body');
  if (style === 'mushroom') {
    const capC = col(o.color ?? 0xff7fae);
    add(body, K('spStem', () => latheD([[0, 0], [0.3, 0], [0.26, 0.06], [0.22, 0.2], [0.24, 0.3], [0, 0.3]], 14)), M(0xfff1e0));
    const cap = K('spCap' + capC.map((v) => v.toFixed(3)).join(','), () => colored(G.latheGeo([[0, 0.2], [0.36, 0.205], [0.5, 0.22], [0.57, 0.245], [0.605, 0.275], [0.61, 0.305], [0.59, 0.34], [0.53, 0.39], [0.44, 0.43], [0.3, 0.475], [0.15, 0.497], [0, 0.505]], 32),
      (x, y) => mixc(col(0xfff0e4), capC.map((v) => v * (0.9 + 0.12 * smoothstep(0.28, 0.5, y))), smoothstep(0.24, 0.27, y))));
    add(body, cap, MG(0xffffff, { vertexColors: true, spec: 0.3 }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3, rr = i % 2 ? 0.47 : 0.27, y = i % 2 ? 0.39 : 0.475;
      const n = [Math.sin(a) * (i % 2 ? 0.9 : 0.4), 1, Math.cos(a) * (i % 2 ? 0.9 : 0.4)];
      add(body, sph(8, 5), M(0xffffff), { p: [Math.sin(a) * rr, y, Math.cos(a) * rr], r: faceN(n.map((v) => v / Math.hypot(...n))), s: [0.085, 0.085, 0.025] });
    }
    add(body, tor(0.25, 6, 22), M(0xffd9ec), { p: [0, 0.27, 0], r: [PI / 2, 0, 0], s: 0.5 });
  } else {
    const pc = col(o.color ?? 0xff9ec8);
    add(body, K('spStemF', () => latheD([[0, 0], [0.2, 0], [0.12, 0.08], [0.1, 0.26], [0, 0.3]], 10)), M(0x6cc06a));
    for (let i = 0; i < 4; i++) add(body, K('spLeaf', () => leafGeo(1, 0.55, { segs: 5, across: 1, lift: 0.25, bend: 0.5 })), M(0x7cd46e, { vertexColors: true }), { p: [0, 0.03, 0], r: [0, (i / 4) * TAU + 0.4, 0], s: 0.5 });
    const pet = K('spPetal', () => G.puffyShapeGeo(petalOutline(1, 0.75, 18, 0.5), 0.14, 2).translate(0, 0.5, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const pn = grp(body, '', [Math.sin(a) * 0.2, 0.36, Math.cos(a) * 0.2], [0, a, 0]);
      add(pn, pet, MG(i % 2 ? lighten(pc, 0.35) : pc, { spec: 0.2 }), { r: [PI / 2 - 0.3, 0, 0], s: [0.42, 0.44, 0.4] });
    }
    add(body, K('spPad', () => latheD([[0, 0.3], [0.3, 0.3], [0.34, 0.36], [0.33, 0.44], [0.26, 0.49], [0, 0.5]], 18)), MG(0xffd84d, { spec: 0.35 }));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; add(body, sph(6, 4), M(0xffa63d), { p: [Math.sin(a) * 0.18, 0.485, Math.cos(a) * 0.18], s: [0.035, 0.015, 0.035] }); }
  }
  const sp = new Spring(170, 7);
  let t = 0;
  return {
    root, type: 'springPad', style,
    bounce(k = 1) { sp.x = -0.4 * k; sp.v = -2 * k; },
    update(dt) {
      t += dt;
      const s = sp.update(0, dt);
      const sy = clamp(1 + s, 0.45, 1.6);
      body.scale.set(1 - s * 0.35, sy, 1 - s * 0.35);
    },
  };
};

// ============================================================================ starCannon
B.starCannon = (o) => {
  const root = new Node('starCannon');
  const body = grp(root, 'body');
  add(body, K('scBase', () => latheD([[0, 0], [0.58, 0], [0.62, 0.05], [0.58, 0.16], [0.42, 0.22], [0.36, 0.3], [0, 0.3]], 20)), M(0xd5cfe6));
  add(body, tor(0.18, 6, 24), MG(0xffcf4d), { p: [0, 0.2, 0], r: [PI / 2, 0, 0], s: 0.5 });
  const turret = grp(body, 'turret', [0, 0.3, 0]);
  const plateM = M(0xb59cf0);
  for (const sd of [-1, 1]) {
    add(turret, K('scPlate', () => G.extrudeGeo(roundPoly([[-0.25, 0], [0.25, 0], [0.18, 0.62], [-0.18, 0.62]], 0.08, 2), 0.1)), plateM, { p: [sd * 0.33, 0, 0], r: [0, PI / 2, 0] });
    add(turret, sph(10, 7), MG(0xffcf4d), { p: [sd * 0.4, 0.55, 0], s: [0.06, 0.09, 0.09] });
  }
  add(turret, cyl(12), plateM, { p: [0, 0, 0], s: [0.26, 0.12, 0.26] });
  const pitchN = grp(turret, 'pitch', [0, 0.55, 0]);
  const recoil = grp(pitchN, 'recoil');
  const barrelM = MG(0xff86b8, { spec: 0.35 }), ringM = MG(0xffcf4d, { spec: 0.6 });
  recoil.add(rot(add(null, K('scBarrel', () => latheD([[0, -0.42], [0.28, -0.42], [0.33, -0.34], [0.34, -0.2], [0.27, 0.1], [0.24, 0.4], [0.29, 0.52], [0.3, 0.6], [0.2, 0.6], [0.18, 0.5], [0, 0.5]], 18)), barrelM), PI / 2, 0, 0));
  for (const z of [-0.25, 0.4]) add(recoil, tor(0.16, 6, 20), ringM, { p: [0, 0, z], s: z > 0 ? 0.26 : 0.33 });
  add(recoil, sph(12, 8), ringM, { p: [0, 0, -0.44], s: [0.16, 0.16, 0.12] });
  for (const sd of [-1, 1]) add(recoil, starFlat(), M(0xfff2a0), { p: [sd * 0.31, 0.02, -0.05], r: [0, sd * PI / 2, 0], s: [0.2, 0.2, 0.25] });
  add(recoil, starFlat(), M(0xfff2a0), { p: [0, 0.31, -0.05], r: [-PI / 2, 0, 0], s: [0.2, 0.2, 0.25] });
  add(recoil, disc(16), M(0x3a2f5a), { p: [0, 0, 0.598], r: [PI / 2, 0, 0], s: 0.19 });
  const muzzle = grp(recoil, 'muzzle', [0, 0, 0.62]);
  const flashM = MU(0xfff0a0, { transparent: true, opacity: 1 });
  const flash = add(muzzle, starGeo(), flashM, { s: 0.001 }); flash.visible = false;
  const smoke = [];
  for (let i = 0; i < 5; i++) { const s = add(root, ico(1), M(0xffffff, { transparent: true }), { s: 0.1 }); s.visible = false; smoke.push({ node: s, v: [0, 0, 0] }); }
  const kick = new Spring(220, 12);
  let yaw = 0, pitch = num(o.pitch, 0.6), cy = 0, cp = pitch, ft = -1, t = 0;
  const api = {
    root, type: 'starCannon', muzzle,
    aim(y, p) { yaw = num(y, yaw); pitch = clamp(num(p, pitch), -0.2, 1.4); },
    fire() {
      kick.kick(-5); ft = 0; flash.visible = true;
      const cyw = Math.cos(cy), syw = Math.sin(cy), cpp = Math.cos(cp), spp = Math.sin(cp);
      const dir = [syw * cpp, spp, cyw * cpp];
      const mp = [dir[0] * 0.62, 0.85 + dir[1] * 0.62, dir[2] * 0.62];
      smoke.forEach((s, i) => {
        s.node.visible = true; s.node.position.set(mp[0], mp[1], mp[2]);
        const a = (i / smoke.length) * TAU;
        s.v = [dir[0] * 2 + Math.cos(a) * 0.8, dir[1] * 2 + Math.sin(a) * 0.8, dir[2] * 2 + Math.sin(a + 1) * 0.6];
      });
    },
    update(dt) {
      t += dt;
      cy += (yaw - cy) * (1 - Math.exp(-10 * dt));
      cp += (pitch - cp) * (1 - Math.exp(-10 * dt));
      turret.rotation.y = cy;
      pitchN.rotation.x = -cp;
      const kk = kick.update(0, dt);
      recoil.position.z = Math.max(-0.25, kk * 0.06);
      body.scale.set(1 - kk * 0.02, 1 + kk * 0.03, 1 - kk * 0.02);
      if (ft >= 0) {
        ft += dt;
        const f = clamp(ft / 0.35, 0, 1);
        const s = Ease.outBack(Math.min(1, f * 3)) * 0.5 * (1 - f);
        flash.scale.set(s, s, s); flash.rotation.z = ft * 6; flashM.opacity = 1 - f;
        smoke.forEach((sm) => {
          sm.node.position.x += sm.v[0] * dt; sm.node.position.y += sm.v[1] * dt; sm.node.position.z += sm.v[2] * dt;
          const ss = 0.1 + ft * 0.5; sm.node.scale.set(ss, ss, ss); sm.node.opacity = clamp(1 - ft / 0.7, 0, 1);
        });
        if (ft > 0.7) { ft = -1; flash.visible = false; smoke.forEach((sm) => (sm.node.visible = false)); }
      }
    },
  };
  api.update(0);
  return api;
};

// ============================================================================ saw
B.saw = (o) => {
  const r = num(o.r, 0.8);
  const root = new Node('saw');
  const spin = grp(root, 'spin');
  spin.scale.set(r / 0.8, r / 0.8, r / 0.8);
  const teeth = K('sawBlade', () => {
    const out = [], n = 14;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      out.push([Math.cos(a0) * 0.62, Math.sin(a0) * 0.62]);
      out.push([Math.cos(a0 + (a1 - a0) * 0.18) * 0.82, Math.sin(a0 + (a1 - a0) * 0.18) * 0.82]);
      out.push([Math.cos(a0 + (a1 - a0) * 0.32) * 0.66, Math.sin(a0 + (a1 - a0) * 0.32) * 0.66]);
    }
    return G.extrudeGeo(out, 0.06);
  });
  add(spin, teeth, MG(0xdfe3f2, { spec: 0.9, rim: 0.55 }));
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const g = K('sawWedge' + i, () => G.cylinderGeo(0.5, 0.5, 0.11, 3, 1, true, (i / bands) * TAU, TAU / bands));
    add(spin, g, MG(i % 2 ? 0xffffff : 0xff6f8f, { spec: 0.5 }), { r: [PI / 2, 0, 0] });
  }
  add(spin, tor(0.1, 6, 28), MG(0xff9ab8), { s: 0.52 });
  add(spin, cyl(12), MG(0xffcf4d, { spec: 0.6 }), { p: [0, 0, -0.1], r: [PI / 2, 0, 0], s: [0.1, 0.2, 0.1] });
  for (const z of [0.06, -0.06]) add(spin, sph(10, 6), MG(0xffffff), { p: [0, 0, z], s: [0.09, 0.09, 0.03] });
  const speed = num(o.speed, 7);
  let t = 0;
  return { root, type: 'saw', r, speed, update(dt) { t += dt; spin.rotation.z -= dt * speed; } };
};

// ============================================================================ spikeTrap
B.spikeTrap = (o) => {
  const root = new Node('spikeTrap');
  add(root, rbox(1, 0.14, 1, 0.05, 2), M(0xc9c3dc), { p: [0, 0.07, 0] });
  const holes = K('stHoles', () => merge([0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => ({ geo: G.circleGeo(0.075, 10), m: m4([(i - 1) * 0.3, 0.142, (j - 1) * 0.3]), c: 0x5a5470 })))));
  add(root, holes, VCs());
  const spikes = grp(root, 'spikes');
  const sg = K('stSpikes2', () => merge([0, 1, 2].flatMap((i) => [0, 1, 2].flatMap((j) => [
    { geo: prismBody(5, 0.75), m: m4([(i - 1) * 0.3, -0.05, (j - 1) * 0.3], [0, i + j, 0], [0.095, 0.24, 0.095]), c: [0xc6a4ff, 0xff9ed2, 0x9fd8ff][(i + j) % 3] },
    { geo: prismTip(5, 0.75), m: m4([(i - 1) * 0.3, 0.19, (j - 1) * 0.3], [0, i + j, 0], [0.095, 0.36, 0.095]), c: 0xf6f0ff },
  ]))));
  add(spikes, sg, VCs({ spec: 0.4 }));
  let raised = 0;
  const api = {
    root, type: 'spikeTrap', get raised() { return raised; },
    setRaised(t) { raised = clamp(num(t, 0), 0, 1); spikes.position.y = lerp(-0.5, 0.0, raised); spikes.visible = raised > 0.01; },
    update() {},
  };
  api.setRaised(num(o.raised, 0));
  return api;
};

// ============================================================================ spikeStrip (static crystal spikes)
B.spikeStrip = (o) => {
  const w = num(o.w, 2), d = num(o.d, 1);
  const root = new Node('spikeStrip');
  const g = K(`ss${w}_${d}`, () => {
    const items = [{ geo: G.roundedBoxGeo(w, 0.1, d, 0.04, 2), m: m4([0, 0.05, 0]), c: 0x9b93b8 }];
    const nx = Math.max(1, Math.round(w / 0.32)), nz = Math.max(1, Math.round(d / 0.32));
    const r = new RNG(Math.round(w * 100 + d * 7));
    const cs = [0xc6a4ff, 0xff9ed2, 0x9fd8ff];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -w / 2 + ((i + 0.5) / nx) * w + r.range(-0.04, 0.04), z = -d / 2 + ((j + 0.5) / nz) * d + r.range(-0.04, 0.04);
      const h = r.range(0.32, 0.46), rr = r.range(0.07, 0.09), c = cs[(i + j) % 3];
      const yaw = r.next() * TAU, tilt = r.range(-0.12, 0.12);
      const base = m4([x, 0.08, z], [tilt, yaw, 0]);
      items.push({ geo: prismBody(5, 0.75), m: Mat4mul(base, m4(null, 0, [rr, h * 0.45, rr])), c });
      items.push({ geo: prismTip(5, 0.75), m: Mat4mul(base, m4([0, h * 0.45, 0], 0, [rr, h * 0.55, rr])), c: mixc(c, 0xffffff, 0.6) });
    }
    return merge(items);
  });
  add(root, g, VCs({ spec: 0.45 }));
  return { root, type: 'spikeStrip', w, d, update() {} };
};

// ============================================================================ crusher (2x2x2 angry block)
B.crusher = (o) => {
  const root = new Node('crusher');
  const body = grp(root, 'body');
  add(body, K('crBody', () => colored(G.roundedBoxGeo(2, 2, 2, 0.32, 3), (x, y, z) => { const k = 0.9 + 0.1 * smoothstep(-1, 1, y) - 0.04 * (Math.abs(Math.sin(x * 4.2 + z * 3.1)) > 0.97 ? 1 : 0); return [k, k, k]; })), M(0xb8b2cc, { vertexColors: true }));
  for (const sd of [-1, 1]) for (const k of [-1, 1]) add(body, sph(8, 6), M(0xa39cbb), { p: [sd * 1.0, k * 0.55, 0.55], s: [0.08, 0.16, 0.16] });
  const face = grp(body, 'face', [0, 0.05, 1.0]);
  const white = M(0xffffff), dark = MG(0x2a1f3d, { spec: 0.5, rim: 0.1 });
  const angry = grp(face, 'angry'), sleep = grp(face, 'sleep');
  for (const sd of [-1, 1]) {
    add(angry, sph(14, 10), white, { p: [sd * 0.42, 0.2, 0.0], s: [0.25, 0.28, 0.08] });
    add(angry, sph(10, 8), dark, { p: [sd * 0.38, 0.15, 0.06], s: [0.12, 0.15, 0.05] });
    add(angry, sph(6, 4), MU(0xffffff), { p: [sd * 0.34, 0.21, 0.1], s: [0.035, 0.04, 0.02] });
    add(angry, rbox(0.55, 0.12, 0.1, 0.05, 1), dark, { p: [sd * 0.42, 0.55, 0.03], r: [0, 0, -sd * 0.38] });
    add(sleep, K('crLid', () => G.torusGeo(1, 0.22, 5, 12, PI)), dark, { p: [sd * 0.42, 0.18, 0.02], r: [0, 0, PI], s: [0.2, 0.16, 0.2] });
    add(sleep, sph(8, 6), M(0xffa8c4), { p: [sd * 0.62, -0.12, 0.0], s: [0.14, 0.08, 0.03] });
  }
  add(angry, rbox(0.7, 0.24, 0.1, 0.08, 2), white, { p: [0, -0.45, 0.0] });
  for (const x of [-0.18, 0, 0.18]) add(angry, box(), M(0x9a94b0), { p: [x, -0.45, 0.055], s: [0.025, 0.22, 0.01] });
  add(angry, box(), M(0x9a94b0), { p: [0, -0.45, 0.055], s: [0.68, 0.025, 0.01] });
  add(sleep, sph(10, 8), dark, { p: [0, -0.42, 0.0], s: [0.1, 0.08, 0.04] });
  const zz = grp(sleep, 'zz', [0.75, 0.75, 0.1]);
  const zg = K('zShape', () => G.extrudeGeo([[-0.5, 0.5], [0.5, 0.5], [0.5, 0.3], [-0.15, -0.3], [0.5, -0.3], [0.5, -0.5], [-0.5, -0.5], [-0.5, -0.3], [0.15, 0.3], [-0.5, 0.3]], 0.2));
  add(zz, zg, M(0xffffff), { s: 0.18 });
  add(zz, zg, M(0xffffff), { p: [0.2, 0.25, 0], s: 0.12 });
  let faceN2 = o.face === 'sleep' ? 'sleep' : 'angry', t = Math.random() * 5;
  const api = {
    root, type: 'crusher', get face() { return faceN2; },
    setFace(f) { faceN2 = f === 'sleep' ? 'sleep' : 'angry'; angry.visible = faceN2 === 'angry'; sleep.visible = faceN2 === 'sleep'; },
    update(dt) {
      t += dt;
      if (faceN2 === 'angry') face.position.x = Math.sin(t * 40) * 0.006;
      else { face.position.x = 0; zz.position.y = 0.75 + Math.sin(t * 2) * 0.06; zz.rotation.z = Math.sin(t * 1.5) * 0.15; }
    },
  };
  api.setFace(faceN2);
  return api;
};

// ============================================================================ firebar
B.firebar = (o) => {
  const n = Math.max(1, Math.round(num(o.n, 6))), spacing = num(o.spacing, 0.5);
  const root = new Node('firebar');
  add(root, tor(0.3, 6, 18), M(0x9b93b8), { r: [PI / 2, 0, 0], s: 0.26 });
  add(root, rbox(0.42, 0.18, 0.42, 0.06, 1), M(0xb8b2cc), { p: [0, -0.2, 0] });
  const core = MU(0xfff6c8), mid = MU(0xffd04a), outer = MU(0xff8a3c, { transparent: true, opacity: 0.9 });
  const halo = GLOWM(0xff9a4a, { opacity: 0.8 });
  const balls = [];
  for (let i = 0; i < n; i++) {
    const b = grp(root, 'ball' + i, [i * spacing, 0, 0]);
    const s = i === 0 ? 1.15 : 1;
    const oN = add(b, K('fbLump' + (i % 3), () => lumpGeo(i % 3 + 3, { ws: 10, hs: 7, lobes: 6, amp: 0.3, sharp: 4 })), outer, { s: 0.2 * s });
    add(b, sph(10, 7), mid, { s: 0.15 * s });
    add(b, sph(8, 6), core, { s: 0.08 * s });
    const h = add(b, ico(1), halo, { s: 0.36 * s });
    balls.push({ node: b, outer: oN, halo: h, ph: i * 1.7 });
  }
  let t = Math.random() * 10;
  return {
    root, type: 'firebar', n, spacing, balls: balls.map((b) => b.node),
    update(dt) {
      t += dt;
      for (const b of balls) {
        const f = valueNoise2(t * 9 + b.ph, b.ph * 3);
        const s = 0.92 + f * 0.2;
        b.node.scale.set(s, s * (1 + Math.sin(t * 13 + b.ph) * 0.05), s);
        b.outer.rotation.y = t * 4 + b.ph; b.outer.rotation.x = t * 3;
        b.halo.opacity = 0.7 + f * 0.3;
      }
    },
  };
};

// ============================================================================ laserEmitter
B.laserEmitter = (o) => {
  const root = new Node('laserEmitter');
  const holder = grp(root, 'holder');
  add(holder, tor(0.22, 6, 20), MG(0xffcf4d, { spec: 0.5 }), { s: 0.24 });
  add(holder, K('leBack', () => latheD([[0, -0.3], [0.2, -0.3], [0.24, -0.22], [0.22, -0.08], [0.16, 0], [0, 0]], 14)), M(0xb8b2cc), { r: [PI / 2, 0, 0] });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + PI / 4;
    add(holder, rbox(0.06, 0.16, 0.2, 0.025, 1), M(0xd5cfe6), { p: [Math.cos(a) * 0.27, Math.sin(a) * 0.27, -0.05], r: [0, 0, a - PI / 2] });
  }
  const cm = pmatG(0xff6fb8, { spec: 0.7, emissive: 0x3a0a20 });
  const crys = grp(root, 'crystal', [0, 0, 0.02]);
  add(crys, prismBody(6, 0.8), cm, { r: [PI / 2, 0, 0], s: [0.13, 0.16, 0.13] });
  add(crys, prismTip(6, 0.8), cm, { p: [0, 0, 0.16], r: [PI / 2, 0, 0], s: [0.13, 0.16, 0.13] });
  const beam = grp(root, 'beam', [0, 0, 0.3]);
  const coreM = MU(0xffffff), glowM = glowInst(0xff5fa8, { opacity: 0.9, rim: 1.2 });
  const coreB = add(beam, cyl(8), coreM, { r: [PI / 2, 0, 0], s: [0.035, 1, 0.035] });
  const midB = add(beam, cyl(10), MU(0xff8fc8, { transparent: true, opacity: 0.85 }), { r: [PI / 2, 0, 0], s: [0.07, 1, 0.07] });
  const glowB = add(beam, cyl(14, 1, false), glowM, { r: [PI / 2, 0, 0], s: [0.2, 1, 0.2] });
  const end = add(beam, ico(2), glowInst(0xffa8d8), { s: 0.25 });
  const muzzleG = add(root, ico(2), glowInst(0xff7fc0), { p: [0, 0, 0.26], s: 0.24 });
  let on = o.on !== false, len = num(o.length, 6), cur = on ? len : 0, t = Math.random() * 5;
  const api = {
    root, type: 'laserEmitter', get on() { return on; }, get length() { return cur; },
    setBeam(v, l) { on = !!v; if (l !== undefined) len = Math.max(0.01, num(l, len)); },
    update(dt) {
      t += dt;
      cur = moveToward(cur, on ? len : 0, dt * (on ? 40 : 30));
      const vis = cur > 0.02;
      beam.visible = vis; muzzleG.visible = vis;
      const L = Math.max(0.001, cur - 0.3);
      const fl = 1 + Math.sin(t * 50) * 0.08 + Math.sin(t * 23) * 0.06;
      coreB.scale.set(0.035 * fl, L, 0.035 * fl);
      midB.scale.set(0.07 * fl, L, 0.07 * fl);
      glowB.scale.set(0.2 * (0.9 + 0.1 * Math.sin(t * 17)), L, 0.2 * (0.9 + 0.1 * Math.sin(t * 17)));
      glowM.opacity = 0.75 + 0.2 * Math.sin(t * 31);
      end.position.z = L; const es = 0.22 + 0.05 * Math.sin(t * 20); end.scale.set(es, es, es);
      crys.rotation.z = t * 1.5;
      setE(cm, 0xff5fa8, on ? 0.35 + 0.1 * Math.sin(t * 8) : 0.08);
    },
  };
  api.update(0);
  return api;
};

// ============================================================================ pinwheel / windFan
function pinwheelHead(parent, R, colors) {
  const head = grp(parent, 'blades');
  colors.forEach((c0, k) => {
    const c = col(c0);
    const g = K('pwBlade2' + c.map((v) => v.toFixed(3)).join(','), () => {
      const gg = G.puffyShapeGeo([[0.04, -0.02], [1, 0.0], [0.86, 0.3], [0.62, 0.5], [0.36, 0.5], [0.14, 0.3]], 0.035, 2);
      gg.displace((v) => { v.z += 0.3 * v.x * v.y + 0.04 * v.x; });
      gg.computeVertexNormals();
      gg.colorBy((x, y, z, nx, ny, nz) => (nz > 0 ? c.map((q) => q * (0.92 + 0.12 * x)) : mixc(c, [1, 1, 1], 0.75)));
      return gg;
    });
    const n = grp(head, '', [0, 0, 0], [0, 0, (k / colors.length) * TAU]);
    add(n, g, M(0xffffff, { vertexColors: true, spec: 0.25, emissive: dim(c, 0.12) }), { s: [R, R, R] });
  });
  add(head, starFlat(), MG(0xffcf4d, { spec: 0.6 }), { p: [0, 0, 0.07 * R + 0.02], s: [R * 0.34, R * 0.34, R * 0.4] });
  add(head, sph(8, 6), M(0xffffff), { p: [0, 0, 0.1 * R + 0.03], s: [R * 0.07, R * 0.07, R * 0.05] });
  return head;
}
B.windFan = (o) => {
  const root = new Node('windFan');
  add(root, K('wfBase', () => latheD([[0, 0], [0.34, 0], [0.36, 0.06], [0.24, 0.14], [0, 0.14]], 16)), M(0xd5cfe6));
  add(root, cyl(10, 0.8), M(0xfff2e6), { p: [0, 0.1, 0], s: [0.07, 0.86, 0.07] });
  add(root, rbox(0.18, 0.18, 0.3, 0.06, 1), M(0xb59cf0), { p: [0, 1.0, -0.04] });
  const hub = grp(root, 'hub', [0, 1.0, 0.14]);
  const head = pinwheelHead(hub, 0.8, [0xff8fbf, 0xffd84d, 0x8fe0b8, 0x8fc0ff]);
  const ring = add(hub, tor(0.03, 6, 32), MGlow(0xffffff, { opacity: 1 }), { s: 0.8 });
  let speed = num(o.speed, 1), t = 0, vel = 0;
  return {
    root, type: 'windFan',
    get speed() { return speed; }, setSpeed(s) { speed = num(s, speed); },
    update(dt, sp) {
      if (typeof sp === 'number') speed = sp;
      t += dt;
      vel += (speed * 9 - vel) * (1 - Math.exp(-3 * dt));
      head.rotation.z -= vel * dt;
      ring.opacity = clamp(Math.abs(vel) / 12, 0, 1) * 0.14;
      ring.visible = ring.opacity > 0.01;
    },
  };
};
B.pinwheel = (o) => {
  const root = new Node('pinwheel');
  const cs = [[0xff8fbf, 0xffd84d, 0x8fe0b8, 0x8fc0ff], [0xb89aff, 0xff9ec4, 0xfff09a, 0x9fe8ff]][num(o.variant, 0) % 2];
  add(root, tubeGeo([[0, 0, 0], [0, 1.0, 0]], 0.022, 6, { round: true }), M(0xfff2e6));
  add(root, sph(8, 6), M(0xff8fbf), { p: [0, 1.0, 0], s: 0.04 });
  const hub = grp(root, 'hub', [0, 1.0, 0.04]);
  const head = pinwheelHead(hub, 0.24, cs);
  let speed = num(o.speed, 1), vel = 0;
  return {
    root, type: 'pinwheel',
    update(dt, sp) {
      if (typeof sp === 'number') speed = sp;
      vel += (speed * 7 - vel) * (1 - Math.exp(-3 * dt));
      head.rotation.z -= vel * dt;
    },
  };
};

// ============================================================================ crate (pushable)
function crateGeo(key, wc, starC) {
  return K(key, () => {
    const S = 1, items = [{ geo: G.roundedBoxGeo(S, S, S, 0.08, 2), m: m4([0, S / 2, 0]), c: lighten(wc, 0.08) }];
    const faces = [[[0, S / 2, S / 2], 0], [[S / 2, S / 2, 0], PI / 2], [[0, S / 2, -S / 2], PI], [[-S / 2, S / 2, 0], -PI / 2], [[0, S, 0], [-PI / 2, 0, 0]]];
    for (const [p, r] of faces) {
      const F = m4(p, r);
      const at = (pp, rr, ss) => Mat4mul(F, m4(pp, rr, ss));
      items.push({ geo: G.boxGeo(1, 1, 1), m: at([0, 0, 0.004], 0, [S - 0.22, S - 0.22, 0.012]), c: dim(wc, 0.8) });
      for (const y of [-0.22, 0, 0.22]) items.push({ geo: G.boxGeo(1, 1, 1), m: at([0, y, 0.006], 0, [S - 0.24, 0.012, 0.014]), c: dim(wc, 0.7) });
      if (starC !== null) items.push({ geo: G.puffyShapeGeo(roundStarOutline(5, 0.5, 0.27, 20, 1.3), 0.12, 1), m: at([0, 0, 0.02], 0, [0.46, 0.46, 0.2]), c: starC });
    }
    return merge(items);
  });
}
function Mat4mul(a, b) { const o = new Float32Array(16); return Mat4mulInto(o, a, b); }
function Mat4mulInto(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
B.crate = (o) => {
  const root = new Node('crate');
  add(root, crateGeo('crate', col(0xe8ae76), col(0xffd84d)), VCs({ spec: 0.15 }));
  return { root, type: 'crate', update() {} };
};

// ============================================================================ breakRock
B.breakRock = (o) => {
  const root = new Node('breakRock');
  const main = grp(root, 'main');
  const rg = K('brRock', () => {
    const g = G.roundedBoxGeo(1.5, 1.4, 1.5, 0.38, 3);
    g.displace((v) => { const n = (Math.sin(v.x * 3.1 + v.z * 1.7) + Math.sin(v.y * 2.3 - v.x * 1.1)) * 0.03; v.x *= 1 + n; v.z *= 1 + n; v.y *= 1 + n * 0.5; });
    g.computeVertexNormals();
    return colored(g, (x, y, z) => { const k = 0.88 + 0.14 * smoothstep(-0.7, 0.7, y); return [k, k, k]; }).translate(0, 0.7, 0);
  });
  add(main, rg, M(0xc4bdd8, { vertexColors: true }));
  const crackG = K('brCracks', () => {
    const r = new RNG(5), items = [];
    const sides = [[[0, 0.75, 0.755], 0], [[0.755, 0.7, 0], PI / 2], [[0, 0.7, -0.755], PI], [[-0.755, 0.75, 0], -PI / 2], [[0, 1.405, 0], [-PI / 2, 0, 0]]];
    for (const [p, ro] of sides) {
      const F = m4(p, ro);
      let x = r.range(-0.3, 0.1), y = r.range(-0.3, 0.3);
      const pts = [[x, y, 0]];
      for (let k = 0; k < 4; k++) { x += r.range(0.08, 0.16); y += (k % 2 ? 1 : -1) * r.range(0.08, 0.18); pts.push([x, y, 0]); }
      items.push({ geo: tubeGeo(pts, 0.022, 4), m: F, c: 0x6e6688 });
      const q = pts[2], pts2 = [q, [q[0] - 0.05, q[1] - 0.15, 0], [q[0] + 0.02, q[1] - 0.28, 0]];
      items.push({ geo: tubeGeo(pts2, 0.016, 4), m: F, c: 0x6e6688 });
    }
    return merge(items);
  });
  add(main, crackG, VCs());
  const pieces = [];
  const r = new RNG(9);
  for (let i = 0; i < 9; i++) {
    const n = add(root, K('brChunk' + (i % 3), () => boulderGeo(i % 3 + 7, 0.25, 1)), M(i % 2 ? 0xc4bdd8 : 0xb3acc9), { s: r.range(0.2, 0.34) });
    n.visible = false;
    const a = (i / 9) * TAU + r.range(-0.3, 0.3);
    pieces.push({ node: n, home: [Math.sin(a) * 0.35, r.range(0.3, 1.1), Math.cos(a) * 0.35], v: [0, 0, 0], w: [r.range(-8, 8), r.range(-8, 8), r.range(-8, 8)], a });
  }
  let broken = false, bt = -1;
  return {
    root, type: 'breakRock', get broken() { return broken; },
    hit() { main.traverse((n) => { if (n.isMesh) n.flash = 0.6; }); main.userData.shake = 0.25; },
    break() {
      if (broken) return;
      broken = true; bt = 0; main.visible = false;
      for (const p of pieces) { p.node.visible = true; p.node.position.set(...p.home); const sp = 3 + Math.random() * 2; p.v = [Math.sin(p.a) * sp, 3.5 + Math.random() * 2.5, Math.cos(p.a) * sp]; }
    },
    update(dt) {
      if (!broken) {
        if (main.userData.shake > 0) { main.userData.shake -= dt; main.position.x = Math.sin(main.userData.shake * 80) * 0.03; } else main.position.x = 0;
        main.traverse((n) => { if (n.isMesh && n.flash > 0) n.flash = Math.max(0, n.flash - dt * 3); });
        return;
      }
      if (bt < 0) return;
      bt += dt;
      debris(pieces, dt, 12);
      const f = clamp(1 - (bt - 0.6) / 0.4, 0, 1);
      for (const p of pieces) { if (p.node.position.y < 0.12) { p.node.position.y = 0.12; p.v[1] = Math.abs(p.v[1]) * 0.3; p.v[0] *= 0.6; p.v[2] *= 0.6; } p.node.opacity = f; }
      if (bt > 1.0) { root.visible = false; bt = -1; }
    },
  };
};

// ============================================================================ breakCrate
B.breakCrate = (o) => {
  const root = new Node('breakCrate');
  const main = grp(root, 'main');
  add(main, K('bcBody', () => {
    const wc = col(0xf0c48a), S = 1, items = [{ geo: G.roundedBoxGeo(S, S, S, 0.06, 2), m: m4([0, S / 2, 0]), c: wc }];
    const faces = [[[0, S / 2, S / 2], 0], [[S / 2, S / 2, 0], PI / 2], [[0, S / 2, -S / 2], PI], [[-S / 2, S / 2, 0], -PI / 2], [[0, S, 0], [-PI / 2, 0, 0]]];
    for (const [p, r] of faces) {
      const F = m4(p, r), at = (pp, rr, ss) => Mat4mul(F, m4(pp, rr, ss));
      for (const sd of [-1, 1]) items.push({ geo: G.boxGeo(1, 1, 1), m: at([0, 0, 0.012], [0, 0, sd * PI / 4], [1.2, 0.12, 0.03]), c: dim(wc, 0.82) });
      for (const y of [-0.42, 0.42]) items.push({ geo: G.boxGeo(1, 1, 1), m: at([0, y, 0.01], 0, [S, 0.14, 0.025]), c: dim(wc, 0.9) });
      items.push({ geo: G.boxGeo(1, 1, 1), m: at([0.18, 0.12, 0.03], [0, 0, 0.9], [0.22, 0.03, 0.01]), c: 0x8a5a3c });
      items.push({ geo: G.boxGeo(1, 1, 1), m: at([0.3, 0.05, 0.03], [0, 0, -0.5], [0.14, 0.03, 0.01]), c: 0x8a5a3c });
    }
    return merge(items);
  }), VCs());
  const planks = [];
  const r = new RNG(3);
  for (let i = 0; i < 10; i++) {
    const n = add(root, rbox(0.7, 0.14, 0.06, 0.03, 1), M(i % 2 ? 0xf0c48a : 0xd9a66c), { s: r.range(0.6, 1.1) });
    n.visible = false;
    const a = (i / 10) * TAU;
    planks.push({ node: n, home: [Math.sin(a) * 0.3, r.range(0.2, 0.9), Math.cos(a) * 0.3], v: [0, 0, 0], w: [r.range(-10, 10), r.range(-10, 10), r.range(-10, 10)], a });
  }
  let broken = false, bt = -1;
  return {
    root, type: 'breakCrate', get broken() { return broken; },
    break() {
      if (broken) return;
      broken = true; bt = 0; main.visible = false;
      for (const p of planks) { p.node.visible = true; p.node.position.set(...p.home); p.node.rotation.set(Math.random() * 3, p.a, 0); const sp = 2.5 + Math.random() * 2; p.v = [Math.sin(p.a) * sp, 3 + Math.random() * 2, Math.cos(p.a) * sp]; }
    },
    update(dt) {
      if (!broken || bt < 0) return;
      bt += dt;
      debris(planks, dt, 12);
      const f = clamp(1 - (bt - 0.5) / 0.4, 0, 1);
      for (const p of planks) { if (p.node.position.y < 0.05) { p.node.position.y = 0.05; p.v[1] = Math.abs(p.v[1]) * 0.25; p.v[0] *= 0.5; p.v[2] *= 0.5; p.w = p.w.map((x) => x * 0.5); } p.node.opacity = f; }
      if (bt > 0.9) { root.visible = false; bt = -1; }
    },
  };
};

// ============================================================================ thornVine
B.thornVine = (o) => {
  const w = num(o.w, 2), h = num(o.h, 2.5);
  const root = new Node('thornVine');
  const body = grp(root, 'body');
  const geo = K(`tv3_${w}_${h}`, () => {
    const r = new RNG(Math.round(w * 13 + h * 7)), vines = [], thorns = [], leaves = [];
    const n = Math.max(3, Math.round(w * 2.2));
    const addVine = (pts, rad, c) => {
      vines.push({ geo: tubeGeo(pts, (t) => rad * (1 - 0.45 * t), 6, { round: true }), m: null, c });
      for (let k = 1; k < pts.length - 1; k++) {
        if (r.next() < 0.35) continue;
        const p = pts[k], a = r.next() * TAU;
        const d = [Math.cos(a), r.range(-0.2, 0.6), Math.sin(a) * 0.8 + 0.3];
        thorns.push({ geo: G.coneGeo(0.045, 0.16, 5), m: m4([p[0] + d[0] * 0.05, p[1], p[2] + d[2] * 0.05], [PI / 2 - Math.atan2(d[1], Math.hypot(d[0], d[2])), Math.atan2(d[0], d[2]), 0]), c: mixc(0xff8fc8, 0xffc0e0, r.next()) });
        if (r.next() < 0.3) leaves.push({ geo: leafGeo(1, 0.5, { segs: 3, across: 1, lift: 0.3, bend: 0.5 }), m: m4(p, [0, a, 0], 0.2), c: mixc(0x7a9a6a, 0x8f7aa8, r.next()) });
      }
    };
    for (let i = 0; i < n; i++) for (const dir of [-1, 1]) {
      const x0 = -w / 2 + ((i + 0.5) / n) * w - dir * 0.35, pts = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push([clamp(x0 + dir * t * 0.9 + Math.sin(t * 9 + i * 2 + dir) * 0.09, -w / 2 + 0.05, w / 2 - 0.05), t * h * r.range(0.96, 1.0), Math.sin(t * 6 + i * 1.3 + dir) * 0.1 + (dir > 0 ? 0.06 : -0.04)]);
      }
      addVine(pts, r.range(0.075, 0.095), mixc(0x8a64a0, 0x6c4f88, r.next()));
    }
    for (let i = 0; i < Math.max(2, Math.round(w * 1.2)); i++) {
      const x = -w / 2 + ((i + 0.5) / Math.max(2, Math.round(w * 1.2))) * w, y0 = h * r.range(0.82, 1.0), pts = [];
      for (let k = 0; k <= 10; k++) { const a = k * 0.62, rr = 0.16 * (1 - k / 13); pts.push([x + Math.cos(a) * rr, y0 + Math.sin(a) * rr + k * 0.01, 0.02]); }
      vines.push({ geo: tubeGeo(pts, (t) => 0.04 * (1 - 0.6 * t), 5, { round: true }), m: null, c: 0x7a5a94 });
    }
    return { vines: merge(vines), thorns: merge([...thorns, ...leaves]) };
  });
  const vm = new Material({ color: 0xffffff, vertexColors: true, ...SOFT }), tm = new Material({ color: 0xffffff, vertexColors: true, ...SOFT, spec: 0.3 });
  add(body, geo.vines, vm);
  add(body, geo.thorns, tm);
  const flames = [];
  const fr = new RNG(7);
  for (let i = 0; i < 7; i++) {
    const f = add(root, K('flameDrop', () => latheD([[0, 0], [0.06, 0.02], [0.08, 0.08], [0.05, 0.16], [0, 0.24]], 8)), MU(i % 2 ? 0xffb04a : 0xff7a3c, { transparent: true }), { p: [fr.range(-w / 2, w / 2), fr.range(0.1, h * 0.8), fr.range(-0.1, 0.15)], s: 1.4 });
    f.visible = false; flames.push(f);
  }
  let burning = false, bt = -1, gone = false;
  return {
    root, type: 'thornVine', w, h, get burnt() { return gone; },
    burn() { if (burning || gone) return; burning = true; bt = 0; flames.forEach((f) => (f.visible = true)); },
    update(dt) {
      if (!burning) return;
      bt += dt;
      const k = clamp(bt / 1.2, 0, 1);
      lerpC(vm, 0xffffff, 0x3a2a30, smoothstep(0, 0.6, k)); setE(vm, 0xff6a2a, Math.sin(Math.min(1, k * 1.5) * PI) * 0.6);
      lerpC(tm, 0xffffff, 0x4a3030, smoothstep(0, 0.6, k)); setE(tm, 0xff7a3a, Math.sin(Math.min(1, k * 1.5) * PI) * 0.5);
      const sh = 1 - Ease.inCubic(k) * 0.85;
      body.scale.set(1 - k * 0.15, sh, 1 - k * 0.15);
      setOpacity(body, clamp(1 - (k - 0.55) / 0.45, 0, 1));
      flames.forEach((f, i) => { const s = (1.0 + Math.sin(bt * 25 + i) * 0.25) * clamp(1 - (k - 0.6) / 0.4, 0, 1) * 1.4; f.scale.set(s, s * 1.3, s); f.position.y = Math.max(0.05, f.position.y - dt * 1.2 * k); f.opacity = clamp(1 - (k - 0.6) / 0.4, 0, 1); });
      if (bt > 1.25) { root.visible = false; burning = false; gone = true; }
    },
  };
};

// ============================================================================ iceBlock
B.iceBlock = (o) => {
  const s = num(o.s, 1.2);
  const root = new Node('iceBlock');
  const body = grp(root, 'body');
  const im = new Material({ color: 0xbfeaff, transparent: true, opacity: 0.62, depthWrite: false, spec: 0.8, rim: 0.7 });
  const cube = add(body, K(`ice${s}`, () => G.roundedBoxGeo(s, s, s, s * 0.1, 2).translate(0, s / 2, 0)), im);
  cube.renderOrder = 2;
  const frost = add(body, K(`iceFrost${s}`, () => merge([
    { geo: G.roundedBoxGeo(s * 0.7, s * 0.06, s * 0.5, s * 0.03, 1), m: m4([-s * 0.08, s + 0.005, s * 0.1], [0, 0.3, 0]), c: 0xffffff },
    { geo: tubeGeo([[-s * 0.35, s * 0.85, s * 0.505], [-s * 0.1, s * 0.6, s * 0.505], [s * 0.05, s * 0.7, s * 0.505], [s * 0.3, s * 0.35, s * 0.505]], s * 0.012, 3), m: null, c: 0xffffff },
    { geo: tubeGeo([[s * 0.505, s * 0.8, -s * 0.2], [s * 0.505, s * 0.5, s * 0.05], [s * 0.505, s * 0.3, -s * 0.1]], s * 0.012, 3), m: null, c: 0xffffff },
    { geo: G.sphereGeo(1, 6, 4), m: m4([-s * 0.3, s * 0.78, s * 0.51], 0, [s * 0.09, s * 0.06, s * 0.01]), c: 0xffffff },
  ])), MU(0xffffff, { vertexColors: true, transparent: true, opacity: 0.9 }));
  frost.renderOrder = 3;
  const inner = add(body, K(`iceIn${s}`, () => G.roundedBoxGeo(s * 0.6, s * 0.6, s * 0.6, s * 0.15, 1).translate(0, s / 2, 0)), new Material({ color: 0xe8f8ff, transparent: true, opacity: 0.35, depthWrite: false, unlit: true }));
  inner.renderOrder = 1;
  const puddle = add(root, disc(20), new Material({ color: 0xa8dcff, transparent: true, opacity: 0.0, spec: 0.8, depthWrite: false }), { p: [0, 0.01, 0], s: s * 0.4 });
  puddle.visible = false;
  let melting = false, mt = -1, gone = false;
  return {
    root, type: 'iceBlock', s, get melted() { return gone; },
    melt() { if (melting || gone) return; melting = true; mt = 0; puddle.visible = true; },
    update(dt) {
      if (!melting) return;
      mt += dt;
      const k = clamp(mt / 1.3, 0, 1);
      const sy = 1 - Ease.inOutSine(k), sx = 1 - Ease.inOutSine(k) * 0.6;
      body.scale.set(sx, Math.max(0.001, sy), sx);
      im.opacity = 0.62 * (1 - k * 0.5);
      const ps = s * (0.4 + k * 0.5);
      puddle.scale.set(ps, 1, ps);
      puddle.material.opacity = Math.sin(k * PI) * 0.7;
      if (mt > 1.35) { root.visible = false; melting = false; gone = true; }
    },
  };
};

// ============================================================================ torch
B.torch = (o) => {
  const root = new Node('torch');
  add(root, K('tcBase', () => latheD([[0, 0], [0.24, 0], [0.26, 0.05], [0.16, 0.12], [0.1, 0.2], [0, 0.2]], 14)), M(0xd5cfe6));
  add(root, cyl(8, 0.8), M(0xc98b55), { p: [0, 0.15, 0], s: [0.07, 0.95, 0.07] });
  add(root, K('tcBowl', () => latheD([[0, 1.02], [0.08, 1.02], [0.2, 1.08], [0.27, 1.2], [0.25, 1.24], [0.18, 1.18], [0, 1.16]], 14)), MG(0xffcf4d, { spec: 0.5 }));
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; add(root, sph(6, 4), M(0xff8fbf), { p: [Math.sin(a) * 0.23, 1.15, Math.cos(a) * 0.23], s: 0.035 }); }
  const fl = grp(root, 'flame', [0, 1.17, 0]);
  const drop = K('flameTear', () => latheD([[0, 0], [0.09, 0.02], [0.13, 0.08], [0.12, 0.16], [0.07, 0.26], [0.02, 0.34], [0, 0.36]], 10));
  const f1 = add(fl, drop, MU(0xff7f3a), { s: [1.3, 1.25, 1.3] });
  const f2 = add(fl, drop, MU(0xffc24a), { p: [0, 0.02, 0.02], s: [0.95, 0.95, 0.95] });
  const f3 = add(fl, drop, MU(0xfff2c0), { p: [0, 0.03, 0.04], s: [0.5, 0.55, 0.5] });
  const halo = add(fl, ico(2), GLOWM(0xffa040, { opacity: 0.9 }), { p: [0, 0.2, 0], s: 0.6 });
  let isLit = o.lit !== false, k = isLit ? 1 : 0, t = Math.random() * 6;
  const api = {
    root, type: 'torch', get lit() { return isLit; },
    setLit(v) { isLit = !!v; },
    update(dt) {
      t += dt;
      k = moveToward(k, isLit ? 1 : 0, dt * 4);
      const e = isLit ? Ease.outBack(k) : Ease.inCubic(k);
      fl.visible = k > 0.01;
      const n1 = valueNoise2(t * 7, 1.3), n2 = valueNoise2(t * 9, 5.1);
      fl.scale.set(e * (0.95 + n1 * 0.12), e * (0.9 + n2 * 0.25), e * (0.95 + n1 * 0.12));
      f1.rotation.y = t * 2; f2.rotation.y = -t * 3;
      fl.rotation.z = (n1 - 0.5) * 0.15; fl.rotation.x = (n2 - 0.5) * 0.12;
      halo.opacity = k * (0.65 + n2 * 0.35);
      void f3;
    },
  };
  api.update(0);
  return api;
};

// ============================================================================ seedSprout
B.seedSprout = (o) => {
  const H = num(o.h, 2.5), R = num(o.r, 1.2);
  const root = new Node('seedSprout');
  add(root, K('ssMound', () => lumpGeo(5, { ws: 12, hs: 7, lobes: 6, amp: 0.25, flat: 0.15 })), M(0xb98a62), { p: [0, 0.0, 0], s: [0.5, 0.18, 0.5] });
  const sprout = grp(root, 'sprout', [0, 0.12, 0]);
  add(sprout, tubeGeo([[0, 0, 0], [0.02, 0.12, 0], [0, 0.24, 0.01]], 0.025, 5, { round: true }), M(0x7cd46e));
  const sLeaf = K('ssLeaf', () => leafGeo(1, 0.6, { segs: 4, across: 1, lift: 0.5, bend: 0.4 }));
  for (const sd of [-1, 1]) add(sprout, sLeaf, M(0x8fdc72, { vertexColors: true }), { p: [0, 0.23, 0], r: [0, sd * PI / 2, 0], s: 0.18 });
  // stem (unit height, scaled)
  const stemG = K('ssStem', () => tubeGeo([[0, 0, 0], [0.03, 0.25, 0.02], [-0.02, 0.5, -0.01], [0.02, 0.75, 0.02], [0, 1, 0]], (t) => lerp(1, 0.75, t), 8, { capStart: false }));
  const stemN = grp(root, 'stemN');
  const stem = add(stemN, stemG, M(0x6cc06a), { s: [0.2, 1, 0.2] });
  const leaves = [];
  const bl = K('ssBigLeaf', () => leafGeo(1, 0.6, { segs: 6, across: 2, lift: 0.4, bend: 1.0 }));
  for (let i = 0; i < 5; i++) { const n = grp(stemN, 'leaf' + i, [0, 0, 0], [0, i * 2.4, 0]); add(n, bl, M(i % 2 ? 0x7cd46e : 0x8fdc72, { vertexColors: true }), { s: 0.85 - i * 0.07 }); leaves.push({ n, y: 0.12 + i * 0.15 }); }
  const head = grp(root, 'flower');
  const padG = K(`ssPad${R}`, () => latheD([[0, -0.26], [R * 0.7, -0.26], [R * 0.95, -0.2], [R, -0.12], [R * 0.97, -0.03], [R * 0.9, 0], [0, 0]], 28));
  const padM = MG(0xffe066, { spec: 0.25 });
  add(head, padG, padM);
  const dots = K(`ssDots${R}`, () => { const it = []; for (let i = 0; i < 18; i++) { const a = i * 2.4, rr = Math.sqrt((i + 0.5) / 18) * R * 0.78; it.push({ geo: G.sphereGeo(1, 6, 3, 0, TAU, 0, PI / 2), m: m4([Math.sin(a) * rr, -0.01, Math.cos(a) * rr], 0, [0.05, 0.025, 0.05]), c: 0xffb340 }); } return merge(it); });
  add(head, dots, VCs());
  add(head, K(`ssCalyx${R}`, () => latheD([[0, -0.5], [0.12, -0.48], [R * 0.45, -0.32], [R * 0.75, -0.22], [0, -0.22]], 16)), M(0x6cc06a));
  const pet = K('ssPetal', () => G.puffyShapeGeo(petalOutline(1, 0.62, 18, 0.45), 0.12, 2).translate(0, 0.5, 0));
  const petals = [];
  const pc = col(o.color ?? 0xff8fbf);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const pv = grp(head, 'pet' + i, [Math.sin(a) * R * 0.85, -0.12, Math.cos(a) * R * 0.85], [0, a, 0]);
    const pn = grp(pv, '');
    add(pn, pet, MG(i % 2 ? lighten(pc, 0.3) : pc, { spec: 0.15 }), { s: [R * 0.75, R * 0.75, R * 0.6] });
    petals.push(pn);
  }
  let g = 0;
  const api = {
    root, type: 'seedSprout', h: H, r: R, get growth() { return g; },
    setGrowth(t) {
      g = clamp(num(t, 0), 0, 1);
      const sp = clamp(g / 0.12, 0, 1);
      sprout.visible = g < 0.3;
      const ss = g < 0.15 ? 1 + 0.25 * sp : Math.max(0.01, 1.25 - (g - 0.15) / 0.12);
      sprout.scale.set(ss, ss, ss);
      const st = Ease.outCubic(clamp((g - 0.1) / 0.6, 0, 1));
      const topY = lerp(0.3, H - 0.26, st);
      stemN.visible = g > 0.1;
      stem.scale.set(0.2 * (0.5 + 0.5 * st), Math.max(0.01, topY), 0.2 * (0.5 + 0.5 * st));
      leaves.forEach((L, i) => { const k = Ease.outBack(clamp((st - i * 0.12) / 0.4, 0, 1)); L.n.position.y = L.y * topY; L.n.scale.set(k, k, k); });
      const ho = clamp((g - 0.55) / 0.45, 0, 1);
      head.visible = g > 0.1;
      head.position.y = topY + 0.26 * (0.3 + 0.7 * ho);
      const hs = lerp(0.18, 1, Ease.outBack(ho));
      head.scale.set(hs, hs, hs);
      if (g >= 1) { head.position.y = H; head.scale.set(1, 1, 1); }
      petals.forEach((p) => { p.rotation.x = lerp(-0.2, 1.3, Ease.outBack(ho)); });
    },
    update() {},
  };
  api.setGrowth(num(o.growth, 0));
  return api;
};

// ============================================================================ drum
B.drum = (o) => {
  const CS = [0xff6f7f, 0x6fb0ff, 0xffd84d, 0x7fd88f];
  const c = col(CS[clamp(Math.round(num(o.color, 0)), 0, 3)]);
  const root = new Node('drum');
  const body = grp(root, 'body');
  const bm = pmatG(c, { spec: 0.35 });
  add(body, K('drBody', () => latheD([[0, 0], [0.36, 0], [0.39, 0.04], [0.41, 0.25], [0.39, 0.46], [0.36, 0.5], [0, 0.5]], 22)), bm);
  const gold = MG(0xffcf4d, { spec: 0.6 });
  for (const y of [0.04, 0.47]) add(body, tor(0.12, 6, 26), gold, { p: [0, y, 0], r: [PI / 2, 0, 0], s: 0.38 });
  const zig = K('drZig', () => { const pts = []; const n = 16; for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; pts.push([Math.sin(a) * 0.415, i % 2 ? 0.1 : 0.42, Math.cos(a) * 0.415]); } return tubeGeo(pts, 0.014, 4); });
  add(body, zig, M(0xffffff));
  const head = grp(body, 'head', [0, 0.5, 0]);
  const hm = pmat(0xfff8ee, { spec: 0.2 });
  add(head, K('drHead', () => latheD([[0, 0], [0.37, 0], [0.36, 0.02], [0.2, 0.035], [0, 0.04]], 22)), hm);
  add(head, starFlat(), M(c), { p: [0, 0.045, 0], r: [-PI / 2, 0, 0], s: [0.24, 0.24, 0.2] });
  const glow = add(root, tor(0.15, 6, 28), MGlow(c, { opacity: 1 }), { p: [0, 0.52, 0], r: [PI / 2, 0, 0], s: 0.42 });
  glow.visible = false;
  const sq = new Spring(260, 10);
  let lt = 0;
  return {
    root, type: 'drum', color: c,
    hit() { sq.kick(-4); lt = 1; },
    update(dt) {
      const s = sq.update(0, dt);
      body.scale.set(1 - s * 0.1, 1 + s * 0.18, 1 - s * 0.1);
      head.position.y = 0.5 + s * 0.02;
      lt = Math.max(0, lt - dt * 2);
      setE(bm, c, lt * 0.5); setE(hm, 0xffffff, lt * 0.3);
      glow.visible = lt > 0.01; glow.opacity = lt; const gs = 0.42 + (1 - lt) * 0.35; glow.scale.set(gs, gs, gs);
    },
  };
};

// ============================================================================ target
B.target = (o) => {
  const root = new Node('target');
  add(root, rbox(0.12, 1.05, 0.12, 0.04, 1), M(0xc98b55), { p: [0, 0.52, -0.05] });
  add(root, K('tgFoot', () => latheD([[0, 0], [0.22, 0], [0.24, 0.05], [0.12, 0.1], [0, 0.1]], 12)), M(0xd5cfe6));
  const board = grp(root, 'board', [0, 1.05, 0.03]);
  const wob = grp(board, 'wob');
  const cs = [0xff6f7f, 0xffffff, 0xff6f7f, 0xffffff];
  const ringMats = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.42 - i * 0.1;
    const m = pmat(cs[i], { spec: 0.15 });
    ringMats.push(m);
    add(wob, cyl(24), m, { p: [0, 0, i * 0.012], r: [PI / 2, 0, 0], s: [r, 0.07, r] });
  }
  add(wob, tor(0.12, 6, 28), MG(0xffcf4d), { p: [0, 0, 0.0], s: 0.42 });
  const starM = pmatG(0xffcf4d, { spec: 0.6 });
  const star = add(wob, starFlat(), starM, { p: [0, 0, 0.09], s: [0.17, 0.17, 0.3] });
  const done = grp(wob, 'done');
  add(done, starGeo(), MG(0xffe066, { spec: 0.6, emissive: 0x332200 }), { p: [0, 0, 0.1], s: [0.5, 0.5, 0.4] });
  done.visible = false;
  const sp = new Spring(120, 5);
  let isDone = false, dk = 0, flipT = -1;
  return {
    root, type: 'target', get done() { return isDone; },
    hit() { sp.kick(6); wob.traverse((n) => { if (n.isMesh) n.flash = 0.7; }); },
    setDone() { if (isDone) return; isDone = true; flipT = 0; },
    reset() { isDone = false; flipT = -1; dk = 0; board.rotation.y = 0; ringMats.forEach((m, i) => lerpC(m, cs[i], cs[i], 1)); done.visible = false; star.visible = true; },
    update(dt) {
      const w = sp.update(0, dt);
      wob.rotation.x = -w * 0.08; wob.rotation.z = w * 0.03;
      wob.traverse((n) => { if (n.isMesh && n.flash > 0) n.flash = Math.max(0, n.flash - dt * 3); });
      if (flipT >= 0) {
        flipT += dt;
        const k = clamp(flipT / 0.6, 0, 1);
        board.rotation.y = Ease.outBack(k) * TAU;
        dk = k;
        const pal = [0xffd84d, 0xfff6c8, 0xffb84d, 0xfff6c8];
        ringMats.forEach((m, i) => lerpC(m, cs[i], pal[i], k));
        done.visible = k > 0.3; const ds = Ease.outBack(clamp((k - 0.3) / 0.7, 0, 1)); done.scale.set(ds, ds, ds);
        star.visible = k < 0.3;
        if (k >= 1) flipT = -1;
      }
      if (isDone) done.rotation.z += dt * 0.8;
      void dk; void starM;
    },
  };
};

// ============================================================================ mailbox
B.mailbox = (o) => {
  const root = new Node('mailbox');
  const mc = col(o.color ?? 0x7fb8ff);
  add(root, rbox(0.12, 0.8, 0.12, 0.04, 1), M(0xc98b55), { p: [0, 0.4, 0] });
  const box2 = grp(root, 'box', [0, 0.8, 0]);
  const bm = M(mc, { spec: 0.25 });
  add(box2, rbox(0.42, 0.24, 0.56, 0.05, 1), bm, { p: [0, 0.12, 0] });
  add(box2, K('mbTop', () => G.cylinderGeo(0.21, 0.21, 0.56, 14, 1, true, -PI / 2, PI)), bm, { p: [0, 0.24, 0], r: [PI / 2, 0, PI / 2] });
  add(box2, heartFlat(), M(0xff8fbf), { p: [0.215, 0.2, 0], r: [0, PI / 2, 0], s: [0.14, 0.14, 0.2] });
  add(box2, K('mbBack', () => G.circleGeo(0.2, 12)), M(dim(mc, 0.8)), { p: [0, 0.24, -0.281], r: [-PI / 2, 0, 0] });
  // door (front, hinged at bottom)
  const door = grp(box2, 'door', [0, 0.0, 0.28]);
  const dg = K('mbDoor', () => G.extrudeGeo((() => { const pts = [[-0.21, 0], [0.21, 0], [0.21, 0.24]]; for (let i = 1; i < 12; i++) { const a = (i / 12) * PI; pts.push([Math.cos(a) * 0.21, 0.24 + Math.sin(a) * 0.21]); } pts.push([-0.21, 0.24]); return pts; })(), 0.03));
  add(door, dg, M(lighten(mc, 0.3), { spec: 0.25 }), { p: [0, 0, 0.015] });
  add(door, sph(8, 6), MG(0xffcf4d), { p: [0, 0.3, 0.04], s: 0.03 });
  const letter = grp(box2, 'letter', [0, 0.1, 0.1]);
  add(letter, box(), M(0xffffff), { s: [0.3, 0.2, 0.02], r: [-0.3, 0, 0] });
  add(letter, heartFlat(), M(0xff6f8f), { p: [0, 0.0, 0.015], r: [-0.3, 0, 0], s: [0.07, 0.07, 0.1] });
  letter.visible = false;
  // flag (side, hinged)
  const flag = grp(box2, 'flag', [-0.23, 0.14, -0.12]);
  add(flag, box(), M(0xd0d4e4), { p: [0, 0.0, 0.12], s: [0.025, 0.025, 0.24] });
  add(flag, rbox(0.03, 0.1, 0.12, 0.02, 1), M(0xff5f6f), { p: [0, 0.06, 0.2] });
  let opened = false, k = 0;
  return {
    root, type: 'mailbox', get opened() { return opened; },
    open() { opened = true; },
    close() { opened = false; },
    update(dt) {
      k = moveToward(k, opened ? 1 : 0, dt * 2.5);
      const e = Ease.outBack(k);
      door.rotation.x = e * 1.6;
      flag.rotation.x = -Ease.outBack(clamp(k * 1.3 - 0.2, 0, 1)) * 1.45;
      letter.visible = k > 0.3;
      letter.position.set(0, 0.1 + clamp(k * 1.4 - 0.4, 0, 1) * 0.22, 0.1 + clamp(k * 1.4 - 0.4, 0, 1) * 0.1);
    },
  };
};

// ============================================================================ nest (+ setEggs)
B.nest = (o) => {
  const root = new Node('nest');
  const g = K('nestGeo', () => {
    const r = new RNG(11), items = [];
    items.push({ geo: G.latheGeo([[0, 0.06], [0.22, 0.07], [0.3, 0.12], [0.31, 0.16], [0, 0.13]], 14), m: null, c: 0xfff0dc });
    for (let i = 0; i < 26; i++) {
      const a0 = r.next() * TAU, len = r.range(0.8, 1.6), rr = r.range(0.3, 0.38), y = r.range(0.04, 0.2);
      const pts = [];
      for (let k = 0; k <= 5; k++) { const a = a0 + (k / 5) * len; pts.push([Math.sin(a) * rr, y + Math.sin(k * 1.3 + i) * 0.04, Math.cos(a) * rr]); }
      items.push({ geo: tubeGeo(pts, 0.025, 4, { round: true }), m: null, c: mixc(0xb98a62, 0xd9a874, r.next()) });
    }
    items.push({ geo: G.torusGeo(0.33, 0.1, 6, 20), m: m4([0, 0.11, 0], [PI / 2, 0, 0], [1, 1, 0.9]), c: 0xc4956a });
    return merge(items);
  });
  add(root, g, VCs());
  const eggs = [];
  const ec = [0xbfe4ff, 0xfff4e0, 0xffd6e8];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    const e = add(root, K('egg', () => colored(G.latheGeo([[0, -1], [0.55, -0.85], [0.78, -0.4], [0.75, 0.2], [0.5, 0.7], [0, 0.95]], 12), (x, y, z) => { const sp = Math.sin(x * 23) * Math.sin(y * 19) * Math.sin(z * 17) > 0.6 ? 0.88 : 1; return [sp, sp, sp]; })),
      M(ec[i], { vertexColors: true, spec: 0.25 }), { p: [Math.sin(a) * 0.1, 0.17, Math.cos(a) * 0.1], r: [0.3, a, 0.2], s: 0.085 });
    e.visible = false; eggs.push(e);
  }
  let n = 0;
  const api = { root, type: 'nest', get eggs() { return n; }, setEggs(k) { n = clamp(Math.round(num(k, 0)), 0, 3); eggs.forEach((e, i) => (e.visible = i < n)); }, update() {} };
  api.setEggs(num(o.eggs, 0));
  return api;
};

// ============================================================================ bell
B.bell = (o) => {
  const root = new Node('bell');
  const wood = M(0xc98b55), woodL = M(0xe8ae76);
  for (const sd of [-1, 1]) {
    add(root, rbox(0.16, 2.0, 0.16, 0.05, 1), wood, { p: [sd * 0.65, 1.0, 0] });
    add(root, rbox(0.3, 0.1, 0.3, 0.04, 1), M(0xd5cfe6), { p: [sd * 0.65, 0.05, 0] });
  }
  add(root, rbox(1.6, 0.16, 0.22, 0.06, 2), woodL, { p: [0, 2.0, 0] });
  for (const sd of [-1, 1]) add(root, rbox(1.85, 0.07, 0.42, 0.03, 1), M(0xff8fbf), { p: [0, 2.2, sd * 0.17], r: [sd * 0.55, 0, 0] });
  add(root, cyl(10), M(0xffffff), { p: [-0.95, 2.31, 0], r: [0, 0, -PI / 2], s: [0.045, 1.9, 0.045] });
  add(root, starFlat(), MG(0xffcf4d), { p: [0, 2.48, 0.0], s: [0.2, 0.2, 0.3] });
  const piv = grp(root, 'pivot', [0, 1.92, 0]);
  add(piv, tor(0.3, 6, 12), MG(0xffcf4d), { p: [0, -0.04, 0], s: 0.05 });
  const gold = MG(0xffcf3d, { spec: 0.7, rim: 0.5, emissive: 0x221500 });
  const bellG = K('bellBody', () => latheD([[0, -0.1], [0.08, -0.1], [0.12, -0.14], [0.18, -0.3], [0.22, -0.52], [0.3, -0.68], [0.33, -0.74], [0.3, -0.76], [0.24, -0.72], [0, -0.7]], 20));
  const bellN = add(piv, bellG, gold);
  add(piv, tor(0.12, 6, 24), MG(0xffe680, { spec: 0.6 }), { p: [0, -0.6, 0], r: [PI / 2, 0, 0], s: 0.27 });
  const bow = grp(piv, 'bow', [0, -0.18, 0.13]);
  for (const sd of [-1, 1]) add(bow, sph(10, 7), MG(0xff5f9e), { p: [sd * 0.07, 0, 0], r: [0, 0, sd * 0.4], s: [0.07, 0.05, 0.03] });
  add(bow, starFlat(), MG(0xffe680), { p: [0, 0, 0.02], s: [0.06, 0.06, 0.1] });
  const clapP = grp(piv, 'clapper', [0, -0.3, 0]);
  add(clapP, cyl(6), M(0xb8b2cc), { p: [0, -0.4, 0], s: [0.015, 0.4, 0.015] });
  add(clapP, sph(10, 7), MG(0xd8b040), { p: [0, -0.44, 0], s: 0.07 });
  const halo = add(piv, ico(2), glowInst(0xffe27a, { opacity: 1 }), { p: [0, -0.45, 0], s: 0.6 });
  halo.visible = false;
  let a = 0, v = 0, ca = 0, cv = 0, glowT = 0;
  return {
    root, type: 'bell',
    ring(k = 1) { v += 4.5 * k; glowT = 1; },
    update(dt) {
      const acc = -a * 30 - v * 1.6;
      v += acc * dt; a += v * dt;
      const cacc = -(ca - a) * 60 - cv * 3;
      cv += cacc * dt; ca += cv * dt;
      piv.rotation.x = a * 0.5;
      clapP.rotation.x = (ca - a) * 0.6;
      glowT = Math.max(0, glowT - dt * 0.8);
      halo.visible = glowT > 0.01; halo.opacity = glowT * 0.8;
      setE(gold, 0xffd040, glowT * 0.4 + 0.13);
      void bellN;
    },
  };
};

// ============================================================================ signBoard
B.signBoard = (o) => {
  const icon = ['arrow', 'star', 'paw', '!', '?'].includes(o.icon) ? o.icon : 'arrow';
  const root = new Node('signBoard');
  add(root, rbox(0.12, 1.0, 0.1, 0.04, 1), M(0xc98b55), { p: [0, 0.5, -0.02] });
  const bd = grp(root, 'board', [0, 1.02, 0.03]);
  add(bd, K('sbBoard', () => G.extrudeGeo(roundPoly([[-0.42, -0.27], [0.42, -0.27], [0.42, 0.27], [-0.42, 0.27]], 0.1, 3), 0.08)), M(0xd9a06a));
  add(bd, K('sbFace', () => G.extrudeGeo(roundPoly([[-0.36, -0.21], [0.36, -0.21], [0.36, 0.21], [-0.36, 0.21]], 0.07, 3), 0.02)), M(0xfff4e2), { p: [0, 0, 0.045] });
  const F = [0, 0, 0.06];
  if (icon === 'arrow') add(bd, K('sbArrow', () => G.extrudeGeo(roundPoly([[-0.24, -0.06], [0.06, -0.06], [0.06, -0.14], [0.26, 0], [0.06, 0.14], [0.06, 0.06], [-0.24, 0.06]], 0.025, 2), 0.04)), M(0xff7fae), { p: F });
  else if (icon === 'star') add(bd, starFlat(), MG(0xffcf4d), { p: F, s: [0.34, 0.34, 0.25] });
  else if (icon === 'paw') {
    const pm = M(0xff8fbf);
    add(bd, sph(12, 8), pm, { p: [0, -0.05, 0.05], s: [0.1, 0.08, 0.02] });
    for (const [x, y] of [[-0.12, 0.05], [-0.045, 0.11], [0.045, 0.11], [0.12, 0.05]]) add(bd, sph(10, 6), pm, { p: [x, y, 0.05], s: [0.042, 0.05, 0.02] });
  } else if (icon === '!') {
    add(bd, rbox(0.07, 0.24, 0.04, 0.03, 1), M(0xff5f6f), { p: [0, 0.04, 0.06] });
    add(bd, sph(8, 6), M(0xff5f6f), { p: [0, -0.14, 0.06], s: [0.04, 0.04, 0.02] });
  } else {
    add(bd, K('qArc', () => G.torusGeo(0.08, 0.028, 5, 14, PI * 1.3)), M(0x7f9cff), { p: [0, 0.07, 0.06], r: [0, 0, -0.65 * PI / 2] });
    add(bd, rbox(0.05, 0.08, 0.04, 0.02, 1), M(0x7f9cff), { p: [0.0, -0.06, 0.06] });
    add(bd, sph(8, 6), M(0x7f9cff), { p: [0, -0.15, 0.06], s: [0.035, 0.035, 0.02] });
  }
  return { root, type: 'signBoard', icon, update() {} };
};

// ============================================================================ dreamLight (goal "꿈빛")
B.dreamLight = (o) => {
  const c = col(o.color ?? 0xffa8dc);
  const root = new Node('dreamLight');
  add(root, K('dlBase', () => latheD([[0, 0], [0.55, 0], [0.58, 0.06], [0.5, 0.14], [0.36, 0.2], [0.32, 0.3], [0.36, 0.34], [0, 0.34]], 22)), M(0xf2eefc));
  add(root, tor(0.15, 6, 24), MG(0xffcf4d), { p: [0, 0.3, 0], r: [PI / 2, 0, 0], s: 0.35 });
  const baseCr = K('dlBaseCr', () => merge([0, 1, 2, 3, 4, 5].flatMap((i) => { const a = (i / 6) * TAU; const h = i % 2 ? 0.22 : 0.3; return [
    { geo: prismBody(6, 0.8), m: m4([Math.sin(a) * 0.45, 0.08, Math.cos(a) * 0.45], [0.35, a, 0], [0.06, h, 0.06]), c: lighten(c, 0.2) },
    { geo: prismTip(6, 0.8), m: Mat4mul(m4([Math.sin(a) * 0.45, 0.08, Math.cos(a) * 0.45], [0.35, a, 0]), m4([0, h, 0], 0, [0.06, 0.1, 0.06])), c: 0xffffff },
  ]; })));
  add(root, baseCr, VCs({ spec: 0.4 }));
  const fl = grp(root, 'float', [0, 1.4, 0]);
  const cradle = grp(fl, 'cradle');
  const cm = MG(lighten(c, 0.35), { spec: 0.6, emissive: dim(c, 0.12) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const n = grp(cradle, '', [Math.sin(a) * 0.26, -0.3, Math.cos(a) * 0.26], [0.55, a, 0]);
    add(n, prismBody(6, 0.8), cm, { s: [0.075, 0.3, 0.075] });
    add(n, prismTip(6, 0.8), MU(lighten(c, 0.6)), { p: [0, 0.3, 0], s: [0.075, 0.14, 0.075] });
  }
  add(cradle, prismTip(6, 0.8), cm, { p: [0, -0.32, 0], r: [PI, 0, 0], s: [0.16, 0.22, 0.16] });
  const orbM = MG(lighten(c, 0.3), { spec: 0.7, rim: 0.6, emissive: dim(c, 0.45) });
  const orb = add(fl, sph(20, 14), orbM, { s: 0.27 });
  const inner = add(fl, starGeo(), MU(0xfffbe8), { p: [0, 0, 0.12], s: [0.24, 0.24, 0.3] });
  add(fl, sph(8, 6), MU(0xffffff), { p: [-0.09, 0.12, 0.2], s: [0.05, 0.035, 0.02] });
  const halo1 = add(fl, ico(2), glowInst(dim(c, 0.6), { opacity: 1 }), { s: 0.5 });
  const halo2 = add(fl, ico(2), glowInst(dim(c, 0.45), { opacity: 1, rim: 2.5 }), { s: 1.0 });
  const sparks = [];
  for (let i = 0; i < 5; i++) sparks.push(add(fl, sparkGeo(), MU(i % 2 ? 0xffffff : lighten(c, 0.5)), { s: 0.1 }));
  let t = Math.random() * 6;
  return {
    root, type: 'dreamLight', color: c, orb: fl,
    update(dt) {
      t += dt;
      fl.position.y = 1.4 + Math.sin(t * 1.6) * 0.06;
      cradle.rotation.y = t * 0.5;
      inner.rotation.z = t * 1.2;
      const p = 0.5 + 0.5 * Math.sin(t * 2.4);
      const os = 0.27 * (1 + p * 0.06); orb.scale.set(os, os, os);
      const h1 = 0.46 + p * 0.08; halo1.scale.set(h1, h1, h1); halo1.opacity = 0.55 + p * 0.3;
      const h2 = 0.95 + p * 0.15; halo2.scale.set(h2, h2, h2); halo2.opacity = 0.25 + p * 0.2;
      sparks.forEach((s, i) => {
        const a = t * 0.9 + (i / 5) * TAU, ph = (t * 0.7 + i * 0.29) % 1;
        s.position.set(Math.cos(a) * 0.55, Math.sin(a * 1.7 + i) * 0.3, Math.sin(a) * 0.55);
        const k = Math.sin(ph * PI) * 0.12; s.scale.set(k, k, k); s.rotation.z = t * 2;
      });
    },
  };
};

// ============================================================================ collectibles
export function starCandyGeo(color = 0xffd23f) {
  const c = col(color);
  const key = 'starCandyGeo' + c.map((v) => v.toFixed(3)).join(',');
  return K(key, () => {
    const body = G.puffyShapeGeo(roundStarOutline(5, 0.5, 0.29, 30, 1.25), 0.24, 3);
    const items = [
      { geo: colored(body, (x, y, z) => { const k = 0.86 + 0.24 * clamp(z / 0.24, -1, 1) * 0.5 + 0.12 * clamp(y, -0.5, 0.5); return [c[0] * k, c[1] * k, c[2] * k]; }), m: m4([0, 0, 0], 0, 0.36), c: 0xffffff },
      { geo: G.sphereGeo(1, 8, 6), m: m4([-0.045, 0.055, 0.075], [0, 0, 0.6], [0.035, 0.022, 0.012]), c: lighten(c, 0.85) },
      { geo: G.sphereGeo(1, 6, 4), m: m4([-0.005, 0.085, 0.066], 0, [0.012, 0.012, 0.008]), c: lighten(c, 0.85) },
    ];
    const g = merge(items);
    g.computeBoundingSphere();
    return g;
  });
}
B.starCandy = (o) => {
  const c = col(o.color ?? 0xffd23f);
  const root = new Node('starCandy');
  const spin = grp(root, 'spin');
  add(spin, starCandyGeo(c), MG(0xffffff, { vertexColors: true, spec: 0.55, rim: 0.45 }));
  const halo = add(spin, ico(1), GLOWM(lighten(c, 0.3), { opacity: 0.45 }), { s: 0.24 });
  void halo;
  let t = Math.random() * 6;
  return {
    root, type: 'starCandy', color: c,
    update(dt) { t += dt; spin.rotation.y = t * 2.6; spin.position.y = Math.sin(t * 3) * 0.035; spin.rotation.z = Math.sin(t * 1.7) * 0.1; },
  };
};
B.bigCandy = (o) => {
  const root = new Node('bigCandy');
  const spin = grp(root, 'spin');
  const cs = [col(o.color ?? 0xff7fb4), [1, 1, 1]];
  for (let i = 0; i < 8; i++) {
    const g = K('bcWedge' + i, () => {
      const gg = G.sphereGeo(1, 3, 12, (i / 8) * TAU, TAU / 8);
      gg.displace((v) => { const a = v.y * 1.4; const cx = Math.cos(a), sx = Math.sin(a); const x = v.x * cx - v.z * sx, z = v.x * sx + v.z * cx; v.x = x; v.z = z; });
      gg.computeVertexNormals();
      return gg;
    });
    add(spin, g, MG(cs[i % 2], { spec: 0.6, rim: 0.4 }), { s: 0.21 });
  }
  const wrapM = MG(0xc9a8ff, { spec: 0.5, rim: 0.5 });
  const twist = K('bcTwist', () => latheD([[0.0, 0], [0.07, 0.02], [0.035, 0.08], [0.03, 0.1], [0.08, 0.16], [0.14, 0.22], [0.15, 0.25], [0.0, 0.24]], 12, (a, y) => (y > 0.12 ? 1 + 0.25 * Math.cos(a * 7) * smoothstep(0.12, 0.25, y) : 1)));
  for (const sd of [-1, 1]) add(spin, twist, wrapM, { p: [sd * 0.17, 0, 0], r: [0, 0, -sd * PI / 2], s: 0.76 });
  add(spin, sph(8, 6), MU(0xffffff), { p: [-0.07, 0.11, 0.15], s: [0.045, 0.03, 0.02] });
  add(spin, ico(1), GLOWM(0xffc0e0, { opacity: 0.4 }), { s: 0.42 });
  let t = Math.random() * 6;
  return { root, type: 'bigCandy', update(dt) { t += dt; spin.rotation.y = t * 1.8; spin.position.y = Math.sin(t * 2.4) * 0.05; spin.rotation.x = Math.sin(t * 1.3) * 0.15; } };
};
B.heartItem = (o) => {
  const root = new Node('heartItem');
  const piv = grp(root, 'bob');
  add(piv, heartGeo(), MG(o.color ?? 0xff5f86, { spec: 0.6, rim: 0.5, emissive: 0x200008 }), { s: [0.5, 0.5, 0.55] });
  add(piv, sph(8, 6), MU(0xffffff), { p: [-0.09, 0.1, 0.1], r: [0, 0, 0.5], s: [0.05, 0.03, 0.02] });
  add(piv, ico(1), GLOWM(0xff8fb0, { opacity: 0.45 }), { s: 0.36 });
  let t = Math.random() * 6;
  return {
    root, type: 'heartItem',
    update(dt) {
      t += dt;
      piv.position.y = Math.sin(t * 2.4) * 0.06;
      piv.rotation.y = Math.sin(t * 1.2) * 0.5;
      const b = 1 + Math.max(0, Math.sin(t * 6)) * 0.06 * (Math.sin(t * 1.5) > 0 ? 1 : 0.3);
      piv.scale.set(b, b, b);
    },
  };
};
B.cookieBase = (o) => {
  const root = new Node('cookieBase');
  add(root, K('cookie', () => colored(latheD([[0, -0.075], [0.26, -0.075], [0.3, -0.05], [0.305, 0], [0.29, 0.05], [0.25, 0.07], [0.0, 0.075]], 32, (a) => 1 + 0.03 * Math.cos(a * 16)),
    (x, y, z) => { const r = Math.hypot(x, z) / 0.3; const k = lerp(1.05, 0.82, smoothstep(0.55, 1.0, r)) * (y < -0.04 ? 0.85 : 1); return [k, k * 0.97, k * 0.92]; })),
    MG(0xf9c868, { vertexColors: true, spec: 0.4, rim: 0.4 }));
  const dots = K('cookieDots', () => merge(Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * TAU; return { geo: G.sphereGeo(1, 5, 3), m: m4([Math.sin(a) * 0.235, 0.064, Math.cos(a) * 0.235], 0, [0.016, 0.01, 0.016]), c: i % 3 === 0 ? 0xff8fbf : (i % 3 === 1 ? 0xffffff : 0x8fd0ff) }; })));
  add(root, dots, VCs());
  add(root, tor(0.12, 6, 32), MG(0xffd27a, { spec: 0.6 }), { p: [0, 0.03, 0], r: [PI / 2, 0, 0], s: 0.27 });
  const top = grp(root, 'top', [0, 0.075, 0]);
  const sparks = [];
  for (let i = 0; i < 4; i++) sparks.push(add(root, sparkGeo(), MU(0xfffbe0), { s: 0.1 }));
  let t = Math.random() * 6;
  return {
    root, type: 'cookieBase', top,
    update(dt) {
      t += dt;
      sparks.forEach((s, i) => {
        const ph = (t * 0.8 + i * 0.25) % 1, a = i * 1.7 + Math.floor(t * 0.8 + i * 0.25) * 2.3;
        s.position.set(Math.sin(a) * 0.34, 0.02 + Math.sin(a * 3) * 0.05, Math.cos(a) * 0.34);
        const k = Math.sin(ph * PI) * 0.1; s.scale.set(k, k, k); s.rotation.z = t * 2;
      });
    },
  };
};

// ---------------------------------------------------------------- public
export const OBJECT_TYPES = Object.keys(B);
export function buildObject(type, opts = {}) {
  const f = B[type];
  if (!f) { console.warn('buildObject: unknown type ' + type); return B.crate({}); }
  const o = f(opts || {});
  if (!o.update) o.update = () => {};
  o.type = type;
  return o;
}

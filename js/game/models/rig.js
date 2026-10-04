// ============================================================================
// models/rig.js — CharacterRig: shared chibi skeleton + procedural animator.
// All 30 animal forms are built on this rig (see animals.js for specs).
//
// Skeleton (local space, root at feet center, facing +Z):
//   root -> base (squash/stretch, lean, spin) -> hips (body) -> neck -> head
//                                               hips -> armL/armR (shoulder pivots) -> handL/handR
//                                               hips -> legL/legR (hip pivots)
//                                               hips -> tail
//                                               head -> earL/earR, face (eyes/mouth/cheeks), ribbon
// State passed to update():
//   { anim, t, speed(0..1), vy, puff(0..1), attackKind, specialKind, swimDepth }
// ============================================================================
import { Node } from '../../engine/scene.js';
import {
  G, UNIT, M, MG, MU, add, grp, ell, onSphere, faceRot, makeEyes, makeCheeks, makeMouth, makeRibbon,
  setFlash, setOpacity, Spring, approach, chain, PI, TAU, lerp, clamp,
} from './common.js';
import { makePatternTexture } from '../../engine/texgen.js';
import { mat } from '../../engine/material.js';

// ---------------------------------------------------------------- part registry
export const PARTS = { ears: {}, snout: {}, tail: {}, extra: {}, body: {}, arms: {}, legs: {} };
export function registerPart(kind, type, fn) { PARTS[kind][type] = fn; }

const patternCache = new Map();
function patternMat(spec, color) {
  const key = JSON.stringify([spec.pattern, color]);
  let m = patternCache.get(key);
  if (!m) {
    const tex = makePatternTexture(spec.pattern.type, spec.pattern.base || cssHex(color), cssHex(spec.pattern.mark), spec.pattern.seed || 3);
    m = mat(color, { spec: 0.12, rim: 0.38, map: tex, ...(spec.pattern.matOpts || {}) });
    m.color = [1, 1, 1];
    patternCache.set(key, m);
  }
  return m;
}
export function cssHex(c) { return typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c; }

// ---------------------------------------------------------------- rig
export class CharacterRig {
  constructor(spec) {
    this.spec = spec;
    const C = spec.colors;
    const P = Object.assign({
      hipY: 0.34, bodyR: 0.27, bodyS: [1, 0.95, 0.92], headR: 0.42, headS: [1.04, 0.96, 1], headY: 0.42,
      shoulderX: 0.235, shoulderY: 0.1, armR: 0.075, armL: 0.12, legX: 0.13, legY: -0.2, footS: [0.1, 0.085, 0.13],
    }, spec.prop || {});
    this.P = P;
    this.root = new Node('rig-' + spec.id);
    this.base = grp(this.root, 'base');
    this.hips = grp(this.base, 'hips', [0, P.hipY, 0]);
    this.mats = {
      body: spec.pattern && spec.pattern.on !== 'head' ? patternMat(spec, C.body) : M(C.body),
      head: spec.pattern && spec.pattern.on !== 'body' ? patternMat(spec, C.body) : M(C.body),
      plain: M(C.body),
      belly: M(C.belly ?? 0xffffff),
      limb: M(C.limb ?? C.body),
      foot: M(C.foot ?? C.limb ?? C.body),
      accent: M(C.accent ?? 0xffa0b8),
      dark: MG(C.dark ?? 0x4a3a52),
      nose: MG(C.nose ?? 0xff7b9c, { spec: 0.5 }),
      white: M(0xffffff),
    };
    // body
    if (PARTS.body[spec.body?.type]) PARTS.body[spec.body.type](this, spec);
    else {
      this.bodyMesh = ell(this.hips, this.mats.body, [0, 0, 0], P.bodyR * P.bodyS[0], P.bodyR * P.bodyS[1], P.bodyR * P.bodyS[2], null, 'body');
      if (spec.belly !== false) ell(this.hips, this.mats.belly, [0, -0.02, P.bodyR * 0.52], P.bodyR * 0.62, P.bodyR * 0.72, P.bodyR * 0.5, null, 'belly');
    }
    // neck/head
    this.neck = grp(this.hips, 'neck', [0, P.headY, 0]);
    this.head = grp(this.neck, 'head');
    this.headMesh = ell(this.head, this.mats.head, [0, 0, 0], P.headR * P.headS[0], P.headR * P.headS[1], P.headR * P.headS[2], null, 'headMesh');
    // face
    const F = spec.face || {};
    this.eyes = makeEyes(this.head, { headR: P.headR * Math.max(P.headS[2], 0.9), yaw: F.eyeYaw ?? 17, pitch: F.eyePitch ?? 5, size: F.eyeSize ?? 1, color: F.eyeColor, glint: F.glint });
    this.cheeks = spec.cheeks === false ? [] : makeCheeks(this.head, { headR: P.headR * P.headS[2], yaw: F.cheekYaw ?? 33, pitch: F.cheekPitch ?? -10, color: F.cheekColor });
    this.mouth = makeMouth(this.head, { headR: P.headR * P.headS[2], pitch: F.mouthPitch ?? -17, dy: F.mouthDy ?? 0, dz: F.mouthDz ?? 0, size: F.mouthSize ?? 1 });
    this.mouthNode = this.mouth.pivot;
    // arms
    this.armL = grp(this.hips, 'armL', [-P.shoulderX, P.shoulderY, 0.02]);
    this.armR = grp(this.hips, 'armR', [P.shoulderX, P.shoulderY, 0.02]);
    for (const [arm, sd] of [[this.armL, -1], [this.armR, 1]]) {
      if (PARTS.arms[spec.arms?.type]) PARTS.arms[spec.arms.type](this, arm, sd, spec);
      else ell(arm, this.mats.limb, [0, -P.armL * 0.7, 0], P.armR, P.armL, P.armR * 0.95, null, 'armMesh');
    }
    this.handL = grp(this.armL, 'handL', [0, -P.armL * 1.5, 0]);
    this.handR = grp(this.armR, 'handR', [0, -P.armL * 1.5, 0]);
    // legs
    this.legL = grp(this.hips, 'legL', [-P.legX, P.legY, 0]);
    this.legR = grp(this.hips, 'legR', [P.legX, P.legY, 0]);
    for (const [leg, sd] of [[this.legL, -1], [this.legR, 1]]) {
      if (PARTS.legs[spec.legs?.type]) PARTS.legs[spec.legs.type](this, leg, sd, spec);
      else ell(leg, this.mats.foot, [0, -0.06, 0.025], P.footS[0], P.footS[1], P.footS[2], null, 'foot');
    }
    // tail
    this.tail = grp(this.hips, 'tail', spec.tailPos || [0, -0.06, -P.bodyR * 0.88]);
    if (spec.tail && PARTS.tail[spec.tail.type]) PARTS.tail[spec.tail.type](this, spec.tail, spec);
    // ears
    this.earL = grp(this.head, 'earL');
    this.earR = grp(this.head, 'earR');
    if (spec.ears && PARTS.ears[spec.ears.type]) PARTS.ears[spec.ears.type](this, spec.ears, spec);
    // snout
    if (spec.snout && PARTS.snout[spec.snout.type]) PARTS.snout[spec.snout.type](this, spec.snout, spec);
    // extras
    for (const ex of spec.extras || []) {
      const t = typeof ex === 'string' ? { type: ex } : ex;
      if (PARTS.extra[t.type]) PARTS.extra[t.type](this, t, spec);
    }
    // ribbon
    const rb = spec.ribbon || {};
    if (rb !== false && spec.ribbon !== false) {
      const R = P.headR;
      const pos = onSphere(R * (rb.out ?? 0.98), rb.yaw ?? 32, rb.pitch ?? 52);
      this.ribbon = makeRibbon(this.head, { p: pos, r: [-(rb.tilt ?? 0.5), ((rb.yaw ?? 32) * PI) / 180, (rb.roll ?? -0.35)], s: rb.s ?? 1 });
    }
    // animation state
    this.phase = 0;
    this.time = Math.random() * 10;
    this.blinkT = 1 + Math.random() * 3;
    this.blinkPhase = -1;
    this.puff = 0;
    this.sq = new Spring(180, 11);
    this.earSpring = new Spring(90, 7);
    this.tailSpring = new Spring(70, 6);
    this.headLag = new Spring(120, 12);
    this.prevVy = 0;
    this.pose = {
      lean: 0, bob: 0, twist: 0, tilt: 0, headX: 0, headY: 0, headZ: 0,
      aLx: 0, aLz: -0.15, aRx: 0, aRz: 0.15, lLx: 0, lRx: 0, lLy: 0, lRy: 0, spin: 0, baseY: 0,
    };
    this.exprOverride = null;
    this.exprTimer = 0;
    this.height = P.hipY + P.headY + P.headR * P.headS[1];
    this.radius = Math.max(P.headR * P.headS[0], 0.38);
    this.onUpdate = spec.onUpdate || null;
    this.root.traverse((n) => { n.userData.rest = { px: n.position.x, py: n.position.y, pz: n.position.z, rx: n.rotation.x, ry: n.rotation.y, rz: n.rotation.z, sx: n.scale.x, sy: n.scale.y, sz: n.scale.z }; });
  }

  trigger(ev, k = 1) {
    if (ev === 'land') this.sq.kick(-2.6 * k);
    else if (ev === 'jump') this.sq.kick(2.4 * k);
    else if (ev === 'hit') { this.sq.kick(-1.5); this.flashT = 0.3; }
    else if (ev === 'flap') this.sq.kick(1.2 * k);
  }
  setExpression(e, dur = 0) { this.exprOverride = e; this.exprTimer = dur; }
  setFlash(v) { setFlash(this.root, v); }
  setOpacity(v) { setOpacity(this.root, v); }

  update(dt, st) {
    const p = this.pose, P = this.P;
    const anim = st.anim || 'idle';
    const t = st.t || 0;
    const sp = clamp(st.speed || 0, 0, 1.5);
    this.time += dt;
    const T = this.time;
    // targets
    let lean = 0, bob = 0, twist = 0, tilt = 0, hX = 0, hY = 0, hZ = 0;
    let aLx = 0, aLz = -0.18, aRx = 0, aRz = 0.18, lLx = 0, lRx = 0, lLy = 0, lRy = 0, baseY = 0;
    let puffT = 0, expr = 'normal', mouth = 'smile', spinV = null;
    let rate = 14;
    const breathe = Math.sin(T * 3.1) * 0.012;
    switch (anim) {
      case 'idle': {
        bob = breathe;
        hZ = Math.sin(T * 0.7) * 0.05;
        hY = Math.sin(T * 0.43) * 0.12;
        aLz = -0.2 - Math.sin(T * 3.1) * 0.04; aRz = 0.2 + Math.sin(T * 3.1) * 0.04;
        break;
      }
      case 'walk': case 'run': {
        const f = 6 + 7 * sp;
        this.phase += dt * f;
        const s = Math.sin(this.phase), c = Math.cos(this.phase);
        const amp = 0.45 + 0.45 * Math.min(sp, 1);
        lLx = s * amp; lRx = -s * amp;
        lLy = Math.max(0, -c) * 0.06 * sp; lRy = Math.max(0, c) * 0.06 * sp;
        aLx = -s * 0.7 * amp; aRx = s * 0.7 * amp;
        aLz = -0.25 - sp * 0.15; aRz = 0.25 + sp * 0.15;
        bob = Math.abs(Math.sin(this.phase)) * 0.05 * (0.4 + sp);
        lean = 0.1 * sp;
        twist = s * 0.12 * sp;
        tilt = c * 0.05 * sp;
        hZ = -c * 0.04 * sp;
        mouth = sp > 0.9 ? 'open' : 'smile';
        rate = 20;
        break;
      }
      case 'jump': {
        lLx = 0.5; lRx = 0.25; aLz = -1.9; aRz = 1.9; aLx = -0.2; aRx = -0.2; hX = -0.12; mouth = 'open';
        break;
      }
      case 'fall': {
        lLx = -0.25; lRx = 0.15; aLz = -2.3 + Math.sin(T * 14) * 0.15; aRz = 2.3 - Math.sin(T * 14) * 0.15; hX = 0.08; mouth = 'o';
        break;
      }
      case 'hover': {
        puffT = 1;
        const fl = Math.sin(T * 20);
        aLz = -1.35 - fl * 0.55; aRz = 1.35 + fl * 0.55; aLx = 0.1; aRx = 0.1;
        lLx = Math.sin(T * 6) * 0.3; lRx = -Math.sin(T * 6) * 0.3;
        mouth = 'o'; bob = Math.sin(T * 5) * 0.03;
        break;
      }
      case 'land': { aLz = -0.5; aRz = 0.5; break; }
      case 'attack': {
        expr = 'angry';
        const k = st.attackKind || 'punch';
        const u = clamp(t / 0.28, 0, 1);
        const out = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
        rate = 30;
        if (k === 'punch') { aRx = -1.7 * out; aRz = 0.2; twist = 0.45 * out; lean = 0.15 * out; aLx = 0.4 * out; mouth = 'open'; }
        else if (k === 'swipe') { aRx = -1.2; aRz = lerp(1.9, -0.4, Math.min(1, u * 1.6)); twist = lerp(-0.5, 0.6, Math.min(1, u * 1.6)); lean = 0.12; mouth = 'open'; }
        else if (k === 'throw') { aRx = u < 0.4 ? lerp(0, 2.4, u / 0.4) : lerp(2.4, -1.4, (u - 0.4) / 0.6); twist = u < 0.4 ? -0.3 : 0.4; lean = u < 0.4 ? -0.05 : 0.15; mouth = 'open'; }
        else if (k === 'smash') { const up = u < 0.45; aLx = aRx = up ? lerp(0, 2.8, u / 0.45) : lerp(2.8, -1.3, Math.min(1, (u - 0.45) / 0.25)); aLz = -0.2; aRz = 0.2; lean = up ? -0.1 : 0.3; baseY = up ? 0 : -0.05; mouth = 'open'; }
        else if (k === 'spin') { spinV = u * TAU * 1.0; aLz = -1.5; aRz = 1.5; mouth = 'open'; }
        else if (k === 'breath') { hX = 0.15; lean = 0.18; aLx = 0.5; aRx = 0.5; aLz = -0.6; aRz = 0.6; mouth = 'open'; }
        else if (k === 'cast') { aLx = -1.4 * out - 0.2; aRx = -1.4 * out - 0.2; aLz = -0.25; aRz = 0.25; lean = 0.1; mouth = 'open'; }
        else if (k === 'kick') { lRx = -1.4 * out; lean = -0.2 * out; aLz = -0.9; aRz = 0.9; }
        else if (k === 'bite') { lean = 0.4 * out; hX = 0.2 * out; aLz = -0.8; aRz = 0.8; mouth = 'open'; }
        else if (k === 'headbutt') { lean = 0.5 * out; hX = 0.35 * out; aLx = 0.6; aRx = 0.6; }
        break;
      }
      case 'airAttack': {
        expr = 'angry'; spinV = clamp(t / 0.32, 0, 1) * TAU; aLz = -1.6; aRz = 1.6; lLx = 0.3; lRx = 0.3; mouth = 'open';
        break;
      }
      case 'pound': {
        expr = 'angry'; lLx = -0.6; lRx = -0.6; aLz = -2.6; aRz = 2.6; hX = 0.15; puffT = 0.4; mouth = 'open';
        break;
      }
      case 'special': {
        const k = st.specialKind || 'cast';
        mouth = 'open';
        if (k === 'roar') { aLz = -1.3; aRz = 1.3; aLx = -0.5; aRx = -0.5; hX = -0.2; lean = -0.1; expr = 'angry'; bob = Math.sin(T * 40) * 0.01; }
        else if (k === 'dash') { lean = 0.55; aLx = 1.2; aRx = 1.2; aLz = -0.5; aRz = 0.5; lLx = -0.6; lRx = 0.5; expr = 'angry'; }
        else if (k === 'smile') { expr = 'happy'; mouth = 'open'; aLz = -2.5; aRz = 2.5; bob = Math.abs(Math.sin(T * 9)) * 0.08; }
        else if (k === 'sniff') { lean = 0.35; hX = 0.3; hY = Math.sin(T * 6) * 0.4; mouth = 'w'; aLx = 0.3; aRx = 0.3; }
        else if (k === 'dig') { lean = 0.45; hX = 0.25; aLx = -1.2 + Math.sin(T * 22) * 0.6; aRx = -1.2 - Math.sin(T * 22) * 0.6; mouth = 'w'; }
        else if (k === 'charge') { lean = -0.05; baseY = -0.08; aLz = -0.6; aRz = 0.6; expr = 'angry'; bob = Math.sin(T * 50) * 0.01; mouth = 'flat'; }
        else if (k === 'spray') { hX = 0.1; lean = 0.08; aLz = -0.4; aRz = 0.4; mouth = 'o'; }
        else if (k === 'cast') { aLx = -1.6; aRx = -1.6; aLz = -0.3; aRz = 0.3; expr = 'happy'; }
        else if (k === 'sleep') { expr = 'sleep'; mouth = 'o'; baseY = -0.06; hX = 0.25; aLz = -0.4; aRz = 0.4; lLx = -1.2; lRx = -1.2; bob = Math.sin(T * 1.6) * 0.015; }
        else if (k === 'curl') { puffT = 0.0; hX = 0.5; aLx = -1.5; aRx = -1.5; lLx = -1.5; lRx = -1.5; expr = 'hurt'; }
        else if (k === 'pose') { aLz = -2.2; aRz = 2.2; aLx = -0.4; aRx = -0.4; expr = 'angry'; mouth = 'open'; baseY = 0.05; }
        else if (k === 'stretch') { hX = -0.3; aLz = -1.0; aRz = 1.0; expr = 'normal'; }
        else if (k === 'tongue') { hX = 0.1; mouth = 'open'; lean = 0.1; }
        break;
      }
      case 'hurt': {
        expr = 'hurt'; mouth = 'frown'; lean = -0.35; aLz = -1.4; aRz = 1.4; hX = -0.2; lLx = 0.3; lRx = -0.3;
        break;
      }
      case 'swim': {
        const f = Math.sin(T * 7);
        aLx = -1.2 + f * 0.8; aRx = -1.2 - f * 0.8; aLz = -0.6; aRz = 0.6;
        lLx = f * 0.6; lRx = -f * 0.6; lean = 0.35; bob = Math.sin(T * 3) * 0.03; mouth = 'smile';
        break;
      }
      case 'dive': {
        const f = Math.sin(T * 9);
        lean = 1.35; aLz = -1.3 + f * 0.3; aRz = 1.3 - f * 0.3; lLx = f * 0.5; lRx = -f * 0.5; mouth = 'smile';
        break;
      }
      case 'climb': {
        const f = Math.sin(this.phase += dt * 8 * Math.max(0.2, sp));
        aLx = -2.6 + f * 0.5; aRx = -2.6 - f * 0.5; aLz = -0.3; aRz = 0.3; lLx = -0.6 - f * 0.4; lRx = -0.6 + f * 0.4; hX = -0.25;
        break;
      }
      case 'glide': {
        aLz = -1.55 + Math.sin(T * 3) * 0.05; aRz = 1.55 - Math.sin(T * 3) * 0.05; lean = 0.55; lLx = 0.5; lRx = 0.5; hX = -0.35; mouth = 'open';
        break;
      }
      case 'fly': {
        const fl = Math.sin(T * 14);
        aLz = -1.2 - fl * 0.6; aRz = 1.2 + fl * 0.6; lean = 0.35; lLx = 0.4; lRx = 0.4; hX = -0.2; mouth = 'smile';
        break;
      }
      case 'roll': case 'ball': {
        aLz = -0.3; aRz = 0.3; aLx = -1.2; aRx = -1.2; lLx = -1.2; lRx = -1.2; hX = 0.4; expr = 'angry';
        break;
      }
      case 'slide': {
        lean = 1.45; aLz = -0.25; aRz = 0.25; aLx = 2.5; aRx = 2.5; lLx = 0.25; lRx = 0.25; hX = -1.0; mouth = 'open'; expr = 'happy';
        break;
      }
      case 'celebrate': {
        expr = 'happy'; mouth = 'open';
        const u = t % 1.2;
        aLz = -2.6 + Math.sin(T * 10) * 0.25; aRz = 2.6 - Math.sin(T * 10) * 0.25;
        baseY = Math.max(0, Math.sin(Math.min(u / 0.6, 1) * PI)) * 0.35;
        spinV = u < 0.6 ? (u / 0.6) * TAU : 0;
        break;
      }
      case 'wave': {
        expr = 'happy'; mouth = 'open'; aRz = 2.5 + Math.sin(T * 12) * 0.35; aLz = -0.2; hZ = 0.12;
        break;
      }
      case 'sit': {
        baseY = -0.1; lLx = -1.45; lRx = -1.45; aLz = -0.35; aRz = 0.35; aLx = -0.4; aRx = -0.4; bob = breathe;
        break;
      }
      case 'sleep': {
        expr = 'sleep'; mouth = 'o'; baseY = -0.1; lLx = -1.45; lRx = -1.45; hX = 0.3; hZ = 0.2; aLz = -0.3; aRz = 0.3; bob = Math.sin(T * 1.5) * 0.02;
        break;
      }
      case 'talk': {
        bob = breathe; mouth = Math.sin(T * 16) > 0 ? 'open' : 'smile'; aRz = 0.5 + Math.sin(T * 4) * 0.2; hZ = Math.sin(T * 2) * 0.06;
        break;
      }
      case 'sad': { expr = 'sad'; mouth = 'frown'; hX = 0.25; aLz = -0.1; aRz = 0.1; bob = breathe; break; }
      case 'surprised': { expr = 'surprised'; mouth = 'o'; aLz = -1.0; aRz = 1.0; hX = -0.1; break; }
      case 'dead': { expr = 'hurt'; mouth = 'frown'; lean = -0.2; aLz = -1.8; aRz = 1.8; break; }
      default: bob = breathe;
    }
    if (st.expression) expr = st.expression;
    if (this.exprTimer > 0) { this.exprTimer -= dt; if (this.exprOverride) expr = this.exprOverride; if (this.exprTimer <= 0) this.exprOverride = null; }
    else if (this.exprOverride) expr = this.exprOverride;

    // smooth pose
    p.lean = approach(p.lean, lean, rate, dt); p.bob = approach(p.bob, bob, 25, dt);
    p.twist = approach(p.twist, twist, rate, dt); p.tilt = approach(p.tilt, tilt, rate, dt);
    p.headX = approach(p.headX, hX, rate * 0.8, dt); p.headY = approach(p.headY, hY, rate * 0.6, dt); p.headZ = approach(p.headZ, hZ, rate * 0.8, dt);
    p.aLx = approach(p.aLx, aLx, rate, dt); p.aLz = approach(p.aLz, aLz, rate, dt);
    p.aRx = approach(p.aRx, aRx, rate, dt); p.aRz = approach(p.aRz, aRz, rate, dt);
    p.lLx = approach(p.lLx, lLx, rate, dt); p.lRx = approach(p.lRx, lRx, rate, dt);
    p.lLy = approach(p.lLy, lLy, rate, dt); p.lRy = approach(p.lRy, lRy, rate, dt);
    p.baseY = approach(p.baseY, baseY, 16, dt);
    this.puff = approach(this.puff, puffT, puffT > this.puff ? 18 : 8, dt);

    // squash/stretch from vertical velocity changes + spring
    const sq = this.sq.update(anim === 'jump' ? 0.08 : 0, dt);
    const sY = clamp(1 + sq, 0.55, 1.45), sXZ = clamp(1 - sq * 0.55, 0.7, 1.35);
    const pf = 1 + this.puff * 0.28;
    this.base.scale.set(sXZ * pf, sY * (1 + this.puff * 0.2), sXZ * pf);
    this.base.position.y = p.bob + p.baseY;
    this.base.rotation.x = p.lean;
    if (spinV !== null) this.base.rotation.y = spinV; else this.base.rotation.y = approach(this.base.rotation.y, 0, 20, dt);
    if (anim === 'roll' || anim === 'ball') { this._roll = (this._roll || 0) + dt * (6 + sp * 14); this.hips.rotation.x = this._roll; }
    else { this._roll = 0; this.hips.rotation.x = approach(this.hips.rotation.x, 0, 20, dt); }
    this.hips.rotation.y = p.twist; this.hips.rotation.z = p.tilt;
    const hl = this.headLag.update(-(st.vy || 0) * 0.015, dt);
    this.head.rotation.set(p.headX + hl, p.headY, p.headZ);
    this.armL.rotation.set(p.aLx, 0, p.aLz);
    this.armR.rotation.set(p.aRx, 0, p.aRz);
    this.legL.rotation.x = p.lLx; this.legR.rotation.x = p.lRx;
    const lr = this.legL.userData.rest, rr = this.legR.userData.rest;
    this.legL.position.y = lr.py + p.lLy; this.legR.position.y = rr.py + p.lRy;
    // puffed cheeks
    for (const c of this.cheeks) { const k = 1 + this.puff * 0.6; const r = c.userData.rest; c.scale.set(r.sx * k, r.sy * k, r.sz); }
    // secondary motion
    const acc = ((st.vy || 0) - this.prevVy) / Math.max(dt, 1e-3);
    this.prevVy = st.vy || 0;
    this.earSpring.kick(clamp(acc * 0.0012, -0.5, 0.5));
    const ear = this.earSpring.update(anim === 'walk' || anim === 'run' ? Math.sin(this.phase * 2) * 0.08 * sp : 0, dt);
    this.earL.rotation.x = (this.earL.userData.rest.rx) + ear; this.earR.rotation.x = (this.earR.userData.rest.rx) + ear;
    this.earL.rotation.z = (this.earL.userData.rest.rz) - ear * 0.5; this.earR.rotation.z = (this.earR.userData.rest.rz) + ear * 0.5;
    const wag = anim === 'idle' || anim === 'celebrate' || anim === 'talk' ? Math.sin(T * (anim === 'celebrate' ? 14 : 3)) * 0.35 : Math.sin(this.phase) * 0.25 * sp;
    const tl = this.tailSpring.update(wag, dt);
    this.tail.rotation.y = (this.tail.userData.rest.ry) + tl;
    this.tail.rotation.x = (this.tail.userData.rest.rx) + clamp(-(st.vy || 0) * 0.03, -0.4, 0.4);
    // blink & expressions
    this.eyes.set(expr);
    if (expr === 'normal' || expr === 'angry' || expr === 'sad' || expr === 'surprised') {
      this.blinkT -= dt;
      if (this.blinkT <= 0 && this.blinkPhase < 0) { this.blinkPhase = 0; this.blinkT = 1.8 + Math.random() * 3.2; }
      if (this.blinkPhase >= 0) {
        this.blinkPhase += dt / 0.14;
        const v = this.blinkPhase < 0.5 ? 1 - this.blinkPhase * 2 : (this.blinkPhase - 0.5) * 2;
        this.eyes.blink(v);
        if (this.blinkPhase >= 1) { this.blinkPhase = -1; this.eyes.blink(1); }
      }
    }
    this.mouth.set(mouth);
    if (this.flashT > 0) { this.flashT -= dt; this.setFlash(this.flashT > 0 ? (Math.floor(this.flashT * 30) % 2 ? 0.8 : 0) : 0); }
    if (this.onUpdate) this.onUpdate(this, dt, st);
  }
}

// ============================================================================
// Built-in part types (more are registered in animals.js)
// ============================================================================
registerPart('ears', 'cat', (rig, o) => {
  const R = rig.P.headR, sz = o.size ?? 1;
  for (const [ear, sd] of [[rig.earL, -1], [rig.earR, 1]]) {
    const pos = onSphere(R * 0.86, (o.yaw ?? 36) * sd, o.pitch ?? 48);
    ear.position.set(pos[0], pos[1], pos[2]);
    ear.rotation.set(-0.15, 0, -(o.splay ?? 0.42) * sd);
    add(ear, UNIT.cone, rig.mats.plain, { p: [0, 0.11 * sz, 0], s: [0.14 * sz, 0.24 * sz, 0.1 * sz] });
    add(ear, UNIT.cone, rig.mats.accent, { p: [0, 0.1 * sz, 0.035 * sz], s: [0.085 * sz, 0.17 * sz, 0.05 * sz] });
  }
});
registerPart('ears', 'round', (rig, o) => {
  const R = rig.P.headR, sz = o.size ?? 1;
  for (const [ear, sd] of [[rig.earL, -1], [rig.earR, 1]]) {
    const pos = onSphere(R * 0.88, (o.yaw ?? 40) * sd, o.pitch ?? 46);
    ear.position.set(pos[0], pos[1], pos[2]);
    ear.rotation.set(0, (o.yaw ?? 40) * sd * PI / 180 * 0.4, -0.3 * sd);
    ell(ear, o.mat ? rig.mats[o.mat] : rig.mats.plain, [0, 0.05 * sz, 0], 0.12 * sz, 0.12 * sz, 0.07 * sz);
    if (o.inner !== false) ell(ear, o.innerMat ? rig.mats[o.innerMat] : rig.mats.accent, [0, 0.05 * sz, 0.04 * sz], 0.075 * sz, 0.075 * sz, 0.04 * sz);
  }
});
registerPart('ears', 'rabbit', (rig, o) => {
  const R = rig.P.headR, sz = o.size ?? 1;
  for (const [ear, sd] of [[rig.earL, -1], [rig.earR, 1]]) {
    const pos = onSphere(R * 0.82, (o.yaw ?? 20) * sd, o.pitch ?? 62);
    ear.position.set(pos[0], pos[1], pos[2]);
    ear.rotation.set(-0.12, 0, -(o.splay ?? 0.2) * sd + (o.flop && sd > 0 ? -0.9 : 0));
    ell(ear, rig.mats.plain, [0, 0.27 * sz, 0], 0.09 * sz, 0.29 * sz, 0.06 * sz);
    ell(ear, rig.mats.accent, [0, 0.26 * sz, 0.03 * sz], 0.055 * sz, 0.23 * sz, 0.04 * sz);
  }
});
registerPart('ears', 'dog', (rig, o) => {
  const R = rig.P.headR, sz = o.size ?? 1;
  for (const [ear, sd] of [[rig.earL, -1], [rig.earR, 1]]) {
    const pos = onSphere(R * 0.92, (o.yaw ?? 62) * sd, o.pitch ?? 30);
    ear.position.set(pos[0], pos[1], pos[2]);
    ear.rotation.set(0.1, 0, (0.25 + (o.droop ?? 0.2)) * sd);
    ell(ear, o.mat ? rig.mats[o.mat] : rig.mats.limb, [0.03 * sd, -0.13 * sz, 0], 0.1 * sz, 0.2 * sz, 0.06 * sz);
  }
});

registerPart('snout', 'cat', (rig, o) => {
  const R = rig.P.headR;
  const pos = onSphere(R * 0.93, 0, -10);
  const sn = grp(rig.head, 'snout', pos, faceRot(0, -10));
  ell(sn, rig.mats.belly, [-0.045, -0.012, 0.0], 0.06, 0.045, 0.045);
  ell(sn, rig.mats.belly, [0.045, -0.012, 0.0], 0.06, 0.045, 0.045);
  ell(sn, rig.mats.nose, [0, 0.025, 0.035], 0.028, 0.02, 0.018);
  if (o.whiskers !== false) {
    const wm = M(o.whiskerColor ?? 0x9a8590);
    for (const sd of [-1, 1]) for (const k of [-1, 1]) {
      add(sn, () => G.cachedGeo('whisker', () => G.capsuleGeo(0.006, 0.12, 4, 2)), wm, { p: [0.12 * sd, 0.0 + k * 0.016, -0.01], r: [0, 0, PI / 2 + k * 0.12 * sd] });
    }
  }
  rig.snout = sn;
  // mouth sits under snout
  rig.mouth.pivot.position.y -= 0.02;
});
registerPart('snout', 'nose', (rig, o) => {
  const R = rig.P.headR;
  const pos = onSphere(R * 0.995, 0, o.pitch ?? -6);
  ell(rig.head, rig.mats.nose, pos, 0.03 * (o.size ?? 1), 0.022 * (o.size ?? 1), 0.02);
});
registerPart('snout', 'muzzle', (rig, o) => {
  const R = rig.P.headR, s = o.size ?? 1;
  const pos = onSphere(R * 0.9, 0, o.pitch ?? -12);
  const sn = grp(rig.head, 'snout', pos, faceRot(0, o.pitch ?? -12));
  ell(sn, o.mat ? rig.mats[o.mat] : rig.mats.belly, [0, 0, 0.02 * s], 0.11 * s, 0.075 * s, 0.08 * s);
  ell(sn, rig.mats.nose, [0, 0.035 * s, 0.09 * s], 0.034 * s, 0.024 * s, 0.022 * s);
  rig.snout = sn;
  rig.mouth.pivot.position.y -= 0.03 * s;
  rig.mouth.pivot.position.z += 0.04 * s;
});

registerPart('tail', 'cat', (rig, o) => {
  const m = o.mat ? rig.mats[o.mat] : rig.mats.plain;
  const nodes = chain(rig.tail, m, o.segs ?? 5, o.seg ?? 0.075, o.r0 ?? 0.045, o.r1 ?? 0.04, [0.3, 0, 0], 'tailseg');
  rig.tail.rotation.x = -(o.angle ?? 1.9);
  if (o.tip) ell(nodes[nodes.length - 1], rig.mats[o.tip], [0, (o.seg ?? 0.075) * 1.05, 0], 0.05, 0.05, 0.05);
  rig.tailNodes = nodes;
});
registerPart('tail', 'pom', (rig, o) => {
  ell(rig.tail, o.mat ? rig.mats[o.mat] : rig.mats.belly, [0, 0, -0.02], 0.09 * (o.size ?? 1), 0.09 * (o.size ?? 1), 0.08 * (o.size ?? 1));
});
registerPart('tail', 'stub', (rig, o) => {
  ell(rig.tail, o.mat ? rig.mats[o.mat] : rig.mats.plain, [0, 0, -0.02], 0.06, 0.05, 0.08);
});

registerPart('extra', 'belly-patch', () => {});

export function buildRig(spec) { return new CharacterRig(spec); }

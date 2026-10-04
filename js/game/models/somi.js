// ============================================================================
// models/somi.js — Somi, the heroine (human chibi girl) on the shared CharacterRig.
// Dark-brown rounded bob with bangs + two small pigtails tied with her pink
// star ribbons, peach skin, pink pajamas with yellow star dots, fluffy
// slippers. buildSomiGirl({ cape: true }) adds a small starry lavender cape.
// Works with every rig anim (idle, walk, talk, wave, sad, surprised, sleep,
// sit, celebrate, ...). Exposed nodes: rig.hair, rig.pigtailL/R, rig.cape.
// ============================================================================
import { CharacterRig, registerPart } from './rig.js';
import { G, UNIT, M, MG, add, grp, ell, makeRibbon, approach, Spring, PI, TAU, clamp } from './common.js';
import { onHead, headRad, bodyRad, onEll, mergeParts, skinMat, finishRibbon, GEO, splinePts, tubeGeo, profile, sphereNormals } from './animalParts.js';
import { Texture } from '../../engine/renderer.js';
import { makeCanvas } from '../../engine/texgen.js';
import { Material } from '../../engine/material.js';
import { mulberry32 } from '../../engine/math.js';

const SKIN = 0xffe1cf, HAIR = 0x5b3a2e, HAIR_HI = 0x6e4838;
const PJ = 0xff9ec6, STAR = 0xffe066;

// ---------------------------------------------------------------- parts
// peach head + pajama body texture
registerPart('extra', 'somiSkin', (rig) => {
  rig.headMesh.material = rig.mats.head = M(SKIN);
  if (rig.bodyMesh) rig.bodyMesh.material = rig.mats.body = skinMat('pajama');
});
// hair: procedural shell = head surface + thickness field. Hair regions get +T, the face
// window (below a scalloped bang line, inside the side hairlines) and everything below
// the bob line get -T (tucked inside the head), giving a clean, thick-edged hairline.
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export function hairThickness(yawDeg, pitchDeg) {
  const ay = Math.abs(yawDeg);
  // bang line (pitch above which the forehead is covered), scalloped into soft locks
  const bang = 20.5 + 0.0042 * ay * ay - 1.6 * Math.cos((yawDeg * TAU) / 30) * smooth(50, 20, ay);
  // side hairline (face window half width in yaw), widening a little toward the chin
  const side = 57 + Math.max(0, -pitchDeg) * 0.12;
  // bob bottom: jaw length at the sides, lower at the back
  const bottom = -27 - 16 * smooth(80, 170, ay);
  const inFace = smooth(side + 4, side - 4, ay) * smooth(bang + 3.5, bang - 3.5, pitchDeg);
  const above = smooth(bottom - 4, bottom + 4, pitchDeg);
  const hair = above * (1 - inFace);
  // base thickness: thin on top, fuller at the sides/back; rounded curl-in bulge near the bob edge
  let T = 0.026 + 0.012 * smooth(20, 80, ay) * smooth(40, -10, pitchDeg);
  T += 0.011 * Math.exp(-(((pitchDeg - (bottom + 6)) / 7) ** 2)) * smooth(40, 70, ay);
  T += 0.01 * Math.exp(-(((pitchDeg - (bang + 4)) / 5) ** 2)) * smooth(60, 40, ay); // fringe bulge
  return hair * T - (1 - hair) * 0.04;
}
registerPart('extra', 'somiHair', (rig) => {
  const Rr = headRad(rig);
  const g = G.cachedGeo('somi:hair4:' + Rr.join(','), () => {
    const WS = 128, HS = 88;
    const gg = G.sphereGeo(1, WS, HS);
    gg.displace((v) => {
      const l = Math.hypot(v.x, v.y, v.z) || 1, dx = v.x / l, dy = v.y / l, dz = v.z / l;
      const rh = 1 / Math.hypot(dx / Rr[0], dy / Rr[1], dz / Rr[2]);
      const yaw = (Math.atan2(dx, dz) * 180) / PI, pitch = (Math.asin(clamp(dy, -1, 1)) * 180) / PI;
      const r = rh + hairThickness(yaw, pitch);
      v.set(dx * r, dy * r, dz * r);
    });
    sphereNormals(gg, WS, HS);
    gg.computeBoundingSphere();
    return gg;
  });
  rig.hair = add(rig.head, g, MG(HAIR, { spec: 0.16, rim: 0.42 }), { name: 'hair' });
});
// two small pigtails tied with pink star ribbons (animated nodes)
registerPart('extra', 'pigtails', (rig, o) => {
  const Rr = headRad(rig);
  const hair = MG(HAIR, { spec: 0.35, rim: 0.4 });
  const tuft = G.cachedGeo('somi:pigtail', () => {
    const pts = splinePts([[0, 0, 0], [0, -0.07, -0.012], [0, -0.15, -0.004], [0, -0.22, 0.02], [0, -0.26, 0.05]], 28);
    return tubeGeo(pts, profile([[0, 0.05], [0.2, 0.076], [0.55, 0.07], [0.82, 0.048], [1, 0.022]]), 14, 'round');
  });
  const ribs = [];
  for (const sd of [-1, 1]) {
    const yw = sd * (o.yaw ?? 98), pt0 = o.pitch ?? 32;
    const s = onEll(Rr, yw, pt0, hairThickness(yw, pt0) + 0.005);
    const pt = grp(rig.head, 'pigtail' + (sd < 0 ? 'L' : 'R'), s.p, [0.1, 0, sd * 0.62]);
    add(pt, tuft, hair, { p: [0, -0.015, 0], name: 'pigtailHair' });
    // tie: pink star ribbon on the outer side, angled back so it reads from behind
    const rb = makeRibbon(pt, { p: [sd * 0.014, 0.014, -0.012], r: [0.12, sd * 2.05, -sd * 0.62], s: 0.86 });
    ribs.push(rb);
    if (sd < 0) rig.pigtailL = pt; else rig.pigtailR = pt;
  }
  rig.ribbon = ribs[1]; rig.ribbons = ribs;
  rig.pigSpring = new Spring(60, 5);
});
// white peter-pan collar + star buttons on the pajama top
registerPart('extra', 'pjCollar', (rig) => {
  const R = bodyRad(rig);
  const white = M(0xffffff);
  for (const sd of [-1, 1]) ell(rig.hips, white, [sd * 0.075, 0.082, R[2] * 0.87], 0.09, 0.045, 0.05, [0.35, sd * 0.35, -sd * 0.35], 'collar');
  const gold = MG(STAR, { spec: 0.5, emissive: 0x221800 });
  for (const y of [-0.01, -0.09]) {
    const s = onEll(R, 0, (Math.asin(clamp(y / R[1], -1, 1)) * 180) / PI, 0.004);
    add(rig.hips, UNIT.star, gold, { p: s.p, r: [s.r[0], s.r[1], 0], s: 0.055, name: 'button' });
  }
});
// starry lavender cape (dream scenes): partial cone, double sided, painted
let capeTex = null;
function capeMat() {
  if (!capeTex) {
    const W = 256, H = 128, c = makeCanvas(W, H), g = c.getContext('2d');
    // canvas row 0 maps to the cape's bottom edge (cylinder uv v=0 at the bottom)
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#a98cf2'); grd.addColorStop(1, '#cdb8ff');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const rnd = mulberry32(9);
    const star = (x, y, r) => {
      g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -PI / 2 + (k / 10) * TAU, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    };
    g.fillStyle = '#ffe680';
    for (let i = 0; i < 26; i++) { const x = rnd() * W, y = 8 + rnd() * (H - 16), r = 3 + rnd() * 4; star(x, y, r); if (x < 10) star(x + W, y, r); if (x > W - 10) star(x - W, y, r); }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.8 + rnd() * 1.2, 0, TAU); g.fill(); }
    // golden hem (bottom edge)
    g.fillStyle = '#ffd86a'; g.fillRect(0, 0, W, 7);
    capeTex = new Texture(c, { wrap: 'repeat', mipmaps: true });
  }
  return new Material({ color: 0xffffff, map: capeTex, side: 'double', spec: 0.15, rim: 0.35 });
}
let capeMatShared = null;
registerPart('extra', 'cape', (rig) => {
  const R = bodyRad(rig);
  const cape = grp(rig.hips, 'cape', [0, 0.1, -0.03]);
  const g = G.cachedGeo('somi:cape3:' + R.join(','), () => {
    // flared partial cone around the back (open at the front)
    const top = R[0] * 0.92, bot = R[0] * 1.45, h = 0.42;
    const geo = G.cylinderGeo(top, bot, h, 20, 5, false, PI - 1.2, 2.4);
    geo.translate(0, -h / 2, 0);
    // flare backward + scalloped hem
    geo.displace((v) => {
      const t = clamp(-v.y / h, 0, 1), a = Math.atan2(v.x, v.z);
      v.z *= 1 + 0.22 * t * t;
      v.y += 0.035 * t * t * (1 - Math.abs(Math.cos(a * 3.2)));
    });
    geo.computeBoundingSphere();
    return geo;
  });
  if (!capeMatShared) capeMatShared = capeMat();
  add(cape, g, capeMatShared, { name: 'capeMesh' });
  // tie cord around the neck + gold star clasp
  add(cape, GEO.thinTorus, M(0xb79cff), { p: [0, -0.012, 0.02], r: [PI / 2 + 0.12, 0, 0], s: [R[0] * 0.93, R[2] * 0.98, 0.16] });
  add(cape, UNIT.star, MG(0xffd23f, { spec: 0.6, emissive: 0x332200 }), { p: [0, -0.03, R[2] * 1.0 + 0.03], r: [-0.2, 0, 0], s: 0.075, name: 'clasp' });
  rig.cape = cape;
});

// ---------------------------------------------------------------- animation
function somiUpdate(rig, dt, st) {
  const a = st.anim, T = rig.time;
  // pigtails: bounce with motion and vertical velocity
  if (rig.pigtailL) {
    const sp = rig.pigSpring;
    sp.kick(clamp(-(st.vy || 0) * 0.02, -0.3, 0.3) * dt * 30);
    const walk = a === 'walk' || a === 'run' ? Math.sin(rig.phase * 2) * 0.12 * (0.5 + (st.speed || 0)) : 0;
    const v = sp.update(walk + (a === 'celebrate' ? Math.sin(T * 12) * 0.2 : 0), dt);
    rig.pigtailL.rotation.z = rig.pigtailL.userData.rest.rz - v - Math.sin(T * 2.2) * 0.03;
    rig.pigtailR.rotation.z = rig.pigtailR.userData.rest.rz + v + Math.sin(T * 2.2 + 1) * 0.03;
    const sway = a === 'walk' || a === 'run' ? Math.cos(rig.phase) * 0.12 : 0;
    rig.pigtailL.rotation.x = sway; rig.pigtailR.rotation.x = -sway;
  }
  // cape flares back with speed / flutters in the air
  if (rig.cape) {
    const air = a === 'jump' || a === 'fall' || a === 'hover' || a === 'glide' || a === 'fly';
    const target = (a === 'walk' || a === 'run' ? 0.25 + 0.35 * clamp(st.speed || 0, 0, 1.5) : 0) + (air ? 0.45 : 0) + (a === 'sit' || a === 'sleep' ? -0.15 : 0);
    rig._capeX = approach(rig._capeX ?? 0, target, 6, dt);
    rig.cape.rotation.x = -rig._capeX - (air || a === 'run' ? Math.sin(T * 13) * 0.05 : Math.sin(T * 1.7) * 0.015);
  }
}

// ---------------------------------------------------------------- builder
function somiSpec(cape) {
  return {
    id: cape ? 'somi-cape' : 'somi',
    colors: { body: PJ, belly: 0xffffff, limb: PJ, foot: 0xf6f0ff, accent: 0xff7fb0, nose: 0xffb39a, dark: 0x4a3a52 },
    face: { eyePitch: 0, mouthPitch: -19, cheekPitch: -11 },
    arms: { type: 'sleeve', mat: skinMat('pajama'), hand: SKIN, cuff: 0xffffff },
    legs: { type: 'slipper', pants: skinMat('pajama'), slipper: 0xf6f0ff, sole: 0xffbfd8, pom: 0xff7fb0 },
    belly: false,
    ribbon: false,
    extras: ['hires', 'somiSkin', 'somiHair', { type: 'pigtails' }, 'pjCollar', ...(cape ? ['cape'] : [])],
    onUpdate: somiUpdate,
  };
}

export function buildSomiGirl(opts = {}) {
  if (typeof opts === 'string') opts = { cape: opts.includes('cape') };
  const rig = new CharacterRig(somiSpec(!!(opts && opts.cape)));
  for (const rb of rig.ribbons || []) finishRibbon({ ribbon: rb });
  return rig;
}

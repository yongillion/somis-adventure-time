// ============================================================================
// models/animals.js — visual specs for the 30 animal forms of Somi.
// Each spec is consumed by CharacterRig (rig.js). Extra part types live in
// animalParts.js (registered on import). Every form wears Somi's pink star
// ribbon (spec.ribbon placement; buildAnimal adds a back star so it reads
// from the gameplay camera behind/above).
// Named nodes exposed on rigs: joey (kangaroo), trunkTip (elephant),
// fin (shark), wingL/wingR (dragon), neckExt (giraffe), shell (turtle),
// horn (unicorn horn tip), spikes (hedgehog group), yuzu (capybara).
// ============================================================================
import { CharacterRig, registerPart, PARTS } from './rig.js';
import {
  tailWave, wingsUpdate, trunkUpdate, joeyUpdate, beakUpdate, neckUpdate, spikesUpdate, finUpdate, finishRibbon,
} from './animalParts.js';

// shorthand for chain tails: [len, radius, bend, mat, rz]
export const ANIMAL_SPECS = {
  cat: {
    colors: { body: 0xfff1e2, belly: 0xffffff, accent: 0xffb3c6, nose: 0xff8fae, limb: 0xfff1e2, foot: 0xffffff },
    ears: { type: 'pointy', h: 0.24, w: 0.14, d: 0.095, yaw: 36, pitch: 48, splay: 0.42, innerH: 0.7 },
    snout: { type: 'cat' },
    tail: { type: 'chain', smooth: true, angle: 1.45, segs: [[0.075, 0.04, 0], [0.075, 0.039, 0.3], [0.075, 0.038, 0.38], [0.07, 0.037, 0.42], [0.065, 0.036, 0.45], [0.06, 0.035, 0.45]], tip: { m: 'accent', r: 0.045 } },
    ribbon: { yaw: 0, pitch: 66, s: 1.05 },
  },
  rabbit: {
    colors: { body: 0xffffff, belly: 0xfff6f8, accent: 0xffb8cc, nose: 0xff8fae },
    ears: { type: 'rabbit' },
    snout: { type: 'nose' },
    tail: { type: 'pom' },
    extras: ['buckTeeth', { type: 'mouthMap', map: { smile: 'w' } }],
    ribbon: { yaw: 36, pitch: 60, roll: -0.55 },
    update(rig) { if (rig.teeth) rig.teeth.visible = rig.mouthShape === 'smile' || rig.mouthShape === 'flat'; },
  },
  dog: {
    colors: { body: 0xf3c98b, belly: 0xfff4e0, accent: 0xd99a5b, nose: 0x4a3030, limb: 0xf3c98b, foot: 0xfff4e0 },
    ears: { type: 'dog', mat: 'accent' },
    snout: { type: 'muzzle' },
    tail: { type: 'chain', smooth: true, angle: 2.0, segs: [[0.07, 0.044, 0.35], [0.07, 0.042, 0.4], [0.065, 0.041, 0.4, 'belly']], wave: 0.04 },
    extras: [{ type: 'collar', color: 0xff4d5e, tag: 'disc' }],
    ribbon: { yaw: 30, pitch: 66 },
    update(rig, dt, st) {
      const a = st.anim, T = rig.time;
      const sp = a === 'idle' || a === 'walk' || a === 'run' || a === 'celebrate' || a === 'talk' || a === 'wave' ? 1 : 0.3;
      rig.tail.rotation.y = rig.tail.userData.rest.ry + Math.sin(T * 13) * 0.5 * sp;
    },
  },
  sheep: {
    colors: { body: 0xffdcc4, belly: 0xffffff, accent: 0xffb3c6, nose: 0xe88aa0, limb: 0xffdcc4, foot: 0xffdcc4 },
    body: { type: 'wool' },
    ears: { type: 'side', len: 0.11, wid: 0.055, yaw: 76, pitch: 14, droop: 0.65 },
    snout: { type: 'nose', size: 0.85 },
    tail: { type: 'pom', mat: 'white' },
    legs: { type: 'hoof', hoof: 0x6b4a3a },
    extras: [{ type: 'skin', head: 'sheepHead' }, 'woolTuft', { type: 'ramhorns', yaw: 50, pitch: 36 }],
    ribbon: { yaw: 34, pitch: 58, out: 1.2 },
  },
  cow: {
    colors: { body: 0xfffdf8, belly: 0xffffff, accent: 0xffb6c4, nose: 0xff8fae, limb: 0xfffdf8, foot: 0xfffdf8 },
    ears: { type: 'side', len: 0.13, wid: 0.062, yaw: 74, pitch: 30, droop: 0.25 },
    snout: { type: 'cow' },
    tail: { type: 'tuft', tuft: 0x3f3652 },
    legs: { type: 'hoof', hoof: 0x5a4a5e },
    extras: [{ type: 'skin', head: 'cowHead', body: 'cowBody' }, { type: 'horns', yaw: 34, pitch: 58 }, { type: 'collar', color: 0x5fa8ff, tag: 'bell' }],
    ribbon: { yaw: -30, pitch: 66 },
  },
  kangaroo: {
    colors: { body: 0xd99a5e, belly: 0xf9dfbe, accent: 0xf7b8a0, nose: 0x5a3a35, limb: 0xd99a5e, foot: 0xd99a5e },
    prop: { hipY: 0.36, legY: -0.2 },
    ears: { type: 'pointy', h: 0.26, w: 0.105, d: 0.06, yaw: 27, pitch: 58, splay: 0.3, twist: -0.25, innerW: 0.55, innerH: 0.7 },
    snout: { type: 'nose', size: 1.0, pitch: -8 },
    tail: { type: 'chain', smooth: true, angle: 2.25, segs: [[0.12, 0.085, 0], [0.12, 0.07, 0.3], [0.11, 0.056, 0.32], [0.1, 0.042, 0.3]], wave: 0.04 },
    arms: { type: 'glove', color: 0xff4f63 },
    legs: { type: 'bigfoot' },
    extras: [{ type: 'skin', head: 'kangarooHead' }, { type: 'pouch' }],
    ribbon: { yaw: -30, pitch: 66 },
    update: joeyUpdate,
  },
  koala: {
    colors: { body: 0xb9bdcc, belly: 0xffffff, accent: 0xffffff, nose: 0x4d4466, limb: 0xb0b4c4, foot: 0xa9adbd },
    ears: { type: 'koala' },
    snout: { type: 'koala' },
    extras: [{ type: 'skin', head: 'koalaHead' }],
    ribbon: { yaw: 0, pitch: 64 },
  },
  quokka: {
    colors: { body: 0xd8aa7c, belly: 0xfff1de, accent: 0xf5b2a4, nose: 0x4a3035, limb: 0xd8aa7c, foot: 0xc69468 },
    ears: { type: 'round', size: 0.68, yaw: 42, pitch: 56 },
    snout: { type: 'nose', size: 1.05, pitch: -7 },
    tail: { type: 'stub' },
    extras: [{ type: 'skin', head: 'quokkaHead' }, { type: 'cheekPuffs', size: 0.68, mat: 'belly', yaw: 38, pitch: -22 }, { type: 'happyMouth', w: 1.55, h: 1.3 }, { type: 'face', mouthPitch: -22 }],
    ribbon: { yaw: 30, pitch: 66 },
  },
  bear: {
    colors: { body: 0xb87b4b, belly: 0xf0cfa0, accent: 0xf0cfa0, nose: 0x4a3030, limb: 0xb87b4b, foot: 0xa86f42 },
    ears: { type: 'round' },
    snout: { type: 'muzzle' },
    tail: { type: 'stub' },
    belly: false,
    extras: [{ type: 'heartBelly' }],
    ribbon: { yaw: 32, pitch: 66 },
  },
  elephant: {
    colors: { body: 0xafbde3, belly: 0xc8d2ef, accent: 0xffbfd2, nose: 0x8a7aa8, limb: 0xafbde3, foot: 0xc8d2ef },
    ears: { type: 'elephant' },
    snout: { type: 'trunk' },
    tail: { type: 'tuft', tuft: 0x8a96c0, segs: 2 },
    extras: ['tusks'],
    ribbon: { yaw: 26, pitch: 66 },
    update: trunkUpdate,
  },
  shark: {
    colors: { body: 0x6aaee8, belly: 0xffffff, accent: 0xffb3c6, limb: 0x6aaee8, foot: 0x6aaee8 },
    arms: { type: 'flipper', fin: true },
    tail: { type: 'sharkfin' },
    extras: [{ type: 'skin', head: 'sharkHead' }, { type: 'fin', on: 'head', pitch: 70, len: 0.36, h: 0.27, th: 0.36, lean: 0.25 }, 'sharkGrin'],
    ribbon: { yaw: 42, pitch: 66 },
    update: finUpdate,
  },
  dolphin: {
    colors: { body: 0x86d4ee, belly: 0xffffff, accent: 0xffb3c6, limb: 0x86d4ee, foot: 0x86d4ee },
    snout: { type: 'dolphin' },
    arms: { type: 'flipper' },
    tail: { type: 'fluke' },
    extras: [{ type: 'skin', head: 'dolphinHead' }, { type: 'fin', on: 'head', pitch: 38, size: 0.72, th: 0.3, lean: 0.75 }],
    ribbon: { yaw: 32, pitch: 66 },
    update: finUpdate,
  },
  dragon: {
    colors: { body: 0x8fe3b4, belly: 0xffe680, accent: 0xffb3cf, nose: 0x5fb88a, limb: 0x8fe3b4, foot: 0x8fe3b4 },
    snout: { type: 'muzzle2', mat: 0xb2f0cf, w: 0.12, h: 0.075, noseW: 0.015, noseH: 0.012 },
    tail: { type: 'chain', smooth: true, angle: 1.95, segs: [[0.09, 0.07, 0.05], [0.09, 0.058, 0.25], [0.08, 0.047, 0.3], [0.07, 0.038, 0.3]], spade: 0xff9ec0 },
    extras: [{ type: 'horns', geo: 'cone', yaw: 30, pitch: 62, back: -0.55, splay: 0.3, size: 1.25 }, { type: 'wings', size: 1.5 }, { type: 'spines' }],
    ribbon: { yaw: -34, pitch: 66 },
    update: wingsUpdate,
  },
  tiger: {
    colors: { body: 0xffa04a, belly: 0xfff8ee, accent: 0xfff8ee, nose: 0xff8fae, limb: 0xffa04a, foot: 0xfff8ee },
    ears: { type: 'round', innerMat: 'accent' },
    snout: { type: 'muzzle2', puffs: true, mat: 'belly' },
    tail: { type: 'chain', smooth: true, angle: 1.8, segs: [[0.075, 0.042, 0.25], [0.07, 0.041, 0.3, 0x3d2f4a], [0.07, 0.04, 0.3], [0.07, 0.039, 0.3, 0x3d2f4a], [0.065, 0.038, 0.3]], tip: { m: 0x3d2f4a, r: 0.045 } },
    extras: [{ type: 'skin', head: 'tigerHead', body: 'tigerBody' }],
    ribbon: { yaw: 32, pitch: 66 },
  },
  panda: {
    colors: { body: 0xffffff, belly: 0xffffff, accent: 0x3d3650, nose: 0x3d3650, limb: 0x3d3650, foot: 0x3d3650 },
    ears: { type: 'round', mat: 'limb', inner: false },
    snout: { type: 'muzzle', mat: 'white' },
    tail: { type: 'stub', mat: 'white' },
    belly: false,
    extras: [{ type: 'skin', head: 'pandaHead', body: 'pandaBody' }],
    ribbon: { yaw: 30, pitch: 66 },
  },
  fox: {
    colors: { body: 0xff9a4a, belly: 0xffffff, accent: 0xfff2e6, nose: 0x4a3035, limb: 0xff9a4a, foot: 0x6a4048 },
    ears: { type: 'pointy', h: 0.3, w: 0.15, d: 0.08, yaw: 36, pitch: 50, tip: 0x5a3a48, tipFrom: 0.62 },
    snout: { type: 'nose', size: 0.9 },
    tail: {
      type: 'plume', yaw: 0.3, tip: 0xffffff, tipFrom: 0.74, wave: 0.08,
      pts: [[0, 0, 0], [0, 0.0, -0.12], [0, 0.06, -0.26], [0, 0.16, -0.36], [0, 0.3, -0.4], [0, 0.43, -0.36]],
      r: [[0, 0.05], [0.2, 0.09], [0.5, 0.125], [0.75, 0.115], [0.92, 0.075], [1, 0.035]],
    },
    extras: [{ type: 'skin', head: 'foxHead' }],
    ribbon: { yaw: 0, pitch: 66 },
  },
  penguin: {
    colors: { body: 0x45558c, belly: 0xffffff, accent: 0xffb3c6, limb: 0x45558c, foot: 0xffa63d },
    snout: { type: 'beak' },
    arms: { type: 'flipper' },
    legs: { type: 'webbed', color: 0xffa63d, toe: 0xffb85c },
    tail: { type: 'stub' },
    extras: [{ type: 'skin', head: 'penguinHead' }, { type: 'mouthMap' }],
    ribbon: { yaw: 32, pitch: 66 },
    update: beakUpdate,
  },
  pig: {
    colors: { body: 0xffb8cb, belly: 0xffd3df, accent: 0xff96b3, nose: 0xd8607f, limb: 0xffb8cb, foot: 0xff9cb6 },
    ears: { type: 'pig', flop: 0.5, yaw: 44, pitch: 42 },
    snout: { type: 'pig' },
    tail: { type: 'curly' },
    face: { cheekColor: 0xff6f9a },
    ribbon: { yaw: 0, pitch: 70 },
  },
  hamster: {
    colors: { body: 0xffb85a, belly: 0xffffff, accent: 0xffb3c6, nose: 0xff8fae, limb: 0xffb85a, foot: 0xffc9d0 },
    prop: { bodyR: 0.29, bodyS: [1.08, 0.94, 1.0], headS: [1.08, 0.96, 1.0] },
    belly: false,
    ears: { type: 'round', size: 0.6, yaw: 40, pitch: 56 },
    snout: { type: 'nose', size: 0.75 },
    tail: { type: 'stub', mat: 'white' },
    extras: [{ type: 'skin', head: 'hamsterHead' }, { type: 'belly' }, { type: 'cheekPuffs', size: 0.8, yaw: 44, pitch: -26, sink: 0.085 }],
    ribbon: { yaw: 0, pitch: 68 },
  },
  squirrel: {
    colors: { body: 0xd2784a, belly: 0xffe9cc, accent: 0xffd0b8, nose: 0x4a3035, limb: 0xd2784a, foot: 0xc06a40 },
    ears: { type: 'pointy', h: 0.2, w: 0.11, d: 0.07, yaw: 32, pitch: 56, tuft: 0x9a4a2a },
    snout: { type: 'nose', size: 0.85 },
    tail: {
      type: 'plume', yaw: 0.45, tip: 0xe8955f, tipFrom: 0.86, wave: 0.06,
      pts: [[0, 0, 0], [0, 0.03, -0.16], [0, 0.12, -0.38], [0, 0.3, -0.55], [0, 0.5, -0.56], [0, 0.68, -0.5], [0, 0.8, -0.52], [0, 0.82, -0.64]],
      r: [[0, 0.055], [0.12, 0.085], [0.35, 0.13], [0.6, 0.145], [0.82, 0.13], [1, 0.1]],
    },
    tailPos: [0.04, -0.04, -0.2],
    extras: [{ type: 'skin', head: 'squirrelHead' }],
    ribbon: { yaw: 0, pitch: 66 },
  },
  lion: {
    colors: { body: 0xffcf66, belly: 0xfff0c8, accent: 0xffe8b0, nose: 0xc8706a, limb: 0xffcf66, foot: 0xffe0a0 },
    ears: { type: 'roundOut', yaw: 44, pitch: 56, lift: 0.085, size: 1.0, innerMat: 'accent' },
    snout: { type: 'muzzle2', puffs: true, mat: 'belly' },
    tail: { type: 'tuft', tuft: 0xe0803a },
    extras: [{ type: 'skin', head: 'lionHead' }, { type: 'lionmane' }],
    ribbon: { yaw: 0, pitch: 70, out: 1.3 },
  },
  giraffe: {
    colors: { body: 0xffd968, belly: 0xfff2c4, accent: 0xffb8a8, nose: 0x8a5a3a, limb: 0xffd968, foot: 0xffd968 },
    prop: { hipY: 0.38, headY: 0.74, legY: -0.22, headR: 0.4 },
    ears: { type: 'side', len: 0.1, wid: 0.05, yaw: 62, pitch: 42, droop: 0.15 },
    snout: { type: 'muzzle2', mat: 'belly', w: 0.15, h: 0.1, d: 0.09 },
    tail: { type: 'tuft', tuft: 0x8a5a3a },
    legs: { type: 'hoof', hoof: 0x8a5a3a },
    extras: [{ type: 'skin', head: 'giraffeHead', body: 'giraffeBody' }, { type: 'ossicones' }, { type: 'giraffeNeck', skin: 'giraffeBody', mane: 0xc47a3a, r: 0.125 }],
    ribbon: { yaw: 40, pitch: 66 },
    update: neckUpdate,
  },
  monkey: {
    colors: { body: 0xa8714a, belly: 0xffd8b8, accent: 0xffd0b0, nose: 0x6a4030, limb: 0xa8714a, foot: 0xffd0b0 },
    ears: { type: 'monkey' },
    snout: { type: 'muzzle2', mat: 'belly', w: 0.12, h: 0.08, noseW: 0.026, noseH: 0.016 },
    tail: { type: 'chain', smooth: true, angle: 1.4, segs: [[0.08, 0.032, 0.1], [0.08, 0.031, 0.25], [0.075, 0.03, 0.35], [0.07, 0.029, 0.5], [0.06, 0.028, 0.65], [0.055, 0.027, 0.8], [0.05, 0.026, 0.95]], wave: 0.06 },
    extras: [{ type: 'skin', head: 'monkeyHead' }],
    ribbon: { yaw: 30, pitch: 66 },
  },
  frog: {
    colors: { body: 0x86d86c, belly: 0xfff3a8, accent: 0xffb3c6, limb: 0x86d86c, foot: 0x86d86c },
    prop: { headS: [1.16, 0.86, 1.0], headY: 0.38 },
    legs: { type: 'webbed', color: 0x86d86c, toe: 0xa8ec90 },
    extras: [{ type: 'skin', head: 'frogHead' }, { type: 'eyeBumps' }, { type: 'face', mouthPitch: -12, mouthScale: [2.0, 1.3], cheekYaw: 40, cheekPitch: -6 }],
    ribbon: { yaw: 0, pitch: 70 },
  },
  turtle: {
    colors: { body: 0xa8e6a0, belly: 0xffeb9a, accent: 0xffb3c6, nose: 0x6aa860, limb: 0xa8e6a0, foot: 0xa8e6a0 },
    tail: { type: 'stub' },
    extras: [{ type: 'skin', head: 'turtleHead' }, { type: 'shell' }],
    ribbon: { yaw: 32, pitch: 66 },
  },
  unicorn: {
    colors: { body: 0xffffff, belly: 0xfff6fb, accent: 0xffc2dc, nose: 0xffa8c8, limb: 0xffffff, foot: 0xffffff },
    ears: { type: 'pointy', h: 0.17, w: 0.085, d: 0.06, yaw: 40, pitch: 48, splay: 0.45 },
    snout: { type: 'muzzle2', mat: 0xfff0f6, w: 0.12, h: 0.075, noseW: 0.02, noseH: 0.014 },
    tail: { type: 'rainbow' },
    legs: { type: 'hoof', hoof: 0xffa8c8 },
    extras: [{ type: 'unihorn' }, { type: 'mane' }],
    ribbon: { yaw: -38, pitch: 66 },
  },
  redpanda: {
    colors: { body: 0xe0703a, belly: 0x5a3328, accent: 0xffffff, nose: 0x3d2a30, limb: 0x5a3328, foot: 0x4a2a22 },
    ears: { type: 'redpanda' },
    snout: { type: 'nose', size: 0.85 },
    tail: { type: 'chain', angle: 1.7, k: 0.8, segs: [[0.075, 0.07, 0.15], [0.075, 0.08, 0.3, 0xffd9b0], [0.075, 0.082, 0.3], [0.075, 0.078, 0.3, 0xffd9b0], [0.07, 0.07, 0.3]], tip: { m: 0x5a3328, r: 0.06 } },
    extras: [{ type: 'skin', head: 'redpandaHead' }],
    ribbon: { yaw: 0, pitch: 66 },
  },
  otter: {
    colors: { body: 0x9c6b4c, belly: 0xf3dcc2, accent: 0xf3c2b0, nose: 0x4a3035, limb: 0x8c5e42, foot: 0x8c5e42 },
    prop: { headS: [1.1, 0.92, 1.0] },
    ears: { type: 'round', size: 0.46, yaw: 70, pitch: 26, innerMat: 'belly' },
    snout: { type: 'muzzle2', puffs: true, mat: 'belly', whiskers: true, noseW: 0.042, noseH: 0.03, noseY: 0.035 },
    tail: { type: 'chain', smooth: true, angle: 2.0, segs: [[0.11, 0.075, 0.1, null, 0.055], [0.11, 0.058, 0.15, null, 0.042], [0.1, 0.04, 0.15, null, 0.03]] },
    extras: [{ type: 'skin', head: 'otterHead' }],
    ribbon: { yaw: 32, pitch: 66 },
  },
  hedgehog: {
    colors: { body: 0xffe7c6, belly: 0xffeed6, accent: 0xffb3c6, nose: 0x3d2a35, limb: 0xffd9b0, foot: 0xffd0a6 },
    ears: { type: 'round', size: 0.5, yaw: 48, pitch: 46 },
    snout: { type: 'pointy' },
    extras: [{ type: 'skin', head: 'hedgehogHead' }, { type: 'quills' }],
    ribbon: { yaw: 26, pitch: 62, out: 1.12 },
    update: spikesUpdate,
  },
  capybara: {
    colors: { body: 0xc08a5a, belly: 0xd8a878, accent: 0xb07a4c, nose: 0x5a4036, limb: 0xb07a4c, foot: 0x9a6a44 },
    prop: { headS: [1.14, 0.88, 1.06] },
    ears: { type: 'round', size: 0.48, yaw: 58, pitch: 50, innerMat: 'dark' },
    snout: { type: 'capy', size: 1.12 },
    extras: [{ type: 'face', eyeYaw: 21, eyePitch: 11 }, 'eyelids', { type: 'yuzu' }],
    ribbon: { yaw: 36, pitch: 66 },
  },
};

// normalize specs: ids, hi-res head/body, shared per-frame secondary motion
for (const [id, s] of Object.entries(ANIMAL_SPECS)) {
  s.id = id;
  s.extras = ['hires', ...(s.extras || [])];
  s.ribbon = { yaw: 30, pitch: 68, s: 1.1, tilt: 0.3, ...(s.ribbon || {}) };
  const own = s.update;
  s.onUpdate = (rig, dt, st) => { tailWave(rig, dt, st); if (own) own(rig, dt, st); };
}

// Pre-build every form once (paints skins, caches geometry) — call during a loading screen.
export function prewarmAnimals(ids = Object.keys(ANIMAL_SPECS)) { for (const id of ids) buildAnimal(id); }

export function buildAnimal(id) {
  const spec = ANIMAL_SPECS[id] || ANIMAL_SPECS.cat;
  const rig = new CharacterRig(spec);
  finishRibbon(rig);
  return rig;
}

// Head-only build (for cookies/icons): returns a Node containing the head
export function buildAnimalHead(id) {
  const rig = buildAnimal(id);
  const head = rig.neck;
  head.removeFromParent();
  head.position.set(0, 0, 0);
  return head;
}

export { PARTS, registerPart };

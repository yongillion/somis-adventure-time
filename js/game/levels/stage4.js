// ============================================================================
// stage4.js — 반딧불 정글 (Firefly Jungle) — night jungle with glowing
// mushrooms, giant leaves, vines and mossy ruins. Boss: 카멜레온 카멜.
// Sections:
//  A landing clearing (greeter, first enemies, Puffy 0)
//  B monkey grove: monkey cookie, first swing up a ruin cliff (safe practice)
//  C frog pond: frog cookie, hook tutorial, Puffy 1 on a high tree
//  D grapple chasm: hook chain across a 20 m gap (frog / monkey)
//  E parrot rest (quiz pet, panda side islet, hidden Puffy 4) + coconut hill
//    (rolling coconut gauntlet up a slope with leaf rest-pockets)
//  F dim firefly grove: firefly pet (5 lights), ghost-platform path to Puffy 2
//  G fox ruins: fox cookie, foxfire torches open the gate, tiger secret behind
//    a heavy rock, thorn vines (burn), pinwheel -> wind updraft to the terrace
//  H ruins trap corridor (side view): spike traps, crushers, firebar, blink
//    leaves + vertical saw under a low ceiling
//  I bridge + Kamel arena (4 tree pillars for the tongue to stick into)
// ============================================================================
import { rgb, Vec3 } from '../../engine/math.js';
import { Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { THEMES } from '../world/env.js';
import { blockParts } from '../world/terrain.js';
import { ChameleonBoss } from '../bosses/chameleon.js';
import { stageIntro, puffyNpc, ctl, SOMI, meFace } from './common.js';

const RUIN = { style: 'stone', color: 0xa9bfa3, color2: 0x92aa8d };
const RUIN_DARK = { style: 'stone', color: 0x8fa58c, color2: 0x7b9279 };
const BARK = { style: 'bark' };
const RUIN_PAL = { grass: 0xb4c8ac, grass2: 0xa2b89c, rim: 0x8fa88a, earth: 0x8a9a88, rock: 0x7f8f80 };
const GROVE_PAL = { grass: 0x3f9a58, grass2: 0x52ae66, rim: 0x2f8a48 };
const GLOW = [0x8affd8, 0xffa8e8, 0xfff08a, 0x9ad8ff, 0xc8a8ff];
const PI = Math.PI;

// dim grove zones (x, z, r): the firefly grove and its ghost-platform path
const DIM_ZONES = [[-3, -117, 11.5], [-21, -117.4, 12]];

// small decoration helper: [type, x, z, scale, colorIndex?]
function deco(L, list, y = null) {
  for (const it of list) {
    const [t, x, z, s = 1, ci] = it;
    L.prop(t, x, y, z, { s, seed: Math.round(Math.abs(x * 7 + z * 3)), yaw: (x * 1.7 + z * 0.9) % 6.28, color: ci !== undefined ? GLOW[ci % GLOW.length] : undefined });
  }
}
// a cozy cluster of glowing mushrooms around a point
function glowPatch(L, x, z, n = 3, r = 0.7, ci = 0) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + x;
    L.prop('glowMushroom', x + Math.sin(a) * r * (0.4 + (i % 2) * 0.6), null, z + Math.cos(a) * r * (0.4 + (i % 2) * 0.6), { s: 0.8 + (i % 3) * 0.25, color: GLOW[(ci + i) % GLOW.length], seed: i * 7 + Math.round(Math.abs(z)), collide: false });
  }
}

// round visual pond (water shader disc) — decoration only
function waterDisc(L, x, y, z, r, color = 0x72dccb, deep = 0x2e9c8e) {
  const m = new Mesh(G.cachedGeo('s4:disc' + r, () => G.circleGeo(r, 44)), new Material({ shader: 'water', color, transparent: true, opacity: 0.84, uniforms: { uDeep: rgb(deep), uWaveAmp: 0.05 }, satField: true }));
  m.position.set(x, y, z);
  m.renderOrder = 3;
  L.lv.root.add(m);
  return m;
}
// hanging vines & moss on a wall face (visual only, no colliders). face: z of the wall face, dir: +1 if the face looks toward +Z
function vines(L, x0, x1, faceZ, top, list) {
  for (const [u, len, w = 0.16] of list) {
    const x = x0 + (x1 - x0) * u;
    L.lv.addParts(blockParts(x, top + 0.05, faceZ + 0.06, w, len, 0.1, { key: 'deco', color: 0x5cbf62, color2: 0x4aa852, round: 0.05 }));
    L.lv.addParts(blockParts(x + 0.12, top - len * 0.45, faceZ + 0.1, 0.42, 0.26, 0.16, { key: 'deco', color: 0x7ad86e, color2: 0x62c85e, round: 0.1 }));
    L.lv.addParts(blockParts(x - 0.1, top - len * 0.8, faceZ + 0.1, 0.36, 0.22, 0.14, { key: 'deco', color: 0x7ad86e, color2: 0x62c85e, round: 0.1 }));
  }
}

export default {
  build(L, stage) {
    this._dim = null;
    // the env's decorative ring of far islands is centered on the origin (stages.js has no `center` for this
    // stage); with the default seed one island hangs right over the fox ruins, so rebuild the ring around the
    // middle of this ~245 m stage with a seed that keeps every far island well away from the route.
    if (CTX.env && CTX.env.distant && CTX.env._buildDistant) { CTX.env.distant.removeFromParent(); CTX.env._buildDistant(CTX.env.theme, 784, new Vec3(0, 0, -116)); }
    // ======================================================== A. landing clearing
    L.island(0, 0, 0, 10, { clear: [[0, 6.6, 2.6], [0, 2, 2.4], [0, -3, 2.6], [0, -7.6, 2.6], [-2.6, 4.4, 1.3], [2.6, 3.6, 1.2], [6.2, -4.5, 1.6], [-3, -3, 1.6], [3.2, -5.5, 1.5]], density: 1.1, flowers: 0.12 });
    L.start(0, 0.3, 7, PI);
    puffyNpc(L, -2.6, 0, 4.4, 2, [
      ['뭉실이', '어서 와! 여기는 반딧불 정글이야. 원래는 밤마다 반딧불이 반짝반짝 춤을 췄는데...', 'puffy2'],
      ['뭉실이', '회색 안개가 오고 나서 모두 숨어 버렸어. 정글 깊은 유적에서 무서운 혀가 쭉쭉 나온대!', 'puffy2'],
      ['뭉실이', '정글에서 새 동물 친구 쿠키를 찾으면 꼭 변신해 봐! 원숭이, 개구리, 여우... 다들 특별한 재주가 있어.', 'puffy2'],
    ], { yaw: 0.5 });
    L.sign(2.6, 0, 3.6, () => ['반딧불 정글이에요! 빛나는 버섯을 따라가면 길을 잃지 않아요.', ctl('새 동물 친구 쿠키를 먹으면, 오른쪽 위의 얼굴 버튼으로 언제든지 변신할 수 있어요!', '새 동물 친구 쿠키를 먹으면, 캐릭터 버튼(1번 키 또는 Tab)으로 언제든지 변신할 수 있어요!')], { icon: '!', yaw: -0.35 });
    L.candyLine([0, 0.9, 4.6], [0, 0.9, 1.4], 4);
    L.candyRing(0, 0.9, -2.6, 2.6, 8);
    L.candyLine([0, 0.9, -6], [0, 0.9, -9], 3);
    L.enemy('gloomy', -3, 0, -3, { range: 2.4 });
    L.enemy('hopper', 3.2, 0, -5.5, { range: 1.8 });
    L.enemy('spiky', 0.5, 0, -6.6, { range: 1.4, hard: true });
    L.puffy(0, 6.2, null, -4.5, { thanks: [{ who: '뭉실이', text: '고마워! 깜깜한 정글에서 혼자 무서웠어... 반짝반짝 용감한 너를 보니까 힘이 나!', face: 'puffy0' }] });
    deco(L, [['giantLeaf', 7.6, -5.6, 1.3], ['jungleTree', -4.8, -7.6, 1.05], ['jungleTree', 4.9, -7.9, 0.95], ['fern', 5.2, -3.2, 1.1], ['bigBloom', -6.2, 1.2, 1.0, 1], ['fern', -7.4, -2.6, 1.2], ['stump', 6.8, 2.2, 1.0], ['log', -6.6, 5.2, 0.9]]);
    glowPatch(L, -1.8, 0.8, 3, 0.6, 0); glowPatch(L, 1.9, -0.6, 3, 0.6, 1); glowPatch(L, -1.9, -6.0, 2, 0.5, 2); glowPatch(L, 2.0, -7.0, 2, 0.5, 3);
    L.bridge([0, 0, -9.6], [0, 0, -15.6], 2.4);
    L.candyLine([0, 0.9, -10.4], [0, 0.9, -14.8], 4);

    // ======================================================== B. monkey grove + first swing
    L.island(0, 0, -24, 8.6, { clear: [[0, -16, 2.2], [0, -19.5, 2], [2.4, -20, 1.2], [-3.1, -21, 1.4], [0, -27, 3.4], [0, -31, 3.2], [-4.2, -26, 1.8], [4.2, -24.4, 1.8], [3.6, -29.4, 1.4]], density: 1.0, flowers: 0.12 });
    L.cookie('monkey', 0, 0.9, -18.8);
    L.sign(2.4, 0, -20.0, () => ['원숭이로 변신하면, 반짝이는 꽃 고리에 휘익~ 매달릴 수 있어요!', ctl('꽃 고리 가까이에서 특기 버튼! 앞으로 흔들흔들 하다가 점프 버튼을 누르면 손을 놓고 높이 날아가요.', '꽃 고리 가까이에서 특기 버튼(L 또는 C)! 앞으로 흔들흔들 하다가 점프를 누르면 손을 놓고 높이 날아가요.')], { icon: '!', yaw: -0.4 });
    L.checkpoint(-3.1, 0, -21, { yaw: PI });
    // ruin cliff (top 5.6) with a flower ring above it
    L.block(0, 5.6, -35.1, 11, 12.6, 5, RUIN);
    L.block(-3.9, 6.4, -34.2, 1.4, 0.8, 1.4, RUIN_DARK);
    L.block(4.1, 6.6, -35.6, 1.2, 1.0, 1.2, RUIN_DARK);
    L.grapple(0, 7.6, -30.0);
    L.camZone(0, 4, -31, 6, 5, 6.5, { pitch: 0.62, dist: 10.5, height: 2.2, priority: 1 });
    vines(L, -5.2, 5.2, -32.6, 5.6, [[0.06, 3.2], [0.2, 2.2], [0.33, 4.0], [0.58, 2.6], [0.71, 3.6], [0.9, 2.4]]);
    L.lv.addParts(blockParts(0, 5.75, -32.75, 11.2, 0.4, 0.5, { key: 'deco', color: 0x6ccc6a, color2: 0x58b85a, round: 0.18 }));
    L.candyArc([0, 1.4, -26.8], [0, 6.6, -33.6], 6, 2.6);
    L.candyRing(0, 0.9, -24.0, 3.0, 8);
    L.enemy('gloomy', -4.2, 0, -26, { range: 1.8 });
    L.enemy('flyer', 4.2, 0, -24.4, { flyH: 2.2, range: 1.8 });
    L.enemy('hopper', 3.6, 0, -29.4, { range: 1.2, hard: true });
    deco(L, [['jungleTree', -6.6, -28.4, 1.0], ['palmTree', 6.8, -27.6, 0.95], ['giantLeaf', -6.8, -19.6, 1.1], ['fern', 6.4, -18.6, 1.1], ['bigBloom', 6.2, -21.8, 0.9, 4]]);
    glowPatch(L, -2.4, -24.8, 3, 0.6, 2); glowPatch(L, 2.6, -32.0, 2, 0.5, 0); glowPatch(L, -2.8, -32.0, 2, 0.5, 1);
    deco(L, [['fern', -3.4, -36.2, 0.9], ['glowMushroom', 3.2, -36.4, 1.1, 3]], 5.6);

    // ======================================================== C. frog pond
    L.island(0, 5.6, -45, 8.4, { flat: true, grass: false, clear: [[0, -37, 2.4], [-1.2, -44.8, 4.6], [0, -50, 2.6], [2.6, -48.4, 1.2], [6.6, -47.8, 2.2], [3.4, -42, 1.6], [-5, -49, 1.6], [-6.2, -40.4, 1.4]], density: 0.9 });
    L.grass(4.2, 5.6, -40.6, 2.4, 14); L.grass(-5.2, 5.6, -50.4, 2.4, 14); L.grass(5.2, 5.6, -51, 2.2, 10); L.grass(-6, 5.6, -43, 2, 10);
    waterDisc(L, -1.4, 5.7, -44.8, 3.6);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; L.prop(i % 3 ? 'rock' : 'fern', -1.4 + Math.sin(a) * 3.85, 5.6, -44.8 + Math.cos(a) * 3.85, { s: i % 3 ? 0.55 : 0.7, seed: i * 5, collide: false, color: 0xb8c4b0 }); }
    L.mover('lily', 2.4, 2.4, 0.25, [[-1.6, 5.88, -44.6]], {});
    L.mover('lily', 1.3, 1.3, 0.2, [[-3.9, 5.82, -43.4]], {});
    L.mover('lily', 1.1, 1.1, 0.2, [[1.2, 5.8, -46.4]], {});
    L.mover('lily', 1.0, 1.0, 0.2, [[-3.4, 5.8, -46.8]], {});
    L.cookie('frog', -1.6, 6.85, -44.6);
    L.sign(2.6, 5.6, -48.4, () => ['개구리로 변신하면 혀 갈고리를 쓸 수 있어요!', ctl('꽃 고리를 보고 특기 버튼! 혀를 쭉~ 뻗어서 휙 날아가요. 하늘에서도 또 쓸 수 있어요.', '꽃 고리를 보고 특기 버튼(L 또는 C)! 혀를 쭉~ 뻗어서 휙 날아가요. 하늘에서도 또 쓸 수 있어요.')], { icon: '!', yaw: -0.3 });
    L.candyRing(-1.4, 6.5, -44.8, 5.0, 10);
    L.enemy('hopper', 3.4, 5.6, -42, { range: 1.6 });
    L.enemy('hopper', -5, 5.6, -49, { range: 1.6 });
    L.enemy('shooter', -6.2, 5.6, -40.4, { range: 0.4 });
    L.enemy('flyer', 0, 5.6, -50.4, { flyH: 2.4, range: 1.5, hard: true });
    // Puffy 1 on a leaf high up a tree (hook up from the pond)
    L.pillar(6.6, 10.8, -47.8, 0.8, 5.2, BARK);
    L.mover('leaf', 3.4, 3.4, 0.22, [[6.6, 11.0, -47.8]], { stem: 0 });
    L.grapple(3.6, 13.0, -45.4);
    L.puffy(1, 6.8, 11.0, -48.0, { thanks: [{ who: '뭉실이', text: '이렇게 높은 나무 위까지 혀 갈고리로 휙! 정말 멋졌어. 고마워!', face: 'puffy1' }] });
    L.candyRing(6.6, 11.8, -47.8, 1.0, 5);
    L.candyLine([2.2, 7.0, -44.4], [3.4, 12.0, -45.4], 4);
    deco(L, [['jungleTree', -6.8, -38.2, 1.0], ['palmTree', -7.4, -46.0, 0.95], ['giantLeaf', 6.9, -41.0, 1.2], ['fern', 5.6, -52.0, 1.0], ['fern', -5.4, -52.4, 1.0], ['bigBloom', -6.2, -48.4, 0.9, 1], ['stump', 3.2, -39.2, 0.9]], 5.6);
    glowPatch(L, 2.6, -52.4, 2, 0.5, 3); glowPatch(L, -2.6, -52.6, 2, 0.5, 4); glowPatch(L, 5.2, -45.0, 2, 0.5, 0);

    // ======================================================== D. grapple chasm (hook chain)
    // each ring sits ~1.4 m above the previous one so the hook prefers the next ring from the pop-up
    L.grapple(0, 9.4, -57.6);
    L.grapple(0.8, 10.8, -64.0);
    L.grapple(-0.4, 12.2, -72.0);
    L.candyRing(0, 9.8, -57.6, 0.9, 5);
    L.candyRing(0.8, 11.2, -64.0, 0.9, 5);
    L.candyRing(-0.4, 12.6, -72.0, 0.9, 5);
    L.candyArc([-0.2, 13.0, -72.6], [0, 9.6, -75.6], 3, 0.8);

    // ======================================================== E. parrot rest + coconut hill
    L.island(0, 8.6, -79.6, 6.6, { clear: [[0, -74, 2.2], [-2.9, -76.2, 1.2], [3.4, -80.8, 1.6], [-4.6, -82.8, 1.4], [0, -85, 2.4], [-2.2, -85, 1], [6, -79.4, 1.4], [2.2, -85, 1]], density: 0.9, flowers: 0.15 });
    L.checkpoint(-2.9, 8.6, -76.2, { yaw: PI });
    L.prop('stump', 3.4, 8.6, -80.8, { s: 1.2, seed: 3 });
    L.petEvent('parrot', 3.4, 9.9, -80.8, {
      kind: 'quiz',
      lines: ['안녕! 나는 앵무새 따라쟁이야! 따라쟁이~ 따라쟁이~', '내 퀴즈를 맞히면 친구가 되어 줄게! 틀려도 괜찮아, 힌트를 줄게!'],
      questions: [
        { q: '첫 번째 문제! 원숭이가 제일 좋아하는 노란 과일은 뭘까?', choices: ['사과', '바나나', '포도'], answer: 1, right: '딩동댕! 노랗고 길쭉한 바나나! 냠냠~', wrong: '음~ 노랗고 길쭉하고, 껍질을 벗겨 먹는 과일이야!' },
        { q: '두 번째 문제! 연못의 개구리는 어떻게 울까?', choices: ['개굴개굴', '야옹야옹', '꿀꿀'], answer: 0, right: '딩동댕! 개굴개굴~ 개굴개굴~', wrong: '힌트! 개구리의 "개"로 시작하는 소리야!' },
        { q: '마지막 문제! 밤에 꼬리에서 반짝반짝 빛이 나는 작은 곤충은?', choices: ['나비', '개미', '반딧불이'], answer: 2, right: '딩동댕동! 반딧불이 맞아! 이 정글에 아주 많이 살아!', wrong: '힌트! 꼬리에 작은 등불이 달린 친구야. 이 정글 이름에도 들어 있어!' },
      ],
      thanks: '따라쟁이~ 다 맞혔어! 이제 네가 공격하면 나도 깃털을 슝슝 같이 쏴 줄게!',
    });
    L.puffy(4, -4.6, 8.6, -82.8, { hidden: true, thanks: [{ who: '뭉실이', text: '어떻게 알았어? 나 숨바꼭질 진짜 잘하는데! 헤헤, 찾아 줘서 고마워!', face: 'puffy4' }] });
    L.heart(2.2, 9.5, -85.0);
    L.enemy('gloomy', 1.4, 8.6, -77.6, { range: 1.4 });
    L.enemy('hopper', 2.6, 8.6, -83.4, { range: 1.0 });
    L.candyLine([0, 9.5, -76.4], [0, 9.5, -84.0], 4);
    deco(L, [['jungleTree', -5.6, -84.2, 0.95], ['giantLeaf', 5.0, -76.2, 1.1], ['fern', -5.4, -78.0, 1.0], ['bigBloom', 4.6, -84.0, 0.85, 2]], 8.6);
    glowPatch(L, 0.6, -77.4, 2, 0.5, 1); glowPatch(L, -4.0, -84.6, 2, 0.4, 3);
    // panda side islet across falling leaves
    L.falling('leaf', 9.2, 8.6, -79.4, 2.6, 2.6, 0.22, { delay: 0.7, respawn: 2.6 });
    L.falling('leaf', 13.0, 9.0, -80.0, 2.6, 2.6, 0.22, { delay: 0.7, respawn: 2.6 });
    L.island(18.0, 9.4, -80.2, 3.0, { big: 0, small: 2, clear: [[18, -80.2, 1.6]] });
    L.cookie('panda', 18.0, 10.3, -80.2);
    L.sign(19.4, 9.4, -78.6, () => ['판다로 변신하면 대나무 장대로 휘익~ 아주 멀리 뛸 수 있어요!', ctl('특기 버튼을 누르면 보고 있는 쪽으로 장대뛰기!', '특기 버튼(L 또는 C)을 누르면 보고 있는 쪽으로 장대뛰기!')], { icon: '?', yaw: -0.9 });
    L.candyLine([7.4, 9.3, -79.6], [15.2, 10.0, -80.1], 5);
    L.bigCandy(18.8, 10.5, -81.6);
    // coconut hill: rolling coconuts down a slope, leaf pockets to dodge into
    L.sign(-2.2, 8.6, -85.0, () => ['코코넛이 데굴데굴 굴러와요!', '폴짝 뛰어넘거나, 옆의 나뭇잎 쉼터로 쏙 피해요.'], { icon: '!', yaw: 0.2 });
    L.ramp([0, 8.6, -87.6], [0, 12.6, -107.2], 4.4, { top: 'top:grass' });
    L.roller([-0.86, 12.6, -106.6], [-0.86, 8.6, -87.8], { period: 4.2, speed: 4.0, r: 0.72, color: 0x8a6440, phase: 0 });
    L.roller([0.86, 12.6, -106.6], [0.86, 8.6, -87.8], { period: 4.2, speed: 4.0, r: 0.72, color: 0x7a5636, phase: 0.5 });
    if (CTX.diff && CTX.diff.extraEnemies) L.roller([0, 12.6, -106.6], [0, 8.6, -87.8], { period: 4.6, speed: 5.0, r: 0.6, color: 0x9a7048, phase: 0.25 });
    // log rails keep Somi on the slope when a coconut bumps her (gaps at the leaf pockets)
    const rampY = (z) => 8.6 + (-87.6 - z) / 19.6 * 4;
    for (const [x, z0, z1] of [[-2.36, -87.7, -93.2], [-2.36, -95.8, -107.1], [2.36, -87.7, -99.2], [2.36, -101.8, -107.1]]) {
      L.ramp([x, rampY(z0) + 0.55, z0], [x, rampY(z1) + 0.55, z1], 0.32, { style: 'bark', thick: 0.95 });
    }
    L.mover('leaf', 2.4, 2.4, 0.22, [[-3.3, 10.01, -94.5]], { stem: 0 });
    L.mover('leaf', 2.4, 2.4, 0.22, [[3.3, 11.23, -100.5]], { stem: 0 });
    L.candyRing(-3.3, 10.8, -94.5, 0.7, 4);
    L.candyRing(3.3, 12.0, -100.5, 0.7, 4);
    L.candyLine([0, 9.6, -89.4], [0, 13.2, -105.2], 9);

    // ======================================================== F. dim firefly grove
    L.island(0, 12.6, -116.6, 9.4, { pal: GROVE_PAL, clear: [[0, -108.6, 2.4], [-2.4, -111.2, 1.4], [5.6, -111.8, 1.4], [-6.6, -118.2, 1.4], [4.6, -121.4, 1.8], [0.4, -124.6, 1.6], [-3.6, -121.6, 2.0], [0.6, -120.4, 1.0], [-0.9, -121.8, 1.0], [3, -124.6, 1.4], [-7.8, -114.8, 1.2], [-9, -117, 1.6], [6.8, -117, 1.2], [3.2, -116, 1.2]], density: 1.3, flowers: 0.05, big: 6 });
    L.petEvent('firefly', -2.4, 13.9, -111.2, {
      kind: 'collect', itemKind: 'light',
      items: [[5.6, 13.6, -111.8], [-6.6, 13.6, -118.2], [4.6, 15.4, -121.4], [0.4, 13.6, -124.6], [-3.6, 17.1, -121.6]],
      lines: ['흑흑... 나는 반딧불이 반짝이야. 회색 안개 바람에 내 불빛 다섯 개가 숲속에 흩어져 버렸어.', '반짝반짝 빛나는 불빛을 찾아 줄래? 버섯 꼭대기처럼 높은 곳에도 있을 거야!'],
      thanks: '와아, 내 불빛이 다 돌아왔어! 이제 내가 어두운 곳을 환하게 비춰 줄게. 어둠 속에 숨은 발판도 보여 줄 수 있어!',
      onJoin: () => { CTX.hud.toast('반짝이의 불빛으로 숲 왼쪽의 숨은 발판이 보여요!', 'pet', 3.4); CTX.hud.pointAt({ x: -12, y: 13.4, z: -117.4 }, 5); },
    });
    L.block(4.6, 14.4, -121.4, 2.0, 1.8, 2.0, RUIN);
    L.pillar(-3.6, 15.6, -121.6, 0.35, 3.0, { style: 'wood', color: 0xfff0e2, topColor: 0xfff0e2 });
    L.mover('mushroom', 2.8, 2.8, 0.6, [[-3.6, 16.2, -121.6]], { color: 0xff8fc4 });
    L.spring(0.6, 12.6, -120.4, { power: 17, style: 'mushroom' });
    L.pillar(-0.9, 13.9, -121.8, 0.22, 1.3, { style: 'wood', color: 0xfff0e2, topColor: 0xfff0e2 });
    L.mover('mushroom', 1.7, 1.7, 0.45, [[-0.9, 14.4, -121.8]], {});
    L.sign(-7.6, 12.6, -114.6, () => ['깜깜한 숲 너머에 숨은 발판이 있대요.', '반짝이의 불빛을 가까이 가져가면 발판이 반짝 나타나요!'], { icon: '?', yaw: 0.9 });
    const gps = [[-12.0, 13.0, -117.4], [-15.6, 13.5, -119.0], [-19.2, 14.0, -117.8], [-22.8, 14.5, -116.2], [-26.4, 15.0, -117.4]];
    for (const g of gps) L.ghost(g[0], g[1], g[2], 2.4, 2.4, { style: 'crystal' });
    L.island(-32.0, 15.0, -117.6, 2.8, { pal: GROVE_PAL, big: 0, small: 2, clear: [[-32, -117.6, 1.4]] });
    L.puffy(2, -32.0, 15.0, -117.6, { thanks: [{ who: '뭉실이', text: '반짝이 덕분에 숨은 길이 보였구나! 어둠 속까지 찾아와 줘서 고마워!', face: 'puffy2' }] });
    L.bigCandy(-32.9, 15.9, -116.2);
    for (const g of gps) L.candy(g[0], g[1] + 0.9, g[2]);
    L.enemy('ghost', 3.2, 12.6, -116.0, { flyH: 1.6, range: 2.4 });
    L.enemy('ghost', -4.2, 12.6, -114.8, { flyH: 1.8, range: 2 });
    L.enemy('gloomy', 2.4, 12.6, -122.4, { range: 1.6 });
    L.enemy('ghost', -0.6, 12.6, -118.4, { flyH: 1.7, range: 2, hard: true });
    L.heart(6.8, 13.5, -117.0);
    L.checkpoint(3.0, 12.6, -124.6, { yaw: PI });
    deco(L, [['jungleTree', 7.4, -112.6, 1.1], ['jungleTree', -7.6, -110.6, 1.05], ['giantLeaf', 6.6, -120.2, 1.3], ['giantLeaf', -6.8, -121.6, 1.2], ['bigBloom', -5.0, -112.4, 0.9, 1], ['fern', 2.6, -110.2, 1.0], ['fern', -1.4, -116.0, 0.9], ['log', 1.4, -119.0, 0.9]], 12.6);
    glowPatch(L, 5.0, -114.0, 4, 0.8, 0); glowPatch(L, -5.6, -116.0, 4, 0.8, 1); glowPatch(L, 1.8, -113.8, 3, 0.6, 2); glowPatch(L, -2.0, -124.0, 3, 0.6, 3); glowPatch(L, 6.0, -123.4, 3, 0.6, 4); glowPatch(L, -0.4, -119.8, 2, 0.5, 0);
    glowPatch(L, -32.6, -119.0, 3, 0.5, 1);
    L.candyLine([0, 13.5, -108.6], [0, 13.5, -112.6], 3);
    L.candyRing(0, 13.5, -116.6, 3.2, 8);
    L.candyArc([-0.9, 15.2, -121.8], [-3.0, 17.0, -121.6], 3, 0.8);
    L.candyLine([0.6, 14.0, -120.4], [0.6, 16.4, -120.4], 3);

    // ======================================================== G. fox ruins
    L.bridge([0, 12.6, -126.0], [0, 12.6, -131.8], 2.6, { color: 0xc8a070 });
    L.candyLine([0, 13.5, -126.8], [0, 13.5, -130.8], 3);
    L.island(0, 12.6, -140.6, 8.8, { pal: RUIN_PAL, top: 'top:stone', density: 0.55, clear: [[0, -132.6, 2.4], [0, -138, 3.6], [-3.6, -136.8, 1.2], [3.6, -136.8, 1.2], [0, -142.6, 1.8], [-5.6, -141.4, 2.8], [3.4, -144.4, 1.2], [0, -145, 2.6], [6.4, -141, 1.4], [-7.2, -134.6, 1], [7.4, -136, 1]], grassDensity: 0.4 });
    L.cookie('fox', 0, 13.5, -133.8);
    L.sign(2.4, 12.6, -134.6, () => ['여우로 변신하면 파란 여우불을 만들 수 있어요!', ctl('특기 버튼을 누르면 여우불이 빙글빙글~ 꺼진 횃불 가까이 가면 불이 붙어요. 문을 열려면 횃불 세 개!', '특기 버튼(L 또는 C)을 누르면 여우불이 빙글빙글~ 꺼진 횃불 가까이 가면 불이 붙어요. 문을 열려면 횃불 세 개!')], { icon: '!', yaw: -0.4 });
    const t1 = L.torch(-3.6, 12.6, -136.8, null);
    const t2 = L.torch(3.6, 12.6, -136.8, null);
    L.block(0, 13.6, -142.6, 1.8, 1.0, 1.8, RUIN_DARK);
    const t3 = L.torch(0, 13.6, -142.6, null);
    L.torchGroup('torchesG', [t1, t2, t3]);
    for (const t of [t1, t2, t3]) t.obj.setLit(false); // engine Torch builds its model lit by default
    // kid-friendly foxfire aura: torches within 2 m of Somi light up while foxfire is active
    L._add({ update() {
      const p = CTX.player;
      if (!p || !p.buffs || !p.buffs.foxfire) return;
      for (const t of [t1, t2, t3]) if (!t.lit && Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z) < 2.3 && Math.abs(p.pos.y - t.pos.y) < 1.6) t.setLit(true);
    } });
    // ruin wall with the gate
    L.block(-5.2, 15.6, -146.2, 7.2, 3.6, 1.2, RUIN);
    L.block(5.2, 15.6, -146.2, 7.2, 3.6, 1.2, RUIN);
    L.block(0, 16.2, -146.2, 3.4, 0.8, 1.4, RUIN_DARK);
    L.gate(0, 12.6, -146.2, 0, 'torchesG', { w: 3.2, h: 2.8 });
    puffyNpc(L, 3.4, 12.6, -144.4, 5, [
      ['뭉실이', '이 문은 아주 옛날 정글 친구들이 만든 문이래.', 'puffy5'],
      ['뭉실이', '횃불 세 개에 모두 불을 붙이면 문이 스르륵 열린대! 불꽃을 다룰 수 있는 친구가 있으면 좋을 텐데...', 'puffy5'],
    ], { yaw: -0.4 });
    // tiger secret: small ruin room closed by a heavy rock (kangaroo / bear can break it)
    const AX = -5.4, AZ0 = -141.4;
    L.block(AX - 2.1, 15.0, AZ0, 0.8, 2.4, 3.6, RUIN_DARK);
    L.block(AX - 0.3, 15.0, AZ0 + 1.5, 3.6, 2.4, 0.6, RUIN_DARK);
    L.block(AX - 0.3, 15.0, AZ0 - 1.5, 3.6, 2.4, 0.6, RUIN_DARK);
    L.block(AX - 0.3, 15.4, AZ0, 4.0, 0.4, 4.0, RUIN);
    L.rock(AX + 1.3, 12.6, AZ0, { size: 1.7 });
    L.cookie('tiger', AX - 0.9, 13.5, AZ0);
    L.bigCandy(AX - 1.4, 13.4, AZ0 - 0.6);
    L.enemy('spiky', -4.6, 12.6, -133.6, { range: 1.2 });
    L.enemy('gloomy', -2.4, 12.6, -144.0, { range: 1.2 });
    L.enemy('shooter', 6.4, 12.6, -141.0, { range: 0.3 });
    L.enemy('hopper', 5.4, 12.6, -138.0, { range: 1.0, hard: true });
    L.candyRing(0, 13.5, -139.4, 2.0, 7);
    deco(L, [['fern', -7.4, -145.0, 0.9], ['giantLeaf', 7.4, -139.2, 1.0], ['fern', 7.0, -133.8, 0.9], ['bigBloom', -6.8, -133.0, 0.8, 2]], 12.6);
    L.pillar(-7.2, 15.0, -134.6, 0.6, 2.4, RUIN);
    L.pillar(7.4, 14.4, -136.0, 0.6, 1.8, RUIN_DARK);
    glowPatch(L, -3.4, -132.8, 2, 0.4, 3); glowPatch(L, 3.6, -132.6, 2, 0.4, 0);
    // thorn vines on the bridge to the pinwheel court
    L.sign(-2.0, 12.6, -148.0, () => ['앗, 가시덩굴이 길을 막고 있어요!', '여우불을 켜고 가시덩굴 가까이 가면 화르륵 태울 수 있어요.'], { icon: '!', yaw: 0.3 });
    L.bridge([0, 12.6, -149.2], [0, 12.6, -155.6], 2.6, { color: 0xc8a070 });
    L.thorns(0, 12.6, -152.4, { w: 3.0, h: 2.6 });
    L.candyLine([0, 13.5, -154.0], [0, 13.5, -155.4], 2);
    // pinwheel court: wind updraft to the high terrace
    L.island(0, 12.6, -163.2, 7.6, { pal: RUIN_PAL, top: 'top:stone', density: 0.6, clear: [[0, -156.4, 2.2], [3.6, -163, 1.6], [0, -168.0, 2.4], [-4.4, -164.4, 1.4], [-2.4, -158.6, 1.2], [-2.6, -162, 1.4]], grassDensity: 0.4 });
    L.pinwheel(3.6, 12.6, -163.0, 'pinwheelG', { yaw: -0.6, dur: 9 });
    L.pillar(0, 12.75, -168.0, 1.6, 0.4, RUIN_DARK);
    L.wind(0, 16.7, -168.0, 1.6, 4.1, 1.6, [0, 40, 0], { signal: 'pinwheelG', fan: false });
    L.sign(-2.4, 12.6, -158.6, () => ['바람개비를 쌩쌩 돌리면 돌 바람구멍에서 바람이 솟아올라요!', ctl('여우의 꼬리 회오리(공격 버튼)로 바람개비를 맞히고, 바람구멍 위로 쏙!', '여우의 꼬리 회오리(J 또는 X)로 바람개비를 맞히고, 바람구멍 위로 쏙!')], { icon: '?', yaw: 0.3 });
    L.puffy(3, -4.4, 12.6, -164.4, { thanks: [{ who: '뭉실이', text: '바람개비가 쌩쌩 도는 걸 봤어! 너 정말 똑똑하다! 고마워!', face: 'puffy3' }] });
    L.enemy('gloomy', -2.6, 12.6, -162.0, { range: 1.6 });
    L.enemy('hopper', 2.8, 12.6, -158.8, { range: 1.0 });
    L.candyRing(0, 13.5, -163.2, 2.6, 7);
    L.enemy('flyer', 1.6, 12.6, -160.6, { flyH: 2.4, range: 1.4, hard: true });
    L.candyLine([0, 13.6, -168.0], [0, 18.6, -168.0], 5);
    deco(L, [['fern', 5.6, -158.8, 1.0], ['giantLeaf', -6.0, -159.4, 1.0], ['jungleTree', 5.8, -167.4, 0.9], ['fern', -5.4, -168.0, 0.9]], 12.6);
    glowPatch(L, 1.6, -166.4, 2, 0.4, 2); glowPatch(L, -1.6, -166.4, 2, 0.4, 4);

    // ======================================================== H. ruins trap corridor (side view)
    // the walkway is a bit wider on the open (camera) side so a crusher squish never shoves Somi off the edge
    L.slab(0.3, 18.6, -180.3, 4.0, 21.4, { top: 'top:stone', thick: 1.0, pal: RUIN_PAL });
    L.slab(0, 18.6, -199.6, 3.4, 5.2, { top: 'top:stone', thick: 1.0, pal: RUIN_PAL });
    L.block(-2.2, 23.4, -186.0, 0.9, 8.0, 32.4, RUIN_DARK);
    L.block(-0.4, 23.4, -194.0, 3.8, 0.9, 7.4, RUIN);
    for (const z of [-172, -178, -184, -190, -196, -201]) L.pillar(-1.95, 22.4, z, 0.35, 3.8, RUIN);
    L.checkpoint(1.1, 18.6, -171.6, { yaw: PI });
    L.heart(0, 19.5, -173.8);
    L.sign(-1.2, 18.6, -172.8, () => ['오래된 유적의 함정 길이에요!', '쿵쿵 돌덩이와 빙글빙글 불꽃 막대... 리듬을 잘 보고 지나가요!'], { icon: '!', yaw: 0.6 });
    for (const x of [-0.8, 0.3, 1.4]) L.spikeTrap(x, 18.6, -176.4, { period: 2.6, up: 0.4 });
    L.crusher(0, -179.4, 22.2, 18.6, { size: 3.2, wait: 1.4, phase: 0 });
    L.crusher(0, -183.8, 22.2, 18.6, { size: 3.2, wait: 1.4, phase: 0.45 });
    L.firebar(0, 19.25, -187.8, { n: 6, spacing: 0.55, speed: 1.5 });
    L.blink('leaf', 0, 18.6, -192.6, 2.2, 2.2, 0.22, { on: 3.0, off: 1.2, phase: 0 });
    L.blink('leaf', 0, 18.6, -195.3, 2.2, 2.2, 0.22, { on: 3.0, off: 1.2, phase: 0.4 });
    L.saw([[0, 19.1, -194.0], [0, 21.5, -194.0]], { r: 0.85, speed: 2.0, yaw: PI / 2 });
    L.candyLine([0, 19.5, -174.6], [0, 19.5, -177.6], 3);
    L.candy(0, 19.5, -181.6); L.candy(0, 19.5, -185.6);
    L.candyArc([0, 19.5, -186.0], [0, 19.5, -190.0], 3, 1.6);
    L.candyLine([0, 19.4, -192.6], [0, 19.4, -195.3], 2);
    L.enemy('gloomy', 0, 18.6, -199.2, { range: 0.6, hard: true });
    L.camZone(0, 21, -186, 6, 5, 16.6, { yaw: PI / 2, pitch: 0.3, dist: 11.5, lockYaw: true, priority: 2 });
    L.checkpoint(1.1, 18.6, -200.6, { yaw: PI });

    // ======================================================== I. boss bridge + Kamel arena
    L.bridge([0, 18.6, -202.2], [0, 18.6, -213.8], 2.6, { color: 0xc8a070 });
    L.candyLine([0, 19.5, -203.4], [0, 19.5, -212.6], 6);
    L.heart(0.8, 19.5, -208.0);
    L.sign(-1.8, 18.6, -203.6, () => ['다리 너머 유적에서 혀가 쭉쭉 나오는 소리가 들려요...', '숨어 있는 친구를 잘 찾아봐요. 나무 기둥 뒤로 숨는 것도 좋은 생각이에요!'], { icon: '!', yaw: 0.25 });
    const AZ = -227.8, AY = 18.6;
    const arena = L.arena(0, AY, AZ, 14, { big: 8, small: 6 });
    stage.arena = arena;
    const pillars = [];
    for (const a of [PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]) {
      const x = Math.sin(a) * 6.6, z = AZ + Math.cos(a) * 6.6;
      const pc = L.pillar(x, AY + 4.0, z, 0.95, 4.0, BARK);
      pc.camBlock = false; // keep the camera free in the arena
      L.prop('giantLeaf', x + 0.2, AY + 4.0, z, { s: 1.5, seed: Math.round(a * 10), collide: false });
      L.prop('fern', x - 0.3, AY + 4.0, z + 0.2, { s: 1.2, seed: Math.round(a * 7), collide: false });
      L.prop('glowMushroom', x + 1.2, AY, z + 0.4, { s: 1.0, color: GLOW[Math.round(a) % GLOW.length], collide: false });
      pillars.push({ x, z, r: 0.95 });
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.15, rr = 11.9 + (i % 3) * 0.55;
      const x = Math.sin(a) * rr, z = AZ + Math.cos(a) * rr;
      if (Math.abs(x) < 3 && z > AZ + 8) continue; // keep the entrance free
      const k = i % 4;
      if (k === 0) L.prop('glowMushroom', x, AY, z, { s: 1.25, color: GLOW[i % GLOW.length], collide: false, seed: i });
      else if (k === 1) L.prop('fern', x, AY, z, { s: 1.15, collide: false, seed: i });
      else if (k === 2) L.prop('bigBloom', x, AY, z, { s: 0.9, color: GLOW[(i + 2) % GLOW.length], collide: false, seed: i });
      else L.lv.addParts(blockParts(x, AY + 0.7 + (i % 2) * 0.5, z, 0.9, 0.9 + (i % 2) * 0.5, 0.9, { key: 'block:stone', color: RUIN_DARK.color, color2: RUIN_DARK.color2, yaw: a }));
    }
    stage.bossCtl = new ChameleonBoss(stage, {
      pos: [0, AY, AZ - 3.8], yaw: 0, arena, pillars,
      introLines: [
        { who: '카멜레온 카멜', text: '후후후... 내가 보이니? 나는 숨바꼭질 대장 카멜이야!', face: 'bossfog:chameleon' },
        { who: SOMI, text: '카멜! 회색 안개 때문에 정글 친구들이 다 숨어 버렸어. 이제 그만해 줘!', face: meFace() },
        { who: '카멜레온 카멜', text: '싫어싫어! 아무도 나를 못 찾게 숨을 거야. 내 긴 혀를 피할 수 있나 보자, 낼름!', face: 'bossfog:chameleon' },
      ],
      thanks: [
        ['boss', '어라...? 눈앞이 반짝반짝해. 꼬리 끝까지 초록색이 돌아왔어!'],
        [SOMI, '카멜, 이제 괜찮아? 다행이다!'],
        ['boss', '숨어 있으면 아무도 나를 못 볼 거라고 생각했어. 그런데 숨는 건... 정말 외로운 거구나.'],
        ['boss', '안개 속에서 우는 그 아이도 어딘가에 혼자 숨어 있는 게 아닐까?'],
        ['boss', '정글을 밝혀 줘서 고마워. 자, 이 꿈빛을 가져가렴!'],
      ],
    });
    L.killY(-22);
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      shots: [
        [[15, 13, 17], [0, 3, -16], 2.6, 50],
        [[-15, 19, -50], [0, 9, -76], 2.6, 52],
        [[-26, 25, -104], [-8, 13, -120], 2.4, 52],
        [[17, 31, -170], [0, 19, -212], 2.4, 54],
      ],
      lines: [
        ['뭉실이', '어서 와, 반딧불 정글에 온 걸 환영해! 그런데... 회색 안개 때문에 반딧불들이 모두 숨어 버렸어.', 'puffy2'],
        [SOMI, '걱정 마! 내가 초록 꿈빛을 찾아서 정글을 다시 반짝반짝하게 만들어 줄게!', 'me'],
        ['뭉실이', '정글 깊은 유적에 카멜레온 카멜이 숨어 있대. 새로운 동물 친구들의 힘을 빌려 봐!', 'puffy2'],
      ],
      toast: '빛나는 버섯을 따라 정글 깊은 곳으로!',
    });
  },

  // dim the light inside the firefly grove so fireflies and glowing mushrooms shine
  update(dt, stage) {
    const p = stage.player;
    if (!p) return;
    let k = 0;
    for (const [x, z, r] of DIM_ZONES) {
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (p.pos.y > 10 && p.pos.y < 20) k = Math.max(k, d < r ? 1 : d < r + 6 ? 1 - (d - r) / 6 : 0);
    }
    const s = this._dim || (this._dim = { k: 0, base: null });
    const prev = s.k;
    s.k += (k - s.k) * Math.min(1, dt * 1.6);
    if (Math.abs(s.k) < 0.002) s.k = 0;
    if (s.k === prev) return;
    const R = CTX.renderer;
    if (!R || !R.globals) return;
    const g = R.globals;
    if (!s.base) { const J = THEMES.jungle; s.base = { sun: rgb(J.sunColor), sky: rgb(J.skyLight), ground: rgb(J.groundLight), fog: rgb(J.fog) }; }
    const f = 1 - 0.42 * s.k, ff = 1 - 0.32 * s.k;
    g.uSunColor.set(s.base.sun.map((v) => v * f));
    g.uSkyColor.set(s.base.sky.map((v) => v * (1 - 0.3 * s.k)));
    g.uGroundColor.set(s.base.ground.map((v) => v * f));
    g.uFogColor.set(s.base.fog.map((v) => v * ff));
    R.touchGlobals();
    if (stage.level) stage.level.dark = s.k > 0.5;
  },
};

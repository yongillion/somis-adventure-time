// ============================================================================
// stage5.js — 수정 바다 (Crystal Sea) — sunny beach islands over the open sea,
// coral walls, crystal lasers and turquoise lagoons. Boss: 문어 대왕 옥토.
// Sections:
//  A coral beach landing (greeter, first enemies, Puffy 0)
//  B dolphin cookie + seed sprouts: water rings grow flower steps over a coral wall
//  C seagull beach islets: chase the seagull across islets (Puffy 1 on a side islet)
//  D crystal laser causeway (on/off lasers) + lily channel (moving lily pads)
//    + sweeping crystal lasers
//  E shark cookie + side coral lagoon (dive: Puffy 2 underwater)
//  F otter cookie + long lagoon with a strong current: water-run across
//  G star-cannon island: cannons over the sea (+ turtle side islet via a side cannon)
//  H dragonfly race island (7 rings, 30 s), Puffy 3
//  I jellyfish crossing over the sea on moving lily pads (gauntlet 2), hidden Puffy 4
//  J bridge + Octo arena (round, octopus in a center pool)
// ============================================================================
import { rgb, Vec3 } from '../../engine/math.js';
import { Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { blockParts } from '../world/terrain.js';
import { OctopusBoss } from '../bosses/octopus.js';
import { stageIntro, puffyNpc, ctl, SOMI, meFace } from './common.js';

const PI = Math.PI;
const SEA_Y = -2.2;
const CORAL = { style: 'stone', color: 0xffb8c6, color2: 0xff9fb6 };
const CRYSTAL = { style: 'crystal', color: 0xc8eaff, color2: 0xe2d4ff };
const SANDB = { style: 'sand', color: 0xffe6c0, color2: 0xf6d8a8 };
const CRYSTAL_PAL = { grass: 0xdcefff, grass2: 0xeae2ff, rim: 0xbcdcff };
const CORALS = [0xff8fb0, 0xffb06a, 0xc8a0ff, 0x7ad8e8, 0xffe07a];

// [type, x, z, scale, colorIndex?] on whatever ground is below
function deco(L, list, y = null) {
  for (const [t, x, z, s = 1, ci] of list) {
    L.prop(t, x, y, z, { s, seed: Math.round(Math.abs(x * 7 + z * 3)), yaw: (x * 1.3 + z * 0.7) % 6.28, color: ci !== undefined ? CORALS[ci % CORALS.length] : undefined });
  }
}
// round water disc (visual only)
function waterDisc(L, x, y, z, r) {
  const m = new Mesh(G.cachedGeo('s5:disc' + r, () => G.circleGeo(r, 48)), new Material({ shader: 'water', color: 0x7ad8f0, transparent: true, opacity: 0.85, uniforms: { uDeep: rgb(0x2a90c8), uWaveAmp: 0.08 }, satField: true }));
  m.position.set(x, y, z);
  m.renderOrder = 3;
  L.lv.root.add(m);
  return m;
}
// an enclosed lagoon: sandy floor, rim walls reaching the floor, water volume.
// inner box: center (cx, cz), size w x d. Returns the inner bounds.
function lagoon(L, cx, cz, w, d, top, floor, rims, o = {}) {
  const t = 1.0;
  const [rN, rS, rW, rE] = rims; // rim top heights (null = no wall on that side)
  const style = o.rim || SANDB;
  const h = (rt) => rt - floor + 0.2;
  if (rN !== null) L.block(cx, rN, cz + d / 2 + t / 2, w + t * 2, h(rN), t, style);
  if (rS !== null) L.block(cx, rS, cz - d / 2 - t / 2, w + t * 2, h(rS), t, style);
  if (rW !== null) L.block(cx - w / 2 - t / 2, rW, cz, t, h(rW), d, style);
  if (rE !== null) L.block(cx + w / 2 + t / 2, rE, cz, t, h(rE), d, style);
  L.slab(cx, floor, cz, w + 0.2, d + 0.2, { thick: 0.5, under: false, top: 'top:sand' });
  L.water(cx, top, cz, w, d, top - floor, { color: o.color ?? 0x6fdcf0, deep: o.deep ?? 0x2a9ad0 });
  return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
}

export default {
  build(L, stage) {
    // the env's decorative ring of far islands is centered on the origin (stages.js has no `center` for this
    // stage); this stage is ~330 m long, so rebuild the ring around its middle with a seed that keeps every far
    // island well away from the route (otherwise one hangs right above the otter lagoon), stretched along the
    // stage axis so the islands near both ends stay ~90 m+ away.
    if (CTX.env && CTX.env.distant && CTX.env._buildDistant) {
      CTX.env.distant.removeFromParent();
      CTX.env._buildDistant(CTX.env.theme, 2029, new Vec3(0, 0, -160));
      const d = CTX.env.distant;
      if (d && d.scale && d.position) { d.scale.set(1, 1, 1.4); d.position.z = -160 * (1 - 1.4); }
    }
    // ======================================================== A. coral beach landing
    L.island(0, 1, 0, 10, { clear: [[0, 6.6, 2.6], [0, 2, 2.4], [0, -3, 2.6], [0, -7.6, 2.6], [-2.6, 4.4, 1.3], [2.6, 3.6, 1.2], [6, -4.6, 1.8], [-3, -3, 1.6], [3.4, -5.6, 1.5]], density: 1.0, flowers: 0.08 });
    L.start(0, 1.3, 7, PI);
    puffyNpc(L, -2.6, 1, 4.4, 4, [
      ['뭉실이', '어서 와! 여기는 수정 바다야. 원래는 바닷물이 수정처럼 반짝반짝 빛났어.', 'puffy4'],
      ['뭉실이', '그런데 회색 안개 때문에 바다가 흐려졌어. 바다 깊은 곳에서 문어 대왕님이 화가 났대...', 'puffy4'],
      ['뭉실이', '물웅덩이에서는 누구나 헤엄칠 수 있어! 그래도 넓은 바다에 빠지면 아야~ 하니까 조심해!', 'puffy4'],
    ], { yaw: 0.5 });
    L.sign(2.6, 1, 3.6, () => ['섬과 섬 사이 바다에 풍덩 빠지면 하트가 하나 줄어요. 조심조심 폴짝!', '맑은 물웅덩이에서는 헤엄칠 수 있어요. 점프 버튼으로 물 밖으로 폴짝!'], { icon: '!', yaw: -0.35 });
    L.candyLine([0, 1.9, 4.6], [0, 1.9, 1.4], 4);
    L.candyRing(0, 1.9, -2.6, 2.6, 8);
    L.candyLine([0, 1.9, -6], [0, 1.9, -9], 3);
    L.enemy('gloomy', -3, 1, -3, { range: 2.4 });
    L.enemy('gloomy', 3.4, 1, -5.6, { range: 1.8 });
    L.enemy('hopper', 0.4, 1, -6.8, { range: 1.4, hard: true });
    L.candyRing(6.0, 1.9, -4.6, 1.7, 6);
    L.puffy(0, 6.0, null, -4.6, { thanks: [{ who: '뭉실이', text: '고마워! 파도 소리가 무서워서 꼼짝도 못 했어... 이제 괜찮아!', face: 'puffy0' }] });
    deco(L, [['beachUmbrella', 7.4, -5.8, 1.0], ['palmTree', -6.4, -6.8, 1.05], ['palmTree', 6.6, 3.8, 0.95], ['sandcastle', -6.0, 1.8, 0.9], ['lifebuoy', 4.4, 6.4, 0.9], ['coral', -7.4, -2.2, 1.1, 0], ['coral', 7.6, -1.2, 1.0, 2], ['barnacleRock', -4.6, 6.8, 0.9]]);
    deco(L, [['shell', 1.8, 1.6, 1.2, 0], ['starfish', -1.6, -1.4, 1.3, 1], ['shell', -2.2, 2.6, 1.0, 3], ['starfish', 2.4, -6.4, 1.2, 4], ['shell', -1.4, -7.8, 1.1, 1]]);
    L.bridge([0, 1, -9.6], [0, 1, -15.6], 2.4, { color: 0xe8c08a });
    L.candyLine([0, 1.9, -10.4], [0, 1.9, -14.8], 4);

    // ======================================================== B. dolphin + seed flower steps
    L.island(0, 1, -24, 8.6, { clear: [[0, -16, 2.2], [0, -19, 1.6], [2.4, -20, 1.2], [-3.1, -21, 1.4], [-2.2, -29.6, 2.2], [1.8, -30.6, 2.2], [0, -27, 2], [-4.6, -25.6, 1.4], [4.2, -24, 1.4], [3.4, -28.6, 1.2]], density: 0.9, flowers: 0.08 });
    L.cookie('dolphin', 0, 1.9, -18.8);
    L.sign(2.4, 1, -20.0, () => ['돌고래로 변신하면 물방울 링을 쏠 수 있어요!', ctl('목마른 씨앗에 공격 버튼으로 물방울 링을 퐁퐁! 쑥쑥 자라서 꽃 발판이 돼요.', '목마른 씨앗에 J(또는 X)로 물방울 링을 퐁퐁! 쑥쑥 자라서 꽃 발판이 돼요.')], { icon: '!', yaw: -0.4 });
    L.checkpoint(-3.1, 1, -21, { yaw: PI });
    // coral wall (top 7.6) — the flower steps lead over it
    L.block(0, 7.6, -34.6, 13, 13, 4, CORAL);
    L.lv.addParts(blockParts(0, 7.75, -32.75, 13.2, 0.35, 0.5, { key: 'deco', color: 0xffd0da, color2: 0xffc0cc, round: 0.15 }));
    coralWall(L, -6.5, 6.5, -32.6, -36.6, 1.0, 7.6);
    L.candyLine([0, 8.5, -33.8], [0, 8.5, -36.0], 3);
    L.seed(-2.2, 1, -29.6, { h: 2.4, r: 1.2 });
    L.seed(1.8, 1, -30.6, { h: 4.7, r: 1.2 });
    L.camZone(0, 5, -30.5, 7, 6, 5, { pitch: 0.58, dist: 10.5, height: 2.0, priority: 1 });
    L.candyRing(-2.2, 1.9, -27.4, 0.6, 4);
    L.candyRing(1.8, 1.9, -28.4, 0.6, 4);
    L.candyArc([-2.2, 4.2, -29.6], [1.8, 6.4, -30.6], 4, 1.0);
    L.candyArc([1.8, 6.4, -30.6], [0, 8.4, -34.0], 4, 1.2);
    L.enemy('gloomy', -4.6, 1, -25.6, { range: 1.6 });
    L.enemy('flyer', 4.2, 1, -24, { flyH: 2.2, range: 1.8 });
    L.enemy('gloomy', 3.4, 1, -28.6, { range: 1.2, hard: true });
    deco(L, [['palmTree', -6.8, -28.0, 1.0], ['palmTree', 6.8, -19.6, 0.95], ['coral', -6.6, -19.2, 1.1, 1], ['coral', 6.6, -27.4, 1.0, 3], ['seaweed', 5.0, -29.4, 1.2], ['seaweed', -5.0, -29.8, 1.1]]);
    deco(L, [['crystalCluster', -4.6, -34.0, 1.2], ['coral', 4.2, -35.4, 1.2, 4], ['crystalCluster', 5.4, -33.6, 0.9], ['coral', -2.0, -35.6, 0.9, 2]], 7.6);

    // ======================================================== C. seagull beach islets
    L.island(0, 1, -45, 8.4, { clear: [[0, -37, 2.4], [3.4, -47.2, 1.4], [0, -45, 2.8], [0, -52, 2.4], [-4.4, -40.4, 1.4], [5.8, -41, 1.4]], density: 0.9, flowers: 0.06 });
    L.island(-3.5, 1, -59, 3.4, { big: 1, small: 2, clear: [[-3.5, -59, 1.6], [-5.0, -60.0, 1.0]] });
    L.island(2.5, 1.3, -67.5, 3.2, { big: 1, small: 2, clear: [[2.5, -67.5, 1.8]] });
    L.island(8.8, 1.2, -64.0, 2.3, { big: 0, small: 2, clear: [[8.8, -63.8, 1.2]] });
    L.island(-1.5, 1.6, -76, 3.4, { big: 1, small: 2, clear: [[-1.5, -76, 1.8], [-2.4, -77.0, 1.0]] });
    for (const [x, y, z] of [[3.4, 1, -47.2], [-5.0, 1, -60.0], [9.6, 1.2, -64.8], [3.8, 2, -86.0]]) L.prop('barnacleRock', x, y, z, { s: 1.0, seed: Math.round(z) });
    L.prop('sandcastle', -2.4, 1.6, -77.0, { s: 1.0, seed: 5 });
    L.petEvent('seagull', 3.4, 2.6, -47.2, {
      kind: 'chase',
      perches: [[3.4, 2.6, -47.2], [-5.0, 2.6, -60.0], [9.6, 2.8, -64.8], [-2.4, 3.3, -77.0], [3.8, 3.6, -86.0]],
      taunts: ['끼룩! 나 잡아 봐라~', '파도보다 빨리 와 봐!', '저기 작은 섬으로 간다~', '헤헤, 조금만 더!'],
      endLines: ['끼룩끼룩! 잡혔다! 너 정말 날쌔구나!', '나는 갈매기 끼룩이야. 같이 바닷바람을 타고 다니자!'],
      thanks: '끼룩~ 이제 호버링이 끝나도 점프를 꾹 누르고 있으면, 내가 바닷바람으로 더 멀리 데려다줄게!',
    });
    L.puffy(1, 8.6, 1.2, -63.2, { thanks: [{ who: '뭉실이', text: '바다 건너 작은 섬까지 와 줬구나! 끼룩이도 고맙대. 고마워!', face: 'puffy1' }] });
    L.candyLine([0, 1.9, -38.4], [0, 1.9, -43.6], 4);
    L.candyArc([-0.8, 1.9, -53.4], [-3.0, 1.9, -56.4], 3, 1.4);
    L.candyArc([-1.6, 1.9, -61.6], [1.2, 2.2, -65.0], 4, 1.6);
    L.candyArc([4.6, 2.2, -66.4], [7.4, 2.1, -64.6], 3, 1.4);
    L.candyArc([1.2, 2.2, -70.2], [-0.6, 2.5, -73.4], 3, 1.4);
    L.candyArc([-0.6, 2.5, -78.6], [0, 2.9, -81.6], 3, 1.2);
    L.enemy('hopper', 2.5, 1.3, -67.5, { range: 1.2 });
    L.enemy('flyer', -2.6, 1, -49.6, { flyH: 2.2, range: 1.4 });
    L.enemy('hopper', -1.5, 1.6, -75.2, { range: 1.2, hard: true });
    deco(L, [['palmTree', -6.6, -42.0, 1.0], ['beachUmbrella', 6.0, -50.4, 0.95], ['coral', -6.8, -49.0, 1.0, 0], ['sandcastle', 5.6, -40.6, 0.8], ['lifebuoy', -4.6, -50.8, 0.9]]);
    deco(L, [['shell', 1.6, -42.6, 1.2, 2], ['starfish', -2.4, -47.8, 1.3, 0], ['shell', 2.2, -51.2, 1.1, 4], ['starfish', -2.6, -58.0, 1.2, 3], ['shell', 3.4, -66.6, 1.1, 1], ['starfish', 8.2, -64.8, 1.2, 0], ['shell', -0.6, -75.0, 1.2, 2]]);

    // ======================================================== D. crystal lasers + lily channel
    L.island(0, 2, -88, 7.5, { pal: CRYSTAL_PAL, top: 'top:crystal', clear: [[0, -81, 2.4], [-2.8, -84.2, 1.4], [3.8, -86, 1.4], [2.6, -91.6, 1.2], [0, -94, 2.4]], density: 0.7, flowers: 0.05 });
    L.checkpoint(-2.8, 2, -84.2, { yaw: PI });
    L.sign(2.6, 2, -91.6, () => ['수정 레이저가 깜빡깜빡! 꺼졌을 때 지나가거나, 폴짝 뛰어넘어요.', '움직이는 연잎은 잘 보고 타요. 물에 빠지면 헤엄쳐서 올라와요!'], { icon: '!', yaw: -0.3 });
    L.heart(-2.4, 2.9, -92.4);
    L.candyRing(0, 2.9, -88.0, 3.0, 8);
    deco(L, [['crystalCluster', -5.4, -86.0, 1.3], ['crystalCluster', 5.6, -91.0, 1.1], ['coral', -5.6, -91.6, 1.0, 2], ['palmTree', 4.8, -83.6, 0.95], ['seaweed', -4.0, -82.4, 1.1]]);
    // causeway 1: two on/off lasers
    L.slab(0, 2, -100.6, 3.6, 10.4, { top: 'top:crystal', pal: CRYSTAL_PAL, thick: 0.7 });
    for (const [x, z, yaw, ph] of [[-2.25, -98.6, PI / 2, 0], [2.25, -102.6, -PI / 2, 0.5]]) {
      L.block(x, 2.2, z, 0.7, 2.6, 0.7, CRYSTAL);
      L.laser(x, 2.62, z, yaw, { length: 4.3, on: 1.6, off: 1.6, phase: ph });
    }
    L.candyLine([0, 2.9, -96.4], [0, 2.9, -105], 5);
    // lily channel: moving lily pads over a calm pool (falling in = swimming)
    lagoon(L, 0, -109.6, 7.2, 7.2, 1.4, -1.0, [2.0, 2.0, 2.0, 2.0], { rim: CRYSTAL });
    L.mover('lily', 2.4, 2.4, 0.3, [[-2.0, 1.6, -107.6], [2.0, 1.6, -107.6]], { speed: 1.4, wait: 0.6 });
    L.mover('lily', 2.4, 2.4, 0.3, [[2.0, 1.6, -111.4], [-2.0, 1.6, -111.4]], { speed: 1.4, wait: 0.6 });
    L.enemy('jelly', 0, 1.4, -109.6, { flyH: 1.8, range: 1.6 });
    L.enemy('jelly', 2.6, 1.4, -108.0, { flyH: 2.0, range: 1.4, hard: true });
    L.candyRing(0, 0.2, -109.6, 1.4, 6);
    L.candyLine([0, 2.4, -107.6], [0, 2.4, -111.4], 3);
    // causeway 2: sweeping crystal lasers (jump over the wiper beam)
    L.slab(0, 2, -119.0, 3.6, 11.4, { top: 'top:crystal', pal: CRYSTAL_PAL, thick: 0.7 });
    for (const [x, z, yaw, ph] of [[-2.25, -116.4, PI / 2, 0], [2.25, -121.6, -PI / 2, 0.37]]) {
      L.block(x, 2.2, z, 0.7, 2.6, 0.7, CRYSTAL);
      L.laser(x, 2.62, z, yaw, { length: 4.6, always: true, sweep: 0.85, sweepSpeed: 1.1, phase: ph });
    }
    L.candyArc([0, 2.9, -114.6], [0, 2.9, -118.2], 3, 1.3);
    L.candyArc([0, 2.9, -119.8], [0, 2.9, -123.4], 3, 1.3);

    // ======================================================== E. shark + side coral lagoon (underwater Puffy)
    L.island(0, 2, -133.2, 8.6, { clear: [[0, -125.6, 2.4], [-3, -127.6, 1.4], [0, -127.4, 1.4], [2.6, -128.6, 1.2], [6.6, -133.2, 2.4], [-3.6, -136.4, 1.4], [3.6, -138, 1.4], [0, -141, 2.4]], density: 0.9, flowers: 0.06 });
    L.checkpoint(-3.0, 2, -127.6, { yaw: PI });
    L.cookie('shark', 0, 2.9, -127.4);
    L.sign(2.6, 2, -128.6, () => ['상어, 돌고래, 수달 같은 물 친구들은 물속 깊이 잠수할 수 있어요!', ctl('물에서 공격 버튼을 꾹 누르고 있으면 쏙~ 잠수! 손을 떼면 다시 올라와요.', '물에서 J(또는 X)를 꾹 누르고 있으면 쏙~ 잠수! 손을 떼면 다시 올라와요.')], { icon: '!', yaw: -0.4 });
    lagoon(L, 14.0, -133.2, 8, 10, 1.6, -1.2, [2.4, 2.4, 2.4, 2.4], { rim: CORAL, color: 0x62e0e8, deep: 0x1f8ab8 });
    L.slab(7.7, 2.0, -133.2, 2.8, 12.0, { top: 'top:sand', thick: 0.7, depth: 3 }); // sandy path from the island to the lagoon rim
    L.sign(7.6, 2, -130.4, () => ['산호 웅덩이 바닥에 뭉실이가 갇혀 있어요!', '물 친구로 잠수해서 방울에 콩! 콩! 몸으로 부딪혀 깨 줘요.'], { icon: '?', yaw: -0.9 });
    const cage2 = L.puffy(2, 15.4, -1.2, -135.6, { thanks: [{ who: '뭉실이', text: '보글보글... 물속까지 와 줘서 고마워! 숨 참느라 힘들었지?', face: 'puffy2' }] });
    diverBump(L, cage2);
    L.candyRing(15.4, -0.4, -135.6, 1.7, 8);
    L.bigCandy(11.4, -0.5, -129.6);
    L.candyLine([11.4, 0.4, -137.0], [17.0, 0.4, -129.6], 5);
    deco(L, [['seaweed', 11.0, -136.6, 1.3], ['seaweed', 17.4, -131.0, 1.2], ['coral', 12.4, -137.4, 1.2, 0], ['coral', 17.2, -137.2, 1.0, 2], ['coral', 11.2, -129.0, 1.0, 3], ['shell', 14.0, -132.0, 1.3, 4], ['starfish', 13.0, -134.6, 1.4, 1]], -1.2);
    L.enemy('jelly', 14.0, 1.6, -131.2, { flyH: 1.6, range: 1.6 });
    L.enemy('jelly', 13.0, 1.6, -136.0, { flyH: 1.9, range: 1.4 });
    L.candyLine([0, 2.9, -129.6], [0, 2.9, -139.4], 5);
    L.enemy('gloomy', -3.6, 2, -136.4, { range: 1.8 });
    L.enemy('shooter', -5.6, 2, -139.4, { range: 0.3 });
    L.enemy('spiky', 3.6, 2, -138.0, { range: 1.2, hard: true });
    deco(L, [['palmTree', -6.8, -130.0, 1.0], ['beachUmbrella', -6.2, -134.4, 0.9], ['coral', 4.6, -139.6, 1.0, 1], ['sandcastle', -5.0, -126.6, 0.8], ['lifebuoy', 4.6, -127.0, 0.9]]);
    deco(L, [['shell', 1.6, -131.2, 1.2, 0], ['starfish', -1.8, -134.0, 1.3, 2], ['shell', 1.8, -139.0, 1.1, 3]]);
    L.bridge([0, 2, -141.6], [0, 2, -147.8], 2.4, { color: 0xe8c08a });
    L.candyLine([0, 2.9, -142.4], [0, 2.9, -147.0], 4);

    // ======================================================== F. otter + current lagoon (water-run)
    L.island(0, 2, -155, 7.2, { clear: [[0, -148.4, 2.2], [0, -150.6, 1.4], [2.4, -151.6, 1.2], [0, -157, 2.4], [-3.4, -156, 1.4], [3.6, -158, 1.4]], density: 0.9, flowers: 0.06 });
    L.cookie('otter', 0, 2.9, -150.6);
    L.sign(2.4, 2, -151.6, () => ['수달로 변신하면 물 위를 사사삭 달릴 수 있어요!', ctl('물가에서 특기 버튼! 센 물살도 물 위로 달리면 문제없어요. 잠수해서 물살 아래로 가도 돼요.', '물가에서 특기 버튼(L 또는 C)! 센 물살도 물 위로 달리면 문제없어요. 잠수해서 물살 아래로 가도 돼요.')], { icon: '!', yaw: -0.4 });
    L.heart(-2.4, 2.9, -158.4);
    L.candyRing(0, 2.9, -155.0, 2.6, 8);
    L.enemy('hopper', -3.4, 2, -156, { range: 1.4 });
    L.slab(0, 2.0, -161.4, 11, 2.4, { top: 'top:sand', thick: 0.7, depth: 3 }); // shore between the island and the lagoon
    lagoon(L, 0, -175.4, 9, 24, 1.4, -1.2, [2.0, 1.75, 2.4, 2.4], { rim: SANDB });
    L.slab(0, 2.0, -189.2, 11, 2.0, { top: 'top:sand', thick: 0.7, depth: 3 });
    L.wind(0, 0.8, -175.4, 4.5, 0.6, 12, [0, 0, 40], { fan: false });
    L.enemy('jelly', -2.4, 1.4, -170.0, { flyH: 2.9, range: 1.4 });
    L.enemy('jelly', 2.4, 1.4, -180.6, { flyH: 2.9, range: 1.4 });
    L.candyLine([0, 1.9, -165], [0, 1.9, -186], 10);
    for (let i = 0; i < 6; i++) { const z = -165.4 - i * 4.2; L.prop('lifebuoy', i % 2 ? 5.0 : -5.0, 2.4, z, { s: 0.8, seed: i }); }
    deco(L, [['palmTree', 5.2, -150.0, 0.95], ['coral', -5.4, -151.2, 1.0, 4], ['beachUmbrella', 4.6, -159.4, 0.85], ['shell', -1.8, -153.4, 1.2, 1]], 2);

    // ======================================================== G. star-cannon island (+ turtle side islet)
    L.island(0, 2, -196.6, 8, { clear: [[0, -189.6, 2.2], [-3, -192, 1.4], [0, -202.6, 1.6], [6.2, -196, 1.6], [2.6, -193.4, 1.2], [-3.4, -199, 1.4], [4.4, -200.8, 1.2]], density: 0.9, flowers: 0.06 });
    L.checkpoint(-3.0, 2, -192.0, { yaw: PI });
    L.sign(2.6, 2, -193.4, () => ['별 대포에 폴짝 올라타면 바다 건너로 슝~ 날아가요!', '대포가 바라보는 쪽으로 날아가니까 잘 보고 타요.'], { icon: '!', yaw: -0.3 });
    puffyNpc(L, 4.4, 2, -200.8, 3, [
      ['뭉실이', '오른쪽을 보고 있는 대포도 있지? 저쪽 작은 섬에 무언가 반짝이는 게 있대!', 'puffy3'],
      ['뭉실이', '대포는 하나도 안 무서워. 슝~ 하고 날아가는 거야. 신난다!', 'puffy3'],
    ], { yaw: -0.6 });
    L.cannon(0, 2, -202.6, [-3.6, 3.0, -223.4], { time: 1.6 });
    L.cannon(6.2, 2, -196.0, [25.6, 2.5, -196.4], { time: 1.6 });
    L.island(-3.6, 3.0, -222.8, 3.8, { big: 1, small: 2, clear: [[-3.6, -223.4, 1.8], [-3.6, -225.0, 1.4]] });
    L.cannon(-3.6, 3.0, -225.4, [1.8, 3.5, -246.4], { time: 1.7 });
    L.island(26.0, 2.5, -196.4, 4.0, { big: 1, small: 3, clear: [[25.6, -196.4, 1.8], [24.0, -198.8, 1.4], [27.4, -194.6, 1.2]] });
    L.cookie('turtle', 27.4, 3.4, -194.6);
    // a little spike garden guards a big candy: the turtle's shell spin rolls right over it
    L.spikes(26.5, 2.5, -199.1, 2.2, 1.9);
    L.bigCandy(26.5, 3.4, -199.1);
    L.candyLine([25.4, 3.3, -197.6], [27.6, 3.3, -197.6], 3);
    L.cannon(24.0, 2.5, -198.8, [2.6, 2.0, -194.6], { time: 1.6 });
    L.sign(28.7, 2.5, -196.2, () => [ctl('거북이로 변신해서 특기 버튼을 누르면 등껍질 스핀! 가시 바닥도 데구루루 지나가요.', '거북이로 변신해서 특기 버튼(L 또는 C)을 누르면 등껍질 스핀! 가시 바닥도 데구루루 지나가요.'), '다시 돌아갈 땐 옆의 대포를 타요.'], { icon: '?', yaw: -1.2 });
    L.candyLine([0, 2.9, -191.0], [0, 2.9, -199.6], 4);
    L.enemy('gloomy', -3.4, 2, -199, { range: 1.6 });
    L.enemy('gloomy', 3.2, 2, -191.6, { range: 1.4 });
    L.enemy('shooter', -5.6, 2, -195.6, { range: 0.3, hard: true });
    L.candyArc([0, 3.4, -204], [-3.4, 4.4, -220.4], 7, 5);
    L.candyArc([-3.2, 4.4, -227], [1.2, 4.8, -243.4], 7, 5);
    deco(L, [['palmTree', -6.4, -194.0, 1.0], ['beachUmbrella', -5.6, -201.4, 0.9], ['coral', 6.0, -192.0, 1.0, 0], ['sandcastle', 5.0, -202.2, 0.8]]);
    deco(L, [['sandcastle', 24.4, -194.2, 0.8], ['coral', 23.6, -194.0, 1.0, 3]]);

    // ======================================================== H. dragonfly race island
    L.island(2, 3.5, -250, 10, { clear: [[1.8, -242, 2.6], [5.4, -243.6, 1.4], [6.0, -248.2, 1.6], [7.6, -255.6, 1.6], [4, -258.6, 1.6], [-4.2, -255.4, 1.8], [-3.0, -243.4, 1.6], [-5.6, -247, 1.4], [-1.0, -253, 1.6], [8.6, -249, 1.4], [2, -259, 2.4]], density: 0.9, flowers: 0.06 });
    L.island(-11.6, 3.2, -251.0, 2.6, { big: 0, small: 2, clear: [[-11.6, -251, 1.4]] });
    L.island(15.4, 3.8, -252.0, 2.4, { big: 0, small: 2, clear: [[15.4, -252, 1.4]] });
    L.petEvent('dragonfly', 5.4, 4.9, -243.6, {
      kind: 'race', time: 30,
      rings: [[6.0, 4.4, -248.2, 0], [7.8, 5.0, -255.6, 0.7], [15.4, 5.3, -252.0, PI / 2], [4.0, 4.6, -258.6, PI / 2], [-4.2, 5.9, -255.4, -0.8], [-11.6, 4.3, -251.0, 0], [-3.0, 4.4, -243.4, PI / 2]],
      lines: ['쌩쌩~! 나는 잠자리 쌩쌩이야. 바다 위를 나는 게 제일 좋아!', '반짝이는 고리를 30초 안에 차례차례 모두 지나가 볼래? 노랗게 빛나는 고리부터 가면 돼!'],
      thanks: '우와, 진짜 빠르다! 이제 내가 같이 다니면서 네 발이 더 쌩쌩 빨라지게 해 줄게!',
    });
    L.puffy(3, -5.6, 3.5, -247.0, { thanks: [{ who: '뭉실이', text: '잠자리처럼 쌩쌩 와 줬구나! 고마워, 이제 바다를 마음껏 볼 수 있어!', face: 'puffy3' }] });
    L.enemy('gloomy', -1.0, 3.5, -253.0, { range: 2.0 });
    L.enemy('hopper', 8.6, 3.5, -249.0, { range: 1.4 });
    L.enemy('flyer', 2.0, 3.5, -251.0, { flyH: 2.6, range: 2, hard: true });
    L.heart(-1.6, 4.4, -258.4);
    L.candyRing(2, 4.4, -250, 3.4, 10);
    L.candyLine([-8.2, 4.4, -251.0], [-10.6, 4.4, -251.0], 3);
    L.candyLine([12.2, 4.6, -252.0], [14.4, 4.8, -252.0], 3);
    deco(L, [['palmTree', 10.4, -246.0, 1.0], ['palmTree', -6.6, -252.0, 1.05], ['beachUmbrella', 9.4, -253.8, 0.9], ['coral', -5.4, -244.2, 1.1, 1], ['shell', 6.4, -258.0, 1.2, 2], ['coral', 8.8, -244.0, 1.0, 4]]);
    deco(L, [['shell', 3.2, -246.0, 1.2, 0], ['starfish', -1.6, -248.6, 1.3, 2], ['shell', 0.6, -255.2, 1.1, 3], ['starfish', 5.6, -251.6, 1.2, 1]]);

    // ======================================================== I. jellyfish crossing (moving lily pads over the sea)
    L.sign(-0.4, 3.5, -258.6, () => ['연잎 배를 타고 바다를 건너요! 연잎이 가까이 왔을 때 폴짝!', '둥실둥실 해파리는 닿으면 아야~ 해요. 잘 보고 피해요.'], { icon: '!', yaw: 0.3 });
    L.mover('lily', 2.7, 2.7, 0.3, [[2, 3.5, -261.2], [2, 3.5, -267.4]], { speed: 1.8, wait: 1.0 });
    L.mover('lily', 2.7, 2.7, 0.3, [[-1.6, 3.5, -271.0], [5.6, 3.5, -271.0]], { speed: 2.0, wait: 0.6 });
    L.mover('lily', 2.7, 2.7, 0.3, [[2, 3.5, -274.4], [2, 3.5, -276.6]], { speed: 1.4, wait: 0.8 });
    L.enemy('jelly', -0.6, 3.5, -269.2, { flyH: 1.5, range: 1.4 });
    L.enemy('jelly', 4.6, 3.5, -273.4, { flyH: 1.7, range: 1.4 });
    L.enemy('jelly', 2.0, 3.5, -264.6, { flyH: 2.4, range: 1.2, hard: true });
    L.candyLine([2, 4.4, -262.4], [2, 4.4, -266.6], 3);
    L.candyLine([0.6, 4.4, -271], [3.4, 4.4, -271], 3);
    L.candyLine([2, 4.4, -274.6], [2, 4.4, -276.6], 2);
    L.island(2, 3.5, -284, 6, { clear: [[2, -278.6, 2.2], [-0.6, -281.2, 1.4], [5.6, -286, 1.4], [4, -282, 1.0], [-0.2, -288.6, 1.0], [2, -289.6, 2]], density: 0.8, flowers: 0.06 });
    L.checkpoint(-0.6, 3.5, -281.2, { yaw: PI });
    L.prop('barnacleRock', 6.8, 3.5, -287.2, { s: 1.2, seed: 9 });
    L.puffy(4, 5.6, 3.5, -286.0, { hidden: true, thanks: [{ who: '뭉실이', text: '모래 속에 꼭꼭 숨어 있었는데 찾아냈네! 대단해, 고마워!', face: 'puffy4' }] });
    L.heart(4.0, 4.4, -282.0);
    L.candyRing(2, 4.4, -284.0, 2.4, 6);
    deco(L, [['palmTree', -2.6, -286.4, 0.95], ['coral', 6.6, -281.0, 1.0, 2]]);

    // ======================================================== J. boss bridge + Octo arena
    L.bridge([2, 3.5, -289.8], [2, 3.5, -301.6], 2.6, { color: 0xe8c08a });
    L.candyLine([2, 4.4, -291], [2, 4.4, -300.6], 6);
    L.sign(0.2, 3.5, -290.4, () => ['다리 너머 커다란 물웅덩이에서 보글보글 거품이 올라와요...', '다리가 바닥을 쾅! 내려치면 그 다리 끝을 노려 봐요!'], { icon: '!', yaw: 0.3 });
    const AX = 2, AY = 3.5, AZ = -316;
    const arena = L.arena(AX, AY, AZ, 14, { big: 8, small: 6, top: 'top:sand' });
    stage.arena = arena;
    waterDisc(L, AX, AY + 0.1, AZ, 3.3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2 + 0.2;
      L.prop(i % 3 === 0 ? 'coral' : i % 3 === 1 ? 'shell' : 'starfish', AX + Math.sin(a) * 3.7, AY, AZ + Math.cos(a) * 3.7, { s: i % 3 === 0 ? 0.8 : 1.2, color: CORALS[i % CORALS.length], collide: false, seed: i });
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI * 2 + 0.1, rr = 12.0 + (i % 3) * 0.5;
      const x = AX + Math.sin(a) * rr, z = AZ + Math.cos(a) * rr;
      if (Math.abs(x - AX) < 3 && z > AZ + 8) continue;
      const kind = i % 4 === 0 ? 'coral' : i % 4 === 1 ? 'seaweed' : i % 4 === 2 ? 'crystalCluster' : 'shell';
      L.prop(kind, x, AY, z, { s: kind === 'crystalCluster' ? 2.1 : kind === 'shell' ? 1.3 : 1.6, color: CORALS[i % CORALS.length], collide: false, seed: i, yaw: a });
    }
    stage.bossCtl = new OctopusBoss(stage, {
      pos: [AX, AY, AZ], yaw: 0, arena, poolR: 3.3,
      introLines: [
        { who: '문어 대왕 옥토', text: '누구냐문어! 내 수정 바다에서 첨벙첨벙 시끄럽게 하는 게!', face: 'bossfog:octopus' },
        { who: SOMI, text: '문어 대왕님! 바다가 회색으로 흐려졌어요. 회색 안개 때문이죠?', face: meFace() },
        { who: '문어 대왕 옥토', text: '몰라몰라! 마음속이 깜깜해서 아무것도 모르겠어! 내 다리 여섯 개로 혼내 주겠다문어!', face: 'bossfog:octopus' },
      ],
      thanks: [
        ['boss', '어... 바닷물이 다시 수정처럼 반짝반짝해졌어. 내 왕관도!'],
        [SOMI, '문어 대왕님, 이제 괜찮아요? 다행이다!'],
        ['boss', '바다 깊은 곳까지 슬픔이 스며들었었어... 그런데 그 슬픔에서 하늘의 별빛 냄새가 났어.'],
        ['boss', '혹시 하늘에서 떨어진 작은 별이 있는 걸까?'],
        ['boss', '고맙다문어! 자, 바다의 꿈빛을 가져가렴!'],
      ],
    });
    // splash + quick respawn when falling into the open sea
    seaSplash(L);
    L.killY(-5.5);
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      shots: [
        [[16, 12, 18], [0, 2, -16], 2.6, 50],
        [[-18, 16, -62], [0, 2, -90], 2.6, 52],
        [[20, 18, -150], [4, 2, -176], 2.4, 52],
        [[18, 26, -262], [2, 4, -308], 2.4, 54],
      ],
      lines: [
        ['뭉실이', '어서 와, 수정 바다에 온 걸 환영해! 그런데 바닷물이 회색으로 흐려지고 있어...', 'puffy4'],
        [SOMI, '걱정 마! 내가 파랑 꿈빛을 찾아서 바다를 다시 반짝반짝하게 만들어 줄게!', 'me'],
        ['뭉실이', '바다 끝 커다란 웅덩이에 문어 대왕님이 있대. 물 친구들의 힘을 빌려 봐!', 'puffy4'],
      ],
      toast: '파도 소리를 따라 바다 끝까지 가 봐요!',
    });
  },
};

// divers can't attack underwater: bumping into the cage while swimming/diving breaks it
function diverBump(L, cage) {
  L._add({
    cool: 0, hinted: false, hinted2: false,
    update(dt) {
      if (this.cool > 0) this.cool -= dt;
      const p = CTX.player;
      if (!p || !cage || cage.state !== 'caged') return;
      const dx = p.pos.x - cage.pos.x, dz = p.pos.z - cage.pos.z, d = Math.hypot(dx, dz);
      const dy = p.pos.y + 0.5 - (cage.pos.y + 0.7);
      if ((p.state === 'dive' || p.state === 'swim') && d < 1.4 && Math.abs(dy) < 1.3) {
        if (this.cool <= 0) {
          this.cool = 0.45;
          cage.onHit({ dmg: 1, tags: [], kind: 'bump' });
          p.vel.x = dx / (d || 1) * 3; p.vel.z = dz / (d || 1) * 3;
          if (CTX.fx) CTX.fx.bubbles({ x: cage.pos.x, y: cage.pos.y + 1, z: cage.pos.z }, 6);
          if (!this.hinted) { this.hinted = true; CTX.hud.toast('콩! 콩! 물속에서는 몸으로 부딪혀서 방울을 깨요!', 'good', 2.6); }
        }
      } else if (p.state === 'swim' && !p.swimmer && d < 4 && !this.hinted2) {
        this.hinted2 = true;
        CTX.hud.toast('물 친구(돌고래, 상어, 수달...)로 변신하면 공격 버튼을 꾹! 잠수할 수 있어요', 'warn', 3.4);
      }
    },
  });
}

// a splash when Somi drops into the open sea (the kill plane respawns her right after)
function seaSplash(L) {
  L._add({
    wasAbove: true,
    update() {
      const p = CTX.player;
      if (!p) return;
      const above = p.pos.y > SEA_Y;
      if (this.wasAbove && !above && !p.dead && !CTX.physics.waterAt(p.pos.x, p.pos.y + 0.4, p.pos.z)) {
        CTX.fx.splash({ x: p.pos.x, y: SEA_Y, z: p.pos.z }, 1.4);
        if (CTX.audio) CTX.audio.sfx('splash');
      }
      this.wasAbove = above;
    },
  });
}

// visual-only coral blobs (brain coral / sponge bumps) sprinkled over a wall's faces
// faces: south face at z = zS (facing +z), back face z = zN, sides at x0 / x1; y range [y0, y1]
function coralWall(L, x0, x1, zS, zN, y0, y1) {
  let sd = 1234567;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const blob = (x, y, z, r, ci, flat) => {
    const g = G.UNIT.sphere().clone();
    g.applyMatrix(G.trs(x, y, z, 0, 0, 0, r, r * 0.86, r * (flat ? 0.55 : 1)));
    const c = rgb(CORALS[ci % CORALS.length]);
    g.colorBy((px, py, pz, nx, ny) => { const k = 0.8 + 0.16 * Math.max(0, ny) + 0.07 * Math.sin(px * 11 + py * 9 + pz * 7); return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; });
    L.lv.addStatic('deco', g);
  };
  // front face: clusters on both sides of the flower-step climb (keep the middle clear)
  for (let i = 0; i < 30; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (3.4 + rnd() * (x1 - 3.6));
    const y = y0 + 0.4 + rnd() * (y1 - y0 - 0.8);
    const r = 0.26 + rnd() * 0.42;
    blob(x, y, zS + r * 0.12, r, i, true);
    if (rnd() < 0.45) blob(x + (rnd() - 0.5) * 0.9, y + (rnd() - 0.5) * 0.7, zS + 0.08, r * 0.55, i + 2, true);
  }
  // a low row behind the seeds
  for (let i = 0; i < 9; i++) blob(-3.4 + i * 0.85 + rnd() * 0.3, y0 + 0.35 + rnd() * 0.7, zS + 0.06, 0.22 + rnd() * 0.2, i + 1, true);
  // side faces
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1, x = side > 0 ? x1 : x0;
    const z = zS - 0.3 - rnd() * (zS - zN - 0.6), y = y0 + 0.4 + rnd() * (y1 - y0 - 0.8), r = 0.25 + rnd() * 0.4;
    const g = G.UNIT.sphere().clone();
    g.applyMatrix(G.trs(x + side * r * 0.12, y, z, 0, 0, 0, r * 0.55, r * 0.86, r));
    const c = rgb(CORALS[(i + 3) % CORALS.length]);
    g.colorBy((px, py, pz, nx, ny) => { const k = 0.8 + 0.16 * Math.max(0, ny) + 0.07 * Math.sin(px * 11 + py * 9 + pz * 7); return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; });
    L.lv.addStatic('deco', g);
  }
  // big brain corals sitting on the top corners
  blob(x0 + 0.9, y1 + 0.25, zS - 0.9, 0.62, 2, false);
  blob(x1 - 0.8, y1 + 0.22, zN + 0.9, 0.55, 3, false);
  blob(-3.0, y1 + 0.18, zS - 0.5, 0.42, 0, false);
}

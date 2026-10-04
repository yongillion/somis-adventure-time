// ============================================================================
// stage3.js — 해바라기 꿀벌 언덕 (Sunflower Bee Hill)
// Sections:
//  A 해바라기 언덕 입구 — landing hill (greeter, flower arch, first fog cage)         z   8 .. -10
//  B 꿀벌 정원 — quokka cookie + smile sign (enemy group), 윙윙이 feeding,           z -15 .. -34
//      side path east over giant sunflower pads to a little island (puffy 3)
//  C 빙글빙글 해바라기 — three rotating sunflower bars (timing gauntlet 1)            z -38 .. -77
//  D 곰돌이 쿠키 & 금 간 바닥 — bear cookie, honey plaza with a cracked floor        z -80 .. -106
//  E 꿀벌집 동굴 — hive tunnel under the honey mound: pollen lasers (gauntlet 2),    z -100 .. -131
//      a honeycomb nook (puffy), heavy timer-switch gate (puzzle)
//  F 코알라 쿠키 & 덩굴 벽 — koala cookie, climbable vine wall up the shaft (puzzle) z -131 .. -141
//  G 꽃 무대 — flower stage: 랄라's bell melody (puzzle), hidden puffy, secret ledge  z -141 .. -163
//  H 깜빡 꿀방울 길 — blinking bubbles, spike-trap path, falling biscuits (gauntlet 3) z -163 .. -206
//  I 우르릉 번개구름 arena (lantern + bridge before)                                 z -206 .. -252
// ============================================================================
import { Vec3, TAU, clamp } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { PAL } from '../fx.js';
import { Save } from '../save.js';
import { blockParts } from '../world/terrain.js';
import { ThunderCloudBoss } from '../bosses/thundercloud.js';
import { stageIntro, puffyNpc, ctl, SOMI } from './common.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const C3 = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// honey / hive palette: bands at absolute heights (every 2 m)
const HIVE = [[0xffc94a, 0xf4b83a], [0xf6b23a, 0xeba22e], [0xffd772, 0xfac85a], [0xeea232, 0xe39428]];
const HB = 2.0;
const hiveCol = (yb) => HIVE[((Math.round(yb / HB) % 4) + 4) % 4];

// hive wall block: one box collider + honey bands (cobble texture reads like wax cells)
function hive(L, x, top, z, w, h, d, o = {}) {
  const bottom = top - h;
  L.col({ type: 'box', x, y: (top + bottom) / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, tag: 'block', climbable: !!o.climbable });
  let y = top, first = true;
  while (y > bottom + 0.01) {
    const onB = Math.abs(y / HB - Math.round(y / HB)) < 0.004;
    const yb = Math.max(bottom, onB ? y - HB : Math.floor(y / HB) * HB);
    const c = o.color ? [o.color, o.color2 ?? o.color] : hiveCol(yb);
    const inset = first ? (o.cap ?? 0.08) : 0;
    L.lv.addParts(blockParts(x, y, z, Math.max(0.3, w - inset * 2), y - yb + 0.02, Math.max(0.3, d - inset * 2), { color: c[0], color2: c[1], key: 'block:' + (o.style || 'stone'), round: 0.14 }));
    y = yb; first = false;
  }
}
// decorative honeycomb cells on a vertical face (center c, outward normal yaw, size w x h)
function hexPanel(L, cx, cy, cz, yaw, w, h, o = {}) {
  const r = o.r ?? 0.42;
  const dx = Math.sqrt(3) * r, dy = 1.5 * r;
  const items = [];
  const ring = G.cachedGeo('s3:hexRing', () => G.ringGeo(0.8, 1.0, 6));
  const disc = G.cachedGeo('s3:hexDisc', () => G.circleGeo(0.82, 6));
  const tx = Math.cos(yaw), tz = -Math.sin(yaw); // tangent along the face
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const rows = Math.floor(h / dy), cols = Math.floor(w / dx);
  let k = o.seed ?? 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = -w / 2 + dx * (i + 0.5) + (j % 2 ? dx / 2 : 0);
    if (u > w / 2 - dx * 0.4) continue;
    const v = -h / 2 + dy * (j + 0.5);
    const px = cx + tx * u + nx * 0.03, py = cy + v, pz = cz + tz * u + nz * 0.03;
    k = (k * 1103515245 + 12345) & 0x7fffffff;
    const fill = k % 5;
    items.push({ geo: ring, matrix: G.trs(px, py, pz, Math.PI / 2, yaw, 0, r, 1, r), color: C3(0xfff0b0) });
    items.push({ geo: disc, matrix: G.trs(px - nx * 0.015, py, pz - nz * 0.015, Math.PI / 2, yaw, 0, r, 1, r), color: C3(fill === 0 ? 0xd9861c : fill === 1 ? 0xffd04a : 0xf2a933) });
  }
  if (items.length) L.lv.addParts([{ key: 'deco', geo: G.mergeGeometries(items) }]);
}
// wax floor colors (plaza / tunnel floor)
const WAX = { grass: 0xffdf8a, grass2: 0xffd06a, rim: 0xf2b54a };
// honey dripping over a top edge. axis 'x': drips along x (a0..a1) on the face at z = c;
// axis 'z': along z on the face at x = c. out = outward offset (sign gives the face direction)
function honeyDrips(L, axis, a0, a1, yTop, c, out, seed) {
  const items = [];
  const sph = G.UNIT.sphereLo();
  let k = seed * 7919 + 13;
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  for (let a = lo + 0.5; a < hi - 0.3; a += 0.85) {
    k = (k * 1103515245 + 12345) & 0x7fffffff;
    const len = 0.5 + ((k % 100) / 100) * 1.9, w = 0.26 + ((k >> 8) % 10) * 0.025;
    const along = a + (((k >> 4) % 7) - 3) * 0.05;
    const x = axis === 'x' ? along : c + out, z = axis === 'x' ? c + out : along;
    const x2 = axis === 'x' ? x : x + out * 0.6, z2 = axis === 'x' ? z + out * 0.6 : z;
    const sx = axis === 'x' ? w : w * 0.6, sz = axis === 'x' ? w * 0.6 : w;
    items.push({ geo: sph, matrix: G.trs(x, yTop - len / 2 + 0.05, z, 0, 0, 0, sx, len / 2 + 0.12, sz), color: C3(0xffb52e) });
    items.push({ geo: sph, matrix: G.trs(x2, yTop - len + 0.05, z2, 0, 0, 0, w * 1.18, w * 1.3, w * 1.18), color: C3(0xffc340) });
  }
  if (items.length) L.lv.addParts([{ key: 'deco', geo: G.mergeGeometries(items) }]);
}
// a giant straw beehive (skep): stacked straw rings shrinking toward the top, entrance facing +Z
function skep(L, x, y, z, R, H) {
  const items = [];
  const n = 9;
  const tube = (H / n) * 0.62;
  for (let i = 0; i < n; i++) {
    const v = (i + 0.5) / n;
    const rr = Math.max(tube * 1.2, R * Math.sqrt(Math.max(0.02, 1 - v * v * 0.92)) - tube * 0.4);
    items.push({ geo: G.torusGeo(rr, tube, 8, 48), matrix: G.trs(x, y + tube * 0.8 + v * (H - tube * 1.6), z, Math.PI / 2, 0, 0), color: C3(i % 2 ? 0xe9b24c : 0xf6c862) });
  }
  // core filler so no gaps show between the rings
  items.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(x, y + 0.1, z, 0, 0, 0, R * 0.93, H * 0.97, R * 0.93), color: C3(0xd99a3a) });
  // knob on top
  items.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(x, y + H + tube * 0.1, z, 0, 0, 0, tube * 1.4, tube * 1.1, tube * 1.4), color: C3(0xf6c862) });
  // entrance (dark hole + little wooden landing board)
  items.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(x, y + 0.9, z + R * 0.9, 0, 0, 0, 0.95, 0.62, 0.4), color: C3(0x5a3418) });
  items.push({ geo: G.UNIT.box(), matrix: G.trs(x, y + 0.18, z + R + 0.2, 0, 0, 0, 1.9, 0.14, 0.8), color: C3(0xc98b55) });
  L.lv.addParts([{ key: 'deco', geo: G.mergeGeometries(items) }]);
}
// green vines + leaves hanging on a climbable face
function vines(L, x0, x1, yb, yt, z, nz = 1) {
  const items = [];
  const stem = G.cachedGeo('s3:vineStem', () => G.cylinderGeo(0.07, 0.07, 1, 6, 1, false));
  const leaf = G.UNIT.sphereLo();
  let k = 7;
  for (let x = x0 + 0.3; x <= x1 - 0.2; x += 0.62) {
    k = (k * 1103515245 + 12345) & 0x7fffffff;
    const top = yt + 0.1, bot = yb + 0.2 + (k % 3) * 0.3;
    const wob = ((k >> 3) % 7 - 3) * 0.03;
    items.push({ geo: stem, matrix: G.trs(x + wob, (top + bot) / 2, z + nz * 0.08, 0, 0, wob, 1, top - bot, 1), color: C3(0x4fae4a) });
    for (let y = bot + 0.25; y < top; y += 0.42) {
      k = (k * 1103515245 + 12345) & 0x7fffffff;
      const sd = k % 2 ? 1 : -1;
      items.push({ geo: leaf, matrix: G.trs(x + sd * 0.16, y, z + nz * 0.12, 0.3, sd * 0.6, sd * 0.5, 0.17, 0.09, 0.12), color: C3(k % 3 ? 0x6fd060 : 0x5ac258) });
    }
  }
  L.lv.addParts([{ key: 'deco', geo: G.mergeGeometries(items) }]);
}
// a flat sunflower head (petal ring + seed disc), facing +Y, radius r
let _sunGeo = null;
function sunflowerHead(r = 1.2) {
  if (!_sunGeo) {
    const petals = G.puffyShapeGeo(G.flowerOutline(14, 1.0, 0.7, 84), 0.08, 3);
    const disc = G.cylinderGeo(0.56, 0.6, 0.12, 28, 1, true);
    const dots = [];
    for (let i = 0; i < 18; i++) { const a = i * 2.39996, rr = 0.48 * Math.sqrt((i + 0.5) / 18); dots.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(Math.cos(a) * rr, 0.07, Math.sin(a) * rr, 0, 0, 0, 0.06, 0.03, 0.06), color: C3(0x5a3418) }); }
    _sunGeo = G.mergeGeometries([
      { geo: petals, matrix: G.trs(0, 0.02, 0, -Math.PI / 2, 0, 0), color: C3(0xffd23a) },
      { geo: disc, matrix: G.trs(0, 0.06, 0), color: C3(0x8a5226) },
      ...dots,
    ]);
  }
  const m = new Mesh(_sunGeo, new Material({ vertexColors: true, spec: 0.12, rim: 0.3, satField: true }));
  m.scale.set(r, r, r);
  return m;
}

// a giant sunflower you can stand on: flat flower head (collider) on a tall green stem
function flowerPad(L, x, top, z, r = 1.15, stemH = 7) {
  L.col({ type: 'cyl', x, y: top - 0.2, z, hx: r * 0.92, hy: 0.2, tag: 'flowerPad' });
  const head = sunflowerHead(r);
  head.position.set(x, top - 0.13, z);
  L.lv.root.add(head);
  const items = [
    { geo: G.cylinderGeo(0.16, 0.24, 1, 8, 1, false), matrix: G.trs(x, top - 0.1 - stemH / 2, z, 0, 0, 0, 1, stemH, 1), color: C3(0x5cbf5e) },
    { geo: G.UNIT.sphereLo(), matrix: G.trs(x + 0.55, top - 2.2, z, 0, 0, -0.6, 0.6, 0.12, 0.3), color: C3(0x6fd060) },
    { geo: G.UNIT.sphereLo(), matrix: G.trs(x - 0.5, top - 3.6, z, 0, 0, 0.6, 0.55, 0.12, 0.28), color: C3(0x6fd060) },
  ];
  L.lv.addParts([{ key: 'deco', geo: G.mergeGeometries(items) }]);
}

// ============================================================================
export default {
  build(L, stage) {
    const lv = L.lv;
    const pf = (i, text) => ({ thanks: [{ who: '뭉실이', text, face: 'puffy' + i }] });

    // ------------------------------------------------------------ A. 해바라기 언덕 입구 (landing hill)
    L.island(0, 0, 0, 10, { clear: [[0, 6.5, 3], [0, 0.5, 2.6], [0, -6, 2.6], [-2.8, 3.2, 1.6], [2.8, 2.6, 1.4], [5.4, -4.6, 2.2], [-5, -3, 1.6]], density: 1.1, flowers: 0.45 });
    L.start(0, 0.3, 6.5, Math.PI);
    puffyNpc(L, -2.8, 0, 3.2, 2, [
      ['뭉실이', '안녕, 소미야! 여기는 해바라기가 가득한 꿀벌 언덕이야.', 'puffy2'],
      ['뭉실이', '하늘에 먹구름이 잔뜩 끼더니... 꿀벌들도 해바라기도 시무룩해졌어.', 'puffy2'],
      ['뭉실이', '언덕 아래 꿀벌집 동굴을 지나가야 한대. 새 동물 친구들이 꼭 필요할 거야!', 'puffy2'],
    ], { yaw: 0.5 });
    L.sign(2.8, 0, 2.6, () => ['동물 친구마다 특별한 힘이 있어요!', ctl('특기 버튼을 눌러서 새 친구의 힘을 써 봐요.', '특기 키(L 또는 C)를 눌러서 새 친구의 힘을 써 봐요.')], { icon: '!', yaw: -0.3 });
    L.prop('flowerArch', 0, 0, -6.4, { seed: 2 });
    for (const [x, z, s] of [[6.6, -3.0, 1.0], [7.4, -5.6, 0.9], [-7.4, 1.4, 1.1]]) L.prop('beehive', x, 0, z, { seed: Math.round(x + z), s });
    for (const [x, z] of [[-7.6, 4.4], [-6.8, -2.4], [7.6, 2.4], [6.2, 5.6], [-3.6, 7.6], [3.8, 7.4]]) L.prop('sunflower', x, 0, z, { seed: Math.round(x * 3 + z), s: 1.1, yaw: Math.atan2(-x, -z) });
    L.prop('honeyPot', 4.4, 0, -6.4, { seed: 1 });
    L.prop('honeyPot', 4.0, 0, -7.2, { seed: 3, s: 0.8 });
    L.puffy(0, 5.4, 0, -4.6, pf(0, '고마워! 꿀벌들이 회색 안개에 놀라서 나를 꽁꽁 가둬 버렸어...'));
    L.candyLine([0, 0.9, 4.6], [0, 0.9, 0.2], 5);
    L.candyRing(0, 0.9, -3.0, 1.6, 8);
    L.candyLine([-6.0, 0.9, 0.5], [-6.0, 0.9, -4.5], 4);
    L.candyArc([1.6, 0.9, -1.4], [3.8, 0.9, -3.2], 3, 0.8);
    L.candyLine([0, 0.9, -7.6], [0, 0.9, -9.0], 2);
    L.enemy('flyer', -3.0, 0, -5.0, { flyH: 1.6, range: 2.0 });
    L.enemy('gloomy', 3.0, 0, -7.2, { range: 1.6, hard: true });
    L.bridge([0, 0, -9.7], [0, 1, -15.4], 2.6, { color: 0xf4c46a, color2: 0xe6b058 });
    L.candyLine([0, 1.1, -10.6], [0, 1.8, -14.6], 4);

    // ------------------------------------------------------------ B. 꿀벌 정원 (quokka cookie, smile, 윙윙이)
    L.island(0, 1, -24.5, 9.5, { clear: [[0, -16, 2.2], [0, -20, 2.4], [0, -25, 2.4], [0, -33, 2.4], [-3, -17.6, 1.4], [2.6, -20.6, 1.4], [-2, -28.8, 3.2], [5.8, -27.6, 1.8], [-6.2, -22, 1.4]], density: 1.0, flowers: 0.55 });
    L.checkpoint(-3.0, 1, -17.6, { yaw: Math.PI });
    L.cookie('quokka', 0, 2.0, -20.0);
    L.candyRing(0, 1.9, -20.0, 1.3, 6);
    L.sign(2.6, 1, -20.6, () => ['쿼카는 세상에서 제일 잘 웃는 친구!', ctl('특기 버튼을 누르면 방긋~ 활짝 웃어요. 주변 먹구름이들이 착해지고 하트도 1개 회복돼요!', '특기 키(L 또는 C)를 누르면 방긋~ 활짝 웃어요. 주변 먹구름이들이 착해지고 하트도 1개 회복돼요!')], { icon: '!', yaw: -0.3 });
    // a crowd of grumpy clouds to smile at
    L.enemy('gloomy', -3.4, 1, -27.6, { range: 1.6 });
    L.enemy('gloomy', -0.6, 1, -29.8, { range: 1.6 });
    L.enemy('hopper', -2.4, 1, -30.6, { range: 1.4 });
    L.enemy('shield', 1.2, 1, -27.4, { range: 1.4, yaw: 0 });
    L.enemy('flyer', 3.2, 1, -31.2, { flyH: 2.0, range: 2.0, hard: true });
    L.prop('beehive', -7.8, 1, -24.6, { seed: 4 });
    L.prop('beehive', 7.6, 1, -20.6, { seed: 7, s: 1.1 });
    for (const [x, z] of [[-8.0, -19.6], [8.2, -25.6], [-6.4, -30.8], [6.6, -31.0], [-8.6, -27.6]]) L.prop('sunflower', x, 1, z, { seed: Math.round(x - z), s: 1.15, yaw: Math.atan2(-x, -24.5 - z) });
    L.prop('sunflower', 6.6, 1, -27.6, { seed: 9, s: 1.5, yaw: -1.6 });
    // 윙윙이 — the hungry hummingbird by the big sunflower
    L.petEvent('hummingbird', 5.4, 3.0, -27.0, {
      kind: 'feed', need: 20,
      lines: ['윙윙~ 나는 벌새 윙윙이야. 꽃꿀이 다 회색이 돼서 배가 너무 고파...', '반짝반짝 별사탕을 조금만 나눠 주면 힘이 날 것 같아!'],
      thanks: '냠냠! 고마워~ 이제 기운이 펄펄 나! 내가 근처의 별사탕을 쏙쏙 끌어다 줄게!',
    });
    L.candyLine([0, 1.9, -22.4], [0, 1.9, -33.0], 7);
    L.candyArc([-4.2, 1.9, -19.4], [-6.2, 1.9, -22.0], 4, 1.0);
    L.candyLine([-4.8, 1.9, -25.0], [-4.8, 1.9, -31.0], 4);
    L.heart(-6.2, 2.2, -22.0);
    // side path: hop along giant sunflowers to a little island with a caged puffy (puffy 3)
    flowerPad(L, 12.0, 1.8, -23.0, 1.2, 7);
    flowerPad(L, 14.6, 2.6, -25.6, 1.15, 8);
    flowerPad(L, 17.4, 3.4, -23.4, 1.15, 9);
    L.island(20.6, 3.6, -26.2, 2.0, { big: 0, small: 1, grass: true, depth: 5 });
    L.puffy(3, 21.0, 3.6, -26.8, pf(3, '해바라기 징검다리를 건너왔구나! 높은 곳은 무서웠는데... 고마워!'));
    L.bigCandy(20.0, 4.5, -25.4);
    L.candyArc([9.2, 1.9, -23.0], [12.0, 2.7, -23.0], 3, 0.9);
    L.candyArc([12.0, 2.7, -23.0], [14.6, 3.5, -25.6], 3, 0.9);
    L.candyArc([14.6, 3.5, -25.6], [17.4, 4.3, -23.4], 3, 0.9);
    L.candyArc([17.4, 4.3, -23.4], [20.0, 4.5, -25.2], 3, 0.9);
    L.bridge([0, 1, -33.8], [0, 1, -38.9], 2.4, { color: 0xf4c46a, color2: 0xe6b058 });

    // ------------------------------------------------------------ C. 빙글빙글 해바라기 (rotating sunflower bars)
    L.island(0, 1, -42.2, 3.6, { big: 0, small: 1, clear: [[0, -42.2, 1.6], [2.2, -40.6, 1.0]] });
    L.candyRing(0, 1.9, -42.2, 1.4, 6);
    L.sign(2.2, 1, -40.6, () => ['빙글빙글 해바라기 다리예요!', '해바라기 잎이 이쪽을 향해 쭉 펴지면 폴짝 올라타요. 가운데는 안전해요!'], { icon: '!', yaw: -0.4 });
    const rotZ = [-50.2, -57.8, -65.4];
    lv.rotators = rotZ.map((z, i) => {
      const rot = L.rotator('leaf', 0, 1.3, z, 2.4, 7.0, 0.5, { speed: i % 2 ? -0.55 : 0.55 });
      rot.node.add(sunflowerHead(1.15));
      L.candyRing(0, 2.2, z, 0.7, 5);
      return rot;
    });
    L.island(0, 1.3, -73.8, 3.4, { big: 0, small: 1, clear: [[0, -73.8, 2]] });
    L.bigCandy(1.4, 2.3, -74.4); // a sweet reward for crossing the spinning sunflowers
    L.island(6.4, 1.3, -57.8, 1.9, { big: 0, small: 0, grass: true });
    L.puffy(1, 6.6, 1.3, -57.8, pf(1, '빙글빙글 돌다가 어지러웠어... 해바라기를 타고 와 줘서 고마워!'));
    L.candyArc([2.0, 2.0, -57.8], [5.0, 2.2, -57.8], 3, 0.8);
    L.enemy('flyer', -2.6, 1.3, -61.6, { flyH: 2.2, range: 1.4, hard: true });
    // tall sunflowers framing the crossing (background)
    for (const [x, z, s] of [[-7, -48, 2.4], [7.5, -51, 2.0], [-8, -63, 2.2], [8.5, -66, 2.6], [-6.5, -70, 1.8]]) {
      L.island(x, -1 + (s - 2) * 2, z, 1.2, { big: 0, small: 0, grass: false, depth: 4 });
      L.prop('sunflower', x, -1 + (s - 2) * 2, z, { seed: Math.round(x * z), s, yaw: Math.atan2(-x, 0) });
    }

    // ------------------------------------------------------------ D. 곰돌이 쿠키 & 금 간 바닥 (bear cookie, honey plaza)
    L.ramp([0, 1.3, -77.0], [0, 4, -82.6], 3.0);
    L.candyLine([0, 2.2, -77.6], [0, 4.8, -82.0], 4);
    L.island(0, 4, -90.6, 9, { clear: [[0, -83, 2.4], [0, -88.6, 2.4], [0, -95, 2.4], [-3, -85, 1.4], [2.6, -90.4, 1.4], [-4.6, -94.6, 1.6]], density: 1.0, flowers: 0.5 });
    L.checkpoint(-3.0, 4, -85.0, { yaw: Math.PI });
    L.cookie('bear', 0, 5.0, -88.6);
    L.candyRing(0, 4.9, -88.6, 1.3, 6);
    L.candyArc([-2.6, 4.9, -92.0], [2.6, 4.9, -96.0], 5, 1.0);
    L.sign(2.6, 4, -90.4, () => ['곰돌이는 힘세고 무거운 친구!', ctl('특기 버튼을 누르면 펄쩍 뛰었다가 쿵! 금이 간 바닥을 와장창 부숴요.', '특기 키(L 또는 C)를 누르면 펄쩍 뛰었다가 쿵! 금이 간 바닥을 와장창 부숴요.')], { icon: '!', yaw: -0.3 });
    L.enemy('hopper', 3.4, 4, -94.6, { range: 1.6 });
    L.enemy('gloomy', -4.6, 4, -91.0, { range: 2.0 });
    L.enemy('flyer', 4.6, 4, -86.0, { flyH: 2.2, range: 2.0 });
    L.enemy('spiky', -5.4, 4, -88.0, { range: 1.4 });
    L.enemy('gloomy', 4.6, 4, -97.4, { range: 1.2 });
    for (const [x, z] of [[-7.6, -86], [7.6, -88], [-6.8, -96.4], [6.4, -96.8]]) L.prop('sunflower', x, 4, z, { seed: Math.round(x - z), s: 1.2, yaw: Math.atan2(-x, -90.6 - z) });
    // honey plaza in front of the hive mound: four slabs around a cracked floor
    const PL = { thick: 1.0, under: false, top: 'top:candy', pal: WAX };
    L.slab(0, 4, -100.6, 9.6, 2.4, PL);
    L.slab(0, 4, -105.1, 9.6, 1.8, PL);
    L.slab(-3.0, 4, -103.0, 3.6, 2.4, PL);
    L.slab(3.0, 4, -103.0, 3.6, 2.4, PL);
    L.crackedFloor(0, 4, -103.0, { w: 2.4, d: 2.4 });
    L.sign(-2.6, 4, -101.0, () => ['바닥에 금이 쩍쩍 가 있어요. 아래에서 윙윙 소리가 나요!', '무거운 곰돌이로 쿵! 하고 부숴 볼까요?'], { icon: '?', yaw: 0.3 });
    for (const [x, z] of [[-4.2, -105.4], [4.2, -105.4]]) L.prop('honeyPot', x, 4, z, { seed: Math.round(x), s: 1.1 });

    // ------------------------------------------------------------ hive mound (encloses the tunnel E + shaft F)
    // tunnel interior: x -2.4..2.4, floor y -4, ceiling y 3, z -100 .. -137; walls 4 m thick (x ±2.4..6.4)
    // the west wall has a little honeycomb nook (x -4.8..-2.4, z -116.8..-114.2, y -4..-1.2) for puffy 2
    hive(L, -4.4, 12, -110.1, 4, 20, 7.8, { cap: 0.2 });     // west wall, north of the nook
    hive(L, -4.4, 12, -128.9, 4, 20, 24.2, { cap: 0.2 });    // west wall, south of the nook
    hive(L, -5.6, 12, -115.5, 1.6, 20, 2.6, { cap: 0 });     // behind the nook
    hive(L, -3.6, 12, -115.5, 2.4, 13.2, 2.6, { cap: 0 });   // over the nook (bottom y -1.2)
    hive(L, -3.6, -4.6, -115.5, 2.4, 3.4, 2.6, { cap: 0 });  // under the nook floor
    hive(L, 4.4, 12, -123.5, 4, 20, 35, { cap: 0.2 });       // east wall
    hive(L, 0, 12, -118.5, 4.8, 9, 25);                      // roof over the tunnel (z -106 .. -131), bottom y 3
    hive(L, 0, 12, -140, 4.8, 5, 2.0);                       // lintel over the south doorway (y 7..12, z -139..-141)
    hive(L, -3.6, 3.0, -103, 2.4, 11, 6, { cap: 0 });        // under-plaza side walls (x 2.4..4.8)
    hive(L, 3.6, 3.0, -103, 2.4, 11, 6, { cap: 0 });
    hive(L, 0, 3.0, -99.6, 4.8, 11, 0.8, { cap: 0 });        // tunnel north end wall
    L.slab(0, -4, -118.5, 4.9, 37, { thick: 0.8, under: false, top: 'top:candy', pal: WAX });
    // hive mound decoration: grassy top, honeycomb faces, honey drips, the giant straw beehive
    L.slab(0, 12.3, -123.5, 13.4, 35.4, { thick: 0.5, under: false, round: 0.25 });
    hexPanel(L, 0, 8.0, -105.98, 0, 12.2, 7.4, { seed: 3, r: 0.5 });
    hexPanel(L, -6.42, 2.5, -123.5, -Math.PI / 2, 34.4, 18, { seed: 5, r: 0.55 });
    hexPanel(L, 6.42, 2.5, -123.5, Math.PI / 2, 34.4, 18, { seed: 7, r: 0.55 });
    hexPanel(L, -4.4, 4.5, -141.02, Math.PI, 3.8, 15, { seed: 9, r: 0.5 });
    hexPanel(L, 4.4, 4.5, -141.02, Math.PI, 3.8, 15, { seed: 10, r: 0.5 });
    hexPanel(L, 0, 9.5, -141.02, Math.PI, 4.6, 4.6, { seed: 12, r: 0.5 });
    honeyDrips(L, 'x', -6.4, 6.4, 12.05, -106, 0.07, 1);
    honeyDrips(L, 'z', -141, -106, 12.05, -6.4, -0.07, 2);
    honeyDrips(L, 'z', -141, -106, 12.05, 6.4, 0.07, 3);
    skep(L, 0, 12.3, -121.5, 4.9, 7.2);
    for (const [x, z, s] of [[-4.2, -109.5, 1.4], [4.4, -110.5, 1.2], [-4.6, -131, 1.3], [4.6, -134, 1.5], [-3.8, -137.8, 1.2], [3.6, -138.6, 1.1]]) L.prop('sunflower', x, 12.3, z, { seed: Math.round(x * z), s, yaw: Math.atan2(-x, 6) });
    for (const [x, z, s] of [[2.6, -108.4, 1.2], [-4.4, -127.6, 1.3], [4.8, -128.6, 1.1]]) L.prop('beehive', x, 12.3, z, { seed: Math.round(x * 7 - z), s });
    for (const [x, z] of [[-1.6, -108.2], [-5.2, -116], [5.2, -118.4], [-1.8, -134.6], [1.6, -131.6]]) L.prop('flowerBush', x, 12.3, z, { seed: Math.round(x * 3 - z) });

    // ------------------------------------------------------------ E. 꿀벌집 동굴 (hive tunnel with pollen lasers)
    L.checkpoint(-1.5, -4, -106.0, { yaw: Math.PI });
    L.camZone(0, -1, -118.5, 3.0, 4.5, 19, { yaw: 0, pitch: 0.36, dist: 7.6, height: 1.2, priority: 2 });
    hexPanel(L, -2.38, -1.0, -107.35, Math.PI / 2, 13.7, 6.2, { seed: 11, r: 0.36 });
    hexPanel(L, -2.38, -1.0, -126.65, Math.PI / 2, 19.7, 6.2, { seed: 14, r: 0.36 });
    hexPanel(L, -2.38, 0.6, -115.5, Math.PI / 2, 2.6, 3.4, { seed: 15, r: 0.36 });
    hexPanel(L, -4.78, -2.6, -115.5, Math.PI / 2, 2.6, 2.8, { seed: 16, r: 0.32 });   // nook back wall
    hexPanel(L, -3.6, -2.6, -114.22, Math.PI, 2.4, 2.8, { seed: 17, r: 0.32 });      // nook side walls
    hexPanel(L, -3.6, -2.6, -116.78, 0, 2.4, 2.8, { seed: 18, r: 0.32 });
    hexPanel(L, 2.38, -1.0, -118.5, -Math.PI / 2, 36, 6.2, { seed: 13, r: 0.36 });
    L.sign(1.4, -4, -107.6, () => ['꽃가루 레이저예요! 반짝반짝 깜빡일 때 조심해요.', '낮은 레이저는 폴짝 뛰어넘고, 높은 레이저 아래에서는 점프하지 말아요!'], { icon: '!', yaw: -0.2 });
    L.candyLine([0, -3.1, -101.6], [0, -3.1, -105.0], 3);
    for (const [x, z] of [[-1.7, -101.2], [1.8, -104.6]]) L.prop('honeyPot', x, -4, z, { seed: Math.round(z), s: 1.0 });
    // lasers across the tunnel (emitters on the west wall pointing +X)
    const LA = (z, h, o) => L.laser(-2.3, -4 + h, z, Math.PI / 2, { length: 4.6, ...o });
    LA(-110.0, 0.5, { on: 2.0, off: 1.7, phase: 0 });
    LA(-113.6, 0.5, { on: 2.0, off: 1.7, phase: 0.5 });
    LA(-117.4, 1.9, { on: 2.6, off: 1.2, phase: 0.2 });
    LA(-121.4, 0.5, { always: true, sweep: 0.55, sweepSpeed: 1.0 });
    LA(-125.0, 0.5, { on: 1.8, off: 1.8, phase: 0 });
    LA(-125.0, 1.9, { on: 1.8, off: 1.8, phase: 0.5 });
    L.candyLine([0, -3.1, -108.4], [0, -3.1, -126.4], 9);
    // honeycomb nook in the west wall (puffy 2), between the 2nd and 3rd laser
    L.slab(-3.6, -4, -115.5, 2.4, 2.6, { thick: 0.6, under: false, top: 'top:candy', pal: WAX });
    L.puffy(2, -3.5, -4, -115.5, pf(2, '레이저가 무서워서 꼼짝도 못 했어. 반짝이는 길을 뚫고 와 줬구나!'));
    L.candyRing(-3.5, -3.0, -115.5, 0.7, 4);
    L.enemy('shield', 1.0, -4, -119.4, { range: 1.0, yaw: 0 });
    L.enemy('spiky', -0.8, -4, -128.2, { range: 0.8, hard: true });
    // heavy timer switch -> gate (lintel above so nobody floats over)
    L.floorSwitch(1.4, -4, -126.6, 'hiveGate', { mode: 'timer', timer: 6, heavy: true });
    L.gate(0, -4, -129.2, 0, 'hiveGate', { w: 4.8, h: 3.0 });
    hive(L, 0, 3.0, -129.2, 4.8, 4.0, 0.7, { cap: 0 });
    L.sign(-1.4, -4, -126.2, () => ['꿀벌 문이 꼭 닫혀 있어요.', '무거운 친구가 노란 스위치를 꾹 밟으면 문이 잠깐 열려요. 째깍째깍, 서둘러요!'], { icon: '?', yaw: 0.25 });
    L.enemy('gloomy', 0.6, -4, -123.0, { range: 0.8, hard: true });

    // ------------------------------------------------------------ F. 코알라 쿠키 & 덩굴 벽 (koala + vine wall in the shaft)
    L.cookie('koala', 0, -3.0, -131.6);
    L.candyRing(0, -3.1, -131.6, 1.2, 6);
    L.sign(1.6, -4, -132.6, () => ['코알라는 나무를 잘 타는 친구!', ctl('코알라로 변신해서 덩굴 벽에 폴짝 붙은 다음, 조이스틱을 위로 밀면 쭉쭉 올라가요.', '코알라로 변신해서 덩굴 벽에 폴짝 붙은 다음, 위쪽 방향키를 누르면 쭉쭉 올라가요.')], { icon: '!', yaw: -0.3 });
    hive(L, 0, 4, -138, 4.8, 8, 2.0, { climbable: true, color: 0xcf9a5a, color2: 0xc08a4c, style: 'bark' });
    vines(L, -2.3, 2.3, -4, 4, -137);
    L.slab(0, 4, -140.3, 4.8, 2.6, { thick: 0.8, under: false });
    L.camZone(0, 1, -134.5, 3.0, 6, 3.0, { yaw: 0, pitch: 1.05, dist: 8.5, priority: 3 });
    L.candyLine([0, -2.0, -136.4], [0, 3.6, -136.4], 6);

    // ------------------------------------------------------------ G. 꽃 무대 (flower stage meadow)
    L.island(0, 4, -152, 11, { clear: [[0, -142, 2.4], [0, -147, 2.6], [0, -155, 4.6], [-3.2, -144.8, 1.4], [-2.4, -149.6, 1.2], [2.4, -149.6, 1.2], [0, -160.6, 1.4], [0, -163, 2.4], [-8.6, -153, 2.4], [6.4, -145.6, 1.4]], density: 1.1, flowers: 0.6 });
    L.checkpoint(-3.2, 4, -144.8, { yaw: Math.PI });
    // the round wooden stage + backdrop
    L.pillar(0, 4.35, -155.0, 3.8, 1.2, { style: 'wood', color: 0xd99a62, topColor: 0xf2c48a });
    L.prop('flowerArch', 0, 4.35, -158.2, { seed: 1, s: 1.25 });
    const BELLC = [0xff6a7a, 0x7ad86a, 0xffd23a, 0x6ab8ff];
    const bellX = [-2.7, -0.9, 0.9, 2.7];
    bellX.forEach((x, i) => L.lv.addParts([{ key: 'deco', geo: G.cylinderGeo(0.62, 0.66, 0.08, 24, 1, true).setColor(C3(BELLC[i])).applyMatrix(G.trs(x, 4.39, -154.0)) }]));
    // 랄라 — the canary sings a 4-note bell melody (colored pads: red, green, yellow, blue)
    // (the canary sits under the flower arch at the back; the bells stand in a row at the front of the stage)
    L.petEvent('canary', 0, 5.95, -157.4, {
      kind: 'bells', r: 2.3,
      bells: bellX.map((x) => [x, 4.35, -154.0]),
      order: [0, 2, 1, 3],
      lines: ['랄랄라~ 나는 카나리아 랄라야. 회색 안개 때문에 노래를 잊어버렸어...', '내가 종으로 노래를 들려줄게. 잘 듣고 똑같은 순서로 종을 쳐 줄래?', '힌트! 빨강 → 노랑 → 초록 → 파랑 순서로 울릴 거야. 잘 보고 똑같이 쳐 봐!'],
      thanks: '랄랄라~♪ 노래가 다시 생각났어! 고마워! 이제 내가 자장가를 불러서 먹구름이들을 재워 줄게.',
    });
    puffyNpc(L, -2.4, 4, -149.6, 4, [
      ['뭉실이', '랄라의 노래를 듣고 싶어서 기다리고 있어!', 'puffy4'],
      ['뭉실이', '무대에 올라가서 랄라한테 말을 걸어 봐. 종소리 순서를 잘 기억해야 해!', 'puffy4'],
    ], { yaw: 0.2 });
    puffyNpc(L, 2.4, 4, -149.6, 5, [
      ['뭉실이', '꽃밭 서쪽 큰 해바라기 뒤에서 반짝이는 걸 봤어...', 'puffy5'],
      ['뭉실이', '강아지 친구가 킁킁 냄새를 맡으면 숨은 걸 찾을 수 있을지도 몰라!', 'puffy5'],
    ], { yaw: -0.2 });
    L.puffy(4, 0, 4, -160.6, { hidden: true, ...pf(4, '무대 뒤에 숨어 있었는데 들켰네! 노래 연습하고 있었어~') });
    for (const [x, z, s] of [[-7.6, -146], [7.8, -150], [-9.2, -151.6, 2.2], [-9.0, -155.2, 2.0], [-8.2, -158.0, 1.8], [8.6, -157.6], [6.4, -161.4], [-5.8, -161.6]]) L.prop('sunflower', x, 4, z, { seed: Math.round(x * z), s: s ?? 1.25, yaw: Math.atan2(-x, -152 - z) });
    L.prop('beehive', 6.4, 4, -145.6, { seed: 5, s: 1.2 });
    L.candyLine([0, 4.9, -142.0], [0, 4.9, -150.0], 6);
    L.candyRing(0, 5.25, -155.0, 2.6, 10);
    // (enemies stay on the meadow's north side, away from the bell stage)
    L.enemy('hopper', 5.8, 4, -144.6, { range: 1.0 });
    L.enemy('spiky', -5.0, 4, -146.6, { range: 1.2 });
    L.enemy('gloomy', -6.4, 4, -144.6, { range: 1.0 });
    L.enemy('flyer', -7.0, 4, -147.4, { flyH: 2.6, range: 1.2, hard: true });
    L.enemy('shield', 3.4, 4, -145.4, { range: 1.0, hard: true });
    // secret: a ledge behind the giant sunflowers (red panda cookie, hidden)
    L.island(-15.0, 6.2, -155.0, 2.4, { big: 0, small: 1, grass: true });
    L.cookie('redpanda', -15.0, 7.2, -155.0, { hidden: true });
    L.bigCandy(-15.6, 7.4, -153.6);
    L.candyArc([-10.6, 5.0, -154.6], [-13.4, 7.0, -155.0], 4, 1.0);

    // ------------------------------------------------------------ H. 깜빡 꿀방울 길 (blink bubbles, spike traps, falling biscuits)
    L.sign(-1.6, 4, -161.8, () => ['깜빡깜빡 꿀방울 발판이에요! 반짝반짝 깜빡이면 곧 사라져요.', '그다음엔 쑥쑥 솟는 가시 길! 가시가 들어갔을 때 지나가요.'], { icon: '!', yaw: 0.2 });
    // a wave: each bubble pops up a moment after the one before it
    lv.blinks = [
      L.blink('bubble', 0, 4.5, -165.4, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0 }),
      L.blink('bubble', 0, 5.0, -169.2, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0.8 }),
      L.blink('bubble', 0, 5.5, -173.0, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0.6 }),
    ];
    L.candyLine([0, 5.3, -165.4], [0, 6.3, -173.0], 3);
    L.island(0, 6, -178.5, 3.2, { big: 0, small: 1, clear: [[0, -178.5, 2]] });
    L.heart(1.4, 7.2, -178.0);
    L.enemy('flyer', 2.4, 6, -169.0, { flyH: 1.6, range: 1.4, hard: true });
    L.slab(0, 6, -188.5, 2.6, 13.4, { thick: 0.7, depth: 4, top: 'top:candy' });
    [-184.4, -188.4, -192.4].forEach((z, i) => { for (const x of [-0.65, 0.65]) L.spikeTrap(x, 6, z, { period: 2.8, up: 0.42, phase: i * 0.33 }); });
    L.candyLine([0, 6.9, -182.4], [0, 6.9, -194.6], 6);
    for (const z of [-186.4, -190.4]) L.prop('flowerArch', 0, 6, z, { seed: 3, s: 0.95 });
    L.enemy('hopper', 0, 6, -178.5, { range: 1.2 });
    for (const z of [-197.6, -200.6, -203.6]) L.falling('biscuit', 0, 6, z, 2.4, 2.4, 0.5, { delay: 0.6 });
    L.candyLine([0, 6.9, -197.6], [0, 6.9, -203.6], 3);

    // ------------------------------------------------------------ I. 우르릉 번개구름 arena
    L.island(0, 6, -210.2, 5, { clear: [[0, -206, 2.2], [0, -210.2, 2.2], [0, -214.5, 2], [-2.8, -207.6, 1.3], [2.4, -213.6, 1.2]], density: 1.0, flowers: 0.6 });
    L.checkpoint(-2.8, 6, -207.6, { yaw: Math.PI });
    L.sign(2.4, 6, -213.6, () => ['하늘이 우르르 쾅쾅! 먹구름 친구가 화가 났나 봐요...', '번개 표시가 생기면 얼른 피하고, 지쳐서 내려오면 그때 톡톡!'], { icon: '!', yaw: -0.2 });
    L.enemy('hopper', 2.4, 6, -208.4, { range: 1.2 });
    L.heart(-1.6, 7.2, -212.8);
    L.heart(1.6, 7.2, -212.8);
    L.bridge([0, 6, -215.1], [0, 6, -223.6], 2.6, { color: 0xf4c46a, color2: 0xe6b058 });
    L.candyLine([0, 6.9, -216], [0, 6.9, -222.8], 5);
    const arena = L.arena(0, 6, -237.5, 14, { big: 0, small: 6 });
    stage.arena = arena;
    // the storm cloud floats high: a lower, wider camera keeps it in view during the fight
    L.camZone(0, 9, -237.5, 14.5, 6, 14.5, { yaw: 0, pitch: 0.2, dist: 12, height: 3.0, fov: 55, priority: 2 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.2;
      if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) > 0) continue;
      const rr = 13.0 + (i % 2) * 0.4;
      L.prop(i % 3 === 0 ? 'sunflower' : i % 3 === 1 ? 'clover' : 'tulip', Math.sin(a) * rr, 6, -237.5 + Math.cos(a) * rr, { seed: i, s: i % 3 === 0 ? 1.3 : 1.2, collide: false, yaw: a + Math.PI });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.52;
      if (Math.cos(a) > 0.86) continue; // keep the entrance from the bridge clear
      L.prop('flowerBush', Math.sin(a) * 12.3, 6, -237.5 + Math.cos(a) * 12.3, { seed: i + 20, s: 1.2, collide: false });
    }
    [[0.95, 18.5, 5.4, 3.0], [2.0, 19.0, 6.6, 3.4], [3.14, 18.8, 5.0, 3.0], [4.3, 19.2, 6.2, 3.2], [5.35, 18.4, 5.6, 3.0]].forEach(([a, d, y, r], i) => {
      const x = Math.sin(a) * d, z = -237.5 + Math.cos(a) * d;
      L.island(x, y, z, r, { big: 0, small: 1, grass: true, depth: 7, flowers: 0.7 });
      L.prop(['sunflower', 'beehive', 'sunflower', 'flowerArch', 'sunflower'][i], x, y, z, { seed: i + 2, s: i === 1 ? 1.6 : 2.0, yaw: a + Math.PI });
    });
    stage.bossCtl = new ThunderCloudBoss(stage, {
      pos: [0, 6, -241.5], yaw: 0, arena,
      introLines: [
        { who: '우르릉 번개구름', text: '우르릉 쾅쾅! 누가 내 언덕에 왔지?! 다 비에 젖어 버려라!', face: 'bossfog:thundercloud' },
        { who: SOMI, text: '먹구름님, 왜 그렇게 화가 났어요? 해바라기들이 해님을 못 봐서 슬퍼해요!', face: 'char:' + (Save.data ? Save.data.currentChar || 'cat' : 'cat') },
        { who: '우르릉 번개구름', text: '몰라 몰라! 그냥 마음이 우르릉거린단 말이야! 번개 맛 좀 봐라!', face: 'bossfog:thundercloud' },
      ],
      thanks: [
        ['boss', '우르릉... 아니, 이제 화 안 났어. 사실 왜 화가 났는지도 몰랐어. 그냥... 너무 쓸쓸했어.'],
        [SOMI, '쓸쓸했구나... 이제 우리 친구니까 괜찮아요!'],
        ['boss', '그 쓸쓸한 마음은 내 것이 아니었던 것 같아. 어디선가 흘러 들어온 슬픔이었어.'],
        ['boss', '고마워, 꼬마 친구. 꿈빛을 가져가렴. 언덕에 햇살이 다시 비칠 거야!'],
      ],
    });
    L.killY(-28);
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      // fly from the stormy arena back over the hills to the landing where Somi stands
      shots: [
        [[12, 24, -208], [0, 10, -238], 2.4, 50],
        [[-16, 20, -138], [0, 6, -156], 2.6, 52],
        [[16, 22, -84], [0, 6, -106], 2.6, 52],
        [[-14, 14, -36], [0, 2, -56], 2.4, 52],
        [[9, 9, 17], [0, 1, 0], 1.6, 52],
      ],
      lines: [
        ['뭉실이', '어서 와, 소미야! 여기는 해바라기 꿀벌 언덕이야.', 'puffy2'],
        ['뭉실이', '언덕 끝에 사는 번개구름이 회색 안개에 물들어서, 해님을 꽁꽁 가려 버렸어...', 'puffy2'],
        [SOMI, '해바라기들이 해님을 다시 볼 수 있게, 내가 꿈빛을 찾아올게!', 'me'],
      ],
      toast: '언덕 너머의 꿈빛을 찾아 출발~!',
    });
  },

  onCookie(id) {
    const hud = CTX.hud;
    if (!hud) return;
    if (id === 'quokka') hud.toast('쿼카로 변신해서 먹구름이들에게 방긋 웃어 봐요!', 'good', 3);
    if (id === 'bear') { hud.toast('곰돌이로 변신해서 금 간 바닥을 쿵! 부숴 봐요', 'good', 3); hud.pointAt(new Vec3(0, 4.5, -103), 5); }
    if (id === 'koala') { hud.toast('코알라로 변신해서 덩굴 벽을 타고 올라가요!', 'good', 3); hud.pointAt(new Vec3(0, 0, -137), 4); }
    if (id === 'redpanda') hud.toast('비밀 쿠키를 찾았어요! 레서판다 인형으로 먹구름이를 속여 봐요', 'good', 3.2);
  },
};
void TAU; void clamp; void PAL; void sfx; void Node;

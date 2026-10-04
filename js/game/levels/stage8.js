// ============================================================================
// stage8.js — 달빛 꿈의 정원 (Moonlight Dream Garden) — the finale.
// A moon gate · white-rose garden (unicorn cookie, hidden ghost path) ·
// crystal laser forest + moon lift · dragon cliff (thorn bower) · star-stone
// chasm (high cloud puffy) · phoenix shrine (light the torches) · memory lane
// under the fog ceiling (side view) · the bridge of voices · the Gray Fog.
// Noa's voice is heard along the way. Beating the fog reveals Noa → ending.
// ============================================================================
import { Vec3, RNG, TAU } from '../../engine/math.js';
import { Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { buildWhale } from '../models/npcs.js';
import { buildObject } from '../models/objects.js';
import { FogKingBoss } from '../bosses/fogking.js';
import { stageIntro, puffyNpc, ctl, SOMI } from './common.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };

const VOICE_CSS = `
.noa-voice { position: absolute; left: 50%; top: calc(env(safe-area-inset-top,0px) + var(--u)*27); transform: translateX(-50%); width: min(calc(var(--vw)*86), calc(var(--u)*120)); text-align: center;
  font-size: calc(var(--u)*3.2); color: #f4ecff; text-shadow: 0 0 calc(var(--u)*1.6) rgba(150,120,255,.9), 0 2px 0 rgba(50,30,90,.8); letter-spacing: .04em;
  opacity: 0; transition: opacity 1.2s; pointer-events: none; z-index: 6; word-break: keep-all; }
.noa-voice.on { opacity: 1; }
.noa-voice::before { content: '✦ '; color: #ffe9a8; }
`;
function ensureVoiceCss() { if (document.getElementById('noaVoiceCss')) return; const s = document.createElement('style'); s.id = 'noaVoiceCss'; s.textContent = VOICE_CSS; document.head.appendChild(s); }

// a band of dark fog clouds overhead: touching it hurts and pushes you down (stops flying over the gauntlet)
class FogCeiling {
  constructor(level, x, y, z, w, d) {
    this.x = x; this.y = y; this.z = z; this.w = w; this.d = d;
    const rng = new RNG(Math.round(Math.abs(z) * 7 + w));
    const items = [];
    for (let i = 0; i <= Math.ceil(d / 1.1); i++) {
      for (let j = -1; j <= 1; j++) {
        const px = x + j * (w / 2.4) + rng.range(-0.3, 0.3), pz = z - d / 2 + i * 1.1 + rng.range(-0.3, 0.3);
        const r = rng.range(0.75, 1.15);
        const shade = rng.range(0.85, 1.1);
        items.push({ geo: G.UNIT.sphereLo(), matrix: G.trs(px, y + r * 0.7 + rng.range(0, 0.4), pz, 0, 0, 0, r, r * 0.8, r), color: [0.36 * shade, 0.3 * shade, 0.5 * shade] });
      }
    }
    this.node = new Mesh(G.mergeGeometries(items, { withUV: false }), new Material({ color: 0xffffff, vertexColors: true, rim: 0.55, spec: 0.1, emissive: 0x140c26 }));
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    if (Math.random() < dt * 6) CTX.fx.fogPuff({ x: this.x + (Math.random() - 0.5) * this.w, y: this.y + 0.1, z: this.z + (Math.random() - 0.5) * this.d }, 1);
    const p = CTX.player;
    if (!p || p.dead) return;
    if (Math.abs(p.pos.x - this.x) < this.w / 2 + 0.3 && Math.abs(p.pos.z - this.z) < this.d / 2 && p.pos.y + 1.0 > this.y && p.pos.y < this.y + 2.5) {
      p.hurt(1, { x: p.pos.x, y: this.y + 1, z: p.pos.z }, { knock: 1.5, up: 0, hazard: true });
      p.vel.y = Math.min(p.vel.y, -6);
      if (p.state === 'hover') p.setState('normal');
      if (!this._hinted) { this._hinted = true; CTX.hud.toast('어두운 안개 구름에 닿으면 아야! 아래로 지나가요', 'warn', 2.6); }
    }
  }
}

export default {
  build(L, stage) {
    ensureVoiceCss();
    const lv = L.lv;
    // Noa's voice — gentle captions at the top of the screen
    stage.clearNoaVoice = () => { for (const o of document.querySelectorAll('.noa-voice')) o.remove(); };
    stage.noaVoice = (text, dur = 4.5) => {
      stage.clearNoaVoice(); // one line at a time
      const el = document.createElement('div');
      el.className = 'noa-voice stage-fx';
      el.textContent = text;
      document.getElementById('ui').appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));
      sfx('cry', { vol: 0.3, pitch: 1.25 });
      setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 1300); }, dur * 1000);
    };
    const voice = (x, y, z, hx, hz, text) => L.trigger(x, y + 1.5, z, hx, 3, hz, () => stage.noaVoice(text));

    // ------------------------------------------------------------ A. the moon gate
    L.island(0, 0, 0, 10, { clear: [[0, 6, 3], [0, -6, 3], [5, -5, 1.6], [-3, 3, 1.5], [2.6, 2.6, 1.2]], density: 1.0 });
    L.start(0, 0.3, 7, Math.PI);
    L.prop('archway', 0, 0, -5.4, { s: 1.25, collide: false });
    L.prop('starLamp', -2.6, 0, -4.6, { seed: 2 });
    L.prop('starLamp', 2.6, 0, -4.6, { seed: 4 });
    puffyNpc(L, -3, 0, 3, 4, [
      '여기는 달빛 꿈의 정원... 꿈나라의 모든 회색 안개가 시작된 곳이야.',
      '정원 가장 깊은 곳에서 누군가 아주 오랫동안 울고 있대. 우리도 무서워서 가까이 못 갔어...',
      ['소미', '내가 갈게. 그 아이를 꼭 만나야 해!', 'me'],
    ], { yaw: 0.6 });
    L.sign(2.6, 0, 2.6, () => ['지금까지 만난 모든 친구들의 힘을 모아요!', ctl('막히면 오른쪽 위 버튼으로 다른 동물 친구로 바꿔 봐요.', '막히면 1번(또는 Tab) 키로 다른 동물 친구로 바꿔 봐요.')], { icon: 'star', yaw: 0 });
    L.puffy(0, 5, null, -5, { thanks: [{ who: '뭉실이', text: '고마워! 달빛 정원까지 와 준 친구는 네가 처음이야!', face: 'puffy0' }] });
    L.candyRing(0, 0.9, -1.5, 2.6, 10);
    L.candyLine([0, 0.9, 5], [0, 0.9, 1.5], 4);
    L.candyArc([-4.5, 0.9, 2], [-6.5, 0.9, -3], 5, 1.2);
    L.candyArc([4.5, 0.9, 2], [6.5, 0.9, -1], 4, 1.2);
    L.enemy('gloomy', -3.5, 0, -5.5, { range: 2 });
    voice(0, 0, -8, 4, 1.2, '...누구... 거기 누구 있어...?');
    L.bridge([0, 0, -9.6], [0, 0, -15.6], 2.4);
    L.candyLine([0, 0.9, -10.4], [0, 0.9, -15], 5);

    // ------------------------------------------------------------ B. white-rose garden + hidden ghost path
    L.island(0, 0, -24, 8.5, { clear: [[0, -16, 2], [0, -32, 2.4], [0, -19.5, 1.4], [2.4, -22, 1.2], [-3, -28, 1.2]], density: 1.2, flowers: 0.6 });
    for (const [x, z] of [[-5, -20], [4.6, -26.5], [-5.4, -27], [5.2, -19.8], [-2, -30.2], [3, -30.4]]) L.prop('whiteRose', x, 0, z, { s: 1.6, seed: Math.round(x * 5 - z) });
    L.cookie('unicorn', 0, 0.9, -19.5);
    L.sign(2.4, 0, -22, () => ['유니콘은 가까이 있는 숨은 발판을 반짝반짝 보여줘요!', ctl('특기 버튼으로 무지개 다리도 만들 수 있어요.', '특기(L/C) 버튼으로 무지개 다리도 만들 수 있어요.')], { icon: 'star', yaw: 0 });
    L.checkpoint(-3, 0, -28, { yaw: Math.PI });
    L.enemy('ghost', 3, 0, -25, { range: 2.5, flyH: 1.6 });
    L.enemy('gloomy', -3, 0, -23.5, { range: 2 });
    L.enemy('hopper', -4.4, 0, -20.6, { range: 1.5 });
    L.candyRing(0, 0.9, -25, 4.2, 12);
    L.enemy('spiky', 2, 0, -29, { range: 1.5, hard: true });
    // ghost platforms (revealed by unicorn / firefly / foxfire)
    L.ghost(0, 0.6, -35.6, 2.6, 2.6, { style: 'moon' });
    L.ghost(0, 1.4, -39.6, 2.6, 2.6, { style: 'moon' });
    L.ghost(0, 2.0, -43.4, 2.6, 2.6, { style: 'moon' });
    L.candyArc([0, 1.4, -34], [0, 2.2, -39.6], 4, 1.0);
    L.candyArc([0, 2.2, -40], [0, 3.2, -45.4], 4, 1.0);
    L.sign(-1.6, 0, -31.4, () => ['길이 끊겼어요...? 유니콘으로 가까이 가 보면 숨은 발판이 보일지도!'], { icon: '?', yaw: 0 });

    // ------------------------------------------------------------ C. crystal laser forest + moon lift
    L.island(0, 2.5, -52, 7, { clear: [[0, -45.5, 2], [0, -58.5, 2], [5, -55.6, 1.3], [-5.6, -50, 1.4], [5.8, -49.2, 1.2]], density: 0.8 });
    for (const [x, z, s] of [[-4.6, -47, 1.1], [4.4, -47.4, 0.9], [-4.8, -56.4, 1.0], [3.6, -57.2, 1.2]]) L.prop('crystalTree', x, 2.5, z, { s, seed: Math.round(x - z) });
    L.laser(-6.2, 3.25, -48.6, Math.PI / 2, { length: 12.4, on: 1.6, off: 1.6 });
    L.laser(6.2, 3.25, -52.2, -Math.PI / 2, { length: 12.4, on: 1.6, off: 1.6, phase: 0.5 });
    L.laser(-6.2, 3.25, -55.8, Math.PI / 2, { length: 12.4, on: 1.6, off: 1.6, phase: 0.25 });
    L.sign(-1.8, 2.5, -45.4, () => ['반짝 레이저 숲이에요. 빛이 꺼졌을 때 지나가거나, 폴짝 뛰어넘어요!'], { icon: '!', yaw: 0 });
    L.puffy(1, 5, null, -55.6, { thanks: [{ who: '뭉실이', text: '레이저 사이에 갇혀 있었어... 고마워!', face: 'puffy1' }] });
    L.enemy('shooter', -5.6, null, -50, { range: 0.3 });
    L.enemy('hopper', 2.5, null, -50.5, { range: 2 });
    L.candyLine([0, 3.4, -47], [0, 3.4, -57.5], 7);
    L.checkpoint(-3, 2.5, -47.2, { yaw: Math.PI });
    L.enemy('gloomy', 3, null, -48.4, { range: 1.6 });
    L.candyRing(-3.2, 3.3, -54, 1.2, 6);
    L.heart(5.8, 3.4, -49.2);
    L.mover('moon', 3, 3, 0.6, [[0, 2.5, -60.4], [0, 7.5, -63.6]], { speed: 1.8, wait: 1.3 });
    L.candyLine([0, 3.4, -60.4], [0, 8.4, -63.6], 5);

    // ------------------------------------------------------------ D. dragon cliff + thorn bower
    L.island(0, 7.5, -70, 5.5, { clear: [[0, -65, 1.6], [0, -68.5, 1.4], [3.2, -71.6, 2.4], [0, -75, 1.4]], density: 0.7 });
    L.cookie('dragon', 0, 8.4, -68.4);
    L.sign(-2.2, 7.5, -67.2, () => [ctl('드래곤은 공격 버튼으로 불을 뿜어요! 가시덩굴도 태울 수 있어요.', '드래곤은 공격 버튼으로 불을 뿜어요! 가시덩굴도 태울 수 있어요.'), ctl('하늘에서 특기 버튼을 누르면 펄럭펄럭 날 수 있어요!', '하늘에서 특기(L/C) 버튼을 누르면 펄럭펄럭 날 수 있어요!')], { icon: 'star', yaw: 0 });
    // the rose bower: stone walls, a roof and a thorn door (burn it!)
    const BW = { style: 'stone', color: 0xe8e2ff, color2: 0xd8d0f4 };
    L.block(1.85, 10.0, -71.6, 0.35, 2.5, 2.6, BW);
    L.block(4.55, 10.0, -71.6, 0.35, 2.5, 2.6, BW);
    L.block(3.2, 10.0, -72.75, 3.0, 2.5, 0.35, BW);
    L.block(3.2, 10.4, -71.65, 3.6, 0.4, 3.2, { style: 'candy', color: 0xd8c8ff, color2: 0xe8dcff, round: 0.15 });
    L.thorns(3.2, 7.5, -70.35, { w: 2.4, h: 2.5 });
    L.bigCandy(3.2, 8.4, -71.7);
    L.heart(2.6, 8.3, -72.1);
    L.enemy('spiky', -2.6, 7.5, -71.5, { range: 1.2, hard: true });
    L.enemy('hopper', -2.4, 7.5, -68.4, { range: 1.2 });
    L.checkpoint(-2.6, 7.5, -72.2, { yaw: Math.PI });
    L.candyRing(0, 8.4, -70, 3.6, 10);

    // ------------------------------------------------------------ E. star-stone chasm
    L.island(1.5, 7.0, -79.5, 1.8, { big: 0, small: 1 });
    L.island(-1.5, 7.4, -85.2, 1.8, { big: 0, small: 1 });
    L.island(1.2, 7.0, -91.0, 1.8, { big: 0, small: 1 });
    L.candyArc([0.6, 8.2, -75.6], [1.5, 7.9, -79.5], 4, 1.2);
    L.candyArc([1.5, 7.9, -80.5], [-1.5, 8.3, -85.2], 4, 1.4);
    L.candyArc([-1.5, 8.3, -86.2], [1.2, 7.9, -91], 4, 1.4);
    L.candyArc([1.2, 7.9, -92], [0.4, 6.9, -97.6], 5, 1.8);
    L.enemy('flyer', -1, 7.4, -82, { flyH: 1.6, range: 2.5 });
    L.enemy('flyer', 1, 7.4, -94, { flyH: 1.8, range: 2.5 });
    L.enemy('flyer', 0, 7.4, -88, { flyH: 2.4, range: 2, hard: true });
    // a puffy on a high cloud (dragon flight / moon jump)
    L.island(-1.5, 13.4, -85.6, 1.9, { big: 0, small: 0, grass: false, top: 'top:cloud' });
    L.puffy(2, -1.5, 13.4, -85.8, { thanks: [{ who: '뭉실이', text: '이렇게 높은 구름 위까지! 하늘을 나는 친구구나!', face: 'puffy2' }] });
    L.candyLine([-1.5, 9.4, -85.4], [-1.5, 12.6, -85.4], 4);

    // ------------------------------------------------------------ F. phoenix shrine
    L.island(0, 6, -104, 7, { clear: [[0, -97.4, 1.8], [0, -105, 4.4], [-4.5, -99.5, 1.2], [-5.4, -103.6, 1.2], [0, -110, 1.8]], density: 0.9 });
    const nest = buildObject('nest', {});
    nest.root.position.set(0, 6, -105);
    nest.root.scale.set(1.6, 1.6, 1.6);
    lv.add({ node: nest.root, update: (dt) => nest.update(dt) });
    L.petEvent('phoenix', 0, 7.2, -105, {
      kind: 'torches', torches: [[-3.2, 6, -102], [3.2, 6, -102], [-3.2, 6, -108], [3.2, 6, -108]],
      lines: ['나는 불사조 피닉스... 회색 안개 때문에 내 불꽃이 모두 꺼져 버렸어.', '주변의 횃불 네 개를 다시 밝혀 줄 수 있니? 불을 쓰는 친구(드래곤이나 여우)가 필요해.'],
      doneLines: ['따뜻해... 내 불꽃이 다시 타오르고 있어!'],
      thanks: '고마워, 소미! 내 불꽃 깃털을 줄게. 쓰러져도 한 번 더 일어날 수 있을 거야!',
    });
    L.checkpoint(-4.5, 6, -99.5, { yaw: Math.PI });
    L.puffy(4, -5.4, null, -103.6, { hidden: true, thanks: [{ who: '뭉실이', text: '깜깜해서 아무도 못 찾을 줄 알았어. 찾아 줘서 고마워!', face: 'puffy4' }] });
    voice(0, 6, -100, 5, 1.5, '...여기는 너무 춥고 어두워... 아무도... 안 와...');
    L.enemy('ghost', -4, null, -108, { range: 2, flyH: 1.8 });
    L.enemy('big', 0, null, -109.4, { range: 1.0 });
    L.candyRing(0, 6.9, -105, 4.6, 12);
    L.enemy('gloomy', 4.2, null, -100.4, { range: 1.5 });
    L.candyArc([0, 6.9, -97], [0, 6.9, -101], 4, 0.8);

    // ------------------------------------------------------------ G. memory lane under the fog ceiling (side view)
    L.slab(0, 6, -121, 3.2, 18, { thick: 0.6, depth: 3, taper: 0.5 });
    lv.add(new FogCeiling(lv, 0, 9.7, -121, 3.6, 17.2));
    L.crusher(0, -115.4, 9.4, 6, { wait: 1.7, downWait: 0.9 });
    L.saw([[0, 6.95, -119.6], [0, 8.9, -119.6]], { r: 0.75, speed: 2.2, yaw: Math.PI / 2 });
    L.crusher(0, -123.8, 9.4, 6, { wait: 1.7, downWait: 0.9, phase: 0.5 });
    for (const x of [-0.9, 0.9]) L.spikeTrap(x, 6, -127.4, { period: 2.4, up: 0.45 });
    L.candyLine([0, 6.9, -113], [0, 6.9, -129.5], 9);
    L.blink('moon', 0, 6.1, -132.6, 2.4, 2.4, 0.5, { on: 2.4, off: 1.4, phase: 0 });
    L.blink('moon', 0, 6.4, -136.4, 2.4, 2.4, 0.5, { on: 2.4, off: 1.4, phase: 0.4 });
    L.candyLine([0, 7.0, -132.6], [0, 7.3, -136.4], 2);
    // a ledge below the gap holds a puffy (drop down, float back up)
    L.block(0, 3.6, -134.5, 2.4, 0.6, 2.4, { style: 'crystal', color: 0xe0d8ff });
    L.puffy(3, 0, 3.6, -134.5, { thanks: [{ who: '뭉실이', text: '아래쪽까지 살펴 주다니! 너는 정말 꼼꼼하구나!', face: 'puffy3' }] });
    L.slab(0, 6.5, -144.5, 3.2, 10, { thick: 0.6, depth: 3, taper: 0.5 });
    L.saw([[0, 7.45, -141.2], [0, 7.45, -146.6]], { r: 0.75, speed: 2.6, yaw: Math.PI / 2 });
    L.laser(-2.2, 7.25, -148.4, Math.PI / 2, { length: 4.4, on: 1.4, off: 1.5 });
    L.candyLine([0, 7.4, -140], [0, 7.4, -149], 5);
    L.camZone(0, 8, -133, 9, 8, 21.5, { yaw: Math.PI / 2, pitch: 0.28, dist: 12, lockYaw: true, priority: 2 });
    L.sign(-1.8, 6, -111.6, () => ['기억의 길이에요. 위쪽의 어두운 안개 구름은 피해요!', '쿵쿵 돌덩이가 올라갔을 때 재빨리 지나가요.'], { icon: '!', yaw: 0 });
    L.heart(0, 7.0, -110.8);

    // ------------------------------------------------------------ H. the bridge of voices
    L.island(0, 6.5, -157.5, 6, { clear: [[0, -150.5, 2], [0, -163, 2], [-2.5, -160, 1.2], [2.6, -154, 1.2]], density: 0.8 });
    L.checkpoint(-2.5, 6.5, -160, { yaw: Math.PI });
    L.heart(2.6, 7.4, -154);
    L.sign(2.6, 6.5, -160.6, () => ['마지막 꿈빛이 이 다리 너머에 있어요.', '소미, 힘내! 꿈나라의 모든 친구들이 응원하고 있어요!'], { icon: 'star', yaw: 0 });
    puffyNpc(L, -3.4, 6.5, -155, 1, ['우리 모두 여기서 응원할게! 무서우면 하트를 확인하고, 천천히 해도 괜찮아!'], { yaw: 0.5 });
    L.enemy('shield', 2, null, -158, { range: 1.5 });
    L.enemy('hopper', 3, null, -156.4, { range: 1.2 });
    L.candyRing(0, 7.4, -157.5, 3.8, 10);
    L.enemy('charger', -2, null, -156, { range: 1.5, hard: true });
    L.bridge([0, 6.5, -163.4], [0, 6.5, -176.6], 2.8);
    L.candyLine([0, 7.4, -164.5], [0, 7.4, -175.5], 8);
    voice(0, 6.5, -170, 2, 3, '...가까이 오지 마... 나는 회색빛이야... 아무도 나를 좋아하지 않아...');

    // ------------------------------------------------------------ I. the Gray Fog's stage
    const arena = L.arena(0, 6.5, -191, 15, { big: 10, small: 8, curtainColor: 0xb0a0e0 });
    stage.arena = arena;
    L.camZone(0, 10, -191, 16, 12, 16, { dist: 12.5, pitch: 0.36, fov: 54, height: 1.4, priority: 3 });
    // the Star Whale, trapped in fog high above
    const whale = buildWhale();
    whale.setFogged(1);
    whale.root.position.set(-4, 24, -206);
    whale.root.rotation.y = Math.PI * 0.4;
    whale.root.scale.set(1.2, 1.2, 1.2);
    lv.root.add(whale.root);
    stage.whale = whale;
    // (level entities only update during play; the finale cutscene animates the whale itself)
    lv.add({ update(dt) {
      this.t = (this.t || 0) + dt;
      whale.update(dt, { anim: 'sleep', t: this.t, lod: 3 });
      whale.root.position.y = 24 + Math.sin(this.t * 0.4) * 0.6;
      if (Math.random() < dt * 3) CTX.fx.fogPuff({ x: whale.root.position.x + (Math.random() - 0.5) * 8, y: whale.root.position.y + (Math.random() - 0.5) * 3, z: whale.root.position.z + (Math.random() - 0.5) * 4 }, 2);
    } });
    stage.bossCtl = new FogKingBoss(stage, {
      pos: [0, 6.5, -198], yaw: 0, arena,
      introLines: [
        { who: '회색 안개', text: '...오지 마... 아무도... 오지 마...', face: 'bossfog:fogking' },
        { who: SOMI, text: '너였구나... 계속 울고 있던 목소리. 이제 혼자 울지 않아도 돼!', face: 'char:' + (CTX.save && CTX.save.data ? CTX.save.data.currentChar || 'cat' : 'cat') },
        { who: '회색 안개', text: '거짓말... 다들 나를 몰라줬어... 이 안개 속에서 영원히 혼자 있을 거야...!', face: 'bossfog:fogking' },
      ],
    });
    L.killY(-22);
    void TAU; void Vec3;
  },

  async onStart(L, stage) {
    await stageIntro(stage, {
      shots: [
        [[20, 15, 18], [0, 3, -8], 3.2, 48],
        [[14, 20, -150], [0, 11, -196], 3.6, 50],
        [[-6, 12, -205], [0, 20, -205], 2.2, 50],
      ],
      lines: [
        ['뭉실이', '드디어 달빛 정원이야! 저 멀리 커다란 회색 안개가 보이지? 별고래님도 저 안개 속에 갇혀 있어...', 'puffy4'],
        [SOMI, '별고래야... 그리고 울고 있는 그 아이도. 내가 꼭 구해 줄게!', 'me'],
      ],
      toast: '정원 가장 깊은 곳으로 가 봐요!',
    });
  },
};

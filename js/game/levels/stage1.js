// ============================================================================
// stage1.js — 꽃구름 들판 (Flower Cloud Meadow) — the tutorial stage.
// Sections: A landing meadow (move/jump/attack, first Puffy) · B bee bubble +
// lantern · C stepping islands & first hover · D rabbit cookie ledge, moving
// cloud · E crystal-switch gate, crate & switch hut (dog cookie) · F flower
// saw path (side view gauntlet, sheep cookie) · G butterfly garden (pollen
// hunt, spring to the high cloud) · H King Mushroom arena.
// ============================================================================
import { Vec3, Ease, TAU } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { buildWhale } from '../models/npcs.js';
import { MushKingBoss } from '../bosses/mushking.js';
import { Save } from '../save.js';

const T = () => !!(CTX.game && CTX.game.touchMode);
const SOMI = '소미';

export default {
  build(L, stage) {
    const lv = L.lv;
    // ------------------------------------------------------------ A. landing meadow
    L.island(0, 0, 0, 10, { clear: [[0, 6, 3], [0, -6, 3], [5, -6, 2], [-4, -3, 2.4], [2.5, 3.5, 1.5]], density: 1.1 });
    L.start(0, 0.3, 6.5, Math.PI);
    L.sign(2.6, 0, 3.4, () => [T()
      ? '왼쪽 아래 조이스틱으로 걸어요. 오른쪽 아래 큰 버튼을 누르면 점프!'
      : '방향키(또는 WASD)로 걸어요. 스페이스(또는 K)를 누르면 점프!', '점프 버튼을 길게 누르면 더 높이 뛰어요.'], { icon: '!', yaw: 0 });
    L.block(-4, 1.0, -3, 3, 1.0, 3, { style: 'stone', color: 0xf0e4ff });
    L.candyRing(-4, 1.6, -3, 0.9, 6);
    L.candyRing(0, 0.9, -1, 2.4, 8);
    L.candyLine([0, 0.9, 4], [0, 0.9, 0.5], 4);
    L.candyArc([-6, 0.9, 3], [-7, 0.9, -4], 5, 1.0);
    L.candyArc([6.5, 0.9, 3], [7.5, 0.9, -2], 4, 1.0);
    L.puffy(0, 5, null, -6, { thanks: [{ who: '뭉실이', text: '고마워! 회색 안개 방울에 갇혀서 무서웠어... 다른 뭉실이들도 꼭 구해 줘!', face: 'puffy0' }] });
    L.sign(3.2, 0, -3.2, () => [T()
      ? '뭉실이가 안개 방울에 갇혀 있어요! 오른쪽의 공격 버튼으로 방울을 톡톡 깨 주세요.'
      : '뭉실이가 안개 방울에 갇혀 있어요! J(또는 X) 키로 공격해서 방울을 깨 주세요.'], { icon: '!', yaw: 0.35 });
    L.bridge([0, 0, -9.6], [0, 0, -16.4], 2.4);
    L.candyLine([0, 0.9, -10.5], [0, 0.9, -15.5], 5);
    // ------------------------------------------------------------ B. bee bubble, first enemies, lantern
    L.island(0, 0, -24, 8, { clear: [[0, -17, 2], [0, -31, 2], [-3, -28, 1.5], [5.5, -25, 1.5]], density: 1.0 });
    L.sign(-1.8, 0, -17.6, () => ['회색 먹구름이는 안개에 물든 친구들이에요.', T() ? '공격 버튼으로 톡! 치면 원래대로 착해져요. 위에서 밟아도 돼요!' : 'J(또는 X)로 공격하면 원래대로 착해져요. 위에서 밟아도 돼요!'], { icon: '!', yaw: 0 });
    L.enemy('gloomy', -2.5, 0, -23, { range: 2.5 });
    L.enemy('gloomy', 2.5, 0, -27, { range: 2.5 });
    L.enemy('gloomy', 0, 0, -29, { range: 2, hard: true });
    L.petEvent('bee', 5.6, 1.5, -25, { kind: 'bubble', hits: 3, thanks: '붕붕~ 고마워! 나는 꿀벌 붕붕이야. 내가 꿀로 하트를 채워 줄게!' });
    L.checkpoint(-3, 0, -28.5, { yaw: Math.PI });
    L.candyArc([-1, 1, -20], [-3, 1, -26], 6, 1.5);
    L.heart(4, 1.2, -19);
    L.candyRing(0, 0.9, -24, 5.2, 14);
    L.sign(1.8, 0, -30.5, () => ['멀리 뛰고 싶을 땐? 점프한 다음 공중에서 점프를 또 눌러요!', '둥실둥실~ 몇 번 더 날아오를 수 있어요. 공격을 누르면 후~ 하고 바람을 뱉어요.'], { icon: '?', yaw: 0 });
    // ------------------------------------------------------------ C. stepping islands & first hover gap
    L.island(0.5, 0.8, -35.5, 2.2, { big: 0, small: 1, grass: true });
    L.island(-1.5, 1.8, -40.6, 2.0, { big: 0, small: 1 });
    L.island(1.5, 2.8, -45.6, 2.0, { big: 0, small: 1 });
    L.candyArc([0.3, 1.6, -33], [0.5, 1.6, -35.5], 3, 0.8);
    L.candyArc([0.5, 1.6, -36.5], [-1.5, 2.6, -40.5], 4, 1.4);
    L.candyArc([-1.5, 2.6, -41.5], [1.5, 3.6, -45.5], 4, 1.4);
    L.candyArc([1.5, 3.6, -47], [0, 2.8, -53], 6, 2.2);
    L.enemy('flyer', 0, 2.5, -50, { range: 2, flyH: 2.0, hard: true });
    // ------------------------------------------------------------ D. rabbit ledge island + moving cloud
    L.island(0, 2, -59, 7, { clear: [[0, -53, 2], [0, -65, 2], [-4, -62, 2.2], [4.3, -63.3, 1.2], [3.4, -61.6, 1.0]], density: 1.0 });
    L.enemy('hopper', 2.5, 2, -58, { range: 2.5 });
    L.enemy('hopper', -2, 2, -56, { range: 2 });
    L.block(-4, 5.6, -62, 3, 3.6, 3, { style: 'stone', color: 0xf4eaff, color2: 0xe6dcf6 });
    L.cookie('rabbit', -4, 6.5, -62);
    L.candyLine([-1.6, 3.2, -60.5], [-2.6, 5.2, -61.5], 3);
    L.candyRing(0, 2.9, -58, 3.4, 10);
    L.sign(-1.2, 2, -57.2, () => ['저 높은 곳에 반짝이는 게 있어요!', '점프 → 공중에서 점프 버튼을 여러 번! 둥실둥실 올라가 봐요.'], { icon: 'arrow', yaw: 0.2 });
    L.puffy(1, 4.3, null, -63.4, { thanks: [{ who: '뭉실이', text: '나무 뒤에 숨어 있었는데 찾아 줬구나! 고마워!', face: 'puffy1' }] });
    L.prop('lollipopTree', 3.2, 2, -61.4, { seed: 7, color: 0xffa8c8, s: 1.2 });
    L.mover('cloud', 3.2, 3.2, 0.6, [[0, 2.0, -67.4], [0, 3.0, -76.3]], { speed: 2.2, wait: 1.2 });
    L.candyLine([0, 2.9, -68], [0, 3.9, -75.5], 6);
    // ------------------------------------------------------------ E. switch gate + crate hut
    L.island(0, 3, -84, 8, { clear: [[0, -77, 2], [0, -91.5, 2.2], [5, -86, 2.4], [-4.5, -82.2, 2.8], [0.5, -78.6, 2.4], [2.4, -79.8, 1.2], [-2.2, -80, 1]], density: 0.9 });
    L.checkpoint(2.4, 3, -79.8, { yaw: Math.PI });
    // crystal switch on a stone step opens the gate on the exit bridge
    L.block(5, 4.6, -86, 3, 1.6, 3, { style: 'stone', color: 0xf0e4ff });
    L.crystal(5, 4.6, -86, 'gateE', { mode: 'once' });
    L.sign(2.2, 3, -87.6, () => ['길이 막혀 있어요. 근처의 수정 스위치를 공격하면 문이 열릴지도 몰라요!'], { icon: '?', yaw: 0 });
    L.bridge([0, 3, -91.6], [0, 3, -99.4], 2.4);
    L.gate(0, 3, -92.4, 0, 'gateE', { w: 3.2, h: 2.6 });
    L.enemy('shooter', -5.5, 3, -88.5, { range: 0.5 });
    L.enemy('gloomy', 2, 3, -84, { range: 3 });
    L.enemy('hopper', -2.5, 3, -87, { range: 1.6, hard: true });
    L.candyRing(1, 3.9, -86, 2.4, 8);
    // the little hut: push the crate onto the switch to open its door
    const HUT = { style: 'wood', color: 0xffd6a8, color2: 0xf2c494 };
    L.block(-6.1, 5.6, -82.2, 0.4, 2.6, 3.2, HUT);
    L.block(-2.9, 5.6, -82.2, 0.4, 2.6, 3.2, HUT);
    L.block(-4.5, 5.6, -83.8, 3.6, 2.6, 0.4, HUT);
    L.block(-4.5, 6.05, -82.3, 4.4, 0.45, 4.2, { style: 'candy', color: 0xff8fb8, color2: 0xffa6c8, round: 0.2 });
    L.gate(-4.5, 3, -80.55, 0, 'hutE', { w: 2.9, h: 2.45 });
    L.cookie('dog', -4.5, 3.8, -82.4);
    L.floorSwitch(-1.0, 3, -78.6, 'hutE', { mode: 'once', crate: true });
    L.crate(2.0, 3, -78.6);
    L.sign(-2.2, 3, -80.0, () => ['문이 잠긴 작은 집이에요. 스위치를 계속 누르고 있으면 열릴 텐데...', '옆에 있는 상자를 밀어서 스위치 위에 올려 볼까요?'], { icon: '?', yaw: 0.3 });
    L.candyRing(-4.5, 3.8, -82.4, 0.8, 5);
    // ------------------------------------------------------------ F. flower saw path (side view)
    L.slab(0, 3, -102.5, 6, 6, { deco: true });
    L.slab(0, 3, -114.5, 3, 18, { thick: 0.6, depth: 3, taper: 0.5 });
    L.saw([[0, 3.95, -107.6], [0, 6.5, -107.6]], { r: 0.75, speed: 2.3, yaw: Math.PI / 2 });
    for (const x of [-1, 0, 1]) L.spikeTrap(x, 3, -110.8, { period: 2.6, up: 0.4 });
    L.saw([[0, 3.95, -113.2], [0, 3.95, -117.6]], { r: 0.75, speed: 2.4, yaw: Math.PI / 2 });
    L.block(0, 7.0, -115.4, 2.2, 0.5, 2.2, { style: 'candy', color: 0xffd6ea, color2: 0xffe8f2 });
    L.puffy(2, 0, 7.0, -115.4, { thanks: [{ who: '뭉실이', text: '톱니 위의 높은 곳까지 와 줬어? 정말 용감하다!', face: 'puffy2' }] });
    L.saw([[0, 3.95, -120.8], [0, 6.5, -120.8]], { r: 0.75, speed: 2.3, yaw: Math.PI / 2, phase: 0.5 });
    L.candyLine([0, 3.9, -104.5], [0, 3.9, -106.5], 2);
    L.candyLine([0, 3.9, -109], [0, 3.9, -112.2], 3);
    L.candyArc([0, 3.9, -118.6], [0, 3.9, -122.6], 3, 1.2);
    L.enemy('gloomy', 0, 3, -122.6, { range: 0.4, hard: true });
    // bubble platforms over the gap
    L.blink('bubble', 0, 3.2, -126.6, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0 });
    L.blink('bubble', 0, 3.7, -130.4, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0.33 });
    L.blink('bubble', 0, 4.2, -134.2, 2.4, 2.4, 0.5, { on: 2.6, off: 1.4, phase: 0.66 });
    L.candyLine([0, 4.0, -126.6], [0, 5.0, -134.2], 3);
    L.slab(0, 4, -141, 7, 7, { deco: true });
    L.cookie('sheep', 0, 4.9, -140.2);
    L.checkpoint(-2.4, 4, -142.6, { yaw: Math.PI });
    L.camZone(0, 5, -120, 9, 7, 19.5, { yaw: Math.PI / 2, pitch: 0.3, dist: 11.5, lockYaw: true, priority: 2 });
    L.sign(-2, 3, -100.2, () => ['꽃잎 톱니 길이에요! 톱니와 가시는 아야~ 해요.', '움직이는 리듬을 잘 보고, 지나갈 틈이 생기면 출발!'], { icon: '!', yaw: 0 });
    // ------------------------------------------------------------ G. butterfly garden
    L.bridge([0, 4, -144.4], [0, 4, -149.4], 2.4);
    L.island(0, 4, -158, 9, { clear: [[0, -150, 2], [0, -167, 2.5], [-3, -155, 1.5], [0, -164, 1.5], [5.5, -162.5, 2], [6.6, -158, 1.2], [2.4, -165.6, 1.2]], density: 1.3, flowers: 0.55 });
    for (const [x, z, k] of [[-5, -153, 'bigFlower'], [3, -150.6, 'flowerBush'], [-7.2, -158, 'bigFlower'], [6.8, -153.6, 'bigFlower'], [-2.6, -163, 'tulip'], [2.2, -160.5, 'daisy'], [-0.6, -152.2, 'tulip']]) L.prop(k, x, 4, z, { seed: Math.round(x * 3 + z), s: k === 'bigFlower' ? 1.1 : 1.3 });
    L.petEvent('butterfly', -3, 5.0, -155, {
      kind: 'collect', itemKind: 'pollen',
      items: [[4, 4.8, -152], [-6.2, 4.8, -162], [5.5, 6.6, -162.5], [-9, 6.4, -150], [0, 9.6, -166.5]],
      lines: ['흑흑... 나는 나비 나풀이야. 안개 바람에 꽃가루를 모두 날려 버렸어.', '반짝이는 꽃가루 다섯 개를 찾아 줄 수 있니? 높은 곳에도 있을 거야!'],
      thanks: '꽃가루가 다 모였어! 고마워~ 이제 내 날개로 둥실둥실 더 오래 날게 도와줄게!',
    });
    L.block(5.5, 5.8, -162.5, 2.4, 1.8, 2.4, { style: 'stone', color: 0xfff0f6 });
    L.island(-9, 5.5, -150, 2.2, { big: 0, small: 1 });
    L.spring(0, 4, -164, { power: 17, style: 'mushroom' });
    L.island(0, 9.0, -171, 2.6, { big: 0, small: 2 });
    L.puffy(3, 0, 9.0, -171.4, { thanks: [{ who: '뭉실이', text: '이렇게 높은 곳까지! 버섯 스프링은 정말 신나지?', face: 'puffy3' }] });
    L.candyLine([0, 6, -164], [0, 9.5, -164], 4);
    L.puffy(4, 6.6, 4, -158.4, { hidden: true, thanks: [{ who: '뭉실이', text: '나를 찾아냈구나! 숨바꼭질 대장이네!', face: 'puffy4' }] });
    L.enemy('hopper', 3, 4, -160, { range: 2 });
    L.enemy('gloomy', -3, 4, -161, { range: 2.5 });
    L.enemy('flyer', 4, 4, -154, { flyH: 2.4, range: 2.5 });
    L.heart(-7, 5, -158);
    L.candyRing(0, 4.9, -158, 6.0, 16);
    L.candyArc([0, 4.9, -150], [3, 4.9, -153], 4, 0.8);
    L.bigCandy(-9, 6.4, -149);
    L.checkpoint(2.4, 4, -165.6, { yaw: Math.PI });
    // ------------------------------------------------------------ H. King Mushroom arena
    L.bridge([0, 4, -166.8], [0, 4, -179.2], 2.6);
    L.candyLine([0, 4.9, -168], [0, 4.9, -178], 6);
    const arena = L.arena(0, 4, -192, 13, { big: 9, small: 6 });
    stage.arena = arena;
    stage.bossCtl = new MushKingBoss(stage, {
      pos: [0, 4, -195], yaw: 0, arena,
      introLines: [
        { who: '킹 버섯돌이', text: '누구냐버섯! 내 들판에 함부로 들어오다니!', face: 'bossfog:mushking' },
        { who: SOMI, text: '버섯 임금님! 회색 안개 때문에 화가 난 거죠? 제가 도와 드릴게요!', face: 'char:' + (Save.data ? Save.data.currentChar || 'cat' : 'cat') },
        { who: '킹 버섯돌이', text: '시끄럽다버섯! 쿵쿵 밟아 주마!', face: 'bossfog:mushking' },
      ],
      thanks: [
        ['boss', '으... 으응? 머리가 맑아졌다버섯!'],
        ['boss', '회색 안개가 머릿속을 꽉 채워서, 아무것도 보이지 않았어. 미안해, 꼬마 친구.'],
        [SOMI, '이제 괜찮아요? 다행이다!'],
        ['boss', '고맙다버섯! 그런데... 안개 속에서 누군가 우는 소리를 들었어. 아주 작고, 아주 슬픈 목소리였어.'],
        ['boss', '저기 꿈빛을 가져가렴. 들판에 색깔이 돌아올 거야!'],
      ],
    });
    L.sign(-2.2, 4, -167.4, () => ['이 다리 너머에서 쿵쿵 소리가 나요...', '무서울 땐 하트를 확인하고, 착한 마음으로 힘내요!'], { icon: '!', yaw: 0 });
    L.killY(-26);
    void lv; void TAU; void Vec3;
  },

  async onStart(L, stage) {
    const first = !!stage.opts.intro || (Save.data && !Save.flag('seen:stage1intro'));
    if (first) await intro(stage);
    CTX.hud.banner('스테이지 1', '꽃구름 들판', 2.8);
    if (first) setTimeout(() => CTX.hud.toast('꿈빛을 찾아 들판 끝까지 가 봐요!', 'good', 3), 1600);
  },
};

// ------------------------------------------------------------------ intro: the whale drops Somi off and is swallowed by the fog
async function intro(stage) {
  const p = stage.player;
  const lv = stage.level;
  const whale = buildWhale();
  whale.setFogged(0);
  lv.root.add(whale.root);
  const charId = p.charId;
  await stage.runCutscene(async (dir) => {
    dir.letterbox(true);
    dir.actor(whale, 'swim');
    const W0 = new Vec3(-26, 14, 26), W1 = new Vec3(0, 4.6, 1.5);
    whale.root.position.copy(W0);
    whale.root.rotation.y = Math.atan2(W1.x - W0.x, W1.z - W0.z);
    p.lockAnim = 'sit';
    const ride = () => { p.pos.set(whale.root.position.x, whale.root.position.y + 1.6, whale.root.position.z); p.yaw = whale.root.rotation.y; };
    ride();
    dir.shot([9, 5.5, 13], [0, 3, 0], 50);
    dir.camTo([7.5, 4.2, 10.5], [0, 3.2, 0], 5.5);
    await dir.tween(5.2, (k) => {
      const e = Ease.outCubic(k);
      whale.root.position.set(W0.x + (W1.x - W0.x) * e, W0.y + (W1.y - W0.y) * e + Math.sin(k * Math.PI) * 2, W0.z + (W1.z - W0.z) * e);
      whale.root.rotation.y = Math.atan2(W1.x - W0.x, W1.z - W0.z) + (Math.PI - Math.atan2(W1.x - W0.x, W1.z - W0.z)) * Ease.inOutSine(Math.max(0, k - 0.6) / 0.4);
      ride();
      if (Math.random() < 0.4) CTX.fx.rainbowTrail(new Vec3(whale.root.position.x, whale.root.position.y, whale.root.position.z));
    }, Ease.linear);
    dir.anim(whale, 'idle');
    await dir.say([[ '별고래', '자, 다 왔어. 여기가 꿈나라의 첫 번째 섬, 꽃구름 들판이란다.', 'whale']]);
    // the cat hops down
    p.lockAnim = 'jump';
    const a = p.pos.clone(), b = new Vec3(0, 0, 4.2);
    if (CTX.audio) CTX.audio.sfx('jump');
    await dir.tween(0.8, (k) => { p.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * 1.6, a.z + (b.z - a.z) * k); p.yaw = Math.PI; }, Ease.linear);
    p.lockAnim = null;
    p.pos.copy(b); p.yaw = 0;
    CTX.fx.landing(p.pos, 0.8);
    if (CTX.audio) CTX.audio.sfx('land');
    dir.camTo([4.5, 2.6, 9.5], [0, 2.4, 2.2], 1.6);
    await dir.wait(0.5);
    p.lockAnim = 'surprised';
    await dir.say([
      [SOMI, '우와... 그런데 꽃도, 나무도, 하늘도... 다 회색이야.', 'char:' + charId],
      ['별고래', '회색 안개가 색깔을 빼앗아 갔기 때문이란다. 들판 끝 어딘가에 숨겨진 「꿈빛」을 되찾으면 색깔이 돌아올 거야.', 'whale'],
      ['별고래', '가는 길에 「꿈 등불」을 켜면, 그 주변부터 조금씩 색이 살아난단다.', 'whale'],
    ]);
    p.lockAnim = 'wave';
    await dir.say([[SOMI, '알았어! 꿈빛을 찾으러 출발~!', 'char:' + charId]]);
    // the fog strikes
    p.lockAnim = 'surprised';
    if (CTX.audio) { CTX.audio.stopMusic(0.5); CTX.audio.sfx('wind', { pitch: 0.6 }); CTX.audio.sfx('heartbeat'); }
    const wc = whale.root.position.clone();
    dir.camTo([6.5, 3.4, 11], [0, 4.4, 1.5], 1.2);
    let fogK = 0;
    const puff = (n) => { for (let i = 0; i < n; i++) { const ang = Math.random() * TAU; const r = 2 + Math.random() * 4; CTX.fx.fogPuff({ x: wc.x + Math.sin(ang) * r, y: wc.y + (Math.random() - 0.3) * 3, z: wc.z + Math.cos(ang) * r }, 3); } };
    await dir.tween(2.2, (k) => { fogK = k; puff(2); whale.setFogged(k * 0.6); }, Ease.linear);
    dir.anim(whale, 'sleep');
    await dir.say([['별고래', '앗...! 안개가...! 소미야... 꿈빛을... 모으면... 다시... 만날 수 있... 을 거야...', 'whale']]);
    await dir.tween(2.4, (k) => {
      puff(3);
      whale.setFogged(0.6 + k * 0.4);
      whale.setOpacity(1 - k);
      whale.root.position.set(wc.x, wc.y + k * 6, wc.z - k * 8);
    }, Ease.inQuad);
    whale.root.visible = false;
    void fogK;
    await dir.wait(0.6);
    dir.camTo([3.2, 1.8, 8.2], [0, 1.0, 4.2], 1.2);
    await dir.say([[SOMI, '별고래야!!', 'char:' + charId]]);
    p.lockAnim = 'sad';
    await dir.wait(1.0);
    p.lockAnim = 'celebrate';
    if (CTX.audio) CTX.audio.playMusic(stage.musicId, { restart: true });
    await dir.say([[SOMI, '...기다려, 별고래야. 내가 꼭 꿈빛을 모아서 구해 줄게!', 'char:' + charId]]);
    p.lockAnim = null;
    dir.letterbox(false);
    whale.root.removeFromParent();
  });
  p.place(new Vec3(0, 0.2, 4.2), Math.PI);
  p.setCheckpoint(new Vec3(0, 0.2, 4.2), Math.PI);
  CTX.cam.snap(p);
  if (Save.data) { Save.flag('seen:stage1intro', true); Save.write(); }
}

// ============================================================================
// sequences.js — the story: opening (bedroom → Dreamland), stage clear
// (color return + results), Noa's memories, the ending and credits.
// ============================================================================
import { Vec3, Ease, TAU, rgb, lerp, clamp } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { CutsceneMode, Director } from './cutscene.js';
import { buildRoom, buildMemorySet, buildSkyFlight } from './sets.js';
import { buildAnimal } from '../models/animals.js';
import { STAGES } from '../data/stages.js';
import { CHARACTERS, COOKIE_STAGE } from '../data/characters.js';
import { PETS, PET_STAGE } from '../data/pets.js';
import { Save } from '../save.js';
import { h, Screen } from '../ui/ui.js';
import { ICON } from '../ui/icons.js';
import { charPortrait, petPortrait } from '../ui/portraits.js';
import { PAL } from '../fx.js';

const audio = () => CTX.audio;
const music = (id, o) => { if (CTX.audio) CTX.audio.playMusic(id, o); };
const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const jingle = (n) => { if (CTX.audio) CTX.audio.jingle(n); };

const SEQ_CSS = `
.results { pointer-events: auto; padding: calc(var(--u)*3) calc(var(--u)*5.5); display: flex; flex-direction: column; align-items: center; gap: calc(var(--u)*1.4); min-width: min(88vw, calc(var(--u)*74)); }
.results .rt { font-size: calc(var(--u)*5.2); color: var(--pink-d); text-align: center; }
.results .rs { font-size: calc(var(--u)*2.6); color: var(--ink-soft); }
.results .rows { display: grid; grid-template-columns: auto auto; gap: calc(var(--u)*1.1) calc(var(--u)*5); font-size: calc(var(--u)*3.0); color: var(--ink); margin: calc(var(--u)*1) 0; }
.results .rows .k { display: flex; align-items: center; gap: calc(var(--u)*1.2); }
.results .rows svg { width: calc(var(--u)*3.8); height: calc(var(--u)*3.8); }
.results .rows .v { text-align: right; font-variant-numeric: tabular-nums; }
.results .rows .v.full { color: var(--pink-d); }
.results .stamp { font-size: calc(var(--u)*2.6); color: #fff; background: linear-gradient(90deg, var(--pink), var(--lilac)); padding: calc(var(--u)*0.6) calc(var(--u)*2.4); border-radius: 999px; }
.results .row-in { opacity: 0; transform: translateY(calc(var(--u)*1)); transition: opacity .35s, transform .35s; }
.results .row-in.on { opacity: 1; transform: none; }
.memhead { position: absolute; top: calc(env(safe-area-inset-top,0px) + var(--u)*9.5); left: 0; right: 0; text-align: center; color: #ffe9a8; font-size: calc(var(--u)*2.6); letter-spacing: .12em; text-shadow: 0 0 calc(var(--u)*1.5) rgba(255,220,120,.6); opacity: 0; transition: opacity 1s; pointer-events: none; }
.memhead.on { opacity: 1; }
.credits { position: absolute; inset: 0; overflow: hidden; pointer-events: auto; background: linear-gradient(180deg, rgba(10,8,34,.25), rgba(10,8,34,.55)); }
.credits .roll { position: absolute; left: 0; right: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: calc(var(--u)*2.2); color: #fff; text-align: center; will-change: transform; padding: 0 calc(var(--u)*4); }
.credits h2 { font-size: calc(var(--u)*4.4); margin: calc(var(--u)*5) 0 calc(var(--u)*0.6); color: #ffe9a8; text-shadow: 0 0 calc(var(--u)*2) rgba(255,200,120,.55); font-weight: normal; }
.credits h3 { font-size: calc(var(--u)*3.0); margin: calc(var(--u)*1.5) 0 0; color: #ffc6e4; font-weight: normal; }
.credits p { font-size: calc(var(--u)*2.8); margin: 0; line-height: 1.6; text-shadow: 0 2px 0 rgba(40,20,70,.6); word-break: keep-all; }
.credits .grid { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(var(--u)*1.4); max-width: min(92vw, calc(var(--u)*150)); }
.credits .cell { display: flex; flex-direction: column; align-items: center; width: calc(var(--u)*13); font-size: calc(var(--u)*2.1); gap: calc(var(--u)*0.4); }
.credits .cell img { width: calc(var(--u)*11); height: calc(var(--u)*11); border-radius: 50%; background: rgba(255,255,255,.14); box-shadow: 0 0 0 calc(var(--u)*0.35) rgba(255,255,255,.55); }
.credits .big { font-size: calc(var(--u)*6.4); color: #fff; text-shadow: 0 0 calc(var(--u)*3) rgba(255,190,230,.8), 0 3px 0 rgba(120,60,160,.7); margin-top: calc(var(--u)*6); }
.credits .sign { font-size: calc(var(--u)*4); color: #ffe9a8; }
.credits .end { font-size: calc(var(--u)*8); margin: calc(var(--u)*10) 0 calc(var(--u)*4); color: #fff; text-shadow: 0 0 calc(var(--u)*3) rgba(255,220,160,.9); }
.credits .hint { position: absolute; right: calc(env(safe-area-inset-right,0px) + var(--u)*2.4); bottom: calc(env(safe-area-inset-bottom,0px) + var(--u)*2.4); font-size: calc(var(--u)*2.2); color: rgba(255,255,255,.7); }
`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = SEQ_CSS; document.head.appendChild(s); }

const SOMI = '소미';
const WHALE = '별고래';
const NOA = '노아';
const curChar = () => (Save.data && Save.data.currentChar && Save.hasChar(Save.data.currentChar) ? Save.data.currentChar : 'cat');

// ============================================================================
// OPENING — Somi's bedroom at night; the Star Whale asks for help.
// ============================================================================
export function playOpening(game) {
  ensureCss();
  return game.setMode(new CutsceneMode(() => buildRoom({ morning: false }), openingScript, {
    id: 'opening',
    onDone: () => goStage1(),
  }));
}
async function goStage1() {
  const { StageMode } = await import('../modes/stage.js');
  CTX.game.transition(() => CTX.game.setMode(new StageMode(1, { intro: true })), 0.9);
}

async function openingScript(dir, S) {
  const { somi, whale } = S;
  const fl = document.getElementById('flash');
  fl.style.transition = 'none'; fl.style.background = '#0b0820'; fl.style.opacity = '1';
  music('opening', { fade: 0.5, restart: true });
  dir.letterbox(true);
  dir.actor(somi, 'idle');
  dir.actor(whale, 'swim');
  whale.setFogged(0);
  // 1) the night sky through Somi's window, then pull back to reveal her room
  dir.shot([0.85, 2.05, -3.05], [3.0, 7.0, -40], 50);
  dir.camTo([0.85, 2.0, -2.95], [3.4, 8.0, -40], 7.5, Ease.inOutSine);
  await dir.fade('#0b0820', 0, 2.0);
  await dir.caption('아주 깊은 밤, 하늘에 별이 가득한 날이었어요.', 3.6);
  dir.camTo([2.3, 2.15, 2.3], [0.2, 1.35, -2.6], 6.5, Ease.inOutCubic, 52);
  await dir.caption('별을 사랑하는 아이, 소미는 오늘도 창가에서 밤하늘을 보고 있었어요.', 4.2);
  await dir.wait(1.2);
  somi.root.rotation.y = Math.PI;
  dir.anim(somi, 'wave');
  await dir.say([[SOMI, '별님들, 안녕! 오늘도 반짝반짝 예쁘다~', 'somi']]);
  dir.anim(somi, 'idle');
  // 3) something swims toward the window
  dir.camTo([1.9, 1.55, 0.6], [0.9, 2.2, -10], 1.6, Ease.inOutSine);
  const w0 = new Vec3(-34, 9, -36), w1 = new Vec3(1.1, 2.0, -12.5);
  whale.root.position.copy(w0);
  dir.tween(6.5, (k) => {
    whale.root.position.set(lerp(w0.x, w1.x, k), lerp(w0.y, w1.y, k) + Math.sin(k * Math.PI) * 3, lerp(w0.z, w1.z, k));
    whale.root.rotation.y = lerp(Math.PI * 0.55, Math.PI * 0.08, Ease.inOutSine(k));
  }, Ease.outCubic);
  await dir.wait(1.6);
  await dir.say([[SOMI, '어? 저기... 뭔가 반짝반짝 헤엄쳐 와!', 'somi']]);
  await dir.wait(2.4);
  dir.anim(somi, 'surprised');
  sfx('chime');
  await dir.say([[SOMI, '우와... 고래?! 하늘을 헤엄치는 고래야!', 'somi']]);
  dir.anim(whale, 'happy');
  dir.camTo([1.5, 1.5, 0.2], [1.0, 2.1, -10], 1.4);
  await dir.say([
    [WHALE, '안녕, 소미야. 나는 꿈나라를 지키는 별고래란다.', 'whale'],
    [WHALE, '지금 꿈나라에 큰일이 났어. 슬픈 회색 안개가 나타나서 꿈나라의 색깔을 하나씩 삼키고 있단다.', 'whale'],
  ]);
  dir.anim(whale, 'idle');
  // reaction shot of Somi
  dir.shot([0.5, 1.45, -0.6], [0.8, 1.15, -2.6], 44);
  somi.root.rotation.y = Math.PI * 0.82;
  dir.anim(somi, 'sad');
  await dir.say([[SOMI, '색깔이 없어지면... 꿈나라 친구들은 어떻게 돼?', 'somi']]);
  dir.camTo([1.9, 1.7, 0.4], [1.0, 2.2, -8], 1.2);
  const choice = await dir.say([
    [WHALE, '뭉실이들도, 동물 친구들도 모두 기운을 잃고 슬퍼질 거야. 그래서 별처럼 반짝이는 마음을 가진 아이를 찾고 있었단다.', 'whale'],
    { who: WHALE, text: '소미야... 꿈나라를 도와줄 수 있겠니?', face: 'whale', choices: ['응! 내가 도와줄게!', '조금 무섭지만... 해 볼게!'] },
  ]);
  dir.anim(somi, 'celebrate');
  dir.anim(whale, 'happy');
  await dir.say([
    choice === 1
      ? [WHALE, '무서운 마음이 들어도 용기를 내는 게 진짜 용기란다. 내가 늘 곁에 있을게.', 'whale']
      : [WHALE, '고마워, 소미야! 역시 내가 생각한 대로야.', 'whale'],
    [WHALE, '이 별 리본을 받으렴. 동물 쿠키의 힘을 리본에 담으면, 그 동물 친구로 변신할 수 있단다.', 'whale'],
  ]);
  // 4) the transformation
  dir.anim(somi, 'idle');
  dir.camTo([1.5, 1.35, 0.4], [0.8, 0.95, -2.55], 1.0, Ease.inOutSine, 42);
  await dir.wait(0.6);
  const head = new Vec3(0.8, 1.35, -2.55);
  for (let i = 0; i < 10; i++) { CTX.fx.twinkle(head, PAL.gold, 0.6); await dir.wait(0.08); }
  sfx('magic', { pitch: 1.2 });
  CTX.fx.sparkle(head, PAL.pink, 24, 0.7);
  await dir.wait(0.5);
  sfx('transform');
  CTX.fx.flash('#ffffff', 0.7, 0.95);
  CTX.fx.poof(new Vec3(0.8, 0.7, -2.55));
  somi.root.visible = false;
  dir.release(somi);
  const cat = buildAnimal('cat');
  cat.root.position.set(0.8, 0, -2.55);
  cat.root.rotation.y = 0.15;
  S.root.add(cat.root);
  S.extra.push(cat);
  dir.actor(cat, 'celebrate');
  await dir.wait(1.8);
  cat.root.rotation.y = 0.2;
  dir.anim(cat, 'wave');
  await dir.say([[SOMI, '우와! 내가 고양이가 됐어! 냥냥~!', 'char:cat']]);
  dir.anim(cat, 'idle');
  await dir.say([
    [WHALE, '꿈나라 곳곳에 숨겨진 동물 쿠키를 찾으면 더 많은 친구로 변신할 수 있을 거야.', 'whale'],
    [WHALE, '자, 내 등에 타렴. 꿈나라로 출발이야!', 'whale'],
  ]);
  cat.root.rotation.y = Math.PI;
  dir.anim(cat, 'wave');
  await dir.say([[SOMI, '꿈나라야, 기다려! 소미가 간다!', 'char:cat']]);
  // 5) jump out of the window onto the whale's back
  dir.camTo([2.6, 2.0, 1.6], [0.8, 2.0, -6], 1.2);
  dir.anim(cat, 'jump');
  sfx('jump');
  const c0 = new Vec3(0.8, 0, -2.55), c1 = new Vec3(whale.root.position.x, whale.root.position.y + 1.65, whale.root.position.z);
  await dir.tween(1.25, (k) => {
    cat.root.position.set(lerp(c0.x, c1.x, k), lerp(c0.y, c1.y, k) + Math.sin(k * Math.PI) * 2.6, lerp(c0.z, c1.z, k));
  }, Ease.linear);
  dir.anim(cat, 'sit');
  sfx('land');
  CTX.fx.sparkle(c1, PAL.gold, 12, 0.6);
  // the whale swims up into the sky (camera tracks it from the window)
  dir.anim(whale, 'swim');
  const w2 = whale.root.position.clone();
  let dep = 0;
  S.tick = (dt) => {
    dep += dt;
    const k = Math.min(1, dep / 5.5), e = k * k * (3 - 2 * k);
    whale.root.position.set(w2.x - e * 7, w2.y + e * 7, w2.z - e * 34);
    whale.root.rotation.y = lerp(Math.PI * 0.08, Math.PI + 0.2, Ease.inOutSine(Math.min(1, dep / 1.4)));
    whale.root.rotation.x = -0.22 * e;
    cat.root.position.set(whale.root.position.x, whale.root.position.y + 1.65, whale.root.position.z);
    cat.root.rotation.y = whale.root.rotation.y;
    const cp = CTX.camera.target;
    cp.x += (whale.root.position.x - cp.x) * Math.min(1, dt * 3);
    cp.y += (whale.root.position.y + 1 - cp.y) * Math.min(1, dt * 3);
    cp.z += (whale.root.position.z - cp.z) * Math.min(1, dt * 3);
    if (Math.random() < dt * 25) CTX.fx.rainbowTrail(new Vec3(whale.root.position.x, whale.root.position.y + 0.5, whale.root.position.z + 3));
  };
  dir.camTo([1.2, 1.6, 0.8], [w2.x, w2.y + 1, w2.z], 1.0, Ease.inOutSine);
  await dir.wait(3.2);
  await dir.caption('그렇게 소미의 꿈나라 모험이 시작되었어요.', 2.8);
  await dir.fade('#ffffff', 1, 1.2);
  S.tick = null;
  dir.letterbox(false);
}

// ============================================================================
// STAGE CLEAR — colors return, results, memory, back to the map
// ============================================================================
function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; }

export async function playStageClear(stage, firstClear) {
  ensureCss();
  const def = stage.def, id = stage.stageId;
  const p = stage.player;
  const dir = new Director({ skippable: false });
  stage.cutscene = dir;
  stage.cutsceneCam = true;
  CTX.cam.mode = 'manual';
  CTX.hud.show(false);
  CTX.hud.setPrompt(null);
  CTX.input.setTouchVisible(false);
  if (p.ability && p.ability.end) { p.ability.end(p, true); p.ability = null; }
  p.vel.set(0, 0, 0);
  if (audio()) audio().stopMusic(0.4);
  dir.letterbox(true);
  // the dream light rises from the player into the sky
  const c = new Vec3(p.pos.x, p.pos.y, p.pos.z);
  p.lockAnim = 'celebrate';
  const cam0 = CTX.camera.position.clone();
  const yaw0 = Math.atan2(cam0.x - c.x, cam0.z - c.z);
  dir.orbit([c.x, c.y, c.z], 6.5, 2.4, yaw0, yaw0 + 1.2, 4.5, 1.2);
  jingle('colorRestore');
  const col = rgb(def.color);
  CTX.fx.colorBloom(c, col, 8);
  CTX.fx.flash('#ffffff', 0.9, 0.85);
  await dir.wait(0.6);
  // color wave sweeps the whole stage
  CTX.env.setBaseSat(1);
  CTX.env.setSkySat(1);
  CTX.env.addSpot(c.x, c.y, c.z, 400);
  for (let i = 0; i < 4; i++) { CTX.fx.colorBloom(c, i % 2 ? [1, 1, 1] : col, 10 + i * 8); await dir.wait(0.35); }
  CTX.fx.confetti(new Vec3(c.x, c.y + 1, c.z), 60);
  stage.level.enemies.forEach((e) => { if (e.alive && !e.boss) { e.die({}); } });
  await dir.wait(1.0);
  jingle('stageclear');
  CTX.hud.show(true);
  CTX.hud.banner(id === 8 ? '마음의 빛을 되찾았어요!' : `${def.colorName} 꿈빛을 되찾았어요!`, def.name + ' 클리어!', 3.4);
  await dir.wait(3.6);
  CTX.hud.show(false);
  // results card
  await showResults(stage);
  await dir.fade('#1d1638', 1, 0.6);
  dir.letterbox(false);
  dir.dispose();
  if (id === 8 || id === '8') { await playEnding(CTX.game); return; }
  if (id === 'test') { const { MapMode } = await import('../modes/map.js'); CTX.game.setMode(new MapMode({ focus: 1 })); return; }
  if (firstClear) { await playMemory(+id); return; }
  const { MapMode } = await import('../modes/map.js');
  await CTX.game.setMode(new MapMode({ focus: +id }));
  const el = document.getElementById('flash'); el.style.transition = 'opacity .8s'; el.style.opacity = '0';
}

function showResults(stage) {
  return new Promise((resolve) => {
    const id = stage.stageId;
    const sd = stage.sd;
    const cookiesTot = Object.values(COOKIE_STAGE).filter((s) => s === id).length;
    const petsTot = Object.values(PET_STAGE).filter((s) => s === id).length;
    const petsGot = Save.data ? Object.keys(Save.data.pets).filter((pp) => PET_STAGE[pp] === id).length : 0;
    const el = h('div', { class: 'screen', style: 'background:rgba(28,14,56,.35)' });
    const card = h('div', { class: 'panel results' });
    card.append(h('div', { class: 'rt' }, '스테이지 클리어!'), h('div', { class: 'rs' }, `스테이지 ${id} · ${stage.def.name}`));
    const rows = h('div', { class: 'rows' });
    const row = (icon, label, value, full = false) => {
      const k = h('div', { class: 'k row-in', html: `${icon}<span>${label}</span>` });
      const v = h('div', { class: 'v row-in' + (full ? ' full' : '') }, value);
      rows.append(k, v);
      return [k, v];
    };
    const items = [
      row(ICON.star, '걸린 시간', fmtTime(stage.stats.time)),
      row(ICON.candy, '모은 별사탕', `${stage.pickups ? stage.pickups.count : 0}개`),
      row(ICON.puffy, '구한 뭉실이', `${sd.puffies.length} / 5`, sd.puffies.length >= 5),
      row(ICON.cookie, '동물 쿠키', `${sd.cookies.length} / ${cookiesTot}`, cookiesTot > 0 && sd.cookies.length >= cookiesTot),
      row(ICON.heart, '펫 친구', `${petsGot} / ${petsTot}`, petsTot > 0 && petsGot >= petsTot),
      row(ICON.check, '착해진 먹구름', `${stage.stats.enemies}마리`),
    ];
    card.append(rows);
    const all = sd.puffies.length >= 5 && sd.cookies.length >= cookiesTot && petsGot >= petsTot;
    if (all) card.append(h('div', { class: 'stamp row-in' }, '완벽해요! 모두 찾았어요!'));
    else card.append(h('div', { class: 'rs row-in', style: 'font-size:calc(var(--u)*2.3)' }, '아직 못 찾은 친구들이 있어요. 나중에 다시 와서 찾아봐요!'));
    let sc;
    const btn = h('button', { class: 'btn', 'data-nav': '1', 'data-autofocus': '1', onclick: () => { sfx('menuSelect'); CTX.ui.pop(sc); resolve(); } }, '계속');
    card.append(btn);
    el.append(card);
    sc = CTX.ui.push(new Screen(el, {}));
    const reveal = [...card.querySelectorAll('.row-in')];
    reveal.forEach((e, i) => setTimeout(() => { e.classList.add('on'); if (i % 2 === 1) sfx('coin', { pitch: 1 + i * 0.03, vol: 0.6 }); }, 250 + i * 140));
  });
}

// ============================================================================
// MEMORIES — Noa's story, one piece after each first clear (stages 1-7)
// ============================================================================
const MEMORIES = [
  null,
  { lines: ['아주 먼 옛날, 밤하늘에 작은 별 하나가 태어났어요.', '이름은 노아. 노아는 반짝반짝 빛나는 게 세상에서 제일 좋았어요.'], anim: 'happy', gray: 0 },
  { lines: ['노아는 다른 별들과 함께 반짝이고 싶었어요.', '하지만 노아의 빛은 너무 작아서, 아무도 노아를 보지 못했어요.'], anim: 'idle', gray: 0.15 },
  { lines: ['"나도 여기 있어! 나랑 같이 놀자!" 노아는 있는 힘껏 외쳤어요.', '하지만 큰 별들은 저마다 반짝이느라 노아의 목소리를 듣지 못했어요.'], anim: 'cry', gray: 0.3 },
  { lines: ['어느 날 밤, 노아는 하늘에서 미끄러져', '꿈나라의 깊은 숲속으로 떨어지고 말았어요.'], anim: 'cry', gray: 0.35, fall: true },
  { lines: ['아무도 노아가 사라진 걸 몰랐어요.', '노아는 혼자 울었어요. 눈물이 떨어진 자리마다 회색 안개가 피어났어요.'], anim: 'cry', gray: 0.55, fog: 1 },
  { lines: ['안개는 점점 커져서 꿈나라의 색깔을 삼키기 시작했어요.', '너무 슬퍼서, 노아는 그 안개가 자기 눈물이라는 것도 몰랐어요.'], anim: 'cry', gray: 0.75, fog: 2 },
  { lines: ['"누군가... 나를 찾아 줬으면 좋겠어..."', '그 작은 목소리가, 이제 소미의 마음에 들려와요.'], anim: 'sleep', gray: 0.9, fog: 2, somi: true },
];

export function playMemory(n) {
  ensureCss();
  return CTX.game.setMode(new CutsceneMode(() => buildMemorySet(n), (dir, S) => memoryScript(dir, S, n), {
    id: 'memory' + n,
    onDone: async () => {
      const { MapMode } = await import('../modes/map.js');
      CTX.game.transition(() => CTX.game.setMode(new MapMode({ focus: Math.min(8, n + 1), justCleared: n })), 0.8);
    },
  }));
}

async function memoryScript(dir, S, n) {
  const M = MEMORIES[n];
  const { noa } = S;
  music('memory', { fade: 1.2, restart: true });
  const fl = document.getElementById('flash');
  fl.style.transition = 'none'; fl.style.background = '#1d1638'; fl.style.opacity = '1';
  dir.letterbox(true);
  noa.setGray(M.gray);
  dir.actor(noa, M.anim);
  const head = h('div', { class: 'memhead' }, `기억의 조각 ${n} / 7`);
  dir.ui.append(head);
  const home = S.noaHome;
  const forest = S.forest;
  if (!forest) {
    dir.shot([0, home.y + 0.6, 4.6], [0, home.y + 0.2, 0], 44);
    dir.orbit([0, home.y, 0], 4.2, 0.5, 0, 0.8, 14, 0.25);
  } else {
    dir.shot([0, 2.2, 8.5], [0, 0.8, 0], 46);
    dir.orbit([0, 0.4, 0], 7.5, 2.0, -0.5, 0.5, 14, 0.6);
  }
  if (M.fall) {
    // Noa slips from the sky and drops into the forest
    noa.root.position.set(-3, 14, -4);
    dir.shot([3, 3.5, 9], [-1.5, 7, -2], 52);
    dir.camTo([2.6, 2.4, 8.5], [0, 1.2, 0], 3.4);
    dir.tween(3.2, (k) => {
      noa.root.position.set(lerp(-3, 0, k), lerp(14, 0.05, k), lerp(-4, 0, k));
      noa.root.rotation.z = k * TAU * 1.5;
      if (Math.random() < 0.5) CTX.fx.trail(new Vec3(noa.root.position.x, noa.root.position.y + 0.4, noa.root.position.z), [1, 0.9, 0.5], 0.4);
    }, Ease.inQuad || Ease.linear).then(() => { noa.root.rotation.z = 0; CTX.fx.landing(noa.root.position, 0.7); sfx('land', { pitch: 1.4 }); });
  }
  await dir.fade('#1d1638', 0, 1.4);
  head.classList.add('on');
  await dir.wait(0.6);
  // fog grows out of the tears
  if (M.fog) {
    let acc = 0;
    S.tick = (dt) => {
      acc += dt;
      while (acc > 0.14) {
        acc -= 0.14;
        const a = Math.random() * TAU, d = 0.8 + Math.random() * (M.fog > 1 ? 6 : 3);
        CTX.fx.fogPuff({ x: Math.sin(a) * d, y: 0.4 + Math.random() * 1.5, z: Math.cos(a) * d }, M.fog > 1 ? 3 : 2);
      }
    };
  }
  if (n === 3) setTimeout(() => sfx('cry', { vol: 0.5 }), 3000);
  for (const line of M.lines) await dir.caption(line, Math.max(3.4, line.length * 0.13));
  if (M.somi) {
    // Somi hears the voice
    const r = buildAnimal(curChar());
    r.root.position.set(0, 0, 4.5);
    r.root.rotation.y = Math.PI;
    r.setOpacity && r.setOpacity(0.0);
    S.root.add(r.root);
    S.extra.push(r);
    dir.actor(r, 'idle');
    dir.camTo([2.8, 1.6, 7.6], [0, 0.6, 1.5], 2);
    dir.tween(1.2, (k) => { r.setOpacity && r.setOpacity(k); });
    await dir.wait(1.6);
    dir.anim(r, 'surprised');
    await dir.say([
      [SOMI, '이 목소리... 계속 들렸던 그 우는 소리야!', 'char:' + curChar()],
      [SOMI, '달빛 꿈의 정원 쪽에서 들려. 기다려, 내가 꼭 찾아 갈게!', 'char:' + curChar()],
    ]);
  }
  await dir.wait(0.8);
  head.classList.remove('on');
  S.tick = null;
  await dir.fade('#1d1638', 1, 1.0);
  dir.letterbox(false);
}

// ============================================================================
// ENDING — flight with Noa, Noa returns to the sky, Somi wakes up, credits
// ============================================================================
export function playEnding(game) {
  ensureCss();
  return game.setMode(new CutsceneMode(() => buildSkyFlight(curChar()), endingFlight, {
    id: 'ending1', skippable: false,
    onDone: () => {
      CTX.game.setMode(new CutsceneMode(() => buildRoom({ morning: true }), endingRoom, {
        id: 'ending2', skippable: false,
        onDone: () => playCredits(),
      }));
    },
  }));
}

async function endingFlight(dir, S) {
  const { whale, rider, noa } = S;
  const fl = document.getElementById('flash');
  fl.style.transition = 'none'; fl.style.background = '#ffffff'; fl.style.opacity = '1';
  music('ending', { fade: 1.0, restart: true });
  dir.letterbox(true);
  dir.actor(whale, 'swim');
  dir.actor(rider, 'sit');
  dir.actor(noa, 'happy');
  noa.setGray(0);
  whale.root.position.set(0, 0, 0);
  whale.root.rotation.y = Math.PI / 2;
  // whale cruises along +X; the camera rides along until Noa rises
  let wx = 0, follow = true, noaFree = false;
  S.tick = (dt) => {
    wx += dt * 3.2;
    whale.root.position.set(wx, Math.sin(wx * 0.2) * 0.8, 0);
    if (!noaFree) noa.root.position.set(wx + 1.5, 2.25 + Math.sin(S.t * 2) * 0.2, 1.3);
    if (follow) { CTX.camera.target.set(wx + 1.5, 1.4, 0); CTX.camera.position.set(wx - 5 + Math.sin(S.t * 0.2) * 1.5, 2.6, 8.5); }
  };
  dir.shot([wx - 6, 2.5, 9], [wx + 2, 1.2, 0], 50);
  await dir.fade('#ffffff', 0, 1.8);
  await dir.caption('꿈나라에 다시 색깔이 돌아왔어요.', 3.2);
  await dir.say([
    [NOA, '소미야... 나를 찾아 줘서 고마워. 이제 하나도 안 외로워.', 'noa'],
    [SOMI, '노아, 이제 우리는 친구야. 영원히!', 'char:' + curChar()],
    [WHALE, '노아의 슬픔이 걷히자 안개도 모두 사라졌단다. 소미 덕분이야.', 'whale'],
    [NOA, '나는 이제 하늘로 돌아가야 해. 내 자리에서 다시 반짝일 거야.', 'noa'],
    [NOA, '밤하늘을 봐. 가장 반짝이는 별이 나야. 언제나... 너를 보고 있을게.', 'noa'],
  ]);
  dir.anim(rider, 'wave');
  await dir.say([[SOMI, '안녕, 노아! 꼭 매일 밤 인사할게!', 'char:' + curChar()]]);
  // Noa rises and becomes the brightest star
  follow = false; noaFree = true;
  const n0 = noa.root.position.clone();
  dir.camTo([wx - 3, 1.2, 7], [wx + 1, 9, -6], 2.5);
  sfx('star');
  dir.anim(noa, 'hug');
  await dir.tween(3.2, (k) => {
    noa.root.position.set(n0.x + k * 2, n0.y + Ease.inCubic(k) * 14, n0.z - k * 8);
    if (Math.random() < 0.6) CTX.fx.trail(noa.root.position, [1, 0.95, 0.6], 0.5);
  }, Ease.linear);
  CTX.fx.flash('#fff6d8', 1.2, 0.85);
  sfx('colorBloom');
  CTX.fx.colorBloom(noa.root.position, [1, 0.95, 0.7], 12);
  noa.root.scale.set(2.2, 2.2, 2.2);
  await dir.wait(2.0);
  await dir.caption('그날 밤, 하늘에서 가장 반짝이는 별 하나가 새로 빛나기 시작했어요.', 3.6);
  follow = true;
  await dir.say([[WHALE, '고마워, 소미야. 이제 집으로 돌아갈 시간이란다. 푹 자렴...', 'whale']]);
  await dir.fade('#ffffff', 1, 2.0);
  S.tick = null;
  dir.letterbox(false);
}

async function endingRoom(dir, S) {
  const { somi } = S;
  const fl = document.getElementById('flash');
  fl.style.transition = 'none'; fl.style.background = '#ffffff'; fl.style.opacity = '1';
  S.whale.root.visible = false;
  dir.letterbox(true);
  // Somi asleep in her bed
  somi.root.position.set(-3.3, 0.92, 0.5);
  somi.root.rotation.set(-Math.PI / 2 + 0.08, 0, 0);
  dir.actor(somi, 'sleep');
  dir.shot([-0.6, 2.4, 2.4], [-3.3, 1.0, 0.2], 44);
  dir.camTo([-0.9, 2.1, 1.9], [-3.3, 1.0, 0.0], 5);
  await dir.fade('#ffffff', 0, 2.0);
  await dir.caption('아침 햇살이 소미의 방을 비추었어요.', 3.0);
  // wake up
  somi.root.rotation.set(0, 0, 0);
  somi.root.position.set(-2.0, 0, 0.4);
  somi.root.rotation.y = Math.PI / 2;
  CTX.fx.sparkle(new Vec3(-2, 1, 0.4), PAL.gold, 8, 0.6);
  dir.anim(somi, 'surprised');
  dir.shot([0.6, 1.6, 2.6], [-1.6, 1.0, 0.2], 46);
  await dir.say([[SOMI, '...어? 여기는 내 방이네. 꿈이었나?', 'somi']]);
  // run to the window
  dir.camTo([2.0, 1.8, 1.0], [0.8, 1.6, -3], 2.2);
  await dir.walk(somi, [0.8, 0, -2.5], 1.8, 'run');
  somi.root.rotation.y = Math.PI;
  await dir.wait(0.4);
  // a bright star still twinkles in the dawn sky
  const star = S.moon;
  star.position.set(-2, 7.6, -40);
  star.scale.set(0.42, 0.42, 0.42);
  star.userData.halo.scale.set(4.2, 4.2, 4.2);
  dir.camTo([1.2, 1.5, -1.6], [-1.6, 6.4, -40], 2.4);
  await dir.wait(2.6);
  for (let i = 0; i < 4; i++) { CTX.fx.twinkle(new Vec3(-1.9, 7.6, -39), [1, 0.95, 0.75], 1.4); CTX.fx.sparkle(new Vec3(-1.9, 7.6, -39), [1, 0.92, 0.7], 6, 1.2); await dir.wait(0.35); }
  dir.anim(somi, 'wave');
  await dir.say([[SOMI, '노아다! 노아가 나한테 인사하고 있어!', 'somi'], [SOMI, '안녕, 노아! 오늘 밤에도 꼭 만나자!', 'somi']]);
  dir.anim(somi, 'celebrate');
  dir.camTo([3.0, 2.4, 3.2], [-0.2, 1.4, -2.6], 4);
  await dir.caption('슬픔도, 외로움도... 함께라면 반짝이는 빛이 될 수 있어요.', 4.4);
  await dir.fade('#0b0820', 1, 2.0);
  dir.letterbox(false);
}

// ------------------------------------------------------------------ credits roll
export function playCredits() {
  ensureCss();
  const mode = new CutsceneMode(() => buildSkyFlight(curChar()), creditsScript, {
    id: 'credits', skippable: !!(Save.data && Save.data.seenEnding),
    onDone: async () => {
      if (Save.data) { Save.data.seenEnding = true; Save.write(); }
      const { MapMode } = await import('../modes/map.js');
      CTX.game.transition(() => CTX.game.setMode(new MapMode({ focus: 8 })), 1.0);
    },
  });
  return CTX.game.setMode(mode);
}

async function creditsScript(dir, S) {
  const fl = document.getElementById('flash');
  fl.style.transition = 'none'; fl.style.background = '#0b0820'; fl.style.opacity = '1';
  music('credits', { fade: 0.8, restart: true });
  const { whale, rider, noa } = S;
  dir.actor(whale, 'swim'); dir.actor(rider, 'sit'); dir.actor(noa, 'happy');
  noa.root.scale.set(1.4, 1.4, 1.4);
  let x = 0;
  let scroll = null;
  S.tick = (dt) => {
    x += dt * 2.6;
    whale.root.position.set(x, Math.sin(x * 0.25) * 0.8 - 2.5, -6);
    whale.root.rotation.y = Math.PI / 2;
    noa.root.position.set(x + 1, 1.0 + Math.sin(S.t * 1.7) * 0.3, -4.5);
    CTX.camera.position.set(x - 1.5, 1.5, 11);
    CTX.camera.target.set(x + 1.2, -0.6, -4);
    if (scroll) scroll(dt);
  };
  // build the roll
  const wrap = h('div', { class: 'credits' });
  const roll = h('div', { class: 'roll' });
  const sec = (title, ...kids) => { roll.append(h('h2', {}, title), ...kids); };
  roll.append(h('div', { style: 'height:100vh' }));
  roll.append(h('div', { class: 'big' }, '소미의 어드벤처 타임'));
  sec('주인공', h('p', {}, '소미 — 별을 사랑하는 용감한 아이'));
  sec('꿈나라를 지켜 준 친구', h('p', {}, '별고래'), h('p', {}, '노아 — 가장 반짝이는 작은 별'));
  const animals = h('div', { class: 'grid' });
  for (const c of CHARACTERS) {
    const got = Save.data ? Save.hasChar(c.id) : true;
    const img = h('img', { alt: '' });
    animals.append(h('div', { class: 'cell' }, img, got ? c.name : '???'));
    setTimeout(() => { try { img.src = charPortrait(c.id); if (!got) img.style.filter = 'brightness(0) opacity(.45)'; } catch (e) { /* ignore */ } }, 60);
  }
  sec('함께한 동물 친구들', animals);
  const pets = h('div', { class: 'grid' });
  for (const pt of PETS) {
    const got = Save.data ? Save.hasPet(pt.id) : true;
    const img = h('img', { alt: '' });
    pets.append(h('div', { class: 'cell' }, img, got ? pt.name : '???'));
    setTimeout(() => { try { img.src = petPortrait(pt.id); if (!got) img.style.filter = 'brightness(0) opacity(.45)'; } catch (e) { /* ignore */ } }, 80);
  }
  sec('꿈방울 펫 친구들', pets);
  sec('다시 웃게 된 친구들', ...['킹 버섯돌이', '호박 대장', '우르릉 번개구름', '카멜레온 카멜', '문어 대왕 옥토', '눈보라 예티', '태엽 기사 클락'].map((n) => h('p', {}, n)));
  sec('그리고', h('p', {}, `구해 준 뭉실이 ${Save.data ? Save.totalPuffies() : 0}마리`), h('p', {}, '꿈나라의 모든 친구들'));
  sec('만든 사람들', h('h3', {}, '이야기 · 그림 · 음악 · 프로그램'), h('p', {}, '아빠 그리고 Claude'));
  roll.append(h('div', { class: 'big' }, '사랑하는 소미에게'), h('p', { style: 'font-size:calc(var(--u)*3.2);max-width:calc(var(--u)*110)' }, '소미가 슬플 때도, 외로울 때도 언제나 곁에서 반짝이는 별이 되어 줄게.'), h('div', { class: 'sign' }, '— 아빠가'));
  roll.append(h('div', { class: 'end' }, '끝'));
  roll.append(h('div', { style: 'height:40vh' }));
  wrap.append(roll, h('div', { class: 'hint' }, CTX.game.touchMode ? '화면을 누르고 있으면 빨리 감기' : '점프 버튼을 누르고 있으면 빨리 감기'));
  dir.ui.append(wrap);
  dir.ui.style.pointerEvents = 'auto';
  let held = false;
  wrap.addEventListener('pointerdown', () => { held = true; });
  window.addEventListener('pointerup', () => { held = false; });
  await dir.fade('#0b0820', 0, 1.5);
  // scroll (frame-driven so it pauses with the game)
  let y = 0;
  const total = () => roll.scrollHeight - window.innerHeight * 0.55;
  await new Promise((resolve) => {
    scroll = (dt) => {
      if (dir.skipping) { scroll = null; resolve(); return; }
      const fast = held || (CTX.input && (CTX.input.down('jump') || CTX.input.down('confirm') || CTX.input.down('attack')));
      y += (fast ? 6 : 1) * dt * 54 * Math.max(0.7, window.innerHeight / 800);
      roll.style.transform = `translateY(${-y}px)`;
      if (y >= total()) { scroll = null; resolve(); }
    };
  });
  jingle('victory');
  await dir.wait(4.0);
  await dir.fade('#0b0820', 1, 1.6);
  S.tick = null;
}
void clamp; void STAGES; void Save;

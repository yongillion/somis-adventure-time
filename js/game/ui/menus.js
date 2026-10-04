// ============================================================================
// menus.js — pause menu, character select, pet box, settings, help
// ============================================================================
import { CTX, DIFFICULTY } from '../ctx.js';
import { h, Screen } from './ui.js';
import { ICON } from './icons.js';
import { charPortrait, petPortrait } from './portraits.js';
import { CHARACTERS, CHAR_BY_ID, COOKIE_STAGE } from '../data/characters.js';
import { PETS, PET_BY_ID, petLevelProgress, PET_STAGE, MAX_PET_LEVEL } from '../data/pets.js';
import { STAGES } from '../data/stages.js';
import { Save } from '../save.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };

const CSS = `
.mscreen { background: rgba(28,14,56,.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.mpanel { padding: calc(var(--u)*3.4) calc(var(--u)*4); max-width: min(94vw, calc(var(--u)*150)); max-height: 92vh; display: flex; flex-direction: column; gap: calc(var(--u)*2.2); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.mtitle { font-size: calc(var(--u)*5); color: var(--pink-d); text-align: center; text-shadow: 0 2px 0 #fff; }
.mrow { display: flex; gap: calc(var(--u)*2); flex-wrap: wrap; justify-content: center; }
.mstats { display: flex; gap: calc(var(--u)*2.4); justify-content: center; flex-wrap: wrap; font-size: calc(var(--u)*2.8); color: var(--ink); }
.mstats span { display: inline-flex; align-items: center; gap: calc(var(--u)*0.8); background: var(--paper-2); border-radius: 999px; padding: calc(var(--u)*0.6) calc(var(--u)*1.8); }
.mstats svg { width: calc(var(--u)*3.6); height: calc(var(--u)*3.6); }
.cgrid { display: grid; grid-template-columns: repeat(10, 1fr); gap: calc(var(--u)*1.2); overflow-y: auto; padding: calc(var(--u)*1); }
@media (max-aspect-ratio: 4/3) { .cgrid { grid-template-columns: repeat(6, 1fr); } }
.ccard { position: relative; aspect-ratio: 1; border-radius: calc(var(--u)*2.4); background: radial-gradient(circle at 50% 35%, #fff, #ffe6f2); border: calc(var(--u)*0.5) solid #fff; box-shadow: 0 calc(var(--u)*0.5) 0 #e8d8f0; cursor: pointer; pointer-events: auto; overflow: hidden; padding: 0; transition: transform .12s; }
.ccard img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ccard.locked img { filter: brightness(0) opacity(.3); }
.ccard.locked::after { content: '?'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: calc(var(--u)*5); color: #fff; text-shadow: 0 2px 0 var(--lilac-d); }
.ccard.focus, .ccard.sel { transform: scale(1.08); box-shadow: 0 0 0 calc(var(--u)*0.6) var(--pink), 0 calc(var(--u)*0.8) calc(var(--u)*1.6) var(--shadow); z-index: 2; }
.ccard.cur::before { content: '★'; position: absolute; right: 4%; top: 2%; color: var(--butter-d); font-size: calc(var(--u)*2.8); z-index: 3; text-shadow: 0 1px 0 #fff; }
.cdetail { display: flex; gap: calc(var(--u)*3); align-items: center; background: var(--paper-2); border-radius: calc(var(--u)*3); padding: calc(var(--u)*2) calc(var(--u)*3); min-height: calc(var(--u)*24); }
.cdetail .big { width: calc(var(--u)*20); height: calc(var(--u)*20); flex: 0 0 auto; border-radius: 50%; background: radial-gradient(circle at 50% 35%, #fff, #ffe6f2); border: calc(var(--u)*0.6) solid #fff; overflow: hidden; }
.cdetail .big img { width: 100%; height: 100%; object-fit: cover; }
.cdetail .big.locked img { filter: brightness(0) opacity(.3); }
.cdetail .info { flex: 1; min-width: 0; color: var(--ink); }
.cdetail .nm { font-size: calc(var(--u)*4); color: var(--pink-d); }
.cdetail .ab { font-size: calc(var(--u)*2.5); margin-top: calc(var(--u)*0.8); line-height: 1.4; word-break: keep-all; }
.cdetail .ab b { color: var(--lilac-d); font-weight: normal; }
.cdetail .lockmsg { font-size: calc(var(--u)*2.6); color: var(--ink-soft); margin-top: calc(var(--u)*1); }
.pgrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: calc(var(--u)*1.8); padding: calc(var(--u)*1); }
.pbub { position: relative; aspect-ratio: 1; border-radius: 50%; border: none; cursor: pointer; pointer-events: auto; padding: 0; background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.95), rgba(220,240,255,.55) 45%, rgba(190,170,255,.35) 75%, rgba(255,255,255,.9) 100%); box-shadow: inset 0 0 calc(var(--u)*2) rgba(255,255,255,.9), 0 calc(var(--u)*0.6) calc(var(--u)*1.4) var(--shadow); transition: transform .12s; overflow: hidden; }
.pbub img { width: 84%; height: 84%; margin: 8%; object-fit: contain; display: block; animation: petfloat 2.4s ease-in-out infinite; }
@keyframes petfloat { 50% { transform: translateY(-6%); } }
.pbub.unknown img { filter: brightness(0) opacity(.25); animation: none; }
.pbub.unknown::after { content: '?'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: calc(var(--u)*5); color: #fff; text-shadow: 0 2px 0 var(--lilac-d); }
.pbub.focus, .pbub.sel { transform: scale(1.1); box-shadow: 0 0 0 calc(var(--u)*0.6) var(--lilac), 0 calc(var(--u)*0.8) calc(var(--u)*1.6) var(--shadow); }
.pbub .lv { position: absolute; left: 50%; bottom: 4%; transform: translateX(-50%); font-size: calc(var(--u)*1.8); background: var(--lilac); color: #fff; border-radius: 999px; padding: 0 calc(var(--u)*0.9); }
.pbub.cur::before { content: '♥'; position: absolute; right: 10%; top: 6%; color: var(--pink); font-size: calc(var(--u)*3); z-index: 2; }
.xpbar { height: calc(var(--u)*1.8); border-radius: 99px; background: #fff; overflow: hidden; margin-top: calc(var(--u)*0.8); border: calc(var(--u)*0.3) solid #e8dcff; }
.xpbar i { display: block; height: 100%; background: linear-gradient(90deg, var(--lilac), var(--sky)); }
.setrow { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--u)*3); font-size: calc(var(--u)*3); color: var(--ink); background: var(--paper-2); border-radius: calc(var(--u)*2); padding: calc(var(--u)*1.2) calc(var(--u)*2.4); }
.seg { display: flex; gap: calc(var(--u)*1); }
.seg .btn { font-size: calc(var(--u)*2.4); padding: calc(var(--u)*0.8) calc(var(--u)*2); }
.seg .btn.on { background: linear-gradient(180deg, #ffe88a, var(--butter) 55%, var(--butter-d)); color: #6a4a10; box-shadow: 0 calc(var(--u)*0.5) 0 #c8901a; text-shadow: none; }
.vol { display: flex; align-items: center; gap: calc(var(--u)*1); }
.vol .btn { width: calc(var(--u)*6); padding: calc(var(--u)*0.6) 0; font-size: calc(var(--u)*3); }
.vol .meter { width: calc(var(--u)*22); height: calc(var(--u)*2); background: #fff; border-radius: 99px; overflow: hidden; border: calc(var(--u)*0.3) solid #e8dcff; }
.vol .meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--pink), var(--butter)); }
.help { font-size: calc(var(--u)*2.5); color: var(--ink); line-height: 1.6; display: grid; grid-template-columns: auto 1fr; gap: calc(var(--u)*0.6) calc(var(--u)*2.4); }
.help kbd { font-family: var(--font); background: #fff; border-radius: calc(var(--u)*1); padding: 0 calc(var(--u)*1.2); box-shadow: 0 2px 0 #d8c8ec; color: var(--lilac-d); white-space: nowrap; }
`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

// ------------------------------------------------------------------ pause
export function openPause(o) {
  ensureCss();
  const ui = CTX.ui;
  const sd = o.stageId && Save.data ? Save.stage(o.stageId) : null;
  const el = h('div', { class: 'screen mscreen' });
  const p = h('div', { class: 'panel mpanel', style: 'min-width:min(86vw,calc(var(--u)*70))' });
  p.append(h('div', { class: 'mtitle' }, '잠깐 쉬어요'));
  if (o.stageId && STAGES[o.stageId]) {
    p.append(h('div', { style: 'text-align:center;font-size:calc(var(--u)*2.8);color:var(--ink-soft)' }, `스테이지 ${o.stageId} · ${STAGES[o.stageId].name}`));
    p.append(h('div', { class: 'mstats' },
      h('span', { html: `${ICON.puffy} 뭉실이 ${sd ? sd.puffies.length : 0}/5` }),
      h('span', { html: `${ICON.cookie} 쿠키 ${sd ? sd.cookies.length : 0}/${Object.values(COOKIE_STAGE).filter((s) => s === +o.stageId).length}` }),
      h('span', { html: `${ICON.candy} ${Save.data ? Save.data.candies : 0}` })));
  }
  const list = h('div', { class: 'menu-list', style: 'align-self:center' });
  let sc;
  const btn = (txt, cls, fn) => h('button', { class: 'btn ' + cls, 'data-nav': '1', onclick: () => { sfx('menuSelect'); fn(); } }, txt);
  list.append(
    btn('계속하기', '', () => { ui.pop(sc); o.resume && o.resume(); }),
    btn('캐릭터 바꾸기', 'alt', () => openCharSelect({ onPick: o.onChar })),
    btn('펫 상자', 'alt', () => openPetBox({ onPick: o.onPet })),
    btn('설정', 'ghost', () => openSettings({})),
  );
  if (o.onExit) list.append(btn(o.exitLabel || '지도로 나가기', 'ghost', async () => {
    const ok = await ui.confirm('지도로 돌아갈까요?<br>(구출한 뭉실이와 쿠키는 저장돼요)'.replace('<br>', ' '), '돌아가기', '계속하기');
    if (ok) { ui.pop(sc); o.onExit(); }
  }));
  p.append(list);
  el.append(p);
  sc = ui.push(new Screen(el, { onBack: () => { ui.pop(sc); o.resume && o.resume(); } }));
  sc.closeOnPause = true;
  return sc;
}

// ------------------------------------------------------------------ character select
export function openCharSelect(o = {}) {
  ensureCss();
  const ui = CTX.ui;
  const el = h('div', { class: 'screen mscreen' });
  const p = h('div', { class: 'panel mpanel', style: 'width:min(96vw,calc(var(--u)*150))' });
  const owned = new Set(Save.data ? Save.data.chars : ['cat']);
  p.append(h('div', { class: 'mtitle' }, `동물 친구로 변신! (${owned.size}/30)`));
  const grid = h('div', { class: 'cgrid' });
  const detail = h('div', { class: 'cdetail' });
  const bigImg = h('img', { alt: '' });
  const big = h('div', { class: 'big' }, bigImg);
  const info = h('div', { class: 'info' });
  detail.append(big, info);
  let sel = null;
  const cur = CTX.player ? CTX.player.charId : (Save.data ? Save.data.currentChar : 'cat');
  const show = (c) => {
    sel = c;
    const has = owned.has(c.id);
    big.classList.toggle('locked', !has);
    try { bigImg.src = charPortrait(c.id); } catch (e) { /* ignore */ }
    info.innerHTML = '';
    if (has) {
      info.append(h('div', { class: 'nm' }, c.name),
        h('div', { class: 'ab', html: `<b>공격</b> ${c.attack.name}` }),
        h('div', { class: 'ab', html: `<b>특기</b> ${c.special.name} — ${c.special.desc}` }));
    } else {
      const st = COOKIE_STAGE[c.id];
      info.append(h('div', { class: 'nm' }, '???'), h('div', { class: 'lockmsg' }, `스테이지 ${st}의 어딘가에 숨어 있는 ${'동물 쿠키'}를 찾으면 변신할 수 있어요!`));
    }
    for (const e of grid.children) e.classList.toggle('sel', e._c === c);
    go.disabled = !has || c.id === cur;
    go.textContent = c.id === cur ? '지금 모습' : '변신!';
  };
  let sc;
  const choose = () => {
    if (!sel || !owned.has(sel.id)) { sfx('fail'); return; }
    ui.pop(sc);
    if (o.onPick) o.onPick(sel.id);
  };
  for (const c of CHARACTERS) {
    const has = owned.has(c.id);
    const card = h('button', { class: 'ccard' + (has ? '' : ' locked') + (c.id === cur ? ' cur' : ''), 'data-nav': '1', onclick: () => { if (sel === c && has) { sfx('menuSelect'); choose(); } else { sfx('menuMove'); show(c); } } });
    card._c = c;
    card._onFocus = () => show(c);
    const img = h('img', { alt: c.name, loading: 'lazy' });
    card.append(img);
    grid.append(card);
    // fill portraits progressively to avoid a long stall
    requestAnimationFrame(() => setTimeout(() => { try { img.src = charPortrait(c.id); } catch (e) { /* ignore */ } }, 0));
  }
  const go = h('button', { class: 'btn', 'data-nav': '1', onclick: () => { sfx('menuSelect'); choose(); } }, '변신!');
  const close = h('button', { class: 'btn ghost', 'data-nav': '1', onclick: () => { sfx('menuBack'); ui.pop(sc); if (o.onClose) o.onClose(); } }, '닫기');
  p.append(grid, detail, h('div', { class: 'mrow' }, go, close));
  el.append(p);
  sc = ui.push(new Screen(el, { onBack: () => { ui.pop(sc); if (o.onClose) o.onClose(); } }));
  const curCard = [...grid.children].find((e) => e._c.id === cur);
  show(CHAR_BY_ID[cur] || CHARACTERS[0]);
  if (curCard && !CTX.game.touchMode) sc.focus(curCard);
  return sc;
}

// ------------------------------------------------------------------ pet box
export function openPetBox(o = {}) {
  ensureCss();
  const ui = CTX.ui;
  const el = h('div', { class: 'screen mscreen' });
  const p = h('div', { class: 'panel mpanel', style: 'width:min(96vw,calc(var(--u)*130))' });
  const ownedN = PETS.filter((pt) => Save.hasPet(pt.id)).length;
  p.append(h('div', { class: 'mtitle' }, `꿈방울 펫 상자 (${ownedN}/15)`));
  const body = h('div', { style: 'display:flex;gap:calc(var(--u)*3);align-items:stretch;flex-wrap:wrap;justify-content:center' });
  const grid = h('div', { class: 'pgrid', style: 'flex:1 1 calc(var(--u)*60);min-width:0' });
  const detail = h('div', { class: 'cdetail', style: 'flex:1 1 calc(var(--u)*50);flex-direction:column;align-items:stretch' });
  body.append(grid, detail);
  let sel = null, sc;
  const curId = () => Save.data ? Save.data.currentPet : null;
  const refresh = () => {
    for (const b of grid.children) {
      const pt = b._p;
      const has = Save.hasPet(pt.id);
      b.classList.toggle('unknown', !has);
      b.classList.toggle('cur', curId() === pt.id);
      b.classList.toggle('sel', sel === pt);
      const lv = b.querySelector('.lv');
      if (lv) lv.textContent = has ? 'Lv' + petLevelProgress(Save.data.pets[pt.id].xp).lv : '';
    }
  };
  const show = (pt) => {
    sel = pt;
    detail.innerHTML = '';
    const has = Save.hasPet(pt.id);
    if (!has) {
      detail.append(h('div', { class: 'nm', style: 'font-size:calc(var(--u)*4);color:var(--lilac-d)' }, '???'),
        h('div', { class: 'lockmsg', style: 'font-size:calc(var(--u)*2.6);color:var(--ink-soft);line-height:1.5' }, `스테이지 ${PET_STAGE[pt.id]}에서 만날 수 있는 친구예요. 도움이 필요한 친구를 찾아봐요!`));
    } else {
      const pr = petLevelProgress(Save.data.pets[pt.id].xp);
      detail.append(
        h('div', { style: 'display:flex;align-items:center;gap:calc(var(--u)*2)' },
          h('div', { class: 'big', style: 'width:calc(var(--u)*13);height:calc(var(--u)*13)' }, h('img', { alt: '', src: petPortrait(pt.id) })),
          h('div', {}, h('div', { class: 'nm', style: 'font-size:calc(var(--u)*4);color:var(--lilac-d)' }, `${pt.name}`), h('div', { style: 'font-size:calc(var(--u)*2.4);color:var(--ink-soft)' }, `${pt.kind} · Lv${pr.lv}${pr.lv >= MAX_PET_LEVEL ? ' (최고!)' : ''}`))),
        h('div', { class: 'xpbar' }, h('i', { style: `width:${Math.round(pr.frac * 100)}%` })),
        h('div', { class: 'ab', style: 'font-size:calc(var(--u)*2.6);margin-top:calc(var(--u)*1.2);line-height:1.5;word-break:keep-all', html: `<b style="color:var(--pink-d);font-weight:normal">${pt.title}</b><br>${pt.desc(pr.lv)}` }),
        pr.lv < MAX_PET_LEVEL ? h('div', { style: 'font-size:calc(var(--u)*2.2);color:var(--ink-soft);margin-top:calc(var(--u)*0.8)' }, `다음 레벨: ${pt.desc(pr.lv + 1)}`) : null,
        h('div', { style: 'font-size:calc(var(--u)*2.1);color:var(--ink-soft);margin-top:calc(var(--u)*0.8)' }, '능력을 쓸수록 경험치가 쌓여요.'),
      );
      const row = h('div', { class: 'mrow', style: 'margin-top:calc(var(--u)*1.6)' });
      const isCur = curId() === pt.id;
      row.append(h('button', { class: 'btn small' + (isCur ? ' ghost' : ''), 'data-nav': '1', onclick: () => {
        sfx('petSummon');
        Save.data.currentPet = isCur ? null : pt.id;
        Save.write();
        if (o.onPick) o.onPick(Save.data.currentPet);
        refresh(); show(pt);
      } }, isCur ? '상자에서 쉬기' : '함께 가기'));
      row.append(h('button', { class: 'btn small gold', 'data-nav': '1', onclick: () => {
        if (!Save.data || Save.data.candies < 10) { sfx('fail'); CTX.hud && CTX.hud.toast('별사탕이 10개 필요해요!', 'warn'); return; }
        if (pr.lv >= MAX_PET_LEVEL) { sfx('fail'); return; }
        Save.data.candies -= 10;
        Save.data.pets[pt.id].xp += 4;
        Save.write();
        sfx('heal');
        if (CTX.hud) CTX.hud.setCandies(Save.data.candies);
        if (CTX.pet && CTX.pet.id === pt.id) { CTX.pet.happy(1.2); CTX.hud.setPet(pt.id, Save.data.pets[pt.id].xp); }
        refresh(); show(pt);
      } }, `간식 주기 ${ICON.candy ? '(별사탕 10)' : ''}`));
      detail.append(row);
    }
    refresh();
  };
  for (const pt of PETS) {
    const has = Save.hasPet(pt.id);
    const b = h('button', { class: 'pbub', 'data-nav': '1', onclick: () => { sfx('menuMove'); show(pt); } });
    b._p = pt;
    b._onFocus = () => show(pt);
    const img = h('img', { alt: pt.name });
    b.append(img, h('span', { class: 'lv' }, has ? 'Lv1' : ''));
    grid.append(b);
    requestAnimationFrame(() => setTimeout(() => { try { img.src = petPortrait(pt.id); } catch (e) { /* ignore */ } }, 0));
  }
  const close = h('button', { class: 'btn ghost', 'data-nav': '1', onclick: () => { sfx('menuBack'); ui.pop(sc); if (o.onClose) o.onClose(); } }, '닫기');
  p.append(body, h('div', { class: 'mrow' }, close));
  el.append(p);
  sc = ui.push(new Screen(el, { onBack: () => { ui.pop(sc); if (o.onClose) o.onClose(); } }));
  const first = PETS.find((pt) => pt.id === curId()) || PETS.find((pt) => Save.hasPet(pt.id)) || PETS[0];
  show(first);
  return sc;
}

// ------------------------------------------------------------------ settings
export function openSettings(o = {}) {
  ensureCss();
  const ui = CTX.ui;
  const S = Save.settings;
  const el = h('div', { class: 'screen mscreen' });
  const p = h('div', { class: 'panel mpanel', style: 'width:min(94vw,calc(var(--u)*110));overflow-y:auto' });
  p.append(h('div', { class: 'mtitle' }, '설정'));
  const vol = (label, key, apply) => {
    const meter = h('div', { class: 'meter' }, h('i', { style: `width:${Math.round(S[key] * 100)}%` }));
    const set = (v) => { S[key] = Math.max(0, Math.min(1, Math.round(v * 10) / 10)); meter.firstChild.style.width = Math.round(S[key] * 100) + '%'; apply(S[key]); Save.writeSettings(); sfx('menuMove'); };
    return h('div', { class: 'setrow' }, h('span', {}, label), h('div', { class: 'vol' },
      h('button', { class: 'btn ghost', 'data-nav': '1', onclick: () => set(S[key] - 0.1) }, '－'), meter,
      h('button', { class: 'btn ghost', 'data-nav': '1', onclick: () => set(S[key] + 0.1) }, '＋')));
  };
  const seg = (label, opts, get, set) => {
    const box = h('div', { class: 'seg' });
    const draw = () => { [...box.children].forEach((b, i) => b.classList.toggle('on', opts[i][0] === get())); };
    for (const [v, t] of opts) box.append(h('button', { class: 'btn ghost', 'data-nav': '1', onclick: () => { set(v); draw(); Save.writeSettings(); sfx('menuSelect'); } }, t));
    draw();
    return h('div', { class: 'setrow' }, h('span', {}, label), box);
  };
  p.append(
    vol('배경 음악', 'music', (v) => CTX.audio && CTX.audio.setMusicVolume(v)),
    vol('효과음', 'sfx', (v) => CTX.audio && CTX.audio.setSfxVolume(v)),
    seg('화질', [['auto', '자동'], ['low', '부드럽게'], ['high', '선명하게']], () => S.quality, (v) => { S.quality = v; CTX.game.applyQuality(); }),
    seg('화면 흔들림', [[true, '켜기'], [false, '끄기']], () => S.shake, (v) => { S.shake = v; CTX.settingsShake = v; }),
    seg('진동', [[true, '켜기'], [false, '끄기']], () => S.vibrate, (v) => { S.vibrate = v; }),
  );
  if (Save.data) {
    p.append(seg('난이도', Object.values(DIFFICULTY).map((d) => [d.id, d.name]), () => Save.data.difficulty, (v) => {
      Save.data.difficulty = v; CTX.diff = DIFFICULTY[v]; Save.write();
      if (CTX.player) { CTX.player.maxHp = CTX.diff.maxHp; CTX.player.hp = Math.min(CTX.player.hp, CTX.player.maxHp); if (CTX.hud) CTX.hud.setHp(CTX.player.hp, CTX.player.maxHp); }
    }));
  }
  p.append(h('div', { class: 'mtitle', style: 'font-size:calc(var(--u)*3.4)' }, '조작법'), helpGrid());
  let sc;
  p.append(h('div', { class: 'mrow' }, h('button', { class: 'btn', 'data-nav': '1', onclick: () => { sfx('menuBack'); ui.pop(sc); } }, '확인')));
  el.append(p);
  sc = ui.push(new Screen(el, { onBack: () => ui.pop(sc) }));
  return sc;
}
export function helpGrid() {
  const g = h('div', { class: 'help' });
  const touch = CTX.game && CTX.game.touchMode;
  const rows = touch ? [
    ['왼쪽 화면 끌기', '움직이기 (가상 조이스틱)'],
    ['분홍 버튼', '점프 · 하늘에서 다시 누르면 둥실둥실 날기'],
    ['노란 버튼', '공격 · 날다가 누르면 바람 뿜기'],
    ['보라 버튼', '특기 (동물마다 달라요!)'],
    ['오른쪽 화면 끌기', '카메라 돌리기'],
    ['위쪽 작은 버튼', '캐릭터 바꾸기 · 펫 상자 · 일시정지'],
  ] : [
    ['<kbd>WASD</kbd> / <kbd>방향키</kbd>', '움직이기'],
    ['<kbd>Space</kbd> / <kbd>K</kbd>', '점프 · 하늘에서 다시 누르면 둥실둥실 날기'],
    ['<kbd>J</kbd> / <kbd>X</kbd>', '공격 · 이야기하기'],
    ['<kbd>L</kbd> / <kbd>Shift</kbd>', '특기'],
    ['<kbd>Q</kbd> <kbd>E</kbd>', '카메라 돌리기'],
    ['<kbd>1</kbd> / <kbd>Tab</kbd>', '캐릭터 바꾸기'],
    ['<kbd>2</kbd> / <kbd>F</kbd>', '펫 상자'],
    ['<kbd>Esc</kbd> / <kbd>P</kbd>', '일시정지'],
    ['게임패드', 'A 점프 · X 공격 · Y 특기 · LB 캐릭터 · RB 펫'],
  ];
  for (const [k, v] of rows) g.append(h('div', { html: k }), h('div', {}, v));
  return g;
}
void PET_BY_ID;

// ============================================================================
// title.js — title screen: 3D dreamland backdrop, logo, blinking TOUCH,
// main menu, difficulty select.
// ============================================================================
import { Vec3, TAU } from '../../engine/math.js';
import { CTX, DIFFICULTY } from '../ctx.js';
import { Level } from '../world/level.js';
import { LevelBuilder } from '../world/builder.js';
import { buildAnimal } from '../models/animals.js';
import { buildWhale, buildPuffy } from '../models/npcs.js';
import { buildObject } from '../models/objects.js';
import { h, Screen } from '../ui/ui.js';
import { Overlay, logoHTML } from '../ui/overlay.js';
import { openSettings } from '../ui/menus.js';
import { ICON } from '../ui/icons.js';
import { Save } from '../save.js';
import { Audio } from '../../engine/audio.js';

const DIFF_CSS = `
.diffs { display: flex; gap: calc(var(--u)*2.6); flex-wrap: wrap; justify-content: center; }
.dcard { pointer-events: auto; cursor: pointer; width: calc(var(--u)*40); border: none; border-radius: calc(var(--u)*3.5); padding: calc(var(--u)*2.6) calc(var(--u)*2.4); background: var(--paper); box-shadow: 0 calc(var(--u)*0.8) 0 #d8c8ec, 0 calc(var(--u)*1.6) calc(var(--u)*3) rgba(30,10,60,.4); font-family: var(--font); color: var(--ink); display: flex; flex-direction: column; align-items: center; gap: calc(var(--u)*1.2); transition: transform .15s; }
.dcard .dn { font-size: calc(var(--u)*4.6); }
.dcard .dh { display: flex; gap: 2px; }
.dcard .dh svg { width: calc(var(--u)*3.6); height: calc(var(--u)*3.4); }
.dcard .dd { font-size: calc(var(--u)*2.3); line-height: 1.45; text-align: center; word-break: keep-all; color: var(--ink-soft); min-height: calc(var(--u)*10); }
.dcard.focus { transform: translateY(calc(var(--u)*-1)) scale(1.04); box-shadow: 0 0 0 calc(var(--u)*0.7) #fff, 0 0 0 calc(var(--u)*1.3) var(--pink), 0 calc(var(--u)*2) calc(var(--u)*3) rgba(30,10,60,.45); }
.title-menu { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom,0px) + var(--u)*8); transform: translateX(-50%); }
.title-top { position: absolute; top: calc(env(safe-area-inset-top,0px) + var(--u)*7); left: 0; right: 0; display: flex; justify-content: center; pointer-events: none; }
`;

export class TitleMode {
  constructor(o = {}) { this.isTitle = true; this.o = o; this.t = 0; }
  async enter() {
    if (!document.getElementById('diffcss')) { const s = document.createElement('style'); s.id = 'diffcss'; s.textContent = DIFF_CSS; document.head.appendChild(s); }
    const level = new Level({ killY: -100 });
    this.level = level;
    CTX.level = level; CTX.physics = level.physics;
    CTX.env.apply('title', { sat: 1, skySat: 1, particleRate: 1.5 });
    const L = new LevelBuilder(level, 'meadow');
    L.island(0, 0, 0, 7.5, { clear: [[0, 2.2, 2.6]], density: 1.1 });
    L.island(-15, 3.5, -8, 4.5, {});
    L.island(16, 5, -12, 5, {});
    L.island(-7, 9, -24, 4, {});
    L.island(10, -4, 6, 3.2, {});
    L.island(-12, -2, 9, 2.6, {});
    L.island(26, 9, -30, 6, {});
    L.island(-28, 6, -26, 5, {});
    level.finalize(CTX.scene);
    // actors
    this.cat = buildAnimal(Save.data && Save.data.currentChar && Save.hasChar(Save.data.currentChar) ? Save.data.currentChar : 'cat');
    this.cat.root.position.set(0, 0, 2.2);
    CTX.scene.add(this.cat.root);
    this.puffies = [];
    const pp = [[-2.2, 0.9, 0.4], [2.4, 1.2, 0.2], [-1.0, 2.6, -2.2], [1.8, 4.2, -1.6]];
    pp.forEach((p, i) => {
      const pf = buildPuffy(i + 1);
      pf.root.position.set(p[0], 0, p[1]);
      pf.root.rotation.y = p[2];
      CTX.scene.add(pf.root);
      this.puffies.push(pf);
    });
    this.lantern = buildObject('lantern', { color: 0xffd36b });
    this.lantern.root.position.set(4.2, 0, -2.2);
    this.lantern.setLit(true);
    CTX.scene.add(this.lantern.root);
    this.whale = buildWhale();
    this.whale.root.scale.set(1.3, 1.3, 1.3);
    CTX.scene.add(this.whale.root);
    this.whaleT = 0;
    CTX.cam.mode = 'manual';
    this.ui = document.getElementById('ui');
    this.showTouch();
    Audio.playMusic('title');
  }
  exit() {
    this.level.dispose();
    for (const n of [this.cat.root, this.lantern.root, this.whale.root, ...this.puffies.map((p) => p.root)]) n.removeFromParent();
    if (this.el) this.el.remove();
    CTX.ui.clear();
    CTX.level = null;
    CTX.particles.clear();
  }
  // ------------------------------------------------------------------ screens
  showTouch() {
    const el = h('div', { class: 'screen title-screen' });
    el.innerHTML = `<div class="title-top">${logoHTML()}</div><div style="flex:1.5"></div><div class="touch-prompt">TOUCH</div><div style="flex:1"></div><div class="title-foot">소미를 위해 만든 꿈나라 모험 · 버전 0.1</div>`;
    this.ui.appendChild(el);
    this.el = el;
    let done = false;
    const go = (e) => {
      if (done) return;
      done = true;
      if (e && e.preventDefault) e.preventDefault();
      Overlay.requestFullscreen();
      Audio.init();
      Audio.resume();
      Audio.playMusic('title');
      Audio.sfx('sparkle');
      CTX.fx.flash('#ffffff', 0.4, 0.5);
      el.remove();
      CTX.input.onAny(null);
      this.showMenu();
    };
    // click (not pointerdown): only a completed tap counts as user activation, which fullscreen requires
    el.addEventListener('click', go);
    setTimeout(() => CTX.input.onAny((kind) => { if (kind !== 'pointer') go(); }), 250);
  }
  showMenu() {
    const has = Save.hasSave();
    const el = h('div', { class: 'screen', style: 'pointer-events:none' });
    el.innerHTML = `<div class="title-top">${logoHTML()}</div>`;
    const list = h('div', { class: 'menu-list title-menu', style: 'pointer-events:auto' });
    const btn = (txt, cls, fn, af) => h('button', { class: 'btn ' + cls, 'data-nav': '1', 'data-autofocus': af ? '1' : null, onclick: () => { Audio.sfx('menuSelect'); fn(); } }, txt);
    if (has) list.append(btn('이어하기', '', () => this.continueGame(), true));
    list.append(btn('처음부터', has ? 'alt' : '', () => this.newGame(), !has));
    list.append(btn('설정', 'ghost', () => openSettings({})));
    el.append(list);
    this.menuScreen = CTX.ui.push(new Screen(el, {}));
  }
  async newGame() {
    if (Save.hasSave()) {
      const ok = await CTX.ui.confirm('처음부터 시작하면 지금까지의 모험 기록이 지워져요. 괜찮아요?', '새로 시작', '취소');
      if (!ok) return;
    }
    this.showDifficulty();
  }
  showDifficulty() {
    const el = h('div', { class: 'screen mscreen', style: 'flex-direction:column;gap:calc(var(--u)*3);background:rgba(28,14,56,.5)' });
    el.append(h('div', { class: 'mtitle', style: 'font-size:calc(var(--u)*5);color:#fff;text-shadow:0 3px 0 var(--pink-d)' }, '난이도를 골라요'));
    const row = h('div', { class: 'diffs' });
    let sc;
    for (const d of Object.values(DIFFICULTY)) {
      const hearts = Array.from({ length: d.maxHp }, () => ICON.heart).join('');
      const c = h('button', { class: 'dcard', 'data-nav': '1', 'data-autofocus': d.id === 'normal' ? '1' : null, onclick: () => { Audio.sfx('menuSelect'); CTX.ui.pop(sc); this.start(d.id); } },
        h('div', { class: 'dn', style: `color:${d.color}` }, d.name), h('div', { class: 'dh', html: hearts }), h('div', { class: 'dd' }, d.desc));
      row.append(c);
    }
    el.append(row, h('div', { style: 'color:#fff;font-size:calc(var(--u)*2.3);opacity:.85' }, '난이도는 나중에 설정에서 언제든지 바꿀 수 있어요.'));
    el.append(h('button', { class: 'btn ghost small', 'data-nav': '1', onclick: () => { Audio.sfx('menuSelect'); CTX.ui.pop(sc); } }, '뒤로'));
    // hide the main menu underneath while choosing
    const menuEl = this.menuScreen && this.menuScreen.el;
    if (menuEl) menuEl.style.visibility = 'hidden';
    sc = CTX.ui.push(new Screen(el, { onBack: () => CTX.ui.pop(sc), onClose: () => { if (menuEl) menuEl.style.visibility = ''; } }));
  }
  async start(diffId) {
    Save.newGame(diffId);
    CTX.diff = DIFFICULTY[diffId];
    CTX.ui.clear();
    const { playOpening } = await import('../story/sequences.js');
    CTX.game.transition(() => playOpening(CTX.game), 0.8);
  }
  async continueGame() {
    Save.loadGame();
    CTX.diff = DIFFICULTY[Save.data.difficulty] || DIFFICULTY.normal;
    CTX.ui.clear();
    const { MapMode } = await import('./map.js');
    CTX.game.transition(() => CTX.game.setMode(new MapMode({ focus: Save.data.lastStage || 1 })));
  }
  // ------------------------------------------------------------------ frame
  update(dt) {
    this.t += dt;
    const t = this.t;
    const cam = CTX.camera;
    const yaw = Math.sin(t * 0.07) * 0.32;
    cam.position.set(Math.sin(yaw) * 13.5, 3.2 + Math.sin(t * 0.13) * 0.4, Math.cos(yaw) * 13.5);
    cam.target.set(0, 4.6, 0);
    cam.fov = 50 * Math.PI / 180;
    this.cat.update(dt, { anim: Math.sin(t * 0.5) > 0.6 ? 'wave' : 'idle', t, speed: 0 });
    this.cat.root.rotation.y = Math.sin(t * 0.3) * 0.25;
    this.puffies.forEach((p, i) => p.update(dt, { anim: (Math.floor(t / 3 + i) % 3 === 0) ? 'happy' : 'idle', t: t + i }));
    this.lantern.update(dt);
    this.whaleT += dt * 0.11;
    const a = this.whaleT;
    this.whale.root.position.set(Math.sin(a) * 30, 12.5 + Math.sin(a * 2) * 1.5, -28 + Math.cos(a) * 14);
    this.whale.root.rotation.y = a + Math.PI / 2;
    this.whale.update(dt, { anim: 'swim', t: this.t });
    CTX.env.update(dt, new Vec3(0, 2, 0), cam);
    CTX.fx.update(dt);
    CTX.particles.update(dt, cam);
    CTX.shadows.begin();
    CTX.shadows.push(this.cat.root.position.x, 0.03, this.cat.root.position.z, 1.1, 0.16, 0.1, 0.3, 0.35, 0, 14);
    for (const p of this.puffies) CTX.shadows.push(p.root.position.x, 0.03, p.root.position.z, 0.7, 0.16, 0.1, 0.3, 0.3, 0, 14);
    void TAU;
  }
}

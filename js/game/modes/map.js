// ============================================================================
// map.js — world map "꿈나라 지도": 8 themed islands in a ring around the
// Dream Tree; hop between unlocked islands, start stages, open menus.
// ============================================================================
import { Vec3, TAU, damp, dampAngle, Ease, rgb, lerp } from '../../engine/math.js';
import { Mesh, Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX, DIFFICULTY } from '../ctx.js';
import { Level } from '../world/level.js';
import { LevelBuilder, DECOR_SETS } from '../world/builder.js';
import { THEMES } from '../world/env.js';
import { STAGES, STAGE_IDS } from '../data/stages.js';
import { COOKIE_STAGE } from '../data/characters.js';
import { PET_STAGE } from '../data/pets.js';
import { buildAnimal } from '../models/animals.js';
import { buildObject } from '../models/objects.js';
import { buildPuffy, buildWhale } from '../models/npcs.js';
import { buildRainbowSegment } from '../models/platforms.js';
import { h, Screen } from '../ui/ui.js';
import { ICON } from '../ui/icons.js';
import { openCharSelect, openPetBox, openSettings } from '../ui/menus.js';
import { Save } from '../save.js';
import { Audio } from '../../engine/audio.js';

const MAP_CSS = `
.mapui { position: absolute; inset: 0; pointer-events: none; }
.mapbar { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom,0px) + var(--u)*2.4); transform: translateX(-50%); display: flex; align-items: center; gap: calc(var(--u)*2); pointer-events: none; }
.mapcard { pointer-events: auto; min-width: calc(var(--u)*62); padding: calc(var(--u)*1.8) calc(var(--u)*3.4); display: flex; flex-direction: column; align-items: center; gap: calc(var(--u)*0.8); }
.mapcard .sn { font-size: calc(var(--u)*2.4); color: var(--ink-soft); }
.mapcard .nm { font-size: calc(var(--u)*4.4); color: var(--pink-d); }
.mapcard .st { display: flex; gap: calc(var(--u)*1.6); font-size: calc(var(--u)*2.6); color: var(--ink); flex-wrap: wrap; justify-content: center; }
.mapcard .st span { display: inline-flex; align-items: center; gap: calc(var(--u)*0.6); }
.mapcard .st svg { width: calc(var(--u)*3.4); height: calc(var(--u)*3.4); }
.mapcard .clr { font-size: calc(var(--u)*2.2); color: #fff; background: var(--mint); border-radius: 999px; padding: 0 calc(var(--u)*1.6); }
.arrowbtn { pointer-events: auto; width: calc(var(--u)*11); height: calc(var(--u)*11); border-radius: 50%; padding: 0; font-size: calc(var(--u)*5); display: flex; align-items: center; justify-content: center; }
.arrowbtn svg { width: 55%; height: 55%; }
.maptop { position: absolute; right: calc(env(safe-area-inset-right,0px) + var(--u)*2.4); top: calc(env(safe-area-inset-top,0px) + var(--u)*2.4); display: flex; gap: calc(var(--u)*1.4); pointer-events: auto; }
.maptl { position: absolute; left: calc(env(safe-area-inset-left,0px) + var(--u)*2.4); top: calc(env(safe-area-inset-top,0px) + var(--u)*2.4); display: flex; flex-direction: column; gap: calc(var(--u)*1); pointer-events: none; }
.maptl .ttl { font-size: calc(var(--u)*4); color: #fff; text-shadow: 0 3px 0 var(--lilac-d), 0 0 calc(var(--u)*2) rgba(80,40,140,.6); }
.colors { display: flex; gap: calc(var(--u)*0.8); }
.colors i { width: calc(var(--u)*3.4); height: calc(var(--u)*3.4); border-radius: 50%; border: calc(var(--u)*0.4) solid #fff; box-shadow: 0 2px 4px rgba(40,20,70,.3); display: block; }
.colors i.off { background: rgba(255,255,255,.25) !important; }
`;

export class MapMode {
  constructor(o = {}) { this.o = o; this.t = 0; this.sel = o.focus || 1; this.hop = null; }
  async enter() {
    if (!document.getElementById('mapcss')) { const s = document.createElement('style'); s.id = 'mapcss'; s.textContent = MAP_CSS; document.head.appendChild(s); }
    if (!Save.data) Save.loadGame();
    CTX.diff = DIFFICULTY[Save.data.difficulty] || DIFFICULTY.normal;
    const cleared = STAGE_IDS.filter((i) => Save.stage(i).cleared).length;
    this.clearedN = cleared;
    const level = new Level({ killY: -100 });
    this.level = level; CTX.level = level; CTX.physics = level.physics;
    CTX.env.apply('map', { sat: 0.35 + 0.65 * (cleared / 8), skySat: 0.55 + 0.45 * (cleared / 8), particleRate: 1 });
    // islands
    this.isl = [];
    const R = 27;
    const heights = [0, 2.5, 5, 3.5, 6, 8.5, 7, 10.5];
    for (let k = 0; k < 8; k++) {
      const id = k + 1;
      const a = Math.PI + (k / 8) * TAU;
      const x = Math.sin(a) * R, z = Math.cos(a) * R, y = heights[k];
      const theme = STAGES[id].theme;
      const L = new LevelBuilder(level, theme);
      L.island(x, y, z, 6.2, { density: 0.9, clear: [[x, z, 2.2]], depth: 9 });
      // signature props
      const D = DECOR_SETS[theme];
      L.prop(D.big[0], x + 2.6, y, z - 2.0, { seed: id, s: 1.1 });
      L.prop(D.big[1] || D.big[0], x - 2.8, y, z - 1.4, { seed: id + 3 });
      this.isl.push({ id, pos: new Vec3(x, y, z), a, theme });
    }
    // center island with dream tree
    const LC = new LevelBuilder(level, 'moon');
    LC.island(0, 4, 0, 9, { density: 0.5, clear: [[0, 0, 3]], depth: 12 });
    LC.prop('crystalTree', 0, 4, 0, { s: 2.2, seed: 2 });
    LC.prop('starLamp', 4, 4, 3, { seed: 1 });
    LC.prop('starLamp', -4, 4, -3, { seed: 3 });
    level.finalize(CTX.scene);
    // saturation spots on cleared islands
    for (const is of this.isl) if (Save.stage(is.id).cleared) CTX.env.addSpot(is.pos.x, is.pos.y, is.pos.z, 16, true);
    // markers & bridges
    this.root = new Node('mapdeco');
    CTX.scene.add(this.root);
    this.markers = [];
    for (const is of this.isl) {
      const unlocked = is.id <= Save.data.unlockedStage;
      const done = Save.stage(is.id).cleared;
      const lan = buildObject('lantern', { color: STAGES[is.id].color });
      lan.root.position.set(is.pos.x + 1.6, is.pos.y, is.pos.z + 1.2);
      if (done) lan.setLit(true);
      this.root.add(lan.root);
      const flag = buildObject('signBoard', { icon: done ? 'star' : unlocked ? '!' : '?' });
      flag.root.position.set(is.pos.x - 1.7, is.pos.y, is.pos.z + 1.6);
      flag.root.rotation.y = is.a + Math.PI;
      this.root.add(flag.root);
      this.markers.push({ lan, flag, is, unlocked, done });
    }
    // light bridges between consecutive islands
    for (let k = 0; k < 7; k++) {
      const a = this.isl[k].pos, b = this.isl[k + 1].pos;
      const open = this.isl[k + 1].id <= Save.data.unlockedStage;
      const n = 9;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const p = new Vec3().lerpVectors(a, b, t);
        p.y += Math.sin(t * Math.PI) * 4 + 0.6;
        const m = new Mesh(G.UNIT.star(), new Material({ color: open ? 0xffe66a : 0xb8b0d0, emissive: open ? 0x5a4810 : 0x101018, spec: 0.5, rim: 0.5 }));
        m.position.copy(p); m.scale.set(0.5, 0.5, 0.5);
        m.userData.spin = i * 0.6;
        this.root.add(m);
      }
    }
    // rescued puffies around the center tree
    this.puffies = [];
    const total = Save.totalPuffies();
    const show = Math.min(12, total);
    for (let i = 0; i < show; i++) {
      const p = buildPuffy(i % 6);
      const a = (i / Math.max(1, show)) * TAU;
      p.root.position.set(Math.sin(a) * 5.5, 4, Math.cos(a) * 5.5);
      p.root.rotation.y = a;
      this.root.add(p.root);
      this.puffies.push(p);
    }
    // sleeping whale above the center (gray until the end)
    this.whale = buildWhale();
    this.whale.setFogged(Save.data.seenEnding ? 0 : 0.85);
    this.whale.root.position.set(0, 21, -4);
    this.whale.root.scale.set(1.4, 1.4, 1.4);
    this.root.add(this.whale.root);
    // player marker
    this.avatar = buildAnimal(Save.data.currentChar && Save.hasChar(Save.data.currentChar) ? Save.data.currentChar : 'cat');
    this.root.add(this.avatar.root);
    this.sel = Math.min(Math.max(1, this.sel), Save.data.unlockedStage);
    const is0 = this.isl[this.sel - 1];
    this.avatar.root.position.copy(is0.pos);
    this.camYaw = is0.a; this.camTarget = is0.pos.clone();
    this.buildUI();
    Audio.playMusic('map');
    CTX.cam.mode = 'manual';
    if (this.o.justCleared) setTimeout(() => this.celebrateUnlock(this.o.justCleared), 600);
  }
  exit() {
    this.level.dispose();
    this.root.removeFromParent();
    if (this.ui) this.ui.remove();
    CTX.ui.clear();
    CTX.particles.clear();
    CTX.level = null;
  }
  buildUI() {
    const ui = h('div', { class: 'mapui' });
    const colors = h('div', { class: 'colors' });
    for (const id of STAGE_IDS) { const c = STAGES[id].color; colors.append(h('i', { class: Save.stage(id).cleared ? '' : 'off', style: `background:#${c.toString(16).padStart(6, '0')}` })); }
    ui.append(h('div', { class: 'maptl' }, h('div', { class: 'ttl' }, '꿈나라 지도'), colors,
      h('div', { style: 'font-size:calc(var(--u)*2.4);color:#fff;text-shadow:0 2px 0 var(--lilac-d)' }, `구한 뭉실이 ${Save.totalPuffies()}/40 · 친구 ${Save.data.chars.length}/30 · 펫 ${Object.keys(Save.data.pets).length}/15`)));
    const small = (svg, label, fn) => h('button', { class: 'tbtn tbtn-small', style: 'position:relative;top:auto;right:auto', 'aria-label': label, onclick: () => { Audio.sfx('menuSelect'); fn(); } }, h('span', { html: svg, style: 'width:60%;height:60%;display:flex' }));
    ui.append(h('div', { class: 'maptop' },
      small(`<svg viewBox="0 0 64 64"><circle cx="32" cy="36" r="17" fill="#e0488a"/><path d="M17 28 L14 10 L28 20 Z M47 28 L50 10 L36 20 Z" fill="#e0488a"/></svg>`, '캐릭터', () => this.openChars()),
      small(`<svg viewBox="0 0 64 64"><ellipse cx="32" cy="36" rx="9" ry="13" fill="#7a58e8"/><ellipse cx="18" cy="26" rx="12" ry="8" fill="#7a58e8" opacity=".75"/><ellipse cx="46" cy="26" rx="12" ry="8" fill="#7a58e8" opacity=".75"/></svg>`, '펫', () => this.openPets()),
      small(`<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="10" fill="none" stroke="#4a3566" stroke-width="7"/><path d="M32 8 V16 M32 48 V56 M8 32 H16 M48 32 H56 M15 15 L21 21 M43 43 L49 49 M49 15 L43 21 M21 43 L15 49" stroke="#4a3566" stroke-width="6" stroke-linecap="round"/></svg>`, '설정', () => openSettings({})),
      small(`<svg viewBox="0 0 64 64"><path d="M12 30 L32 12 L52 30 V52 H12 Z" fill="#4a3566"/><rect x="26" y="36" width="12" height="16" fill="#fff"/></svg>`, '타이틀', () => this.toTitle())));
    const card = h('div', { class: 'panel mapcard' });
    this.card = card;
    const left = h('button', { class: 'btn ghost arrowbtn', 'data-nav': '1', onclick: () => this.move(-1), html: ICON.back });
    const right = h('button', { class: 'btn ghost arrowbtn', 'data-nav': '1', onclick: () => this.move(1), html: ICON.back.replace('M28 10 L14 24 L28 38', 'M20 10 L34 24 L20 38') });
    this.goBtn = h('button', { class: 'btn', 'data-nav': '1', 'data-autofocus': '1', onclick: () => this.go() }, '출발!');
    ui.append(h('div', { class: 'mapbar' }, left, card, this.goBtn, right));
    document.getElementById('ui').appendChild(ui);
    this.ui = ui;
    this.screen = CTX.ui.push(new Screen(h('div', { style: 'display:none' }), { noNav: true }));
    this.updateCard();
  }
  updateCard() {
    const id = this.sel;
    const def = STAGES[id];
    const sd = Save.stage(id);
    const cookiesTot = Object.values(COOKIE_STAGE).filter((s) => s === id).length;
    const petsTot = Object.values(PET_STAGE).filter((s) => s === id).length;
    const petsGot = Object.keys(Save.data.pets).filter((p) => PET_STAGE[p] === id).length;
    this.card.innerHTML = '';
    this.card.append(h('div', { class: 'sn' }, `스테이지 ${id} · ${def.sub}`), h('div', { class: 'nm' }, def.name),
      h('div', { class: 'st', html: `<span>${ICON.puffy}${sd.puffies.length}/5</span><span>${ICON.cookie}${sd.cookies.length}/${cookiesTot}</span><span>${ICON.star}펫 ${petsGot}/${petsTot}</span>${sd.cleared ? '<span class="clr">클리어!</span>' : ''}` }));
  }
  move(d) {
    if (this.hop) return;
    const n = this.sel + d;
    if (n < 1 || n > 8) { Audio.sfx('menuBack'); return; }
    if (n > Save.data.unlockedStage) { Audio.sfx('fail'); CTX.hud.toast ? null : null; this.lockedNote(); return; }
    Audio.sfx('jump');
    const from = this.isl[this.sel - 1].pos.clone(), to = this.isl[n - 1].pos.clone();
    this.hop = { from, to, t: 0, dur: 0.9 };
    this.sel = n;
    this.updateCard();
  }
  lockedNote() {
    if (this._ln) return;
    this._ln = h('div', { class: 'toast warn', style: 'position:absolute;left:50%;top:22%;transform:translateX(-50%)' }, '아직 갈 수 없어요. 앞 스테이지를 먼저 클리어해요!');
    document.getElementById('ui').appendChild(this._ln);
    setTimeout(() => { this._ln.remove(); this._ln = null; }, 1800);
  }
  async go() {
    Audio.sfx('menuSelect');
    if (this.going) return;
    this.going = true;
    const { StageMode } = await import('./stage.js');
    Save.data.currentChar = Save.data.currentChar || 'cat';
    CTX.game.transition(() => CTX.game.setMode(new StageMode(this.sel)), 0.6);
  }
  openChars() {
    openCharSelect({ onPick: (id) => {
      Save.data.currentChar = id; Save.write();
      const p = this.avatar.root.position.clone();
      this.avatar.root.removeFromParent();
      this.avatar = buildAnimal(id);
      this.avatar.root.position.copy(p);
      this.root.add(this.avatar.root);
      CTX.fx.poof(new Vec3(p.x, p.y + 0.6, p.z));
      Audio.sfx('transform');
    } });
  }
  openPets() { openPetBox({}); }
  async toTitle() {
    const { TitleMode } = await import('./title.js');
    CTX.game.transition(() => CTX.game.setMode(new TitleMode()));
  }
  celebrateUnlock(id) {
    const is = this.isl[id - 1];
    CTX.fx.colorBloom(is.pos, rgb(STAGES[id].color), 10);
    Audio.jingle('colorRestore');
    const next = id < 8 ? this.isl[id] : null;
    if (next) setTimeout(() => { CTX.fx.colorBloom(next.pos, [1, 1, 1], 6); this.showToast('새로운 섬으로 가는 길이 열렸어요!'); }, 1400);
  }
  showToast(t) {
    const el = h('div', { class: 'toast good', style: 'position:absolute;left:50%;top:20%;transform:translateX(-50%)' }, t);
    document.getElementById('ui').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  // ------------------------------------------------------------------ frame
  update(dt) {
    this.t += dt;
    const I = CTX.input;
    if (!CTX.ui.busy() || CTX.ui.top() === this.screen) {
      const d = I.menuDir(dt);
      if (d === 'left') this.move(-1); else if (d === 'right') this.move(1);
      if (I.pressed('confirm') || I.pressed('jump')) this.go();
      if (I.pressed('char')) this.openChars();
      if (I.pressed('pet')) this.openPets();
      if (I.pressed('back') || I.pressed('pause')) openSettings({});
    }
    // avatar hop
    const av = this.avatar;
    if (this.hop) {
      const hp = this.hop;
      hp.t += dt;
      const k = Math.min(1, hp.t / hp.dur);
      const p = new Vec3().lerpVectors(hp.from, hp.to, Ease.inOutSine(k));
      p.y += Math.sin(k * Math.PI) * 6;
      av.root.position.copy(p);
      av.root.rotation.y = Math.atan2(hp.to.x - hp.from.x, hp.to.z - hp.from.z);
      av.update(dt, { anim: k < 0.9 ? 'hover' : 'fall', t: hp.t, speed: 0 });
      if (Math.random() < dt * 20) CTX.fx.rainbowTrail(new Vec3(p.x, p.y + 0.5, p.z));
      if (k >= 1) { this.hop = null; Audio.sfx('land'); CTX.fx.landing(av.root.position, 0.8); }
    } else {
      const is = this.isl[this.sel - 1];
      av.root.rotation.y = dampAngle(av.root.rotation.y, is.a + Math.PI, 4, dt);
      av.update(dt, { anim: Math.sin(this.t * 0.6) > 0.7 ? 'wave' : 'idle', t: this.t, speed: 0 });
    }
    // camera: outside the ring looking at the selected island
    const is = this.isl[this.sel - 1];
    this.camYaw = dampAngle(this.camYaw, is.a, 2.2, dt);
    this.camTarget.damp(is.pos, 2.2, dt);
    const cam = CTX.camera;
    const dist = 15;
    cam.position.set(this.camTarget.x + Math.sin(this.camYaw) * dist, this.camTarget.y + 7.5, this.camTarget.z + Math.cos(this.camYaw) * dist);
    cam.target.set(this.camTarget.x * 0.8, this.camTarget.y + 2.2, this.camTarget.z * 0.8);
    cam.fov = 50 * Math.PI / 180;
    // spin bridge stars, puffies
    for (const n of this.root.children) if (n.userData.spin !== undefined) n.rotation.y = this.t * 1.5 + n.userData.spin;
    this.puffies.forEach((p, i) => p.update(dt, { anim: (Math.floor(this.t / 2.5 + i) % 4 === 0) ? 'cheer' : 'idle', t: this.t + i }));
    for (const m of this.markers) { m.lan.update(dt); m.flag.update(dt); }
    this.whale.update(dt, { anim: Save.data.seenEnding ? 'swim' : 'sleep', t: this.t });
    this.whale.root.position.y = 21 + Math.sin(this.t * 0.5) * 0.6;
    CTX.env.update(dt, this.camTarget, cam);
    CTX.fx.update(dt);
    CTX.particles.update(dt, cam);
    CTX.shadows.begin();
    CTX.shadows.push(av.root.position.x, this.hop ? lerp(this.hop.from.y, this.hop.to.y, Math.min(1, this.hop.t / this.hop.dur)) + 0.03 : av.root.position.y + 0.03, av.root.position.z, 1.0, 0.16, 0.1, 0.3, 0.35, 0, 14);
    void THEMES;
  }
}

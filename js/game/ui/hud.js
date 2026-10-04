// ============================================================================
// hud.js — in-game HUD: hearts, character/pet portraits, counters, toasts,
// banners, boss bar, gauges, floating texts, hint arrows, prompts.
// ============================================================================
import { CTX } from '../ctx.js';
import { ICON } from './icons.js';
import { charPortrait, petPortrait } from './portraits.js';
import { CHAR_BY_ID } from '../data/characters.js';
import { PET_BY_ID, petLevelProgress } from '../data/pets.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

export class HUD {
  constructor(root) {
    this.root = el('div', 'hud');
    root.appendChild(this.root);
    // top-left
    const tl = el('div', 'hud-tl');
    this.charPortrait = el('div', 'portrait');
    this.charImg = el('img'); this.charImg.alt = '';
    this.charPortrait.appendChild(this.charImg);
    const info = el('div', 'hud-info');
    this.charName = el('div', 'char-name');
    this.hearts = el('div', 'hearts');
    this.gauge = el('div', 'gauge hidden', '<i></i><span></span>');
    info.append(this.charName, this.hearts, this.gauge);
    this.petWrap = el('div', 'pet-wrap hidden');
    this.petPortrait = el('div', 'portrait pet');
    this.petImg = el('img'); this.petImg.alt = '';
    this.petPortrait.appendChild(this.petImg);
    this.petLv = el('div', 'pet-lv', 'Lv1');
    this.petXp = el('div', 'pet-xp', '<i></i>');
    this.petWrap.append(this.petPortrait, this.petLv, this.petXp);
    tl.append(this.charPortrait, info, this.petWrap);
    this.root.appendChild(tl);
    // top-right
    const tr = el('div', 'hud-tr');
    this.candyEl = el('div', 'counter', `<span class="ico">${ICON.candy}</span><b>0</b>`);
    this.puffyEl = el('div', 'counter', `<span class="ico">${ICON.puffy}</span><b>0/5</b>`);
    this.keyEl = el('div', 'keyicon hidden', ICON.key);
    tr.append(this.candyEl, this.puffyEl, this.keyEl);
    this.root.appendChild(tr);
    // toasts & banners
    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);
    this.bannerEl = el('div', 'banner hidden');
    this.root.appendChild(this.bannerEl);
    this.boss = el('div', 'bossbar hidden', '<div class="nm"></div><div class="bar"><i></i><b></b></div>');
    this.root.appendChild(this.boss);
    this.heldEl = el('div', 'held hidden');
    this.root.appendChild(this.heldEl);
    this.arrowEl = el('div', 'arrow-hint hidden', ICON.arrow);
    this.root.appendChild(this.arrowEl);
    this.floatLayer = el('div', '');
    this.root.appendChild(this.floatLayer);
    this.promptEl = el('div', 'prompt hidden');
    this.root.appendChild(this.promptEl);
    this.hp = -1; this.maxHp = -1;
    this.arrowTarget = null; this.arrowT = 0;
    this.prompt = null;
  }
  show(v) { this.root.classList.toggle('off', !v); this.visible = v; }
  setCharacter(id) {
    const c = CHAR_BY_ID[id];
    this.charName.textContent = c ? c.name : '';
    try { this.charImg.src = charPortrait(id); } catch (e) { /* ignore */ }
    this.charPortrait.style.boxShadow = `0 0 0 calc(var(--u) * 0.45) ${c ? c.color : '#ff6fa8'}, 0 calc(var(--u) * 0.8) calc(var(--u) * 1.6) rgba(60,30,90,.35)`;
  }
  setPet(id, xp) {
    if (!id) { this.petWrap.classList.add('hidden'); return; }
    this.petWrap.classList.remove('hidden');
    if (this._petId !== id) { this._petId = id; try { this.petImg.src = petPortrait(id); } catch (e) { /* ignore */ } }
    const pr = petLevelProgress(xp || 0);
    this.petLv.textContent = 'Lv' + pr.lv;
    this.petXp.firstChild.style.width = Math.round(pr.frac * 100) + '%';
    void PET_BY_ID;
  }
  setHp(hp, max, hurt = false) {
    if (this.maxHp !== max) {
      this.hearts.innerHTML = '';
      for (let i = 0; i < max; i++) this.hearts.appendChild(el('div', 'heart', ICON.heart));
      this.maxHp = max;
      this.hp = -1;
    }
    const hs = this.hearts.children;
    for (let i = 0; i < max; i++) {
      const full = i < hp;
      const was = i < this.hp;
      hs[i].classList.toggle('empty', !full);
      if (this.hp >= 0 && full !== was) {
        hs[i].classList.remove('pop', 'lost'); void hs[i].offsetWidth;
        hs[i].classList.add(full ? 'pop' : 'lost');
      }
    }
    this.hp = hp;
    void hurt;
  }
  setCandies(n) {
    const b = this.candyEl.querySelector('b');
    if (b.textContent !== String(n)) {
      b.textContent = String(n);
      this.candyEl.classList.remove('bump'); void this.candyEl.offsetWidth; this.candyEl.classList.add('bump');
    }
  }
  setPuffies(n, total = 5) { this.puffyEl.querySelector('b').textContent = `${n}/${total}`; this.puffyEl.classList.remove('bump'); void this.puffyEl.offsetWidth; this.puffyEl.classList.add('bump'); }
  setKey(v) { this.keyEl.classList.toggle('hidden', !v); }
  setGauge(frac, label) {
    if (frac === null || frac === undefined) { this.gauge.classList.add('hidden'); return; }
    this.gauge.classList.remove('hidden');
    this.gauge.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    this.gauge.lastChild.textContent = label || '';
  }
  setHeld(text) { if (!text) this.heldEl.classList.add('hidden'); else { this.heldEl.textContent = text; this.heldEl.classList.remove('hidden'); } }
  toast(text, kind = '', dur = 2.6) {
    const t = el('div', 'toast ' + kind, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, dur * 1000);
  }
  banner(big, sub = '', dur = 2.4) {
    this.bannerEl.innerHTML = `<div class="big">${big}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.bannerEl.classList.remove('hidden');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.bannerEl.classList.add('hidden'), dur * 1000);
  }
  bossShow(name, frac) {
    if (name === null) { this.boss.classList.add('hidden'); return; }
    this.boss.classList.remove('hidden');
    this.boss.querySelector('.nm').textContent = name;
    this.bossSet(frac ?? 1);
  }
  bossSet(frac) {
    this.boss.querySelector('i').style.transform = `scaleX(${Math.max(0, frac)})`;
    this.boss.querySelector('b').style.transform = `scaleX(${Math.max(0, frac)})`;
  }
  floatText(pos, str, cls = '') {
    const cam = CTX.camera;
    const p = cam.project(pos);
    if (!p.visible) return;
    const t = el('div', 'float-text ' + cls, str);
    t.style.left = (p.x * 100) + '%'; t.style.top = (p.y * 100) + '%';
    this.floatLayer.appendChild(t);
    setTimeout(() => t.remove(), 1000);
  }
  // world-anchored prompt bubble (e.g., "대화하기")
  setPrompt(pos, text) { this.prompt = pos ? { pos, text } : null; }
  // point at a secret
  pointAt(pos, dur = 8) { this.arrowTarget = pos; this.arrowT = dur; }
  update(dt) {
    if (this.prompt) {
      const p = CTX.camera.project(this.prompt.pos);
      if (p.visible) {
        this.promptEl.classList.remove('hidden');
        this.promptEl.textContent = this.prompt.text;
        this.promptEl.style.left = (p.x * 100) + '%'; this.promptEl.style.top = (p.y * 100) + '%';
      } else this.promptEl.classList.add('hidden');
    } else this.promptEl.classList.add('hidden');
    if (this.arrowT > 0 && this.arrowTarget) {
      this.arrowT -= dt;
      const p = CTX.camera.project(this.arrowTarget);
      const cx = 0.5, cy = 0.5;
      let dx = p.x - cx, dy = p.y - cy;
      if (!p.visible && p.z > 1) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(dy, dx);
      let x, y;
      if (p.visible && p.x > 0.08 && p.x < 0.92 && p.y > 0.1 && p.y < 0.9) { x = p.x; y = p.y - 0.09; this.arrowEl.style.transform = `rotate(180deg)`; }
      else { const r = 0.4; x = cx + Math.cos(ang) * r; y = cy + Math.sin(ang) * r * 0.85; this.arrowEl.style.transform = `rotate(${ang + Math.PI / 2}rad)`; }
      this.arrowEl.style.left = (x * 100) + '%'; this.arrowEl.style.top = (y * 100) + '%';
      this.arrowEl.classList.remove('hidden');
      if (this.arrowT <= 0) this.arrowEl.classList.add('hidden');
    }
  }
  reset() {
    this.setGauge(null); this.setHeld(null); this.setKey(false); this.bossShow(null); this.arrowT = 0; this.arrowEl.classList.add('hidden'); this.prompt = null;
    this.toasts.innerHTML = '';
  }
}

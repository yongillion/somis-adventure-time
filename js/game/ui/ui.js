// ============================================================================
// ui.js — modal UI framework: screen stack with spatial navigation
// (keyboard / gamepad / touch), dialog boxes with typewriter text & choices.
// ============================================================================
import { Orient } from '../../engine/orient.js';
import { CTX } from '../ctx.js';
import { charPortrait, petPortrait, npcPortrait } from './portraits.js';

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };

export class Screen {
  constructor(el, o = {}) {
    this.el = el;
    this.onBack = o.onBack || null;
    this.focusEl = null;
    this.noNav = !!o.noNav;
    this.onOpen = o.onOpen || null;
    this.onClose = o.onClose || null;
    this.onUpdate = o.onUpdate || null;
    this.onTab = o.onTab || null;
  }
  items() { return [...this.el.querySelectorAll('[data-nav]:not([disabled]):not(.hidden)')].filter((e) => e.offsetParent !== null); }
  focus(e) {
    if (this.focusEl) this.focusEl.classList.remove('focus');
    this.focusEl = e;
    if (e) {
      e.classList.add('focus');
      if (e.scrollIntoView) e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (e._onFocus) e._onFocus();
    }
  }
  nav(dir) {
    const items = this.items();
    if (!items.length) return;
    if (!this.focusEl || !items.includes(this.focusEl)) { this.focus(items[0]); return; }
    // compare positions in the landscape game box (screen rects are turned on portrait phones)
    const center = (el) => { const r = el.getBoundingClientRect(); return Orient.toLocal(r.left + r.width / 2, r.top + r.height / 2); };
    const [cx, cy] = center(this.focusEl);
    let best = null, bs = Infinity;
    for (const e of items) {
      if (e === this.focusEl) continue;
      const [x, y] = center(e);
      const dx = x - cx, dy = y - cy;
      let primary, secondary;
      if (dir === 'left') { if (dx > -4) continue; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'right') { if (dx < 4) continue; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'up') { if (dy > -4) continue; primary = -dy; secondary = Math.abs(dx); }
      else { if (dy < 4) continue; primary = dy; secondary = Math.abs(dx); }
      const score = primary + secondary * 2.2;
      if (score < bs) { bs = score; best = e; }
    }
    if (best) { this.focus(best); sfx('menuMove'); }
  }
  activate() { if (this.focusEl) { this.focusEl.classList.add('pressed'); setTimeout(() => this.focusEl && this.focusEl.classList.remove('pressed'), 120); this.focusEl.click(); } }
}

export class UI {
  constructor(root) {
    this.root = root;
    this.layer = h('div', { class: 'ui-layer', style: 'position:absolute;inset:0;pointer-events:none' });
    root.appendChild(this.layer);
    this.stack = [];
    this.dlg = null;
    CTX.ui = this;
  }
  busy() { return this.stack.length > 0 || !!this.dlg || !!(this._dlgQueue && this._dlgQueue.length); }
  top() { return this.stack[this.stack.length - 1] || null; }
  push(screen) {
    this.stack.push(screen);
    this.layer.appendChild(screen.el);
    screen.el.classList.add('fade-in');
    if (screen.onOpen) screen.onOpen(screen);
    if (!screen.noNav) {
      const items = screen.items();
      const pre = screen.el.querySelector('[data-autofocus]');
      if (!CTX.game || !CTX.game.touchMode) screen.focus(pre || items[0] || null);
    }
    CTX.input.clearAll();
    return screen;
  }
  pop(screen = null) {
    const s = screen || this.stack[this.stack.length - 1];
    if (!s) return;
    const i = this.stack.indexOf(s);
    if (i >= 0) this.stack.splice(i, 1);
    s.el.remove();
    if (s.onClose) s.onClose(s);
    CTX.input.clearAll();
  }
  clear() { while (this.stack.length) this.pop(); }
  update(dt) {
    const I = CTX.input;
    if (this.dlg) { this._dialogUpdate(dt); return; }
    const s = this.top();
    if (!s) return;
    if (s.onUpdate) s.onUpdate(dt);
    if (s.noNav) return;
    const d = I.menuDir(dt);
    if (d) s.nav(d);
    if (I.pressed('confirm') || I.pressed('attack') && false) { if (!s.focusEl) s.nav('down'); else s.activate(); }
    if (I.pressed('back') || I.pressed('pause') && s.closeOnPause) { if (s.onBack) { sfx('menuBack'); s.onBack(); } }
    if (s.onTab) { if (I.pressed('tabL')) s.onTab(-1); if (I.pressed('tabR')) s.onTab(1); }
  }

  // ------------------------------------------------------------------ dialog
  // seq: [{who, text, face, choices:[...]} ...] -> Promise (resolves to last choice index if any)
  dialog(seq) {
    // queue behind any dialog that is already showing (never overwrite it)
    if (this.dlg || (this._dlgQueue && this._dlgQueue.length)) {
      this._dlgQueue = this._dlgQueue || [];
      return new Promise((resolve) => this._dlgQueue.push({ seq, resolve }));
    }
    return this._openDialog(seq);
  }
  _flushDialogQueue() {
    if (this.dlg || !this._dlgQueue || !this._dlgQueue.length) return;
    const n = this._dlgQueue.shift();
    this._openDialog(n.seq).then(n.resolve);
  }
  _openDialog(seq) {
    return new Promise((resolve) => {
      const box = h('div', { class: 'dialog panel' });
      const face = h('div', { class: 'face' });
      const img = h('img', { alt: '' });
      face.append(img);
      const body = h('div', { class: 'body' });
      const who = h('div', { class: 'who' });
      const txt = h('div', { class: 'txt' });
      const choices = h('div', { class: 'choices' });
      const next = h('div', { class: 'next' }, '▼');
      body.append(who, txt, choices);
      box.append(face, body, next);
      this.layer.appendChild(box);
      const st = { box, img, face, who, txt, next, choices, seq, i: -1, shown: 0, full: '', t: 0, resolve, result: null, waitChoice: false };
      box.addEventListener('pointerdown', (e) => { e.preventDefault(); this._dialogAdvance(); });
      this.dlg = st;
      if (CTX.audio) CTX.audio.duck(0.55, 99);
      this._dialogNext();
    });
  }
  _dialogNext() {
    const st = this.dlg;
    st.i++;
    if (st.i >= st.seq.length) {
      st.box.remove();
      this.dlg = null;
      if (CTX.audio) CTX.audio.duck(1, 0.01);
      CTX.input.clearAll();
      st.resolve(st.result);
      // next queued dialog (on the next tick, after the resolver's continuation ran)
      if (this._dlgQueue && this._dlgQueue.length) setTimeout(() => this._flushDialogQueue(), 0);
      return;
    }
    const L = st.seq[st.i];
    st.who.textContent = L.who || '';
    st.full = L.text || '';
    st.shown = 0; st.t = 0;
    st.txt.textContent = '';
    st.choices.innerHTML = '';
    st.waitChoice = false;
    st.next.style.visibility = 'hidden';
    const f = L.face;
    let url = '';
    try {
      if (f) {
        if (f.startsWith && (f.startsWith('char:'))) url = charPortrait(f.slice(5));
        else if (f.startsWith && f.startsWith('pet:')) url = petPortrait(f.slice(4));
        else url = npcPortrait(f);
      }
    } catch (e) { url = ''; }
    st.face.style.display = url ? '' : 'none';
    if (url) st.img.src = url;
    st.blipPitch = L.pitch ?? (f && f.startsWith && f.startsWith('char:') ? 1.15 : f === 'whale' ? 0.6 : f && f.startsWith && f.startsWith('puffy') ? 1.4 : 1);
  }
  // close the current dialog immediately (cutscene skip)
  _dialogForceClose() {
    const st = this.dlg;
    if (!st) return;
    st.box.remove();
    this.dlg = null;
    if (CTX.audio) CTX.audio.duck(1, 0.01);
    CTX.input.clearAll();
    st.resolve(null);
    if (this._dlgQueue && this._dlgQueue.length) setTimeout(() => this._flushDialogQueue(), 0);
  }
  busyDialog() { return !!this.dlg || !!(this._dlgQueue && this._dlgQueue.length); }
  _dialogAdvance() {
    const st = this.dlg;
    if (!st) return;
    if (st.waitChoice) return;
    if (st.shown < st.full.length) { st.shown = st.full.length; st.txt.textContent = st.full; this._dialogShowEnd(); return; }
    sfx('menuSelect', { vol: 0.5 });
    this._dialogNext();
  }
  _dialogShowEnd() {
    const st = this.dlg;
    const L = st.seq[st.i];
    if (L.choices && !st.waitChoice) {
      st.waitChoice = true;
      st.next.style.visibility = 'hidden';
      const scr = new Screen(st.choices);
      L.choices.forEach((c, i) => {
        const b = h('button', { class: 'btn small ' + (i % 2 ? 'alt' : ''), 'data-nav': '1', onclick: (e) => { e.stopPropagation(); st.result = i; st.waitChoice = false; scr.el = null; this._dialogNext(); } }, c);
        st.choices.appendChild(b);
      });
      st.choiceScreen = scr;
      if (!CTX.game.touchMode) scr.focus(scr.items()[0]);
    } else st.next.style.visibility = 'visible';
  }
  _dialogUpdate(dt) {
    const st = this.dlg;
    const I = CTX.input;
    if (st.shown < st.full.length) {
      st.t += dt;
      const speed = 34;
      const n = Math.min(st.full.length, Math.floor(st.t * speed));
      if (n > st.shown) {
        st.shown = n;
        st.txt.textContent = st.full.slice(0, n);
        const ch = st.full[n - 1];
        if (ch && ch.trim() && n % 2 === 0) sfx('blip', { pitch: st.blipPitch * (0.95 + Math.random() * 0.1), vol: 0.35 });
        if (n >= st.full.length) this._dialogShowEnd();
      }
    }
    if (st.waitChoice && st.choiceScreen) {
      const d = I.menuDir(dt);
      if (d) st.choiceScreen.nav(d);
      if (I.pressed('confirm') || I.pressed('jump')) { if (st.choiceScreen.focusEl) st.choiceScreen.activate(); else st.choiceScreen.nav('right'); }
      return;
    }
    if (I.pressed('confirm') || I.pressed('jump') || I.pressed('attack')) this._dialogAdvance();
  }
  // quick yes/no
  confirm(text, yes = '네', no = '아니요') {
    return new Promise((resolve) => {
      const el = h('div', { class: 'screen', style: 'background:rgba(30,15,60,.45)' });
      const p = h('div', { class: 'panel', style: 'padding:calc(var(--u)*4) calc(var(--u)*5);display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*3);max-width:min(calc(var(--vw)*90),calc(var(--u)*90))' });
      p.append(h('div', { style: 'font-size:calc(var(--u)*3.4);text-align:center;color:var(--ink);word-break:keep-all;line-height:1.5' }, text));
      const row = h('div', { style: 'display:flex;gap:calc(var(--u)*3)' });
      let sc;
      const done = (v) => { this.pop(sc); resolve(v); };
      row.append(h('button', { class: 'btn', 'data-nav': '1', onclick: () => { sfx('menuSelect'); done(true); } }, yes), h('button', { class: 'btn ghost', 'data-nav': '1', 'data-autofocus': '1', onclick: () => { sfx('menuBack'); done(false); } }, no));
      p.append(row);
      el.append(p);
      sc = this.push(new Screen(el, { onBack: () => done(false) }));
    });
  }
}

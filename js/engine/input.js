// ============================================================================
// input.js — unified keyboard / gamepad / touch (virtual joystick) input
// ============================================================================
import { clamp } from './math.js';

const ACTIONS = ['jump', 'attack', 'special', 'pause', 'char', 'pet', 'camL', 'camR', 'up', 'down', 'left', 'right', 'confirm', 'back', 'tabL', 'tabR'];

const KEYMAP = {
  jump: ['Space', 'KeyK', 'KeyZ'],
  attack: ['KeyJ', 'KeyX'],
  special: ['KeyL', 'KeyC', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  char: ['Digit1', 'KeyR', 'Tab'],
  pet: ['Digit2', 'KeyF'],
  camL: ['KeyQ'],
  camR: ['KeyE'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'KeyZ', 'KeyK', 'NumpadEnter'],
  back: ['Escape', 'Backspace', 'KeyX'],
  tabL: ['KeyQ', 'PageUp'],
  tabR: ['KeyE', 'PageDown'],
};
const PADMAP = {
  jump: [0], attack: [2, 1], special: [3, 7], pause: [9], char: [4], pet: [5, 8],
  camL: [6], camR: [], up: [12], down: [13], left: [14], right: [15], confirm: [0], back: [1], tabL: [4], tabR: [5],
};

const ICONS = {
  jump: `<svg viewBox="0 0 64 64"><path d="M32 12 L50 34 H39 V52 H25 V34 H14 Z" fill="currentColor"/></svg>`,
  attack: `<svg viewBox="0 0 64 64"><path d="M32 8 L38 25 L56 25 L42 36 L47 54 L32 43 L17 54 L22 36 L8 25 L26 25 Z" fill="currentColor"/></svg>`,
  special: `<svg viewBox="0 0 64 64"><path d="M32 6 C34 22 42 30 58 32 C42 34 34 42 32 58 C30 42 22 34 6 32 C22 30 30 22 32 6 Z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 64 64"><rect x="18" y="14" width="10" height="36" rx="4" fill="currentColor"/><rect x="36" y="14" width="10" height="36" rx="4" fill="currentColor"/></svg>`,
  char: `<svg viewBox="0 0 64 64"><circle cx="32" cy="36" r="17" fill="currentColor"/><path d="M17 28 L14 10 L28 20 Z M47 28 L50 10 L36 20 Z" fill="currentColor"/></svg>`,
  pet: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="36" rx="9" ry="13" fill="currentColor"/><ellipse cx="18" cy="26" rx="12" ry="8" fill="currentColor" opacity=".75"/><ellipse cx="46" cy="26" rx="12" ry="8" fill="currentColor" opacity=".75"/></svg>`,
};

export const Input = {
  move: { x: 0, y: 0 },
  cam: { x: 0, y: 0 },
  lastDevice: 'keyboard',
  enabled: true,
  touchEnabled: false,
  _cur: {}, _prev: {}, _latch: {},
  _keys: new Set(),
  _touchAct: {},
  _pointers: new Map(),
  _joy: { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 },
  _camDrag: { id: -1, lastX: 0, dx: 0 },
  _anyCb: null,
  _padPrev: [],
  _repeat: {},

  init(root) {
    for (const a of ACTIONS) { this._cur[a] = false; this._prev[a] = false; this._latch[a] = false; this._touchAct[a] = false; }
    this.root = root;
    window.addEventListener('keydown', (e) => this._onKey(e, true), { passive: false });
    window.addEventListener('keyup', (e) => this._onKey(e, false), { passive: false });
    window.addEventListener('blur', () => { this._keys.clear(); for (const a of ACTIONS) this._touchAct[a] = false; this._joy.active = false; this.move.x = this.move.y = 0; });
    this._buildTouchUI(root);
    window.addEventListener('gamepadconnected', () => { this.lastDevice = 'gamepad'; this._emitDevice(); });
    // detect first touch anywhere to switch device mode
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') { if (this.lastDevice !== 'touch') { this.lastDevice = 'touch'; this._emitDevice(); } }
      else if (e.pointerType === 'mouse' && this.lastDevice === 'touch') { /* keep */ }
      if (this._anyCb) this._anyCb('pointer');
    }, { capture: true });
    this.isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (this.isTouchDevice && !matchMedia('(pointer:fine)').matches) this.lastDevice = 'touch';
  },
  onDeviceChange(cb) { this._devCb = cb; },
  _emitDevice() { if (this._devCb) this._devCb(this.lastDevice); },
  onAny(cb) { this._anyCb = cb; },

  _onKey(e, down) {
    const code = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace'].includes(code)) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this._keys.add(code);
      if (this.lastDevice !== 'keyboard') { this.lastDevice = 'keyboard'; this._emitDevice(); }
      for (const a of ACTIONS) if (KEYMAP[a].includes(code)) this._latch[a] = true;
      if (this._anyCb) this._anyCb('key', code);
    } else this._keys.delete(code);
  },

  // ----------------------------------------------------------- touch UI
  _buildTouchUI(root) {
    const el = document.createElement('div');
    el.className = 'touch-ui';
    el.innerHTML = `
      <div class="joy-base"><div class="joy-ring"></div><div class="joy-knob"></div></div>
      <div class="joy-hint"></div>
      <button class="tbtn tbtn-jump" data-act="jump" aria-label="점프">${ICONS.jump}<span>점프</span></button>
      <button class="tbtn tbtn-attack" data-act="attack" aria-label="공격">${ICONS.attack}<span>공격</span></button>
      <button class="tbtn tbtn-special" data-act="special" aria-label="특기"><i class="cd"></i>${ICONS.special}<span>특기</span></button>
      <button class="tbtn tbtn-small tbtn-char" data-act="char" aria-label="캐릭터">${ICONS.char}</button>
      <button class="tbtn tbtn-small tbtn-pet" data-act="pet" aria-label="펫">${ICONS.pet}</button>
      <button class="tbtn tbtn-small tbtn-pause" data-act="pause" aria-label="일시정지">${ICONS.pause}</button>
    `;
    root.appendChild(el);
    this.touchEl = el;
    this.joyBase = el.querySelector('.joy-base');
    this.joyKnob = el.querySelector('.joy-knob');
    this.specialBtn = el.querySelector('.tbtn-special');
    this.specialCd = el.querySelector('.tbtn-special .cd');
    const down = (e) => {
      if (!this.touchEnabled) return;
      e.preventDefault();
      const btn = e.target.closest ? e.target.closest('.tbtn') : null;
      if (btn) {
        const act = btn.dataset.act;
        this._pointers.set(e.pointerId, { type: 'btn', act, el: btn });
        this._touchAct[act] = true; this._latch[act] = true;
        btn.classList.add('on');
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* ignore */ } }
        return;
      }
      const w = window.innerWidth;
      if (e.clientX < w * 0.48 && !this._joy.active) {
        this._joy.active = true; this._joy.id = e.pointerId;
        this._joy.ox = e.clientX; this._joy.oy = e.clientY; this._joy.x = e.clientX; this._joy.y = e.clientY;
        this._pointers.set(e.pointerId, { type: 'joy' });
        this.joyBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.joyBase.classList.add('on');
        this.joyKnob.style.transform = 'translate(-50%, -50%)';
      } else if (this._camDrag.id < 0) {
        this._camDrag.id = e.pointerId; this._camDrag.lastX = e.clientX; this._camDrag.dx = 0;
        this._pointers.set(e.pointerId, { type: 'cam' });
      }
    };
    const move = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      if (p.type === 'joy') {
        this._joy.x = e.clientX; this._joy.y = e.clientY;
        const R = Math.min(70, window.innerHeight * 0.13);
        let dx = this._joy.x - this._joy.ox, dy = this._joy.y - this._joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > R * 1.6) { // drag base along
          const k = (d - R * 1.6) / d; this._joy.ox += dx * k; this._joy.oy += dy * k;
          dx = this._joy.x - this._joy.ox; dy = this._joy.y - this._joy.oy;
          this.joyBase.style.transform = `translate(${this._joy.ox}px, ${this._joy.oy}px)`;
        }
        const cl = Math.min(Math.hypot(dx, dy), R);
        const ang = Math.atan2(dy, dx);
        this.joyKnob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * cl}px), calc(-50% + ${Math.sin(ang) * cl}px))`;
      } else if (p.type === 'cam') {
        this._camDrag.dx += e.clientX - this._camDrag.lastX;
        this._camDrag.lastX = e.clientX;
      } else if (p.type === 'btn') {
        // allow sliding between jump/attack: re-target
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const btn = t && t.closest ? t.closest('.tbtn') : null;
        if (btn && btn !== p.el && !btn.classList.contains('tbtn-small') && !p.el.classList.contains('tbtn-small')) {
          this._touchAct[p.act] = false; p.el.classList.remove('on');
          p.act = btn.dataset.act; p.el = btn;
          this._touchAct[p.act] = true; this._latch[p.act] = true; btn.classList.add('on');
        }
      }
    };
    const up = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      this._pointers.delete(e.pointerId);
      if (p.type === 'btn') { this._touchAct[p.act] = false; p.el.classList.remove('on'); }
      else if (p.type === 'joy') { this._joy.active = false; this._joy.id = -1; this.joyBase.classList.remove('on'); }
      else if (p.type === 'cam') { this._camDrag.id = -1; }
    };
    el.addEventListener('pointerdown', down, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  setTouchVisible(v) {
    this.touchEnabled = v;
    this.touchEl.classList.toggle('show', v);
    if (!v) {
      for (const [, p] of this._pointers) if (p.type === 'btn') { this._touchAct[p.act] = false; p.el.classList.remove('on'); }
      this._pointers.clear();
      this._joy.active = false; this.joyBase.classList.remove('on');
      this._camDrag.id = -1;
    }
  },
  setSpecialCooldown(frac, ready, label) {
    if (!this.specialCd) return;
    const deg = Math.round(clamp(frac, 0, 1) * 360);
    this.specialCd.style.background = frac > 0 ? `conic-gradient(rgba(40,30,80,.55) ${deg}deg, transparent ${deg}deg)` : 'none';
    this.specialBtn.classList.toggle('ready', !!ready);
    if (label !== undefined && this._specialLabel !== label) {
      this._specialLabel = label;
      const s = this.specialBtn.querySelector('span'); if (s) s.textContent = label;
    }
  },

  // ----------------------------------------------------------- frame update
  update(dt) {
    for (const a of ACTIONS) this._prev[a] = this._cur[a];
    // gamepad
    let pad = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const padDown = {};
    let pmx = 0, pmy = 0, pcx = 0, pcy = 0;
    if (pad) {
      const bt = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      for (const a of ACTIONS) { padDown[a] = PADMAP[a].some(bt); }
      const ax = (i) => (pad.axes[i] || 0);
      const dz = (x, y) => { const m = Math.hypot(x, y); if (m < 0.18) return [0, 0]; const k = Math.min(1, (m - 0.18) / 0.82) / m; return [x * k, y * k]; };
      [pmx, pmy] = dz(ax(0), ax(1));
      [pcx, pcy] = dz(ax(2), ax(3));
      const any = pad.buttons.some((b) => b.pressed) || Math.hypot(ax(0), ax(1)) > 0.5;
      if (any) {
        if (this.lastDevice !== 'gamepad') { this.lastDevice = 'gamepad'; this._emitDevice(); }
        const nowPressed = pad.buttons.map((b) => b.pressed);
        if (this._anyCb && nowPressed.some((v, i) => v && !this._padPrev[i])) this._anyCb('pad');
        this._padPrev = nowPressed;
      } else this._padPrev = pad.buttons.map((b) => b.pressed);
      if (pad.buttons[15] && pad.buttons[15].pressed) pmx = 1;
      if (pad.buttons[14] && pad.buttons[14].pressed) pmx = -1;
      if (pad.buttons[12] && pad.buttons[12].pressed) pmy = -1;
      if (pad.buttons[13] && pad.buttons[13].pressed) pmy = 1;
    }
    for (const a of ACTIONS) {
      const k = KEYMAP[a].some((c) => this._keys.has(c));
      this._cur[a] = this.enabled && (k || !!padDown[a] || this._touchAct[a] || this._latch[a]);
      this._latch[a] = false;
    }
    // movement vector
    let mx = 0, my = 0;
    if (this._keys.has('ArrowLeft') || this._keys.has('KeyA')) mx -= 1;
    if (this._keys.has('ArrowRight') || this._keys.has('KeyD')) mx += 1;
    if (this._keys.has('ArrowUp') || this._keys.has('KeyW')) my -= 1;
    if (this._keys.has('ArrowDown') || this._keys.has('KeyS')) my += 1;
    if (mx || my) { const l = Math.hypot(mx, my); mx /= l; my /= l; }
    if (Math.hypot(pmx, pmy) > Math.hypot(mx, my)) { mx = pmx; my = pmy; }
    if (this._joy.active) {
      const R = Math.min(70, window.innerHeight * 0.13);
      let dx = (this._joy.x - this._joy.ox) / R, dy = (this._joy.y - this._joy.oy) / R;
      const m = Math.hypot(dx, dy);
      if (m < 0.12) { dx = 0; dy = 0; } else { const k = Math.min(1, (m - 0.12) / 0.75) / m; dx *= k; dy *= k; }
      mx = dx; my = dy;
    }
    this.move.x = this.enabled ? mx : 0; this.move.y = this.enabled ? my : 0;
    if (this.bot) this.bot(this, dt); // automated test driver (tools/bot.js)
    // camera
    let cx = pcx;
    if (this._keys.has('KeyQ')) cx -= 1;
    if (this._keys.has('KeyE')) cx += 1;
    if (pad && pad.buttons[6] && pad.buttons[6].value > 0.3) cx -= pad.buttons[6].value;
    if (pad && pad.buttons[7] && pad.buttons[7].value > 0.3 && false) cx += pad.buttons[7].value;
    this.cam.x = this.enabled ? cx : 0;
    this.cam.y = this.enabled ? pcy : 0;
    this.camDragPx = this.enabled ? this._camDrag.dx : 0;
    this._camDrag.dx = 0;
  },
  down(a) { return this._cur[a]; },
  pressed(a) { return this._cur[a] && !this._prev[a]; },
  released(a) { return !this._cur[a] && this._prev[a]; },
  consume(a) { this._prev[a] = this._cur[a]; },
  // menu navigation with key repeat
  navRepeat(a, dt) {
    if (!this._cur[a]) { this._repeat[a] = 0; return false; }
    if (!this._prev[a]) { this._repeat[a] = 0.38; return true; }
    this._repeat[a] -= dt;
    if (this._repeat[a] <= 0) { this._repeat[a] = 0.11; return true; }
    return false;
  },
  menuDir(dt) {
    // returns 'up'|'down'|'left'|'right'|null with repeat; uses dpad keys + stick
    const st = this._stickNav || (this._stickNav = { dir: null, t: 0 });
    let dir = null;
    for (const d of ['up', 'down', 'left', 'right']) if (this.navRepeat(d, dt)) dir = d;
    if (dir) return dir;
    const mx = this.move.x, my = this.move.y;
    let sd = null;
    if (Math.hypot(mx, my) > 0.6) sd = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
    if (this._joy.active) sd = null; // touch joystick doesn't drive menus
    if (sd !== st.dir) { st.dir = sd; st.t = 0.38; return sd; }
    if (sd) { st.t -= dt; if (st.t <= 0) { st.t = 0.12; return sd; } }
    return null;
  },
  clearAll() {
    for (const a of ACTIONS) { this._latch[a] = false; this._cur[a] = false; this._prev[a] = false; }
    this._keys.clear();
  },
};

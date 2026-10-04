// ============================================================================
// overlay.js — fullscreen handling + "TOUCH to continue" pause screen shown
// when fullscreen is exited (e.g. Android back button) or the app is hidden;
// portrait-orientation hint on phones.
// ============================================================================
import { CTX } from '../ctx.js';
import { h } from './ui.js';

export function logoHTML() {
  const word = '어드벤처 타임';
  const letters = [...word].map((c, i) => (c === ' ' ? ' ' : `<b style="animation-delay:${(i * 0.12).toFixed(2)}s">${c}</b>`)).join('');
  return `<div class="logo"><span class="l1">소미의</span><span class="l2">${letters}</span></div>`;
}

export const Overlay = {
  el: null,
  wasFull: false,
  active: false,
  init(game) {
    this.game = game;
    const onFs = () => {
      const full = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (full) this.wasFull = true;
      else if (this.wasFull) { this.wasFull = false; this.pauseForTouch('fs'); }
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pauseForTouch('hidden'); if (CTX.audio) CTX.audio.suspend(); }
    });
    window.addEventListener('pagehide', () => { if (CTX.save && CTX.save.data) CTX.save.write(); });
    // orientation hint for phones
    this.rot = h('div', { class: 'rotate-hint hidden' }, h('div', { class: 'phone' }), h('div', {}, '화면을 가로로 돌려 주세요!'), h('div', { style: 'font-size:15px;opacity:.75' }, '소미의 어드벤처 타임은 가로 화면에서 더 재미있어요'));
    document.getElementById('ui').appendChild(this.rot);
    const checkRot = () => {
      const portrait = window.innerHeight > window.innerWidth * 1.05;
      const phone = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && Math.min(window.innerWidth, window.innerHeight) < 600;
      const show = portrait && phone;
      this.rot.classList.toggle('hidden', !show);
      game.portraitBlock = show;
    };
    window.addEventListener('resize', checkRot);
    window.addEventListener('orientationchange', () => setTimeout(checkRot, 200));
    checkRot();
  },
  canFullscreen() { const el = document.documentElement; return !!(el.requestFullscreen || el.webkitRequestFullscreen); },
  isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; },
  requestFullscreen() {
    if (!this.isTouch()) return;
    const el = document.documentElement;
    try {
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn) {
        const r = fn.call(el, { navigationUI: 'hide' });
        if (r && r.catch) r.then(() => { this.wasFull = true; this._lockOrientation(); }).catch(() => {});
        else { this.wasFull = true; this._lockOrientation(); }
      }
    } catch (e) { /* not allowed (e.g. iframe) */ }
  },
  _lockOrientation() { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ } },
  // title-like pause screen; resumes on touch
  pauseForTouch(reason) {
    const g = this.game;
    if (this.active || !g.mode || g.mode.isTitle) return;
    this.active = true;
    g.suspended = true;
    if (CTX.audio) CTX.audio.suspend();
    CTX.input.setTouchVisible(false);
    const el = h('div', { class: 'screen title-screen', style: 'z-index:40;background:radial-gradient(ellipse at 50% 40%, rgba(60,40,110,.55), rgba(20,10,45,.85))' });
    el.innerHTML = logoHTML() + '<div class="touch-prompt">TOUCH</div><div class="title-sub">화면을 누르면 계속해요</div>';
    document.getElementById('ui').appendChild(el);
    this.el = el;
    const resume = (e) => {
      if (e) e.preventDefault();
      if (!this.active) return;
      this.active = false;
      el.remove();
      this.el = null;
      this.requestFullscreen();
      if (CTX.audio) { CTX.audio.init(); CTX.audio.resume(); }
      g.suspended = false;
      CTX.input.clearAll();
      if (g.mode && g.mode.onTouchMode) g.mode.onTouchMode(g.touchMode);
      window.removeEventListener('keydown', kd);
      clearInterval(padPoll);
    };
    const kd = (e) => { if (!e.repeat) resume(e); };
    el.addEventListener('pointerdown', resume);
    // keyboard / gamepad resume too
    setTimeout(() => window.addEventListener('keydown', kd), 300);
    const padPoll = setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.buttons.some((b) => b.pressed)) { resume(); return; }
    }, 150);
    void reason;
  },
};

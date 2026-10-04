// ============================================================================
// overlay.js — mobile fullscreen flow:
//  * title: blinking TOUCH -> the tap switches to fullscreen (landscape lock on Android)
//  * leaving fullscreen during play (Android back button, address bar shown) or
//    hiding the app pauses the game behind a title-like TOUCH screen; the next
//    tap goes fullscreen again and the game continues
//  * after the first TOUCH, any tap brings fullscreen back (title, map, menus)
// Browsers only allow fullscreen from a real activation (click / pointerup /
// touchend / keydown), never from pointerdown — so every request happens in a
// click handler. Portrait phones are handled by js/engine/orient.js (the game
// is turned by 90°), so nothing here asks the player to rotate the device.
// ============================================================================
import { CTX } from '../ctx.js';
import { h } from './ui.js';
import { isMobileDevice } from '../../engine/orient.js';

export function logoHTML() {
  const word = '어드벤처 타임';
  const letters = [...word].map((c, i) => (c === ' ' ? ' ' : `<b style="animation-delay:${(i * 0.12).toFixed(2)}s">${c}</b>`)).join('');
  return `<div class="logo"><span class="l1">소미의</span><span class="l2">${letters}</span></div>`;
}

export const Overlay = {
  el: null,
  wasFull: false, // fullscreen was on (so leaving it means "pause")
  wantFull: false, // the player started on a touch device: keep the game fullscreen
  active: false,
  init(game) {
    this.game = game;
    const onFs = () => {
      if (this.isFull()) { this.wasFull = true; this._lockOrientation(); }
      else if (this.wasFull) { this.wasFull = false; this.pauseForTouch('fs'); }
      // orientation lock / unlock changes the viewport: re-layout once it settles
      setTimeout(() => game.resize(), 80);
      setTimeout(() => game.resize(), 400);
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pauseForTouch('hidden'); if (CTX.audio) CTX.audio.suspend(); }
      else if (!this.active && CTX.audio) CTX.audio.resume(); // title / no pause screen: music comes back by itself
    });
    window.addEventListener('pagehide', () => { if (CTX.save && CTX.save.data) CTX.save.write(); });
    // once started, any tap restores fullscreen (capture phase: runs before the tapped control)
    document.addEventListener('click', () => {
      if (this.wantFull && !this.active && !this.isFull()) this.requestFullscreen();
    }, true);
  },
  isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
  canFullscreen() { const el = document.documentElement; return !!(el.requestFullscreen || el.webkitRequestFullscreen); },
  isTouch() { return isMobileDevice(); }, // phones / tablets only
  // call from a click/keydown handler only (needs user activation)
  requestFullscreen() {
    if (!this.isTouch() || !this.canFullscreen()) return;
    this.wantFull = true;
    if (this.isFull()) return;
    const el = document.documentElement;
    try {
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      const r = fn.call(el, { navigationUI: 'hide' });
      if (r && r.then) r.then(() => { this.wasFull = true; this._lockOrientation(); }).catch(() => {});
    } catch (e) { /* not allowed here (e.g. inside an iframe) */ }
  },
  _lockOrientation() {
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ }
  },
  // title-like pause screen; a tap goes fullscreen again and resumes
  pauseForTouch(reason) {
    const g = this.game;
    if (this.active || !g.mode || g.mode.isTitle) return;
    this.active = true;
    g.suspended = true;
    if (CTX.audio) CTX.audio.suspend();
    CTX.input.setTouchVisible(false);
    const el = h('div', { class: 'screen title-screen pause-touch' });
    el.innerHTML = `<div class="title-top">${logoHTML()}</div><div style="flex:1.5"></div><div class="touch-prompt">TOUCH</div><div style="flex:1"></div><div class="title-foot">화면을 누르면 이어서 해요</div>`;
    document.getElementById('ui').appendChild(el);
    this.el = el;
    let padPoll = 0;
    const resume = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!this.active) return;
      this.active = false;
      el.remove();
      this.el = null;
      this.requestFullscreen();
      if (CTX.audio) { CTX.audio.init(); CTX.audio.resume(); }
      g.suspended = false;
      g.resize();
      CTX.input.clearAll();
      if (g.mode && g.mode.onTouchMode) g.mode.onTouchMode(g.touchMode);
      window.removeEventListener('keydown', kd);
      clearInterval(padPoll);
    };
    const kd = (e) => { if (!e.repeat) resume(e); };
    el.addEventListener('click', resume);
    // keyboard / gamepad resume too
    setTimeout(() => { if (this.active) window.addEventListener('keydown', kd); }, 300);
    padPoll = setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.buttons.some((b) => b.pressed)) { resume(); return; }
    }, 150);
    void reason;
  },
};

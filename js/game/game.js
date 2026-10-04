// ============================================================================
// game.js — engine bootstrap, main loop, mode (scene) management
// ============================================================================
import { Renderer } from '../engine/renderer.js';
import { Scene, Camera } from '../engine/scene.js';
import { ParticleSystem, BillboardBatch } from '../engine/particles.js';
import { makeParticleAtlas } from '../engine/texgen.js';
import { Input } from '../engine/input.js';
import { Audio } from '../engine/audio.js';
import { CTX, DIFFICULTY } from './ctx.js';
import { FX } from './fx.js';
import { Environment } from './world/env.js';
import { CameraController } from './camera.js';
import { HUD } from './ui/hud.js';
import { Save } from './save.js';
import { UI } from './ui/ui.js';

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.renderer = new Renderer(canvas, { antialias: true });
    this.scene = new Scene();
    this.camera = new Camera(50, 0.1, 900);
    CTX.game = this;
    CTX.renderer = this.renderer;
    CTX.scene = this.scene;
    CTX.camera = this.camera;
    this.atlas = makeParticleAtlas();
    CTX.particles = new ParticleSystem(this.scene, this.atlas, 1600);
    CTX.shadows = new BillboardBatch({ max: 160, atlas: this.atlas, flat: true, renderOrder: 10, name: 'shadows' });
    this.scene.add(CTX.shadows);
    CTX.sprites = new BillboardBatch({ max: 400, atlas: this.atlas, blending: 'additive', renderOrder: 85, name: 'sprites' });
    this.scene.add(CTX.sprites);
    CTX.fx = new FX(this.scene);
    CTX.env = new Environment(this.scene);
    CTX.cam = new CameraController(this.camera);
    Input.init(uiRoot);
    CTX.input = Input;
    CTX.audio = Audio;
    CTX.save = Save;
    Save.loadSettings();
    CTX.settingsShake = Save.settings.shake;
    CTX.diff = DIFFICULTY.normal;
    CTX.hud = new HUD(uiRoot);
    CTX.hud.show(false);
    this.ui = new UI(uiRoot);
    this.mode = null;
    this.paused = false;
    this.last = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;
    this.lowSpec = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    CTX.lowSpec = this.lowSpec;
    this.applyQuality();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    Input.onDeviceChange((d) => this.setTouchMode(d === 'touch'));
    this.setTouchMode(Input.lastDevice === 'touch');
    this.frameCb = (t) => this.frame(t);
    this.simulate = false; // headless stepping for tests
  }
  applyQuality() {
    const q = Save.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    let pr;
    if (q === 'low') pr = 1;
    else if (q === 'high') pr = Math.min(dpr, 2);
    else pr = Math.min(dpr, this.lowSpec ? 1.6 : 2);
    this.renderer.pixelRatio = pr;
    this.renderer.resScale = 1;
    this.resize();
  }
  setTouchMode(on) {
    document.body.classList.toggle('touch', !!on);
    this.touchMode = !!on;
    if (this.mode && this.mode.onTouchMode) this.mode.onTouchMode(on);
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
  }
  setMode(mode, args) {
    if (this.mode && this.mode.exit) this.mode.exit();
    this.mode = mode;
    CTX.mode = mode;
    if (mode && mode.enter) return mode.enter(args);
  }
  start() { requestAnimationFrame(this.frameCb); }
  // fade to dark, run fn (may be async), fade back
  transition(fn, dur = 0.45) {
    const el = document.getElementById('flash');
    return new Promise((resolve) => {
      el.style.transition = `opacity ${dur}s`;
      el.style.background = '#1d1638';
      el.style.opacity = '1';
      setTimeout(async () => {
        try { await fn(); } catch (e) { console.error(e); }
        el.style.transition = `opacity ${dur * 1.3}s`;
        el.style.opacity = '0';
        resolve();
      }, dur * 1000 + 30);
    });
  }
  // test hooks: manual stepping without the RAF loop
  advance(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) this.step(dt); }
  renderOnce() { this.render(); }
  frame(t) {
    requestAnimationFrame(this.frameCb);
    if (this.manual) { this.last = t; return; }
    let rdt = (t - this.last) / 1000;
    this.last = t;
    if (!(rdt > 0)) rdt = 1 / 60;
    rdt = Math.min(rdt, 0.1);
    this.step(rdt);
    this.render();
    // adaptive resolution
    this.fpsAcc += rdt; this.fpsN++;
    if (this.fpsAcc > 2) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0; this.fpsN = 0;
      if (Save.settings.quality === 'auto') {
        const R = this.renderer;
        if (this.fps < 40 && R.resScale > 0.6) { R.resScale = Math.max(0.6, R.resScale - 0.15); this.resize(); }
        else if (this.fps > 57 && R.resScale < 1) { R.resScale = Math.min(1, R.resScale + 0.1); this.resize(); }
      }
    }
  }
  step(rdt) {
    Input.update(rdt);
    let dt = Math.min(rdt, 1 / 30);
    if (CTX.hitStop > 0) { CTX.hitStop -= rdt; dt = 0; }
    CTX.time += dt;
    this.renderer.globals.uTime = (this.renderer.globals.uTime + dt) % 10000;
    if (this.mode && this.mode.update && !this.suspended) this.mode.update(dt, rdt);
    this.ui.update(rdt);
    if (CTX.hud && CTX.hud.visible) CTX.hud.update(rdt);
  }
  render() {
    if (this.mode && this.mode.beforeRender) this.mode.beforeRender();
    this.renderer.render(this.scene, this.camera);
  }
}

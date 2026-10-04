// ============================================================================
// cutscene.js — Director (async scripting: waits, tweens, camera moves,
// captions, dialogs, actors) + CutsceneMode hosting standalone 3D sets.
// ============================================================================
import { Vec3, Ease, lerp, clamp } from '../../engine/math.js';
import { Node } from '../../engine/scene.js';
import { CTX } from '../ctx.js';
import { h } from '../ui/ui.js';
import { Save } from '../save.js';

const CAP_CSS = `
.caption { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom,0px) + var(--u)*9); transform: translateX(-50%); width: min(calc(var(--vw)*88), calc(var(--u)*130)); text-align: center; font-size: calc(var(--u)*3.6); line-height: 1.55; color: #fff; text-shadow: 0 2px 0 rgba(60,20,90,.7), 0 0 calc(var(--u)*2) rgba(40,10,70,.8); word-break: keep-all; pointer-events: none; opacity: 0; transition: opacity .8s; }
.caption.on { opacity: 1; }
.caption.top { bottom: auto; top: calc(env(safe-area-inset-top,0px) + var(--u)*8); }
.letterbox { position: absolute; left: 0; right: 0; height: 0; background: #120a24; transition: height .7s ease; pointer-events: none; }
.letterbox.t { top: 0; } .letterbox.b { bottom: 0; }
.letterbox.on { height: calc(var(--u)*7); }
.skipbtn { position: absolute; right: calc(env(safe-area-inset-right,0px) + var(--u)*2.4); top: calc(env(safe-area-inset-top,0px) + var(--u)*2.4); pointer-events: auto; font-size: calc(var(--u)*2.4); padding: calc(var(--u)*1) calc(var(--u)*2.6); z-index: 5; }
.storyimg { position: absolute; inset: 0; pointer-events: none; }
`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CAP_CSS; document.head.appendChild(s); }

export class Director {
  constructor(o = {}) {
    ensureCss();
    this.time = 0;
    this.waiters = [];
    this.tweens = [];
    this.actors = new Map(); // rig -> {anim, t}
    this.skipping = false;
    this.ui = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    this.lbT = h('div', { class: 'letterbox t' });
    this.lbB = h('div', { class: 'letterbox b' });
    this.cap = h('div', { class: 'caption' });
    this.ui.append(this.lbT, this.lbB, this.cap);
    document.getElementById('ui').appendChild(this.ui);
    if (o.skippable) {
      this.skipBtn = h('button', { class: 'btn ghost skipbtn', onclick: () => this.skip() }, '건너뛰기 ▶▶');
      this.ui.append(this.skipBtn);
    }
    this.cam = CTX.camera;
  }
  dispose() { this.ui.remove(); this.resolveAll(); }
  skip() {
    if (this.skipping) return;
    this.skipping = true;
    if (CTX.ui.dlg) CTX.ui._dialogForceClose && CTX.ui._dialogForceClose();
    this.resolveAll();
  }
  resolveAll() {
    for (const w of this.waiters) w.r();
    this.waiters.length = 0;
    for (const t of this.tweens) { t.fn(1); t.r(); }
    this.tweens.length = 0;
  }
  update(dt) {
    this.time += dt;
    for (let i = this.waiters.length - 1; i >= 0; i--) if (this.time >= this.waiters[i].t) { const w = this.waiters[i]; this.waiters.splice(i, 1); w.r(); }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      t.e += dt;
      const k = clamp(t.e / t.dur, 0, 1);
      t.fn(t.ease(k));
      if (k >= 1) { this.tweens.splice(i, 1); t.r(); }
    }
    for (const [rig, a] of this.actors) { a.t += dt; rig.update(dt, { anim: a.anim, t: a.t, speed: a.speed || 0, specialKind: a.sk, attackKind: a.ak }); }
    if (CTX.input.pressed('pause') && this.skipBtn) this.skip();
  }
  wait(s) { if (this.skipping) return Promise.resolve(); return new Promise((r) => this.waiters.push({ t: this.time + s, r })); }
  tween(dur, fn, ease = Ease.inOutSine) {
    if (this.skipping || dur <= 0) { fn(1); return Promise.resolve(); }
    return new Promise((r) => this.tweens.push({ dur, e: 0, fn, ease, r }));
  }
  shot(pos, target, fovDeg) { this.cam.position.set(...pos); this.cam.target.set(...target); if (fovDeg) this.cam.fov = fovDeg * Math.PI / 180; }
  camTo(pos, target, dur, ease = Ease.inOutSine, fovDeg = null) {
    const p0 = this.cam.position.clone(), t0 = this.cam.target.clone();
    const p1 = new Vec3(...pos), t1 = new Vec3(...target);
    const f0 = this.cam.fov, f1 = fovDeg ? fovDeg * Math.PI / 180 : f0;
    return this.tween(dur, (k) => { this.cam.position.lerpVectors(p0, p1, k); this.cam.target.lerpVectors(t0, t1, k); this.cam.fov = lerp(f0, f1, k); }, ease);
  }
  orbit(center, radius, height, a0, a1, dur, lookY = 0) {
    const c = new Vec3(...center);
    return this.tween(dur, (k) => {
      const a = lerp(a0, a1, k);
      this.cam.position.set(c.x + Math.sin(a) * radius, c.y + height, c.z + Math.cos(a) * radius);
      this.cam.target.set(c.x, c.y + lookY, c.z);
    }, Ease.inOutSine);
  }
  actor(rig, anim = 'idle', o = {}) { this.actors.set(rig, { anim, t: 0, speed: o.speed || 0, sk: o.sk, ak: o.ak }); }
  anim(rig, anim, o = {}) { const a = this.actors.get(rig); if (a) { a.anim = anim; a.t = 0; a.speed = o.speed || 0; a.sk = o.sk; a.ak = o.ak; } else this.actor(rig, anim, o); }
  release(rig) { this.actors.delete(rig); }
  move(node, to, dur, ease = Ease.inOutSine) {
    const p0 = node.position.clone(), p1 = new Vec3(...to);
    return this.tween(dur, (k) => node.position.lerpVectors(p0, p1, k), ease);
  }
  walk(rig, to, dur, anim = 'walk') {
    const node = rig.root;
    const p0 = node.position.clone(), p1 = new Vec3(...to);
    node.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    this.anim(rig, anim, { speed: anim === 'run' ? 1 : 0.6 });
    return this.tween(dur, (k) => node.position.lerpVectors(p0, p1, k), Ease.linear).then(() => this.anim(rig, 'idle'));
  }
  say(lines) {
    if (this.skipping) return Promise.resolve(null);
    const seq = lines.map((l) => (Array.isArray(l) ? { who: l[0], text: l[1], face: l[2] } : l));
    return CTX.ui.dialog(seq);
  }
  async caption(text, dur = 3.2, top = false) {
    if (this.skipping) return;
    this.cap.classList.toggle('top', !!top);
    this.cap.textContent = text;
    this.cap.classList.add('on');
    await this.wait(dur);
    this.cap.classList.remove('on');
    await this.wait(0.8);
  }
  captionOn(text, top = false) { this.cap.classList.toggle('top', !!top); this.cap.textContent = text; this.cap.classList.add('on'); }
  captionOff() { this.cap.classList.remove('on'); }
  letterbox(on) { this.lbT.classList.toggle('on', on); this.lbB.classList.toggle('on', on); }
  fade(color = '#000', to = 1, dur = 0.6) {
    const el = document.getElementById('flash');
    el.style.transition = `opacity ${this.skipping ? 0 : dur}s`;
    el.style.background = color;
    el.style.opacity = String(to);
    return this.wait(dur);
  }
}

// ------------------------------------------------------------------ standalone cutscene mode with a 3D set
export class CutsceneMode {
  // set: { build(mode) -> {update(dt), dispose()} } ; script: async (dir, set, mode) => {}
  constructor(setFn, script, o = {}) { this.setFn = setFn; this.script = script; this.o = o; this.isCutscene = true; }
  async enter() {
    CTX.cam.mode = 'manual';
    CTX.hud.show(false);
    this.set = await this.setFn(this);
    const seen = this.o.id ? Save.flag('seen:' + this.o.id) : false;
    this.dir = new Director({ skippable: this.o.skippable ?? seen });
    this.running = true;
    (async () => {
      try { await this.script(this.dir, this.set, this); }
      catch (e) { console.error(e); }
      if (this.o.id && Save.data) { Save.flag('seen:' + this.o.id, true); Save.write(); }
      this.running = false;
      if (this.o.onDone) this.o.onDone();
    })();
  }
  exit() {
    if (this.dir) this.dir.dispose();
    if (this.set && this.set.dispose) this.set.dispose();
    CTX.particles.clear();
    const el = document.getElementById('flash');
    el.style.transition = 'opacity .5s'; el.style.opacity = '0';
  }
  update(dt) {
    if (this.dir) this.dir.update(dt);
    if (this.set && this.set.update) this.set.update(dt);
    CTX.env.update(dt, this.set && this.set.focus ? this.set.focus : new Vec3(), CTX.camera);
    CTX.fx.update(dt);
    CTX.particles.update(dt, CTX.camera);
  }
}
void Node;

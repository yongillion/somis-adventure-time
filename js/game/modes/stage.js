// ============================================================================
// modes/stage.js — gameplay mode: loads a stage, runs player/pet/systems,
// handles checkpoints, death/respawn, rescues, cookies, pause/menus, clear.
// ============================================================================
import { bakeTree } from '../../engine/bake.js';
import { Vec3, rgb } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { Level } from '../world/level.js';
import { LevelBuilder } from '../world/builder.js';
import { THEMES } from '../world/env.js';
import { Player } from '../player.js';
import { Pet } from '../systems/pet.js';
import { Pickups } from '../systems/pickups.js';
import { Projectiles } from '../systems/projectiles.js';
import { Abilities } from '../systems/abilities.js';
import { installFreeze } from '../systems/interact.js';
import { STAGES, loadStageScript } from '../data/stages.js';
import { CHAR_BY_ID, COOKIE_STAGE } from '../data/characters.js';
import { PET_BY_ID } from '../data/pets.js';
import { Save } from '../save.js';
import { openPause, openCharSelect, openPetBox } from '../ui/menus.js';
import { Director } from '../story/cutscene.js';

export class StageMode {
  constructor(stageId, opts = {}) {
    this.stageId = stageId;
    this.opts = opts;
    this.def = STAGES[stageId];
    this.t = 0;
    this.state = 'loading';
    this.stats = { enemies: 0, time: 0, candyStart: 0, deaths: 0 };
    this.timers = [];
  }
  // game-time timer: runs fn after `sec` seconds of (unpaused) stage time
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  _tickTimers(dt) {
    if (!this.timers.length) return;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); try { tm.fn(); } catch (e) { console.error(e); } }
    }
  }
  get sd() { return Save.data ? Save.stage(this.stageId) : { puffies: [], cookies: [], secrets: [] }; }
  isPuffyRescued(i) { return this.sd.puffies.includes(i); }

  async enter() {
    const def = this.def;
    const script = await loadStageScript(this.stageId);
    this.script = script;
    const level = new Level({ killY: def.killY ?? -28 });
    this.level = level;
    level.restoreColor = def.color;
    CTX.level = level;
    CTX.physics = level.physics;
    const cleared = Save.data && this.sd.cleared;
    this.cleared = !!cleared;
    CTX.env.apply(def.theme, { sat: cleared ? 1 : def.baseSat ?? 0.3, skySat: cleared ? 1 : 0.5, center: new Vec3(def.center?.[0] || 0, 0, def.center?.[1] || 0) });
    this.pickups = new Pickups(level);
    CTX.pickups = this.pickups;
    this.pickups.onCookie = (id, it) => this.unlockCookie(id, it);
    this.projectiles = new Projectiles(CTX.scene);
    CTX.projectiles = this.projectiles;
    installFreeze(level);
    this._installLevelHooks(level);
    const L = new LevelBuilder(level, def.theme);
    L.pickups = this.pickups;
    L.stage = this;
    this.builder = L;
    const distantBefore = CTX.env.distant;
    script.build(L, this);
    level.finalize(CTX.scene);
    // merge rigid same-material sibling meshes (fewer draw calls; self-reverting if game code animates a part)
    if (!CTX.noBake) { const t0 = performance.now(); const saved = bakeTree(level.root); if (CTX.debug) console.log('[bake]', saved, 'draws saved in', (performance.now() - t0).toFixed(1), 'ms'); }
    // keep the decorative far-island ring outside the playable area (unless the stage placed it itself)
    if (CTX.env.distant === distantBefore && CTX.env.distant) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const c of level.physics.statics) {
        if (c.tag === 'under' || c.tag === 'arenaWall') continue;
        const e = c.type === 'cyl' ? c.hx : Math.hypot(c.hx, c.hz);
        x0 = Math.min(x0, c.x - e); x1 = Math.max(x1, c.x + e); z0 = Math.min(z0, c.z - e); z1 = Math.max(z1, c.z + e);
      }
      if (x1 > x0) {
        const half = Math.max(x1 - x0, z1 - z0) / 2;
        CTX.env.rebuildDistant(new Vec3((x0 + x1) / 2, 0, (z0 + z1) / 2), Math.max(150, half + 75));
      }
    }
    CTX.cam.setZones(level.camZones);
    CTX.cam.setDefaults({ yaw: def.camYaw ?? level.spawn.yaw + Math.PI, pitch: def.camPitch ?? 0.5, dist: def.camDist ?? 8.4, fov: 50, height: 1.0 });
    // player
    const p = new Player();
    this.player = p;
    CTX.player = p;
    CTX.scene.add(p.node);
    const ch = (Save.data && Save.data.currentChar && Save.hasChar(Save.data.currentChar)) ? Save.data.currentChar : 'cat';
    p.setCharacter(ch);
    p.resetHp();
    const sp = this.opts.spawn || level.spawn;
    p.place(sp.pos, sp.yaw);
    p.setCheckpoint(sp.pos, sp.yaw);
    p.onFall = () => this.onFall();
    p.onDeath = () => this.onDeath();
    this.setPet(Save.data ? Save.data.currentPet : null);
    CTX.cam.mode = 'follow';
    CTX.cam.boss = null;
    CTX.cam.snap(p);
    CTX.hud.reset();
    CTX.hud.show(true);
    CTX.hud.setHp(p.hp, p.maxHp);
    CTX.hud.setCandies(Save.data ? Save.data.candies : 0);
    CTX.hud.setPuffies(this.sd.puffies.length, 5);
    this.stats.candyStart = Save.data ? Save.data.candies : 0;
    this.musicId = this.def.music || THEMES[def.theme].music;
    if (CTX.audio) CTX.audio.playMusic(this.musicId);
    this.state = 'play';
    CTX.input.setTouchVisible(CTX.game.touchMode);
    if (Save.data) { Save.data.lastStage = this.stageId; }
    // stage intro scripts run after enter() returns (so screen transitions can fade in)
    if (script.onStart) Promise.resolve().then(() => script.onStart(L, this)).catch((e) => console.error(e));
    else if (this.def.name && this.stageId !== 'test') CTX.hud.banner(`스테이지 ${this.stageId}`, this.def.name, 2.6);
  }
  exit() {
    if (this.player) { Abilities.clearBuffs(this.player); this.player.node.removeFromParent(); }
    if (CTX.pet) { CTX.pet.node.removeFromParent(); CTX.pet = null; }
    if (this.projectiles) { this.projectiles.clear(); this.projectiles.root.removeFromParent(); }
    if (this.level) this.level.dispose();
    if (this.boss && this.boss.dispose) this.boss.dispose();
    CTX.particles.clear();
    CTX.input.setTouchVisible(false);
    CTX.hud.show(false);
    CTX.hud.reset();
    for (const el of document.querySelectorAll('.stage-fx')) el.remove(); // stage-specific overlays (e.g. Noa's voice)
    CTX.worldScale = 1;
    document.body.classList.remove('slowtime');
    CTX.level = null; CTX.player = null; CTX.pickups = null; CTX.projectiles = null;
    if (Save.data) Save.write();
  }
  onTouchMode(on) { CTX.input.setTouchVisible(on && this.state === 'play'); }

  // ------------------------------------------------------------------ hooks into level
  _installLevelHooks(level) {
    level.reveal = (pos, r, dur = 10, silent = false) => {
      let n = 0;
      let nearest = null, nd = 1e9;
      for (const s of level.secrets) {
        if (s.done) continue;
        const d = Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y, s.pos.z - pos.z);
        if (d < r) { n++; if (s.reveal) s.reveal(); }
        if (d < nd && d < 70) { nd = d; nearest = s; }
      }
      for (const g of level.ghosts) if (g.pos.distanceTo(pos) < r) g.reveal(dur);
      if (nearest && CTX.hud) CTX.hud.pointAt(nearest.pos, silent ? 4 : dur);
      return n;
    };
    level.dig = (p) => {
      let best = null, bd = 1.8;
      for (const s of level.digSpots) { if (s.done) continue; const d = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z); if (d < bd && Math.abs(s.pos.y - p.pos.y) < 1) { bd = d; best = s; } }
      if (best) { best.dig(); if (CTX.pet && CTX.pet.onSecretFound) CTX.pet.onSecretFound(); return true; }
      const key = Math.round(p.pos.x / 3) + ',' + Math.round(p.pos.z / 3);
      level._dug = level._dug || new Set();
      if (!level._dug.has(key) && Math.random() < 0.35) { level._dug.add(key); CTX.pickups.drop(new Vec3(p.pos.x, p.pos.y + 0.3, p.pos.z), 2, 1.5); return true; }
      level._dug.add(key);
      return false;
    };
    level.onPuffyRescued = (cage) => {
      const sd = this.sd;
      if (!sd.puffies.includes(cage.idx)) {
        sd.puffies.push(cage.idx);
        Save.write();
        CTX.hud.setPuffies(sd.puffies.length, 5);
        if (CTX.audio) CTX.audio.jingle('rescue');
        CTX.hud.toast(`뭉실이를 구했어요! (${sd.puffies.length}/5)`, 'good');
        if (sd.puffies.length === 5) this.after(1.8, () => CTX.hud.toast('이 스테이지의 뭉실이를 모두 구했어요!', 'good', 3));
      }
      if (cage.hidden && CTX.pet && CTX.pet.onSecretFound) CTX.pet.onSecretFound();
      if (cage.dialog) this.after(0.9, () => CTX.ui.dialog(cage.dialog));
    };
    level.onEnemyDefeated = () => { this.stats.enemies++; };
  }

  // ------------------------------------------------------------------ pets & characters
  setPet(id) {
    if (CTX.pet) { CTX.pet.node.removeFromParent(); CTX.pet = null; }
    if (!id || !PET_BY_ID[id] || !Save.hasPet(id)) { CTX.hud.setPet(null); return; }
    const pet = new Pet(id);
    pet.place(this.player.pos);
    CTX.scene.add(pet.node);
    CTX.pet = pet;
    CTX.hud.setPet(id, pet.xp);
  }
  gainPet(id, opts = {}) {
    const isNew = Save.addPet(id);
    const pt = PET_BY_ID[id];
    if (isNew) {
      if (CTX.audio) CTX.audio.jingle('petjoin');
      CTX.hud.banner('새 펫 친구!', `${pt.kind} ${pt.name}`, 3);
      if (!Save.data.currentPet || opts.equip !== false) { Save.data.currentPet = id; this.setPet(id); }
      Save.write();
      const first = Object.keys(Save.data.pets).length === 1;
      const lines = [
        { who: pt.name, text: opts.thanks || '고마워! 이제부터 내가 같이 다닐게!', face: 'pet:' + id },
        { who: '', text: `${pt.name}의 힘 「${pt.title}」 — ${pt.desc(1)}`, face: 'pet:' + id },
      ];
      if (first) lines.push({ who: '', text: '펫은 꿈방울 펫 상자에 들어가요. 펫 버튼을 누르면 언제든지 다른 펫과 바꿀 수 있어요. 능력을 쓸수록 레벨이 올라가요!', face: 'pet:' + id });
      return CTX.ui.dialog(lines);
    }
    return Promise.resolve();
  }
  unlockCookie(id, it) {
    const c = CHAR_BY_ID[id];
    const isNew = Save.unlockChar(id);
    const sd = this.sd;
    if (!sd.cookies.includes(id)) { sd.cookies.push(id); Save.write(); }
    if (!isNew) return;
    if (CTX.audio) CTX.audio.jingle('cookie');
    this.player.celebrateT = 1.4;
    CTX.hud.banner('새 친구!', `${c.name} 쿠키를 찾았어요`, 3);
    const first = Save.data.chars.length === 2;
    const lines = [
      { who: '', text: `이제 ${c.name}(으)로 변신할 수 있어요!`, face: 'char:' + id },
      { who: '', text: `특기 「${c.special.name}」 — ${c.special.desc}`, face: 'char:' + id },
    ];
    if (first) lines.push({ who: '', text: CTX.game.touchMode ? '오른쪽 위의 고양이 얼굴 버튼을 누르면 언제든지 동물 친구를 바꿀 수 있어요!' : '캐릭터 버튼(1번 키 또는 Tab)을 누르면 언제든지 동물 친구를 바꿀 수 있어요!', face: 'char:' + id });
    this.after(1.2, () => CTX.ui.dialog(lines).then(() => {
      if (this.script.onCookie) this.script.onCookie(id, this);
    }));
    void it;
  }
  changeChar(id) {
    if (!id || id === this.player.charId) return;
    Abilities.clearBuffs(this.player);
    this.player.setCharacter(id, true);
    if (Save.data) { Save.data.currentChar = id; Save.write(); }
  }

  // ------------------------------------------------------------------ deaths
  onFall() { this.fadeTo(() => this.player.respawnAfterFall(), 0.35); }
  onDeath() {
    this.stats.deaths++;
    if (CTX.hud) CTX.hud.banner('앗!', '괜찮아요, 다시 해 봐요!', 1.6);
    if (CTX.audio) CTX.audio.jingle('tryagain');
    this.after(1.3, () => this.fadeTo(() => {
      const pen = CTX.diff.deathPenalty;
      if (pen > 0 && Save.data) {
        const lost = Math.floor(Save.data.candies * pen);
        Save.data.candies -= lost;
        CTX.hud.setCandies(Save.data.candies);
      }
      this.player.revive(true);
      if (this.level.onRespawn) this.level.onRespawn();
      if (this.boss && this.boss.onPlayerRespawn) this.boss.onPlayerRespawn();
    }, 0.5));
  }
  fadeTo(fn, dur = 0.4) {
    const el = document.getElementById('flash');
    el.style.transition = `opacity ${dur}s`;
    el.style.background = '#1d1638';
    el.style.opacity = '1';
    this.after(dur, () => {
      fn();
      el.style.transition = `opacity ${dur * 1.4}s`;
      el.style.opacity = '0';
    });
  }

  // ------------------------------------------------------------------ in-stage cutscenes
  // fn(dir) runs with gameplay frozen (visuals alive), camera under script control.
  async runCutscene(fn, o = {}) {
    if (this.state === 'cutscene') return;
    this.state = 'cutscene';
    CTX.input.setTouchVisible(false);
    if (o.hideHud !== false) CTX.hud.show(false);
    CTX.hud.setPrompt(null);
    const p = this.player;
    p.vel.set(0, 0, 0);
    if (p.ability && p.ability.end) { p.ability.end(p, true); p.ability = null; }
    if (p.state === 'hover' || p.state === 'hurt') p.setState('normal');
    const dir = new Director({ skippable: o.skippable ?? false });
    this.cutscene = dir;
    this.cutsceneCam = o.camera !== false;
    if (this.cutsceneCam) CTX.cam.mode = 'manual';
    try { await fn(dir); } catch (e) { console.error(e); }
    dir.letterbox(false);
    dir.captionOff();
    setTimeout(() => dir.dispose(), 800);
    this.cutscene = null;
    this.cutsceneCam = false;
    p.lockAnim = null;
    CTX.cam.mode = 'follow';
    if (o.snap !== false) CTX.cam.snap(p);
    if (this.state === 'cutscene') {
      this.state = 'play';
      CTX.hud.show(true);
      CTX.input.setTouchVisible(CTX.game.touchMode);
    }
    CTX.input.clearAll();
  }

  // ------------------------------------------------------------------ menus
  pauseMenu() {
    this.state = 'menu';
    CTX.input.setTouchVisible(false);
    if (CTX.audio) { CTX.audio.sfx('pause'); }
    openPause({
      stageId: this.stageId,
      resume: () => this.resume(),
      onChar: (id) => { this.changeChar(id); },
      onPet: (id) => { this.setPet(id); },
      onExit: () => this.exitToMap(),
    });
  }
  resume() { this.state = 'play'; CTX.input.setTouchVisible(CTX.game.touchMode); CTX.input.clearAll(); }
  charMenu() {
    this.state = 'menu';
    CTX.input.setTouchVisible(false);
    openCharSelect({ onPick: (id) => { this.changeChar(id); this.resume(); }, onClose: () => this.resume() });
  }
  petMenu() {
    this.state = 'menu';
    CTX.input.setTouchVisible(false);
    openPetBox({ onPick: (id) => this.setPet(id), onClose: () => this.resume() });
  }
  async exitToMap() {
    const { MapMode } = await import('./map.js');
    CTX.game.transition(() => CTX.game.setMode(new MapMode({ focus: this.stageId })));
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const ui = CTX.ui;
    if (this.state === 'menu') { if (!ui.busy()) this.resume(); return; }
    if (this.state === 'cutscene' || this.state === 'clear') { if (this.cutscene) this.cutscene.update(dt); this._visualTick(dt); return; }
    if (this.state !== 'play') return;
    const I = CTX.input;
    if (ui.busy()) { this._visualTick(dt); return; }
    if (I.pressed('pause')) { this.pauseMenu(); return; }
    if (I.pressed('char')) { this.charMenu(); return; }
    if (I.pressed('pet')) { this.petMenu(); return; }
    this._tickTimers(dt);
    this.t += dt;
    this.stats.time += dt;
    const p = this.player, level = this.level;
    const ws = dt * CTX.worldScale;
    level.physics.beginFrame();
    level.updatePre(ws);
    p.update(dt);
    Abilities.tick(p, dt);
    if (CTX.pet) CTX.pet.update(dt);
    this.projectiles.update(ws);
    if (this.boss) this.boss.update(ws);
    level.update(ws);
    this.pickups.update(dt);
    level.physics.updateTriggers(p.pos, dt);
    CTX.cam.update(dt, p, I);
    CTX.env.update(dt, p.pos, CTX.camera);
    CTX.fx.update(dt);
    CTX.particles.update(dt, CTX.camera);
    this.updateShadows();
    if (this.script.update) this.script.update(dt, this);
    if (Save.data) Save.data.playTime += dt;
  }
  // keep visuals alive while dialogs/cutscenes run (no gameplay simulation)
  _visualTick(dt) {
    const p = this.player;
    p._finish(dt);
    if (CTX.pet) CTX.pet.update(dt);
    if (!this.cutsceneCam) CTX.cam.update(dt, p, null);
    CTX.env.update(dt, p.pos, CTX.camera);
    CTX.fx.update(dt);
    CTX.particles.update(dt, CTX.camera);
    if (this.boss && this.boss.visualTick) this.boss.visualTick(dt);
    this.updateShadows();
  }
  updateShadows() {
    const S = CTX.shadows;
    S.begin();
    const ph = this.level.physics;
    const add = (x, y, z, size, a = 0.32) => {
      const g = ph.groundBelow(x, y + 0.2, z, 30);
      if (!g) return;
      const h = Math.max(0, y - g.y);
      const k = Math.max(0.35, 1 - h * 0.06);
      S.push(x, g.y + 0.03, z, size * k, 0.16, 0.1, 0.3, a * k, 0, 14);
    };
    const p = this.player;
    if (!p.dead && p.node.visible) add(p.pos.x, p.pos.y, p.pos.z, 1.05, 0.38);
    if (CTX.pet && CTX.pet.pos) add(CTX.pet.pos.x, CTX.pet.pos.y - 0.2, CTX.pet.pos.z, 0.45, 0.22);
    for (const e of this.level.enemies) if (e.alive && e.shadowSize && e.node.visible) add(e.pos.x, e.pos.y, e.pos.z, e.shadowSize, 0.3);
    if (this.boss && this.boss.shadow) { const b = this.boss.shadow(); if (b) add(b.x, b.y, b.z, b.size, 0.35); }
    if (this.level.extraShadows) for (const s of this.level.extraShadows) add(s.x, s.y, s.z, s.size, s.a ?? 0.3);
  }

  // ------------------------------------------------------------------ stage clear
  async stageClear() {
    if (this.state === 'clear') return;
    this.state = 'clear';
    const sd = this.sd;
    const firstClear = !sd.cleared;
    sd.cleared = true;
    sd.time = Math.round(this.stats.time);
    if (Save.data) {
      const id = +this.stageId;
      if (Save.data.unlockedStage <= id && id < 8) Save.data.unlockedStage = id + 1;
      Save.write();
    }
    CTX.input.setTouchVisible(false);
    const { playStageClear } = await import('../story/sequences.js');
    await playStageClear(this, firstClear);
  }
}
void rgb; void COOKIE_STAGE;

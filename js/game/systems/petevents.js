// ============================================================================
// petevents.js — meeting new pets: little story events placed in stages.
// kinds: bubble (pop a fog bubble), collect (find N things), chase (catch the
// shy pet), feed (share candies), bells (repeat a melody), quiz (answer),
// race (fly through rings in time), targets (hit all in time), torches.
// ============================================================================
import { Vec3, TAU, clamp, Ease, lerp } from '../../engine/math.js';
import { Node, Mesh } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { buildPet } from '../models/pets.js';
import { buildObject } from '../models/objects.js';
import { softGlowMaterial } from '../models/props.js';
import { PET_BY_ID } from '../data/pets.js';
import { Save } from '../save.js';
import { PAL } from '../fx.js';
import { Torch } from './interact.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const ITEM_STYLE = {
  pollen: { color: 0xffe066, label: '꽃가루' },
  spot: { color: 0xff5a6a, label: '점' },
  light: { color: 0xd8ff6a, label: '반딧불' },
  note: { color: 0x8fd8ff, label: '음표' },
  shell: { color: 0xffc8e0, label: '조개' },
  feather: { color: 0xfff2c0, label: '깃털' },
  gear: { color: 0xc8b8ff, label: '톱니' },
  star: { color: 0xfff0a0, label: '별조각' },
};

function glowOrb(color, r = 0.22) {
  const n = new Node('orb');
  const core = new Mesh(G.UNIT.sphere(), new Material({ color, unlit: true }));
  core.scale.set(r, r, r);
  const halo = new Mesh(G.UNIT.sphere(), softGlowMaterial(color, { opacity: 0.9, rim: 1.3 }));
  halo.scale.set(r * 3, r * 3, r * 3);
  const star = new Mesh(G.UNIT.star(), new Material({ color: 0xffffff, unlit: true }));
  star.scale.set(r * 0.9, r * 0.9, r * 0.4);
  n.add(core, halo, star);
  n.userData.halo = halo; n.userData.star = star;
  return n;
}

export class PetEvent {
  // o: { kind, lines:[...] intro dialog, thanks, items:[[x,y,z]], itemKind, perches, need, bells, questions, rings, time, targets, torches, hits }
  constructor(stage, level, petId, x, y, z, o = {}) {
    this.stage = stage; this.level = level; this.petId = petId; this.o = o;
    this.def = PET_BY_ID[petId];
    this.kind = o.kind || 'bubble';
    this.pos = new Vec3(x, y, z);
    this.node = new Node('petEvent-' + petId);
    this.node.position.copy(this.pos);
    this.rig = buildPet(petId);
    this.petNode = new Node('petHolder');
    this.petNode.add(this.rig.root);
    this.node.add(this.petNode);
    this.t = 0; this.anim = 'idle'; this.animT = 0;
    this.state = 'wait';
    this.done = !!(Save.data && Save.hasPet(petId));
    this.name = this.def.name;
    this.face = 'pet:' + petId;
    if (this.done) { this.node.visible = false; this.state = 'done'; return; }
    this.prompt = this.kind !== 'bubble' && this.kind !== 'chase';
    if (this.kind === 'bubble') this._initBubble();
    if (this.kind === 'collect') this._initCollect();
    if (this.kind === 'chase') { this.perches = (o.perches || []).map((p) => new Vec3(...p)); this.perchI = 0; this.flyT = -1; }
    if (this.kind === 'bells') this._initBells();
    if (this.kind === 'race') this._initRace();
    if (this.kind === 'targets') this._initTargets();
    if (this.kind === 'torches') this._initTorches();
    level.add(this);
  }
  say(lines) {
    return CTX.ui.dialog(lines.map((l) => (typeof l === 'string' ? { who: this.name, text: l, face: this.face } : Array.isArray(l) ? { who: l[0] === 'me' ? '소미' : (l[0] || this.name), text: l[1], face: l[0] === 'me' ? 'char:' + CTX.player.charId : (l[2] ?? this.face) } : l)));
  }

  // ---------------------------------------------------------------- bubble
  _initBubble() {
    this.hits = this.o.hits ?? 3;
    const b = new Mesh(G.UNIT.sphereHi ? G.UNIT.sphereHi() : G.UNIT.sphere(), new Material({ color: 0xb8acd8, spec: 0.8, rim: 1.0, transparent: true, opacity: 0.5, depthWrite: false }));
    b.scale.set(0.62, 0.62, 0.62);
    b.renderOrder = 55;
    this.bubble = b;
    this.node.add(b);
    this.anim = 'sad';
    this.hitbox = this.level.addHittable({ pos: this.pos.clone(), r: 0.75, onHit: () => this._bubbleHit() });
  }
  _bubbleHit() {
    if (this.state !== 'wait') return false;
    if (this.cool > 0) return true;
    this.cool = 0.25;
    this.hits--;
    this.wob = 1;
    sfx('crystal', { pitch: 1.3 });
    CTX.fx.sparkle(this.pos, PAL.lav, 6, 0.5);
    if (this.hits <= 0) {
      this.state = 'joining';
      this.bubble.visible = false;
      this.hitbox.enabled = false;
      sfx('pop');
      CTX.fx.pop(this.pos);
      this.join();
    }
    return true;
  }

  // ---------------------------------------------------------------- collect
  _initCollect() {
    const st = ITEM_STYLE[this.o.itemKind || 'pollen'];
    this.items = (this.o.items || []).map((p) => {
      const n = glowOrb(st.color);
      n.position.set(...p);
      n.visible = false;
      this.level.root.add(n);
      return { n, pos: new Vec3(...p), got: false, ph: Math.random() * TAU };
    });
    this.got = 0;
    this.label = this.o.label || st.label;
    this.anim = 'sad';
  }
  // ---------------------------------------------------------------- bells
  _initBells() {
    this.bells = (this.o.bells || []).map((p, i) => {
      const obj = buildObject('bell');
      obj.root.position.set(...p);
      if (this.o.bellYaw !== undefined) obj.root.rotation.y = this.o.bellYaw;
      this.level.root.add(obj.root);
      const b = { obj, pos: new Vec3(...p), i };
      b.hit = this.level.addHittable({ pos: new Vec3(p[0], p[1] + 1.3, p[2]), r: 0.7, onHit: () => this._bellHit(b) });
      return b;
    });
    this.order = this.o.order || [0, 1, 2];
    this.pitches = [1.0, 1.26, 1.5, 1.68, 2.0];
    this.seqI = 0;
    this.playing = null;
    this.anim = 'idle';
  }
  _ring(b) { b.obj.ring(1); sfx('bell', { pitch: this.pitches[b.i % this.pitches.length] }); CTX.fx.notes(new Vec3(b.pos.x, b.pos.y + 1.8, b.pos.z), 2); }
  _bellHit(b) {
    if ((b.cool || 0) > 0) return true;
    b.cool = 0.3;
    this._ring(b);
    if (this.state !== 'active' || this.playing) return true;
    if (this.order[this.seqI] === b.i) {
      this.seqI++;
      if (this.seqI >= this.order.length) { this.state = 'joining'; if (CTX.audio) CTX.audio.jingle('quizRight'); this.join(); }
    } else {
      // wrong bell: replay the melody right away (input is ignored while it plays)
      this.seqI = 0;
      if (CTX.audio) CTX.audio.jingle('quizWrong');
      CTX.hud.toast('앗, 순서가 달라요! 다시 들어 봐요', 'warn');
      this._playMelody(1.2);
    }
    return true;
  }
  _playMelody(delay = 0.6) {
    this.playing = { t: -delay, i: 0 };
  }
  // ---------------------------------------------------------------- race (rings)
  _initRace() {
    this.rings = (this.o.rings || []).map((r, i) => {
      const n = new Node('raceRing');
      const m = new Mesh(G.torusGeo(1.25, 0.12, 8, 36), new Material({ color: 0xffd84a, emissive: 0x403000, spec: 0.5, rim: 0.6 }));
      const g = new Mesh(G.torusGeo(1.25, 0.32, 6, 36), softGlowMaterial(0xfff0a0, { opacity: 0.6, rim: 1.2 }));
      n.add(m, g);
      n.position.set(r[0], r[1], r[2]);
      n.rotation.y = r[3] || 0;
      n.visible = false;
      this.level.root.add(n);
      return { n, m, g, pos: new Vec3(r[0], r[1], r[2]), yaw: r[3] || 0, passed: false, i };
    });
    this.raceT = 0;
  }
  // ---------------------------------------------------------------- targets
  _initTargets() {
    this.targets = (this.o.targets || []).map((p) => {
      const obj = buildObject('target');
      obj.root.position.set(p[0], p[1], p[2]);
      obj.root.rotation.y = p[3] || 0;
      this.level.root.add(obj.root);
      const tg = { obj, pos: new Vec3(p[0], p[1], p[2]), done: false };
      tg.hit = this.level.addHittable({ pos: new Vec3(p[0], p[1] + 1.1, p[2]), r: 0.7, onHit: () => this._targetHit(tg) });
      return tg;
    });
    this.raceT = 0;
  }
  _targetHit(tg) {
    if (tg.done) return false;
    tg.obj.hit();
    sfx('drum1', { pitch: 1.2 });
    if (this.state !== 'active') { if (!this._tHint) { this._tHint = true; CTX.hud.toast(`${this.name}에게 먼저 말을 걸어 봐요!`, 'warn'); } return true; }
    tg.done = true; tg.obj.setDone();
    CTX.fx.sparkle(new Vec3(tg.pos.x, tg.pos.y + 1.1, tg.pos.z), PAL.gold, 12, 0.5);
    const left = this.targets.filter((x) => !x.done).length;
    CTX.hud.setGauge(1 - left / this.targets.length, `과녁 ${this.targets.length - left}/${this.targets.length}`);
    if (left === 0) { this.state = 'joining'; CTX.hud.setGauge(null); if (CTX.audio) CTX.audio.jingle('quizRight'); this.join(); }
    return true;
  }
  _resetTargets() {
    for (const tg of this.targets) {
      tg.done = false;
      // the target model only exposes a `done` getter; reset through its own API when it has one
      try { if (tg.obj.reset) tg.obj.reset(); else if (Object.getOwnPropertyDescriptor(tg.obj, 'done')?.set) tg.obj.done = false; } catch (e) { /* visual only */ }
    }
  }
  // ---------------------------------------------------------------- torches
  _initTorches() {
    this.torches = (this.o.torches || []).map((p) => {
      const t = new Torch(this.level, p[0], p[1], p[2], null, {});
      this.level.add(t);
      return t;
    });
  }

  // ---------------------------------------------------------------- talk / start
  async talk() {
    this.talking = true;
    CTX.hud.setPrompt(null);
    const o = this.o;
    if (this.kind === 'collect') {
      if (this.state === 'wait') {
        await this.say(o.lines || [`내 ${this.label}를 잃어버렸어... 찾아 줄 수 있니?`]);
        this.state = 'active';
        for (const it of this.items) { it.n.visible = true; CTX.fx.sparkle(it.pos, PAL.gold, 6, 0.4); }
        CTX.hud.setGauge(0, `${this.label} 0/${this.items.length}`);
        CTX.hud.pointAt(this._nearestItem().pos, 5);
        sfx('notify');
      } else if (this.state === 'active') {
        await this.say([`${this.label}가 ${this.items.length - this.got}개 더 남았어! 반짝반짝 빛나는 걸 찾아 줘!`]);
        const n = this._nearestItem(); if (n) CTX.hud.pointAt(n.pos, 5);
      }
    } else if (this.kind === 'feed') {
      const need = o.need ?? 20;
      const r = await this.say([...(o.lines || []), { who: this.name, text: `별사탕 ${need}개만 나눠 줄래? (지금 ${Save.data ? Save.data.candies : 0}개 있어요)`, face: this.face, choices: [`별사탕 ${need}개 주기`, '나중에 줄게'] }]);
      if (r === 0) {
        if (Save.data && Save.data.candies >= need) {
          Save.data.candies -= need; Save.write();
          CTX.hud.setCandies(Save.data.candies);
          for (let i = 0; i < 6; i++) setTimeout(() => { CTX.fx.candy(new Vec3(this.pos.x, this.pos.y + 0.2, this.pos.z), [1, 0.85, 0.3]); sfx('coin', { pitch: 1 + i * 0.08 }); }, i * 90);
          this.state = 'joining';
          await this.join();
        } else await this.say([`앗, 별사탕이 조금 모자라. 별사탕을 더 모아서 다시 와 줘!`]);
      }
    } else if (this.kind === 'bells') {
      if (this.state === 'wait') await this.say(o.lines || ['내 노래를 잘 듣고, 종을 같은 순서로 쳐 줄래?']);
      else await this.say(['한 번 더 불러 줄게. 잘 들어 봐!']);
      this.state = 'active'; this.seqI = 0;
      this._playMelody(0.4);
    } else if (this.kind === 'quiz') {
      await this.say(o.lines || ['문제를 맞히면 친구가 되어 줄게!']);
      for (const q of o.questions || []) {
        for (;;) {
          const r = await this.say([{ who: this.name, text: q.q, face: this.face, choices: q.choices }]);
          if (r === q.answer) { if (CTX.audio) CTX.audio.jingle('quizRight'); await this.say([q.right || '딩동댕! 정답이야!']); break; }
          if (CTX.audio) CTX.audio.jingle('quizWrong');
          await this.say([q.wrong || '음... 다시 한 번 생각해 볼래?']);
        }
      }
      this.state = 'joining';
      await this.join();
    } else if (this.kind === 'race') {
      await this.say(this.state === 'wait' ? (o.lines || [`반짝이는 고리를 ${o.time ?? 30}초 안에 모두 지나가 봐!`]) : ['다시 해 볼까? 이번엔 할 수 있을 거야!']);
      this._startRace();
    } else if (this.kind === 'targets') {
      await this.say(this.state === 'wait' ? (o.lines || [`과녁을 ${o.time ?? 25}초 안에 모두 맞혀 봐!`]) : ['다시 도전! 이번엔 꼭 할 수 있어!']);
      this.state = 'active'; this.raceT = o.time ?? 25;
      this._resetTargets();
      CTX.hud.setGauge(0, `과녁 0/${this.targets.length}`);
      sfx('notify');
    } else if (this.kind === 'torches') {
      if (this.torches.every((t) => t.lit)) { this.state = 'joining'; await this.join(); }
      else { await this.say(o.lines || ['횃불을 모두 켜 주면 따뜻해질 것 같아... 불을 쓸 수 있는 친구가 필요해!']); this.state = 'active'; }
    } else if (this.kind === 'chase') {
      await this.say(o.endLines || ['헤헤, 잡혔다! 너 정말 빠르구나!']);
      this.state = 'joining';
      await this.join();
    }
    this.talking = false;
  }
  _nearestItem() {
    let best = null, bd = 1e9;
    for (const it of this.items || []) { if (it.got) continue; const d = it.pos.distanceTo(CTX.player.pos); if (d < bd) { bd = d; best = it; } }
    return best;
  }
  _startRace() {
    this.state = 'active';
    this.raceT = this.o.time ?? 30;
    this.ringI = 0;
    for (const r of this.rings) { r.passed = false; r.n.visible = true; r.n.scale.set(1, 1, 1); }
    CTX.hud.setGauge(1, `남은 시간 ${Math.ceil(this.raceT)}초`);
    if (CTX.audio) CTX.audio.playMusic('minigame');
    sfx('notify');
    CTX.hud.banner('시작!', '', 1.0);
  }
  _endRace(win) {
    CTX.hud.setGauge(null);
    if (CTX.audio) CTX.audio.playMusic(this.stage.musicId || 'meadow');
    if (win) { this.state = 'joining'; if (CTX.audio) CTX.audio.jingle('quizRight'); this.join(); }
    else {
      this.state = 'retry';
      for (const r of this.rings) r.n.visible = false;
      if (CTX.audio) CTX.audio.jingle('tryagain');
      CTX.hud.toast(`아깝다! ${this.name}에게 다시 말을 걸면 또 도전할 수 있어요`, 'warn', 3);
    }
  }

  // ---------------------------------------------------------------- join the party
  async join() {
    this.anim = 'happy'; this.animT = 0;
    this.state = 'joining';
    sfx('petSummon');
    CTX.fx.sparkle(this.pos, PAL.gold, 16, 0.6);
    // fly in a happy loop toward the player
    const p = CTX.player;
    const from = this.pos.clone();
    const dur = 1.0;
    await new Promise((res) => {
      this._flyHome = { from, t: 0, dur, res };
    });
    await this.stage.gainPet(this.petId, { thanks: this.o.thanks });
    this.state = 'done';
    this.node.visible = false;
    if (CTX.pet && CTX.pet.id === this.petId) { CTX.pet.pos.copy(this.node.position); CTX.pet.lastPos.copy(this.node.position); }
    if (this.o.onJoin) this.o.onJoin(this);
    void p;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    if (this.state === 'done') return;
    this.t += dt; this.animT += dt;
    if (this.cool > 0) this.cool -= dt;
    const p = CTX.player;
    const ui = CTX.ui;
    let bob = Math.sin(this.t * 2.2) * 0.12;
    // fly-to-player animation when joining
    if (this._flyHome) {
      const f = this._flyHome;
      f.t += dt;
      const k = clamp(f.t / f.dur, 0, 1);
      const to = new Vec3(p.pos.x - 0.7, p.pos.y + 1.5, p.pos.z - 0.5);
      const e = Ease.inOutSine(k);
      this.node.position.set(lerp(f.from.x, to.x, e), lerp(f.from.y, to.y, e) + Math.sin(k * Math.PI) * 1.5, lerp(f.from.z, to.z, e));
      this.petNode.rotation.y = Math.atan2(to.x - f.from.x, to.z - f.from.z);
      if (Math.random() < dt * 30) CTX.fx.rainbowTrail(this.node.position);
      if (k >= 1) { this._flyHome = null; f.res(); }
      this.rig.update(dt, { anim: 'happy', t: this.animT, speed: 1 });
      return;
    }
    // kind-specific
    if (this.kind === 'bubble' && this.bubble) {
      this.wob = Math.max(0, (this.wob || 0) - dt * 3);
      const s = 0.62 * (1 + Math.sin(this.t * 30) * 0.08 * this.wob) * (1 + Math.sin(this.t * 1.8) * 0.03);
      this.bubble.scale.set(s, s * (1 - this.wob * 0.06), s);
      if (Math.random() < dt * 2) CTX.fx.fogPuff({ x: this.pos.x, y: this.pos.y + bob, z: this.pos.z }, 1);
      if (this.hitbox) this.hitbox.pos.set(this.pos.x, this.pos.y + bob, this.pos.z);
      if (!this._seen && p.pos.distanceTo(this.pos) < 7) { this._seen = true; CTX.hud.toast(`${this.def.kind}가 안개 방울에 갇혀 있어요! 공격해서 꺼내 줘요`, 'pet', 3); }
    }
    if (this.kind === 'collect' && this.state === 'active') {
      for (const it of this.items) {
        if (it.got) continue;
        it.ph += dt;
        it.n.position.set(it.pos.x, it.pos.y + Math.sin(it.ph * 2.4) * 0.15, it.pos.z);
        it.n.userData.star.rotation.y = it.ph * 2;
        const k = 1 + Math.sin(it.ph * 4) * 0.12; it.n.userData.halo.scale.set(0.66 * k, 0.66 * k, 0.66 * k);
        if (it.n.position.distanceTo(new Vec3(p.pos.x, p.pos.y + 0.55, p.pos.z)) < 1.0 || (CTX.pet && it.n.position.distanceTo(CTX.pet.pos) < 0.6)) {
          it.got = true; it.n.visible = false; this.got++;
          sfx('coinBig', { pitch: 1 + this.got * 0.06 });
          CTX.fx.sparkle(it.pos, PAL.gold, 14, 0.5);
          CTX.hud.setGauge(this.got / this.items.length, `${this.label} ${this.got}/${this.items.length}`);
          if (this.got >= this.items.length) {
            CTX.hud.setGauge(null);
            this.state = 'returning';
            CTX.hud.toast(`${this.label}를 모두 찾았어요! ${this.name}에게 돌아가요`, 'good', 3);
            CTX.hud.pointAt(this.pos, 6);
          }
        }
      }
    }
    if (this.kind === 'collect' && this.state === 'returning' && p.pos.distanceTo(this.pos) < 3.2 && !ui.busy()) {
      this.state = 'joining';
      if (CTX.audio) CTX.audio.jingle('quizRight');
      this.join();
    }
    if (this.kind === 'chase' && this.state === 'wait') {
      if (this.flyT >= 0) {
        this.flyT += dt;
        const a = this.perches[this.perchI - 1], b = this.perches[this.perchI];
        const k = clamp(this.flyT / 1.1, 0, 1), e = Ease.inOutSine(k);
        this.pos.set(lerp(a.x, b.x, e), lerp(a.y, b.y, e) + Math.sin(k * Math.PI) * 2.2, lerp(a.z, b.z, e));
        this.petNode.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        if (k >= 1) this.flyT = -1;
      } else if (this.perches.length && p.pos.distanceTo(this.pos) < 2.8) {
        if (this.perchI < this.perches.length - 1) {
          this.perchI++;
          this.flyT = 0;
          sfx('flap', { pitch: 1.6 });
          const lines = this.o.taunts || ['헤헤, 여기야~!', '잡아 봐~!', '조금만 더!'];
          CTX.fx.text(new Vec3(this.pos.x, this.pos.y + 0.8, this.pos.z), lines[(this.perchI - 1) % lines.length], 'pet');
          if (this.perchI === 1) CTX.hud.toast(`${this.name}가 술래잡기를 하자고 해요! 따라가 봐요`, 'pet', 3);
        } else this.prompt = true;
      }
      if (this.perchI >= this.perches.length - 1 && this.flyT < 0) this.prompt = true;
    }
    if (this.kind === 'bells' && this.playing) {
      const pl = this.playing;
      pl.t += dt;
      if (pl.t >= pl.i * 0.7 && pl.i < this.order.length) {
        const b = this.bells[this.order[pl.i]];
        this._ring(b);
        pl.i++;
      }
      if (pl.i >= this.order.length && pl.t > this.order.length * 0.7 + 0.2) { this.playing = null; CTX.hud.toast('이제 같은 순서로 종을 쳐 봐요!', 'pet', 2.6); }
      this.anim = 'happy';
    } else if (this.kind === 'bells') this.anim = this.state === 'active' ? 'idle' : 'idle';
    if (this.bells) for (const b of this.bells) { b.obj.update(dt); if (b.cool > 0) b.cool -= dt; }
    if (this.kind === 'race' && this.state === 'active') {
      this.raceT -= dt;
      CTX.hud.setGauge(clamp(this.raceT / (this.o.time ?? 30), 0, 1), `남은 시간 ${Math.max(0, Math.ceil(this.raceT))}초 · 고리 ${this.ringI}/${this.rings.length}`);
      const r = this.rings[this.ringI];
      for (const rr of this.rings) { rr.n.rotation.z += dt * (rr === r ? 1.5 : 0.3); rr.m.material.color = rr.passed ? [0.6, 0.95, 0.6] : rr === r ? [1, 0.85, 0.3] : [0.95, 0.9, 0.75]; rr.g.visible = rr === r; }
      if (r) {
        const c = new Vec3(p.pos.x, p.pos.y + 0.55, p.pos.z);
        if (c.distanceTo(r.pos) < 1.45) {
          r.passed = true; this.ringI++;
          sfx('chime', { pitch: 1 + this.ringI * 0.08 });
          CTX.fx.wave(r.pos, 2, PAL.gold);
          r.n.visible = false;
          if (this.ringI >= this.rings.length) this._endRace(true);
        }
      }
      if (this.state === 'active' && this.raceT <= 0) this._endRace(false);
    }
    if (this.kind === 'targets') {
      for (const tg of this.targets) tg.obj.update(dt);
      if (this.state === 'active') {
        this.raceT -= dt;
        if (this.raceT <= 0) {
          this.state = 'retry';
          CTX.hud.setGauge(null);
          for (const tg of this.targets) { tg.done = false; }
          if (CTX.audio) CTX.audio.jingle('tryagain');
          CTX.hud.toast(`시간이 다 됐어요! ${this.name}에게 다시 말을 걸어 봐요`, 'warn', 3);
        } else {
          const n = this.targets.filter((x) => x.done).length;
          CTX.hud.setGauge(n / this.targets.length, `과녁 ${n}/${this.targets.length} · ${Math.ceil(this.raceT)}초`);
        }
      }
    }
    if (this.kind === 'torches' && this.state === 'active' && this.torches.every((t) => t.lit)) {
      this.state = 'joining';
      if (CTX.audio) CTX.audio.jingle('quizRight');
      this.say(this.o.doneLines || ['따뜻해! 고마워!']).then(() => this.join());
    }
    // talk prompt
    const near = p.pos.distanceTo(this.pos) < (this.o.r ?? 2.8) && Math.abs(p.pos.y - this.pos.y) < 2.5;
    const canTalk = this.prompt && !this.talking && (this.state === 'wait' || this.state === 'active' || this.state === 'retry') && !(this.kind === 'race' && this.state === 'active') && !(this.kind === 'targets' && this.state === 'active') && !(this.kind === 'bells' && this.playing);
    if (near && canTalk && !ui.busy()) {
      CTX.hud.setPrompt(new Vec3(this.pos.x, this.pos.y + 0.9, this.pos.z), CTX.game.touchMode ? '공격 버튼: 이야기' : '공격(J/X): 이야기');
      this._prompting = true;
      if (CTX.input.pressed('attack') || (CTX.input.pressed('confirm') && !CTX.input.pressed('jump'))) { CTX.input.consume('attack'); this.talk(); }
    } else if (this._prompting) { this._prompting = false; CTX.hud.setPrompt(null); }
    // visuals
    this.node.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    if (!this._flyHome && (this.kind !== 'chase' || this.flyT < 0)) {
      const want = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      this.petNode.rotation.y += (want - this.petNode.rotation.y) * Math.min(1, dt * 3);
    }
    let anim = this.anim;
    if (this.kind === 'chase') anim = this.flyT >= 0 ? 'fly' : 'happy';
    if (this.kind === 'collect' && this.state === 'returning') anim = 'happy';
    if (this.talking) anim = 'happy';
    this.rig.update(dt, { anim, t: this.animT, speed: 0.5 });
    if (Math.random() < dt * 1.5 && this.state === 'wait' && this.kind !== 'bubble') CTX.fx.twinkle(new Vec3(this.pos.x, this.pos.y + 0.5, this.pos.z), PAL.gold, 0.5);
  }
}

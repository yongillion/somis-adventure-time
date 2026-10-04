// ============================================================================
// bosses/fogking.js — 회색 안개 (final boss, stage 8). A huge, sad fog giant
// (Noa's loneliness). Slams its floating hands (marker → impact ring; the
// resting hand can be hit), cries a rain of fog tears, roars (pushes outward +
// calls fog minions), then — tired — sinks and reveals its heart-star core
// (big damage). Between phases Noa's voice is heard. Defeat dissolves the fog
// and reveals Noa: the emotional climax, then the ending.
// ============================================================================
import { Vec3, lerp, clamp, TAU, Ease } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { BossController } from './boss.js';
import { buildNoa } from '../models/npcs.js';
import { PAL } from '../fx.js';
import { Save } from '../save.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
const SOMI = '소미', NOA = '노아';

export class FogKingBoss extends BossController {
  constructor(stage, o) {
    super(stage, { id: 'fogking', name: '회색 안개', hp: 90, music: 'finalboss', title: '모든 슬픔이 모인 곳', introDist: 13, outroDist: 9, camWeight: 0.3, hitInvuln: 0.35, wakeFrac: 0.62, ...o });
    this.patterns = [
      ['slamL', 'slamR', 'tears', 'slamR', 'slamL', 'reveal'],
      ['slamL', 'slamR', 'roar', 'tears', 'slamR', 'slamL', 'reveal'],
      ['slam2', 'tears', 'roar', 'slam2', 'tears', 'reveal'],
    ];
    this.stompable = false;
    this.sink = 0;
    this.restHand = null; // {x,y,z,t} hand lying on the ground after a slam (hittable)
    this.camFocus.max = 5;
    this.camFocus.y = () => this.pos.y + 3.2;
  }
  // body (fog: weak to hits) + resting hand + exposed core
  spheres() {
    const out = [];
    const y0 = this.pos.y;
    if (this.mode === 'weak') {
      const c = this.local(0, 2.75 + 0.2, 1.7);
      out.push({ x: c.x, y: y0 + c.y, z: c.z, r: 1.35, mul: 2.5, core: true });
    }
    out.push({ x: this.pos.x, y: y0 + 3.4, z: this.pos.z, r: 2.1, mul: 0.35, body: true });
    if (this.restHand) out.push({ x: this.restHand.x, y: this.ground + 0.6, z: this.restHand.z, r: 1.0, mul: 1, hand: true });
    return out;
  }
  local(x, y, z) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: this.pos.x + x * c + z * s, y, z: this.pos.z - x * s + z * c };
  }
  _contact(p) {
    if (!this.contact || this.mode === 'weak') return;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    if (Math.hypot(dx, dz) < 2.3 && p.pos.y < this.pos.y + 5.5) p.hurt(CTX.diff ? CTX.diff.bossDmg : 1, { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, { knock: 9, up: 6 });
  }
  shadow() { return { x: this.pos.x, y: this.ground + 0.2, z: this.pos.z, size: 5.5 }; }
  onBlocked() {}
  async introPose(dir) {
    this.play('roar');
    await dir.wait(0.5);
    sfx('bossRoar', { pitch: 0.7 });
    CTX.fx.shake(0.5, 1.2);
    for (let i = 0; i < 10; i++) CTX.fx.fogPuff({ x: this.pos.x + (Math.random() - 0.5) * 8, y: this.pos.y + 1 + Math.random() * 5, z: this.pos.z + (Math.random() - 0.5) * 6 }, 3);
    await dir.wait(1.4);
    this.play('idle');
  }
  onFightStart(quick) {
    this.setMode('idle');
    if (!quick) this.stage.after(1.2, () => this.stage.noaVoice && this.stage.noaVoice('...오지 마... 나는... 회색빛이야...'));
  }
  onReset() { this.sink = 0; this.restHand = null; this.slam = null; this._then = null; this.weakMul = 1; this.contact = true; this.armored = false; this.rig.setOpacity(1); }
  onPhase(n) {
    const v = this.stage.noaVoice;
    if (!v) return;
    if (n === 2) { v('...나도... 나도 여기 있는데... 왜 아무도 몰라줘...'); this.stage.after(2.6, () => CTX.hud.toast('이 목소리... 노아? 노아야, 내가 왔어!', 'pet', 3)); }
    if (n === 3) { v('...가까이 오지 마... 아니... 가지 마... 혼자는 싫어...'); this.stage.after(2.6, () => CTX.hud.toast('조금만 더! 노아의 슬픔을 걷어 내요!', 'good', 3)); }
  }
  // ---------------------------------------------------------------- AI
  think(dt) {
    const p = this.player;
    const ph = this.phase;
    // sink while weak, rise otherwise
    const sinkT = this.mode === 'weak' ? 1.25 : 0;
    this.sink += (sinkT - this.sink) * Math.min(1, dt * 3);
    this.pos.y = this.ground - this.sink;
    if (this.restHand) { this.restHand.t -= dt; if (this.restHand.t <= 0) this.restHand = null; }
    switch (this.mode) {
      case 'idle': {
        this.play('idle');
        this.facePlayer(1.2, dt);
        if (this.mt > [1.3, 1.0, 0.8][ph - 1]) this.setMode(this.nextFromPattern());
        break;
      }
      case 'slamL': case 'slamR': case 'slam2': {
        if (!this.slam) {
          const hand = this.mode === 'slamL' ? 'L' : 'R';
          if (this.mode === 'slam2') this._then = 'slamL'; // phase 3: right then left, back to back
          this.slam = { hand, t: 0, hit: false };
          this.play('handSlam', { hand });
          this.restartAnim();
          sfx('charge', { pitch: 0.5 });
        }
        const S = this.slam;
        S.t += dt;
        const sd = S.hand === 'L' ? -1 : 1;
        // aim the slam at the player while the hand rises
        if (S.t < 0.6) this.facePlayer(1.8 + ph * 0.4, dt);
        const imp = this.local(sd * 1.9, 0, 3.4);
        if (!S.mark && S.t > 0.05) S.mark = this.marker(imp.x, imp.z, 1.7, 0.75);
        if (S.mark && S.t < 0.82) S.mark.move(imp.x, imp.z);
        if (!S.hit && S.t >= 0.82) {
          S.hit = true;
          CTX.fx.shake(0.55, 0.45);
          CTX.fx.shock(new Vec3(imp.x, this.ground, imp.z), 3.2);
          sfx('crusher', { pitch: 0.65 });
          this.shock(imp.x, imp.z, { maxR: [8, 9.5, 11][ph - 1], speed: [6.5, 7.5, 8.5][ph - 1], color: 0xd8c8ff });
          if (Math.hypot(p.pos.x - imp.x, p.pos.z - imp.z) < 1.9 && p.pos.y < this.ground + 1.8) p.hurt(CTX.diff.bossDmg, { x: imp.x, y: this.ground, z: imp.z }, { knock: 9, up: 9 });
          this.restHand = { x: imp.x, z: imp.z, t: 0.68 };
          for (let i = 0; i < 5; i++) CTX.fx.fogPuff({ x: imp.x + (Math.random() - 0.5) * 2, y: this.ground + 0.4, z: imp.z + (Math.random() - 0.5) * 2 }, 2);
          if (!this._taughtHand) { this._taughtHand = true; CTX.hud.toast('땅에 닿은 손을 공격해 봐요!', 'good', 2.6); }
        }
        if (S.t > (this._then ? 1.6 : 2.1)) {
          this.slam = null;
          if (this._then) { const m = this._then; this._then = null; this.setMode(m); } else this.setMode('idle');
        }
        break;
      }
      case 'tears': {
        if (this.mt < dt * 1.5) { this.play('tearRain'); sfx('rain'); sfx('cry', { vol: 0.5, pitch: 0.8 }); this._tearN = 0; }
        const n = [9, 12, 15][ph - 1];
        const every = 2.6 / n;
        while (this._tearN < n && this.mt > 0.5 + this._tearN * every) {
          let x, z;
          if (this._tearN % 3 === 0) { x = p.pos.x + (Math.random() - 0.5) * 1.2; z = p.pos.z + (Math.random() - 0.5) * 1.2; }
          else { const q = this.randomArenaPoint(2, 0.85); x = q.x; z = q.z; }
          this.fall('fogball', x, z, { delay: 0.55, speed: 6.5, height: 9, r: 0.65, scale: 1.8, markColor: 0x9ab8ff });
          this._tearN++;
        }
        if (this.mt > 3.9) this.setMode('idle');
        break;
      }
      case 'roar': {
        if (this.mt < dt * 1.5) { this.play('roar'); this.restartAnim(); }
        if (this.mt > 0.4 && this.mt < 1.6) {
          if (!this._roared) { this._roared = true; sfx('bossRoar', { pitch: 0.8 }); CTX.fx.shake(0.4, 1.0); CTX.fx.wave(new Vec3(this.pos.x, this.ground + 0.3, this.pos.z), 10, [0.8, 0.75, 1]); }
          // push the player outward (heavy friends resist)
          const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
          const k = (p.heavy ? 1.2 : 4.2) * dt;
          if (!p.dead) { p.pos.x += dx / d * k; p.pos.z += dz / d * k; }
          if (Math.random() < dt * 30) CTX.fx.speedLines(new Vec3(p.pos.x, p.pos.y + 0.6, p.pos.z), { x: -dx / d, z: -dz / d });
        }
        if (this.mt > 1.0 && !this._called) { this._called = true; this.summon(ph >= 3 ? 'ghost' : 'gloomy', 2, { max: 3, dist: 4 }); if (ph >= 2) this.summon('flyer', 1, { max: 4, dist: 3 }); }
        if (this.mt > 2.2) { this._roared = false; this._called = false; this.setMode('idle'); }
        break;
      }
      case 'reveal': {
        if (this.mt < dt * 1.5) { this.play('coreReveal'); this.restartAnim(); sfx('heartbeat'); }
        if (this.mt > 1.0) this.setMode('weak');
        break;
      }
      case 'weak': {
        const dur = [5.0, 4.5, 4.0][ph - 1];
        if (this.mt < dt * 1.5) {
          this.play('weak');
          this.contact = false;
          sfx('star', { pitch: 0.8 });
          if (!this._taughtCore) { this._taughtCore = true; CTX.hud.toast('반짝이는 하트 별이 보여요! 지금이에요!', 'good', 3); }
        }
        if (Math.random() < dt * 6) { const c = this.local(0, 0, 1.8); CTX.fx.twinkle(new Vec3(c.x, this.pos.y + 2.9, c.z), [1, 0.85, 0.9], 0.8); }
        if (this.mt > dur) { this.contact = true; this.setMode('recover'); }
        break;
      }
      case 'recover': {
        if (this.mt < dt * 1.5) { this.play('idle'); sfx('whoosh', { pitch: 0.5 }); }
        if (this.mt > 1.0) this.setMode('idle');
        break;
      }
      default: this.setMode('idle');
    }
  }

  // ---------------------------------------------------------------- the climax: the fog dissolves and Noa appears
  async defeatCutscene(dir) {
    const p = this.player;
    const st = this.stage;
    if (st.clearNoaVoice) st.clearNoaVoice();
    dir.letterbox(true);
    this.rig.setFlash(0); this.flashT = 0;
    this.pos.y = this.ground;
    this.restHand = null;
    const c = new Vec3(this.pos.x, this.ground, this.pos.z);
    const front = this.local(0, 0, 4.2);
    // 1) the giant staggers and dissolves into soft light
    dir.shot([front.x + 9 * Math.sin(this.yaw + 0.4), this.ground + 4.2, front.z + 9 * Math.cos(this.yaw + 0.4)], [c.x, this.ground + 3.4, c.z], 52);
    this.play('hurt');
    for (let i = 0; i < 8; i++) { CTX.fx.hit({ x: c.x + (Math.random() - 0.5) * 4, y: this.ground + 1 + Math.random() * 5, z: c.z + (Math.random() - 0.5) * 3 }, PAL.white, 1.6); sfx('pop', { pitch: 0.6 + i * 0.06 }); await dir.wait(0.14); }
    if (CTX.audio) CTX.audio.playMusic('noa', { fade: 1.5, restart: true });
    this.play('dissolve');
    dir.camTo([front.x + 7 * Math.sin(this.yaw + 0.3), this.ground + 3.2, front.z + 7 * Math.cos(this.yaw + 0.3)], [c.x, this.ground + 2.8, c.z], 2.6);
    for (let i = 0; i < 14; i++) { CTX.fx.fogPuff({ x: c.x + (Math.random() - 0.5) * 6, y: this.ground + Math.random() * 6, z: c.z + (Math.random() - 0.5) * 4 }, 3); await dir.wait(0.17); }
    await dir.tween(0.8, (k) => this.rig.setOpacity(1 - k));
    this.node.visible = false;
    // 2) Noa — gray, crying — is revealed where the heart-star was
    const noa = buildNoa();
    noa.setGray(1);
    const npos = this.local(0, 0, 1.4);
    noa.root.position.set(npos.x, this.ground + 2.6, npos.z);
    noa.root.rotation.y = this.yaw;
    noa.root.scale.set(1.3, 1.3, 1.3);
    this.level.root.add(noa.root);
    dir.actor(noa, 'cry');
    CTX.fx.flash('#ffffff', 0.5, 0.5);
    await dir.tween(1.6, (k) => { noa.root.position.y = this.ground + 2.6 - 2.55 * Ease.inOutSine(k); });
    // player walks closer
    const meet = this.local(0, 0, 3.6);
    p.place(new Vec3(meet.x, this.ground, meet.z), this.yaw + Math.PI);
    p.yaw = this.yaw + Math.PI;
    const mid = { x: (npos.x + meet.x) / 2, z: (npos.z + meet.z) / 2 };
    const side = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    dir.shot([mid.x + side.x * 5.2, this.ground + 1.6, mid.z + side.z * 5.2], [mid.x, this.ground + 0.7, mid.z], 46);
    p.yaw = Math.atan2(npos.x - meet.x, npos.z - meet.z);
    if (CTX.audio) CTX.audio.sfx('cry', { vol: 0.5 });
    const me = 'char:' + p.charId;
    await dir.say([
      [NOA, '흑... 흑... 다들 나를 못 본 척했어... 나는 너무 작고 흐릿해서... 아무도 내 목소리를 듣지 못했어...', 'noaGray'],
    ]);
    p.lockAnim = 'talk';
    await dir.say([[SOMI, '내가 들었어. 계속 들렸어. 네가 혼자 울고 있는 소리.', me]]);
    await dir.say([[NOA, '...정말? 나를 찾으러 와 준 거야? 나는 회색 안개를 잔뜩 만들었는걸... 모두 나를 미워할 거야...', 'noaGray']]);
    await dir.say([
      [SOMI, '아니야. 너무 외로워서 그랬던 거잖아. 슬플 땐 슬프다고 말해도 괜찮아.', me],
      [SOMI, '찾았다, 노아. 이제 내가 네 친구야.', me],
    ]);
    // 3) the hug — color returns to Noa and to the whole Dreamland
    const close = this.local(0, 0, 2.15);
    const a0 = p.pos.clone();
    p.lockAnim = 'walk';
    await dir.tween(0.9, (k) => { p.pos.set(lerp(a0.x, close.x, k), this.ground, lerp(a0.z, close.z, k)); });
    p.lockAnim = 'celebrate';
    dir.anim(noa, 'hug');
    dir.camTo([mid.x + side.x * 3.6, this.ground + 1.3, mid.z + side.z * 3.6], [(npos.x + close.x) / 2, this.ground + 0.6, (npos.z + close.z) / 2], 1.6, Ease.inOutSine, 42);
    if (CTX.audio) CTX.audio.sfx('heartbeat');
    await dir.wait(1.2);
    if (CTX.audio) { CTX.audio.jingle('colorRestore'); CTX.audio.sfx('colorBloom'); }
    CTX.fx.flash('#fff8e0', 1.0, 0.9);
    await dir.tween(2.2, (k) => noa.setGray(1 - k));
    CTX.env.setBaseSat(1); CTX.env.setSkySat(1);
    CTX.env.addSpot(npos.x, this.ground, npos.z, 500);
    for (let i = 0; i < 5; i++) { CTX.fx.colorBloom(new Vec3(npos.x, this.ground, npos.z), i % 2 ? [1, 1, 1] : [1, 0.85, 0.5], 6 + i * 6); await dir.wait(0.3); }
    CTX.fx.confetti(new Vec3(npos.x, this.ground + 1.5, npos.z), 70);
    dir.anim(noa, 'happy');
    p.lockAnim = 'celebrate';
    dir.camTo([mid.x + side.x * 6.5, this.ground + 2.6, mid.z + side.z * 6.5], [mid.x, this.ground + 1.2, mid.z], 2.0);
    await dir.wait(1.6);
    await dir.say([[NOA, '따뜻해... 이게 친구구나. 고마워, 소미야! 이제 하나도 무섭지 않아!', 'noa']]);
    // 4) the Star Whale is free again
    const wh = st.whale;
    if (wh) {
      wh.root.visible = true;
      dir.actor(wh, 'swim');
      const w0 = wh.root.position.clone(), w1 = new Vec3(npos.x - 3, this.ground + 6.5, npos.z - 4);
      dir.camTo([mid.x + side.x * 9, this.ground + 3.5, mid.z + side.z * 9], [npos.x - 2, this.ground + 4.5, npos.z - 2], 3.0);
      await dir.tween(3.2, (k) => {
        wh.setFogged(1 - k);
        wh.root.position.set(lerp(w0.x, w1.x, Ease.inOutSine(k)), lerp(w0.y, w1.y, Ease.inOutSine(k)), lerp(w0.z, w1.z, Ease.inOutSine(k)));
        if (Math.random() < 0.5) CTX.fx.rainbowTrail(new Vec3(wh.root.position.x, wh.root.position.y, wh.root.position.z));
      });
      dir.anim(wh, 'happy');
      await dir.say([
        ['별고래', '소미야! 해냈구나! 노아의 슬픔이 걷히자 안개도 모두 사라졌단다.', 'whale'],
        [SOMI, '별고래야! 다시 만났다!', me],
      ]);
    }
    this.noa = noa;
    p.lockAnim = null;
    dir.letterbox(false);
  }
  afterDefeat() {
    // no dream light: the heart's light came back with Noa — go straight to the finale
    if (Save.data) { Save.flag('foundNoa', true); Save.write(); }
    this.stage.stageClear();
  }
}
void clamp; void TAU;

// ============================================================================
// player.js — Somi's controller: Kirby-like run / jump / hover-float,
// swim, climb, hurt/death/respawn, character switching. Weapons & specials
// are delegated to systems/weapons.js and systems/abilities.js.
// ============================================================================
import { bakeTree } from '../engine/bake.js';
import { Node } from '../engine/scene.js';
import { Vec3, clamp, damp, dampAngle, moveToward, lerp, angleDiff } from '../engine/math.js';
import { CTX, PHYS } from './ctx.js';
import { CHAR_BY_ID } from './data/characters.js';
import { buildAnimal } from './models/animals.js';
import { Weapons } from './systems/weapons.js';
import { Abilities } from './systems/abilities.js';
import { PAL } from './fx.js';

const rigCache = new Map();

export class Player {
  constructor() {
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.yaw = 0;
    this.node = new Node('player');
    this.body = {
      pos: this.pos, vel: this.vel, r: PHYS.radius, h: PHYS.height, stepUp: PHYS.stepUp, snapDown: 0.34, margin: 0.12,
      grounded: false, ground: null, onCarryYaw: (d) => { this.yaw += d; },
    };
    this.state = 'normal';
    this.stateT = 0;
    this.hp = 6; this.maxHp = 6;
    this.invuln = 0;
    this.coyote = 0; this.jumpBuf = 0; this.jumpHeld = false; this.jumping = false;
    this.flaps = 0; this.hoverT = 0; this.airJumps = 0;
    this.attackT = 9; this.attackAnim = 'punch'; this.attackDur = 0.28; this.airAttackT = 9;
    this.special = { cd: 0, cdMax: 1 };
    this.ability = null; // active ability state
    this.locked = false;
    this.lockAnim = null;
    this.celebrateT = 0;
    this.safePos = new Vec3(); this.safeT = 0; this.safeYaw = 0;
    this.checkpoint = { pos: new Vec3(), yaw: 0 };
    this.swimW = null;
    this.climbC = null; this.climbN = { x: 0, z: 1 };
    this.dead = false;
    this.lowGrav = 0; // moonjump timer
    this.slowMul = 1;
    this.speedMul = 1;
    this.shield = 0; // bubble shield hits
    this.bubbleT = 0;
    this.prevGrounded = false;
    this.fallStartY = 0;
    this.stepT = 0;
    this.carry = null; // carried item
    this.onDamage = null; this.onDeath = null; this.onFall = null;
    this.charId = null;
    this.rig = null;
    this.animState = { anim: 'idle', t: 0, speed: 0, vy: 0, attackKind: 'punch', specialKind: 'cast' };
    this._mv = new Vec3();
    this.reviveUsed = false;
  }

  get def() { return CHAR_BY_ID[this.charId]; }
  get grounded() { return this.body.grounded; }
  get center() { return new Vec3(this.pos.x, this.pos.y + 0.55, this.pos.z); }
  facing(out = { x: 0, z: 0 }) { out.x = Math.sin(this.yaw); out.z = Math.cos(this.yaw); return out; }
  get heavy() { return !!this.def.stats.heavy; }
  get swimmer() { return !!this.def.stats.swim; }
  get climber() { return !!this.def.stats.climb; }

  setCharacter(id, withFx = false) {
    if (!CHAR_BY_ID[id]) id = 'cat';
    if (this.ability && this.ability.end) this.ability.end(this, true);
    this.ability = null;
    if (this.rig) this.node.remove(this.rig.root);
    let rig = rigCache.get(id);
    if (!rig) { rig = buildAnimal(id); bakeTree(rig.root); rigCache.set(id, rig); }
    this.rig = rig;
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.set(0, 0, 0);
    rig.root.scale.set(1, 1, 1);
    rig.root.visible = true;
    rig.setOpacity(1); rig.setFlash(0);
    this.node.add(rig.root);
    this.charId = id;
    this.special.cd = 0;
    this.special.cdMax = this.def.special.cd;
    Weapons.reset(this);
    if (withFx) {
      CTX.fx.poof(this.center);
      if (CTX.audio) CTX.audio.sfx('transform');
      this.invuln = Math.max(this.invuln, 0.6);
      rig.trigger('jump', 1.4);
      this.celebrateT = 0.0;
    }
    if (CTX.hud) CTX.hud.setCharacter(id);
  }

  place(pos, yaw = 0) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.body.grounded = false; this.body.ground = null;
    this.state = 'normal'; this.stateT = 0;
    this.safePos.copy(pos); this.safeYaw = yaw;
    this.fallStartY = pos.y;
  }
  setCheckpoint(pos, yaw) { this.checkpoint.pos.copy(pos); this.checkpoint.yaw = yaw; this.reviveUsed = false; }
  resetHp() { this.maxHp = CTX.diff.maxHp; this.hp = this.maxHp; if (CTX.hud) CTX.hud.setHp(this.hp, this.maxHp); }

  // ------------------------------------------------------------------ damage
  hurt(dmg = 1, from = null, o = {}) {
    if (this.dead || this.locked) return false;
    if (this.invuln > 0 && !o.force) return false;
    if (this.ability && this.ability.invulnerable && this.ability.invulnerable(this, o)) return false;
    if (this.shield > 0 && !o.force) {
      this.shield--;
      CTX.fx.hit(this.center, PAL.sky, 1.2);
      if (CTX.audio) CTX.audio.sfx('block');
      this.invuln = 0.8;
      if (CTX.pet) CTX.pet.onShieldUsed && CTX.pet.onShieldUsed();
      if (this.onShieldBreak) this.onShieldBreak();
      return false;
    }
    if (CTX.pet && CTX.pet.tryBlock && CTX.pet.tryBlock()) { this.invuln = 0.8; return false; }
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = CTX.diff.invuln;
    this.rig.trigger('hit');
    CTX.fx.hit(this.center, PAL.pink, 1);
    CTX.fx.shake(0.22, 0.25);
    CTX.fx.hitStop(0.06);
    if (CTX.audio) CTX.audio.sfx('hurt');
    if (CTX.save && CTX.save.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(40); } catch (_) { /* ignore */ } }
    if (CTX.hud) CTX.hud.setHp(this.hp, this.maxHp, true);
    // knockback
    if (!o.noKnock) {
      let kx = 0, kz = 0;
      if (from) { kx = this.pos.x - from.x; kz = this.pos.z - from.z; const l = Math.hypot(kx, kz) || 1; kx /= l; kz /= l; }
      else { const f = this.facing(); kx = -f.x; kz = -f.z; }
      const k = o.knock ?? 6;
      this.vel.x = kx * k; this.vel.z = kz * k;
      this.vel.y = Math.max(this.vel.y, o.up ?? 6);
      this.body.grounded = false;
      if (this.ability && this.ability.end) { this.ability.end(this); this.ability = null; }
      this.setState('hurt');
    }
    if (this.onDamage) this.onDamage(dmg);
    if (this.hp <= 0) this.die();
    return true;
  }
  heal(n = 1, fx = true) {
    if (this.dead) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    if (fx) { CTX.fx.heal(this.center); if (CTX.audio) CTX.audio.sfx('heal'); }
    if (CTX.hud) CTX.hud.setHp(this.hp, this.maxHp);
    return this.hp > before;
  }
  die() {
    if (this.dead) return;
    // phoenix revive
    if (CTX.pet && CTX.pet.tryRevive && !this.reviveUsed) {
      const n = CTX.pet.tryRevive();
      if (n > 0) {
        this.reviveUsed = true;
        this.hp = Math.min(this.maxHp, n);
        this.invuln = 2.5;
        CTX.fx.colorBloom(this.pos, [1, 0.6, 0.3], 4);
        CTX.fx.flash('#ffd0a0', 0.5, 0.6);
        if (CTX.audio) CTX.audio.sfx('heal');
        if (CTX.hud) { CTX.hud.setHp(this.hp, this.maxHp); CTX.hud.toast('피닉스의 힘으로 다시 일어났어요!', 'pet'); }
        return;
      }
    }
    this.dead = true;
    this.setState('dead');
    this.vel.set(0, 6, 0);
    if (this.ability && this.ability.end) { this.ability.end(this); this.ability = null; }
    if (CTX.audio) CTX.audio.sfx('fail');
    if (this.onDeath) this.onDeath();
  }
  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  // ------------------------------------------------------------------ external motion
  bounce(vy, o = {}) {
    this.vel.y = vy;
    this.body.grounded = false;
    this.jumping = false;
    this.flaps = this.maxFlaps(); this.hoverT = 0; this.airJumps = this.maxAirJumps();
    if (this.state === 'hover' || this.state === 'hurt') this.setState('normal');
    if (!o.keepAbility && this.ability && this.ability.endOnBounce) { this.ability.end(this); this.ability = null; }
    this.rig.trigger('jump', 1.5);
  }
  launch(vx, vy, vz, lockT = 0.6) {
    this.vel.set(vx, vy, vz);
    this.body.grounded = false;
    this.launchT = lockT;
    this.flaps = this.maxFlaps(); this.hoverT = 0; this.airJumps = this.maxAirJumps();
    this.setState('normal');
    if (this.ability && this.ability.end) { this.ability.end(this); this.ability = null; }
  }
  maxFlaps() { return CTX.diff.flaps + (this.def.stats.flaps || 0) + (CTX.pet ? CTX.pet.bonus('flaps') : 0); }
  maxAirJumps() { return CTX.pet ? CTX.pet.bonus('airJumps') : 0; }
  maxHoverTime() { return CTX.diff.hoverTime + (CTX.pet ? CTX.pet.bonus('hoverTime') : 0); }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const I = CTX.input;
    const ph = CTX.physics;
    this.stateT += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.special.cd > 0) this.special.cd = Math.max(0, this.special.cd - dt);
    if (this.lowGrav > 0) this.lowGrav -= dt;
    if (this.launchT > 0) this.launchT -= dt;
    this.attackT += dt; this.airAttackT += dt;
    const locked = this.locked || this.dead;

    // carried by moving platforms
    ph.carry(this.body);

    // ---------------------------------------------------------- input to world direction
    let mx = 0, mz = 0, mag = 0;
    if (!locked) {
      const b = CTX.cam.basis();
      const ix = I.move.x, iy = I.move.y;
      mx = b.rx * ix + b.fx * -iy;
      mz = b.rz * ix + b.fz * -iy;
      mag = Math.min(1, Math.hypot(ix, iy));
      if (mag > 0.01) { const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l; }
    }
    this._mv.set(mx, 0, mz);
    this.inputMag = mag;

    const jumpPressed = !locked && I.pressed('jump');
    const jumpDown = !locked && I.down('jump');
    const attackPressed = !locked && I.pressed('attack');
    const attackDown = !locked && I.down('attack');
    const specialPressed = !locked && I.pressed('special');
    const specialDown = !locked && I.down('special');
    const specialReleased = !locked && I.released('special');
    if (jumpPressed) this.jumpBuf = PHYS.buffer; else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // water check
    const w = ph.waterAt(this.pos.x, this.pos.y + 0.45, this.pos.z);
    if (this.dead) { this._updateDead(dt); this._finish(dt); return; }

    // ---------------------------------------------------------- abilities (may take over)
    let handled = false;
    if (!locked) {
      if (specialPressed) Abilities.press(this);
      if (specialDown) Abilities.hold(this, dt);
      if (specialReleased) Abilities.release(this);
    }
    if (this.ability) handled = Abilities.update(this, dt, { mx, mz, mag, jumpPressed, jumpDown, attackPressed, attackDown, w });

    if (!handled) {
      if (this.state === 'hurt') {
        this._gravity(dt, 1);
        this.vel.x = damp(this.vel.x, 0, 3, dt); this.vel.z = damp(this.vel.z, 0, 3, dt);
        if (this.stateT > 0.34 && (this.body.grounded || this.stateT > 0.6)) this.setState('normal');
      } else if (w && this.state !== 'climb' && !(this.ability && this.ability.noSwim)) {
        this._updateSwim(dt, w, mx, mz, mag, jumpPressed, jumpDown, attackDown);
      } else if (this.state === 'climb') {
        this._updateClimb(dt, jumpPressed);
      } else {
        if (this.state === 'swim' || this.state === 'dive') this.setState('normal');
        this._updateNormal(dt, mx, mz, mag, jumpPressed, jumpDown, attackPressed);
      }
    }
    // attacks
    if (!locked && !handled && this.state !== 'hurt' && this.state !== 'dive') Weapons.update(this, dt, attackPressed, attackDown);
    else if (!locked && this.ability && this.ability.allowAttack) Weapons.update(this, dt, attackPressed, attackDown);

    // physics move
    const wasGrounded = this.body.grounded;
    const vyBefore = this.vel.y;
    ph.moveBody(this.body, dt);
    // conveyors / surfaces
    const g = this.body.ground;
    if (this.body.grounded && g) {
      if (g.conv) { this.pos.x += g.conv.x * dt; this.pos.z += g.conv.z * dt; }
      if (g.surface === 'bouncy' && this.body.landed) { this.bounce(g.bounce || 16); if (g.owner && g.owner.onBounce) g.owner.onBounce(); }
      if (g.onStand) g.onStand(this, dt);
      if (g.hazard) this.hurt(1, { x: g.x, y: g.y, z: g.z }, { up: 9, knock: 4, hazard: true });
    }
    if (this.body.hitCeil && this.body.ceilC && this.body.ceilC.onHeadBump) this.body.ceilC.onHeadBump(this);
    if (this.body.hitWall && this.body.wallC && this.body.wallC.hazard) this.hurt(1, { x: this.body.wallC.x, y: this.pos.y, z: this.body.wallC.z }, { hazard: true });
    // landing
    if (this.body.landed) this._onLand(vyBefore);
    if (!wasGrounded && !this.body.grounded && vyBefore > 0 && this.vel.y <= 0) this.fallStartY = this.pos.y;
    // climb start
    if (this.climber && !this.body.grounded && this.body.hitWall && this.body.wallC && this.body.wallC.climbable && this.state !== 'climb' && !this.ability) {
      const into = -(mx * this.body.wallNx + mz * this.body.wallNz);
      if (into > 0.3 || this.state === 'hover') this._startClimb(this.body.wallC, this.body.wallNx, this.body.wallNz);
    }
    // safe ground
    if (this.body.grounded && g && !g.moving && !g.hazard && g.surface !== 'crumble' && !g.noSafe && g.topAt(this.pos.x, this.pos.z, -0.45) !== null) {
      this.safeT += dt;
      if (this.safeT > 0.3) { this.safePos.copy(this.pos); this.safeYaw = this.yaw; this.safeT = 0; }
    }
    // fall out of world
    if (this.pos.y < CTX.level.killY) this._fellOut();
    this._finish(dt);
  }

  _gravity(dt, mul = 1) {
    let g = this.vel.y > 0 ? PHYS.gravity : PHYS.fallGravity;
    if (this.lowGrav > 0) g *= 0.42;
    g *= mul;
    this.vel.y -= g * dt;
    const maxFall = this.lowGrav > 0 ? PHYS.maxFall * 0.5 : PHYS.maxFall;
    if (this.vel.y < -maxFall) this.vel.y = -maxFall;
  }
  runSpeed() {
    return PHYS.runSpeed * this.def.stats.speed * this.speedMul * (CTX.pet ? 1 + CTX.pet.bonus('speed') : 1);
  }

  _updateNormal(dt, mx, mz, mag, jumpPressed, jumpDown) {
    const grounded = this.body.grounded;
    if (grounded) { this.coyote = PHYS.coyote; this.flaps = this.maxFlaps(); this.hoverT = 0; this.airJumps = this.maxAirJumps(); this.jumping = false; }
    else this.coyote -= dt;
    const hovering = this.state === 'hover';
    // horizontal
    let speed = this.runSpeed();
    if (hovering) speed *= PHYS.hoverSpeedMul;
    if (this.attackT < 0.22 && grounded && Weapons.slowsMove(this)) speed *= 0.35;
    const ice = grounded && this.body.ground && this.body.ground.surface === 'ice';
    let acc = grounded ? (mag > 0.05 ? PHYS.accelGround : PHYS.decelGround) : (mag > 0.05 ? PHYS.accelAir : PHYS.decelAir);
    if (ice) acc *= 0.18;
    if (this.launchT > 0) acc *= 0.15;
    const tvx = mx * speed * mag, tvz = mz * speed * mag;
    const dvx = tvx - this.vel.x, dvz = tvz - this.vel.z;
    const dl = Math.hypot(dvx, dvz), step = acc * dt;
    if (dl <= step) { this.vel.x = tvx; this.vel.z = tvz; } else { this.vel.x += (dvx / dl) * step; this.vel.z += (dvz / dl) * step; }
    // facing
    if (mag > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), grounded ? 16 : 10, dt);
    // jumping
    if (this.jumpBuf > 0 && (grounded || this.coyote > 0) && !hovering) {
      this._doJump(PHYS.jumpVel * Math.sqrt(this.def.stats.jump));
    } else if (jumpPressed && !grounded && this.coyote <= 0) {
      if (hovering) this._flap();
      else if (this.airJumps > 0) {
        this.airJumps--;
        const k = CTX.pet ? CTX.pet.airJumpPower() : 0.8;
        this._doJump(PHYS.jumpVel * Math.sqrt(this.def.stats.jump) * k, true);
        if (CTX.pet) CTX.pet.onAirJump && CTX.pet.onAirJump();
      } else if (this.flaps > 0 && this.hoverT < this.maxHoverTime()) {
        this.setState('hover');
        this._flap();
      }
    }
    // variable jump height
    if (this.jumping && !jumpDown && this.vel.y > 2.5 && !hovering && this.jumpTime > 0.085) { this.vel.y *= PHYS.jumpCut; this.jumping = false; }
    if (this.jumping) this.jumpTime += dt;
    if (this.vel.y <= 0) this.jumping = false;
    // vertical
    if (hovering) {
      this.hoverT += dt;
      this.vel.y -= PHYS.hoverGravity * (this.lowGrav > 0 ? 0.5 : 1) * dt;
      const flutter = CTX.pet ? CTX.pet.bonus('flutter') : 0;
      const maxF = (jumpDown ? PHYS.hoverFallHold : PHYS.hoverFallFree) * (1 - flutter * 0.25);
      if (this.vel.y < -maxF) this.vel.y = -maxF;
      const tired = this.hoverT >= this.maxHoverTime();
      if (grounded) { this._exhale(false); }
      else if (tired) {
        // seagull glide extension
        if (CTX.pet && CTX.pet.canGlide && CTX.pet.canGlide(this, jumpDown, dt)) { /* keep floating */ }
        else this._exhale(true);
      }
    } else {
      this._gravity(dt);
    }
    if (this.state !== 'normal' && this.state !== 'hover') this.setState('normal');
  }
  _doJump(v, air = false) {
    this.vel.y = v;
    this.body.grounded = false;
    this.coyote = 0; this.jumpBuf = 0;
    this.jumping = true;
    this.jumpTime = 0;
    this.fallStartY = this.pos.y;
    this.rig.trigger('jump', air ? 1.2 : 1);
    if (CTX.audio) CTX.audio.sfx(air ? 'jump2' : 'jump', { pitch: 0.95 + Math.random() * 0.1 });
    CTX.fx.jumpPuff(this.pos);
  }
  _flap() {
    if (this.flaps <= 0) return;
    this.flaps--;
    this.vel.y = Math.max(this.vel.y, PHYS.flapVel * (this.lowGrav > 0 ? 1.3 : 1));
    this.rig.trigger('flap');
    if (CTX.audio) CTX.audio.sfx('flap', { pitch: 1 + (this.maxFlaps() - this.flaps) * 0.04 });
    const f = this.facing();
    CTX.fx.flapPuff({ x: this.pos.x - f.x * 0.4, y: this.pos.y + 0.4, z: this.pos.z - f.z * 0.4 }, { x: -f.x, y: -0.6, z: -f.z });
    if (CTX.pet && CTX.pet.onFlap) CTX.pet.onFlap(this.maxFlaps() - this.flaps);
  }
  // end hover: Kirby exhales an air puff (damages enemies in front if attacked)
  _exhale(fall = true, attack = false) {
    const f = this.facing();
    const p = { x: this.pos.x + f.x * 0.5, y: this.pos.y + 0.55, z: this.pos.z + f.z * 0.5 };
    CTX.fx.exhale(p, { x: f.x, y: 0, z: f.z });
    if (attack) Weapons.airPuff(this);
    if (CTX.audio) CTX.audio.sfx('whoosh', { vol: 0.5, pitch: 1.3 });
    this.setState('normal');
    this.rig.trigger('land', 0.4);
    if (fall) this.hoverT = this.maxHoverTime();
  }
  tryHoverAttack() {
    // exhaling an air puff ends the float but keeps the remaining hover time (float again with jump)
    if (this.state === 'hover') { this._exhale(false, true); return true; }
    return false;
  }

  _onLand(vy) {
    const k = clamp(-vy / 16, 0.2, 1.3);
    this.rig.trigger('land', k);
    if (vy < -6) { CTX.fx.landing(this.pos, k); }
    if (CTX.audio) CTX.audio.sfx('land', { vol: 0.4 + k * 0.5 });
    if (this.state === 'hover') this._exhale(false);
    this.fallStartY = this.pos.y;
    if (this.ability && this.ability.onLand) this.ability.onLand(this, vy);
  }

  // ------------------------------------------------------------------ swim
  _updateSwim(dt, w, mx, mz, mag, jumpPressed, jumpDown, attackDown) {
    const surfaceY = w.top - 0.62;
    if (this.state !== 'swim' && this.state !== 'dive') {
      const fallV = this.vel.y;
      this.setState('swim');
      CTX.fx.splash({ x: this.pos.x, y: w.top, z: this.pos.z }, clamp(-fallV / 10, 0.5, 1.4));
      if (CTX.audio) CTX.audio.sfx('splash');
      this.vel.y *= 0.3;
      this.flaps = this.maxFlaps(); this.hoverT = 0;
    }
    const diver = this.swimmer;
    const speed = this.runSpeed() * (diver ? 1.15 : 0.72);
    this.vel.x = damp(this.vel.x, mx * speed * mag, 6, dt);
    this.vel.z = damp(this.vel.z, mz * speed * mag, 6, dt);
    if (mag > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 8, dt);
    if (diver && attackDown) {
      this.setState('dive');
      this.vel.y = damp(this.vel.y, -4, 4, dt);
      if (this.pos.y < w.bottom + 0.2) { this.pos.y = w.bottom + 0.2; this.vel.y = Math.max(0, this.vel.y); }
      if (Math.random() < dt * 8) CTX.fx.bubbles({ x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z });
    } else if (this.state === 'dive' && this.pos.y < surfaceY - 0.2) {
      // float up (or swim up faster holding jump)
      this.vel.y = damp(this.vel.y, jumpDown ? 6 : 3, 4, dt);
      if (Math.random() < dt * 6) CTX.fx.bubbles({ x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z });
    } else {
      if (this.state === 'dive') this.setState('swim');
      // buoyancy toward surface
      this.vel.y = damp(this.vel.y, (surfaceY - this.pos.y) * 6, 8, dt);
      if (jumpPressed) {
        this.vel.y = PHYS.jumpVel * (diver ? 1.0 : 0.88);
        this.pos.y = Math.max(this.pos.y, surfaceY);
        this.setState('normal');
        this.jumping = true;
        CTX.fx.splash({ x: this.pos.x, y: w.top, z: this.pos.z }, 0.6);
        if (CTX.audio) CTX.audio.sfx('jump');
      }
    }
    this.swimW = w;
    if (mag > 0.2 && Math.random() < dt * 5 && this.state === 'swim') CTX.fx.splash({ x: this.pos.x, y: w.top, z: this.pos.z }, 0.25);
  }

  // ------------------------------------------------------------------ climb
  _startClimb(c, nx, nz) {
    this.setState('climb');
    this.climbC = c; this.climbN = { x: nx, z: nz };
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-nx, -nz);
    this.flaps = this.maxFlaps(); this.hoverT = 0;
    if (CTX.audio) CTX.audio.sfx('climb');
  }
  _updateClimb(dt, jumpPressed) {
    const I = CTX.input, c = this.climbC;
    const n = this.climbN;
    // lateral axis along wall
    const lx = -n.z, lz = n.x;
    const b = CTX.cam.basis();
    // camera-relative: stick up = climb up; stick sideways = move along wall in screen sense
    const side = I.move.x * (b.rx * lx + b.rz * lz) >= 0 ? Math.abs(I.move.x) : -Math.abs(I.move.x);
    const up = -I.move.y;
    this.vel.set(lx * side * 2.6, up * 3.2, lz * side * 2.6);
    // stick to wall: push slightly into it
    this.vel.x -= n.x * 1.5; this.vel.z -= n.z * 1.5;
    this.climbSpeed = Math.hypot(side, up);
    this.yaw = Math.atan2(-n.x, -n.z);
    const top = c.top;
    if (this.pos.y > top - 0.55 && up > 0.2) {
      // mantle over the top
      this.pos.y = top + 0.05;
      this.pos.x -= n.x * 0.7; this.pos.z -= n.z * 0.7;
      this.vel.set(-n.x * 2, 4, -n.z * 2);
      this.setState('normal');
      return;
    }
    if (jumpPressed) {
      this.vel.set(n.x * 5, PHYS.jumpVel * 0.95, n.z * 5);
      this.yaw = Math.atan2(n.x, n.z);
      this.setState('normal');
      this.jumping = true;
      if (CTX.audio) CTX.audio.sfx('jump');
      return;
    }
    // lost the wall?
    if (this.stateT > 0.1 && !this.body.hitWall) {
      this._climbLost = (this._climbLost || 0) + dt;
      if (this._climbLost > 0.12) { this.setState('normal'); this._climbLost = 0; }
    } else this._climbLost = 0;
    if (this.body.grounded && up < -0.3) this.setState('normal');
  }

  // ------------------------------------------------------------------ death / fall
  _updateDead(dt) {
    this.vel.y -= 18 * dt;
    if (this.stateT < 0.25) this.vel.y = Math.max(this.vel.y, 2);
    this.pos.y += this.vel.y * dt * 0.4;
    this.rig.root.rotation.y += dt * 4;
  }
  _fellOut() {
    if (this.dead || this._falling) return;
    this._falling = true;
    if (this.onFall) this.onFall();
    else this.respawnAfterFall();
  }
  respawnAfterFall() {
    const toSafe = CTX.diff.fallTo === 'safe';
    const dmg = CTX.diff.fallDmg;
    this._falling = false;
    if (this.ability && this.ability.end) { this.ability.end(this, true); this.ability = null; }
    if (toSafe) this.place(this.safePos.clone().addXYZ(0, 0.3, 0), this.safeYaw);
    else this.place(this.checkpoint.pos.clone().addXYZ(0, 0.3, 0), this.checkpoint.yaw);
    this.hp = Math.max(0, this.hp - dmg);
    if (CTX.hud) CTX.hud.setHp(this.hp, this.maxHp, true);
    if (CTX.audio) CTX.audio.sfx('hurt');
    this.invuln = 1.5;
    if (this.hp <= 0) { this.hp = 0; this.die(); }
    CTX.cam.snap(this);
  }
  revive(atCheckpoint = true) {
    this.dead = false;
    this._falling = false;
    this.rig.root.rotation.set(0, 0, 0);
    this.resetHp();
    if (atCheckpoint) this.place(this.checkpoint.pos.clone().addXYZ(0, 0.3, 0), this.checkpoint.yaw);
    this.invuln = 2;
    this.reviveUsed = false;
    CTX.cam.snap(this);
  }

  // ------------------------------------------------------------------ animation & visuals
  _finish(dt) {
    const r = this.rig;
    const st = this.animState;
    const hs = Math.hypot(this.vel.x, this.vel.z) / PHYS.runSpeed;
    let anim = 'idle', sk = st.specialKind, ak = st.attackKind;
    if (this.dead) anim = 'dead';
    else if (this.lockAnim) anim = this.lockAnim;
    else if (this.celebrateT > 0) { anim = 'celebrate'; this.celebrateT -= dt; }
    else if (this.ability && this.ability.anim) {
      const a = this.ability.anim(this);
      if (typeof a === 'string') anim = a; else { anim = a.anim; if (a.specialKind) sk = a.specialKind; if (a.attackKind) ak = a.attackKind; }
    } else if (this.state === 'hurt') anim = 'hurt';
    else if (this.state === 'swim') anim = 'swim';
    else if (this.state === 'dive') anim = 'dive';
    else if (this.state === 'climb') anim = this.climbSpeed > 0.1 ? 'climb' : 'climb';
    else if (this.attackT < Weapons.animDur(this)) { anim = this.body.grounded ? 'attack' : 'airAttack'; ak = this.attackAnim; if (!this.body.grounded && !Weapons.isMelee(this)) anim = 'attack'; }
    else if (this.state === 'hover') anim = 'hover';
    else if (!this.body.grounded) anim = this.vel.y > 0.5 ? 'jump' : 'fall';
    else if (hs > 0.08) anim = hs > 0.7 ? 'run' : 'walk';
    if (anim !== st.anim) { st.anim = anim; st.t = 0; } else st.t += dt;
    if (anim === 'attack' && this.attackT < dt * 1.5) st.t = this.attackT;
    st.speed = this.state === 'climb' ? this.climbSpeed : hs;
    st.vy = this.vel.y;
    st.attackKind = ak; st.specialKind = sk;
    r.update(dt, st);
    // footsteps
    if (this.body.grounded && hs > 0.3 && anim !== 'attack') {
      this.stepT += dt * (4 + hs * 6);
      if (this.stepT > 1) { this.stepT = 0; CTX.fx.dust(this.pos, 1, 0.6); if (CTX.audio) CTX.audio.sfx('step', { vol: 0.25, pitch: 0.9 + Math.random() * 0.2 }); }
    }
    // transform
    this.node.position.copy(this.pos);
    this.node.rotation.y = this.yaw;
    // invulnerability blink
    if (this.invuln > 0 && !this.dead) {
      const on = Math.floor(this.invuln * 14) % 2 === 0;
      r.root.visible = on || this.invuln > CTX.diff.invuln - 0.05 ? true : on;
      this._blink = true;
    } else if (this._blink) { r.root.visible = true; this._blink = false; }
    if (this.ability && this.ability.visual) this.ability.visual(this, dt);
    // special button UI
    const sd = this.def.special;
    const cdFrac = this.special.cdMax > 0 ? this.special.cd / this.special.cdMax : 0;
    CTX.input.setSpecialCooldown(cdFrac, this.special.cd <= 0, sd.label);
  }
}
void lerp; void moveToward; void angleDiff;

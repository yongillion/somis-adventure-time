// ============================================================================
// weapons.js — character attacks (melee combos, shots, lobs, boomerangs,
// breath, beam, wave, spin, smash, tongue) + Kirby air-puff from hover.
// ============================================================================
import { Vec3, clamp } from '../../engine/math.js';
import { Mesh, Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX } from '../ctx.js';
import { PAL } from '../fx.js';

const v = new Vec3();
const MELEE = new Set(['melee', 'spin', 'smash', 'wave']);

// shared visual: swipe arc (crescent) + beam + tongue
let arcMesh = null, beamMesh = null, tongueMesh = null;
function ensureVisuals(root) {
  if (arcMesh) { if (!arcMesh.parent) root.add(arcMesh, beamMesh, tongueMesh); return; }
  const arcGeo = G.torusGeo(1, 0.12, 6, 24, Math.PI * 0.95);
  arcMesh = new Mesh(arcGeo, new Material({ color: 0xffffff, unlit: true, transparent: true, blending: 'additive', depthWrite: false, side: 'double', fog: false }));
  arcMesh.visible = false; arcMesh.frustumCulled = false;
  const beamGeo = G.cylinderGeo(1, 1, 1, 12, 1, false).translate(0, 0.5, 0);
  beamMesh = new Mesh(beamGeo, new Material({ color: 0xffffff, unlit: true, transparent: true, blending: 'additive', depthWrite: false, side: 'double', fog: false }));
  beamMesh.visible = false; beamMesh.frustumCulled = false;
  const tg = G.capsuleGeo(0.5, 1, 8, 3).translate(0, 1, 0);
  tongueMesh = new Mesh(tg, new Material({ color: 0xff7aa0, spec: 0.4, rim: 0.3 }));
  tongueMesh.visible = false; tongueMesh.frustumCulled = false;
  root.add(arcMesh, beamMesh, tongueMesh);
}

function front(p, d, h = 0.55) { const f = p.facing(); return v.set(p.pos.x + f.x * d, p.pos.y + h, p.pos.z + f.z * d); }
function info(p, a, extra = {}) {
  const f = p.facing();
  return { dmg: (a.dmg ?? 1) * (CTX.pet ? CTX.pet.dmgMul() : 1), tags: a.tags || [], dir: { x: f.x, z: f.z }, kind: a.kind, knock: a.knock ?? 5, from: 'player', ...extra };
}
function sfx(n, o) { if (CTX.audio) CTX.audio.sfx(n, o); }

export const Weapons = {
  reset(p) { p.combo = 0; p.comboT = 9; p.atkCd = 0; p.breathT = 0; p.held = null; p.tongue = null; p.arcT = 9; p.beamT = 9; p.boomOut = 0; p.smashT = 0; p._pendingSmash = null; },
  isMelee(p) { return MELEE.has(p.def.attack.kind); },
  slowsMove(p) { const k = p.def.attack.kind; return k === 'melee' || k === 'smash' || k === 'breath' || k === 'beam'; },
  animDur(p) { const k = p.def.attack.kind; return k === 'breath' ? (p.breathT > 0 ? 9 : 0.25) : (k === 'spin' ? 0.36 : 0.28); },

  update(p, dt, pressed, down) {
    ensureVisuals(CTX.level.root);
    const a = p.def.attack;
    p.atkCd -= dt;
    p.comboT += dt;
    this._visuals(p, dt);
    if (p.state === 'hover' && pressed) { p.tryHoverAttack(); return; }
    if (p.state === 'swim' && p.swimmer && down) return; // diving
    // breath continues while held
    if (a.kind === 'breath' && p.breathT > 0) {
      p.breathT -= dt;
      if (!down && p.breathElapsed > (a.dur ?? 0.45)) p.breathT = 0;
      p.breathElapsed += dt;
      p.breathTick -= dt;
      const f = p.facing();
      const mouth = { x: p.pos.x + f.x * 0.55, y: p.pos.y + 0.7, z: p.pos.z + f.z * 0.55 };
      if (a.color === 'fire') CTX.fx.fireBreath(mouth, { x: f.x, y: -0.05, z: f.z });
      if (p.breathTick <= 0) {
        p.breathTick = 0.11;
        for (let d = 0.8; d <= a.range; d += 0.8) CTX.level.hit(p.pos.x + f.x * d, p.pos.y + 0.6, p.pos.z + f.z * d, 0.65, info(p, a, { knock: 2 }), null);
      }
      if (p.breathT <= 0) p.atkCd = 0.35;
      p.attackT = 0;
      return;
    }
    // rapid fire (hamster)
    if (a.rapid && down && p.atkCd <= 0) { this._fire(p, a); p.atkCd = a.rapid; return; }
    if (!pressed || p.atkCd > 0) return;
    this._fire(p, a);
  },

  _fire(p, a) {
    const f = p.facing();
    const grounded = p.body.grounded;
    p.attackT = 0;
    if (CTX.pet && CTX.pet.onAttack) CTX.pet.onAttack();
    switch (a.kind) {
      case 'melee': {
        const isAir = !grounded;
        if (p.comboT > 0.55) p.combo = 0;
        p.combo = (p.combo % (a.combo || 1)) + 1;
        p.comboT = 0;
        const last = p.combo === (a.combo || 1) && (a.combo || 1) > 1;
        p.attackAnim = isAir ? 'spin' : (a.anim === 'swipe' ? (p.combo % 2 === 0 ? 'punch' : 'swipe') : a.anim);
        const reach = a.range * (last ? 1.15 : 1);
        const c = isAir ? new Vec3(p.pos.x, p.pos.y + 0.55, p.pos.z) : front(p, reach * 0.62).clone();
        const r = isAir ? 1.15 : reach * 0.62;
        const n = CTX.level.hit(c.x, c.y, c.z, r, info(p, a, { dmg: (a.dmg ?? 1) * (last ? 1.5 : 1) * (CTX.pet ? CTX.pet.dmgMul() : 1), knock: (a.knock ?? 5) * (last ? 1.6 : 1) }), null);
        if (a.lunge && grounded) { p.vel.x += f.x * a.lunge; p.vel.z += f.z * a.lunge; }
        else if (grounded) { p.vel.x += f.x * 2.2; p.vel.z += f.z * 2.2; }
        if (isAir) { p.vel.y = Math.max(p.vel.y, 1.5); }
        this._arc(p, isAir ? 1.15 : reach * 0.75, last ? PAL.gold : PAL.white, isAir);
        sfx(a.sfx || 'swipe', { pitch: 1 + p.combo * 0.06 });
        if (n > 0) { CTX.fx.hitStop(last ? 0.07 : 0.04); if (last) CTX.fx.shake(0.12, 0.15); }
        p.atkCd = last ? 0.32 : 0.16;
        break;
      }
      case 'shot': {
        const count = a.count || 1, spread = a.spread || 0;
        const baseYaw = p.yaw;
        const aim = this._autoAim(p, 7);
        for (let i = 0; i < count; i++) {
          const yaw = (aim !== null ? aim : baseYaw) + (count > 1 ? (i - (count - 1) / 2) * spread : 0);
          const dx = Math.sin(yaw), dz = Math.cos(yaw);
          CTX.projectiles.spawn({
            kind: a.proj, pos: new Vec3(p.pos.x + dx * 0.5, p.pos.y + 0.62, p.pos.z + dz * 0.5), vel: new Vec3(dx * a.speed, 0, dz * a.speed),
            life: a.life ?? 0.8, dmg: (a.dmg ?? 1), tags: a.tags || [], r: 0.35, pierce: !!a.pierce, bounce: a.bounce || 0, ground: !!a.ground,
            slow: !!a.slow, gravity: a.ground ? 0 : 0, spin: a.proj === 'heart' || a.proj === 'clam' || a.proj === 'shell' ? 9 : 0, knock: 4,
            trail: a.proj === 'heart' ? [1, 0.6, 0.8] : a.proj === 'ring' ? [0.7, 0.95, 1] : null,
          });
        }
        p.attackAnim = a.proj === 'carrot' || a.proj === 'quill' || a.proj === 'seed' ? 'cast' : 'throw';
        if (a.proj === 'heart' || a.proj === 'ring' || a.proj === 'tornado') p.attackAnim = 'cast';
        sfx(a.sfx || 'shoot', { pitch: 0.95 + Math.random() * 0.1 });
        p.atkCd = a.rapid ? a.rapid : 0.28;
        break;
      }
      case 'lob': {
        const aim = this._autoAim(p, 9);
        const yaw = aim !== null ? aim : p.yaw;
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        CTX.projectiles.spawn({
          kind: a.proj, pos: new Vec3(p.pos.x + dx * 0.4, p.pos.y + 0.9, p.pos.z + dz * 0.4), vel: new Vec3(dx * a.speed + p.vel.x * 0.3, a.up ?? 4, dz * a.speed + p.vel.z * 0.3),
          life: a.life ?? 1.5, dmg: a.dmg ?? 1, tags: a.tags || [], r: 0.38, gravity: 16, bounce: a.bounce || 0, boom: a.boom || 0, spin: 8, knock: 5,
        });
        p.attackAnim = 'throw';
        sfx(a.sfx || 'throw');
        p.atkCd = 0.38;
        break;
      }
      case 'boomerang': {
        if ((p.boomOut || 0) >= 1) return;
        const aim = this._autoAim(p, a.range + 1);
        const yaw = aim !== null ? aim : p.yaw;
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        p.boomOut = (p.boomOut || 0) + 1;
        CTX.projectiles.spawn({
          kind: a.proj, pos: new Vec3(p.pos.x + dx * 0.5, p.pos.y + 0.65, p.pos.z + dz * 0.5), vel: new Vec3(dx * a.speed, 0, dz * a.speed),
          life: 4, dmg: a.dmg ?? 1, tags: a.tags || [], r: 0.45, pierce: true, spin: 18, knock: 4,
          boomerang: { owner: p, range: a.range, speed: a.speed, out: true },
          onHit: null,
        });
        p.attackAnim = 'throw';
        sfx(a.sfx || 'boomerang');
        p.atkCd = 0.25;
        break;
      }
      case 'breath': {
        p.breathT = 1.2; p.breathElapsed = 0; p.breathTick = 0;
        p.attackAnim = 'breath';
        sfx(a.sfx || 'fire');
        break;
      }
      case 'beam': {
        const h = p.pos.y + 0.75;
        const range = a.range;
        const ph = CTX.physics;
        const t = ph.raycast(p.pos.x, h, p.pos.z, p.pos.x + f.x * range, h, p.pos.z + f.z * range);
        const len = Math.max(0.6, range * t);
        const set = new Set();
        for (let d = 0.6; d <= len; d += 0.5) CTX.level.hit(p.pos.x + f.x * d, h, p.pos.z + f.z * d, 0.55, info(p, a, { knock: 3 }), set);
        p.beamT = 0; p.beamLen = len;
        p.attackAnim = 'cast';
        sfx(a.sfx || 'beam');
        for (let d = 0.6; d <= len; d += 0.8) CTX.fx.beamSpark({ x: p.pos.x + f.x * d, y: h, z: p.pos.z + f.z * d }, PAL.rainbow[Math.floor(Math.random() * 7)]);
        p.atkCd = 0.4;
        break;
      }
      case 'wave': {
        const c = { x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z };
        CTX.level.hit(c.x, c.y, c.z, a.range, info(p, a, { knock: 7, stun: 0.6 }), null);
        CTX.fx.wave(p.pos, a.range, PAL.gold);
        p.attackAnim = 'cast';
        sfx(a.sfx || 'bell');
        p.atkCd = 0.5;
        break;
      }
      case 'spin': {
        const c = { x: p.pos.x, y: p.pos.y + 0.55, z: p.pos.z };
        CTX.level.hit(c.x, c.y, c.z, a.range, info(p, a, { knock: 6 }), null);
        p.attackAnim = 'spin';
        this._arc(p, a.range, PAL.white, true);
        sfx(a.sfx || 'spin');
        p.atkCd = 0.38;
        if (!grounded) p.vel.y = Math.max(p.vel.y, 2);
        break;
      }
      case 'smash': {
        if (!grounded) {
          // air: spin hit
          CTX.level.hit(p.pos.x, p.pos.y + 0.55, p.pos.z, 1.2, info(p, a), null);
          p.attackAnim = 'spin'; this._arc(p, 1.2, PAL.white, true); sfx('spin'); p.atkCd = 0.3;
          break;
        }
        p.attackAnim = 'smash';
        p.atkCd = 0.55;
        sfx('swipe', { pitch: 0.8 });
        // delayed impact
        p.smashT = 0.16;
        p._pendingSmash = () => {
          const c = front(p, a.range * 0.7, 0.4).clone();
          const n = CTX.level.hit(c.x, c.y, c.z, a.range * 0.65, info(p, a, { knock: 8 }), null);
          CTX.fx.shock({ x: c.x, y: p.pos.y, z: c.z }, a.shock || 2.4);
          CTX.fx.shake(0.18, 0.2);
          sfx(a.sfx || 'hammer');
          if (n) CTX.fx.hitStop(0.06);
          // shockwave stuns small enemies nearby
          CTX.level.hit(c.x, p.pos.y + 0.3, c.z, (a.shock || 2.4), { dmg: 0, tags: [], kind: 'shock', knock: 2, stun: 1.2, from: 'player', dir: { x: f.x, z: f.z } }, null);
        };
        break;
      }
      case 'tongue': {
        if (p.held) {
          // spit captured enemy as a star
          CTX.projectiles.spawn({ kind: 'star', pos: new Vec3(p.pos.x + f.x * 0.6, p.pos.y + 0.6, p.pos.z + f.z * 0.6), vel: new Vec3(f.x * 16, 0, f.z * 16), life: 0.9, dmg: 2.5, r: 0.5, pierce: true, spin: 12, knock: 8, trail: [1, 0.9, 0.4] });
          p.held = null;
          p.attackAnim = 'cast';
          sfx('release');
          p.atkCd = 0.3;
          if (CTX.hud) CTX.hud.setHeld(null);
          break;
        }
        p.tongue = { t: 0, len: 0, max: a.range, out: true, caught: null };
        p.attackAnim = 'bite';
        sfx('whoosh', { pitch: 1.4 });
        p.atkCd = 0.45;
        break;
      }
      default: break;
    }
  },

  // nearest enemy in a forward cone -> yaw to aim (gentle auto-aim for kids)
  _autoAim(p, range) {
    const f = p.facing();
    let best = null, bs = -1;
    for (const e of CTX.level.enemies) {
      if (!e.alive || e.friendly) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = e.pos.y - p.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.3 || Math.abs(dy) > 2.5) continue;
      const dot = (dx * f.x + dz * f.z) / d;
      if (dot < 0.8) continue;
      const s = dot - d * 0.02;
      if (s > bs) { bs = s; best = e; }
    }
    return best ? Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z) : null;
  },

  // Kirby air puff when attacking from hover
  airPuff(p) {
    const f = p.facing();
    CTX.projectiles.spawn({ kind: 'puff', pos: new Vec3(p.pos.x + f.x * 0.6, p.pos.y + 0.55, p.pos.z + f.z * 0.6), vel: new Vec3(f.x * 9, 0, f.z * 9), life: 0.45, dmg: 1, r: 0.45, knock: 5 });
    p.attackT = 0; p.attackAnim = 'cast';
  },

  _arc(p, r, color, full) {
    p.arcT = 0; p.arcR = r; p.arcFull = full; arcMesh.material.color = color.slice();
  },
  _visuals(p, dt) {
    // pending smash impact
    if (p.smashT > 0) { p.smashT -= dt; if (p.smashT <= 0 && p._pendingSmash) { p._pendingSmash(); p._pendingSmash = null; } }
    // swipe arc
    if (p.arcT < 0.18) {
      p.arcT += dt;
      const k = p.arcT / 0.18;
      arcMesh.visible = true;
      arcMesh.position.set(p.pos.x, p.pos.y + 0.55, p.pos.z);
      const s = p.arcR * (0.7 + k * 0.4);
      arcMesh.scale.set(s, s, 1);
      arcMesh.rotation.set(-Math.PI / 2, p.yaw + (p.arcFull ? k * 6 : -Math.PI / 2 + 0.05 + (p.combo % 2 ? 0.25 : -0.25)), 0);
      arcMesh.opacity = 1 - k;
    } else arcMesh.visible = false;
    // beam
    if (p.beamT < 0.25) {
      p.beamT += dt;
      const k = p.beamT / 0.25;
      beamMesh.visible = true;
      const f = p.facing();
      beamMesh.position.set(p.pos.x + f.x * 0.5, p.pos.y + 0.75, p.pos.z + f.z * 0.5);
      beamMesh.rotation.set(Math.PI / 2, p.yaw, 0);
      const w = 0.22 * (1 - k * 0.6);
      beamMesh.scale.set(w, p.beamLen, w);
      const hue = (performance.now() * 0.002) % 1;
      beamMesh.material.color = [0.8 + 0.2 * Math.sin(hue * 6.28), 0.8 + 0.2 * Math.sin(hue * 6.28 + 2), 0.85 + 0.15 * Math.sin(hue * 6.28 + 4)];
      beamMesh.opacity = 1 - k;
    } else beamMesh.visible = false;
    // tongue
    const t = p.tongue;
    if (t) {
      const f = p.facing();
      t.t += dt;
      if (t.out) {
        t.len = Math.min(t.max, t.len + dt * 22);
        const tip = { x: p.pos.x + f.x * (0.5 + t.len), y: p.pos.y + 0.6, z: p.pos.z + f.z * (0.5 + t.len) };
        // catch enemy
        const e = CTX.level.nearestEnemy(tip.x, tip.y, tip.z, 0.8, (en) => !en.boss && en.canSwallow !== false);
        if (e) { t.caught = e; t.out = false; e.swallow && e.swallow(); }
        // pull items
        if (CTX.pickups && CTX.pickups.grabAt(tip, 0.8)) t.out = false;
        const hitWall = CTX.physics.solidAt(tip.x, tip.y, tip.z);
        if (t.len >= t.max || hitWall) t.out = false;
        // also strike hittables (switches etc.)
        CTX.level.hit(tip.x, tip.y, tip.z, 0.4, { dmg: 1, tags: [], kind: 'tongue', knock: 2, from: 'player', dir: { x: f.x, z: f.z } }, t.set || (t.set = new Set()));
      } else {
        t.len = Math.max(0, t.len - dt * 26);
        if (t.len <= 0) {
          if (t.caught) { p.held = t.caught.type || 'enemy'; if (CTX.hud) CTX.hud.setHeld('냠! 공격 버튼으로 퉤!'); sfx('bite'); p.rig.trigger('land', 0.6); }
          p.tongue = null;
        }
      }
      tongueMesh.visible = !!p.tongue;
      if (p.tongue) {
        tongueMesh.position.set(p.pos.x + f.x * 0.45, p.pos.y + 0.62, p.pos.z + f.z * 0.45);
        tongueMesh.rotation.set(Math.PI / 2, p.yaw, 0);
        tongueMesh.scale.set(0.09, Math.max(0.01, t.len / 2), 0.09);
      }
    } else tongueMesh.visible = false;
  },
};
void clamp; void Node;

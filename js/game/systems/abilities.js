// ============================================================================
// abilities.js — the 30 animal special abilities (Special button)
// An active ability is stored on player.ability = { id, t, ... hooks }:
//   update(p, dt, ctl) -> true if it controls movement this frame
//   anim(p) -> rig anim name or {anim, specialKind}
//   end(p, silent), invulnerable(p,o), reflects, noSwim, allowAttack, endOnBounce, visual(p,dt), onLand(p,vy)
// Buffs that don't take over movement live in player.buffs.
// ============================================================================
import { Vec3, clamp, damp, dampAngle, lerp, TAU } from '../../engine/math.js';
import { Mesh, Node } from '../../engine/scene.js';
import { Material } from '../../engine/material.js';
import * as G from '../../engine/geometry.js';
import { CTX, PHYS } from '../ctx.js';
import { PAL } from '../fx.js';
import { Collider } from '../world/physics.js';
import { buildPlatform, buildRainbowSegment, buildCloudPad } from '../models/platforms.js';
import { buildProjModel } from '../models/projmodels.js';
import { buildAnimal } from '../models/animals.js';

const sfx = (n, o) => { if (CTX.audio) CTX.audio.sfx(n, o); };
function startCd(p) { p.special.cd = p.def.special.cd; p.special.cdMax = p.def.special.cd; }
function ready(p) { return p.special.cd <= 0 && !p.dead && p.state !== 'hurt'; }
function inputDir(p, ctl) {
  if (ctl && ctl.mag > 0.2) return { x: ctl.mx, z: ctl.mz };
  return p.facing();
}
function curInput(p) {
  const I = CTX.input, b = CTX.cam.basis();
  const ix = I.move.x, iy = I.move.y;
  let mx = b.rx * ix + b.fx * -iy, mz = b.rz * ix + b.fz * -iy;
  const mag = Math.min(1, Math.hypot(ix, iy));
  const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
  return { mx, mz, mag };
}
function steer(p, dt, speed, acc = 30, turn = 10) {
  const c = curInput(p);
  if (c.mag > 0.1) p.yaw = dampAngle(p.yaw, Math.atan2(c.mx, c.mz), turn, dt);
  const tx = c.mx * speed * c.mag, tz = c.mz * speed * c.mag;
  p.vel.x = damp(p.vel.x, tx, acc * 0.15, dt);
  p.vel.z = damp(p.vel.z, tz, acc * 0.15, dt);
  return c;
}
function gravity(p, dt, mul = 1, maxFall = PHYS.maxFall) {
  p.vel.y -= (p.vel.y > 0 ? PHYS.gravity : PHYS.fallGravity) * mul * (p.lowGrav > 0 ? 0.42 : 1) * dt;
  if (p.vel.y < -maxFall) p.vel.y = -maxFall;
}
function contactHit(p, r, dmg, tags = [], knock = 8, set = null) {
  return CTX.level.hit(p.pos.x, p.pos.y + 0.5, p.pos.z, r, { dmg: dmg * (CTX.pet ? CTX.pet.dmgMul() : 1), tags, kind: 'body', knock, from: 'player', dir: p.facing() }, set);
}
function endAbility(p, silent) { if (p.ability && p.ability.end) p.ability.end(p, silent); p.ability = null; }

// ------------------------------------------------------------------ shared visuals
let ropeMesh = null;
function rope(a, b, color = [0.55, 0.85, 0.4], w = 0.06) {
  if (!ropeMesh) {
    ropeMesh = new Mesh(G.cylinderGeo(1, 1, 1, 8, 1, false).translate(0, 0.5, 0), new Material({ color: 0xffffff, rim: 0.3 }));
    ropeMesh.frustumCulled = false;
  }
  if (!ropeMesh.parent) CTX.level.root.add(ropeMesh);
  ropeMesh.visible = true;
  ropeMesh.material.color = color;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  ropeMesh.position.set(a.x, a.y, a.z);
  ropeMesh.rotation.set(Math.acos(clamp(dy / len, -1, 1)), Math.atan2(dx, dz), 0);
  ropeMesh.scale.set(w, len, w);
}
function hideRope() { if (ropeMesh) ropeMesh.visible = false; }

function findGrapple(p, maxD, preferAbove = true) {
  let best = null, bs = -1e9;
  const f = p.facing();
  for (const g of CTX.level.grapples) {
    if (g.enabled === false) continue;
    const dx = g.pos.x - p.pos.x, dy = g.pos.y - (p.pos.y + 0.8), dz = g.pos.z - p.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxD || d < 1.0) continue;
    const dh = Math.hypot(dx, dz) || 1;
    const dot = (dx * f.x + dz * f.z) / dh;
    const s = -d * 0.25 + dot * 2 + (preferAbove && dy > 0 ? 1.5 : 0);
    if (s > bs) { bs = s; best = g; }
  }
  return best;
}

// ------------------------------------------------------------------ ability table
const A = {};

A.airdash = {
  press(p) {
    if (!ready(p) || (p.airDashUsed && !p.grounded) || p.ability) return;
    startCd(p);
    const c = curInput(p);
    const d = c.mag > 0.2 ? { x: c.mx, z: c.mz } : p.facing();
    p.yaw = Math.atan2(d.x, d.z);
    if (!p.grounded) p.airDashUsed = true;
    if (p.state === 'hover') p.setState('normal');
    const set = new Set();
    sfx('dash');
    p.ability = {
      id: 'airdash', t: 0,
      update(p, dt) {
        this.t += dt;
        const sp = this.t < 0.18 ? 15 : 7;
        p.vel.x = d.x * sp; p.vel.z = d.z * sp;
        p.vel.y = this.t < 0.18 ? 0 : p.vel.y - PHYS.gravity * dt;
        CTX.fx.speedLines(p.center, d);
        contactHit(p, 0.8, 1, [], 7, set);
        if (this.t > 0.24 || (p.body.hitWall && this.t > 0.05)) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'dash' }; },
      invulnerable() { return true; },
      endOnBounce: true,
      end() { },
    };
  },
};

A.moonjump = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    p.lowGrav = 4.5;
    sfx('magic');
    CTX.fx.sparkle(p.center, [0.9, 0.9, 1], 16, 0.8);
    if (p.grounded) { p.vel.y = PHYS.jumpVel * 1.08; p.body.grounded = false; p.jumping = true; p.rig.trigger('jump', 1.4); }
    if (CTX.hud) CTX.hud.toast('달토끼 점프! 몸이 가벼워졌어요', 'ability');
  },
};

A.sniff = {
  press(p) {
    if (!ready(p) || p.ability || !p.grounded) return;
    startCd(p);
    sfx('whoosh', { pitch: 1.6, vol: 0.5 });
    p.ability = {
      id: 'sniff', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = damp(p.vel.x, 0, 10, dt); p.vel.z = damp(p.vel.z, 0, 10, dt);
        gravity(p, dt);
        if (this.t > 0.9) {
          const n = CTX.level.reveal ? CTX.level.reveal(p.pos, 16, 12) : 0;
          if (CTX.hud) CTX.hud.toast(n > 0 ? `킁킁! 근처에 비밀이 ${n}개 있어요!` : '킁킁... 이 근처엔 비밀이 없나 봐요.', 'ability');
          if (n > 0 && CTX.audio) CTX.audio.jingle('secret'); else sfx('menuBack');
          endAbility(p);
        }
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'sniff' }; },
    };
  },
};

A.cloudpad = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    const spawn = () => {
      const y = p.pos.y - 0.02;
      const node = buildCloudPad();
      node.position.set(p.pos.x, y, p.pos.z);
      CTX.level.root.add(node);
      const col = CTX.physics.add(new Collider({ type: 'cyl', x: p.pos.x, y: y - 0.3, z: p.pos.z, hx: 0.95, hy: 0.3, moving: true, tag: 'cloudpad' }));
      CTX.fx.poof({ x: p.pos.x, y: y - 0.1, z: p.pos.z }, [[1, 1, 1], [0.95, 0.95, 1]]);
      sfx('bounce', { pitch: 0.8 });
      const ent = {
        t: 0, node,
        update(dt) {
          this.t += dt;
          node.position.y = y + Math.sin(this.t * 3) * 0.04;
          col.moveTo(col.x, y - 0.3 + Math.sin(this.t * 3) * 0.04, col.z);
          const left = 3.2 - this.t;
          if (left < 0.9) node.visible = Math.floor(this.t * 12) % 2 === 0;
          if (left <= 0) { CTX.physics.remove(col); node.removeFromParent(); this.dead = true; CTX.fx.poof(node.position, [[1, 1, 1]]); }
        },
      };
      CTX.level.add(ent);
      if (p.state === 'hover') p.setState('normal');
      p.vel.y = Math.max(p.vel.y, 0);
    };
    if (p.grounded) {
      p.vel.y = 9; p.body.grounded = false; p.rig.trigger('jump');
      p.pendingCloud = 0.42; p.pendingCloudFn = spawn;
    } else spawn();
  },
};

A.rush = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    const d = p.facing();
    const set = new Set();
    sfx('charge');
    p.ability = {
      id: 'rush', t: 0,
      update(p, dt) {
        this.t += dt;
        const c = curInput(p);
        if (c.mag > 0.2) { p.yaw = dampAngle(p.yaw, Math.atan2(c.mx, c.mz), 3, dt); }
        const f = p.facing();
        p.vel.x = f.x * 11.5; p.vel.z = f.z * 11.5;
        gravity(p, dt);
        if (Math.random() < dt * 30) CTX.fx.dust(p.pos, 1, 0.8);
        const n = CTX.level.hit(p.pos.x + f.x * 0.7, p.pos.y + 0.55, p.pos.z + f.z * 0.7, 0.9, { dmg: 2, tags: ['heavy', 'rush'], kind: 'rush', knock: 11, from: 'player', dir: f }, set);
        if (n) { CTX.fx.shake(0.15, 0.15); CTX.fx.hitStop(0.04); }
        if (p.body.hitWall && this.t > 0.08) {
          CTX.fx.hit(p.center, PAL.white, 1.2); CTX.fx.shake(0.25, 0.2); sfx('hit');
          p.vel.x = -f.x * 4; p.vel.z = -f.z * 4; p.vel.y = 5;
          endAbility(p);
        }
        if (this.t > 0.9) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'dash' }; },
      invulnerable() { return true; },
      endOnBounce: true,
    };
    void d;
  },
};

A.superjump = {
  press(p) {
    if (!ready(p) || p.ability || !p.grounded) return;
    p.ability = {
      id: 'superjump', t: 0, charge: 0,
      update(p, dt) {
        this.t += dt;
        this.charge = Math.min(1, this.t / 0.7);
        p.vel.x = damp(p.vel.x, 0, 12, dt); p.vel.z = damp(p.vel.z, 0, 12, dt);
        gravity(p, dt);
        const c = curInput(p);
        if (c.mag > 0.2) p.yaw = dampAngle(p.yaw, Math.atan2(c.mx, c.mz), 10, dt);
        if (Math.random() < dt * 20) CTX.fx.twinkle(p.pos, this.charge >= 1 ? PAL.gold : PAL.white, 0.6);
        if (!p.grounded) { endAbility(p, true); }
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'charge' }; },
      release(p) {
        const k = lerp(1.18, 1.66, this.charge);
        const f = p.facing();
        p.vel.y = PHYS.jumpVel * k;
        p.vel.x = f.x * 3; p.vel.z = f.z * 3;
        p.body.grounded = false; p.jumping = false;
        p.rig.trigger('jump', 2);
        CTX.fx.landing(p.pos, 1.2);
        CTX.fx.sparkle(p.pos, PAL.gold, 10, 0.5);
        sfx('bounce', { pitch: 0.8 + this.charge * 0.4 });
        startCd(p);
        p.ability = null;
      },
    };
  },
};

A.nap = {
  press(p) {
    if (!ready(p) || p.ability || !p.grounded) return;
    startCd(p);
    sfx('pause');
    p.ability = {
      id: 'nap', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = damp(p.vel.x, 0, 10, dt); p.vel.z = damp(p.vel.z, 0, 10, dt);
        gravity(p, dt);
        if (Math.random() < dt * 2.5) CTX.fx.zzz({ x: p.pos.x + 0.2, y: p.pos.y + 1.2, z: p.pos.z });
        if (this.t > 2.0) {
          p.heal(2);
          if (CTX.hud) CTX.hud.toast('푹 잤더니 기운이 났어요!', 'ability');
          endAbility(p);
        }
        return true;
      },
      anim() { return 'sleep'; },
    };
  },
};

A.smile = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('chime');
    p.ability = {
      id: 'smile', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = damp(p.vel.x, 0, 8, dt); p.vel.z = damp(p.vel.z, 0, 8, dt);
        gravity(p, dt);
        if (this.t > 0.35 && !this.done) {
          this.done = true;
          let n = 0;
          for (const e of CTX.level.enemies) if (e.alive && !e.boss && e.pos.distanceTo(p.pos) < 7.5) { e.charm(8); n++; }
          p.heal(1);
          CTX.fx.petals(p.center, PAL.rainbow, 20);
          CTX.fx.colorBloom(p.pos, [1, 0.75, 0.85], 7.5);
          if (CTX.hud) CTX.hud.toast(n ? `헤헤~ 먹구름이 ${n}마리가 착해졌어요!` : '방긋! 기분이 좋아졌어요', 'ability');
        }
        if (this.t > 0.9) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'smile' }; },
      invulnerable() { return true; },
    };
  },
};

A.pound = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    const air = !p.grounded;
    if (!air) { p.vel.y = 9.5; p.body.grounded = false; p.rig.trigger('jump'); }
    sfx('whoosh', { pitch: 0.7 });
    p.ability = {
      id: 'pound', t: 0, phase: air ? 1 : 0,
      update(p, dt) {
        this.t += dt;
        if (this.phase === 0) { // hop
          gravity(p, dt);
          p.vel.x = damp(p.vel.x, 0, 6, dt); p.vel.z = damp(p.vel.z, 0, 6, dt);
          if (this.t > 0.28) { this.phase = 1; this.t = 0; }
        } else {
          p.vel.x = 0; p.vel.z = 0;
          p.vel.y = this.t < 0.12 ? 1.5 : -24;
        }
        return true;
      },
      onLand(p, vy) {
        if (this.phase !== 1) return;
        const R = 3.2;
        CTX.fx.shock(p.pos, R);
        CTX.fx.shake(0.4, 0.3);
        CTX.fx.hitStop(0.07);
        sfx('quake');
        CTX.level.hit(p.pos.x, p.pos.y + 0.3, p.pos.z, R, { dmg: 2 * (CTX.pet ? CTX.pet.dmgMul() : 1), tags: ['heavy', 'pound'], kind: 'pound', knock: 8, stun: 1.5, from: 'player', dir: p.facing() }, null);
        // break floor under feet
        const g = p.body.ground;
        if (g && g.owner && g.owner.onPound) g.owner.onPound(p);
        p.vel.y = 5;
        p.body.grounded = false;
        endAbility(p);
        void vy;
      },
      anim() { return this.phase === 1 ? 'pound' : 'jump'; },
      invulnerable() { return this.phase === 1; },
    };
  },
};

A.spray = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('water');
    const set = new Set();
    p.ability = {
      id: 'spray', t: 0, tick: 0, allowAttack: false,
      update(p, dt) {
        this.t += dt;
        steer(p, dt, p.runSpeed() * 0.35, 30, 6);
        gravity(p, dt);
        const f = p.facing();
        const tip = p.rig.trunkTip ? p.rig.trunkTip.getWorldPosition(new Vec3()) : new Vec3(p.pos.x + f.x * 0.6, p.pos.y + 0.7, p.pos.z + f.z * 0.6);
        CTX.fx.waterJet(tip, { x: f.x, y: 0.15, z: f.z });
        this.tick -= dt;
        if (this.tick <= 0) {
          this.tick = 0.12;
          set.clear();
          for (let d = 0.8; d <= 5.5; d += 0.7) {
            const y = p.pos.y + 0.8 + (d * 0.15) - (d * d * 0.06);
            CTX.level.hit(p.pos.x + f.x * d, y, p.pos.z + f.z * d, 0.6, { dmg: 0.4, tags: ['water'], kind: 'spray', knock: 7, from: 'player', dir: f }, set);
          }
        }
        if (this.t > 1.6) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'spray' }; },
    };
  },
};

A.finswim = {
  press(p) {
    if (!ready(p) || p.ability) return;
    if (p.ability && p.ability.id === 'finswim') return;
    startCd(p);
    sfx('dive');
    CTX.fx.dust(p.pos, 10, 1.2);
    const set = new Set();
    p.ability = {
      id: 'finswim', t: 0, noSwim: true,
      update(p, dt, ctl) {
        this.t += dt;
        steer(p, dt, p.runSpeed() * 1.55, 40, 9);
        const w = CTX.physics.waterAt(p.pos.x, p.pos.y + 0.3, p.pos.z);
        if (w) { p.vel.y = damp(p.vel.y, (w.top - 0.9 - p.pos.y) * 4, 6, dt); }
        else gravity(p, dt);
        if (Math.random() < dt * 25) { if (w) CTX.fx.bubbles(p.center, 1); else CTX.fx.dust(p.pos, 1, 0.7); }
        contactHit(p, 0.7, 1, [], 6, set);
        if ((ctl && ctl.jumpPressed) || this.t > 3.2) {
          // breach jump with bite
          p.vel.y = PHYS.jumpVel * 1.15;
          p.body.grounded = false;
          CTX.level.hit(p.pos.x, p.pos.y + 0.6, p.pos.z, 1.6, { dmg: 2, tags: [], kind: 'bite', knock: 8, from: 'player', dir: p.facing() }, null);
          CTX.fx.splash(p.pos, 0.8);
          sfx('bite');
          endAbility(p);
        }
        return true;
      },
      anim() { return 'dive'; },
      visual(p) { p.rig.root.position.y = -0.75; },
      end(p) { p.rig.root.position.y = 0; },
      invulnerable() { return true; },
    };
  },
};

A.bubble = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    p.shield = 1;
    sfx('bubble');
    if (!p.bubbleNode) { p.bubbleNode = buildProjModel('bubbleShield'); }
    p.node.add(p.bubbleNode);
    p.bubbleNode.position.set(0, 0.6, 0);
    p.bubbleNode.visible = true;
    p.buffs = p.buffs || {};
    p.buffs.bubble = { t: 7 };
    p.onShieldBreak = () => { if (p.bubbleNode) p.bubbleNode.visible = false; if (p.buffs) delete p.buffs.bubble; CTX.fx.splash(p.center, 0.8); };
  },
};

A.fly = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('glide');
    if (p.state === 'hover') p.setState('normal');
    p.ability = {
      id: 'fly', t: 0, allowAttack: true, noSwim: true, dur: 3.6,
      update(p, dt, ctl) {
        this.t += dt;
        steer(p, dt, p.runSpeed() * 1.2, 40, 8);
        if (ctl.jumpDown) p.vel.y = damp(p.vel.y, 5.5, 6, dt); else p.vel.y = damp(p.vel.y, -1.2, 4, dt);
        if (ctl.jumpPressed) { p.rig.trigger('flap'); sfx('flap', { pitch: 0.8 }); }
        if (Math.random() < dt * 8) CTX.fx.flapPuff({ x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z }, { x: 0, y: -1, z: 0 });
        if (CTX.hud) CTX.hud.setGauge(1 - this.t / this.dur, '비행');
        if (this.t > this.dur || (p.grounded && this.t > 0.3)) endAbility(p);
        return true;
      },
      anim() { return 'fly'; },
      end() { if (CTX.hud) CTX.hud.setGauge(null); },
      endOnBounce: true,
    };
    p.vel.y = Math.max(p.vel.y, 5);
    p.body.grounded = false;
  },
};

A.pounce = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    const tgt = CTX.level.nearestEnemy(p.pos.x, p.pos.y + 0.5, p.pos.z, 9);
    const f = p.facing();
    let tx, ty, tz;
    if (tgt) { tx = tgt.pos.x; ty = tgt.pos.y; tz = tgt.pos.z; p.yaw = Math.atan2(tx - p.pos.x, tz - p.pos.z); }
    else { tx = p.pos.x + f.x * 5; ty = p.pos.y; tz = p.pos.z + f.z * 5; }
    const dur = 0.38;
    const vx = (tx - p.pos.x) / dur, vz = (tz - p.pos.z) / dur;
    const vy = (ty - p.pos.y) / dur + 0.5 * PHYS.gravity * dur;
    sfx('roar', { pitch: 1.4, vol: 0.6 });
    const set = new Set();
    p.ability = {
      id: 'pounce', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = vx; p.vel.z = vz;
        if (this.t < 0.02) p.vel.y = Math.min(vy, 14);
        p.vel.y -= PHYS.gravity * dt;
        const n = CTX.level.hit(p.pos.x, p.pos.y + 0.5, p.pos.z, 1.0, { dmg: 3 * (CTX.pet ? CTX.pet.dmgMul() : 1), tags: [], kind: 'pounce', knock: 9, from: 'player', dir: p.facing() }, set);
        if (n) { CTX.fx.hitStop(0.08); CTX.fx.shake(0.2, 0.2); p.vel.x *= -0.2; p.vel.z *= -0.2; p.vel.y = 6; endAbility(p); return true; }
        if (this.t > dur + 0.1 || (p.grounded && this.t > 0.12)) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'dash' }; },
      invulnerable() { return true; },
      endOnBounce: true,
    };
  },
};

A.vault = {
  press(p) {
    if (!ready(p) || p.ability || !p.grounded) return;
    startCd(p);
    const c = curInput(p);
    const d = c.mag > 0.2 ? { x: c.mx, z: c.mz } : p.facing();
    p.yaw = Math.atan2(d.x, d.z);
    p.vel.set(d.x * 10.5, 11.5, d.z * 10.5);
    p.body.grounded = false;
    p.launchT = 0.5;
    p.rig.trigger('jump', 1.6);
    sfx('bounce', { pitch: 0.7 });
    CTX.fx.landing(p.pos, 0.8);
    p.ability = {
      id: 'vault', t: 0,
      update(p, dt) { this.t += dt; gravity(p, dt); if (this.t > 0.25) endAbility(p); return true; },
      anim() { return { anim: 'special', specialKind: 'pose' }; },
      endOnBounce: true,
    };
  },
};

A.foxfire = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    sfx('fire', { pitch: 1.3 });
    p.buffs = p.buffs || {};
    if (!p.foxNodes) { p.foxNodes = [buildProjModel('foxfire'), buildProjModel('foxfire'), buildProjModel('foxfire')]; }
    for (const n of p.foxNodes) { CTX.level.root.add(n); n.visible = true; }
    p.buffs.foxfire = { t: 8, ang: 0, cool: new Map() };
  },
};

A.slide = {
  press(p) {
    if (p.ability && p.ability.id === 'slide') return;
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('slide');
    const f = p.facing();
    const set = new Set();
    p.body.h = 0.5;
    p.ability = {
      id: 'slide', t: 0, held: true, noSwim: false,
      update(p, dt, ctl) {
        this.t += dt;
        const ice = p.grounded && p.body.ground && p.body.ground.surface === 'ice';
        const sp = ice ? 13 : 9.5;
        const c = curInput(p);
        if (c.mag > 0.2) p.yaw = dampAngle(p.yaw, Math.atan2(c.mx, c.mz), 3.5, dt);
        const ff = p.facing();
        p.vel.x = damp(p.vel.x, ff.x * sp, 6, dt); p.vel.z = damp(p.vel.z, ff.z * sp, 6, dt);
        gravity(p, dt);
        if (Math.random() < dt * 20) CTX.fx.dust(p.pos, 1, 0.6);
        if (this.t > 0.3) set.clear();
        contactHit(p, 0.7, 1, [], 6, set);
        if (ctl.jumpPressed && p.grounded) {
          p.vel.y = PHYS.jumpVel * 0.9; p.body.grounded = false; p.jumping = true; sfx('jump');
          this.stop(p);
          return true;
        }
        if (!this.held && this.t > 0.45) this.stop(p);
        if (p.body.hitWall && this.t > 0.1) { CTX.fx.hit(p.center, PAL.white, 0.7); this.stop(p); }
        return true;
      },
      stop(p) {
        // stand up only if there's headroom
        const blocked = CTX.physics.solidAt(p.pos.x, p.pos.y + 0.9, p.pos.z);
        if (blocked) { this.held = false; this.t = 0.2; return; }
        endAbility(p);
      },
      release() { this.held = false; },
      anim() { return 'slide'; },
      end(p) { p.body.h = PHYS.height; },
    };
    void f;
  },
};

A.dig = {
  press(p) {
    if (!ready(p) || p.ability || !p.grounded) return;
    startCd(p);
    sfx('crumble', { vol: 0.6 });
    p.ability = {
      id: 'dig', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = damp(p.vel.x, 0, 12, dt); p.vel.z = damp(p.vel.z, 0, 12, dt);
        gravity(p, dt);
        if (Math.random() < dt * 25) CTX.fx.dust({ x: p.pos.x + Math.sin(p.yaw) * 0.5, y: p.pos.y, z: p.pos.z + Math.cos(p.yaw) * 0.5 }, 1, 0.8);
        if (this.t > 0.7) {
          const found = CTX.level.dig ? CTX.level.dig(p) : false;
          if (!found && CTX.hud) CTX.hud.toast('여긴 아무것도 없어요. 반짝이는 흙더미를 찾아봐요!', 'ability');
          endAbility(p);
        }
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'dig' }; },
    };
  },
};

A.ball = {
  press(p) {
    if (p.ability && p.ability.id === 'ball') { endAbility(p); startCd(p); return; }
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('roll');
    if (!p.ballNode) { p.ballNode = buildProjModel('bubbleShield'); }
    p.node.add(p.ballNode);
    p.ballNode.visible = true;
    p.body.h = 0.75;
    const set = new Set();
    p.ability = {
      id: 'ball', t: 0, noSwim: false,
      update(p, dt, ctl) {
        this.t += dt;
        const c = curInput(p);
        const sp = 9.5;
        const acc = p.grounded ? 14 : 5;
        if (c.mag > 0.1) {
          p.vel.x += c.mx * acc * dt * c.mag * 1.6; p.vel.z += c.mz * acc * dt * c.mag * 1.6;
          p.yaw = dampAngle(p.yaw, Math.atan2(c.mx, c.mz), 6, dt);
        } else if (p.grounded) { p.vel.x = damp(p.vel.x, 0, 1.2, dt); p.vel.z = damp(p.vel.z, 0, 1.2, dt); }
        const hs = Math.hypot(p.vel.x, p.vel.z);
        if (hs > sp) { p.vel.x *= sp / hs; p.vel.z *= sp / hs; }
        gravity(p, dt);
        if (p.body.hitWall) { p.vel.x += p.body.wallNx * 4; p.vel.z += p.body.wallNz * 4; sfx('bounce', { vol: 0.4 }); }
        if (ctl.jumpPressed && p.grounded) { p.vel.y = PHYS.jumpVel * 1.05; p.body.grounded = false; sfx('bounce'); }
        if (this.t > 0.2) set.clear();
        if (hs > 3) contactHit(p, 0.7, 1, [], 6, set);
        return true;
      },
      anim() { return 'ball'; },
      visual(p) { if (p.ballNode) { p.ballNode.position.set(0, 0.42, 0); p.ballNode.scale.set(0.62, 0.62, 0.62); } p.rig.root.scale.set(0.8, 0.8, 0.8); p.rig.root.position.y = 0.08; },
      end(p) { if (p.ballNode) p.ballNode.visible = false; p.body.h = PHYS.height; p.rig.root.scale.set(1, 1, 1); p.rig.root.position.y = 0; },
      invulnerable(p, o) { return !!(o && o.hazard); },
    };
  },
};

A.glide = {
  press(p) {
    if (p.grounded || p.ability) return;
    this.start(p);
  },
  hold(p) {
    if (!p.grounded && !p.ability && p.vel.y < 1 && p.state !== 'hurt') this.start(p);
  },
  start(p) {
    if (p.state === 'hover') p.setState('normal');
    sfx('glide', { vol: 0.5 });
    p.ability = {
      id: 'glide', t: 0, held: true, noSwim: false,
      update(p, dt) {
        this.t += dt;
        const c = curInput(p);
        const f = p.facing();
        if (c.mag > 0.1) p.yaw = dampAngle(p.yaw, Math.atan2(c.mx, c.mz), 4, dt);
        const sp = p.runSpeed() * 1.4;
        p.vel.x = damp(p.vel.x, f.x * sp * Math.max(0.5, c.mag), 3, dt); p.vel.z = damp(p.vel.z, f.z * sp * Math.max(0.5, c.mag), 3, dt);
        p.vel.y = damp(p.vel.y, -1.1, 6, dt);
        if (Math.random() < dt * 6) CTX.fx.trail({ x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z }, [1, 1, 1], 0.2);
        if (!this.held || p.grounded || this.t > 7) endAbility(p);
        return true;
      },
      release() { this.held = false; },
      anim() { return 'glide'; },
      endOnBounce: true,
    };
  },
};

A.roar = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('roar');
    p.ability = {
      id: 'roar', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = damp(p.vel.x, 0, 8, dt); p.vel.z = damp(p.vel.z, 0, 8, dt);
        gravity(p, dt);
        if (this.t > 0.25 && !this.done) {
          this.done = true;
          CTX.fx.wave(p.pos, 8, PAL.gold);
          CTX.fx.shock(p.pos, 5, [1, 0.95, 0.7]);
          CTX.fx.shake(0.35, 0.4);
          for (const e of CTX.level.enemies) if (e.alive && e.pos.distanceTo(p.pos) < 8.5) e.stun(e.boss ? 0.8 : 3);
          CTX.level.hit(p.pos.x, p.pos.y + 0.5, p.pos.z, 8.5, { dmg: 0, tags: ['wind', 'roar'], kind: 'roar', knock: 3, from: 'player', dir: p.facing() }, null);
          // destroy enemy projectiles nearby
          for (const pr of CTX.projectiles.list) if (pr.team !== 'player' && pr.pos.distanceTo(p.pos) < 8) pr.alive = false;
        }
        if (this.t > 0.9) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'roar' }; },
      invulnerable() { return true; },
    };
  },
};

A.neck = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('whoosh', { pitch: 0.7 });
    const set = new Set();
    p.ability = {
      id: 'neck', t: 0,
      update(p, dt) {
        this.t += dt;
        p.vel.x = damp(p.vel.x, 0, 10, dt); p.vel.z = damp(p.vel.z, 0, 10, dt);
        gravity(p, dt);
        const k = this.t < 0.3 ? this.t / 0.3 : this.t < 0.55 ? 1 : 1 - (this.t - 0.55) / 0.3;
        this.k = Math.max(0, k);
        const f = p.facing();
        const reach = 1.4 + this.k * 4.2;
        const hx = p.pos.x + f.x * 0.4, hz = p.pos.z + f.z * 0.4;
        for (let y = 1.2; y <= reach; y += 0.6) {
          CTX.level.hit(hx, p.pos.y + y, hz, 0.6, { dmg: 1, tags: ['neck'], kind: 'neck', knock: 3, from: 'player', dir: f }, set);
          if (CTX.pickups) CTX.pickups.grabAt({ x: hx, y: p.pos.y + y, z: hz }, 0.8);
        }
        if (this.t > 0.85) endAbility(p);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'stretch' }; },
      visual(p) { if (p.rig.neckExt) p.rig.neckExt.scale.y = 1 + (this.k || 0) * 5.5; },
      end(p) { if (p.rig.neckExt) p.rig.neckExt.scale.y = 1; },
    };
  },
};

A.swing = {
  press(p) {
    if (p.ability && p.ability.id === 'swing') { p.ability.letGo(p); return; }
    if (!ready(p) || p.ability) return;
    const g = findGrapple(p, 8.5);
    if (!g) { if (CTX.hud) CTX.hud.toast('근처에 그네 고리가 없어요', 'ability'); return; }
    startCd(p);
    sfx('whoosh');
    const L = Math.max(2.2, Math.min(5.5, g.pos.distanceTo(new Vec3(p.pos.x, p.pos.y + 0.8, p.pos.z))));
    p.ability = {
      id: 'swing', t: 0, g, L, noSwim: true,
      update(p, dt, ctl) {
        this.t += dt;
        const hand = new Vec3(p.pos.x, p.pos.y + 1.0, p.pos.z);
        // pendulum: gravity + input push, then constrain to rope length
        p.vel.y -= PHYS.gravity * dt;
        const c = curInput(p);
        p.vel.x += c.mx * 9 * dt * c.mag; p.vel.z += c.mz * 9 * dt * c.mag;
        const nx = hand.x + p.vel.x * dt, ny = hand.y + p.vel.y * dt, nz = hand.z + p.vel.z * dt;
        const dx = nx - g.pos.x, dy = ny - g.pos.y, dz = nz - g.pos.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        // remove radial velocity component (taut rope)
        const rx = dx / d, ry = dy / d, rz = dz / d;
        const vr = p.vel.x * rx + p.vel.y * ry + p.vel.z * rz;
        if (d >= this.L && vr > 0) { p.vel.x -= vr * rx; p.vel.y -= vr * ry; p.vel.z -= vr * rz; }
        // reel in slightly
        if (this.L > 2.4) this.L -= dt * 1.2;
        const hs = Math.hypot(p.vel.x, p.vel.z);
        if (hs > 0.5) p.yaw = dampAngle(p.yaw, Math.atan2(p.vel.x, p.vel.z), 6, dt);
        rope(hand, g.pos, [0.55, 0.8, 0.35]);
        if (ctl.jumpPressed || this.t > 6) this.letGo(p);
        return true;
      },
      letGo(p) {
        p.vel.y = Math.max(p.vel.y, 0) + 7.5;
        p.vel.x *= 1.25; p.vel.z *= 1.25;
        p.launchT = 0.4;
        p.rig.trigger('jump', 1.4);
        sfx('jump2');
        p.flaps = p.maxFlaps();
        endAbility(p);
      },
      anim() { return 'climb'; },
      end() { hideRope(); },
      endOnBounce: true,
    };
    p.body.grounded = false;
    if (p.state === 'hover') p.setState('normal');
  },
};

A.hook = {
  press(p) {
    if (!ready(p) || p.ability) return;
    const g = findGrapple(p, 10);
    startCd(p);
    sfx('whoosh', { pitch: 1.5 });
    if (!g) {
      // grab item or enemy ahead
      const f = p.facing();
      for (let d = 1; d <= 6; d += 0.6) {
        const pt = { x: p.pos.x + f.x * d, y: p.pos.y + 0.6, z: p.pos.z + f.z * d };
        if (CTX.pickups && CTX.pickups.grabAt(pt, 0.9)) break;
        const e = CTX.level.nearestEnemy(pt.x, pt.y, pt.z, 0.9);
        if (e) { e.stun(1.5); e.pull && e.pull(p.pos); break; }
      }
      p.attackT = 0; p.attackAnim = 'bite';
      return;
    }
    p.ability = {
      id: 'hook', t: 0, g, noSwim: true,
      update(p, dt) {
        this.t += dt;
        const to = new Vec3(g.pos.x - p.pos.x, g.pos.y - 0.6 - p.pos.y, g.pos.z - p.pos.z);
        const d = to.length();
        const mouth = new Vec3(p.pos.x, p.pos.y + 0.7, p.pos.z);
        rope(mouth, g.pos, [1, 0.5, 0.65], 0.07);
        if (this.t < 0.12) { p.vel.set(0, 0, 0); return true; }
        if (d < 0.9 || this.t > 1.2) {
          p.vel.set(to.x * 2, 8, to.z * 2);
          p.flaps = p.maxFlaps();
          p.launchT = 0.25;
          endAbility(p);
          return true;
        }
        to.scale(17 / d);
        p.vel.copy(to);
        p.yaw = Math.atan2(to.x, to.z);
        return true;
      },
      anim() { return { anim: 'special', specialKind: 'tongue' }; },
      end() { hideRope(); },
      invulnerable() { return true; },
    };
    p.body.grounded = false;
  },
};

A.shellspin = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('spin');
    const set = new Set();
    p.ability = {
      id: 'shellspin', t: 0, reflects: true,
      update(p, dt, ctl) {
        this.t += dt;
        steer(p, dt, p.runSpeed() * 1.45, 30, 8);
        gravity(p, dt);
        if (ctl.jumpPressed && p.grounded) { p.vel.y = PHYS.jumpVel * 0.9; p.body.grounded = false; sfx('jump'); }
        if (this.t % 0.25 < dt) set.clear();
        contactHit(p, 0.85, 1.5, [], 8, set);
        if (Math.random() < dt * 20) CTX.fx.dust(p.pos, 1, 0.7);
        if (this.t > 3) endAbility(p);
        return true;
      },
      anim() { return 'roll'; },
      visual(p) { p.rig.root.rotation.y += 0.6; },
      end(p) { p.rig.root.rotation.y = 0; },
      invulnerable() { return true; },
    };
  },
};

A.rainbow = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    sfx('magic', { pitch: 1.2 });
    const f = p.facing();
    const len = 10;
    const y = (p.grounded ? p.pos.y : p.pos.y - 0.15);
    const cx = p.pos.x + f.x * (len / 2 + 0.3), cz = p.pos.z + f.z * (len / 2 + 0.3);
    const node = buildRainbowSegment(len);
    node.position.set(cx, y, cz);
    node.rotation.y = p.yaw;
    CTX.level.root.add(node);
    const col = CTX.physics.add(new Collider({ type: 'box', x: cx, y: y - 0.15, z: cz, hx: 0.75, hy: 0.15, hz: len / 2, yaw: p.yaw, moving: true, tag: 'rainbow' }));
    for (let i = 0; i < 10; i++) CTX.fx.rainbowTrail({ x: p.pos.x + f.x * i, y: y + 0.2, z: p.pos.z + f.z * i });
    if (p.state === 'hover') p.setState('normal');
    if (!p.grounded) p.vel.y = Math.max(p.vel.y, 0);
    CTX.level.add({
      t: 0, node,
      update(dt) {
        this.t += dt;
        const left = 6.5 - this.t;
        node.scale.set(1, 1, Math.min(1, this.t * 4));
        if (left < 1.2) node.visible = Math.floor(this.t * 10) % 2 === 0;
        if (left <= 0) { CTX.physics.remove(col); node.removeFromParent(); this.dead = true; }
      },
    });
  },
};

A.decoy = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    sfx('transform');
    const rig = buildAnimal('redpanda');
    const doll = rig.root;
    doll.scale.set(0.7, 0.7, 0.7);
    const f = p.facing();
    const pos = new Vec3(p.pos.x + f.x * 0.8, p.pos.y, p.pos.z + f.z * 0.8);
    const g = CTX.physics.groundBelow(pos.x, pos.y + 1, pos.z, 4);
    if (g) pos.y = g.y;
    doll.position.copy(pos);
    doll.rotation.y = p.yaw + Math.PI;
    CTX.level.root.add(doll);
    CTX.fx.poof(pos);
    const decoy = { pos, alive: true };
    CTX.level.decoy = decoy;
    CTX.level.add({
      t: 0,
      update(dt) {
        this.t += dt;
        rig.update(dt, { anim: 'wave', t: this.t, speed: 0 });
        if (this.t > 6) {
          CTX.fx.boom({ x: pos.x, y: pos.y + 0.5, z: pos.z }, 2.6);
          CTX.fx.confetti({ x: pos.x, y: pos.y + 0.5, z: pos.z }, 30);
          CTX.level.hit(pos.x, pos.y + 0.5, pos.z, 2.8, { dmg: 2, tags: [], kind: 'boom', knock: 8, from: 'player', dir: { x: 0, z: 1 } }, null);
          sfx('explode');
          doll.removeFromParent();
          decoy.alive = false;
          if (CTX.level.decoy === decoy) CTX.level.decoy = null;
          this.dead = true;
        }
      },
    });
  },
};

A.waterrun = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('dash', { pitch: 1.3 });
    p.ability = {
      id: 'waterrun', t: 0, noSwim: true,
      update(p, dt, ctl) {
        this.t += dt;
        const c = steer(p, dt, p.runSpeed() * 1.35, 40, 12);
        const w = CTX.physics.waterAt(p.pos.x, p.pos.y + 0.2, p.pos.z) || CTX.physics.waterAt(p.pos.x, p.pos.y - 0.4, p.pos.z);
        if (w && p.pos.y <= w.top + 0.08 && p.vel.y <= 0) {
          p.pos.y = w.top; p.vel.y = 0;
          p.body.grounded = true; p.body.ground = null;
          p.coyote = PHYS.coyote; p.flaps = p.maxFlaps(); p.hoverT = 0;
          if (Math.random() < dt * 30 && c.mag > 0.1) CTX.fx.splash({ x: p.pos.x, y: w.top, z: p.pos.z }, 0.25);
        } else gravity(p, dt);
        if (ctl.jumpPressed && (p.grounded || (w && p.pos.y <= w.top + 0.1))) { p.vel.y = PHYS.jumpVel; p.body.grounded = false; sfx('jump'); }
        if (this.t > 4.5) endAbility(p);
        if (CTX.hud) CTX.hud.setGauge(1 - this.t / 4.5, '물 달리기');
        return true;
      },
      anim(p) { return Math.hypot(p.vel.x, p.vel.z) > 1 ? 'run' : 'idle'; },
      end() { if (CTX.hud) CTX.hud.setGauge(null); },
    };
  },
};

A.spikeguard = {
  press(p) {
    if (!ready(p) || p.ability) return;
    startCd(p);
    sfx('shield');
    const set = new Set();
    p.ability = {
      id: 'spikeguard', t: 0, reflects: true,
      update(p, dt) {
        this.t += dt;
        steer(p, dt, p.runSpeed() * 0.3, 20, 6);
        gravity(p, dt);
        if (this.t % 0.3 < dt) set.clear();
        contactHit(p, 1.0, 2, [], 9, set);
        if (this.t > 2) endAbility(p);
        return true;
      },
      anim() { return 'ball'; },
      visual(p) { if (p.rig.spikes) p.rig.spikes.scale.set(1.25, 1.25, 1.25); },
      end(p) { if (p.rig.spikes) p.rig.spikes.scale.set(1, 1, 1); },
      invulnerable() { return true; },
    };
  },
};

A.slowtime = {
  press(p) {
    if (!ready(p)) return;
    startCd(p);
    sfx('teleport', { pitch: 0.8 });
    p.buffs = p.buffs || {};
    p.buffs.slowtime = { t: 5.5 };
    CTX.worldScale = 0.35;
    document.body.classList.add('slowtime');
    if (CTX.hud) CTX.hud.toast('느긋~ 세상이 천천히 움직여요', 'ability');
  },
};

// ------------------------------------------------------------------ public API
export const Abilities = {
  press(p) {
    const id = p.def.special.id;
    if (p.ability && p.ability.press2) { p.ability.press2(p); return; }
    const a = A[id];
    if (a && a.press) a.press(p);
  },
  hold(p, dt) {
    const a = A[p.def.special.id];
    if (a && a.hold) a.hold(p, dt);
  },
  release(p) {
    if (p.ability && p.ability.release) p.ability.release(p);
  },
  update(p, dt, ctl) {
    const ab = p.ability;
    if (!ab) return false;
    return ab.update ? ab.update(p, dt, ctl) : false;
  },
  // per-frame bookkeeping (buffs, flags) — call every frame
  tick(p, dt) {
    if (p.grounded) p.airDashUsed = false;
    if (p.pendingCloud > 0) { p.pendingCloud -= dt; if (p.pendingCloud <= 0 && p.pendingCloudFn) { p.pendingCloudFn(); p.pendingCloudFn = null; } }
    if (p.lowGrav > 0 && Math.random() < dt * 10) CTX.fx.twinkle(p.center, [0.85, 0.9, 1], 0.6);
    const B = p.buffs;
    if (!B) return;
    if (B.bubble) {
      B.bubble.t -= dt;
      if (p.bubbleNode) { p.bubbleNode.visible = true; const s = 1 + Math.sin(performance.now() * 0.006) * 0.03; p.bubbleNode.scale.set(s, s, s); }
      if (!p.grounded && p.vel.y < -3) p.vel.y = -3;
      if (B.bubble.t <= 0 || p.shield <= 0) { delete B.bubble; p.shield = 0; if (p.bubbleNode) p.bubbleNode.visible = false; }
    }
    if (B.foxfire) {
      const f = B.foxfire;
      f.t -= dt; f.ang += dt * 4.2;
      p.foxNodes.forEach((n, i) => {
        const a = f.ang + (i / 3) * TAU;
        n.position.set(p.pos.x + Math.cos(a) * 1.3, p.pos.y + 0.7 + Math.sin(f.ang * 2 + i) * 0.15, p.pos.z + Math.sin(a) * 1.3);
        const s = 0.9 + Math.sin(performance.now() * 0.02 + i) * 0.1; n.scale.set(s, s, s);
        if (Math.random() < dt * 10) CTX.fx.trail(n.position, [0.5, 0.8, 1], 0.25);
        const key = 'ff' + i;
        const last = f.cool.get(key) || 0;
        if (performance.now() - last > 350) {
          const hits = CTX.level.hit(n.position.x, n.position.y, n.position.z, 0.45, { dmg: 1, tags: ['fire'], kind: 'foxfire', knock: 4, from: 'player', dir: { x: Math.cos(a), z: Math.sin(a) } }, null);
          if (hits) f.cool.set(key, performance.now());
        }
      });
      if (f.t <= 0) { for (const n of p.foxNodes) n.visible = false; delete B.foxfire; }
    }
    if (B.slowtime) {
      B.slowtime.t -= dt;
      if (B.slowtime.t <= 0) { delete B.slowtime; CTX.worldScale = 1; document.body.classList.remove('slowtime'); }
    }
  },
  clearBuffs(p) {
    if (p.buffs) {
      if (p.buffs.foxfire && p.foxNodes) for (const n of p.foxNodes) n.visible = false;
      if (p.buffs.slowtime) { CTX.worldScale = 1; document.body.classList.remove('slowtime'); }
      if (p.bubbleNode) p.bubbleNode.visible = false;
      p.buffs = {};
    }
    p.shield = 0;
    hideRope();
  },
};
void Node; void buildPlatform; void clamp; void lerp;

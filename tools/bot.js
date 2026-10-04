// In-page waypoint bot for automated playtests. Load with ?bot in tests (see tools/botrun.mjs).
// waypoint: { p:[x,y,z], r (arrive radius), act: 'jump'|'hover'|'attack'|'special'|'wait', t (wait seconds), char: id, noAuto: bool }
(function () {
  const B = window.__bot = { wps: [], i: 0, t: 0, held: 0, flapT: 0, atkT: 0, stuckT: 0, best: 1e9, log: [], done: false, waitT: 0, god: false, skips: 0 };
  B.load = (wps, o = {}) => { B.wps = wps; B.i = 0; B.done = false; B.log = []; B.god = !!o.god; B.skips = 0; B.teleportOnStuck = !!o.teleport; };
  function press(I, a, on) { I._cur[a] = on; }
  B.step = (I, dt) => {
    const C = window.__CTX;
    const g = C.game, m = g.mode;
    for (const a of ['jump', 'attack', 'special', 'confirm']) I._cur[a] = I._cur[a] && false;
    I.move.x = 0; I.move.y = 0;
    // dialogs: advance
    if (C.ui.dlg) {
      B.dlgT = (B.dlgT || 0) + dt;
      if (B.dlgT > 0.25) {
        B.dlgT = 0;
        const d = C.ui.dlg;
        if (d.waitChoice && d.choiceScreen) { const b = d.choices.querySelector('button'); if (b) b.click(); }
        else C.ui._dialogAdvance();
      }
      return;
    }
    if (C.ui.top && C.ui.top() && C.ui.top().el && C.ui.top().el.querySelector('.results')) { const b = C.ui.top().el.querySelector('button'); if (b) b.click(); return; }
    if (!m || !m.player || m.state !== 'play') return;
    const p = m.player;
    if (B.god) { p.invuln = 99; p.hp = p.maxHp; }
    const w = B.wps[B.i];
    if (!w) { B.done = true; return; }
    if (w.char && p.charId !== w.char) { m.changeChar(w.char); }
    if (w.until) {
      let ok = false;
      try { ok = !!(new Function('C', 'p', 'return (' + w.until + ');'))(C, p); } catch (e) { B.log.push('until error ' + e.message); ok = true; }
      if (!w._untilReached) {
        // move to the waiting spot first, then wait for the condition
        const dx0 = w.p[0] - p.pos.x, dz0 = w.p[2] - p.pos.z;
        if (Math.hypot(dx0, dz0) < 0.7) w._untilReached = true;
      }
      if (w._untilReached) {
        B.waitT += dt;
        if (ok || B.waitT > (w.t ?? 20)) { B.waitT = 0; B.next(ok ? 'until' : 'until-timeout'); }
        return;
      }
    }
    if (w.follow === 'boss') {
      const bs = m.boss;
      if (!bs || bs.state === 'done' || bs.state === 'defeat' || B.t > (w.t ?? 400) + (w._t0 ?? (w._t0 = B.t))) { B.next('boss-' + (bs ? bs.state : 'none')); return; }
      w.p = [bs.pos.x, bs.pos.y, bs.pos.z];
      w.r = 0; w.noAuto = true;
      // keep some distance while attacking
      const ddx = bs.pos.x - p.pos.x, ddz = bs.pos.z - p.pos.z, dd = Math.hypot(ddx, ddz);
      B.atkT += dt;
      if (dd < bs.radius + 2.2) { if (B.atkT > 0.25) { B.atkT = 0; press(I, 'attack', true); } return; }
    }
    const tx = w.p[0], ty = w.p[1], tz = w.p[2];
    const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz);
    const dy = ty - p.pos.y;
    const r = w.r ?? 0.9;
    B.t += dt;
    if (w.act === 'wait') {
      B.waitT += dt;
      if (B.waitT > (w.t ?? 1)) { B.waitT = 0; B.next('wait'); }
      return;
    }
    if (d < r && Math.abs(dy) < (w.ry ?? 1.6) && (p.body.grounded || w.air)) {
      if (w.act === 'attack') { B.atkT += dt; if (B.atkT > 0.3) { B.atkT = 0; press(I, 'attack', true); } B.waitT += dt; if (B.waitT < (w.t ?? 1.5)) return; B.waitT = 0; }
      if (w.act === 'special') { press(I, 'special', true); }
      B.next('arrive');
      return;
    }
    // steer (camera relative)
    const b = C.cam.basis();
    const nx = dx / (d || 1), nz = dz / (d || 1);
    const ix = nx * b.rx + nz * b.rz;
    const iy = -(nx * b.fx + nz * b.fz);
    const sl = Math.hypot(ix, iy) || 1;
    let k = d < 1.5 ? Math.max(0.35, d / 1.5) : 1;
    I.move.x = ix / sl * k; I.move.y = iy / sl * k;
    // attack nearby enemies
    B.atkT += dt;
    const e = C.level.nearestEnemy(p.pos.x, p.pos.y + 0.5, p.pos.z, 2.6);
    if (e && B.atkT > 0.28) { B.atkT = 0; press(I, 'attack', true); }
    // jumping / hovering
    const ph = C.physics;
    const ahead = ph.groundBelow(p.pos.x + nx * 1.4, p.pos.y + 1.4, p.pos.z + nz * 1.4, 4.0);
    const gapAhead = !ahead || ahead.c.hazard || ahead.y < p.pos.y - 2.6;
    const wantUp = dy > 0.55;
    if (B.rel > 0) B.rel -= dt;
    if (p.body.grounded) {
      B.flapN = 0;
      if (B.held > 0) { B.held -= dt; press(I, 'jump', true); if (B.held <= 0) B.rel = 0.08; }
      else if (B.rel > 0) { /* release a moment so the next press is a fresh edge */ }
      else if ((w.act === 'jump' && d < (w.jd ?? 2.5)) || (!w.noAuto && ((gapAhead && d > 0.8) || (wantUp && d < 4.5)))) { B.held = 0.32; press(I, 'jump', true); B.hold = true; }
    } else {
      if (B.held > 0) { B.held -= dt; press(I, 'jump', true); }
      else {
        const below = ph.groundBelow(p.pos.x + nx * 0.6, p.pos.y + 1.0, p.pos.z + nz * 0.6, 7);
        const needHover = (dy > -0.2) || !below || (below && below.y < ty - 1.0 && d > 1.2);
        B.flapT -= dt;
        if (needHover && p.vel.y < 1.2 && B.flapT <= 0) { press(I, 'jump', true); B.flapT = 0.24; }
        else if (needHover) press(I, 'jump', I._prev.jump && B.flapT > 0.12);
      }
    }
    // stuck detection
    if (d < B.best - 0.3) { B.best = d; B.stuckT = 0; } else B.stuckT += dt;
    if (B.stuckT > (w.stuck ?? 7)) {
      B.log.push(`STUCK wp${B.i} at ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} -> ${tx},${ty},${tz}`);
      B.skips++;
      if (B.teleportOnStuck) { p.pos.set(tx, ty + 0.5, tz); p.vel.set(0, 0, 0); }
      B.next('stuck');
    }
  };
  B.next = (why) => { const C = window.__CTX; const p = C.player; B.log.push(`wp${B.i} ${why} t=${B.t.toFixed(1)} pos=${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} hp=${p.hp}`); B.i++; B.best = 1e9; B.stuckT = 0; B.held = 0; };
  const hook = () => { const I = window.__CTX && window.__CTX.input; if (!I) { setTimeout(hook, 50); return; } I.bot = (I2, dt) => B.step(I2, dt); };
  hook();
})();

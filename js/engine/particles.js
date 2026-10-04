// ============================================================================
// particles.js — instanced billboard batches + pooled particle system
// ============================================================================
import { Custom } from './scene.js';
import { Vec3, rand, TAU, lerp } from './math.js';

const QUAD = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const QUAD_IDX = new Uint16Array([0, 1, 2, 0, 2, 3]);

export class BillboardBatch extends Custom {
  constructor({ max = 1000, atlas, atlasN = 4, blending = 'normal', flat = false, depthWrite = false, depthTest = true, renderOrder = 60, fog = false, name = 'batch' } = {}) {
    super(name);
    this.max = max;
    this.atlas = atlas;
    this.atlasN = atlasN;
    this.blending = blending;
    this.flat = flat;
    this.depthWrite = depthWrite;
    this.depthTest = depthTest;
    this.renderOrder = renderOrder;
    this.fog = fog;
    this.posSize = new Float32Array(max * 4);
    this.col = new Float32Array(max * 4);
    this.extra = new Float32Array(max * 4);
    this.count = 0;
    this._gpu = null;
  }
  begin() { this.count = 0; }
  push(x, y, z, size, r, g, b, a, rot = 0, tile = 0, stretch = 0) {
    if (this.count >= this.max) return;
    const i = this.count++ * 4;
    this.posSize[i] = x; this.posSize[i + 1] = y; this.posSize[i + 2] = z; this.posSize[i + 3] = size;
    this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b; this.col[i + 3] = a;
    this.extra[i] = rot; this.extra[i + 1] = tile; this.extra[i + 2] = stretch; this.extra[i + 3] = 0;
  }
  _ensure(renderer) {
    const gl = renderer.gl;
    if (this._gpu && this._gpu.gen === renderer.gen) return this._gpu;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, QUAD_IDX, gl.STATIC_DRAW);
    const mk = (loc, arr) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(loc, 1);
      return b;
    };
    const b1 = mk(4, this.posSize), b2 = mk(5, this.col), b3 = mk(6, this.extra);
    renderer._st.vao = vao;
    this._gpu = { vao, b1, b2, b3, gen: renderer.gen };
    return this._gpu;
  }
  render(renderer) {
    if (this.count === 0) return;
    const gl = renderer.gl;
    const g = this._ensure(renderer);
    const defs = [];
    if (this.flat) defs.push('FLAT');
    if (this.fog) defs.push('USE_FOG');
    const p = renderer.buildProgram('particle', defs);
    renderer.useProgram(p);
    renderer.setBlend(this.blending);
    renderer.setDepth(this.depthTest, this.depthWrite);
    renderer.setCull('double');
    renderer.setPolyOffset(this.flat ? -2 : 0);
    renderer.setUniform(p, 'uMap', this.atlas);
    renderer.setUniform(p, 'uAtlasN', this.atlasN);
    renderer.bindVAO(g.vao);
    const n = this.count * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, g.b1); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posSize, 0, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.b2); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.col, 0, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.b3); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.extra, 0, n);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.count);
    renderer.stats.calls++;
    renderer.setPolyOffset(0);
  }
}

// --------------------------------------------------------------------------
// Pooled particles. Each particle: position, velocity, life, size/color curves.
class P {
  constructor() { this.alive = false; }
}

export class ParticleSystem {
  constructor(scene, atlas, max = 1800) {
    this.max = max;
    this.free = [];
    for (let i = 0; i < max; i++) this.free.push(new P());
    this.alive = [];
    this.alpha = new BillboardBatch({ max, atlas, blending: 'normal', renderOrder: 70, name: 'particles-alpha' });
    this.add = new BillboardBatch({ max, atlas, blending: 'additive', renderOrder: 80, name: 'particles-add' });
    scene.add(this.alpha, this.add);
    this._camPos = new Vec3();
    this._camFwd = new Vec3();
    this.timeScale = 1;
  }
  clear() { for (const p of this.alive) { p.alive = false; this.free.push(p); } this.alive.length = 0; }
  spawn() {
    let p = this.free.pop();
    if (!p) p = this.alive.shift(); // recycle oldest
    if (!p) return null;
    p.alive = true;
    this.alive.push(p);
    return p;
  }
  // core emitter
  emit(o) {
    const count = o.count ?? 1;
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      const pos = o.pos;
      const spreadR = o.radius ?? 0;
      let ox = 0, oy = 0, oz = 0;
      if (spreadR > 0) {
        const a = Math.random() * TAU, u = Math.random() * 2 - 1, r = spreadR * Math.cbrt(Math.random());
        const s = Math.sqrt(1 - u * u);
        ox = Math.cos(a) * s * r; oy = u * r * (o.flatY ? 0.2 : 1); oz = Math.sin(a) * s * r;
      }
      p.x = pos.x + ox; p.y = pos.y + oy; p.z = pos.z + oz;
      // velocity
      const sp = Array.isArray(o.speed) ? rand(o.speed[0], o.speed[1]) : (o.speed ?? 2);
      let vx, vy, vz;
      if (o.dir) {
        const spread = o.spread ?? 0.3;
        vx = o.dir.x + (Math.random() * 2 - 1) * spread;
        vy = o.dir.y + (Math.random() * 2 - 1) * spread;
        vz = o.dir.z + (Math.random() * 2 - 1) * spread;
        const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
      } else if (o.ring) {
        const a = (i / count) * TAU + Math.random() * 0.2;
        vx = Math.cos(a); vy = o.ringUp ?? 0; vz = Math.sin(a);
        const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
      } else {
        const a = Math.random() * TAU, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
        vx = Math.cos(a) * s; vy = u; vz = Math.sin(a) * s;
        if (o.upBias) { vy = Math.abs(vy) * o.upBias + vy * (1 - o.upBias); }
      }
      p.vx = vx * sp + (o.vel ? o.vel.x : 0);
      p.vy = vy * sp + (o.vel ? o.vel.y : 0);
      p.vz = vz * sp + (o.vel ? o.vel.z : 0);
      p.life = 0;
      p.maxLife = Array.isArray(o.life) ? rand(o.life[0], o.life[1]) : (o.life ?? 0.8);
      const s0 = Array.isArray(o.size) ? rand(o.size[0], o.size[1]) : (o.size ?? 0.3);
      p.size0 = s0;
      p.size1 = o.sizeEnd !== undefined ? s0 * o.sizeEnd : s0 * 0.2;
      p.sizeCurve = o.sizeCurve || 'linear'; // linear | pop | grow
      const c0 = o.color || [1, 1, 1];
      const colors = o.colors;
      const cc = colors ? colors[Math.floor(Math.random() * colors.length)] : c0;
      const c1 = o.colorEnd || cc;
      p.r0 = cc[0]; p.g0 = cc[1]; p.b0 = cc[2];
      p.r1 = c1[0]; p.g1 = c1[1]; p.b1 = c1[2];
      p.a0 = o.alpha ?? 1; p.a1 = o.alphaEnd ?? 0;
      p.fadeIn = o.fadeIn ?? 0;
      p.rot = o.rot !== undefined ? o.rot : Math.random() * TAU;
      p.rotVel = Array.isArray(o.spin) ? rand(o.spin[0], o.spin[1]) : (o.spin ?? 0) * (Math.random() < 0.5 ? -1 : 1);
      p.tile = Array.isArray(o.tile) ? o.tile[Math.floor(Math.random() * o.tile.length)] : (o.tile ?? 0);
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.additive = !!o.additive;
      p.stretch = o.stretch ?? 0;
      p.wobble = o.wobble ?? 0;
      p.wobPhase = Math.random() * TAU;
      p.follow = o.follow || null; // object with position to follow (Vec3)
      if (p.follow) { p.fx = p.x - p.follow.x; p.fy = p.y - p.follow.y; p.fz = p.z - p.follow.z; }
    }
  }
  update(dt, camera) {
    dt *= this.timeScale;
    const A = this.alive;
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i];
      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; A[i] = A[A.length - 1]; A.pop(); this.free.push(p); continue; }
      p.vy -= p.gravity * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      if (p.follow) {
        p.fx += p.vx * dt; p.fy += p.vy * dt; p.fz += p.vz * dt;
        p.x = p.follow.x + p.fx; p.y = p.follow.y + p.fy; p.z = p.follow.z + p.fz;
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      if (p.wobble) { p.x += Math.sin(p.life * 5 + p.wobPhase) * p.wobble * dt; p.z += Math.cos(p.life * 4 + p.wobPhase) * p.wobble * dt; }
      p.rot += p.rotVel * dt;
    }
    // fill batches
    const cam = camera;
    this._camPos.copy(cam.position);
    this._camFwd.subVectors(cam.target, cam.position).normalize();
    const alphaList = [];
    this.add.begin();
    for (const p of A) {
      if (p.additive) this._pushP(this.add, p);
      else { p._d = (p.x - this._camPos.x) * this._camFwd.x + (p.y - this._camPos.y) * this._camFwd.y + (p.z - this._camPos.z) * this._camFwd.z; alphaList.push(p); }
    }
    alphaList.sort((a, b) => b._d - a._d);
    this.alpha.begin();
    for (const p of alphaList) this._pushP(this.alpha, p);
  }
  _pushP(batch, p) {
    const t = p.life / p.maxLife;
    let s;
    if (p.sizeCurve === 'pop') s = t < 0.15 ? lerp(p.size0 * 0.3, p.size0, t / 0.15) : lerp(p.size0, p.size1, (t - 0.15) / 0.85);
    else if (p.sizeCurve === 'grow') s = lerp(p.size0, p.size1, Math.sqrt(t));
    else s = lerp(p.size0, p.size1, t);
    let a = lerp(p.a0, p.a1, t);
    if (p.fadeIn > 0 && t < p.fadeIn) a *= t / p.fadeIn;
    let st = 0;
    if (p.stretch) { const sp = Math.hypot(p.vx, p.vy, p.vz); st = Math.min(sp * p.stretch, 3); }
    batch.push(p.x, p.y, p.z, s, lerp(p.r0, p.r1, t), lerp(p.g0, p.g1, t), lerp(p.b0, p.b1, t), a, p.rot, p.tile, st);
  }
}

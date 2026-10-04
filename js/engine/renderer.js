// ============================================================================
// renderer.js — compact WebGL2 renderer (toon pipeline, instancing, customs)
// ============================================================================
import { bakeValid, unbake } from './bake.js';
import { Mat4, Vec3 } from './math.js';
import { SHADERS } from './shaders.js';

export let GLCTX = null;

let texId = 0;
export class Texture {
  constructor(source, opts = {}) {
    this.id = ++texId;
    this.source = source; // canvas / image / {width,height,data}
    this.wrap = opts.wrap || 'repeat'; // repeat | clamp
    this.filter = opts.filter || 'linear'; // linear | nearest
    this.mipmaps = opts.mipmaps ?? true;
    this.flipY = opts.flipY ?? false;
    this.version = 1;
    this._gpu = null;
  }
  update() { this.version++; }
}

const FLAG = {
  VCOLOR: 1, UV: 2, MAP: 4, INST: 8, WIND: 16, SAT: 32, FOG: 64, DOUBLE: 128, UNLIT: 256, SPEC: 512, ATEST: 1024,
};
const FLAG_DEFS = [
  [1, 'USE_VCOLOR'], [2, 'USE_UV'], [4, 'USE_MAP'], [8, 'USE_INSTANCING'], [16, 'USE_WIND'], [32, 'USE_SATFIELD'],
  [64, 'USE_FOG'], [128, 'DOUBLE_SIDED'], [256, 'UNLIT'], [512, 'USE_SPEC'], [1024, 'ALPHA_TEST'],
];
const ATTR_LOC = { position: 0, normal: 1, color: 2, uv: 3 };

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: opts.antialias ?? true, alpha: false, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WEBGL2_UNSUPPORTED');
    this.gl = gl;
    GLCTX = gl;
    this.gen = 1;
    this.programs = new Map();
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.resScale = 1;
    this.minPx = 0.75; // small-feature culling: meshes projecting below this radius (CSS px) are skipped
    this.width = 1; this.height = 1;
    this.stats = { calls: 0, tris: 0, programs: 0 };
    this._opaque = []; this._transparent = []; this._customs = [];
    this._normalMat = new Float32Array(9);
    this._sphere = new Vec3();
    this._frustum = new Float32Array(24);
    this.globals = {
      uView: Mat4.create(), uProj: Mat4.create(), uInvViewProj: Mat4.create(), uCamPos: new Float32Array(3), uTime: 0,
      uSunDir: new Float32Array([0.4, 0.8, 0.3]), uSunColor: new Float32Array([1, 0.97, 0.9]),
      uSkyColor: new Float32Array([0.75, 0.85, 1]), uGroundColor: new Float32Array([0.55, 0.5, 0.48]),
      uShadeTint: new Float32Array([0.78, 0.74, 0.92]), uRimColor: new Float32Array([1, 1, 1]),
      uFogColor: new Float32Array([0.8, 0.88, 1]), uFog: new Float32Array([40, 160, -6, -30]),
      uBaseSat: 1, uSatSpots: new Float32Array(32), uSkySat: 1,
    };
    this.globalsVersion = 1;
    this.clearColor = [0.6, 0.8, 1.0];
    this._initState();
    this._fsTri = null;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.gen++; this.programs.clear(); this._initState(); this._fbo = null; }, false);
  }

  _initState() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);
    this._st = { prog: null, vao: null, blend: 'none', depthWrite: true, depthTest: true, cull: 'back', polyOff: 0 };
    this._white = null;
  }

  setSize(cssW, cssH) {
    const pr = this.pixelRatio * this.resScale;
    const w = Math.max(1, Math.floor(cssW * pr)), h = Math.max(1, Math.floor(cssH * pr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.width = w; this.height = h;
    this.cssW = cssW; this.cssH = cssH;
  }

  // ------------------------------------------------------------------ programs
  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      console.error('Shader compile error:', log, '\n', lines);
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }
  buildProgram(shaderName, defines) {
    const key = shaderName + '|' + defines.join(',');
    let p = this.programs.get(key);
    if (p) return p;
    const gl = this.gl;
    const src = SHADERS[shaderName];
    if (!src) throw new Error('Unknown shader ' + shaderName);
    const head = '#version 300 es\n' + defines.map((d) => '#define ' + d + '\n').join('') + 'precision highp float;\nprecision highp int;\n';
    const vs = this._compile(gl.VERTEX_SHADER, head + src.vertex);
    const fs = this._compile(gl.FRAGMENT_SHADER, head + src.fragment);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      console.error('Program link error', shaderName, defines, log);
      throw new Error('Program link error: ' + log);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    const uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(prog, info.name);
      const u = { loc, type: info.type, size: info.size, unit: -1 };
      if (info.type === gl.SAMPLER_2D) u.unit = unit++;
      uniforms[name] = u;
    }
    const globalNames = Object.keys(this.globals).filter((k) => uniforms[k]);
    p = { key, prog, uniforms, globalNames, globalsStamp: -1, frameStamp: -1, id: this.programs.size + 1, gen: this.gen };
    this.programs.set(key, p);
    this.stats.programs = this.programs.size;
    return p;
  }
  programFor(mat, mask) {
    let entry = mat._progs.get(mask);
    if (entry && entry.gen === this.gen) return entry;
    const defs = [];
    for (const [bit, name] of FLAG_DEFS) if (mask & bit) defs.push(name);
    for (const d of mat.defines) defs.push(d);
    const p = this.buildProgram(mat.shader, defs);
    mat._progs.set(mask, p);
    return p;
  }
  useProgram(p) {
    const gl = this.gl;
    if (this._st.prog !== p) { gl.useProgram(p.prog); this._st.prog = p; }
    if (p.globalsStamp !== this.globalsVersion) {
      for (const name of p.globalNames) this.setUniform(p, name, this.globals[name]);
      p.globalsStamp = this.globalsVersion;
    }
  }
  setUniform(p, name, v) {
    const u = p.uniforms[name];
    if (!u) return;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT:
        if (u.size > 1) gl.uniform1fv(u.loc, v);
        else if (u.last !== v) { u.last = v; gl.uniform1f(u.loc, v); }
        break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: {
        // skip redundant uploads (material colours repeat a lot between draws)
        const c = u.lastV || (u.lastV = [NaN, NaN, NaN]);
        if (c[0] !== v[0] || c[1] !== v[1] || c[2] !== v[2]) { c[0] = v[0]; c[1] = v[1]; c[2] = v[2]; gl.uniform3fv(u.loc, v); }
        break;
      }
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
      case gl.SAMPLER_2D: {
        gl.activeTexture(gl.TEXTURE0 + u.unit);
        gl.bindTexture(gl.TEXTURE_2D, v ? this.texture(v) : this.whiteTexture());
        gl.uniform1i(u.loc, u.unit);
        break;
      }
      default: break;
    }
  }
  touchGlobals() { this.globalsVersion++; }

  // ------------------------------------------------------------------ textures
  whiteTexture() {
    if (this._white && this._white.gen === this.gen) return this._white.tex;
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this._white = { tex: t, gen: this.gen };
    return t;
  }
  texture(tex) {
    const gl = this.gl;
    let g = tex._gpu;
    if (!g || g.gen !== this.gen) { g = tex._gpu = { tex: gl.createTexture(), gen: this.gen, version: 0 }; }
    if (g.version !== tex.version) {
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, tex.flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const s = tex.source;
      if (s.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, s.width, s.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s);
      const wrap = tex.wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (tex.filter === 'nearest') {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (tex.mipmaps) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
        else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      g.version = tex.version;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    return g.tex;
  }

  // ------------------------------------------------------------------ geometry
  _uploadAttr(gl, a, loc) {
    if (!a.buf || a.bufGen !== this.gen) { a.buf = gl.createBuffer(); a.bufGen = this.gen; a.upVersion = -1; }
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
    if (a.upVersion !== a.version) {
      gl.bufferData(gl.ARRAY_BUFFER, a.array, a.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      a.upVersion = a.version;
    }
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, a.itemSize, gl.FLOAT, false, 0, 0);
  }
  geometryVAO(geo) {
    const gl = this.gl;
    let g = geo._gpu;
    if (!g || g.gen !== this.gen || g.version !== geo.version) {
      if (!g || g.gen !== this.gen) {
        g = geo._gpu = { vao: gl.createVertexArray(), gen: this.gen, version: -1, ibuf: null };
        for (const k in geo.attributes) { const a = geo.attributes[k]; a.buf = null; }
      }
      gl.bindVertexArray(g.vao);
      this._st.vao = g.vao;
      for (const k in geo.attributes) {
        const loc = ATTR_LOC[k];
        if (loc === undefined) continue;
        this._uploadAttr(gl, geo.attributes[k], loc);
      }
      if (geo.index) {
        if (!g.ibuf) g.ibuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.index, gl.STATIC_DRAW);
      }
      g.version = geo.version;
    } else {
      if (this._st.vao !== g.vao) { gl.bindVertexArray(g.vao); this._st.vao = g.vao; }
      // refresh dynamic/dirty attributes
      for (const k in geo.attributes) {
        const a = geo.attributes[k];
        if (a.upVersion !== a.version && ATTR_LOC[k] !== undefined) {
          gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
          gl.bufferData(gl.ARRAY_BUFFER, a.array, a.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
          a.upVersion = a.version;
        }
      }
    }
    return g;
  }
  instancedVAO(mesh) {
    const gl = this.gl, geo = mesh.geometry;
    let g = mesh._gpu;
    if (!g || g.gen !== this.gen || g.geoVersion !== geo.version || g.geoStamp !== (geo.gpuStamp || 0) || !geo._gpu) {
      // make sure geometry buffers exist
      this.geometryVAO(geo);
      if (!g || g.gen !== this.gen) g = mesh._gpu = { vao: gl.createVertexArray(), gen: this.gen, mbuf: gl.createBuffer(), cbuf: gl.createBuffer() };
      gl.bindVertexArray(g.vao);
      this._st.vao = g.vao;
      for (const k in geo.attributes) {
        const loc = ATTR_LOC[k];
        if (loc === undefined) continue;
        const a = geo.attributes[k];
        gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, a.itemSize, gl.FLOAT, false, 0, 0);
      }
      if (geo.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo._gpu.ibuf);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.mbuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceMatrix, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(4 + i);
        gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, 64, i * 16);
        gl.vertexAttribDivisor(4 + i, 1);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, g.cbuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceColor, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(8);
      gl.vertexAttribPointer(8, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(8, 1);
      g.geoVersion = geo.version;
      g.geoStamp = geo.gpuStamp || 0;
      mesh.needsUpdate = false;
    } else {
      if (this._st.vao !== g.vao) { gl.bindVertexArray(g.vao); this._st.vao = g.vao; }
      if (mesh.needsUpdate) {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.mbuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceMatrix, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.cbuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceColor, gl.DYNAMIC_DRAW);
        mesh.needsUpdate = false;
      }
    }
    return g;
  }
  bindVAO(vao) { if (this._st.vao !== vao) { this.gl.bindVertexArray(vao); this._st.vao = vao; } }

  // free GPU memory held by everything under `root` (a discarded level). Shared geometries that are
  // drawn again later are simply re-uploaded on demand, so this is always safe.
  releaseGeometry(geo) {
    const gl = this.gl, g = geo._gpu;
    if (g && g.gen === this.gen) { gl.deleteVertexArray(g.vao); if (g.ibuf) gl.deleteBuffer(g.ibuf); }
    geo._gpu = null;
    for (const k in geo.attributes) {
      const a = geo.attributes[k];
      if (a.buf && a.bufGen === this.gen) gl.deleteBuffer(a.buf);
      a.buf = null; a.upVersion = -1;
    }
    geo.gpuStamp = (geo.gpuStamp || 0) + 1;
  }
  releaseTree(root) {
    if (this.contextLost || !root) return;
    const gl = this.gl, seen = new Set();
    gl.bindVertexArray(null); this._st.vao = null;
    root.traverse((n) => {
      if (!n.isMesh) return;
      if (n.isInstanced && n._gpu) {
        const g = n._gpu;
        if (g.gen === this.gen) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.mbuf); gl.deleteBuffer(g.cbuf); }
        n._gpu = null;
      }
      const geo = n.geometry;
      if (geo && !seen.has(geo)) { seen.add(geo); this.releaseGeometry(geo); }
    });
  }

  // ------------------------------------------------------------------ state
  setBlend(mode) {
    const gl = this.gl;
    if (this._st.blend === mode) return;
    if (mode === 'none') gl.disable(gl.BLEND);
    else {
      gl.enable(gl.BLEND);
      if (mode === 'additive') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      else if (mode === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    this._st.blend = mode;
  }
  setDepth(test, write) {
    const gl = this.gl;
    if (this._st.depthTest !== test) { if (test) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST); this._st.depthTest = test; }
    if (this._st.depthWrite !== write) { gl.depthMask(write); this._st.depthWrite = write; }
  }
  setCull(side) {
    const gl = this.gl;
    if (this._st.cull === side) return;
    if (side === 'double') gl.disable(gl.CULL_FACE);
    else { gl.enable(gl.CULL_FACE); gl.cullFace(side === 'back' ? gl.FRONT : gl.BACK); }
    this._st.cull = side;
  }
  setPolyOffset(v) {
    const gl = this.gl;
    if (this._st.polyOff === v) return;
    if (v) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(v, v); } else gl.disable(gl.POLYGON_OFFSET_FILL);
    this._st.polyOff = v;
  }

  // ------------------------------------------------------------------ frustum
  _extractFrustum(m) {
    const f = this._frustum;
    const set = (i, a, b, c, d) => { const l = Math.hypot(a, b, c) || 1; f[i] = a / l; f[i + 1] = b / l; f[i + 2] = c / l; f[i + 3] = d / l; };
    set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    set(4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    set(8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    set(12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    set(16, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    set(20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  }
  sphereVisible(x, y, z, r) {
    const f = this._frustum;
    for (let i = 0; i < 24; i += 4) if (f[i] * x + f[i + 1] * y + f[i + 2] * z + f[i + 3] < -r) return false;
    return true;
  }

  // ------------------------------------------------------------------ render
  _collect(node) {
    if (!node.visible) return;
    if (node.isMesh) {
      if (node._bakedInto) { /* drawn as part of its merged bake */ }
      else if (node.isBaked) { if (bakeValid(node)) this._candidates.push(node); else unbake(node); }
      else this._candidates.push(node);
    } else if (node.isCustom) this._customs.push(node);
    const ch = node.children;
    for (let i = 0; i < ch.length; i++) this._collect(ch[i]);
  }

  render(scene, camera, opts = {}) {
    if (this.contextLost) return;
    const gl = this.gl;
    this.stats.calls = 0; this.stats.tris = 0;
    camera.aspect = this.width / this.height;
    camera.update();
    scene.updateWorld();
    const G = this.globals;
    G.uView.set(camera.view); G.uProj.set(camera.proj); G.uInvViewProj.set(camera.invViewProj);
    G.uCamPos[0] = camera.position.x; G.uCamPos[1] = camera.position.y; G.uCamPos[2] = camera.position.z;
    this.globalsVersion++;
    this._extractFrustum(camera.viewProj);

    if (opts.target) gl.bindFramebuffer(gl.FRAMEBUFFER, opts.target);
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, opts.width || this.width, opts.height || this.height);
    const cc = opts.clearColor || this.clearColor;
    gl.clearColor(cc[0], cc[1], cc[2], opts.clearAlpha ?? 1);
    this.setDepth(true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    if (scene.sky && !opts.noSky) this.drawSky(scene.sky, camera);

    this._candidates = []; this._customs = [];
    this._collect(scene);
    const op = this._opaque, tr = this._transparent;
    op.length = 0; tr.length = 0;
    const vp = camera.viewProj;
    const kpx = (this.cssH || this.height) * 0.5 / Math.tan((camera.fov || 0.9) * 0.5);
    const minPx = opts.minPx ?? this.minPx;
    const cullK = minPx > 0 ? (minPx / kpx) * (minPx / kpx) : 0;
    const cpx = camera.position.x, cpy = camera.position.y, cpz = camera.position.z;
    for (const m of this._candidates) {
      const geo = m.geometry;
      if (!geo || !m.material) continue;
      if (m.isInstanced && m.count === 0) continue;
      if (m.frustumCulled) {
        let bs;
        if (m.isInstanced) { if (!m._bounds || m.needsUpdate) m.computeBounds(); bs = m._bounds; }
        else { if (!geo.boundingSphere) geo.computeBoundingSphere(); bs = geo.boundingSphere; }
        const w = m.worldMatrix;
        const c = bs.center;
        const x = w[0] * c.x + w[4] * c.y + w[8] * c.z + w[12];
        const y = w[1] * c.x + w[5] * c.y + w[9] * c.z + w[13];
        const z = w[2] * c.x + w[6] * c.y + w[10] * c.z + w[14];
        const r = bs.radius * Mat4.maxScale(w);
        if (cullK > 0 && !m.isInstanced && !m.noSmallCull) {
          const dx = x - cpx, dy = y - cpy, dz = z - cpz;
          if (r * r < cullK * (dx * dx + dy * dy + dz * dz)) continue;
        }
        if (!this.sphereVisible(x, y, z, r)) continue;
        m._viewZ = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      } else {
        const w = m.worldMatrix;
        m._viewZ = vp[3] * w[12] + vp[7] * w[13] + vp[11] * w[14] + vp[15];
      }
      const transparent = m.material.transparent || (m.opacity !== undefined && m.opacity < 1);
      if (transparent) tr.push(m); else op.push(m);
    }
    op.sort((a, b) => (a.material.renderOrder - b.material.renderOrder) || (a.material.id - b.material.id));
    tr.sort((a, b) => ((a.renderOrder + a.material.renderOrder) - (b.renderOrder + b.material.renderOrder)) || (b._viewZ - a._viewZ));
    this._lastMat = null;
    for (const m of op) this.drawMesh(m);
    // customs with renderOrder < 50 draw between opaque and transparent (e.g., shadows)
    const customs = this._customs.sort((a, b) => a.renderOrder - b.renderOrder);
    for (const c of customs) if (c.renderOrder < 50) c.render(this, camera);
    for (const m of tr) this.drawMesh(m);
    for (const c of customs) if (c.renderOrder >= 50) c.render(this, camera);
    if (opts.target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawMesh(m) {
    const gl = this.gl, mat = m.material, geo = m.geometry;
    let mask = 0;
    if (mat.vertexColors && geo.attributes.color) mask |= FLAG.VCOLOR;
    if (mat.map && geo.attributes.uv) mask |= FLAG.UV | FLAG.MAP;
    if (m.isInstanced) mask |= FLAG.INST;
    if (mat.wind > 0) mask |= FLAG.WIND;
    if (mat.satField) mask |= FLAG.SAT;
    if (mat.fog) mask |= FLAG.FOG;
    if (mat.side === 'double') mask |= FLAG.DOUBLE;
    if (mat.unlit) mask |= FLAG.UNLIT;
    if (mat.spec > 0) mask |= FLAG.SPEC;
    if (mat.alphaTest) mask |= FLAG.ATEST;
    const p = this.programFor(mat, mask);
    this.useProgram(p);
    const meshOpacity = m.opacity !== undefined ? m.opacity : 1;
    const transparent = mat.transparent || meshOpacity < 1;
    this.setBlend(transparent ? (mat.blending === 'normal' ? 'normal' : mat.blending) : 'none');
    this.setDepth(mat.depthTest, transparent ? (mat.depthWrite && meshOpacity >= 1) : mat.depthWrite);
    this.setCull(mat.side);
    this.setPolyOffset(mat.polygonOffset);
    if (this._lastMat !== mat || this._lastProg !== p) {
      this.setUniform(p, 'uColor', mat.color);
      this.setUniform(p, 'uEmissive', mat.emissive);
      this.setUniform(p, 'uRim', mat.rim);
      this.setUniform(p, 'uSpec', mat.spec);
      this.setUniform(p, 'uWind', mat.wind);
      if (mat.map) { this.setUniform(p, 'uMap', mat.map); this.setUniform(p, 'uMapRepeat', mat.mapRepeat); }
      for (const k in mat.uniforms) this.setUniform(p, k, mat.uniforms[k]);
      this._lastMat = mat; this._lastProg = p;
    }
    this.setUniform(p, 'uOpacity', mat.opacity * meshOpacity);
    this.setUniform(p, 'uFlash', Math.max(mat.flash, m.flash || 0));
    this.setUniform(p, 'uModel', m.worldMatrix);
    if (!m.isInstanced && p.uniforms.uNormalMat) {
      Mat4.normalMat3(this._normalMat, m.worldMatrix);
      this.setUniform(p, 'uNormalMat', this._normalMat);
    }
    if (m.isInstanced) {
      this.instancedVAO(m);
      if (geo.index) gl.drawElementsInstanced(geo.drawMode, geo.index.length, geo.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0, m.count);
      else gl.drawArraysInstanced(geo.drawMode, 0, geo.vertexCount, m.count);
      this.stats.tris += ((geo.index ? geo.index.length : geo.vertexCount) / 3) * m.count;
    } else {
      this.geometryVAO(geo);
      const count = geo.drawCount !== undefined && geo.drawCount >= 0 ? geo.drawCount : (geo.index ? geo.index.length : geo.vertexCount);
      if (geo.index) gl.drawElements(geo.drawMode, count, geo.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      else gl.drawArrays(geo.drawMode, 0, count);
      this.stats.tris += count / 3;
    }
    this.stats.calls++;
  }

  fullscreenTriangle() {
    if (this._fsTri && this._fsTri.gen === this.gen) return this._fsTri;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this._st.vao = vao;
    this._fsTri = { vao, gen: this.gen };
    return this._fsTri;
  }
  drawSky(sky) {
    const gl = this.gl;
    const p = this.buildProgram('sky', []);
    this.useProgram(p);
    this.setBlend('none'); this.setDepth(false, false); this.setCull('double'); this.setPolyOffset(0);
    for (const k in sky.uniforms) this.setUniform(p, k, sky.uniforms[k]);
    this.setUniform(p, 'uInvViewProj', this.globals.uInvViewProj);
    this.setUniform(p, 'uCamPos', this.globals.uCamPos);
    this.setUniform(p, 'uTime', this.globals.uTime);
    this.setUniform(p, 'uSkySat', this.globals.uSkySat);
    const t = this.fullscreenTriangle();
    this.bindVAO(t.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.calls++;
    this.setDepth(true, true);
  }

  // ------------------------------------------------------------------ offscreen
  // Render scene to RGBA pixels (for portraits). Returns ImageData-like.
  renderToImageData(scene, camera, w, h) {
    const gl = this.gl;
    if (!this._fbo || this._fbo.w !== w || this._fbo.h !== h || this._fbo.gen !== this.gen) {
      const fb = gl.createFramebuffer();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._fbo = { fb, tex, rb, w, h, gen: this.gen };
    }
    const prevW = this.width, prevH = this.height;
    this.width = w; this.height = h;
    this.render(scene, camera, { target: this._fbo.fb, width: w, height: h, clearColor: [0, 0, 0], clearAlpha: 0, noSky: true });
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo.fb);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.width = prevW; this.height = prevH;
    // flip Y
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return { width: w, height: h, data: out };
  }
}

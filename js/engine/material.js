// ============================================================================
// material.js — Material description + shared material cache helpers
// ============================================================================
import { rgb } from './math.js';

let matId = 0;

export class Material {
  constructor(o = {}) {
    this.id = ++matId;
    this.shader = o.shader || 'toon';
    this.color = o.color !== undefined ? rgb(o.color) : [1, 1, 1];
    this.emissive = o.emissive !== undefined ? rgb(o.emissive) : [0, 0, 0];
    this.opacity = o.opacity ?? 1;
    this.transparent = o.transparent ?? false;
    this.blending = o.blending || 'normal'; // normal | additive | multiply
    this.depthWrite = o.depthWrite ?? !this.transparent;
    this.depthTest = o.depthTest ?? true;
    this.side = o.side || 'front'; // front | back | double
    this.map = o.map || null;
    this.mapRepeat = o.mapRepeat || [1, 1];
    this.vertexColors = !!o.vertexColors;
    this.rim = o.rim ?? 0.28;
    this.spec = o.spec ?? 0;
    this.unlit = !!o.unlit;
    this.satField = !!o.satField;
    this.fog = o.fog ?? true;
    this.wind = o.wind ?? 0;
    this.alphaTest = !!o.alphaTest;
    this.flash = 0;
    this.uniforms = o.uniforms || {};
    this.defines = o.defines || [];
    this.renderOrder = o.renderOrder ?? 0;
    this.polygonOffset = o.polygonOffset ?? 0;
    this._progs = new Map();
    this._defStr = this.defines.slice().sort().join(',');
  }
  clone(over = {}) {
    const m = new Material({
      shader: this.shader, color: this.color, emissive: this.emissive, opacity: this.opacity,
      transparent: this.transparent, blending: this.blending, depthWrite: this.depthWrite, depthTest: this.depthTest,
      side: this.side, map: this.map, mapRepeat: this.mapRepeat, vertexColors: this.vertexColors, rim: this.rim,
      spec: this.spec, unlit: this.unlit, satField: this.satField, fog: this.fog, wind: this.wind,
      alphaTest: this.alphaTest, uniforms: { ...this.uniforms }, defines: this.defines.slice(), renderOrder: this.renderOrder,
      polygonOffset: this.polygonOffset, ...over,
    });
    return m;
  }
}

// Cache: same visual params -> same material (for static/shared parts)
const cache = new Map();
export function mat(color, opts = {}) {
  const key = JSON.stringify([color, opts]);
  let m = cache.get(key);
  if (!m) { m = new Material({ color, ...opts }); cache.set(key, m); }
  return m;
}
// Glossy toon (characters, items)
export function glossy(color, opts = {}) { return mat(color, { spec: 0.35, rim: 0.4, ...opts }); }

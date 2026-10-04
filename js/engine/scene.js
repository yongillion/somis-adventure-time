// ============================================================================
// scene.js — scene graph: Node, Mesh, InstancedMesh, Camera, Scene
// ============================================================================
import { Vec3, Quat, Mat4, DEG } from './math.js';

let nodeId = 0;

export class Node {
  constructor(name = '') {
    this.id = ++nodeId;
    this.name = name;
    this.position = new Vec3();
    this.rotation = new Vec3(); // Euler YXZ radians
    this.quaternion = null; // if set, overrides rotation
    this.scale = new Vec3(1, 1, 1);
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.matrix = Mat4.create();
    this.worldMatrix = Mat4.create();
    this.matrixAutoUpdate = true;
    this.userData = {};
  }
  add(...nodes) {
    for (const n of nodes) {
      if (!n) continue;
      if (n.parent) n.parent.remove(n);
      n.parent = this;
      this.children.push(n);
    }
    return this;
  }
  remove(n) {
    const i = this.children.indexOf(n);
    if (i >= 0) { this.children.splice(i, 1); n.parent = null; }
    return this;
  }
  removeFromParent() { if (this.parent) this.parent.remove(this); return this; }
  clearChildren() { for (const c of this.children) c.parent = null; this.children.length = 0; }
  traverse(fn) { fn(this); for (let i = 0; i < this.children.length; i++) this.children[i].traverse(fn); }
  getByName(name) {
    if (this.name === name) return this;
    for (const c of this.children) { const r = c.getByName(name); if (r) return r; }
    return null;
  }
  updateMatrix() {
    const p = this.position, s = this.scale;
    if (this.quaternion) Mat4.composeQuat(this.matrix, p.x, p.y, p.z, this.quaternion, s.x, s.y, s.z);
    else Mat4.composeEuler(this.matrix, p.x, p.y, p.z, this.rotation.x, this.rotation.y, this.rotation.z, s.x, s.y, s.z);
  }
  updateWorld(parentWorld = null, force = false) {
    if (!this.visible && !force) return;
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (parentWorld) Mat4.multiply(this.worldMatrix, parentWorld, this.matrix);
    else this.worldMatrix.set(this.matrix);
    const ch = this.children;
    for (let i = 0; i < ch.length; i++) ch[i].updateWorld(this.worldMatrix, force);
  }
  // compute world matrix of this node right now (walks up parents)
  updateWorldFromRoot() {
    const chain = [];
    let n = this;
    while (n) { chain.push(n); n = n.parent; }
    let parent = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      c.updateMatrix();
      if (parent) Mat4.multiply(c.worldMatrix, parent, c.matrix); else c.worldMatrix.set(c.matrix);
      parent = c.worldMatrix;
    }
    return this.worldMatrix;
  }
  getWorldPosition(out = new Vec3()) { return out.set(this.worldMatrix[12], this.worldMatrix[13], this.worldMatrix[14]); }
  setScale(s) { this.scale.set(s, s, s); return this; }
}

export class Mesh extends Node {
  constructor(geometry, material, name = '') {
    super(name);
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.frustumCulled = true;
    this.renderOrder = 0;
    this._viewZ = 0;
  }
}

export class InstancedMesh extends Node {
  constructor(geometry, material, maxCount, name = '') {
    super(name);
    this.isMesh = true;
    this.isInstanced = true;
    this.geometry = geometry;
    this.material = material;
    this.maxCount = maxCount;
    this.count = 0;
    this.instanceMatrix = new Float32Array(maxCount * 16);
    this.instanceColor = new Float32Array(maxCount * 4).fill(1);
    this.needsUpdate = true;
    this.frustumCulled = true;
    this.renderOrder = 0;
    this._bounds = null;
    this._gpu = null;
  }
  setMatrixAt(i, m) { this.instanceMatrix.set(m, i * 16); this.needsUpdate = true; }
  setColorAt(i, r, g, b, a = 1) { const o = i * 4; this.instanceColor[o] = r; this.instanceColor[o + 1] = g; this.instanceColor[o + 2] = b; this.instanceColor[o + 3] = a; this.needsUpdate = true; }
  setTransformAt(i, px, py, pz, rx, ry, rz, sx, sy = sx, sz = sx) {
    Mat4.composeEuler(_m, px, py, pz, rx, ry, rz, sx, sy, sz);
    this.instanceMatrix.set(_m, i * 16);
    this.needsUpdate = true;
  }
  computeBounds() {
    // bounding sphere enclosing all instances (in local space)
    const g = this.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r0 = g.boundingSphere.radius;
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity, maxS = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 16, m = this.instanceMatrix;
      const x = m[o + 12], y = m[o + 13], z = m[o + 14];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
      const s = Math.sqrt(Math.max(m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2], m[o + 4] * m[o + 4] + m[o + 5] * m[o + 5] + m[o + 6] * m[o + 6], m[o + 8] * m[o + 8] + m[o + 9] * m[o + 9] + m[o + 10] * m[o + 10]));
      if (s > maxS) maxS = s;
    }
    if (this.count === 0) { this._bounds = { center: new Vec3(), radius: 0 }; return; }
    const c = new Vec3((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2);
    const half = Math.hypot(maxx - minx, maxy - miny, maxz - minz) / 2;
    this._bounds = { center: c, radius: half + r0 * maxS + Math.hypot(g.boundingSphere.center.x, g.boundingSphere.center.y, g.boundingSphere.center.z) * maxS };
  }
}
const _m = Mat4.create();

export class Camera {
  constructor(fovDeg = 50, near = 0.1, far = 600) {
    this.fov = fovDeg * DEG;
    this.near = near;
    this.far = far;
    this.aspect = 1;
    this.position = new Vec3(0, 5, 10);
    this.target = new Vec3();
    this.up = new Vec3(0, 1, 0);
    this.view = Mat4.create();
    this.proj = Mat4.create();
    this.viewProj = Mat4.create();
    this.invViewProj = Mat4.create();
    this.roll = 0;
  }
  update() {
    Mat4.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    if (this.roll) {
      const f = new Vec3().subVectors(this.target, this.position).normalize();
      const r = new Vec3().crossVectors(f, new Vec3(0, 1, 0)).normalize();
      const u = new Vec3().crossVectors(r, f);
      this.up.set(0, 0, 0).addScaled(u, Math.cos(this.roll)).addScaled(r, Math.sin(this.roll));
    } else this.up.set(0, 1, 0);
    Mat4.lookAt(this.view, this.position, this.target, this.up);
    Mat4.multiply(this.viewProj, this.proj, this.view);
    Mat4.invert(this.invViewProj, this.viewProj);
  }
  // project world -> normalized device coords; returns {x,y (0..1 screen), z (ndc), visible}
  project(p, out = { x: 0, y: 0, z: 0, visible: false }) {
    const m = this.viewProj;
    const x = p.x, y = p.y, z = p.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    out.x = nx * 0.5 + 0.5; out.y = 1 - (ny * 0.5 + 0.5); out.z = nz;
    out.visible = w > 0 && nz < 1 && nx > -1.2 && nx < 1.2 && ny > -1.2 && ny < 1.2;
    return out;
  }
  forward(out = new Vec3()) { return out.subVectors(this.target, this.position).normalize(); }
}

export class Scene extends Node {
  constructor() {
    super('scene');
    this.background = [0.6, 0.8, 1.0];
    this.sky = null; // sky renderable (custom)
    this.customs = []; // custom renderables (particles etc.)
  }
}

// A custom renderable node: subclass and implement render(renderer, camera)
export class Custom extends Node {
  constructor(name = '') { super(name); this.isCustom = true; this.renderOrder = 100; }
  render(/* renderer, camera */) {}
}

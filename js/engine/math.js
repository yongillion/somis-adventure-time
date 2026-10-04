// ============================================================================
// math.js — vectors, quaternions, 4x4 matrices, easing, RNG, noise, color
// Column-major matrices (WebGL convention). Euler order is 'YXZ'.
// ============================================================================

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => c + (d - c) * clamp01(invLerp(a, b, v));
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const sign = (v) => (v < 0 ? -1 : 1);
export const fract = (v) => v - Math.floor(v);

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
}
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
export function moveToward(a, b, maxDelta) {
  if (Math.abs(b - a) <= maxDelta) return b;
  return a + Math.sign(b - a) * maxDelta;
}
export function moveTowardAngle(a, b, maxDelta) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
}

// --------------------------------------------------------------------------
// Easing
// --------------------------------------------------------------------------
export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => { const u = t - 1; return u * u * u + 1; },
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  inOutSine: (t) => -(Math.cos(PI * t) - 1) / 2,
  outSine: (t) => Math.sin((t * PI) / 2),
  inSine: (t) => 1 - Math.cos((t * PI) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * PI) / 3)) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// --------------------------------------------------------------------------
// Vec3
// --------------------------------------------------------------------------
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  addXYZ(x, y, z) { this.x += x; this.y += y; this.z += z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) { return this.crossVectors(this, v); }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx;
    return this;
  }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lengthXZ() { return Math.sqrt(this.x * this.x + this.z * this.z); }
  normalize() { const l = this.length(); if (l > 1e-8) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  setLength(len) { return this.normalize().scale(len); }
  distanceTo(v) { return Math.sqrt(this.distanceToSq(v)); }
  distanceToSq(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  distXZ(v) { const dx = this.x - v.x, dz = this.z - v.z; return Math.sqrt(dx * dx + dz * dz); }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; }
  damp(v, lambda, dt) { return this.lerp(v, 1 - Math.exp(-lambda * dt)); }
  applyMat4(m) {
    const x = this.x, y = this.y, z = this.z;
    const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15] || 1);
    this.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) * w;
    this.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) * w;
    this.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w;
    return this;
  }
  transformDir(m) {
    const x = this.x, y = this.y, z = this.z;
    this.x = m[0] * x + m[4] * y + m[8] * z;
    this.y = m[1] * x + m[5] * y + m[9] * z;
    this.z = m[2] * x + m[6] * y + m[10] * z;
    return this;
  }
  applyQuat(q) {
    const x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  rotateY(a) {
    const c = Math.cos(a), s = Math.sin(a), x = this.x, z = this.z;
    this.x = x * c + z * s; this.z = -x * s + z * c;
    return this;
  }
  setFromMatrixPosition(m) { this.x = m[12]; this.y = m[13]; this.z = m[14]; return this; }
  equals(v, eps = 1e-6) { return Math.abs(this.x - v.x) < eps && Math.abs(this.y - v.y) < eps && Math.abs(this.z - v.z) < eps; }
  toArray(a = [], o = 0) { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a; }
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this; }
  isZero() { return this.x === 0 && this.y === 0 && this.z === 0; }
}
export const v3 = (x, y, z) => new Vec3(x, y, z);

// --------------------------------------------------------------------------
// Quat
// --------------------------------------------------------------------------
export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromAxisAngle(ax, ay, az, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = ax * s; this.y = ay * s; this.z = az * s; this.w = Math.cos(h);
    return this;
  }
  // Euler YXZ
  setFromEuler(x, y, z) {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 - s1 * s2 * c3;
    this.w = c1 * c2 * c3 + s1 * s2 * s3;
    return this;
  }
  multiply(q) { return this.multiplyQuats(this, q); }
  premultiply(q) { return this.multiplyQuats(q, this); }
  multiplyQuats(a, b) {
    const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w, qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    return this;
  }
  normalize() {
    let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (l === 0) return this.identity();
    l = 1 / l; this.x *= l; this.y *= l; this.z *= l; this.w *= l;
    return this;
  }
  conjugate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  slerp(qb, t) {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);
    const x = this.x, y = this.y, z = this.z, w = this.w;
    let cosHalf = w * qb.w + x * qb.x + y * qb.y + z * qb.z;
    if (cosHalf < 0) { this.w = -qb.w; this.x = -qb.x; this.y = -qb.y; this.z = -qb.z; cosHalf = -cosHalf; }
    else this.copy(qb);
    if (cosHalf >= 1.0) { this.w = w; this.x = x; this.y = y; this.z = z; return this; }
    const sqrSin = 1.0 - cosHalf * cosHalf;
    if (sqrSin <= Number.EPSILON) {
      const s = 1 - t;
      this.w = s * w + t * this.w; this.x = s * x + t * this.x; this.y = s * y + t * this.y; this.z = s * z + t * this.z;
      return this.normalize();
    }
    const sinHalf = Math.sqrt(sqrSin), halfTheta = Math.atan2(sinHalf, cosHalf);
    const ra = Math.sin((1 - t) * halfTheta) / sinHalf, rb = Math.sin(t * halfTheta) / sinHalf;
    this.w = w * ra + this.w * rb; this.x = x * ra + this.x * rb; this.y = y * ra + this.y * rb; this.z = z * ra + this.z * rb;
    return this;
  }
  // rotation that takes unit vector a to unit vector b
  setFromUnitVectors(a, b) {
    let r = a.dot(b) + 1;
    if (r < 1e-6) {
      r = 0;
      if (Math.abs(a.x) > Math.abs(a.z)) { this.x = -a.y; this.y = a.x; this.z = 0; this.w = r; }
      else { this.x = 0; this.y = -a.z; this.z = a.y; this.w = r; }
    } else {
      this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; this.w = r;
    }
    return this.normalize();
  }
}

// --------------------------------------------------------------------------
// Mat4 (Float32Array(16), column-major)
// --------------------------------------------------------------------------
export const Mat4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  copy(o, a) { o.set(a); return o; },
  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    o[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    o[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    o[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    o[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return o;
  },
  // position, euler YXZ (rx,ry,rz), scale
  composeEuler(o, px, py, pz, rx, ry, rz, sx, sy, sz) {
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
    const ce = c * e, cf = c * f, de = d * e, df = d * f;
    o[0] = (ce + df * b) * sx; o[1] = a * f * sx; o[2] = (cf * b - de) * sx; o[3] = 0;
    o[4] = (de * b - cf) * sy; o[5] = a * e * sy; o[6] = (df + ce * b) * sy; o[7] = 0;
    o[8] = a * d * sz; o[9] = -b * sz; o[10] = a * c * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
    return o;
  },
  composeQuat(o, px, py, pz, q, sx, sy, sz) {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
    o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
    o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
    return o;
  },
  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return Mat4.identity(o);
    det = 1.0 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  perspective(o, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  },
  // view matrix
  lookAt(o, eye, target, up) {
    let z0 = eye.x - target.x, z1 = eye.y - target.y, z2 = eye.z - target.z;
    let len = Math.hypot(z0, z1, z2);
    if (len < 1e-8) return Mat4.identity(o);
    z0 /= len; z1 /= len; z2 /= len;
    let x0 = up.y * z2 - up.z * z1, x1 = up.z * z0 - up.x * z2, x2 = up.x * z1 - up.y * z0;
    len = Math.hypot(x0, x1, x2);
    if (len < 1e-8) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }
    const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
    o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
    o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
    o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
    o[12] = -(x0 * eye.x + x1 * eye.y + x2 * eye.z);
    o[13] = -(y0 * eye.x + y1 * eye.y + y2 * eye.z);
    o[14] = -(z0 * eye.x + z1 * eye.y + z2 * eye.z);
    o[15] = 1;
    return o;
  },
  // 3x3 inverse-transpose of upper-left of m into o (Float32Array(9))
  normalMat3(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[4], a11 = a[5], a12 = a[6], a20 = a[8], a21 = a[9], a22 = a[10];
    const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = 0; o[7] = 0; o[8] = 1; return o; }
    det = 1 / det;
    // inverse (row-major result) then transpose -> write column-major of inverse-transpose
    const i00 = b01 * det, i01 = (-a22 * a01 + a02 * a21) * det, i02 = (a12 * a01 - a02 * a11) * det;
    const i10 = b11 * det, i11 = (a22 * a00 - a02 * a20) * det, i12 = (-a12 * a00 + a02 * a10) * det;
    const i20 = b21 * det, i21 = (-a21 * a00 + a01 * a20) * det, i22 = (a11 * a00 - a01 * a10) * det;
    // inverse in column-major is [i00,i01,i02, i10,i11,i12, i20,i21,i22]; transpose:
    o[0] = i00; o[1] = i10; o[2] = i20;
    o[3] = i01; o[4] = i11; o[5] = i21;
    o[6] = i02; o[7] = i12; o[8] = i22;
    return o;
  },
  maxScale(m) {
    const sx = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const sy = m[4] * m[4] + m[5] * m[5] + m[6] * m[6];
    const sz = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
    return Math.sqrt(Math.max(sx, sy, sz));
  },
  fromTranslation(o, x, y, z) { Mat4.identity(o); o[12] = x; o[13] = y; o[14] = z; return o; },
};

// --------------------------------------------------------------------------
// Random & noise
// --------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class RNG {
  constructor(seed = 1) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.f()); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
}
export const rand = (a = 0, b = 1) => a + (b - a) * Math.random();
export const randInt = (a, b) => Math.floor(a + (b - a + 1) * Math.random());
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function valueNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const n000 = hash3(xi, yi, zi), n100 = hash3(xi + 1, yi, zi), n010 = hash3(xi, yi + 1, zi), n110 = hash3(xi + 1, yi + 1, zi);
  const n001 = hash3(xi, yi, zi + 1), n101 = hash3(xi + 1, yi, zi + 1), n011 = hash3(xi, yi + 1, zi + 1), n111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(lerp(lerp(n000, n100, u), lerp(n010, n110, u), v), lerp(lerp(n001, n101, u), lerp(n011, n111, u), v), w);
}
export function fbm2(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * valueNoise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * valueNoise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// --------------------------------------------------------------------------
// Color helpers — colors are [r,g,b] floats in 0..1 (sRGB, stylized)
// --------------------------------------------------------------------------
export function rgb(hex) {
  if (Array.isArray(hex)) return hex.slice(0, 3);
  if (typeof hex === 'string') hex = parseInt(hex.replace('#', ''), 16);
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
export function mixColor(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
export function shade(c, f) { return [clamp01(c[0] * f), clamp01(c[1] * f), clamp01(c[2] * f)]; }
export function lighten(c, t) { return mixColor(c, [1, 1, 1], t); }
export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export function colorToCss(c, a = 1) {
  const r = Math.round(clamp01(c[0]) * 255), g = Math.round(clamp01(c[1]) * 255), b = Math.round(clamp01(c[2]) * 255);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}
export function hexToCss(hex) { return colorToCss(rgb(hex)); }

// distance from point p to segment ab in XZ plane
export function distPointSegXZ(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp01(t);
  const cx = ax + abx * t, cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

// Catmull-Rom on array of Vec3 (closed or open)
export function catmullRom(points, t, closed = false, out = new Vec3()) {
  const n = points.length;
  if (n === 1) return out.copy(points[0]);
  const segs = closed ? n : n - 1;
  let f = clamp01(t) * segs;
  let i = Math.floor(f);
  if (i >= segs) i = segs - 1;
  const lt = f - i;
  const idx = (k) => (closed ? ((k % n) + n) % n : clamp(k, 0, n - 1));
  const p0 = points[idx(i - 1)], p1 = points[idx(i)], p2 = points[idx(i + 1)], p3 = points[idx(i + 2)];
  const t2 = lt * lt, t3 = t2 * lt;
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * lt + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  out.x = cr(p0.x, p1.x, p2.x, p3.x);
  out.y = cr(p0.y, p1.y, p2.y, p3.y);
  out.z = cr(p0.z, p1.z, p2.z, p3.z);
  return out;
}

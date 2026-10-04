// ============================================================================
// texgen.js — procedural canvas textures (particle atlas, tileable details,
// animal patterns). Everything is generated at runtime: no image assets.
// ============================================================================
import { Texture } from './renderer.js';
import { mulberry32, TAU, clamp01, lerp } from './math.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// tileable value noise (period p)
function tnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    a = ((a % p) + p) % p; b = ((b % p) + p) % p;
    let n = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
function tfbm(x, y, p, seed, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * tnoise(x * f, y * f, p * f, seed + i * 17); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// --------------------------------------------------------------------------
// Particle atlas: 4x4 tiles of 128px
export const TILE = {
  GLOW: 0, DOT: 1, SPARKLE: 2, STAR: 3, HEART: 4, RING: 5, PUFF: 6, PETAL: 7,
  LEAF: 8, SNOW: 9, NOTE: 10, DROP: 11, CONFETTI: 12, FLAME: 13, SHADOW: 14, ZAP: 15,
};
export function makeParticleAtlas() {
  const T = 128, N = 4;
  const c = makeCanvas(T * N, T * N);
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const tile = (i, fn) => {
    const x = (i % N) * T, y = Math.floor(i / N) * T;
    g.save(); g.translate(x + T / 2, y + T / 2); fn(g, T); g.restore();
  };
  const radial = (r, stops) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); for (const [o, col] of stops) gr.addColorStop(o, col); return gr; };
  const starPath = (pts, ro, ri, rot = -Math.PI / 2) => {
    g.beginPath();
    for (let k = 0; k < pts * 2; k++) {
      const a = rot + (k / (pts * 2)) * TAU, r = k % 2 === 0 ? ro : ri;
      if (k === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  };
  // 0 glow
  tile(0, () => { g.fillStyle = radial(62, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [0.6, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(-64, -64, 128, 128); });
  // 1 dot
  tile(1, () => { g.fillStyle = radial(56, [[0, 'rgba(255,255,255,1)'], [0.75, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]); g.beginPath(); g.arc(0, 0, 56, 0, TAU); g.fill(); });
  // 2 sparkle (4-point)
  tile(2, () => {
    g.fillStyle = radial(60, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    g.beginPath();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU - Math.PI / 2, r = k % 2 === 0 ? 62 : 9; if (k === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(0, 0, 10, 0, TAU); g.fill();
  });
  // 3 star (5-point, rounded)
  tile(3, () => { g.fillStyle = '#fff'; g.lineJoin = 'round'; g.strokeStyle = '#fff'; g.lineWidth = 10; starPath(5, 52, 24); g.fill(); g.stroke(); });
  // 4 heart
  tile(4, () => {
    g.fillStyle = '#fff'; g.beginPath();
    for (let k = 0; k <= 60; k++) {
      const t = (k / 60) * TAU;
      const x = 16 * Math.pow(Math.sin(t), 3), y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      if (k === 0) g.moveTo(x * 3.4, y * 3.4 - 4); else g.lineTo(x * 3.4, y * 3.4 - 4);
    }
    g.fill();
  });
  // 5 ring
  tile(5, () => { g.strokeStyle = '#fff'; g.lineWidth = 9; g.beginPath(); g.arc(0, 0, 50, 0, TAU); g.stroke(); g.globalAlpha = 0.35; g.lineWidth = 18; g.stroke(); g.globalAlpha = 1; });
  // 6 puff (soft cloud)
  tile(6, () => {
    const rnd = mulberry32(7);
    for (let k = 0; k < 9; k++) {
      const a = rnd() * TAU, d = rnd() * 24, r = 26 + rnd() * 16;
      g.fillStyle = radial(r, [[0, 'rgba(255,255,255,0.9)'], [0.7, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
      g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.restore();
    }
  });
  // 7 petal
  tile(7, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -52); g.bezierCurveTo(40, -30, 34, 30, 0, 52); g.bezierCurveTo(-34, 30, -40, -30, 0, -52); g.fill(); g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.ellipse(0, 10, 6, 30, 0, 0, TAU); g.fill(); });
  // 8 leaf
  tile(8, () => {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -56); g.quadraticCurveTo(46, -10, 0, 56); g.quadraticCurveTo(-46, -10, 0, -56); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, -48); g.lineTo(0, 50); g.stroke();
  });
  // 9 snowflake
  tile(9, () => {
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 8;
    for (let k = 0; k < 6; k++) {
      g.save(); g.rotate((k / 6) * TAU);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -52); g.moveTo(0, -30); g.lineTo(-14, -42); g.moveTo(0, -30); g.lineTo(14, -42); g.stroke();
      g.restore();
    }
  });
  // 10 music note
  tile(10, () => {
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 9;
    g.beginPath(); g.ellipse(-14, 30, 20, 15, -0.4, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(3, 28); g.lineTo(3, -46); g.stroke();
    g.beginPath(); g.moveTo(3, -46); g.quadraticCurveTo(30, -36, 28, -10); g.quadraticCurveTo(24, -26, 3, -28); g.fill();
  });
  // 11 droplet
  tile(11, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -54); g.bezierCurveTo(30, -12, 40, 14, 0, 50); g.bezierCurveTo(-40, 14, -30, -12, 0, -54); g.fill(); g.fillStyle = 'rgba(255,255,255,0.0)'; });
  // 12 confetti (rounded square)
  tile(12, () => { g.fillStyle = '#fff'; const r = 14, s = 44; g.beginPath(); g.moveTo(-s + r, -s); g.arcTo(s, -s, s, s, r); g.arcTo(s, s, -s, s, r); g.arcTo(-s, s, -s, -s, r); g.arcTo(-s, -s, s, -s, r); g.fill(); });
  // 13 flame (teardrop glow)
  tile(13, () => {
    const gr = g.createRadialGradient(0, 18, 4, 0, 10, 56);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -60); g.bezierCurveTo(34, -10, 44, 30, 0, 58); g.bezierCurveTo(-44, 30, -34, -10, 0, -60); g.fill();
  });
  // 14 shadow blob
  tile(14, () => { g.fillStyle = radial(62, [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]); g.beginPath(); g.arc(0, 0, 63, 0, TAU); g.fill(); });
  // 15 zap
  tile(15, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(10, -58); g.lineTo(-24, 6); g.lineTo(-2, 6); g.lineTo(-12, 58); g.lineTo(26, -10); g.lineTo(4, -10); g.closePath(); g.fill(); });
  return new Texture(c, { wrap: 'clamp', mipmaps: true });
}

// --------------------------------------------------------------------------
// Tileable surface detail textures (mostly near-white so they tint base colors)
export function makeDetailTexture(kind, size = 256, seed = 1) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const rnd = mulberry32(seed * 977 + kind.length * 13);
  const put = (x, y, v, a = 255) => { const i = (y * size + x) * 4; d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = a; };
  const P = 8; // noise period in cells
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * P, v = (y / size) * P;
    let r = 1, gg = 1, b = 1;
    switch (kind) {
      case 'grass': {
        const n = tfbm(u, v, P, seed, 4);
        const n2 = tnoise(u * 4, v * 4, P * 4, seed + 5);
        const k = 0.86 + n * 0.2 + (n2 > 0.72 ? 0.07 : 0);
        r = k * 0.98; gg = k * 1.02; b = k * 0.95;
        break;
      }
      case 'stone': {
        const n = tfbm(u * 0.8, v * 0.8, P * 0.8, seed, 3);
        // cobble cells via worley-ish
        const cells = 6;
        const cu = (x / size) * cells, cv = (y / size) * cells;
        let md = 9, md2 = 9;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const ix = Math.floor(cu) + ox, iy = Math.floor(cv) + oy;
          const wx = ((ix % cells) + cells) % cells, wy = ((iy % cells) + cells) % cells;
          const hr = mulberry32(wx * 31 + wy * 131 + seed);
          const px = ix + 0.2 + hr() * 0.6, py = iy + 0.2 + hr() * 0.6;
          const dd = Math.hypot(cu - px, cv - py);
          if (dd < md) { md2 = md; md = dd; } else if (dd < md2) md2 = dd;
        }
        const edge = clamp01((md2 - md) * 5);
        const k = (0.72 + edge * 0.28) * (0.9 + n * 0.15);
        r = gg = b = k;
        break;
      }
      case 'wood': {
        const plank = Math.floor((y / size) * 4);
        const grain = tnoise(u * 0.5 + plank * 3.1, v * 6, P * 0.5, seed);
        const seam = (y % (size / 4)) < 3 ? 0.72 : 1;
        const k = (0.85 + grain * 0.15) * seam * (0.96 + (plank % 2) * 0.04);
        r = k; gg = k * 0.97; b = k * 0.93;
        break;
      }
      case 'cloud': {
        const n = tfbm(u, v, P, seed, 4);
        const k = 0.9 + n * 0.12;
        r = k; gg = k; b = k * 1.03;
        break;
      }
      case 'sand': {
        const n = tfbm(u * 2, v * 2, P * 2, seed, 2);
        const sp = rnd() > 0.93 ? 0.9 : 1;
        const k = (0.9 + n * 0.12) * sp;
        r = k; gg = k * 0.98; b = k * 0.94;
        break;
      }
      case 'snow': {
        const n = tfbm(u, v, P, seed, 3);
        const sp = rnd() > 0.985 ? 1.15 : 1;
        const k = (0.92 + n * 0.08) * sp;
        r = k * 0.97; gg = k; b = k * 1.04;
        break;
      }
      case 'brick': {
        const rows = 8, bh = size / rows, row = Math.floor(y / bh);
        const off = (row % 2) * (size / 8);
        const bx = ((x + off) % (size / 4));
        const mortar = (y % bh) < 3 || bx < 3;
        const n = tnoise(u * 2, v * 2, P * 2, seed);
        const k = mortar ? 0.75 : 0.9 + n * 0.1;
        r = k; gg = k * 0.96; b = k * 0.94;
        break;
      }
      case 'tiles': {
        const s = size / 4;
        const cx = Math.floor(x / s), cy = Math.floor(y / s);
        const k = (cx + cy) % 2 === 0 ? 1 : 0.88;
        const bevel = (x % s) < 2 || (y % s) < 2 ? 0.8 : 1;
        r = gg = b = k * bevel;
        break;
      }
      case 'candy': {
        const st = Math.sin(((x + y) / size) * TAU * 4);
        const k = st > 0 ? 1 : 0.86;
        r = gg = b = k;
        break;
      }
      case 'crystal': {
        const n = tfbm(u, v, P, seed, 3);
        const k = 0.85 + Math.abs(Math.sin(n * 12)) * 0.15;
        r = k * 0.97; gg = k; b = k * 1.03;
        break;
      }
      case 'metal': {
        const n = tnoise(u * 0.5, v * 8, P * 0.5, seed);
        const k = 0.86 + n * 0.12;
        r = gg = b = k;
        break;
      }
      case 'bark': {
        const n = tnoise(u * 3, v * 0.6, P * 3, seed);
        const k = 0.78 + n * 0.22;
        r = k; gg = k * 0.95; b = k * 0.9;
        break;
      }
      default: break;
    }
    put(x, y, [Math.round(clamp01(r) * 255), Math.round(clamp01(gg) * 255), Math.round(clamp01(b) * 255)]);
  }
  g.putImageData(img, 0, 0);
  // decorative overlays
  if (kind === 'grass') {
    // tiny flowers dots
    for (let i = 0; i < 40; i++) {
      const x = rnd() * size, y = rnd() * size;
      g.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.2})`;
      g.beginPath(); g.arc(x, y, 1.5 + rnd() * 1.5, 0, TAU); g.fill();
    }
  }
  return new Texture(c, { wrap: 'repeat', mipmaps: true });
}

// --------------------------------------------------------------------------
// Animal coat patterns (applied on sphere UVs: u around, v top->bottom)
export function makePatternTexture(kind, base = '#ffffff', mark = '#333333', seed = 3) {
  const W = 256, H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(seed);
  g.fillStyle = mark;
  if (kind === 'stripes') {
    for (let i = 0; i < 9; i++) {
      const x = (i / 9) * W + rnd() * 6;
      g.beginPath();
      g.moveTo(x - 5, 0); g.quadraticCurveTo(x + 9, H * 0.25, x - 2, H * 0.5); g.quadraticCurveTo(x + 6, H * 0.65, x, H * 0.72);
      g.lineTo(x + 7, H * 0.72); g.quadraticCurveTo(x + 14, H * 0.5, x + 6, H * 0.3); g.quadraticCurveTo(x + 12, H * 0.12, x + 8, 0);
      g.closePath(); g.fill();
    }
  } else if (kind === 'spots') {
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, y = 8 + rnd() * (H - 16), rx = 8 + rnd() * 14, ry = 6 + rnd() * 10;
      g.beginPath(); g.ellipse(x, y, rx, ry, rnd() * 3, 0, TAU); g.fill();
      if (x < rx * 2) { g.beginPath(); g.ellipse(x + W, y, rx, ry, 0, 0, TAU); g.fill(); }
      if (x > W - rx * 2) { g.beginPath(); g.ellipse(x - W, y, rx, ry, 0, 0, TAU); g.fill(); }
    }
  } else if (kind === 'giraffe') {
    g.fillStyle = mark;
    const cols = 9, rows = 5;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const cx = ((i + (j % 2) * 0.5) / cols) * W, cy = ((j + 0.5) / rows) * H;
      g.beginPath();
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, r = (W / cols) * 0.38 * (0.8 + rnd() * 0.35);
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.85;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
    }
  } else if (kind === 'dots') {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 10; i++) {
      g.beginPath(); g.arc(((i + (j % 2) * 0.5) / 10) * W, ((j + 0.5) / 4) * H, 6, 0, TAU); g.fill();
    }
  } else if (kind === 'belly') {
    // lighter oval on front (u around 0.5 => front at u=0? sphere uv u=0 at +Z)
    g.fillStyle = mark;
    g.beginPath(); g.ellipse(0, H * 0.62, W * 0.16, H * 0.34, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(W, H * 0.62, W * 0.16, H * 0.34, 0, 0, TAU); g.fill();
  }
  return new Texture(c, { wrap: 'repeat', mipmaps: true });
}

// Simple soft cloud sprite texture (for sky billboards)
export function makeCloudTexture(seed = 5) {
  const W = 256, H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  for (let i = 0; i < 16; i++) {
    const x = 50 + rnd() * 156, y = 50 + rnd() * 40 - (Math.abs(x - 128) / 128) * 20, r = 22 + rnd() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return new Texture(c, { wrap: 'clamp', mipmaps: true });
}

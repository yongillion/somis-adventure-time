// ============================================================================
// projmodels.js — small models for player/pet projectiles & weapon visuals
// (enemy projectiles come from enemies.js buildProjectile)
// ============================================================================
import { Node } from '../../engine/scene.js';
import * as G from '../../engine/geometry.js';
import { M, MG, MU, MGlow, add, grp, ell, UNIT, PI } from './common.js';
import { buildProjectile as buildEnemyProjectile, buildBomb } from './enemies.js';

const K = (k, fn) => G.cachedGeo('pj:' + k, fn);

const B = {
  carrot() {
    const n = new Node('carrot');
    add(n, UNIT.cone, MG(0xff8a3a), { p: [0, 0, 0.02], r: [PI / 2, 0, 0], s: [0.09, 0.32, 0.09] });
    for (let i = 0; i < 3; i++) add(n, UNIT.cone, M(0x6fd36a), { p: [0, 0, -0.16], r: [-PI / 2 + (i - 1) * 0.5, 0, 0], s: [0.035, 0.14, 0.035] });
    return n;
  },
  heart() { const n = new Node('heart'); add(n, UNIT.heart, MG(0xff6a9a, { emissive: 0x401020 }), { s: 0.34 }); return n; },
  bone() {
    const n = new Node('bone');
    const m = MG(0xfff8ec);
    add(n, UNIT.capsule, m, { r: [0, 0, PI / 2], s: [0.12, 0.34, 0.12] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ell(n, m, [sx * 0.2, 0, sz * 0.06], 0.07, 0.07, 0.07);
    return n;
  },
  wool() { const n = new Node('wool'); const m = M(0xffffff); ell(n, m, [0, 0, 0], 0.2, 0.18, 0.2); ell(n, m, [0.1, 0.06, 0.05], 0.12, 0.12, 0.12); ell(n, m, [-0.1, 0.04, -0.04], 0.12, 0.12, 0.12); return n; },
  peanut() { const n = new Node('peanut'); const m = M(0xe8b878); ell(n, m, [0, 0, 0.07], 0.08, 0.08, 0.09); ell(n, m, [0, 0, -0.07], 0.085, 0.085, 0.09); return n; },
  ring() { const n = new Node('ring'); add(n, UNIT.torus, MGlow(0x9aeaff, { opacity: 0.85 }), { s: [0.3, 0.3, 0.3] }); add(n, UNIT.torus, MG(0xd8f8ff, { transparent: true, opacity: 0.6 }), { s: [0.24, 0.24, 0.5] }); return n; },
  tornado() {
    const n = new Node('tornado');
    const m = MG(0xe8fff4, { transparent: true, opacity: 0.75 });
    for (let i = 0; i < 4; i++) add(n, UNIT.torus, m, { p: [0, i * 0.16, 0], r: [PI / 2, 0, 0], s: [0.12 + i * 0.07, 0.12 + i * 0.07, 0.4] });
    return n;
  },
  snowball() { const n = new Node('snowball'); ell(n, MG(0xf4fbff), [0, 0, 0], 0.17); return n; },
  mud() { const n = new Node('mud'); ell(n, M(0x9a6a4a), [0, 0, 0], 0.15, 0.13, 0.15); ell(n, M(0xb88a6a), [0.05, 0.06, 0.05], 0.06); return n; },
  seed() { const n = new Node('seed'); ell(n, MG(0x5a4a5a), [0, 0, 0], 0.05, 0.05, 0.09); ell(n, MG(0xf0e8d8), [0, 0.02, 0.01], 0.025, 0.03, 0.06); return n; },
  acorn() {
    const n = new Node('acorn');
    ell(n, MG(0xc8884a), [0, -0.03, 0], 0.13, 0.15, 0.13);
    add(n, UNIT.hemi, M(0x8a5a3a), { p: [0, 0.04, 0], s: [0.15, 0.1, 0.15] });
    add(n, UNIT.cylinder, M(0x6a4a2a), { p: [0, 0.15, 0], s: [0.02, 0.06, 0.02] });
    return n;
  },
  banana() {
    const n = new Node('banana');
    add(n, K('banana', () => G.torusGeo(0.18, 0.055, 8, 14, PI * 0.8)), MG(0xffe04a), { r: [PI / 2, 0, 0] });
    return n;
  },
  leaf() {
    const n = new Node('leaf');
    add(n, K('leafShape', () => G.puffyShapeGeo([[0, 0.25], [0.12, 0.1], [0.12, -0.08], [0, -0.25], [-0.12, -0.08], [-0.12, 0.1]], 0.03, 2)), M(0x7ad86a, { side: 'double' }), { r: [PI / 2, 0, 0], s: 1.2 });
    return n;
  },
  shell() { const n = new Node('shell'); add(n, UNIT.hemi, MG(0x8ad06a), { s: [0.24, 0.16, 0.24] }); add(n, UNIT.cylinder, M(0xf0e0a0), { p: [0, -0.01, 0], s: [0.25, 0.03, 0.25] }); return n; },
  clam() {
    const n = new Node('clam');
    add(n, K('clamShape', () => G.puffyShapeGeo(G.flowerOutline(7, 0.2, 0.17, 42), 0.05, 2)), MG(0xffd8e8), { r: [PI / 2, 0, 0] });
    return n;
  },
  quill() { const n = new Node('quill'); add(n, UNIT.cone, M(0xa87a5a), { r: [PI / 2, 0, 0], s: [0.04, 0.3, 0.04] }); return n; },
  yuzu() { const n = new Node('yuzu'); ell(n, MG(0xffc23a), [0, 0, 0], 0.15); add(n, UNIT.cone, M(0x5ac85a), { p: [0, 0.15, 0], s: [0.05, 0.08, 0.02] }); return n; },
  feather() { const n = new Node('feather'); ell(n, MG(0x6ae88a), [0, 0, 0], 0.04, 0.03, 0.16); return n; },
  puff() { const n = new Node('puff'); const m = MU(0xffffff, { transparent: true, opacity: 0.8 }); ell(n, m, [0, 0, 0], 0.22); ell(n, m, [0.12, 0.05, -0.05], 0.14); ell(n, m, [-0.1, -0.04, -0.06], 0.14); return n; },
  star() { const n = new Node('star'); add(n, UNIT.star, MG(0xffe04a, { emissive: 0x403000 }), { s: 0.6 }); return n; },
  foxfire() { const n = new Node('foxfire'); ell(n, MGlow(0x6ab8ff, { opacity: 0.9 }), [0, 0, 0], 0.22); ell(n, MU(0xd8f0ff), [0, 0, 0], 0.1); return n; },
  bubbleShield() { const n = new Node('bubbleShield'); ell(n, MG(0xbfefff, { transparent: true, opacity: 0.35, spec: 0.8, rim: 1.0, depthWrite: false }), [0, 0, 0], 0.85); return n; },
};

export function buildProjModel(kind) {
  if (kind.startsWith('e:')) return buildEnemyProjectile(kind.slice(2));
  if (B[kind]) return B[kind]();
  if (kind === 'bomb') return buildBomb();
  return buildEnemyProjectile(kind);
}

// ============================================================================
// bake.js — draw-call reduction: sibling leaf meshes that share a material are
// merged into one mesh. The originals stay in the tree (so game code can keep
// animating them) and are skipped while the bake is valid. Every frame the
// renderer checks the sources; the first time any of them is changed by game
// code (transform, visibility, material, geometry contents, parent, per-mesh
// opacity/flash differing) the bake is dropped for good and the originals draw
// again — so baking never changes what you see, only how many draw calls it takes.
// ============================================================================
import { Mesh } from './scene.js';
import * as G from './geometry.js';

const geoVersion = (g) => { let v = (g.version || 0) * 1000 + (g.drawCount === undefined ? 0 : 1e7 + g.drawCount); for (const k in g.attributes) v += g.attributes[k].version || 0; return v; };
const isDynamicGeo = (g) => { for (const k in g.attributes) if (g.attributes[k].dynamic) return true; return false; };

function canBake(c) {
  if (!c.isMesh || c.isInstanced || c.isBaked || c._bakedInto || c.noBake) return false;
  if (!c.visible || c.children.length) return false;
  if (c.matrixAutoUpdate === false) return false; // already a static batch (chunked for culling)
  if (c.quaternion || c.renderOrder || c.flash || c.frustumCulled === false) return false;
  if (c.opacity !== undefined && c.opacity < 1) return false;
  const m = c.material, g = c.geometry;
  if (!m || !g || !g.attributes || !g.attributes.position) return false;
  if (m.transparent || (m.shader && m.shader !== 'toon')) return false; // keep sorting/custom shaders untouched
  if (g.drawMode !== undefined && g.drawMode !== 4) return false; // TRIANGLES only
  if (g.drawCount !== undefined && g.drawCount >= 0) return false;
  if (isDynamicGeo(g)) return false;
  return true;
}

function flipWinding(geo) {
  const g = geo.clone();
  if (g.index) {
    const ix = g.index;
    for (let i = 0; i + 2 < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  return g;
}

// merge baked buckets inside `root` (call once the subtree is built). Returns number of draw calls saved.
export function bakeTree(root, { minGroup = 2 } = {}) {
  let saved = 0;
  const groups = [];
  root.traverse((n) => { if (!n.isMesh && n.children.length >= minGroup && !n.noBake) groups.push(n); });
  for (const g of groups) {
    const buckets = new Map();
    for (const c of g.children) {
      if (!canBake(c)) continue;
      const op = c.userData && c.userData.op !== undefined ? c.userData.op : 1;
      // spatial cell so scattered props are not fused into one level-wide mesh (keeps frustum culling useful)
      const cell = Math.round(c.position.x / 16) + ',' + Math.round(c.position.y / 16) + ',' + Math.round(c.position.z / 16);
      const key = c.material.id + ':' + op + ':' + (c.material.map ? 1 : 0) + ':' + cell;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < minGroup) continue;
      const mat = list[0].material;
      const items = [];
      let verts = 0;
      for (const c of list) {
        c.updateMatrix();
        const m = new Float32Array(c.matrix);
        const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
        items.push({ geo: det < 0 ? flipWinding(c.geometry) : c.geometry, matrix: m });
        verts += c.geometry.vertexCount;
      }
      if (verts > 60000) continue;
      const geo = G.mergeGeometries(items, { withUV: !!mat.map });
      const M = new Mesh(geo, mat, 'baked');
      M.isBaked = true;
      M.userData.op = list[0].userData ? list[0].userData.op : undefined;
      M.bakeSrc = list;
      M.bakeSnap = list.map((c) => ({
        px: c.position.x, py: c.position.y, pz: c.position.z,
        rx: c.rotation.x, ry: c.rotation.y, rz: c.rotation.z,
        sx: c.scale.x, sy: c.scale.y, sz: c.scale.z,
        geo: c.geometry, ver: geoVersion(c.geometry),
      }));
      // insert before the first source so the renderer validates the bake before reaching the sources
      const idx = g.children.indexOf(list[0]);
      g.children.splice(idx, 0, M);
      M.parent = g;
      for (const c of list) c._bakedInto = M;
      saved += list.length - 1;
    }
  }
  return saved;
}

export function unbake(M) {
  M.isBaked = false;
  M.visible = false;
  for (const c of M.bakeSrc) if (c._bakedInto === M) c._bakedInto = null;
}

// still valid? also mirrors uniform per-mesh opacity/flash onto the merged mesh
export function bakeValid(M) {
  const src = M.bakeSrc, snap = M.bakeSnap, mat = M.material, parent = M.parent;
  const s0 = src[0];
  const op = s0.opacity, fl = s0.flash;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], s = snap[i];
    if (c.parent !== parent || !c.visible || c.material !== mat || c.geometry !== s.geo || c.quaternion || c.renderOrder) return false;
    const p = c.position, r = c.rotation, sc = c.scale;
    if (p.x !== s.px || p.y !== s.py || p.z !== s.pz || r.x !== s.rx || r.y !== s.ry || r.z !== s.rz || sc.x !== s.sx || sc.y !== s.sy || sc.z !== s.sz) return false;
    if (c.opacity !== op || c.flash !== fl) return false;
    if (c.children.length) return false;
    if (geoVersion(c.geometry) !== s.ver) return false;
  }
  M.opacity = op; M.flash = fl;
  return true;
}

# Somi Adventure — Engine API (custom WebGL2, no external libs)

All code is ES modules. Coordinates: 1 unit = 1 meter, Y up. Models face **+Z**.
Euler rotation order is **YXZ** (yaw, then pitch, then roll). Colors are hex numbers (`0xff88aa`) or `[r,g,b]` floats 0..1.

## js/engine/math.js
- `Vec3` (x,y,z): `set, copy, clone, add, sub, addScaled(v,s), scale, lerp(v,t), length, lengthXZ, normalize, dot, cross, distanceTo, distXZ, applyMat4, applyQuat, rotateY(a)` (chainable).
- `Quat`, `Mat4` (Float32Array(16) column-major): `create, identity, multiply(o,a,b), composeEuler(o,px,py,pz,rx,ry,rz,sx,sy,sz), invert, perspective, lookAt`.
- `clamp, lerp, smoothstep, damp(a,b,lambda,dt), angleDiff, dampAngle, moveToward, Ease.{outBack,outCubic,inOutSine,outElastic,outBounce,...}`
- `RNG(seed)` (`next, range, int, pick`), `rand(a,b)`, `valueNoise2/3`, `fbm2/3`, `rgb(hex)->[r,g,b]`, `hsl(h,s,l)`, `mixColor`, `TAU, PI, DEG`.

## js/engine/scene.js
- `Node(name)`: `position: Vec3`, `rotation: Vec3` (Euler YXZ, radians), `scale: Vec3`, `visible`, `children`, `add(...)`, `remove`, `removeFromParent`, `traverse(fn)`, `getByName`, `userData`, `worldMatrix`, `getWorldPosition(out)`, `updateWorldFromRoot()`.
- `Mesh(geometry, material, name)` extends Node. Per-mesh: `.flash` (0..1 white flash), `.opacity` (0..1, auto-switches to transparent pass), `.renderOrder`, `.frustumCulled`.
- `InstancedMesh(geometry, material, maxCount)`: `setTransformAt(i, px,py,pz, rx,ry,rz, sx,sy,sz)`, `setColorAt(i,r,g,b,a)`, `.count`.
- `Camera(fovDeg, near, far)`: `position`, `target` (lookAt point), `project(vec3)` -> `{x,y (0..1 screen), visible}`.
- `Scene`: root node; `scene.sky = { uniforms: {...} }` draws the sky.

## js/engine/geometry.js
Builders (all return `Geometry` with position/normal/uv, indexed):
`boxGeo(w,h,d)`, `roundedBoxGeo(w,h,d,r,seg)`, `sphereGeo(r,ws,hs, phiStart,phiLen,thetaStart,thetaLen)`, `cylinderGeo(rTop,rBot,h,radial,hSeg,capped)`, `coneGeo(r,h,radial)`, `capsuleGeo(r,len)` (vertical, total h = len+2r), `latheGeo([[r,y],...] bottom->top, seg)`, `torusGeo(R,r,rs,ts,arc)` (in XY plane; arc from +X CCW), `planeGeo(w,d,sw,sd)` (XZ, faces +Y), `circleGeo(r,seg)` (XZ), `ringGeo(rIn,rOut,seg)`, `puffyShapeGeo(outline2D, depth, rings)` (inflated pillow, faces +Z), `extrudeGeo(outline2D, depth)`, outlines: `starOutline(points,rOut,rIn)`, `heartOutline(size)`, `flowerOutline(petals,rOut,rIn)`, `circleOutline(r)`; `crystalGeo(r,hTop,hBot,sides)` (flat-shaded gem), `icoGeo(r,detail)`, `rockGeo(r,seed,rough,detail)` (flat-shaded).
Utilities: `geo.translate/scale/rotate(rx,ry,rz)/applyMatrix(m)/clone()/toFlat()/displace(fn(v))/setColor([r,g,b])/colorBy(fn)`, `mergeGeometries([{geo, matrix, color}])` -> single geometry with vertex colors, `trs(px,py,pz, rx,ry,rz, sx,sy,sz)` -> Mat4, `cachedGeo(key, fn)`.
`UNIT.sphere()` (r=1), `UNIT.sphereHi()`, `UNIT.sphereLo()`, `UNIT.hemi()`, `UNIT.cylinder()` (r=1,h=1), `UNIT.cone()` (r=1,h=1, base at y=-0.5, tip at +0.5), `UNIT.capsule()` (r=0.5, len=1), `UNIT.box()`, `UNIT.rbox()`, `UNIT.torus()` (R=1,r=0.25), `UNIT.star()` (puffy star ~1 wide), `UNIT.heart()`, `UNIT.disc()`.
**Always reuse UNIT/cached geometry and scale the mesh** instead of creating new geometry per instance.

## js/engine/material.js
`new Material({ color, emissive, opacity, transparent, blending:'normal'|'additive', depthWrite, side:'front'|'double', map: Texture, mapRepeat:[u,v], vertexColors, rim (0..1 fresnel rim), spec (0..1 toon highlight), unlit, satField, fog, wind, alphaTest, renderOrder })`.
`mat(color, opts)` returns a **cached shared** material (same args -> same object). Use shared materials whenever possible.

## js/game/models/common.js (model helpers — use these!)
- Materials: `M(color, opts)` soft-gloss toon (default for characters), `MG(color)` glossy, `MU(color)` unlit, `MGlow(color)` additive glow.
- `add(parent, geoOrFn, material, {p:[x,y,z], r:[x,y,z], s:num|[x,y,z], name})` -> Mesh.
- `grp(parent, name, p, r)` -> Node (pivot/group).
- `ell(parent, material, [x,y,z], rx, ry, rz, rot, name)` -> ellipsoid Mesh (scaled unit sphere).
- `onSphere(R, yawDeg, pitchDeg)` -> [x,y,z] on a sphere surface (yaw 0 = front +Z, + toward +X). `faceRot(yawDeg, pitchDeg)` -> rotation making local +Z point outward there.
- Face: `makeEyes(head, {headR,yaw,pitch,size,color,glint})` -> `{set(expr), blink(v)}` expressions: normal|happy|hurt|sleep|angry|sad|surprised. `makeCheeks(head, {...})`, `makeMouth(head, {...})` -> `{set('smile'|'open'|'o'|'flat'|'w'|'frown')}`, `makeRibbon(parent,{p,r,s})` (Somi's pink star bow).
- `setFlash(root,v)`, `setOpacity(root,v)`, `Spring(stiff,damp)` (`update(target,dt)`, `kick(v)`), `approach(cur,target,rate,dt)`, `chain(parent, mat, segs, segLen, r0, r1, bend)`.

## js/game/models/rig.js
`CharacterRig(spec)` — shared chibi skeleton + procedural animation. See header comment in the file for the node hierarchy and `update(dt, state)` states:
`idle, walk, run, jump, fall, hover, land, attack (attackKind: punch|swipe|throw|smash|spin|breath|cast|kick|bite|headbutt), airAttack, pound, special (specialKind: roar|dash|smile|sniff|dig|charge|spray|cast|sleep|curl|pose|stretch|tongue), hurt, swim, dive, climb, glide, fly, roll, ball, slide, celebrate, wave, sit, sleep, talk, sad, surprised, dead`.
Rig fields: `root, base, hips, neck, head, armL, armR, handL, handR, legL, legR, tail, earL, earR, mouthNode, eyes, mouth, cheeks, mats{body,head,plain,belly,limb,foot,accent,dark,nose,white}, P (proportions), height, radius`.
`registerPart(kind, type, fn(rig, opts, spec))` kinds: `ears | snout | tail | extra | body | arms | legs`. Spec `onUpdate(rig, dt, state)` hook for custom animation of extra parts.

## Testing
- Local server: `python3 -m http.server 8765` from project root.
- Screenshot: `node tools/shot.mjs "<url>" out.png [waitMs] [w] [h] [evalJs]` (prints console errors).
- Model viewer: `tools/viewer.html?mod=animals&fn=buildAnimal&ids=cat,dog&anim=walk&cols=5&sp=1.6&h=0.8&yaw=0.35&dist=6`
  (`mod` = module file under js/game/models, `fn` = exported builder; result may be a rig with `.root`+`.update` or a Node).

# SPEC — Props, interactive objects, collectibles, platforms

Game: "소미의 어드벤처 타임" — Kirby Forgotten Land-style 3D platformer for a young girl, 8 dreamy themed stages on floating
islands. Look: bright pastel, soft rounded shapes, toy-like, glossy toon. Read `docs/ENGINE.md`, `js/game/models/common.js`.
Do NOT edit engine/common/rig files. Origin conventions are important: the level builder places things by them.

## Deliverable A: `js/game/models/props.js` — static decoration (mergeable)
```
export function propParts(type, opts={}) -> [{ geo, matrix (Float32Array16 or null), color:[r,g,b], kind:'solid'|'glow' }]
export function buildProp(type, opts={}) -> Node   // convenience: merges solid parts into one vertex-colored Mesh
                                                     // (Material {vertexColors:true}) + glow parts as MGlow/unlit meshes
export const PROP_TYPES  // { theme: [type,...] }
export function grassGeo(variant) / flowerGeo(variant) -> Geometry (with vertex colors, origin at base) for InstancedMesh
```
Origin: base center on the ground (y=0 = ground contact), +Y up. `opts`: `s` (uniform scale), `seed` (variation: slight
size/rotation/color jitter — deterministic), `color` (main color override where sensible). Geometry must be cached per
(type, seed%4) to keep memory low. Keep triangle counts modest (trees ≤ 1500 tris, small props ≤ 400).
Types (approx size in meters):
- generic: `rock`(1), `rockCluster`(1.5), `crystalCluster`(1.2, color, glow tips), `cloudPuff`(2, decor), `bush`(1),
  `mushroomDeco`(0.6, red cap white dots), `fence`(2 long, 0.8 tall), `signPost`(1.2), `stoneArch`(3 wide, 3 tall)
- meadow: `lollipopTree`(3–4 tall, round pastel canopy, opts.color), `daisy`(0.5), `tulip`(0.5), `flowerBush`(0.9), `bigFlower`(1.5)
- canyon: `mesaPillar`(4 tall layered orange/peach rock), `cactusRound`(1.2), `orangeTree`(3, with oranges), `pumpkinDeco`(0.7),
  `hayBale`(1), `barrel`(1), `crateDeco`(1)
- honey: `sunflower`(2.5 tall), `beehive`(1.2), `honeyPot`(0.6), `clover`(0.4), `flowerArch`(3 wide)
- jungle: `palmTree`(4), `jungleTree`(5, with hanging vines), `giantLeaf`(1.5), `fern`(1), `glowMushroom`(0.8, glow cap),
  `log`(2 long), `stump`(0.8), `bigBloom`(1.2 big friendly flower)
- sea: `coral`(1, branching, opts.color), `seaweed`(1.5), `shell`(0.5), `starfish`(0.4), `sandcastle`(1.2), `beachUmbrella`(2.2),
  `lifebuoy`(0.8), `barnacleRock`(1.2)
- snow: `snowPine`(3.5), `snowman`(1.6), `iceCrystal`(1.4 glow-ish), `igloo`(2.5), `snowRock`(1), `frozenFlower`(0.6), `candyCane`(1.5)
- toy: `toyBlock`(1, letter-ish colored faces), `crayon`(2 tall), `giftBox`(1), `toyBall`(0.8), `topDeco`(1), `gearDeco`(1.5), `pencil`(2.5)
- moon: `moonFlower`(0.8, glow center), `crystalTree`(3, glow), `starLamp`(2.2, glow star on post), `archway`(3), `whiteRose`(0.7),
  `cloudPillar`(4), `floatLantern`(0.6, glow)

## Deliverable B: `js/game/models/objects.js` — interactive / animated objects
`export function buildObject(type, opts={}) -> { root, update(dt), ...methods }` (all have `root` Node and `update(dt)`).
| type | size / origin | methods |
|---|---|---|
| lantern | checkpoint "꿈 등불", 1.6 tall, base | `setLit(bool)` animated 0.6s: gray stone + dim crystal -> warm glowing star crystal (opts.color) |
| cage | fog bubble cage for a 0.55-tall Puffy, 1.4 tall, base | `hit()` wobble+crack, `break()` shatter anim then hidden, `.broken` |
| floorSwitch | 1.2 Ø pad, 0.25 tall, base | `setPressed(bool)` |
| crystalSwitch | orb on pedestal 1.2 tall, base | `setOn(bool)` (blue/pink) + `hit()` pop |
| gate | opts {w=3,h=2.5}, base center, bars span X | `setOpen(t 0..1)` bars sink into ground |
| lockDoor | opts {w=2.4,h=3}, base | `setOpen(t)` |
| key | 0.6 long golden star key, center | spins/bobs in update |
| springPad | 1.2 Ø, 0.5 tall, base; opts.style 'mushroom'|'flower' | `bounce()` squash anim |
| starCannon | 1.6 tall, base | `aim(yaw,pitch)`, `fire()` recoil |
| saw | radius opts.r=0.8, center, blade in XY plane facing +Z | spins in update (cute candy gear but clearly sharp) |
| spikeTrap | 1x1 tile, base | `setRaised(t)` |
| spikeStrip | opts {w,d}, base | static crystal spikes |
| crusher | 2x2x2 stone block, center, angry face on +Z | `setFace('sleep'|'angry')` |
| firebar | pivot center; opts {n=6, spacing=0.5} balls along +X | flicker in update (gameplay rotates root) |
| laserEmitter | crystal emitter ~0.6, center, beam along +Z | `setBeam(on, length)` glowing beam with flicker |
| windFan | 1.6 wide pinwheel facing +Z, base | `update(dt, speed)` |
| crate | 1x1x1 pushable wooden crate with star, origin bottom center | |
| breakRock | 1.5 cube cracked rock, bottom center | `break()` pieces fly, then hidden |
| breakCrate | 1x1x1, bottom center | `break()` |
| thornVine | opts {w=2,h=2.5}, base | `burn()` shrivel/fade then hidden |
| iceBlock | opts {s=1.2} cube, bottom center | `melt()` |
| torch | 1.4 tall, base | `setLit(bool)` flame glow flicker |
| seedSprout | base; opts {h=2.5, r=1.2} | `setGrowth(t 0..1)`: sprout -> giant flower whose flat top platform is at height h |
| pinwheel | 1.2 tall, base | `update(dt, speed)` |
| drum | 0.8 Ø, base; opts.color 0..3 (red, blue, yellow, green) | `hit()` bounce + light up |
| target | 1.5 tall bullseye on post, base | `hit()`, `setDone()` |
| mailbox | 1.2 tall, base | `open()` |
| nest | 0.8 Ø, base | |
| bell | hanging golden bell 0.8 with frame 2 tall, base | `ring()` |
| signBoard | 1.3 tall, base; opts.icon 'arrow'|'star'|'paw'|'!'|'?' | |
| dreamLight | goal orb "꿈빛" in floating crystal cradle, 1.8 tall, base; opts.color | pulses in update |
| starCandy | 별사탕 collectible ~0.35, center; opts.color | spins in update |
| bigCandy | 0.7, center | spins |
| heartItem | 0.5, center | bobs |
| cookieBase | golden cookie disc 0.6 Ø x 0.15, center (an animal head is attached on top by gameplay) | sparkles |
Also export `starCandyGeo()` -> single Geometry with vertex colors (for InstancedMesh; origin center, ~0.35).

## Deliverable C: `js/game/models/platforms.js`
`export function buildPlatform(style, w, d, h=0.6, opts={}) -> Node` — **origin at TOP center** (top surface y=0, extends down
to -h), footprint w (X) by d (Z). Styles: `cloud, leaf, wood, ice, gear (round, uses w as diameter), biscuit (cracked cracker for
falling platforms), bubble (translucent pink for disappearing blocks), stone, candy (striped), crystal, lily (round lily pad),
mushroom (round cap), moon (pale glowing stone)`. Should look good at sizes 1.5–6 m. `opts.round` -> cylindrical footprint.
Also: `buildRainbowSegment(len)` (unicorn's rainbow bridge piece, 1.4 wide, flat top at y=0, 6 pastel color bands along length)
and `buildCloudPad()` (sheep's summoned cloud pad, 1.6 Ø, top y=0).

## Verify
Server: `cd /home/claude/somi-adventure && python3 -m http.server 8765 --bind 127.0.0.1 &` (if not running).
Use `tools/viewer.html?mod=props&fn=buildProp&ids=lollipopTree,daisy,...&sp=3&dist=14&h=1.5`. For objects/platforms, write a small
viewer variant under `tools/` (e.g. tools/viewer-objects.html) that calls methods (setLit(true), setOpen(0.5)...) to check states.
Read every PNG; iterate until polished, cohesive, cute, and correctly scaled relative to a 1.2m tall character (show
`mod=animals&ids=cat` beside them at least once). Zero console errors.
Save final shots to `/tmp/claude-0/-home-claude/87897895-3900-5863-965a-62dff1744667/scratchpad/models/` and list them.

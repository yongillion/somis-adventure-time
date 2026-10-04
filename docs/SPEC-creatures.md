# SPEC — Pets (15), Enemies (~16), NPCs (Puffy, Star Whale, Noa)

Game: "소미의 어드벤처 타임" — 3D platformer for a young girl. Art: Kirby and the Forgotten Land — bright, round, glossy,
toy-like, big tall-oval eyes with glint, blush. Story: a sad "Gray Fog" has drained the colors of Dreamland. Enemies are
cute creatures **infected by the fog**: gray-lavender, grumpy (angry eyes), wispy fog swirl on top. When defeated they pop
into color (gameplay handles particles). They must look cute, never scary.

Read first: `docs/ENGINE.md`, `js/game/models/common.js` (materials, add/grp/ell, makeEyes/makeMouth/makeCheeks, Spring),
and `js/game/models/rig.js` to see the established style (the animal rig). Do NOT edit engine/common/rig files.

## Deliverables
### 1) `js/game/models/pets.js`
`export function buildPet(id)` -> `{ root, update(dt, st), setFlash(v), setOpacity(v), size, glow: [r,g,b] }`
`st = { anim: 'fly'|'idle'|'happy'|'ability'|'sleep'|'sad', t, speed }`. Origin = body center. Size ~0.28–0.4 across.
Wings flap procedurally (fast for bee/hummingbird/dragonfly, slow for butterfly/owl). 'happy' = loop/flip + happy eyes,
'ability' = glow pulse (emissive) + wings wide, 'sleep' = eyes closed (used in the pet box UI).
| id | name | look |
|---|---|---|
| bee | 붕붕이 | round yellow body, black stripes, small translucent wings, antennae, tiny stinger |
| butterfly | 나풀이 | small body, two pairs of big pink→lavender wings with dots, curly antennae |
| sparrow | 짹짹이 | round brown bird, white cheeks, tiny beak, chubby |
| seagull | 끼룩이 | white round bird, gray wings, yellow beak with red dot |
| parrot | 따라쟁이 | green body, red/yellow/blue wings, curved orange beak, head crest |
| owl | 부엉박사 | brown round owl, huge round eyes with little round glasses, ear tufts, cream belly |
| ladybug | 점박이 | red dome shell w/ black dots (split when flying), black head, small wings |
| dragonfly | 쌩쌩이 | slender cyan body, big round eyes, 4 long translucent wings |
| firefly | 반짝이 | small dark-brown body, glowing yellow-green abdomen (emissive + MGlow halo), wings |
| hummingbird | 윙윙이 | tiny teal/magenta iridescent bird, long thin beak, blurry fast wings |
| dove | 구구 | white dove, little olive leaf in beak |
| woodpecker | 콕콕이 | red crest, black/white body, sturdy beak |
| canary | 랄라 | bright yellow round bird, orange beak, singing mouth |
| eagle | 용감이 | brown baby eagle, fluffy white head, yellow beak, brave eyes |
| phoenix | 피닉스 | red-orange-gold, flame tail feathers (emissive + glow), small crown crest; legendary sparkle |
Pets can't use the ribbon. Eyes: makeEyes scaled (size ~0.45–0.6, headR small).

### 2) `js/game/models/enemies.js`
`export function buildEnemy(type, variant)` -> `{ root, update(dt, st), setFlash(v), setOpacity(v), height, radius, centerY, muzzle? (Node: projectile origin) }`
Origin at feet (flyers: body center, with `flying:true`). `st = { anim, t, speed }` with anims:
`idle, walk, run, windup (telegraph: shake + glow/red tint flash), attack, hurt, stun (dizzy: 3 little stars orbit head),
sleep (eyes closed + bob), friendly (happy eyes, dancing — charmed), die (squash flat then puff), fly`.
Fog look: body colors from lavender-gray palette (e.g. 0x9b93b8, 0x7d7499, 0xb9b3cf), a little dark swirl puff on top,
pale glowing eyes are OK but keep them cute (makeEyes with 'angry' expression). Each type should have one readable signature.
| type | name | description | size |
|---|---|---|---|
| gloomy | 뭉게먹구름 | basic: fluffy cloud-blob (cluster of spheres), tiny feet, walks | ~0.9 tall |
| hopper | 통통먹구름 | jelly-like blob that hops (strong squash & stretch) | 0.8 |
| flyer | 훨훨먹구름 | small cloud with little bat-like wings (flying:true) | 0.7 |
| shooter | 뿅뿅달팽이 | snail; shell is a little cannon; `muzzle` node | 0.9 |
| spiky | 가시먹구름 | blob covered in soft spikes (can't stomp) | 0.9 |
| shield | 방패먹구름 | blob holding a round wooden shield in front | 1.0 |
| roller | 데굴먹구름 | round ball-body with face; in 'run' the body spins/rolls | 0.9 |
| bomber | 펑펑먹구름 | blob with tiny helmet, holds a round cloud-bomb; also export `buildBomb()` | 0.9 |
| ghost | 스르륵 | translucent wavy-bottom ghost cloud (flying:true), floaty | 1.0 |
| big | 왕먹구름 | big tough gloomy with a tuft crown (3 HP) | 1.8 |
| charger | 뿔먹구름 | blob with two small horns; 'windup' paws ground, 'run' charges | 1.0 |
| jelly | 해파리 | pastel-gray jellyfish, dangling tentacles, pulsing (flying:true) | 0.9 |
| mushroom | 꼬마버섯 | small grumpy mushroom minion (boss 1 summons) | 0.6 |
| pumpkinling | 꼬마호박 | small pumpkin with leaf, angry carved face | 0.6 |
| snowball | 눈뭉치 | snowball with face, rolls ('run' = roll) | 0.7 |
| toysoldier | 태엽병정 | wind-up toy soldier (key turning on back), cork gun (`muzzle`) | 1.0 |
`variant` (optional, adds a small themed accessory): `meadow` (flower), `canyon` (cowboy-ish leaf hat), `honey` (honey drip
hat), `jungle` (leaf crown), `sea` (shell), `snow` (knit beanie), `toy` (propeller cap), `moon` (tiny star). Unknown -> none.
Also export `buildProjectile(kind)` -> Node for enemy shots: `fogball` (gray glowing ball), `seed`, `cork`, `snowball`, `ink`, `spore`.

### 3) `js/game/models/npcs.js`
- `buildPuffy(colorIndex)` -> rig `{root, update(dt,{anim,t}), setFlash, setOpacity}`. 뭉실이: Dreamland residents. Small fluffy
  cloud creature (~0.55 tall), pastel color by index (0 white-pink, 1 mint, 2 butter yellow, 3 sky blue, 4 lavender, 5 peach),
  tiny feet, little star on an antenna. anims: idle, happy (bounce), talk, sad (in cage, droopy), wave, cheer (jumping, arms up).
- `buildWhale()` -> rig. 별고래 Star Whale: huge gentle whale (~9 long), deep blue→violet body, glowing pale belly, many small
  emissive star spots on its back (use MU/MGlow), big kind eyes, side fins, tail fluke. anims: swim (body undulation, tail
  beats), idle, sleep (eyes closed), happy. `setFogged(v)` 0..1 lerps to gray/dim (whale is swallowed by fog in the story).
- `buildNoa()` -> rig. 노아: the lost little star (~0.7). Puffy 5-point star body (yellow, `UNIT.star` or puffyShape) with a face,
  tiny arms/legs. anims: idle (float), cry (sad eyes, shaking), happy, hug (arms open), sleep. `setGray(v)` 0..1 -> gray & dim
  (lonely state) vs bright glowing (emissive + MGlow halo).

## Rules / Verify
- Reuse shared materials and UNIT geometries. ≤ 30 meshes per enemy, ≤ 25 per pet. Whale may use more (≤ 120).
- Screenshot every model with `tools/viewer.html?mod=pets&fn=buildPet&ids=...` (and enemies/npcs) in several anims,
  Read the PNGs, iterate until they look cute and consistent with the animal style (compare with `?mod=animals&ids=cat,rabbit`).
  Use `h=0.3&dist=2.5` style params to frame small models.
- Zero console errors. Save final review shots to
  `/tmp/claude-0/-home-claude/87897895-3900-5863-965a-62dff1744667/scratchpad/models/` and list them in your final message.

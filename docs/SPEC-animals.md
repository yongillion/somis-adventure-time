# SPEC — 30 animal forms + Somi (girl) models

Game: "소미의 어드벤처 타임" — 3D platformer for a young girl (early elementary). Art direction: **Kirby and the Forgotten Land** —
bright, soft, glossy toy-like chibi, round shapes, big tall-oval eyes with blue glint, pink blush, tiny mouth. Every animal form
is the heroine Somi transformed, so **every animal wears Somi's pink star ribbon** (`makeRibbon`, already handled by the rig via
`spec.ribbon`), placed where it looks cute and is clearly visible from behind/above (gameplay camera is behind & above).

Read first: `docs/ENGINE.md`, `js/game/models/common.js`, `js/game/models/rig.js` (the CharacterRig), `js/game/models/animals.js`
(cat, rabbit, dog already done as examples — refine them too if you can improve them).

## Deliverables (only edit/create these files)
1. `js/game/models/animals.js` — `ANIMAL_SPECS` with all 30 ids, `buildAnimal(id)`, `buildAnimalHead(id)` (keep exports).
   Put new part types in `js/game/models/animalParts.js` (import it from animals.js for side-effect registration) using
   `registerPart(kind, type, fn)`.
2. `js/game/models/somi.js` — `buildSomiGirl(opts)` returning a `CharacterRig` (human chibi spec: no animal ears/tail).
3. Do NOT edit `js/engine/*`, `common.js`, `rig.js`. If the rig truly needs a change, describe it in your final message instead
   (you may monkey-patch via spec.onUpdate hooks).

## The 30 ids (fixed — gameplay code depends on them)
| id | Korean | Look (pastel, kid-friendly) | Required named nodes (set on rig) |
|---|---|---|---|
| cat | 고양이 | (done) cream-white, pink ear inner, whiskers, curly tail w/ pink tip | |
| rabbit | 토끼 | white, long ears pink inner, pom tail, tiny buck teeth under nose | |
| dog | 강아지 | golden puppy, floppy darker ears, white muzzle, little red collar + gold tag, wagging tail | |
| sheep | 양 | fluffy WOOL body = cluster of 8-12 white spheres (cloud-like), wool tuft on head, peach face, small curly beige horns (torus spirals), dark-brown hooves | |
| cow | 소 | white with black spots (pattern 'spots'), big pink muzzle with nostrils, small cream horns, side ears, gold cowbell on collar, tail with tuft | |
| kangaroo | 캥거루 | tan/orange-brown, tall ears, long big feet, thick long tail, belly pouch with a tiny baby joey peeking out, RED boxing gloves on hands | `rig.joey` |
| koala | 코알라 | soft gray, BIG round fluffy ears with white fluff, big dark oval nose, white chin/belly | |
| quokka | 쿼카 | warm tan-brown, small round ears, extra happy smile (default mouth 'open'/smile), round cheeks | |
| bear | 곰돌이 | teddy-bear brown, round ears, light tan muzzle, heart-shaped belly patch | |
| elephant | 코끼리 | pastel blue-lavender gray, big flat side ears w/ pink inner, curling trunk (segmented chain that sways), tiny white tusks optional | `rig.trunkTip` (Node at trunk end, for water spray origin) |
| shark | 상어 | blue top/white belly, dorsal fin on top, fin-shaped arms, tail fin at back, friendly toothy grin (small white triangles) | `rig.fin` |
| dolphin | 돌고래 | aqua/light blue, white belly, rounded beak snout, dorsal fin, flipper arms, tail fluke | |
| dragon | 드래곤 | pastel mint-green, yellow belly, cream horns, small wings with pink membrane, back spikes, tail with spade tip | `rig.wingL`, `rig.wingR` (flap in fly/hover/glide/jump) |
| tiger | 호랑이 | orange with black stripes (pattern 'stripes'), white muzzle/belly, round ears w/ white center, striped tail | |
| panda | 판다 | white, black ears/limbs, black eye patches (tilted ovals behind the eyes), black shoulder band | |
| fox | 여우 | orange, white muzzle/chest, big pointed ears with dark tips, BIG fluffy tail with white tip | |
| penguin | 펭귄 | navy body, white face (heart-shaped) + belly, small orange beak, orange feet, flipper arms, no ears | |
| pig | 돼지 | pink, flat snout disc with two nostrils, triangular floppy ears, curly tail | |
| hamster | 햄스터 | golden-orange + white, very chubby cheeks, tiny round ears, tiny tail | |
| squirrel | 다람쥐 | red-brown, cream belly, pointed ears with tufts, big S-curled fluffy tail (bigger than body) | |
| lion | 사자 | golden yellow, big fluffy orange-brown mane ring around face, round ears, tail with tuft | |
| giraffe | 기린 | yellow with brown patches (pattern 'giraffe'), long neck (head raised), two ossicones, small ears | `rig.neckExt` (Node whose scale.y stretches the neck; head must stay attached) |
| monkey | 원숭이 | brown, peach heart-shaped face plate, big side ears with peach inner, long curled tail | |
| frog | 개구리 | green, big eyes on top of head (eyeball bumps), wide smile, light-yellow belly, webbed feet, no ears/tail | |
| turtle | 거북이 | light green skin, domed shell on back (orange/brown with hexagon plates), shell rim | `rig.shell` |
| unicorn | 유니콘 | white, pastel rainbow mane & tail, golden spiral horn, pink hooves, horse ears | `rig.horn` (horn tip Node) |
| redpanda | 레서판다 | rusty red-orange, white face markings (eyebrow spots, cheeks, ear rims), dark legs/arms, ringed fluffy tail | |
| otter | 수달 | brown, light face/muzzle, whiskers, tiny ears, thick tapered tail | |
| hedgehog | 고슴도치 | cream face/belly, brown spiky back (many small cones on back hemisphere of body+head), tiny ears, black nose | `rig.spikes` (group Node) |
| capybara | 카피바라 | warm brown, wide flat boxy-round head, small ears, sleepy half-closed eyes, big nose, a little yuzu (orange) on head | `rig.yuzu` |

## Rules
- Use `CharacterRig` and specs; customize proportions via `spec.prop` (`hipY, bodyR, bodyS, headR, headS, headY, shoulderX, ...`).
  Keep overall height ~1.0–1.35 (giraffe may reach ~1.6). Feet must touch y=0 in idle.
- Reuse shared materials (`M`, `MG`) and UNIT geometries; no per-instance geometry creation in tight loops.
  Target ≤ 60 meshes per animal (hedgehog spikes: merge spikes into one geometry with `G.mergeGeometries`).
- Animate extra parts (trunk sway, wings flap, joey blink, tail fluff) in `spec.onUpdate(rig, dt, state)`; respond to
  `state.anim` (e.g. wings flap fast in 'fly'/'hover', spread in 'glide').
- Eyes/face must remain clearly readable; nothing should cover the eyes. Ribbon visible from behind/above.
- Colors: pastel but saturated enough to read on bright backgrounds. Avoid pure black (use 0x2a1f3d-ish).
- `buildSomiGirl({cape})`: cute chibi girl — dark-brown hair: rounded bob with bangs + two small pigtails tied with pink star
  ribbons; peach skin; pink pajamas with yellow star dots; slippers. Same eye style. Option `cape:true` adds a small starry
  lavender cape (for dream scenes). Must work with all rig anims (idle, walk, talk, wave, sad, surprised, sleep, sit, celebrate).

## Verify (required)
Start server if needed: `cd /home/claude/somi-adventure && python3 -m http.server 8765 --bind 127.0.0.1 &`
- Grid screenshots of all 30 (e.g. 3 shots of 10, `cols=5`) in `idle`, plus `walk`, `hover`, `attack&ak=swipe`, `fly`, `glide`
  with `tools/viewer.html`. Look at every image (Read the PNG) and fix: floating/detached parts, clipping through face,
  wrong orientation, ugly proportions, unreadable silhouette. Also check from behind (`yaw=3.14`) for the ribbon.
- Somi girl: idle/walk/talk/wave/sleep screenshots, with and without cape.
- Zero console errors (shot.mjs prints them).
Save final review screenshots to `/tmp/claude-0/-home-claude/87897895-3900-5863-965a-62dff1744667/scratchpad/models/` and list them
in your final message, with a short note per animal of anything notable.

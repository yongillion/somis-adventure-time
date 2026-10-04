# SPEC — Stage & boss design (stages 2–7)

Game: **소미의 어드벤처 타임** — a Kirby-and-the-Forgotten-Land–style 3D platformer (Mario Odyssey puzzle flavor, GRIS-like
color restoration) for a young girl (lower elementary). Somi transforms into cute animals (30 forms, unlocked by eating
hidden **animal cookies**), meets flying pets (15), rescues **뭉실이 (Puffies)** from fog cages, and purifies bosses
infected by the **Gray Fog**. Each stage is gray (desaturated) at start; lit **꿈 등불 (lanterns = checkpoints)** bloom
color locally; beating the boss reveals the **꿈빛 (Dream Light)** → stage clear → the whole stage turns colorful.
Story: the fog is the sadness of a lonely little star **노아 (Noa)** who fell from the sky; every purified boss hints at
"a small crying voice" (see per-stage thanks lines below). Text is Korean, warm, simple (7-year-old reading level).

**Everything must feel polished, cute, readable, fair and fun.** Never scary. Difficulty: gentle on 보통 (normal),
more enemies/faster hazards on 어렵게/매우 어렵게 (handled mostly by the engine; you add `hard: true` extra enemies).

## Read first (in this order)
1. `docs/ENGINE.md` (engine API), `js/game/world/builder.js` (**the level DSL**), `js/game/levels/stage1.js` (**reference
   stage — copy its structure and quality bar**), `js/game/levels/common.js` (stageIntro, puffyNpc, ctl).
2. `js/game/bosses/boss.js` (BossController framework) + `js/game/bosses/mushking.js` (**reference boss**),
   `BOSS_TIMING` at the end of `js/game/models/bosses.js` (anim names/durations/parts of your boss model).
3. `js/game/systems/petevents.js` (pet meeting events), `js/game/systems/interact.js`, `hazards.js`, `movers.js`,
   `enemies.js` (ENEMY_DEF types/AIs), `js/game/data/characters.js` (abilities/tags), `js/game/world/env.js` (THEMES).

## Deliverables (per stage N)
- `js/game/levels/stageN.js` — `export default { build(L, stage), onStart(L, stage) }` (optional `update(dt, stage)`).
- `js/game/bosses/<bossId>.js` — `export class XxxBoss extends BossController` (see mushking.js).
- `tools/routes/stageN.json` — bot route that plays the stage start → boss → dream light (see Testing).
- **Only create/edit those files** (plus scratch files in your scratchpad). All other files are shared and read-only for
  you (other agents work in parallel). If you need something the engine lacks, implement it inside your own files
  (custom entity class with `update(dt)` + optional `node`, added via `L._add(entity)` or `L._add(entity, true)` for
  things that must update before the player like platforms; colliders via `L.col({...})` / `level.physics.add`). If a
  shared-file bug blocks you, work around it and describe it precisely in your final report.

## Coordinates, units & movement metrics
1 unit = 1 m, Y up. Builder `y` arguments are **top-surface heights**. Camera default looks along **-Z** (player
spawns facing -Z: `L.start(x, y, z, Math.PI)`); build the main route mostly toward -Z with turns (use camZones to
re-aim the camera when the route turns or for 2.5D side views: `yaw: Math.PI/2` = camera on +X side looking -X).
Signs/NPCs: `yaw: 0` faces +Z (toward an approaching player/camera).
- Run 5.4 m/s. Jump (hold) ≈ 2.1 m high; running jump ≈ 3.8 m long. **Hover (Kirby float)**: after jumping press jump
  again repeatedly — each flap +≈0.45 m, 6 flaps (normal) / 4 (very hard), hover time 4.2 s (normal) / 2.5 s (very
  hard), horizontal hover speed ≈ 4.2 m/s. ⇒ Main-path gaps ≤ 6 m, main-path climbs ≤ 3.6 m above takeoff. Bigger
  gaps need movers, springs (`power` 17 ≈ +4.8 m), cannons or abilities.
- Islands: `L.island(x, y, z, r)` collider radius is `r*0.975` — **keep every gameplay object inside that radius**
  (the builder warns `[level] no ground under ...` in the console → must be zero warnings).
- Kill plane: `L.killY(y)` ~ 25 m under the lowest walkable surface. Normal difficulty respawns at the last safe spot.

## Character availability (puzzles must respect it)
Before stage N the player owns: cat + stage-1 cookies (rabbit, dog, sheep) + all earlier stages' cookies. A puzzle on
the **main path** of stage N may only require animals from earlier stages or from a cookie placed **earlier on stage
N's main path** (make that cookie unmissable and teach its use with a sign right after). Up to **1 optional secret per
stage** may require a later animal (sign: "나중에 다른 친구와 다시 와 봐요!").
| tag / need | who |
|---|---|
| heavy (break `L.rock`, heavy floor switch) | kangaroo(2), bear(3), cow(7), lion(7) |
| pound (break `L.crackedFloor`) | bear(3) special |
| fire (burn `L.thorns`, melt `L.ice`, light `L.torch`) | fox(4) special foxfire, dragon(8) |
| water (grow `L.seed`) | dolphin(5) attack, elephant(7) special |
| wind (spin `L.pinwheel`) | fox(4) attack, lion(7) roar |
| light / reveal ghost platforms (`L.ghost`) | firefly pet(4), fox foxfire buff(4), unicorn(8) |
| grapple (`L.grapple`) | frog(4) hook, monkey(4) swing |
| climb walls (`L.block(..., {climbable:true})`) | koala(3), squirrel(2), monkey(4), redpanda(3) |
| dig (`L.dig`) | pig(2) |
| swim/dive (water volumes `L.water`) | everyone swims; divers (hold attack) shark, dolphin, otter, turtle, frog, penguin |
| slide/roll through 0.8 m low tunnels | penguin(6) slide (h 0.5), hamster(2) ball (h 0.75) |
| neck: hit/grab things up to 5.6 m above | giraffe(6) |
| freeze water into floes | penguin(6) snowball |
| others | rabbit moonjump, sheep cloud pad, kangaroo superjump, squirrel glide, panda vault, otter water-run, capybara slow time, cat air-dash |

## Stage composition (each stage)
- **Length**: a first-time young player should need **~10 minutes** including the boss (≈ 7–9 sections + boss).
  Main route ≈ 250–350 m with varied, readable challenges; optional side areas for secrets.
- **Lanterns** `L.checkpoint`: 4–6 (one right before the boss bridge).
- **Puffies** `L.puffy(i, ...)` exactly indices **0–4**: ~2 on/near the path, ~2 off-path (behind/above/under
  things, over hazards), 1 hidden (`hidden: true`, revealed by dog sniff/owl or by hitting it). Give each a short
  thanks line (`thanks: [{ who:'뭉실이', text, face:'puffyN' }]`, N = color 0..5).
- **Cookies** listed in your brief: `L.cookie(id, x, y, z)` floating ~0.9 m above ground.
- **Pets** listed in your brief: `L.petEvent(id, x, y, z, { kind, ... })` (see petevents.js kinds; write charming
  `lines` and `thanks` in the pet's voice).
- **Signs** (`L.sign`) to teach each new mechanic (1–2 lines, use `ctl(touchText, keyText)` when naming buttons) and
  1–3 friendly Puffy NPCs (`puffyNpc`) with flavor/hints. A first-visit `stageIntro(stage, { shots, lines })` in
  `onStart` (short camera flyover over the stage + a greeter dialog), like stage 1 uses for its banner.
- **Candies** generously along routes (~150–200 incl. arcs/rings guiding jumps), 2–3 `bigCandy` in secret spots,
  3–5 `heart`s before hard parts.
- **Enemies** (variant = theme automatically): 15–25 on normal; add 5–8 more with `hard: true`. Mix AIs. Don't put
  enemies where a kid can't see them coming.
- **Hazard gauntlets** (Super Meat Boy spirit, kid-friendly): at least 2 sections built around rhythm/timing
  (saws, spike traps, crushers, firebars, lasers, rollers, droppers, blink/falling platforms, wind). Telegraph
  clearly, give safe spots, put a lantern before. Remember the player can hover over things — use ceilings, vertical
  saws, moving/sweeping hazards, and lengths longer than one hover so hazards still matter.
- **Puzzles**: at least 2 per stage (switch/gate wiring with `signal`s, crates, crystal switches, ability gates).
- **Boss arena**: `const arena = L.arena(x, y, z, r)` (r 12–15) at the end; lantern + bridge before it; boss
  controller constructed in `build` like stage1 (`stage.bossCtl = new XxxBoss(stage, {...})`). Arena walls activate
  automatically during the fight.
- Decorate richly with theme props (`L.prop(type, x, y, z, {s, seed, yaw})`, see `DECOR_SETS` & PROP_TYPES) — islands
  auto-decorate (use `clear: [[x, z, r], ...]` keep-out circles over paths/objects and `density`).
- Performance: ≤ ~220 entities, ≤ ~60 enemies incl. hard extras; avoid huge numbers of moving things in one view.

## Boss rules (BossController)
- Constructor opts: `{ pos, yaw, arena, hp (base; ×difficulty), introLines, thanks, title, music, introDist,
  outroDist, centerY, radius, hitInvuln, camWeight, wakeFrac, lightPos }`. `thanks` items: `['boss', text]` (boss
  speaking, purified portrait), `['소미', text]` (player portrait), or full `{who, text, face}`.
  Intro lines should use face `'bossfog:<id>'` (fogged portrait).
- Override `think(dt)` as a small state machine using `this.mode`/`this.mt` (`setMode`), `this.patterns` (3 phase
  pattern lists) + `nextFromPattern()`, `this.phase` (1→3 at 67%/34% HP). Helpers: `play(anim, extra)`, `facePlayer`,
  `walkToward`, `toPlayer()`, `shock(x,z,{maxR,speed})` (ring to jump over), `marker(x,z,r,dur)` (ground
  telegraph), `fall(kind,x,z,{delay,speed,height,r})` (thing falling onto a marker), `shoot(kind, from, vel, o)`,
  `lob(kind, from, to, T)`, `summon(type, n, {max})`, `randomArenaPoint()`. Set `this.weakMul = 2` + `this.contact =
  false` during weak moments; `this.armored = true` to block hits. Override `spheres()` for hit/contact spheres
  (with `mul`), `introPose(dir)`, `onFightStart`, `onReset`, `onPhase(n)`, `shadow()`.
- Every attack is **telegraphed** (wind-up anim ≥ 0.5 s, markers, sounds). Every boss has a clear **weak moment**
  every ~8–12 s where it takes ×2 damage. Fight length for a kid: **1.5–3 minutes**. Base HP guide: stage2 46,
  stage3 48, stage4 50, stage5 54, stage6 58, stage7 62 (hits deal ~1–2, 0.4 s invulnerability between hits).
- Use projectile kinds that exist: enemy `fogball, seed, cork, snowball, ink, spore, bomb`, and player ones like
  `star`, `leaf`, `acorn` for visuals. Minions: any ENEMY_DEF type (e.g. `pumpkinling`, `snowball`, `toysoldier`).

## Testing (mandatory, iterate until clean)
Server: `http://127.0.0.1:8765/` (already running; if not: `cd /home/claude/somi-adventure && python3 -m http.server
8765 --bind 127.0.0.1 &`). All tools use Playwright + SwiftShader (slow-ish; keep runs focused).
1. `node --check <file>` for each file.
2. Overview shots: `node tools/overview.mjs "http://127.0.0.1:8765/index.html?stage=N&flags=seen:stageNintro" <outdir>
   '[["name",[camX,camY,camZ],[tgtX,tgtY,tgtZ],fov], ...]'` → Read the PNGs. Check composition, scale, colors.
3. Bot playthrough: write `tools/routes/stageN.json` (waypoints, see `tools/bot.js` header: `p`, `r`, `act`
   (`attack`/`special`/`wait`/`jump`), `t`, `until` (JS condition with `C`=CTX, `p`=player), `noAuto`, `air`, `ry`,
   `char` (switch animal), `follow:"boss"`). Run: `node tools/botrun.mjs "http://127.0.0.1:8765/index.html?stage=N&flags=seen:stageNintro"
   <outdir> tools/routes/stageN.json 60000 3000 1 1` (args: maxFrames shotEvery god teleportOnStuck). Goal: the bot
   reaches the arena, defeats the boss and touches the dream light (log ends with all waypoints; "STUCK" lines must
   be explained — real reachability bugs must be fixed). Use `?stage=N&at=x,y,z` (+ `&flags=...`) to start anywhere.
   Unlocked animals in tests: give them with `&flags=` won't work — use waypoint `"char": "kangaroo"` (the bot
   switches animal directly; unlocked or not) to test ability puzzles.
4. Boss: start near the arena (`&at=`), route `[{"p":[...]}, {"p":[...],"follow":"boss","t":400}, {"p":[light]}]`,
   check that all modes happen (log `C.game.mode.boss.mode` in a custom script if needed) and screenshot attacks.
5. Zero console errors and zero `[level] no ground under` warnings.
6. Final report: what you built (sections list with coordinates), cookies/pets/puffies locations, boss behavior,
   test results (bot log summary), known issues, any shared-file bug you found.

## Per-stage briefs
(Colors: stage `def.color` in `js/game/data/stages.js`. Music is automatic. Enemy variants automatic.)

### Stage 2 — 노을 과일 협곡 (theme `canyon`) · boss `pumpkin` 호박 대장
Sunset fruit canyon: mesas, orange trees, cacti, hay, barrels, wooden bridges, star cannons over chasms.
Cookies: **kangaroo** (early, main path; first breakable rock wall right after — sign teaches "힘센 친구"),
**squirrel** (main path; then a long windy canyon crossing where gliding/hover helps), **pig** (near glittering dig
mounds `L.dig` with treasure: one has a puffy/bigCandy), **hamster** (side area; a spike-floor corridor the hamster
ball can roll over to a treasure).
Pets: **sparrow 짹짹이** (`chase`, 4 perches on orange trees/mesas), **ladybug 점박이** (`collect`, itemKind `spot`,
7 spots in an orchard). Hazards: rolling boulders down slopes (`L.roller`), crushers in a narrow canyon, wind gusts
on a narrow bridge, cannons, falling platforms. Enemies: gloomy, hopper, shooter, roller, charger, bomber.
Boss 호박 대장: throwSeeds (3 aimed seeds), vineWhip (sweeping low arc → jump over), rollStart→roll (rolls toward the
player, bounces off the arena edge 2–3 times) → dizzy (weak ×2, ~3 s), summon pumpkinlings (phase 2+).
Thanks: "후아~ 머리가 맑아졌어! 내가 왜 과일 친구들을 괴롭혔을까... 미안해." / "그런데 안개 속에서 '나도 여기 있어...'
하는 작은 목소리가 들렸어. 누가 숨바꼭질을 하고 있는 걸까?"

### Stage 3 — 해바라기 꿀벌 언덕 (theme `honey`) · boss `thundercloud` 우르릉 번개구름
Sunflower hills, beehives, honey pots, flower arches; a honeycomb cave below cracked floors.
Cookies: **bear** (main; then cracked floors (`L.crackedFloor`, pound) leading down into the cave), **quokka**
(main), **koala** (main; then a climbable vine wall `L.block(..., { climbable: true })`), **redpanda** (hidden secret).
Pets: **hummingbird 윙윙이** (`feed`, need 20), **canary 랄라** (`bells`, 3–4 bells melody near a flower stage).
Hazards: pollen lasers in the hive (`L.laser`), rotating sunflower platforms (`L.rotator`), blink/falling platforms,
spike traps. Enemies: flyer (bees), gloomy, hopper, shield, spiky.
Boss 우르릉 번개구름 (flying; origin = cloud center, keep it ~5–6 m above the arena): drifts toward the player;
charge→strike (lightning on a marked spot, 1/2/3 bolts by phase, shock ring at impact), rain (fogballs falling in a
moving circle), tired → descend (low, core exposed, weak ×2 ~3.5 s). High = hits ×0.6 (projectiles/hover attacks).
Thanks: "우르릉... 아니, 이제 화 안 났어. 사실 왜 화가 났는지도 몰랐어. 그냥... 너무 쓸쓸했어." / "그 쓸쓸한 마음은 내 것이
아니었던 것 같아. 어디선가 흘러 들어온 슬픔이었어."

### Stage 4 — 반딧불 정글 (theme `jungle`) · boss `chameleon` 카멜레온 카멜
Night jungle, glowing mushrooms, giant leaves, vines, fireflies, ruins.
Cookies: **monkey** and **frog** (main, before grapple sections `L.grapple` over gaps), **fox** (main; then torches
`L.torch` + `L.torchGroup` opening a gate, thorn vines `L.thorns` burned by foxfire, pinwheels `L.pinwheel` spun by
fox wind), **panda** (side), **tiger** (secret).
Pets: **firefly 반짝이** (`collect`, itemKind `light`, 5 lights in a dim grove; afterwards ghost platforms `L.ghost`
nearby lead to a puffy), **parrot 따라쟁이** (`quiz`, 3 kid-friendly questions with hints when wrong).
Enemies: gloomy, hopper, spiky, ghost, shooter, flyer.
Boss 카멜레온 카멜 (arena with 3–4 pillars/trees): vanish (fade) → appear somewhere (eyes first) → tongueWindup →
tongueOut along a ground line marker (length ~7); if it hits a pillar → tongueStuck (tongue tip weak ×2, ~3 s) else
retracts; walks & spits seeds; phase 2+: two tongue attacks in a row / shorter windups.
Thanks: "숨어 있으면 아무도 나를 못 볼 거라고 생각했어. 그런데 숨는 건... 정말 외로운 거구나." / "안개 속에서 우는 그
아이도 어딘가에 혼자 숨어 있는 게 아닐까?"

### Stage 5 — 수정 바다 (theme `sea`, visual ocean at y≈-2.2) · boss `octopus` 문어 대왕 옥토
Beach islands, coral, lagoons with water volumes `L.water(x, top, z, w, d, depth)`, crystal formations, lily pads.
Cookies: **dolphin** (main; then seeds `L.seed` grown with water rings → flower platforms), **shark** (main),
**otter** (main; then a water-running stretch across a lagoon), **turtle** (side). One puffy underwater (divers).
Pets: **seagull 끼룩이** (`chase` across beach islands), **dragonfly 쌩쌩이** (`race`: 6–8 rings `[x,y,z,yaw]`, ~30 s).
Hazards: jellyfish, crystal lasers, moving lily pads, cannons over the sea, currents (`L.wind` over water).
Boss 문어 대왕 옥토 (center of a round arena, big): slam (tentacle i rises then slams outward along `OCTO_YAW[i]`
→ line marker first, shock along the line) → stuck (tip weak ×2 ~3 s), ink (lob ink blobs), submerge/emerge
(phase 3: emerges and slams in a ring), phase 2+: two slams.
Thanks: "바다 깊은 곳까지 슬픔이 스며들었었어... 그런데 그 슬픔에서 하늘의 별빛 냄새가 났어." / "혹시 하늘에서 떨어진 작은
별이 있는 걸까?"

### Stage 6 — 오로라 눈꽃 산 (theme `snow`) · boss `yeti` 눈보라 예티
Snowy night mountain under aurora, pines, igloos, frozen lakes, ice crystals.
Cookies: **penguin** (main; then a frozen-lake section: freeze water into floes with snowballs, slide under 0.8 m
low gaps), **giraffe** (main; then high crystal switches reachable with the neck), **hedgehog** (side).
Pets: **owl 부엉박사** (`quiz` about the story/world), **dove 구구** (`bubble` high on an ice spire).
Hazards: ice floors (`surface: 'ice'` / block style `ice`), icicle droppers, snowball rollers, blizzard wind zones,
ice blocks (`L.ice`) melted by fire (fox). Enemies: snowball, gloomy, hopper, flyer, charger, shield.
Boss 눈보라 예티: throwWindup→throw (big snowball lobbed / rolling), slam (both hands: shock ring + icicles falling
on markers), inhale/blow (blizzard pushes the player toward the edge; heavy animals resist), charge (runs straight;
hitting one of 4 ice pillars in the arena → stunned, weak ×2 ~3 s).
Thanks: "춥고 외로웠어... 아니, 그건 내 마음이 아니었어. 달빛 정원 쪽에서 차가운 슬픔이 불어오고 있어."

### Stage 7 — 장난감 시계탑 (theme `toy`) · boss `clockknight` 태엽 기사 클락
Toy-box world climbing a giant clock tower: blocks, crayons, gears, gift boxes, train tracks.
Cookies: **elephant** (main; spray to grow seeds), **lion** (main; roar spins pinwheels → gates), **capybara**
(main; slow-time helps with a very fast hazard section), **cow** (side; rush breaks rock walls).
Pets: **woodpecker 콕콕이** (`targets`: 5 targets, ~25 s), **eagle 용감이** (`chase` up the tower or `bubble` at the top).
Hazards: rotating gears (`L.rotator`, style `gear`), clock-hand moving platforms (`L.mover` with `fn`), conveyors
(set `.conv = {x, z}` on a collider), toy crushers, lasers, saws, cannons, timer switches (`mode: 'timer'`).
Boss 태엽 기사 클락: stiff walk, chargeWindup→charge (lance across the arena), spin (lance sweep — jump over),
shoot (corks from shoulders), after ~3 attacks → unwound (key glows; weak ×2 ~3.5 s).
Thanks: "째깍... 째깍... 시간이 멈춘 것 같았어. 달빛 꿈의 정원에 가 봐. 모든 안개는 거기서 시작됐어." / "그리고 그곳에서...
누군가 아주 오랫동안 혼자 울고 있어."

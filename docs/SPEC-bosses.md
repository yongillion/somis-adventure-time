# SPEC — 8 Boss models (+ animations)

Game: "소미의 어드벤처 타임" (Kirby Forgotten Land-like 3D platformer for a young girl). Bosses are big friendly-looking
creatures **infected by the Gray Fog** (gray-lavender tint, grumpy brows). After defeat they are purified: colors return
and they smile. They must be impressive but never scary for a 7-year-old.

Read first: `docs/ENGINE.md`, `js/game/models/common.js`, `js/game/models/rig.js` (style reference). Do NOT edit those.

## Deliverable: `js/game/models/bosses.js`
`export function buildBoss(id)` -> object:
```
{ root,            // Node, origin at feet center (flying bosses: see notes), faces +Z
  update(dt, st),  // st = { anim, t, speed, ...extra }
  setFlash(v),     // 0..1 white hit flash
  setPurified(v),  // 0 = fog-gray look, 1 = original bright colors (lerp material colors; bosses own their materials -> clone)
  setOpacity(v),
  parts: {...},    // named Nodes required below (for weak points / projectile origins)
  height, radius }
```
Every boss supports anims: `idle, hurt, defeated` (defeated = purified pose: sitting/relieved, happy eyes) plus its own list.
Make anims procedural with smooth blending (approach / Spring). `t` = seconds since anim started.

| id | name | look (approx size) | extra anims | parts |
|---|---|---|---|---|
| mushking | 킹 버섯돌이 | giant mushroom king (3.5 tall): red cap with white spots + small gold crown, cream stem body with face, tiny arms, stubby feet | walk, jumpCrouch, jumpAir, land, stuck (cap jammed in ground, legs kick, dizzy), spore (cap puffs), summon | cap, face, crown |
| pumpkin | 호박 대장 | pumpkin general (3.2): big orange pumpkin body, carved cute glowing face, leafy vine arms, leaf cape, curly stem hat | walk, rollStart, roll (body spins forward), dizzy (orbiting stars), throwSeeds, vineWhip (one arm sweeps wide), summon | handL, handR, mouth |
| thundercloud | 우르릉 번개구름 | big storm cloud (4.5 wide, floats; origin at cloud center) grumpy face, lightning-bolt horns, puffy cheeks | charge (sparks/glow), strike, rain (sad drops), descend (tired, low), | core |
| chameleon | 카멜레온 카멜 | big chameleon (3 tall), green, curly tail, cone eyes that look around, head crest | walk, cling (on wall), tongueWindup, tongueOut, tongueStuck, vanish (fade via setOpacity shimmer), appear | tongue (Node: scale.z extends tongue along +Z, length 1 unit at scale 1), tongueTip, head |
| octopus | 문어 대왕 옥토 | giant octopus (head 4 tall) pink-purple, big eyes, 6 tentacles around (each a chain) | swim, slam (st.tentacle = index: that tentacle rises then slams outward), stuck (st.tentacle stays down, wiggling), ink, submerge, emerge | tentacles[] (base Nodes), tips[] (tip Nodes), head |
| yeti | 눈보라 예티 | big white fluffy yeti (3.5), pale-blue face, small horns, huge hands | walk, throwWindup, throw (snowball in parts.handR), slam, inhale, blow, charge (run), stunned (stars) | handL, handR, mouth |
| clockknight | 태엽 기사 클락 | wind-up toy knight (3.2): tin lavender/silver body, round helmet with plume, clock face on chest, big wind-up key on back (rotates), lance arm | walk (stiff toy walk), chargeWindup, charge, spin (top spin), shoot (shoulder hatches), unwound (slumped, key slow) | key, lance, shoulderL, shoulderR, chest |
| fogking | 회색 안개 | FINAL: huge sad fog giant (6 tall): dark lavender cloud body of many spheres, pale glowing violet sad eyes, crown of dark crystals, two big separate floating fog hands, a dim heart-star core inside chest | handSlam (st.hand 'L'/'R'), tearRain, roar, coreReveal (chest parts open to expose core), weak (core exposed & pulsing), dissolve (fade out pieces) | handL, handR, core, eyes |

Notes:
- `setPurified(v)`: store each material's original color + a fogged color (desaturated toward 0x8d86a8, darker),
  lerp. fogking stays dark (its purified state = soft white-lavender, gentle eyes).
- Each boss ≤ 120 meshes (prefer fewer; merge static bits with G.mergeGeometries + vertexColors material).
- Weak points must be visually obvious (e.g., clockknight key glows when unwound; octopus tentacle tip turns pink when stuck).

## Verify
Server: `cd /home/claude/somi-adventure && python3 -m http.server 8765 --bind 127.0.0.1 &` (if not running).
Use `tools/viewer.html?mod=bosses&fn=buildBoss&ids=mushking&anim=idle&dist=12&h=2` etc. Shoot each boss in several anims and at
`setPurified` 0 and 1 (you may add a `pur` query param handling in a copy of the viewer under tools/, e.g. tools/viewer-boss.html).
Read every PNG and iterate until each boss looks polished, cute, readable. Zero console errors.
Save final shots to `/tmp/claude-0/-home-claude/87897895-3900-5863-965a-62dff1744667/scratchpad/models/` and list them.

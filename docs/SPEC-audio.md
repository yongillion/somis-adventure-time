# SPEC — Procedural audio: music + SFX (WebAudio, no audio files)

Game: "소미의 어드벤처 타임" — a dreamy, cute 3D platformer (Kirby Forgotten Land energy + GRIS-like emotional, fantastical
moments) for a young girl. Story: a lonely little star "Noa" whose tears became a Gray Fog that drained Dreamland's colors;
Somi restores 8 colors and finally befriends Noa (touching ending). All sound must be synthesized at runtime.

## Deliverables
- `js/engine/audio.js` — engine (context, buses, instruments, scheduler, reverb, sfx playback). Export `Audio` object:
```
Audio.init()                 // create/resume AudioContext; safe to call repeatedly; must be called from a user gesture
Audio.resume(); Audio.suspend();     // used on pause / tab hidden
Audio.setMusicVolume(v); Audio.setSfxVolume(v);   // 0..1
Audio.playMusic(id, {fade=0.8, restart=false})  // crossfade to a looping track; same id -> no restart
Audio.stopMusic(fade=0.8)
Audio.duck(level=0.35, dur=1.2)     // temporarily lower music (dialog, jingles)
Audio.jingle(id)                    // one-shot musical stinger; ducks music while playing
Audio.sfx(name, {vol=1, pitch=1, pan=0})   // pitch = playback multiplier (1 = normal)
Audio.currentMusic                  // id or null
Audio.ready                         // bool
```
- `js/game/music.js` — song data (your own compact notation) for every track below.
- `js/game/sfx.js` — SFX recipes for every name below (import into audio.js or register).
Must be robust: no errors if `init()` was never called (all calls become no-ops), no clicks/pops (use envelopes), limit
simultaneous voices (mobile CPU), master compressor/limiter to avoid clipping, reverb via generated impulse response.
Scheduler: lookahead (~0.1–0.2s) with setInterval/setTimeout; must keep loops seamless and tolerate tab throttling.

## Musical identity
Compose a short memorable **main theme** (8–16 bars) used: title (music box), ending (warm full arrangement), `noa`
(slow piano + strings, emotional), credits (upbeat). Kirby-like bright melodies for stages; each stage track distinct.
Tracks loop seamlessly (length ~30–60s each).
| id | mood / tempo / instrumentation |
|---|---|
| title | dreamy music box + soft pad + gentle bells, main theme, ~84bpm |
| map | cheerful walking tune, marimba + flute, ~104bpm |
| opening | storybook: celesta/music box + strings pad, slow, gentle wonder (~70bpm) |
| meadow | Stage 1 flower fields: bright, bouncy, pluck lead + bass + light drums, ~128bpm, C major |
| canyon | Stage 2 sunset fruit canyon: warm, whistle + guitar-like pluck, light shuffle, ~112bpm |
| honey | Stage 3 sunflower honey hills: playful pizzicato + bells, ~120bpm |
| jungle | Stage 4 firefly jungle: marimba + bongos, mysterious-but-fun, ~116bpm |
| sea | Stage 5 crystal sea: flowing harp arpeggios + soft pad + bubbly synth, ~96bpm |
| snow | Stage 6 aurora snow mountain: glockenspiel/celesta sparkle, sleigh bells, ~104bpm |
| toy | Stage 7 toy clock tower: quirky clockwork, toy piano, tick-tock percussion, ~132bpm |
| moon | Stage 8 moonlight dream garden: ethereal, choir-like pad, harp, bells, building epic, ~88bpm |
| boss | energetic minor-key boss battle, driving bass + drums, ~150bpm |
| finalboss | epic final battle with choir pad, ~140bpm, minor |
| noa | the main theme slow and emotional (piano + strings), ~72bpm |
| memory | sad gentle music box (memory scenes), ~66bpm |
| ending | main theme, warm & full, hopeful, ~84bpm |
| credits | upbeat medley around the main theme, ~110bpm |
| minigame | cute quick loop for pet events / challenges, ~140bpm |
Jingles (one-shot, `Audio.jingle`): `stageclear` (~4s fanfare), `cookie` (new friend unlocked, ~2s), `petjoin` (~2s),
`levelup` (~1.5s), `colorRestore` (~3s magical swell), `tryagain` (~2s gentle, not sad), `rescue` (~1.5s), `bossIntro` (~2.5s
dramatic), `victory` (~3s), `secret` (~1.2s discovery), `quizRight` (~1s), `quizWrong` (~1s soft).

## SFX names (all required)
Movement: `jump, jump2 (air jump), flap (hover puff), land, step, dash, glide, swim, splash, dive, climb, slide, roll, bounce (spring),
cannon, wind, teleport`.
Combat: `punch, swipe, throw, shoot, magic, fire, water, ice, bubble, boomerang, bite, roar, horn, hammer, beam, spin, quake,
explode, hit (enemy hit), pop (enemy defeated, cute + sparkly), hurt (player hurt), shield, block, charge, release`.
Items/UI: `coin (star candy, bright), coinBig, heart, heal, cookie, key, unlock, door, switch, gateOpen, break, crumble, cage,
checkpoint, sparkle, transform (character change, magical poof), petSummon, petAbility, menuMove, menuSelect, menuBack, pause,
blip (dialog typewriter, very short soft), notify, timer (tick), success, fail, bell, drum1, drum2, drum3, drum4 (4 distinct
pitched drums for a Simon game), quizRight, quizWrong, whoosh, chime, crystal, honey, snow, gear, laser, saw, crusher, lightning,
rain, thunder, bossRoar, bossHit, bossDown, colorBloom (big magical bloom), heartbeat, star (Noa twinkle), cry (soft sad tone)`.

## Verify
- Create `tools/audio-test.html` that initializes Audio and renders each track and each SFX via an OfflineAudioContext path
  (or a test hook) and reports peak/RMS (non-silent, no clipping > 0.99, no NaN). Run it headless with
  `node tools/shot.mjs "http://127.0.0.1:8765/tools/audio-test.html" out.png 8000 800 600 "window.__audioReport"` (start server
  `cd /home/claude/somi-adventure && python3 -m http.server 8765 --bind 127.0.0.1 &` if needed) and make sure every item passes.
- Also run a test that calls every public API before `init()` (must not throw).
- Report the musical structure (key/chords) of the main theme in your final message.

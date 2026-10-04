// ============================================================================
// sfx.js — procedural sound-effect recipes for "소미의 어드벤처 타임" (played by js/engine/audio.js)
// Each recipe receives S (see SfxCtx in audio.js): S.tone / S.noise / S.fm / S.note / S.chord / S.arp / S.drum,
// S.rev(send), S.rnd(a,b). Times are seconds from the sound start, frequencies in Hz; the `pitch` option of
// Audio.sfx() scales both like a sample's playback rate. Style: cute, round, sparkly — never harsh.
// ============================================================================

const PENTA_HI = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7'];
const pick = (S, arr) => arr[Math.floor(S.rnd(0, arr.length - 0.001))];

// One soft water bubble ("blip" that rises)
function bubbleBlip(S, t, f = 700, v = 0.18) {
  S.tone({ w: 'sine', f: f * 0.6, f2: f * 1.5, fd: 0.06, t, d: 0.09, a: 0.004, v });
}
// Tiny high sparkle cluster
function sparkles(S, t, n = 3, step = 0.05, vel = 0.35) {
  for (let i = 0; i < n; i++) S.note('glock', pick(S, PENTA_HI), t + i * step + S.rnd(0, 0.015), 0.2, vel * S.rnd(0.7, 1));
}
// Soft "poof" of air
function poof(S, t, f0 = 2500, f1 = 600, d = 0.3, v = 0.3) {
  S.noise({ c: 'pink', t, d, a: 0.006, v, bp: [f0, f1, 0.9] });
}

export const SFX = {
  // ------------------------------------------------------------------ movement
  jump(S) {
    S.tone({ w: 'triangle', f: 300, f2: 720, fd: 0.11, d: 0.16, a: 0.004, v: 0.34 });
    S.tone({ w: 'sine', f: 600, f2: 1440, fd: 0.1, d: 0.12, a: 0.004, v: 0.07 });
    S.noise({ c: 'pink', d: 0.07, a: 0.005, v: 0.05, bp: [1200, 2400, 1.2] });
  },
  jump2(S) {
    S.tone({ w: 'triangle', f: 480, f2: 980, fd: 0.08, d: 0.1, a: 0.004, v: 0.28 });
    S.tone({ w: 'triangle', f: 700, f2: 1450, fd: 0.08, t: 0.065, d: 0.12, a: 0.004, v: 0.24 });
    S.note('glock', 'E7', 0.06, 0.15, 0.3);
  },
  flap(S) {
    S.noise({ c: 'pink', d: 0.17, a: 0.02, v: 0.38, bp: [950, 480, 1.1] });
    S.tone({ w: 'sine', f: 220, f2: 150, d: 0.12, a: 0.01, v: 0.14 });
  },
  land(S) {
    S.tone({ w: 'sine', f: 140, f2: 58, fd: 0.08, d: 0.11, a: 0.002, v: 0.42 });
    S.noise({ c: 'pink', d: 0.08, a: 0.002, v: 0.28, lp: [900, 250] });
  },
  step(S) {
    const r = S.rnd(0.9, 1.12);
    S.noise({ c: 'white', d: 0.035, a: 0.001, v: 0.13, lp: [1700 * r, 700], hp: 200 });
    S.tone({ w: 'sine', f: 230 * r, f2: 150 * r, d: 0.045, a: 0.002, v: 0.1 });
    S.rev(0.04);
  },
  dash(S) {
    S.noise({ c: 'white', d: 0.24, a: 0.03, v: 0.28, bp: [700, 2600, 1.4] });
    S.tone({ w: 'triangle', f: 220, f2: 540, d: 0.18, a: 0.01, v: 0.1 });
    S.noise({ c: 'pink', d: 0.12, a: 0.004, v: 0.12, lp: [800, 300] });
  },
  glide(S) {
    S.noise({ c: 'pink', d: 0.6, a: 0.16, v: 0.3, bp: [600, 1250, 2.2], am: [5, 0.35] });
    S.tone({ w: 'sine', f: 660, f2: 780, d: 0.55, a: 0.18, v: 0.035, vib: [4.5, 25] });
    S.rev(0.2);
  },
  swim(S) {
    S.noise({ c: 'pink', d: 0.2, a: 0.03, v: 0.28, bp: [500, 1100, 1.5] });
    bubbleBlip(S, 0.05, 900, 0.14);
    bubbleBlip(S, 0.12, 1300, 0.1);
    S.rev(0.15);
  },
  splash(S) {
    S.noise({ c: 'white', d: 0.45, a: 0.003, v: 0.42, lp: [5500, 700] });
    S.noise({ c: 'pink', d: 0.32, a: 0.005, v: 0.26, bp: [1300, 450, 1] });
    for (let i = 0; i < 4; i++) bubbleBlip(S, 0.08 + i * 0.07 + S.rnd(0, 0.03), S.rnd(700, 1500), 0.1);
    S.rev(0.18);
  },
  dive(S) {
    S.tone({ w: 'sine', f: 1100, f2: 240, d: 0.26, a: 0.005, v: 0.2 });
    S.noise({ c: 'white', t: 0.1, d: 0.4, a: 0.004, v: 0.34, lp: [4500, 500] });
    for (let i = 0; i < 5; i++) bubbleBlip(S, 0.2 + i * 0.06 + S.rnd(0, 0.03), S.rnd(500, 1200), 0.1);
    S.rev(0.2);
  },
  climb(S) {
    S.noise({ c: 'white', d: 0.05, a: 0.002, v: 0.22, bp: [1800, 1200, 2] });
    S.noise({ c: 'white', t: 0.09, d: 0.05, a: 0.002, v: 0.2, bp: [2200, 1400, 2] });
    S.tone({ w: 'sine', f: 330, f2: 260, d: 0.05, a: 0.002, v: 0.06 });
  },
  slide(S) {
    S.noise({ c: 'white', d: 0.38, a: 0.02, v: 0.2, env: 'hold', rel: 0.12, bp: [1700, 900, 1.2], am: [22, 0.3] });
    S.tone({ w: 'sine', f: 520, f2: 380, d: 0.36, a: 0.02, v: 0.05 });
  },
  roll(S) {
    S.tone({ w: 'triangle', f: 170, f2: 140, d: 0.38, a: 0.01, v: 0.28, lp: 900, am: [16, 0.6] });
    S.noise({ c: 'brown', d: 0.38, a: 0.01, v: 0.35, lp: 500, am: [16, 0.5] });
  },
  bounce(S) {
    S.tone({ w: 'sine', f: 190, f2: 560, fd: 0.09, d: 0.55, a: 0.004, v: 0.4, vib: [13, 140, 0.06, 0.02] });
    S.tone({ w: 'triangle', f: 95, f2: 280, fd: 0.09, d: 0.4, a: 0.004, v: 0.14, vib: [13, 140, 0.06, 0.02] });
    S.rev(0.1);
  },
  cannon(S) {
    S.tone({ w: 'sine', f: 115, f2: 38, fd: 0.25, d: 0.5, a: 0.003, v: 0.62 });
    S.noise({ c: 'pink', d: 0.45, a: 0.002, v: 0.5, lp: [2200, 200] });
    poof(S, 0.0, 1500, 400, 0.3, 0.25);
    S.rev(0.2);
  },
  wind(S) {
    S.noise({ c: 'pink', d: 1.5, a: 0.45, v: 0.36, bp: [380, 1150, 2.5, 0.8], am: [0.8, 0.4] });
    S.noise({ c: 'pink', t: 0.15, d: 1.2, a: 0.5, v: 0.12, bp: [950, 620, 4] });
    S.rev(0.25);
  },
  teleport(S) {
    S.fm({ f: 300, f2: 1800, ratio: 1.5, idx: [3, 0.5], d: 0.5, a: 0.02, v: 0.16 });
    S.arp('celesta', ['C6', 'E6', 'G6', 'C7', 'E7'], 0.05, 0.05, 0.4, 0.55);
    S.noise({ c: 'white', d: 0.45, a: 0.12, v: 0.05, hp: 6000, am: [18, 0.6] });
    S.rev(0.35);
  },

  // ------------------------------------------------------------------ combat
  punch(S) {
    S.noise({ c: 'white', d: 0.09, a: 0.002, v: 0.36, bp: [1300, 500, 1] });
    S.tone({ w: 'sine', f: 210, f2: 80, d: 0.13, a: 0.002, v: 0.45 });
  },
  swipe(S) {
    S.noise({ c: 'white', d: 0.15, a: 0.02, v: 0.3, bp: [1500, 4500, 1.5] });
    S.tone({ w: 'sine', f: 900, f2: 1600, d: 0.1, a: 0.01, v: 0.04 });
  },
  throw(S) {
    S.noise({ c: 'white', d: 0.21, a: 0.03, v: 0.27, bp: [800, 2400, 1.3] });
    S.tone({ w: 'triangle', f: 300, f2: 620, d: 0.16, a: 0.008, v: 0.09 });
  },
  shoot(S) {
    S.tone({ w: 'square', f: 1300, f2: 420, d: 0.13, a: 0.003, v: 0.1, lp: 3500 });
    S.tone({ w: 'sine', f: 1300, f2: 420, d: 0.14, a: 0.003, v: 0.16 });
  },
  magic(S) {
    S.noise({ c: 'white', d: 0.5, a: 0.05, v: 0.08, hp: 5000, am: [18, 0.6] });
    S.arp('celesta', ['G5', 'C6', 'E6', 'G6', 'C7'], 0, 0.04, 0.35, 0.6);
    S.fm({ f: 800, ratio: 2.01, idx: [1.5, 0.1], d: 0.6, a: 0.01, v: 0.08 });
    S.rev(0.35);
  },
  fire(S) {
    S.noise({ c: 'pink', d: 0.5, a: 0.03, v: 0.4, lp: [400, 2400, 0.7, 0.18] });
    S.noise({ c: 'brown', d: 0.45, a: 0.02, v: 0.3, lp: 700 });
    for (let i = 0; i < 5; i++) S.noise({ c: 'white', t: 0.05 + S.rnd(0, 0.35), d: 0.02, a: 0.001, v: 0.12, bp: [S.rnd(2500, 5000)] });
  },
  water(S) {
    S.noise({ c: 'white', d: 0.38, a: 0.01, v: 0.24, bp: [2600, 1200, 1.2], am: [30, 0.5] });
    for (let i = 0; i < 3; i++) bubbleBlip(S, 0.05 + i * 0.08, S.rnd(700, 1400), 0.1);
    S.rev(0.15);
  },
  ice(S) {
    S.fm({ f: 1800, ratio: 2.76, idx: [2, 0.2], d: 0.6, a: 0.002, v: 0.12 });
    S.fm({ f: 2400, ratio: 3.1, idx: [1.5, 0.1], t: 0.04, d: 0.5, a: 0.002, v: 0.08 });
    S.noise({ c: 'white', d: 0.3, a: 0.003, v: 0.07, hp: 7000 });
    S.note('glock', 'B6', 0.02, 0.3, 0.3);
    S.rev(0.3);
  },
  bubble(S) {
    S.tone({ w: 'sine', f: 280, f2: 900, fd: 0.06, d: 0.12, a: 0.003, v: 0.3 });
    S.tone({ w: 'sine', f: 500, f2: 1300, fd: 0.05, t: 0.07, d: 0.1, a: 0.003, v: 0.2 });
    S.rev(0.15);
  },
  boomerang(S) {
    S.noise({ c: 'white', d: 0.62, a: 0.05, v: 0.28, env: 'hold', rel: 0.15, bp: [1100, 1500, 2], am: [12, 0.9] });
    S.tone({ w: 'sine', f: 600, f2: 700, d: 0.6, a: 0.05, v: 0.05, env: 'hold', rel: 0.15, am: [12, 0.9] });
  },
  bite(S) {
    S.noise({ c: 'white', d: 0.06, a: 0.001, v: 0.32, bp: [1600, 800, 1.5] });
    S.noise({ c: 'white', t: 0.08, d: 0.06, a: 0.001, v: 0.28, bp: [1500, 700, 1.5] });
    S.tone({ w: 'sine', f: 260, f2: 130, d: 0.12, a: 0.002, v: 0.28 });
    S.tone({ w: 'sine', f: 240, f2: 120, t: 0.08, d: 0.12, a: 0.002, v: 0.24 });
  },
  roar(S) { // cute "rawr!"
    S.tone({ w: 'sawtooth', f: 250, f2: 185, d: 0.6, a: 0.04, v: 0.15, lp: [1600, 800], vib: [26, 45] });
    S.tone({ w: 'triangle', f: 125, f2: 92, d: 0.55, a: 0.05, v: 0.2 });
    S.noise({ c: 'pink', d: 0.55, a: 0.05, v: 0.18, bp: [800, 450, 1], am: [28, 0.5] });
    S.rev(0.15);
  },
  horn(S) { // friendly "toot"
    S.tone({ w: 'sawtooth', f: 320, f2: 345, fd: 0.06, d: 0.42, a: 0.03, v: 0.12, env: 'hold', rel: 0.1, lp: 1500, vib: [5, 12, 0.15] });
    S.tone({ w: 'square', f: 160, f2: 172, fd: 0.06, d: 0.42, a: 0.03, v: 0.05, env: 'hold', rel: 0.1, lp: 800 });
    S.rev(0.2);
  },
  hammer(S) {
    S.tone({ w: 'sine', f: 170, f2: 70, d: 0.2, a: 0.002, v: 0.5 });
    S.tone({ w: 'triangle', f: 820, f2: 620, d: 0.07, a: 0.001, v: 0.14 });
    S.noise({ c: 'white', d: 0.05, a: 0.001, v: 0.18, bp: [1500] });
  },
  beam(S) {
    S.tone({ w: 'sine', f: 900, f2: 1300, d: 0.55, a: 0.02, v: 0.12, env: 'hold', rel: 0.12, vib: [30, 60] });
    S.fm({ f: 450, ratio: 2, idx: [1, 1], d: 0.55, a: 0.02, v: 0.09, env: 'hold', rel: 0.12 });
    S.noise({ c: 'white', d: 0.5, a: 0.03, v: 0.04, hp: 6000 });
    S.rev(0.25);
  },
  spin(S) {
    S.noise({ c: 'white', d: 0.5, a: 0.05, v: 0.28, bp: [800, 2600, 2, 0.3], am: [14, 0.8] });
    S.tone({ w: 'triangle', f: 400, f2: 900, d: 0.5, a: 0.05, v: 0.06, am: [14, 0.8] });
  },
  quake(S) {
    S.noise({ c: 'brown', d: 1.1, a: 0.05, v: 0.7, lp: [320, 120], am: [9, 0.5] });
    S.tone({ w: 'sine', f: 58, f2: 46, d: 1.0, a: 0.02, v: 0.38, am: [7, 0.5] });
    for (let i = 0; i < 4; i++) S.noise({ c: 'pink', t: S.rnd(0.05, 0.7), d: 0.12, a: 0.004, v: 0.12, lp: [900, 300] });
  },
  explode(S) { // big but round, ends with a sparkle
    S.noise({ c: 'pink', d: 0.8, a: 0.003, v: 0.55, lp: [2600, 200, 0.7] });
    S.tone({ w: 'sine', f: 95, f2: 32, d: 0.55, a: 0.003, v: 0.55 });
    S.noise({ c: 'white', d: 0.3, a: 0.002, v: 0.18, bp: [1100, 300, 1] });
    sparkles(S, 0.12, 3, 0.06, 0.3);
    S.rev(0.25);
  },
  hit(S) {
    S.tone({ w: 'sine', f: 620, f2: 260, d: 0.1, a: 0.002, v: 0.38 });
    S.noise({ c: 'white', d: 0.05, a: 0.001, v: 0.22, bp: [2600, 1200, 1.5] });
  },
  pop(S) { // enemy defeated: cute pop + sparkle
    S.tone({ w: 'sine', f: 420, f2: 1350, fd: 0.05, d: 0.1, a: 0.002, v: 0.38 });
    S.noise({ c: 'white', d: 0.045, a: 0.001, v: 0.22, bp: [3500, 2000, 1.2] });
    S.arp('glock', ['E6', 'G6', 'C7'], 0.04, 0.045, 0.3, 0.42);
    S.tone({ w: 'sine', f: 2093, d: 0.35, t: 0.12, a: 0.004, v: 0.04 });
    S.rev(0.25);
  },
  hurt(S) { // "ouch" — soft wobble down, never harsh
    S.tone({ w: 'triangle', f: 760, f2: 380, d: 0.3, a: 0.005, v: 0.3, vib: [18, 60] });
    S.tone({ w: 'square', f: 380, f2: 190, d: 0.22, a: 0.005, v: 0.04, lp: 1400 });
  },
  shield(S) {
    S.fm({ f: 520, ratio: 1.5, idx: [2.5, 0.8], d: 0.7, a: 0.05, v: 0.12 });
    S.chord('glasspad', ['C5', 'G5', 'C6'], 0, 0.45, 0.6, { a: 0.05, r: 0.4 });
    S.noise({ c: 'white', d: 0.5, a: 0.1, v: 0.05, hp: 6000, am: [16, 0.5] });
    S.rev(0.3);
  },
  block(S) {
    S.fm({ f: 1500, ratio: 2.7, idx: [2, 0.1], d: 0.25, a: 0.001, v: 0.17 });
    S.noise({ c: 'white', d: 0.035, a: 0.001, v: 0.2, bp: [4000] });
    S.tone({ w: 'sine', f: 300, f2: 200, d: 0.08, a: 0.002, v: 0.2 });
  },
  charge(S) {
    S.tone({ w: 'sawtooth', f: 180, f2: 900, fd: 0.9, d: 1.0, a: 0.1, v: 0.07, env: 'hold', rel: 0.1, lp: [700, 3800], am: [10, 0.4] });
    S.tone({ w: 'sine', f: 360, f2: 1800, fd: 0.9, d: 1.0, a: 0.1, v: 0.1, env: 'hold', rel: 0.1 });
    S.noise({ c: 'white', d: 1.0, a: 0.8, v: 0.06, hp: 6000, env: 'hold', rel: 0.1 });
    S.rev(0.2);
  },
  release(S) {
    S.noise({ c: 'white', d: 0.32, a: 0.004, v: 0.33, bp: [3000, 800, 1] });
    S.tone({ w: 'sine', f: 1500, f2: 500, d: 0.3, a: 0.003, v: 0.22 });
    S.note('bell', 'C6', 0.02, 0.4, 0.5);
    S.rev(0.25);
  },

  // ------------------------------------------------------------------ items / UI
  coin(S) { // star candy: bright two-note "ting-ting"
    S.tone({ w: 'sine', f: 1975.5, d: 0.12, a: 0.002, v: 0.26 });
    S.tone({ w: 'sine', f: 3951, d: 0.06, a: 0.001, v: 0.04 });
    S.tone({ w: 'sine', f: 2637, t: 0.065, d: 0.38, a: 0.002, v: 0.27 });
    S.tone({ w: 'sine', f: 5274, t: 0.065, d: 0.12, a: 0.001, v: 0.04 });
    S.rev(0.18);
  },
  coinBig(S) {
    S.arp('celesta', ['C6', 'E6', 'G6', 'C7'], 0, 0.055, 0.3, 0.75);
    S.chord('bell', ['C7', 'E7'], 0.22, 0.6, 0.55);
    S.noise({ c: 'white', d: 0.6, a: 0.05, v: 0.05, hp: 7000, am: [20, 0.6] });
    S.rev(0.3);
  },
  heart(S) {
    S.note('marimba', 'G5', 0, 0.2, 0.7);
    S.note('marimba', 'C6', 0.1, 0.3, 0.8);
    S.note('bell', 'E6', 0.1, 0.5, 0.45);
    S.chord('glasspad', ['C5', 'E5', 'G5'], 0, 0.35, 0.45, { a: 0.05, r: 0.4 });
    S.rev(0.25);
  },
  heal(S) {
    S.arp('harp', ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], 0, 0.06, 0.6, 0.6);
    S.chord('glasspad', ['C5', 'E5', 'G5', 'C6'], 0, 0.6, 0.55, { a: 0.15, r: 0.6 });
    S.noise({ c: 'white', d: 0.8, a: 0.3, v: 0.04, hp: 6000, am: [14, 0.6] });
    S.rev(0.35);
  },
  cookie(S) { // crunch-crunch + "yum!"
    S.noise({ c: 'white', d: 0.05, a: 0.001, v: 0.22, bp: [2500, 1500, 1.5] });
    S.noise({ c: 'white', t: 0.075, d: 0.05, a: 0.001, v: 0.2, bp: [2100, 1300, 1.5] });
    S.note('celesta', 'E6', 0.13, 0.2, 0.65);
    S.note('celesta', 'A6', 0.21, 0.3, 0.7);
    S.rev(0.2);
  },
  key(S) {
    S.arp('glock', ['E6', 'G#6', 'B6', 'E7'], 0, 0.05, 0.3, 0.45);
    S.fm({ f: 2000, ratio: 3.1, idx: [1.5, 0.1], d: 0.4, a: 0.002, v: 0.06 });
    S.rev(0.3);
  },
  unlock(S) {
    S.noise({ c: 'white', d: 0.025, a: 0.001, v: 0.28, bp: [3000, 2000, 2] });
    S.tone({ w: 'square', f: 1200, d: 0.03, a: 0.001, v: 0.04, lp: 3000 });
    S.noise({ c: 'white', t: 0.08, d: 0.03, a: 0.001, v: 0.28, bp: [2200, 1500, 2] });
    S.arp('celesta', ['C6', 'G6', 'C7'], 0.14, 0.06, 0.35, 0.6);
    S.rev(0.25);
  },
  door(S) { // cute wooden "bwomp"
    S.tone({ w: 'sine', f: 165, f2: 98, d: 0.5, a: 0.02, v: 0.34 });
    S.noise({ c: 'pink', d: 0.5, a: 0.05, v: 0.22, lp: [900, 300] });
    S.noise({ c: 'white', d: 0.4, a: 0.1, v: 0.04, bp: [1200, 600, 3] });
    S.rev(0.2);
  },
  switch(S) {
    S.noise({ c: 'white', d: 0.02, a: 0.001, v: 0.28, bp: [3200, 2500, 2] });
    S.tone({ w: 'sine', f: 880, f2: 1320, t: 0.02, fd: 0.04, d: 0.14, a: 0.003, v: 0.2 });
  },
  gateOpen(S) {
    S.noise({ c: 'brown', d: 1.0, a: 0.1, v: 0.5, lp: [420, 150], am: [12, 0.3] });
    S.tone({ w: 'sine', f: 72, f2: 64, d: 0.9, a: 0.05, v: 0.24 });
    S.arp('celesta', ['C5', 'G5', 'C6', 'E6', 'G6'], 0.6, 0.07, 0.5, 0.55);
    S.rev(0.3);
  },
  break(S) { // crate pops apart
    S.noise({ c: 'white', d: 0.2, a: 0.002, v: 0.4, bp: [1200, 600, 1] });
    S.noise({ c: 'white', t: 0.03, d: 0.08, a: 0.001, v: 0.28, bp: [2400] });
    S.noise({ c: 'white', t: 0.07, d: 0.1, a: 0.001, v: 0.26, bp: [900] });
    S.tone({ w: 'sine', f: 190, f2: 80, d: 0.15, a: 0.002, v: 0.34 });
  },
  crumble(S) {
    for (let i = 0; i < 8; i++) S.noise({ c: 'pink', t: i * 0.06 + S.rnd(0, 0.03), d: 0.1, a: 0.002, v: 0.3 * (1 - i / 10), lp: [S.rnd(700, 1300), 300] });
    S.tone({ w: 'sine', f: 90, f2: 50, d: 0.5, a: 0.01, v: 0.2 });
  },
  cage(S) {
    S.fm({ f: 420, ratio: 3.1, idx: [3, 0.3], d: 0.6, a: 0.002, v: 0.17 });
    S.fm({ f: 630, ratio: 2.4, idx: [2, 0.2], t: 0.03, d: 0.5, a: 0.002, v: 0.1 });
    S.noise({ c: 'white', d: 0.05, a: 0.001, v: 0.2, bp: [3000] });
    S.rev(0.2);
  },
  checkpoint(S) {
    S.arp('bell', ['C6', 'G6', 'C7'], 0, 0.1, 0.8, 0.6);
    S.chord('glasspad', ['C5', 'E5', 'G5', 'C6'], 0, 0.7, 0.5, { a: 0.1, r: 0.6 });
    S.noise({ c: 'white', d: 0.9, a: 0.2, v: 0.04, hp: 7000, am: [16, 0.7] });
    S.rev(0.35);
  },
  sparkle(S) { sparkles(S, 0, 4, 0.06, 0.35); S.rev(0.35); },
  transform(S) { // magical poof
    poof(S, 0, 3000, 700, 0.35, 0.35);
    S.tone({ w: 'sine', f: 300, f2: 1200, d: 0.4, a: 0.01, v: 0.1 });
    S.arp('celesta', ['C6', 'D6', 'E6', 'G6', 'A6', 'C7'], 0.15, 0.04, 0.35, 0.5);
    S.chord('glasspad', ['C5', 'G5', 'E6'], 0.1, 0.4, 0.45, { a: 0.1, r: 0.5 });
    S.rev(0.35);
  },
  petSummon(S) {
    S.tone({ w: 'sine', f: 900, f2: 1700, fd: 0.12, d: 0.2, a: 0.01, v: 0.18, vib: [9, 20] });
    S.tone({ w: 'sine', f: 1100, f2: 2000, fd: 0.1, t: 0.14, d: 0.2, a: 0.01, v: 0.18 });
    S.tone({ w: 'sine', f: 420, f2: 1300, fd: 0.05, t: 0.3, d: 0.1, a: 0.002, v: 0.25 });
    S.arp('marimba', ['C6', 'E6', 'G6'], 0.32, 0.06, 0.3, 0.6);
    S.rev(0.25);
  },
  petAbility(S) {
    S.fm({ f: 600, f2: 1400, ratio: 2, idx: [2, 0.5], d: 0.35, a: 0.01, v: 0.13 });
    S.arp('celesta', ['E6', 'G6', 'B6'], 0.15, 0.05, 0.3, 0.5);
    S.rev(0.3);
  },
  menuMove(S) {
    S.tone({ w: 'sine', f: 1180, d: 0.045, a: 0.002, v: 0.12 });
    S.tone({ w: 'sine', f: 2360, d: 0.03, a: 0.001, v: 0.025 });
    S.rev(0.05);
  },
  menuSelect(S) {
    S.note('celesta', 'E6', 0, 0.1, 0.6);
    S.note('celesta', 'A6', 0.06, 0.2, 0.7);
    S.tone({ w: 'sine', f: 1760, t: 0.06, d: 0.15, a: 0.003, v: 0.04 });
    S.rev(0.15);
  },
  menuBack(S) {
    S.note('celesta', 'A5', 0, 0.15, 0.5);
    S.note('celesta', 'E5', 0.07, 0.2, 0.45);
    S.rev(0.12);
  },
  pause(S) {
    S.note('glass', 'C6', 0, 0.1, 0.6);
    S.note('glass', 'G5', 0.1, 0.18, 0.55);
    S.rev(0.2);
  },
  blip(S) { // dialog typewriter: tiny & soft
    S.tone({ w: 'triangle', f: S.rnd(560, 660), d: 0.03, a: 0.002, v: 0.09, lp: 2400 });
    S.rev(0.02);
  },
  notify(S) {
    S.note('bell', 'G5', 0, 0.4, 0.45, { index: 1.4 });
    S.note('bell', 'C6', 0.14, 0.6, 0.5, { index: 1.4 });
    S.rev(0.25);
  },
  timer(S) {
    S.drum('t', 0, 0.8);
    S.tone({ w: 'sine', f: 2000, d: 0.03, a: 0.001, v: 0.04 });
    S.rev(0.05);
  },
  success(S) {
    S.arp('celesta', ['C5', 'E5', 'G5', 'C6'], 0, 0.07, 0.3, 0.7);
    S.chord('bell', ['C6', 'E6', 'G6'], 0.28, 0.7, 0.45);
    S.chord('glasspad', ['C5', 'E5', 'G5'], 0.28, 0.4, 0.45, { a: 0.05, r: 0.5 });
    S.rev(0.3);
  },
  fail(S) { // gentle "bwoo-bwoo"
    S.note('glass', 'G4', 0, 0.18, 0.75);
    S.note('glass', 'E4', 0.2, 0.32, 0.65);
    S.tone({ w: 'triangle', f: 196, f2: 185, d: 0.2, a: 0.01, v: 0.08 });
    S.tone({ w: 'triangle', f: 165, f2: 150, t: 0.2, d: 0.35, a: 0.01, v: 0.07 });
    S.rev(0.15);
  },
  bell(S) { S.note('bell', 'C6', 0, 1.2, 0.85); S.rev(0.35); },
  // four distinct pitched drums for the Simon game (C3, E3, G3, C4 — a C major chord)
  drum1(S) { // deep taiko
    S.tone({ w: 'sine', f: 140, f2: 130.8, fd: 0.05, d: 0.6, a: 0.004, v: 0.55 });
    S.tone({ w: 'sine', f: 261.6, d: 0.18, a: 0.002, v: 0.12 });
    S.noise({ c: 'pink', d: 0.08, a: 0.001, v: 0.25, lp: [1200, 300] });
    S.rev(0.15);
  },
  drum2(S) { // round tom
    S.tone({ w: 'sine', f: 178, f2: 164.8, fd: 0.06, d: 0.45, a: 0.004, v: 0.5 });
    S.tone({ w: 'triangle', f: 329.6, d: 0.12, a: 0.002, v: 0.1 });
    S.noise({ c: 'white', d: 0.04, a: 0.001, v: 0.12, lp: [2000, 600] });
    S.rev(0.15);
  },
  drum3(S) { // conga with a slap
    S.tone({ w: 'sine', f: 210, f2: 196, fd: 0.04, d: 0.35, a: 0.001, v: 0.48 });
    S.tone({ w: 'sine', f: 392, d: 0.1, a: 0.001, v: 0.12 });
    S.noise({ c: 'white', d: 0.035, a: 0.001, v: 0.18, bp: [2200, 1500, 1.5] });
    S.rev(0.15);
  },
  drum4(S) { // bright bongo
    S.tone({ w: 'sine', f: 280, f2: 261.6, fd: 0.03, d: 0.25, a: 0.001, v: 0.45 });
    S.tone({ w: 'sine', f: 523.3, d: 0.08, a: 0.001, v: 0.12 });
    S.noise({ c: 'white', d: 0.025, a: 0.001, v: 0.16, bp: [3200, 2200, 2] });
    S.rev(0.15);
  },
  quizRight(S) {
    S.note('celesta', 'E6', 0, 0.12, 0.7);
    S.note('celesta', 'C7', 0.09, 0.35, 0.8);
    S.tone({ w: 'sine', f: 2093, t: 0.09, d: 0.4, a: 0.003, v: 0.05 });
    S.rev(0.25);
  },
  quizWrong(S) {
    S.note('glass', 'D5', 0, 0.16, 0.6);
    S.note('glass', 'B4', 0.18, 0.28, 0.55);
    S.rev(0.15);
  },
  whoosh(S) {
    S.noise({ c: 'white', d: 0.38, a: 0.12, v: 0.28, bp: [400, 2200, 1.2, 0.22] });
    S.noise({ c: 'pink', d: 0.3, a: 0.1, v: 0.1, lp: [600, 1200] });
  },
  chime(S) { // wind chime
    for (let i = 0; i < 4; i++) S.note('bell', pick(S, PENTA_HI.slice(0, 6)), i * S.rnd(0.08, 0.14), 0.8, 0.35 * S.rnd(0.7, 1), { ratio: 2.76, index: 1.2 });
    S.rev(0.4);
  },
  crystal(S) {
    S.fm({ f: 2349, ratio: 2.76, idx: [1.2, 0.05], d: 1.2, a: 0.002, v: 0.11 });
    S.fm({ f: 3136, ratio: 2.76, idx: [1, 0.05], t: 0.05, d: 1.0, a: 0.002, v: 0.07 });
    S.note('glock', 'A6', 0.02, 0.5, 0.35);
    S.rev(0.4);
  },
  honey(S) { // sticky "blop"
    S.tone({ w: 'sine', f: 520, f2: 300, fd: 0.2, d: 0.35, a: 0.01, v: 0.28, lp: 1200, vib: [8, 50] });
    S.tone({ w: 'sine', f: 300, f2: 180, t: 0.18, d: 0.25, a: 0.01, v: 0.2 });
    S.rev(0.12);
  },
  snow(S) { // soft crunch
    S.noise({ c: 'white', d: 0.12, a: 0.01, v: 0.22, hp: 2500, lp: 7000 });
    S.noise({ c: 'pink', d: 0.1, a: 0.005, v: 0.14, lp: 1500 });
    S.rev(0.08);
  },
  gear(S) {
    for (let i = 0; i < 6; i++) S.noise({ c: 'white', t: i * 0.045, d: 0.016, a: 0.001, v: 0.22, bp: [3500, 3000, 3] });
    S.tone({ w: 'sine', f: 2600, t: 0.27, d: 0.15, a: 0.002, v: 0.08 });
  },
  laser(S) {
    S.tone({ w: 'square', f: 1800, f2: 300, d: 0.16, a: 0.002, v: 0.07, lp: 4000 });
    S.tone({ w: 'sine', f: 1800, f2: 300, d: 0.17, a: 0.002, v: 0.15 });
  },
  saw(S) { // buzz-saw hazard (filtered so it never gets harsh)
    S.tone({ w: 'sawtooth', f: 210, d: 0.6, a: 0.03, v: 0.06, env: 'hold', rel: 0.12, lp: 2500, am: [32, 0.6] });
    S.noise({ c: 'white', d: 0.6, a: 0.03, v: 0.09, env: 'hold', rel: 0.12, bp: [3200, 3200, 2], am: [32, 0.6] });
  },
  crusher(S) {
    S.tone({ w: 'sine', f: 82, f2: 40, d: 0.42, a: 0.002, v: 0.6 });
    S.noise({ c: 'pink', d: 0.36, a: 0.002, v: 0.4, lp: [1600, 200] });
    S.fm({ f: 300, ratio: 2.4, idx: [3, 0.3], d: 0.3, a: 0.002, v: 0.08 });
  },
  lightning(S) {
    S.noise({ c: 'white', d: 0.25, a: 0.001, v: 0.3, hp: 1500, am: [40, 0.8] });
    S.noise({ c: 'pink', t: 0.05, d: 0.8, a: 0.01, v: 0.35, lp: [3000, 300] });
    S.tone({ w: 'sine', f: 2000, f2: 200, d: 0.1, a: 0.001, v: 0.08 });
    S.rev(0.3);
  },
  rain(S) {
    S.noise({ c: 'pink', d: 2.0, a: 0.4, v: 0.2, env: 'hold', rel: 0.5, hp: 900, lp: 6000 });
    for (let i = 0; i < 12; i++) { const f = S.rnd(1500, 3500); S.tone({ w: 'sine', f, f2: f * 0.6, t: S.rnd(0.05, 1.8), d: 0.04, a: 0.001, v: 0.05 }); }
    S.rev(0.2);
  },
  thunder(S) {
    S.noise({ c: 'brown', d: 2.6, a: 0.08, v: 0.75, lp: [650, 150], am: [3, 0.3] });
    S.noise({ c: 'pink', d: 0.35, a: 0.005, v: 0.25, lp: [2200, 300] });
    S.rev(0.35);
  },
  bossRoar(S) {
    S.tone({ w: 'sawtooth', f: 112, f2: 86, d: 1.2, a: 0.08, v: 0.17, lp: [1200, 600], vib: [24, 35] });
    S.tone({ w: 'sawtooth', f: 168, f2: 129, d: 1.1, a: 0.1, v: 0.08, lp: 1000 });
    S.noise({ c: 'pink', d: 1.1, a: 0.1, v: 0.24, bp: [600, 350, 1], am: [26, 0.5] });
    S.tone({ w: 'sine', f: 56, d: 1.0, a: 0.1, v: 0.22 });
    S.rev(0.3);
  },
  bossHit(S) {
    S.tone({ w: 'sine', f: 175, f2: 70, d: 0.26, a: 0.002, v: 0.52 });
    S.noise({ c: 'white', d: 0.15, a: 0.001, v: 0.34, bp: [1300, 500, 1] });
    S.fm({ f: 700, ratio: 2.7, idx: [2.5, 0.1], d: 0.25, a: 0.002, v: 0.08 });
    S.rev(0.2);
  },
  bossDown(S) {
    S.tone({ w: 'sine', f: 720, f2: 150, d: 1.2, a: 0.02, v: 0.18, vib: [10, 80] });
    for (const t of [0.3, 0.62, 0.95]) {
      S.noise({ c: 'pink', t, d: 0.4, a: 0.003, v: 0.35, lp: [2200, 250] });
      S.tone({ w: 'sine', f: 95, f2: 38, t, d: 0.35, a: 0.003, v: 0.35 });
    }
    S.arp('glock', ['C7', 'G6', 'E6', 'C6'], 1.15, 0.06, 0.4, 0.4);
    S.arp('celesta', ['C6', 'E6', 'G6', 'C7', 'E7'], 1.35, 0.06, 0.5, 0.5);
    S.rev(0.35);
  },
  colorBloom(S) { // big magical bloom
    S.noise({ c: 'white', d: 2.6, a: 1.0, v: 0.06, hp: [3000, 8000], am: [14, 0.5] });
    S.chord('glasspad', ['C4', 'G4', 'E5', 'B5', 'D6'], 0, 1.4, 0.85, { a: 0.8, r: 1.2 });
    S.arp('harp', ['C4', 'G4', 'C5', 'E5', 'G5', 'B5', 'D6', 'E6', 'G6', 'B6'], 0.2, 0.07, 1.0, 0.6);
    S.chord('bell', ['C6', 'E6', 'G6'], 1.0, 1.5, 0.6);
    S.drum('y', 1.0, 0.3);
    S.tone({ w: 'sine', f: 130.8, d: 2.0, a: 0.8, v: 0.14 });
    S.rev(0.5);
  },
  heartbeat(S) { // lub-dub
    S.tone({ w: 'sine', f: 72, f2: 52, d: 0.15, a: 0.004, v: 0.55 });
    S.tone({ w: 'sine', f: 64, f2: 48, t: 0.2, d: 0.17, a: 0.004, v: 0.45 });
    S.rev(0.05);
  },
  star(S) { // Noa's twinkle
    S.fm({ f: 2637, ratio: 2.0, idx: [1, 0.1], d: 0.8, a: 0.003, v: 0.1, vib: [7, 30] });
    S.note('celesta', 'B6', 0.1, 0.3, 0.5);
    S.note('celesta', 'E7', 0.2, 0.4, 0.4);
    S.rev(0.45);
  },
  cry(S) { // soft sad tone
    S.tone({ w: 'sine', f: 740, f2: 560, fd: 0.8, d: 0.95, a: 0.08, v: 0.13, env: 'hold', rel: 0.3, vib: [5.5, 35, 0.1, 0.2] });
    S.tone({ w: 'sine', f: 1480, f2: 1120, fd: 0.8, d: 0.9, a: 0.08, v: 0.018, env: 'hold', rel: 0.3 });
    S.noise({ c: 'pink', d: 0.6, a: 0.2, v: 0.02, bp: [1500] });
    S.rev(0.4);
  },
};

// Per-sound level trim in dB (measured momentary loudness -> category targets: tiny UI/footsteps ~-32 LUFS,
// movement ~-25, impacts ~-21, rewards / big moments ~-15). Applied by the engine on top of the `vol` option.
export const SFX_GAIN = {
  beam: -4.3, bell: -0.7, bite: 3.5, blip: 10.3, block: 2.8, boomerang: 1.5, bossDown: -0.7, bossHit: 2.8,
  bossRoar: 4.3, bounce: -1.7, break: 3.7, bubble: 1.7, cage: 0.0, cannon: -0.3, charge: -2.9, checkpoint: -2.1,
  chime: 1.1, climb: 9.1, coin: -0.9, coinBig: -3.0, colorBloom: -2.1, cookie: -1.6, crumble: 2.7, crusher: 0.4,
  cry: -3.4, crystal: -0.5, dash: 8.9, dive: 0.6, door: -1.0, drum1: -1.8, drum2: -0.3, drum3: 1.2, drum4: 3.0,
  explode: 0.3, fail: -3.3, fire: 4.9, flap: 6.6, gateOpen: -1.7, gear: 6.1, glide: 6.9, hammer: 1.4, heal: -4.0,
  heart: -3.4, heartbeat: 1.2, hit: 4.7, honey: -0.9, horn: -0.4, hurt: 4.6, ice: 0.3, jump: 3.3, jump2: 1.2,
  key: -1.6, land: 1.5, laser: 2.4, lightning: 4.7, magic: -4.2, menuBack: -1.3, menuMove: 7.7, menuSelect: -3.5,
  notify: 0.6, pause: -2.0, petAbility: -1.7, petSummon: -1.5, pop: -0.4, punch: 2.7, quake: -0.2, quizRight: -1.4,
  quizWrong: -1.8, rain: 1.0, release: 0.0, roar: 2.7, roll: 2.1, saw: 2.4, shield: -3.0, shoot: 2.2, slide: 1.8,
  snow: 3.7, sparkle: -1.7, spin: 9.0, splash: 0.7, star: -1.6, step: 7.3, success: -4.0, swim: 6.5, swipe: 8.2,
  switch: 4.0, teleport: -2.7, throw: 8.8, thunder: 1.1, timer: 2.0, transform: -2.6, unlock: -2.1, water: 5.2,
  whoosh: 6.1, wind: 9.0,
};

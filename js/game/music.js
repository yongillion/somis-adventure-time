// ============================================================================
// music.js — soundtrack data for "소미의 어드벤처 타임" (rendered by js/engine/audio.js)
//
// Song format
//   { bpm, beats=4 (per bar), steps=8 (melody grid per bar), dsteps=16 (drum grid), swing=0..0.35 (shuffle),
//     tr=0 (transpose semitones), loopStart=0 (bars of intro played once), chords, parts[] }
//   chords: bars separated by '|'; several chords in one bar split it evenly. e.g. 'C | G/B | Am F'.
//   Melody part:   { inst, mel: 'G4 - E5 - - - D5 C5 | ...', at: startBar, oct, vol, pan, rev, opts, glide }
//                  tokens: note (C5, F#4, Bb3, C5+E5) [! accent | ? soft], '-' hold, '.' rest
//   Generators:    { inst, gen: 'pad' | 'arp' | 'bass' | 'stab', pat, lo (lowest midi), n (voices), bars: [from, to) }
//                  arp tokens = chord-tone index (0 = lowest tone >= lo; bassFirst: 0 = bass note),
//                  bass tokens = R (bass) r (root) 5 3 7 8 (octave) a (chromatic approach to next chord) or a note name,
//                  stab tokens = x / X / o (chord hit normal / accent / soft)
//   Drums:         { drums: { k: 'x...x...', s: '....x...' }, fill: { every: 8, s: '...' } }  — letters in audio.js (DRUMS)
// Instruments (audio.js INST/CHORD): musicbox celesta glock bell marimba toypiano harp guitar pizz piano flute whistle glass
//   lead pluck chip brass strings bubble timp choirlead synbass softbass drivebass | chord voices: pad warmpad glasspad choir.
//   All are loudness-normalized, so part `vol` is the mix balance (melody ~0.8-1, accompaniment 0.3-0.6). `gain` per song
//   trims the whole track to its loudness target (stages ~-18.5 LUFS at default music volume).
// All melodies were written for this game. The main theme ("Noa's Lullaby") appears in title, opening (quote),
// moon (stage 8), noa, ending, credits and, in minor, in memory and finalboss.
// ============================================================================

// ------------------------------------------------------------------ main theme (C major, 8 steps per bar)
// Key C major. Hook: rising sixth (sol -> mi') falling back by step; bass descends C-B-A-G-F-E-D-G.
// The second half climbs to A5 over F and turns bittersweet on F minor (Ab5) before resolving home.
const THEME_A = `G4 - E5 - - - D5 C5 | D5 - - - G4 - - - | E4 - C5 - - - B4 A4 | B4 - - - G4 - - - |
                 A4 - F5 - - - E5 D5 | E5 - - - C5 - - - | F5 - - - E5 - D5 - | D5 - - - B4 - - -`;
const THEME_A2 = `G4 - E5 - - - D5 C5 | D5 - - - G4 - - - | E4 - C5 - - - B4 A4 | B4 - - - G4 - A4 B4 |
                  C5 - A5 - - - G5 F5 | Ab5 - - - G5 - - - | E5 - - - D5 - - - | C5 - - - - - - -`;
const THEME_B = `A5 - - G5 F5 - C5 - | D5 - - E5 - - G5 - | G5 - - F5 E5 - B4 - | C5 - - D5 - - E5 - |
                 F5 - - E5 D5 - A4 - | B4 - - C5 - - D5 - | E5 - - D5 C#5 - A4 - | F5 - E5 - D5 - B4 -`;
const TH_A = 'C | G/B | Am | Em/G | F | C/E | Dm7 | G';
const TH_A2 = 'C | G/B | Am | Em/G | F | Fm | C/G G7 | C';
const TH_B = 'F | G | Em | Am | Dm7 | G | Em7 A7 | Dm7 G7';
const J = (...xs) => xs.join(' | ');

// ------------------------------------------------------------------ title: music box lullaby (C, 84 bpm)
const title = {
  bpm: 84, gain: 1.202, loopStart: 2,
  chords: J('Cmaj7', 'Fmaj7', TH_A, TH_A2, 'Fmaj7', 'G7sus4'),
  parts: [
    { inst: 'musicbox', mel: J(THEME_A, THEME_A2), at: 2, oct: 1, vol: 0.85, pan: 0.05, rev: 0.38 },
    // music-box broken chords: quarters in the first half, flowing eighths in the second
    { inst: 'musicbox', gen: 'arp', bassFirst: true, lo: 52, pat: '0 . 2 . 3 . 2 .', bars: [2, 10], vol: 0.42, pan: -0.15, rev: 0.35 },
    { inst: 'musicbox', gen: 'arp', bassFirst: true, lo: 52, pat: '0 2 3 4 3 2 3 2', bars: [10, 18], vol: 0.36, pan: -0.15, rev: 0.35 },
    // intro / interlude sparkles
    { inst: 'musicbox', gen: 'arp', lo: 72, pat: '4 . 3 . 2 . 1 . | 3 . 2 . 1 . 0 .', bars: [0, 2], vol: 0.5, pan: 0.2, rev: 0.5 },
    { inst: 'musicbox', gen: 'arp', lo: 67, pat: '0 1 2 3 4 5 6 7 | 7 6 5 4 3 2 1 0', bars: [18, 20], vol: 0.45, pan: 0.2, rev: 0.5 },
    { inst: 'warmpad', gen: 'pad', lo: 55, n: 4, vol: 0.55, rev: 0.55 },
    { inst: 'bell', gen: 'arp', lo: 79, pat: '0 . . . . . . . | . . . . . . 1 .', bars: [2, 20], vol: 0.32, pan: 0.3, rev: 0.65, opts: { ratio: 3.5, index: 1.6 } },
    { inst: 'softbass', gen: 'bass', lo: 36, pat: 'R - - - - - - -', bars: [10, 20], vol: 0.28, rev: 0.1 },
  ],
};

// ------------------------------------------------------------------ noa: theme, slow piano + strings (Bb, 72 bpm)
const noa = {
  bpm: 72, gain: 0.804, tr: -2, loopStart: 2,
  chords: J('Fmaj7', 'G7sus4 G7', TH_A, TH_A2),
  parts: [
    { inst: 'piano', mel: THEME_A, at: 2, vol: 0.95, pan: 0.08, rev: 0.42, opts: { rel: 0.7 } },
    { inst: 'piano', mel: THEME_A2, at: 10, oct: 1, vol: 0.62, pan: 0.12, rev: 0.48, opts: { rel: 0.7 } },
    { inst: 'strings', mel: THEME_A2, at: 10, vol: 0.85, pan: -0.05, rev: 0.5, opts: { a: 0.3, r: 0.7 } },
    { inst: 'piano', gen: 'arp', bassFirst: true, lo: 40, pat: '0 2 3 4 5 4 3 2', vol: 0.5, pan: -0.12, rev: 0.42, opts: { rel: 1.0 } },
    { inst: 'strings', gen: 'pad', lo: 55, n: 3, bars: [2, 10], vol: 0.3, rev: 0.55, opts: { a: 0.9, r: 1.2 } },
    { inst: 'strings', gen: 'pad', lo: 55, n: 3, bars: [10, 18], vol: 0.38, rev: 0.55, opts: { a: 0.7, r: 1.2 } },
    { inst: 'strings', gen: 'bass', lo: 36, pat: 'R - - - - - - -', bars: [10, 18], vol: 0.55, rev: 0.4, opts: { cut: 1400, a: 0.4, r: 0.9 } },
    { inst: 'glasspad', gen: 'pad', lo: 64, n: 3, bars: [14, 18], vol: 0.3, rev: 0.7 },
  ],
};

// ------------------------------------------------------------------ ending: theme warm & full (D, 84 bpm)
const ending = {
  bpm: 84, gain: 0.785, tr: 2, loopStart: 2,
  chords: J('Fmaj7', 'G6', TH_A, TH_B, TH_A2),
  parts: [
    { inst: 'flute', mel: THEME_A, at: 2, vol: 0.85, pan: 0.05, rev: 0.4 },
    { inst: 'strings', mel: THEME_B, at: 10, vol: 0.95, pan: 0.0, rev: 0.45, opts: { a: 0.12, r: 0.5 } },
    { inst: 'celesta', mel: THEME_B, at: 10, oct: 1, vol: 0.4, pan: 0.25, rev: 0.5 },
    { inst: 'flute', mel: THEME_A2, at: 18, vol: 0.75, pan: 0.05, rev: 0.4 },
    { inst: 'piano', mel: THEME_A2, at: 18, oct: 1, vol: 0.45, pan: 0.2, rev: 0.45, opts: { rel: 0.5 } },
    { inst: 'strings', mel: THEME_A2, at: 18, oct: -1, vol: 0.6, pan: -0.15, rev: 0.45, opts: { a: 0.15 } },
    { inst: 'harp', gen: 'arp', lo: 48, pat: '0 1 2 3 4 3 2 1', vol: 0.5, pan: -0.25, rev: 0.45 },
    { inst: 'warmpad', gen: 'pad', lo: 52, n: 4, vol: 0.45, rev: 0.55 },
    { inst: 'choir', gen: 'pad', lo: 57, n: 3, bars: [10, 26], vol: 0.55, rev: 0.6, opts: { vowel: 'a' } },
    { inst: 'softbass', gen: 'bass', lo: 36, pat: 'R - - - 5 - - -', bars: [2, 26], vol: 0.45, rev: 0.1 },
    { drums: { k: 'x.......x.......', m: '..x...x...x...x.', c: '....x.......x...' }, bars: [10, 26], vol: 0.3, rev: 0.25,
      fill: { every: 8, s: '........x.x.xxxx' } },
    { drums: { p: 'x...............' }, bars: [18, 19], vol: 0.5, rev: 0.4, opts: { timpF: 73.42 } },
    { inst: 'bell', gen: 'arp', lo: 74, pat: '0 . . . . . . . | . . . . 1 . . .', bars: [18, 26], vol: 0.28, pan: 0.3, rev: 0.6 },
  ],
};

// ------------------------------------------------------------------ opening: storybook wonder (C, 70 bpm)
const OPEN_MEL = `E5 - - - A5 - G5 - | E5 - - - D5 - - - | G5 - - - B5 - A5 - | G5 - - - E5 - - - |
                  F5 - - - A5 - C6 - | C6 - - - B5 - - - | B5 - - - G5 - E5 - | G5 - - - - - - - |
                  E5 - - - A5 - G5 - | E5 - - - D5 - - - | G5 - - - E5 - C#5 - | D5 - - - - - - - |
                  G4 - E5 - - - D5 C5 | D5 - - - G4 - - - | A4 - - - Ab4 - - - | G4 - - - - - - -`;
const opening = {
  bpm: 70, gain: 1.084, loopStart: 0,
  chords: J('Fmaj7', 'G6', 'Em7', 'Am7', 'Dm7', 'G7sus4 G7', 'Cmaj7', 'Cmaj7', 'Fmaj7', 'G6', 'Em7 A7', 'Dm7', 'C', 'G/B', 'F Fm', 'C'),
  parts: [
    { inst: 'celesta', mel: OPEN_MEL, vol: 0.9, pan: 0.1, rev: 0.5 },
    { inst: 'musicbox', gen: 'arp', lo: 60, pat: '0 1 2 3 2 1 2 1', vol: 0.3, pan: -0.25, rev: 0.5 },
    { inst: 'strings', gen: 'pad', lo: 53, n: 4, vol: 0.25, rev: 0.6, opts: { a: 1.0, r: 1.4, cut: 2400 } },
    { inst: 'strings', gen: 'bass', lo: 36, pat: 'R - - - - - - -', vol: 0.4, rev: 0.4, opts: { cut: 1200, a: 0.6, r: 1.0 } },
    { inst: 'glock', gen: 'arp', lo: 84, pat: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . 0 . 2 .', vol: 0.3, pan: 0.35, rev: 0.7 },
    { inst: 'glasspad', gen: 'pad', lo: 67, n: 3, bars: [12, 16], vol: 0.3, rev: 0.7 },
  ],
};

// ------------------------------------------------------------------ memory: sad gentle music box (A minor, 66 bpm)
// The theme's hook and falling bass, mirrored into A minor.
const MEM_MEL = `E4 - C5 - - - B4 A4 | B4 - - - G4 - - - | A4 - F5 - - - E5 D5 | E5 - - - C5 - - - |
                 F5 - - - E5 - D5 - | C5 - - - A4 - - - | B4 - D5 - - - C5 B4 | B4 - - - G#4 - - - |
                 E4 - C5 - - - B4 A4 | B4 - - - G4 - - - | A4 - F5 - - - E5 D5 | E5 - - - C5 - - - |
                 D5 - F5 - - - E5 D5 | C5 - - - A4 - - - | B4 - - - G#4 - B4 - | A4 - - - - - - -`;
const memory = {
  bpm: 66, gain: 1.288,
  chords: 'Am | Em/G | F | C/E | Dm | Am/C | Bm7b5 | E7 | Am | Em/G | F | C/E | Dm | F | E7 | Am',
  parts: [
    { inst: 'musicbox', mel: MEM_MEL, oct: 1, vol: 0.85, pan: 0.05, rev: 0.45, opts: { decay: 1.2 } },
    { inst: 'musicbox', gen: 'arp', bassFirst: true, lo: 52, pat: '0 . 2 . 3 . 2 .', vol: 0.4, pan: -0.15, rev: 0.45 },
    { inst: 'glasspad', gen: 'pad', lo: 57, n: 3, vol: 0.32, rev: 0.65, opts: { a: 1.6, r: 2.0 } },
    { inst: 'celesta', mel: MEM_MEL, at: 0, oct: 0, vol: 0.18, pan: 0.3, rev: 0.7 },
  ],
};

// ------------------------------------------------------------------ map: cheerful walk, flute + marimba (G, 104 bpm)
const MAP_A = `B4 - D5 - G5 - - F#5 | E5 - G5 - E5 - C5 - | D5 - B4 - G4 - A4 B4 | A4 - - - - - . . |
               B4 - D5 - G5 - - F#5 | E5 - G5 - C6 - B5 A5 | G5 - E5 - F#5 - A5 - | G5 - - - - - . . `;
const MAP_B = `G5 - - F#5 E5 - B4 - | C5 - - D5 E5 - G5 - | D5 - - C5 B4 - G4 - | A4 - - B4 - - F#5 - |
               G5 - - F#5 E5 - B4 - | E5 - - F#5 G5 - C6 - | B5 - - A5 G5 - E5 - | F#5 - - - D5 - - - `;
const MAP_CH = 'G | C | G | D | G | C | Am7 D7 | G | Em | C | G | D | Em | C | Am7 | D7';
const map = {
  bpm: 104, gain: 0.989, swing: 0.12,
  chords: MAP_CH,
  parts: [
    { inst: 'flute', mel: J(MAP_A, MAP_B), vol: 0.85, pan: 0.05, rev: 0.3 },
    { inst: 'marimba', mel: MAP_A, vol: 0.45, pan: 0.15, rev: 0.25 },
    { inst: 'marimba', gen: 'arp', lo: 55, pat: '0 . 2 . 1 . 2 .', bars: [0, 8], vol: 0.4, pan: -0.2, rev: 0.2 },
    { inst: 'marimba', gen: 'stab', lo: 57, n: 3, pat: '. x . x . x . x', bars: [8, 16], vol: 0.32, pan: -0.2, rev: 0.2 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . . . 5 . . a', vol: 0.6, rev: 0.12 },
    { inst: 'warmpad', gen: 'pad', lo: 55, n: 3, bars: [8, 16], vol: 0.3, rev: 0.4 },
    { drums: { k: 'x.......x.......', f: '....x.......x...', m: 'oxoxoxoxoxoxoxox' }, vol: 0.45, rev: 0.15,
      fill: { every: 8, f: '....x.......x.x.', b: '..........x.B.B.' } },
  ],
};

// ------------------------------------------------------------------ meadow: Stage 1 flower fields (C, 128 bpm)
const MEADOW_A = `G5 . E5 C5 . E5 G5 . | A5 . E5 C5 . E5 A5 . | F5 . A5 C6 . D6 C6 . | G5 - - - D5 - - - |
                  G5 . E5 C5 . E5 G5 . | A5 . E5 C5 . E5 A5 . | F5 . E5 D5 . B4 D5 . | C5 - - - . . . . `;
const MEADOW_B = `A5 - - G5 A5 - C6 - | B5 - - A5 G5 - D5 - | E5 - - D5 E5 - G5 - | A5 - - - E5 - - - |
                  F5 - - E5 F5 - A5 - | G5 - - F5 D5 - B4 - | E5 - - D5 C5 - E5 - | F5 - - - D5 - B4 - `;
const MEADOW_CTR = `E6 - - - - - - - | C6 - - - - - - - | C6 - - - A5 - - - | B5 - - - - - - - |
                    E6 - - - - - - - | C6 - - - E6 - - - | D6 - - - B5 - - - | C6 - - - - - - - `;
const MEADOW_CH_A = 'C | Am | F | G | C | Am | Dm7 G7 | C';
const MEADOW_CH_B = 'F | G | Em | Am | Dm7 | G | Em7 Am7 | Dm7 G7';
const meadow = {
  bpm: 128, gain: 1.135, loopStart: 1,
  chords: J('G7', MEADOW_CH_A, MEADOW_CH_A, MEADOW_CH_B),
  parts: [
    { inst: 'pluck', mel: J('. . . . G4 A4 B4 D5', MEADOW_A, MEADOW_A), vol: 0.85, pan: 0.05, rev: 0.22 },
    { inst: 'pluck', mel: MEADOW_A, at: 9, oct: 1, vol: 0.25, pan: 0.2, rev: 0.3, opts: { sus: 0.1 } },
    { inst: 'lead', mel: MEADOW_B, at: 17, vol: 0.7, pan: 0.05, rev: 0.3 },
    { inst: 'pluck', mel: MEADOW_B, at: 17, oct: 1, vol: 0.22, pan: -0.2, rev: 0.3 },
    { inst: 'glock', mel: MEADOW_CTR, at: 9, vol: 0.4, pan: 0.3, rev: 0.4 },
    { inst: 'synbass', gen: 'bass', lo: 36, pat: 'R . 8 . R . 5 .', bars: [1, 25], vol: 0.6, rev: 0.05 },
    { inst: 'synbass', gen: 'bass', lo: 36, pat: 'R . . . . . . .', bars: [0, 1], vol: 0.6, rev: 0.05 },
    { inst: 'pluck', gen: 'stab', lo: 60, n: 3, pat: '. x . x . x . x', bars: [1, 25], vol: 0.3, pan: -0.25, rev: 0.2, opts: { sus: 0.05, d: 0.12 } },
    { inst: 'warmpad', gen: 'pad', lo: 55, n: 4, bars: [17, 25], vol: 0.35, rev: 0.4 },
    { drums: { k: 'x.......x.......', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', m: '..o...o...o...o.' }, bars: [1, 25], vol: 0.5, rev: 0.12,
      fill: { every: 8, c: '....x.......x.x.', N: '..........x.x...', n: '..............x.' } },
    { drums: { s: '........x.x.xxxx' }, bars: [0, 1], vol: 0.35, rev: 0.15 },
  ],
};

// ------------------------------------------------------------------ canyon: sunset fruit canyon, whistle + guitar shuffle (D, 112 bpm)
const CANYON_A = `A4 D5 . F#5 A5 - - - | G5 F#5 E5 D5 E5 - - - | B4 D5 . G5 B5 - - - | A5 G5 F#5 E5 F#5 - - - |
                  F#5 - - D5 B4 - D5 F#5 | G5 - - E5 B4 - E5 G5 | A5 - G5 - E5 - C#5 - | D5 - - - - - . . `;
const CANYON_B = `B5 - - A5 G5 - - - | A5 - - G5 E5 - - - | F#5 - - E5 C#5 - - - | D5 - - C#5 B4 - - - |
                  G4 B4 D5 G5 - - F#5 G5 | A5 - - - E5 - - - | G5 - F#5 - E5 - D5 - | C#5 - - - E5 - A4 - `;
const canyon = {
  bpm: 112, gain: 0.989, swing: 0.3,
  chords: 'D | D | G | D | Bm | Em7 | A7 | D | G | A | F#m | Bm | G | A | Em7 | A7',
  parts: [
    { inst: 'whistle', mel: J(CANYON_A, CANYON_B), glide: true, vol: 0.85, pan: 0.05, rev: 0.32 },
    { inst: 'guitar', gen: 'stab', lo: 52, n: 4, strum: 0.014, pat: '. . x . . . x x', vol: 0.3, pan: -0.25, rev: 0.2, opts: { ring: 0.05 } },
    { inst: 'guitar', gen: 'arp', bassFirst: true, lo: 50, pat: '0 . 2 3 1 . 2 3', bars: [8, 16], vol: 0.3, pan: 0.3, rev: 0.25 },
    { inst: 'softbass', gen: 'bass', lo: 36, pat: 'R . . . 5 . . .', vol: 0.55, rev: 0.08 },
    { inst: 'warmpad', gen: 'pad', lo: 54, n: 3, vol: 0.28, rev: 0.4 },
    { inst: 'marimba', gen: 'arp', lo: 69, pat: '. . . . . . . . | . . . . 2 . 1 .', bars: [0, 8], vol: 0.3, pan: 0.35, rev: 0.3 },
    { drums: { k: 'x.......x.......', r: '....x.......x...', m: 'x.x.x.x.x.x.x.x.' }, vol: 0.45, rev: 0.15,
      fill: { every: 8, r: '....x.......x.xx' } },
    { drums: { w: '..x...x...x...x.' }, bars: [8, 16], vol: 0.25, pan: 0.3, rev: 0.2 },
  ],
};

// ------------------------------------------------------------------ honey: sunflower honey hills, pizzicato + bells (F, 120 bpm)
const HONEY_A = `A4 . C5 . F5 . E5 F5 | G5 . . E5 C5 . . . | F5 . A5 . D6 . C#6 D6 | Bb5 . . F5 D5 . . . |
                 A4 . C5 . F5 . E5 F5 | Bb5 . . G5 F5 . D5 . | E5 . G5 . Bb5 . A5 G5 | F5 . C5 . F5 . . . `;
const HONEY_B = `F5 - - D5 - - Bb4 - | C5 - - E5 - - G5 - | A5 - - E5 - - C5 - | D5 - - F5 - - A5 - |
                 Bb5 - - A5 G5 - D5 - | E5 - - F5 G5 - C6 - | A5 - - - F5 - D5 - | G5 - - - E5 - C5 - `;
const honey = {
  bpm: 120, gain: 1.109,
  chords: 'F | C/E | Dm | Bb | F/A | Gm7 | C7 | F | Bb | C | Am | Dm | Gm | C | Bbmaj7 | C7',
  parts: [
    { inst: 'pizz', mel: HONEY_A, vol: 1.0, pan: 0.05, rev: 0.25 },
    { inst: 'glock', mel: HONEY_A, oct: 1, vol: 0.22, pan: 0.25, rev: 0.35 },
    { inst: 'glock', mel: HONEY_B, at: 8, vol: 0.6, pan: 0.1, rev: 0.35 },
    { inst: 'celesta', mel: HONEY_B, at: 8, oct: -1, vol: 0.35, pan: -0.1, rev: 0.35 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . 5 . R . 5 .', vol: 0.65, rev: 0.1 },
    { inst: 'pizz', gen: 'stab', lo: 57, n: 3, pat: '. x . x . x . x', bars: [0, 8], vol: 0.3, pan: -0.25, rev: 0.2 },
    { inst: 'pizz', gen: 'arp', lo: 57, pat: '0 2 1 2 0 2 1 2', bars: [8, 16], vol: 0.38, pan: -0.25, rev: 0.2 },
    { inst: 'warmpad', gen: 'pad', lo: 53, n: 3, bars: [8, 16], vol: 0.28, rev: 0.4 },
    { drums: { k: 'x.......x.......', w: '..x...x...x...x.', e: '....x.......x...' }, vol: 0.42, rev: 0.15,
      fill: { every: 8, w: '..x...x...x.x.xx' } },
  ],
};

// ------------------------------------------------------------------ jungle: firefly jungle, marimba + bongos (E dorian, 116 bpm)
const JUNGLE_A = `E5 . B4 . E5 F#5 G5 . | F#5 . E5 . C#5 . . . | E5 . B4 . E5 F#5 G5 A5 | B5 . A5 . G5 . F#5 . |
                  G5 . E5 . B5 . . . | A5 . F#5 . D5 . . . | C6 . A5 . E5 . G5 . | F#5 . D#5 . B4 . . . `;
const JUNGLE_B = `G4 - - B4 - - E5 - | F#5 - - D5 - - A4 - | E5 - - C5 - - G4 - | F#4 - - A4 - - D#5 - |
                  G5 - - B5 - - E6 - | D6 - - A5 - - F#5 - | E5 - - G5 - - C6 - | B5 - - A5 F#5 - D#5 - `;
const jungle = {
  bpm: 116, gain: 0.955,
  chords: 'Em | A | Em | A | Cmaj7 | Bm7 | Am7 | B7 | Em | D | C | B7 | Em | D | C | B7',
  parts: [
    { inst: 'marimba', mel: JUNGLE_A, vol: 1.0, pan: 0.05, rev: 0.25 },
    { inst: 'marimba', mel: JUNGLE_A, oct: -1, vol: 0.4, pan: -0.1, rev: 0.25 },
    { inst: 'glass', mel: JUNGLE_B, at: 8, vol: 0.75, pan: 0.05, rev: 0.4, opts: { a: 0.06 } },
    { inst: 'marimba', mel: JUNGLE_B, at: 8, vol: 0.4, pan: 0.2, rev: 0.3 },
    { inst: 'marimba', gen: 'arp', lo: 52, steps: 16, pat: '0 . 2 . 1 . 2 3 . 2 . 1 2 . 1 .', vol: 0.36, pan: -0.3, rev: 0.2 },
    { inst: 'softbass', gen: 'bass', lo: 33, pat: 'R . . R . . 5 .', vol: 0.6, rev: 0.06, opts: { sus: 0.5 } },
    { inst: 'glasspad', gen: 'pad', lo: 55, n: 3, vol: 0.22, rev: 0.6 },
    { inst: 'glock', gen: 'arp', lo: 76, pat: '. . . . . . 4 . | . . 6 . . . . . | . . . . . . . . | . 5 . . . . 3 .', vol: 0.3, pan: 0.4, rev: 0.7 },
    { drums: { b: 'x.....x.x.....x.', B: '..x.x...x.x.x...', m: 'oxoxoxoxoxoxoxox', k: 'x.......x.......' }, vol: 0.5, rev: 0.15,
      fill: { every: 8, B: '..x.x...xxx.xxxx' } },
  ],
};

// ------------------------------------------------------------------ sea: crystal sea, harp + glass + bubbles (A, 96 bpm)
const SEA_A = `C#5 - E5 - G#5 - - E5 | A5 - - - F#5 - - - | F#5 - A5 - C#6 - - A5 | B5 - - - G#5 - - - |
               E5 - G#5 - B5 - - G#5 | A5 - - - C#6 - - - | F#5 - E5 - D5 - C#5 - | B4 - - - - - - - `;
const SEA_B = `A5 - - - F#5 - A5 - | G#5 - - - E5 - B4 - | E5 - - - C#5 - E5 - | F#5 - - - - - . . |
               D5 - F#5 - A5 - C#6 - | B5 - - - G#5 - - - | A5 - G#5 - E5 - C#5 - | B4 - - - - - - - `;
const sea = {
  bpm: 96, gain: 0.891,
  chords: 'Amaj7 | F#m7 | Dmaj7 | E | C#m7 | F#m7 | Dmaj7 | Esus4 E | Dmaj7 | E/D | C#m7 | F#m7 | Bm7 | E | Amaj7 | Esus4 E',
  parts: [
    { inst: 'glass', mel: J(SEA_A, SEA_B), vol: 0.85, pan: 0.05, rev: 0.45 },
    { inst: 'bubble', mel: J(SEA_A, SEA_B), oct: 1, vol: 0.3, pan: 0.2, rev: 0.5 },
    { inst: 'harp', gen: 'arp', steps: 16, bassFirst: true, lo: 45, pat: '0 2 4 5 6 5 4 2 3 4 5 6 7 6 5 4', vol: 0.42, pan: -0.2, rev: 0.45, opts: { decay: 0.6 } },
    { inst: 'glasspad', gen: 'pad', lo: 57, n: 4, vol: 0.4, rev: 0.6 },
    { inst: 'softbass', gen: 'bass', lo: 33, pat: 'R - - - - - 5 -', vol: 0.55, rev: 0.1 },
    { inst: 'bubble', gen: 'arp', lo: 76, pat: '. . . 0 . . . . | . . . . . 2 . 1 | . 3 . . . . . . | . . . . 0 . 2 .', vol: 0.32, pan: 0.45, rev: 0.6 },
    { drums: { m: '..o...o...o...o.', g: 'x...............' }, bars: [8, 16], vol: 0.3, rev: 0.4 },
  ],
};

// ------------------------------------------------------------------ snow: aurora snow mountain, celesta + glock + sleigh bells (G, 104 bpm)
const SNOW_A = `D5 - G5 - B5 - A5 G5 | F#5 - - - D5 - - - | E5 - G5 - B5 - A5 G5 | D5 - - - B4 - - - |
                E5 - G5 - C6 - B5 A5 | B5 - - - G5 - - - | C6 - - B5 A5 - G5 - | F#5 - - - A5 - - - `;
const SNOW_B = `G5 - - E5 - - C6 - | G5 - - Eb5 - - C5 - | D5 - - B4 - - G4 - | B4 - - - - - E5 F#5 |
                G5 - - - E5 - - - | F#5 - - - A5 - - - | B5 - - A5 G5 - - - | A5 - - - F#5 - - - `;
const snow = {
  bpm: 104, gain: 0.966,
  chords: 'G | Bm/F# | Em | G/D | C | G/B | Am7 | D7 | C | Cm | G/B | Em | Am7 | D | G | D7',
  parts: [
    { inst: 'celesta', mel: J(SNOW_A, SNOW_B), vol: 1.0, pan: 0.05, rev: 0.4 },
    { inst: 'glock', mel: J(SNOW_A, SNOW_B), oct: 1, vol: 0.25, pan: 0.25, rev: 0.45 },
    { inst: 'harp', gen: 'arp', lo: 55, pat: '0 2 1 2 3 2 1 2', vol: 0.32, pan: -0.25, rev: 0.4, opts: { decay: 0.7 } },
    { inst: 'strings', gen: 'pad', lo: 55, n: 3, vol: 0.32, rev: 0.5, opts: { a: 0.6, r: 1.0, cut: 2600 } },
    { inst: 'glasspad', gen: 'pad', lo: 67, n: 3, bars: [8, 16], vol: 0.25, rev: 0.7 },
    { inst: 'softbass', gen: 'bass', lo: 36, pat: 'R - - - 5 - - -', vol: 0.55, rev: 0.08 },
    { drums: { j: 'x.x.X.x.x.x.X.x.', k: 'x.......x.......', g: 'x...............|................' }, vol: 0.4, rev: 0.25,
      fill: { every: 8, j: 'x.x.X.x.xxxxXXXX' } },
  ],
};

// ------------------------------------------------------------------ toy: toy clock tower, toy piano + tick-tock (C, 132 bpm)
const TOY_A = `G5 E5 . . G5 E5 . . | G5 E5 . C#5 . E5 G5 Bb5 | A5 F5 . . A5 F5 . . | A5 F5 . D5 . G5 B5 D6 |
               E6 . C6 . G5 . E5 . | G#5 . B5 . E6 . D6 . | C6 . A5 . C6 . Ab5 . | G5 . E5 . D5 . B4 . `;
const TOY_B = `A5 . . . E5 . C5 . | D5 . . . B4 . G#4 . | C5 . . . E5 . A5 . | B5 . . . G#5 . E5 . |
               A5 . G5 . F5 . E5 . | G5 . F5 . E5 . C5 . | F#5 . A5 . C6 . A5 . | B5 . A5 . G5 . F5 . `;
const TOY_CH_A = 'C | C#dim7 | Dm7 | G7 | C | E7 | F Fm | C/G G7';
const toy = {
  bpm: 132, gain: 0.989,
  chords: J(TOY_CH_A, 'Am | E7 | Am | E7/G# | F | C/E | D7 | G7', TOY_CH_A),
  parts: [
    { inst: 'toypiano', mel: J(TOY_A, TOY_B, TOY_A), vol: 1.0, pan: 0.05, rev: 0.25, gate: 0.6 },
    { inst: 'glock', mel: TOY_A, at: 16, vol: 0.3, pan: 0.3, rev: 0.3 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . 5 . R . 5 .', bars: [0, 8], vol: 0.65, rev: 0.08 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . . R 5 . . .', bars: [8, 16], vol: 0.65, rev: 0.08 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . 5 . R . 5 .', bars: [16, 24], vol: 0.65, rev: 0.08 },
    { inst: 'toypiano', gen: 'stab', lo: 60, n: 3, pat: '. x . x . x . x', bars: [0, 8], vol: 0.3, pan: -0.3, rev: 0.2 },
    { inst: 'toypiano', gen: 'stab', lo: 60, n: 3, pat: '. x . x . x . x', bars: [16, 24], vol: 0.3, pan: -0.3, rev: 0.2 },
    { inst: 'glock', gen: 'arp', lo: 72, steps: 16, pat: '0 . 1 . 2 . 1 . 0 . 1 . 2 . 3 .', bars: [8, 16], vol: 0.22, pan: -0.3, rev: 0.3 },
    { inst: 'warmpad', gen: 'pad', lo: 55, n: 3, bars: [8, 16], vol: 0.22, rev: 0.4 },
    { drums: { t: 'x...x...x...x...', T: '..x...x...x...x.', k: 'x.......x.......', f: '....x.......x...' }, vol: 0.5, rev: 0.12,
      fill: { every: 8, w: '........x.x.x.xx' } },
  ],
};

// ------------------------------------------------------------------ moon: moonlight dream garden, building epic (D, 88 bpm)
// Written in C, transposed to D. A = the main theme on celesta; B = yearning flute; C = choir climax.
const MOON_B = `A4 - - - C5 - F5 - | E5 - - - D5 - - - | G4 - - - B4 - E5 - | D5 - - - C5 - - - |
                F4 - - - A4 - D5 - | E5 - - - G5 - - - | A5 - - - G5 - F5 - | G5 - - - - - - - `;
const MOON_C = `E5 - - - A5 - - - | C6 - - - A5 - - - | G5 - - - E5 - C5 - | D5 - - - - - - - |
                E5 - - - A5 - B5 - | C6 - - - D6 - C6 - | A5 - - - F5 - D5 - | B5 - - - G5 - - - `;
const moon = {
  bpm: 88, gain: 0.933, tr: 2,
  chords: J(TH_A, 'F | G | Em | Am | Dm7 | Em | F | G', 'Am | F | C | G | Am | F | Dm7 | G7'),
  parts: [
    { inst: 'celesta', mel: THEME_A, vol: 0.9, pan: 0.05, rev: 0.5 },
    { inst: 'bell', mel: THEME_A, oct: 1, vol: 0.18, pan: 0.3, rev: 0.6, opts: { index: 1.2 } },
    { inst: 'flute', mel: MOON_B, at: 8, vol: 0.85, pan: 0.05, rev: 0.45 },
    { inst: 'strings', mel: MOON_B, at: 8, oct: -1, vol: 0.45, pan: -0.15, rev: 0.45 },
    { inst: 'choirlead', mel: MOON_C, at: 16, oct: -1, vol: 0.9, pan: 0.0, rev: 0.5 },
    { inst: 'strings', mel: MOON_C, at: 16, vol: 0.6, pan: 0.15, rev: 0.5, opts: { a: 0.1 } },
    { inst: 'brass', mel: MOON_C, at: 16, oct: -1, vol: 0.28, pan: -0.15, rev: 0.4 },
    { inst: 'harp', gen: 'arp', lo: 48, pat: '0 1 2 3 4 3 2 1', vol: 0.45, pan: -0.25, rev: 0.45 },
    { inst: 'glasspad', gen: 'pad', lo: 60, n: 3, bars: [0, 8], vol: 0.35, rev: 0.7 },
    { inst: 'choir', gen: 'pad', lo: 53, n: 4, bars: [0, 16], vol: 0.4, rev: 0.65, opts: { vowel: 'o' } },
    { inst: 'choir', gen: 'pad', lo: 53, n: 4, bars: [16, 24], vol: 0.6, rev: 0.6, opts: { vowel: 'a' } },
    { inst: 'softbass', gen: 'bass', lo: 36, pat: 'R - - - - - - -', bars: [8, 16], vol: 0.5, rev: 0.1 },
    { inst: 'softbass', gen: 'bass', lo: 36, pat: 'R - - - 5 - - -', bars: [16, 24], vol: 0.6, rev: 0.1 },
    { inst: 'bell', gen: 'arp', lo: 79, pat: '0 . . . . . . . | . . . . . . 1 .', vol: 0.25, pan: 0.35, rev: 0.7 },
    { drums: { k: 'x.......x.......', m: 'o.x.o.x.o.x.o.x.' }, bars: [8, 16], vol: 0.35, rev: 0.25 },
    { drums: { K: 'x.......x.......', S: '....x.......x...', h: '..x...x...x...x.', p: 'x...............' }, bars: [16, 24], vol: 0.42, rev: 0.3,
      fill: { every: 8, n: '........x.x.....', N: '............x.x.' }, opts: { timpF: 73.42 } },
    { drums: { y: '................' }, bars: [16, 24], vol: 0.35, rev: 0.4, fill: { every: 8, offset: 7, y: 'x...............' } },
  ],
};

// ------------------------------------------------------------------ boss: energetic minor boss battle (C minor, 150 bpm)
const BOSS_A = `C5 . C5 . Eb5 . G5 . | F5 . Eb5 . D5 . Eb5 . | C5 . C5 . Eb5 . Ab5 . | G5 - - - F5 - - - |
                C6 . Bb5 . G5 . Eb5 . | F5 . G5 . Eb5 . C5 . | Eb5 . F5 . G5 . Ab5 . | B5 - - - D6 - - - `;
const BOSS_B = `Ab5 - - G5 F5 - C5 - | Bb5 - - Ab5 G5 - D5 - | C6 - - Bb5 Ab5 - Eb5 - | D6 - - - Bb5 - - - |
                C6 - - - Ab5 - F5 - | Eb6 - - - C6 - Ab5 - | D6 - - - Bb5 - F5 - | B5 - - - D5 - F5 - `;
const BOSS_C = `C6 - - - Eb6 - - - | D6 - - - Bb5 - - - | Bb5 - - - G5 - D6 - | C6 - - - - - - - |
                Ab5 - - - C6 - Eb6 - | D6 - - - F6 - - - | Eb6 - - - C6 - Ab5 - | B5 - - - D6 - - - `;
const boss = {
  bpm: 150, gain: 0.955,
  chords: J('Cm | Cm | Ab | Bb | Cm | Cm | Ab | G', 'Fm | Gm | Ab | Bb | Fm | Ab | Bb | G7', 'Ab | Bb | Gm | Cm | Ab | Bb | Fm7 | G'),
  parts: [
    { inst: 'lead', mel: J(BOSS_A, BOSS_B, BOSS_C), vol: 0.75, pan: 0.05, rev: 0.2 },
    { inst: 'brass', mel: J(BOSS_A, BOSS_B, BOSS_C), oct: -1, vol: 0.5, pan: -0.1, rev: 0.2 },
    { inst: 'drivebass', gen: 'bass', lo: 36, pat: 'R R 8 R R R 8 R', vol: 0.7, rev: 0.03 },
    { inst: 'pluck', gen: 'arp', lo: 60, steps: 16, pat: '0 1 2 1 3 1 2 1 0 1 2 1 3 1 2 1', vol: 0.24, pan: 0.3, rev: 0.15, opts: { wave: 'saw', sus: 0.1 } },
    { inst: 'pad', gen: 'pad', lo: 52, n: 4, vol: 0.3, rev: 0.3, opts: { cut: 1200, a: 0.3 } },
    { inst: 'brass', gen: 'stab', lo: 55, n: 3, pat: 'x . . x . . x . | . . x . . . x .', bars: [8, 16], vol: 0.32, pan: 0.25, rev: 0.2 },
    { inst: 'strings', gen: 'pad', lo: 55, n: 3, bars: [16, 24], vol: 0.3, rev: 0.3, opts: { a: 0.15, r: 0.4 } },
    { drums: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' }, vol: 0.55, rev: 0.1,
      fill: { every: 4, s: '....x.......x.xx', n: '........x.x.....', N: '............x.x.' } },
    { drums: { y: '................' }, vol: 0.45, rev: 0.3, fill: { every: 8, offset: 7, y: 'x...............' } },
  ],
};

// ------------------------------------------------------------------ finalboss: epic final battle, choir (D minor, 140 bpm)
// The theme's hook returns in minor (Noa's sorrow) over driving strings.
const FB_A = `A4 - F5 - - - E5 D5 | D5 - - - Bb4 - - - | Bb4 - G5 - - - F5 E5 | E5 - - - C#5 - - - |
              A4 - F5 - - - E5 D5 | D5 - - - Bb4 - - - | G4 - Bb4 - A4 - C#5 - | D5 - - - - - - - `;
const FB_B = `F5 - - - D5 - F5 - | G5 - - - E5 - G5 - | A5 - - - - - - - | A5 - G5 - F5 - E5 - |
              F5 - - - Bb5 - - - | G5 - - - C6 - - - | C#6 - - - A5 - - - | E5 - - - G5 - - - `;
// C section: the main theme breaks through in F major (Somi's warmth reaching Noa), then back to D minor.
const FB_C = `C5 - A5 - - - G5 F5 | G5 - - - C5 - - - | A4 - F5 - - - E5 D5 | E5 - - - C5 - D5 E5 |
              F5 - D6 - - - C6 Bb5 | Db6 - - - C6 - - - | A5 - - - G5 - - - | F5 - - - - - - - `;
const finalboss = {
  bpm: 140, gain: 0.841,
  chords: J('Dm | Bb | Gm | A | Dm | Bb | Gm A7 | Dm', 'Bb | C | Dm | Dm | Bb | C | A | A7', 'F | C/E | Dm | Am/C | Bb | Bbm | F/C C7 | F'),
  parts: [
    { inst: 'choirlead', mel: FB_A, vol: 0.95, pan: 0.0, rev: 0.4 },
    { inst: 'strings', mel: FB_A, vol: 0.55, pan: 0.15, rev: 0.35, opts: { a: 0.08 } },
    { inst: 'brass', mel: FB_B, at: 8, vol: 0.8, pan: 0.05, rev: 0.3 },
    { inst: 'choirlead', mel: FB_B, at: 8, oct: -1, vol: 0.55, pan: -0.1, rev: 0.4 },
    { inst: 'brass', mel: FB_C, at: 16, vol: 0.75, pan: 0.05, rev: 0.3 },
    { inst: 'choirlead', mel: FB_C, at: 16, vol: 0.6, pan: -0.1, rev: 0.45 },
    { inst: 'bell', mel: FB_C, at: 16, oct: 1, vol: 0.22, pan: 0.3, rev: 0.55, opts: { index: 1.4, decay: 0.45 } },
    { inst: 'choir', gen: 'pad', lo: 50, n: 4, vol: 0.5, rev: 0.5, opts: { vowel: 'o', a: 0.4 } },
    { inst: 'pluck', gen: 'arp', lo: 50, steps: 16, pat: '0 0 1 0 2 0 1 0 0 0 1 0 2 0 1 0', vol: 0.28, pan: -0.25, rev: 0.15, opts: { wave: 'saw', sus: 0.1 } },
    { inst: 'drivebass', gen: 'bass', lo: 33, pat: 'R R R R R R R R', vol: 0.65, rev: 0.03 },
    { inst: 'brass', gen: 'stab', lo: 55, n: 3, pat: 'x . . . . . x . | . . x . x . . .', bars: [8, 16], vol: 0.3, pan: 0.25, rev: 0.2 },
    { inst: 'harp', gen: 'arp', lo: 60, pat: '0 1 2 3 4 3 2 1', bars: [16, 24], vol: 0.3, pan: 0.3, rev: 0.4, opts: { decay: 0.55 } },
    { drums: { K: 'x.......x.x.....', S: '....x.......x...', h: '..x...x...x...x.', p: 'x.......x.......' }, vol: 0.5, rev: 0.15,
      fill: { every: 4, S: '....x.......xxxx', n: '........x.x.....', N: '............x.x.' }, opts: { timpF: 73.42 } },
    { drums: { y: '................' }, vol: 0.45, rev: 0.3, fill: { every: 8, offset: 7, y: 'x...............' } },
  ],
};

// ------------------------------------------------------------------ minigame: cute quick loop (F, 140 bpm)
const MINI_A = `C5 F5 A5 F5 C6 . A5 . | D5 F5 A5 F5 D6 . A5 . | D5 F5 Bb5 F5 D6 . Bb5 . | C6 . Bb5 . A5 . G5 . |
                C5 F5 A5 F5 C6 . A5 . | D5 F5 A5 F5 D6 . F6 . | D6 . Bb5 . G5 . E5 . | F5 . A5 . F5 . . . `;
const MINI_B = `F5 - D5 - Bb4 - D5 F5 | G5 - E5 - C5 - E5 G5 | A5 - E5 - C5 - E5 A5 | F5 - - - A5 - - - |
                Bb5 - F5 - D5 - F5 Bb5 | C6 - G5 - E5 - G5 C6 | Bb5 - A5 - G5 - F5 - | E5 - G5 - Bb5 - C6 - `;
const MINI_C = `A5 . A5 . G5 . F5 . | D5 . F5 . Bb5 - - . | A5 . A5 . G5 . F5 . | E5 . G5 . C6 - - . |
                D6 . D6 . C6 . A5 . | Bb5 . A5 . F5 - - . | G5 . A5 . Bb5 . D6 . | C6 - - . G5 . E5 . `;
const minigame = {
  bpm: 140, gain: 0.822,
  chords: J('F | Dm | Bb | C | F | Dm | Gm7 C7 | F', 'Bb | C | Am | Dm | Bb | C | Gm7 | C7', 'Dm | Bb | F | C | Dm | Bb | Gm7 | C7'),
  parts: [
    { inst: 'chip', mel: J(MINI_A, MINI_B, MINI_C), vol: 0.9, pan: 0.05, rev: 0.18 },
    { inst: 'marimba', mel: J(MINI_A, MINI_B, MINI_C), oct: -1, vol: 0.45, pan: -0.1, rev: 0.2 },
    { inst: 'glock', gen: 'arp', lo: 72, pat: '0 . 1 . 2 . 1 .', bars: [16, 24], vol: 0.25, pan: 0.35, rev: 0.3 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . 8 . 5 . 8 .', vol: 0.65, rev: 0.06 },
    { inst: 'marimba', gen: 'stab', lo: 60, n: 3, pat: '. x . x . x . x', vol: 0.3, pan: 0.3, rev: 0.15 },
    { drums: { k: 'x.......x.......', c: '....x.......x...', m: 'oxoxoxoxoxoxoxox', B: '......x.......x.' }, vol: 0.5, rev: 0.1,
      fill: { every: 8, c: '....x.......x.xx', b: '........x.x.....' } },
  ],
};

// ------------------------------------------------------------------ credits: upbeat medley around the theme (C, 110 bpm)
const credits = {
  bpm: 110, gain: 1.035,
  chords: J(TH_A, TH_B, MEADOW_CH_A, TH_A2),
  parts: [
    { inst: 'lead', mel: THEME_A, vol: 0.75, pan: 0.05, rev: 0.25 },
    { inst: 'marimba', mel: THEME_A, vol: 0.45, pan: 0.2, rev: 0.25 },
    { inst: 'flute', mel: THEME_B, at: 8, vol: 0.8, pan: 0.05, rev: 0.3 },
    { inst: 'strings', mel: THEME_B, at: 8, oct: -1, vol: 0.5, pan: -0.15, rev: 0.35 },
    { inst: 'pluck', mel: MEADOW_A, at: 16, vol: 0.85, pan: 0.05, rev: 0.22 },
    { inst: 'glock', mel: MEADOW_CTR, at: 16, vol: 0.35, pan: 0.3, rev: 0.35 },
    { inst: 'lead', mel: THEME_A2, at: 24, vol: 0.75, pan: 0.05, rev: 0.25 },
    { inst: 'glock', mel: THEME_A2, at: 24, oct: 1, vol: 0.25, pan: 0.3, rev: 0.35 },
    { inst: 'brass', mel: THEME_A2, at: 24, oct: -1, vol: 0.3, pan: -0.15, rev: 0.25 },
    { inst: 'synbass', gen: 'bass', lo: 36, pat: 'R . 8 . 5 . 8 .', vol: 0.6, rev: 0.05 },
    { inst: 'pluck', gen: 'stab', lo: 60, n: 3, pat: '. x . x . x . x', vol: 0.28, pan: -0.25, rev: 0.2, opts: { sus: 0.05, d: 0.12 } },
    { inst: 'warmpad', gen: 'pad', lo: 55, n: 4, vol: 0.32, rev: 0.4 },
    { drums: { k: 'x.......x.x.....', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', m: '..o...o...o...o.' }, vol: 0.5, rev: 0.12,
      fill: { every: 8, c: '....x.......x.x.', N: '........x.x.....', n: '............x.x.' } },
    { drums: { y: '................' }, vol: 0.35, rev: 0.3, fill: { every: 8, offset: 7, y: 'x...............' } },
  ],
};

export const SONGS = { title, map, opening, meadow, canyon, honey, jungle, sea, snow, toy, moon, boss, finalboss, noa, memory, ending, credits, minigame };

// ------------------------------------------------------------------ jingles (one-shot; Audio.jingle(id) ducks the music)
const stageclear = { // ~4 s fanfare
  bpm: 160, chords: 'C | F G | C', duck: 0.15, tail: 2,
  parts: [
    { inst: 'brass', mel: 'G4 C5 E5 G5 C6 - E6 - | D6 - C6 A5 B5 - G5 - | C6 - - - - - - -', vol: 0.75, rev: 0.3 },
    { inst: 'pluck', mel: 'G4 C5 E5 G5 C6 - E6 - | D6 - C6 A5 B5 - G5 - | C6 - - - . . . .', vol: 0.45, pan: 0.2, rev: 0.3 },
    { inst: 'celesta', mel: '. . . . . . . . | . . . . . . . . | C6+E6+G6+C7 - - - - - - -', vol: 0.45, pan: -0.2, rev: 0.5 },
    { inst: 'brass', gen: 'stab', lo: 52, n: 3, pat: 'x . . . x . . . | x . . . x . . . | X - - - - - - -', vol: 0.42, pan: -0.15, rev: 0.3 },
    { inst: 'synbass', gen: 'bass', lo: 36, pat: 'R . . . R . . . | R . . . R . . . | R - - - - - - -', vol: 0.6, rev: 0.05 },
    { inst: 'harp', mel: '. . . . . . . . | . . . . . . . . | . C5 E5 G5 C6 E6 G6 C7', vol: 0.35, pan: 0.3, rev: 0.5 },
    { drums: { K: 'x.......x.......|x.......x.......|x...............', s: '................|........x.x.xxxx|................',
               y: '................|................|x...............' }, vol: 0.5, rev: 0.25 },
  ],
};
const cookie = { // ~2 s: new friend unlocked
  bpm: 120, steps: 16, chords: 'Cmaj7', tail: 2, duck: 0.3,
  parts: [
    { inst: 'celesta', mel: 'G5 . C6 . E6 . G6 . C7 - - - - - - -', vol: 0.85, rev: 0.45 },
    { inst: 'marimba', mel: 'G4 . C5 . E5 . G5 . C6 - - - - - - -', vol: 0.5, pan: -0.2, rev: 0.3 },
    { inst: 'bell', mel: '. . . . . . . . E6+G6+C7 - - - - - - -', vol: 0.38, pan: 0.2, rev: 0.6 },
    { inst: 'glock', mel: '. . . . . . . . . . G6 . E6 . C6 .', vol: 0.3, pan: 0.35, rev: 0.6 },
    { inst: 'glasspad', gen: 'pad', lo: 60, n: 4, vol: 0.4, rev: 0.5, opts: { a: 0.3, r: 1.2 } },
  ],
};
const petjoin = { // ~2 s
  bpm: 132, steps: 16, chords: 'F', tail: 1.5, duck: 0.3,
  parts: [
    { inst: 'marimba', mel: 'C5 . F5 . A5 . . C6 . . F6 - - - . .', vol: 0.8, rev: 0.3 },
    { inst: 'bubble', mel: '. . . . . . . . . . . . F6 . A6 .', vol: 0.45, pan: 0.3, rev: 0.4 },
    { inst: 'pizz', mel: 'F3 . . . C4 . . . F3 . . . . . . .', vol: 0.7, rev: 0.1 },
    { inst: 'warmpad', gen: 'pad', lo: 57, n: 3, vol: 0.3, rev: 0.4, opts: { a: 0.15 } },
    { drums: { B: 'x.......x.......', b: '....x.......x...' }, vol: 0.4, rev: 0.15 },
  ],
};
const levelup = { // ~1.5 s
  bpm: 160, steps: 16, chords: 'C', tail: 1.2, duck: 0.3,
  parts: [
    { inst: 'pluck', mel: 'C5 D5 E5 F5 G5 A5 B5 C6 - - - - - - - -', vol: 0.8, rev: 0.25 },
    { inst: 'glock', mel: '. . . . . . . . C6+E6+G6 - - - - - - -', vol: 0.4, pan: 0.25, rev: 0.5 },
    { inst: 'brass', gen: 'stab', lo: 55, n: 3, pat: '. . . . . . . . X - - - - - - -', vol: 0.5, rev: 0.3 },
    { inst: 'synbass', mel: '. . . . . . . . C3 - - - - - - -', vol: 0.5 },
    { drums: { s: 'o.o.o.o.x.......', y: '........x.......' }, vol: 0.4, rev: 0.2 },
  ],
};
const colorRestore = { // ~3 s magical swell
  bpm: 80, steps: 16, chords: 'Cmaj9', tail: 2.5, duck: 0.2,
  parts: [
    { inst: 'harp', mel: 'C4 E4 G4 B4 D5 E5 G5 B5 D6 E6 G6 B6 D7 - - -', vol: 0.6, rev: 0.6 },
    { inst: 'choir', gen: 'pad', lo: 55, n: 4, vol: 0.6, rev: 0.6, opts: { a: 1.2, r: 1.5 } },
    { inst: 'glasspad', gen: 'pad', lo: 64, n: 4, vol: 0.5, rev: 0.7, opts: { a: 1.5 } },
    { inst: 'bell', mel: '. . . . . . . . . . . . C6+E6+G6+B6 - - -', vol: 0.42, pan: 0.2, rev: 0.7 },
    { inst: 'softbass', mel: 'C3 - - - - - - - - - - - - - - -', vol: 0.4, rev: 0.2 },
    { drums: { g: '............x...', y: '............o...' }, vol: 0.4, rev: 0.6 },
  ],
};
const tryagain = { // ~2 s, gentle and encouraging (ends on the dominant: "let's go again!")
  bpm: 112, chords: 'C G', tail: 1.5, duck: 0.35,
  parts: [
    { inst: 'marimba', mel: 'E5 . C5 . D5 - G5 -', vol: 0.75, rev: 0.3 },
    { inst: 'glass', mel: 'E5 . C5 . D5 - G5 -', vol: 0.45, pan: 0.2, rev: 0.4 },
    { inst: 'pizz', gen: 'bass', lo: 36, pat: 'R . . . R . . .', vol: 0.55, rev: 0.1 },
    { inst: 'warmpad', gen: 'pad', lo: 55, n: 3, vol: 0.3, rev: 0.4, opts: { a: 0.2 } },
  ],
};
const rescue = { // ~1.5 s
  bpm: 150, chords: 'C', tail: 1.5, duck: 0.25,
  parts: [
    { inst: 'brass', mel: 'C5 . E5 . G5 C6 - -', vol: 0.65, rev: 0.3 },
    { inst: 'celesta', mel: 'C6 . E6 . G6 C7 - -', vol: 0.4, pan: 0.25, rev: 0.45 },
    { inst: 'brass', gen: 'stab', lo: 55, n: 3, pat: '. . . . . X - -', vol: 0.4, pan: -0.2, rev: 0.3 },
    { drums: { s: 'x.x.x...........', y: '..........x.....' }, vol: 0.4, rev: 0.2 },
  ],
};
const bossIntro = { // ~2.5 s dramatic
  bpm: 96, chords: 'Cm Cm Cm Db', tail: 2, duck: 0.1,
  parts: [
    { inst: 'brass', mel: 'C4+G4 . . C4+G4 . . Db4+Ab4 -', vol: 0.7, rev: 0.3 },
    { inst: 'brass', mel: 'C3+G3 . . C3+G3 . . Db3+Ab3 -', vol: 0.45, pan: -0.15, rev: 0.3 },
    { inst: 'choir', mel: 'C4+Eb4+G4 - - - - - Db4+F4+Ab4 -', vol: 0.5, rev: 0.5, opts: { a: 0.3, vowel: 'o' } },
    { inst: 'drivebass', mel: 'C2 . . C2 . . Db2 -', vol: 0.6, rev: 0.05 },
    { drums: { p: 'X...ooxxxxxxXXXX', y: '..............x.' }, vol: 0.55, rev: 0.3, opts: { timpF: 65.41 } },
  ],
};
const victory = { // ~3 s triumphant
  bpm: 140, chords: 'C | C', tail: 2, duck: 0.15,
  parts: [
    { inst: 'brass', mel: 'C5 . C5 . C5 E5 G5 - | C6 - - - - - - -', vol: 0.75, rev: 0.3 },
    { inst: 'lead', mel: 'C5 . C5 . C5 E5 G5 - | C6 - - - - - - -', vol: 0.4, pan: 0.2, rev: 0.3 },
    { inst: 'brass', gen: 'stab', lo: 52, n: 3, pat: 'x . x . x . x . | X - - - - - - -', vol: 0.42, pan: -0.15, rev: 0.3 },
    { inst: 'synbass', gen: 'bass', lo: 36, pat: 'R . R . R . 5 . | R - - - - - - -', vol: 0.6, rev: 0.05 },
    { inst: 'bell', gen: 'stab', lo: 76, n: 3, pat: '. . . . . . . . | x - - - - - - -', vol: 0.42, pan: 0.2, rev: 0.5 },
    { inst: 'harp', mel: '. . . . . . . . | C5 E5 G5 C6 E6 G6 C7 -', vol: 0.4, pan: 0.3, rev: 0.5 },
    { drums: { K: 'x...x...x...x...|x...............', S: 'x...x...x...x.xx|x...............', y: '................|x...............' }, vol: 0.5, rev: 0.25 },
  ],
};
const secret = { // ~1.2 s discovery: whole-tone shimmer
  bpm: 150, beats: 3, steps: 12, chords: 'Cmaj7', tail: 1.5, duck: 0.35,
  parts: [
    { inst: 'celesta', mel: 'C5 D5 E5 F#5 G#5 A#5 C6 D6 E6 - - -', vol: 0.75, rev: 0.55 },
    { inst: 'bell', mel: '. . . . . . . . B6 - - -', vol: 0.35, pan: 0.25, rev: 0.6 },
    { inst: 'glasspad', gen: 'pad', lo: 60, n: 4, vol: 0.35, rev: 0.6, opts: { a: 0.4 } },
  ],
};
const quizRight = { // ~1 s
  bpm: 120, beats: 2, steps: 8, chords: 'C', tail: 1, duck: 0.4,
  parts: [
    { inst: 'celesta', mel: 'E6 - C7 - - - - -', vol: 0.8, rev: 0.4 },
    { inst: 'bell', mel: 'E6 - C7 - - - - -', vol: 0.3, pan: 0.2, rev: 0.5 },
    { inst: 'marimba', mel: 'C5+E5 - G5+C6 - - - - -', vol: 0.5, pan: -0.2, rev: 0.3 },
  ],
};
const quizWrong = { // ~1 s, soft "uh-oh"
  bpm: 120, beats: 2, steps: 8, tail: 0.8, duck: 0.45,
  parts: [
    { inst: 'marimba', mel: 'D5 - - . B4 - - -', vol: 0.7, rev: 0.3 },
    { inst: 'glass', mel: 'D5 - - . B4 - - -', vol: 0.4, pan: 0.2, rev: 0.35 },
  ],
};

export const JINGLES = { stageclear, cookie, petjoin, levelup, colorRestore, tryagain, rescue, bossIntro, victory, secret, quizRight, quizWrong };

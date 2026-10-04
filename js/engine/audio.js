// ============================================================================
// audio.js — procedural audio engine (WebAudio, no audio files)
//   * synth instruments (music box, celesta, glock, bells, marimba, harp, piano,
//     strings, choir, pads, flute, whistle, plucks, basses, drums ...)
//   * step sequencer compiled from compact song data (js/game/music.js)
//   * lookahead scheduler (setInterval) with adaptive lookahead for throttled tabs
//   * crossfading music players, ducking, one-shot jingles
//   * SFX playback from recipes (js/game/sfx.js) with voice limiting
//   * generated-IR convolution reverb, master compressor + limiter + soft clip
//
// Public API (all calls are safe no-ops before init()):
//   Audio.init()  Audio.resume()  Audio.suspend()
//   Audio.setMusicVolume(v)  Audio.setSfxVolume(v)          (0..1)
//   Audio.playMusic(id, {fade=0.8, restart=false})  Audio.stopMusic(fade=0.8)
//   Audio.duck(level=0.35, dur=1.2)  Audio.jingle(id)  Audio.sfx(name, {vol, pitch, pan})
//   Audio.currentMusic  Audio.ready
// playMusic() before init() remembers the id; the track starts when init() runs.
// ============================================================================
import { SONGS, JINGLES } from '../game/music.js';
import { SFX, SFX_GAIN } from '../game/sfx.js';

// ------------------------------------------------------------------ helpers
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C4' -> 60, 'F#5' -> 78, 'Bb3' -> 58 */
export function noteToMidi(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([#b]{0,2})(-?\d+)$/.exec(s);
  if (!m) return NaN;
  let pc = PC[m[1]];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return pc + (+m[3] + 1) * 12;
}
function pcOf(name) {
  const m = /^([A-G])([#b]{0,2})$/.exec(name);
  if (!m) return NaN;
  let pc = PC[m[1]];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}
const place = (pc, lo) => lo + ((((pc - lo) % 12) + 12) % 12); // lowest midi >= lo with pitch class pc

// ------------------------------------------------------------------ chords
const QUAL = {
  '': [0, 4, 7], M: [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], 5: [0, 7],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10], mM7: [0, 3, 7, 11], 9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7],
  '7sus4': [0, 5, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8],
  69: [0, 4, 7, 9, 14], 'maj7#11': [0, 4, 7, 11, 18], '7b9': [0, 4, 7, 10, 13], 'add#11': [0, 4, 7, 18],
};
function parseChord(sym) {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m || !QUAL[m[2]]) throw new Error('bad chord "' + sym + '"');
  const root = pcOf(m[1]);
  const ints = QUAL[m[2]];
  return { sym, root, bass: m[3] ? pcOf(m[3]) : root, ints, pcs: [...new Set(ints.map((i) => (root + i) % 12))] };
}
/** close-position voicing in [lo, lo+12), padded with octave doublings up to n notes */
function voicing(ch, lo, n) {
  let pcs = ch.pcs.slice();
  if (pcs.length > n && ch.ints.includes(7)) pcs = pcs.filter((p) => p !== (ch.root + 7) % 12);
  if (pcs.length > n) pcs = pcs.filter((p) => p !== ch.root);
  const notes = pcs.map((pc) => place(pc, lo)).sort((a, b) => a - b);
  for (let i = 0; notes.length < n; i++) notes.push(notes[i] + 12);
  return notes;
}
/** ascending list of chord tones from lo (optionally starting with the bass note) */
function arpList(ch, lo, bassFirst) {
  const out = [];
  let m0 = lo;
  if (bassFirst) { const b = place(ch.bass, lo); out.push(b); m0 = b + 1; }
  for (let m = m0; out.length < 24 && m < m0 + 48; m++) if (ch.pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}
function bassNote(tok, ch, next, lo) {
  const R = place(ch.bass, lo), r = place(ch.root, lo);
  switch (tok) {
    case 'R': return R;
    case 'r': return r;
    case 'L': return R - 12;
    case '8': return R + 12;
    case '5': return r + 7;
    case '3': return r + (ch.ints.find((i) => i === 3 || i === 4) ?? ch.ints[1]);
    case '7': return r + (ch.ints.find((i) => i === 10 || i === 11) ?? 10);
    case '6': return r + 9;
    case '2': return r + 2;
    case '4': return r + 5;
    case 'a': { const n = place((next || ch).bass, lo); return n - 1 === R ? n + 1 : n - 1; } // chromatic approach
    case 'A': { const n = place((next || ch).bass, lo); return n + 2 === R ? n - 1 : n + 2; } // approach from above
    default: return noteToMidi(tok);
  }
}

// Instruments that take a whole chord in one voice (shared filter/envelope).
const CHORD_INSTS = new Set(['pad', 'warmpad', 'choir', 'glasspad']);

// ------------------------------------------------------------------ compiler
// Song data format (see js/game/music.js):
//   { bpm, beats=4, steps=8, swing=0, tr=0, loopStart=0 (bars), chords: 'C | G/B | Am F', parts: [...] }
//   melody part:  { inst, mel: 'C5 - E5 . | ...', at=0, oct=0, tr=0, vel=0.8, gate=0.92, steps, glide }
//   generator:    { inst, gen: 'pad'|'arp'|'bass'|'stab', pat: '0 2 1 2 | ...', lo, n, bars:[from,to], bassFirst, strum }
//   drums:        { drums: { k: 'x...x...', s: '....x...' }, steps=16, bars, fill: { every, k: '...', ... } }
//   common:       vol, pan, rev (reverb send), opts (instrument params)
// Tokens: note 'C5' / 'C5+E5' (dyad) with optional '!' accent or '?' soft, '-' hold, '.' rest.
const _compiled = new Map();
export function getCompiled(id, isJingle = false) {
  const key = (isJingle ? 'j:' : 's:') + id;
  if (_compiled.has(key)) return _compiled.get(key);
  const def = isJingle ? JINGLES[id] : SONGS[id];
  if (!def) return null;
  const c = compileSong(def, id, isJingle);
  _compiled.set(key, c);
  return c;
}

function splitBars(str) { return String(str).split('|').map((b) => b.trim()).filter((b) => b.length); }
function barTokens(bar) { return bar.includes(' ') ? bar.split(/\s+/).filter(Boolean) : bar.split(''); }

export function compileSong(def, id = '?', isJingle = false) {
  const errors = [];
  const beats = def.beats || 4;
  const tr = def.tr || 0;
  const rng = makeRng(hashStr(id) + 7);
  // chord timeline
  const segs = [];
  if (def.chords) {
    splitBars(def.chords).forEach((bar, bi) => {
      const syms = bar.split(/\s+/).filter(Boolean);
      const len = beats / syms.length;
      syms.forEach((s, si) => {
        let ch = null;
        if (s === '%') ch = segs.length ? segs[segs.length - 1].ch : null;
        else if (s !== '-' && s !== 'NC') { try { ch = parseChord(s); } catch (e) { errors.push(`${id}: ${e.message}`); } }
        segs.push({ b: bi * beats + si * len, len, ch });
      });
    });
  }
  const chordBars = segs.length ? Math.round((segs[segs.length - 1].b + segs[segs.length - 1].len) / beats) : 0;
  let nBars = def.bars || chordBars;
  for (const p of def.parts) if (p.mel) nBars = Math.max(nBars, (p.at || 0) + splitBars(p.mel).length);
  for (const p of def.parts) if (p.drums && !def.bars && !chordBars) for (const s of Object.values(p.drums)) nBars = Math.max(nBars, splitBars(s).length);
  const chordAt = (b) => { let c = null; for (const s of segs) { if (s.b <= b + 1e-6) c = s; else break; } return c; };
  const nextChord = (seg) => { const i = segs.indexOf(seg); return i >= 0 && i + 1 < segs.length ? segs[i + 1].ch : segs.length ? segs[0].ch : null; };

  const events = [];
  const parts = [];
  def.parts.forEach((p, pi) => {
    const steps = p.steps || (p.drums ? def.dsteps || 16 : def.steps || 8);
    const stepB = beats / steps;
    const ptr = tr + (p.tr || 0) + 12 * (p.oct || 0);
    const baseVel = p.vel ?? 0.8;
    const hum = p.hum ?? 0.06;
    const vel = (v) => clamp(v * (1 + (rng() * 2 - 1) * hum), 0.05, 1);
    const gate = p.gate ?? 0.92;
    const inst = p.inst || (p.drums ? 'drums' : 'pluck');
    parts.push({ inst, vol: (p.vol ?? 0.5) * (def.gain ?? 1), pan: p.pan ?? 0, rev: p.rev ?? 0.2, opts: p.opts || {} });
    const from = p.bars ? p.bars[0] : 0;

    if (p.mel) {
      let bar = p.at || 0, cur = null, prevEnd = -1, prevMidi = null;
      for (const barStr of splitBars(p.mel)) {
        const toks = barTokens(barStr);
        if (toks.length !== steps) errors.push(`${id}: part ${pi} (${inst}) bar ${bar}: ${toks.length} steps, expected ${steps}`);
        toks.forEach((tk, si) => {
          const b = bar * beats + si * stepB;
          if (tk === '-') { if (cur) cur.d += stepB; return; }
          if (cur) { prevEnd = cur.b + cur.d; prevMidi = Array.isArray(cur.m) ? cur.m[0] : cur.m; }
          cur = null;
          if (tk === '.') { prevMidi = null; return; }
          let s = tk, v = baseVel;
          if (s.endsWith('!')) { v *= 1.25; s = s.slice(0, -1); } else if (s.endsWith('?')) { v *= 0.6; s = s.slice(0, -1); }
          const ms = s.split('+').map((x) => noteToMidi(x) + ptr);
          if (ms.some((x) => isNaN(x))) { errors.push(`${id}: part ${pi} bad note "${tk}" bar ${bar}`); return; }
          cur = { b, d: stepB, p: pi, m: ms.length === 1 ? ms[0] : ms, v: vel(v), g: gate };
          if (p.glide && prevMidi != null && Math.abs(prevEnd - b) < 1e-6) cur.gl = prevMidi;
          events.push(cur);
        });
        bar++;
      }
      nBars = Math.max(nBars, bar);
    } else if (p.gen) {
      const to = p.bars ? p.bars[1] : chordBars;
      const lo = p.lo ?? (p.gen === 'bass' ? 36 : p.gen === 'pad' ? 52 : 55);
      const n = p.n || (p.gen === 'pad' ? 4 : 3);
      if (p.gen === 'pad') {
        let last = null;
        for (const s of segs) {
          if (s.b < from * beats - 1e-6 || s.b >= to * beats - 1e-6 || !s.ch) { last = null; continue; }
          const notes = voicing(s.ch, lo, n).map((m) => m + ptr);
          if (last && !p.retrig && last.sym === s.ch.sym && Math.abs(last.ev.b + last.ev.d - s.b) < 1e-6) { last.ev.d += s.len; continue; }
          const ev = { b: s.b, d: s.len, p: pi, m: notes, v: vel(baseVel), g: 1 };
          events.push(ev); last = { sym: s.ch.sym, ev };
        }
      } else {
        const pat = splitBars(p.pat || (p.gen === 'bass' ? 'R - - - R - - -' : p.gen === 'stab' ? '. x . x . x . x' : '0 1 2 1 0 1 2 1')).map(barTokens);
        pat.forEach((tk, i) => { if (tk.length !== steps) errors.push(`${id}: part ${pi} (${p.gen}) pattern bar ${i}: ${tk.length} steps, expected ${steps}`); });
        const isChordInst = CHORD_INSTS.has(inst);
        let cur = null;
        for (let bar = from; bar < to; bar++) {
          const toks = pat[(bar - from) % pat.length];
          toks.forEach((tk0, si) => {
            const b = bar * beats + si * stepB;
            if (tk0 === '-') { if (cur) for (const e of cur) e.d += stepB; return; }
            cur = null;
            if (tk0 === '.') return;
            const seg = chordAt(b);
            if (!seg || !seg.ch) return;
            let tk = tk0, v = baseVel;
            if (tk.endsWith('!')) { v *= 1.25; tk = tk.slice(0, -1); } else if (tk.endsWith('?')) { v *= 0.6; tk = tk.slice(0, -1); }
            let ms;
            if (p.gen === 'arp') {
              const list = arpList(seg.ch, lo, p.bassFirst);
              const idx = tk.split('+').map((x) => parseInt(x, 10));
              if (idx.some((x) => isNaN(x))) { errors.push(`${id}: part ${pi} bad arp token ${tk0}`); return; }
              ms = idx.map((x) => list[Math.min(x, list.length - 1)]);
            } else if (p.gen === 'bass') {
              ms = tk.split('+').map((x) => bassNote(x, seg.ch, nextChord(seg), lo));
              if (ms.some((x) => isNaN(x))) { errors.push(`${id}: part ${pi} bad bass token ${tk0}`); return; }
            } else if (p.gen === 'stab') {
              if (tk === 'x' || tk === 'X' || tk === 'o') { if (tk === 'X') v *= 1.25; if (tk === 'o') v *= 0.6; ms = voicing(seg.ch, lo, n); } else { errors.push(`${id}: bad stab token ${tk0}`); return; }
            }
            ms = ms.map((m) => m + ptr);
            const vv = vel(v);
            if (isChordInst || ms.length === 1) {
              cur = [{ b, d: stepB, p: pi, m: ms.length === 1 ? ms[0] : ms, v: vv, g: gate }];
            } else {
              const strumB = (p.strum || 0) * (def.bpm / 60);
              const up = p.strum && si % 2 === 1;
              const order = up ? ms.slice().reverse() : ms;
              cur = order.map((m, k) => ({ b: b + k * strumB, d: stepB, p: pi, m, v: vv * (up ? 0.85 : 1), g: gate, so: k * strumB }));
            }
            events.push(...cur);
          });
        }
      }
    } else if (p.drums) {
      const to = p.bars ? p.bars[1] : Math.max(chordBars, nBars);
      const lines = Object.entries(p.drums).map(([k, s]) => [k, splitBars(s).map(barTokens)]);
      const fill = p.fill ? Object.entries(p.fill).filter(([k]) => k !== 'every' && k !== 'offset').map(([k, s]) => [k, splitBars(s).map(barTokens)]) : null;
      for (const [k, bars] of lines.concat(fill || [])) bars.forEach((tk, i) => { if (tk.length !== steps) errors.push(`${id}: drum line ${k} bar ${i}: ${tk.length} steps, expected ${steps}`); });
      for (let bar = from; bar < to; bar++) {
        const rel = bar - from;
        const isFill = fill && (rel + 1 + (p.fill.offset || 0)) % p.fill.every === 0;
        const use = isFill ? lines.filter(([k]) => !fill.some(([fk]) => fk === k)).concat(fill) : lines;
        for (const [k, bars] of use) {
          const toks = bars[isFill && fill.some(([fk]) => fk === k) ? 0 : rel % bars.length];
          toks.forEach((tk, si) => {
            if (tk === '.' || tk === '-') return;
            const v = tk === 'X' ? 1 : tk === 'o' ? 0.45 : 0.8;
            events.push({ b: bar * beats + si * stepB, d: stepB, p: pi, dr: k, v: vel(v) });
          });
        }
      }
    }
  });

  // swing: delay off-beat eighths (piecewise-linear warp inside each beat)
  const sw = def.swing || 0;
  if (sw) {
    const warp = (b) => { const beat = Math.floor(b + 1e-9), x = b - beat; return beat + (x < 0.5 ? x * (1 + sw) : 0.5 * (1 + sw) + (x - 0.5) * (1 - sw)); };
    for (const e of events) { const s = warp(e.b - (e.so || 0)) + (e.so || 0), en = warp(e.b + e.d); e.b = s; e.d = Math.max(0.05, en - s); }
  }
  events.sort((a, b) => a.b - b.b);
  const totalBeats = nBars * beats;
  const loopStart = isJingle ? nBars : Math.min(def.loopStart || 0, nBars - 1);
  const introBeats = loopStart * beats;
  const intro = [], body = [];
  for (const e of events) { if (e.b < introBeats - 1e-6) intro.push(e); else { body.push(e); e.b -= introBeats; } }
  const spb = 60 / def.bpm;
  return {
    id, bpm: def.bpm, spb, beats, nBars, introBeats, loopBeats: totalBeats - introBeats,
    intro, body, parts, errors, loop: !isJingle, duck: def.duck,
    introSec: introBeats * spb, loopSec: (totalBeats - introBeats) * spb, lengthSec: totalBeats * spb,
    tail: def.tail ?? 1.5,
  };
}

// ------------------------------------------------------------------ wavetables / noise / IR
function harmonicWave(ctx, amps) {
  const n = amps.length + 1, re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 1; i < n; i++) im[i] = amps[i - 1];
  return ctx.createPeriodicWave(re, im);
}
function buildWaves(ctx) {
  const H = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
  return {
    softsaw: harmonicWave(ctx, H(40, (k) => Math.pow(k, -1.15) * Math.exp(-k / 22))),
    saw: harmonicWave(ctx, H(48, (k) => 1 / k)),
    pulse25: harmonicWave(ctx, H(40, (k) => (Math.sin(Math.PI * k * 0.25) / k) * Math.exp(-k / 34))),
    pulse12: harmonicWave(ctx, H(40, (k) => (Math.sin(Math.PI * k * 0.125) / k) * Math.exp(-k / 30))),
    square: harmonicWave(ctx, H(31, (k) => (k % 2 ? 1 / k : 0) * Math.exp(-k / 26))),
    piano: harmonicWave(ctx, [1, 0.62, 0.36, 0.24, 0.15, 0.1, 0.065, 0.045, 0.03, 0.02, 0.012, 0.008]),
    pluck: harmonicWave(ctx, H(30, (k) => (Math.abs(Math.sin(Math.PI * k * 0.22)) / Math.pow(k, 1.25)) * Math.exp(-k / 28))),
    guitar: harmonicWave(ctx, H(30, (k) => (Math.abs(Math.sin(Math.PI * k * 0.13)) / Math.pow(k, 1.2)) * Math.exp(-k / 30))),
    flute: harmonicWave(ctx, [1, 0.3, 0.09, 0.035, 0.012]),
    organ: harmonicWave(ctx, [1, 0.5, 0.25, 0.12, 0.05, 0.03]),
    tri: harmonicWave(ctx, H(15, (k) => (k % 2 ? 1 / (k * k) : 0) * (((k - 1) / 2) % 2 ? -1 : 1))),
  };
}
function buildNoise(ctx, rng) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 2);
  const mk = (fill) => { const b = ctx.createBuffer(1, len, sr); fill(b.getChannelData(0)); return b; };
  const white = mk((d) => { for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1; });
  const pink = mk((d) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  });
  const brown = mk((d) => { let x = 0; for (let i = 0; i < len; i++) { x = (x + 0.02 * (rng() * 2 - 1)) * 0.998; d[i] = x * 3.2; } });
  // cross-fade buffer ends so looping is seamless
  for (const b of [white, pink, brown]) {
    const d = b.getChannelData(0), n = Math.floor(sr * 0.02);
    for (let i = 0; i < n; i++) { const a = i / n; d[len - n + i] = d[len - n + i] * (1 - a) + d[i] * a; }
  }
  return { white, pink, brown };
}
function makeIR(ctx, dur = 2.8, t60 = 2.3, pre = 0.012) {
  const sr = ctx.sampleRate, len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), rng = makeRng(ch ? 9177 : 3313);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr - pre;
      if (t < 0) { d[i] = 0; continue; }
      const env = Math.exp((-6.9 * t) / t60) * (t < 0.006 ? t / 0.006 : 1);
      const fc = 7500 * Math.exp(-t * 1.7) + 700;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (rng() * 2 - 1 - lp);
      lp2 += a * (lp - lp2);
      d[i] = (lp * 0.6 + lp2 * 0.8) * env;
    }
    const taps = [[0.011, 0.9], [0.019, -0.7], [0.027, 0.55], [0.038, -0.5], [0.049, 0.4], [0.061, -0.35], [0.077, 0.28], [0.093, -0.2]];
    for (const [tt, amp] of taps) {
      const idx = Math.floor((pre + tt + (ch ? 0.0023 : 0)) * sr);
      for (let j = 0; j < 24 && idx + j < len; j++) d[idx + j] += amp * 0.18 * Math.exp(-j / 6) * (ch && j % 2 ? -1 : 1);
    }
    // fade the last 10% to avoid a truncated tail
    const f0 = Math.floor(len * 0.9);
    for (let i = f0; i < len; i++) d[i] *= 1 - (i - f0) / (len - f0);
  }
  return buf;
}
function makeClipCurve() {
  // input domain [-1,1] represents signal [-2,2] (a 0.5 pre-gain feeds the shaper)
  const n = 4096, c = new Float32Array(n), knee = 0.8, room = 0.18;
  for (let i = 0; i < n; i++) {
    const s = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(s);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    c[i] = Math.sign(s) * y;
  }
  return c;
}

// ------------------------------------------------------------------ voices & envelopes
/** One note/sound: a bundle of sources that start at t and stop together. */
class Voice {
  constructor(E, dest, t) {
    this.E = E; this.ctx = E.ctx; this.t = t; this.srcs = []; this.end = t + 0.05;
    this.out = this.ctx.createGain();
    this.out.connect(dest);
    this.level = 1;
  }
  setLevel(x) { this.level = x; this.out.gain.value = x; return this; }
  osc(type, f, det = 0) {
    const o = this.ctx.createOscillator();
    const w = this.E.waves[type];
    if (w) o.setPeriodicWave(w); else o.type = type;
    o.frequency.setValueAtTime(clamp(f, 1, this.E.nyq), this.t);
    if (det) o.detune.setValueAtTime(det, this.t);
    this.srcs.push(o);
    return o;
  }
  noise(color = 'white', rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.E.noise[color]; s.loop = true; s._noise = true;
    if (rate !== 1) s.playbackRate.setValueAtTime(rate, this.t);
    this.srcs.push(s);
    return s;
  }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.setValueAtTime(clamp(f, 10, this.E.nyq * 0.95), this.t); b.Q.value = q;
    return b;
  }
  /** sine LFO into an AudioParam (depth in param units), optional delayed fade-in */
  lfo(rate, depth, targets, delay = 0, fade = 0) {
    const o = this.osc('sine', rate), g = this.gain(fade || delay ? 0 : depth);
    o.connect(g);
    for (const tg of [].concat(targets)) g.connect(tg);
    if (fade || delay) { g.gain.setValueAtTime(0, this.t + delay); g.gain.linearRampToValueAtTime(depth, this.t + delay + Math.max(fade, 0.01)); }
    return g;
  }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  done(end) {
    this.end = Math.max(this.t + 0.02, end);
    const stopAt = this.end + 0.02;
    for (const s of this.srcs) {
      if (s._noise) s.start(this.t, this.E.rng() * 1.5); else s.start(this.t);
      s.stop(stopAt);
    }
    const out = this.out;
    if (this.srcs[0]) this.srcs[0].onended = () => { try { out.disconnect(); } catch (e) { /* already gone */ } };
    return this;
  }
  /** quick fade-out (voice stealing) */
  kill(t) {
    if (this.end <= t + 0.05) return;
    const g = this.out.gain;
    g.setValueAtTime(this.level, t); g.linearRampToValueAtTime(0, t + 0.035);
    for (const s of this.srcs) { try { s.stop(t + 0.045); } catch (e) { /* ignore */ } }
    this.end = t + 0.045;
  }
}
/** percussive envelope: linear attack, exponential decay to -60 dB at t60 */
function perc(p, t, a, pk, t60) {
  pk = Math.max(pk, 1e-4);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(pk * 1e-3, t + a + t60);
  p.linearRampToValueAtTime(0, t + a + t60 + 0.012);
  return t + a + t60 + 0.012;
}
/** breakpoint envelope: pts [[dt, v], ...] (first linear from 0, rest exponential), released at `off` over r (to -60 dB) */
function envPts(p, t, off, pts, r) {
  p.setValueAtTime(0, t);
  let pT = t, pV = 0, cut = false;
  for (let i = 0; i < pts.length; i++) {
    const tt = t + pts[i][0], vv = Math.max(pts[i][1], 1e-5);
    if (off < tt) {
      const f = (off - pT) / Math.max(tt - pT, 1e-6);
      const vOff = Math.max(i === 0 ? vv * f : pV * Math.pow(vv / pV, f), 1e-5);
      if (i === 0) p.linearRampToValueAtTime(vOff, off); else p.exponentialRampToValueAtTime(vOff, off);
      pT = off; pV = vOff; cut = true;
      break;
    }
    if (i === 0) p.linearRampToValueAtTime(vv, tt); else p.exponentialRampToValueAtTime(vv, tt);
    pT = tt; pV = vv;
  }
  if (!cut && off > pT) { p.setValueAtTime(pV, off); pT = off; }
  const end = pT + r;
  p.exponentialRampToValueAtTime(Math.max(pV * 1e-3, 1e-7), end);
  p.linearRampToValueAtTime(0, end + 0.012);
  return end + 0.012;
}
const adsr = (p, t, dur, a, d, s, r, pk) => envPts(p, t, t + Math.max(dur, 0.02), [[a, pk], [a + d, pk * Math.max(s, 1e-3)]], r);
function partial(v, f, ratio, amp, a, t60, type = 'sine', dest = v.out) {
  const fr = f * ratio;
  if (fr > v.E.nyq * 0.85) return v.t;
  const o = v.osc(type, fr), g = v.gain();
  o.connect(g); g.connect(dest);
  return perc(g.gain, v.t, a, amp, t60);
}

// ------------------------------------------------------------------ instruments
// Per-note instruments: (E, dest, t, freq, dur, vel, opts) -> Voice
const INST = {
  musicbox(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(600 / f, 0.4), 0.5, 1.6) * (o.decay || 1), pk = 0.3 * vel;
    const end = partial(v, f, 1, pk, 0.0015, 2.3 * k);
    partial(v, f, 2, pk * 0.06, 0.0015, 0.7 * k);
    partial(v, f, 6.27, pk * 0.11, 0.0018, 0.22 * k);
    const n = v.noise('white'), bp = v.filter('bandpass', Math.min(f * 4, 9000), 2.5), g = v.gain();
    v.chain(n, bp, g, v.out); perc(g.gain, t, 0.0012, pk * 0.22, 0.015);
    return v.done(end);
  },
  celesta(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(700 / f, 0.35), 0.5, 1.5) * (o.decay || 1), pk = 0.27 * vel;
    const end = partial(v, f, 1, pk, 0.003, 2.6 * k);
    partial(v, f, 2, pk * 0.18, 0.002, 0.9 * k);
    partial(v, f, 3, pk * 0.05, 0.002, 0.35 * k);
    partial(v, f, 4.03, pk * 0.06, 0.0015, 0.14 * k);
    return v.done(end);
  },
  glock(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(1000 / f, 0.3), 0.5, 1.4) * (o.decay || 1), pk = 0.22 * vel;
    const end = partial(v, f, 1, pk, 0.0012, 2.4 * k);
    partial(v, f, 2.756, pk * 0.28, 0.0012, 0.8 * k);
    partial(v, f, 5.404, pk * 0.12, 0.0015, 0.3 * k);
    partial(v, f, 8.933, pk * 0.05, 0.002, 0.12 * k);
    return v.done(end);
  },
  bell(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(800 / f, 0.3), 0.5, 1.6) * (o.decay || 1);
    const ratio = o.ratio || 3.5, idx = (o.index ?? 2.2) * clamp(1200 / f, 0.3, 1);
    const c = v.osc('sine', f), m = v.osc('sine', f * ratio), mg = v.gain(), g = v.gain();
    m.connect(mg); mg.connect(c.frequency); c.connect(g); g.connect(v.out);
    const dev = Math.max(Math.min(f * ratio * idx, 7000), 1);
    mg.gain.setValueAtTime(dev, t); mg.gain.exponentialRampToValueAtTime(dev * 0.05 + 0.5, t + 1.6 * k);
    const end = perc(g.gain, t, 0.002, 0.2 * vel, 3.4 * k);
    partial(v, f, 2, 0.035 * vel, 0.002, 1.2 * k);
    return v.done(end);
  },
  marimba(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(400 / f, 0.55), 0.35, 2.2) * (o.decay || 1), pk = 0.36 * vel;
    const end = partial(v, f, 1, pk, 0.0015, 0.85 * k);
    partial(v, f, 3.93, pk * 0.16, 0.0012, 0.13 * k);
    partial(v, f, 9.6, pk * 0.035, 0.0015, 0.045 * k);
    return v.done(end);
  },
  toypiano(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(800 / f, 0.35), 0.5, 1.4) * (o.decay || 1), pk = 0.24 * vel;
    const ff = f * Math.pow(2, ((hashStr('tp' + Math.round(f * 10)) % 17) - 8) / 1200); // charmingly out of tune
    const end = partial(v, ff, 1, pk, 0.0012, 1.2 * k);
    partial(v, ff, 2.0, pk * 0.32, 0.0012, 0.4 * k);
    partial(v, ff, 4.1, pk * 0.2, 0.0015, 0.14 * k);
    partial(v, ff, 6.9, pk * 0.08, 0.002, 0.06 * k);
    const n = v.noise('white'), bp = v.filter('bandpass', 3000, 1.2), g = v.gain();
    v.chain(n, bp, g, v.out); perc(g.gain, t, 0.001, pk * 0.25, 0.02);
    return v.done(end);
  },
  harp(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(300 / f, 0.35), 0.55, 1.5) * (o.decay || 1);
    const s = v.osc('pluck', f), lp = v.filter('lowpass', Math.min(f * 14, 14000), 0.5), g = v.gain();
    v.chain(s, lp, g, v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.5, 500), t + 0.6 * k);
    const end = perc(g.gain, t, 0.002, 0.34 * vel, 2.6 * k);
    return v.done(end);
  },
  guitar(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(200 / f, 0.4), 0.5, 1.5) * (o.decay || 1), pk = 0.34 * vel;
    const s = v.osc('guitar', f * 1.004), lp = v.filter('lowpass', Math.min(f * 16, 12000), 0.8), g = v.gain();
    s.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    v.chain(s, lp, g, v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 3, 600), t + 0.3 * k);
    const end = envPts(g.gain, t, t + Math.max(dur, 0.05) + (o.ring ?? 0.15), [[0.0015, pk], [1.6 * k, pk * 0.001]], 0.12);
    return v.done(end);
  },
  pizz(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(300 / f, 0.4), 0.5, 1.6) * (o.decay || 1);
    const s = v.osc('saw', f), lp = v.filter('lowpass', Math.min(f * 6, 9000), 0.9), g = v.gain();
    v.chain(s, lp, g, v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.7, 250), t + 0.1);
    const end = perc(g.gain, t, 0.004, 0.38 * vel, 0.5 * k);
    partial(v, f, 1, 0.12 * vel, 0.004, 0.32 * k);
    return v.done(end);
  },
  piano(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(260 / f, 0.45), 0.35, 2.0) * (o.decay || 1), pk = 0.2 * vel;
    const s1 = v.osc('piano', f, -2.5), s2 = v.osc('piano', f, 2.5);
    const lp = v.filter('lowpass', Math.min(f * (3 + 8 * vel), 13000), 0.6), g = v.gain();
    s1.connect(lp); s2.connect(lp); lp.connect(g); g.connect(v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.8, 350), t + 1.2 * k);
    const end = envPts(g.gain, t, t + Math.max(dur, 0.08), [[0.002, pk], [0.12, pk * 0.55], [6 * k, pk * 0.001]], o.rel || 0.3);
    const n = v.noise('pink'), nl = v.filter('lowpass', 1800, 0.7), ng = v.gain();
    v.chain(n, nl, ng, v.out); perc(ng.gain, t, 0.001, pk * 0.25, 0.03);
    return v.done(end);
  },
  flute(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.24 * vel;
    const s = v.osc(o.wave || 'flute', f), g = v.gain();
    if (o.from) { s.frequency.setValueAtTime(o.from, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
    else { s.detune.setValueAtTime(-25, t); s.detune.linearRampToValueAtTime(0, t + 0.06); }
    if (dur > 0.25) v.lfo(o.vibRate || 5.2, o.vib ?? 12, s.detune, 0.22, 0.3);
    const n = v.noise('pink'), bp = v.filter('bandpass', Math.min(f * 2, 9000), 1.2), ng = v.gain(o.breath ?? 0.5);
    v.chain(n, bp, ng, g); s.connect(g); g.connect(v.out);
    const end = adsr(g.gain, t, dur, o.from ? 0.025 : o.a || 0.05, 0.18, 0.78, o.r || 0.14, pk);
    return v.done(end);
  },
  whistle(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.22 * vel;
    const s = v.osc('sine', f), g = v.gain();
    if (o.from) { s.frequency.setValueAtTime(o.from, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.07); }
    else { s.frequency.setValueAtTime(f * 0.97, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.05); }
    if (dur > 0.2) v.lfo(5.6, o.vib ?? 20, s.detune, 0.16, 0.25);
    const n = v.noise('white'), hp = v.filter('highpass', 3500, 0.7), ng = v.gain(0.02);
    v.chain(n, hp, ng, g); s.connect(g); g.connect(v.out);
    const end = adsr(g.gain, t, dur, o.from ? 0.02 : 0.03, 0.1, 0.85, 0.09, pk);
    return v.done(end);
  },
  glass(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.2 * vel;
    const s = v.osc('sine', f), s2 = v.osc('sine', f * 3.01), m2 = v.gain(0.06), g = v.gain();
    s.connect(g); s2.connect(m2); m2.connect(g); g.connect(v.out);
    if (dur > 0.3) v.lfo(4.8, 10, [s.detune, s2.detune], 0.25, 0.4);
    const end = adsr(g.gain, t, dur, o.a || 0.04, 0.3, 0.75, o.r || 0.3, pk);
    return v.done(end);
  },
  lead(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.16 * vel;
    const s1 = v.osc('pulse25', f), s2 = v.osc('saw', f, 7), m1 = v.gain(0.6), m2 = v.gain(0.4);
    const lp = v.filter('lowpass', Math.min(f * 2 + 3500 * vel, 12000), o.q || 1.4), g = v.gain();
    s1.connect(m1); s2.connect(m2); m1.connect(lp); m2.connect(lp); lp.connect(g); g.connect(v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.5 + 600, 900), t + 0.3);
    if (o.from) for (const s of [s1, s2]) { s.frequency.setValueAtTime(o.from, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
    if (dur > 0.3) v.lfo(5.5, o.vib ?? 9, [s1.detune, s2.detune], 0.2, 0.25);
    const end = adsr(g.gain, t, dur, 0.006, 0.22, o.sus ?? 0.55, o.r || 0.1, pk);
    return v.done(end);
  },
  pluck(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.22 * vel;
    const s = v.osc(o.wave || 'pulse25', f), lp = v.filter('lowpass', Math.min(f * 3 + 4500 * vel, 13000), 1.3), g = v.gain();
    v.chain(s, lp, g, v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.3 + 300, 500), t + (o.fd || 0.18));
    const end = adsr(g.gain, t, dur, 0.003, o.d || 0.3, o.sus ?? 0.22, o.r || 0.08, pk);
    return v.done(end);
  },
  chip(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.1 * vel;
    const s = v.osc(o.wave || 'pulse25', f), lp = v.filter('lowpass', 5000, 0.5), g = v.gain();
    v.chain(s, lp, g, v.out);
    if (dur > 0.25) v.lfo(6, 14, s.detune, 0.15, 0.1);
    const end = adsr(g.gain, t, dur, 0.004, 0.08, 0.65, 0.05, pk);
    return v.done(end);
  },
  brass(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.15 * vel;
    const s1 = v.osc('saw', f, -6), s2 = v.osc('saw', f, 6);
    for (const [s, dt] of [[s1, -6], [s2, 6]]) { s.detune.setValueAtTime(dt - 35, t); s.detune.linearRampToValueAtTime(dt, t + 0.06); }
    const lp = v.filter('lowpass', 300, 0.9), g = v.gain();
    s1.connect(lp); s2.connect(lp); lp.connect(g); g.connect(v.out);
    lp.frequency.linearRampToValueAtTime(Math.min(f * 5 + 1800 * vel, 9000), t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 3.5 + 700, 6000), t + 0.35);
    const end = adsr(g.gain, t, dur, 0.035, 0.25, 0.72, o.r || 0.12, pk);
    return v.done(end);
  },
  synbass(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.42 * vel;
    const s1 = v.osc('triangle', f), s2 = v.osc('pulse25', f), m2 = v.gain(0.45);
    const lp = v.filter('lowpass', Math.min(f * 10, 6000), 2.2), g = v.gain();
    s1.connect(lp); s2.connect(m2); m2.connect(lp); lp.connect(g); g.connect(v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 3.2, 260), t + 0.16);
    const end = adsr(g.gain, t, dur, 0.004, 0.18, 0.55, 0.06, pk);
    return v.done(end);
  },
  softbass(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.5 * vel;
    const s1 = v.osc('sine', f), s2 = v.osc('sine', f * 2), m2 = v.gain(0.26), s3 = v.osc('sine', f * 3), m3 = v.gain(0.07), g = v.gain();
    s1.connect(g); s2.connect(m2); m2.connect(g); s3.connect(m3); m3.connect(g); g.connect(v.out);
    const end = adsr(g.gain, t, dur, 0.012, 0.3, o.sus ?? 0.7, o.r || 0.12, pk);
    return v.done(end);
  },
  drivebass(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.36 * vel;
    const s1 = v.osc('saw', f), sub = v.osc('sine', f), ms = v.gain(0.55);
    const lp = v.filter('lowpass', Math.min(f * 9, 5000), 4), g = v.gain();
    s1.connect(lp); lp.connect(g); sub.connect(ms); ms.connect(g); g.connect(v.out);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 3, 220), t + 0.12);
    const end = adsr(g.gain, t, dur, 0.003, 0.12, 0.7, 0.05, pk);
    return v.done(end);
  },
  strings(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), pk = 0.1 * vel * (o.gain || 1);
    const s1 = v.osc('saw', f, -5), s2 = v.osc('saw', f, 6);
    v.lfo(5.3, o.vib ?? 9, [s1.detune, s2.detune], 0.12, 0.4);
    const lp = v.filter('lowpass', o.cut || 3000, 0.5), g = v.gain();
    s1.connect(lp); s2.connect(lp); lp.connect(g); g.connect(v.out);
    const end = adsr(g.gain, t, dur, o.a || 0.22, 0.4, 0.85, o.r || 0.45, pk);
    return v.done(end);
  },
  bubble(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t), k = clamp(Math.pow(600 / f, 0.3), 0.6, 1.4);
    const s = v.osc('sine', f * 0.55), g = v.gain();
    s.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    s.connect(g); g.connect(v.out);
    const end = perc(g.gain, t, 0.004, 0.3 * vel, 0.42 * k * (o.decay || 1));
    partial(v, f, 2.01, 0.04 * vel, 0.004, 0.2 * k);
    return v.done(end);
  },
  timp(E, d, t, f, dur, vel, o) {
    const v = new Voice(E, d, t);
    const s = v.osc('sine', f * 1.03), g = v.gain();
    s.frequency.exponentialRampToValueAtTime(f, t + 0.1);
    s.connect(g); g.connect(v.out);
    const end = perc(g.gain, t, 0.004, 0.5 * vel, 1.8);
    partial(v, f, 1.505, 0.2 * vel, 0.004, 1.0);
    partial(v, f, 1.99, 0.1 * vel, 0.004, 0.7);
    const n = v.noise('brown'), lp = v.filter('lowpass', 700, 0.7), ng = v.gain();
    v.chain(n, lp, ng, v.out); perc(ng.gain, t, 0.002, 0.3 * vel, 0.12);
    return v.done(end);
  },
  choirlead(E, d, t, f, dur, vel, o) { return CHORD.choir(E, d, t, [f], dur, vel, { a: 0.16, r: 0.5, gain: 1.5, ...o }); },
};

// Chord instruments: (E, dest, t, freqs[], dur, vel, opts) -> Voice (one shared filter/envelope)
const VOWELS = {
  a: [[800, 1, 6], [1150, 0.6, 7], [2900, 0.22, 9]],
  o: [[450, 1, 6], [800, 0.55, 7], [2830, 0.12, 9]],
  u: [[325, 1, 6], [700, 0.35, 7], [2530, 0.08, 9]],
  e: [[400, 1, 6], [1700, 0.5, 8], [2600, 0.25, 9]],
};
const CHORD = {
  pad(E, d, t, fs, dur, vel, o) {
    const v = new Voice(E, d, t), cut = o.cut || 1500, a = o.a ?? 0.8, det = o.det ?? 7, w = o.wave || 'softsaw';
    const pl = E.panner(-0.45), pr = E.panner(0.45), lp = v.filter('lowpass', cut * 0.5, 0.6), g = v.gain();
    lp.frequency.exponentialRampToValueAtTime(cut, t + a * 1.2 + 0.01);
    for (const f of fs) { const s1 = v.osc(w, f, -det), s2 = v.osc(w, f, det); s1.connect(pl); s2.connect(pr); }
    pl.connect(lp); pr.connect(lp); lp.connect(g); g.connect(v.out);
    const end = adsr(g.gain, t, dur, a, 0.6, 0.85, o.r ?? 1.3, ((o.gain || 1) * 0.1 * vel) / Math.sqrt(fs.length));
    return v.done(end);
  },
  warmpad(E, d, t, fs, dur, vel, o) { return CHORD.pad(E, d, t, fs, dur, vel, { wave: 'tri', cut: 2200, det: 6, gain: 1.6, ...o }); },
  glasspad(E, d, t, fs, dur, vel, o) { return CHORD.pad(E, d, t, fs, dur, vel, { wave: 'organ', cut: 4000, det: 5, gain: 1.1, a: 1.2, ...o }); },
  choir(E, d, t, fs, dur, vel, o) {
    const v = new Voice(E, d, t), sum = v.gain(1), env = v.gain();
    const vib = v.lfo(4.8, 11, [], 0.2, 0.6);
    let i = 0;
    for (const f of fs) for (const dt of [-9, 8]) { const s = v.osc('saw', f, dt + ((i++ * 37) % 7) - 3); vib.connect(s.detune); s.connect(sum); }
    for (const [ff, gg, q] of VOWELS[o.vowel || 'a']) { const bp = v.filter('bandpass', ff, q), bg = v.gain(gg); v.chain(sum, bp, bg, env); }
    const lp = v.filter('lowpass', 900, 0.5), lg = v.gain(0.25);
    v.chain(sum, lp, lg, env);
    env.connect(v.out);
    const end = adsr(env.gain, t, dur, o.a ?? 0.9, 0.5, 0.9, o.r ?? 1.4, ((o.gain || 1) * 0.5 * vel) / Math.sqrt(fs.length * 2));
    return v.done(end);
  },
};

// ------------------------------------------------------------------ drums
function toneHit(v, type, f0, f1, ft, a, pk, t60, dest = v.out) {
  const s = v.osc(type, f0), g = v.gain();
  if (f1 && f1 !== f0) s.frequency.exponentialRampToValueAtTime(f1, v.t + ft);
  s.connect(g); g.connect(dest);
  return perc(g.gain, v.t, a, pk, t60);
}
function noiseHit(v, color, type, f, q, a, pk, t60, dest = v.out) {
  const n = v.noise(color), fl = v.filter(type, f, q), g = v.gain();
  v.chain(n, fl, g, dest);
  return perc(g.gain, v.t, a, pk, t60);
}
// Drum kit letters: k kick, K big kick, s snare, S big snare, c clap, h hat, o open hat, m shaker, e tambourine,
// b/B bongo low/high, t/T clock tick/tock, w woodblock, r rim, n/N tom low/high, y crash, g triangle, j sleigh bells,
// p timpani (opts.timpF), f finger snap
const DRUMS = {
  k(E, d, t, vel, o) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', o.kf || 165, 56, 0.075, 0.002, 0.85 * vel, o.kd || 0.28);
    toneHit(v, 'triangle', 330, 165, 0.03, 0.0015, 0.16 * vel, 0.06);
    noiseHit(v, 'white', 'lowpass', 2200, 0.7, 0.001, 0.08 * vel, 0.012);
    return v.done(end);
  },
  K(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 120, 40, 0.13, 0.002, 1.0 * vel, 0.55);
    noiseHit(v, 'white', 'lowpass', 3000, 0.7, 0.0008, 0.16 * vel, 0.02);
    return v.done(end);
  },
  s(E, d, t, vel) {
    const v = new Voice(E, d, t);
    toneHit(v, 'triangle', 200, 165, 0.05, 0.002, 0.3 * vel, 0.1);
    const end = noiseHit(v, 'white', 'bandpass', 2600, 0.6, 0.0015, 0.5 * vel, 0.2);
    return v.done(end);
  },
  S(E, d, t, vel) {
    const v = new Voice(E, d, t);
    toneHit(v, 'triangle', 185, 150, 0.06, 0.002, 0.4 * vel, 0.14);
    const end = noiseHit(v, 'white', 'bandpass', 2200, 0.5, 0.002, 0.65 * vel, 0.32);
    noiseHit(v, 'white', 'highpass', 6000, 0.7, 0.001, 0.15 * vel, 0.12);
    return v.done(end);
  },
  c(E, d, t, vel) {
    const v = new Voice(E, d, t), n = v.noise('white'), bp = v.filter('bandpass', 1400, 1.2), g = v.gain(), p = g.gain, pk = 0.6 * vel;
    v.chain(n, bp, g, v.out);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk * 0.9, t + 0.001); p.linearRampToValueAtTime(pk * 0.12, t + 0.009);
    p.linearRampToValueAtTime(pk * 0.85, t + 0.011); p.linearRampToValueAtTime(pk * 0.12, t + 0.02);
    p.linearRampToValueAtTime(pk, t + 0.022); p.exponentialRampToValueAtTime(pk * 0.001, t + 0.21); p.linearRampToValueAtTime(0, t + 0.22);
    return v.done(t + 0.22);
  },
  h(E, d, t, vel) { const v = new Voice(E, d, t); return v.done(noiseHit(v, 'white', 'highpass', 7500, 0.7, 0.001, 0.2 * vel, 0.05)); },
  o(E, d, t, vel) { const v = new Voice(E, d, t); return v.done(noiseHit(v, 'white', 'highpass', 6500, 0.7, 0.002, 0.16 * vel, 0.35)); },
  m(E, d, t, vel) {
    const v = new Voice(E, d, t), n = v.noise('white'), bp = v.filter('bandpass', 6000, 1.4), g = v.gain(), p = g.gain;
    v.chain(n, bp, g, v.out);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(0.22 * vel, t + 0.018); p.exponentialRampToValueAtTime(0.0002, t + 0.1); p.linearRampToValueAtTime(0, t + 0.11);
    return v.done(t + 0.11);
  },
  e(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = noiseHit(v, 'white', 'bandpass', 8800, 2.5, 0.002, 0.22 * vel, 0.15);
    noiseHit(v, 'white', 'bandpass', 5200, 4, 0.002, 0.08 * vel, 0.08);
    return v.done(end);
  },
  b(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 240, 215, 0.05, 0.001, 0.5 * vel, 0.25);
    noiseHit(v, 'white', 'bandpass', 1800, 2, 0.001, 0.08 * vel, 0.012);
    return v.done(end);
  },
  B(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 352, 318, 0.04, 0.001, 0.45 * vel, 0.2);
    noiseHit(v, 'white', 'bandpass', 2600, 2, 0.001, 0.08 * vel, 0.01);
    return v.done(end);
  },
  t(E, d, t, vel) {
    const v = new Voice(E, d, t);
    toneHit(v, 'sine', 3000, 0, 0, 0.0015, 0.1 * vel, 0.03);
    return v.done(noiseHit(v, 'white', 'bandpass', 5200, 5, 0.0015, 0.35 * vel, 0.025));
  },
  T(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 1650, 0, 0, 0.002, 0.14 * vel, 0.05);
    noiseHit(v, 'white', 'bandpass', 2100, 5, 0.002, 0.35 * vel, 0.03);
    return v.done(end);
  },
  w(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 1080, 1040, 0.02, 0.001, 0.3 * vel, 0.08);
    toneHit(v, 'sine', 2900, 0, 0, 0.0015, 0.06 * vel, 0.03);
    return v.done(end);
  },
  r(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'triangle', 1750, 0, 0, 0.001, 0.15 * vel, 0.03);
    noiseHit(v, 'white', 'highpass', 3000, 0.7, 0.001, 0.12 * vel, 0.02);
    return v.done(end);
  },
  n(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 150, 100, 0.14, 0.002, 0.55 * vel, 0.45);
    noiseHit(v, 'white', 'lowpass', 1200, 0.7, 0.001, 0.08 * vel, 0.05);
    return v.done(end);
  },
  N(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 220, 150, 0.12, 0.002, 0.5 * vel, 0.38);
    noiseHit(v, 'white', 'lowpass', 1600, 0.7, 0.001, 0.08 * vel, 0.04);
    return v.done(end);
  },
  y(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = noiseHit(v, 'white', 'highpass', 3800, 0.5, 0.003, 0.18 * vel, 1.6);
    noiseHit(v, 'white', 'bandpass', 8000, 1, 0.002, 0.1 * vel, 0.8);
    return v.done(end);
  },
  g(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = toneHit(v, 'sine', 3700, 0, 0, 0.001, 0.07 * vel, 1.1);
    toneHit(v, 'sine', 7900, 0, 0, 0.001, 0.025 * vel, 0.6);
    return v.done(end);
  },
  j(E, d, t, vel) {
    const v = new Voice(E, d, t), n = v.noise('white'), b1 = v.filter('bandpass', 7800, 8), b2 = v.filter('bandpass', 10500, 8), g = v.gain(), p = g.gain, pk = 0.5 * vel;
    n.connect(b1); n.connect(b2); b1.connect(g); b2.connect(g); g.connect(v.out);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk, t + 0.001); p.exponentialRampToValueAtTime(pk * 0.15, t + 0.011);
    p.linearRampToValueAtTime(pk * 0.9, t + 0.012); p.exponentialRampToValueAtTime(pk * 0.15, t + 0.024);
    p.linearRampToValueAtTime(pk * 0.8, t + 0.025); p.exponentialRampToValueAtTime(pk * 0.001, t + 0.17); p.linearRampToValueAtTime(0, t + 0.18);
    return v.done(t + 0.18);
  },
  p(E, d, t, vel, o) { return INST.timp(E, d, t, o.timpF || 73.42, 1, vel, o); },
  f(E, d, t, vel) {
    const v = new Voice(E, d, t);
    const end = noiseHit(v, 'white', 'bandpass', 2800, 3, 0.001, 0.4 * vel, 0.035);
    toneHit(v, 'sine', 1900, 1500, 0.01, 0.001, 0.06 * vel, 0.02);
    return v.done(end);
  },
};

// ------------------------------------------------------------------ loudness normalization
// Measured with a reference phrase (8th-note arpeggios, vel 0.8, raw engine) so that every instrument at
// part vol 1.0 sits at about -26 LUFS (chord instruments -27); drums: kick ~ snare, hats/shakers ~9 dB lower.
const INST_GAIN = {
  bell: 0.75, brass: 1.43, bubble: 1.78, celesta: 0.82, chip: 5.0, choirlead: 0.93, drivebass: 0.65, flute: 1.0, glass: 1.1,
  glock: 1.0, guitar: 1.2, harp: 0.76, lead: 3.4, marimba: 1.16, musicbox: 0.8, piano: 1.07, pizz: 1.5, pluck: 2.75,
  softbass: 0.52, strings: 2.4, synbass: 0.75, timp: 0.62, toypiano: 1.24, whistle: 1.02,
  choir: 1.53, glasspad: 1.76, pad: 1.53, warmpad: 1.15,
};
const DRUM_GAIN = {
  k: 0.6, K: 0.56, s: 1.45, S: 1.19, c: 2.3, h: 1.55, o: 1.05, m: 1.5, e: 1.93, b: 0.89, B: 1.0, t: 2.75, T: 2.04,
  w: 1.43, r: 2.98, n: 0.8, N: 0.92, y: 0.74, g: 0.84, j: 1.33, p: 0.62, f: 4.27,
};

// ------------------------------------------------------------------ song player
class Player {
  constructor(E, song, dry, wet, t0, loop) {
    const c = E.ctx;
    this.E = E; this.s = song; this.t0 = t0; this.loop = loop;
    this.out = c.createGain(); this.wet = c.createGain();
    this.out.connect(dry); this.wet.connect(wet);
    this.ch = song.parts.map((p) => {
      const g = c.createGain(), pan = E.panner(p.pan), sg = c.createGain();
      g.gain.value = p.vol; sg.gain.value = p.rev;
      g.connect(pan); pan.connect(this.out); pan.connect(sg); sg.connect(this.wet);
      return g;
    });
    this.phase = song.introBeats > 0 ? 0 : 1;
    this.idx = 0; this.k = 0;
    this.stopAt = Infinity; this.disposeAt = Infinity; this.done = false; this.dead = false;
  }
  fadeIn(t, dur) {
    for (const g of [this.out.gain, this.wet.gain]) { g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + Math.max(dur, 0.01)); }
  }
  timeOf(ev) {
    const s = this.s;
    return this.phase === 0 ? this.t0 + ev.b * s.spb : this.t0 + (s.introBeats + this.k * s.loopBeats + ev.b) * s.spb;
  }
  /** schedule every event that starts before `until` (absolute ctx time) */
  schedule(until) {
    if (this.done) return;
    const now = this.E.ctx.currentTime, lim = Math.min(until, this.stopAt);
    for (let guard = 0; guard < 4000; guard++) {
      const list = this.phase === 0 ? this.s.intro : this.s.body;
      if (this.idx >= list.length) {
        if (!this.loop) { this.done = true; return; }
        if (this.phase === 0) { this.phase = 1; this.idx = 0; this.k = 0; continue; }
        if (!list.length || this.s.loopBeats <= 0) { this.done = true; return; }
        // only advance to the next iteration once its start is inside the window
        const nextStart = this.t0 + (this.s.introBeats + (this.k + 1) * this.s.loopBeats) * this.s.spb;
        if (nextStart + list[0].b * this.s.spb >= lim) return;
        this.k++; this.idx = 0;
        continue;
      }
      const ev = list[this.idx], t = this.timeOf(ev);
      if (t >= lim) return;
      this.idx++;
      if (t < now - 0.03) continue; // missed (throttled timer / late start): skip instead of bursting
      try { this.E._playEvent(this, ev, Math.max(t, now)); } catch (e) { this.E._err('note', e); }
    }
  }
  stop(now, fade) {
    const f = Math.max(0.03, fade || 0);
    for (const g of [this.out.gain, this.wet.gain]) {
      const v = g.value;
      g.cancelScheduledValues(now); g.setValueAtTime(v, now); g.linearRampToValueAtTime(0, now + f);
    }
    this.stopAt = Math.min(this.stopAt, now + f);
    this.disposeAt = now + f + 4;
  }
  dispose() {
    this.done = true; this.dead = true;
    try { this.out.disconnect(); this.wet.disconnect(); } catch (e) { /* ignore */ }
    for (const g of this.ch) { try { g.disconnect(); } catch (e) { /* ignore */ } }
  }
}

// ------------------------------------------------------------------ SFX recipe context
// Recipes (js/game/sfx.js) receive this object. Times are in seconds relative to the sound start and
// frequencies in Hz; both are scaled by the `pitch` playback multiplier automatically.
//   S.tone({ w:'sine'|'triangle'|'square'|'sawtooth'|wave, f, f2, fd, fc:'exp'|'lin', t, d, a, v, env:'exp'|'hold'|'lin', rel,
//            vib:[rate, cents, delay, fade], am:[rate, depth], lp:[f0,f1,q,sweepT], hp:[...], bp:[...] })
//   S.noise({ c:'white'|'pink'|'brown', rate, t, d, a, v, env, lp, hp, bp, am })
//   S.fm({ f, f2, ratio, idx:[i0,i1], t, d, a, v, env, lp... })
//   S.note(inst, 'C6'|midi, t, dur, vel, opts)   S.chord(inst, notes[], t, dur, vel, opts)   S.arp(inst, notes[], t, step, dur, vel)
//   S.drum(letter, t, vel)   S.rev(send)   S.rnd(a, b)
class SfxCtx {
  constructor(E, t, vol, pitch, pan) {
    this.E = E; this.t = t; this.p = pitch; this.ts = 1 / pitch; this.end = t + 0.05; this.voices = [];
    const c = E.ctx;
    this.in = c.createGain(); this.in.gain.value = vol;
    this.pan = E.panner(pan); this.send = c.createGain(); this.send.gain.value = 0.12;
    this.in.connect(this.pan); this.pan.connect(E.sDry); this.pan.connect(this.send); this.send.connect(E.sWet);
  }
  rev(x) { this.send.gain.value = x; }
  rnd(a = 0, b = 1) { return a + (b - a) * this.E.rng(); }
  _filters(v, node, o, t, d) {
    for (const [type, key] of [['highpass', 'hp'], ['lowpass', 'lp'], ['bandpass', 'bp']]) {
      const spec = o[key];
      if (!spec) continue;
      const arr = Array.isArray(spec) ? spec : [spec];
      const fl = v.filter(type, arr[0] * this.p, arr[2] ?? (type === 'bandpass' ? 1.5 : 0.7));
      if (arr[1]) fl.frequency.exponentialRampToValueAtTime(clamp(arr[1] * this.p, 20, this.E.nyq * 0.95), t + (arr[3] != null ? arr[3] * this.ts : d));
      node.connect(fl); node = fl;
    }
    return node;
  }
  _env(p, t, d, o) {
    const a = (o.a ?? 0.004) * this.ts, pk = o.v ?? 0.3;
    if (o.env === 'hold') { const rel = (o.rel ?? 0.08) * this.ts; return envPts(p, t, t + Math.max(d - rel, a + 0.005), [[a, pk]], rel); }
    if (o.env === 'lin') { p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk, t + a); p.linearRampToValueAtTime(0, t + Math.max(d, a + 0.005)); return t + Math.max(d, a + 0.005); }
    return perc(p, t, a, pk, Math.max(d - a, 0.01));
  }
  _out(v, g, o) {
    if (o.am) {
      const depth = clamp(o.am[1], 0, 1), ag = v.gain(1 - depth * 0.5);
      v.lfo(o.am[0], depth * 0.5, ag.gain);
      g.connect(ag); ag.connect(v.out);
    } else g.connect(v.out);
  }
  _fin(v, end) { v.done(end); this.end = Math.max(this.end, v.end); this.voices.push(v); return v; }
  tone(o) {
    const t = this.t + (o.t || 0) * this.ts, d = (o.d || 0.2) * this.ts, v = new Voice(this.E, this.in, t);
    const f0 = (o.f || 440) * this.p, s = v.osc(o.w || 'sine', f0, o.det || 0);
    if (o.f2) {
      const f1 = clamp(o.f2 * this.p, 1, this.E.nyq), fd = (o.fd ?? o.d ?? 0.2) * this.ts;
      if (o.fc === 'lin') s.frequency.linearRampToValueAtTime(f1, t + fd); else s.frequency.exponentialRampToValueAtTime(f1, t + fd);
    }
    if (o.vib) v.lfo(o.vib[0], o.vib[1], s.detune, (o.vib[2] || 0) * this.ts, (o.vib[3] ?? 0.05) * this.ts);
    const g = v.gain();
    this._filters(v, s, o, t, d).connect(g);
    this._out(v, g, o);
    return this._fin(v, this._env(g.gain, t, d, o));
  }
  noise(o) {
    const t = this.t + (o.t || 0) * this.ts, d = (o.d || 0.2) * this.ts, v = new Voice(this.E, this.in, t);
    const s = v.noise(o.c || 'white', (o.rate || 1) * Math.sqrt(this.p)), g = v.gain();
    this._filters(v, s, o, t, d).connect(g);
    this._out(v, g, o);
    return this._fin(v, this._env(g.gain, t, d, o));
  }
  fm(o) {
    const t = this.t + (o.t || 0) * this.ts, d = (o.d || 0.3) * this.ts, v = new Voice(this.E, this.in, t);
    const f = (o.f || 440) * this.p, ratio = o.ratio || 2, idx = o.idx || [2, 0.2];
    const c = v.osc(o.w || 'sine', f), m = v.osc('sine', f * ratio), mg = v.gain();
    m.connect(mg); mg.connect(c.frequency);
    if (o.f2) {
      const f2 = clamp(o.f2 * this.p, 1, this.E.nyq), fd = (o.fd ?? o.d ?? 0.3) * this.ts;
      c.frequency.exponentialRampToValueAtTime(f2, t + fd); m.frequency.exponentialRampToValueAtTime(clamp(f2 * ratio, 1, this.E.nyq), t + fd);
    }
    const dev0 = clamp(f * ratio * idx[0], 0.5, 8000), dev1 = clamp(f * ratio * idx[1], 0.5, 8000);
    mg.gain.setValueAtTime(dev0, t); mg.gain.exponentialRampToValueAtTime(dev1, t + d);
    const g = v.gain();
    this._filters(v, c, o, t, d).connect(g);
    this._out(v, g, o);
    return this._fin(v, this._env(g.gain, t, d, o));
  }
  note(inst, n, t = 0, dur = 0.25, vel = 0.8, opts = {}) {
    const midi = noteToMidi(n) + 12 * Math.log2(this.p), tt = this.t + t * this.ts;
    let v;
    if (CHORD[inst]) v = CHORD[inst](this.E, this.in, tt, [mtof(midi)], dur * this.ts, vel, opts);
    else v = (INST[inst] || INST.celesta)(this.E, this.in, tt, mtof(midi), dur * this.ts, vel, opts);
    v.setLevel(INST_GAIN[inst] ?? 1);
    this.end = Math.max(this.end, v.end); this.voices.push(v);
    return v;
  }
  chord(inst, notes, t = 0, dur = 0.5, vel = 0.8, opts = {}) {
    if (CHORD[inst]) {
      const fs = notes.map((n) => mtof(noteToMidi(n) + 12 * Math.log2(this.p)));
      const v = CHORD[inst](this.E, this.in, this.t + t * this.ts, fs, dur * this.ts, vel, opts).setLevel(INST_GAIN[inst] ?? 1);
      this.end = Math.max(this.end, v.end); this.voices.push(v);
      return v;
    }
    notes.forEach((n, i) => this.note(inst, n, t + i * (opts.strum || 0), dur, vel, opts));
    return null;
  }
  arp(inst, notes, t = 0, step = 0.06, dur, vel = 0.8, opts = {}) {
    notes.forEach((n, i) => this.note(inst, n, t + i * step, dur ?? step * 2, Array.isArray(vel) ? vel[i] : vel, opts));
  }
  drum(letter, t = 0, vel = 0.8, opts = {}) {
    const fn = DRUMS[letter];
    if (!fn) return null;
    const v = fn(this.E, this.in, this.t + t * this.ts, vel, opts).setLevel(DRUM_GAIN[letter] ?? 1);
    this.end = Math.max(this.end, v.end); this.voices.push(v);
    return v;
  }
  kill(t) {
    const g = this.in.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.04);
    for (const v of this.voices) v.kill(t + 0.01);
    this.end = Math.min(this.end, t + 0.06);
  }
  dispose() { try { this.in.disconnect(); this.pan.disconnect(); this.send.disconnect(); } catch (e) { /* ignore */ } }
}

// ------------------------------------------------------------------ engine
const volCurve = (v) => { v = clamp(+v || 0, 0, 1); return v * v; };
function rampTo(param, v, now, dur = 0.06) {
  const cur = param.value;
  param.cancelScheduledValues(now); param.setValueAtTime(cur, now); param.linearRampToValueAtTime(v, now + dur);
}
export class AudioEngine {
  constructor(ctx, opts = {}) {
    this.ctx = ctx; this.nyq = ctx.sampleRate / 2; this.manual = !!opts.manual; this.raw = !!opts.raw;
    this.rng = makeRng(opts.seed || 0x5eed1);
    this.waves = buildWaves(ctx); this.noise = buildNoise(ctx, this.rng);
    this.voices = []; this.sfxActive = []; this.players = [];
    this.music = null; this.musicId = null; this.jinglePlayer = null;
    this.lastSfx = new Map(); this.errors = []; this.stats = { maxVoices: 0, steals: 0 };
    this.maxVoices = opts.maxVoices || 40; this.maxSfx = opts.maxSfx || 14;
    this.lookahead = 0.25; this._lastWall = 0;
    this._duckUntil = 0; this._duckLevel = 1;
    this._graph(volCurve(opts.musicVolume ?? 0.8), volCurve(opts.sfxVolume ?? 0.9));
  }
  _err(where, e) { if (this.errors.length < 50) this.errors.push(where + ': ' + (e && e.message ? e.message : e)); if (!this.manual) console.warn('[audio]', where, e); }
  panner(pan = 0) {
    const c = this.ctx;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); return p; }
    return c.createGain();
  }
  _graph(mv, sv) {
    const c = this.ctx, G = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };
    // master: gain -> glue compressor -> limiter -> soft clipper (never exceeds ~0.98)
    this.master = G(0.8);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.knee.value = 12; this.comp.ratio.value = 2.5; this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.1;
    this.clipPre = G(0.5); this.clip = c.createWaveShaper(); this.clip.curve = makeClipCurve(); this.clip.oversample = '2x';
    if (this.raw) this.master.connect(c.destination); // calibration: bypass dynamics
    else { this.master.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(this.clipPre); this.clipPre.connect(this.clip); this.clip.connect(c.destination); }
    // shared reverb
    this.reverb = c.createConvolver(); this.reverb.normalize = true; this.reverb.buffer = makeIR(c);
    this.revOut = G(this.raw ? 0 : 0.6); this.reverb.connect(this.revOut); this.revOut.connect(this.master);
    // music: tracks -> duck -> volume ; jingles bypass the duck
    this.mDry = G(); this.mWet = G(); this.mDuck = G(); this.mWetDuck = G(); this.mVol = G(mv); this.mWetVol = G(mv);
    this.mDry.connect(this.mDuck); this.mDuck.connect(this.mVol); this.mVol.connect(this.master);
    this.mWet.connect(this.mWetDuck); this.mWetDuck.connect(this.mWetVol); this.mWetVol.connect(this.reverb);
    this.jDry = G(0.9); this.jWet = G(0.9); this.jDry.connect(this.mVol); this.jWet.connect(this.mWetVol);
    // sfx
    this.sDry = G(); this.sWet = G(); this.sVol = G(sv); this.sWetVol = G(sv);
    this.sDry.connect(this.sVol); this.sVol.connect(this.master); this.sWet.connect(this.sWetVol); this.sWetVol.connect(this.reverb);
  }
  setMusicVolume(v) { const g = volCurve(v), now = this.ctx.currentTime; rampTo(this.mVol.gain, g, now); rampTo(this.mWetVol.gain, g, now); }
  setSfxVolume(v) { const g = volCurve(v), now = this.ctx.currentTime; rampTo(this.sVol.gain, g, now); rampTo(this.sWetVol.gain, g, now); }

  _addVoice(v, t) {
    // Voices can be scheduled ahead of time (jingles schedule all notes at once), so count only the voices
    // that actually overlap the new note's start time and steal the oldest of those.
    const vs = this.voices, now = this.ctx.currentTime;
    if (vs.length >= 16) { let j = 0; for (const x of vs) if (x.end > now) vs[j++] = x; vs.length = j; }
    let live = 0, oldest = null;
    for (const x of vs) if (x.t <= t + 1e-4 && x.end > t) { live++; if (!oldest || x.t < oldest.t) oldest = x; }
    if (live >= this.maxVoices && oldest) {
      this.stats.steals++;
      oldest.kill(t);
      live--;
    }
    vs.push(v);
    if (live + 1 > this.stats.maxVoices) this.stats.maxVoices = live + 1;
  }
  _playEvent(pl, ev, t) {
    const part = pl.s.parts[ev.p], dst = pl.ch[ev.p];
    if (ev.dr) { const fn = DRUMS[ev.dr]; if (fn) this._addVoice(fn(this, dst, t, ev.v, part.opts).setLevel(DRUM_GAIN[ev.dr] ?? 1), t); return; }
    const dur = ev.d * pl.s.spb * (ev.g ?? 1), inst = part.inst, lv = INST_GAIN[inst] ?? 1;
    if (CHORD[inst]) { this._addVoice(CHORD[inst](this, dst, t, [].concat(ev.m).map(mtof), dur, ev.v, part.opts).setLevel(lv), t); return; }
    const fn = INST[inst] || INST.pluck;
    const o = ev.gl != null ? { ...part.opts, from: mtof(ev.gl) } : part.opts;
    for (const m of [].concat(ev.m)) this._addVoice(fn(this, dst, t, mtof(m), dur, ev.v, o).setLevel(lv), t);
  }

  playMusic(id, { fade = 0.8, restart = false } = {}) {
    const song = getCompiled(id);
    if (!song) { this._err('playMusic', 'unknown track ' + id); return false; }
    if (this.musicId === id && this.music && !restart) return true;
    const now = this.ctx.currentTime, t0 = now + 0.06;
    if (this.music) this.music.stop(now, fade);
    const pl = new Player(this, song, this.mDry, this.mWet, t0, true);
    if (fade > 0.01) pl.fadeIn(now, fade * (this.music ? 1 : 0.6));
    this.music = pl; this.musicId = id; this.players.push(pl);
    pl.schedule(now + this.lookahead);
    return true;
  }
  stopMusic(fade = 0.8) {
    if (this.music) this.music.stop(this.ctx.currentTime, fade);
    this.music = null; this.musicId = null;
  }
  duck(level = 0.35, dur = 1.2) {
    const now = this.ctx.currentTime;
    level = clamp(+level || 0, 0, 1); dur = Math.max(0.05, +dur || 0);
    let until = now + dur;
    if (now < this._duckUntil) { level = Math.min(level, this._duckLevel); until = Math.max(until, this._duckUntil); }
    this._duckUntil = until; this._duckLevel = level;
    for (const p of [this.mDuck.gain, this.mWetDuck.gain]) {
      const cur = p.value;
      p.cancelScheduledValues(now); p.setValueAtTime(cur, now);
      p.linearRampToValueAtTime(level, now + 0.12);
      p.setValueAtTime(level, Math.max(until, now + 0.13));
      p.linearRampToValueAtTime(1, Math.max(until, now + 0.13) + 0.7);
    }
  }
  jingle(id) {
    const song = getCompiled(id, true);
    if (!song) { this._err('jingle', 'unknown jingle ' + id); return 0; }
    const now = this.ctx.currentTime, t0 = now + 0.03;
    if (this.jinglePlayer && !this.jinglePlayer.dead) this.jinglePlayer.stop(now, 0.12);
    const pl = new Player(this, song, this.jDry, this.jWet, t0, false);
    pl.schedule(t0 + song.lengthSec + 0.5);
    pl.disposeAt = t0 + song.lengthSec + song.tail + 3;
    this.players.push(pl); this.jinglePlayer = pl;
    this.duck(song.duck ?? 0.28, song.lengthSec + 0.25);
    return song.lengthSec;
  }
  sfx(name, { vol = 1, pitch = 1, pan = 0 } = {}) {
    const fn = SFX[name];
    if (!fn) { this._err('sfx', 'unknown sfx ' + name); return; }
    const now = this.ctx.currentTime;
    const last = this.lastSfx.get(name);
    if (last !== undefined && now - last < 0.03 && now >= last) return; // same sound in the same frame
    this.lastSfx.set(name, now);
    let act = this.sfxActive;
    if (act.length) { act = this.sfxActive = act.filter((s) => { if (s.end + 0.3 > now) return true; s.dispose(); return false; }); }
    const live = act.filter((s) => s.end > now);
    if (live.length >= this.maxSfx) live[0].kill(now);
    const trim = Math.pow(10, ((SFX_GAIN && SFX_GAIN[name]) || 0) / 20);
    const S = new SfxCtx(this, now + 0.004, clamp(+vol || 0, 0, 2) * trim, clamp(+pitch || 1, 0.25, 4), clamp(+pan || 0, -1, 1));
    try { fn(S); } catch (e) { this._err('sfx ' + name, e); }
    this.sfxActive.push(S);
  }
  /** schedule all players up to absolute time `until` and clean up finished ones */
  scheduleUntil(until) {
    const now = this.ctx.currentTime;
    for (const p of this.players) if (!p.done) p.schedule(until);
    if (this.players.some((p) => now > p.disposeAt)) {
      this.players = this.players.filter((p) => { if (now > p.disposeAt) { p.dispose(); return false; } return true; });
    }
    if (this.sfxActive.length > 24) this.sfxActive = this.sfxActive.filter((s) => { if (s.end + 0.3 > now) return true; s.dispose(); return false; });
  }
  /** live timer callback: adaptive lookahead grows when callbacks arrive late (background/throttled tabs) */
  tick() {
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const gap = this._lastWall ? wall - this._lastWall : 0.025;
    this._lastWall = wall;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const want = Math.max(0.25, hidden ? 1.6 : 0, Math.min(gap * 1.6 + 0.1, 3));
    this.lookahead = want >= this.lookahead ? want : Math.max(want, this.lookahead * 0.97);
    this.scheduleUntil(this.ctx.currentTime + this.lookahead);
  }
}

// ------------------------------------------------------------------ public facade
const ST = { ctx: null, eng: null, timer: 0, mv: 0.8, sv: 0.9, userSuspended: false, warned: new Set() };
const running = () => !!(ST.eng && ST.ctx && ST.ctx.state === 'running');
const warnOnce = (msg) => { if (!ST.warned.has(msg)) { ST.warned.add(msg); console.warn('[audio] ' + msg); } };

export const Audio = {
  ready: false,
  currentMusic: null,
  init() {
    try {
      if (typeof window === 'undefined') return false;
      if (!ST.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        let ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        ST.ctx = ctx;
        const nav = typeof navigator !== 'undefined' ? navigator : {};
        const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') || (nav.hardwareConcurrency || 8) <= 4;
        ST.eng = new AudioEngine(ctx, { musicVolume: ST.mv, sfxVolume: ST.sv, maxVoices: mobile ? 28 : 40, maxSfx: mobile ? 10 : 14 });
        ST.timer = setInterval(() => { try { ST.eng.tick(); } catch (e) { warnOnce('tick failed: ' + e.message); } }, 25);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { try { ST.eng.tick(); } catch (e) { /* ignore */ } });
        try { // iOS unlock: start a silent buffer inside the user gesture
          const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
          s.buffer = b; s.connect(ctx.destination); s.start(0);
        } catch (e) { /* ignore */ }
        this.ready = true;
        if (this.currentMusic) ST.eng.playMusic(this.currentMusic, { fade: 1.2 });
      }
      if (ST.ctx.state === 'suspended' && !ST.userSuspended) ST.ctx.resume().catch(() => {});
    } catch (e) {
      warnOnce('init failed: ' + (e && e.message));
    }
    return this.ready;
  },
  resume() {
    ST.userSuspended = false;
    try { if (ST.ctx && ST.ctx.state === 'suspended') ST.ctx.resume().catch(() => {}); } catch (e) { /* ignore */ }
  },
  suspend() {
    ST.userSuspended = true;
    try { if (ST.ctx && ST.ctx.state === 'running') ST.ctx.suspend().catch(() => {}); } catch (e) { /* ignore */ }
  },
  setMusicVolume(v) { ST.mv = clamp(+v || 0, 0, 1); try { if (ST.eng) ST.eng.setMusicVolume(ST.mv); } catch (e) { /* ignore */ } },
  setSfxVolume(v) { ST.sv = clamp(+v || 0, 0, 1); try { if (ST.eng) ST.eng.setSfxVolume(ST.sv); } catch (e) { /* ignore */ } },
  get musicVolume() { return ST.mv; },
  get sfxVolume() { return ST.sv; },
  playMusic(id, opts = {}) {
    if (!SONGS[id]) { warnOnce('unknown music "' + id + '"'); return; }
    const restart = !!(opts && opts.restart);
    if (this.currentMusic === id && !restart && (!ST.eng || ST.eng.musicId === id)) return;
    this.currentMusic = id;
    try { if (ST.eng) ST.eng.playMusic(id, { fade: opts && opts.fade != null ? +opts.fade : 0.8, restart }); } catch (e) { warnOnce('playMusic: ' + e.message); }
  },
  stopMusic(fade = 0.8) {
    this.currentMusic = null;
    try { if (ST.eng) ST.eng.stopMusic(+fade || 0); } catch (e) { /* ignore */ }
  },
  duck(level = 0.35, dur = 1.2) { try { if (running()) ST.eng.duck(level, dur); } catch (e) { /* ignore */ } },
  jingle(id) {
    if (!JINGLES[id]) { warnOnce('unknown jingle "' + id + '"'); return 0; }
    try { if (running()) return ST.eng.jingle(id); } catch (e) { warnOnce('jingle: ' + e.message); }
    return 0;
  },
  sfx(name, opts) {
    if (!SFX[name]) { warnOnce('unknown sfx "' + name + '"'); return; }
    try { if (running()) ST.eng.sfx(name, opts || {}); } catch (e) { warnOnce('sfx: ' + e.message); }
  },
  get musicIds() { return Object.keys(SONGS); },
  get jingleIds() { return Object.keys(JINGLES); },
  get sfxNames() { return Object.keys(SFX); },
  /** length info for a track: { intro, loop } seconds */
  trackInfo(id) { const s = getCompiled(id); return s ? { intro: s.introSec, loop: s.loopSec, bpm: s.bpm, bars: s.nBars } : null; },
};

// ------------------------------------------------------------------ offline rendering (tests / tools)
/** Render a scripted scenario offline. actions: [{ t, fn(engine) }]. The live scheduler is simulated by
 *  suspending the OfflineAudioContext every `step` seconds and calling scheduleUntil(), like the timer does. */
export async function renderScenario(seconds, actions = [], { sampleRate = 44100, step = 0.25, seed, raw = false } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
  const eng = new AudioEngine(oc, { manual: true, seed, raw });
  const acts = actions.slice().sort((a, b) => a.t - b.t);
  let ai = 0;
  const tick = (t) => {
    while (ai < acts.length && acts[ai].t <= t + 1e-9) { try { acts[ai].fn(eng); } catch (e) { eng._err('action', e); } ai++; }
    eng.scheduleUntil(t + step + 0.15);
  };
  tick(0);
  const n = Math.ceil(seconds / step);
  for (let i = 1; i < n; i++) { const t = i * step; oc.suspend(t).then(() => { tick(t); oc.resume(); }); }
  const buf = await oc.startRendering();
  return { buf, eng };
}
export const AudioTest = {
  SONGS, JINGLES, SFX, getCompiled, renderScenario, AudioEngine, INST, CHORD, DRUMS,
  compileAll() {
    const errors = [];
    for (const id of Object.keys(SONGS)) { try { errors.push(...compileSong(SONGS[id], id).errors); } catch (e) { errors.push(id + ': ' + e.message); } }
    for (const id of Object.keys(JINGLES)) { try { errors.push(...compileSong(JINGLES[id], id, true).errors); } catch (e) { errors.push('jingle ' + id + ': ' + e.message); } }
    return errors;
  },
};
export default Audio;

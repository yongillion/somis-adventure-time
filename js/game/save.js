// ============================================================================
// save.js — persistent progress (localStorage, guarded) + settings
// ============================================================================
const KEY = 'somi-adventure-save-v1';
const SKEY = 'somi-adventure-settings-v1';

function load(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
function store(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (_) { return false; }
}

export function newSaveData(difficulty = 'normal') {
  return {
    version: 1,
    difficulty,
    created: Date.now(),
    playTime: 0,
    unlockedStage: 1,
    stages: {}, // id -> { cleared, puffies:[], cookies:[], secrets:[], best:0, time:0 }
    chars: ['cat'],
    currentChar: 'cat',
    pets: {}, // id -> { xp }
    currentPet: null,
    candies: 0,
    totalCandies: 0,
    seenOpening: false,
    seenEnding: false,
    flags: {},
    lastStage: 1,
  };
}

export const Save = {
  data: null,
  settings: { music: 0.75, sfx: 0.85, quality: 'auto', shake: true, vibrate: true, showControls: true },
  hasSave() { const d = load(KEY); return !!(d && d.version === 1); },
  loadGame() {
    const d = load(KEY);
    if (d && d.version === 1) {
      this.data = Object.assign(newSaveData(d.difficulty), d);
      if (!this.data.chars.includes('cat')) this.data.chars.unshift('cat');
      return true;
    }
    return false;
  },
  newGame(difficulty) { this.data = newSaveData(difficulty); this.write(); },
  write() { if (this.data) store(KEY, this.data); },
  wipe() { try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } this.data = null; },
  loadSettings() { const s = load(SKEY); if (s) Object.assign(this.settings, s); },
  writeSettings() { store(SKEY, this.settings); },
  stage(id) {
    const d = this.data;
    if (!d.stages[id]) d.stages[id] = { cleared: false, puffies: [], cookies: [], secrets: [], best: 0, time: 0 };
    return d.stages[id];
  },
  hasChar(id) { return this.data && this.data.chars.includes(id); },
  unlockChar(id) { if (!this.hasChar(id)) { this.data.chars.push(id); this.write(); return true; } return false; },
  hasPet(id) { return !!(this.data && this.data.pets[id]); },
  addPet(id) { if (!this.hasPet(id)) { this.data.pets[id] = { xp: 0 }; if (!this.data.currentPet) this.data.currentPet = id; this.write(); return true; } return false; },
  flag(k, v) { if (v === undefined) return !!(this.data && this.data.flags[k]); this.data.flags[k] = v; return v; },
  totalPuffies() { let n = 0; for (const k in this.data.stages) n += this.data.stages[k].puffies.length; return n; },
};

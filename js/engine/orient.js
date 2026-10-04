// ============================================================================
// orient.js — the game is always laid out in landscape.
// On a touch device whose browser is in portrait (phone held upright, or
// auto-rotate turned off), the whole game layer (#app) is turned by 90° instead
// of asking the player to rotate the phone. Gravity tells which way the phone is
// being held, so the picture is never upside down. In fullscreen, Android also
// locks the screen to landscape and the rotation simply switches itself off.
//
// Everything that works with pointer coordinates converts them with toLocal(),
// and UI sizes use --vw / --vh (1% of the landscape box) instead of vw / vh.
// ============================================================================
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// phones / tablets (a touch laptop with a mouse is not one)
export const isMobileDevice = () => {
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!touch) return false;
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  return coarse || isIOS || /Android|Mobile/i.test(navigator.userAgent);
};

export const Orient = {
  rot: 0, // degrees the game layer is turned: 0 | 90 | -90
  dir: 90, // turn used while the browser is portrait: 90 = phone turned to the left (most common)
  touch: false,
  W: 1, H: 1, // real viewport
  w: 1, h: 1, // landscape box the game lives in
  _onChange: null,
  _cand: 0, _candN: 0,

  init(onChange) {
    this._onChange = onChange;
    this.touch = isMobileDevice();
    const later = () => setTimeout(() => this._changed(), 120);
    window.addEventListener('orientationchange', later);
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', later);
    // which way is the phone actually held? (Android reports it without a permission prompt)
    if (this.touch && !isIOS && 'DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', (e) => {
        const g = e.accelerationIncludingGravity;
        if (!g || g.x == null || g.y == null) return;
        const x = g.x, y = g.y;
        if (Math.abs(x) < 6.5 || Math.abs(x) < Math.abs(y) * 1.4) { this._candN = 0; return; }
        const want = x > 0 ? 90 : -90; // right edge up -> turned left -> rotate +90°
        if (want === this.dir) { this._candN = 0; return; }
        if (this._cand !== want) { this._cand = want; this._candN = 0; }
        if (++this._candN >= 8) { this.dir = want; this._candN = 0; if (this.rot) this._changed(); }
      });
    }
    this.apply();
  },
  _changed() { if (this._onChange) this._onChange(); else this.apply(); },

  // recompute the layout from the current viewport; returns true when the rotation changed
  apply() {
    const W = window.innerWidth || 1, H = window.innerHeight || 1;
    const rot = this.touch && H > W * 1.02 ? this.dir : 0;
    const de = document.documentElement, st = de.style;
    const changed = rot !== this.rot;
    this.rot = rot; this.W = W; this.H = H;
    this.w = rot ? H : W; this.h = rot ? W : H;
    de.classList.toggle('rot', rot !== 0);
    de.classList.toggle('narrow', this.w / this.h <= 4 / 3); // media queries see the real viewport, not the game box
    st.setProperty('--vw', this.w / 100 + 'px');
    st.setProperty('--vh', this.h / 100 + 'px');
    if (rot) {
      st.setProperty('--app-w', this.w + 'px');
      st.setProperty('--app-h', this.h + 'px');
      st.setProperty('--app-tf', rot === 90 ? `translate(${W}px, 0px) rotate(90deg)` : `translate(0px, ${H}px) rotate(-90deg)`);
    }
    return changed;
  },

  // viewport (clientX/clientY) -> coordinates inside the landscape game box
  toLocal(x, y) {
    if (this.rot === 90) return [y, this.W - x];
    if (this.rot === -90) return [this.H - y, x];
    return [x, y];
  },
};

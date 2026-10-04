// ============================================================================
// boot.js — loading screen: prewarm models & shaders, then show the title
// ============================================================================
import { CTX } from '../ctx.js';
import { h } from '../ui/ui.js';
import { ICON } from '../ui/icons.js';
import { Overlay } from '../ui/overlay.js';
import { Save } from '../save.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function bootToTitle(game) {
  Overlay.init(game);
  const ui = document.getElementById('ui');
  const bar = h('i');
  const msg = h('div', { class: 'msg' }, '꿈나라로 가는 중...');
  const el = h('div', { class: 'loading' }, h('div', { class: 'star', html: ICON.star }), h('div', { class: 'bar' }, bar), msg);
  ui.appendChild(el);
  const steps = [];
  const tips = ['별사탕을 모아요...', '뭉실이들을 깨우는 중...', '동물 친구들을 부르는 중...', '꿈 등불을 닦는 중...', '별고래를 기다리는 중...'];
  const { prewarmAnimals, ANIMAL_SPECS } = await import('../models/animals.js');
  const ids = Object.keys(ANIMAL_SPECS);
  for (let i = 0; i < ids.length; i++) steps.push(() => prewarmAnimals([ids[i]]));
  steps.push(async () => { await import('../models/pets.js'); await import('../models/enemies.js'); await import('../models/npcs.js'); await import('../models/bosses.js'); await import('../models/props.js'); await import('../models/objects.js'); });
  steps.push(async () => { await import('../modes/title.js'); await import('../modes/map.js'); await import('../modes/stage.js'); });
  for (let i = 0; i < steps.length; i++) {
    await steps[i]();
    bar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
    if (i % 6 === 0) msg.textContent = tips[(i / 6) % tips.length | 0];
    await tick();
  }
  Save.loadGame();
  const { TitleMode } = await import('./title.js');
  await game.setMode(new TitleMode());
  el.style.transition = 'opacity .6s';
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 700);
  void CTX;
}

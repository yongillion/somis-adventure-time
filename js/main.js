// ============================================================================
// main.js — entry point
// ============================================================================
import { Game } from './game/game.js';
import { StageMode } from './game/modes/stage.js';
import { Save } from './game/save.js';
import { CTX, DIFFICULTY } from './game/ctx.js';

function fatal(msg) {
  const ui = document.getElementById('ui');
  const d = document.createElement('div');
  d.className = 'err';
  d.innerHTML = msg;
  ui.appendChild(d);
}

async function boot() {
  let game;
  try {
    game = new Game(document.getElementById('gl'), document.getElementById('ui'));
  } catch (e) {
    console.error(e);
    fatal('이 기기에서는 3D 그래픽(WebGL2)을 켤 수 없어요.<br>최신 크롬이나 사파리에서 다시 열어 주세요.');
    return;
  }
  window.__game = game;
  window.__CTX = CTX;
  const q = new URLSearchParams(location.search);
  if (q.get('debug')) CTX.debug = true;
  if (q.get('nobake')) CTX.noBake = true;
  game.start();
  if (q.get('stage')) {
    if (!Save.loadGame()) Save.newGame(q.get('diff') || 'normal');
    CTX.diff = DIFFICULTY[q.get('diff') || Save.data.difficulty] || DIFFICULTY.normal;
    const id = q.get('stage');
    if (q.get('at')) Save.flag('seen:stage' + id + 'intro', true);
    for (const f of (q.get('flags') || '').split(',').filter(Boolean)) Save.flag(f, true);
    await game.setMode(new StageMode(id === 'test' ? 'test' : +id, { intro: q.get('intro') === '1', spawn: q.get('at') ? { pos: (() => { const a = q.get('at').split(',').map(Number); return { x: a[0], y: a[1], z: a[2], clone() { return this; } }; })(), yaw: 0 } : null }));
    window.__ready = true;
    return;
  }
  if (q.get('seq')) {
    // direct entry into story sequences (testing)
    if (!Save.loadGame()) Save.newGame('normal');
    CTX.diff = DIFFICULTY[Save.data.difficulty] || DIFFICULTY.normal;
    const S = await import('./game/story/sequences.js');
    const s = q.get('seq');
    if (s === 'opening') await S.playOpening(game);
    else if (s.startsWith('memory')) await S.playMemory(+s.slice(6));
    else if (s === 'ending') await S.playEnding(game);
    else if (s === 'credits') await S.playCredits();
    window.__ready = true;
    return;
  }
  const { bootToTitle } = await import('./game/modes/boot.js');
  await bootToTitle(game);
  window.__ready = true;
}
boot();

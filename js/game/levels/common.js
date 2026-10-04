// ============================================================================
// levels/common.js — helpers shared by stage scripts: control-text helpers,
// first-visit stage intro (camera flyover + greeter dialog), quick NPCs.
// ============================================================================
import { Ease } from '../../engine/math.js';
import { CTX } from '../ctx.js';
import { Save } from '../save.js';

export const T = () => !!(CTX.game && CTX.game.touchMode);
// pick the right control wording for touch vs keyboard/gamepad
export const ctl = (touch, keys) => (T() ? touch : keys);
export const SOMI = '소미';
export const meFace = () => 'char:' + (CTX.player ? CTX.player.charId : 'cat');

// A friendly Puffy NPC with lines (strings or [who, text, face] arrays). color 0..5.
export function puffyNpc(L, x, y, z, color, lines, o = {}) {
  // lines: strings, [who, text, face] arrays (face 'me' = the player's current animal) or a function returning them
  const fn = () => (typeof lines === 'function' ? lines() : lines).map((l) => (Array.isArray(l) && l[2] === 'me' ? [l[0], l[1], meFace()] : l));
  return L.npc('puffy', x, y, z, fn, { color, name: o.name || '뭉실이', yaw: o.yaw ?? 0, auto: !!o.auto, r: o.r ?? 2.4, after: o.after });
}

// First-visit intro: camera flyover through `shots`, then greeter dialog; always shows the stage banner.
// o: { id, shots: [[[px,py,pz],[tx,ty,tz], dur], ...], lines: [...dialog], toast }
export async function stageIntro(stage, o = {}) {
  const flag = 'seen:stage' + stage.stageId + 'intro';
  const first = Save.data && !Save.flag(flag);
  if (first && (o.shots || o.lines)) {
    await stage.runCutscene(async (dir) => {
      dir.letterbox(true);
      const shots = o.shots || [];
      if (shots.length) {
        dir.shot(shots[0][0], shots[0][1], shots[0][3] || 50);
        for (let i = 1; i < shots.length; i++) await dir.camTo(shots[i][0], shots[i][1], shots[i - 1][2] ?? 3, Ease.inOutSine, shots[i][3] || 50);
        if (shots.length === 1) await dir.wait(shots[0][2] ?? 2);
      }
      if (o.lines && o.lines.length) {
        const p = stage.player;
        if (o.showPlayer !== false) {
          // frame the player for the dialog
          const yaw = p.yaw + Math.PI;
          dir.camTo([p.pos.x + Math.sin(yaw) * 5.5, p.pos.y + 2.4, p.pos.z + Math.cos(yaw) * 5.5], [p.pos.x, p.pos.y + 1.0, p.pos.z], 1.2);
        }
        await dir.say(o.lines.map((l) => (Array.isArray(l) && l[2] === 'me' ? [l[0], l[1], meFace()] : l)));
      }
      dir.letterbox(false);
    });
    if (Save.data) { Save.flag(flag, true); Save.write(); }
  }
  CTX.hud.banner('스테이지 ' + stage.stageId, stage.def.name, 2.8);
  if (o.toast) setTimeout(() => CTX.hud.toast(o.toast, 'good', 3.2), 1500);
  return first;
}

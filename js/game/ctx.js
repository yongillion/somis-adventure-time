// ============================================================================
// ctx.js — shared game context (service locator) + global tuning constants
// ============================================================================
export const CTX = {
  renderer: null, scene: null, camera: null, cam: null, physics: null, particles: null, shadows: null, sprites: null,
  fx: null, input: null, audio: null, save: null, diff: null, level: null, player: null, pet: null,
  enemies: null, projectiles: null, pickups: null, hud: null, ui: null, game: null,
  time: 0, timeScale: 1, worldScale: 1, hitStop: 0, paused: false,
};

export const PHYS = {
  gravity: 30, fallGravity: 36, maxFall: 20,
  runSpeed: 5.4, accelGround: 46, decelGround: 40, accelAir: 26, decelAir: 5,
  jumpVel: 11.2, jumpCut: 0.58, coyote: 0.12, buffer: 0.13,
  flapVel: 3.3, hoverGravity: 12, hoverFallHold: 1.5, hoverFallFree: 3.2, hoverSpeedMul: 0.78,
  radius: 0.36, height: 1.05, stepUp: 0.38,
};

export const DIFFICULTY = {
  normal: {
    id: 'normal', name: '보통', desc: '처음 하는 친구에게 딱 좋아요. 하트가 넉넉하고, 떨어져도 바로 옆에서 다시 시작해요.',
    maxHp: 6, hoverTime: 4.2, flaps: 6, invuln: 1.6, enemySpeed: 0.85, enemyDmg: 1, bossDmg: 1, bossHp: 0.8,
    hazardSpeed: 0.85, fallTo: 'safe', fallDmg: 1, heartRate: 0.35, deathPenalty: 0, extraEnemies: false, color: '#7fd67a',
  },
  hard: {
    id: 'hard', name: '어렵게', desc: '조금 더 도전! 적이 빨라지고, 떨어지면 체크포인트로 돌아가요.',
    maxHp: 5, hoverTime: 3.3, flaps: 5, invuln: 1.3, enemySpeed: 1.0, enemyDmg: 1, bossDmg: 1, bossHp: 1.0,
    hazardSpeed: 1.0, fallTo: 'checkpoint', fallDmg: 1, heartRate: 0.2, deathPenalty: 0.1, extraEnemies: true, color: '#ffb347',
  },
  veryhard: {
    id: 'veryhard', name: '매우 어렵게', desc: '진짜 모험가를 위한 난이도! 하트가 적고 보스가 아주 강해요.',
    maxHp: 4, hoverTime: 2.5, flaps: 4, invuln: 1.05, enemySpeed: 1.18, enemyDmg: 1, bossDmg: 2, bossHp: 1.35,
    hazardSpeed: 1.15, fallTo: 'checkpoint', fallDmg: 2, heartRate: 0.1, deathPenalty: 0.25, extraEnemies: true, color: '#ff6b8a',
  },
};

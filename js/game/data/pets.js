// ============================================================================
// pets.js — 15 pet companions. Each gives a passive/automatic power that
// grows with level (Lv1..Lv5). XP is earned each time the power is used.
// ============================================================================

export const PET_XP = [0, 8, 22, 45, 80]; // xp needed to reach Lv1..Lv5
export const MAX_PET_LEVEL = 5;

export const PETS = [
  { id: 'bee', name: '붕붕이', kind: '꿀벌', color: '#ffd84a', power: 'regen', title: '꿀 치유',
    desc: (lv) => `${[0, 28, 24, 20, 16, 12][lv]}초마다 하트를 1개 회복해 줘요.`, val: [0, 28, 24, 20, 16, 12] },
  { id: 'butterfly', name: '나풀이', kind: '나비', color: '#f5a8ff', power: 'flutter', title: '나풀나풀 날개',
    desc: (lv) => `호버링을 ${[0, 1, 2, 2, 3, 4][lv]}번 더 할 수 있고, 더 천천히 떨어져요.`, val: [0, 1, 2, 2, 3, 4] },
  { id: 'sparrow', name: '짹짹이', kind: '참새', color: '#c9a07a', power: 'airjump', title: '짹짹 점프',
    desc: (lv) => `공중에서 ${lv >= 4 ? 2 : 1}번 더 점프할 수 있어요. (점프력 ${[0, 70, 78, 86, 92, 100][lv]}%)`, val: [0, 0.7, 0.78, 0.86, 0.92, 1.0] },
  { id: 'seagull', name: '끼룩이', kind: '갈매기', color: '#e8f0ff', power: 'glide', title: '바닷바람 활공',
    desc: (lv) => `호버링이 끝나도 점프를 누르고 있으면 ${[0, 2, 3, 4, 5, 6][lv]}초 동안 활공해요.`, val: [0, 2, 3, 4, 5, 6] },
  { id: 'parrot', name: '따라쟁이', kind: '앵무새', color: '#5fd38a', power: 'echo', title: '따라 하기 공격',
    desc: (lv) => `공격할 때 깃털을 함께 쏴요. (힘 ${[0, 0.5, 0.6, 0.8, 1, 1.2][lv]})`, val: [0, 0.5, 0.6, 0.8, 1, 1.2] },
  { id: 'owl', name: '부엉박사', kind: '부엉이', color: '#b88b5e', power: 'reveal', title: '박사님의 눈',
    desc: (lv) => `${[0, 6, 8, 10, 12, 15][lv]}m 안의 숨은 비밀을 보여주고, 가장 가까운 비밀 방향을 알려줘요.`, val: [0, 6, 8, 10, 12, 15] },
  { id: 'ladybug', name: '점박이', kind: '무당벌레', color: '#ff5a5a', power: 'luck', title: '행운의 점',
    desc: (lv) => `적을 물리치면 별사탕과 하트가 더 잘 나와요. (행운 +${[0, 20, 30, 40, 55, 70][lv]}%)`, val: [0, 0.2, 0.3, 0.4, 0.55, 0.7] },
  { id: 'dragonfly', name: '쌩쌩이', kind: '잠자리', color: '#5ad0ff', power: 'speed', title: '쌩쌩 달리기',
    desc: (lv) => `달리기가 ${[0, 8, 12, 16, 20, 25][lv]}% 빨라져요.`, val: [0, 0.08, 0.12, 0.16, 0.2, 0.25] },
  { id: 'firefly', name: '반짝이', kind: '반딧불이', color: '#d8ff6a', power: 'light', title: '반짝 불빛',
    desc: (lv) => `어둠을 밝히고 ${[0, 6, 7, 8, 9, 11][lv]}m 안의 유령 발판을 보이게 해요.`, val: [0, 6, 7, 8, 9, 11] },
  { id: 'hummingbird', name: '윙윙이', kind: '벌새', color: '#4fd8c8', power: 'magnet', title: '꿀 자석',
    desc: (lv) => `${[0, 3, 4, 5, 6, 8][lv]}m 안의 별사탕을 끌어와요.`, val: [0, 3, 4, 5, 6, 8] },
  { id: 'dove', name: '구구', kind: '비둘기', color: '#f4f4ff', power: 'shield', title: '평화의 방패',
    desc: (lv) => `공격을 한 번 막아줘요. ${[0, 30, 25, 20, 16, 12][lv]}초마다 다시 충전돼요.`, val: [0, 30, 25, 20, 16, 12] },
  { id: 'woodpecker', name: '콕콕이', kind: '딱따구리', color: '#ff6a5a', power: 'peck', title: '콕콕 쪼기',
    desc: (lv) => `가까운 적을 ${[0, 3, 2.5, 2, 1.6, 1.2][lv]}초마다 콕! 쪼아요.`, val: [0, 3, 2.5, 2, 1.6, 1.2] },
  { id: 'canary', name: '랄라', kind: '카나리아', color: '#ffe84a', power: 'lullaby', title: '자장가',
    desc: (lv) => `${[0, 18, 15, 12, 10, 8][lv]}초마다 노래해서 주변 적을 재워요.`, val: [0, 18, 15, 12, 10, 8] },
  { id: 'eagle', name: '용감이', kind: '아기 독수리', color: '#c58a4a', power: 'power', title: '용감한 힘',
    desc: (lv) => `공격력이 ${[0, 25, 35, 50, 65, 80][lv]}% 세져요.`, val: [0, 0.25, 0.35, 0.5, 0.65, 0.8] },
  { id: 'phoenix', name: '피닉스', kind: '불사조', color: '#ff8a3a', power: 'revive', title: '불사조의 깃털',
    desc: (lv) => `하트가 모두 사라지면 하트 ${[0, 2, 3, 3, 4, 99][lv] === 99 ? '가득' : [0, 2, 3, 3, 4, 99][lv] + '개'}로 다시 일어나요. (체크포인트마다 1번)`, val: [0, 2, 3, 3, 4, 99] },
];

export const PET_BY_ID = Object.fromEntries(PETS.map((p) => [p.id, p]));
export const PET_IDS = PETS.map((p) => p.id);

export function petLevel(xp) {
  let lv = 1;
  for (let i = 1; i < PET_XP.length; i++) if (xp >= PET_XP[i]) lv = i + 1;
  return Math.min(lv, MAX_PET_LEVEL);
}
export function petLevelProgress(xp) {
  const lv = petLevel(xp);
  if (lv >= MAX_PET_LEVEL) return { lv, frac: 1, need: 0 };
  const a = PET_XP[lv - 1], b = PET_XP[lv];
  return { lv, frac: (xp - a) / (b - a), need: b - xp };
}
// stage where each pet event happens
export const PET_STAGE = {
  bee: 1, butterfly: 1, sparrow: 2, ladybug: 2, hummingbird: 3, canary: 3, firefly: 4, parrot: 4,
  seagull: 5, dragonfly: 5, owl: 6, dove: 6, woodpecker: 7, eagle: 7, phoenix: 8,
};

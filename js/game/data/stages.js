// ============================================================================
// stages.js — stage metadata (names, themes, colors) + lazy script loading
// ============================================================================
export const STAGES = {
  test: { id: 'test', name: '테스트 섬', theme: 'meadow', baseSat: 1, color: 0xff6b8a },
  1: { id: 1, name: '꽃구름 들판', sub: '빨강 꿈빛', theme: 'meadow', color: 0xff6b8a, colorName: '빨강', boss: 'mushking', baseSat: 0.32 },
  2: { id: 2, name: '노을 과일 협곡', sub: '주황 꿈빛', theme: 'canyon', color: 0xff9a3a, colorName: '주황', boss: 'pumpkin', baseSat: 0.3 },
  3: { id: 3, name: '해바라기 꿀벌 언덕', sub: '노랑 꿈빛', theme: 'honey', color: 0xffd84a, colorName: '노랑', boss: 'thundercloud', baseSat: 0.3 },
  4: { id: 4, name: '반딧불 정글', sub: '초록 꿈빛', theme: 'jungle', color: 0x5fd86a, colorName: '초록', boss: 'chameleon', baseSat: 0.3 },
  5: { id: 5, name: '수정 바다', sub: '파랑 꿈빛', theme: 'sea', color: 0x4aa8ff, colorName: '파랑', boss: 'octopus', baseSat: 0.3 },
  6: { id: 6, name: '오로라 눈꽃 산', sub: '남색 꿈빛', theme: 'snow', color: 0x6a6aff, colorName: '남색', boss: 'yeti', baseSat: 0.3 },
  7: { id: 7, name: '장난감 시계탑', sub: '보라 꿈빛', theme: 'toy', color: 0xb06aff, colorName: '보라', boss: 'clockknight', baseSat: 0.3 },
  8: { id: 8, name: '달빛 꿈의 정원', sub: '마음의 빛', theme: 'moon', color: 0xfff4c8, colorName: '마음', boss: 'fogking', baseSat: 0.3 },
};
export const STAGE_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

const loaders = {
  test: () => import('../levels/test.js'),
  1: () => import('../levels/stage1.js'),
  2: () => import('../levels/stage2.js'),
  3: () => import('../levels/stage3.js'),
  4: () => import('../levels/stage4.js'),
  5: () => import('../levels/stage5.js'),
  6: () => import('../levels/stage6.js'),
  7: () => import('../levels/stage7.js'),
  8: () => import('../levels/stage8.js'),
};
export async function loadStageScript(id) {
  const m = await loaders[id]();
  return m.default || m;
}

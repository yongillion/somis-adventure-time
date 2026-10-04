// ============================================================================
// characters.js — gameplay definitions for Somi's 30 animal forms.
// attack.kind: melee | shot | lob | boomerang | breath | beam | wave | spin | smash | tongue
// tags on attacks: fire | ice | water | wind | heavy | light  (interact with level objects)
// special.id is implemented in systems/abilities.js
// ============================================================================

export const CHARACTERS = [
  {
    id: 'cat', name: '고양이', color: '#ffc9dc',
    stats: { speed: 1.0, jump: 1.0 },
    attack: { kind: 'melee', name: '냥냥 펀치', anim: 'swipe', combo: 3, dmg: 1, range: 1.35, arc: 140, sfx: 'swipe' },
    special: { id: 'airdash', name: '냥냥 대시', desc: '앞으로 쌩! 하늘에서도 한 번 대시할 수 있어요.', cd: 0.7, label: '대시' },
  },
  {
    id: 'rabbit', name: '토끼', color: '#ffe0ea',
    stats: { speed: 1.05, jump: 1.08 },
    attack: { kind: 'shot', name: '당근 미사일', proj: 'carrot', speed: 17, dmg: 1, count: 1, life: 0.7, sfx: 'shoot' },
    special: { id: 'moonjump', name: '달토끼 점프', desc: '잠깐 동안 달나라처럼 몸이 가벼워져서 아주 높이 뛰어요.', cd: 8, label: '달점프' },
  },
  {
    id: 'dog', name: '강아지', color: '#ffe2b0',
    stats: { speed: 1.1, jump: 1.0 },
    attack: { kind: 'boomerang', name: '뼈다귀 부메랑', proj: 'bone', speed: 14, dmg: 1, range: 7, sfx: 'boomerang' },
    special: { id: 'sniff', name: '킁킁 냄새 맡기', desc: '숨겨진 보물과 친구를 찾아내요. 화살표가 길을 알려줘요!', cd: 10, label: '킁킁' },
  },
  {
    id: 'sheep', name: '양', color: '#fff4e8',
    stats: { speed: 0.95, jump: 1.0, flaps: 1 },
    attack: { kind: 'lob', name: '솜뭉치 통통', proj: 'wool', speed: 9, up: 5, dmg: 1, bounce: 2, life: 2.2, sfx: 'bounce' },
    special: { id: 'cloudpad', name: '몽글 구름 발판', desc: '발 밑에 폭신한 구름 발판을 만들어요. 떨어질 때 쓰면 좋아요!', cd: 5, label: '구름' },
  },
  {
    id: 'cow', name: '소', color: '#f4f4ff',
    stats: { speed: 0.95, jump: 0.95, heavy: true },
    attack: { kind: 'wave', name: '음메 방울 소리', range: 2.6, arc: 360, dmg: 1, sfx: 'bell', fx: 'ring' },
    special: { id: 'rush', name: '음메 돌진', desc: '힘차게 돌진해서 금 간 바위벽도 부숴요.', cd: 2.5, label: '돌진' },
  },
  {
    id: 'kangaroo', name: '캥거루', color: '#ffd2a8',
    stats: { speed: 1.05, jump: 1.15 },
    attack: { kind: 'melee', name: '복싱 펀치', anim: 'punch', combo: 2, dmg: 2, range: 1.5, arc: 90, tags: ['heavy'], knock: 9, sfx: 'punch' },
    special: { id: 'superjump', name: '캥거루 슈퍼 점프', desc: '꾹 눌러 힘을 모았다가 떼면 아주아주 높이 뛰어요.', cd: 1.2, label: '슈퍼점프', hold: true },
  },
  {
    id: 'koala', name: '코알라', color: '#e3e6f2',
    stats: { speed: 0.9, jump: 1.0, climb: true },
    attack: { kind: 'boomerang', name: '유칼립투스 잎 부메랑', proj: 'leaf', speed: 12, dmg: 1, range: 6, sfx: 'boomerang' },
    special: { id: 'nap', name: '쿨쿨 낮잠', desc: '잠깐 낮잠을 자고 하트를 2개 회복해요. 덩굴 벽도 오를 수 있어요.', cd: 18, label: '낮잠' },
  },
  {
    id: 'quokka', name: '쿼카', color: '#ffe0c6',
    stats: { speed: 1.0, jump: 1.05 },
    attack: { kind: 'shot', name: '하트 빔', proj: 'heart', speed: 15, dmg: 1, count: 1, pierce: true, life: 0.8, sfx: 'magic' },
    special: { id: 'smile', name: '세상 행복 스마일', desc: '활짝 웃으면 주변 먹구름이들이 착해지고 하트가 1개 회복돼요.', cd: 14, label: '스마일' },
  },
  {
    id: 'bear', name: '곰돌이', color: '#e8c8a8',
    stats: { speed: 0.92, jump: 0.95, heavy: true },
    attack: { kind: 'smash', name: '꿀단지 해머', dmg: 2, range: 1.7, arc: 120, tags: ['heavy'], sfx: 'hammer', shock: 2.6 },
    special: { id: 'pound', name: '곰돌이 쿵!', desc: '하늘에서 쿵! 금 간 바닥을 부수고 주변 적을 기절시켜요.', cd: 0.9, label: '쿵!' },
  },
  {
    id: 'elephant', name: '코끼리', color: '#d5ddf6',
    stats: { speed: 0.88, jump: 0.92, heavy: true },
    attack: { kind: 'shot', name: '땅콩 세 발', proj: 'peanut', speed: 14, dmg: 1, count: 3, spread: 0.32, life: 0.65, sfx: 'shoot' },
    special: { id: 'spray', name: '코끼리 물뿌리기', desc: '물을 뿌려 씨앗을 큰 꽃으로 키우고 불도 꺼요.', cd: 2.5, label: '물뿌리기' },
  },
  {
    id: 'shark', name: '상어', color: '#bfe0ff',
    stats: { speed: 1.08, jump: 1.0, swim: true },
    attack: { kind: 'melee', name: '앙! 깨물기', anim: 'bite', combo: 2, dmg: 2, range: 1.6, arc: 70, lunge: 5, sfx: 'bite' },
    special: { id: 'finswim', name: '지느러미 잠수', desc: '땅과 물 속으로 쏙! 지느러미만 내밀고 빠르게 헤엄쳐요.', cd: 3.5, label: '잠수' },
  },
  {
    id: 'dolphin', name: '돌고래', color: '#c4f0ff',
    stats: { speed: 1.05, jump: 1.05, swim: true },
    attack: { kind: 'shot', name: '물방울 링', proj: 'ring', speed: 13, dmg: 1, pierce: true, life: 0.9, tags: ['water'], sfx: 'bubble' },
    special: { id: 'bubble', name: '방울 방패', desc: '커다란 물방울이 한 번 지켜주고 천천히 떨어지게 해줘요.', cd: 9, label: '방울' },
  },
  {
    id: 'dragon', name: '드래곤', color: '#c8f5dc',
    stats: { speed: 1.0, jump: 1.0 },
    attack: { kind: 'breath', name: '불꽃 숨결', dmg: 1, range: 3.4, tags: ['fire'], dur: 0.45, sfx: 'fire', color: 'fire' },
    special: { id: 'fly', name: '드래곤 비행', desc: '날개를 펄럭펄럭! 점프를 누르면 하늘을 날 수 있어요.', cd: 4, label: '비행' },
  },
  {
    id: 'tiger', name: '호랑이', color: '#ffd7aa',
    stats: { speed: 1.12, jump: 1.05 },
    attack: { kind: 'melee', name: '호랑이 발톱', anim: 'swipe', combo: 3, dmg: 1.5, range: 1.6, arc: 160, sfx: 'swipe' },
    special: { id: 'pounce', name: '어흥 덮치기', desc: '가까운 적에게 휙 날아가 힘센 공격을 해요.', cd: 1.4, label: '덮치기' },
  },
  {
    id: 'panda', name: '판다', color: '#f2f2f2',
    stats: { speed: 0.95, jump: 1.0 },
    attack: { kind: 'spin', name: '대나무 봉 돌리기', dmg: 1.5, range: 1.7, sfx: 'spin', weapon: 'bamboo' },
    special: { id: 'vault', name: '대나무 장대뛰기', desc: '장대로 휘익~ 아주 멀리 뛰어 넘어요.', cd: 1.2, label: '장대' },
  },
  {
    id: 'fox', name: '여우', color: '#ffd0a8',
    stats: { speed: 1.12, jump: 1.05 },
    attack: { kind: 'shot', name: '꼬리 회오리', proj: 'tornado', speed: 9, dmg: 1, pierce: true, life: 1.0, tags: ['wind'], sfx: 'wind' },
    special: { id: 'foxfire', name: '여우불', desc: '파란 여우불 세 개가 빙글빙글 지켜줘요. 횃불도 켤 수 있어요.', cd: 12, label: '여우불' },
  },
  {
    id: 'penguin', name: '펭귄', color: '#cfdcff',
    stats: { speed: 0.95, jump: 0.95, swim: true },
    attack: { kind: 'lob', name: '눈덩이 던지기', proj: 'snowball', speed: 10, up: 4, dmg: 1, tags: ['ice'], life: 1.6, sfx: 'throw' },
    special: { id: 'slide', name: '배 미끄럼', desc: '배로 쭈욱~ 미끄러져요. 낮은 틈도 지나갈 수 있어요.', cd: 0.4, label: '미끄럼', hold: true },
  },
  {
    id: 'pig', name: '돼지', color: '#ffd0dc',
    stats: { speed: 0.95, jump: 1.0 },
    attack: { kind: 'shot', name: '진흙 공', proj: 'mud', speed: 12, dmg: 1, life: 0.8, slow: true, sfx: 'throw' },
    special: { id: 'dig', name: '꿀꿀 보물찾기', desc: '반짝이는 흙더미를 파면 보물이 나와요!', cd: 0.8, label: '땅파기' },
  },
  {
    id: 'hamster', name: '햄스터', color: '#ffe6b8',
    stats: { speed: 1.05, jump: 1.0 },
    attack: { kind: 'shot', name: '해바라기씨 연사', proj: 'seed', speed: 18, dmg: 0.6, count: 1, rapid: 0.12, life: 0.5, sfx: 'shoot' },
    special: { id: 'ball', name: '햄스터 볼', desc: '공 속에 쏙! 데굴데굴 빠르게 굴러요. 가시도 괜찮아요.', cd: 0.5, label: '햄스터볼' },
  },
  {
    id: 'squirrel', name: '다람쥐', color: '#f5c9a6',
    stats: { speed: 1.1, jump: 1.05, climb: true },
    attack: { kind: 'lob', name: '도토리 폭탄', proj: 'acorn', speed: 10, up: 4.5, dmg: 1.5, boom: 1.6, life: 1.6, sfx: 'throw' },
    special: { id: 'glide', name: '날다람쥐 활공', desc: '하늘에서 누르고 있으면 멀리멀리 날아가요.', cd: 0.3, label: '활공', hold: true },
  },
  {
    id: 'lion', name: '사자', color: '#ffe39e',
    stats: { speed: 1.05, jump: 1.0, heavy: true },
    attack: { kind: 'melee', name: '사자 펀치', anim: 'punch', combo: 2, dmg: 2, range: 1.6, arc: 100, tags: ['heavy'], knock: 8, sfx: 'punch' },
    special: { id: 'roar', name: '사자후', desc: '어흥! 주변 적을 모두 기절시키고 바람개비도 돌려요.', cd: 8, label: '포효' },
  },
  {
    id: 'giraffe', name: '기린', color: '#fff0a8',
    stats: { speed: 1.0, jump: 1.0 },
    attack: { kind: 'melee', name: '머리 박치기', anim: 'headbutt', combo: 1, dmg: 1.5, range: 2.0, arc: 70, sfx: 'punch' },
    special: { id: 'neck', name: '쭉쭉 목 늘리기', desc: '목을 쭈욱 늘려서 높은 곳의 스위치와 보물에 닿아요.', cd: 0.8, label: '목늘리기' },
  },
  {
    id: 'monkey', name: '원숭이', color: '#f1d3b5',
    stats: { speed: 1.08, jump: 1.05, climb: true },
    attack: { kind: 'boomerang', name: '바나나 부메랑', proj: 'banana', speed: 13, dmg: 1, range: 7, sfx: 'boomerang' },
    special: { id: 'swing', name: '원숭이 그네', desc: '근처의 그네 고리를 잡고 휘익! 높이 날아올라요.', cd: 0.4, label: '그네' },
  },
  {
    id: 'frog', name: '개구리', color: '#c8f2b0',
    stats: { speed: 1.0, jump: 1.18, swim: true },
    attack: { kind: 'tongue', name: '냠냠 퉤!', range: 4.5, dmg: 1, sfx: 'whoosh' },
    special: { id: 'hook', name: '혀 갈고리', desc: '혀를 쭉! 꽃 갈고리를 잡아 휙 날아가요. 아이템도 끌어와요.', cd: 0.5, label: '갈고리' },
  },
  {
    id: 'turtle', name: '거북이', color: '#d2f0c8',
    stats: { speed: 0.9, jump: 0.95, swim: true },
    attack: { kind: 'shot', name: '등딱지 미끄럼', proj: 'shell', speed: 11, dmg: 1.5, ground: true, bounce: 3, life: 2, sfx: 'throw' },
    special: { id: 'shellspin', name: '등껍질 스핀', desc: '등껍질 속에서 빙글빙글! 가시 바닥도 지나갈 수 있어요.', cd: 3.5, label: '스핀' },
  },
  {
    id: 'unicorn', name: '유니콘', color: '#fbe3ff',
    stats: { speed: 1.05, jump: 1.05 },
    attack: { kind: 'beam', name: '무지개 빔', dmg: 1, range: 6, tags: ['light'], sfx: 'beam' },
    special: { id: 'rainbow', name: '무지개 다리', desc: '앞으로 반짝반짝 무지개 다리를 만들어요.', cd: 9, label: '무지개' },
  },
  {
    id: 'redpanda', name: '레서판다', color: '#ffc6a8',
    stats: { speed: 1.05, jump: 1.05, climb: true },
    attack: { kind: 'spin', name: '꼬리 휘두르기', dmg: 1, range: 1.5, sfx: 'spin' },
    special: { id: 'decoy', name: '레서판다 인형', desc: '인형을 두면 적이 인형만 쫓아가요. 나중에 펑!', cd: 9, label: '인형' },
  },
  {
    id: 'otter', name: '수달', color: '#e6cdb4',
    stats: { speed: 1.05, jump: 1.0, swim: true },
    attack: { kind: 'shot', name: '조개 던지기', proj: 'clam', speed: 14, dmg: 1, bounce: 1, life: 0.9, sfx: 'throw' },
    special: { id: 'waterrun', name: '물 위 달리기', desc: '물 위를 사사삭 달려요!', cd: 3, label: '물달리기' },
  },
  {
    id: 'hedgehog', name: '고슴도치', color: '#ead8c4',
    stats: { speed: 1.0, jump: 1.0 },
    attack: { kind: 'shot', name: '가시 세 발', proj: 'quill', speed: 16, dmg: 1, count: 3, spread: 0.28, life: 0.55, sfx: 'shoot' },
    special: { id: 'spikeguard', name: '가시 방패', desc: '동그랗게 몸을 말아요. 무엇이든 튕겨내요!', cd: 3, label: '가시방패' },
  },
  {
    id: 'capybara', name: '카피바라', color: '#e9cfb1',
    stats: { speed: 0.9, jump: 1.0 },
    attack: { kind: 'lob', name: '유자 던지기', proj: 'yuzu', speed: 10, up: 4, dmg: 1.5, life: 1.5, sfx: 'throw' },
    special: { id: 'slowtime', name: '느긋 타임', desc: '느긋~하게. 잠시 동안 세상이 천천히 움직여요.', cd: 14, label: '느긋' },
  },
];

export const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
export const CHAR_IDS = CHARACTERS.map((c) => c.id);

// Which stage holds each animal cookie (stage index 1..8); cat is the starting form.
export const COOKIE_STAGE = {
  rabbit: 1, dog: 1, sheep: 1,
  kangaroo: 2, squirrel: 2, pig: 2, hamster: 2,
  bear: 3, quokka: 3, koala: 3, redpanda: 3,
  monkey: 4, frog: 4, fox: 4, panda: 4, tiger: 4,
  dolphin: 5, shark: 5, otter: 5, turtle: 5,
  penguin: 6, giraffe: 6, hedgehog: 6,
  elephant: 7, lion: 7, cow: 7, capybara: 7,
  dragon: 8, unicorn: 8,
};

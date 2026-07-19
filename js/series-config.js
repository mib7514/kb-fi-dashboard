// series-config.js — 시리즈 메타데이터 (조회 페이지 + admin 공유).
// Fenrir series-config.ts에서 이 프로젝트에 필요한 필드만 추림.
// 데이터 자체는 data/*.js에 있고, 여기엔 "성질"(type/frequency/소스/표시명)만.

export const SERIES_CONFIG = {
  'kr-cpi-headline': {
    series_id: 'kr-cpi-headline',
    display_name: 'KR CPI 총지수 (NSA)',
    source: 'kosis',
    unit: '2020=100',
    value_type: 'index',
    frequency: 'monthly',
    // KOSIS CSV에서 이 시리즈를 식별하는 힌트 (admin 자동 매칭용)
    kosis_hint: { account: '총지수', transform: '원자료' },
  },
  'kr-cpi-core': {
    series_id: 'kr-cpi-core',
    display_name: 'KR Core CPI (식료품·에너지 제외, OECD)',
    source: 'kosis',
    unit: '2020=100',
    value_type: 'index',
    frequency: 'monthly',
    kosis_hint: { account: '식료품및에너지제외지수', transform: '원자료' },
  },
  'kr-cpi-lifecost': {
    series_id: 'kr-cpi-lifecost',
    display_name: 'KR 생활물가지수',
    source: 'kosis',
    unit: '2020=100',
    value_type: 'index',
    frequency: 'monthly',
    // 정확 일치 우선 — '전월세포함 생활물가지수' 등 파생 라벨과 오매칭 방지.
    kosis_hint: { account: '생활물가지수', transform: '원자료' },
  },
  'us-cpi-headline': {
    series_id: 'us-cpi-headline',
    display_name: 'US CPI All Items (NSA)',
    source: 'bls',
    unit: '1982-84=100',
    value_type: 'index',
    frequency: 'monthly',
  },
  'us-cpi-core': {
    series_id: 'us-cpi-core',
    display_name: 'US CPI ex Food & Energy (NSA)',
    source: 'bls',
    unit: '1982-84=100',
    value_type: 'index',
    frequency: 'monthly',
  },
};

export const ALL_SERIES_IDS = Object.keys(SERIES_CONFIG);

export function getConfig(seriesId) {
  return SERIES_CONFIG[seriesId] ?? null;
}

// 조회 페이지가 data/*.js가 등록한 데이터를 읽는 진입점.
// 각 data 파일은 window.FENRIR_SERIES[series_id] = { meta, series } 로 자기 등록.
export function getSeriesData(seriesId) {
  const reg = (typeof window !== 'undefined' && window.FENRIR_SERIES) || {};
  return reg[seriesId] ?? null;
}

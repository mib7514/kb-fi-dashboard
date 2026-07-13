// taylor-config.mjs — Taylor 금리압력 모듈 공용 상수. 캘리브레이션·파이프라인이 공유.
//
// 파라미터는 캘리브레이션(scripts/calibration/)으로 동결된 값. 재현검증은 scripts/calibration/RESULT.md.
// ECOS 코드는 2026-07 라이브 실검증 완료(StatisticItemList/StatisticSearch 샘플 확인).

// 동결 파라미터 — i* = r* + π + α·(π−2) + β·ygap
export const PARAMS = { rstar: 1.20, alpha: 0.25, beta: 0.45, piStar: 2.0 };

export const HP_LAMBDA = 1600;

// ECOS 시계열 정의 (STAT_CODE / ITEM_CODE / 주기). 전부 라이브 검증됨.
export const ECOS_SERIES = {
  // 국고채(3년) 일별 시장금리, 연%
  ktb3y: { stat: '817Y002', item: '010200000', cycle: 'D', unit: '%' },
  // 한국은행 기준금리 일별, 연%
  base: { stat: '722Y001', item: '0101000', cycle: 'D', unit: '%' },
  // 근원 CPI = 소비자물가지수 농산물및석유류제외지수(2020=100), 월별
  //   ※ headline(901Y010/00·901Y009 총지수)은 상관 0.816으로 기각,
  //     OECD식 core(901Y010/DB 식료품·에너지제외)는 r*가 그리드 상단 경계 → 기각. (RESULT.md)
  cpiCore: { stat: '901Y010', item: 'QB', cycle: 'M', unit: '2020=100' },
  // 실질 GDP(계절조정) = 경제활동별 GDP·GNI(계절조정,실질,분기) 국내총생산(시장가격,GDP), 분기
  gdp: { stat: '200Y104', item: '1400', cycle: 'Q', unit: '십억원(SA,실질)' },
};

// 국고3년·기준금리 적재 시작(차트/압력 계산 기준). CPI는 YoY용 12개월, GDP는 HP 워밍업용으로 더 이르게 적재.
export const KTB_START = '2015-01-01';
export const CPI_FETCH_START = '2013-01'; // YoY(12M) 여유
export const GDP_FETCH_START = '2000Q1';  // one-sided HP 워밍업(2015 시점 안정화)
export const PRESSURE_START = '2015-03';   // 압력 시계열 첫 산출월

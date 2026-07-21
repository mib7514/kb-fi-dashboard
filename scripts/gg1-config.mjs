// gg1-config.mjs — GG-1 국민소득 갭 모니터(교역조건 프록시) 공용 상수.
//
// 이 모듈은 갭 "항"만 측정한다. GDP 레벨 전망(Fenrir)과 무관하며 GDP 데이터 의존성 없음.
//   갭 프록시(%p) ≈ β × Δln(순상품교역조건, y/y).  β·프록시 계산은 GG-1b 소관.
//
// ── ECOS 시계열 (STAT_CODE / ITEM_CODE / 주기) — 2026-07-21 라이브 실검증 ──
//   StatisticTableList·StatisticItemList·StatisticSearch(sample 키, 메타·표본) 로 코드/범위/값 확인.
//   검증 근거:
//     · 순상품교역조건지수  403Y005 / A (M)          198801~202606 (최신 2026-06)
//     · 수출물가지수 총지수  402Y014 / *AA · item2=C  197101~202606  (계약통화기준)
//     · 수입물가지수 총지수  401Y015 / *AA · item2=C  197101~202606  (계약통화기준)
//     · 실질 GDP(원계열)     200Y106 / 1400 (Q)       1960Q1~2026Q1  국내총생산(시장가격)
//     · 실질 GDI(원계열)     200Y106 / 1600 (Q)       1960Q1~2026Q1  국내총소득(GDI)
//
//   ▸ 수출입물가지수는 2차 분류(ITEM_CODE2)로 계약통화(C)/달러(D)/원화(W) 기준이 공존한다.
//     교역조건은 환율효과를 제거한 상대가격 개념이므로 계약통화기준(C)을 채택.
//     (naive 총지수비는 가중·연쇄식 차이로 순상품교역조건과 정확히 일치하지는 않는다 →
//      export/import y/y 는 1b '줄다리기 분해'용 보조 지표. meta.notes 에 명기.)
//   ▸ GDP·GDI 는 동일 표(200Y106, 원계열·실질)의 레벨을 받아 같은 방식으로 y/y 산출 →
//     gap_actual_pp = gdi_yoy − gdp_yoy 가 표간 기준 불일치 없이 내적 일관.
//     ECOS 에 GDI y/y 증가율 항목이 없어(주요지표 200Y102 는 GNI y/y 만 제공) 레벨→y/y 계산.

export const ECOS_SERIES = {
  // 순상품교역조건지수 (2020=100), 월별
  tot:        { stat: '403Y005', item: 'A',    cycle: 'M', unit: '2020=100' },
  // 수출물가지수 총지수(계약통화기준) (2020=100), 월별
  exportPx:   { stat: '402Y014', item: '*AA',  item2: 'C', cycle: 'M', unit: '2020=100' },
  // 수입물가지수 총지수(계약통화기준) (2020=100), 월별
  importPx:   { stat: '401Y015', item: '*AA',  item2: 'C', cycle: 'M', unit: '2020=100' },
  // 실질 국내총생산(원계열, 시장가격 GDP), 분기
  gdp:        { stat: '200Y106', item: '1400', cycle: 'Q', unit: '십억원(실질,원계열)' },
  // 실질 국내총소득(원계열, GDI), 분기
  gdi:        { stat: '200Y106', item: '1600', cycle: 'Q', unit: '십억원(실질,원계열)' },
};

// 산출 범위: 월간·분기 모두 최근 15년(β 회귀 10yr 디폴트 + 룩백 토글 여지).
// y/y 산출을 위해 fetch 는 1년 더(=16년) 소급해 base 를 확보하고, 산출은 15년으로 trim.
export const OUTPUT_YEARS = 15;
export const LOOKBACK_YEARS = OUTPUT_YEARS + 1; // fetch 소급(=16년): y/y base 확보

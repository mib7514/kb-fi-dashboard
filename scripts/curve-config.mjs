// curve-config.mjs — Curve Phase Monitor(CP) 데이터 파이프라인 공용 상수.
//   측정 레이어. 산식·판정·UI 는 curve-phase.html / js/curve-phase/* 소관.
//
// ── ECOS·FRED 코드는 2026-07-22 라이브 실검증(StatisticItemList/StatisticSearch, StatisticSearch sample) ──
//   KR 시장금리 표 = 817Y002 (CYCLE D, 연%). ※ 명령서 메모 후보 721Y001 은 오류 — 817Y002 로 확정.
//     검증 근거(가용 시작):
//       국고채 1Y  010190000  2000-02-01
//       국고채 3Y  010200000  1998-11-13   (taylor 모듈과 동일 노드)
//       국고채 5Y  010200001  2000-01-04   ※ 접미사 001 — 형제 만기와 불규칙, 오타 주의
//       국고채 10Y 010210000  2000-12-18
//       국고채 30Y 010230000  2012-09-11   ← 발행 개시. 이전 구간은 null.
//   기준금리 = 722Y001 / 0101000 (CYCLE D, 1999-05-06~).
//     ※ 2008-03 이전은 실제로 콜금리목표제(7일물 RP '기준금리'는 2008-03 도입). ECOS 가 back-stitch 하여
//       1999~ 연속 '기준금리'로 제공. percentile 계산엔 전 기간 포함하되 콜금리목표제 각주 명기(meta.note).
//   US: FRED DGS2/DGS5/DGS10, EFFR, THREEFYTP10(ACM 10Y term premium). FRED_API_KEY 재사용.

// ── KR (ECOS) ──
export const KR_TENORS = {
  y1:  { stat: '817Y002', item: '010190000', label: '국고채 1년' },
  y3:  { stat: '817Y002', item: '010200000', label: '국고채 3년' },
  y5:  { stat: '817Y002', item: '010200001', label: '국고채 5년' },
  y10: { stat: '817Y002', item: '010210000', label: '국고채 10년' },
  y30: { stat: '817Y002', item: '010230000', label: '국고채 30년' },
};
export const KR_BASE = { stat: '722Y001', item: '0101000', label: '한국은행 기준금리' };
export const KR_CYCLE = 'D';
export const KR_UNIT = '연%';
// 백필 시작(2005-08 인상 사이클 커버). 1Y/3Y/5Y/10Y 모두 이전부터 존재, 30Y 는 2012-09 이후만.
export const KR_START = '20040102';

// ── US (FRED) ──
export const US_TENORS = {
  dgs2:  { id: 'DGS2',  label: 'UST 2Y' },
  dgs5:  { id: 'DGS5',  label: 'UST 5Y' },
  dgs10: { id: 'DGS10', label: 'UST 10Y' },
};
// 정책금리(출력키 effr): EFFR(NY Fed 거래량가중, 2000-07~) 우선, 그 이전은 DFF(연방기금 실효금리, 1954~)로
//   back-stitch. 1994 사이클을 변수1(DGS2−정책금리) 전기간 percentile 에 포함시키려면 pre-2000 이 필요.
//   두 계열 차이는 통상 <2bp(2000-07 seam 무시 가능). meta.note 에 splice 명기.
export const US_POLICY = { primary: 'EFFR', backfill: 'DFF', label: 'Fed Funds Rate (EFFR↔DFF splice)' };
export const US_TP = { id: 'THREEFYTP10', label: 'ACM 10Y Term Premium' };
export const US_UNIT = 'percent';
// 백필 시작(1994-02 인상 사이클 커버). ACM TP 는 1990년대부터 제공.
export const US_START = '1993-01-01';

// gc-config.mjs — Global Curve Compare(GC) 데이터 파이프라인 공용 상수·순수 헬퍼.
//   측정 레이어. 스프레드·z·Δ 산식은 클라이언트(GC-2) 소관 — 여기선 원금리 수집만.
//
// ── 시리즈 코드(2026-07-22 CP 모듈에서 라이브 실검증된 노드 재사용) ──
//   KR 시장금리 표 = 817Y002 (CYCLE D, 연%).  ※ 명령서 부록 후보 코드 검증 결과 817Y002 확정.
//     국고채 3Y  010200000  (1998-11-13~)
//     국고채 10Y 010210000  (2000-12-18~)
//     국고채 30Y 010230000  (2012-09-11~ 발행개시, 이전 구간 null)
//   US: FRED DGS3 / DGS10 / DGS30 (CMT, 결측일 '.' 스킵).
//
//   ▸ 원금리(yield) 저장, 스프레드는 클라이언트 계산. 국가 간 날짜 정렬·보간 금지(시리즈별 독립 plot).

export const round3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

// 출력 키 순서(파일·행 공통). 3종 만기.
export const YIELD_KEYS = ['y3', 'y10', 'y30'];
export const SERIES_LABELS = ['3Y', '10Y', '30Y'];

// ── US (FRED) ──
export const US_SERIES = { y3: 'DGS3', y10: 'DGS10', y30: 'DGS30' };

// ── KR (ECOS 817Y002) ──
export const KR_TENORS = {
  y3:  { stat: '817Y002', item: '010200000', label: '국고채 3년' },
  y10: { stat: '817Y002', item: '010210000', label: '국고채 10년' },
  y30: { stat: '817Y002', item: '010230000', label: '국고채 30년' },
};
export const KR_CYCLE = 'D';

// 'YYYYMMDD' → 'YYYY-MM-DD' / 역변환.
export const isoFromCompact = (t) => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
export const compactFromIso = (s) => s.replaceAll('-', '');

// 최초 backfill 시작(5년 전). now 를 주입받아 테스트 가능(기본 현재시각).
//   ※ 일반 CLI 스크립트라 new Date() 허용(fetch-curve-* 선례 동일). 결정성 필요 시 GC_SDATE 로 override.
export function defaultBackfillStartISO(now = new Date()) {
  const d = new Date(now.getTime());
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

// 여러 계열 Map(dateKey→value)을 날짜 합집합으로 병합 → [{d, y3, y10, y30}]. 결측 만기 null(보간 금지).
//   fmtDate: dateKey → 'YYYY-MM-DD' 변환(US 는 이미 ISO라 항등, KR 은 isoFromCompact).
export function unionRows(maps, keys, fmtDate = (d) => d) {
  const all = new Set();
  for (const k of keys) for (const d of maps[k].keys()) all.add(d);
  return [...all].sort().map((d) => {
    const row = { d: fmtDate(d) };
    for (const k of keys) row[k] = maps[k].has(d) ? round3(maps[k].get(d)) : null;
    return row;
  });
}

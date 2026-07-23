// gc-calc.js — Global Curve Compare(GC) 클라이언트 계산 레이어. 순수 함수, DOM 의존 없음.
//   GC-3 UI 가 import. 원금리(data/gc/{us,jp,kr}.json)에서 스프레드·z250·Δ 를 각국 독립 산출.
//
// [규약]
//   · s310  = (y10 − y3) × 100  (bp, 소수 1자리)   — 3/10 스프레드
//   · s1030 = (y30 − y10) × 100 (bp, 소수 1자리)   — 10/30 스프레드
//   · z250  = 트레일링 250 표본 z (모집단 표준편차 ÷n — us-credit-spread 규약 동일).
//             표본 < 250 이면 null(부분 윈도우 금지). 표준편차 0 이면 null. z 는 소수 2자리.
//   · Δ1w/Δ1m = 5/21 영업일 전(자국 행 인덱스) 대비 변화(bp, 소수 1자리). 달력일 아님.
//   · 결측(null yield)은 skip — 보간하지 않는다. 스프레드 한쪽이 null 이면 그날 스프레드 null,
//     z 버퍼에서 제외(표본에 안 셈), Δ 는 대상 인덱스가 null 이면 null.

export const Z_WINDOW = 250;

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// 스프레드(bp) = (a − b) × 100. 한쪽이라도 null 이면 null.
export function spreadBp(a, b) {
  if (a == null || b == null) return null;
  return round1((a - b) * 100);
}

// rows:[{d,y3,y10,y30}] → { s310:[{d,v}], s1030:[{d,v}] } (v = bp | null).
export function spreadSeries(rows) {
  return {
    s310: rows.map((r) => ({ d: r.d, v: spreadBp(r.y10, r.y3) })),
    s1030: rows.map((r) => ({ d: r.d, v: spreadBp(r.y30, r.y10) })),
  };
}

// 롤링 z: 트레일링 win 개 non-null 표본 기준. 표본<win → null(부분 윈도우 금지).
//   series:[{d,v}] (v=null 결측→버퍼 제외). 반환 [{d,z}] (z=null=표시 안 함).
export function rollingZ(series, win = Z_WINDOW) {
  const out = [];
  const buf = []; // 최근 win 개 non-null 값
  for (const p of series) {
    if (p.v == null) { out.push({ d: p.d, z: null }); continue; } // 결측 skip
    buf.push(p.v);
    if (buf.length > win) buf.shift();
    if (buf.length < win) { out.push({ d: p.d, z: null }); continue; } // 부분 윈도우 금지
    const mean = buf.reduce((s, v) => s + v, 0) / win;
    const varc = buf.reduce((s, v) => s + (v - mean) ** 2, 0) / win; // 모집단(÷n)
    const sd = Math.sqrt(varc);
    out.push({ d: p.d, z: sd > 0 ? round2((p.v - mean) / sd) : null });
  }
  return out;
}

// 자국 행 인덱스 기준 lag 영업일 전 대비 변화(bp). 대상 부족/한쪽 null 이면 null.
export function deltaLatest(series, lag) {
  const n = series.length;
  if (n <= lag) return null;
  const cur = series[n - 1].v;
  const prev = series[n - 1 - lag].v;
  if (cur == null || prev == null) return null;
  return round1(cur - prev);
}

// 최신 요약: { date, level(bp), z250, d1w, d1m }.
export function latestMetrics(series, zSeries) {
  const n = series.length;
  const last = n ? series[n - 1] : null;
  return {
    date: last ? last.d : null,
    level: last ? last.v : null,
    z250: zSeries.length ? zSeries[zSeries.length - 1].z : null,
    d1w: deltaLatest(series, 5),
    d1m: deltaLatest(series, 21),
  };
}

// 한 국가 rows → 두 스프레드의 { series, z, latest }.
export function computeGC(rows) {
  const { s310, s1030 } = spreadSeries(rows);
  const z310 = rollingZ(s310);
  const z1030 = rollingZ(s1030);
  return {
    s310: { series: s310, z: z310, latest: latestMetrics(s310, z310) },
    s1030: { series: s1030, z: z1030, latest: latestMetrics(s1030, z1030) },
  };
}

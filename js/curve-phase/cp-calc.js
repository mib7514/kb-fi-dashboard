// cp-calc.js — Curve Phase Monitor 계산 엔진. 순수 함수, ES module. DOM·fetch 없음.
//   단위 규약: 금리는 %(원자료), 스프레드는 bp(=%p×100). 함수 경계에서 명시.
//   Phase 2 범위: percentile · z250 · 기준금리 carry-forward 조인 · 프라이싱 갭 스프레드 · 밴드 분류.
//   (5y5y·분해는 Phase 4, 판정은 Phase 5 로 분리.)

// ── 기본 헬퍼 ──
export const nonNulls = (arr) => arr.filter((v) => typeof v === 'number' && Number.isFinite(v));

// percentile: count(v <= cur)/n*100, 현재값 포함(rv-calc.js 규약과 동일).
export function percentile(values, cur) {
  const n = values.length;
  if (!n || !Number.isFinite(cur)) return null;
  let c = 0;
  for (const v of values) if (v <= cur) c++;
  return (c / n) * 100;
}

// 트레일링 window(기본 250) 표본 z. 모집단 std, 표본<window 이면 null(fetch 스크립트 zLatest 규약과 동일).
export function zLatest(vals, window = 250) {
  if (vals.length < window) return null;
  const win = vals.slice(vals.length - window);
  const mean = win.reduce((s, v) => s + v, 0) / win.length;
  const varc = win.reduce((s, v) => s + (v - mean) ** 2, 0) / win.length;
  const sd = Math.sqrt(varc);
  if (!(sd > 0)) return null;
  return Math.round(((vals[vals.length - 1] - mean) / sd) * 100) / 100;
}

// N영업일 전 대비 변화(값 배열 대상). 표본 부족 시 null.
export function changeOverN(vals, n) {
  if (vals.length <= n) return null;
  return Math.round((vals[vals.length - 1] - vals[vals.length - 1 - n]) * 10) / 10;
}

// ── 기준금리 as-of 조회 (계단 함수, carry-forward, 보간 금지) ──
//   baseArr: [{date:'YYYY-MM-DD', rate}] 오름차순. date(YYYY-MM-DD)는 사전식=시간순.
//   기준금리는 달력일 계열이라 대개 정확 일치하나, 최신 며칠은 국고채가 앞서므로 직전 관측을 carry-forward.
export function asOfRate(baseArr, date) {
  let lo = 0, hi = baseArr.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (baseArr[mid].date <= date) { ans = baseArr[mid].rate; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans; // date 가 첫 관측 이전이면 null
}

// ── 프라이싱 갭 스프레드: (만기금리 − 기준금리), bp ──
//   yieldRows: kr_yields.data([{date, y1, y3, ...}]), baseArr: kr_base_rate.data.
//   반환 [[date, bp]] — 해당 만기 결측(예: 30Y 2012 이전)·기준금리 부재 날짜는 제외.
export function spreadSeries(yieldRows, baseArr, tenorKey) {
  const out = [];
  for (const r of yieldRows) {
    const yv = r[tenorKey];
    if (yv == null) continue;
    const bv = asOfRate(baseArr, r.date);
    if (bv == null) continue;
    out.push([r.date, Math.round((yv - bv) * 100 * 10) / 10]); // %p→bp, 1자리
  }
  return out;
}

// [[date,bp]] → 최신값·percentile(전기간)·z250 요약.
export function summarize(series, zWindow = 250) {
  if (!series.length) return { last: null, date: null, pct: null, z: null, n: 0 };
  const vals = series.map((d) => d[1]);
  const last = vals[vals.length - 1];
  return {
    last,
    date: series[series.length - 1][0],
    pct: percentile(vals, last),      // 전기간 percentile
    z: zLatest(vals, zWindow),
    n: series.length,
  };
}

// 밴드 분류(결정론 라벨). 변수1 판독 가이드용. 임계값은 초기값(관찰 후 조정, 각주 명기).
//   ≥70 잔존(resid) · ≤30 소진(exhausted) · 그 외 혼재(mixed).
export const BAND_HI = 70;
export const BAND_LO = 30;
export function band(pct) {
  if (pct == null) return null;
  if (pct >= BAND_HI) return 'resid';
  if (pct <= BAND_LO) return 'exhausted';
  return 'mixed';
}

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

// [[date,val]] → 최신값·percentile(전기간)·z250·60일 변화 요약. chg60 은 series 원단위(비반올림).
export function summarize(series, zWindow = 250) {
  if (!series.length) return { last: null, date: null, pct: null, z: null, chg60: null, n: 0 };
  const vals = series.map((d) => d[1]);
  const last = vals[vals.length - 1];
  const chg60 = vals.length > 60 ? last - vals[vals.length - 1 - 60] : null;
  return {
    last,
    date: series[series.length - 1][0],
    pct: percentile(vals, last),      // 전기간 percentile
    z: zLatest(vals, zWindow),
    chg60,                            // 60영업일 변화(원단위)
    n: series.length,
  };
}

// ── US 전용 (같은 파일 내 컬럼 조인 — carry-forward 불필요) ──
// 한 행의 두 컬럼 차(bp). DGS2−EFFR 등. 결측 행 제외.
export function colSpreadBp(rows, keyA, keyB) {
  const out = [];
  for (const r of rows) {
    if (r[keyA] == null || r[keyB] == null) continue;
    out.push([r.date, Math.round((r[keyA] - r[keyB]) * 100 * 10) / 10]);
  }
  return out;
}

// 5y5y 근사 ≈ 2×10Y − 5Y (%, 레벨). par 커브 단순근사 — 레벨 편의 존재, 방향·z 추적 전용.
//   US: (rows, 'dgs10','dgs5') 기본 · KR: (rows, 'y10','y5').
export function fwd5y5y(rows, k10 = 'dgs10', k5 = 'dgs5') {
  const out = [];
  for (const r of rows) {
    if (r[k10] == null || r[k5] == null) continue;
    out.push([r.date, Math.round((2 * r[k10] - r[k5]) * 1000) / 1000]);
  }
  return out;
}

// 두 [[date,val]] 시계열의 날짜 교집합에서 A−B (레벨). 기대성분 = 5y5y − ACM TP 용.
export function seriesDiff(a, b) {
  const mb = new Map(b.map((d) => [d[0], d[1]]));
  const out = [];
  for (const [d, v] of a) if (mb.has(d)) out.push([d, Math.round((v - mb.get(d)) * 1000) / 1000]);
  return out;
}

// ── 기울기 변화 분해 (window 영업일 롤링, bp) ──
const bp1 = (x) => Math.round(x * 100 * 10) / 10; // %p→bp, 1자리

// KR Δ(3s10s) 분해:  Δ(10Y−3Y) = 앞단[−Δ(3Y−기준)] + 뒷단[잔차 = Δ(10Y−기준)].
//   ▸ 뒷단을 '잔차'로 두는 이유: 기준금리는 계단형(정책 결정일에만 점프)이라 Δ기준이 앞·뒷단에
//     각각 +Δ기준/−Δ기준으로 상쇄되어 소거된다 → 분해는 정확 항등식이고, 앞단은 프라이싱 갭 변화
//     (3Y−기준)로 깨끗이, 뒷단은 그 나머지로 정의된다. 기준금리 as-of 는 carry-forward(계단).
//   반환: [{date, front, back, total}] (bp), 최근 nBars개.
export function decompKR(yieldRows, baseArr, window = 20, nBars = 126) {
  const rows = yieldRows
    .filter((r) => r.y3 != null && r.y10 != null)
    .map((r) => ({ date: r.date, y3: r.y3, y10: r.y10, base: asOfRate(baseArr, r.date) }))
    .filter((r) => r.base != null);
  const out = [];
  for (let i = window; i < rows.length; i++) {
    const t = rows[i], p = rows[i - window];
    const total = bp1((t.y10 - t.y3) - (p.y10 - p.y3));
    const front = bp1(-((t.y3 - t.base) - (p.y3 - p.base)));
    const back = bp1((t.y10 - t.base) - (p.y10 - p.base));
    out.push({ date: t.date, front, back, total });
  }
  return out.slice(-nBars);
}

// US Δ(2s10s) 분해 + 뒷단 2차 분해(기대 vs TP, US만 가능):
//   Δ(10Y−2Y) = 앞단[−Δ(2Y−EFFR)] + 뒷단기대[Δ((10Y−TP)−EFFR)] + 뒷단TP[ΔTP].
//   (10Y = 기대성분(10Y−TP) + TP. 뒷단 잔차 Δ(10Y−EFFR) 를 기대·TP 로 재분해.) TP 는 날짜 교집합.
//   반환: [{date, front, backExp, backTp, total}] (bp), 최근 nBars개.
export function decompUS(usRows, tpRows, window = 20, nBars = 126) {
  const tpMap = new Map(tpRows.map((r) => [r.date, r.tp10]));
  const rows = usRows
    .filter((r) => r.dgs2 != null && r.dgs10 != null && r.effr != null && tpMap.has(r.date))
    .map((r) => ({ date: r.date, y2: r.dgs2, y10: r.dgs10, effr: r.effr, tp: tpMap.get(r.date) }));
  const out = [];
  for (let i = window; i < rows.length; i++) {
    const t = rows[i], p = rows[i - window];
    const total = bp1((t.y10 - t.y2) - (p.y10 - p.y2));
    const front = bp1(-((t.y2 - t.effr) - (p.y2 - p.effr)));
    const backExp = bp1(((t.y10 - t.tp) - t.effr) - ((p.y10 - p.tp) - p.effr));
    const backTp = bp1(t.tp - p.tp);
    out.push({ date: t.date, front, backExp, backTp, total });
  }
  return out.slice(-nBars);
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

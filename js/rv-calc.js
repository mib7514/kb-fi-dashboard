// Curve RV 계산 엔진 — 순수 함수, ES module
// 단위 규약: 스프레드·롤·캐리는 bp, 금리는 %. 함수 경계에서 명시.
// 데이터 저장형: 스프레드는 %p(0.371=37.1bp), 금리는 %. bp 변환은 toBp() 사용.

export const MATURITIES = [1, 2, 3, 5, 10];
export const MATURITY_LABELS = ['1년', '2년', '3년', '5년', '10년'];

// 확장 가능한 페어 설정 (spread(X) - spread(Y))
export const PAIRS = [
  { x: '공사채AAA', y: '은행채AAA', label: '공사AAA−은행AAA' },
];

// --- 기본 헬퍼 ---
export function nonNulls(arr) {
  return arr.filter(v => typeof v === 'number' && Number.isFinite(v));
}

// %p 배열 → bp 배열 (null 보존)
export function toBp(arr) {
  return arr.map(v => (v == null || !Number.isFinite(v)) ? null : v * 100);
}

export function latest(arr) {
  const v = nonNulls(arr);
  return v.length ? v[v.length - 1] : null;
}

// 윈도우 슬라이스: 1y=최근 245, 3y=최근 750, full=전체 (비null 배열 대상)
export function windowSlice(vals, window) {
  if (window === '1y') return vals.slice(-245);
  if (window === '3y') return vals.slice(-750);
  return vals;
}

// --- 1) percentile ---
// values: 비교 대상 배열, cur: 현재값. count(v <= cur)/n*100. 현재값 포함.
export function percentile(values, cur) {
  const n = values.length;
  if (!n || !Number.isFinite(cur)) return null;
  let c = 0;
  for (const v of values) if (v <= cur) c++;
  return c / n * 100;
}

// 시리즈(널 포함)의 현재값 percentile (지정 윈도우)
export function seriesPercentile(arr, window) {
  const vals = nonNulls(arr);
  if (!vals.length) return null;
  const cur = vals[vals.length - 1];
  return percentile(windowSlice(vals, window), cur);
}

// 두 시리즈를 엮는 계산: 양쪽 비null인 날짜만 정렬 유지하며 (b - a)
export function alignedDiff(arrA, arrB) {
  const out = [];
  const n = Math.min(arrA.length, arrB.length);
  for (let i = 0; i < n; i++) {
    const a = arrA[i], b = arrB[i];
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) out.push(b - a);
  }
  return out;
}

// --- 2) 스프레드커브 기울기 ---
// arrA_bp, arrB_bp: bp 단위 스프레드 시리즈. slope = spread(B) - spread(A).
// 현재값 + full/3y percentile.
export function slopeStats(arrA_bp, arrB_bp) {
  const diff = alignedDiff(arrA_bp, arrB_bp);
  if (!diff.length) return { current: null, full: null, '3y': null };
  const cur = diff[diff.length - 1];
  return {
    current: cur,
    full: percentile(diff, cur),
    '3y': percentile(windowSlice(diff, '3y'), cur),
  };
}

// 기본 기울기 세트
export const SLOPE_SETS = [[1, 2], [2, 3], [3, 5], [5, 10], [1, 3], [3, 10]];

// --- 3) 페어 ---
// arrX_bp - arrY_bp 시계열 → 현재 + full percentile
export function pairStats(arrX_bp, arrY_bp) {
  const diff = alignedDiff(arrY_bp, arrX_bp); // b - a = X - Y
  if (!diff.length) return { current: null, full: null };
  const cur = diff[diff.length - 1];
  return { current: cur, full: percentile(diff, cur) };
}

// --- 선형보간 ---
// xs: 오름차순 그리드, ys: 대응 값. 범위 밖은 양끝값으로 클램프.
export function interp(xs, ys, t) {
  if (t <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (t <= xs[i]) {
      const x0 = xs[i - 1], x1 = xs[i], y0 = ys[i - 1], y1 = ys[i];
      return y0 + (y1 - y0) * (t - x0) / (x1 - x0);
    }
  }
  return ys[ys.length - 1];
}

// --- 4) 캐리+롤 (1년 보유) ---
// ktbByMat: {1,2,3,5,10 → 금리%}, spreadBpByMat: {1,2,3,5,10 → 스프레드bp}
// 반환: 만기별 { spread(=캐리), ktbRoll, spreadRoll, excessCarryRoll, allIn(%), dur, excessPerDur }
export function carryRoll(ktbByMat, spreadBpByMat) {
  const xs = MATURITIES;
  const yk = xs.map(m => ktbByMat[m]);
  const ys = xs.map(m => spreadBpByMat[m]);
  const out = {};
  for (const m of MATURITIES) {
    const spread = spreadBpByMat[m]; // 스프레드캐리 = 현재 스프레드(bp)
    const allIn = ktbByMat[m] + spread / 100; // 올인금리(%)
    if (m === 1) {
      // 1년물: 보유 중 만기 도래 → 롤 N/A
      out[m] = {
        maturity: 1, spread, carry: spread,
        ktbRoll: null, spreadRoll: null, excessCarryRoll: null,
        allIn, dur: null, excessPerDur: null,
      };
      continue;
    }
    const ktbRoll = (ktbByMat[m] - interp(xs, yk, m - 1)) * 100; // bp
    const spreadRoll = spread - interp(xs, ys, m - 1);           // bp
    const excessCarryRoll = spread + spreadRoll;                 // bp
    const y = allIn / 100;                                       // 소수
    const dur = (1 - Math.pow(1 + y, -m)) / y;
    out[m] = {
      maturity: m, spread, carry: spread,
      ktbRoll, spreadRoll, excessCarryRoll,
      allIn, dur, excessPerDur: excessCarryRoll / dur,
    };
  }
  return out;
}

// --- 정렬 배열 이진 삽입/카운트 (백테스트용) ---
function lowerBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
function upperBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}
function binaryInsert(a, x) { a.splice(lowerBound(a, x), 0, x); }

function bucketSummary(a) {
  const n = a.length;
  if (!n) return { n: 0, mean: null, median: null, shrinkProb: null };
  let sum = 0, neg = 0;
  for (const v of a) { sum += v; if (v < 0) neg++; }
  const sorted = [...a].sort((x, y) => x - y);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean: sum / n, median, shrinkProb: neg / n * 100 };
}

// --- 5) 백테스트 (룩어헤드 금지, expanding percentile) ---
// spreadBp: bp 단위 스프레드 시리즈(널 포함). 비null만 사용.
// 각 t에서 s[0..t]만으로 expanding percentile → 버킷(<50/50~85/>85) → forward = s[t+horizon]-s[t]
export function backtest(spreadBp, { warmup = 500, horizon = 126 } = {}) {
  const s = nonNulls(spreadBp);
  const n = s.length;
  const low = [], mid = [], high = [];
  const sorted = [];
  for (let t = 0; t < n; t++) {
    binaryInsert(sorted, s[t]); // sorted = s[0..t]
    if (t < warmup) continue;
    if (t + horizon > n - 1) continue; // forward 관측치 필요
    const pct = upperBound(sorted, s[t]) / (t + 1) * 100; // 현재값 포함 expanding percentile (weak)
    const fwd = s[t + horizon] - s[t];
    if (pct < 50) low.push(fwd);
    else if (pct > 85) high.push(fwd);
    else mid.push(fwd);
  }
  return { low: bucketSummary(low), mid: bucketSummary(mid), high: bucketSummary(high) };
}

// 현재 full percentile이 속한 버킷 키 반환
export function bucketOf(pctFull) {
  if (pctFull == null) return null;
  if (pctFull < 50) return 'low';
  if (pctFull > 85) return 'high';
  return 'mid';
}

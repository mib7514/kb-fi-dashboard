// taylor-calc.js — 수정 Taylor 금리압력 모듈의 순수 계산 코어 (측정 레이어).
// 브라우저(type=module)·Node(import) 양쪽에서 쓰는 ESM. 부작용/전략해석 없음.
//
// 모델(v1):
//   π_t    = CPI YoY (%)               = (CPI_t / CPI_{t-12} − 1) × 100
//   ygap_t = (ln 실질GDP − one-sided HP 추세(λ=1600)) × 100   [분기]
//   i*_t   = r* + π_t + α·(π_t − 2.0) + β·ygap_t
//   압력_t = i*_t − 기준금리_t
//
// HP 필터는 반드시 one-sided(각 시점까지의 데이터만) — 미래정보 누출 방지.

// ── HP 필터 ────────────────────────────────────────────────────────────────
// 최소화: Σ(y_t − τ_t)² + λ·Σ(τ_{t+1} − 2τ_t + τ_{t−1})²
// 정규방정식: (I + λ·DᵀD) τ = y,  D = (n−2)×n 2차차분행렬.
// A = I + λ·DᵀD 는 대칭 양정치 5중대각(pentadiagonal). 여기선 대칭 Cholesky(LLᵀ)로 푼다.

// 대칭 양정치 밀집행렬 A(n×n)에 대한 Cholesky 분해 후 Ax=b 풀이.
// (테스트는 별도의 Gauss 소거로 교차검증 → 알고리즘이 서로 독립.)
function choleskySolve(A, b) {
  const n = b.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) throw new Error('HP: 행렬이 양정치가 아님 (수치 문제)');
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  // Ly = b (전방대입)
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  // Lᵀx = y (후방대입)
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return Array.from(x);
}

// A = I + λ·DᵀD 를 밀집행렬로 구성.
function buildHpMatrix(n, lambda) {
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) A[i][i] = 1;
  // 각 2차차분 행 r(i=0..n-3): 계수 [1,-2,1] on (i,i+1,i+2). DᵀD += rᵀr.
  for (let i = 0; i < n - 2; i++) {
    const idx = [i, i + 1, i + 2];
    const c = [1, -2, 1];
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        A[idx[a]][idx[b]] += lambda * c[a] * c[b];
  }
  return A;
}

// 양방향(two-sided) HP 추세. y: number[], 반환: 추세 number[] (길이 동일).
// n<3 은 필터 정의 불가 → 원계열 반환(추세=데이터).
export function hpTrendTwoSided(y, lambda = 1600) {
  const n = y.length;
  if (n < 3) return y.slice();
  const A = buildHpMatrix(n, lambda);
  return choleskySolve(A, y);
}

// one-sided HP 추세: 각 시점 t 에서 y[0..t] 만으로 two-sided HP 를 풀고 그 끝점을 취함.
// 실시간 지표용(미래정보 배제). 반환 길이 = y.length.
export function hpTrendOneSided(y, lambda = 1600) {
  const n = y.length;
  const out = new Array(n);
  for (let t = 0; t < n; t++) {
    const sub = y.slice(0, t + 1);
    const tr = hpTrendTwoSided(sub, lambda);
    out[t] = tr[tr.length - 1];
  }
  return out;
}

// ── Taylor 성분 ──────────────────────────────────────────────────────────────

// CPI 지수 월별 시계열 → YoY(%). rows: [{period:'YYYY-MM', value:number}] 오름차순.
// 12개월 전 값이 있는 월만 산출. 반환: Map period→yoy(%).
export function cpiYoY(rows) {
  const idx = new Map(rows.map((r) => [r.period, r.value]));
  const out = new Map();
  for (const r of rows) {
    const [y, m] = r.period.split('-').map(Number);
    const prevKey = `${y - 1}-${String(m).padStart(2, '0')}`;
    const prev = idx.get(prevKey);
    if (prev != null && prev !== 0) out.set(r.period, (r.value / prev - 1) * 100);
  }
  return out;
}

// 산출갭(%): 분기 실질GDP index/level → ln → one-sided HP → (ln − 추세)×100.
// rows: [{period:'YYYYQn', value}] 오름차순. 반환: Map period→ygap(%).
export function outputGap(rows, lambda = 1600) {
  const ln = rows.map((r) => Math.log(r.value));
  const trend = hpTrendOneSided(ln, lambda);
  const out = new Map();
  rows.forEach((r, i) => out.set(r.period, (ln[i] - trend[i]) * 100));
  return out;
}

// 수정 Taylor 적정금리(%): i* = r* + π + α(π−2) + β·ygap
export function iStar(pi, ygap, { rstar, alpha, beta, piStar = 2.0 }) {
  return rstar + pi + alpha * (pi - piStar) + beta * ygap;
}

// Taylor 압력(%) = i* − 기준금리
export function pressure(pi, ygap, baseRate, params) {
  return iStar(pi, ygap, params) - baseRate;
}

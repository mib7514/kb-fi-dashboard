// Taylor 계산코어 앵커 테스트 — node --test (자동탐색, 인자 없이 실행).
// 핵심: one-sided HP(λ=1600) 직접구현 검증. 레퍼런스는 세 방식으로 독립 확보:
//   (1) 선형추세 정확재현 — HP 는 2차차분 페널티라 직선을 그대로 통과(수학적 성질).
//   (2) n=3 손계산 앵커 — A 를 손으로 적어 잔차가 y 로 되돌아옴을 확인한 값 하드코딩.
//   (3) 독립 알고리즘(부분피벗 Gauss 소거) 대조 — 모듈은 Cholesky, 여기선 Gauss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hpTrendTwoSided, hpTrendOneSided, cpiYoY, outputGap, iStar, pressure,
} from '../js/taylor-calc.js';

const LAMBDA = 1600;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);
const nearArr = (a, b, tol = 1e-6) => {
  assert.equal(a.length, b.length, `길이 ${a.length} ≠ ${b.length}`);
  a.forEach((v, i) => near(v, b[i], tol));
};

// ── 독립 레퍼런스 솔버: A=I+λDᵀD 구성 후 부분피벗 Gauss 소거 (모듈 Cholesky 와 독립) ──
function buildA(n, lam) {
  const A = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) A[i][i] = 1;
  for (let i = 0; i < n - 2; i++) {
    const idx = [i, i + 1, i + 2], c = [1, -2, 1];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) A[idx[a]][idx[b]] += lam * c[a] * c[b];
  }
  return A;
}
function gaussTrend(y, lam = LAMBDA) {
  const n = y.length;
  if (n < 3) return y.slice();
  const A = buildA(n, lam), b = y.slice();
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]]; [b[col], b[p]] = [b[p], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < n; k++) A[r][k] -= f * A[col][k];
      b[r] -= f * b[col];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k];
    x[i] = s / A[i][i];
  }
  return x;
}

// (1) 상수·선형 추세는 정확 재현 (2차차분 페널티=0 → 적합항이 τ=y 강제).
test('HP: 상수 시계열 → 추세=상수', () => {
  nearArr(hpTrendTwoSided([5, 5, 5, 5, 5], LAMBDA), [5, 5, 5, 5, 5], 1e-9);
});
test('HP: 선형 시계열 → 추세=데이터(정확재현)', () => {
  const y = [10, 12, 14, 16, 18, 20, 22, 24];
  nearArr(hpTrendTwoSided(y, LAMBDA), y, 1e-6);
});

// (2) n=3 손계산 앵커. A=[[1601,-3200,1600],[-3200,6401,-3200],[1600,-3200,1601]], y=[0,0,3].
// 아래 해를 A 에 대입하면 [0,0,3] 로 복원됨(수기 확인). 독립 Cramer/Gauss 로도 동일.
test('HP: n=3 손계산 앵커 (y=[0,0,3], λ=1600)', () => {
  const got = hpTrendTwoSided([0, 0, 3], LAMBDA);
  nearArr(got, [-0.4999479221, 0.9998958442, 2.5000520779], 1e-7);
});

// (3) 독립 Gauss 소거와 대조 + 하드코딩 회귀값. (임의 계열 n=7)
test('HP: 독립 Gauss 소거 대조 + 회귀 하드코딩', () => {
  const y = [3.10, 3.05, 2.90, 3.20, 3.55, 3.40, 3.30];
  const chol = hpTrendTwoSided(y, LAMBDA);
  nearArr(chol, gaussTrend(y, LAMBDA), 1e-8);            // 알고리즘 독립 교차검증
  nearArr(chol, [                                        // 별도계산 하드코딩(회귀 고정)
    3.00539059, 3.07495459, 3.14457772, 3.21430351, 3.28402265, 3.35361685, 3.42313410,
  ], 1e-6);
});

// one-sided = 각 시점 prefix 의 two-sided 끝점.
test('HP one-sided: prefix two-sided 끝점과 일치', () => {
  const y = [3.10, 3.05, 2.90, 3.20, 3.55, 3.40, 3.30];
  const os = hpTrendOneSided(y, LAMBDA);
  for (let t = 0; t < y.length; t++) {
    const tr = hpTrendTwoSided(y.slice(0, t + 1), LAMBDA);
    near(os[t], tr[tr.length - 1], 1e-12);
  }
});

// one-sided 인과성: 미래값을 바꿔도 과거 시점 산출은 불변(미래정보 누출 없음).
test('HP one-sided: 미래값 변경이 과거 산출을 바꾸지 않음', () => {
  const y = [3.10, 3.05, 2.90, 3.20, 3.55, 3.40, 3.30];
  const y2 = y.slice(); y2[6] = 9.99;
  const a = hpTrendOneSided(y, LAMBDA), b = hpTrendOneSided(y2, LAMBDA);
  for (let t = 0; t < 6; t++) near(a[t], b[t], 1e-12);   // 0..5 불변
  assert.ok(Math.abs(a[6] - b[6]) > 1e-6, '마지막 시점은 바뀌어야 함');
});

// ── Taylor 성분 ──
test('cpiYoY: 12개월 전 대비 정확, 결측월 제외', () => {
  const rows = [];
  for (let m = 1; m <= 13; m++) rows.push({ period: `2020-${String(m > 12 ? m - 12 : m).padStart(2, '0')}`, value: 0 });
  // 명시적 계열: 2020-01=100 ... 2021-01=103
  const seq = [
    ['2020-01', 100], ['2020-02', 100], ['2020-03', 100], ['2020-04', 100],
    ['2020-05', 100], ['2020-06', 100], ['2020-07', 100], ['2020-08', 100],
    ['2020-09', 100], ['2020-10', 100], ['2020-11', 100], ['2020-12', 100],
    ['2021-01', 103],
  ].map(([period, value]) => ({ period, value }));
  const yoy = cpiYoY(seq);
  assert.equal(yoy.has('2020-06'), false);              // 12개월 전 없음 → 제외
  near(yoy.get('2021-01'), 3.0);                        // 103/100−1 = 3%
});

test('iStar / pressure 수식', () => {
  const p = { rstar: 1.20, alpha: 0.25, beta: 0.45 };
  // i* = 1.20 + π + 0.25(π−2) + 0.45·ygap
  near(iStar(3.0, 1.0, p), 1.20 + 3.0 + 0.25 * 1.0 + 0.45 * 1.0);
  near(pressure(3.0, 1.0, 2.0, p), iStar(3.0, 1.0, p) - 2.0);
});

test('outputGap: one-sided HP 로 갭 산출, 마지막 갭 부호', () => {
  // 완만 상승 후 급등 → 마지막 시점 갭 > 0
  const rows = [95, 96, 97, 98, 99, 100, 104].map((v, i) => ({ period: `20${15 + i}Q1`, value: v }));
  const g = outputGap(rows, LAMBDA);
  assert.ok(g.get('2021Q1') > 0, '급등 시점 갭은 양(+)이어야');
});

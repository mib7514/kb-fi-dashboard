// 에너지 나우캐스트 모듈 앵커 — node --test (자동탐색, 키 불필요).
// js/us-energy-nowcast.js의 디시즌·회귀·합성이 규약대로 거동하는지 검증.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ols, deseasonalizeMM, seasonalMonthMap, energyNowcast, estimateWeights, synthesizeHeadlineMM,
} from '../js/us-energy-nowcast.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// 월별 시계열 생성 헬퍼: 시작월부터 값 배열.
function series(start, vals) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  for (const v of vals) {
    out.push({ period: `${y}-${String(m).padStart(2, '0')}`, value: v });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

test('ols: 완전선형 y=2+3x → a=2,b=3,r2=1', () => {
  const xs = [0, 1, 2, 3, 4], ys = xs.map((x) => 2 + 3 * x);
  const { a, b, r2 } = ols(xs, ys);
  near(a, 2); near(b, 3); near(r2, 1);
});

test('ols: n<2면 기울기 0', () => {
  const r = ols([5], [9]);
  near(r.b, 0); assert.equal(r.n, 1);
});

test('deseasonalize: 월별 시즈널 성분이 정확히 제거됨', () => {
  // 24개월(2년) 같은 달 값이 동일 → 시즈널 평균=그 값 → 디시즌=0.
  const vals = [];
  for (let yr = 0; yr < 2; yr++) for (let mo = 1; mo <= 12; mo++) vals.push(mo); // 매년 1..12 반복
  const mm = series('2020-01', vals);
  const smap = seasonalMonthMap(mm, 10, '2021-12');
  near(smap.get(3), 3); near(smap.get(11), 11); // 3월 시즈널=3, 11월=11
  const des = deseasonalizeMM(mm, smap);
  for (const p of des) near(p.value, 0); // 완전 계절 → 디시즌 전부 0
});

test('energyNowcast: 대상월 디시즌 입력 = 휘발유 − 그 달 시즈널 성분 (배선 불변식)', () => {
  // 3년치(계절 mo + 연도별 상이 노이즈) → 시즈널이 mo만 흡수, 노이즈는 잔존.
  const noise = [0.4, -0.2, 0.7, 0.1, -0.5, 0.3, 0.9, -0.6, 0.2, 0.8, -0.1, 0.5,
    -0.3, 0.6, -0.4, 0.2, 0.5, -0.7, 0.1, 0.4, -0.2, 0.9, -0.5, 0.3,
    0.6, -0.1, 0.2, -0.8, 0.4, 0.7, -0.3, 0.5, -0.6, 0.1, 0.8, -0.2];
  const gasVals = noise.map((r, i) => (i % 12) + 1 + r); // 계절(mo) + 노이즈
  const gasMM = series('2019-01', gasVals);
  const energyMM = series('2019-01', gasVals.map((g, i) => 0.3 * gasVals[i])); // 임의
  const endPeriod = '2021-11', target = '2021-12';
  const nc = energyNowcast({ gasMM, energyMM, endPeriod, targetPeriod: target, regWindow: 24 });

  // 독립 계산: endPeriod까지의 gasHist로 시즈널맵 → target(12월) 성분 차감.
  const gasHist = gasMM.filter((p) => p.period <= endPeriod);
  const smap = seasonalMonthMap(gasHist, 10, endPeriod);
  const gasTarget = gasMM.find((p) => p.period === target).value;
  near(nc.gasDeseasonInput, gasTarget - smap.get(12), 1e-9);
  near(nc.value, nc.a + nc.b * nc.gasDeseasonInput, 1e-9); // value = a+b·(디시즌입력)
  assert.equal(nc.n, 24); // 가용 35개월(2019-01..2021-11) → regWindow 24로 절단
});

test('energyNowcast: deseason=false면 원시(NSA) 휘발유 m/m로 회귀', () => {
  const gasMM = series('2020-01', Array.from({ length: 24 }, (_, i) => (i % 12) + 1));
  const energyMM = series('2020-01', Array.from({ length: 24 }, (_, i) => 2 * ((i % 12) + 1)));
  const nc = energyNowcast({ gasMM, energyMM, endPeriod: '2021-11', targetPeriod: '2021-12', regWindow: 24, deseason: false });
  near(nc.b, 2, 1e-6);                 // energy=2×gas
  near(nc.gasDeseasonInput, 12, 1e-6); // 원시 휘발유 그대로(12월 값 12)
  near(nc.value, 24, 1e-6);
});

test('estimateWeights: 헤드라인=성분가중합이면 정확히 복원 (합=1)', () => {
  const c = series('2022-01', Array.from({ length: 12 }, (_, i) => 0.2 + 0.05 * ((i % 3) - 1)));
  const f = series('2022-01', Array.from({ length: 12 }, (_, i) => 0.1 + 0.1 * ((i % 4) - 1.5)));
  const e = series('2022-01', Array.from({ length: 12 }, (_, i) => 0.5 * Math.sin(i)));
  const W = { w_c: 0.8, w_f: 0.13, w_e: 0.07 };
  const h = c.map((cp, i) => ({ period: cp.period, value: W.w_c * cp.value + W.w_f * f[i].value + W.w_e * e[i].value }));
  const w = estimateWeights(h, c, f, e);
  near(w.w_c, 0.8, 1e-6); near(w.w_f, 0.13, 1e-6); near(w.w_e, 0.07, 1e-6);
  near(w.w_c + w.w_f + w.w_e, 1, 1e-9);
});

test('estimateWeights: 표본<6이면 BLS 근사 폴백', () => {
  const s = series('2022-01', [0.2, 0.3]);
  const w = estimateWeights(s, s, s, s);
  assert.equal(w.fallback, true);
  near(w.w_c + w.w_f + w.w_e, 1, 1e-9);
});

test('synthesizeHeadlineMM: 에너지만 대체, 코어·식품 시즈널 불변', () => {
  const weights = { w_c: 0.8, w_f: 0.13, w_e: 0.07 };
  const args = { coreSeas: 0.25, foodSeas: 0.10, energySeas: 0.40, energyNowcastMM: -2.0, weights };
  const r = synthesizeHeadlineMM(args);
  const base = 0.8 * 0.25 + 0.13 * 0.10;
  near(r.seasonal, base + 0.07 * 0.40);
  near(r.nowcast, base + 0.07 * -2.0);
  // 두 버전 차이는 정확히 w_e×(nowcast−seasonal) — 에너지 스왑만 반영.
  near(r.nowcast - r.seasonal, 0.07 * (-2.0 - 0.40), 1e-9);
});

test('synthesizeHeadlineMM: energyNowcastMM=null이면 nowcast=null', () => {
  const r = synthesizeHeadlineMM({ coreSeas: 0.2, foodSeas: 0.1, energySeas: 0.3, energyNowcastMM: null, weights: { w_c: 0.8, w_f: 0.13, w_e: 0.07 } });
  assert.equal(r.nowcast, null);
  assert.ok(Number.isFinite(r.seasonal));
});

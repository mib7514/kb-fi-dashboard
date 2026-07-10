// RG-2 v1 롤다운 엔진 앵커 테스트 — node --test (자동탐색, 인자 없이 실행).
// 손계산 가능한 예시 커브로 각 성분 수식 검증. eDy 는 실제 data/rg-calib.js 로 산출(앱과 동일).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interp, curveComplete, expectedDyParallel, decompose, rolldownTable, MAT, TENORS,
  conditionalDefaultCurves, expectedDyByTenor, mixEDy, TENOR3Y,
  anchorFitCurve, IDX_3M, IDX_3Y } from '../js/rg-rolldown.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// 실제 캘리브레이션 medianCurves 로드(앵커가 앱과 일치하도록)
const win = {};
new Function('window', readFileSync(new URL('../data/rg-calib.js', import.meta.url), 'utf8'))(win);
const MC = win.RG_CALIB.medianCurves;

// 예시 커브(%) — 3M/6M/1Y/1.5Y/2Y/2.5Y/3Y/5Y
const CURVE = [3.30, 3.35, 3.40, 3.45, 3.50, 3.56, 3.60, 3.75];
// RG-1 기본 확률(합 100)
const RATE = [33, 34, 33], SPREADP = [33, 34, 33];

test('interp — 격자점 정확', () => {
  near(interp(MAT, CURVE, 2), 3.50);
  near(interp(MAT, CURVE, 3), 3.60);
});
test('interp — 3M 미만 평탄 외삽', () => {
  near(interp(MAT, CURVE, 0.16667), 3.30);   // 2Y? no: below 3M → y(3M)
  near(interp(MAT, CURVE, 0.1), 3.30);
});
test('interp — 중간 선형(1.9167y)', () => {
  // 1.5Y(3.45)~2Y(3.50), t=0.83333 → 3.491667
  near(interp(MAT, CURVE, 1.916667), 3.491667, 1e-4);
});

test('curveComplete', () => {
  assert.equal(curveComplete(CURVE), true);
  assert.equal(curveComplete([3.3, 3.35, '', 3.45, 3.5, 3.56, 3.6, 3.75]), false);
  assert.equal(curveComplete([3.3]), false);
});

test('expectedDyParallel — 기본 확률·실제 medianCurves ≈ 0.890bp', () => {
  const e = expectedDyParallel(RATE, SPREADP, MC);
  near(e, 0.890, 0.01);
});
test('expectedDyParallel — 확률 미입력(합0) → null', () => {
  assert.equal(expectedDyParallel([0, 0, 0], SPREADP, MC), null);
});
test('expectedDyParallel — 하락 100% → 음수(3Y median ≈ 하락행 가중)', () => {
  const e = expectedDyParallel([100, 0, 0], SPREADP, MC);
  assert.ok(e < 0, `하락 100% eDy=${e} 는 음수여야`);
});

test('decompose 2Y — 캐리/롤다운/커브이동 앵커', () => {
  const e = expectedDyParallel(RATE, SPREADP, MC);
  const rows = decompose(CURVE, e);
  const r = rows.find(x => x.tenor === '2Y');
  near(r.carry, 29.16667, 0.001);            // 3.50×100/12
  near(r.rolldown, 1.59722, 0.001);          // −(2−1/12)×(3.491667−3.50)×100
  near(r.curveMove, -(2 - 1 / 12) * e, 1e-6); // −D'×eDy
  near(r.total, r.carry + r.rolldown + r.curveMove, 1e-9);
});

test('decompose 3M — 롤다운 0 (평탄 외삽)', () => {
  const e = expectedDyParallel(RATE, SPREADP, MC);
  const r = decompose(CURVE, e).find(x => x.tenor === '3M');
  near(r.rolldown, 0, 1e-9);                  // yLand=y0 → 0
});

test('decompose — eDy null 이면 커브이동 0', () => {
  const r = decompose(CURVE, null).find(x => x.tenor === '3Y');
  assert.equal(r.curveMove, 0);
  near(r.total, r.carry + r.rolldown, 1e-9);
});

test('rolldownTable — 순위 내림차순 + top', () => {
  const e = expectedDyParallel(RATE, SPREADP, MC);
  const { rows, ranked, top } = rolldownTable(CURVE, e);
  assert.equal(rows.length, 8);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1]._total >= ranked[i]._total);
  assert.equal(top.tenor, ranked[0].tenor);
});

// ── v2 시나리오 + 혼합 ──
test('conditionalDefaultCurves — 3시나리오 각 8구간, 하락<0·상승>0(3Y)', () => {
  const def = conditionalDefaultCurves(SPREADP, MC);
  assert.ok(def.down.length === 8 && def.flat.length === 8 && def.up.length === 8);
  assert.ok(def.down[TENOR3Y] < 0, `하락 3Y ${def.down[TENOR3Y]} <0`);
  assert.ok(def.up[TENOR3Y] > 0, `상승 3Y ${def.up[TENOR3Y]} >0`);
  // 세 시나리오 커브가 서로 다른 모양(실측 반영)
  assert.notDeepEqual(def.down, def.flat);
  assert.notDeepEqual(def.flat, def.up);
});
test('conditionalDefaultCurves — 스프레드 합0 → null', () => {
  assert.equal(conditionalDefaultCurves([0, 0, 0], MC), null);
});

test('expectedDyByTenor — 금리 확률가중 구간별', () => {
  const scene = conditionalDefaultCurves(SPREADP, MC);
  const bt = expectedDyByTenor(RATE, scene);
  assert.equal(bt.length, 8);
  // 수동 검산: 3Y = Σi P(rate i)·scene[dir][3Y]
  const man = (RATE[0] * scene.down[TENOR3Y] + RATE[1] * scene.flat[TENOR3Y] + RATE[2] * scene.up[TENOR3Y]) / 100;
  near(bt[TENOR3Y], man, 1e-9);
});
test('expectedDyByTenor — 금리 합0 → null', () => {
  const scene = conditionalDefaultCurves(SPREADP, MC);
  assert.equal(expectedDyByTenor([0, 0, 0], scene), null);
});

test('mixEDy 등가성 — w=1 이면 평행(v1)과 동일 total (체크리스트 ③)', () => {
  const par = expectedDyParallel(RATE, SPREADP, MC);
  const scene = conditionalDefaultCurves(SPREADP, MC);
  const bt = expectedDyByTenor(RATE, scene);
  const mix = mixEDy(par, bt, 1);                 // w=100%
  const v1 = decompose(CURVE, par);
  const mixed = decompose(CURVE, mix);
  TENORS.forEach((_, k) => near(mixed[k].total, v1[k].total, 1e-9));
});
test('mixEDy 등가성 — w=0 이면 순수 v2와 동일 total (체크리스트 ③)', () => {
  const par = expectedDyParallel(RATE, SPREADP, MC);
  const scene = conditionalDefaultCurves(SPREADP, MC);
  const bt = expectedDyByTenor(RATE, scene);
  const mix = mixEDy(par, bt, 0);                 // w=0%
  const v2 = decompose(CURVE, bt);
  const mixed = decompose(CURVE, mix);
  TENORS.forEach((_, k) => near(mixed[k].total, v2[k].total, 1e-9));
});
test('mixEDy — 확률 미입력(null) → null', () => {
  assert.equal(mixEDy(null, [1, 2, 3], 0.5), null);
  assert.equal(mixEDy(1.5, null, 0.5), null);
});

// ── 앵커 모드: anchorFitCurve ──
// 곡률 있는 shape(3M≠3Y): affine 보정으로 앵커 정확 일치 + 중간 shape 모양 보존
const SHAPE = [10, 12, 15, 17, 18, 19, 20, 25];   // 8구간 Δbp, s3M=10 s3Y=20

test('anchorFitCurve — 앵커 3M·3Y 정확 일치 (affine)', () => {
  const fit = anchorFitCurve({ d3M: 0, d3Y: 5 }, SHAPE);
  assert.equal(fit.method, 'affine');
  near(fit.curve[IDX_3M], 0, 1e-12);
  near(fit.curve[IDX_3Y], 5, 1e-12);
  // a=(5−0)/(20−10)=0.5, b=0−0.5·10=−5 → curve[k]=0.5·shape[k]−5
  near(fit.a, 0.5, 1e-12); near(fit.b, -5, 1e-12);
  TENORS.forEach((_, k) => near(fit.curve[k], 0.5 * SHAPE[k] - 5, 1e-9));
});

test('anchorFitCurve — 모양 보존: 중간 구간이 앵커 직선이 아니라 shape 곡률을 따름', () => {
  const fit = anchorFitCurve({ d3M: 0, d3Y: 5 }, SHAPE);
  // 앵커 두 점을 만기로 이은 직선(3M~3Y): 곡률 없으면 이 값과 같아야 함
  const slope = (5 - 0) / (MAT[IDX_3Y] - MAT[IDX_3M]);
  const lineAt = k => 0 + slope * (MAT[k] - MAT[IDX_3M]);
  // 2Y(k=4): 직선값 vs affine값이 달라야(모양 보존) — shape 가 직선이 아니므로
  assert.ok(Math.abs(fit.curve[4] - lineAt(4)) > 0.1, `2Y affine ${fit.curve[4]} 는 앵커직선 ${lineAt(4)} 와 달라야`);
  // 2차차분 비율 보존: affine 은 shape 의 곡률 부호를 유지
  const secDiff = (a, i) => a[i + 1] - 2 * a[i] + a[i - 1];
  assert.ok(Math.sign(secDiff(fit.curve, 3)) === Math.sign(secDiff(SHAPE, 3)));
});

test('anchorFitCurve — 퇴화(shape 3M=3Y) → 선형 폴백 + 5Y 기울기 연장', () => {
  const flat = [10, 10, 10, 10, 10, 10, 10, 10];    // s3M=s3Y → a 불능
  const fit = anchorFitCurve({ d3M: 0, d3Y: 5 }, flat);
  assert.equal(fit.method, 'linear');
  near(fit.curve[IDX_3M], 0, 1e-12);
  near(fit.curve[IDX_3Y], 5, 1e-12);
  const slope = (5 - 0) / (MAT[IDX_3Y] - MAT[IDX_3M]);  // per year
  // 만기선형보간: 각 구간 = slope·(T−0.25)
  TENORS.forEach((_, k) => near(fit.curve[k], slope * (MAT[k] - MAT[IDX_3M]), 1e-9));
  // 5Y(k=7) 는 3Y 기울기로 연장 → 3Y 값보다 큼
  near(fit.curve[7], 5 + slope * (MAT[7] - MAT[IDX_3Y]), 1e-9);
  assert.ok(fit.curve[7] > fit.curve[IDX_3Y]);
});

test('anchorFitCurve — shape 미제공도 선형 폴백으로 앵커 일치', () => {
  const fit = anchorFitCurve({ d3M: -2, d3Y: 8 }, null);
  assert.equal(fit.method, 'linear');
  near(fit.curve[IDX_3M], -2, 1e-12);
  near(fit.curve[IDX_3Y], 8, 1e-12);
});

test('anchorFitCurve — 앵커 비유한 → null', () => {
  assert.equal(anchorFitCurve({ d3M: 0 }, SHAPE), null);          // d3Y 없음
  assert.equal(anchorFitCurve({ d3M: NaN, d3Y: 5 }, SHAPE), null);
  assert.equal(anchorFitCurve(null, SHAPE), null);
});

test('anchorFitCurve — 실제 조건부 기본커브로 파생 → expectedDyByTenor 로 흐름(계산경로)', () => {
  const def = conditionalDefaultCurves(SPREADP, MC);
  // 각 시나리오 앵커 = 기본커브의 3M·3Y → affine a=1,b=0 → 기본커브 재현
  const scene = {};
  for (const dir of ['down', 'flat', 'up']) {
    const fit = anchorFitCurve({ d3M: def[dir][IDX_3M], d3Y: def[dir][IDX_3Y] }, def[dir]);
    assert.equal(fit.method, 'affine');
    scene[dir] = fit.curve;
    TENORS.forEach((_, k) => near(scene[dir][k], def[dir][k], 1e-9));  // 기본 앵커 → 기본커브
  }
  // 파생 24칸이 그대로 구간별 기대 Δy 계산에 흘러감
  const bt = expectedDyByTenor(RATE, scene);
  assert.equal(bt.length, 8);
});

// RG 섹터×구간 매트릭스 순수 로직 테스트 — node --test (자동탐색).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TENORS, MAT, HOLD, decompose, rolldownTable } from '../js/rg-rolldown.js';
import { sectorCurveNow, landingCurve, matrixReturns, scoreMatrixRank, MATRIX_SECTORS } from '../js/rg-matrix.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

const CURVE = [3.30, 3.35, 3.40, 3.45, 3.50, 3.56, 3.60, 3.75];           // 국고 8구간 %
const EDY = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];                      // 구간 E[Δy] bp(간단화)
const SPREADS = { 공사채: 37, 은행채: 37, 회사채: 70, 카드채: 61, 여전채: 76 };
const EDS = { 공사채: 0.5, 은행채: 0.3, 회사채: 2.0, 카드채: 1.2, 여전채: 1.5 };

test('sectorCurveNow — 국고 + 스프레드(bp→%) 평탄 가산', () => {
  const sc = sectorCurveNow(CURVE, 70);
  near(sc[0], 3.30 + 0.70); near(sc[6], 3.60 + 0.70);
  assert.equal(sc.length, 8);
});

test('landingCurve — 현재 + (E[Δy]+E[Δs])/100', () => {
  const sc = sectorCurveNow(CURVE, 70);
  const lc = landingCurve(sc, EDY, 2.0);
  near(lc[4], (3.50 + 0.70) + (0.9 + 2.0) / 100);   // 2Y
});

test('손계산 — 회사채 2Y 총 기대수익 bp', () => {
  // sectorCurve 2Y = 3.50 + 0.70 = 4.20 ; Dp = 2 − 1/12 = 1.916667
  // carry = 4.20×100/12 = 35.0
  // rolldown: interp(국고, 1.916667)=3.491667(+0.70=4.191667), −Dp×(4.191667−4.20)×100 = 1.59722
  // curveMove = −Dp×(E[Δy]+E[Δs]) = −1.916667×(0.9+2.0) = −5.55833
  // total = 35.0 + 1.59722 − 5.55833 = 31.03889
  const m = matrixReturns(CURVE, SPREADS, EDY, EDS);
  const k2y = TENORS.indexOf('2Y');
  const carry = 4.20 * 100 / 12, Dp = 2 - HOLD;
  const roll = -Dp * (3.491667 + 0.70 - 4.20) * 100;
  const move = -Dp * (0.9 + 2.0);
  const expected = carry + roll + move;
  near(m.returnsBp['회사채'][k2y], expected, 0.01);
  near(m.returnsBp['회사채'][k2y], 31.039, 0.01);
});

test('국고 행 = 기존 RG-2 decompose/rolldownTable 결과와 일치 (checklist ②)', () => {
  const m = matrixReturns(CURVE, SPREADS, EDY, EDS);
  const rg2 = decompose(CURVE, EDY);                       // 국고 = 스프레드0·eDs0 → RG-2 그대로
  TENORS.forEach((_, k) => near(m.returnsBp['국고채'][k], rg2[k].total, 1e-9));
  // rolldownTable(반올림) 총수익과도 일치
  const rt = rolldownTable(CURVE, EDY);
  TENORS.forEach((t, k) => near(Math.round(m.returnsBp['국고채'][k] * 10) / 10, rt.rows[k].total, 1e-9));
});

test('국고 행 carry/롤다운은 스프레드와 무관, 신용섹터 carry 는 스프레드만큼 증가', () => {
  const m = matrixReturns(CURVE, SPREADS, EDY, EDS);
  // 회사채 2Y carryRoll − 국고 2Y carryRoll = 스프레드 carry 차 = 0.70×100/12 = 5.8333(롤다운 동일)
  const k2y = TENORS.indexOf('2Y');
  near(m.carryRollBp['회사채'][k2y] - m.carryRollBp['국고채'][k2y], 0.70 * 100 / 12, 0.01);
});

test('topCell + bestTenorBySector — 최고 셀 산출', () => {
  const m = matrixReturns(CURVE, SPREADS, EDY, EDS);
  assert.ok(MATRIX_SECTORS.includes(m.topCell.sector));
  assert.ok(TENORS.includes(m.topCell.tenor));
  // topCell 은 전 셀 중 최대
  let mx = -Infinity;
  for (const s of MATRIX_SECTORS) for (const v of m.returnsBp[s]) mx = Math.max(mx, v);
  near(m.topCell.bp, mx, 1e-9);
});

test('matrixReturns — 커브 미완/eDy 오류 → null', () => {
  assert.equal(matrixReturns(['', 3.35, 3.4, 3.45, 3.5, 3.56, 3.6, 3.75], SPREADS, EDY, EDS), null);
  assert.equal(matrixReturns(CURVE, SPREADS, [0.9], EDS), null);
});

// ── 매트릭스 채점 ──
test('scoreMatrixRank — 실현 Δ로 재구성, topCell 순위 top-1/top-3', () => {
  const m = matrixReturns(CURVE, SPREADS, EDY, EDS);
  // 실현 = 기대와 동일한 이동이면 실현 매트릭스 순위 = 기대 순위 → topCell 이 top-1
  const realizedSame = {
    curveDeltaBp: EDY.slice(),
    repSpreadDeltaBp: EDS['회사채'],
    sectorsDeltaBp: { 공사채: EDS['공사채'], 은행채: EDS['은행채'], 카드채: EDS['카드채'], 여전채: EDS['여전채'] },
  };
  const sc = scoreMatrixRank(m, realizedSame);
  assert.equal(sc.picked.sector, m.topCell.sector);
  assert.equal(sc.picked.tenor, m.topCell.tenor);
  assert.equal(sc.hitTop1, true);
  assert.equal(sc.realizedRank, 1);
  assert.equal(sc.hitTop3, true);
});

test('scoreMatrixRank — 실현이 크게 다르면 순위 하락(top1 미적중 가능)', () => {
  const m = matrixReturns(CURVE, SPREADS, EDY, EDS);
  // 최상위 셀 섹터의 스프레드만 급확대 → 그 셀 실현수익 급락 → topCell 순위 하락
  const bad = {
    curveDeltaBp: new Array(8).fill(0),
    repSpreadDeltaBp: 50, sectorsDeltaBp: { 공사채: 50, 은행채: 50, 카드채: 50, 여전채: 50 },
  };
  const sc = scoreMatrixRank(m, bad);
  assert.ok(sc.realizedRank >= 1 && sc.realizedRank <= 48);
  assert.equal(sc.realizedTop3.length, 3);
});

test('scoreMatrixRank — matrix 없음/carryRoll 없음 → null', () => {
  assert.equal(scoreMatrixRank(null, {}), null);
  assert.equal(scoreMatrixRank({ topCell: { sector: '국고채', tenor: '2Y' } }, {}), null);
});

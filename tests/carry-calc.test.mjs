// CB-1 캐리 손익분기 엔진 앵커 테스트 — node --test (자동탐색, 인자 없이 실행).
// 손계산 가능한 값으로 각 순수 함수의 수식을 검증. 허용오차 ±0.05bp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netCarryRate, carryBp, breakevenBp, expectedDy, excessReturn,
  scenarioPnl, durationApprox, gridTable,
} from '../js/carry-calc.js';

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// ── 명령서 앵커: D=1.8, 픽업 60bp(YTM 350 − 레포 290), 롤다운 0, h=3 ──
const BASE = { ytm: 350, repo: 290, rolldown: 0, h: 3, D: 1.8 };
// 비헤지 시나리오: 결합 Δy [+3 p60 / +15 p25 / −5 p15] (dKtb 로 표현, dSpread 0)
const SCEN = [
  { label: '기본', p: 60, dKtb: 3, dSpread: 0 },
  { label: '약세', p: 25, dKtb: 15, dSpread: 0 },
  { label: '강세', p: 15, dKtb: -5, dSpread: 0 },
];

test('netCarryRate — 픽업 60bp', () => {
  near(netCarryRate(BASE), 60);
});

test('carryBp — 60bp × 3/12 = 15.0', () => {
  near(carryBp(BASE), 15.0);
});

test('breakevenBp — 캐리/D = 15/1.8 = +8.33', () => {
  near(breakevenBp(BASE), 8.33);
});

test('expectedDy — Σp·Δy = +4.80 (비헤지)', () => {
  near(expectedDy(SCEN, { hedge: false }), 4.80);
});

test('excessReturn — 캐리 − D·E[Δy] = 15 − 1.8×4.8 = +6.36', () => {
  near(excessReturn({ ...BASE, scenarios: SCEN, hedge: false }), 6.36);
});

test('scenarioPnl — 약세(+15bp) 손익 = 15 − 1.8×15 = −12.0, worst 식별', () => {
  const rows = scenarioPnl({ ...BASE, scenarios: SCEN, hedge: false });
  const bear = rows.find(r => r.label === '약세');
  near(bear.pnl, -12.0);
  const worst = rows.reduce((m, r) => (r.pnl < m.pnl ? r : m));
  assert.equal(worst.label, '약세');
});

// ── 헤지 ON: ΔKTB 제외, Δspread만 [+1/+8/−3] 동일 p → E[Δy]=+2.15 ──
// dKtb 를 일부러 크게 넣어 헤지 시 제외됨을 함께 검증.
const SCEN_H = [
  { label: '기본', p: 60, dKtb: 3, dSpread: 1 },
  { label: '약세', p: 25, dKtb: 15, dSpread: 8 },
  { label: '강세', p: 15, dKtb: -5, dSpread: -3 },
];

test('expectedDy — 헤지 ON: Δspread만 → +2.15 (ΔKTB 제외 확인)', () => {
  near(expectedDy(SCEN_H, { hedge: true }), 2.15);
});

test('scenarioPnl — 헤지 ON: move 는 Δspread만 반영', () => {
  const rows = scenarioPnl({ ...BASE, scenarios: SCEN_H, hedge: true });
  near(rows.find(r => r.label === '약세').move, 8);      // dKtb=15 무시, dSpread=8
  near(rows.find(r => r.label === '약세').pnl, 15 - 1.8 * 8); // = +0.6
});

test('durationApprox — 3년·YTM 350bp → 3/(1+0.0175) ≈ 2.9484', () => {
  near(durationApprox(3, 350), 2.9484);
  assert.equal(durationApprox(0, 350), null);
});

test('gridTable — 셀 손익분기 = 순캐리율×h/12/D', () => {
  const g = gridTable({ ytm: 350, repo: 290, rolldown: 0, durations: [1.0, 2.0], horizons: [3, 6, 12] });
  const cell = (D, h) => g.find(r => r.D === D).cells.find(c => c.h === h).breakeven;
  near(cell(2.0, 6), 15.0);   // 60×0.5/2 = 15
  near(cell(1.0, 12), 60.0);  // 60×1/1 = 60
  near(cell(1.0, 3), 15.0);   // 60×0.25/1 = 15
});

test('breakevenBp — D 0/음수 방어 → null', () => {
  assert.equal(breakevenBp({ ...BASE, D: 0 }), null);
  assert.equal(breakevenBp({ ...BASE, D: -1 }), null);
});

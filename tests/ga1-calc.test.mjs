// GA-1 연간 GDP 환산기 앵커 테스트 — node --test (자동탐색, 인자 없이 실행).
//   2023Q4=100 앵커 전기비 연쇄 → 연간 성장률 산술을 손계산 가능한 값으로 검증.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GDP_QOQ_ACTUAL, chainLevels, annualGrowth, buildChain, annualize, presetTable, residualQuarters,
} from '../js/ga1-calc.js';

const near = (a, b, tol) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// ── a. 2025 연간 재현: 1.08% (공표 1.1% 대비 반올림 오차 ±0.05 허용) ──
test('2025 연간 = 1.08% (전량 실적 체인)', () => {
  const levels = chainLevels(GDP_QOQ_ACTUAL);
  near(annualGrowth(levels, 2025), 1.08, 0.05);
});

// ── b~d. 2026 균일 잔여 시나리오 (Q1·Q2 실적, Q3·Q4 = residual) ──
test('잔여 0.0% → 2026 연간 3.05% (±0.02)', () => {
  near(annualize({ residual: 0.0 }).targetGrowth, 3.05, 0.02);
});
test('잔여 0.3% → 2026 연간 3.28% (±0.02)', () => {
  near(annualize({ residual: 0.3 }).targetGrowth, 3.28, 0.02);
});
test('잔여 0.5% → 2026 연간 3.43% (±0.02)', () => {
  near(annualize({ residual: 0.5 }).targetGrowth, 3.43, 0.02);
});

// ── e. 잔여 분기 개별 입력 혼합: 2026Q3 +0.5% / 2026Q4 0.0% → 3.30% (±0.02) ──
test('혼합 커스텀 {Q3:0.5, Q4:0.0} → 2026 연간 3.30% (±0.02)', () => {
  const { targetGrowth } = annualize({ residual: { '2026Q3': 0.5, '2026Q4': 0.0 } });
  near(targetGrowth, 3.30, 0.02);
});

// ── 구조·불변식 검증 ──
test('잔여분기 식별: 2026 = [Q3, Q4] (Q1·Q2 실적)', () => {
  assert.deepEqual(residualQuarters(GDP_QOQ_ACTUAL, 2026), ['2026Q3', '2026Q4']);
});

test('앵커 2023Q4=100 → 2024Q1 레벨 = 101.0 (첫 전기비 +1.0%)', () => {
  const levels = chainLevels(GDP_QOQ_ACTUAL);
  near(levels[0].level, 101.0, 1e-6);
  assert.equal(levels[0].q, '2024Q1');
});

test('securedGrowth = 잔여 0% 가정치(이미 확보된 성장) = targetGrowth(residual 0)', () => {
  const a = annualize({ residual: 0.5 });
  near(a.securedGrowth, annualize({ residual: 0.0 }).targetGrowth, 1e-9);
});

test('실적 분기는 source=actual, 잔여 분기는 source=scenario', () => {
  const { levels } = annualize({ residual: 0.3 });
  const q1 = levels.find((l) => l.q === '2026Q1');
  const q3 = levels.find((l) => l.q === '2026Q3');
  assert.equal(q1.source, 'actual');
  assert.equal(q3.source, 'scenario');
});

test('2026Q2 속보 vintage=advance 보존', () => {
  const { levels } = annualize({ residual: 0.3 });
  assert.equal(levels.find((l) => l.q === '2026Q2').vintage, 'advance');
});

test('presetTable — 3개 프리셋 성장률 단조 증가', () => {
  const t = presetTable({ presets: [0.0, 0.3, 0.5] });
  assert.ok(t[0].growth < t[1].growth && t[1].growth < t[2].growth);
  near(t[0].growth, 3.05, 0.02);
  near(t[2].growth, 3.43, 0.02);
});

test('불완전 연도 방어: 전년 4분기 미확보 시 null', () => {
  // 2024 만 있는 체인 → 2024 연간은 2023 4분기 없음 → null
  const partial = chainLevels(GDP_QOQ_ACTUAL.slice(0, 4));
  assert.equal(annualGrowth(partial, 2024), null);
});

// 예측 성적표 모듈 앵커 — node --test (자동탐색, 키 불필요).
// y/y 변환·오차·누적(점-시점 제외 규칙)·라이브 예측 구조 검증.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mmToYoY, actualYoY, scoreRow, cumulativeError, computeLivePrediction, PREDICTION_COLUMNS,
  classifyRealizedOil, OIL_BRANCH_LABELS,
} from '../js/us-inflation-scorecard.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// 헤드라인 인덱스: 2025-06=100 … 2026-06=103.5 (y/y 3.5). 월 0.2씩 대략.
function headlineFixture() {
  const out = [];
  let v = 100;
  let [y, m] = [2025, 6];
  for (let i = 0; i < 13; i++) { // 2025-06 .. 2026-06
    out.push({ period: `${y}-${String(m).padStart(2, '0')}`, value: v });
    v *= 1.00287; // ≈ +0.287%/월 → 12개월 ≈ 3.5%
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

test('mmToYoY: M-1·M-12 인덱스로 예측 y/y 산출', () => {
  const h = headlineFixture();
  // target 2026-07: M-1=2026-06, M-12=2025-07.
  const idx = new Map(h.map((p) => [p.period, p.value]));
  const predMM = 0.5;
  const expected = ((idx.get('2026-06') * 1.005) / idx.get('2025-07') - 1) * 100;
  near(mmToYoY('2026-07', predMM, h), expected, 1e-9);
});

test('mmToYoY: M-12 인덱스 없으면 null', () => {
  const h = headlineFixture();
  assert.equal(mmToYoY('2025-07', 0.3, h), null); // M-12=2024-07 부재
});

test('actualYoY: 실측 인덱스 y/y', () => {
  const h = headlineFixture();
  near(actualYoY('2026-06', h), 3.5, 0.05); // 픽스처 설계상 ≈3.5
});

test('scoreRow: 각 예측 − 실제', () => {
  const row = {
    actual: { yoy: 3.5 },
    seasonal: { yoy: 3.9 }, combined: { yoy: null }, sealed: { yoy: 4.1 },
    consensus: { yoy: 3.8 }, cleveland: { yoy: 3.96 },
  };
  const e = scoreRow(row);
  near(e.seasonal, 0.4); near(e.sealed, 0.6); near(e.consensus, 0.3); near(e.cleveland, 0.46);
  assert.equal(e.combined, null); // 예측 null → 오차 null
});

test('cumulativeError: frozen·실측·예측 있는 행만, retro·late·비frozen 제외', () => {
  const rows = [
    { // frozen 정상 — 포함
      month: '2026-06', frozen: true, actual: { yoy: 3.5 },
      seasonal: { yoy: 3.9 }, sealed: { yoy: 4.1 }, consensus: { yoy: 3.8 }, cleveland: { yoy: 3.96 },
      combined: { yoy: null, retro: { mm: 0.046 } }, // combined은 retro → 제외
      errors: { seasonal: 0.4, sealed: 0.6, consensus: 0.3, cleveland: 0.46, combined: null },
    },
    { // frozen 정상 — combined 실제값 있음(포함), sealed는 late(제외)
      month: '2026-07', frozen: true, actual: { yoy: 3.2 },
      seasonal: { yoy: 3.4 }, combined: { yoy: 3.3 },
      sealed: { yoy: 3.6, late: true }, consensus: { yoy: 3.1 }, cleveland: { yoy: 3.25 },
      errors: { seasonal: 0.2, combined: 0.1, sealed: 0.4, consensus: -0.1, cleveland: 0.05 },
    },
    { // 비frozen(라이브) — 전부 제외
      month: '2026-08', frozen: false, actual: { yoy: null },
      seasonal: { yoy: 3.3 }, combined: { yoy: 3.2 },
      sealed: { yoy: null }, consensus: { yoy: null }, cleveland: { yoy: null },
      errors: { seasonal: null, combined: null, sealed: null, consensus: null, cleveland: null },
    },
  ];
  const cum = cumulativeError(rows);
  // seasonal: |0.4|,|0.2| → 0.3, n=2
  near(cum.seasonal.mae, 0.3); assert.equal(cum.seasonal.n, 2);
  // combined: 2026-06 retro 제외, 2026-07 포함 → |0.1|, n=1
  near(cum.combined.mae, 0.1); assert.equal(cum.combined.n, 1);
  // sealed: 2026-06 포함(0.6), 2026-07 late 제외 → 0.6, n=1
  near(cum.sealed.mae, 0.6); assert.equal(cum.sealed.n, 1);
  // consensus: |0.3|,|−0.1| → 0.2, n=2
  near(cum.consensus.mae, 0.2); assert.equal(cum.consensus.n, 2);
});

test('cumulativeError: 유효 행 없으면 mae null·n 0', () => {
  const cum = cumulativeError([{ month: '2026-08', frozen: false, actual: { yoy: null }, seasonal: { yoy: 3 } }]);
  assert.equal(cum.seasonal.mae, null); assert.equal(cum.seasonal.n, 0);
});

test('computeLivePrediction: 다음 발표월 = 최신 실측+1, 시즈널·결합 y/y 산출', () => {
  const h = headlineFixture(); // 최신 2026-06
  // 코어·식품·에너지·휘발유는 간단 합성(회귀 표본 확보용 24개월+).
  const mk = (start, n, step) => {
    const out = []; let [y, m] = start.split('-').map(Number); let v = 100;
    for (let i = 0; i < n; i++) { out.push({ period: `${y}-${String(m).padStart(2, '0')}`, value: v }); v *= (1 + step); m++; if (m > 12) { m = 1; y++; } }
    return out;
  };
  const long = (step) => mk('2024-01', 30, step); // 2024-01..2026-06 (CPI 실측)
  const live = computeLivePrediction({
    headlineData: mk('2024-01', 30, 0.00287),
    coreData: long(0.0025), foodData: long(0.002), energyData: long(0.001),
    gasData: mk('2024-01', 31, 0.003), // 2024-01..2026-07 — 휘발유는 대상월(부분월)까지 존재
  });
  assert.equal(live.month, '2026-07');
  assert.ok(Number.isFinite(live.seasonal.yoy));
  assert.ok(Number.isFinite(live.combined.yoy));
  assert.ok(live.combined.reg && Number.isFinite(live.combined.reg.b));
});

test('classifyRealizedOil: WTI 월평균 m/m ±10% 경계로 up20/hold/down20', () => {
  // WTI 인덱스: 2026-05=100, 2026-06=115(+15%→up20), 2026-07=100(−13%→down20).
  const wti = [
    { period: '2026-04', value: 100 }, { period: '2026-05', value: 100 },
    { period: '2026-06', value: 115 }, { period: '2026-07', value: 100 },
  ];
  assert.equal(classifyRealizedOil('2026-06', wti), 'up20');    // +15%
  assert.equal(classifyRealizedOil('2026-07', wti), 'down20');  // −13%
  assert.equal(classifyRealizedOil('2026-05', wti), 'hold');    // 0%
  assert.equal(classifyRealizedOil('2099-01', wti), null);      // 데이터 없음
  assert.ok(OIL_BRANCH_LABELS.hold && OIL_BRANCH_LABELS.up20 && OIL_BRANCH_LABELS.down20);
});

test('PREDICTION_COLUMNS: 5개 예측 컬럼·쉬운 라벨 보유', () => {
  assert.equal(PREDICTION_COLUMNS.length, 5);
  for (const c of PREDICTION_COLUMNS) { assert.ok(c.key && c.label && c.tech); }
  assert.deepEqual(PREDICTION_COLUMNS.map((c) => c.key), ['seasonal', 'combined', 'sealed', 'consensus', 'cleveland']);
});

// CP-Q3b 인상 사이클 성분 분해 앵커 테스트 — node --test.
//   핵심: 분해 항등식 ds310 = Δy10 − Δy3 (각 사이클, ±0.05bp) + overlay.deltaBp 바이트 일치 + 기여율 합 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompCycles } from '../js/curve-phase/cp-calc.js';

const near = (a, b, tol = 0.05) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// 합성 yieldRows(0.1bp 그래뉼) + overlay 항목. offset은 points 로만 사용.
function ov(label, t0, end, off, current = false, deltaBp = null) {
  return { label, current, t0Date: t0, lastOffset: off, deltaBp, points: [{ offset: 0, date: t0 }, { offset: off, date: end }] };
}

// 2005 재현: Δy3 −3.0 / Δy10 −42.0 → ds310 −39.0, 기여 3Y −8% / 10Y 108%(불플랫).
test('분해 항등식 + 2005형(둘 다 하락, 10Y 더 하락)', () => {
  const rows = [{ date: 'A', y3: 4.000, y10: 4.500 }, { date: 'B', y3: 3.970, y10: 4.080 }];
  const [r] = decompCycles([ov('2005', 'A', 'B', 250, false, -39.0)], rows);
  near(r.dyShort, -3.0); near(r.dyLong, -42.0);
  near(r.ds310, -39.0);
  near(r.ds310, r.dyLong - r.dyShort);            // 항등식
  assert.equal(r.shortContrib + r.longContrib, 100); // 합 100%
  assert.equal(r.shortContrib, -8); assert.equal(r.longContrib, 108);
});

// 베어플랫형: 둘 다 상승, 3Y 더 상승 → 3Y 기여 100% 초과, 10Y 음수.
test('베어플랫형(둘 다 상승, 3Y 더) → 기여 >100% / 음수 허용', () => {
  const rows = [{ date: 'A', y3: 1.000, y10: 2.000 }, { date: 'B', y3: 3.000, y10: 3.500 }];
  const [r] = decompCycles([ov('bear', 'A', 'B', 250)], rows);
  near(r.dyShort, 200.0); near(r.dyLong, 150.0);
  near(r.ds310, -50.0);
  near(r.ds310, r.dyLong - r.dyShort);
  assert.equal(r.shortContrib + r.longContrib, 100);
  assert.ok(r.shortContrib > 100 && r.longContrib < 0);
});

// 대칭형: Δy3 +10 / Δy10 −10 → ds310 −20, 기여 50/50.
test('대칭형 → 기여 50/50, 항등식', () => {
  const rows = [{ date: 'A', y3: 1.000, y10: 1.500 }, { date: 'B', y3: 1.100, y10: 1.400 }];
  const [r] = decompCycles([ov('sym', 'A', 'B', 250, false, -20.0)], rows);
  near(r.ds310, -20.0); near(r.ds310, r.dyLong - r.dyShort);
  assert.equal(r.shortContrib, 50); assert.equal(r.longContrib, 50);
});

// 분모 0(Δy3=Δy10) → 기여 null, ds310=0.
test('분모 0(평행 이동) → 기여 null', () => {
  const rows = [{ date: 'A', y3: 1.000, y10: 2.000 }, { date: 'B', y3: 1.100, y10: 2.100 }];
  const [r] = decompCycles([ov('flat', 'A', 'B', 250)], rows);
  near(r.ds310, 0);
  assert.equal(r.shortContrib, null); assert.equal(r.longContrib, null);
});

// current 플래그·부분창·결측 방어.
test('current 플래그 + 결측 날짜 방어', () => {
  const rows = [{ date: 'A', y3: 1.0, y10: 1.5 }, { date: 'B', y3: 1.1, y10: 1.4 }];
  const [cur] = decompCycles([ov('now', 'A', 'B', 3, true)], rows);
  assert.equal(cur.current, true); assert.equal(cur.lastOffset, 3);
  const [miss] = decompCycles([ov('x', 'A', 'ZZZ', 250)], rows); // endDate 부재
  assert.equal(miss.ds310, null); assert.equal(miss.shortContrib, null);
});

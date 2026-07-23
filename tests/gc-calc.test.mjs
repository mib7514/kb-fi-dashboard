// GC-2 계산 레이어 앵커 테스트 — node --test. 스프레드·z250 경계·Δ·결측 처리.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spreadBp, spreadSeries, rollingZ, deltaLatest, latestMetrics, computeGC, Z_WINDOW,
} from '../js/gc/gc-calc.js';

const near = (a, b, tol = 1e-9) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

// ── 스프레드(bp, 소수 1자리) ──
test('spreadBp — (y10−y3)×100, KR 최신 예시 48.1bp', () => {
  near(spreadBp(4.394, 3.913), 48.1); // 0.481 × 100
  near(spreadBp(4.635, 4.394), 24.1); // 10/30
});
test('spreadBp — 한쪽 null 이면 null(보간 금지)', () => {
  assert.equal(spreadBp(null, 3.9), null);
  assert.equal(spreadBp(4.3, null), null);
});
test('spreadSeries — rows → s310/s1030, 결측 전파', () => {
  const { s310, s1030 } = spreadSeries([
    { d: '2026-01-02', y3: 3.0, y10: 3.5, y30: 3.8 },
    { d: '2026-01-03', y3: 3.1, y10: null, y30: 3.9 }, // y10 결측
  ]);
  near(s310[0].v, 50.0); near(s1030[0].v, 30.0);
  assert.equal(s310[1].v, null);   // y10 null → 3/10 null
  assert.equal(s1030[1].v, null);  // y10 null → 10/30 null
});

// ── z250 경계: 부분 윈도우 금지 ──
test('rollingZ — 249 표본 null, 250 표본에서 값 발생 (경계)', () => {
  const series = Array.from({ length: Z_WINDOW }, (_, i) => ({ d: String(i), v: i })); // 250개 distinct
  const z = rollingZ(series);
  assert.equal(z[Z_WINDOW - 2].z, null); // 249번째(표본 249) → null
  assert.notEqual(z[Z_WINDOW - 1].z, null); // 250번째(표본 250) → 값
  assert.equal(typeof z[Z_WINDOW - 1].z, 'number');
});
test('rollingZ — 모집단 std 손계산 (win=2: [10,20]→z=1.0, win=3: [10,20,30]→z=1.22)', () => {
  const a = rollingZ([{ d: '1', v: 10 }, { d: '2', v: 20 }], 2);
  assert.equal(a[0].z, null);
  near(a[1].z, 1.0); // mean15 sd5 → (20−15)/5
  const b = rollingZ([{ d: '1', v: 10 }, { d: '2', v: 20 }, { d: '3', v: 30 }], 3);
  near(b[2].z, 1.22); // mean20 sd√66.67=8.165 → 10/8.165=1.2247→1.22
});
test('rollingZ — 표준편차 0(상수 윈도우) → null', () => {
  const z = rollingZ([{ d: '1', v: 5 }, { d: '2', v: 5 }, { d: '3', v: 5 }], 3);
  assert.equal(z[2].z, null);
});
test('rollingZ — 결측 skip: null 은 표본에 안 셈, 그날 z=null', () => {
  // win=2, 값 [10, null, 20] → idx2 는 [10,20] 표본으로 z 계산(중간 null 제외)
  const z = rollingZ([{ d: '1', v: 10 }, { d: '2', v: null }, { d: '3', v: 20 }], 2);
  assert.equal(z[1].z, null); // 결측일
  near(z[2].z, 1.0);          // 10,20 표본
});

// ── Δ: 자국 영업일 인덱스 기준 ──
test('deltaLatest — lag 인덱스 기준(달력일 아님), bp 소수 1자리', () => {
  const s = Array.from({ length: 11 }, (_, i) => ({ d: String(i), v: i })); // 0..10
  near(deltaLatest(s, 5), 5.0);   // v[10]−v[5]=10−5
  assert.equal(deltaLatest(s, 21), null); // 표본 부족(11<=21)
});
test('deltaLatest — 대상 인덱스 null 이면 null', () => {
  const s = [{ d: '1', v: 10 }, { d: '2', v: null }, { d: '3', v: 30 }];
  assert.equal(deltaLatest(s, 1), null); // v[1] null
});

// ── 통합 ──
test('computeGC — 두 스프레드 latest 구조', () => {
  const rows = Array.from({ length: 260 }, (_, i) => ({ d: String(i), y3: 3, y10: 3.5 + i * 0.001, y30: 4 + i * 0.001 }));
  const r = computeGC(rows);
  assert.ok('s310' in r && 's1030' in r);
  assert.equal(typeof r.s310.latest.z250, 'number'); // 260 표본 → z 존재
  assert.equal(r.s310.latest.date, '259');
  assert.ok(r.s310.latest.level > 0);
});

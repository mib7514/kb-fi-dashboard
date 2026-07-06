// OO-2 계산 엔진 특성화 테스트 — node --test (자동탐색)
//
// [라이선스] 실데이터(유료 민평) 동결 금지. 여기서는 손으로 계산 가능한 합성 세대만 써서
// 각 순수 함수의 수식을 검증한다. 실데이터 앵커(26-5/25-10/밴드)는 tests/local/ (gitignore)에서
// 원본 xlsx 가 있을 때만 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spreadBp, orderGenerations, currentTag, flySeries, flyAtDay,
  eventTimeAlign, percentile, bandStats, generationZ, flyChange, flyExtremes, decompose,
} from '../js/onoff-calc.js';

// 손계산 가능한 합성 세대 4개. fly 만 의미 있게 채우고 raw/slope 는 0.
// start 내림차순 정렬 시 A(2025) > B(2024) > C(2023) > D(2022), 현재=A.
const G = (tag, start, ...flies) => ({
  tag, vs: tag + 'v', slopeVs: tag + 's', start, maturity: '2029-06',
  series: flies.map((f, i) => [`${start.slice(0, 8)}${String(1 + i).padStart(2, '0')}`, 0, 0, f]),
});
const GENS = [
  G('C', '2023-01-01', 2),
  G('A', '2025-01-01', 10, 8, 6),
  G('D', '2022-01-01', -2),
  G('B', '2024-01-01', 4, 3),
];

test('spreadBp — bp 변환·0.1 정규화', () => {
  assert.equal(spreadBp(3.10, 3.00), 10);
  assert.equal(spreadBp(3.15, 2.80), 35); // 부동소수 노이즈 제거
  assert.equal(spreadBp(NaN, 1), null);
});

test('decompose 재수출(onoff-parse 단일정의)', () => {
  assert.deepEqual(decompose(3.10, 3.00, 2.90), { raw: 10, slope: 10, fly: 0 });
});

test('orderGenerations / currentTag — start 내림차순, 현재=최신', () => {
  assert.deepEqual(orderGenerations(GENS).map(g => g.tag), ['A', 'B', 'C', 'D']);
  assert.equal(currentTag(GENS), 'A');
});

test('flySeries / flyAtDay — 컬럼 추출', () => {
  const a = GENS.find(g => g.tag === 'A');
  assert.deepEqual(flySeries(a).fly, [10, 8, 6]);
  assert.equal(flyAtDay(a, 0), 10);
  assert.equal(flyAtDay(a, 2), 6);
  assert.equal(flyAtDay(a, 9), null);
});

test('eventTimeAlign — day 인덱스 정렬 매트릭스(최신 먼저)', () => {
  const al = eventTimeAlign(GENS);
  assert.deepEqual(al.days, [0, 1, 2]);
  assert.deepEqual(al.series.map(s => s.tag), ['A', 'B', 'C', 'D']);
  assert.deepEqual(al.series[0].fly, [10, 8, 6]);
  assert.deepEqual(al.series[3].fly, [-2]);
});

test('percentile — 선형 보간(numpy 기본)', () => {
  assert.equal(percentile([-2, 2, 4], 0.25), 0);
  assert.equal(percentile([-2, 2, 4], 0.50), 2);
  assert.equal(percentile([-2, 2, 4], 0.75), 3);
  assert.equal(percentile([], 0.5), null);
});

test('bandStats — 현재 세대(A) 제외, day별 p25/median/p75', () => {
  // day0 과거 세대(B,C,D) fly = [4,2,-2] → p25 0 / median 2 / p75 3
  assert.deepEqual(bandStats(GENS, 0), { day: 0, n: 3, p25: 0, median: 2, p75: 3 });
  // day1: B 만 존재(=3)
  assert.deepEqual(bandStats(GENS, 1), { day: 1, n: 1, p25: 3, median: 3, p75: 3 });
  // excludeTag 로 기준 세대 교체(B 제외 → A,C,D day0 = [10,2,-2])
  assert.deepEqual(bandStats(GENS, 0, { excludeTag: 'B' }), { day: 0, n: 3, p25: 0, median: 2, p75: 6 });
});

test('generationZ — 현재(A) fly vs 과거 분포', () => {
  // day0: current 10, 과거[4,2,-2] mean=1.333 std=2.494 → z=(10-1.333)/2.494=3.47
  const z = generationZ(GENS, 0);
  assert.equal(z.current, 10);
  assert.equal(z.n, 3);
  assert.equal(z.mean, 1.3);
  assert.equal(z.std, 2.5);
  assert.equal(z.z, 3.47);
  // 표준편차 0 방어: 과거 세대 없으면 z=null
  assert.equal(generationZ([GENS[1]], 0).z, null);
});

test('flyChange / flyExtremes — 현재 세대 요약', () => {
  const a = GENS.find(g => g.tag === 'A'); // fly [10,8,6]
  assert.equal(flyChange(a, 1), -2);       // 6 - 8
  assert.equal(flyChange(a, 5), null);     // 표본 부족
  assert.deepEqual(flyExtremes(a), { current: 6, day: 2, date: '2025-01-03', min: 6, max: 10 });
});

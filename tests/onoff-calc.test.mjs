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
  makeProvisional, appendProvisional, withProvisional,
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

test('bandStats — 현재 세대(A) 제외, day별 p25/median/p75 + min/max/태그', () => {
  // day0 과거 세대(C,D,B) fly = [2,-2,4] → p25 0 / median 2 / p75 3, min −2(D) / max 4(B)
  assert.deepEqual(bandStats(GENS, 0), { day: 0, n: 3, p25: 0, median: 2, p75: 3, min: -2, max: 4, minTag: 'D', maxTag: 'B' });
  // day1: B 만 존재(=3) → min=max=3, 태그 모두 B
  assert.deepEqual(bandStats(GENS, 1), { day: 1, n: 1, p25: 3, median: 3, p75: 3, min: 3, max: 3, minTag: 'B', maxTag: 'B' });
  // excludeTag 로 기준 세대 교체(B 제외 → A,C,D day0 = [10,2,-2]) → min −2(D) / max 10(A)
  assert.deepEqual(bandStats(GENS, 0, { excludeTag: 'B' }), { day: 0, n: 3, p25: 0, median: 2, p75: 6, min: -2, max: 10, minTag: 'D', maxTag: 'A' });
});

test('bandStats — 극단값 세대 태그(동률 시 배열 순서 우선)', () => {
  // 동률 max: C(5) 와 B(5) 동률 → 배열 순서상 먼저 등장한 C 가 maxTag
  const G = (tag, ...f) => ({ tag, vs: 'x', slopeVs: 'y', start: '2025-01-0' + f.length, maturity: '2029-06', series: f.map((v, i) => [`2025-01-0${i + 1}`, 0, 0, v]) });
  const gens = [G('cur', 9), G('C', 5), G('B', 5), G('D', 1)]; // 현재=cur(자동=start 최신? 명시 excludeTag)
  const b = bandStats(gens, 0, { excludeTag: 'cur' });
  assert.equal(b.max, 5); assert.equal(b.maxTag, 'C'); // 동률 → 먼저 등장한 C
  assert.equal(b.min, 1); assert.equal(b.minTag, 'D');
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

test('makeProvisional — slope 가정(최종 민평)/직접입력 분기 + appendProvisional', () => {
  const g = { tag: 'T', vs: 'x', slopeVs: 'y', start: '2026-07-06', maturity: '2029-06', series: [['2026-07-06', 6, 4.4, 1.6]] };
  // 구구지표 미입력 → slope = 최종 민평 slope(4.4) 가정
  const a = makeProvisional(g, { date: '2026-07-07', yOn: 3.775, yOff1: 3.715 });
  assert.deepEqual({ raw: a.raw, slope: a.slope, fly: a.fly, slopeAssumed: a.slopeAssumed }, { raw: 6, slope: 4.4, fly: 1.6, slopeAssumed: true });
  // 구구지표 직접입력 → slope = (구지표−구구지표)*100
  const b = makeProvisional(g, { date: '2026-07-07', yOn: 3.775, yOff1: 3.715, yOff2: 3.68 });
  assert.deepEqual({ raw: b.raw, slope: b.slope, fly: b.fly, slopeAssumed: b.slopeAssumed }, { raw: 6, slope: 3.5, fly: 2.5, slopeAssumed: false });
  // append → day N+1 로 계열 확장(원본 불변)
  const c = appendProvisional(g, a);
  assert.equal(c.series.length, 2);
  assert.deepEqual(c.series[1], ['2026-07-07', 6, 4.4, 1.6]);
  assert.equal(g.series.length, 1); // 원본 불변
});

test('withProvisional — override(==최종일)/append(>최종일)/무효(<최종일)', () => {
  const g = { tag: 'T', vs: 'x', slopeVs: 'y', start: '2026-07-03', maturity: '2029-06', series: [['2026-07-03', 2, 4.5, -2.5], ['2026-07-06', 2.6, 4.4, -1.8]] };
  // override: 기준일 == 최종일 → 최종일 값 대체(계열 길이 유지), provDay=N, anchorDay=N-1
  const ov = withProvisional(g, { date: '2026-07-06', raw: 6, slope: 4.4, fly: 1.6 });
  assert.equal(ov.mode, 'override'); assert.equal(ov.provDay, 1); assert.equal(ov.anchorDay, 0);
  assert.equal(ov.gen.series.length, 2);
  assert.deepEqual(ov.gen.series[1], ['2026-07-06', 6, 4.4, 1.6]); // 최종일 값 override
  // append: 기준일 > 최종일 → day N+1 추가
  const ap = withProvisional(g, { date: '2026-07-07', raw: 6, slope: 4.4, fly: 1.6 });
  assert.equal(ap.mode, 'append'); assert.equal(ap.provDay, 2); assert.equal(ap.gen.series.length, 3);
  // 무효: 기준일 < 최종일 → null
  assert.equal(withProvisional(g, { date: '2026-07-02', raw: 1, slope: 1, fly: 0 }), null);
  assert.equal(g.series.length, 2); // 원본 불변
});

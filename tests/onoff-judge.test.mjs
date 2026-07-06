// OO-4 판정 엔진 특성화 테스트 (에피소드 모델) — node --test (자동탐색)
// 실데이터 미동결: 손으로 설계한 합성 세대로 각 룰/게이트/미래입찰을 검증.
// 실데이터 게이트(26-5 헤드라인·다가오는 7/7·지난 6/8)는 tests/local/ 에서 확인.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodEnds, auctionEvents, futureAuctions, judge, buildSnapshot, TH } from '../js/onoff-judge.js';
import { appendProvisional } from '../js/onoff-calc.js';

function bdays(startISO, n) {
  const out = []; let d = new Date(startISO + 'T00:00:00Z');
  while (out.length < n) { const g = d.getUTCDay(); if (g !== 0 && g !== 6) out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
function gen(tag, startISO, fly) {
  const ds = bdays(startISO, fly.length);
  return { tag, vs: tag + 'v', slopeVs: tag + 's', start: ds[0], maturity: '2029-06', series: fly.map((f, i) => [ds[i], 0, 0, f]) };
}

test('periodEnds — 분기말/반기말 앵커(마지막 관측일)', () => {
  const ds = bdays('2025-06-16', 15); // idx10 = 2025-06-30
  const ends = periodEnds(ds);
  assert.equal(ends.length, 1);
  assert.deepEqual({ kind: ends[0].kind, date: ends[0].date, day: ends[0].day }, { kind: '반기말', date: '2025-06-30', day: 10 });
  assert.deepEqual(periodEnds(['2025-06-26', '2025-06-27', '2025-07-01'])[0], { kind: '반기말', calendar: '2025-06-30', date: '2025-06-27', day: 1 });
});

test('auctionEvents / futureAuctions — 앵커·미래 horizon', () => {
  const ds = bdays('2025-08-01', 15);
  assert.deepEqual(auctionEvents(ds, ['2025-08-14']), [{ kind: '입찰', calendar: '2025-08-14', date: '2025-08-14', day: ds.indexOf('2025-08-14') }]);
  // 최종 관측일 당일(D−0)~5영업일 내 → futureAuctions (잠정 포인트 append 시 그 날짜가 D0)
  const last = ds[ds.length - 1];
  const fa = futureAuctions(ds, [last, '2030-01-01']); // last=당일(bdaysAhead 0), 2030 은 horizon 밖 제외
  assert.deepEqual(fa, [{ calendar: last, bdaysAhead: 0 }]);
});

test('judge — 분기·반기말 되돌림 완료(헤드라인)', () => {
  const fly = [-5, -5, -5, -5, -4, -3, -2, -1, 0, 1.5, 3, -1, -3, -4, -3];
  const r = judge(gen('T', '2025-06-16', fly), [], null);
  assert.equal(r.verdict.type, 'period');
  assert.match(r.verdict.label, /되돌림 완료/);
  assert.equal(r.headline.length, 1);
  assert.match(r.headline[0].evidence[0], /\+8bp 확대/);
});

test('judge — 입찰 컨세션(소멸)', () => {
  const fly = [-3, -3, -3, -3, -3, -3, -2, -1, 0, 1, -2, -2, -2, -2, -2];
  const r = judge(gen('T', '2025-08-01', fly), ['2025-08-14'], null);
  assert.equal(r.verdict.type, 'concession');
  assert.match(r.verdict.label, /소멸/);
});

test('judge — 유동성 리프라이싱', () => {
  const fly = [-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4];
  const r = judge(gen('T', '2025-08-01', fly), [], null);
  assert.equal(r.verdict.type, 'liquidity');
});

test('judge — 패턴 없음 → 관찰, z 아웃라이어 flags 병기', () => {
  const flat = gen('T', '2025-08-01', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(judge(flat, [], null).verdict.type, 'none');
  const r = judge(flat, [], { z: 2.0, n: 17 });
  assert.equal(r.verdict.type, 'none');
  assert.ok(r.flags.some(f => f.type === 'outlier'), '아웃라이어 flags 병기');
});

// ── ① 미래 입찰 발화 ──
test('judge — 미래 입찰 사전 컨세션 발화(진행 중)', () => {
  const fly = [-3, -3, -3, -3, -3, -2, -1, 1]; // 마지막 4관측 확대
  const r = judge(gen('T', '2025-08-01', fly), ['2025-08-13'], null); // 08-12 다음 영업일
  assert.equal(r.verdict.type, 'preAuction');
  assert.match(r.verdict.label, /진행 중/);
  assert.equal(r.upcoming.length, 1);
  assert.equal(r.upcoming[0].fired, true);
});

// ── ② 미래 입찰 비발화(사전 확대 없음 명시) ──
test('judge — 미래 입찰 비발화, 사전 확대 없음 라인 표기', () => {
  const fly = [-3, -3, -3, -3, -3, -3, -3, -3]; // 확대 없음
  const r = judge(gen('T', '2025-08-01', fly), ['2025-08-13'], null);
  assert.equal(r.verdict.type, 'none');
  assert.equal(r.upcoming[0].fired, false);
  assert.match(r.upcoming[0].evidence[0], /사전 확대 없음/);
});

// ── ③ 게이트 밖 과거 발화 → 이력(past) 분류 ──
test('judge — 게이트 밖 과거 컨세션 → past, 헤드라인 비움', () => {
  // 입찰 2025-08-08(day5) 발화, now=19 → day5 < now-7 → past
  const fly = [-5, -5, -4, -3, -2, -1, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3];
  const r = judge(gen('T', '2025-08-01', fly), ['2025-08-08'], null);
  assert.equal(r.headline.length, 0);
  assert.equal(r.verdict.type, 'none');
  assert.equal(r.past.length, 1);
  assert.equal(r.past[0].type, 'concession');
  assert.equal(r.past[0].recent, false);
});

// ── ④ 게이트 내 복수 발화 → 혼합/관찰 ──
test('judge — 게이트 내 복수 발화 → 혼합/관찰', () => {
  // 입찰 2025-08-12(day7)·2025-08-15(day10) 둘 다 발화, now=11 → 둘 다 recent
  const fly = [-5, -5, -5, -5, -4, -3, -2, -1, -2, -1, 0, -1];
  const r = judge(gen('T', '2025-08-01', fly), ['2025-08-12', '2025-08-15'], null);
  assert.equal(r.headline.length, 2);
  assert.equal(r.verdict.type, 'mixed');
  assert.match(r.verdict.label, /혼합\/관찰/);
});

// ── 잠정 포인트: ① 포함 시 발화 전환 ② 미포함 시 원판정 유지 ──
test('judge — 잠정 포인트 포함 시 다가오는 입찰 발화 전환', () => {
  const base = gen('T', '2025-08-01', [-3, -3, -3, -3, -3, -3, -3, -3]); // last 2025-08-12
  const r0 = judge(base, ['2025-08-14'], null);
  assert.equal(r0.verdict.type, 'none');       // ② 미포함 원판정
  assert.equal(r0.upcoming[0].fired, false);
  const prov = appendProvisional(base, { date: '2025-08-13', raw: 5, slope: 4, fly: 1 });
  const r1 = judge(prov, ['2025-08-14'], null); // ① 잠정 포함 → 발화
  assert.equal(r1.upcoming[0].fired, true);
  assert.match(r1.upcoming[0].label, /진행 중/);
  assert.equal(r1.verdict.type, 'preAuction');
});

// 확대폭 기준(시작점 대비 유지) — 윈도우 저점이 시작점과 0.5bp↑ 다를 때만 참고 병기
test('judge — 사전 컨세션 evidence 저점 참고 병기 조건 분기', () => {
  // A) 윈도우 저점(-3) < 시작점(0) → 참고 병기. 마지막 4관측 [0,-3,-1,3]
  const a = judge(gen('T', '2025-08-01', [-3, -3, -3, -3, 0, -3, -1, 3]), ['2025-08-13'], null);
  assert.equal(a.upcoming[0].fired, true);
  assert.ok(a.upcoming[0].evidence.some(e => /참고: 윈도우 저점 -3 대비 \+6bp/.test(e)), '저점 참고 병기');
  // B) 저점(-3) == 시작점(-3) → 병기 없음. 마지막 4관측 [-3,-2,-1,3]
  const b = judge(gen('T', '2025-08-01', [-3, -3, -3, -3, -3, -2, -1, 3]), ['2025-08-13'], null);
  assert.equal(b.upcoming[0].fired, true);
  assert.ok(!b.upcoming[0].evidence.some(e => /참고: 윈도우 저점/.test(e)), '차이<0.5bp → 병기 없음');
});

test('buildSnapshot — 헤드라인/다가오는/지난 구조', () => {
  const fly = [-5, -5, -5, -5, -4, -3, -2, -1, 0, 1.5, 3, -1, -3, -4, -3];
  const g = gen('T', '2025-06-16', fly);
  const s = buildSnapshot(g, judge(g, [], null), { z: 0.5, n: 17 });
  assert.equal(s.tag, 'T'); assert.equal(s.fly, -3); assert.equal(s.z, 0.5);
  assert.ok(Array.isArray(s.fly20) && s.fly20.length === 15);
  assert.ok(s.evidence.length >= 1 && s.evidence[0].conditions.length >= 1);
  assert.ok(Array.isArray(s.upcoming) && Array.isArray(s.past));
});

test('TH 임계값·게이트 상수 노출', () => {
  assert.equal(TH.periodWiden, 2.0);
  assert.equal(TH.zOutlier, 1.5);
  assert.equal(TH.recentDays, 7);
  assert.equal(TH.upcomingDays, 5);
});

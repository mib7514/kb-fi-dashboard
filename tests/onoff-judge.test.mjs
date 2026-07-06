// OO-4 판정 엔진 특성화 테스트 — node --test (자동탐색)
// 실데이터 미동결: 손으로 설계한 합성 세대로 각 룰(분기·반기말/컨세션/유동성/아웃라이어)을 검증.
// 실데이터 게이트("현재 26-5 → 분기·반기말 되돌림 완료")는 tests/local/ 에서 확인.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodEnds, auctionEvents, judge, buildSnapshot, TH } from '../js/onoff-judge.js';

// 영업일(월~금) 날짜 n개 생성
function bdays(startISO, n) {
  const out = []; let d = new Date(startISO + 'T00:00:00Z');
  while (out.length < n) { const g = d.getUTCDay(); if (g !== 0 && g !== 6) out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
// fly 배열 → 세대(raw/slope 0)
function gen(tag, startISO, fly) {
  const ds = bdays(startISO, fly.length);
  return { tag, vs: tag + 'v', slopeVs: tag + 's', start: ds[0], maturity: '2029-06', series: fly.map((f, i) => [ds[i], 0, 0, f]) };
}

test('periodEnds — 분기말/반기말 앵커(마지막 관측일)', () => {
  // 2025-06-30 관측 존재 → 반기말 day 매칭
  const ds = bdays('2025-06-16', 15); // idx10 = 2025-06-30
  const ends = periodEnds(ds);
  assert.equal(ends.length, 1);
  assert.deepEqual({ kind: ends[0].kind, date: ends[0].date, day: ends[0].day }, { kind: '반기말', date: '2025-06-30', day: 10 });
  // 06-30 미관측 시 직전 관측일 앵커
  const ds2 = ['2025-06-26', '2025-06-27', '2025-07-01'];
  assert.deepEqual(periodEnds(ds2)[0], { kind: '반기말', calendar: '2025-06-30', date: '2025-06-27', day: 1 });
});

test('auctionEvents — 입찰일 앵커', () => {
  const ds = bdays('2025-08-01', 15);
  assert.deepEqual(auctionEvents(ds, ['2025-08-14']), [{ kind: '입찰', calendar: '2025-08-14', date: '2025-08-14', day: ds.indexOf('2025-08-14') }]);
  assert.deepEqual(auctionEvents(ds, ['2030-01-01']), []); // 범위 밖
});

test('judge — 분기·반기말 되돌림 완료', () => {
  // 반기말 2025-06-30(idx10). D−7=idx3 baseline −5, peak +3(widen +8), 익월 3영업일 −4로 되돌림
  const fly = [-5, -5, -5, -5, -4, -3, -2, -1, 0, 1.5, 3, -1, -3, -4, -3];
  const r = judge(gen('T', '2025-06-16', fly), [], null);
  assert.equal(r.verdict.type, 'period');
  assert.match(r.verdict.label, /되돌림 완료/);
  assert.equal(r.events.length, 1);
  assert.match(r.badges[0].evidence[0], /\+8bp 확대/);
  assert.match(r.badges[0].evidence[1], /되돌림 완료/);
});

test('judge — 입찰 컨세션(소멸)', () => {
  // 이벤트 없는 8월 구간, 입찰 2025-08-14(idx9). D−4=idx5 −3, peak +1(widen +4), D+3 −2 반납
  const fly = [-3, -3, -3, -3, -3, -3, -2, -1, 0, 1, -2, -2, -2, -2, -2];
  const r = judge(gen('T', '2025-08-01', fly), ['2025-08-14'], null);
  assert.equal(r.verdict.type, 'concession');
  assert.match(r.verdict.label, /소멸/);
});

test('judge — 유동성 리프라이싱(이벤트 무관 지속 확대·되돌림 부재)', () => {
  // 이벤트 없는 구간, 10영업일+ 단조 확대, 현재=peak
  const fly = [-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4];
  const r = judge(gen('T', '2025-08-01', fly), [], null);
  assert.equal(r.verdict.type, 'liquidity');
  assert.match(r.badges[0].evidence[0], /지속 확대/);
});

test('judge — 패턴 없음 → 관찰, z 아웃라이어 별도 병기', () => {
  const flat = gen('T', '2025-08-01', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(judge(flat, [], null).verdict.type, 'none');
  // z ≥ +1.5 → 별도 배지 병기(verdict 는 여전히 none)
  const r = judge(flat, [], { z: 2.0, n: 17 });
  assert.equal(r.verdict.type, 'none');
  assert.ok(r.badges.some(b => b.type === 'outlier'), '아웃라이어 배지 병기');
});

test('buildSnapshot — JSON 복사 구조', () => {
  const fly = [-5, -5, -5, -5, -4, -3, -2, -1, 0, 1.5, 3, -1, -3, -4, -3];
  const g = gen('T', '2025-06-16', fly);
  const r = judge(g, [], null);
  const s = buildSnapshot(g, r, { z: 0.5, n: 17 });
  assert.equal(s.tag, 'T'); assert.equal(s.fly, -3); assert.equal(s.z, 0.5);
  assert.ok(Array.isArray(s.fly20) && s.fly20.length === 15); // ≤20
  assert.ok(s.evidence.length >= 1 && s.evidence[0].conditions.length >= 1);
  assert.ok(s.events10.some(e => e.kind === '반기말'));
});

test('TH 임계값 상수 노출', () => {
  assert.equal(TH.periodWiden, 2.0);
  assert.equal(TH.zOutlier, 1.5);
});

// G2~G5 특성화 테스트 — node --test (자동탐색)
// 동결 픽스처(tests/fixtures/credit-spread-frozen.js)를 로드해 rv-calc 산출값을 기준값과 대조.
//
// [기준값 출처] 명령서 원안 표는 노이즈 낀 원본 xlsx double에서 산출돼 있었다.
// 민평 호가 그리드가 0.1bp(=%p 3자리)이므로 3자리 반올림값이 참값이며,
// 아래 게이트는 그 클린 데이터에서 독립 재산출(파이썬)한 값으로, 본 JS 구현과
// 교차검증(오차 ≈0.00)됐다. percentile 정의는 명세대로 weak(count(v<=cur)/n).
// 허용오차는 명령서 원안 유지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toBp, latest, seriesPercentile, slopeStats, pairStats, carryRoll, backtest,
} from '../js/rv-calc.js';
// --- 데이터: 동결 픽스처 로드 (라이브 data/credit-spread.js 는 매일 갱신되므로 참조 금지) ---
// 픽스처는 커밋 시점 데이터에서 G2~G5 참조 시리즈만 추출·동결한 것 → 테스트 영구 유효.
import { series as S } from './fixtures/credit-spread-frozen.js';

const bp = label => toBp(S[label]); // 스프레드 %p → bp
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 허용오차 (명령서 원안) ---
const TOL = { spread: 0.15, pct: 1, btMean: 0.3, btProb: 2, btN: 5, btMed: 0.5 };

// ============ G2 — percentile (공사채AAA), 클린데이터 재산출 ============
const G2 = [
  { m: '1년', cur: 39.7, full: 94.95, y3: 99.87, y1: 99.59 },
  { m: '2년', cur: 34.5, full: 91.95, y3: 92.13, y1: 89.80 },
  { m: '3년', cur: 37.1, full: 91.31, y3: 88.93, y1: 100.00 },
  { m: '5년', cur: 29.1, full: 85.69, y3: 77.07, y1: 99.59 },
  { m: '10년', cur: 18.0, full: 67.50, y3: 21.87, y1: 13.47 },
];
for (const g of G2) {
  test(`G2 공사채AAA_${g.m} percentile`, () => {
    const arr = bp(`공사채AAA_${g.m}`);
    assert.ok(near(latest(arr), g.cur, TOL.spread), `현재 ${latest(arr)} vs ${g.cur}`);
    assert.ok(near(seriesPercentile(arr, 'full'), g.full, TOL.pct), `full ${seriesPercentile(arr, 'full')} vs ${g.full}`);
    assert.ok(near(seriesPercentile(arr, '3y'), g.y3, TOL.pct), `3y ${seriesPercentile(arr, '3y')} vs ${g.y3}`);
    assert.ok(near(seriesPercentile(arr, '1y'), g.y1, TOL.pct), `1y ${seriesPercentile(arr, '1y')} vs ${g.y1}`);
  });
}

// ============ G3 — 기울기 / 페어, 클린데이터 재산출 ============
test('G3 공사AAA 기울기 (3,10)', () => {
  const s = slopeStats(bp('공사채AAA_3년'), bp('공사채AAA_10년'));
  assert.ok(near(s.current, -19.1, TOL.spread), `current ${s.current}`);
  assert.ok(near(s.full, 2.86, TOL.pct), `full ${s.full}`);
  assert.ok(near(s['3y'], 0.13, TOL.pct), `3y ${s['3y']}`);
});
test('G3 공사AAA 기울기 (3,5)', () => {
  const s = slopeStats(bp('공사채AAA_3년'), bp('공사채AAA_5년'));
  assert.ok(near(s.current, -8.0, TOL.spread), `current ${s.current}`);
  assert.ok(near(s.full, 1.66, TOL.pct), `full ${s.full}`);
});
test('G3 페어 공사AAA−은행AAA 3년', () => {
  const p = pairStats(bp('공사채AAA_3년'), bp('은행채AAA_3년'));
  assert.ok(near(p.current, 0.4, TOL.spread), `current ${p.current}`);
  assert.ok(near(p.full, 90.53, TOL.pct), `full ${p.full}`);
});

// ============ G4 — 캐리+롤 (공사채AAA), 5포인트 보간 ============
test('G4 공사채AAA 캐리+롤', () => {
  const ktbByMat = {}, spreadByMat = {};
  for (const m of [1, 2, 3, 5, 10]) {
    ktbByMat[m] = latest(S[`국고채권_${m}년`]);       // %
    spreadByMat[m] = latest(bp(`공사채AAA_${m}년`));   // bp
  }
  const cr = carryRoll(ktbByMat, spreadByMat);
  const G4 = {
    2: { ktbRoll: 36.00, spreadRoll: -5.20, excess: 29.3, allIn: 4.060, dur: 1.88 },
    3: { ktbRoll: 7.50, spreadRoll: 2.60, excess: 39.7, allIn: 4.161, dur: 2.77 },
    5: { ktbRoll: 11.75, spreadRoll: -4.00, excess: 25.1, allIn: 4.316, dur: 4.41 },
    10: { ktbRoll: 3.60, spreadRoll: -2.22, excess: 15.8, allIn: 4.385, dur: 7.96 },
  };
  for (const m of [2, 3, 5, 10]) {
    const r = cr[m], g = G4[m];
    assert.ok(near(r.ktbRoll, g.ktbRoll, TOL.spread), `${m}년 KTB롤 ${r.ktbRoll} vs ${g.ktbRoll}`);
    assert.ok(near(r.spreadRoll, g.spreadRoll, TOL.spread), `${m}년 스프레드롤 ${r.spreadRoll} vs ${g.spreadRoll}`);
    assert.ok(near(r.excessCarryRoll, g.excess, TOL.spread), `${m}년 초과캐리롤 ${r.excessCarryRoll} vs ${g.excess}`);
    assert.ok(near(r.allIn, g.allIn, 0.002), `${m}년 올인 ${r.allIn} vs ${g.allIn}`);
    assert.ok(near(r.dur, g.dur, 0.02), `${m}년 dur ${r.dur} vs ${g.dur}`);
  }
});

// ============ G5 — 백테스트 (warmup 500, horizon 126, weak), 클린데이터 재산출 ============
test('G5 백테스트 공사채AAA_3년', () => {
  const b = backtest(bp('공사채AAA_3년'));
  const g = {
    low: { n: 325, mean: 7.09, prob: 0.6 },
    mid: { n: 868, mean: 0.97, prob: 42.7 },
    high: { n: 1012, mean: -1.33, prob: 58.0 },
  };
  for (const k of ['low', 'mid', 'high']) {
    assert.ok(near(b[k].n, g[k].n, TOL.btN), `${k} n ${b[k].n} vs ${g[k].n}`);
    assert.ok(near(b[k].mean, g[k].mean, TOL.btMean), `${k} mean ${b[k].mean} vs ${g[k].mean}`);
    assert.ok(near(b[k].shrinkProb, g[k].prob, TOL.btProb), `${k} prob ${b[k].shrinkProb} vs ${g[k].prob}`);
  }
});
test('G5 백테스트 회사채AA-_3년', () => {
  const b = backtest(bp('회사채AA-_3년'));
  const g = {
    low: { n: 686, mean: 11.21, prob: 17.9 },
    mid: { n: 816, mean: -2.16, prob: 62.5 },
    high: { n: 703, mean: -5.49, prob: 66.4 },
  };
  for (const k of ['low', 'mid', 'high']) {
    assert.ok(near(b[k].n, g[k].n, TOL.btN), `${k} n ${b[k].n} vs ${g[k].n}`);
    assert.ok(near(b[k].mean, g[k].mean, TOL.btMean), `${k} mean ${b[k].mean} vs ${g[k].mean}`);
    assert.ok(near(b[k].shrinkProb, g[k].prob, TOL.btProb), `${k} prob ${b[k].shrinkProb} vs ${g[k].prob}`);
  }
  assert.ok(near(b.high.median, -10.50, TOL.btMed), `고 median ${b.high.median}`);
});

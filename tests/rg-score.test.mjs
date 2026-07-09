// RG-4 채점 엔진 테스트 — node --test (자동탐색). 밴드는 실제 data/rg-calib.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyRealized, argmaxDir, combine9, brierMulti, brier3, scoreRg2Rank, scoreJudgment,
  maturityOf, ddayTo, RATE_LABELS, SPREAD_LABELS,
} from '../js/rg-score.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const win = {};
new Function('window', readFileSync(new URL('../data/rg-calib.js', import.meta.url), 'utf8'))(win);
const BANDS = win.RG_CALIB.bands;

test('classifyRealized — 경계(등호=방향, |Δ|<밴드=보합)', () => {
  assert.equal(classifyRealized(4.5, 4.6), 'flat');    // 밴드−0.1 → 보합
  assert.equal(classifyRealized(4.6, 4.6), 'up');      // =밴드 → 방향
  assert.equal(classifyRealized(4.7, 4.6), 'up');      // 밴드+0.1 → 방향
  assert.equal(classifyRealized(-4.6, 4.6), 'down');   // =−밴드 → 방향
  assert.equal(classifyRealized(-4.5, 4.6), 'flat');
  assert.equal(classifyRealized(1, 2.2, SPREAD_LABELS), 'flat');
  assert.equal(classifyRealized(3, 2.2, SPREAD_LABELS), 'wide');
  assert.equal(classifyRealized(-3, 2.2, SPREAD_LABELS), 'narrow');
});

test('combine9 — 합 1, 곱 정확', () => {
  const d = combine9({ down: 60, flat: 30, up: 10 }, { narrow: 20, flat: 30, wide: 50 });
  near(Object.values(d).reduce((a, b) => a + b, 0), 1);
  near(d['down|wide'], 0.6 * 0.5);
  assert.equal(combine9({ down: 0, flat: 0, up: 0 }, { narrow: 1, flat: 1, wide: 1 }), null);
});

test('argmaxDir', () => {
  assert.equal(argmaxDir({ down: 60, flat: 30, up: 10 }, RATE_LABELS), 'down');
  assert.equal(argmaxDir({ narrow: 20, flat: 30, wide: 50 }, SPREAD_LABELS), 'wide');
});

test('brierMulti / brier3 — 손계산 검증', () => {
  const d = combine9({ down: 60, flat: 30, up: 10 }, { narrow: 20, flat: 30, wide: 50 });
  // 실현 down|wide (p=0.30). 손계산 Σ(p−o)² = 0.5748
  near(brierMulti(d, 'down|wide'), 0.5748, 1e-9);
  // 3분류: {narrow50,flat30,wide20}→[.5,.3,.2], 실현 narrow: (.5−1)²+.3²+.2² = 0.38
  near(brier3({ narrow: 50, flat: 30, wide: 20 }, 'narrow'), 0.38, 1e-9);
  // 완전 적중(원핫=예측) → 0, 완전 빗나감(반대 100%) → 2
  near(brier3({ narrow: 100, flat: 0, wide: 0 }, 'narrow'), 0);
  near(brier3({ narrow: 100, flat: 0, wide: 0 }, 'wide'), 2);
});

test('scoreRg2Rank — top-1 / top-2', () => {
  const rg2 = { topTenor: '3Y', carryRollBp: [28, 28, 28.5, 29, 29.5, 30, 30.5, 31] };
  const realizedDy = [0, 0, 0, 0, 0, 0, 0, -20];   // 5Y −20bp → 5Y 최고수익
  const r = scoreRg2Rank(rg2, realizedDy);
  assert.equal(r.realizedTop1, '5Y');
  assert.equal(r.hitTop1, false);                   // 3Y 는 top1 아님
  assert.equal(r.hitTop2, true);                    // 3Y 는 2위(캐리+롤 최대)
  assert.equal(r.realizedRank, 2);
  const r1 = scoreRg2Rank({ topTenor: '5Y', carryRollBp: rg2.carryRollBp }, realizedDy);
  assert.equal(r1.hitTop1, true);
});

test('scoreJudgment — 앵커 케이스(전부 적중) + 이중계산 처리', () => {
  const judgment = {
    probs: { rate: { down: 60, flat: 30, up: 10 }, spread: { narrow: 20, flat: 30, wide: 50 } },
    mode: { cell: 'down|wide' },
    baseline: { bandKtb3yBp: 4.6, bandRepSpreadBp: 2.2 },
    sectors: {
      국고채: { probs: { narrow: 60, flat: 30, wide: 10 } },   // = rate 매핑(down=narrow)
      공사채: { probs: { narrow: 50, flat: 30, wide: 20 } },
      은행채: { probs: { narrow: 33, flat: 34, wide: 33 } },
      회사채: { probs: { narrow: 20, flat: 30, wide: 50 } },   // = spread
      카드채: { probs: { narrow: 33, flat: 34, wide: 33 } },
      여전채: { probs: { narrow: 33, flat: 34, wide: 33 } },
    },
    rg2: { topTenor: '5Y', carryRollBp: [28, 28, 28.5, 29, 29.5, 30, 30.5, 31] },
  };
  const realized = {
    ktb3yDeltaBp: -10, repSpreadDeltaBp: 8,          // down, wide
    sectorsDeltaBp: { 공사채: -3, 은행채: 0, 카드채: 0, 여전채: 0 },
    curveDeltaBp: [0, 0, 0, 0, 0, 0, 0, -20],
  };
  const s = scoreJudgment(judgment, realized, BANDS);
  assert.equal(s.realized.cell, 'down|wide');
  assert.equal(s.modalHit, true);
  assert.deepEqual(s.axisHit, { rate: true, spread: true });
  near(s.brier.cells9, 0.57, 1e-9);                  // round2(0.5748)
  // 공사채 실현 narrow(−3<−1.9) → brier 0.38
  assert.equal(s.brier.sectors.perSector['공사채'].brier, 0.38);
  assert.equal(s.brier.sectors.perSector['공사채'].realDir, 'narrow');
  // 국고=rate·회사=spread 는 shared 플래그, creditAvg 는 신용 4섹터만
  assert.equal(s.brier.sectors.perSector['국고채'].shared, 'rate');
  assert.equal(s.brier.sectors.perSector['회사채'].shared, 'spread');
  const credit = ['공사채', '은행채', '카드채', '여전채'].map(k => s.brier.sectors.perSector[k].brier);
  near(s.brier.sectors.creditAvg, Math.round(credit.reduce((a, b) => a + b, 0) / 4 * 100) / 100, 1e-9);
  assert.ok(s.brier.sectors.creditAvg !== s.brier.sectors.allAvg);  // 6 vs 4 다름(공유 반영)
  assert.equal(s.rg2Rank.hitTop1, true);
});

test('maturity / dday', () => {
  assert.equal(maturityOf('2026-06-08'), '2026-07-08');
  assert.equal(ddayTo('2026-07-08', '2026-07-01'), 7);   // 아직 미도래
  assert.ok(ddayTo('2026-07-08', '2026-07-09') < 0);      // 도래
});

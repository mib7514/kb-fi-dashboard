// 확산지수 계산코어 앵커 테스트 — node --test (자동탐색, 인자 없이 실행).
// Fenrir calculator.test.ts 이식본. diffusion-core.mjs가 원본과 동일하게 거동하는지
// 검증 → 이중 구현 드리프트 방지 게이트(키 불필요).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDiffusion, computeZScores, buildRecord, Z_MIN_HISTORY,
} from '../scripts/lib/diffusion-core.mjs';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

function snap(items, extras = {}) {
  return {
    country: 'US-CPI', period: '2026-03', headline_yoy: 3.0, core_yoy: 2.5,
    items, source_url: 'test', fetched_at: '2026-05-03T00:00:00.000Z', ...extras,
  };
}
const diffusionWithGe2 = (v) => ({
  weighted: { ge0: 50, ge2: v, ge25: 30, ge3: 25 },
  unweighted: { ge0: 50, ge2: v, ge25: 30, ge3: 25 },
});

test('computeDiffusion: 가중+비가중 3-item', () => {
  const r = computeDiffusion(snap([
    { code: 'A', name: 'A', weight: 50, yoy: 3.0 },
    { code: 'B', name: 'B', weight: 30, yoy: 1.0 },
    { code: 'C', name: 'C', weight: 20, yoy: -1.0 },
  ]));
  near(r.weighted.ge0, 80); near(r.weighted.ge2, 50);
  near(r.weighted.ge25, 50); near(r.weighted.ge3, 50);
  near(r.unweighted.ge0, 200 / 3); near(r.unweighted.ge2, 100 / 3);
});

test('computeDiffusion: ge2.5 경계 포함 (yoy=2.5 → ≥2.5)', () => {
  const r = computeDiffusion(snap([{ code: 'X', name: 'X', weight: 100, yoy: 2.5 }]));
  near(r.weighted.ge25, 100); near(r.weighted.ge3, 0);
});

test('computeDiffusion: weight=null은 가중 제외·비가중 포함', () => {
  const r = computeDiffusion(snap([
    { code: 'A', name: 'A', weight: 50, yoy: 3.0 },
    { code: 'B', name: 'B', weight: null, yoy: 3.0 },
    { code: 'C', name: 'C', weight: 50, yoy: -1.0 },
  ]));
  near(r.weighted.ge2, 50); near(r.unweighted.ge2, 200 / 3);
});

test('computeDiffusion: yoy=null은 양쪽 제외', () => {
  const r = computeDiffusion(snap([
    { code: 'A', name: 'A', weight: 50, yoy: 3.0 },
    { code: 'B', name: 'B', weight: 30, yoy: null },
    { code: 'C', name: 'C', weight: 20, yoy: 1.0 },
  ]));
  near(r.weighted.ge0, 100); near(r.weighted.ge2, (50 / 70) * 100);
  near(r.unweighted.ge0, 100); near(r.unweighted.ge2, 50);
});

test('computeDiffusion: 전부 yoy=null → 전부 0', () => {
  const r = computeDiffusion(snap([
    { code: 'A', name: 'A', weight: 50, yoy: null },
    { code: 'B', name: 'B', weight: 50, yoy: null },
  ]));
  assert.equal(r.weighted.ge0, 0); assert.equal(r.weighted.ge2, 0);
  assert.equal(r.unweighted.ge0, 0); assert.equal(r.unweighted.ge2, 0);
});

test('computeDiffusion: ge0 ≥ ge2 ≥ ge25 ≥ ge3 단조', () => {
  const r = computeDiffusion(snap([
    { code: 'A', name: 'A', weight: 25, yoy: 4.0 },
    { code: 'B', name: 'B', weight: 25, yoy: 2.7 },
    { code: 'C', name: 'C', weight: 25, yoy: 2.1 },
    { code: 'D', name: 'D', weight: 25, yoy: 0.5 },
  ]));
  assert.ok(r.weighted.ge0 >= r.weighted.ge2);
  assert.ok(r.weighted.ge2 >= r.weighted.ge25);
  assert.ok(r.weighted.ge25 >= r.weighted.ge3);
  assert.ok(r.unweighted.ge0 >= r.unweighted.ge2);
});

test('computeZScores: warmup(history<12) → 0', () => {
  const history = Array.from({ length: Z_MIN_HISTORY - 1 }, () => diffusionWithGe2(50));
  assert.equal(computeZScores(diffusionWithGe2(50), history).weighted.ge2, 0);
});

test('computeZScores: 분산 있으면 current>mean → z>0', () => {
  const history = [];
  for (let i = 0; i < 60; i++) history.push(diffusionWithGe2(40 + (i % 21)));
  assert.ok(computeZScores(diffusionWithGe2(70), history).weighted.ge2 > 0);
});

test('computeZScores: std=0(상수) → 0', () => {
  const history = Array.from({ length: 60 }, () => diffusionWithGe2(50));
  assert.equal(computeZScores(diffusionWithGe2(70), history).weighted.ge2, 0);
});

test('computeZScores: 12개월 정확계산 z=(cur-μ)/σ', () => {
  const series = [40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62];
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const std = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
  const history = series.map((v) => diffusionWithGe2(v));
  near(computeZScores(diffusionWithGe2(51), history).weighted.ge2, (51 - mean) / std);
});

test('buildRecord: end-to-end, 빈 history → z=0·메타 보존', () => {
  const rec = buildRecord(snap([
    { code: 'A', name: 'A', weight: 60, yoy: 3.5 },
    { code: 'B', name: 'B', weight: 40, yoy: 1.5 },
  ], { country: 'KR', period: '2026-04', core_yoy_intl: 2.1 }), []);
  assert.ok(rec);
  assert.equal(rec.country, 'KR');
  assert.equal(rec.period, '2026-04');
  assert.equal(rec.core_yoy_intl, 2.1);
  assert.equal(rec.weight_coverage, 1);
  near(rec.diffusion.weighted.ge2, 60);
  assert.equal(rec.z_scores_5y.weighted.ge2, 0);
  assert.equal(rec.item_count, 2);
});

test('buildRecord: weight_coverage는 양수 가중치 비율', () => {
  const rec = buildRecord(snap([
    { code: 'A', name: 'A', weight: 50, yoy: 3.0 },
    { code: 'B', name: 'B', weight: null, yoy: 1.0 },
    { code: 'C', name: 'C', weight: 0, yoy: 1.0 },
    { code: 'D', name: 'D', weight: 50, yoy: 2.0 },
  ]), []);
  assert.ok(rec);
  near(rec.weight_coverage, 0.5);
});

test('buildRecord: core_yoy_intl 누락 시 null 보존', () => {
  const s = snap([{ code: 'A', name: 'A', weight: 100, yoy: 2.0 }]);
  delete s.core_yoy_intl;
  const rec = buildRecord(s, []);
  assert.ok(rec);
  assert.equal(rec.core_yoy_intl, null);
});

test('buildRecord: flash(유효 yoy<20%) → null', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({
    code: 'C' + i, name: 'c', weight: 1, yoy: i < 10 ? 2.0 : null,
  }));
  assert.equal(buildRecord(snap(items), []), null);
});

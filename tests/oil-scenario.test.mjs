// 유가 시나리오 밴드 앵커 — node --test (키 불필요).
// 게이트: 단조성(+20%≥유지≥−20%) + 중앙값 일치(유지 = 기존 나우캐스트 결합값).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wtiGasPassthrough, computeOilBand, OIL_SHOCKS } from '../js/us-oil-scenario.js';
import { computeLivePrediction } from '../js/us-inflation-scorecard.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// 성장률 배열 → 인덱스 시계열 [{period,value}], 2024-01 시작.
function idxFrom(growths, start = '2024-01', v0 = 100) {
  const out = []; let [y, m] = start.split('-').map(Number); let v = v0;
  for (const g of growths) { out.push({ period: `${y}-${String(m).padStart(2, '0')}`, value: v }); v *= (1 + g); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

// 비계절 성장 노이즈(월별 상이) — deseason이 신호를 흡수하지 않도록.
const N = 31; // 2024-01 .. 2026-07
const wtiG = Array.from({ length: N }, (_, i) => 0.02 * Math.sin(i * 1.3) + 0.01 * Math.cos(i * 0.7));

import { computeMMGapAware } from '../js/us-inflation-calc.js';

test('wtiGasPassthrough: 휘발유 m/m = 0.4×WTI m/m → β_wg≈0.4', () => {
  const wti = idxFrom(wtiG);
  // 휘발유 성장 = 0.4 × WTI 성장 (근사 — 인덱스 체인이라 m/m ≈ 성장률).
  const gas = idxFrom(wtiG.map((g) => 0.4 * g));
  const pt = wtiGasPassthrough({
    gasMM: computeMMGapAware(gas), wtiMM: computeMMGapAware(wti), endPeriod: '2026-07', regWindow: 24,
  });
  assert.ok(Math.abs(pt.b - 0.4) < 0.03, `β_wg=${pt.b} ≉ 0.4`);
  assert.ok(pt.r2 > 0.9);
});

function bandInputs() {
  const wti = idxFrom(wtiG);
  const gas = idxFrom(wtiG.map((g) => 0.4 * g));              // β_wg≈0.4>0
  const energyG = wtiG.map((g) => 0.5 * 0.4 * g);            // 에너지 = 0.5×휘발유 → b_ge≈0.5>0
  const energy = idxFrom(energyG);
  const food = idxFrom(Array.from({ length: N }, () => 0.002));
  const core = idxFrom(Array.from({ length: N }, () => 0.0025));
  // 헤드라인 = 가중합(w_e=0.08>0) — 성장률 근사 결합.
  const headG = energyG.map((eg, i) => 0.8 * 0.0025 + 0.12 * 0.002 + 0.08 * eg);
  const headline = idxFrom(headG).slice(0, 30); // 헤드라인 실측은 2026-06까지(휘발유는 07까지)
  return { headlineData: headline, coreData: core.slice(0, 30), energyData: energy.slice(0, 30),
    foodData: food.slice(0, 30), gasData: gas, wtiData: wti };
}

test('computeOilBand: 유지 갈래 = 기존 나우캐스트 결합값 (중앙값 불변)', () => {
  const inp = bandInputs();
  const band = computeOilBand(inp);
  const live = computeLivePrediction(inp);
  const hold = band.branches.find((b) => b.key === 'hold');
  assert.equal(band.month, live.month);
  near(hold.mm, live.combined.mm, 1e-12);
  near(hold.yoy, live.combined.yoy, 1e-12);
  assert.equal(hold.gas_delta_mm, 0);
});

test('computeOilBand: 단조성 +20% ≥ 유지 ≥ −20% (양의 전가 데이터)', () => {
  const band = computeOilBand(bandInputs());
  const up = band.branches.find((b) => b.key === 'up20');
  const hold = band.branches.find((b) => b.key === 'hold');
  const down = band.branches.find((b) => b.key === 'down20');
  // 전제: 세 계수 모두 양 → 단조 증가.
  assert.ok(band.base.w_e > 0 && band.base.b_ge > 0 && band.passthrough.b > 0, 'coeffs must be positive');
  assert.ok(up.yoy >= hold.yoy && hold.yoy >= down.yoy, `${up.yoy} ≥ ${hold.yoy} ≥ ${down.yoy}`);
  assert.ok(up.mm >= hold.mm && hold.mm >= down.mm);
  // 대칭 충격 → 대칭 증분(선형).
  near(up.mm - hold.mm, hold.mm - down.mm, 1e-9);
});

test('computeOilBand: passthrough meta에 스팟 유지 가정 명기', () => {
  const band = computeOilBand(bandInputs());
  assert.match(band.passthrough.note, /스팟 유지/);
  assert.match(band.passthrough.method, /24개월/);
});

test('OIL_SHOCKS: up20/hold/down20 3갈래', () => {
  assert.deepEqual(OIL_SHOCKS.map((s) => s.key), ['up20', 'hold', 'down20']);
  assert.deepEqual(OIL_SHOCKS.map((s) => s.shock), [20, 0, -20]);
});

// Phase 3 오프라인 검증 — node --test (키·네트워크 불필요).
// AU 분기→월 브리지 순수함수 + EU/AU/KR 정적표 로드 + buildCountryPayload 라운드트립.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  quarterToMonthRange, periodToQuarter, priorYearQuarter,
  expandQuarterlyToMonthly, needsQuarterlyBridge, splitWindow, COMPLETE_MONTHLY_FIRST_PERIOD,
} from '../scripts/lib/au-bridge.mjs';
import { buildCountryPayload, monthsBetween } from '../scripts/lib/diffusion-pipeline.mjs';
import { EU_HICP_ITEMS } from '../scripts/lib/eu-hicp-items.mjs';
import { AU_CPI_ITEMS } from '../scripts/lib/au-cpi-items.mjs';
import { lookupAuWeight } from '../scripts/lib/au-cpi-weights.mjs';
import { KR_CPI_ITEMS } from '../scripts/lib/kr-cpi-items.mjs';
import { lookupKrWeight } from '../scripts/lib/kr-cpi-weights.mjs';
import { JP_CPI_ITEMS } from '../scripts/lib/jp-cpi-items.mjs';
import { lookupJpWeight } from '../scripts/lib/jp-cpi-weights.mjs';

// ── AU 브리지 ──
test('au-bridge: quarterToMonthRange / periodToQuarter / priorYearQuarter', () => {
  assert.deepEqual(quarterToMonthRange('2024-Q3'), ['2024-07', '2024-09']);
  assert.equal(periodToQuarter('2024-08'), '2024-Q3');
  assert.equal(periodToQuarter('2024-01'), '2024-Q1');
  assert.equal(periodToQuarter('2024-12'), '2024-Q4');
  assert.equal(priorYearQuarter('2024-Q3'), '2023-Q3');
});

test('au-bridge: expandQuarterlyToMonthly → 3개월 + 브리지 표기', () => {
  const snap = { country: 'AU', period: '2024-Q3', headline_yoy: 3, core_yoy: 3, core_yoy_intl: null,
    items: [{ code: 'x', name: 'x', weight: 1, yoy: 2 }], source_url: 'u', fetched_at: '' };
  const out = expandQuarterlyToMonthly(snap, '2024-Q3');
  assert.deepEqual(out.map((s) => s.period), ['2024-07', '2024-08', '2024-09']);
  assert.ok(out.every((s) => s.source_url.endsWith('#bridged-from-quarterly')));
  assert.ok(out.every((s) => s.items[0].yoy === 2)); // 상수보간: 동일 YoY 복제
});

test('au-bridge: needsQuarterlyBridge 경계 (2025-11)', () => {
  assert.equal(COMPLETE_MONTHLY_FIRST_PERIOD, '2025-11');
  assert.equal(needsQuarterlyBridge('2025-10'), true);
  assert.equal(needsQuarterlyBridge('2025-11'), false);
  assert.equal(needsQuarterlyBridge('2026-06'), false);
});

test('au-bridge: splitWindow 세 경우', () => {
  // 경계 걸침
  assert.deepEqual(splitWindow('2021-07', '2026-06'),
    { quarterlyRange: ['2021-07', '2025-10'], monthlyRange: ['2025-11', '2026-06'] });
  // 전부 이전
  assert.deepEqual(splitWindow('2020-01', '2021-01'),
    { quarterlyRange: ['2020-01', '2021-01'], monthlyRange: null });
  // 전부 이후
  assert.deepEqual(splitWindow('2025-11', '2026-06'),
    { quarterlyRange: null, monthlyRange: ['2025-11', '2026-06'] });
});

// ── EU/AU/KR 파이프라인 라운드트립 (실 정적표 + 합성 yoy) ──
function synthSnaps(items, lookup, country, periods, hasIntl) {
  const yoy = (i, t) => Math.round((Math.sin(i * 1.3 + t * 0.2) * 3 + 2.5) * 100) / 100;
  return periods.map((period, t) => ({
    country, period, headline_yoy: 3.1, core_yoy: 2.8, core_yoy_intl: hasIntl ? 2.4 : null,
    items: items.map((it, i) => ({ code: it.code, name: it.name, weight: lookup(it.code), yoy: yoy(i, t) })),
    source_url: 'test', fetched_at: '',
  }));
}

const PERIODS = [...monthsBetween('2021-07', '2026-06')];

for (const [name, items, lookup, country, hasIntl, expectItems] of [
  ['EU', EU_HICP_ITEMS, () => 5, 'EU', false, 292],
  ['AU', AU_CPI_ITEMS, lookupAuWeight, 'AU', true, 87],
  ['KR', KR_CPI_ITEMS, lookupKrWeight, 'KR', true, 458],
  ['JP', JP_CPI_ITEMS, lookupJpWeight, 'JP', true, 582],
]) {
  test(`pipeline 라운드트립: ${name} (${expectItems}품목)`, () => {
    // EU는 lookup이 상수 5(가중치 있음 가정). AU/KR은 실제 lookup.
    const { payload, stats } = buildCountryPayload(
      synthSnaps(items, lookup, country, PERIODS, hasIntl), { series_id: `x-${name}`, country });
    assert.equal(payload.series.length, 60);
    assert.equal(stats.latest, '2026-06');
    assert.equal(payload.meta.item_count, expectItems);
    // 첫 12개월 warmup z=0
    assert.equal(payload.series[0].z.ge2, 0);
    // 단조성
    for (const s of payload.series) {
      assert.ok(s.weighted.ge0 >= s.weighted.ge2 - 1e-9);
      assert.ok(s.weighted.ge2 >= s.weighted.ge25 - 1e-9);
      assert.ok(s.weighted.ge25 >= s.weighted.ge3 - 1e-9);
    }
    // detail 최근 6개월, core_yoy_intl 유무 반영
    assert.equal(payload.detail.length, 6);
    assert.equal(payload.series.at(-1).core_yoy_intl, hasIntl ? 2.4 : null);
  });
}

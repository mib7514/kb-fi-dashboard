// RG-3 섹터 보드 순수 로직 테스트 — node --test (자동탐색). 밴드는 실제 data/rg-calib.js 로 검증.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectedDs, sectorProbs, setSectorProb, sectorBandBp, buildSectorRows, rankByAttractiveness, SECTORS } from '../js/rg-sector.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const win = {};
new Function('window', readFileSync(new URL('../data/rg-calib.js', import.meta.url), 'utf8'))(win);
const BANDS = win.RG_CALIB.bands;

test('expectedDs — 확대 100% → +δ, 축소 100% → −δ, 중립 → 0', () => {
  near(expectedDs({ narrow: 0, flat: 0, wide: 100 }, 2.2), 2.2);
  near(expectedDs({ narrow: 100, flat: 0, wide: 0 }, 2.2), -2.2);
  near(expectedDs({ narrow: 33, flat: 34, wide: 33 }, 2.2), 0);
});
test('expectedDs — 미정규화(합≠100)도 비율로 계산', () => {
  // narrow 50 / wide 150 (합 200) → (150−50)/200 × 2.2 = 1.1
  near(expectedDs({ narrow: 50, flat: 0, wide: 150 }, 2.2), 1.1);
});
test('expectedDs — 합0/밴드없음 → null', () => {
  assert.equal(expectedDs({ narrow: 0, flat: 0, wide: 0 }, 2.2), null);
  assert.equal(expectedDs({ narrow: 33, flat: 34, wide: 33 }, null), null);
});

test('밴드 소스 — 국고채 = 금리축(ktb3y), 회사채 = repSpread (calib 실측)', () => {
  assert.equal(sectorBandBp('국고채', BANDS), BANDS.ktb3y.bandBp);   // 4.6
  assert.equal(sectorBandBp('국고채', BANDS), 4.6);
  assert.equal(sectorBandBp('회사채', BANDS), BANDS.repSpread.bandBp); // 2.2
  assert.equal(sectorBandBp('공사채', BANDS), 1.9);
});

test('sectorProbs — 회사채=state.spread(동일참조), 국고채=state.rate 매핑(하락=축소)', () => {
  const state = {
    rate: { down: 70, flat: 20, up: 10 },
    spread: { narrow: 10, flat: 20, wide: 70 },
    sectors: { 공사채: {}, 은행채: {}, 카드채: {}, 여전채: {} },
  };
  assert.ok(sectorProbs('회사채', state) === state.spread);        // 동일 참조
  assert.deepEqual(sectorProbs('국고채', state), { narrow: 70, flat: 20, wide: 10 }); // down→narrow, up→wide
});

test('setSectorProb — 공유 섹터는 RG-1 축 필드로 되돌려 쓰기', () => {
  const state = { rate: { down: 33, flat: 34, up: 33 }, spread: { narrow: 33, flat: 34, wide: 33 }, sectors: { 공사채: { narrow: 33, flat: 34, wide: 33 }, 은행채: {}, 카드채: {}, 여전채: {} } };
  setSectorProb('국고채', 'narrow', 55, state);   // 축소 → 하락
  assert.equal(state.rate.down, 55);
  setSectorProb('국고채', 'wide', 5, state);       // 확대 → 상승
  assert.equal(state.rate.up, 5);
  setSectorProb('회사채', 'wide', 60, state);
  assert.equal(state.spread.wide, 60);
  setSectorProb('공사채', 'flat', 40, state);
  assert.equal(state.sectors.공사채.flat, 40);
});

test('buildSectorRows — 6행, 공유 섹터 매핑, 밴드 매핑', () => {
  const state = {
    rate: { down: 50, flat: 30, up: 20 },
    spread: { narrow: 20, flat: 30, wide: 50 },
    sectors: { 공사채: { narrow: 33, flat: 34, wide: 33 }, 은행채: { narrow: 33, flat: 34, wide: 33 }, 카드채: { narrow: 33, flat: 34, wide: 33 }, 여전채: { narrow: 33, flat: 34, wide: 33 } },
  };
  const rows = buildSectorRows(state, BANDS);
  assert.equal(rows.length, 6);
  const cc = rows.find(r => r.key === '회사채');
  assert.ok(cc.shared && cc.probs === state.spread);
  near(cc.eDs, 2.2 * ((50 - 20) / 100), 1e-9);
  const kb = rows.find(r => r.key === '국고채');
  assert.ok(kb.shared);
  near(kb.eDs, 4.6 * ((20 - 50) / 100), 1e-9);        // (up−down)/합 × 4.6 = 음수(축소 우세)
});

test('rankByAttractiveness — 축소 기대(더 음수) 상위', () => {
  const state = {
    rate: { down: 80, flat: 10, up: 10 },            // 국고: 하락(축소) 강 → 매우 음수
    spread: { narrow: 33, flat: 34, wide: 33 },       // 회사채 ≈0
    sectors: {
      공사채: { narrow: 10, flat: 10, wide: 80 },     // 강한 확대 → 양수
      은행채: { narrow: 33, flat: 34, wide: 33 },
      카드채: { narrow: 33, flat: 34, wide: 33 },
      여전채: { narrow: 33, flat: 34, wide: 33 },
    },
  };
  const ranked = rankByAttractiveness(buildSectorRows(state, BANDS));
  assert.equal(ranked[0].key, '국고채');              // 최상위(가장 음수)
  assert.equal(ranked[ranked.length - 1].key, '공사채'); // 최하위(가장 양수)
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].eDs <= ranked[i].eDs);
});

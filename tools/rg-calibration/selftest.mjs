// selftest.mjs — 실데이터 없이 코어 로직 검증(합성 시계열). node tools/rg-calibration/selftest.mjs
// 검증: 전향변화 매칭 / 밴드 σ / 9셀 분할 합=매칭수 / 폴백 소스레벨 / 직렬화 왕복.
// 결정론: 시드 PRNG(Math.random 미사용) → 재현 가능.
import { calibrate, serialize, TENORS, RATE_DIRS, SPREAD_DIRS, cellKey, median, stdev, addMonthsISO, forwardChanges } from './calibrate.mjs';

// 시드 PRNG (mulberry32)
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 영업일 ISO 배열 생성(주말 스킵)
function bdays(startISO, n) {
  const out = []; let d = new Date(startISO + 'T00:00:00Z');
  while (out.length < n) { const g = d.getUTCDay(); if (g !== 0 && g !== 6) out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}

// 합성: 국고 커브 8구간 + 대표 스프레드 랜덤워크(%). 5년치 영업일(~1300).
const R = rng(42);
const gauss = () => { let u = 0, v = 0; while (u === 0) u = R(); while (v === 0) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const dates = bdays('2019-01-01', 1300);

const curve = {}; const lvl = {};
for (const t of TENORS) { curve[t] = new Map(); lvl[t] = 3.0; }
const spread = new Map(); let sLvl = 0.5;
const rate = new Map();
for (const d of dates) {
  for (const t of TENORS) { lvl[t] += gauss() * 0.02; curve[t].set(d, Math.round(lvl[t] * 1000) / 1000); } // ~2bp/day σ
  rate.set(d, curve['3Y'].get(d));
  sLvl += gauss() * 0.015; spread.set(d, Math.round(sLvl * 1000) / 1000);
}
const sectors = { 국고채: rate, 공사채: spread, 은행채: spread, 회사채: spread, 카드채: spread, 여전채: spread };

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

console.log('[forwardChanges]');
const fc = forwardChanges(rate);
check('전향 1개월 매칭 다수 생성', fc.deltas.length > 1000);
check('매칭 to > from (전향)', fc.pairs.every(p => p.to > p.from));
check('목표일 ≈ +1개월', fc.pairs.slice(0, 50).every(p => p.to >= addMonthsISO(p.from, 1)));

console.log('[median/stdev]');
check('median 홀수', median([3, 1, 2]) === 2);
check('median 짝수', median([1, 2, 3, 4]) === 2.5);
check('stdev 양수', stdev(fc.deltas) > 0);

console.log('[calibrate]');
const { payload, report } = calibrate({ curve, rate, spread, sectors, meta: { generatedAt: '2024-01-01', source: 'selftest' } });
check('밴드 ktb3y σ·band 존재', payload.bands.ktb3y.bandBp > 0);
check('밴드 = k·σ (0.25)', Math.abs(payload.bands.ktb3y.bandBp - 0.25 * payload.bands.ktb3y.sigmaBp) < 0.06);
check('9셀 전부 존재', Object.keys(payload.medianCurves.cells).length === 9);
const cellSum = Object.values(payload.medianCurves.cells).reduce((s, c) => s + c.n, 0);
check('셀 표본 합 = 매칭 앵커수', cellSum === report.matched);
const rowSum = Object.values(payload.medianCurves.rows).reduce((s, n) => s + n, 0);
check('행 표본 합 = 매칭 앵커수', rowSum === report.matched);
check('각 셀 deltaBp 길이 = 8구간', Object.values(payload.medianCurves.cells).every(c => c.deltaBp.length === TENORS.length));
check('소스레벨 ∈ {cell,row,global}', Object.values(payload.medianCurves.cells).every(c => ['cell', 'row', 'global'].includes(c.source)));
check('표본≥30 셀은 source=cell', Object.values(payload.medianCurves.cells).every(c => c.n < 30 || c.source === 'cell'));

console.log('[serialize 왕복 · 원시레벨 부재]');
const js = serialize(payload);
const sandbox = {}; new Function('window', js)(sandbox);
check('window.RG_CALIB 로드', !!sandbox.RG_CALIB && !!sandbox.RG_CALIB.medianCurves);
check('직렬화에 window.RG_CALIB 헤더', js.includes('window.RG_CALIB'));
// 원시 레벨(수익률 ~3.x, 스프레드 ~0.5)이 새어나가지 않았는지: 레벨 배열/키 부재 확인
check('레벨 키 없음(series/dates/yield/raw)', !/\b(series|dates|yields?|rawLevel|level)\b/i.test(js));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);

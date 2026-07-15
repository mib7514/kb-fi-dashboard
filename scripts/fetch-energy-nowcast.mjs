// fetch-energy-nowcast.mjs — 에너지 나우캐스트 라이브 입력을 FRED에서 조회해
//   data/us-energy-nowcast.json 생성. 헤드라인·코어는 data/us-inflation.json 재사용
//   (이 파일은 신규 입력 = 휘발유·WTI·에너지 CPI·식품 CPI만 담는다).
//
// 설계 원칙(기존 fetch-us-inflation.mjs와 동일):
//  - Node 내장 fetch만(외부 의존 0). 파일에 wall-clock 타임스탬프 금지(diff-없으면-skip).
//  - 주간/일간 → 달력월 평균으로 집계. 당월은 그 시점까지 가용 주(週)만 평균(부분월 나우캐스트 허용).
//  - 산식·나우캐스트는 js/us-energy-nowcast.js(라이브 모듈)가 담당. 이 스크립트는 데이터만.
//
// 실행: NODE_EXTRA_CA_CERTS=.corp-ca.pem  (+ .env FRED_API_KEY)  node scripts/fetch-energy-nowcast.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('[energy-nowcast] FRED_API_KEY 없음'); process.exit(1); }

const START = '2009-01-01'; // 10y 시즈널 창 + 24m 회귀 여유 확보(헤드라인 파이프라인과 동일 백필 기점).

async function fredObs(id) {
  const u = new URL('https://api.stlouisfed.org/fred/series/observations');
  u.searchParams.set('series_id', id); u.searchParams.set('api_key', KEY);
  u.searchParams.set('file_type', 'json'); u.searchParams.set('observation_start', START);
  const r = await fetch(u, { headers: { 'User-Agent': 'fi-dashboard/energy-nowcast' } });
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  const j = await r.json();
  const obs = (j.observations || []).filter((o) => o.value !== '.' && o.value !== '' && o.value != null)
    .map((o) => ({ date: o.date, value: Number(o.value) })).filter((o) => Number.isFinite(o.value));
  if (!obs.length) throw new Error(`FRED ${id}: 유효 관측치 0`);
  return obs;
}

// 주간/일간 → 달력월 평균 [{period:'YYYY-MM', value, weeks}]. date의 month로 버킷.
function monthlyAvg(obs) {
  const byM = new Map();
  for (const o of obs) {
    const p = o.date.slice(0, 7);
    const b = byM.get(p) || { s: 0, n: 0 };
    b.s += o.value; b.n += 1; byM.set(p, b);
  }
  return [...byM.entries()].map(([period, b]) => ({ period, value: b.s / b.n, weeks: b.n }))
    .sort((a, b) => (a.period < b.period ? -1 : 1));
}
// FRED 월간 인덱스(YYYY-MM-01) → {period,value}
const toMonthly = (obs) => obs.map((o) => ({ period: o.date.slice(0, 7), value: o.value }))
  .sort((a, b) => (a.period < b.period ? -1 : 1));

async function main() {
  console.error(`[energy-nowcast] FRED 조회 (start=${START})…`);
  const [gas, wti, energy, food] = await Promise.all([
    fredObs('GASREGW'), fredObs('DCOILWTICO'), fredObs('CPIENGSL'), fredObs('CPIUFDSL'),
  ]);

  const gasM = monthlyAvg(gas);   // 휘발유 월평균 $/gal (당월=부분월 가능, weeks로 표기)
  const wtiM = monthlyAvg(wti);   // WTI 월평균 $/bbl
  const energyM = toMonthly(energy);
  const foodM = toMonthly(food);

  const out = {
    source: 'FRED (GASREGW, DCOILWTICO, CPIENGSL, CPIUFDSL)',
    note: '휘발유·WTI는 달력월 평균(당월=가용 주 평균, weeks 표기). 에너지·식품 CPI는 SA 인덱스. '
      + '나우캐스트 산식은 js/us-energy-nowcast.js. 헤드라인·코어는 data/us-inflation.json 참조.',
    series: {
      'us-gasoline-monthly': {
        meta: { fred_code: 'GASREGW', unit: 'Dollars per Gallon', sa: 'NSA', freq: 'monthly-avg-of-weekly',
          last_updated: gasM[gasM.length - 1].period, last_weeks: gasM[gasM.length - 1].weeks },
        data: gasM,
      },
      'us-wti-monthly': {
        meta: { fred_code: 'DCOILWTICO', unit: 'Dollars per Barrel', sa: 'NSA', freq: 'monthly-avg-of-daily',
          last_updated: wtiM[wtiM.length - 1].period },
        data: wtiM,
      },
      'us-cpi-energy': {
        meta: { fred_code: 'CPIENGSL', unit: 'Index 1982-1984=100', sa: 'SA', freq: 'monthly',
          last_updated: energyM[energyM.length - 1].period },
        data: energyM,
      },
      'us-cpi-food': {
        meta: { fred_code: 'CPIUFDSL', unit: 'Index 1982-1984=100', sa: 'SA', freq: 'monthly',
          last_updated: foodM[foodM.length - 1].period },
        data: foodM,
      },
    },
  };

  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, 'us-energy-nowcast.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.error(`[energy-nowcast] gas 최신 ${out.series['us-gasoline-monthly'].meta.last_updated}`
    + `(${out.series['us-gasoline-monthly'].meta.last_weeks}주), energy CPI 최신 ${energyM[energyM.length - 1].period} → ${outPath}`);
}

main().catch((e) => { console.error(`[energy-nowcast] 실패: ${e.message}`); process.exit(1); });

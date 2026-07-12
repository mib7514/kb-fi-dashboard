// fetch-us-inflation.mjs — FRED에서 미국 물가지수 4종을 조회해 data/us-inflation.json 생성.
//
// 설계 원칙
//  - Node 내장 fetch만 사용 (외부 의존성 0, npm install 없는 repo 유지). Node 18+ 필요.
//  - FRED 공개 데이터 → 원값(지수) 그대로 저장 무방.
//  - 전부 SA(계절조정) 시리즈로 일원화. 산출 y/y는 SA 기준 → BLS/BEA 공표 y/y(NSA)와
//    ±0.1%p 내외 괴리 가능 (UI 각주로 명기).
//  - 파일에는 wall-clock 타임스탬프를 넣지 않는다. 데이터가 바뀔 때만 파일이 바뀌어야
//    워크플로의 "diff 없으면 커밋 skip"이 정확히 동작한다. (기준일은 데이터에서 파생.)
//
// 실행:  FRED_API_KEY=xxxx node scripts/fetch-us-inflation.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── 대상 시리즈 (4종, 전부 FRED SA) ──
const SERIES = [
  { id: 'us-cpi-headline', fred: 'CPIAUCSL', display_name: 'US CPI All Items (SA)',        unit: '1982-84=100' },
  { id: 'us-cpi-core',     fred: 'CPILFESL', display_name: 'US CPI ex Food & Energy (SA)', unit: '1982-84=100' },
  { id: 'us-pce-headline', fred: 'PCEPI',    display_name: 'US PCE Price Index (SA)',      unit: '2017=100' },
  { id: 'us-pce-core',     fred: 'PCEPILFE', display_name: 'US PCE ex Food & Energy (SA)', unit: '2017=100' },
];

// 백필: 2009-01부터 고정(15년+ 확보). 시즈널 윈도우 5/10/15년 토글을 뒷받침한다.
// 4시리즈 × 월별이라 JSON 크기는 여전히 작다.
const OBSERVATION_START = '2009-01-01';

const API_KEY = process.env.FRED_API_KEY;
if (!API_KEY) {
  console.error('[fetch-us-inflation] FRED_API_KEY 환경변수가 없습니다.');
  process.exit(1);
}

function observationStart() {
  return OBSERVATION_START;
}

// FRED 날짜('YYYY-MM-01') → 'YYYY-MM'
function toPeriod(fredDate) {
  return fredDate.slice(0, 7);
}

async function fetchSeries(fredCode, start) {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', fredCode);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', start);

  const res = await fetch(url, { headers: { 'User-Agent': 'fi-dashboard/us-inflation' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FRED ${fredCode} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.observations)) {
    throw new Error(`FRED ${fredCode}: observations 누락`);
  }

  // FRED는 결측을 "."로 반환 → 제외. 오름차순 정렬 보장.
  const data = json.observations
    .filter((o) => o.value !== '.' && o.value !== '' && o.value != null)
    .map((o) => ({ period: toPeriod(o.date), value: Number(o.value) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

  if (data.length === 0) throw new Error(`FRED ${fredCode}: 유효 관측치 0`);
  return data;
}

async function main() {
  const start = observationStart();
  console.error(`[fetch-us-inflation] observation_start=${start}, 시리즈 ${SERIES.length}종`);

  const out = {
    source: 'FRED (Federal Reserve Bank of St. Louis)',
    seasonal_adjustment: 'SA',
    note: '전부 계절조정(SA) 시리즈. 산출 y/y는 SA 기준으로 BLS/BEA 공표 y/y(NSA)와 소폭 괴리 가능.',
    series: {},
  };

  for (const s of SERIES) {
    const data = await fetchSeries(s.fred, start);
    const last = data[data.length - 1];
    out.series[s.id] = {
      meta: {
        series_id: s.id,
        fred_code: s.fred,
        display_name: s.display_name,
        source: 'fred',
        unit: s.unit,
        value_type: 'index',
        frequency: 'monthly',
        seasonal_adjustment: 'SA',
        last_updated: last.period,
      },
      data,
    };
    console.error(`  ${s.id.padEnd(18)} ${s.fred.padEnd(10)} ${data.length}개월  최신 ${last.period}=${last.value}`);
  }

  // data/us-inflation.json — 저장소 루트 기준. 안정적 직렬화(정렬된 key, 2-space).
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(scriptDir, '..');
  const dataDir = join(repoRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, 'us-inflation.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.error(`[fetch-us-inflation] 저장 완료 → ${outPath}`);
}

main().catch((err) => {
  console.error(`[fetch-us-inflation] 실패: ${err.message}`);
  process.exit(1);
});

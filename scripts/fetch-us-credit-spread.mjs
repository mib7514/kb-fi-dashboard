// fetch-us-credit-spread.mjs — 미국 크레딧 스프레드(CS 모듈) FRED 수집 층.
//   BAML(ICE BofA) OAS 7종 + 파생 스프레드 4종 → data/us-credit-spread.json
//
// 설계 원칙(기존 fetch-us-inflation.mjs / fetch-energy-nowcast.mjs와 동일):
//  - Node 내장 fetch만(외부 의존 0). 파일에 wall-clock 타임스탬프 금지(diff-없으면-skip).
//    → meta.updated_at 은 최신 관측일(YYYY-MM-DD)로 채운다(진짜 wall-clock 아님).
//  - FRED OAS 단위는 Percent → bp 변환(×100, 소수 1자리)해서 저장. 날짜 오름차순.
//  - BAML 시리즈는 2026-04부터 최근 ~3년만 제공. z 윈도 250d 고정, 표본<250이면 z=null.
//  - 산식·차트는 페이지(us-credit-spread.html)가 담당. 이 스크립트는 데이터만.
//
// 실행: NODE_EXTRA_CA_CERTS=.corp-ca.pem  (+ .env FRED_API_KEY)  node scripts/fetch-us-credit-spread.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('[us-credit-spread] FRED_API_KEY 없음'); process.exit(1); }

const START = '2020-01-01'; // BAML 3년 제한이라 실제론 ~2023-07부터. 넉넉히 요청(불필요분은 FRED가 안 줌).
const Z_WINDOW = 250;

// 핵심 시리즈 7종 (출력 키 → FRED ID, 라벨)
const CORE = {
  ig_oas:      { id: 'BAMLC0A0CM',    label: 'US IG OAS' },
  hy_oas:      { id: 'BAMLH0A0HYM2',  label: 'US High Yield OAS' },
  aaa:         { id: 'BAMLC0A1CAAA',  label: 'AAA OAS' },
  aa:          { id: 'BAMLC0A2CAA',   label: 'AA OAS' },
  a:           { id: 'BAMLC0A3CA',    label: 'Single-A OAS' },
  bbb:         { id: 'BAMLC0A4CBBB',  label: 'BBB OAS' },
  ig_15y_plus: { id: 'BAMLC8A0C15PY', label: 'US IG 15Y+ OAS' },
};

// 파생 스프레드 4종: [출력키, 라벨, 좌항 core키, 우항 core키]
const DERIVED = [
  ['hy_minus_ig',   'HY − IG',        'hy_oas',      'ig_oas'],
  ['bbb_minus_a',   'BBB − A',        'bbb',         'a'],
  ['a_minus_aa',    'A − AA',         'a',           'aa'],
  ['long_minus_all','IG 15Y+ − IG 전체', 'ig_15y_plus', 'ig_oas'],
];

async function fredObs(id) {
  const u = new URL('https://api.stlouisfed.org/fred/series/observations');
  u.searchParams.set('series_id', id); u.searchParams.set('api_key', KEY);
  u.searchParams.set('file_type', 'json'); u.searchParams.set('observation_start', START);
  const r = await fetch(u, { headers: { 'User-Agent': 'fi-dashboard/us-credit-spread' } });
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  const j = await r.json();
  const obs = (j.observations || [])
    .filter((o) => o.value !== '.' && o.value !== '' && o.value != null)
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!obs.length) throw new Error(`FRED ${id}: 유효 관측치 0`);
  return obs;
}

// Percent → bp, 소수 1자리
const toBp = (pct) => Math.round(pct * 100 * 10) / 10;

// 트레일링 250 표본 z-score. 표본<Z_WINDOW 이면 null. vals = 시계열 값 배열(정렬됨).
function zLatest(vals) {
  if (vals.length < Z_WINDOW) return null;
  const win = vals.slice(vals.length - Z_WINDOW);
  const mean = win.reduce((s, v) => s + v, 0) / win.length;
  const varc = win.reduce((s, v) => s + (v - mean) ** 2, 0) / win.length;
  const sd = Math.sqrt(varc);
  if (!(sd > 0)) return null;
  return Math.round(((vals[vals.length - 1] - mean) / sd) * 100) / 100;
}

async function main() {
  console.error(`[us-credit-spread] FRED 조회 (start=${START}, z윈도=${Z_WINDOW})…`);

  // 핵심 시리즈 병렬 조회 → bp 변환한 [date,bp] 배열 + date→bp 맵
  const coreKeys = Object.keys(CORE);
  const rawList = await Promise.all(coreKeys.map((k) => fredObs(CORE[k].id)));
  const core = {};       // key → { label, data:[[date,bp]], maps }
  for (let i = 0; i < coreKeys.length; i++) {
    const k = coreKeys[i];
    const data = rawList[i].map((o) => [o.date, toBp(o.value)]);
    const map = new Map(data);
    core[k] = { label: CORE[k].label, id: CORE[k].id, data, map };
  }

  // series 블록
  const series = {};
  for (const k of coreKeys) {
    const c = core[k];
    series[k] = {
      label: c.label,
      unit: 'bp',
      data: c.data,
      z250_latest: zLatest(c.data.map((d) => d[1])),
    };
  }

  // derived 블록 — 두 시리즈 공통 날짜에서만 좌−우 계산
  const derived = {};
  for (const [key, label, lk, rk] of DERIVED) {
    const left = core[lk], right = core[rk];
    const dates = left.data.map((d) => d[0]).filter((d) => right.map.has(d));
    const data = dates.map((d) => [d, Math.round((left.map.get(d) - right.map.get(d)) * 10) / 10]);
    derived[key] = {
      label,
      unit: 'bp',
      data,
      z250_latest: zLatest(data.map((d) => d[1])),
    };
  }

  // updated_at = 최신 관측일(wall-clock 아님). 전 시리즈 최신일의 최댓값.
  const latestDate = coreKeys
    .map((k) => core[k].data[core[k].data.length - 1][0])
    .sort()
    .pop();

  const out = {
    meta: {
      updated_at: latestDate,
      source: 'FRED (ICE BofA / BAML OAS)',
      series_ids: coreKeys.map((k) => CORE[k].id),
      z_window: Z_WINDOW,
      history_note: 'FRED BAML series limited to ~3yr from 2026-04. z윈도 250d 고정, 표본<250이면 z=null.',
    },
    series,
    derived,
  };

  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, 'us-credit-spread.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const ig = series.ig_oas, hy = series.hy_oas;
  console.error(`[us-credit-spread] IG ${ig.data.at(-1)[1]}bp(z=${ig.z250_latest}) `
    + `HY ${hy.data.at(-1)[1]}bp(z=${hy.z250_latest}) 최신=${latestDate} `
    + `점수=${ig.data.length}일 → ${outPath}`);
}

main().catch((e) => { console.error(`[us-credit-spread] 실패: ${e.message}`); process.exit(1); });

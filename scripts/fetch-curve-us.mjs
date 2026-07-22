// fetch-curve-us.mjs — CP 미국 국채 커브(DGS2/5/10·EFFR) + ACM 텀프리미엄 적재
//   → data/curve/us_yields.json, us_tp.json.  US 는 참고·식별용(변수2/3 순수 분리에 사용).
//
// 설계 원칙(fetch-us-credit-spread.mjs 등과 동일):
//   · Node 내장 fetch만. wall-clock 금지 → meta.updated_at = 최신 관측일(vintage), diff-skip 정확.
//   · 매 실행 전 구간 재적재(증분 append 아님) — FRED 최근값 사후정정 대비, gapless·idempotent.
//
// 실행(로컬):  NODE_EXTRA_CA_CERTS=.corp-ca.pem node scripts/fetch-curve-us.mjs   (.env FRED_API_KEY)
// 실행(CI):    node scripts/fetch-curve-us.mjs   (secrets.FRED_API_KEY)

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { US_TENORS, US_POLICY, US_TP, US_START } from './curve-config.mjs';

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('[fetch-curve-us] FRED_API_KEY 없음'); process.exit(1); }

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data', 'curve');
const round3 = (x) => Math.round(x * 1000) / 1000;

async function fredObs(id) {
  const u = new URL('https://api.stlouisfed.org/fred/series/observations');
  u.searchParams.set('series_id', id); u.searchParams.set('api_key', KEY);
  u.searchParams.set('file_type', 'json'); u.searchParams.set('observation_start', US_START);
  const r = await fetch(u, { headers: { 'User-Agent': 'fi-dashboard/curve-us' } });
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

// 날짜 그리드 = gridKeys 계열 날짜의 합집합(국채 거래일). 각 행에 valueKeys 값을 붙임(결측 null).
//   ※ 정책금리(DFF)는 주말·공휴일에도 값이 있어 그리드에 넣으면 비거래일이 섞인다 → 그리드는 국채(DGS)만.
function buildRows(maps, gridKeys, valueKeys) {
  const all = new Set();
  for (const k of gridKeys) for (const d of maps[k].keys()) all.add(d);
  const dates = [...all].sort();
  return dates.map((d) => {
    const row = { date: d };
    for (const k of valueKeys) row[k] = maps[k].has(d) ? round3(maps[k].get(d)) : null;
    return row;
  });
}

async function main() {
  const tenorKeys = Object.keys(US_TENORS); // dgs2/dgs5/dgs10
  const [tenorRaw, effrRaw, dffRaw] = await Promise.all([
    Promise.all(tenorKeys.map((k) => fredObs(US_TENORS[k].id))),
    fredObs(US_POLICY.primary),  // EFFR (2000-07~)
    fredObs(US_POLICY.backfill), // DFF (1954~)
  ]);
  const maps = {};
  tenorKeys.forEach((k, i) => { maps[k] = new Map(tenorRaw[i].map((o) => [o.date, o.value])); });
  // 정책금리 splice: DFF 를 깐 뒤 EFFR 로 덮어씀(EFFR 우선).
  maps.effr = new Map(dffRaw.map((o) => [o.date, o.value]));
  for (const o of effrRaw) maps.effr.set(o.date, o.value);

  const yKeys = [...tenorKeys, 'effr'];
  // 그리드는 국채 거래일(dgs*)만. effr 은 그 날짜에 lookup(DFF back-stitch 로 거래일엔 항상 존재).
  const yieldRows = buildRows(maps, tenorKeys, yKeys);
  const tp = await fredObs(US_TP.id);
  const tpRows = tp.map((o) => ({ date: o.date, tp10: round3(o.value) }));
  if (yieldRows.length === 0 || tpRows.length === 0) {
    throw new Error(`산출 0행 — yields=${yieldRows.length} tp=${tpRows.length}. FRED 입력 확인.`);
  }

  const nullPct = {};
  for (const k of yKeys) {
    const n = yieldRows.filter((r) => r[k] == null).length;
    nullPct[k] = Math.round((n / yieldRows.length) * 1000) / 10;
  }

  const yLatest = yieldRows[yieldRows.length - 1].date;
  const tpLatest = tpRows[tpRows.length - 1].date;

  const yieldsOut = {
    meta: {
      module: 'CP',
      updated_at: yLatest,
      source: 'FRED',
      unit: 'percent',
      series: {
        ...Object.fromEntries(tenorKeys.map((k) => [k, `${US_TENORS[k].id} (${US_TENORS[k].label})`])),
        effr: `${US_POLICY.primary}↔${US_POLICY.backfill} (${US_POLICY.label})`,
      },
      note: 'US Treasury CMT(DGS*) + 정책금리. 참고·식별용. '
        + 'effr = EFFR(2000-07~) 우선, 이전은 DFF back-stitch(seam<2bp). updated_at 은 최신 관측일(vintage).',
    },
    data: yieldRows,
  };
  const tpOut = {
    meta: {
      module: 'CP',
      updated_at: tpLatest,
      source: 'FRED (NY Fed ACM)',
      unit: 'percent',
      series: { tp10: `${US_TP.id} (${US_TP.label})` },
      note: 'ACM 10Y term premium. 변수3(TP) 직접 관측. 장단기 분해는 모델 추정치임. '
        + 'updated_at 은 최신 관측일(vintage).',
    },
    data: tpRows,
  };

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'us_yields.json'), `${JSON.stringify(yieldsOut, null, 2)}\n`, 'utf8');
  writeFileSync(join(dataDir, 'us_tp.json'), `${JSON.stringify(tpOut, null, 2)}\n`, 'utf8');

  const last = yieldRows[yieldRows.length - 1];
  console.error(
    `us_yields.json  ${yieldRows.length}행 (${yieldRows[0].date}~${yLatest})  `
    + `null%: ${yKeys.map((k) => `${k}=${nullPct[k]}`).join(' ')}\n`
    + `  최신: 2Y=${last.dgs2} 5Y=${last.dgs5} 10Y=${last.dgs10} EFFR=${last.effr}\n`
    + `us_tp.json  ${tpRows.length}행 (${tpRows[0].date}~${tpLatest})  최신 TP10=${tpRows.at(-1).tp10}`,
  );
}

main().catch((e) => { console.error(`fetch-curve-us 실패: ${e.message}`); process.exit(1); });

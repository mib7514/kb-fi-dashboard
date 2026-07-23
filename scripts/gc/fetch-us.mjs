// scripts/gc/fetch-us.mjs — GC US 국채 금리(FRED DGS3/DGS10/DGS30) → data/gc/us.json (불변 append).
//   측정 레이어(원금리만). 스프레드·z·Δ 는 클라이언트(GC-2).
//
// 설계(fetch-curve-us.mjs 등과 동일): Node 내장 fetch만. 결측일('.') 스킵, 보간 금지.
//   불변 append — 최초 5년 backfill, 이후 마지막 날짜 이후만 추가(gc-io.mergeAppend).
//
// 실행(로컬):  NODE_EXTRA_CA_CERTS=.corp-ca.pem node scripts/gc/fetch-us.mjs   (.env FRED_API_KEY)
// 실행(CI):    node scripts/gc/fetch-us.mjs   (secrets.FRED_API_KEY)
//   window override(검증용):  GC_SDATE=2026-06-01 GC_EDATE=2026-07-24 ...

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { US_SERIES, YIELD_KEYS, SERIES_LABELS, unionRows, defaultBackfillStartISO } from './gc-config.mjs';
import { loadExisting, mergeAppend, writeJson } from './gc-io.mjs';

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('[gc/fetch-us] FRED_API_KEY 없음'); process.exit(1); }

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = process.env.GC_OUT || join(repoRoot, 'data', 'gc', 'us.json');

async function fredObs(id, start, end) {
  const u = new URL('https://api.stlouisfed.org/fred/series/observations');
  u.searchParams.set('series_id', id); u.searchParams.set('api_key', KEY);
  u.searchParams.set('file_type', 'json'); u.searchParams.set('observation_start', start);
  if (end) u.searchParams.set('observation_end', end);
  const r = await fetch(u, { headers: { 'User-Agent': 'fi-dashboard/gc-us' } });
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  const j = await r.json();
  return (j.observations || [])
    .filter((o) => o.value !== '.' && o.value !== '' && o.value != null)
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function main() {
  const existing = loadExisting(outPath);
  // backfill 시작: 기존 파일 있으면 그 시작을 유지(전 구간 요청 후 append 필터가 증분만 남김).
  const start = process.env.GC_SDATE || existing?.meta?.backfill_start || defaultBackfillStartISO();
  const end = process.env.GC_EDATE || undefined;

  const raw = await Promise.all(YIELD_KEYS.map((k) => fredObs(US_SERIES[k], start, end)));
  const maps = {};
  YIELD_KEYS.forEach((k, i) => { maps[k] = new Map(raw[i].map((o) => [o.date, o.value])); });
  const fresh = unionRows(maps, YIELD_KEYS); // FRED date 는 이미 ISO

  const merged = mergeAppend(existing, fresh, { source: 'FRED', series: SERIES_LABELS });
  writeJson(outPath, merged);

  const last = merged.rows[merged.rows.length - 1];
  console.error(
    `us.json  ${merged.rows.length}행 (${merged.rows[0].d}~${last.d})  +${merged._added} append  backfill_start=${merged.meta.backfill_start}\n`
    + `  최신: 3Y=${last.y3} 10Y=${last.y10} 30Y=${last.y30}`,
  );
}

main().catch((e) => { console.error(`gc/fetch-us 실패: ${e.message}`); process.exit(1); });

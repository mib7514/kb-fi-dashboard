// scripts/gc/fetch-kr.mjs — GC KR 국고채 금리(ECOS 817Y002 3Y/10Y/30Y) → data/gc/kr.json (불변 append).
//   측정 레이어(원금리만). 스프레드·z·Δ 는 클라이언트(GC-2).
//
// 설계(fetch-curve-kr.mjs 등과 동일): ecos.mjs 얇은 클라이언트만. 결측 만기 null, 보간 금지.
//   불변 append — 최초 5년 backfill, 이후 마지막 날짜 이후만 추가.
//
// 실행(CI):     ECOS_API_KEY=<정식키> node scripts/gc/fetch-kr.mjs   (secrets.ECOS_API_KEY — 이미 gg1/curve 워크플로가 사용 중)
// 실행(로컬 검증): 사무실 PC 외부 ECOS 정식키 금지 → sample 키 스모크만.
//   NODE_TLS_REJECT_UNAUTHORIZED=0 ECOS_PAGE_SIZE=10 ECOS_API_KEY=sample GC_SDATE=20260701 GC_OUT=/tmp/kr.json node scripts/gc/fetch-kr.mjs
//   전 구간 backfill 은 CI(정식키)에서 수행(fetch-curve-kr 선례 동일).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSeriesPaged } from '../lib/ecos.mjs';
import { KR_TENORS, KR_CYCLE, YIELD_KEYS, SERIES_LABELS, unionRows, isoFromCompact, compactFromIso, defaultBackfillStartISO } from './gc-config.mjs';
import { loadExisting, mergeAppend, writeJson } from './gc-io.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = process.env.GC_OUT || join(repoRoot, 'data', 'gc', 'kr.json');
const pageSize = Number(process.env.ECOS_PAGE_SIZE) || 100000; // sample 키는 10

async function main() {
  const existing = loadExisting(outPath);
  // ECOS 는 YYYYMMDD. 기존 backfill_start(ISO) 유지, 최초엔 5년 전.
  const startIso = existing?.meta?.backfill_start || defaultBackfillStartISO();
  const sdate = process.env.GC_SDATE || compactFromIso(startIso);
  const edate = process.env.GC_EDATE || `${new Date().getFullYear()}1231`;

  const raw = await Promise.all(
    YIELD_KEYS.map((k) => fetchSeriesPaged({ ...KR_TENORS[k], cycle: KR_CYCLE, sdate, edate }, pageSize)),
  );
  const maps = {};
  YIELD_KEYS.forEach((k, i) => { maps[k] = new Map(raw[i].map((r) => [r.time, r.value])); });
  const fresh = unionRows(maps, YIELD_KEYS, isoFromCompact);

  const merged = mergeAppend(existing, fresh, { source: 'ECOS', series: SERIES_LABELS });
  writeJson(outPath, merged);

  const last = merged.rows[merged.rows.length - 1];
  const nullPct = {};
  for (const k of YIELD_KEYS) {
    const n = merged.rows.filter((r) => r[k] == null).length;
    nullPct[k] = Math.round((n / merged.rows.length) * 1000) / 10;
  }
  console.error(
    `kr.json  ${merged.rows.length}행 (${merged.rows[0].d}~${last.d})  +${merged._added} append  backfill_start=${merged.meta.backfill_start}\n`
    + `  null%: ${YIELD_KEYS.map((k) => `${k}=${nullPct[k]}`).join(' ')}\n`
    + `  최신: 3Y=${last.y3} 10Y=${last.y10} 30Y=${last.y30}`,
  );
}

main().catch((e) => { console.error(`gc/fetch-kr 실패: ${e.message}`); process.exit(1); });

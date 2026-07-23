// scripts/gc/fetch-jp.mjs — GC JP 국채 금리(재무성 MOF jgbcm CSV 3Y/10Y/30Y) → data/gc/jp.json (불변 append).
//   측정 레이어(원금리만). 스프레드·z·Δ 는 클라이언트(GC-2).
//
// 설계: Node 내장 fetch만. Shift-JIS 디코딩(TextDecoder) + 연호 날짜 파싱(gc-jp.parseJgbCsv).
//   MOF 는 파일 2개로 나뉜다:
//     · data/jgbcm_all.csv = 과거 전체(1974~), 갱신 주기 김(당월 미포함 가능).
//     · jgbcm.csv          = 당월(최신). 두 파일 union 으로 최신일까지 커버.
//   불변 append — 최초 5년 backfill, 이후 마지막 날짜 이후만 추가. 결측('-') null, 보간 금지.
//
// 실행(로컬/CI):  NODE_EXTRA_CA_CERTS=.corp-ca.pem node scripts/gc/fetch-jp.mjs   (인증 불필요, 공개 CSV)
//   window override(검증용):  GC_SDATE=2021-07-01 GC_OUT=/tmp/jp.json ...

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SERIES_LABELS, defaultBackfillStartISO } from './gc-config.mjs';
import { loadExisting, mergeAppend, writeJson } from './gc-io.mjs';
import { parseJgbCsv } from './gc-jp.mjs';

const ALL_URL = process.env.GC_JP_ALL_URL || 'https://www.mof.go.jp/jgbs/reference/interest_rate/data/jgbcm_all.csv';
const CUR_URL = process.env.GC_JP_CUR_URL || 'https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = process.env.GC_OUT || join(repoRoot, 'data', 'gc', 'jp.json');

async function fetchCsvRows(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'fi-dashboard/gc-jp' } });
  if (!r.ok) throw new Error(`MOF ${url} HTTP ${r.status}`);
  const text = new TextDecoder('shift_jis').decode(new Uint8Array(await r.arrayBuffer()));
  return parseJgbCsv(text);
}

async function main() {
  const existing = loadExisting(outPath);
  const startIso = process.env.GC_SDATE || existing?.meta?.backfill_start || defaultBackfillStartISO();

  // 두 파일 union(당월 파일이 최신일 보강). 같은 날짜는 당월 파일 값으로 덮되 통상 동일.
  const [allRows, curRows] = await Promise.all([fetchCsvRows(ALL_URL), fetchCsvRows(CUR_URL)]);
  const byDate = new Map();
  for (const r of allRows) byDate.set(r.d, r);
  for (const r of curRows) byDate.set(r.d, r);
  const fresh = [...byDate.values()]
    .filter((r) => r.d >= startIso)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  const merged = mergeAppend(existing, fresh, { source: 'MOF', series: SERIES_LABELS });
  writeJson(outPath, merged);

  const last = merged.rows[merged.rows.length - 1];
  const nullPct = {};
  for (const k of ['y3', 'y10', 'y30']) {
    const n = merged.rows.filter((r) => r[k] == null).length;
    nullPct[k] = Math.round((n / merged.rows.length) * 1000) / 10;
  }
  console.error(
    `jp.json  ${merged.rows.length}행 (${merged.rows[0].d}~${last.d})  +${merged._added} append  backfill_start=${merged.meta.backfill_start}\n`
    + `  null%: ${Object.entries(nullPct).map(([k, v]) => `${k}=${v}`).join(' ')}\n`
    + `  최신: 3Y=${last.y3} 10Y=${last.y10} 30Y=${last.y30}`,
  );
}

main().catch((e) => { console.error(`gc/fetch-jp 실패: ${e.message}`); process.exit(1); });

// fetch-curve-kr.mjs — CP 국고채 커브 + 기준금리 적재 → data/curve/kr_yields.json, kr_base_rate.json
//   측정 레이어(원자료만). percentile·z·분해·판정은 페이지(js/curve-phase/*) 소관.
//
// 설계 원칙(gg1/us-credit-spread 등 기존 fetch 층과 동일):
//   · Node 내장 fetch만(외부 의존 0). 파일에 wall-clock 금지 → meta.updated_at = 최신 관측일(vintage).
//     데이터 불변 시 파일 byte-불변 → 워크플로 diff-skip 정확.
//   · 증분(append) 아님, 매 실행 전 구간 재적재 후 통째 재작성. 이유: ECOS 는 최근값을 사후 정정하므로
//     append-only 는 first-print 를 고정해 편의가 남는다. 재적재는 gapless·idempotent(gg1/credit 관례 동일).
//
// 실행(CI):  ECOS_API_KEY=<정식키> node scripts/fetch-curve-kr.mjs
//   로컬은 사무실 PC 외부키 금지 원칙 → KR 은 CI(workflow_dispatch)에서만 검증. (US 는 로컬 FRED 가능.)

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSeriesPaged } from './lib/ecos.mjs';
import { KR_TENORS, KR_BASE, KR_CYCLE, KR_UNIT, KR_START } from './curve-config.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data', 'curve');
const pageSize = Number(process.env.ECOS_PAGE_SIZE) || 100000; // 로컬 sample 키 검증 시 10

const round3 = (x) => Math.round(x * 1000) / 1000;
const isoDate = (t) => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`; // YYYYMMDD → YYYY-MM-DD

// 여러 계열을 날짜 합집합으로 병합 → [{date, k1, k2, ...}] (결측 만기는 null).
function unionRows(maps, keys) {
  const all = new Set();
  for (const k of keys) for (const d of maps[k].keys()) all.add(d);
  const dates = [...all].sort();
  return dates.map((t) => {
    const row = { date: isoDate(t) };
    for (const k of keys) row[k] = maps[k].has(t) ? round3(maps[k].get(t)) : null;
    return row;
  });
}

async function main() {
  const curYear = new Date().getFullYear();
  const edate = `${curYear}1231`;
  const tenorKeys = Object.keys(KR_TENORS);

  // 만기 5종 + 기준금리 병렬 적재.
  const tenorSeries = await Promise.all(
    tenorKeys.map((k) => fetchSeriesPaged({ ...KR_TENORS[k], cycle: KR_CYCLE, sdate: KR_START, edate }, pageSize)),
  );
  const base = await fetchSeriesPaged({ ...KR_BASE, cycle: KR_CYCLE, sdate: KR_START, edate }, pageSize);

  const maps = {};
  tenorKeys.forEach((k, i) => { maps[k] = new Map(tenorSeries[i].map((r) => [r.time, r.value])); });

  const yieldRows = unionRows(maps, tenorKeys);
  const baseRows = base.map((r) => ({ date: isoDate(r.time), rate: round3(r.value) }));
  if (yieldRows.length === 0 || baseRows.length === 0) {
    throw new Error(`산출 0행 — yields=${yieldRows.length} base=${baseRows.length}. ECOS 입력 확인.`);
  }

  // 만기별 null 비율(30Y 는 2012-09 이전 null 정상) — CI 로그·게이트 보고용.
  const nullPct = {};
  for (const k of tenorKeys) {
    const n = yieldRows.filter((r) => r[k] == null).length;
    nullPct[k] = Math.round((n / yieldRows.length) * 1000) / 10;
  }

  const yLatest = yieldRows[yieldRows.length - 1].date;
  const bLatest = baseRows[baseRows.length - 1].date;

  const yieldsOut = {
    meta: {
      module: 'CP',
      updated_at: yLatest, // vintage 파생(파일 불변성)
      source: 'ECOS',
      cycle: KR_CYCLE,
      unit: KR_UNIT,
      series: Object.fromEntries(tenorKeys.map((k) => [k, `${KR_TENORS[k].stat}/${KR_TENORS[k].item} (${KR_TENORS[k].label})`])),
      note: '국고채 시장금리(817Y002). 30Y 는 2012-09-11 발행개시 이전 null. '
        + 'updated_at 은 wall-clock 아닌 최신 관측일(vintage).',
    },
    data: yieldRows,
  };
  const baseOut = {
    meta: {
      module: 'CP',
      updated_at: bLatest,
      source: 'ECOS',
      cycle: KR_CYCLE,
      unit: KR_UNIT,
      series: { rate: `${KR_BASE.stat}/${KR_BASE.item} (${KR_BASE.label})` },
      note: '한국은행 기준금리. 2008-03 이전은 콜금리목표제(7일물 RP 기준금리는 2008-03 도입) — '
        + 'ECOS back-stitch 로 1999~ 연속 제공. percentile 계산엔 전 기간 포함. '
        + 'updated_at 은 최신 관측일(vintage).',
    },
    data: baseRows,
  };

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'kr_yields.json'), `${JSON.stringify(yieldsOut, null, 2)}\n`, 'utf8');
  writeFileSync(join(dataDir, 'kr_base_rate.json'), `${JSON.stringify(baseOut, null, 2)}\n`, 'utf8');

  const last = yieldRows[yieldRows.length - 1];
  console.error(
    `kr_yields.json  ${yieldRows.length}행 (${yieldRows[0].date}~${yLatest})  `
    + `null%: ${tenorKeys.map((k) => `${k}=${nullPct[k]}`).join(' ')}\n`
    + `  최신 커브: 1Y=${last.y1} 3Y=${last.y3} 5Y=${last.y5} 10Y=${last.y10} 30Y=${last.y30}\n`
    + `kr_base_rate.json  ${baseRows.length}행 (${baseRows[0].date}~${bLatest})  최신=${baseRows.at(-1).rate}%`,
  );
}

main().catch((e) => { console.error(`fetch-curve-kr 실패: ${e.message}`); process.exit(1); });

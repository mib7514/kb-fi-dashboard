// update-scorecard.mjs — 예측 성적표(data/us-inflation-scorecard.json) 스냅샷 갱신·동결.
//   매 실행: 다음 발표월 예측 "현재값"을 라이브 행에 기록. 실측 편입 순간 그 직전 스냅샷을
//   동결(frozen)하고 발표 후 예측 수정 금지. 수동 컬럼(sealed/consensus/cleveland)은 동결 시
//   존재분만 정규(late=false), 동결 후 추가분은 late=true.
//
// 입력: data/us-inflation.json(헤드라인·코어), data/us-energy-nowcast.json(에너지·식품·휘발유).
// 산출: 파일에 wall-clock 타임스탬프 금지 — asof는 데이터 파생(last_actual)만.
//
// 실행: node scripts/update-scorecard.mjs   (fetch-*.mjs 뒤에, 키 불필요 — 이미 적재된 data만 읽음)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { comparePeriods } from '../js/calc.js';
import {
  computeLivePrediction, actualYoY, mmToYoY, scoreRow, PREDICTION_COLUMNS,
} from '../js/us-inflation-scorecard.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const readJSON = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

const MANUAL = ['sealed', 'consensus', 'cleveland'];
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function main() {
  const card = readJSON('us-inflation-scorecard.json');
  const us = readJSON('us-inflation.json');
  const ncIn = readJSON('us-energy-nowcast.json');

  const headlineData = us.series['us-cpi-headline'].data;
  const inputs = {
    headlineData,
    coreData: us.series['us-cpi-core'].data,
    energyData: ncIn.series['us-cpi-energy'].data,
    foodData: ncIn.series['us-cpi-food'].data,
    gasData: ncIn.series['us-gasoline-monthly'].data.map((p) => ({ period: p.period, value: p.value })),
  };
  const lastActual = headlineData[headlineData.length - 1].period;

  const byMonth = new Map(card.rows.map((r) => [r.month, r]));

  // ── 1) 실측 편입 + 동결: actual 없는 행 중 이제 실측 가능한 것 채우고 frozen ──
  for (const row of card.rows) {
    if (row.actual?.yoy != null) { // 이미 실측 보유(시드 포함) — 동결 보장 + late 판정만.
      finalizeFrozen(row);
      continue;
    }
    const ay = actualYoY(row.month, headlineData);
    if (ay != null) {
      row.actual = { yoy: r2(ay), mm: r3(headlineMoM(row.month, headlineData)) };
      row.frozen = true;
      // 동결 시점 수동 컬럼 존재 스냅샷(late 기준선).
      row.frozen_manual = row.frozen_manual || {};
      for (const k of MANUAL) row.frozen_manual[k] = row[k]?.yoy != null;
      finalizeFrozen(row);
    }
  }

  // ── 2) 라이브 예측: 다음 발표월(=lastActual+1) 행 갱신/생성 (frozen 아니면만 예측 덮어씀) ──
  const live = computeLivePrediction(inputs);
  if (live) {
    let row = byMonth.get(live.month);
    if (!row) {
      row = { month: live.month, frozen: false };
      card.rows.push(row); byMonth.set(live.month, row);
    }
    if (!row.frozen) {
      row.seasonal = live.seasonal;   // ① 갱신(롤링 스냅샷)
      row.combined = live.combined;   // ② 갱신
      // 수동 컬럼·actual·miss_reason은 보존(사용자 편집분).
      for (const k of MANUAL) if (!(k in row)) row[k] = { yoy: null };
      if (!('actual' in row)) row.actual = { yoy: null, mm: null };
      if (!('miss_reason' in row)) row.miss_reason = null;
      row.errors = scoreRow(row); // actual 없으면 전부 null
    }
  }

  // ── 3) 정렬 + 메타 ──
  card.rows.sort((a, b) => comparePeriods(a.month, b.month));
  card.meta.last_actual = lastActual;

  writeFileSync(join(DATA, 'us-inflation-scorecard.json'), JSON.stringify(card, null, 2) + '\n', 'utf8');

  const frozenN = card.rows.filter((r) => r.frozen).length;
  const liveRow = card.rows.find((r) => !r.frozen);
  console.error(`[scorecard] 행 ${card.rows.length}개(동결 ${frozenN}) · last_actual ${lastActual}`
    + (liveRow ? ` · 라이브 ${liveRow.month}: 시즈널 ${fmt(liveRow.seasonal?.yoy)} / 결합 ${fmt(liveRow.combined?.yoy)}` : ''));

  // ── 4) 동결 후 추가된 수동입력 late 판정 (frozen_manual 기준선 대비) ──
  function finalizeFrozen(row) {
    if (!row.frozen) return;
    row.frozen_manual = row.frozen_manual || {};
    for (const k of MANUAL) {
      const present = row[k]?.yoy != null;
      if (row.frozen_manual[k] === undefined) row.frozen_manual[k] = present; // 최초 동결분
      if (row[k]) row[k].late = present && !row.frozen_manual[k]; // 기준선에 없던 값 → late
    }
    // retro.yoy 보완(정보용, 집계 제외).
    if (row.combined?.retro && row.combined.retro.yoy == null && row.combined.retro.mm != null) {
      row.combined.retro.yoy = r2(mmToYoY(row.month, row.combined.retro.mm, headlineData));
    }
    row.errors = scoreRow(row);
  }
}

// 실측 m/m (period 인덱스/전월 인덱스). 없으면 null.
function headlineMoM(month, data) {
  const idx = new Map(data.map((p) => [p.period, p.value]));
  const [y, m] = month.split('-').map(Number);
  const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const cur = idx.get(month), prev = idx.get(pm);
  return (cur == null || prev == null || prev === 0) ? null : (cur / prev - 1) * 100;
}
function fmt(x) { return x == null ? 'n/a' : x.toFixed(2); }

main();

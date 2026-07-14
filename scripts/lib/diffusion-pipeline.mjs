// diffusion-pipeline.mjs — 국가 공통 확산 파이프라인.
//   스냅샷 시계열 → 누적 history 확산 레코드(buildRecord) → 출력 payload/파일.
// US·EU·AU·KR fetch 스크립트가 공유 (단일 구현 → 국가 간 방법론 드리프트 방지).
// buildRecord/z-score/flash 방법론은 diffusion-core.mjs (Fenrir 이식본) 기준.

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildRecord } from './diffusion-core.mjs';

export const BACKFILL_MONTHS = 60;        // 5y + 1y z-score warmup (Fenrir DEFAULT_BACKFILL_MONTHS)
export const DETAIL_MONTHS = 6;           // 최근 N개월만 품목별 상세 (파일 경량화)
export const DETAIL_SIZE_LIMIT = 500 * 1024;  // 500KB — 초과 시 임의 축소 대신 중단

export function* monthsBetween(start, end) {
  let y = parseInt(start.slice(0, 4), 10), m = parseInt(start.slice(5, 7), 10);
  const endY = parseInt(end.slice(0, 4), 10), endM = parseInt(end.slice(5, 7), 10);
  while (y < endY || (y === endY && m <= endM)) {
    yield `${y}-${String(m).padStart(2, '0')}`;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

// 백필 윈도우: 종료 = 이전 달력월(D-1 month), 시작 = 종료 − (months−1).
// Fenrir backfill/route.ts computeWindow와 동일.
export function computeWindow(now, months = BACKFILL_MONTHS) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
}

const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const r3 = (x) => (x == null ? null : Math.round(x * 1e3) / 1e3);

// 스냅샷 배열 → {payload:{meta,series,detail}, stats}. 시간순 누적 history로 z-score.
// Fenrir backfillCountry의 accumulatedHistory 방식과 1:1.
export function buildCountryPayload(snapshots, meta) {
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  const accumulated = [];
  const records = [];
  let flashSkipped = 0;
  for (const snap of sorted) {
    const rec = buildRecord(snap, accumulated);
    if (rec === null) { flashSkipped++; continue; }
    accumulated.push(rec.diffusion);
    records.push({ record: rec, snapshot: snap });
  }

  const series = records.map(({ record }) => ({
    period: record.period,
    headline_yoy: r3(record.headline_yoy),
    core_yoy: r3(record.core_yoy),
    core_yoy_intl: r3(record.core_yoy_intl),
    weighted: {
      ge0: r4(record.diffusion.weighted.ge0), ge2: r4(record.diffusion.weighted.ge2),
      ge25: r4(record.diffusion.weighted.ge25), ge3: r4(record.diffusion.weighted.ge3),
    },
    unweighted: {
      ge0: r4(record.diffusion.unweighted.ge0), ge2: r4(record.diffusion.unweighted.ge2),
      ge25: r4(record.diffusion.unweighted.ge25), ge3: r4(record.diffusion.unweighted.ge3),
    },
    z: {
      ge0: r4(record.z_scores_5y.weighted.ge0), ge2: r4(record.z_scores_5y.weighted.ge2),
      ge25: r4(record.z_scores_5y.weighted.ge25), ge3: r4(record.z_scores_5y.weighted.ge3),
    },
  }));

  const detail = records.slice(-DETAIL_MONTHS).map(({ record, snapshot }) => ({
    period: record.period,
    items: snapshot.items
      .filter((i) => i.yoy != null)
      .map((i) => ({ code: i.code, name: i.name, weight: i.weight, yoy: r3(i.yoy) })),
  }));

  const last = records[records.length - 1]?.record;
  return {
    payload: {
      meta: {
        ...meta,
        last_updated: last?.period ?? null,
        item_count: last?.item_count ?? 0,
        weight_coverage: last ? r4(last.weight_coverage) : null,
        flash_skipped: flashSkipped,
      },
      series,
      detail,
    },
    stats: { periods: series.length, flashSkipped, latest: last?.period ?? null,
      earliest: records[0]?.record.period ?? null },
  };
}

// 자기등록 JS 한 블록. globalName으로 실데이터(FENRIR_SERIES)/픽스처(FENRIR_FIXTURE) 분리.
export function serializeRegistration(key, payload, globalName = 'FENRIR_SERIES') {
  return `window.${globalName} = window.${globalName} || {};\n` +
    `window.${globalName}[${JSON.stringify(key)}] = ${JSON.stringify(payload)};\n`;
}

// entries: [{key, payload}]. banner + 각 등록 직렬화 → 500KB 가드 → 파일 기록.
// 초과 시 임의 축소 없이 throw (호출자가 중단·보고). 반환 {bytes, path}.
export function writeDataFile({ dataDir, fileName, banner, entries, sizeLimit = DETAIL_SIZE_LIMIT, logTag = 'diffusion' }) {
  let body = banner;
  for (const e of entries) body += serializeRegistration(e.key, e.payload);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > sizeLimit) {
    throw new Error(
      `[${logTag}] ⛔ 파일 ${(bytes / 1024).toFixed(1)}KB > ${sizeLimit / 1024}KB 초과. 임의 축소하지 않고 중단.\n` +
      `  제안: 상단 DETAIL_MONTHS(현재 ${DETAIL_MONTHS})를 3으로 줄이면 대략 절반으로 감소. 승인 후 재실행.`);
  }
  mkdirSync(dataDir, { recursive: true });
  const path = `${dataDir}/${fileName}`;
  writeFileSync(path, body, 'utf8');
  return { bytes, path };
}

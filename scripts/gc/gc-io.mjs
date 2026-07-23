// gc-io.mjs — GC 저장 레이어: 불변 append 병합 + JSON 입출력.
//   불변 append 규약(명령서 §4): 기존 마지막 날짜 이후의 행만 추가. 중복일 skip.
//   소스가 과거치를 사후 정정해도 덮어쓰지 않는다(first-print 고정). — 기존 CP 의 full-reload 와 반대.
//   국가별 파일 분리(us/jp/kr) — 한 소스 장애가 전체를 막지 않도록.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 기존 파일 로드(없거나 파싱 실패 시 null → 최초 backfill 로 처리).
export function loadExisting(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// 불변 append 병합. existing: {meta,rows}|null. fresh: [{d, y3, y10, y30}] 오름차순.
//   반환 {meta:{source,series,updated,backfill_start}, rows, _added}.
//   updated = 최신 관측일(vintage) — wall-clock 아님(데이터 불변 시 파일 byte-불변 → 워크플로 diff-skip 정확,
//     기존 전 모듈 관례 동일). backfill_start = 최초 산정값 고정(기존 meta 우선).
export function mergeAppend(existing, fresh, { source, series }) {
  const prev = existing?.rows ?? [];
  const lastD = prev.length ? prev[prev.length - 1].d : null;
  const added = fresh.filter((r) => !lastD || r.d > lastD); // 마지막 날짜 이후만(중복·과거정정 무시)
  const rows = [...prev, ...added];
  if (rows.length === 0) throw new Error('산출 0행 — 소스 입력 확인.');
  return {
    meta: {
      source,
      series,
      updated: rows[rows.length - 1].d,
      backfill_start: existing?.meta?.backfill_start ?? rows[0].d,
    },
    rows,
    _added: added.length,
  };
}

// 파일 기록(_added 는 로그용 내부필드 → 파일엔 제외).
export function writeJson(path, obj) {
  const { _added, ...clean } = obj;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
}

// ⚠️ 이식본 (PORTED) — 원본: Fenrir src/lib/inflation-diffusion/fetchers/au-bridge.ts
//    기준 커밋: a242949 (mib7514/fenrir HEAD, 2026-07-14 clone)
//    수정 시 반드시 Fenrir 원본과 동시 반영 (이중 구현 드리프트 방지).
//    TS→ESM 손이식, 로직 1:1, 타입 주석만 제거.
//
// AU CPI 분기→월 브리지.
//  - 완전 월별 CPI(CPI v2.0.0)는 2025-11부터. 이전은 분기 CPI(CPI_Q)를 상수 보간
//    (각 분기 YoY를 3개월에 그대로 복제 → 계단형). 선형보간은 없는 변동을 만들어
//    배제(Cleveland Fed 관행). 부작용: AU 분산이 기계적으로 작아 z-score가 0에 가깝게 나옴.

/** ABS 분기코드 → 월말 매핑. Q1→1,2,3 / Q2→4,5,6 / Q3→7,8,9 / Q4→10,11,12 */
export const QUARTER_MONTHS = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

/** ABS가 완전 월별 CPI를 처음 발표하는 시점. 이 이전은 브리지 필요. */
export const COMPLETE_MONTHLY_FIRST_PERIOD = '2025-11';

/** "2024-Q3" → ["2024-07","2024-09"] (분기의 [시작월, 종료월]) */
export function quarterToMonthRange(quarterPeriod) {
  const m = quarterPeriod.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`Invalid quarter period: ${quarterPeriod}`);
  const year = m[1];
  const q = parseInt(m[2], 10);
  const months = QUARTER_MONTHS[q];
  return [
    `${year}-${String(months[0]).padStart(2, '0')}`,
    `${year}-${String(months[2]).padStart(2, '0')}`,
  ];
}

/** 월 Period → 소속 분기 ("2024-08" → "2024-Q3") */
export function periodToQuarter(period) {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Invalid period: ${period}`);
  const year = m[1];
  const month = parseInt(m[2], 10);
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

/** 같은 분기, 전년 ("2024-Q3" → "2023-Q3"). YoY 앵커용. */
export function priorYearQuarter(quarter) {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  return `${parseInt(m[1], 10) - 1}-Q${m[2]}`;
}

/**
 * 단일 분기 스냅샷 → 3개 월별 스냅샷(상수 보간). 분기 YoY를 3개월에 복제,
 * period를 각 월로, source_url에 브리지 표기.
 */
export function expandQuarterlyToMonthly(quarterlySnapshot, quarterPeriod) {
  const m = quarterPeriod.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`expandQuarterlyToMonthly: invalid quarter ${quarterPeriod}`);
  const year = m[1];
  const q = parseInt(m[2], 10);
  const months = QUARTER_MONTHS[q];
  return months.map((month) => ({
    ...quarterlySnapshot,
    period: `${year}-${String(month).padStart(2, '0')}`,
    source_url: quarterlySnapshot.source_url + '#bridged-from-quarterly',
  }));
}

/** target period가 분기 브리지 필요(완전 월별 이전)면 true. */
export function needsQuarterlyBridge(period) {
  return period < COMPLETE_MONTHLY_FIRST_PERIOD;
}

/**
 * [start, end] 윈도우를 분기-브리지 구간(pre-2025-11)과 월별-직접 구간(2025-11+)으로
 * 분할. 어느 한쪽은 빌 수 있음.
 */
export function splitWindow(startPeriod, endPeriod) {
  const cutover = COMPLETE_MONTHLY_FIRST_PERIOD;
  if (endPeriod < cutover) {
    return { quarterlyRange: [startPeriod, endPeriod], monthlyRange: null };
  }
  if (startPeriod >= cutover) {
    return { quarterlyRange: null, monthlyRange: [startPeriod, endPeriod] };
  }
  const cutoverYear = parseInt(cutover.slice(0, 4), 10);
  const cutoverMonth = parseInt(cutover.slice(5, 7), 10);
  const prevMonth = cutoverMonth === 1 ? 12 : cutoverMonth - 1;
  const prevYear = cutoverMonth === 1 ? cutoverYear - 1 : cutoverYear;
  const preCutoverEnd = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  return {
    quarterlyRange: [startPeriod, preCutoverEnd],
    monthlyRange: [cutover, endPeriod],
  };
}

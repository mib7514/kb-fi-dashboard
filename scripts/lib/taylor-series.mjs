// taylor-series.mjs — 원시 ECOS 시계열 → 월별 Taylor 압력 모델. 캘리브레이션·파이프라인 공용.
// 계산 코어(HP·YoY·i*·pressure)는 js/taylor-calc.js 재사용 → 재현·운영이 동일 경로.

import { cpiYoY, outputGap, pressure as pressureFn, iStar } from '../../js/taylor-calc.js';

// ── 시간 포맷 헬퍼 ──
const toMonth = (yyyymm) => `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;        // 'YYYYMM'→'YYYY-MM'
const toDate = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
export const quarterOfMonth = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return `${y}Q${Math.floor((mm - 1) / 3) + 1}`;
};

// 일별 기준금리 → 월별(해당 월 마지막 관측 = 월말/최신 정책금리). Map 'YYYY-MM'→rate.
export function monthEndBaseRate(baseDaily) {
  const m = new Map();
  for (const r of baseDaily) m.set(toMonth(r.time.slice(0, 6)), r.value); // 오름차순이라 마지막이 월말
  return m;
}

// 일별 국고3년 → [date, yield] (차트용).
export function ktbDailySeries(ktbDaily) {
  return ktbDaily.map((r) => [toDate(r.time), r.value]);
}

// ygap 분기 Map → 월 forward-fill. 대상 분기 미발표면 직전 분기 hold(발표시차).
function ygapForMonth(month, ygapMap, sortedQuarters) {
  const q = quarterOfMonth(month);
  if (ygapMap.has(q)) return ygapMap.get(q);
  let best = null;
  for (const qq of sortedQuarters) { if (qq <= q) best = qq; else break; }
  return best == null ? null : ygapMap.get(best);
}

// 월별 압력 시계열 산출.
//   cpiRows:  [{time:'YYYYMM', value}]  근원 CPI 지수
//   gdpRows:  [{time:'YYYYQn', value}]  실질 SA GDP (HP 워밍업 포함 전체)
//   baseDaily:[{time:'YYYYMMDD', value}] 기준금리 일별
// 반환: [{ month, pi, ygap, base, iStar, pressure }] (startMonth 이후, 3성분 모두 가용한 월).
export function buildPressureSeries({ cpiRows, gdpRows, baseDaily, params, lambda = 1600, startMonth }) {
  const piMap = cpiYoY(cpiRows.map((r) => ({ period: toMonth(r.time), value: r.value })));
  const ygapMap = outputGap(gdpRows.map((r) => ({ period: r.time, value: r.value })), lambda);
  const sortedQuarters = [...ygapMap.keys()].sort();
  const baseMap = monthEndBaseRate(baseDaily);

  const out = [];
  for (const month of [...piMap.keys()].sort()) {
    if (startMonth && month < startMonth) continue;
    const pi = piMap.get(month);
    const ygap = ygapForMonth(month, ygapMap, sortedQuarters);
    const base = baseMap.get(month);
    if (pi == null || ygap == null || base == null) continue;
    out.push({
      month, pi, ygap, base,
      iStar: iStar(pi, ygap, params),
      pressure: pressureFn(pi, ygap, base, params),
    });
  }
  return out;
}

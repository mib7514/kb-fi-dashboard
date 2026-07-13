// calc.js — Fenrir inflation-forecast/calc.ts 를 순수 JS(ES module)로 1:1 이식.
// 외부 의존 없음. buildForecast가 진입점.
//
// 타입(참고용):
//   IndexPoint      = { period: 'YYYY-MM', value: number }
//   ScenarioRecord  = { series_id, scenario_id, label, mm_overrides: [{period, mm}], last_edited }
//   MetaRecord      = { series_id, window_years: 5|10|15, notes, comparison_label }
//   MmGuide         = { seasonal_avg_window, seasonal_trimmed_window, recent_6m_avg, recent_12m_avg }
//   ForecastResult  = { series_id, scenario_id, index_history, index_forecast,
//                       mm_history, mm_forecast, yoy_history, yoy_forecast, guide, mm_guide_full }

// ─────────────────────────────────────────────────────────────
//  'YYYY-MM' 산수
// ─────────────────────────────────────────────────────────────

function parsePeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return { year: y, month: m };
}

function formatPeriod(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function nextPeriod(period) {
  const { year, month } = parsePeriod(period);
  return month === 12 ? formatPeriod(year + 1, 1) : formatPeriod(year, month + 1);
}

export function prevPeriod(period, n = 1) {
  let { year, month } = parsePeriod(period);
  month -= n;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return formatPeriod(year, month);
}

export function periodMonth(period) {
  return parsePeriod(period).month;
}

export function comparePeriods(a, b) {
  // 'YYYY-MM' 형식은 사전식 비교가 곧 시간 순 비교.
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────
//  핵심 계산
// ─────────────────────────────────────────────────────────────

function sortByPeriod(points) {
  return [...points].sort((a, b) => comparePeriods(a.period, b.period));
}

// 인덱스 → m-m: ((idx[t]/idx[t-1]) - 1) * 100
export function computeMM(history) {
  const sorted = sortByPeriod(history);
  const result = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    if (prev === 0) continue; // 0 나눗셈 방지
    result.push({
      period: sorted[i].period,
      value: (sorted[i].value / prev - 1) * 100,
    });
  }
  return result;
}

// 인덱스 → y-y: ((idx[t]/idx[t-12]) - 1) * 100. t-12 데이터 없으면 결과 제외.
export function computeYY(history) {
  const sorted = sortByPeriod(history);
  const map = new Map(sorted.map((p) => [p.period, p.value]));
  const result = [];
  for (const p of sorted) {
    const ref = map.get(prevPeriod(p.period, 12));
    if (ref === undefined || ref === 0) continue;
    result.push({
      period: p.period,
      value: (p.value / ref - 1) * 100,
    });
  }
  return result;
}

// 분기 인덱스 → 4-quarter change y-y. 분기 시점은 'YYYY-03/06/09/12'로 인입.
export function computeQuarterlyYY(history) {
  return computeYY(history);
}

// 시즈널 평균 m-m: 1~12월 각각의 N년 평균 (고정 endPeriod 윈도우).
export function seasonalAvgMM(mmHistory, windowYears, endPeriod, forecastMonths) {
  const byMonth = collectMonthSamples(mmHistory, windowYears, endPeriod);
  const result = [];
  let p = nextPeriod(endPeriod);
  for (let i = 0; i < forecastMonths; i++) {
    const samples = byMonth.get(periodMonth(p)) ?? [];
    const value = samples.length > 0
      ? samples.reduce((s, v) => s + v, 0) / samples.length
      : 0;
    result.push({ period: p, value });
    p = nextPeriod(p);
  }
  return result;
}

// trimmed mean (상하위 trimRatio% 제거. 기본 0.1). trim 후 0개면 trim 없는 평균 폴백.
export function seasonalTrimmedAvgMM(mmHistory, windowYears, endPeriod, forecastMonths, trimRatio = 0.1) {
  const byMonth = collectMonthSamples(mmHistory, windowYears, endPeriod);
  const result = [];
  let p = nextPeriod(endPeriod);
  for (let i = 0; i < forecastMonths; i++) {
    const samples = byMonth.get(periodMonth(p)) ?? [];
    result.push({ period: p, value: trimmedMean(samples, trimRatio) });
    p = nextPeriod(p);
  }
  return result;
}

// 시점별 rolling 시즈널 평균. 각 period p마다 윈도우 [p - windowYears*12 .. p-1]을 잡고
// 같은 month-of-year의 m-m을 평균. 실측 갱신 효과 반영.
export function rollingSeasonalAvgMM(mmHistory, windowYears, periods) {
  const sortedHistory = sortByPeriod(mmHistory);
  return periods.map((p) => {
    const monthOfYear = periodMonth(p);
    const windowStart = prevPeriod(p, windowYears * 12);
    const windowEnd = prevPeriod(p, 1);
    const samples = [];
    for (const h of sortedHistory) {
      if (comparePeriods(h.period, windowStart) < 0) continue;
      if (comparePeriods(h.period, windowEnd) > 0) continue;
      if (periodMonth(h.period) !== monthOfYear) continue;
      samples.push(h.value);
    }
    const value = samples.length > 0
      ? samples.reduce((s, v) => s + v, 0) / samples.length
      : 0;
    return { period: p, value };
  });
}

// 최근 N개월 단순 평균. 데이터 부족 시 가용한 만큼만.
export function recentAvgMM(mmHistory, months) {
  const sorted = sortByPeriod(mmHistory);
  const recent = sorted.slice(-months);
  if (recent.length === 0) return 0;
  return recent.reduce((s, p) => s + p.value, 0) / recent.length;
}

// 추정 m-m 결정: override 있으면 그 값, 없으면 guide 값. override는 clipping 없이 그대로.
export function resolveForecastMM(scenario, guideSeasonal) {
  const overrides = new Map(scenario.mm_overrides.map((o) => [o.period, o.mm]));
  return guideSeasonal.map((g) => ({
    period: g.period,
    value: overrides.has(g.period) ? overrides.get(g.period) : g.value,
  }));
}

// 인덱스 forecast: idx[t] = idx[t-1] * (1 + mm[t]/100)
export function projectIndex(lastIndex, mmAssumptions) {
  const result = [];
  let prev = lastIndex.value;
  for (const mm of mmAssumptions) {
    const next = prev * (1 + mm.value / 100);
    result.push({ period: mm.period, value: next });
    prev = next;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
//  통합
// ─────────────────────────────────────────────────────────────

export function buildGuide(mmHistory, meta, endPeriod, forecastMonths) {
  return {
    seasonal_avg_window: seasonalAvgMM(mmHistory, meta.window_years, endPeriod, forecastMonths),
    seasonal_trimmed_window: seasonalTrimmedAvgMM(mmHistory, meta.window_years, endPeriod, forecastMonths),
    recent_6m_avg: recentAvgMM(mmHistory, 6),
    recent_12m_avg: recentAvgMM(mmHistory, 12),
  };
}

const EMPTY_GUIDE = () => ({
  seasonal_avg_window: [],
  seasonal_trimmed_window: [],
  recent_6m_avg: 0,
  recent_12m_avg: 0,
});

export function buildForecast(
  index_history,
  scenario,
  meta,
  forecastMonths = 12,
  valueType = 'index',
  frequency = 'monthly',
) {
  const sorted = sortByPeriod(index_history);

  // 분기 발표 시리즈 — m-m/forecast 미사용, y-y는 4-quarter change.
  if (frequency === 'quarterly') {
    return {
      series_id: scenario.series_id,
      scenario_id: scenario.scenario_id,
      index_history: sorted,
      index_forecast: [],
      mm_history: [],
      mm_forecast: [],
      yoy_history: computeQuarterlyYY(sorted),
      yoy_forecast: [],
      guide: EMPTY_GUIDE(),
      mm_guide_full: [],
    };
  }

  // rate 시리즈 — 값이 이미 y-y율.
  if (valueType === 'rate') {
    return {
      series_id: scenario.series_id,
      scenario_id: scenario.scenario_id,
      index_history: sorted,
      index_forecast: [],
      mm_history: [],
      mm_forecast: [],
      yoy_history: sorted,
      yoy_forecast: [],
      guide: EMPTY_GUIDE(),
      mm_guide_full: [],
    };
  }

  if (sorted.length === 0) {
    return {
      series_id: scenario.series_id,
      scenario_id: scenario.scenario_id,
      index_history: [],
      index_forecast: [],
      mm_history: [],
      mm_forecast: [],
      yoy_history: [],
      yoy_forecast: [],
      guide: EMPTY_GUIDE(),
      mm_guide_full: [],
    };
  }

  const mm_history = computeMM(sorted);
  const yoy_history = computeYY(sorted);
  const lastIndex = sorted[sorted.length - 1];
  const endPeriod = lastIndex.period;

  // forecast periods: nextPeriod(endPeriod)부터 forecastMonths개월
  const forecastPeriods = [];
  {
    let cur = nextPeriod(endPeriod);
    for (let i = 0; i < forecastMonths; i++) {
      forecastPeriods.push(cur);
      cur = nextPeriod(cur);
    }
  }

  // guide.seasonal_avg_window: 전망 시점 시즈널 가이드 — 최종 실측 기준 "고정 윈도우"(동결).
  // 지평 1~12M 구간은 rolling과 표본이 수학적으로 동일하고(값 불변), 12M 초과 연장 구간에서만
  // rolling과 갈린다. 연평균 요약 카드(annualYoYSummary)가 익년 12월까지 고정 윈도우로 연장하므로,
  // 카드와 차트 전망선이 전 지평에서 일치하도록 엔진도 고정 윈도우로 정렬.
  const seasonalAvgFixed = seasonalAvgMM(mm_history, meta.window_years, endPeriod, forecastMonths);
  const guide = {
    seasonal_avg_window: seasonalAvgFixed,
    seasonal_trimmed_window: seasonalTrimmedAvgMM(mm_history, meta.window_years, endPeriod, forecastMonths),
    recent_6m_avg: recentAvgMM(mm_history, 6),
    recent_12m_avg: recentAvgMM(mm_history, 12),
  };

  // mm_guide_full: history 마지막 24개월(회고적 rolling) + forecast 구간(고정 윈도우, 위 가이드와 동일).
  const last24HistoryPeriods = mm_history.slice(-24).map((p) => p.period);
  const mm_guide_full = [
    ...rollingSeasonalAvgMM(mm_history, meta.window_years, last24HistoryPeriods),
    ...seasonalAvgFixed,
  ];

  const mm_forecast = resolveForecastMM(scenario, guide.seasonal_avg_window);
  const index_forecast = projectIndex(lastIndex, mm_forecast);

  // forecast 구간 y-y는 history+forecast 인덱스 합쳐 계산 후 forecast 구간만 추출.
  const forecastStart = index_forecast[0]?.period;
  const yoy_forecast = forecastStart
    ? computeYY([...sorted, ...index_forecast]).filter(
        (p) => comparePeriods(p.period, forecastStart) >= 0,
      )
    : [];

  return {
    series_id: scenario.series_id,
    scenario_id: scenario.scenario_id,
    index_history: sorted,
    index_forecast,
    mm_history,
    mm_forecast,
    yoy_history,
    yoy_forecast,
    guide,
    mm_guide_full,
  };
}

// ─────────────────────────────────────────────────────────────
//  내부 유틸
// ─────────────────────────────────────────────────────────────

// endPeriod로부터 windowYears*12개월 내(endPeriod 포함) 샘플을 month-of-year별로 모음.
function collectMonthSamples(mmHistory, windowYears, endPeriod) {
  const sorted = sortByPeriod(mmHistory);
  const windowStart = prevPeriod(endPeriod, windowYears * 12 - 1);
  const byMonth = new Map();
  for (const p of sorted) {
    if (comparePeriods(p.period, windowStart) < 0) continue;
    if (comparePeriods(p.period, endPeriod) > 0) continue;
    const m = periodMonth(p.period);
    const list = byMonth.get(m);
    if (list) list.push(p.value);
    else byMonth.set(m, [p.value]);
  }
  return byMonth;
}

function trimmedMean(samples, trimRatio) {
  if (samples.length === 0) return 0;
  const sortedAsc = [...samples].sort((a, b) => a - b);
  const trimCount = Math.floor(sortedAsc.length * trimRatio);
  const trimmed = sortedAsc.slice(trimCount, sortedAsc.length - trimCount);
  if (trimmed.length === 0) {
    return sortedAsc.reduce((s, v) => s + v, 0) / sortedAsc.length;
  }
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
}

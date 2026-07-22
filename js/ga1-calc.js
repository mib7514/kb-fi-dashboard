// ga1-calc.js — GA-1 연간 GDP 환산기. 순수 결정론적 산술만. DOM·파일 I/O·외부 fetch 금지.
//
// 질문 하나: "분기 전기비(계절조정) 실적을 이대로 이으면 연간 GDP가 몇 %인가".
//   전망 모델·판정 엔진·확률 없음. 잔여(미실적) 분기는 사용자 지정 전기비로 채우는 산술.
//
// [방법]
//   1) 2023Q4=100 앵커에서 분기 전기비(QoQ %)를 연쇄 곱 → 분기 레벨.
//   2) 연간 성장률 = 당해 4개 분기 레벨 합 / 전년 4개 분기 레벨 합 − 1.
//   3) 잔여 분기(실적 없는 분기)는 균일 프리셋 또는 분기별 커스텀 전기비로 채움.
//
// [실적 상수] 계절조정 실질 GDP 전기대비 %. 출처: 한국은행 보도자료.
//   2024·2025 = 2026Q2 속보 첨부표 / 2026Q1 = 잠정 / 2026Q2 = 속보(advance, 2026-07-23 발표).
//   ▸ 갱신은 이 배열 수정만으로 완결(연 8회 수동). 속보→잠정 수정 시 v·vintage 교체.
//   ▸ 공표치 소수1자리 반올림 → 연쇄·연간 환산에 ±0.05%p 내외 오차 가능(페이지 각주 고지).
export const GDP_QOQ_ACTUAL = [
  { q: '2024Q1', v: 1.0 }, { q: '2024Q2', v: -0.2 },
  { q: '2024Q3', v: 0.1 }, { q: '2024Q4', v: 0.2 },
  { q: '2025Q1', v: -0.2 }, { q: '2025Q2', v: 0.6 },
  { q: '2025Q3', v: 1.4 }, { q: '2025Q4', v: -0.1 },
  { q: '2026Q1', v: 1.8 },                       // 잠정
  { q: '2026Q2', v: 0.6, vintage: 'advance' },   // 속보 (2026-07-23)
];

// 연쇄 앵커: 2023Q4 = 100 (배열 첫 분기의 직전 분기).
export const ANCHOR_LEVEL = 100;
// 데이터 기준일(각주·상수 갱신 안내용).
export const ASOF = '2026-07-23';

const round = (v, dp = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);

// 'YYYYQn' → 정렬용 정수 인덱스(= 연×4 + 분기). 오름차순 비교에만 사용.
export const qIndex = (q) => Number(q.slice(0, 4)) * 4 + Number(q.slice(5));
// 특정 연도의 4개 분기 라벨.
export const yearQuarters = (year) => [1, 2, 3, 4].map((n) => `${year}Q${n}`);

// 분기 전기비(QoQ %) 목록을 레벨로 연쇄. anchorLevel = 첫 분기 직전 분기의 레벨.
//   입력 [{ q, v, source?, vintage? }] → [{ q, level, qoq, source, vintage }].
export function chainLevels(qoqList, anchorLevel = ANCHOR_LEVEL) {
  let lvl = anchorLevel;
  return qoqList.map((item) => {
    lvl *= 1 + item.v / 100;
    return {
      q: item.q,
      qoq: item.v,
      level: round(lvl, 6),
      source: item.source || 'actual',
      ...(item.vintage ? { vintage: item.vintage } : {}),
    };
  });
}

// 연간 성장률(%) = 당해 4분기 레벨 합 / 전년 4분기 레벨 합 − 1.
//   해당 연·전년이 각각 정확히 4개 분기를 갖지 않으면 null(불완전 연도 방어).
export function annualGrowth(levels, year) {
  const sumYear = (y) => {
    const rows = levels.filter((l) => Number(l.q.slice(0, 4)) === y);
    return rows.length === 4 ? rows.reduce((s, l) => s + l.level, 0) : null;
  };
  const cur = sumYear(year);
  const prev = sumYear(year - 1);
  if (cur == null || prev == null) return null;
  return round((cur / prev - 1) * 100, 2);
}

// 실적 + 잔여분기 시나리오를 합쳐 완전한 분기 QoQ 체인을 만든다.
//   residual: 숫자(균일 %) 또는 { 'YYYYQn': % } 맵(분기별). 맵에 없는 잔여분기는 fallback.
//   반환: chainLevels 결과(오름차순, source='actual'|'scenario').
export function buildChain({ actual = GDP_QOQ_ACTUAL, targetYear, residual = 0.3, fallback = 0.3, anchorLevel = ANCHOR_LEVEL } = {}) {
  const haveActual = new Set(actual.map((a) => a.q));
  const rows = actual.map((a) => ({ q: a.q, v: a.v, source: 'actual', vintage: a.vintage }));
  const yr = targetYear ?? (actual.length ? Number(actual[actual.length - 1].q.slice(0, 4)) : null);
  if (yr != null) {
    for (const q of yearQuarters(yr)) {
      if (haveActual.has(q)) continue;
      const v = typeof residual === 'number' ? residual : (residual[q] != null ? residual[q] : fallback);
      rows.push({ q, v, source: 'scenario' });
    }
  }
  rows.sort((a, b) => qIndex(a.q) - qIndex(b.q));
  return chainLevels(rows, anchorLevel);
}

// 잔여분기 개수(targetYear 중 실적 없는 분기 수).
export function residualQuarters(actual = GDP_QOQ_ACTUAL, targetYear) {
  const yr = targetYear ?? Number(actual[actual.length - 1].q.slice(0, 4));
  const have = new Set(actual.map((a) => a.q));
  return yearQuarters(yr).filter((q) => !have.has(q));
}

// 상위 API: 실적 + 잔여 시나리오 → 레벨 체인 + 당해/전년 연간 성장률.
export function annualize({ actual = GDP_QOQ_ACTUAL, targetYear, residual = 0.3, fallback = 0.3, anchorLevel = ANCHOR_LEVEL } = {}) {
  const yr = targetYear ?? Number(actual[actual.length - 1].q.slice(0, 4));
  const levels = buildChain({ actual, targetYear: yr, residual, fallback, anchorLevel });
  return {
    targetYear: yr,
    levels,
    residualQuarters: residualQuarters(actual, yr),
    targetGrowth: annualGrowth(levels, yr),        // 시나리오 반영 당해 연간
    securedGrowth: annualGrowth(buildChain({ actual, targetYear: yr, residual: 0, anchorLevel }), yr), // 잔여 0% = 이미 확보된 성장
    prevGrowth: annualGrowth(levels, yr - 1),      // 전년 연간(전량 실적)
  };
}

// 프리셋 균일 시나리오 표: [{ residual, growth }].
export function presetTable({ actual = GDP_QOQ_ACTUAL, targetYear, presets = [0.0, 0.3, 0.5], anchorLevel = ANCHOR_LEVEL } = {}) {
  const yr = targetYear ?? Number(actual[actual.length - 1].q.slice(0, 4));
  return presets.map((r) => ({ residual: r, growth: annualGrowth(buildChain({ actual, targetYear: yr, residual: r, anchorLevel }), yr) }));
}

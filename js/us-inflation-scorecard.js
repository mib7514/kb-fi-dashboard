// us-inflation-scorecard.js — 헤드라인 CPI y/y 예측 성적표 (측정 레이어, 브라우저+Node 공용).
//   각 발표월에 대해 6개 예측/실측 소스를 나란히 두고 오차를 추적한다. 점-시점 원칙:
//   발표 직전 스냅샷을 동결(frozen)하고 발표 후 소급 수정 금지. 백테스트 소급값(retro)·
//   발표 후 수동입력(late)은 누적 성적에서 제외.
//
// 컬럼(내부키 → 화면 쉬운 설명):
//   seasonal  ① 시즈널 단독      "우리 계산기"
//   combined  ② 나우캐스트 결합  "계산기+기름값"
//   sealed    ③ 봉인값(수동)     "내 최종 판단"
//   consensus ④ 컨센서스(수동)   "시장 예상"
//   cleveland ⑤ 클리블랜드 나우캐스트 "클리블랜드 연은"
//   actual    ⑥ 실제             "실제"
//
// 표시 단위 = y/y 헤드라인(%). m/m은 내부 산출용으로 병기 저장 가능.

import { comparePeriods, prevPeriod, nextPeriod } from './calc.js';
import { computeMMGapAware } from './us-inflation-calc.js';
import { energyNowcast, estimateWeights, synthesizeHeadlineMM, seasonalForPeriod } from './us-energy-nowcast.js';

// 예측 컬럼 메타 (표시 순서·쉬운 설명). actual은 기준선이라 예측에서 제외.
export const PREDICTION_COLUMNS = [
  { key: 'seasonal', label: '우리 계산기', tech: '시즈널 단독' },
  { key: 'combined', label: '계산기+기름값', tech: '나우캐스트 결합' },
  { key: 'sealed', label: '내 최종 판단', tech: '봉인값(수동)' },
  { key: 'consensus', label: '시장 예상', tech: '컨센서스(수동)' },
  { key: 'cleveland', label: '클리블랜드 연은', tech: '클리블랜드 나우캐스트' },
];
const MANUAL_COLUMNS = ['sealed', 'consensus', 'cleveland'];

// 봉인 근거 갈래(수동 선택) 라벨 + 실현 유가 분류 임계.
export const OIL_BRANCH_LABELS = { hold: '지금 수준', up20: '유가 +20%', down20: '유가 −20%', other: '기타' };
export const OIL_BRANCH_THRESHOLD = 10; // 실현 WTI m/m ±% 경계(±20 시나리오의 중점).

/** 실현 유가 갈래 분류: 해당월 WTI 월평균 m/m로 up20/hold/down20. 없으면 null. */
export function classifyRealizedOil(month, wtiData) {
  const mm = computeMMGapAware(wtiData);
  const hit = mm.find((p) => p.period === month);
  if (!hit) return null;
  if (hit.value >= OIL_BRANCH_THRESHOLD) return 'up20';
  if (hit.value <= -OIL_BRANCH_THRESHOLD) return 'down20';
  return 'hold';
}

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** 인덱스 배열 → period→value 맵. */
function indexMap(data) { return new Map(data.map((p) => [p.period, p.value])); }

/**
 * 대상월 m/m 예측 → 헤드라인 y/y(%). idx(M)=idx(M-1)×(1+mm/100), y/y=idx(M)/idx(M-12)−1.
 * M-1(최신 실측)·M-12 인덱스가 있어야 산출. 없으면 null.
 */
export function mmToYoY(targetMonth, predMM, headlineData) {
  if (predMM == null) return null;
  const idx = indexMap(headlineData);
  const base1 = idx.get(prevPeriod(targetMonth));       // M-1 (최신 실측)
  const base12 = idx.get(prevPeriod(targetMonth, 12));  // M-12
  if (base1 == null || base12 == null || base12 === 0) return null;
  const idxM = base1 * (1 + predMM / 100);
  return (idxM / base12 - 1) * 100;
}

/** 실측 인덱스로 실제 y/y(%). 없으면 null. */
export function actualYoY(targetMonth, headlineData) {
  const idx = indexMap(headlineData);
  const cur = idx.get(targetMonth), base12 = idx.get(prevPeriod(targetMonth, 12));
  if (cur == null || base12 == null || base12 === 0) return null;
  return (cur / base12 - 1) * 100;
}

/**
 * 다음 발표월(최신 헤드라인 실측 +1)의 라이브 예측 라인 산출.
 * @returns { month, seasonal:{mm,yoy}, combined:{mm,yoy} }  (예측 불가 컬럼은 mm/yoy=null)
 */
export function computeLivePrediction({ headlineData, coreData, energyData, foodData, gasData,
  windowYears = 10, regWindow = 24, weightWindow = 60 }) {
  const sorted = [...headlineData].sort((a, b) => comparePeriods(a.period, b.period));
  if (sorted.length === 0) return null;
  const endPeriod = sorted[sorted.length - 1].period;  // 최신 실측월 L
  const target = nextPeriod(endPeriod);                // 다음 발표월 M=L+1

  const hMM = computeMMGapAware(headlineData);
  const cMM = computeMMGapAware(coreData);
  const eMM = computeMMGapAware(energyData);
  const fMM = computeMMGapAware(foodData);
  const gMM = computeMMGapAware(gasData);
  const upto = (mm) => mm.filter((p) => comparePeriods(p.period, endPeriod) <= 0);

  // ① 시즈널 단독: 헤드라인 시즈널 m/m 직접.
  const seasonalMM = seasonalForPeriod(upto(hMM), endPeriod, target, windowYears);

  // ② 나우캐스트 결합: 코어·식품 시즈널 유지 + 에너지 나우캐스트 대체.
  const nc = energyNowcast({ gasMM: gMM, energyMM: upto(eMM), endPeriod, targetPeriod: target, regWindow, windowYears });
  const energySeas = seasonalForPeriod(upto(eMM), endPeriod, target, windowYears);
  const foodSeas = seasonalForPeriod(upto(fMM), endPeriod, target, windowYears);
  const coreSeas = seasonalForPeriod(upto(cMM), endPeriod, target, windowYears);
  const w = estimateWeights(
    upto(hMM).slice(-weightWindow), upto(cMM).slice(-weightWindow),
    upto(fMM).slice(-weightWindow), upto(eMM).slice(-weightWindow),
  );
  const synth = synthesizeHeadlineMM({ coreSeas, foodSeas, energySeas, energyNowcastMM: nc.value, weights: w });

  return {
    month: target,
    seasonal: { mm: r3(seasonalMM), yoy: r2(mmToYoY(target, seasonalMM, headlineData)) },
    combined: { mm: r3(synth.nowcast), yoy: r2(mmToYoY(target, synth.nowcast, headlineData)),
      reg: { b: r3(nc.b), r2: r3(nc.r2), w_e: r3(w.w_e) } },
  };
}

/**
 * 한 행의 예측별 오차(pred − actual) 산출. actual.yoy 없으면 전부 null.
 * retro combined는 제외 대상이나 오차 자체는 참고용으로 산출(집계에서 걸러냄).
 */
export function scoreRow(row) {
  const a = row.actual?.yoy;
  const errors = {};
  for (const { key } of PREDICTION_COLUMNS) {
    const pred = row[key]?.yoy;
    errors[key] = (a == null || pred == null) ? null : r2(pred - a);
  }
  return errors;
}

/** 컬럼이 집계에 유효한가: frozen·실측존재·예측존재·retro아님·late아님. */
function eligible(row, key) {
  if (!row.frozen || row.actual?.yoy == null) return false;
  const cell = row[key];
  if (!cell || cell.yoy == null) return false;
  if (key === 'combined' && cell.retro) return false;    // 소급값 제외
  if (MANUAL_COLUMNS.includes(key) && cell.late) return false; // 발표 후 입력 제외
  return true;
}

/** 누적 평균 절대오차(컬럼별). {key:{mae,n}}. */
export function cumulativeError(rows) {
  const out = {};
  for (const { key } of PREDICTION_COLUMNS) {
    const errs = [];
    for (const row of rows) {
      if (!eligible(row, key)) continue;
      const e = row.errors?.[key] ?? scoreRow(row)[key];
      if (e != null) errs.push(Math.abs(e));
    }
    out[key] = { mae: errs.length ? r3(errs.reduce((s, x) => s + x, 0) / errs.length) : null, n: errs.length };
  }
  return out;
}

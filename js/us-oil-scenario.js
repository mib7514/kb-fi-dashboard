// us-oil-scenario.js — 유가 시나리오 밴드 (WTI 유지/+20%/−20% → 헤드라인 CPI y/y).
//   측정 레이어. 나우캐스트 모듈(us-energy-nowcast.js)을 재사용해 유가 충격을 헤드라인까지 전파.
//
// 경로: WTI 충격(±%) → 휘발유 m/m 증분(전가계수 β_wg) → 에너지 m/m → 헤드라인 m/m.
//   · WTI→휘발유 전가: 과거 24개월 디시즌·점-시점 회귀(나우캐스트와 동일 규약).
//   · 휘발유→에너지→헤드라인: 기존 나우캐스트 결합 산식 재사용.
//   · 코어·식품은 3갈래 공통(시즈널). 유지(중앙) 갈래 = 기존 나우캐스트 결합값(불변 보장).
//
// 유가 커브: FRED 단일 스팟(DCOILWTICO)만 가용 → **스팟 유지 가정**(선물 커브 미반영). meta 명기.
//
// 선형성으로 단조 보장: headline_mm(shock) = combined_mm + w_e·b_ge·β_wg·shock.
//   (디시즌은 상수 계절 차감이라 raw 휘발유 증분이 1:1 통과 → 증분 = β_wg·shock.)

import { comparePeriods } from './calc.js';
import { computeMMGapAware } from './us-inflation-calc.js';
import { seasonalMonthMap, deseasonalizeMM, ols } from './us-energy-nowcast.js';
import { computeLivePrediction, mmToYoY } from './us-inflation-scorecard.js';

export const OIL_SHOCKS = [
  { key: 'up20', shock: 20 },
  { key: 'hold', shock: 0 },
  { key: 'down20', shock: -20 },
];

const r2f = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3f = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/**
 * WTI→휘발유 전가계수 β_wg. 디시즌 휘발유 m/m ~ 디시즌 WTI m/m, 24개월 점-시점 회귀.
 * @returns {b, r2, n}
 */
export function wtiGasPassthrough({ gasMM, wtiMM, endPeriod, regWindow = 24, windowYears = 10 }) {
  const gasHist = gasMM.filter((p) => comparePeriods(p.period, endPeriod) <= 0);
  const wtiHist = wtiMM.filter((p) => comparePeriods(p.period, endPeriod) <= 0);
  const gasDes = new Map(deseasonalizeMM(gasMM, seasonalMonthMap(gasHist, windowYears, endPeriod)).map((p) => [p.period, p.value]));
  const wtiDes = new Map(deseasonalizeMM(wtiMM, seasonalMonthMap(wtiHist, windowYears, endPeriod)).map((p) => [p.period, p.value]));
  const periods = wtiHist.filter((p) => gasDes.has(p.period)).map((p) => p.period).slice(-regWindow);
  const xs = periods.map((p) => wtiDes.get(p));
  const ys = periods.map((p) => gasDes.get(p));
  return ols(xs, ys);
}

/**
 * 3갈래 유가 시나리오 밴드. 유지 갈래는 computeLivePrediction 결합값과 동일(중앙값 불변).
 * @returns { month, passthrough:{b,r2,n,method,note}, base:{...}, branches:[{key,shock,gas_delta_mm,mm,yoy}] }
 *          / 입력 부족(결합 예측 불가)이면 null.
 */
export function computeOilBand({ headlineData, coreData, energyData, foodData, gasData, wtiData,
  windowYears = 10, regWindow = 24, weightWindow = 60 }) {
  const live = computeLivePrediction({ headlineData, coreData, energyData, foodData, gasData, windowYears, regWindow, weightWindow });
  if (!live || live.combined.mm == null) return null;
  const target = live.month;
  const endPeriod = [...headlineData].sort((a, b) => comparePeriods(a.period, b.period)).at(-1).period;

  const gMM = computeMMGapAware(gasData);
  const wMM = computeMMGapAware(wtiData);
  const pt = wtiGasPassthrough({ gasMM: gMM, wtiMM: wMM, endPeriod, regWindow, windowYears });

  const b_ge = live.combined.reg.b;   // 에너지 CPI m/m ~ 디시즌 휘발유 m/m 기울기
  const w_e = live.combined.reg.w_e;  // 에너지 가중
  const beta_wg = pt.b;               // 휘발유 m/m ~ WTI m/m 전가

  const branches = OIL_SHOCKS.map(({ key, shock }) => {
    const gasDelta = beta_wg * shock;                 // 충격→휘발유 m/m 증분(%p)
    const mm = live.combined.mm + w_e * b_ge * gasDelta;
    return {
      key, shock,
      gas_delta_mm: shock === 0 ? 0 : r3f(gasDelta),
      mm: shock === 0 ? live.combined.mm : r3f(mm),
      yoy: shock === 0 ? live.combined.yoy : r2f(mmToYoY(target, mm, headlineData)),
    };
  });

  return {
    month: target,
    passthrough: {
      b: r3f(beta_wg), r2: r3f(pt.r2), n: pt.n,
      method: 'WTI m/m → 휘발유 m/m, 24개월 디시즌·점-시점 회귀',
      note: '스팟 유지 가정 (FRED 단일 스팟 DCOILWTICO만 가용 — 선물 커브 미반영). ±20%는 현 스팟 대비 레벨 충격.',
    },
    base: { mm: live.combined.mm, yoy: live.combined.yoy, w_e: r3f(w_e), b_ge: r3f(b_ge) },
    branches,
  };
}

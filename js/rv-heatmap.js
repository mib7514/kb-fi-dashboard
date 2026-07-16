// rv-heatmap.js — 커브 RV 히트맵/드릴다운 조립 (순수 함수·DOM 접근 금지, node 테스트 가능).
//   Phase 1 계산 코어(curve-rv-calc.js) + meta.nodes 위에서 히트맵 z/텍스트/스테일 그리드와
//   드릴다운 데이터를 만든다. 렌더(rv-chart)·오케스트레이션(rv-ui)과 분리.

import {
  staleMask, combineMask, curveVal, carry, reval, excessReturn, pctile,
} from './curve-rv-calc.js';
// carryOnly = 롤다운 미측정(만기도래 m≤h 또는 롤다운 타겟<최소노드) → 캐리만 표시.
import { maturityToYears } from './credit-parse.js';
import { fullPctileFn, bucketize } from './rv-backtest.js';

export const HIDDEN_NODES = [10];       // 인제스트엔 있으나 표시 제외(제외 방식 — 복귀 한 줄).
export const HIDDEN_SECTORS = ['회사채BBB+']; // 표시 행·순위/색 풀에서 제외(데이터 무변경 — 복귀 한 줄).
export const HORIZONS = [1, 3, 6];      // 개월
export const KTB = '국고채권';

// 기대수익 색 5단계 순위 경계(상위 누적 비율): top10% / top25% / top50%. 실사용 후 조정 가능.
export const COLOR_STEPS = [0.10, 0.25, 0.50];
// 랭크 z(0..1) 또는 -1(음수) → 색 밴드. null(제외 셀: 국고행/스테일/carryOnly/숨김섹터)은 null 유지.
export function excessBand(z) {
  if (z == null || !Number.isFinite(z)) return null;
  if (z < 0) return 'neg';                 // 음수: 적색
  const [a, b, c] = COLOR_STEPS;
  if (z >= 1 - a) return 'g1';             // 진초록 (상위 10%, 강조 테두리)
  if (z >= 1 - b) return 'g2';             // 중간 초록 (상위 10~25%)
  if (z >= 1 - c) return 'g3';             // 연초록 (상위 25~50%)
  return 'flat';                           // 무채색 (하위 50%)
}

const bpSeriesOf = (series, lab) => (series[lab] || []).map(v => (v == null || !Number.isFinite(v)) ? null : v * 100);
const lastIdx = (dates) => dates.length - 1;

// 최신일 기준 해당 라벨이 스테일 런(5일+) 진행 중인가.
function staleAtLatest(series, lab) {
  const arr = series[lab];
  if (!arr) return false;
  const m = staleMask(arr);
  return !!m[m.length - 1];
}

// (m−h) 보간에 쓰이는 인접 노드 라벨 2개 (스테일 표시 판정용).
function bracketNodes(nodes, maturities, x) {
  for (let i = 1; i < nodes.length; i++) {
    if (x <= nodes[i]) return [maturities[i - 1], maturities[i]];
  }
  return [maturities[nodes.length - 1]];
}

// 섹터 시점 T 커브 {nodes, values(bp)} — 크레딧=스프레드, 국고=금리레벨.
function curveAtT(series, sector, nodes, maturities, T) {
  const values = maturities.map(mat => {
    const v = series[`${sector}_${mat}`]?.[T];
    return (v == null || !Number.isFinite(v)) ? null : v * 100;
  });
  return { nodes, values };
}

// 셀에 관여하는 노드가 최신일 스테일이면 true (m 노드 + m−h 보간 인접 노드, 3월이면 국고3월 특칙).
function cellStale(series, sector, mat, m, h, nodes, maturities) {
  const involved = new Set([mat]);
  const rem = m - h;
  if (rem >= nodes[0]) for (const b of bracketNodes(nodes, maturities, rem)) involved.add(b);
  for (const nodeLab of involved) {
    if (staleAtLatest(series, `${sector}_${nodeLab}`)) return true;
    if (nodeLab === '3월' && staleAtLatest(series, `${KTB}_3월`)) return true; // 국고3월 특칙
  }
  return false;
}

// rank-percentile (0..1) among finite non-negative values; 음수는 별도.
function rankPct(values, v) {
  const pool = values.filter(x => x != null && Number.isFinite(x) && x >= 0);
  if (!pool.length) return 0;
  let c = 0; for (const x of pool) if (x <= v) c++;
  return c / pool.length;
}

// 셀 현재 버킷 (스테일 제외 모수 full %ile → low/mid/high). 평균회귀 E[Δ] 조회용.
function currentBucket(series, sector, mat, curSpread) {
  const lab = `${sector}_${mat}`;
  let mask = staleMask(series[lab] || []);
  if (mat === '3월' && sector !== KTB) mask = combineMask(mask, staleMask(series[`${KTB}_3월`] || []));
  const pctFn = fullPctileFn(bpSeriesOf(series, lab), mask);
  return bucketize(pctFn(curSpread));
}

// 시나리오/평균회귀 옵션에 따른 셀 ΔS(bp). 국고행·carryOnly는 0.
//   상호배제: meanRev와 scenario는 동시 활성 불가(UI가 강제). 여기선 meanRev 우선.
function cellDeltaS({ series, sector, mat, m, curve, hMonths, scenario, meanRev, backtest }) {
  if (sector === KTB) return 0;
  if (meanRev && backtest) {
    const bt = backtest[`${sector}_${mat}`];
    const stat = bt && bt[hMonths];
    if (stat) {
      const b = currentBucket(series, sector, mat, curveVal(curve, m));
      const e = b && stat[b] ? stat[b].mean : null;
      return (e == null) ? 0 : e; // 미제공 버킷/셀 → 0(순수 excess)
    }
    return 0;
  }
  if (scenario && scenario.mode && scenario.mode !== 'none') {
    if (scenario.mode === 'uniform') return Number(scenario.uniform) || 0;
    if (scenario.mode === 'perSector') return Number(scenario.perSector?.[sector]) || 0;
  }
  return 0;
}

// 분해 2줄째("캐리+롤다운", bp 정수). 캐리는 부호 그대로(음수 '−'), 롤다운은 연결부호(+/−)+절대값.
//   예: 캐리13·롤7 → "13+7", 캐리13·롤−3 → "13−3". base(ΔS=0) = 캐리+롤다운.
//   롤다운 = round(base) − round(캐리)로 유도 → 2줄 합이 항상 round(기대수익 base)와 일치(반올림 어긋남 방지).
function fmtDecomp(cBp, rBp) {
  const ci = Math.round(cBp), ri = Math.round(cBp + rBp) - ci;
  const cs = ci < 0 ? '−' + Math.abs(ci) : String(ci);
  return `${cs}${ri >= 0 ? '+' : '−'}${Math.abs(ri)}`;
}

// ── 히트맵 조립 ──
// opts: { mode, horizonMonths, scenario:{mode,uniform,perSector}, meanRev:bool, backtest:데이터, decompose:bool }
// 반환: { rows, cols, colsYears, mode, horizon, value, text, text2(분해 2줄째|null), zColor(null=무채색), stale, carryOnly, ktbRowIndex }
//   색·순위(zColor)는 항상 ΔS=0 base excess 기준(전제). 표시값(value/text)만 ΔS 반영. text2는 항상 base(ΔS=0) 분해.
export function buildHeatmap(DATA, { mode = 'excess', horizonMonths = 1, scenario = null, meanRev = false, backtest = null, decompose = false } = {}) {
  const { dates, series, meta } = DATA;
  const nodes = meta.nodes, maturities = meta.maturities;
  const T = lastIdx(dates);
  const h = horizonMonths / 12;

  const dispIdx = nodes.map((n, i) => i).filter(i => !HIDDEN_NODES.includes(nodes[i]));
  const cols = dispIdx.map(i => maturities[i]);
  const colsYears = dispIdx.map(i => nodes[i]);
  const creditSectors = meta.sectors.filter(s => s !== KTB && !HIDDEN_SECTORS.includes(s));
  const rows = [KTB, ...creditSectors]; // 숨김섹터는 rows 제외 → excessPool(순위/색)에도 자연 제외

  const value = [], text = [], text2 = [], stale = [], zColor = [], carryOnly = [];
  const excessPool = []; // 크레딧 full-excess 값(스테일·carryOnly 제외) — 랭크 색용
  const wantDecomp = decompose && mode === 'excess';

  // 1차 패스: 값·스테일·carryOnly (+분해 시 캐리/롤다운 base) 계산
  const raw = rows.map(sector => {
    const curve = curveAtT(series, sector, nodes, maturities, T);
    return cols.map((mat, ci) => {
      const m = colsYears[ci];
      const st = cellStale(series, sector, mat, m, h, nodes, maturities);
      let val, co = false, base = null, cBp = null, rBp = null;
      if (mode === 'excess') {
        base = excessReturn(curve, m, h, 0); // 색·순위 기준(ΔS=0)
        if (base != null) {
          const dS = cellDeltaS({ series, sector, mat, m, curve, hMonths: horizonMonths, scenario, meanRev, backtest });
          val = dS !== 0 ? excessReturn(curve, m, h, dS) : base; // 표시값(ΔS 반영)
        } else { val = carry(curve, m, h); co = val != null; } // 롤다운 미측정 → 캐리만(†), ΔS 무효
        // 랭크 풀: 스테일·carryOnly 제외 full-excess의 base(ΔS=0) (수정 ①·전제)
        if (sector !== KTB && !st && !co && base != null) excessPool.push(base);
        if (wantDecomp && base != null) { cBp = carry(curve, m, h); rBp = reval(curve, m, h, 0); } // 분해=항상 ΔS=0
      } else { // pctile — 1년 %ile, 스테일 제외 모수
        const lab = `${sector}_${mat}`;
        let mask = staleMask(series[lab] || []);
        if (mat === '3월' && sector !== KTB) mask = combineMask(mask, staleMask(series[`${KTB}_3월`] || []));
        val = pctile(bpSeriesOf(series, lab), mask, '1y');
      }
      return { val, st, co, base, cBp, rBp, m, mat };
    });
  });

  // 2차 패스: 텍스트·분해 2줄·색 z (국고행·스테일·carryOnly 셀은 무채색·순위 제외 z=null)
  for (let r = 0; r < rows.length; r++) {
    const isKtb = rows[r] === KTB;
    const vrow = [], trow = [], t2row = [], srow = [], zrow = [], corow = [];
    for (let c = 0; c < cols.length; c++) {
      const { val, st, co, base, cBp, rBp } = raw[r][c];
      vrow.push(val); srow.push(st); corow.push(co);
      let txt = '—';
      if (val != null && Number.isFinite(val)) txt = mode === 'excess' ? (val >= 0 ? '+' : '') + val.toFixed(0) : String(Math.round(val));
      trow.push(txt);
      // 분해 2줄째: 스테일=생략(null) · carryOnly='캐리만' · 그 외=base 캐리+롤다운. off면 항상 null.
      let t2 = null;
      if (wantDecomp && val != null && Number.isFinite(val)) {
        if (st) t2 = null;
        else if (co) t2 = '캐리만';
        else if (cBp != null && rBp != null) t2 = fmtDecomp(cBp, rBp);
      }
      t2row.push(t2);
      // 색 z: 국고행/스테일/carryOnly/무값 → null(무채색). excess는 base(ΔS=0) 순위, pctile은 값.
      let z = null;
      if (!isKtb && !st && !co) {
        if (mode === 'excess' && base != null && Number.isFinite(base)) z = base < 0 ? -1 : rankPct(excessPool, base);
        else if (mode !== 'excess' && val != null && Number.isFinite(val)) z = val;
      }
      zrow.push(z);
    }
    value.push(vrow); text.push(trow); text2.push(t2row); stale.push(srow); zColor.push(zrow); carryOnly.push(corow);
  }

  return { rows, cols, colsYears, mode, horizon: horizonMonths, value, text, text2, zColor, stale, carryOnly, ktbRowIndex: 0 };
}

// ── 드릴다운 조립 ──
// 반환: { sector, mat, m, spreadBp, pctile1y, horizons:[{months,excess,carry,rolldown}],
//         history:{dates,values,stale}, isKtb, meanrev:{currentBucket, table} }
export function buildDrilldown(DATA, sector, mat, backtest = null) {
  const { dates, series, meta } = DATA;
  const nodes = meta.nodes, maturities = meta.maturities;
  const T = lastIdx(dates);
  const m = maturityToYears(mat);
  const isKtb = sector === KTB;
  const curve = curveAtT(series, sector, nodes, maturities, T);
  const lab = `${sector}_${mat}`;
  const spBp = bpSeriesOf(series, lab);

  let mask = staleMask(series[lab] || []);
  if (mat === '3월' && !isKtb) mask = combineMask(mask, staleMask(series[`${KTB}_3월`] || []));

  const horizons = HORIZONS.map(months => {
    const h = months / 12;
    return { months, excess: excessReturn(curve, m, h, 0), carry: carry(curve, m, h), rolldown: reval(curve, m, h, 0) };
  });

  // 최근 1년 히스토리 (스테일 세그먼트 표시용)
  const from = Math.max(0, T - 250);
  const hist = { dates: [], values: [], stale: [] };
  for (let i = from; i <= T; i++) { hist.dates.push(dates[i]); hist.values.push(spBp[i]); hist.stale.push(!!mask[i]); }

  const curSpread = curveVal(curve, m);
  const p1 = pctile(spBp, mask, '1y');

  // 평균회귀 상세: 현재 버킷 + 버킷×호라이즌 빈도(제공 시). 국고행 미제공.
  let meanrev = null;
  if (!isKtb) {
    const bt = backtest && backtest[lab];
    const table = { low: {}, mid: {}, high: {} };
    for (const b of ['low', 'mid', 'high']) for (const hh of HORIZONS) table[b][hh] = (bt && bt[hh] && bt[hh][b]) ? bt[hh][b] : null;
    meanrev = { currentBucket: currentBucket(series, sector, mat, curSpread), table };
  }
  return { sector, mat, m, spreadBp: curSpread, pctile1y: p1, horizons, history: hist, isKtb, meanrev };
}

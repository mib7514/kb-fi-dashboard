// rv-heatmap.js — 커브 RV 히트맵/드릴다운 조립 (순수 함수·DOM 접근 금지, node 테스트 가능).
//   Phase 1 계산 코어(curve-rv-calc.js) + meta.nodes 위에서 히트맵 z/텍스트/스테일 그리드와
//   드릴다운 데이터를 만든다. 렌더(rv-chart)·오케스트레이션(rv-ui)과 분리.

import {
  staleMask, combineMask, curveVal, carry, reval, excessReturn, pctile,
} from './curve-rv-calc.js';
// carryOnly = 롤다운 미측정(만기도래 m≤h 또는 롤다운 타겟<최소노드) → 캐리만 표시.
import { maturityToYears } from './credit-parse.js';

export const HIDDEN_NODES = [10];       // 인제스트엔 있으나 표시 제외(제외 방식 — 복귀 한 줄).
export const HORIZONS = [1, 3, 6];      // 개월
export const KTB = '국고채권';

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

// ── 히트맵 조립 ──
// 반환: { rows(라벨), cols(라벨), colsYears, mode, horizon,
//         value[r][c], text[r][c], zColor[r][c](null=무채색), stale[r][c], ktbRowIndex }
export function buildHeatmap(DATA, { mode = 'excess', horizonMonths = 1 } = {}) {
  const { dates, series, meta } = DATA;
  const nodes = meta.nodes, maturities = meta.maturities;
  const T = lastIdx(dates);
  const h = horizonMonths / 12;

  const dispIdx = nodes.map((n, i) => i).filter(i => !HIDDEN_NODES.includes(nodes[i]));
  const cols = dispIdx.map(i => maturities[i]);
  const colsYears = dispIdx.map(i => nodes[i]);
  const creditSectors = meta.sectors.filter(s => s !== KTB);
  const rows = [KTB, ...creditSectors];

  const value = [], text = [], stale = [], zColor = [], carryOnly = [];
  const excessPool = []; // 크레딧 full-excess 값(스테일·carryOnly 제외) — 랭크 색용

  // 1차 패스: 값·스테일·carryOnly 계산
  const raw = rows.map(sector => {
    const curve = curveAtT(series, sector, nodes, maturities, T);
    return cols.map((mat, ci) => {
      const m = colsYears[ci];
      const st = cellStale(series, sector, mat, m, h, nodes, maturities);
      let val, co = false;
      if (mode === 'excess') {
        const ex = excessReturn(curve, m, h, 0);
        if (ex != null) { val = ex; }
        else { val = carry(curve, m, h); co = val != null; } // 롤다운 미측정 → 캐리만(†)
        // 랭크 풀: 스테일·carryOnly 제외한 full-excess만 (수정 ①·결정 ①)
        if (sector !== KTB && !st && !co && val != null) excessPool.push(val);
      } else { // pctile — 1년 %ile, 스테일 제외 모수
        const lab = `${sector}_${mat}`;
        let mask = staleMask(series[lab] || []);
        if (mat === '3월' && sector !== KTB) mask = combineMask(mask, staleMask(series[`${KTB}_3월`] || []));
        val = pctile(bpSeriesOf(series, lab), mask, '1y');
      }
      return { val, st, co, m, mat };
    });
  });

  // 2차 패스: 텍스트·색 z (국고행·스테일·carryOnly 셀은 무채색·순위 제외 z=null)
  for (let r = 0; r < rows.length; r++) {
    const isKtb = rows[r] === KTB;
    const vrow = [], trow = [], srow = [], zrow = [], corow = [];
    for (let c = 0; c < cols.length; c++) {
      const { val, st, co } = raw[r][c];
      vrow.push(val); srow.push(st); corow.push(co);
      let txt = '—';
      if (val != null && Number.isFinite(val)) txt = mode === 'excess' ? (val >= 0 ? '+' : '') + val.toFixed(0) : String(Math.round(val));
      trow.push(txt);
      // 색 z: 국고행/스테일/carryOnly/무값 → null(무채색·순위 미반영).
      let z = null;
      if (!isKtb && !st && !co && val != null && Number.isFinite(val)) {
        if (mode === 'excess') z = val < 0 ? -1 : rankPct(excessPool, val); // [-1..1]
        else z = val; // 0..100
      }
      zrow.push(z);
    }
    value.push(vrow); text.push(trow); stale.push(srow); zColor.push(zrow); carryOnly.push(corow);
  }

  return { rows, cols, colsYears, mode, horizon: horizonMonths, value, text, zColor, stale, carryOnly, ktbRowIndex: 0 };
}

// ── 드릴다운 조립 ──
// 반환: { sector, mat, m, spreadBp, pctile1y,
//         horizons:[{months, excess, carry, rolldown}], history:{dates,values,stale}, isKtb }
export function buildDrilldown(DATA, sector, mat) {
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
  return { sector, mat, m, spreadBp: curSpread, pctile1y: p1, horizons, history: hist, isKtb };
}

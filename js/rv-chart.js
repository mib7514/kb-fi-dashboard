// rv-chart.js — Curve RV Plotly 렌더링 (전역 Plotly). curve-rv 페이지 전용(다른 화면 미사용).
//   히트맵(모드별 색·국고행/스테일 무채색·셀 텍스트) + 스프레드 히스토리(스테일 회색 세그먼트).

import { excessBand, COLOR_STEPS } from './rv-heatmap.js';

const COLORS = {
  current: '#58a6ff', accent: '#f0883e', grid: '#21262d', axis: '#484f58',
  text: '#c9d1d9', muted: '#8b949e', grey: '#6e7681', white: '#e6edf3',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CONFIG = { displayModeBar: false, responsive: true };

// %ile(레벨) 색: 낮음(타이트=위험) 적색 → 중립 → 높음(와이드) 청색.
const RISK_SCALE = [[0, '#8b1a1a'], [0.25, '#f85149'], [0.5, '#6e7681'], [0.75, '#399ae6'], [1, '#1f6feb']];
// 기대수익 색(랭크 5단계 이산): 음수 적색 · 하위50% 무채색 · 상위 25~50/10~25/10% 3단 초록.
const EX_NEG = '#8b1a1a', EX_FLAT = '#484f58', EX_G3 = '#1f4a2e', EX_G2 = '#2ea043', EX_G1 = '#3fb950';
const EX_BORDER = '#56d364'; // 상위 10% 강조 테두리
// COLOR_STEPS(상위 누적 비율)로부터 이산 step colorscale 생성. z∈[-1,1], t=(z+1)/2.
//   음수(z=-1)만 t=0. 양수 랭크 z는 밴드 경계 1-c/1-b/1-a에서 색이 계단식으로 바뀐다.
function excessColorscale([a, b, c]) {
  const tz = (z) => (z + 1) / 2;
  const t0 = tz(0), t3 = tz(1 - c), t2 = tz(1 - b), t1 = tz(1 - a); // flat/g3/g2/g1 시작점
  return [
    [0, EX_NEG], [t0, EX_NEG],
    [t0, EX_FLAT], [t3, EX_FLAT],
    [t3, EX_G3], [t2, EX_G3],
    [t2, EX_G2], [t1, EX_G2],
    [t1, EX_G1], [1, EX_G1],
  ];
}

// ── 히트맵 ── data: { rows, cols, z(null=무채색), text, text2(분해 2줄째|null), stale, carryOnly, mode, ktbRowIndex }
export function renderHeatmap(el, data, onSelect) {
  const { rows, cols, z, text, text2, stale, carryOnly, mode, ktbRowIndex } = data;
  const isExcess = mode === 'excess';
  const trace = {
    type: 'heatmap', x: cols, y: rows, z,
    colorscale: isExcess ? excessColorscale(COLOR_STEPS) : RISK_SCALE,
    zmin: isExcess ? -1 : 0, zmax: isExcess ? 1 : 100,
    xgap: 2, ygap: 2, showscale: false,
    hoverongaps: true,
    customdata: text,
    hovertemplate: '%{y} · %{x}<br>' + (isExcess ? '기대수익 %{customdata}bp' : '%ile %{customdata}') + '<extra></extra>',
  };
  // 셀 텍스트를 annotation으로 (색: 국고행/스테일=회색, 그 외=흰색)
  const annotations = [];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
    let t = text[r][c];
    if (t == null || t === '') continue;
    const isStale = stale && stale[r][c];
    const isCarryOnly = carryOnly && carryOnly[r][c];
    const grey = r === ktbRowIndex || isStale || isCarryOnly;
    if (isStale) t += '*';
    if (isCarryOnly) t += '†';
    // 분해 2줄째(소형) — text2가 있으면 줄바꿈해 이어붙임. 색은 1줄과 동조(grey/무채).
    const t2 = text2 && text2[r] ? text2[r][c] : null;
    if (t2) t += `<br><span style="font-size:8.5px;color:${grey ? COLORS.grey : COLORS.muted}">${t2}</span>`;
    annotations.push({
      x: cols[c], y: rows[r], xref: 'x', yref: 'y', text: t,
      showarrow: false, font: { size: 10.5, family: FONT, color: grey ? COLORS.grey : COLORS.white },
    });
  }
  // 상위 10%(g1) 셀 강조 테두리 (excess 모드만). 카테고리축 데이터좌표(인덱스±0.5)로 rect.
  const shapes = [];
  if (isExcess) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
      if (excessBand(z[r][c]) === 'g1') shapes.push({
        type: 'rect', xref: 'x', yref: 'y', x0: c - 0.5, x1: c + 0.5, y0: r - 0.5, y1: r + 0.5,
        line: { color: EX_BORDER, width: 2 }, fillcolor: 'rgba(0,0,0,0)', layer: 'above',
      });
    }
  }
  const layout = {
    paper_bgcolor: 'transparent', plot_bgcolor: '#0d1117',
    font: { color: COLORS.muted, family: FONT, size: 11 },
    xaxis: { side: 'top', gridcolor: 'transparent', linecolor: COLORS.axis, tickfont: { size: 11 }, type: 'category' },
    yaxis: { autorange: 'reversed', gridcolor: 'transparent', linecolor: COLORS.axis, tickfont: { size: 10 }, type: 'category' },
    margin: { l: 92, r: 20, t: 40, b: 16 }, showlegend: false, hovermode: 'closest', annotations, shapes,
  };
  Plotly.react(el, [trace], layout, CONFIG);
  if (onSelect && !el._rvBound) {
    el._rvBound = true;
    el.on('plotly_click', (ev) => {
      const p = ev.points && ev.points[0];
      if (p && p.y && p.x) onSelect(p.y, p.x);
    });
  }
}

// ── 스프레드 히스토리 (최근 1년, 스테일 구간 회색 점선) ──
// data: { dates, values(bp|null), stale(bool[]), current, title }
export function renderHistory(el, data) {
  const { dates, values, stale } = data;
  // 정상 세그먼트(파랑 실선) / 스테일 세그먼트(회색 점선) 분리 — 스테일 점만 남긴 시리즈.
  const normal = values.map((v, i) => (stale && stale[i]) ? null : v);
  const staleY = values.map((v, i) => (stale && stale[i]) ? v : null);
  const traces = [
    { x: dates, y: normal, name: '스프레드', mode: 'lines', line: { color: COLORS.current, width: 1.6 }, connectgaps: false },
    { x: dates, y: staleY, name: '스테일', mode: 'lines', line: { color: COLORS.grey, width: 1.6, dash: 'dot' }, connectgaps: false },
  ];
  const layout = {
    title: { text: data.title || '스프레드 히스토리 (bp)', font: { color: COLORS.text, size: 12, family: FONT }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { color: COLORS.muted, family: FONT, size: 10 },
    xaxis: { gridcolor: COLORS.grid, linecolor: COLORS.axis, tickfont: { size: 9 } },
    yaxis: { title: { text: 'bp', font: { size: 9 } }, gridcolor: COLORS.grid, linecolor: COLORS.axis, tickfont: { size: 9 } },
    margin: { l: 46, r: 14, t: 28, b: 28 }, showlegend: false, hovermode: 'x',
  };
  if (typeof data.current === 'number' && Number.isFinite(data.current)) {
    layout.shapes = [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: data.current, y1: data.current, line: { color: COLORS.accent, width: 1, dash: 'dash' } }];
    layout.annotations = [{ xref: 'paper', x: 1, xanchor: 'right', y: data.current, yanchor: 'bottom', text: `현재 ${data.current.toFixed(1)}`, showarrow: false, font: { color: COLORS.accent, size: 9 } }];
  }
  Plotly.react(el, traces, layout, CONFIG);
}

export { COLORS };

// rv-chart.js — Curve RV Plotly 렌더링 (전역 Plotly). curve-rv 페이지 전용(다른 화면 미사용).
//   히트맵(모드별 색·국고행/스테일 무채색·셀 텍스트) + 스프레드 히스토리(스테일 회색 세그먼트).

const COLORS = {
  current: '#58a6ff', accent: '#f0883e', grid: '#21262d', axis: '#484f58',
  text: '#c9d1d9', muted: '#8b949e', grey: '#6e7681', white: '#e6edf3',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CONFIG = { displayModeBar: false, responsive: true };

// %ile(레벨) 색: 낮음(타이트=위험) 적색 → 중립 → 높음(와이드) 청색.
const RISK_SCALE = [[0, '#8b1a1a'], [0.25, '#f85149'], [0.5, '#6e7681'], [0.75, '#399ae6'], [1, '#1f6feb']];
// 기대수익 색(랭크): 음수 적색 → 하위 무채색 → 상위 초록. z∈[-1,1], t=(z+1)/2.
const EXCESS_SCALE = [[0, '#8b1a1a'], [0.49, '#da3633'], [0.5, '#484f58'], [0.75, '#2ea043'], [1, '#3fb950']];

// ── 히트맵 ── data: { rows, cols, z(null=무채색), text, stale, carryOnly, mode, ktbRowIndex }
export function renderHeatmap(el, data, onSelect) {
  const { rows, cols, z, text, stale, carryOnly, mode, ktbRowIndex } = data;
  const isExcess = mode === 'excess';
  const trace = {
    type: 'heatmap', x: cols, y: rows, z,
    colorscale: isExcess ? EXCESS_SCALE : RISK_SCALE,
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
    annotations.push({
      x: cols[c], y: rows[r], xref: 'x', yref: 'y', text: t,
      showarrow: false, font: { size: 10.5, family: FONT, color: grey ? COLORS.grey : COLORS.white },
    });
  }
  const layout = {
    paper_bgcolor: 'transparent', plot_bgcolor: '#0d1117',
    font: { color: COLORS.muted, family: FONT, size: 11 },
    xaxis: { side: 'top', gridcolor: 'transparent', linecolor: COLORS.axis, tickfont: { size: 11 }, type: 'category' },
    yaxis: { autorange: 'reversed', gridcolor: 'transparent', linecolor: COLORS.axis, tickfont: { size: 10 }, type: 'category' },
    margin: { l: 92, r: 20, t: 40, b: 16 }, showlegend: false, hovermode: 'closest', annotations,
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

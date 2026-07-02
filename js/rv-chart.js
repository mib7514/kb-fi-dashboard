// rv-chart.js — Curve RV Plotly 렌더링. 전역 Plotly 사용 (vendor/plotly.min.js 선로드).
// 기존 chart.js의 다크 테마·baseLayout 패턴 답습.

const COLORS = {
  current: '#58a6ff',   // 현재 (파랑)
  prior: '#8b949e',     // 1년 전 (회색)
  band: '#30363d',      // 3y min~max 밴드
  accent: '#f0883e',
  marker: '#f0883e',
  grid: '#21262d',
  axis: '#484f58',
  text: '#c9d1d9',
  muted: '#8b949e',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CONFIG = { displayModeBar: false, responsive: true };

// 위험 우선 색상: 낮은 %ile(타이트=위험) 적색 → 중간 중립 → 높은 %ile(와이드=저평가) 청색
const RISK_SCALE = [
  [0.00, '#8b1a1a'],
  [0.25, '#f85149'],
  [0.50, '#6e7681'],
  [0.75, '#399ae6'],
  [1.00, '#1f6feb'],
];

function baseLayout(title, yTitle, extra = {}) {
  return {
    title: { text: title, font: { color: COLORS.text, size: 13, family: FONT }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: COLORS.muted, family: FONT, size: 11 },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, tickfont: { size: 10 }, ...(extra.xaxis || {}) },
    yaxis: { title: { text: yTitle, font: { size: 10 } }, gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, tickfont: { size: 10 }, ...(extra.yaxis || {}) },
    margin: { l: 52, r: 16, t: 34, b: 36 },
    showlegend: extra.showlegend !== undefined ? extra.showlegend : true,
    legend: { orientation: 'h', y: -0.18, font: { size: 10 }, bgcolor: 'transparent' },
    hovermode: extra.hovermode || 'x unified',
    ...extra.layout,
  };
}

// ── [0] 섹터×만기 히트맵 ──
// grid: { sectors:[...14], maturities:[...5], z:[[pct|null,...],...] }, onSelect(sector)
export function renderHeatmap(el, grid, onSelect) {
  const text = grid.z.map(row => row.map(v => (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v).toString() : '—'));
  const trace = {
    type: 'heatmap',
    x: grid.maturities, y: grid.sectors, z: grid.z,
    text, texttemplate: '%{text}', textfont: { size: 11, family: FONT, color: '#e6edf3' },
    colorscale: RISK_SCALE, zmin: 0, zmax: 100,
    xgap: 2, ygap: 2,
    hovertemplate: '%{y} · %{x}<br>%ile %{z:.0f}<extra></extra>',
    colorbar: { title: { text: '%ile', font: { size: 9, color: COLORS.muted } }, tickfont: { size: 9, color: COLORS.muted }, thickness: 10, len: 0.9, outlinewidth: 0 },
  };
  const layout = baseLayout('섹터 × 만기 percentile 히트맵 (행 클릭 → 상세)', '', {
    showlegend: false, hovermode: 'closest',
    yaxis: { autorange: 'reversed', tickfont: { size: 10 }, gridcolor: 'transparent', linecolor: COLORS.axis },
    xaxis: { side: 'top', gridcolor: 'transparent', linecolor: COLORS.axis, tickfont: { size: 11 } },
    layout: { margin: { l: 92, r: 40, t: 44, b: 20 } },
  });
  Plotly.react(el, [trace], layout, CONFIG);
  if (onSelect && !el._rvBound) {
    el._rvBound = true;
    el.on('plotly_click', (ev) => {
      const p = ev.points && ev.points[0];
      if (p && p.y) onSelect(p.y);
    });
  }
}

// ── [2] 스프레드 텀스트럭처: 현재 커브 + 1년 전 + 3y min~max 밴드 ──
// data: { maturities:[1,2,3,5,10], current:[..bp], prior:[..bp], lo:[..bp], hi:[..bp] }
export function renderTermStructure(el, data) {
  const x = data.maturities;
  const traces = [
    // 밴드: lo → hi 채우기
    { x, y: data.lo, name: '3y min', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
    { x, y: data.hi, name: '3y min~max', mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(88,166,255,0.10)', hoverinfo: 'skip' },
    { x, y: data.prior, name: '1년 전', mode: 'lines+markers', line: { color: COLORS.prior, width: 1.5, dash: 'dot' }, marker: { size: 5 } },
    { x, y: data.current, name: '현재', mode: 'lines+markers', line: { color: COLORS.current, width: 2 }, marker: { size: 7 } },
  ];
  const layout = baseLayout('스프레드 텀스트럭처 (bp)', 'bp', {
    hovermode: 'x unified',
    xaxis: { type: 'category', gridcolor: COLORS.grid, linecolor: COLORS.axis, tickfont: { size: 10 } },
  });
  Plotly.react(el, traces, layout, CONFIG);
}

// ── 스프레드 히스토리 (상세 / 페어) : 전 기간 + 현재값 표시선 ──
// data: { dates:[...], values:[...bp|null], current:number|null, title, yTitle }
export function renderHistory(el, data) {
  const traces = [{
    x: data.dates, y: data.values, name: data.name || '스프레드', mode: 'lines',
    line: { color: COLORS.current, width: 1.4 }, connectgaps: false,
  }];
  const layout = baseLayout(data.title || '스프레드 히스토리 (bp)', data.yTitle || 'bp', { showlegend: false, hovermode: 'x' });
  if (typeof data.current === 'number' && Number.isFinite(data.current)) {
    layout.shapes = [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: data.current, y1: data.current, line: { color: COLORS.accent, width: 1, dash: 'dash' } }];
    layout.annotations = [{ xref: 'paper', x: 1, xanchor: 'right', y: data.current, yanchor: 'bottom', text: `현재 ${data.current.toFixed(1)}`, showarrow: false, font: { color: COLORS.accent, size: 9 } }];
  }
  Plotly.react(el, traces, layout, CONFIG);
}

export { COLORS };

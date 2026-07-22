// cp-charts.js — Curve Phase Monitor 차트 렌더링(Plotly, vendor 전역). ES module.
//   사이트 공용 토큰·baseLayout 규약 준수. DESIGN.md: 모든 시계열 차트 끝점 값 라벨 필수(동적 바인딩).
//   Phase 2: 프라이싱 갭 스프레드(bp) 다선 차트. 룩백 슬라이스는 세션수 기준.

export const C = {
  accent: '#58a6ff', up: '#3fb950', amber: '#f0883e', red: '#f85149', purple: '#a371f7',
  grid: '#21262d', axis: '#484f58', muted: '#8b949e', text: '#c9d1d9',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// 룩백 → 세션수(영업일). all 은 전체.
export const LOOKBACKS = ['1y', '3y', '10y', 'all'];
export const LOOKBACK_LABEL = { '1y': '1Y', '3y': '3Y', '10y': '10Y', all: '전체' };
const SESSIONS = { '1y': 252, '3y': 756, '10y': 2520 };
export const sliceLookback = (data, lookback) =>
  (lookback === 'all' ? data : data.slice(-(SESSIONS[lookback] || data.length)));

const baseLayout = (extra = {}) => ({
  paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
  font: { color: C.muted, family: FONT, size: 11 },
  margin: { l: 48, r: 54, t: 10, b: 32 }, // r 여유 = 끝점 라벨 공간
  legend: { orientation: 'h', x: 0, y: 1.1, font: { size: 11 } },
  hovermode: 'x unified',
  xaxis: { type: 'date', gridcolor: C.grid, linecolor: C.axis, zeroline: false, tickfont: { size: 10 } },
  yaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: true, zerolinecolor: C.axis, tickfont: { size: 10 },
    title: { text: 'bp', font: { size: 11 } } },
  ...extra,
});

// 끝점 값 라벨(DESIGN.md 필수). 여러 라벨이 겹치면 세로로 최소 간격 벌림.
function endpointAnnotations(traces, dp) {
  const pts = traces
    .filter((t) => t.x.length)
    .map((t) => ({ x: t.x[t.x.length - 1], y: t.y[t.y.length - 1], color: t.line.color }))
    .sort((a, b) => b.y - a.y);
  return pts.map((p) => ({
    x: p.x, y: p.y, xref: 'x', yref: 'y',
    text: `${p.y > 0 ? '+' : ''}${p.y.toFixed(dp)}`,
    showarrow: false, xanchor: 'left', xshift: 6,
    font: { family: FONT, size: 10.5, color: p.color },
  }));
}

// lines: [{ name, color, data:[[date,val]] }]. unit: 'bp'(정수1자리)|'%'(2자리). divId 에 렌더.
export function renderSpreadChart(divId, lines, lookback, unit = 'bp') {
  const dp = unit === 'bp' ? 1 : 2;
  const traces = lines.map((l) => {
    const d = sliceLookback(l.data, lookback);
    return {
      x: d.map((r) => r[0]), y: d.map((r) => r[1]), name: l.name, mode: 'lines',
      line: { color: l.color, width: 1.7 },
      hovertemplate: `%{x|%Y-%m-%d}<br>${l.name} %{y:.${dp}f}${unit}<extra></extra>`,
    };
  });
  Plotly.newPlot(divId,
    traces,
    baseLayout({ annotations: endpointAnnotations(traces, dp), yaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: true, zerolinecolor: C.axis, tickfont: { size: 10 }, title: { text: unit, font: { size: 11 } } } }),
    { displayModeBar: false, responsive: true });
}

// 기울기 변화 분해 누적 막대(bp). points: [{date, total, ...}], comps: [{key,name,color}](누적 대상).
//   막대는 상대 누적(barmode:relative, +위/−아래), 합계는 선으로 오버레이 + 끝점 라벨.
export function renderDecompChart(divId, points, comps) {
  const x = points.map((p) => p.date);
  const traces = comps.map((c) => ({
    x, y: points.map((p) => p[c.key]), name: c.name, type: 'bar',
    marker: { color: c.color },
    hovertemplate: `%{x|%Y-%m-%d}<br>${c.name} %{y:.1f}bp<extra></extra>`,
  }));
  const total = points.map((p) => p.total);
  traces.push({
    x, y: total, name: 'Δ 합계', type: 'scatter', mode: 'lines',
    line: { color: C.text, width: 1.3 },
    hovertemplate: `%{x|%Y-%m-%d}<br>Δ 합계 %{y:.1f}bp<extra></extra>`,
  });
  const anno = x.length ? [{
    x: x[x.length - 1], y: total[total.length - 1], xref: 'x', yref: 'y',
    text: `${total[total.length - 1] > 0 ? '+' : ''}${total[total.length - 1].toFixed(1)}`,
    showarrow: false, xanchor: 'left', xshift: 6, font: { family: FONT, size: 10.5, color: C.text },
  }] : [];
  Plotly.newPlot(divId, traces,
    baseLayout({ barmode: 'relative', annotations: anno }),
    { displayModeBar: false, responsive: true });
}

// 사이클 오버레이: x=세션 오프셋(T=0 대비), y=기울기 bp. 현재=굵은 선, 과거=반투명, 참고=점선.
//   overlays: [{ label, color, current, ref, points:[{offset,bp}] }].
export function renderOverlayChart(divId, overlays) {
  const traces = overlays.filter((o) => o.points.length).map((o) => ({
    x: o.points.map((p) => p.offset), y: o.points.map((p) => p.bp), name: o.label, mode: 'lines',
    line: { color: o.color, width: o.current ? 2.6 : 1.4, dash: o.ref ? 'dot' : 'solid' },
    opacity: o.current ? 1 : 0.5,
    hovertemplate: `T%{x:+d}세션<br>${o.label} %{y:.1f}bp<extra></extra>`,
  }));
  const layout = baseLayout({
    shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: 0, x1: 0, y0: 0, y1: 1,
      line: { color: C.axis, width: 1, dash: 'dash' } }],
    xaxis: { type: 'linear', gridcolor: C.grid, linecolor: C.axis, zeroline: false, tickfont: { size: 10 },
      title: { text: 'T=0(첫 인상일) 대비 세션(영업일)', font: { size: 11 } } },
  });
  Plotly.newPlot(divId, traces, layout, { displayModeBar: false, responsive: true });
}

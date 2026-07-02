// chart.js — Plotly 렌더링. calc.js의 ForecastResult를 받아 3종 차트를 그림.
// 전역 Plotly 사용 (vendor/plotly.min.js가 먼저 로드됨).

const COLORS = {
  history: '#58a6ff',      // 실측 (파랑)
  forecast: '#f0883e',     // 전망 (주황)
  guide: '#8b949e',        // 시즈널 가이드 (회색)
  comparison: '#bc8cff',   // 비교 시나리오 (보라)
  target: '#3fb950',       // 물가목표선 (초록)
  grid: '#21262d',
  axis: '#484f58',
  text: '#c9d1d9',
  muted: '#8b949e',
};

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function baseLayout(title, yTitle, extra = {}) {
  return {
    title: { text: title, font: { color: COLORS.text, size: 13, family: FONT }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: COLORS.muted, family: FONT, size: 11 },
    xaxis: {
      gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
      tickfont: { size: 10 }, ...(extra.xaxis || {}),
    },
    yaxis: {
      title: { text: yTitle, font: { size: 10 } },
      gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
      tickfont: { size: 10 }, ...(extra.yaxis || {}),
    },
    margin: { l: 52, r: 16, t: 34, b: 36 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.16, font: { size: 10 }, bgcolor: 'transparent' },
    hovermode: 'x unified',
    ...extra.layout,
  };
}

const CONFIG = { displayModeBar: false, responsive: true };

function xy(points) {
  return { x: points.map((p) => p.period), y: points.map((p) => p.value) };
}

// forecast를 history 마지막 점과 이어 그리기 위해 연결점 추가.
function bridge(history, forecast) {
  if (history.length === 0 || forecast.length === 0) return forecast;
  return [history[history.length - 1], ...forecast];
}

// ── Index 차트: 실측 + 전망(점선) ──
export function renderIndexChart(el, result, opts = {}) {
  const { index_history, index_forecast } = result;
  const traces = [
    {
      ...xy(index_history), name: '실측', mode: 'lines',
      line: { color: COLORS.history, width: 1.8 },
    },
  ];
  if (index_forecast.length > 0) {
    traces.push({
      ...xy(bridge(index_history, index_forecast)), name: '전망', mode: 'lines',
      line: { color: COLORS.forecast, width: 1.8, dash: 'dot' },
    });
  }
  if (opts.comparisonForecast && opts.comparisonForecast.length > 0) {
    traces.push({
      ...xy(bridge(index_history, opts.comparisonForecast)),
      name: opts.comparisonLabel || '비교', mode: 'lines',
      line: { color: COLORS.comparison, width: 1.5, dash: 'dashdot' },
    });
  }
  Plotly.react(el, traces, baseLayout('Index (2020=100)', 'index', {
    xaxis: opts.xRange ? { range: opts.xRange } : {},
  }), CONFIG);
}

// ── m-m 차트: 실측 m-m(막대) + 시즈널 가이드(선) + 전망 m-m(점) ──
export function renderMmChart(el, result, opts = {}) {
  const { mm_history, mm_forecast, mm_guide_full } = result;
  const recentHist = mm_history.slice(-opts.mmHistoryMonths || -24);

  const traces = [
    {
      ...xy(recentHist), name: '실측 m-m', type: 'bar',
      marker: { color: COLORS.history, opacity: 0.65 },
    },
  ];
  if (mm_guide_full && mm_guide_full.length > 0) {
    traces.push({
      ...xy(mm_guide_full), name: '시즈널 가이드', mode: 'lines',
      line: { color: COLORS.guide, width: 1.4, dash: 'dot' },
    });
  }
  if (mm_forecast.length > 0) {
    traces.push({
      ...xy(mm_forecast), name: '전망 m-m', mode: 'markers',
      marker: { color: COLORS.forecast, size: 6, symbol: 'diamond' },
    });
  }
  Plotly.react(el, traces, baseLayout('전월비 m-m (%)', '% m-m', {
    layout: { bargap: 0.3 },
  }), CONFIG);
}

// ── y-y 차트: 실측 + 전망(점선) + 목표선 ──
export function renderYoyChart(el, result, opts = {}) {
  const { yoy_history, yoy_forecast } = result;
  const histSlice = opts.yyMonths ? yoy_history.slice(-opts.yyMonths) : yoy_history;

  const traces = [
    {
      ...xy(histSlice), name: '실측 y-y', mode: 'lines',
      line: { color: COLORS.history, width: 1.8 },
    },
  ];
  if (yoy_forecast.length > 0) {
    traces.push({
      ...xy(bridge(histSlice, yoy_forecast)), name: '전망 y-y', mode: 'lines',
      line: { color: COLORS.forecast, width: 1.8, dash: 'dot' },
    });
  }
  if (opts.comparisonYoyForecast && opts.comparisonYoyForecast.length > 0) {
    traces.push({
      ...xy(bridge(histSlice, opts.comparisonYoyForecast)),
      name: opts.comparisonLabel || '비교', mode: 'lines',
      line: { color: COLORS.comparison, width: 1.5, dash: 'dashdot' },
    });
  }

  const layout = baseLayout('전년동월비 y-y (%)', '% y-y');
  // 물가목표 2% 수평선
  if (opts.targetLine !== false) {
    layout.shapes = [{
      type: 'line', xref: 'paper', x0: 0, x1: 1,
      y0: opts.target ?? 2, y1: opts.target ?? 2,
      line: { color: COLORS.target, width: 1, dash: 'dash' },
    }];
    layout.annotations = [{
      xref: 'paper', x: 1, xanchor: 'right', y: opts.target ?? 2, yanchor: 'bottom',
      text: `목표 ${opts.target ?? 2}%`, showarrow: false,
      font: { color: COLORS.target, size: 9 },
    }];
  }
  Plotly.react(el, traces, layout, CONFIG);
}

export { COLORS };

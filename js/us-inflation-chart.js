// us-inflation-chart.js — 미국 물가전망 Plotly 렌더.
// chart.js의 COLORS/스타일을 재사용하되, 두 가지가 달라 US 전용으로 둔다:
//   ① 지수 단위 제목이 시리즈마다 다름(1982-84=100 / 2017=100) → 파라미터화.
//   ② 결측월(CPI 2025-10 등)에서 라인을 끊어 gap을 눈에 보이게 → denseXY로 null 삽입.
// 전역 Plotly 사용 (vendor/plotly.min.js 선로드).

import { COLORS } from './chart.js';
import { nextPeriod, comparePeriods } from './calc.js';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CONFIG = { displayModeBar: false, responsive: true };

function baseLayout(title, yTitle, extra = {}) {
  return {
    title: { text: title, font: { color: COLORS.text, size: 13, family: FONT }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: COLORS.muted, family: FONT, size: 11 },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, tickfont: { size: 10 }, ...(extra.xaxis || {}) },
    yaxis: { title: { text: yTitle, font: { size: 10 } }, gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, tickfont: { size: 10 }, ...(extra.yaxis || {}) },
    margin: { l: 52, r: 16, t: 34, b: 36 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.16, font: { size: 10 }, bgcolor: 'transparent' },
    hovermode: 'x unified',
    ...extra.layout,
  };
}

// 연속 month 축으로 펼치되 빠진 달은 y=null → Plotly가 그 지점에서 라인을 끊음(gap 가시화).
function denseXY(points) {
  const s = [...points].sort((a, b) => comparePeriods(a.period, b.period));
  if (s.length === 0) return { x: [], y: [] };
  const map = new Map(s.map((p) => [p.period, p.value]));
  const x = [];
  const y = [];
  let p = s[0].period;
  const end = s[s.length - 1].period;
  while (true) {
    x.push(p);
    y.push(map.has(p) ? map.get(p) : null);
    if (p === end) break;
    p = nextPeriod(p);
  }
  return { x, y };
}

// forecast를 history 마지막 점과 이어 그리기 위한 연결점 추가.
function bridge(history, forecast) {
  if (history.length === 0 || forecast.length === 0) return forecast;
  return [history[history.length - 1], ...forecast];
}

// ── Index 차트: 실측 + 전망(점선). unit은 시리즈 meta.unit. ──
export function renderIndexChart(el, result, opts = {}) {
  const { index_history, index_forecast } = result;
  const traces = [
    { ...denseXY(index_history), name: '실측', mode: 'lines', connectgaps: false, line: { color: COLORS.history, width: 1.8 } },
  ];
  if (index_forecast.length > 0) {
    traces.push({ ...denseXY(bridge(index_history, index_forecast)), name: '전망', mode: 'lines', connectgaps: false, line: { color: COLORS.forecast, width: 1.8, dash: 'dot' } });
  }
  Plotly.react(el, traces, baseLayout(`Index (${opts.unit || 'index'})`, 'index', {
    xaxis: opts.xRange ? { range: opts.xRange } : {},
  }), CONFIG);
}

// ── m-m 차트: 실측 m-m(막대) + 시즈널 가이드(선) + 전망 m-m(점) ──
export function renderMmChart(el, result, opts = {}) {
  const { mm_history, mm_forecast, mm_guide_full } = result;
  const recentHist = mm_history.slice(-(opts.mmHistoryMonths || 24));
  const traces = [
    { ...denseXY(recentHist), name: '실측 m-m', type: 'bar', marker: { color: COLORS.history, opacity: 0.65 } },
  ];
  if (mm_guide_full && mm_guide_full.length > 0) {
    traces.push({ ...denseXY(mm_guide_full), name: '시즈널 가이드', mode: 'lines', connectgaps: false, line: { color: COLORS.guide, width: 1.4, dash: 'dot' } });
  }
  if (mm_forecast.length > 0) {
    traces.push({ ...denseXY(mm_forecast), name: '전망 m-m', mode: 'markers', marker: { color: COLORS.forecast, size: 6, symbol: 'diamond' } });
  }
  Plotly.react(el, traces, baseLayout('전월비 m-m (%)', '% m-m', { layout: { bargap: 0.3 } }), CONFIG);
}

// ── y-y 차트: 실측 + 전망(점선) + 목표선 2%. gap(2025-10/2026-10)은 null로 끊김. ──
export function renderYoyChart(el, result, opts = {}) {
  const { yoy_history, yoy_forecast } = result;
  const histSlice = opts.yyMonths ? yoy_history.slice(-opts.yyMonths) : yoy_history;
  const traces = [
    { ...denseXY(histSlice), name: '실측 y-y', mode: 'lines', connectgaps: false, line: { color: COLORS.history, width: 1.8 } },
  ];
  if (yoy_forecast.length > 0) {
    traces.push({ ...denseXY(bridge(histSlice, yoy_forecast)), name: '전망 y-y', mode: 'lines', connectgaps: false, line: { color: COLORS.forecast, width: 1.8, dash: 'dot' } });
  }
  const layout = baseLayout('전년동월비 y-y (%)', '% y-y');
  if (opts.targetLine !== false) {
    const t = opts.target ?? 2;
    layout.shapes = [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: t, y1: t, line: { color: COLORS.target, width: 1, dash: 'dash' } }];
    layout.annotations = [{ xref: 'paper', x: 1, xanchor: 'right', y: t, yanchor: 'bottom', text: `목표 ${t}%`, showarrow: false, font: { color: COLORS.target, size: 9 } }];
  }
  Plotly.react(el, traces, layout, CONFIG);
}

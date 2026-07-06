// onoff-chart.js — On/Off 스프레드 Plotly 렌더링. 전역 Plotly 사용(vendor/plotly.min.js 선로드).
// 기존 rv-chart.js 의 다크 테마·baseLayout 패턴 답습. 계산은 onoff-calc.js, 여기선 표현만.

import { flySeries, bandStats, orderGenerations } from './onoff-calc.js';

const COLORS = {
  fly: '#58a6ff',      // fly (파랑, 주계열)
  raw: '#8b949e',      // raw (회색)
  slope: '#f0883e',    // slope (주황)
  band: 'rgba(88,166,255,0.10)',
  median: '#8b949e',
  current: '#58a6ff',
  prior: '#6e7681',    // 직전세대 (가는 회색 실선)
  rich: '#3fb950',     // 0 아래 = 지표물 리치(정상)
  cheap: '#f0883e',    // 0 위 = 지표물 저평가(이례)
  grid: '#21262d',
  axis: '#484f58',
  text: '#c9d1d9',
  muted: '#8b949e',
  zero: '#6e7681',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CONFIG = { displayModeBar: false, responsive: true };

const EVENT_COLOR = { 반기말: '#bc8cff', 분기말: '#bc8cff', 입찰: '#3fb950' };

// 이벤트 세로선 + 상단 라벨을 layout 에 주입. xOf(e) → x좌표(Panel A: 날짜, Panel B: day).
function withEvents(layout, events, xOf) {
  if (!events || !events.length) return layout;
  const shapes = events.map(e => ({
    type: 'line', xref: 'x', yref: 'paper', x0: xOf(e), x1: xOf(e), y0: 0, y1: 1,
    line: { color: EVENT_COLOR[e.kind] || COLORS.muted, width: 1, dash: 'dot' }, layer: 'below',
  }));
  const annotations = events.map(e => ({
    x: xOf(e), xref: 'x', y: 1, yref: 'paper', yanchor: 'bottom', xanchor: 'center',
    text: `${e.kind}`, hovertext: `${e.kind} ${e.calendar || e.date} · day${e.day}`, showarrow: false,
    font: { color: EVENT_COLOR[e.kind] || COLORS.muted, size: 9, family: FONT },
  }));
  return { ...layout, shapes: [...(layout.shapes || []), ...shapes], annotations: [...(layout.annotations || []), ...annotations] };
}

function baseLayout(title, yTitle, extra = {}) {
  return {
    title: { text: title, font: { color: COLORS.text, size: 13, family: FONT }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: COLORS.muted, family: FONT, size: 11 },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, tickfont: { size: 10 }, ...(extra.xaxis || {}) },
    yaxis: { title: { text: yTitle, font: { size: 10 } }, gridcolor: COLORS.grid, zerolinecolor: COLORS.zero, linecolor: COLORS.axis, tickfont: { size: 10 }, ...(extra.yaxis || {}) },
    margin: { l: 52, r: 18, t: 34, b: 40 },
    showlegend: extra.showlegend !== undefined ? extra.showlegend : true,
    legend: { orientation: 'h', y: -0.2, font: { size: 10 }, bgcolor: 'transparent' },
    hovermode: extra.hovermode || 'x unified',
    ...extra.layout,
  };
}

// ── Panel A — 답(fly) + 보조설명(raw/slope 토글). 기본은 fly 단독. ──
// raw/slope 는 범례에 존재하되 기본 숨김(legendonly). hover 에는 fly=raw−slope 관계를 병기해
// 숨김 상태에서도 세 값이 함께 보인다. y=0 기준으로 위=저평가(이례)/아래=리치(정상) 라벨.
export function renderDecompose(el, gen, events) {
  const fs = flySeries(gen);
  const cd = fs.dates.map((_, i) => [fs.raw[i], fs.slope[i]]); // hover 병기용 [raw, slope]
  const traces = [
    { x: fs.dates, y: fs.raw, name: '지표−구지표 스프레드(원시)', mode: 'lines', line: { color: COLORS.raw, width: 1.3, dash: 'dot' }, visible: 'legendonly' },
    { x: fs.dates, y: fs.slope, name: '커브 기울기 효과', mode: 'lines', line: { color: COLORS.slope, width: 1.3, dash: 'dot' }, visible: 'legendonly' },
    {
      x: fs.dates, y: fs.fly, name: '커브조정 상대가치(fly)', mode: 'lines', line: { color: COLORS.fly, width: 2.8 },
      customdata: cd, hovertemplate: 'fly %{y:.1f}bp = raw %{customdata[0]:.1f} − slope %{customdata[1]:.1f}<extra></extra>',
    },
  ];
  let layout = baseLayout(`Panel A · 커브조정 상대가치 — ${gen.tag} (vs ${gen.vs} · slope vs ${gen.slopeVs})`, 'bp', {
    hovermode: 'x unified',
    xaxis: { gridcolor: COLORS.grid, linecolor: COLORS.axis, tickfont: { size: 10 } },
    yaxis: { title: { text: 'bp', font: { size: 10 } }, gridcolor: COLORS.grid, zerolinecolor: COLORS.zero, zerolinewidth: 1.6, linecolor: COLORS.axis, tickfont: { size: 10 } },
    layout: { margin: { l: 52, r: 118, t: 34, b: 40 } }, // 우측 여백 = 영역 해석 라벨
  });
  // 영역 해석 라벨(우측 여백)
  layout.annotations = [
    { xref: 'paper', x: 1.005, xanchor: 'left', yref: 'paper', y: 0.97, yanchor: 'top', align: 'left', text: '▲ 0 위<br>지표물<br>저평가(이례)', showarrow: false, font: { color: COLORS.cheap, size: 9, family: FONT } },
    { xref: 'paper', x: 1.005, xanchor: 'left', yref: 'paper', y: 0.03, yanchor: 'bottom', align: 'left', text: '▼ 0 아래<br>지표물<br>리치(정상)', showarrow: false, font: { color: COLORS.rich, size: 9, family: FONT } },
  ];
  layout = withEvents(layout, events, e => e.date); // Panel A x=날짜
  Plotly.react(el, traces, layout, CONFIG);
}

// ── Panel B — 이벤트타임 세대 비교: 과거 p25–p75 밴드 + median 점선 + 직전세대 실선 + 선택 세대 강조선 ──
// gens 전체, selectedTag 는 강조/제외 대상. band day 범위 = 선택 세대 길이(사이클 horizon).
// 직전세대 = 정렬상 선택 세대 바로 뒤(과거) 세대. 자기 길이 전체를 그리되 x축 범위는 선택 세대
// horizon 유지(직전세대가 더 길면 잘림 허용).
export function renderEventTime(el, gens, selectedTag, events) {
  const sel = gens.find(g => g.tag === selectedTag);
  if (!sel) { Plotly.react(el, [], baseLayout('Panel B', 'bp'), CONFIG); return; }
  const maxDay = sel.series.length;
  const days = [], lo = [], hi = [], med = [];
  for (let d = 0; d < maxDay; d++) {
    const b = bandStats(gens, d, { excludeTag: selectedTag });
    days.push(d);
    lo.push(b.n >= 3 ? b.p25 : null);
    hi.push(b.n >= 3 ? b.p75 : null);
    med.push(b.n >= 3 ? b.median : null);
  }
  const selFly = sel.series.map(r => r[3]);
  const selDates = sel.series.map(r => r[0]);

  // 직전세대(선택 세대 바로 뒤)
  const ordered = orderGenerations(gens);
  const selIdx = ordered.findIndex(g => g.tag === selectedTag);
  const prior = (selIdx >= 0 && selIdx + 1 < ordered.length) ? ordered[selIdx + 1] : null;

  const traces = [
    { x: days, y: lo, name: 'p25', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false, connectgaps: false },
    { x: days, y: hi, name: '과거세대 p25–p75', mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: COLORS.band, hoverinfo: 'skip', connectgaps: false },
    { x: days, y: med, name: '과거세대 median', mode: 'lines', line: { color: COLORS.median, width: 1.3, dash: 'dot' }, connectgaps: false },
  ];
  if (prior) {
    traces.push({
      x: prior.series.map((_, i) => i), y: prior.series.map(r => r[3]),
      name: `직전세대(${prior.tag})`, mode: 'lines', line: { color: COLORS.prior, width: 1.2 },
      customdata: prior.series.map(r => r[0]), hovertemplate: `day %{x} · ${prior.tag} %{customdata}<br>fly %{y:.1f}bp<extra></extra>`,
    });
  }
  traces.push({
    x: days, y: selFly, name: `${selectedTag} (선택)`, mode: 'lines+markers',
    line: { color: COLORS.current, width: 2.2 }, marker: { size: 4 },
    customdata: selDates, hovertemplate: 'day %{x} · %{customdata}<br>fly %{y:.1f}bp<extra></extra>',
  });

  let layout = baseLayout(`Panel B · 이벤트타임 세대 비교 — ${selectedTag} vs 과거 ${gens.length - 1}세대`, 'fly bp', {
    hovermode: 'x unified',
    // x축 범위 = 선택 세대 horizon 고정(직전세대가 더 길면 잘림 허용)
    xaxis: { title: { text: '민평 개시 후 영업일(day)', font: { size: 10 } }, gridcolor: COLORS.grid, linecolor: COLORS.axis, tickfont: { size: 10 }, range: [-0.5, maxDay - 0.5] },
  });
  layout = withEvents(layout, events, e => e.day); // Panel B x=day 인덱스
  Plotly.react(el, traces, layout, CONFIG);
}

export { COLORS };

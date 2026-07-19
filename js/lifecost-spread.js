// lifecost-spread.js — 생활물가 실적 스프레드 패널 (전망 없음, 실적 전용).
// buildForecast/v1 엔진 미사용. calc.js의 computeYY만 import(수정 없음)해 실적 y/y를 뽑고,
// 총지수 대비 두 스프레드(생활물가−총지수, 근원−총지수)를 계산·표시한다.
// 데이터: window.FENRIR_SERIES 레지스트리 (file:// 호환). 생활물가 파일 없으면 안내만.

import { computeYY } from './calc.js';
import { getSeriesData, getConfig } from './series-config.js';
import { COLORS } from './chart.js';

const ID = { headline: 'kr-cpi-headline', core: 'kr-cpi-core', lifecost: 'kr-cpi-lifecost' };
const RANGE_MONTHS = { '5y': 60, '10y': 120, all: Infinity };

const state = { range: '5y' };

// ── 유틸 ──
function fmtSigned(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d);
}
function fmt(v, d = 2) {
  return (typeof v !== 'number' || !Number.isFinite(v)) ? '—' : v.toFixed(d);
}
function krMonth(period) {
  const m = /^\d{4}-(\d{2})$/.exec(period || '');
  return m ? `${Number(m[1])}월` : (period ?? '');
}
function minusMonths(period, n) {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) - n;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

// 실적 y/y 맵 (period → % y-y). 데이터 없으면 null.
function yoyMap(id) {
  const entry = getSeriesData(id);
  if (!entry || !Array.isArray(entry.series) || entry.series.length === 0) return null;
  return new Map(computeYY(entry.series).map((p) => [p.period, p.value]));
}

// A − B (%p), 두 맵 모두 값이 있는 기간만. period 오름차순.
function spread(mapA, mapB) {
  const out = [];
  for (const [period, va] of mapA) {
    const vb = mapB.get(period);
    if (vb === undefined || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
    out.push({ period, value: va - vb });
  }
  out.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  return out;
}

function clampRange(series, latestPeriod) {
  const n = RANGE_MONTHS[state.range];
  if (!Number.isFinite(n)) return series;
  const cutoff = minusMonths(latestPeriod, n - 1);
  return series.filter((p) => p.period >= cutoff);
}

// ── 렌더: 데이터 없음 안내 ──
function renderNotice(msg) {
  const conc = document.getElementById('lifecost-conclusion');
  const cards = document.getElementById('lifecost-cards');
  const chart = document.getElementById('lifecost-chart');
  if (conc) conc.innerHTML = '';
  if (cards) cards.innerHTML = `<div class="notice">${msg}</div>`;
  if (chart) { if (window.Plotly) window.Plotly.purge(chart); chart.innerHTML = ''; }
}

// ── 렌더: 한 줄 결론 ──
function renderConclusion(spLife) {
  const el = document.getElementById('lifecost-conclusion');
  if (!el) return;
  const last = spLife[spLife.length - 1];
  const prev = spLife[spLife.length - 2];
  if (!last) { el.innerHTML = ''; return; }
  const dir = !prev ? '유지'
    : (last.value - prev.value) > 0.05 ? '확대'
    : (last.value - prev.value) < -0.05 ? '축소' : '유지';
  const hl = last.value >= 0 ? '높음' : '낮음';
  const prevTxt = prev ? ` (전월 ${fmtSigned(prev.value, 1)}%p)` : '';
  el.innerHTML =
    `${krMonth(last.period)} 생활물가는 총지수보다 <strong>${fmtSigned(last.value, 1)}%p</strong> ${hl}` +
    ` — 체감 괴리 <strong class="dir-${dir}">${dir}</strong>${prevTxt}`;
}

// ── 렌더: 최신값 카드 (y/y 3종 + 스프레드 2종, 전월 병기) ──
function renderCards(hl, core, life, spLife, spCore) {
  const el = document.getElementById('lifecost-cards');
  if (!el) return;
  const period = spLife[spLife.length - 1]?.period;
  const prevPeriod = period ? minusMonths(period, 1) : null;
  const val = (map, p) => (map && p != null ? map.get(p) : undefined);
  const sVal = (arr, back = 0) => arr[arr.length - 1 - back]?.value;

  const cards = [
    { label: '총지수 y-y', now: val(hl, period), prev: val(hl, prevPeriod), unit: '%', d: 2 },
    { label: '근원 y-y', now: val(core, period), prev: val(core, prevPeriod), unit: '%', d: 2 },
    { label: '생활물가 y-y', now: val(life, period), prev: val(life, prevPeriod), unit: '%', d: 2 },
    { label: '생활물가 − 총지수', now: sVal(spLife, 0), prev: sVal(spLife, 1), unit: '%p', d: 2, accent: true },
    { label: '근원 − 총지수', now: sVal(spCore, 0), prev: sVal(spCore, 1), unit: '%p', d: 2 },
  ];

  el.innerHTML = cards.map((c) => `
    <div class="stat${c.accent ? ' stat-accent' : ''}">
      <div class="stat-label">${c.label}</div>
      <div class="stat-main">${fmtSigned(c.now, c.d)}<span class="stat-unit">${c.unit}</span></div>
      <div class="stat-sub">전월 ${fmtSigned(c.prev, c.d)}${c.unit}</div>
    </div>`).join('');
}

// ── 렌더: 스프레드 시계열 (두 라인 + 0 기준선 + 끝점 값 라벨) ──
function renderChart(spLifeFull, spCoreFull) {
  const el = document.getElementById('lifecost-chart');
  if (!el || !window.Plotly) return;
  const latestPeriod = spLifeFull[spLifeFull.length - 1]?.period
    ?? spCoreFull[spCoreFull.length - 1]?.period;
  const spLife = clampRange(spLifeFull, latestPeriod);
  const spCore = clampRange(spCoreFull, latestPeriod);

  const line = (pts) => ({ x: pts.map((p) => p.period), y: pts.map((p) => p.value) });
  const traces = [
    { ...line(spLife), name: '생활물가 − 총지수', mode: 'lines', line: { color: COLORS.forecast, width: 1.8 } },
    { ...line(spCore), name: '근원 − 총지수', mode: 'lines', line: { color: COLORS.comparison, width: 1.6, dash: 'dot' } },
  ];

  // 끝점 값 라벨 (DESIGN.md). 두 라벨이 가까우면 세로로 벌림.
  const endpoints = [
    { pt: spLife[spLife.length - 1], color: COLORS.forecast },
    { pt: spCore[spCore.length - 1], color: COLORS.comparison },
  ].filter((e) => e.pt);
  let yshift = [0, 0];
  if (endpoints.length === 2 && Math.abs(endpoints[0].pt.value - endpoints[1].pt.value) < 0.15) {
    yshift = endpoints[0].pt.value >= endpoints[1].pt.value ? [9, -9] : [-9, 9];
  }
  const annotations = endpoints.map((e, i) => ({
    x: e.pt.period, y: e.pt.value, xanchor: 'left', yanchor: 'middle',
    xshift: 6, yshift: yshift[i],
    text: `${fmtSigned(e.pt.value, 1)}%p`, showarrow: false,
    font: { color: e.color, size: 10, family: 'ui-monospace, Menlo, monospace' },
  }));

  const layout = {
    title: { text: '총지수 대비 스프레드 (%p) — 실적', font: { color: COLORS.text, size: 13 }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { color: COLORS.muted, family: 'ui-monospace, Menlo, monospace', size: 11 },
    xaxis: { gridcolor: COLORS.grid, linecolor: COLORS.axis, tickfont: { size: 10 } },
    yaxis: { title: { text: '%p', font: { size: 10 } }, gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, tickfont: { size: 10 } },
    margin: { l: 50, r: 54, t: 34, b: 36 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.16, font: { size: 10 }, bgcolor: 'transparent' },
    hovermode: 'x unified',
    shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: COLORS.axis, width: 1, dash: 'dash' } }],
    annotations,
  };
  window.Plotly.react(el, traces, layout, { displayModeBar: false, responsive: true });
}

// ── 메인 ──
function renderAll() {
  const hl = yoyMap(ID.headline);
  const life = yoyMap(ID.lifecost);
  const core = yoyMap(ID.core);

  // 생활물가(+총지수)가 없으면 섹션 전체를 안내로 대체.
  if (!life) {
    const name = getConfig(ID.lifecost)?.display_name ?? '생활물가지수';
    renderNotice(`<strong>${name}</strong> — 데이터 파일 없음. admin.html에서 KOSIS CSV를 파싱해 <span class="k">data/kr-cpi-lifecost.js</span>를 생성·커밋하면 이 섹션이 활성화됩니다.`);
    return;
  }
  if (!hl) { renderNotice('총지수(kr-cpi-headline) 데이터가 없어 스프레드를 계산할 수 없습니다.'); return; }

  const spLife = spread(life, hl);
  const spCore = core ? spread(core, hl) : [];
  if (spLife.length === 0) { renderNotice('생활물가·총지수의 공통 기간이 없어 스프레드를 계산할 수 없습니다.'); return; }

  renderConclusion(spLife);
  renderCards(hl, core, life, spLife, spCore);
  renderChart(spLife, spCore);
}

function bindControls() {
  const seg = document.getElementById('lifecost-range');
  if (!seg) return;
  seg.querySelectorAll('[data-lrange]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.lrange;
      seg.querySelectorAll('[data-lrange]').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });
}

export function initLifecost() {
  bindControls();
  renderAll();
}

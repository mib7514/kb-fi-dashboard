// rv-ui.js — Curve RV 화면 오케스트레이션 (Phase 2: 기대수익 히트맵 + 드릴다운, 단일 화면).
//   계산·조립은 rv-heatmap.js(순수), 렌더는 rv-chart.js. 데이터: window.FENRIR_SERIES['credit-spread'].
//   시나리오 입력·평균회귀 토글은 Phase 3 — 여기선 ΔS=0 고정.
import { buildHeatmap, buildDrilldown, HORIZONS } from './rv-heatmap.js';
import { renderHeatmap, renderHistory } from './rv-chart.js';

let DATA;
const state = { mode: 'excess', horizon: 1, sel: null };

const num0 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? (v >= 0 ? '+' : '') + v.toFixed(0) : '—';
const num1 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(1) : '—';
const pct0 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(Math.round(v)) : '—';

function drawHeatmap() {
  const hd = buildHeatmap(DATA, { mode: state.mode, horizonMonths: state.horizon });
  renderHeatmap(document.getElementById('rv-heatmap'),
    { rows: hd.rows, cols: hd.cols, z: hd.zColor, text: hd.text, stale: hd.stale, carryOnly: hd.carryOnly, mode: hd.mode, ktbRowIndex: hd.ktbRowIndex },
    onCell);
  // 토글 active 동기화
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
  document.querySelectorAll('[data-hz]').forEach(b => b.classList.toggle('active', +b.dataset.hz === state.horizon));
  document.getElementById('rv-hz-group').style.display = state.mode === 'excess' ? '' : 'none';
  const legendEx = document.getElementById('rv-legend-excess'), legendPc = document.getElementById('rv-legend-pctile');
  if (legendEx && legendPc) { legendEx.style.display = state.mode === 'excess' ? '' : 'none'; legendPc.style.display = state.mode === 'excess' ? 'none' : ''; }
}

function onCell(sector, mat) {
  state.sel = { sector, mat };
  drawDrilldown();
}

function drawDrilldown() {
  const box = document.getElementById('rv-drill');
  if (!state.sel) { box.innerHTML = '<div class="empty">히트맵 셀을 클릭하면 상세가 여기 표시됩니다.</div>'; return; }
  const d = buildDrilldown(DATA, state.sel.sector, state.sel.mat);

  const head = `<div class="drill-head">
    <span class="dh-sec">${d.sector}${d.isKtb ? ' <span class="ref">참조</span>' : ''}</span>
    <span class="dh-mat">${d.mat}</span>
    <span class="dh-kv">현재 스프레드 <b>${num1(d.spreadBp)}</b>bp</span>
    <span class="dh-kv">1년 %ile <b>${pct0(d.pctile1y)}</b></span>
  </div>`;

  const hz = d.horizons; // [{months,excess,carry,rolldown}]
  const col = (k) => hz.map(x => `<td class="n">${num0(x[k])}</td>`).join('');
  const table = `<table class="drill-tbl">
    <thead><tr><th>지표</th>${hz.map(x => `<th>${x.months}개월</th>`).join('')}</tr></thead>
    <tbody>
      <tr><td>기대수익 bp</td>${col('excess')}</tr>
      <tr><td>캐리 bp</td>${col('carry')}</tr>
      <tr><td>롤다운 bp</td>${col('rolldown')}</tr>
      <tr class="ph3"><td>평균회귀</td><td colspan="${hz.length}">Phase 3</td></tr>
    </tbody></table>`;

  box.innerHTML = `${head}<div class="drill-grid"><div class="card">${table}</div><div class="card"><div class="chart-box short" id="rv-drill-chart"></div></div></div>`;
  renderHistory(document.getElementById('rv-drill-chart'), {
    dates: d.history.dates, values: d.history.values, stale: d.history.stale,
    current: d.spreadBp, title: `${d.sector} ${d.mat} 스프레드 (최근 1년, 회색 점선=스테일)`,
  });
}

export function initCurveRV() {
  DATA = window.FENRIR_SERIES && window.FENRIR_SERIES['credit-spread'];
  const app = document.getElementById('rv-app');
  if (!DATA) { app.innerHTML = '<p class="empty">데이터를 불러오지 못했습니다 (data/credit-spread.js).</p>'; return; }

  document.getElementById('rv-updated').textContent = DATA.meta.last_updated;
  document.getElementById('rv-range').textContent = `${DATA.dates[0]} ~ ${DATA.dates[DATA.dates.length - 1]}`;
  document.getElementById('rv-count').textContent = `${DATA.dates.length}일 · ${DATA.meta.nodes.length}노드(표시 ${DATA.meta.nodes.length - 1})`;

  document.querySelectorAll('[data-mode]').forEach(b =>
    b.addEventListener('click', () => { state.mode = b.dataset.mode; drawHeatmap(); }));
  document.querySelectorAll('[data-hz]').forEach(b =>
    b.addEventListener('click', () => { state.horizon = +b.dataset.hz; drawHeatmap(); if (state.sel) drawDrilldown(); }));

  drawHeatmap();
  // 기본 드릴다운: 공사채AAA 3년
  onCell('공사채AAA', '3년');
}

export { buildHeatmap, buildDrilldown, HORIZONS };

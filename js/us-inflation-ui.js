// us-inflation-ui.js — 미국 물가전망 페이지 컨트롤러.
// us-inflation-calc.js(gap-aware 계산) + us-inflation-chart.js(렌더)를 엮음.
// 데이터: data/us-inflation.json 을 fetch (로컬 서버 서빙 전제 — file:// 미지원).
// 개인 입력(m-m override)은 localStorage 'us-inflation-forecast' 단일 객체 + JSON 내보내기/가져오기.

import { buildForecastUS, missingPeriods, annualYoYSummaryUS } from './us-inflation-calc.js';
import { renderIndexChart, renderMmChart, renderYoyChart } from './us-inflation-chart.js';
import { cumulativeError, PREDICTION_COLUMNS, OIL_BRANCH_LABELS } from './us-inflation-scorecard.js';

const DATA_URL = 'data/us-inflation.json';
const SCORECARD_URL = 'data/us-inflation-scorecard.json';
const LS_KEY = 'us-inflation-forecast';
const SERIES_ORDER = ['us-cpi-headline', 'us-cpi-core', 'us-pce-headline', 'us-pce-core'];
const SERIES_LABEL = {
  'us-cpi-headline': 'CPI 헤드라인',
  'us-cpi-core': 'CPI 근원',
  'us-pce-headline': 'PCE 헤드라인',
  'us-pce-core': 'PCE 근원',
};

// ── 상태 ──
const state = {
  activeSeries: 'us-cpi-headline',
  forecastMonths: 12,   // 6 | 12 | 24
  yyMonths: 60,         // y-y 표시 범위(최근 N개월) — 적재기간과 별개, 기본 5년
  windowYears: 10,      // 시즈널 가이드 윈도우 5|10|15년 (적재 2009~ → 15년 지원)
  overridesBySeries: {},// { seriesId: { 'YYYY-MM': mm(number) } }
};

let DATA = null; // { series: { id: { meta, data } } }

// ── 저장/로드 (OO 규약: 단일 객체 덮어쓰기, try/catch, 방어적 병합) ──
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(persistable())); } catch { /* noop */ }
}
function persistable() {
  return {
    kind: LS_KEY,
    version: 1,
    activeSeries: state.activeSeries,
    forecastMonths: state.forecastMonths,
    yyMonths: state.yyMonths,
    windowYears: state.windowYears,
    overridesBySeries: state.overridesBySeries,
  };
}
function applyState(s) {
  if (!s || typeof s !== 'object') return;
  if (SERIES_ORDER.includes(s.activeSeries)) state.activeSeries = s.activeSeries;
  if ([6, 12, 24].includes(s.forecastMonths)) state.forecastMonths = s.forecastMonths;
  if (typeof s.yyMonths === 'number') state.yyMonths = s.yyMonths;
  if ([5, 10, 15].includes(s.windowYears)) state.windowYears = s.windowYears;
  if (s.overridesBySeries && typeof s.overridesBySeries === 'object') {
    // 시리즈별 { period: number }만 취함.
    const clean = {};
    for (const [sid, ov] of Object.entries(s.overridesBySeries)) {
      if (!SERIES_ORDER.includes(sid) || !ov || typeof ov !== 'object') continue;
      clean[sid] = {};
      for (const [period, mm] of Object.entries(ov)) {
        const num = Number(mm);
        if (/^\d{4}-\d{2}$/.test(period) && Number.isFinite(num)) clean[sid][period] = num;
      }
    }
    state.overridesBySeries = clean;
  }
}
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  applyState(s);
}

// ── 계산 ──
function activeEntry() { return DATA.series[state.activeSeries]; }

function scenario() {
  const ov = state.overridesBySeries[state.activeSeries] || {};
  return {
    series_id: state.activeSeries,
    scenario_id: 'base',
    label: 'Base',
    mm_overrides: Object.entries(ov).map(([period, mm]) => ({ period, mm })),
    last_edited: new Date().toISOString(),
  };
}
function meta() {
  return { series_id: state.activeSeries, window_years: state.windowYears, notes: '', comparison_label: '' };
}
function compute() {
  return buildForecastUS(activeEntry().data, scenario(), meta(), state.forecastMonths);
}

// ── 포맷 ──
function fmt(v, d = 2) { return (typeof v !== 'number' || !Number.isFinite(v)) ? '—' : v.toFixed(d); }
function fmtSigned(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d);
}

// ── 렌더 ──
function renderAll() {
  const result = compute();
  const unit = activeEntry().meta.unit;
  renderYoyChart(document.getElementById('chart-yoy'), result, { yyMonths: state.yyMonths });
  renderIndexChart(document.getElementById('chart-index'), result, { unit });
  renderMmChart(document.getElementById('chart-mm'), result);
  renderSeriesBar();
  renderSelector();
  renderAnnual(annualYoYSummaryUS(activeEntry().data, scenario(), meta()));
  renderSummary(result);
  renderEditor(result);
  renderFootnote();
}

// ── 연평균 y-y 요약 카드 ──
// m-m 입력·윈도우 토글·시리즈 전환 모두 renderAll을 거치므로 여기서 자동 재계산됨.
function renderAnnual(summary) {
  const el = document.getElementById('annual-summary');
  if (!el) return;
  if (!summary || summary.years.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = summary.years.map((y) => {
    const parts = [];
    if (y.actual > 0) parts.push(`실측 ${y.actual}M`);
    parts.push(`입력 ${y.input}M`);
    parts.push(`가이드 ${y.guide}M`);
    const gap = y.complete ? '' : `<span class="annual-gap">${y.months}개월 평균</span>`;
    return `
      <div class="annual-item">
        <div class="annual-year">${y.year}<span class="annual-unit">연평균</span>${gap}</div>
        <div class="annual-val">${fmtSigned(y.avg, 2)}<span class="stat-unit">%</span></div>
        <div class="annual-parts">${parts.join(' + ')}</div>
      </div>`;
  }).join('');
}

function renderSelector() {
  const el = document.getElementById('series-selector');
  el.innerHTML = SERIES_ORDER.map((id) =>
    `<button data-series="${id}" class="${id === state.activeSeries ? 'active' : ''}">${SERIES_LABEL[id]}</button>`).join('');
  el.querySelectorAll('[data-series]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeSeries = btn.dataset.series;
      save();
      renderAll();
    });
  });
}

function renderSeriesBar() {
  const m = activeEntry().meta;
  const data = activeEntry().data;
  document.getElementById('series-name').textContent = m.display_name;
  document.getElementById('series-source').textContent = `${m.source.toUpperCase()} · ${m.fred_code}`;
  document.getElementById('series-range').textContent = `${data[0].period} ~ ${data[data.length - 1].period}`;
  document.getElementById('series-count').textContent = `${data.length}개월`;
  document.getElementById('series-updated').textContent = m.last_updated;
}

function renderSummary(result) {
  const el = document.getElementById('summary');
  const lastHist = result.yoy_history[result.yoy_history.length - 1];
  const lastFcst = result.yoy_forecast[result.yoy_forecast.length - 1];
  const lastIdx = result.index_history[result.index_history.length - 1];
  const fcstAvg = result.yoy_forecast.length > 0
    ? result.yoy_forecast.reduce((s, p) => s + p.value, 0) / result.yoy_forecast.length
    : null;

  const cards = [
    { label: '최신 실측', sub: lastIdx?.period ?? '—', main: fmt(lastIdx?.value, 2), unit: 'idx' },
    { label: '최신 y-y', sub: lastHist?.period ?? '—', main: fmtSigned(lastHist?.value, 2), unit: '%' },
    { label: '전망 종점 y-y', sub: lastFcst?.period ?? '—', main: fmtSigned(lastFcst?.value, 2), unit: '%' },
    { label: '전망기간 평균 y-y', sub: `${state.forecastMonths}개월`, main: fmtSigned(fcstAvg, 2), unit: '%' },
    { label: '최근 6M m-m 평균', sub: '연율화 아님', main: fmtSigned(result.guide.recent_6m_avg, 3), unit: '%' },
  ];
  el.innerHTML = cards.map((c) => `
    <div class="stat">
      <div class="stat-label">${c.label}</div>
      <div class="stat-main">${c.main}<span class="stat-unit">${c.unit}</span></div>
      <div class="stat-sub">${c.sub}</div>
    </div>`).join('');
}

function renderEditor(result) {
  const el = document.getElementById('editor-body');
  const guide = result.guide.seasonal_avg_window;
  const ov = state.overridesBySeries[state.activeSeries] || {};
  el.innerHTML = guide.map((g) => {
    const has = ov[g.period] !== undefined;
    const effective = has ? ov[g.period] : g.value;
    return `
      <div class="editor-row ${has ? 'has-override' : ''}">
        <div class="er-period">${g.period}</div>
        <div class="er-guide">가이드 ${fmtSigned(g.value, 3)}</div>
        <input class="er-input" type="number" step="0.01" data-period="${g.period}"
               value="${has ? ov[g.period] : ''}" placeholder="${fmt(g.value, 3)}" />
        <div class="er-eff">→ ${fmtSigned(effective, 3)}%</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.er-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const period = e.target.dataset.period;
      const raw = e.target.value.trim();
      const bag = state.overridesBySeries[state.activeSeries] || (state.overridesBySeries[state.activeSeries] = {});
      if (raw === '') {
        delete bag[period];
      } else {
        const num = parseFloat(raw);
        if (Number.isFinite(num)) bag[period] = num;
      }
      save();
      renderAll();
    });
  });
}

function renderFootnote() {
  const el = document.getElementById('footnote');
  const missing = missingPeriods(activeEntry().data);
  const gapLine = missing.length > 0
    ? `<div class="warn">⚠ 결측월 <span class="k">${missing.join(', ')}</span> — 2025년 미 연방정부 셧다운으로 BLS 미발표. 보간하지 않고 공백 유지: 해당 월 m-m·y-y는 산출하지 않으며 차트에서 라인이 끊깁니다.</div>`
    : '';
  el.innerHTML = `
    ${gapLine}
    <div>모든 시리즈는 <span class="k">계절조정(SA)</span> 지수(FRED). 산출 y-y는 SA 기준이라 BLS/BEA 공표 y-y(NSA)와 ±0.1%p 내외 괴리 가능.</div>
    <div>시즈널 가이드는 각 전망 시점 기준 최근 <span class="k">${state.windowYears}년</span> 같은 달 m-m의 rolling 평균(적재 2009~, 윈도우 5/10/15년 선택 — 표시 구간과 별개). 연준 공식 목표는 헤드라인 PCE 2% (근원 PCE는 기조 판단 참고지표); 차트의 2% 수평선은 참고용.</div>`;
}

// ── 컨트롤 바인딩 ──
function bindControls() {
  document.querySelectorAll('[data-window]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.windowYears = Number(btn.dataset.window);
      document.querySelectorAll('[data-window]').forEach((b) => b.classList.toggle('active', b === btn));
      save();
      renderAll(); // 윈도우 변경 → 시즈널 가이드·전망 기본값 재계산
    });
  });
  document.querySelectorAll('[data-fcst]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.forecastMonths = Number(btn.dataset.fcst);
      document.querySelectorAll('[data-fcst]').forEach((b) => b.classList.toggle('active', b === btn));
      save();
      renderAll();
    });
  });
  document.querySelectorAll('[data-yy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.yyMonths = Number(btn.dataset.yy);
      document.querySelectorAll('[data-yy]').forEach((b) => b.classList.toggle('active', b === btn));
      save();
      renderAll();
    });
  });

  document.getElementById('reset-overrides').addEventListener('click', () => {
    delete state.overridesBySeries[state.activeSeries];
    save();
    renderAll();
  });

  // JSON 내보내기 (전 시리즈 override 포함 — 기기 간 동기화용)
  document.getElementById('export-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(persistable(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'us-inflation-forecast.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // JSON 가져오기
  const importInput = document.getElementById('import-json');
  document.getElementById('import-btn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyState(JSON.parse(String(reader.result)));
        save();
        syncControlActive();
        renderAll();
      } catch { /* 무시 (잘못된 파일) */ }
    };
    reader.readAsText(f, 'utf-8');
    e.target.value = '';
  });
}

// 세그먼트 버튼 active 상태를 state에 맞춤(가져오기 후).
function syncControlActive() {
  document.querySelectorAll('[data-window]').forEach((b) => b.classList.toggle('active', Number(b.dataset.window) === state.windowYears));
  document.querySelectorAll('[data-fcst]').forEach((b) => b.classList.toggle('active', Number(b.dataset.fcst) === state.forecastMonths));
  document.querySelectorAll('[data-yy]').forEach((b) => b.classList.toggle('active', Number(b.dataset.yy) === state.yyMonths));
}

// ── 예측 성적표 (헤드라인 CPI y/y) — 저장된 동결 스냅샷 표시 전용 ──
function scCell(row, key) {
  const c = row[key];
  const v = c?.yoy;
  if (v == null) return '<span class="na">–</span>';
  let s = v.toFixed(1);
  if (key === 'combined' && c.retro) s += '<span class="flag" title="백테스트 소급값 — 누적 성적 제외">소급</span>';
  if (['sealed', 'consensus', 'cleveland'].includes(key) && c.late) s += '<span class="flag" title="발표 후 입력 — 누적 성적 제외">지연</span>';
  if (row.frozen && row.actual && row.actual.yoy != null) {
    const e = row.errors ? row.errors[key] : null;
    if (e != null) {
      const cls = Math.abs(e) <= 0.15 ? 'ok' : 'hi';
      s += `<span class="err ${cls}">${e >= 0 ? '+' : ''}${e.toFixed(2)}</span>`;
    }
  }
  return s;
}

function renderScorecard(card) {
  const el = document.getElementById('scorecard-body');
  if (!el) return;
  if (!card || !Array.isArray(card.rows) || card.rows.length === 0) {
    el.innerHTML = '<div class="empty">아직 기록된 예측이 없습니다.</div>';
    return;
  }
  const rows = [...card.rows].sort((a, b) => (a.month < b.month ? -1 : 1));

  const legend = `
    <div class="sc-legend">
      숫자는 <b>작년 같은 달 대비 물가 상승률(%)</b>. 발표 전 예측을 그대로 박제하고, 실제가 나오면 옆에 <b>오차</b>를 붙입니다.<br>
      <b>우리 계산기</b> 평소 계절 흐름만으로 계산 ·
      <b>계산기+기름값</b> 여기에 최근 기름값을 반영 ·
      <b>내 최종 판단</b> 직접 봉인한 값 ·
      <b>시장 예상</b> 시장 컨센서스 ·
      <b>클리블랜드 연은</b> 클리블랜드 연준 추정 ·
      <b>실제</b> 발표된 값. <span style="color:var(--override)">소급/지연</span>은 성적 집계에서 뺍니다.
    </div>`;

  const head = `<tr><th>발표월</th>${PREDICTION_COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}`
    + `<th>봉인 유가 갈래</th><th>실제</th><th>미스 원인</th></tr>`;
  const body = rows.map((row) => {
    const cls = row.frozen ? '' : ' class="live"';
    const preds = PREDICTION_COLUMNS.map((c) => `<td>${scCell(row, c.key)}</td>`).join('');
    // 봉인 근거 유가 갈래 + 적중 여부(모델 오차와 분리 — 유가를 틀렸나 판단을 틀렸나).
    let branch = '<span class="na">–</span>';
    if (row.sealed && row.sealed.branch) {
      branch = OIL_BRANCH_LABELS[row.sealed.branch] || row.sealed.branch;
      if (row.frozen && row.sealed.branch_hit != null) {
        branch += row.sealed.branch_hit ? '<span class="hit y" title="유가 갈래 적중">✓</span>'
          : `<span class="hit n" title="실현 유가는 ${OIL_BRANCH_LABELS[row.realized_oil] || '?'}">✗</span>`;
      }
    }
    const actual = (row.actual && row.actual.yoy != null)
      ? `<td class="actual">${row.actual.yoy.toFixed(1)}</td>` : '<td class="na">–</td>';
    const reason = `<td class="reason">${row.miss_reason ? row.miss_reason : (row.frozen ? '' : '<span style="color:var(--accent)">예측 진행중</span>')}</td>`;
    return `<tr${cls}><td class="month">${row.month}</td>${preds}<td class="branch">${branch}</td>${actual}${reason}</tr>`;
  }).join('');

  // 누적 평균 오차 (동결·실측·비소급·비지연만).
  const cum = cumulativeError(rows);
  let best = null;
  for (const c of PREDICTION_COLUMNS) { const m = cum[c.key]; if (m.mae != null && (best == null || m.mae < best.mae)) best = { key: c.key, mae: m.mae }; }
  const cumLine = PREDICTION_COLUMNS.map((c) => {
    const m = cum[c.key];
    if (m.mae == null) return `${c.label} <b>–</b>`;
    const b = best && best.key === c.key ? ' class="best"' : '';
    return `<span${b}>${c.label} <b>${m.mae.toFixed(2)}</b><span style="opacity:.6">(n=${m.n})</span></span>`;
  }).join(' · ');

  el.innerHTML = legend
    + `<div class="sc-table-wrap"><table class="sc"><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    + `<div class="sc-cumulative">누적 평균 오차 (작을수록 정확, 발표 전 예측만): ${cumLine}</div>`;
}

// 다음 발표 한 줄 결론(유지 갈래) + 유가 밴드 3줄 + 미니 차트.
function renderNextcast(card) {
  const live = (card.rows || []).find((r) => !r.frozen && r.band);
  const one = document.getElementById('nextcast-oneline');
  const box = document.getElementById('oilband');
  if (!live || !one || !box) return;
  const hold = live.band.branches.find((b) => b.key === 'hold');
  const up = live.band.branches.find((b) => b.key === 'up20');
  const down = live.band.branches.find((b) => b.key === 'down20');
  if (hold?.yoy == null) return;

  one.style.display = '';
  one.innerHTML = `다음 발표 예상: <b>${hold.yoy.toFixed(1)}%</b> 안팎 <span style="color:var(--muted)">(기름값이 지금 수준일 때)</span>`
    + `<div class="sub">${live.month} 헤드라인 CPI · 작년 같은 달 대비</div>`;

  box.style.display = '';
  const bodyEl = document.getElementById('oilband-body');
  const rowHtml = (cls, lbl, v) => `<div class="oilrow ${cls}"><div class="lbl">${lbl}</div><div class="v">${v == null ? '–' : v.toFixed(1) + '%'}</div></div>`;
  bodyEl.innerHTML =
    `<div class="oilband-lines">
       ${rowHtml('up', '기름값 +20%면', up?.yoy)}
       ${rowHtml('hold', '지금 수준이면', hold?.yoy)}
       ${rowHtml('down', '기름값 −20%면', down?.yoy)}
     </div>
     <div class="oilband-chart" id="oilband-chart"></div>
     <div class="oilband-note">가운데 실선 = 기름값이 지금 수준일 때, 음영 = 기름값 ±20% 범위. ${live.band.passthrough.note}</div>`;
  drawBandChart(card, live, { hold, up, down });
}

function drawBandChart(card, live, br) {
  const elId = 'oilband-chart';
  if (typeof Plotly === 'undefined' || !document.getElementById(elId)) return;
  const hist = (card.meta && card.meta.recent_actual_yoy) || [];
  if (hist.length === 0 || br.hold.yoy == null || br.up.yoy == null || br.down.yoy == null) return;
  const xh = hist.map((p) => p.month), yh = hist.map((p) => p.yoy);
  const last = hist[hist.length - 1];
  const fx = [last.month, live.month]; // 마지막 실측 → 전망월
  const A = '#58a6ff';          // 실선(중앙) 색
  const DEEP = '#2f81f7';       // 음영보다 진한 같은 파랑 계열(상·하 라벨/마커)
  const up = br.up.yoy, hold = br.hold.yoy, down = br.down.yoy; // 동적 바인딩(하드코딩 없음)

  const traces = [
    { x: xh, y: yh, mode: 'lines', name: '실측', line: { color: A, width: 2 }, hovertemplate: '실제 %{y:.1f}%<extra></extra>' },
    // 콘: 상단·하단 커넥터 + 사이 음영
    { x: fx, y: [last.yoy, up], mode: 'lines', line: { color: DEEP, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false },
    { x: fx, y: [last.yoy, down], mode: 'lines', line: { color: DEEP, width: 1, dash: 'dot' }, fill: 'tonexty', fillcolor: 'rgba(88,166,255,0.13)', hoverinfo: 'skip', showlegend: false },
    { x: fx, y: [last.yoy, hold], mode: 'lines', line: { color: A, width: 2, dash: 'dash' }, hoverinfo: 'skip', showlegend: false },
    // 전망월 세 갈래 마커 — 호버(x unified)에서 함께 뜸
    { x: [live.month], y: [up], mode: 'markers', name: '기름값 +20%면', marker: { color: DEEP, size: 7 }, hovertemplate: '기름값 +20%면 %{y:.1f}%<extra></extra>' },
    { x: [live.month], y: [hold], mode: 'markers', name: '지금이면', marker: { color: A, size: 9 }, hovertemplate: '지금이면 %{y:.1f}%<extra></extra>' },
    { x: [live.month], y: [down], mode: 'markers', name: '기름값 −20%면', marker: { color: DEEP, size: 7 }, hovertemplate: '기름값 −20%면 %{y:.1f}%<extra></extra>' },
    // 실측 마지막 점 강조
    { x: [last.month], y: [last.yoy], mode: 'markers', marker: { color: A, size: 7 }, hoverinfo: 'skip', showlegend: false },
  ];

  // ── y 범위 + 라벨 겹침 방지(콘이 좁으면 지시선으로 상·중·하 분리) ──
  const yAll = [...yh, up, hold, down];
  const ymin = Math.min(...yAll), ymax = Math.max(...yAll);
  const pad = Math.max(0.15, (ymax - ymin) * 0.15);
  const lo = ymin - pad, hi = ymax + pad, span = hi - lo;
  const PLOT_H = 180;                 // 대략 plot 높이(px) — 간격 판정용
  const yToPx = (y) => (hi - y) / span * PLOT_H; // 위=작은 px
  const MIN = 15;                     // 라벨 최소 세로 간격(px)
  let sHold = yToPx(hold), sUp = yToPx(up), sDown = yToPx(down);
  if (sHold - sUp < MIN) sUp = sHold - MIN;     // up은 hold 위로 최소 간격
  if (sDown - sHold < MIN) sDown = sHold + MIN; // down은 hold 아래로

  const valLabel = (y, sy, color, bold) => ({
    x: live.month, y, xref: 'x', yref: 'y',
    text: (bold ? '<b>' : '') + y.toFixed(1) + '%' + (bold ? '</b>' : ''),
    font: { color, size: 11.5 }, xanchor: 'left', ax: 24, ay: sy - yToPx(y),
    showarrow: true, arrowcolor: color, arrowwidth: 1, arrowhead: 0, standoff: 2,
  });
  const annotations = [
    valLabel(up, sUp, DEEP, false),
    valLabel(hold, sHold, A, true),
    valLabel(down, sDown, DEEP, false),
    { // 실측 마지막 점 = 기준점
      x: last.month, y: last.yoy, xref: 'x', yref: 'y',
      text: `<b>${last.yoy.toFixed(1)}%</b> <span style="font-size:9px">여기까지 실제</span>`,
      font: { color: A, size: 11 }, xanchor: 'right', ax: -6, ay: -16,
      showarrow: true, arrowcolor: A, arrowwidth: 1, arrowhead: 0, standoff: 2,
    },
  ];

  const layout = {
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { color: '#c9d1d9', family: 'ui-monospace, Menlo, Consolas, monospace', size: 10 },
    xaxis: { gridcolor: '#21262d', linecolor: '#484f58', tickfont: { size: 9 } },
    yaxis: { title: { text: 'y/y %', font: { size: 9 } }, range: [lo, hi], gridcolor: '#21262d', linecolor: '#484f58', tickfont: { size: 9 } },
    margin: { l: 42, r: 66, t: 16, b: 26 }, // 오른쪽 라벨 공간 확보
    showlegend: false, hovermode: 'x unified', annotations,
  };
  Plotly.react(elId, traces, layout, { displayModeBar: false, responsive: true });
}

async function loadScorecard() {
  try {
    const res = await fetch(SCORECARD_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const card = await res.json();
    renderNextcast(card);
    renderScorecard(card);
  } catch { /* 성적표 부재/오류는 비치명 — 나머지 페이지는 정상 렌더 */ }
}

// ── 초기화 ──
export async function initUS() {
  load();
  loadScorecard(); // 시리즈 상태와 무관 — 병렬 로드(비치명)
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">데이터를 불러오지 못했습니다 (${err.message}).<br>
       <code>${DATA_URL}</code> 는 fetch로 읽으므로 <b>로컬 서버</b>가 필요합니다 (file:// 직접 열기 불가).<br>
       예: <code>python -m http.server</code> 후 http://localhost:8000/us-inflation.html</div>`;
    return;
  }
  if (!DATA?.series || !DATA.series[state.activeSeries]) {
    document.getElementById('app').innerHTML = '<div class="empty">시리즈 데이터가 비어 있습니다.</div>';
    return;
  }
  bindControls();
  syncControlActive();
  renderAll();
}

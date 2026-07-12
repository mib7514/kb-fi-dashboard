// us-inflation-ui.js — 미국 물가전망 페이지 컨트롤러.
// us-inflation-calc.js(gap-aware 계산) + us-inflation-chart.js(렌더)를 엮음.
// 데이터: data/us-inflation.json 을 fetch (로컬 서버 서빙 전제 — file:// 미지원).
// 개인 입력(m-m override)은 localStorage 'us-inflation-forecast' 단일 객체 + JSON 내보내기/가져오기.

import { buildForecastUS, missingPeriods } from './us-inflation-calc.js';
import { renderIndexChart, renderMmChart, renderYoyChart } from './us-inflation-chart.js';

const DATA_URL = 'data/us-inflation.json';
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
  renderSummary(result);
  renderEditor(result);
  renderFootnote();
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

// ── 초기화 ──
export async function initUS() {
  load();
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

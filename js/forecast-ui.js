// forecast-ui.js — 물가전망 페이지 컨트롤러.
// calc.js(계산) + chart.js(렌더)를 엮어 화면 상태를 관리.

import { buildForecast, computeMM } from './calc.js';
import { renderIndexChart, renderMmChart, renderYoyChart } from './chart.js';
import { getSeriesData } from './series-config.js';

// 이 페이지가 표시할 시리즈 (1단계: KR-CPI headline 고정. 이후 탭으로 확장).
const ACTIVE_SERIES_ID = 'kr-cpi-headline';

// ── 상태 ──
const state = {
  windowYears: 10,      // 5 | 10 | 15 (US 모듈과 통일: 기본 10)
  forecastMonths: 12,   // 전망 개월수
  yyMonths: 60,         // y-y 차트 표시 범위 (최근 N개월)
  overrides: {},        // { 'YYYY-MM': mm(number) }  — 사용자 정성 판단
};

let META = null;
let DATA = null;

function scenario() {
  return {
    series_id: META.series_id,
    scenario_id: 'base',
    label: 'Base',
    mm_overrides: Object.entries(state.overrides).map(([period, mm]) => ({ period, mm })),
    last_edited: new Date().toISOString(),
  };
}

function meta() {
  return {
    series_id: META.series_id,
    window_years: state.windowYears,
    notes: '',
    comparison_label: '',
  };
}

function compute() {
  return buildForecast(
    DATA, scenario(), meta(),
    state.forecastMonths, META.value_type, META.frequency,
  );
}

// ── 렌더 ──
function renderAll() {
  const result = compute();
  renderIndexChart(document.getElementById('chart-index'), result);
  renderMmChart(document.getElementById('chart-mm'), result);
  renderYoyChart(document.getElementById('chart-yoy'), result, { yyMonths: state.yyMonths });
  renderSummary(result);
  renderEditor(result);
}

function fmt(v, d = 2) {
  return (typeof v !== 'number' || !Number.isFinite(v)) ? '—' : v.toFixed(d);
}
function fmtSigned(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d);
}

// ── 요약 카드 ──
function renderSummary(result) {
  const el = document.getElementById('summary');
  const lastHist = result.yoy_history[result.yoy_history.length - 1];
  const lastFcst = result.yoy_forecast[result.yoy_forecast.length - 1];
  const lastIdx = result.index_history[result.index_history.length - 1];

  // 전망 기간 연평균 y-y (forecast 구간)
  const fcstAvg = result.yoy_forecast.length > 0
    ? result.yoy_forecast.reduce((s, p) => s + p.value, 0) / result.yoy_forecast.length
    : null;

  const cards = [
    { label: '최신 실측', sub: lastIdx?.period ?? '—', main: fmt(lastIdx?.value, 2), unit: 'idx' },
    { label: '최신 y-y', sub: lastHist?.period ?? '—', main: fmtSigned(lastHist?.value, 2), unit: '%' },
    { label: `전망 종점 y-y`, sub: lastFcst?.period ?? '—', main: fmtSigned(lastFcst?.value, 2), unit: '%' },
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

// ── m-m override 편집기 ──
// 각 forecast 월에 대해 [가이드값 표시] + [override 입력]. 입력 비우면 가이드값 사용.
function renderEditor(result) {
  const el = document.getElementById('editor-body');
  const guide = result.guide.seasonal_avg_window; // forecast 시점별 rolling 시즈널
  if (guide.length === 0) {
    el.innerHTML = '<div class="empty">이 시리즈는 m-m 편집을 지원하지 않습니다 (rate/quarterly).</div>';
    return;
  }

  el.innerHTML = guide.map((g) => {
    const ov = state.overrides[g.period];
    const hasOv = ov !== undefined;
    const effective = hasOv ? ov : g.value;
    return `
      <div class="editor-row ${hasOv ? 'has-override' : ''}">
        <div class="er-period">${g.period}</div>
        <div class="er-guide">가이드 ${fmtSigned(g.value, 3)}</div>
        <input class="er-input" type="number" step="0.01" data-period="${g.period}"
               value="${hasOv ? ov : ''}" placeholder="${fmt(g.value, 3)}" />
        <div class="er-eff">→ ${fmtSigned(effective, 3)}%</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.er-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const period = e.target.dataset.period;
      const raw = e.target.value.trim();
      if (raw === '') delete state.overrides[period];
      else {
        const num = parseFloat(raw);
        if (Number.isFinite(num)) state.overrides[period] = num;
      }
      renderAll();
    });
  });
}

// ── 컨트롤 바인딩 ──
function bindControls() {
  // window 토글
  document.querySelectorAll('[data-window]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.windowYears = Number(btn.dataset.window);
      document.querySelectorAll('[data-window]').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });

  // 전망 개월수
  document.querySelectorAll('[data-fcst]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.forecastMonths = Number(btn.dataset.fcst);
      document.querySelectorAll('[data-fcst]').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });

  // y-y 표시범위
  document.querySelectorAll('[data-yy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.yyMonths = Number(btn.dataset.yy);
      document.querySelectorAll('[data-yy]').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });

  // override 초기화
  document.getElementById('reset-overrides').addEventListener('click', () => {
    state.overrides = {};
    renderAll();
  });

  // 시나리오 export (현재 override를 JSON으로)
  document.getElementById('export-scenario').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(scenario(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${META.series_id}-scenario.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ── 초기화 ──
export function initForecast() {
  const entry = getSeriesData(ACTIVE_SERIES_ID);
  META = entry?.meta ?? null;
  DATA = entry?.series ?? null;

  if (!META || !DATA || DATA.length === 0) {
    document.getElementById('app').innerHTML =
      `<div class="empty">데이터를 불러오지 못했습니다. data/${ACTIVE_SERIES_ID}.js 확인.</div>`;
    return;
  }

  // 헤더 메타 채우기
  document.getElementById('series-name').textContent = META.display_name;
  document.getElementById('series-source').textContent = META.source.toUpperCase();
  document.getElementById('series-updated').textContent = META.last_updated;
  document.getElementById('series-count').textContent = `${DATA.length}개월`;
  document.getElementById('series-range').textContent =
    `${DATA[0].period} ~ ${DATA[DATA.length - 1].period}`;

  bindControls();
  renderAll();
}

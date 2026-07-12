// admin-ui.js — 로컬 데이터 공장. CSV 업로드 → 파싱 → 미리보기 → data/*.js export.
// calc.js/chart.js/series-config.js를 조회 페이지와 공유 (로직 중복 없음).
// API 키 없음 (순수 파일 변환) — 공개 레포에 올려도 무방하나, 커밋은 나만.

import { buildForecast } from './calc.js';
import { renderYoyChart, renderMmChart } from './chart.js';
import { parseKosisCsv, matchRow } from './csv-parse.js';
import { SERIES_CONFIG, ALL_SERIES_IDS, getConfig } from './series-config.js';

const state = {
  parsed: null,        // parseKosisCsv 결과
  selectedRowIdx: -1,  // 선택된 데이터 행
  seriesId: 'kr-cpi-headline',
};

function fmt(v, d = 2) {
  return (typeof v !== 'number' || !Number.isFinite(v)) ? '—' : v.toFixed(d);
}
function fmtSigned(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d);
}

// ── CSV 로드 ──
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseKosisCsv(String(reader.result));
      state.parsed = parsed;
      // 현재 seriesId의 힌트로 자동 매칭 시도
      autoMatch();
      renderRows();
      renderPreview();
      setStatus(`파싱 완료 — ${parsed.rows.length}개 행, 기간 ${parsed.periods[0]} ~ ${parsed.periods[parsed.periods.length - 1]}`, 'ok');
    } catch (err) {
      state.parsed = null;
      setStatus('파싱 실패: ' + err.message, 'bad');
      renderRows();
      renderPreview();
    }
  };
  reader.onerror = () => setStatus('파일 읽기 실패', 'bad');
  reader.readAsText(file, 'utf-8');
}

function autoMatch() {
  if (!state.parsed) return;
  const cfg = getConfig(state.seriesId);
  const row = matchRow(state.parsed, cfg?.kosis_hint);
  state.selectedRowIdx = row ? state.parsed.rows.indexOf(row) : -1;
}

// ── 행 목록 렌더 ──
function renderRows() {
  const el = document.getElementById('rows');
  if (!state.parsed) {
    el.innerHTML = '<div class="empty">CSV를 올리면 감지된 데이터 행이 여기 표시됩니다.</div>';
    return;
  }
  el.innerHTML = state.parsed.rows.map((row, i) => `
    <label class="row-opt ${i === state.selectedRowIdx ? 'selected' : ''}">
      <input type="radio" name="rowsel" value="${i}" ${i === state.selectedRowIdx ? 'checked' : ''} />
      <span class="ro-account">${row.account || '(무명)'}</span>
      <span class="ro-meta">${row.unit || '—'} · ${row.transform || '—'}</span>
      <span class="ro-count">${row.points.length}개월</span>
    </label>`).join('');

  el.querySelectorAll('input[name=rowsel]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.selectedRowIdx = Number(inp.value);
      renderRows();
      renderPreview();
    });
  });
}

function selectedSeries() {
  if (!state.parsed || state.selectedRowIdx < 0) return null;
  return state.parsed.rows[state.selectedRowIdx].points;
}

// ── 미리보기 (calc로 실제 전망 계산) ──
function renderPreview() {
  const el = document.getElementById('preview');
  const series = selectedSeries();
  if (!series) {
    el.innerHTML = '<div class="empty">행을 선택하면 전망 미리보기가 계산됩니다.</div>';
    document.getElementById('export-btn').disabled = true;
    return;
  }
  document.getElementById('export-btn').disabled = false;

  const cfg = getConfig(state.seriesId) || {};
  const scenario = { series_id: state.seriesId, scenario_id: 'base', label: 'Base', mm_overrides: [], last_edited: new Date().toISOString() };
  const meta = { series_id: state.seriesId, window_years: 10, notes: '', comparison_label: '' };
  const result = buildForecast(series, scenario, meta, 12, cfg.value_type || 'index', cfg.frequency || 'monthly');

  const lastIdx = result.index_history[result.index_history.length - 1];
  const lastYy = result.yoy_history[result.yoy_history.length - 1];
  const endYy = result.yoy_forecast[result.yoy_forecast.length - 1];

  el.innerHTML = `
    <div class="pv-stats">
      <div class="pv-stat"><div class="l">데이터 포인트</div><div class="m">${series.length}</div></div>
      <div class="pv-stat"><div class="l">최신 실측</div><div class="m">${fmt(lastIdx?.value)}<span>${lastIdx?.period ?? ''}</span></div></div>
      <div class="pv-stat"><div class="l">최신 y-y</div><div class="m">${fmtSigned(lastYy?.value)}%</div></div>
      <div class="pv-stat"><div class="l">전망 종점 y-y</div><div class="m">${fmtSigned(endYy?.value)}%<span>${endYy?.period ?? ''}</span></div></div>
    </div>
    <div class="pv-charts">
      <div class="pv-chart" id="pv-yoy"></div>
      <div class="pv-chart" id="pv-mm"></div>
    </div>`;

  renderYoyChart(document.getElementById('pv-yoy'), result, { yyMonths: 60 });
  renderMmChart(document.getElementById('pv-mm'), result);
}

// ── export: data/{seriesId}.js 생성 → 다운로드 ──
function buildDataFileContent(seriesId, series) {
  const cfg = getConfig(seriesId) || {};
  const meta = {
    series_id: seriesId,
    display_name: cfg.display_name || seriesId,
    source: cfg.source || 'manual',
    unit: cfg.unit || '',
    value_type: cfg.value_type || 'index',
    frequency: cfg.frequency || 'monthly',
    last_updated: series[series.length - 1]?.period || '',
  };
  const sorted = [...series].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  let out = `// ${meta.display_name} (${meta.source.toUpperCase()}, ${meta.unit})\n`;
  out += `// admin 도구 생성 — ${new Date().toISOString().slice(0, 10)}. 레지스트리 자기등록 (file:// 호환).\n`;
  out += `window.FENRIR_SERIES = window.FENRIR_SERIES || {};\n`;
  out += `window.FENRIR_SERIES[${JSON.stringify(seriesId)}] = {\n`;
  out += `  meta: ${JSON.stringify(meta)},\n`;
  out += `  series: ${JSON.stringify(sorted)}\n`;
  out += `};\n`;
  return out;
}

function exportData() {
  const series = selectedSeries();
  if (!series) return;
  const content = buildDataFileContent(state.seriesId, series);
  const blob = new Blob([content], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.seriesId}.js`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`다운로드: ${state.seriesId}.js → data/ 폴더에 넣고 커밋하세요.`, 'ok');
}

function setStatus(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (kind || '');
}

// ── 초기화 ──
export function initAdmin() {
  // 시리즈 선택 드롭다운
  const sel = document.getElementById('series-select');
  sel.innerHTML = ALL_SERIES_IDS.map((id) =>
    `<option value="${id}">${id} — ${SERIES_CONFIG[id].display_name}</option>`).join('');
  sel.value = state.seriesId;
  sel.addEventListener('change', () => {
    state.seriesId = sel.value;
    autoMatch();
    renderRows();
    renderPreview();
  });

  // 파일 입력
  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  });

  // 드래그앤드롭
  const drop = document.getElementById('dropzone');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  document.getElementById('export-btn').addEventListener('click', exportData);

  renderRows();
  renderPreview();
}

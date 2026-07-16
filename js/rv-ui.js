// rv-ui.js — Curve RV 화면 오케스트레이션 (Phase 3: 시나리오 ΔS + 평균회귀).
//   계산·조립은 rv-heatmap.js(순수), 렌더는 rv-chart.js. 데이터: FENRIR_SERIES['credit-spread']
//   + ['curve-rv-backtest']. 시나리오는 localStorage(팀 비공유). 셀 색·순위는 항상 ΔS=0 기준.
import { buildHeatmap, buildDrilldown, RANK_BASIS } from './rv-heatmap.js';
import { renderHeatmap, renderHistory } from './rv-chart.js';

const LS_KEY = 'curve-rv-scenario';
let DATA, BT, CREDIT;
const state = { mode: 'excess', horizon: 1, sel: null, scenario: { mode: 'none', uniform: 0, perSector: {} }, meanRev: false, decompose: false, rankBasis: RANK_BASIS };

const num0 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? (v >= 0 ? '+' : '') + v.toFixed(0) : '—';
const num1 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(1) : '—';
const sgn1 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? (v >= 0 ? '+' : '') + v.toFixed(1) : '—';
const pct0 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(Math.round(v)) : '—';
const BUCKET_KO = { low: '저', mid: '중', high: '고' };

function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ scenario: state.scenario, meanRev: state.meanRev, decompose: state.decompose, rankBasis: state.rankBasis })); } catch { /* noop */ } }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (s && s.scenario && ['none', 'uniform', 'perSector'].includes(s.scenario.mode)) state.scenario = { mode: s.scenario.mode, uniform: Number(s.scenario.uniform) || 0, perSector: s.scenario.perSector || {} };
    if (s && typeof s.meanRev === 'boolean') state.meanRev = s.meanRev;
    if (s && typeof s.decompose === 'boolean') state.decompose = s.decompose;
    if (s && ['vol_adjusted', 'absolute'].includes(s.rankBasis)) state.rankBasis = s.rankBasis;
  } catch { /* noop */ }
  if (state.scenario.mode !== 'none') state.meanRev = false; // 상호배제
}

// excess 모드에서만 시나리오/평균회귀 적용.
const scenActive = () => state.mode === 'excess' && state.scenario.mode !== 'none';

// 상태 → buildHeatmap opts (상호배제 적용: 시나리오 활성 시 meanRev 강제 off). 순수·테스트용.
export function resolveHeatmapOpts(st, bt) {
  const active = st.mode === 'excess' && st.scenario && st.scenario.mode !== 'none';
  const opts = { mode: st.mode, horizonMonths: st.horizon };
  if (st.mode === 'excess') {
    opts.backtest = bt;
    opts.meanRev = !!st.meanRev && !active; // 상호배제 — 둘 다 스프레드 변화 기대치라 동시=이중계산
    opts.scenario = active ? st.scenario : null;
    opts.decompose = !!st.decompose; // 분해 2줄째(캐리+롤다운) — 색·순위 무관, 항상 base(ΔS=0)
    opts.rankBasis = st.rankBasis;    // 색·순위 기준: vol_adjusted(base/σ) | absolute(base)
  }
  return opts;
}

function drawHeatmap() {
  const hd = buildHeatmap(DATA, resolveHeatmapOpts(state, BT));
  renderHeatmap(document.getElementById('rv-heatmap'),
    { rows: hd.rows, cols: hd.cols, z: hd.zColor, text: hd.text, text2: hd.text2, stale: hd.stale, carryOnly: hd.carryOnly, mode: hd.mode, ktbRowIndex: hd.ktbRowIndex },
    onCell);
  syncControls();
}

function syncControls() {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
  document.querySelectorAll('[data-hz]').forEach(b => b.classList.toggle('active', +b.dataset.hz === state.horizon));
  document.querySelectorAll('[data-basis]').forEach(b => b.classList.toggle('active', b.dataset.basis === state.rankBasis));
  const excess = state.mode === 'excess';
  document.getElementById('rv-hz-group').style.display = excess ? '' : 'none';
  document.getElementById('rv-basis-group').style.display = excess ? '' : 'none';
  document.getElementById('rv-mr-group').style.display = excess ? '' : 'none';
  document.getElementById('rv-decomp-group').style.display = excess ? '' : 'none';
  document.getElementById('rv-decompose').checked = state.decompose;
  document.getElementById('rv-scenario-bar').style.display = excess ? '' : 'none';
  document.getElementById('rv-legend-excess').style.display = excess ? '' : 'none';
  document.getElementById('rv-legend-pctile').style.display = excess ? 'none' : '';
  // 시나리오 컨트롤
  document.getElementById('rv-scen-mode').value = state.scenario.mode;
  document.getElementById('rv-scen-uniform').style.display = state.scenario.mode === 'uniform' ? '' : 'none';
  document.getElementById('rv-scen-uniform-in').value = state.scenario.uniform || '';
  document.getElementById('rv-scen-persector').style.display = (excess && state.scenario.mode === 'perSector') ? '' : 'none';
  // 상호배제: 시나리오 적용 중 → 평균회귀 off·비활성
  const mrChk = document.getElementById('rv-meanrev'), mrLbl = mrChk.closest('.mr-toggle');
  mrChk.checked = state.meanRev; mrChk.disabled = scenActive();
  mrLbl.classList.toggle('disabled', scenActive());
  // title(설명 툴팁)은 HTML 고정 — 비활성 사유는 그 안에 포함되어 덮어쓰지 않음
  // 상태 헤드라인 (모드/토글 연동, 시나리오 배지와 병존)
  const hl = document.getElementById('rv-headline');
  if (state.mode === 'excess') {
    const mrApplied = state.meanRev && !scenActive(); // resolveHeatmapOpts와 동일 조건
    let suffix = mrApplied ? ' +과거 회귀 경향' : '';
    if (mrApplied && state.decompose) suffix += ' (분해는 캐리+롤다운만)'; // 2줄 합≠1줄 안내
    const basisTxt = state.rankBasis === 'vol_adjusted' ? '변동성 조정' : '절대 bp';
    hl.textContent = `국고 대비 초과수익 (bp) · ${state.horizon}개월 보유 기준 · 캐리+롤다운${suffix} · 색 = ${basisTxt} 순위`;
  } else {
    hl.textContent = '스프레드 레벨의 1년 히스토리 백분위 (스테일 제외)';
  }
  // 배지
  const badge = document.getElementById('rv-badge');
  if (scenActive()) {
    const ds = state.scenario.mode === 'uniform' ? `${num0(state.scenario.uniform)}bp` : '섹터별';
    badge.textContent = `시나리오 적용 중 · ${state.horizon}개월 기준 ΔS ${ds}`;
    badge.style.display = '';
  } else badge.style.display = 'none';
}

function renderPerSector() {
  const box = document.getElementById('rv-scen-persector');
  box.innerHTML = CREDIT.map(s =>
    `<label class="sp-row"><span>${s}</span><input type="number" class="rv-num" data-sec="${s}" step="1" value="${state.scenario.perSector[s] ?? ''}" placeholder="0" /></label>`).join('');
  box.querySelectorAll('input[data-sec]').forEach(inp => inp.addEventListener('input', () => {
    const v = inp.value.trim(); if (v === '') delete state.scenario.perSector[inp.dataset.sec]; else state.scenario.perSector[inp.dataset.sec] = Number(v) || 0;
    save(); drawHeatmap(); if (state.sel) drawDrilldown();
  }));
}

function onCell(sector, mat) { state.sel = { sector, mat }; drawDrilldown(); }

function drawDrilldown() {
  const box = document.getElementById('rv-drill');
  if (!state.sel) { box.innerHTML = '<div class="empty">히트맵 셀을 클릭하면 상세가 여기 표시됩니다.</div>'; return; }
  const d = buildDrilldown(DATA, state.sel.sector, state.sel.mat, BT);
  const hz = d.horizons;
  const head = `<div class="drill-head">
    <span class="dh-sec">${d.sector}${d.isKtb ? ' <span class="ref">참조</span>' : ''}</span>
    <span class="dh-mat">${d.mat}</span>
    <span class="dh-kv">현재 스프레드 <b>${num1(d.spreadBp)}</b>bp</span>
    <span class="dh-kv">1년 %ile <b>${pct0(d.pctile1y)}</b></span>
  </div>`;
  const col = (k) => hz.map(x => `<td class="n">${num0(x[k])}</td>`).join('');
  const table = `<table class="drill-tbl">
    <thead><tr><th>지표</th>${hz.map(x => `<th>${x.months}개월</th>`).join('')}</tr></thead>
    <tbody>
      <tr><td>기대수익 bp</td>${col('excess')}</tr>
      <tr><td>캐리 bp</td>${col('carry')}</tr>
      <tr><td>롤다운 bp</td>${col('rolldown')}</tr>
    </tbody></table>`;

  // 평균회귀 빈도표 (버킷 × 호라이즌). 현재 버킷 강조. 미제공 = 표본 부족.
  let mrHtml = '';
  if (d.meanrev) {
    const cell = (b, hh) => { const s = d.meanrev.table[b][hh]; return s ? `${s.n}회 중 ${s.shrink}회 축소·평균 ${sgn1(s.mean)}` : '<span class="short">표본 부족</span>'; };
    const rowB = (b) => `<tr class="${d.meanrev.currentBucket === b ? 'cur' : ''}"><td>${BUCKET_KO[b]}${d.meanrev.currentBucket === b ? ' ◀현재' : ''}</td>${[1, 3, 6].map(hh => `<td class="n">${cell(b, hh)}</td>`).join('')}</tr>`;
    mrHtml = `<div class="drill-mr"><table><thead><tr><th>평균회귀 버킷</th><th>1개월</th><th>3개월</th><th>6개월</th></tr></thead>
      <tbody>${['low', 'mid', 'high'].map(rowB).join('')}</tbody></table></div>`;
  } else mrHtml = '<div class="drill-mr note">국고 참조행 — 평균회귀 미제공</div>';

  box.innerHTML = `${head}<div class="drill-grid"><div class="card">${table}${mrHtml}</div><div class="card"><div class="chart-box short" id="rv-drill-chart"></div></div></div>`;
  renderHistory(document.getElementById('rv-drill-chart'), {
    dates: d.history.dates, values: d.history.values, stale: d.history.stale,
    current: d.spreadBp, title: `${d.sector} ${d.mat} 스프레드 (최근 1년, 회색 점선=스테일)`,
  });
}

export function initCurveRV() {
  DATA = window.FENRIR_SERIES && window.FENRIR_SERIES['credit-spread'];
  const app = document.getElementById('rv-app');
  if (!DATA) { app.innerHTML = '<p class="empty">데이터를 불러오지 못했습니다 (data/credit-spread.js).</p>'; return; }
  BT = (window.FENRIR_SERIES['curve-rv-backtest'] || {}).data || null;
  CREDIT = DATA.meta.sectors.filter(s => s !== '국고채권');
  load();

  document.getElementById('rv-updated').textContent = DATA.meta.last_updated;
  document.getElementById('rv-range').textContent = `${DATA.dates[0]} ~ ${DATA.dates[DATA.dates.length - 1]}`;
  document.getElementById('rv-count').textContent = `${DATA.dates.length}일 · ${DATA.meta.nodes.length}노드(표시 ${DATA.meta.nodes.length - 1})`;

  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { state.mode = b.dataset.mode; drawHeatmap(); if (state.sel) drawDrilldown(); }));
  document.querySelectorAll('[data-hz]').forEach(b => b.addEventListener('click', () => { state.horizon = +b.dataset.hz; drawHeatmap(); if (state.sel) drawDrilldown(); }));
  document.querySelectorAll('[data-basis]').forEach(b => b.addEventListener('click', () => { state.rankBasis = b.dataset.basis; save(); drawHeatmap(); }));

  // 평균회귀 토글 (상호배제)
  document.getElementById('rv-meanrev').addEventListener('change', (e) => {
    if (scenActive()) { e.target.checked = false; return; }
    state.meanRev = e.target.checked; save(); drawHeatmap();
  });
  // 분해 표시 토글 (셀 2줄째 캐리+롤다운) — 색·순위 무관
  document.getElementById('rv-decompose').addEventListener('change', (e) => {
    state.decompose = e.target.checked; save(); drawHeatmap();
  });
  // 시나리오 모드
  document.getElementById('rv-scen-mode').addEventListener('change', (e) => {
    state.scenario.mode = e.target.value;
    if (state.scenario.mode !== 'none') state.meanRev = false; // 상호배제
    if (state.scenario.mode === 'perSector') renderPerSector();
    save(); drawHeatmap(); if (state.sel) drawDrilldown();
  });
  document.getElementById('rv-scen-uniform-in').addEventListener('input', (e) => {
    state.scenario.uniform = Number(e.target.value) || 0; save(); drawHeatmap(); if (state.sel) drawDrilldown();
  });

  if (state.scenario.mode === 'perSector') renderPerSector();
  drawHeatmap();
  onCell('공사채AAA', '3년');
}

export { buildHeatmap, buildDrilldown };

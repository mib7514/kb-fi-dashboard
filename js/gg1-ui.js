// gg1-ui.js — GG-1 국민소득 갭 모니터 페이지 컨트롤러.
//   질문 하나: "교역조건이 지금 국민소득에 몇 %p를 얹고 있나".
//   데이터: data/gg1-income-gap.json 을 fetch (로컬 서버 서빙 전제 — file:// 미지원).
//   룩백(5y/10y/all)만 localStorage 'gg1-income-gap' 에 저장. 갭 프록시는 JSON 선계산 필드 스왑(곱셈 재계산 불요).
//   no-build: 의존성은 Plotly(vendor) 뿐. 계산은 update-gg1.mjs 가 이미 수행.

const DATA_URL = 'data/gg1-income-gap.json';
const LS_KEY = 'gg1-income-gap';
const LOOKBACKS = ['5y', '10y', 'all'];
const LOOKBACK_LABEL = { '5y': '5년', '10y': '10년', all: '전체' };

// 팔레트(사이트 기존 토큰과 동일) — 얹음(+)=상승색(green), 빼감(−)=하락색(red).
const C = {
  up: '#3fb950', down: '#f85149', accent: '#58a6ff', amber: '#f0883e',
  grid: '#21262d', axis: '#484f58', muted: '#8b949e', text: '#c9d1d9',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const state = { lookback: '10y' };
let DATA = null;

const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const signed = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d));
const proxyField = (lb) => `gap_proxy_pp_${lb}`;
// 'YYYYQn' → 분기 중앙월 날짜(플롯 정렬용).
const quarterToDate = (q) => {
  const y = q.slice(0, 4); const n = Number(q.slice(5));
  return `${y}-${String(n * 3 - 1).padStart(2, '0')}-15`;
};

// ── 저장/로드 (단일 객체 덮어쓰기, 방어적) ──
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ kind: LS_KEY, version: 1, lookback: state.lookback })); } catch { /* noop */ }
}
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  if (s && LOOKBACKS.includes(s.lookback)) state.lookback = s.lookback;
}

// ── 헤드라인 + 요약 배지 ──
function renderHeadline() {
  const m = DATA.monthly;
  const last = m[m.length - 1];
  const lb = state.lookback;
  const proxy = last[proxyField(lb)];
  const dir = proxy > 0.05 ? 'up' : proxy < -0.05 ? 'down' : 'flat';
  const dirWord = dir === 'up' ? '얹는 중' : dir === 'down' ? '빼는 중' : '중립';
  const color = dir === 'up' ? C.up : dir === 'down' ? C.down : C.muted;

  document.getElementById('headline').innerHTML =
    `<div class="hl-kicker">이번 달 소득 갭 프록시 · <span class="mono">${last.date}</span> 기준 · β 룩백 ${LOOKBACK_LABEL[lb]}</div>
     <div class="hl-value" style="color:${color}">${signed(proxy, 1)}<span class="hl-unit">%p</span>
       <span class="hl-word" style="color:${color}">${dirWord}</span></div>
     <div class="hl-sub">교역조건(수출가격÷수입가격)이 국민소득(GDI)에 ${dir === 'down' ? '빼고' : '얹고'} 있는 폭
       — 소득이 생산보다 ${dir === 'down' ? '느리게' : '빠르게'} 늘어난 근사치</div>`;

  const reg = DATA.meta.beta.regression[lb];
  const q = DATA.quarterly;
  const lastActualQ = [...q].reverse().find((r) => r.gap_actual_pp != null);
  // 프록시가 실적을 얼마나 맞히나 — 실적·분기프록시가 모두 있는 최신 분기.
  const lastPair = [...q].reverse().find((r) => r.gap_actual_pp != null && r.gap_proxy_pp_10y != null);
  const err = lastPair ? lastPair.gap_actual_pp - lastPair.gap_proxy_pp_10y : null;

  document.getElementById('summary').innerHTML = [
    `<div class="stat"><div class="stat-label">순상품교역조건 y/y (최신)</div>
      <div class="stat-main" style="color:${last.tot_yoy_pct >= 0 ? C.up : C.down}">${signed(last.tot_yoy_pct, 1)}<span class="stat-unit">%</span></div>
      <div class="stat-sub">지수 ${fmt(last.tot_index, 1)} · ${last.date}</div></div>`,
    `<div class="stat"><div class="stat-label">β (${LOOKBACK_LABEL[lb]}) · 교역조건 1%p→소득</div>
      <div class="stat-main" style="color:${C.accent}">${fmt(reg.beta, 3)}<span class="stat-unit">%p</span></div>
      <div class="stat-sub">R² ${fmt(reg.r2, 2)} · N=${reg.n} · 이론 ${DATA.meta.beta.theory_range.join('~')}</div></div>`,
    `<div class="stat"><div class="stat-label">최근 분기 실적 갭 (GDI−GDP)</div>
      <div class="stat-main" style="color:${lastActualQ && lastActualQ.gap_actual_pp >= 0 ? C.up : C.down}">${lastActualQ ? signed(lastActualQ.gap_actual_pp, 1) : '—'}<span class="stat-unit">%p</span></div>
      <div class="stat-sub">${lastActualQ ? lastActualQ.quarter : '—'} · GDI ${lastActualQ ? fmt(lastActualQ.gdi_yoy_pct, 1) : '—'} / GDP ${lastActualQ ? fmt(lastActualQ.gdp_yoy_pct, 1) : '—'}</div></div>`,
    `<div class="stat"><div class="stat-label">프록시 정합 (실적−프록시)</div>
      <div class="stat-main" style="color:${C.amber}">${err == null ? '—' : signed(err, 1)}<span class="stat-unit">%p</span></div>
      <div class="stat-sub">${lastPair ? lastPair.quarter : '—'} · 실적 ${lastPair ? fmt(lastPair.gap_actual_pp, 1) : '—'} vs 프록시 ${lastPair ? fmt(lastPair.gap_proxy_pp_10y, 1) : '—'}</div></div>`,
  ].join('');
}

const baseLayout = (extra = {}) => ({
  paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
  font: { color: C.muted, family: FONT, size: 11 },
  margin: { l: 48, r: 14, t: 10, b: 32 },
  legend: { orientation: 'h', x: 0, y: 1.08, font: { size: 11 } },
  hovermode: 'x unified',
  xaxis: { type: 'date', gridcolor: C.grid, linecolor: C.axis, zeroline: false, tickfont: { size: 10 } },
  yaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: true, zerolinecolor: C.axis, tickfont: { size: 10 } },
  ...extra,
});

// ── 줄다리기 차트: 수출물가 y/y vs 수입물가 y/y (최근 5년) ──
function renderTug() {
  const m = DATA.monthly.slice(-60);
  const x = m.map((r) => `${r.date}-01`);
  const traces = [
    { x, y: m.map((r) => r.export_price_yoy_pct), name: '수출물가 y/y', mode: 'lines',
      line: { color: C.up, width: 1.8 }, hovertemplate: '%{x|%Y-%m}<br>수출물가 %{y:+.1f}%<extra></extra>' },
    { x, y: m.map((r) => r.import_price_yoy_pct), name: '수입물가 y/y', mode: 'lines',
      line: { color: C.down, width: 1.8 }, hovertemplate: '%{x|%Y-%m}<br>수입물가 %{y:+.1f}%<extra></extra>' },
  ];
  Plotly.newPlot('chart-tug', traces, baseLayout({ yaxis: { ...baseLayout().yaxis, title: { text: 'y/y %', font: { size: 11 } } } }),
    { displayModeBar: false, responsive: true });
}

// ── 갭 추이 차트: 월간 프록시 라인 + 분기 실적 갭 점 (최근 10년) ──
function renderGap() {
  const lb = state.lookback;
  const m = DATA.monthly.slice(-120);
  const q = DATA.quarterly.slice(-40).filter((r) => r.gap_actual_pp != null);
  const traces = [
    { x: m.map((r) => `${r.date}-01`), y: m.map((r) => r[proxyField(lb)]),
      name: `갭 프록시 (월간·${LOOKBACK_LABEL[lb]})`, mode: 'lines',
      line: { color: C.accent, width: 1.8 },
      hovertemplate: '%{x|%Y-%m}<br>프록시 %{y:+.2f}%p<extra></extra>' },
    { x: q.map((r) => quarterToDate(r.quarter)), y: q.map((r) => r.gap_actual_pp),
      name: '실적 갭 (분기·GDI−GDP)', mode: 'markers',
      marker: { color: C.amber, size: 7, symbol: 'circle', line: { width: 1, color: '#0d1117' } },
      hovertemplate: '%{x|%YQ%q}<br>실적 갭 %{y:+.2f}%p<extra></extra>',
      text: q.map((r) => r.quarter) },
  ];
  Plotly.newPlot('chart-gap', traces, baseLayout({ yaxis: { ...baseLayout().yaxis, title: { text: '갭 %p', font: { size: 11 } } } }),
    { displayModeBar: false, responsive: true });
}

// ── 하단 컨트롤·정보 ──
function renderControls() {
  document.querySelectorAll('#lookback-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lb === state.lookback);
  });
  const b = DATA.meta.beta;
  const wi = b.with_intercept_10y;
  document.getElementById('beta-info').innerHTML =
    `<span class="k">β</span> 5년 ${fmt(b.regression['5y'].beta, 3)} · 10년 ${fmt(b.regression['10y'].beta, 3)} · 전체 ${fmt(b.regression.all.beta, 3)} `
    + `(디폴트 10년, R² ${fmt(b.regression['10y'].r2, 2)}, N=${b.regression['10y'].n}) &nbsp;|&nbsp; `
    + `절편포함(10년): β ${fmt(wi.beta, 3)}, 절편 ${signed(wi.intercept, 2)}%p, R² ${fmt(wi.r2, 2)} &nbsp;|&nbsp; `
    + `이론 β ${b.theory_range.join('~')} = (수출+수입)/(2·명목GDP)`;
  document.getElementById('footnote').innerHTML =
    `<div>β: 교역조건이 1%p 개선되면 국민소득(GDI)이 생산(GDP)보다 약 <span class="k">β %p</span> 더 늘어난다는 회귀 계수 `
    + `(분기평균 교역조건 y/y → 실적 갭, 절편없는 OLS). 갭 프록시 = β × 순상품교역조건 y/y.</div>`
    + `<div>줄다리기 차트의 수출·수입물가는 <span class="k">계약통화기준</span>(환율효과 제거) 보조지표 — `
    + `순상품교역조건과 가중·연쇄식 차이로 정확히 일치하진 않는다.</div>`
    + `<div>출처: 전량 ECOS. 순상품교역조건 403Y005 · 수출/수입물가 402Y014·401Y015 · 실질 GDP/GDI 200Y106(원계열). `
    + `업데이트 <span class="k">${DATA.meta.last_monthly}</span>(월간) · <span class="k">${DATA.meta.last_quarter}</span>(분기).</div>`
    + `<div>이 모듈은 갭 항(GDI−GDP)만 측정한다. GDP 레벨 경로 연간 환산은 `
    + `<a href="gdp-annual.html" style="color:var(--accent);text-decoration:none">연간 GDP 환산기</a> 참조.</div>`;
}

function renderAll() { renderHeadline(); renderTug(); renderGap(); renderControls(); }

function wire() {
  document.getElementById('lookback-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const lb = btn.dataset.lb; if (!LOOKBACKS.includes(lb) || lb === state.lookback) return;
    state.lookback = lb; save();
    renderHeadline(); renderGap(); renderControls(); // 룩백 영향: 헤드라인·갭 라인·β 표기
  });
}

export async function initGG1() {
  load();
  let res;
  try { res = await fetch(DATA_URL, { cache: 'no-cache' }); } catch { res = null; }
  if (!res || !res.ok) {
    document.getElementById('app').insertAdjacentHTML('beforeend',
      `<div class="empty"><code>${DATA_URL}</code> 를 fetch로 읽으므로 <b>로컬 서버</b>가 필요합니다 (file:// 직접 열기 불가).<br>`
      + `예: <code>python -m http.server</code> 후 <code>localhost:8000/gg1-income-gap.html</code></div>`);
    return;
  }
  DATA = await res.json();
  wire();
  renderAll();
}

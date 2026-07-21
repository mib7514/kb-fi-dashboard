// us-credit-spread-ui.js — 미국 크레딧 스프레드(CS 모듈) 페이지 컨트롤러.
//   측정만 한다(what the market says). 해석은 넣지 않는다.
//   데이터: data/us-credit-spread.json 을 fetch (로컬 서버 서빙 전제 — file:// 미지원).
//   룩백(1y/all)만 localStorage 'us-credit-spread' 에 저장. z250 은 fetch 스크립트 선계산.
//   no-build: 의존성은 Plotly(vendor) 뿐.
//   Phase 2 = 카드 6 + 차트 3 + 룩백 토글. Phase 3(이벤트 마커·로그 테이블)은 후속.

const DATA_URL = 'data/us-credit-spread.json';
const EVENTS_URL = 'data/us-issuance-events.json';
const LS_KEY = 'us-credit-spread';
const LOOKBACKS = ['1y', 'all'];
const LOOKBACK_LABEL = { '1y': '1Y', all: '전체' };
const YEAR_SESSIONS = 252; // 1Y ≈ 252 영업일

// 팔레트(사이트 기존 토큰과 동일)
const C = {
  accent: '#58a6ff', up: '#3fb950', amber: '#f0883e', red: '#f85149', purple: '#a371f7',
  grid: '#21262d', axis: '#484f58', muted: '#8b949e', text: '#c9d1d9',
};
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const state = { lookback: '1y' };
let DATA = null;
let EVENTS = [];

const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const signed = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d));

// z 부호·크기 색상: |z|<1 중립, z>0(평소보다 확대)=난색, z<0(축소)=한색. 크기로 강도.
function zColor(z) {
  if (z == null || Number.isNaN(z)) return C.muted;
  if (Math.abs(z) < 1) return C.muted;
  if (z > 0) return z >= 2 ? C.red : C.amber;
  return C.up;
}

// 시리즈/파생 접근 헬퍼
const ser = (k) => DATA.series[k];
const der = (k) => DATA.derived[k];
// [[date,bp]] 에서 최신값·전주(5영업일 전) 대비 변화
function latestAndWoW(data) {
  if (!data || !data.length) return { last: null, wow: null, date: null };
  const last = data[data.length - 1][1];
  const date = data[data.length - 1][0];
  const prev = data.length > 5 ? data[data.length - 1 - 5][1] : null;
  return { last, wow: prev == null ? null : Math.round((last - prev) * 10) / 10, date };
}
// 룩백 슬라이스
const slice = (data) => (state.lookback === '1y' ? data.slice(-YEAR_SESSIONS) : data);

// ── 상단 카드 6종 ──
const CARDS = [
  { key: 'ig_oas', kind: 'series', label: 'IG OAS' },
  { key: 'hy_oas', kind: 'series', label: 'HY OAS' },
  { key: 'hy_minus_ig', kind: 'derived', label: 'HY − IG' },
  { key: 'bbb_minus_a', kind: 'derived', label: 'BBB − A' },
  { key: 'a_minus_aa', kind: 'derived', label: 'A − AA' },
  { key: 'long_minus_all', kind: 'derived', label: 'IG 15Y+ − 전체' },
];

function renderCards() {
  const html = CARDS.map((c) => {
    const obj = c.kind === 'series' ? ser(c.key) : der(c.key);
    const { last, wow, date } = latestAndWoW(obj.data);
    const z = obj.z250_latest;
    const wowStr = wow == null ? '—' : `${signed(wow, 1)}bp/주`;
    return `<div class="stat">
      <div class="stat-label">${c.label}</div>
      <div class="stat-main">${fmt(last, 1)}<span class="stat-unit">bp</span></div>
      <div class="stat-sub">Δ ${wowStr} · z250 <span style="color:${zColor(z)}">${z == null ? '—' : signed(z, 2)}</span></div>
    </div>`;
  }).join('');
  document.getElementById('summary').innerHTML = html;
}

const baseLayout = (extra = {}) => ({
  paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
  font: { color: C.muted, family: FONT, size: 11 },
  margin: { l: 48, r: 14, t: 10, b: 32 },
  legend: { orientation: 'h', x: 0, y: 1.1, font: { size: 11 } },
  hovermode: 'x unified',
  xaxis: { type: 'date', gridcolor: C.grid, linecolor: C.axis, zeroline: false, tickfont: { size: 10 } },
  yaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: true, zerolinecolor: C.axis, tickfont: { size: 10 },
    title: { text: 'bp', font: { size: 11 } } },
  ...extra,
});
const line = (obj, name, color) => {
  const d = slice(obj.data);
  return { x: d.map((r) => r[0]), y: d.map((r) => r[1]), name, mode: 'lines',
    line: { color, width: 1.7 },
    hovertemplate: `%{x|%Y-%m-%d}<br>${name} %{y:.1f}bp<extra></extra>` };
};

// ── 발행 이벤트 오버레이 ──
// 월만 있는 날짜('YYYY-MM')는 15일로 플롯. 전체 날짜는 그대로.
const evPlotDate = (d) => (d && d.length === 7 ? `${d}-15` : d);
// 이벤트 툴팁(발행사·규모·트랜치·concession·coverage)
function evTip(ev) {
  const sz = ev.size_bn == null ? '—' : `$${ev.size_bn}bn`;
  const tr = ev.tranches == null ? '' : ` · ${ev.tranches}트랜치`;
  const con = ev.concession_bp == null ? '—'
    : (Array.isArray(ev.concession_bp) ? `${ev.concession_bp[0]}–${ev.concession_bp[1]}bp` : `${ev.concession_bp}bp`);
  const cov = ev.coverage_x == null ? '—' : `${ev.coverage_x}x`;
  return `<b>${ev.issuer}</b> ${ev.date}<br>규모 ${sz}${tr}<br>concession ${con} · coverage ${cov}`;
}
// traces(플롯될 시리즈) 기준 가시 x범위·yMax 계산 → {shapes, markerTrace}. 이벤트 없으면 shapes:[], markerTrace:null.
function eventOverlay(traces) {
  if (!EVENTS.length || !traces.length || !traces[0].x.length) return { shapes: [], markerTrace: null };
  const firstX = traces[0].x[0], lastX = traces[0].x[traces[0].x.length - 1];
  const yMax = Math.max(...traces.flatMap((t) => t.y.filter((v) => v != null)));
  const evs = EVENTS.map((ev) => ({ ev, px: evPlotDate(ev.date) }))
    .filter(({ px }) => px >= firstX && px <= lastX);
  if (!evs.length) return { shapes: [], markerTrace: null };
  const shapes = evs.map(({ px }) => ({
    type: 'line', xref: 'x', yref: 'paper', x0: px, x1: px, y0: 0, y1: 1,
    line: { color: C.muted, width: 1, dash: 'dot' }, layer: 'below',
  }));
  const markerTrace = {
    x: evs.map(({ px }) => px), y: evs.map(() => yMax), mode: 'markers', name: '발행',
    marker: { color: C.purple, size: 9, symbol: 'triangle-down', line: { width: 1, color: '#0d1117' } },
    text: evs.map(({ ev }) => evTip(ev)), hovertemplate: '%{text}<extra></extra>',
  };
  return { shapes, markerTrace };
}
// 차트 1 — IG vs HY OAS (단일축, 마커 없음)
function renderMain() {
  Plotly.newPlot('chart-main',
    [line(ser('ig_oas'), 'IG OAS', C.accent), line(ser('hy_oas'), 'HY OAS', C.amber)],
    baseLayout(), { displayModeBar: false, responsive: true });
}
// 차트 2 — 등급별 OAS (AAA/AA/A/BBB, 위험도 순 난색화) + 발행 마커
function renderGrades() {
  const traces = [
    line(ser('aaa'), 'AAA', C.accent), line(ser('aa'), 'AA', C.up),
    line(ser('a'), 'A', C.amber), line(ser('bbb'), 'BBB', C.red),
  ];
  const { shapes, markerTrace } = eventOverlay(traces);
  if (markerTrace) traces.push(markerTrace);
  Plotly.newPlot('chart-grades', traces, baseLayout({ shapes }), { displayModeBar: false, responsive: true });
}
// 차트 3 — 파생 스프레드 (BBB−A, A−AA, 장기−전체) + 발행 마커
function renderDerived() {
  const traces = [
    line(der('bbb_minus_a'), 'BBB − A', C.amber),
    line(der('a_minus_aa'), 'A − AA', C.accent),
    line(der('long_minus_all'), 'IG 15Y+ − 전체', C.purple),
  ];
  const { shapes, markerTrace } = eventOverlay(traces);
  if (markerTrace) traces.push(markerTrace);
  Plotly.newPlot('chart-derived', traces, baseLayout({ shapes }), { displayModeBar: false, responsive: true });
}
// ── 발행 이벤트 로그 테이블 (최근순) ──
function renderEventTable() {
  const el = document.getElementById('event-log');
  if (!el) return;
  if (!EVENTS.length) { el.innerHTML = '<div class="cap" style="padding:8px">이벤트 없음</div>'; return; }
  const rows = [...EVENTS].sort((a, b) => (a.date < b.date ? 1 : -1)).map((ev) => {
    const con = ev.concession_bp == null ? '—'
      : (Array.isArray(ev.concession_bp) ? `${ev.concession_bp[0]}–${ev.concession_bp[1]}` : `${ev.concession_bp}`);
    return `<tr>
      <td class="mono">${ev.date}</td><td>${ev.issuer}</td>
      <td class="mono num">${ev.size_bn == null ? '—' : ev.size_bn}</td>
      <td class="mono num">${ev.tranches == null ? '—' : ev.tranches}</td>
      <td class="mono num">${con}</td>
      <td class="mono num">${ev.coverage_x == null ? '—' : ev.coverage_x}</td>
      <td class="evt-note">${ev.note == null ? '—' : ev.note}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="evt"><thead><tr>
    <th>날짜</th><th>발행사</th><th class="num">$bn</th><th class="num">트랜치</th>
    <th class="num">concession(bp)</th><th class="num">coverage(x)</th><th>비고</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderControls() {
  document.querySelectorAll('#lookback-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lb === state.lookback);
  });
  const m = DATA.meta;
  document.getElementById('footnote').innerHTML =
    `<div>OAS = Option-Adjusted Spread(bp). z250 = 최근 250영업일 표본 대비 표준화(표본<250이면 —). `
    + `파생: HY−IG(리스크 선호) · BBB−A(등급 커브) · A−AA(상위등급 차별화) · IG 15Y+−전체(장기 프리미엄).</div>`
    + `<div>출처: <span class="k">FRED · ICE BofA(BAML) OAS</span>. `
    + `${m.history_note}</div>`
    + `<div>업데이트 <span class="k">${m.updated_at}</span> · 시리즈 ${m.series_ids.length}종 · z윈도 <span class="k">${m.z_window}d</span>. `
    + `측정만 한다 — 해석 없음.</div>`;
}

function renderCharts() { renderMain(); renderGrades(); renderDerived(); }
function renderAll() { renderCards(); renderCharts(); renderControls(); renderEventTable(); }

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ kind: LS_KEY, version: 1, lookback: state.lookback })); } catch { /* noop */ }
}
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  if (s && LOOKBACKS.includes(s.lookback)) state.lookback = s.lookback;
}

function wire() {
  document.getElementById('lookback-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const lb = btn.dataset.lb; if (!LOOKBACKS.includes(lb) || lb === state.lookback) return;
    state.lookback = lb; save();
    renderCharts(); renderControls(); // 룩백은 차트 창만 바꾼다(카드는 항상 최신+z250 고정)
  });
}

export async function initCreditSpread() {
  load();
  let res;
  try { res = await fetch(DATA_URL, { cache: 'no-cache' }); } catch { res = null; }
  if (!res || !res.ok) {
    document.getElementById('app').insertAdjacentHTML('beforeend',
      `<div class="empty"><code>${DATA_URL}</code> 를 fetch로 읽으므로 <b>로컬 서버</b>가 필요합니다 (file:// 직접 열기 불가).<br>`
      + `예: <code>python -m http.server</code> 후 <code>localhost:8000/us-credit-spread.html</code></div>`);
    return;
  }
  DATA = await res.json();
  // 발행 이벤트는 부재 허용(마커·테이블만 비고 실패해도 차트는 렌더).
  try {
    const er = await fetch(EVENTS_URL, { cache: 'no-cache' });
    if (er && er.ok) { const ej = await er.json(); EVENTS = Array.isArray(ej.events) ? ej.events : []; }
  } catch { EVENTS = []; }
  wire();
  renderAll();
}

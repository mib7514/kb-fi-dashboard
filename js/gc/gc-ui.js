// gc-ui.js — Global Curve Compare(GC-3) 렌더러. curve-phase 페이지 내 신규 섹션.
//   질문: KR 커브가 글로벌 텀프리미엄 동조인가, 국내 고유 수급인가 — 3/10·10/30 스프레드를 KR/US/JP 나란히.
//   계산은 전량 gc-calc.js(순수). 여기선 fetch·렌더만. 판단 문구 없음(레벨·z·Δ만).
//   데이터: data/gc/{us,jp,kr}.json (로컬 서버 서빙 전제 — file:// 미지원). 국가별 독립(정렬·보간 없음).
//   토글(lookback·차트 모드)만 localStorage 'gc-compare' 저장. 의존성: Plotly(vendor).

import { computeGC } from './gc-calc.js';

const FILES = { KR: 'data/gc/kr.json', US: 'data/gc/us.json', JP: 'data/gc/jp.json' };
const COUNTRIES = ['KR', 'US', 'JP'];
const SPREADS = [{ key: 's310', label: '3/10', el: 'gc-chart-310' }, { key: 's1030', label: '10/30', el: 'gc-chart-1030' }];
const LOOKBACKS = { '1y': 1, '3y': 3, '5y': 5 };
const LS_KEY = 'gc-compare';

// 국가 고정 색: KR 강조(굵게·accent), US/JP 보조. 테마별 이원화 — dark 는 기존 값 그대로.
// COLOR/C 는 뮤터블 라이브 객체(참조 유지, 값만 교체). 렌더 함수가 호출 시점에 읽는다.
// curve-phase 페이지의 'cp-theme-change' 를 독립적으로 수신 — cp-ui 와 상호 참조하지 않는다.
const PALETTES = {
  dark: {
    country: { KR: '#58a6ff', US: '#f0883e', JP: '#a371f7' },
    chrome: { grid: '#21262d', axis: '#484f58', muted: '#8b949e', text: '#c9d1d9' },
  },
  light: {
    country: { KR: '#60584c', US: '#d98e04', JP: '#7c5cbf' },
    chrome: { grid: '#ebe7de', axis: '#c6bfb1', muted: '#837b6d', text: '#3c382f' },
  },
};
const COLOR = { ...PALETTES.dark.country };
const C = { ...PALETTES.dark.chrome };
const WIDTH = { KR: 2.6, US: 1.6, JP: 1.6 };
function applyPalette(theme) {
  const p = PALETTES[theme === 'light' ? 'light' : 'dark'];
  Object.assign(COLOR, p.country);
  Object.assign(C, p.chrome);
}
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const state = { lookback: '3y', mode: { s310: 'level', s1030: 'level' } };
let GC = null;      // { KR:{meta,gc}, ... } — 로드 성공 국가만
let LATEST = null;  // 전 국가 통틀어 최신일(ISO)

const fmt1 = (x) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(1));
const fmt2 = (x) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(2));
const sgn1 = (x) => (x == null || Number.isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(1));

// ── 저장/로드(토글만) ──
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ kind: LS_KEY, version: 1, lookback: state.lookback, mode: state.mode })); } catch { /* noop */ }
}
function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  if (!s) return;
  if (s.lookback in LOOKBACKS) state.lookback = s.lookback;
  if (s.mode) for (const k of ['s310', 's1030']) if (s.mode[k] === 'level' || s.mode[k] === 'z') state.mode[k] = s.mode[k];
}

async function loadCountry(c) {
  try {
    const r = await fetch(FILES[c], { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    return { meta: j.meta, gc: computeGC(j.rows) };
  } catch { return null; }
}

// lookback 컷오프: 최신일에서 N년 전(자국별 슬라이스에 공통 적용).
function cutoffISO() {
  const yrs = LOOKBACKS[state.lookback];
  const [y, m, d] = LATEST.split('-');
  return `${Number(y) - yrs}-${m}-${d}`;
}

function layout(yTitle) {
  return {
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { color: C.muted, family: FONT, size: 11 },
    margin: { l: 48, r: 14, t: 8, b: 32 },
    legend: { orientation: 'h', x: 0, y: 1.12, font: { size: 11 } },
    hovermode: 'x unified',
    xaxis: { type: 'date', gridcolor: C.grid, linecolor: C.axis, zeroline: false, tickfont: { size: 10 } },
    yaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: true, zerolinecolor: C.axis, tickfont: { size: 10 }, title: { text: yTitle, font: { size: 11 } } },
  };
}

// 한 스프레드 차트: KR/US/JP 오버레이. mode 'level'(bp) | 'z'(z250). 결측 line skip(보간 없음).
function renderChart(key, elId) {
  if (!GC) return;
  const mode = state.mode[key];
  const cut = cutoffISO();
  const traces = Object.keys(GC).map((c) => {
    const obj = GC[c].gc[key];
    const src = mode === 'z' ? obj.z : obj.series;
    const pts = src.filter((p) => p.d >= cut);
    return {
      x: pts.map((p) => p.d),
      y: pts.map((p) => (mode === 'z' ? p.z : p.v)),
      name: c, mode: 'lines', connectgaps: false,
      line: { color: COLOR[c], width: WIDTH[c] },
      hovertemplate: `${c} %{x|%Y-%m-%d}<br>${mode === 'z' ? 'z %{y:.2f}' : '%{y:.1f}bp'}<extra></extra>`,
    };
  });
  Plotly.newPlot(elId, traces, layout(mode === 'z' ? 'z250' : 'bp'), { displayModeBar: false, responsive: true });
}

function renderCharts() { for (const s of SPREADS) renderChart(s.key, s.el); }

// 요약 테이블: 국가 × 스프레드 (기준일 / level bp / z250 / Δ1w / Δ1m).
function renderTable() {
  const head = `<thead><tr><th>국가</th><th>스프레드</th><th>기준일</th>
    <th class="num">level bp</th><th class="num">z250</th><th class="num">Δ1w</th><th class="num">Δ1m</th></tr></thead>`;
  const body = Object.keys(GC).map((c) => SPREADS.map((s) => {
    const m = GC[c].gc[s.key].latest;
    const em = c === 'KR' ? ' style="color:var(--text);font-weight:600"' : '';
    return `<tr><td${em}>${c}</td><td>${s.label}</td><td class="num">${m.date ?? '—'}</td>
      <td class="num">${fmt1(m.level)}</td><td class="num">${fmt2(m.z250)}</td>
      <td class="num">${sgn1(m.d1w)}</td><td class="num">${sgn1(m.d1m)}</td></tr>`;
  }).join('')).join('');
  document.getElementById('gc-table').innerHTML = head + `<tbody>${body}</tbody>`;
  document.getElementById('gc-asof').textContent =
    Object.keys(GC).map((c) => `${c} ${GC[c].meta.updated}`).join(' · ');
}

function renderFootnote() {
  document.getElementById('gc-footnote').innerHTML =
    '<div>z250 = 250영업일 기준, 국가별 독립 산출. JP는 YCC 해제 전후 레짐 차이로 장기 z 비교 부적합. '
    + '스프레드/Δ bp(소수 1자리), 국가 간 날짜 미정렬(시리즈별 독립, 결측 보간 없음). 출처: US FRED · JP 재무성 · KR ECOS.</div>';
}

function syncSegs() {
  document.querySelectorAll('#gc-lookback button').forEach((b) => b.classList.toggle('active', b.dataset.lb === state.lookback));
  document.querySelectorAll('.gc-mode').forEach((seg) => {
    const key = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode[key]));
  });
}

function wire() {
  document.getElementById('gc-lookback').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const lb = b.dataset.lb; if (!(lb in LOOKBACKS) || lb === state.lookback) return;
    state.lookback = lb; save(); syncSegs(); renderCharts();
  });
  document.querySelectorAll('.gc-mode').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const key = seg.dataset.key; const mode = b.dataset.mode;
      if (state.mode[key] === mode) return;
      state.mode[key] = mode; save(); syncSegs();
      renderChart(key, SPREADS.find((s) => s.key === key).el);
    });
  });
}

export async function initGC3() {
  loadState();
  applyPalette(document.documentElement.dataset.cpTheme);
  window.addEventListener('cp-theme-change', (e) => {
    applyPalette((e.detail && e.detail.theme) || document.documentElement.dataset.cpTheme);
    // 표·각주는 CSS 변수로 따라오므로 차트만 다시 그린다. 로드 실패 시 차트 div 자체가 없으므로 건너뛴다.
    if (GC && Object.keys(GC).length) renderCharts();
  });
  const entries = await Promise.all(COUNTRIES.map(loadCountry));
  GC = {};
  COUNTRIES.forEach((c, i) => { if (entries[i]) GC[c] = entries[i]; });
  const present = Object.keys(GC);
  if (!present.length) {
    const body = document.getElementById('gc-body');
    if (body) body.innerHTML = '<div class="empty"><code>data/gc/*.json</code> 로드 실패 — <b>로컬 서버</b>가 필요합니다 (file:// 불가).</div>';
    return;
  }
  LATEST = present.map((c) => GC[c].gc.s310.latest.date).filter(Boolean).sort().pop();
  wire(); syncSegs(); renderCharts(); renderTable(); renderFootnote();
}

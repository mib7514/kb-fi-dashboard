// cp-ui.js — Curve Phase Monitor 페이지 컨트롤러. 측정만(결정론 밴드 라벨). export initCurvePhase().
//   Phase 2: KR 변수1(프라이싱 갭) 패널 — 3Y−기준·1Y−기준 스프레드(bp)의 현재값·전기간 percentile·z250
//   + 룩백 토글(1y/3y/10y/all, 기본 3y) + 스프레드 시계열 차트 + 판독 가이드(밴드).
//   US 패널(변수1/2/3)·5y5y·분해·판정·오버레이는 Phase 3~6 에서 추가.

import { loadCurveData, loadCycles } from './cp-data.js';
import { spreadSeries, colSpreadBp, fwd5y5y, seriesDiff, decompKR, decompUS, summarize, band, BAND_HI, BAND_LO } from './cp-calc.js';
import { C, LOOKBACKS, renderSpreadChart, renderDecompChart, renderOverlayChart } from './cp-charts.js';
import { judgeKR, judgeUS, realizedKR } from './cp-judge.js';
import { buildOverlay } from './cp-overlay.js';

const LS_KEY = 'curve-phase';
const HIST_KEY = 'cp-judge-history';
const state = { lookback: '3y' };
let DATA = null;   // { krYields, krBase, usYields, usTp }
let SERIES = null; // KR { s3:[[date,bp]], s1:[[date,bp]] }
let KRB = null;    // KR 뒷단 { fy:%, s3010:bp }
let US = null;     // US { gap:bp, fy:%, tp:%, exp:% }
let DECOMP = null; // { kr:[{date,front,back,total}], us:[{date,front,backExp,backTp,total}] }
let OVERLAY = null; // { kr:[...cycles], us:[...cycles] } 또는 null(cycles.json 부재)

// 사이클 색(현재 제외). 현재 사이클은 accent 굵은 선.
const CYCLE_COLORS = ['#f0883e', '#3fb950', '#a371f7', '#f85149', '#8b949e'];

const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const signed = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d));
const pctStr = (p) => (p == null ? '—' : `${Math.round(p)}p`);
// 60일 변화 → bp 표기(%p 계열은 ×100). 판정(Phase5) ±10bp 임계와 단위 일치.
const chg60Bp = (chg60, unit) => (chg60 == null ? '—' : `${signed(unit === 'bp' ? chg60 : chg60 * 100, 0)}bp`);

// z 색: |z|<1 중립, z>0 난색, z<0 한색(사이트 규약과 동일).
function zColor(z) {
  if (z == null || Number.isNaN(z)) return C.muted;
  if (Math.abs(z) < 1) return C.muted;
  if (z > 0) return z >= 2 ? C.red : C.amber;
  return C.up;
}

// 변수1 지표 정의: 스프레드키 → {label, tenor, color}
const SPREADS = [
  { key: 's3', label: '3Y − 기준금리', tenor: 'y3', color: C.accent },
  { key: 's1', label: '1Y − 기준금리', tenor: 'y1', color: C.up },
];

// 판독 가이드 밴드(정적 라벨, 결정론). 임계값은 초기값 — 각주 명기.
const BANDS = [
  { key: 'resid', head: `≥${BAND_HI}p · 잔존`, desc: '인상 경로의 소화가 단기 구간에서 진행 중 — 역사적 플랫 국면' },
  { key: 'mixed', head: `${BAND_LO}–${BAND_HI}p · 혼재`, desc: '단기·장기 정보 혼재' },
  { key: 'exhausted', head: `≤${BAND_LO}p · 소진`, desc: '변수1 소진 — 추가 정보는 장기 구간으로' },
];

// ── 판정 이력(localStorage) — vintage(KR 국고채 최신일)별 1건 upsert, 최근 60건 유지 ──
function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; } }
function upsertHistory(entry) {
  const h = loadHistory();
  const i = h.findIndex((e) => e.vintage === entry.vintage);
  if (i >= 0) h[i] = entry; else h.push(entry);
  h.sort((a, b) => (a.vintage < b.vintage ? -1 : 1));
  const trimmed = h.slice(-60);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(trimmed)); } catch { /* noop */ }
  return trimmed;
}
function historyStrip(hist) {
  if (hist.length < 2) return '';
  const rows = hist.slice(-8).reverse().map((e) =>
    `<div class="v-hist-row"><span class="k">${e.vintage}</span> ${e.krLabel}`
    + `${e.net == null ? '' : ` · 실현 ${signed(e.net, 1)}bp`}</div>`).join('');
  return `<div class="v-history"><div class="v-hist-title">판정 이력(최근)</div>${rows}</div>`;
}

// ── 판정 카드(최상단): KR 라벨 大 + US 부가 小 + 실현(20d) + 지표별 기준일 ──
function renderVerdict() {
  const s3 = summarize(SERIES.s3), fy = summarize(KRB.fy), tp = summarize(US.tp), exp = summarize(US.exp);
  const toBp = (c) => (c == null ? null : c * 100); // %p 계열 chg60 → bp
  const kr = judgeKR({ v1pct: s3.pct, kr5y5yChg60: toBp(fy.chg60), usTpChg60: toBp(tp.chg60) });
  const us = judgeUS({ usExpChg60: toBp(exp.chg60), usTpChg60: toBp(tp.chg60) });
  const real = realizedKR(DECOMP.kr.at(-1));
  const hist = upsertHistory({
    vintage: DATA.krYields.meta.updated_at, krKey: kr.key, krLabel: kr.label,
    usLabel: us.label, net: real ? real.netBp : null,
  });
  const el = document.getElementById('verdict');
  el.className = `verdict tone-${kr.tone}`;
  el.innerHTML =
    `<div class="v-eyebrow">판정 (조건 성립) · KR 주력</div>`
    + `<div class="v-kr">${kr.label}</div>`
    + `<div class="v-us">US 식별(부가): ${us.label}</div>`
    + (real ? `<div class="v-real">실현(20d): <b>${signed(real.netBp, 1)}bp ${real.direction}</b>, ${real.dominant} 우세 <span class="v-note">— 판정=조건, 실현=분해 움직임(갈릴 수 있음)</span></div>` : '')
    + `<div class="v-dates">기준일 · 3Y−기준 <span class="k">${s3.date}</span> · KR 5y5y <span class="k">${fy.date}</span> · US TP <span class="k">${tp.date}</span> · US 기대 <span class="k">${exp.date}</span></div>`
    + historyStrip(hist);
}

function renderCards() {
  const baseRate = DATA.krBase.data.at(-1);
  const cards = SPREADS.map((s) => {
    const { last, pct, z } = summarize(SERIES[s.key]);
    return `<div class="stat">
      <div class="stat-label">${s.label}</div>
      <div class="stat-main">${fmt(last, 1)}<span class="stat-unit">bp</span></div>
      <div class="stat-sub">pct <span style="color:${zColor(z)}">${pctStr(pct)}</span> · z250 ${z == null ? '—' : signed(z, 2)}</div>
    </div>`;
  }).join('');
  const baseCard = `<div class="stat">
      <div class="stat-label">기준금리(현재)</div>
      <div class="stat-main">${fmt(baseRate.rate, 2)}<span class="stat-unit">%</span></div>
      <div class="stat-sub">최신 ${baseRate.date}</div>
    </div>`;
  document.getElementById('summary').innerHTML = cards + baseCard;
}

// 판독 가이드 — 3Y−기준(주 지표) percentile 이 속한 밴드를 활성 표시(결정론 분류).
function renderGuide() {
  const { pct } = summarize(SERIES.s3);
  const active = band(pct);
  const rows = BANDS.map((b) => `<div class="guide-row${b.key === active ? ' active' : ''}">
      <span class="guide-head">${b.head}</span><span class="guide-desc">${b.desc}</span>
    </div>`).join('');
  document.getElementById('kr-guide').innerHTML =
    `<div class="guide-title">변수1 판독 · 3Y−기준 = <b>${pctStr(pct)}</b></div>${rows}`;
}

function renderKRChart() {
  renderSpreadChart('chart-kr-gap',
    SPREADS.map((s) => ({ name: s.label, color: s.color, data: SERIES[s.key] })),
    state.lookback, 'bp');
}

// 레벨(%) 카드 헬퍼: 값 + z250 + 60일 변화(bp).
function levelCard(label, sum) {
  return `<div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-main">${fmt(sum.last, 2)}<span class="stat-unit">%</span></div>
      <div class="stat-sub">z250 ${sum.z == null ? '—' : signed(sum.z, 2)} · Δ60d ${chg60Bp(sum.chg60, '%')}</div>
    </div>`;
}
// bp 레벨 카드(스프레드): 값(bp) + z250 + 60일 변화(bp).
function bpCard(label, sum) {
  return `<div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-main">${fmt(sum.last, 1)}<span class="stat-unit">bp</span></div>
      <div class="stat-sub">z250 ${sum.z == null ? '—' : signed(sum.z, 2)} · Δ60d ${chg60Bp(sum.chg60, 'bp')}</div>
    </div>`;
}

// ── KR 뒷단 (변수2/3 프록시) — 5y5y · 30Y−10Y ──
function renderKRBackCards() {
  document.getElementById('kr-back-summary').innerHTML =
    levelCard('KR 5y5y (2×10Y−5Y)', summarize(KRB.fy))
    + bpCard('KR 30Y−10Y (TP 프록시)', summarize(KRB.s3010));
}
function renderKRBackCharts() {
  renderSpreadChart('chart-kr-5y5y', [{ name: 'KR 5y5y', color: C.purple, data: KRB.fy }], state.lookback, '%');
  renderSpreadChart('chart-kr-3010', [{ name: 'KR 30Y−10Y', color: C.amber, data: KRB.s3010 }], state.lookback, 'bp');
}

// ── 분해 차트 (20d 롤링, 최근 ~6개월) ──
function renderDecompCharts() {
  renderDecompChart('chart-kr-decomp', DECOMP.kr, [
    { key: 'front', name: '앞단 −Δ(3Y−기준)', color: C.accent },
    { key: 'back', name: '뒷단 (잔차)', color: C.purple },
  ]);
  renderDecompChart('chart-us-decomp2', DECOMP.us, [
    { key: 'front', name: '앞단 −Δ(2Y−EFFR)', color: C.accent },
    { key: 'backExp', name: '뒷단·기대', color: C.up },
    { key: 'backTp', name: '뒷단·TP', color: C.amber },
  ]);
}

// ── 사이클 오버레이 ──
function assignColors(overlays) {
  let i = 0;
  return overlays.map((o) => ({ ...o, color: o.current ? C.accent : CYCLE_COLORS[i++ % CYCLE_COLORS.length] }));
}
function renderCaptions(id, overlays) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = overlays.map((o) => {
    const d = o.deltaBp == null ? '' : `<span class="cyc-delta">Δ ${signed(o.deltaBp, 1)}bp</span>`;
    const win = o.lastOffset == null ? '' : ` <span class="cyc-win">(T0→T+${o.lastOffset})</span>`;
    return `<div class="cyc-row">
        <span class="cyc-swatch" style="background:${o.color}${o.current ? '' : ';opacity:.55'}"></span>
        <span class="cyc-lab">${o.label}</span>
        <span class="cyc-cap">${o.caption}</span>${d}${win}
      </div>`;
  }).join('');
}
function renderOverlays() {
  if (!OVERLAY) return;
  renderOverlayChart('chart-kr-overlay', OVERLAY.kr);
  renderOverlayChart('chart-us-overlay', OVERLAY.us);
  renderCaptions('kr-caps', OVERLAY.kr);
  renderCaptions('us-caps', OVERLAY.us);
}

// ── US 패널 (참고·식별용) ──
function renderUSCards() {
  const gap = summarize(US.gap); // bp — 변수1
  const gapCard = `<div class="stat">
      <div class="stat-label">DGS2 − EFFR</div>
      <div class="stat-main">${fmt(gap.last, 1)}<span class="stat-unit">bp</span></div>
      <div class="stat-sub">pct <span style="color:${zColor(gap.z)}">${pctStr(gap.pct)}</span> · z250 ${gap.z == null ? '—' : signed(gap.z, 2)}</div>
    </div>`;
  document.getElementById('us-summary').innerHTML =
    gapCard
    + levelCard('5y5y (2×10Y−5Y)', summarize(US.fy))
    + levelCard('기대성분 (5y5y−TP)', summarize(US.exp))
    + levelCard('ACM TP10', summarize(US.tp));
}
function renderUSCharts() {
  renderSpreadChart('chart-us-gap',
    [{ name: 'DGS2 − EFFR', color: C.accent, data: US.gap }], state.lookback, 'bp');
  renderSpreadChart('chart-us-decomp',
    [{ name: '기대성분 (5y5y−TP)', color: C.purple, data: US.exp },
      { name: 'ACM TP10', color: C.amber, data: US.tp }], state.lookback, '%');
}

function renderFootnote() {
  const my = DATA.krYields.meta, mb = DATA.krBase.meta;
  document.getElementById('footnote').innerHTML =
    `<div>변수1(프라이싱 갭) = 단기 구간이 인상 경로를 얼마나 반영했는가. `
    + `<span class="k">3Y−기준</span>·<span class="k">1Y−기준</span> 스프레드(bp) = (국고채 만기금리 − 기준금리). `
    + `pct = 전기간 percentile(현재값 포함), z250 = 최근 250영업일 표본 표준화(표본&lt;250이면 —).</div>`
    + `<div>기준금리 조인은 <span class="k">직전 관측값 carry-forward(계단 함수, 보간 없음)</span>. `
    + `기준금리는 2008-03 이전 콜금리목표제(7일물 RP 기준금리 2008-03 도입) — ECOS back-stitch, percentile 전기간 포함.</div>`
    + `<div>본 게이지는 <span class="k">배달 잔량(기준금리 대비)</span>을 측정하며 <span class="k">서프라이즈 여지</span>와 구분됨. `
    + `역사적 플랫 국면 판독은 '터미널 지속 상향' 조건에서 성립했던 패턴 기반.</div>`
    + `<div>밴드 임계값(≥${BAND_HI}p 잔존 / ≤${BAND_LO}p 소진)은 <span class="k">초기값</span> — 관찰 후 조정 가능.</div>`
    + `<div><b>US(참고·식별용)</b> — 변수1 <span class="k">DGS2−EFFR</span> pct(KR과 동일). `
    + `변수2 <span class="k">기대성분 = 5y5y − ACM TP</span>(r* 프록시), 변수3 <span class="k">ACM TP10</span> 직접 관측. `
    + `5y5y ≈ 2×10Y−5Y(par 단순근사, 레벨편의 존재 → 방향·z 전용). `
    + `TP는 10Y ACM이라 5y5y와 만기 불일치(호라이즌 프록시). 장단기 분해는 모델 추정치.</div>`
    + `<div><b>분해(20d 롤링)</b> — KR Δ3s10s = 앞단<span class="k">−Δ(3Y−기준)</span> + 뒷단<span class="k">잔차</span>. `
    + `기준금리 계단 변동은 앞·뒷단에서 상쇄되어 정확 항등식. `
    + `US Δ2s10s = 앞단 + 뒷단(<span class="k">기대</span>·<span class="k">TP</span> 2차 분해, US만 가능). 각국 자체 거래일 축(크로스 조인 없음).</div>`
    + `<div><b>판정</b> — 판정표는 <span class="k">조건 성립</span>(변수1 pct + 5y5y·TP <span class="k">60d</span>), 실현 요약은 <span class="k">20d</span> 분해 순변화. `
    + `창 길이가 달라 조건과 실현이 갈릴 수 있음(카드에 병기). 판정은 각국 최신 as-of 스냅샷 — 지표별 기준일 병기. 임계값 초기값(관찰 후 조정).</div>`
    + `<div>출처: <span class="k">ECOS</span> · 국고채 ${my.updated_at} · 기준금리 ${mb.updated_at} · `
    + `<span class="k">FRED</span> US ${DATA.usYields.meta.updated_at} · ACM TP ${DATA.usTp.meta.updated_at}. 측정만 한다 — 해석 없음.</div>`;
}

function renderControls() {
  document.querySelectorAll('#lookback-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lb === state.lookback);
  });
}

function renderCharts() { renderKRChart(); renderKRBackCharts(); renderUSCharts(); renderDecompCharts(); }
function renderAll() {
  renderVerdict();
  renderCards(); renderGuide(); renderKRBackCards(); renderUSCards();
  renderCharts(); renderOverlays(); renderControls(); renderFootnote();
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ kind: LS_KEY, version: 1, lookback: state.lookback })); } catch { /* noop */ }
}
function loadPrefs() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  if (s && LOOKBACKS.includes(s.lookback)) state.lookback = s.lookback;
}

function wire() {
  document.getElementById('lookback-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const lb = btn.dataset.lb; if (!LOOKBACKS.includes(lb) || lb === state.lookback) return;
    state.lookback = lb; save();
    renderCharts(); renderControls(); // 룩백은 차트 창만(카드·판독은 전기간 고정)
  });
}

export async function initCurvePhase() {
  loadPrefs();
  const loaded = await loadCurveData();
  if (!loaded) {
    document.getElementById('app').insertAdjacentHTML('beforeend',
      `<div class="empty"><code>data/curve/*.json</code> 을 fetch로 읽으므로 <b>로컬 서버</b>가 필요합니다 (file:// 직접 열기 불가).<br>`
      + `예: <code>python -m http.server</code> 후 <code>localhost:8000/curve-phase.html</code></div>`);
    return;
  }
  DATA = loaded.data;
  const krRows = DATA.krYields.data;
  const baseArr = DATA.krBase.data;
  SERIES = {
    s3: spreadSeries(krRows, baseArr, 'y3'),
    s1: spreadSeries(krRows, baseArr, 'y1'),
  };
  // KR 뒷단: 5y5y(2×10Y−5Y, %) · 30Y−10Y(TP 프록시, bp, 2012-09~)
  KRB = { fy: fwd5y5y(krRows, 'y10', 'y5'), s3010: colSpreadBp(krRows, 'y30', 'y10') };
  // US: 변수1 DGS2−EFFR(bp) · 5y5y(%) · TP(%) · 기대성분=5y5y−TP(%)
  const usRows = DATA.usYields.data;
  const fy = fwd5y5y(usRows);
  const tp = DATA.usTp.data.map((r) => [r.date, r.tp10]);
  US = { gap: colSpreadBp(usRows, 'dgs2', 'effr'), fy, tp, exp: seriesDiff(fy, tp) };
  // 분해(20d 롤링, 각국 자체 거래일 축 — 크로스 조인 없음)
  DECOMP = { kr: decompKR(krRows, baseArr), us: decompUS(usRows, DATA.usTp.data) };
  // 사이클 오버레이(cycles.json 부재 허용): KR 3s10s(10Y−3Y) · US 2s10s(10Y−2Y)
  const cycles = await loadCycles();
  if (cycles) {
    OVERLAY = {
      kr: assignColors(buildOverlay(krRows, 'y10', 'y3', cycles.kr || [])),
      us: assignColors(buildOverlay(usRows, 'dgs10', 'dgs2', cycles.us || [])),
    };
  }
  wire();
  renderAll();
}

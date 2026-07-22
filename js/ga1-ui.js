// ga1-ui.js — GA-1 연간 GDP 환산기 페이지 컨트롤러.
//   질문 하나: "분기 전기비 실적을 이대로 이으면 연간 GDP가 몇 %인가".
//   계산은 전량 ga1-calc.js(순수 함수). 여기서는 입력 수집·렌더만. 외부 fetch·데이터 파일 없음.
//   커스텀 잔여분기 입력값만 localStorage 'ga1-annualizer' 저장(bpbybp 관행).

import {
  GDP_QOQ_ACTUAL, ASOF, annualize, presetTable, residualQuarters, buildChain, annualGrowth,
} from './ga1-calc.js';

const LS_KEY = 'ga1-annualizer';
const PRESETS = [0.0, 0.3, 0.5];
const DEFAULT_RESIDUAL = 0.3;

// 색: 실적=중립텍스트, 시나리오=forecast(amber). 사이트 토큰과 동일.
const fmt2 = (x) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(2));
const signedQoq = (x) => (x == null || Number.isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(1));

const RESID_Q = residualQuarters(GDP_QOQ_ACTUAL);           // ['2026Q3','2026Q4']
const TARGET_YEAR = Number(GDP_QOQ_ACTUAL[GDP_QOQ_ACTUAL.length - 1].q.slice(0, 4));

// state: mode 'preset'|'custom', 선택 프리셋, 커스텀 분기별 입력(잔여분기만).
const state = {
  mode: 'preset',
  preset: DEFAULT_RESIDUAL,
  custom: Object.fromEntries(RESID_Q.map((q) => [q, DEFAULT_RESIDUAL])),
};

// ── 저장/로드: 커스텀 입력값만(단일 객체, 방어적) ──
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ kind: LS_KEY, version: 1, mode: state.mode, preset: state.preset, custom: state.custom }));
  } catch { /* noop */ }
}
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  if (!s) return;
  if (s.mode === 'preset' || s.mode === 'custom') state.mode = s.mode;
  if (PRESETS.includes(s.preset)) state.preset = s.preset;
  if (s.custom && typeof s.custom === 'object') {
    for (const q of RESID_Q) if (Number.isFinite(s.custom[q])) state.custom[q] = s.custom[q];
  }
}

// 현재 state → residual 인자(균일 숫자 or 분기맵).
function currentResidual() {
  return state.mode === 'custom' ? { ...state.custom } : state.preset;
}

// ── 헤드라인: 현재 시나리오 연간 + 이미 확보된 성장 ──
function renderHeadline() {
  const a = annualize({ residual: currentResidual() });
  const secured = a.securedGrowth;                          // 잔여 0% = 이미 확보
  const scenarioLabel = state.mode === 'custom'
    ? '커스텀 잔여분기'
    : `잔여 균일 ${signedQoq(state.preset)}%`;

  document.getElementById('headline').innerHTML =
    `<div class="hl-kicker">${TARGET_YEAR}년 연간 실질 GDP 환산 · <span class="mono">${scenarioLabel}</span> 가정</div>
     <div class="hl-value" style="color:var(--forecast)">${fmt2(a.targetGrowth)}<span class="hl-unit">%</span>
       <span class="hl-word">이대로 가면</span></div>
     <div class="hl-sub">${TARGET_YEAR}Q1·Q2 실적 + 잔여분기(${RESID_Q.join('·')}) 가정을 전기비 연쇄로 환산한 산술치
       — 전망 아님, 순수 계산</div>`;

  // 이미 확보된 성장 강조 카드(잔여 0% 가정, 소수 2자리).
  document.getElementById('secured').innerHTML =
    `<div class="secured-inner">
       <div class="secured-label">이미 확보된 성장 <span class="sub">(잔여분기 0.0% 가정)</span></div>
       <div class="secured-value">${fmt2(secured)}<span class="unit">%</span></div>
       <div class="secured-note">${TARGET_YEAR}Q1·Q2 실적만으로 확정되는 연간 하한 — 잔여분기가 0%여도 이만큼</div>
     </div>`;
}

// ── 프리셋 칩 3개(소수 2자리 결과 병기) ──
function renderPresets() {
  const rows = presetTable({ presets: PRESETS });
  const chips = rows.map((r) => {
    const active = state.mode === 'preset' && state.preset === r.residual;
    return `<button class="chip${active ? ' active' : ''}" data-resid="${r.residual}">
      <span class="chip-q">잔여 ${r.residual.toFixed(1)}%</span>
      <span class="chip-a">${fmt2(r.growth)}%</span>
    </button>`;
  }).join('');
  document.getElementById('presets').innerHTML = chips;
}

// ── 커스텀 잔여분기 입력 ──
function renderCustom() {
  const active = state.mode === 'custom';
  const inputs = RESID_Q.map((q) =>
    `<label class="cin"><span class="cin-q">${q}</span>
       <input type="number" step="0.1" value="${state.custom[q]}" data-q="${q}" ${active ? '' : 'disabled'} />
       <span class="cin-u">%</span></label>`).join('');
  const gCustom = active ? annualGrowth(buildChain({ residual: { ...state.custom } }), TARGET_YEAR) : null;
  document.getElementById('custom').innerHTML =
    `<button class="chip chip-toggle${active ? ' active' : ''}" data-custom="1">커스텀 잔여분기</button>
     <div class="cin-row">${inputs}
       <span class="cin-out">→ 연간 <b>${active ? fmt2(gCustom) : '—'}</b>%</span>
     </div>`;
}

// ── 분기 체인 표: 실적 vs 가정 시각 구분 ──
function renderChain() {
  const { levels } = annualize({ residual: currentResidual() });
  const rows = levels.filter((l) => Number(l.q.slice(0, 4)) >= TARGET_YEAR - 1); // 전년+당해만 표시
  const cells = rows.map((l) => {
    const isScen = l.source === 'scenario';
    return `<div class="qcell ${isScen ? 'scen' : 'act'}">
      <div class="qc-q">${l.q}${l.vintage === 'advance' ? ' <span class="tag">속보</span>' : ''}</div>
      <div class="qc-v">${signedQoq(l.qoq)}<span class="qc-u">%</span></div>
      <div class="qc-t">${isScen ? '가정' : '실적'}</div>
    </div>`;
  }).join('');
  document.getElementById('chain').innerHTML = cells;
}

// ── 각주 ──
function renderFootnote() {
  document.getElementById('footnote').innerHTML =
    `<div>산술: 2023Q4=100 앵커에서 계절조정 실질 GDP 전기비를 연쇄 곱해 분기 레벨을 만들고,
       연간 성장률 = 당해 4개 분기 레벨 합 ÷ 전년 4개 분기 레벨 합 − 1. <b>전망 모델·확률 아님, 결정론적 환산.</b></div>
     <div>실적 상수: 한국은행 보도자료 공표 전기비(소수 1자리). ${TARGET_YEAR}Q1 잠정 · ${TARGET_YEAR}Q2 <span class="k">속보(advance)</span> · 기준일 <span class="k">${ASOF}</span>.
       공표치 반올림으로 연간 환산에 <span class="k">±0.05%p</span> 내외 오차 가능(모든 결과 소수 2자리 표기).</div>
     <div>${TARGET_YEAR}Q2 속보가 잠정으로 수정되면 <code>js/ga1-calc.js</code>의 <code>GDP_QOQ_ACTUAL</code> 배열만 갱신.
       국민소득 갭(GDI−GDP) 분해는 <a href="gg1-income-gap.html">국민소득 갭 모니터</a> 참조.</div>`;
}

function renderAll() { renderHeadline(); renderPresets(); renderCustom(); renderChain(); renderFootnote(); }

function wire() {
  document.getElementById('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip'); if (!btn) return;
    state.mode = 'preset'; state.preset = Number(btn.dataset.resid); save();
    renderHeadline(); renderPresets(); renderCustom(); renderChain();
  });
  const custom = document.getElementById('custom');
  custom.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-custom]'); if (!btn) return;
    state.mode = 'custom'; save();
    renderHeadline(); renderPresets(); renderCustom(); renderChain();
  });
  custom.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-q]'); if (!inp) return;
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    state.custom[inp.dataset.q] = v; state.mode = 'custom'; save();
    renderHeadline(); renderCustom(); renderChain();
  });
}

export function initGA1() {
  load();
  wire();
  renderAll();
}

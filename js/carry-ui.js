// carry-ui.js — 레버리지 캐리 손익분기 페이지 오케스트레이션.
// 순수 계산은 js/carry-calc.js. 이 파일은 입력 수집·상태(localStorage)·렌더만 담당.
// 결과는 숫자·분포만 표시(매매신호·권고 없음). p 합계≠100% 는 경고 배지 + 정규화 진행(차단 없음).

import {
  netCarryRate, carryBp, breakevenBp, expectedDy, excessReturn,
  scenarioPnl, durationApprox, gridTable,
} from './carry-calc.js';

const $ = id => document.getElementById(id);
const LS_KEY = 'carry-inputs';
const GRID_DUR = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
const GRID_H = [1, 3, 6, 12];

// 기본값 = CB-1 앵커 재현(픽업 60bp, D=1.8, h=3, 비헤지, [+3/+15/−5] p[60/25/15])
const DEFAULTS = {
  ytm: 3.50, repo: 2.90, roll: 0, durMode: 'D', dur: 1.8, mat: 3.0, h: 3, hedge: false,
  scen: [
    { label: '기본', p: 60, dKtb: 3, dSpread: 0 },
    { label: '약세', p: 25, dKtb: 15, dSpread: 0 },
    { label: '강세', p: 15, dKtb: -5, dSpread: 0 },
  ],
};

const state = structuredClone(DEFAULTS);

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const fmt = (v, dp = 1) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(dp) : '—');
const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ── 상태 저장/로드 ──
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* noop */ } }
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { s = null; }
  if (s && typeof s === 'object' && Array.isArray(s.scen)) Object.assign(state, s);
}

// ── 파생값 계산 ──
function derive() {
  const ytmBp = num(state.ytm) * 100, repoBp = num(state.repo) * 100, rollBp = num(state.roll);
  const D = state.durMode === 'mat' ? durationApprox(num(state.mat), ytmBp) : num(state.dur);
  const sumP = state.scen.reduce((a, s) => a + num(s.p), 0);
  const needNorm = sumP > 0 && Math.abs(sumP - 100) > 0.05;
  // 엔진에 넘길 시나리오 — p 정규화(합계 100 아니면 pᵢ×100/Σp)
  const scenN = state.scen.map(s => ({
    label: s.label, dKtb: num(s.dKtb), dSpread: num(s.dSpread),
    p: needNorm ? num(s.p) * 100 / sumP : num(s.p),
  }));
  const base = { ytm: ytmBp, repo: repoBp, rolldown: rollBp, h: num(state.h), D };
  return {
    ytmBp, repoBp, rollBp, D, sumP, needNorm, scenN, base,
    carry: carryBp(base),
    be: breakevenBp(base),
    eDy: expectedDy(scenN, { hedge: state.hedge }),
    excess: excessReturn({ ...base, scenarios: scenN, hedge: state.hedge }),
    pnl: scenarioPnl({ ...base, scenarios: scenN, hedge: state.hedge }),
    grid: gridTable({ ytm: ytmBp, repo: repoBp, rolldown: rollBp, durations: GRID_DUR, horizons: GRID_H }),
  };
}

// ── 시나리오 입력 행 렌더(상태 → DOM) ──
function renderScenInputs() {
  $('cb-scen-body').innerHTML = state.scen.map((s, i) => `
    <tr data-i="${i}">
      <td><input class="lbl" data-f="label" value="${esc(s.label)}"></td>
      <td><input type="number" step="1" data-f="p" value="${esc(s.p)}"></td>
      <td><input type="number" step="1" data-f="dKtb" value="${esc(s.dKtb)}"></td>
      <td><input type="number" step="1" data-f="dSpread" value="${esc(s.dSpread)}"></td>
      <td><button class="icon-btn" data-del="${i}" title="행 삭제"${state.scen.length <= 1 ? ' disabled style="opacity:.3"' : ''}>×</button></td>
    </tr>`).join('');
}

// ── 출력 렌더 ──
function renderOutputs() {
  const d = derive();

  // p 합계 배지
  const pb = $('cb-psum');
  const sr = Math.round(d.sumP * 10) / 10;
  if (d.sumP <= 0) { pb.textContent = '합계 0% ⚠'; pb.className = 'badge warn'; }
  else if (d.needNorm) { pb.textContent = `합계 ${sr}% ⚠`; pb.className = 'badge warn'; }
  else { pb.textContent = `합계 ${sr}%`; pb.className = 'badge ok'; }
  $('cb-norm-note').innerHTML = d.needNorm
    ? `<b style="color:var(--forecast)">정규화 적용</b> — 확률 합계가 100%가 아니어서 pᵢ×100/${sr} 로 재정규화한 값으로 계산합니다(입력값은 보존).`
    : '확률 합계 100% — 정규화 없이 계산.';

  // 잔존만기 모드 근사 표시
  $('cb-dapprox').innerHTML = state.durMode === 'mat'
    ? `D ≈ <b>${Number.isFinite(d.D) ? d.D.toFixed(2) : '—'}</b> (= ${num(state.mat)}/(1+${(d.ytmBp / 10000).toFixed(4)}/2))` : '';

  // ① 요약 카드
  const cards = [
    { l: `보유기간 캐리 (${num(state.h)}개월)`, m: fmt(d.carry) + 'bp', s: `순캐리율 ${fmt(netCarryRate({ ytm: d.ytmBp, repo: d.repoBp, rolldown: d.rollBp }))}bp/년 × ${num(state.h)}/12` },
    { l: '손익분기 허용 확대폭', m: (d.be == null ? '—' : fmt(d.be) + 'bp'), s: `캐리 / D(${Number.isFinite(d.D) ? d.D.toFixed(2) : '—'}) · 이만큼 벌어지면 초과수익 0` },
    { l: `E[Δy]${state.hedge ? ' (헤지 ON·스프레드만)' : ''}`, m: fmt(d.eDy) + 'bp', s: `Σ p·(ΔKTB${state.hedge ? ' 제외' : ''}+Δspread)` },
    { l: '기대 초과수익', m: fmt(d.excess) + 'bp', s: `캐리 − D×E[Δy]`, cls: d.excess > 0 ? 'pos' : d.excess < 0 ? 'neg' : '' },
  ];
  $('cb-cards').innerHTML = cards.map(c => `
    <div class="stat">
      <div class="stat-label">${c.l}</div>
      <div class="stat-main ${c.cls || ''}">${c.m}</div>
      <div class="stat-sub">${c.s}</div>
    </div>`).join('');

  // ② 시나리오 손익 테이블 (worst = 최소 pnl 강조)
  const rows = d.pnl;
  const worstPnl = rows.length ? Math.min(...rows.map(r => r.pnl)) : null;
  let worstMarked = false;
  $('cb-scen-out').innerHTML = `
    <thead><tr><th class="l">시나리오</th><th>확률</th><th>ΔKTB+Δspread${state.hedge ? '(헤지)' : ''}</th><th>손익 (bp)</th></tr></thead>
    <tbody>${rows.map(r => {
      const isWorst = !worstMarked && r.pnl === worstPnl;
      if (isWorst) worstMarked = true;
      return `<tr class="${isWorst ? 'worst' : ''}">
        <td class="l">${esc(r.label)}${isWorst ? '<span class="tag">최악</span>' : ''}</td>
        <td>${Number.isFinite(r.p) ? r.p.toFixed(1) : '—'}%</td>
        <td>${fmt(r.move)}bp</td>
        <td class="${r.pnl > 0 ? 'pos' : r.pnl < 0 ? 'neg' : ''}">${fmt(r.pnl)}</td>
      </tr>`;
    }).join('')}</tbody>`;

  // ③ 그리드 — 현재 (D,h) 최근접 셀 강조
  const nearestD = GRID_DUR.reduce((m, x) => (Math.abs(x - d.D) < Math.abs(m - d.D) ? x : m), GRID_DUR[0]);
  const curH = GRID_H.includes(num(state.h)) ? num(state.h) : null;
  $('cb-grid').innerHTML = `
    <thead><tr><th class="l">D \\ h(개월)</th>${GRID_H.map(h => `<th${h === curH ? ' style="color:var(--accent)"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${d.grid.map(r => `
      <tr><td class="l"${r.D === nearestD ? ' style="color:var(--accent);font-weight:700"' : ''}>${r.D.toFixed(1)}</td>
        ${r.cells.map(c => {
          const isCur = r.D === nearestD && c.h === curH;
          const isCol = c.h === curH && !isCur;
          return `<td class="${isCur ? 'cur' : isCol ? 'cur-col' : ''}">${c.breakeven == null ? '—' : c.breakeven.toFixed(1)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>`;

  save();
}

// ── 입력값 → 상태 반영 후 재렌더 ──
function syncScalarsFromDom() {
  state.ytm = num($('cb-ytm').value, 0);
  state.repo = num($('cb-repo').value, 0);
  state.dur = num($('cb-dur').value, 0);
  state.mat = num($('cb-mat').value, 0);
  state.h = num($('cb-h').value, 0);
  state.roll = num($('cb-roll').value, 0);
}

function writeScalarsToDom() {
  $('cb-ytm').value = state.ytm; $('cb-repo').value = state.repo;
  $('cb-dur').value = state.dur; $('cb-mat').value = state.mat;
  $('cb-h').value = state.h; $('cb-roll').value = state.roll;
  // 토글 상태
  $('cb-dur-wrap').style.display = state.durMode === 'mat' ? 'none' : '';
  $('cb-mat-wrap').style.display = state.durMode === 'mat' ? '' : 'none';
  $('cb-durmode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.dur === state.durMode));
  $('cb-hedge').querySelectorAll('button').forEach(b => b.classList.toggle('active', (b.dataset.hedge === '1') === !!state.hedge));
}

function resetAll() {
  Object.assign(state, structuredClone(DEFAULTS));
  writeScalarsToDom();
  renderScenInputs();
  renderOutputs();
}

export function initCarry() {
  if (!$('cb-cards')) return;
  load();
  writeScalarsToDom();
  renderScenInputs();
  renderOutputs();

  // 스칼라 입력
  ['cb-ytm', 'cb-repo', 'cb-dur', 'cb-mat', 'cb-h', 'cb-roll'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('input', () => { syncScalarsFromDom(); renderOutputs(); });
  });

  // 듀레이션 기준 토글
  $('cb-durmode').addEventListener('click', e => {
    const b = e.target.closest('button[data-dur]'); if (!b) return;
    state.durMode = b.dataset.dur;
    writeScalarsToDom(); renderOutputs();
  });
  // 헤지 토글
  $('cb-hedge').addEventListener('click', e => {
    const b = e.target.closest('button[data-hedge]'); if (!b) return;
    state.hedge = b.dataset.hedge === '1';
    writeScalarsToDom(); renderOutputs();
  });

  // 시나리오 입력(위임)
  $('cb-scen-body').addEventListener('input', e => {
    const inp = e.target.closest('input[data-f]'); if (!inp) return;
    const tr = inp.closest('tr'); const i = +tr.dataset.i; const f = inp.dataset.f;
    state.scen[i][f] = f === 'label' ? inp.value : num(inp.value, 0);
    renderOutputs(); // 행 재렌더 없이 출력만 갱신(포커스 유지)
  });
  $('cb-scen-body').addEventListener('click', e => {
    const del = e.target.closest('button[data-del]'); if (!del) return;
    if (state.scen.length <= 1) return;
    state.scen.splice(+del.dataset.del, 1);
    renderScenInputs(); renderOutputs();
  });
  $('cb-scen-add').addEventListener('click', () => {
    state.scen.push({ label: '시나리오 ' + (state.scen.length + 1), p: 0, dKtb: 0, dSpread: 0 });
    renderScenInputs(); renderOutputs();
  });
  $('cb-reset').addEventListener('click', resetAll);

  // 해설 펼침 상태 기억
  const ex = $('cb-explainer');
  if (ex) {
    try { ex.open = localStorage.getItem('carry-explainer-open') === '1'; } catch { /* noop */ }
    ex.addEventListener('toggle', () => { try { localStorage.setItem('carry-explainer-open', ex.open ? '1' : '0'); } catch { /* noop */ } });
  }
}

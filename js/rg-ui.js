// rg-ui.js — RG-1 전향적 레짐 히트맵 페이지 오케스트레이션.
// 데이터: window.RG_CALIB(밴드 가이드), window.RG_LEDGER(확정 원장). 정규화: js/prob-normalize.js.
// 흐름: 확률 6칸 입력(숫자+슬라이더, 자동조정 없음) → 9셀 결합확률 히트맵 + 최빈 셀 + 플레이북.
//   합계≠100% → 경고 뱃지 + 정규화 버튼(정규화 전 확정 불가). [확정] → 원장 append 스니펫 생성.
// 순수 계산은 combine()/argmaxCell()/isoWeek(), 나머지는 상태·localStorage·DOM.

import { probStatus, normalized, normalizeInPlace } from './prob-normalize.js';
import {
  TENORS as RD_TENORS, TENOR3Y, curveComplete, expectedDyParallel, rolldownTable, decompose,
  conditionalDefaultCurves, expectedDyByTenor, mixEDy,
} from './rg-rolldown.js';

const $ = id => document.getElementById(id);
const LS_DRAFT = 'rg:draft';
const LS_EXPLAIN = 'rg-explainer-open';

// RG-2 커브(레벨 수익률) 입력 — 세션 전용(메모리만). state 와 분리 → localStorage 미포함(§0.3).
let curveY = RD_TENORS.map(() => '');
let lastRg2 = null;         // 확정 스니펫 반영용(파생값만)
let lastV2Defaults = null;  // 최근 1층 기본커브 { down:[8], flat:[8], up:[8] } — dot 툴팁·리셋 참조

const RATE_KEYS = ['down', 'flat', 'up'];        // 하락/보합/상승
const SPREAD_KEYS = ['narrow', 'flat', 'wide'];  // 축소/보합/확대
const RATE_LABEL = { down: '하락', flat: '보합', up: '상승' };
const RATE_ARROW = { down: '↓', flat: '→', up: '↑' };
const SPREAD_LABEL = { narrow: '축소', flat: '보합', wide: '확대' };

// 9셀 국면 (spec §1 RG-1 플레이북 전문). 키 = `${rateDir}|${spreadDir}` (rg-calib 셀키와 동일).
// stance: fav(우호·리스크 확장) | neu(중립·선별 대응) | def(방어·리스크 축소) — 스프레드 방향 기준.
const PHASES = {
  'down|narrow': { name: '리스크온 랠리', stance: 'fav', play: '듀레이션 오버웨이트 + 장기 크레딧. 금리 하락과 스프레드 압축 동시 수취. 레버리지 캐리 유효성 최고 구간' },
  'down|flat': { name: '듀레이션 장세', stance: 'neu', play: '국채 중심 듀레이션 확대, 크레딧 중립. 단기금리 주도면 스티프너, 장기 주도면 롱엔드 집중' },
  'down|wide': { name: '리스크오프', stance: 'def', play: '국채 듀레이션 유지·확대, 크레딧 언더웨이트, 보유분 우량 전환(quality up). 유동성 확보 우선' },
  'flat|narrow': { name: '캐리 장세', stance: 'fav', play: '크레딧 오버웨이트로 캐리&롤다운 극대화. 레버리지 캐리 손익분기 여유 최대 구간' },
  'flat|flat': { name: '중립·정체', stance: 'neu', play: '방향 베팅 자제, 벤치마크 근접. 유동성·신규발행 프리미엄 등 마이크로 알파 수확, 옵션성 축적' },
  'flat|wide': { name: '크레딧 경계', stance: 'def', play: '신용사이클 악화 신호. 크레딧 축소 + 등급 상향, 부실 시그널 모니터링 격상' },
  'up|narrow': { name: '리플레이션', stance: 'fav', play: '성장 주도 금리 상승. 듀레이션 언더웨이트, 단기 크레딧 캐리로 스프레드 압축 수취' },
  'up|flat': { name: '베어 금리', stance: 'neu', play: '듀레이션 축소, 단기물·FRN 성격 자산 회전, 현금흐름 재투자 대기' },
  'up|wide': { name: '이중 약세', stance: 'def', play: '듀레이션·크레딧 동시 축소, 최단기·현금 중심 전면 방어. 다음 레짐 전환 진입 준비 국면' },
};
const STANCE = { fav: { label: '우호 (리스크 확장)', cls: 'st-fav' }, neu: { label: '중립 (선별 대응)', cls: 'st-neu' }, def: { label: '방어 (리스크 축소)', cls: 'st-def' } };

// v2 24칸 스켈레톤: 각 칸 { v:Δbp|'', source:'default'|'user' }. 값은 파생 Δbp → 작업본 저장 허용(§0.3 OK).
function freshV2() {
  const mk = () => Array.from({ length: RD_TENORS.length }, () => ({ v: '', source: 'default' }));
  return { cells: { down: mk(), flat: mk(), up: mk() }, w: 100 };  // w=100 → 평행(v1) 출발
}

// 기본값 = 합계 100 인 중립 prior(즉시 유효 히트맵 + OK 뱃지)
const DEFAULTS = { rate: { down: 33, flat: 34, up: 33 }, spread: { narrow: 33, flat: 34, wide: 33 }, date: '', v2: freshV2() };
const state = { rate: {}, spread: {}, date: '', v2: freshV2() };

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const fmtP = v => (Number.isFinite(v) ? v.toFixed(1) : '—');

// ── 순수 계산 ──
// 결합확률 9셀(%). rateN/spreadN = 정규화된 확률(%). cell = rate×spread/100.
function combine(rateN, spreadN) {
  const cells = {};
  RATE_KEYS.forEach((r, i) => SPREAD_KEYS.forEach((s, j) => {
    cells[`${r}|${s}`] = rateN[i] * spreadN[j] / 100;
  }));
  return cells;
}
function argmaxCell(cells) {
  let best = null;
  for (const [k, p] of Object.entries(cells)) if (!best || p > best.p) best = { key: k, p };
  return best;
}
function top2Sum(cells) {
  const ps = Object.values(cells).sort((a, b) => b - a);
  return (ps[0] || 0) + (ps[1] || 0);
}
// ISO-8601 주차 'YYYY-Www'
function isoWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;            // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3);         // 목요일
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ft = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - ft + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ── 상태 저장/로드 ──
function save() { try { localStorage.setItem(LS_DRAFT, JSON.stringify(state)); } catch { /* noop */ } }
function load() {
  let s = null; try { s = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null'); } catch { s = null; }
  Object.assign(state, structuredClone(DEFAULTS));
  if (s && s.rate && s.spread) {
    RATE_KEYS.forEach(k => { if (Number.isFinite(+s.rate[k])) state.rate[k] = +s.rate[k]; });
    SPREAD_KEYS.forEach(k => { if (Number.isFinite(+s.spread[k])) state.spread[k] = +s.spread[k]; });
    if (typeof s.date === 'string') state.date = s.date;
    const v2 = validV2(s.v2);
    if (v2) state.v2 = v2;                    // ⑥ 작업본(24칸+w) 복원 — 우선
  } else {
    const carry = ledgerCarryV2();            // 2층: 전주 확정 rg2v2 이월(작업본 없을 때만)
    if (carry) state.v2 = carry;
  }
}

// 저장/이월 v2 형태 검증 → 정규화. 실패 시 null.
function validV2(v2) {
  if (!v2 || !v2.cells) return null;
  const out = freshV2();
  out.w = Number.isFinite(+v2.w) ? +v2.w : 100;
  for (const dir of RATE_KEYS) {
    const arr = v2.cells[dir];
    if (!Array.isArray(arr) || arr.length !== RD_TENORS.length) return null;
    out.cells[dir] = arr.map(c => ({
      v: (c && Number.isFinite(+c.v)) ? +c.v : '',
      source: (c && c.source === 'user') ? 'user' : 'default',
    }));
  }
  return out;
}

// 원장 최신 주차 rg2v2 → v2 시작값(2층 이월). 없으면 null.
function ledgerCarryV2() {
  const j = (window.RG_LEDGER && window.RG_LEDGER.judgments) || {};
  const weeks = Object.keys(j).sort();
  for (let i = weeks.length - 1; i >= 0; i--) {
    const r = j[weeks[i]] && j[weeks[i]].rg2v2;
    if (r && r.curves) {
      const out = freshV2();
      out.w = Number.isFinite(+r.w) ? +r.w : 100;
      for (const dir of RATE_KEYS) {
        const cur = r.curves[dir] || [], src = (r.sources && r.sources[dir]) || [];
        out.cells[dir] = RD_TENORS.map((_, k) => ({
          v: Number.isFinite(+cur[k]) ? +cur[k] : '',
          source: src[k] === 'user' ? 'user' : 'default',
        }));
      }
      return out;
    }
  }
  return null;
}

// ── 밴드 가이드(rg-calib) ──
function calibBands() {
  const c = window.RG_CALIB;
  const b = c && c.bands;
  return {
    ktb3y: b && b.ktb3y ? b.ktb3y.bandBp : null,
    repSpread: b && b.repSpread ? b.repSpread.bandBp : null,
    period: c && c.meta && c.meta.period ? `${c.meta.period.from}~${c.meta.period.to}` : null,
    ok: !!(b && b.ktb3y && b.repSpread),
  };
}

// ── 입력 셀 생성(1회) — 숫자 + 슬라이더 병행, 자동조정 없음 ──
function buildInputs(axis, keys, labelMap) {
  return keys.map(k => `
    <div class="p-cell">
      <div class="p-cell-top"><span class="p-dir">${labelMap[k]}</span>
        <input type="number" min="0" max="100" step="1" class="p-num" id="rg-${axis}-${k}" data-axis="${axis}" data-key="${k}"></div>
      <input type="range" min="0" max="100" step="0.5" class="p-range" id="rg-${axis}-${k}-s" data-axis="${axis}" data-key="${k}">
    </div>`).join('');
}
function writeInputs() {
  for (const k of RATE_KEYS) { $(`rg-rate-${k}`).value = state.rate[k]; $(`rg-rate-${k}-s`).value = state.rate[k]; }
  for (const k of SPREAD_KEYS) { $(`rg-spread-${k}`).value = state.spread[k]; $(`rg-spread-${k}-s`).value = state.spread[k]; }
}

// RG-2 커브 8구간 입력(숫자만, 세션 전용). 값은 curveY(모듈 변수)에만 — localStorage 미포함.
function buildCurveInputs() {
  $('rg-curve-inputs').innerHTML = RD_TENORS.map((t, i) => `
    <div class="cv-cell">
      <label>${t}</label>
      <input type="number" step="0.001" inputmode="decimal" class="cv-num" data-idx="${i}" placeholder="—">
    </div>`).join('');
}

// RG-2 v2: 시나리오 3개 × 구간 8개 블록(세로 전개). 숫자+슬라이더, user 칸 dot. 1회 생성.
const V2_DIRLABEL = { down: '하락 ↓', flat: '보합 →', up: '상승 ↑' };
function buildV2Blocks() {
  $('rg-v2-blocks').innerHTML = RATE_KEYS.map(dir => `
    <div class="v2-block">
      <div class="v2-head">
        <span class="v2-title">${V2_DIRLABEL[dir]} 시나리오</span>
        <span class="v2-prob" id="rg-v2p-${dir}">P —</span>
        <span class="v2-src">9레짐 조건부 · 스프레드 확률 가중</span>
        <button class="btn sm" data-reset="${dir}">기본값 리셋</button>
      </div>
      <div class="v2-cells">
        ${RD_TENORS.map((t, k) => `
          <div class="v2-cell">
            <label>${t} <span class="v2-dot" id="rg-v2dot-${dir}-${k}" style="display:none" title="">●</span></label>
            <input type="number" step="0.1" class="v2-num" id="rg-v2-${dir}-${k}" data-dir="${dir}" data-k="${k}">
            <input type="range" min="-60" max="60" step="0.5" class="v2-range" id="rg-v2s-${dir}-${k}" data-dir="${dir}" data-k="${k}">
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// ── 렌더: 뱃지 + 히트맵 + 최빈 + 확정 가능여부 ──
function renderOutputs() {
  const rateArr = RATE_KEYS.map(k => state.rate[k]);
  const spreadArr = SPREAD_KEYS.map(k => state.spread[k]);
  const rSt = probStatus(rateArr), sSt = probStatus(spreadArr);

  // 축 합계 뱃지
  setBadge('rg-rate-sum', rSt);
  setBadge('rg-spread-sum', sSt);
  $('rg-rate-norm').disabled = !rSt.needNorm;
  $('rg-spread-norm').disabled = !sSt.needNorm;

  // 히트맵은 비파괴 정규화값으로(항상 합 100 결합확률). 확정은 원값이 OK 여야 가능.
  const rN = normalized(rateArr), sN = normalized(spreadArr);
  const cells = combine(rN, sN);
  const mode = argmaxCell(cells);
  const maxP = mode ? mode.p : 0;
  renderHeatmap(cells, mode, maxP);

  // 최빈 셀 요약
  const ph = mode ? PHASES[mode.key] : null;
  $('rg-mode').innerHTML = ph
    ? `<span class="mode-name ${STANCE[ph.stance].cls}">${ph.name}</span>
       <span class="mode-nums">최빈 셀 ${fmtP(mode.p)}% · 상위 2셀 합 ${fmtP(top2Sum(cells))}%</span>`
    : '—';

  // 확정 가능: 양 축 합계 OK
  const canConfirm = rSt.ok && sSt.ok;
  $('rg-confirm').disabled = !canConfirm;
  $('rg-confirm-hint').textContent = canConfirm
    ? '두 축 합계 100% — 확정 가능.'
    : '두 축 합계가 각각 100%가 되어야 확정할 수 있습니다(정규화 버튼 사용).';

  renderRolldown();  // RG-1 확률 변경 → 커브이동 성분 실시간 갱신
  save();
}

// ── RG-2: 커브이동 E[Δy](평행 v1 + 시나리오 v2 혼합) + 3성분 분해 막대 + 순위 ──
function medianCurves() { const c = window.RG_CALIB; return c && c.medianCurves ? c.medianCurves : null; }
function rateArr() { return RATE_KEYS.map(k => state.rate[k]); }
function spreadArr() { return SPREAD_KEYS.map(k => state.spread[k]); }
function wFrac() { const w = +state.v2.w; return (Number.isFinite(w) ? w : 100) / 100; }
function sceneCurves() { const o = {}; for (const d of RATE_KEYS) o[d] = state.v2.cells[d].map(c => (Number.isFinite(+c.v) ? +c.v : 0)); return o; }

// 1층 기본커브 재산출 → source='default' 칸 값 갱신(user 칸 유지)
function refreshV2Defaults() {
  lastV2Defaults = conditionalDefaultCurves(normalized(spreadArr()), medianCurves());
  for (const dir of RATE_KEYS) for (let k = 0; k < RD_TENORS.length; k++) {
    const cell = state.v2.cells[dir][k];
    if (cell.source === 'default') cell.v = lastV2Defaults ? round1(lastV2Defaults[dir][k]) : '';
  }
}
function dotTitle(dir, k) {
  const d = lastV2Defaults ? round1(lastV2Defaults[dir][k]) : null;
  const v = state.v2.cells[dir][k].v;
  return d == null ? '내 전망(user)' : `기본값 ${fmtP(d)} → 내전망 ${fmtP(+v)} (Δ ${fmtP(+v - d)})bp`;
}
// v2 셀 DOM 동기: 값은 전 칸 기록(포커스 칸 제외 → 커서 보존), dot 은 전 칸 갱신
function syncV2Dom() {
  const active = (typeof document !== 'undefined') ? document.activeElement : null;
  for (const dir of RATE_KEYS) for (let k = 0; k < RD_TENORS.length; k++) {
    const cell = state.v2.cells[dir][k];
    const num = $(`rg-v2-${dir}-${k}`), rng = $(`rg-v2s-${dir}-${k}`), dot = $(`rg-v2dot-${dir}-${k}`);
    if (num && num !== active) num.value = cell.v;
    if (rng && rng !== active) rng.value = Number.isFinite(+cell.v) ? +cell.v : 0;
    if (dot) { dot.style.display = cell.source === 'user' ? '' : 'none'; dot.title = cell.source === 'user' ? dotTitle(dir, k) : ''; }
  }
}
function renderV2ProbMirror() {
  const rN = normalized(rateArr());
  RATE_KEYS.forEach((k, i) => { const el = $(`rg-v2p-${k}`); if (el) el.textContent = `P(${RATE_LABEL[k]}) ${fmtP(rN[i])}%`; });
}

function renderRolldown() {
  if (!$('rg-rd-bars')) return;
  const mc = medianCurves();

  // 1층 기본값 실시간 갱신 + DOM 동기 + 확률 미러
  refreshV2Defaults();
  syncV2Dom();
  renderV2ProbMirror();

  const parallel = expectedDyParallel(rateArr(), spreadArr(), mc);   // 스칼라(3Y 기준)
  const byTenor = expectedDyByTenor(rateArr(), sceneCurves());       // 구간별 배열
  const mixed = mixEDy(parallel, byTenor, wFrac());                  // 구간별 배열 | null

  // E[Δy] 3Y 비교 요약
  const edEl = $('rg-edy');
  if (parallel == null) {
    edEl.innerHTML = mc
      ? `<span class="warn-text">확률 미입력 — 커브이동 0 처리.</span> 두 축 확률을 입력하면 반영됩니다.`
      : `<span class="warn-text">rg-calib medianCurves 로드 실패.</span>`;
  } else {
    edEl.innerHTML = `E[Δy] 3Y — 평행(v1) <b>${fmtP(parallel)}</b> · 내전망(v2) <b>${byTenor ? fmtP(byTenor[TENOR3Y]) : '—'}</b> · `
      + `혼합(w=${state.v2.w}%) <b>${mixed ? fmtP(mixed[TENOR3Y]) : '—'}</b> bp `
      + `<span class="rd-note">(커브이동 = −D′×E[Δy], 구간별)</span>`;
  }

  const complete = curveComplete(curveY);
  lastRg2 = { complete, w: state.v2.w, top: null, eDy3Y: mixed ? round1(mixed[TENOR3Y]) : null };

  if (!complete) {
    $('rg-rd-bars').innerHTML = '<div class="empty">위 국고 커브 8구간 수익률(%)을 모두 입력하면 구간별 기대수익이 계산됩니다. (세션 전용 · 저장되지 않음)</div>';
    $('rg-rd-rank').innerHTML = '';
    $('rg-rd-compare').innerHTML = '';
    return;
  }
  const { rows, ranked, top } = rolldownTable(curveY, mixed);   // 혼합 기준
  lastRg2.top = top;
  renderRdBars(rows, top);
  renderRdRank(ranked, top);
  renderCompare(decompose(curveY, parallel), decompose(curveY, byTenor), decompose(curveY, mixed));
}

// v1 / v2 / 혼합 total 비교 소표
function renderCompare(v1, v2, mx) {
  $('rg-rd-compare').innerHTML =
    `<thead><tr><th class="l">구간</th><th>v1 평행</th><th>v2 내전망</th><th>혼합(w=${state.v2.w}%)</th></tr></thead>
     <tbody>${RD_TENORS.map((t, k) => `<tr>
       <td class="l">${t}</td>
       <td>${fmtP(v1[k].total)}</td><td>${fmtP(v2[k].total)}</td><td>${fmtP(mx[k].total)}</td>
     </tr>`).join('')}</tbody>`;
}

function renderRdBars(rows, top) {
  // 제로중심 다이버징 스택: 양수 성분은 오른쪽, 음수는 왼쪽. 전 구간 공통 스케일.
  const mags = rows.map(r => {
    const pos = [r.carry, r.rolldown, r.curveMove].filter(v => v > 0).reduce((a, b) => a + b, 0);
    const neg = [r.carry, r.rolldown, r.curveMove].filter(v => v < 0).reduce((a, b) => a - b, 0);
    return Math.max(pos, neg);
  });
  const S = Math.max(...mags, 1e-9);
  const COMP = [['carry', '캐리', 'seg-carry'], ['rolldown', '롤다운', 'seg-roll'], ['curveMove', '커브이동', 'seg-move']];
  const seg = (r, side) => COMP.map(([key, label, cls]) => {
    const v = r[key];
    if (side === 'pos' ? !(v > 0) : !(v < 0)) return '';
    const w = Math.abs(v) / S * 100;
    return `<span class="rd-seg ${cls}${v < 0 ? ' neg' : ''}" style="width:${w.toFixed(2)}%" title="${label} ${fmtP(v)}bp"></span>`;
  }).join('');
  $('rg-rd-bars').innerHTML = rows.map(r => {
    const isTop = top && r.tenor === top.tenor;
    return `<div class="rd-row${isTop ? ' top' : ''}">
      <div class="rd-label">${r.tenor}${isTop ? ' <span class="rd-tag">최고</span>' : ''}</div>
      <div class="rd-track">
        <div class="rd-neg">${seg(r, 'neg')}</div>
        <div class="rd-pos">${seg(r, 'pos')}</div>
      </div>
      <div class="rd-total ${r.total > 0 ? 'pos' : r.total < 0 ? 'neg' : ''}">${fmtP(r.total)}</div>
    </div>`;
  }).join('');
}

function renderRdRank(ranked, top) {
  const num = (v, cls) => `<td class="${cls || ''}">${fmtP(v)}</td>`;
  $('rg-rd-rank').innerHTML =
    `<thead><tr><th class="l">구간</th><th>기대수익</th><th>캐리</th><th>롤다운</th><th>커브이동</th></tr></thead>
     <tbody>${ranked.map(r => `<tr class="${top && r.tenor === top.tenor ? 'top' : ''}">
       <td class="l">${r.tenor}${top && r.tenor === top.tenor ? ' <span class="rd-tag">최고</span>' : ''}</td>
       ${num(r.total, r.total > 0 ? 'pos' : r.total < 0 ? 'neg' : '')}
       ${num(r.carry)}${num(r.rolldown, r.rolldown < 0 ? 'neg' : '')}${num(r.curveMove, r.curveMove < 0 ? 'neg' : '')}
     </tr>`).join('')}</tbody>`;
}

function setBadge(id, st) {
  const el = $(id);
  if (st.empty) { el.textContent = '합계 0% ⚠'; el.className = 'badge warn'; }
  else if (st.ok) { el.textContent = `합계 ${st.sum}%`; el.className = 'badge ok'; }
  else { el.textContent = `합계 ${st.sum}% ⚠`; el.className = 'badge warn'; }
}

function renderHeatmap(cells, mode, maxP) {
  // 헤더행(스프레드) + 3 데이터행(금리). 색 농도 = 확률/최대. 최빈 셀 테두리.
  let html = `<div class="hm-corner"></div>` +
    SPREAD_KEYS.map(s => `<div class="hm-head">스프레드 ${SPREAD_LABEL[s]}</div>`).join('');
  for (const r of RATE_KEYS) {
    html += `<div class="hm-rowhead">금리 ${RATE_LABEL[r]} ${RATE_ARROW[r]}</div>`;
    for (const s of SPREAD_KEYS) {
      const key = `${r}|${s}`, p = cells[key], ph = PHASES[key];
      const alpha = maxP > 0 ? (0.10 + 0.90 * (p / maxP)) : 0;
      const isMode = mode && mode.key === key;
      html += `<div class="hm-cell ${STANCE[ph.stance].cls}${isMode ? ' hm-mode' : ''}" style="--a:${alpha.toFixed(3)}">
        <div class="hm-p">${fmtP(p)}%</div>
        <div class="hm-name">${ph.name}</div>
        ${isMode ? '<div class="hm-tag">최빈</div>' : ''}
      </div>`;
    }
  }
  $('rg-heatmap').innerHTML = html;
}

// ── 플레이북 전문(상시 전개) + 범례 ──
function renderPlaybook() {
  const rows = [];
  for (const r of RATE_KEYS) for (const s of SPREAD_KEYS) {
    const key = `${r}|${s}`, ph = PHASES[key];
    rows.push(`<tr class="${STANCE[ph.stance].cls}">
      <td class="pb-cell">${RATE_ARROW[r]} ${RATE_LABEL[r]} / ${SPREAD_LABEL[s]}</td>
      <td class="pb-name">${ph.name}</td>
      <td class="pb-play">${ph.play}</td></tr>`);
  }
  $('rg-playbook').innerHTML =
    `<thead><tr><th style="width:150px">셀 (금리/스프레드)</th><th style="width:120px">국면</th><th>정석 플레이북</th></tr></thead>
     <tbody>${rows.join('')}</tbody>`;
  $('rg-legend').innerHTML = Object.values(STANCE)
    .map(s => `<span class="lg ${s.cls}"><span class="lg-dot"></span>${s.label}</span>`).join('');
}

// ── 입력 가이드(밴드) ──
function renderGuide() {
  const b = calibBands();
  const g = (v) => (v == null ? '—' : `±${v}bp`);
  $('rg-guide').innerHTML = b.ok
    ? `<b>보합 밴드</b>(1개월 변화 |Δ| &lt; 밴드 → 보합): 국고 3Y <b>${g(b.ktb3y)}</b> · 대표 스프레드(회사채 AA- 3Y) <b>${g(b.repSpread)}</b>
       <span class="guide-src">— rg-calib ${b.period || ''}, k=0.25</span>`
    : `<span class="warn-text">rg-calib.js 밴드를 불러오지 못했습니다 — data/rg-calib.js 로드 확인.</span>`;
}

// ── 확정 원장(RG_LEDGER) 표시 + 스니펫 ──
function confirmedList() {
  const j = (window.RG_LEDGER && window.RG_LEDGER.judgments) || {};
  return Object.keys(j).sort().reverse().map(w => ({ week: w, rec: j[w] }));
}
function renderConfirmed() {
  const el = $('rg-confirmed');
  const items = confirmedList();
  const curWeek = state.date ? isoWeek(state.date) : null;
  if (!items.length) { el.innerHTML = '<div class="empty">확정된 판단이 없습니다. 아래 [확정]으로 스니펫을 만들어 data/rg-ledger.js 에 붙여넣고 커밋하세요.</div>'; return; }
  el.innerHTML = items.map(({ week, rec }) => {
    const m = rec.mode || {};
    const cur = week === curWeek ? ' <span class="cmt-tag">현재 주차</span>' : '';
    return `<div class="cf ${week === curWeek ? 'latest' : ''}">
      <div class="cf-meta">${week}${cur} · 확정 ${(rec.confirmedAt || '').slice(0, 10)}</div>
      <div class="cf-body">${m.name || '—'} · 최빈 ${fmtP(m.p)}% · 상위2 ${fmtP(m.top2)}%
        · 금리[${RATE_KEYS.map(k => rec.probs?.rate?.[k]).join('/')}] 스프레드[${SPREAD_KEYS.map(k => rec.probs?.spread?.[k]).join('/')}]</div>
    </div>`;
  }).join('');
}

function buildSnippet() {
  const rateN = normalizeInPlace(RATE_KEYS.map(k => state.rate[k]));
  const spreadN = normalizeInPlace(SPREAD_KEYS.map(k => state.spread[k]));
  const rateObj = Object.fromEntries(RATE_KEYS.map((k, i) => [k, rateN[i]]));
  const spreadObj = Object.fromEntries(SPREAD_KEYS.map((k, i) => [k, spreadN[i]]));
  const cells = combine(rateN, spreadN);
  const m = argmaxCell(cells);
  const b = calibBands();
  const week = isoWeek(state.date);
  const rec = {
    probs: { rate: rateObj, spread: spreadObj },
    mode: { cell: m.key, name: PHASES[m.key].name, p: round1(m.p), top2: round1(top2Sum(cells)) },
    baseline: { bandKtb3yBp: b.ktb3y, bandRepSpreadBp: b.repSpread, calib: b.period },
    confirmedAt: new Date().toISOString(),
  };
  // RG-2 v2 파생값(24칸 Δbp + 소스 + w) — 커브 원본(레벨) 미포함(§0.3).
  const curves = {}, sources = {};
  for (const dir of RATE_KEYS) {
    curves[dir] = state.v2.cells[dir].map(c => (Number.isFinite(+c.v) ? round1(+c.v) : null));
    sources[dir] = state.v2.cells[dir].map(c => c.source);
  }
  rec.rg2v2 = { curves, sources, w: state.v2.w };

  // RG-2 헤드라인(혼합 기준 최상위 구간). 커브(레벨) 미완이면 생략.
  const parallel = expectedDyParallel(rateN, spreadN, medianCurves());
  const byTenor = expectedDyByTenor(rateN, sceneCurves());
  const mixed = mixEDy(parallel, byTenor, wFrac());
  if (curveComplete(curveY)) {
    const { top } = rolldownTable(curveY, mixed);
    const version = state.v2.w === 100 ? 'v1-parallel' : state.v2.w === 0 ? 'v2-scenario' : 'mixed';
    rec.rg2 = { version, topTenor: top ? top.tenor : null, topReturnBp: top ? top.total : null, w: state.v2.w, eDy3YBp: mixed ? round1(mixed[TENOR3Y]) : null };
  }
  return { week, text: `window.RG_LEDGER.judgments[${JSON.stringify(week)}] = ${JSON.stringify(rec, null, 2)};\n` };
}

function onConfirm() {
  if (!state.date) { confirmStatus('판단일을 입력하세요.', 'bad'); return; }
  const { week, text } = buildSnippet();
  $('rg-snippet').value = text;
  $('rg-snippet-wrap').style.display = '';
  confirmStatus(`${week} 스니펫 생성됨 — 복사해서 data/rg-ledger.js 에 붙여넣고 커밋하세요.`, 'ok');
}
function confirmStatus(msg, kind) { const s = $('rg-confirm-status'); if (s) { s.textContent = msg; s.className = 'status ' + (kind || ''); } }

async function copySnippet() {
  const txt = $('rg-snippet').value;
  if (!txt) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); confirmStatus('복사됨 — data/rg-ledger.js 에 붙여넣기.', 'ok'); }
    else throw new Error('no clipboard');
  } catch {
    const ta = $('rg-snippet'); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    confirmStatus(ok ? '복사됨(폴백).' : '복사 실패 — 수동 복사하세요.', ok ? 'ok' : 'bad');
  }
}

// ── 초기화 ──
export function initRg() {
  if (!$('rg-heatmap')) return;
  load();
  if (!state.date) { try { state.date = new Date().toISOString().slice(0, 10); } catch { state.date = ''; } }

  // 입력 셀 1회 생성 후 값 주입
  $('rg-rate-inputs').innerHTML = buildInputs('rate', RATE_KEYS, RATE_LABEL);
  $('rg-spread-inputs').innerHTML = buildInputs('spread', SPREAD_KEYS, SPREAD_LABEL);
  buildCurveInputs();
  buildV2Blocks();
  const dateEl = $('rg-date'); if (dateEl) dateEl.value = state.date;
  const wEl = $('rg-w'); if (wEl) { wEl.value = state.v2.w; const wv = $('rg-w-val'); if (wv) wv.textContent = state.v2.w + '%'; }
  writeInputs();

  renderGuide();
  renderPlaybook();
  renderOutputs();      // renderRolldown 포함
  renderConfirmed();

  // 입력 위임(숫자↔슬라이더 동기, 형제 자동조정 없음)
  const onInput = (e) => {
    const el = e.target.closest('[data-axis][data-key]'); if (!el) return;
    const axis = el.dataset.axis, key = el.dataset.key;
    let v = +el.value; if (!Number.isFinite(v)) v = 0; v = Math.max(0, Math.min(100, v));
    state[axis][key] = v;
    // 형제(숫자↔슬라이더) 동기 — 렌더 없이 값만
    const num = $(`rg-${axis}-${key}`), rng = $(`rg-${axis}-${key}-s`);
    if (el === rng && num) num.value = v; else if (el === num && rng) rng.value = v;
    renderOutputs();
  };
  $('rg-rate-inputs').addEventListener('input', onInput);
  $('rg-spread-inputs').addEventListener('input', onInput);

  // 커브(레벨) 입력(세션 전용, 비저장) — 값만 갱신 후 RG-2 재계산
  $('rg-curve-inputs').addEventListener('input', (e) => {
    const el = e.target.closest('[data-idx]'); if (!el) return;
    curveY[+el.dataset.idx] = el.value;   // 문자열 그대로(빈칸 유지), 저장하지 않음
    renderRolldown();
  });

  // v2 24칸 입력(숫자↔슬라이더 동기, 편집 시 source='user' + dot) — 파생 Δbp 라 작업본 저장
  $('rg-v2-blocks').addEventListener('input', (e) => {
    const el = e.target.closest('[data-dir][data-k]'); if (!el) return;
    const dir = el.dataset.dir, k = +el.dataset.k;
    let v = +el.value; if (!Number.isFinite(v)) v = 0; v = Math.max(-60, Math.min(60, v));
    const cell = state.v2.cells[dir][k];
    cell.v = v; cell.source = 'user';
    const num = $(`rg-v2-${dir}-${k}`), rng = $(`rg-v2s-${dir}-${k}`);
    if (el === rng && num) num.value = v; else if (el === num && rng) rng.value = v;
    renderRolldown(); save();
  });
  // 시나리오별 "기본값 리셋" — 해당 시나리오 전 칸 source='default' 로 되돌리고 1층 재계산
  $('rg-v2-blocks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reset]'); if (!b) return;
    const dir = b.dataset.reset;
    state.v2.cells[dir].forEach(c => { c.source = 'default'; });
    renderRolldown(); save();
  });
  // 전체 리셋 — 24칸 전부 기본값
  const resetAll = $('rg-v2-reset-all');
  if (resetAll) resetAll.addEventListener('click', () => {
    for (const dir of RATE_KEYS) state.v2.cells[dir].forEach(c => { c.source = 'default'; });
    renderRolldown(); save();
  });
  // 혼합 w 슬라이더(0~100%) — 작업본 저장
  if (wEl) wEl.addEventListener('input', () => {
    let w = +wEl.value; if (!Number.isFinite(w)) w = 100; state.v2.w = Math.max(0, Math.min(100, w));
    const wv = $('rg-w-val'); if (wv) wv.textContent = state.v2.w + '%';
    renderRolldown(); save();
  });

  // 정규화 버튼(원클릭 파괴적 재기입)
  const normAxis = (axis, keys) => {
    const arr = keys.map(k => state[axis][k]);
    const out = normalizeInPlace(arr);
    keys.forEach((k, i) => { state[axis][k] = out[i]; });
    writeInputs(); renderOutputs();
  };
  $('rg-rate-norm').addEventListener('click', () => normAxis('rate', RATE_KEYS));
  $('rg-spread-norm').addEventListener('click', () => normAxis('spread', SPREAD_KEYS));

  // 판단일
  if (dateEl) dateEl.addEventListener('input', () => { state.date = dateEl.value; save(); renderConfirmed(); });

  // 초기화(기본값 복원) — 확률·판단일·v2(24칸+w) 전부 기본값
  $('rg-reset').addEventListener('click', () => {
    Object.assign(state, structuredClone(DEFAULTS));
    if (!state.date) { try { state.date = new Date().toISOString().slice(0, 10); } catch { state.date = ''; } }
    if (dateEl) dateEl.value = state.date;
    if (wEl) { wEl.value = state.v2.w; const wv = $('rg-w-val'); if (wv) wv.textContent = state.v2.w + '%'; }
    writeInputs(); renderOutputs();
  });

  // 확정 + 복사
  $('rg-confirm').addEventListener('click', onConfirm);
  $('rg-snippet-copy').addEventListener('click', copySnippet);

  // 해설 펼침 기억
  const ex = $('rg-explainer');
  if (ex) {
    try { ex.open = localStorage.getItem(LS_EXPLAIN) === '1'; } catch { /* noop */ }
    ex.addEventListener('toggle', () => { try { localStorage.setItem(LS_EXPLAIN, ex.open ? '1' : '0'); } catch { /* noop */ } });
  }
}

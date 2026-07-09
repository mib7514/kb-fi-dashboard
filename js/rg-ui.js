// rg-ui.js — RG-1 전향적 레짐 히트맵 페이지 오케스트레이션.
// 데이터: window.RG_CALIB(밴드 가이드), window.RG_LEDGER(확정 원장). 정규화: js/prob-normalize.js.
// 흐름: 확률 6칸 입력(숫자+슬라이더, 자동조정 없음) → 9셀 결합확률 히트맵 + 최빈 셀 + 플레이북.
//   합계≠100% → 경고 뱃지 + 정규화 버튼(정규화 전 확정 불가). [확정] → 원장 append 스니펫 생성.
// 순수 계산은 combine()/argmaxCell()/isoWeek(), 나머지는 상태·localStorage·DOM.

import { probStatus, normalized, normalizeInPlace } from './prob-normalize.js';

const $ = id => document.getElementById(id);
const LS_DRAFT = 'rg:draft';
const LS_EXPLAIN = 'rg-explainer-open';

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

// 기본값 = 합계 100 인 중립 prior(즉시 유효 히트맵 + OK 뱃지)
const DEFAULTS = { rate: { down: 33, flat: 34, up: 33 }, spread: { narrow: 33, flat: 34, wide: 33 }, date: '' };
const state = { rate: {}, spread: {}, date: '' };

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
  }
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

  save();
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
  const dateEl = $('rg-date'); if (dateEl) dateEl.value = state.date;
  writeInputs();

  renderGuide();
  renderPlaybook();
  renderOutputs();
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

  // 초기화(기본값 복원)
  $('rg-reset').addEventListener('click', () => {
    Object.assign(state, structuredClone(DEFAULTS));
    if (!state.date) { try { state.date = new Date().toISOString().slice(0, 10); } catch { state.date = ''; } }
    if (dateEl) dateEl.value = state.date;
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

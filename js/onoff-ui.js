// onoff-ui.js — On/Off 스프레드 조회 페이지 오케스트레이션.
// 데이터: window.ONOFF_KTB3Y (data/onoff-ktb3y.js). 계산: onoff-calc.js. 렌더: onoff-chart.js.
// 세대 드롭다운(기본 최신) → Panel A(분해)/B(이벤트타임)/C(요약카드) 갱신.

import {
  orderGenerations, currentTag, generationZ, flyChange, flyExtremes, bandStats,
  makeProvisional, appendProvisional,
} from './onoff-calc.js';
import { renderDecompose, renderEventTime } from './onoff-chart.js';
import { judge, buildSnapshot } from './onoff-judge.js';

const $ = id => document.getElementById(id);
const fmt = (v, u = '') => (typeof v === 'number' && Number.isFinite(v)) ? (v > 0 ? '+' : '') + v.toFixed(1) + u : '—';
const LS_PROV = 'onoff-provisional';

const state = { data: null, gens: [], selected: null, auctions: [], commentary: [], lastSnapshot: null, forwardDays: 60, events: null, provisional: null, prov: null };

const VERDICT_CLASS = { period: 'v-period', concession: 'v-concession', liquidity: 'v-liquidity', mixed: 'v-mixed', none: 'v-none' };

function fillMeta() {
  const d = state.data;
  const gens = state.gens;
  const first = gens.reduce((m, g) => (g.start < m ? g.start : m), gens[0].start);
  $('oo-tenor').textContent = d.tenor;
  $('oo-range').textContent = `${first} ~ ${d.updated}`;
  $('oo-count').textContent = `${gens.length}세대`;
  $('oo-updated').textContent = d.updated;
}

function fillDropdown() {
  const sel = $('oo-gen-select');
  sel.innerHTML = state.gens.map((g, i) =>
    `<option value="${g.tag}">${g.tag}${i === 0 ? ' (현재)' : ''} · vs ${g.vs} · ${g.series.length}일</option>`
  ).join('');
  sel.value = state.selected;
}

// Panel C — 요약 카드
function renderCards() {
  const gen = state.gens.find(g => g.tag === state.selected);
  const day = gen.series.length - 1;                    // 선택 세대의 현재(마지막) day
  const ex = flyExtremes(gen);
  const z = generationZ(state.data.generations, day, { tag: gen.tag });
  const chg5 = flyChange(gen, 5);
  const band = bandStats(state.data.generations, day, { excludeTag: gen.tag });
  const last = gen.series[day];

  const zClass = z.z == null ? '' : (z.z >= 1.5 ? 'ext-hi' : z.z <= -1.5 ? 'ext-lo' : '');
  const cards = [
    { l: `현재 fly (${last[0]})`, m: fmt(last[3], 'bp'), s: `raw ${fmt(last[1])} / slope ${fmt(last[2])}` },
    { l: `세대간 z (day ${day}, n=${z.n})`, m: z.z == null ? '—' : (z.z > 0 ? '+' : '') + z.z.toFixed(2), s: `과거 median ${fmt(band.median, 'bp')}`, cls: zClass },
    { l: '5영업일 변화', m: fmt(chg5, 'bp'), s: chg5 == null ? '표본 부족' : (chg5 > 0 ? '확대' : chg5 < 0 ? '축소' : '보합') },
    { l: '사이클 내 fly', m: fmt(ex.current, 'bp'), s: `최저 ${fmt(ex.min)} / 최고 ${fmt(ex.max)}` },
    { l: '밴드 위치 (day ' + day + ')', m: fmt(band.median, 'bp'), s: `p25 ${fmt(band.p25)} / p75 ${fmt(band.p75)}` },
    { l: '선택 세대', m: gen.tag, s: `vs ${gen.vs} · slope vs ${gen.slopeVs} · 만기 ${gen.maturity}`, small: true },
  ];
  $('oo-cards').innerHTML = cards.map(c => `
    <div class="stat">
      <div class="stat-label">${c.l}</div>
      <div class="stat-main ${c.cls || ''}" ${c.small ? 'style="font-size:16px"' : ''}>${c.m}</div>
      <div class="stat-sub">${c.s}</div>
    </div>`).join('');
}

// 에피소드 배지 렌더 헬퍼
function badgeHtml(ep, forceCls) {
  const bcls = forceCls || VERDICT_CLASS[ep.type] || 'v-none';
  const conds = ep.evidence.map(e => `<li>${e}</li>`).join('');
  return `<div class="verdict-badge ${bcls}">
    <span class="vb-label">${ep.label}</span>
    <ul class="vb-evidence">${conds}</ul>
  </div>`;
}

// 헤드라인 판정 + 다가오는 입찰 + 지난 에피소드 + 아웃라이어 병기 + JSON 복사
function renderVerdict(gen) {
  const day = gen.series.length - 1;
  const z = generationZ(state.data.generations, day, { tag: gen.tag });
  const jr = judge(gen, state.auctions, z);
  state.lastSnapshot = buildSnapshot(gen, jr, z);

  const cls = VERDICT_CLASS[jr.verdict.type] || 'v-none';
  // preAuction 은 아래 '다가오는 입찰' 섹션에서 노출 → 헤드라인 배지에서는 제외(중복 방지)
  const headline = jr.headline.filter(e => e.type !== 'preAuction').map(e => badgeHtml(e)).join('') +
    jr.flags.map(f => badgeHtml(f, 'v-outlier')).join('');
  const upcoming = jr.upcoming.length
    ? `<div class="verdict-sub">다가오는 입찰</div>` + jr.upcoming.map(e => badgeHtml(e, e.fired ? 'v-concession' : 'v-upcoming')).join('')
    : '';
  const past = jr.past.length
    ? `<details class="verdict-past"><summary>지난 에피소드 (${jr.past.length}) — 게이트 밖(현재±${7}영업일)</summary>
        ${jr.past.map(e => badgeHtml(e, 'v-past')).join('')}</details>`
    : '';

  // 잠정(호가 기반) 병렬 판정 — 기존 EOD 판정을 대체하지 않고 아래 병기
  let provHtml = '';
  if (state.prov) {
    const p = state.prov, pj = p.judge;
    const pcls = VERDICT_CLASS[pj.verdict.type] || 'v-none';
    const pbadges = pj.headline.filter(e => e.type !== 'preAuction').map(e => badgeHtml(e)).join('') +
      pj.flags.map(f => badgeHtml(f, 'v-outlier')).join('') +
      pj.upcoming.map(e => badgeHtml(e, e.fired ? 'v-concession' : 'v-upcoming')).join('');
    provHtml = `<div class="prov-verdict">
      <div class="verdict-sub">잠정 (호가 기반) · ${p.point.date} · fly ${fmt(p.point.fly, 'bp')} = raw ${fmt(p.point.raw)} − slope ${fmt(p.point.slope)}${p.point.slopeAssumed ? ` <span class="prov-assumed">(기울기 가정: 최종 민평 ${fmt(p.point.slope, 'bp')})</span>` : ''}</div>
      <div class="verdict-head"><span class="verdict-main ${pcls}">${pj.verdict.label}</span></div>
      <div class="verdict-badges">${pbadges || '<div class="empty" style="padding:8px">잠정 발화 룰 없음.</div>'}</div>
    </div>`;
    const ps = buildSnapshot(p.appended, pj, p.z);
    state.lastSnapshot.provisional = { provisional: true, point: p.point, verdict: ps.verdict, evidence: ps.evidence, flags: ps.flags, upcoming: ps.upcoming, past: ps.past };
  }

  $('oo-verdict').innerHTML = `
    <div class="verdict-head">
      <span class="verdict-main ${cls}">${jr.verdict.label}</span>
      <button class="btn" id="oo-copy-btn">메트릭+판정 JSON 복사</button>
    </div>
    <div class="verdict-badges">${headline || '<div class="empty" style="padding:8px">게이트 내 발화 룰 없음 — 관찰.</div>'}</div>
    ${upcoming}
    ${past}
    ${provHtml}
    <div class="status" id="oo-copy-status"></div>`;
  $('oo-copy-btn').addEventListener('click', copySnapshot);
  return jr.events;
}

async function copySnapshot() {
  const txt = JSON.stringify(state.lastSnapshot, null, 2);
  const done = ok => { const s = $('oo-copy-status'); if (s) { s.textContent = ok ? '복사됨 — onoff-admin 코멘터리 입력란에 붙여넣기' : '복사 실패(수동 복사 필요)'; s.className = 'status ' + (ok ? 'ok' : 'bad'); } };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); done(true); }
    else throw new Error('no clipboard');
  } catch { // 폴백: 임시 textarea
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta); done(ok);
  }
}

// 최신 코멘터리 + 히스토리(당시 fly/z 병기)
function renderCommentary() {
  const el = $('oo-commentary');
  if (!el) return;
  const items = [...state.commentary].sort((a, b) => (a.date < b.date ? 1 : -1)); // 최신 먼저
  if (!items.length) { el.innerHTML = '<div class="empty">등록된 코멘터리가 없습니다. (onoff-admin 에서 추가)</div>'; return; }
  el.innerHTML = items.map((it, i) => {
    const snap = it.inputSnapshot || {};
    const meta = `${it.date || snap.asof || '—'} · ${snap.tag || ''} fly ${fmt(snap.fly, 'bp')} · z ${snap.z ?? '—'}${snap.verdict ? ' · ' + snap.verdict : ''}`;
    return `<div class="cmt ${i === 0 ? 'latest' : ''}">
      <div class="cmt-meta">${meta}${i === 0 ? ' <span class="cmt-tag">최신</span>' : ''}</div>
      <div class="cmt-text">${(it.text || '').replace(/</g, '&lt;')}</div>
    </div>`;
  }).join('');
}

// 잠정 포인트 계산(현재 세대·기준일이 최종 관측일 이후일 때만). 실패 시 null.
function computeProv(gen) {
  if (!state.provisional || state.selected !== currentTag(state.data.generations)) return null;
  const lastDate = gen.series[gen.series.length - 1][0];
  if (!(state.provisional.date > lastDate)) return null;
  const point = makeProvisional(gen, state.provisional);
  const appended = appendProvisional(gen, point);
  const provGens = state.data.generations.map(g => g.tag === gen.tag ? appended : g);
  const z = generationZ(provGens, appended.series.length - 1, { tag: gen.tag });
  return { point, appended, judge: judge(appended, state.auctions, z), z };
}

function renderPanelB() {
  renderEventTime($('oo-chart-b'), state.data.generations, state.selected, state.events, state.forwardDays, state.prov ? state.prov.point : null);
}

function renderAll() {
  const gen = state.gens.find(g => g.tag === state.selected);
  state.prov = computeProv(gen);
  renderCards();
  state.events = renderVerdict(gen);
  renderDecompose($('oo-chart-a'), gen, state.events, state.prov ? state.prov.point : null);
  renderPanelB();
}

// ── 당일 호가 잠정 입력 (localStorage · 비커밋) ──
function provStatus(msg, kind) { const s = $('oo-prov-status'); if (s) { s.textContent = msg; s.className = 'status ' + (kind || ''); } }

function applyProvisional() {
  const date = $('oo-prov-date').value, yOn = $('oo-prov-on').value, yOff1 = $('oo-prov-off1').value, yOff2 = $('oo-prov-off2').value;
  if (!date || yOn === '' || yOff1 === '') { provStatus('기준일·지표·구지표는 필수입니다.', 'bad'); return; }
  const curTag = currentTag(state.data.generations);
  const cur = state.gens.find(g => g.tag === curTag);
  const lastDate = cur.series[cur.series.length - 1][0];
  if (!(date > lastDate)) { provStatus(`기준일(${date})이 민평 최종일(${lastDate}) 이전이거나 같음 → 무시. 최종일 이후 날짜를 입력하세요.`, 'bad'); return; }
  state.provisional = { date, yOn: +yOn, yOff1: +yOff1, yOff2: yOff2 === '' ? null : +yOff2 };
  localStorage.setItem(LS_PROV, JSON.stringify(state.provisional));
  if (state.selected !== curTag) { state.selected = curTag; $('oo-gen-select').value = curTag; } // 잠정은 현재 세대 전용
  renderAll();
  const p = state.prov;
  provStatus(p ? `적용됨 — fly ${fmt(p.point.fly, 'bp')} = raw ${fmt(p.point.raw)} − slope ${fmt(p.point.slope)}${p.point.slopeAssumed ? ' (기울기 가정: 최종 민평)' : ''} · 개인 뷰(비커밋)` : '적용 실패', p ? 'ok' : 'bad');
}

function clearProvisional() {
  state.provisional = null;
  localStorage.removeItem(LS_PROV);
  ['oo-prov-on', 'oo-prov-off1', 'oo-prov-off2'].forEach(id => { const e = $(id); if (e) e.value = ''; });
  renderAll();
  provStatus('초기화됨.', '');
}

function loadProvisional() {
  const dEl = $('oo-prov-date');
  if (dEl && !dEl.value) { try { dEl.value = new Date().toISOString().slice(0, 10); } catch { /* noop */ } } // 기본=오늘
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_PROV) || 'null'); } catch { saved = null; }
  if (saved && saved.date) {
    state.provisional = saved;
    if (dEl) dEl.value = saved.date;
    if ($('oo-prov-on')) $('oo-prov-on').value = saved.yOn ?? '';
    if ($('oo-prov-off1')) $('oo-prov-off1').value = saved.yOff1 ?? '';
    if ($('oo-prov-off2')) $('oo-prov-off2').value = saved.yOff2 ?? '';
  }
}

export function initOnoff() {
  const data = window.ONOFF_KTB3Y;
  if (!data || !Array.isArray(data.generations) || !data.generations.length) {
    const app = $('oo-app');
    if (app) app.insertAdjacentHTML('beforeend', '<div class="empty">데이터(window.ONOFF_KTB3Y)를 불러오지 못했습니다.</div>');
    return;
  }
  state.data = data;
  state.gens = orderGenerations(data.generations); // 최신 → 과거
  state.selected = currentTag(data.generations);
  state.auctions = (window.ONOFF_EVENTS && window.ONOFF_EVENTS.auctions) || [];
  state.commentary = Array.isArray(window.ONOFF_COMMENTARY) ? window.ONOFF_COMMENTARY : [];

  fillMeta();
  fillDropdown();
  loadProvisional();
  renderAll();
  renderCommentary();

  $('oo-gen-select').addEventListener('change', (e) => {
    state.selected = e.target.value;
    renderAll();
  });
  if ($('oo-prov-apply')) $('oo-prov-apply').addEventListener('click', applyProvisional);
  if ($('oo-prov-clear')) $('oo-prov-clear').addEventListener('click', clearProvisional);

  // 포워드 참조 토글 (Panel B x축 연장)
  const seg = $('oo-forward-seg');
  if (seg) seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fwd]');
    if (!btn) return;
    state.forwardDays = parseInt(btn.dataset.fwd, 10) || 0;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    renderPanelB();
  });
}

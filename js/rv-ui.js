// rv-ui.js — Curve RV 화면 오케스트레이션.
// 데이터: window.FENRIR_SERIES['credit-spread'] (data/credit-spread.js 선로드).
import {
  toBp, nonNulls, latest, seriesPercentile, slopeStats, pairStats,
  carryRoll, backtest, bucketOf, SLOPE_SETS, PAIRS, MATURITIES, MATURITY_LABELS,
} from './rv-calc.js';
import { renderHeatmap, renderTermStructure, renderHistory } from './rv-chart.js';

const MATS = MATURITIES;                 // [1,2,3,5,10]
const MLAB = MATURITY_LABELS;            // ['1년',...]
const BUCKET_KO = { low: '저', mid: '중', high: '고' };

let DATA, SERIES, SECTORS, CREDIT_SECTORS;
const state = { sector: '공사채AAA', compare: '', heatWindow: 'full', detailMi: 2 };

// --- 포맷 가드 ---
const num = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(d) : '—';
const sgn = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v)) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—';
const pct = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(Math.round(v)) : '—';
const isExtreme = (v) => typeof v === 'number' && Number.isFinite(v) && (v <= 5 || v >= 95);

// --- 데이터 접근 ---
const lab = (sector, mi) => `${sector}_${MLAB[mi]}`;
const bpSeries = (sector, mi) => toBp(SERIES[lab(sector, mi)] || []);
const ktbSeries = (mi) => SERIES[`국고채권_${MLAB[mi]}`] || []; // %

function priorValue(arr, back = 245) {
  let L = -1;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && Number.isFinite(arr[i])) { L = i; break; }
  if (L < 0) return null;
  let idx = Math.max(0, L - back);
  for (let i = idx; i >= 0; i--) if (arr[i] != null && Number.isFinite(arr[i])) return arr[i];
  for (let i = idx; i <= L; i++) if (arr[i] != null && Number.isFinite(arr[i])) return arr[i];
  return null;
}
function minMaxRecent(arr, n = 750) {
  const v = nonNulls(arr).slice(-n);
  return v.length ? { lo: Math.min(...v), hi: Math.max(...v) } : { lo: null, hi: null };
}

// ============ [0] 히트맵 ============
function drawHeatmap() {
  const z = CREDIT_SECTORS.map(sector =>
    MATS.map((_, mi) => seriesPercentile(bpSeries(sector, mi), state.heatWindow)));
  renderHeatmap(document.getElementById('rv-heatmap'),
    { sectors: CREDIT_SECTORS, maturities: MLAB, z }, selectSector);
  document.querySelectorAll('[data-heatwin]').forEach(b =>
    b.classList.toggle('active', b.dataset.heatwin === state.heatWindow));
}

// ============ [1] 스코어카드 ============
let SECTOR_CACHE = null; // { rows:[{mi, spread, p1,p3,pf, cr, bt}], ... }

function computeSector(sector) {
  const ktbByMat = {}, spreadByMat = {};
  for (let mi = 0; mi < MATS.length; mi++) {
    ktbByMat[MATS[mi]] = latest(ktbSeries(mi));
    spreadByMat[MATS[mi]] = latest(bpSeries(sector, mi));
  }
  const cr = carryRoll(ktbByMat, spreadByMat);
  const rows = MATS.map((m, mi) => {
    const arr = bpSeries(sector, mi);
    const pf = seriesPercentile(arr, 'full');
    const bt = backtest(arr); // lazy: 섹터 선택 시 5회
    return {
      mi, m, spread: latest(arr),
      p1: seriesPercentile(arr, '1y'), p3: seriesPercentile(arr, '3y'), pf,
      cr: cr[m], bt, bucket: bucketOf(pf),
    };
  });
  return { sector, rows };
}

function drawScorecard() {
  SECTOR_CACHE = computeSector(state.sector);
  const rows = SECTOR_CACHE.rows.map(r => {
    const bkt = r.bucket ? r.bt[r.bucket] : null;
    const btTxt = (bkt && bkt.n) ? `${BUCKET_KO[r.bucket]}: ${sgn(bkt.mean)}bp / ${pct(bkt.shrinkProb)}%` : '—';
    const pcell = (v, ex) => `<span class="${isExtreme(v) ? 'ext' : ''}">${pct(v)}</span>`;
    return `<tr data-mi="${r.mi}" class="${r.mi === state.detailMi ? 'sel' : ''}">
      <td class="mat">${MLAB[r.mi]}</td>
      <td class="n">${num(r.spread)}</td>
      <td class="n ile">${pcell(r.p1)}<i>/</i>${pcell(r.p3)}<i>/</i>${pcell(r.pf)}</td>
      <td class="n">${num(r.cr.carry)}</td>
      <td class="n">${sgn(r.cr.spreadRoll)}</td>
      <td class="n">${sgn(r.cr.ktbRoll)}</td>
      <td class="n hl">${num(r.cr.excessCarryRoll)}</td>
      <td class="n">${num(r.cr.excessPerDur)}</td>
      <td class="bt">${btTxt}</td>
    </tr>`;
  }).join('');
  document.getElementById('rv-scorecard-body').innerHTML = rows;
  document.getElementById('rv-sector-name').textContent = state.sector;
  document.querySelectorAll('#rv-scorecard-body tr').forEach(tr =>
    tr.addEventListener('click', () => { state.detailMi = +tr.dataset.mi; drawDetail(); drawScorecard(); }));
}

// ============ [1-상세] 시리즈 히스토리 + 백테스트 3버킷 ============
function drawDetail() {
  const mi = state.detailMi;
  const arr = bpSeries(state.sector, mi);
  renderHistory(document.getElementById('rv-detail-chart'), {
    dates: DATA.dates, values: arr, current: latest(arr),
    title: `${state.sector} ${MLAB[mi]} 스프레드 히스토리 (bp)`,
  });
  const bt = backtest(arr);
  const curBucket = bucketOf(seriesPercentile(arr, 'full'));
  const line = (k) => {
    const b = bt[k];
    return `<tr class="${k === curBucket ? 'sel' : ''}"><td>${BUCKET_KO[k]}${k === curBucket ? ' ◀현재' : ''}</td>
      <td class="n">${b.n}</td><td class="n">${sgn(b.mean)}</td><td class="n">${sgn(b.median)}</td><td class="n">${pct(b.shrinkProb)}%</td></tr>`;
  };
  document.getElementById('rv-detail-bt').innerHTML =
    `<tr><th>구간</th><th>표본</th><th>평균Δ</th><th>중앙Δ</th><th>축소확률</th></tr>` +
    ['low', 'mid', 'high'].map(line).join('');
  document.getElementById('rv-detail-title').textContent = `${state.sector} ${MLAB[mi]} — 6개월 forward 성적`;
}

// ============ [2] 텀스트럭처 ============
function drawTermStructure() {
  const current = [], prior = [], lo = [], hi = [];
  for (let mi = 0; mi < MATS.length; mi++) {
    const arr = bpSeries(state.sector, mi);
    current.push(latest(arr));
    prior.push(priorValue(arr, 245));
    const mm = minMaxRecent(arr, 750);
    lo.push(mm.lo); hi.push(mm.hi);
  }
  // 비교 오버레이: 선택 시(자기 자신 제외) 비교 섹터의 현재 커브를 점선으로
  let compare = null;
  if (state.compare && state.compare !== state.sector) {
    compare = { name: state.compare, current: MATS.map((_, mi) => latest(bpSeries(state.compare, mi))) };
  }
  renderTermStructure(document.getElementById('rv-term'), {
    maturities: MLAB, current, prior, lo, hi,
    title: `${state.sector} — 스프레드 텀스트럭처 (bp)`, compare,
  });
  document.getElementById('rv-ts-sector').textContent =
    state.sector + (compare ? ` vs ${compare.name}` : '');
}

// ============ [3] 기울기 패널 ============
function drawSlopes() {
  const rows = SLOPE_SETS.map(([a, b]) => {
    const ai = MATS.indexOf(a), bi = MATS.indexOf(b);
    const s = slopeStats(bpSeries(state.sector, ai), bpSeries(state.sector, bi));
    return `<tr>
      <td>${a}→${b}년</td>
      <td class="n">${sgn(s.current)}</td>
      <td class="n"><span class="${isExtreme(s.full) ? 'ext' : ''}">${pct(s.full)}</span></td>
      <td class="n"><span class="${isExtreme(s['3y']) ? 'ext' : ''}">${pct(s['3y'])}</span></td>
    </tr>`;
  }).join('');
  document.getElementById('rv-slope-body').innerHTML =
    `<tr><th>구간</th><th>현재bp</th><th>full%</th><th>3y%</th></tr>` + rows;
}

// ============ [4] 페어 패널 ============
function pairHistory(x, y, mi) {
  const ax = SERIES[lab(x, mi)] || [], ay = SERIES[lab(y, mi)] || [];
  const dates = [], vals = [];
  for (let i = 0; i < DATA.dates.length; i++) {
    const a = ax[i], b = ay[i];
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) { dates.push(DATA.dates[i]); vals.push((a - b) * 100); }
  }
  return { dates, vals };
}
function drawPairs() {
  const p = PAIRS[0];
  const rows = MATS.map((m, mi) => {
    const st = pairStats(bpSeries(p.x, mi), bpSeries(p.y, mi));
    return `<tr><td>${MLAB[mi]}</td><td class="n">${sgn(st.current)}</td><td class="n"><span class="${isExtreme(st.full) ? 'ext' : ''}">${pct(st.full)}</span></td></tr>`;
  }).join('');
  document.getElementById('rv-pair-body').innerHTML =
    `<tr><th>만기</th><th>격차bp</th><th>full%</th></tr>` + rows;
  document.getElementById('rv-pair-name').textContent = p.label;
  const h = pairHistory(p.x, p.y, 2); // 3년
  renderHistory(document.getElementById('rv-pair-chart'), {
    dates: h.dates, values: h.vals, current: h.vals[h.vals.length - 1],
    title: `${p.label} 3년 격차 히스토리 (bp)`,
  });
}

// --- 섹터 선택 (히트맵 클릭·드롭다운 공통 진입점) ---
function selectSector(sector) {
  if (!CREDIT_SECTORS.includes(sector)) return;
  state.sector = sector;
  state.detailMi = 2;
  const sel = document.getElementById('rv-sector-select'); // 드롭다운 동기화
  if (sel && sel.value !== sector) sel.value = sector;
  drawScorecard(); drawDetail(); drawTermStructure(); drawSlopes();
}

export function initCurveRV() {
  DATA = window.FENRIR_SERIES && window.FENRIR_SERIES['credit-spread'];
  if (!DATA) { document.getElementById('rv-app').innerHTML = '<p class="empty">데이터를 불러오지 못했습니다 (data/credit-spread.js).</p>'; return; }
  SERIES = DATA.series;
  SECTORS = DATA.meta.sectors;
  CREDIT_SECTORS = SECTORS.filter(s => s !== '국고채권');

  document.getElementById('rv-updated').textContent = DATA.meta.last_updated;
  document.getElementById('rv-range').textContent = `${DATA.dates[0]} ~ ${DATA.dates[DATA.dates.length - 1]}`;
  document.getElementById('rv-count').textContent = `${DATA.dates.length}일`;

  // 섹터 드롭다운 (국고 제외 14) + 비교 드롭다운 ('없음' + 14)
  const sectorSel = document.getElementById('rv-sector-select');
  const compareSel = document.getElementById('rv-compare-select');
  const opts = CREDIT_SECTORS.map(s => `<option value="${s}">${s}</option>`).join('');
  sectorSel.innerHTML = opts;
  sectorSel.value = state.sector;
  compareSel.innerHTML = '<option value="">없음</option>' + opts;
  sectorSel.addEventListener('change', () => selectSector(sectorSel.value));
  compareSel.addEventListener('change', () => { state.compare = compareSel.value; drawTermStructure(); });

  // 히트맵 윈도우 토글
  document.querySelectorAll('[data-heatwin]').forEach(b =>
    b.addEventListener('click', () => { state.heatWindow = b.dataset.heatwin; drawHeatmap(); }));

  drawHeatmap();
  selectSector(state.sector);
  drawPairs();
}

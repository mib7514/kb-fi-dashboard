// rg-ui.js — RG-1 전향적 레짐 히트맵 페이지 오케스트레이션.
// 데이터: window.RG_CALIB(밴드 가이드), window.RG_LEDGER(확정 원장). 정규화: js/prob-normalize.js.
// 흐름: 확률 6칸 입력(숫자+슬라이더, 자동조정 없음) → 9셀 결합확률 히트맵 + 최빈 셀 + 플레이북.
//   합계≠100% → 경고 뱃지 + 정규화 버튼(정규화 전 확정 불가). [확정] → 원장 append 스니펫 생성.
// 순수 계산은 combine()/argmaxCell()/isoWeek(), 나머지는 상태·localStorage·DOM.

import { probStatus, normalized, normalizeInPlace } from './prob-normalize.js';
import {
  TENORS as RD_TENORS, TENOR3Y, curveComplete, curveCell, expectedDyParallel, rolldownTable, decompose,
  conditionalDefaultCurves, expectedDyByTenor, mixEDy,
  anchorFitCurve, IDX_3M, IDX_3Y,
} from './rg-rolldown.js';
import {
  SECTORS, SECTOR_DIRS, SECTOR_DIR_LABEL, sectorProbs, setSectorProb, sectorBandBp, expectedDs,
} from './rg-sector.js';
import { matrixReturns, MATRIX_SECTORS, MATRIX_SPREAD_SERIES } from './rg-matrix.js';
import { scoreJudgment, maturityOf, ddayTo } from './rg-score.js';

const $ = id => document.getElementById(id);
const LS_DRAFT = 'rg:draft';
const LS_EXPLAIN = 'rg-explainer-open';

// RG-2 커브(레벨 수익률) 입력 — 세션 전용(메모리만). state 와 분리 → localStorage 미포함(§0.3).
let curveY = RD_TENORS.map(() => '');
let lastRg2 = null;         // 확정 스니펫 반영용(파생값만)
let lastV2Defaults = null;  // 최근 1층 기본커브 { down:[8], flat:[8], up:[8] } — dot 툴팁·리셋·앵커 seed·shape 참조
let v2Method = {};          // 앵커 모드 시나리오별 보정 방식 { down:'affine'|'linear', ... }
let v2DetailDirty = false;  // 상세 모드 진입 후 24칸을 실제 수정했는가(→앵커 복귀 경고 조건)

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

// v2 스켈레톤. mode: 'anchor'(기본) 시나리오별 앵커 2점(3M·3Y Δbp)만 입력→나머지 자동 산출 |
//   'detail' 24칸 직접 편집. anchors[dir]={d3M,d3Y}(Δbp, null=미설정→기본커브에서 seed).
//   cells 24칸 { v:Δbp|'', source:'default'|'user' } = 파생/편집 결과(계산 경로 입력·작업본 저장 허용, §0.3).
//   착지금리(레벨 %)는 어디에도 담지 않는다 — Δbp 만(현재커브 복원 우회 방지, §0.3).
function freshV2() {
  const mk = () => Array.from({ length: RD_TENORS.length }, () => ({ v: '', source: 'default' }));
  const anc = () => ({ d3M: null, d3Y: null });
  return { mode: 'anchor', anchors: { down: anc(), flat: anc(), up: anc() }, cells: { down: mk(), flat: mk(), up: mk() }, w: 100 };
}

// RG-3 섹터 상태: 국고채→state.rate, 회사채→state.spread 공유 → state.sectors 엔 비공유 4섹터만.
// 비공유 섹터 { mode:'follow'|'custom', narrow, flat, wide }. follow(기본)=RG-1 스프레드 축 상속(미러),
//   custom=사용자 개별 조정(동결). narrow/flat/wide 는 custom 일 때만 유효(follow 는 스프레드에서 파생).
const NONSHARED_SECTORS = SECTORS.filter(s => !s.share).map(s => s.key);
function freshSectors() { const o = {}; for (const k of NONSHARED_SECTORS) o[k] = { mode: 'follow', narrow: 33, flat: 34, wide: 33 }; return o; }

// 매트릭스 섹터 스프레드(bp) — credit-spread.js 최신일 값 기본 로드(공개 파생 데이터라 저장 제약 없음).
//   국고=0 고정(스프레드 없음). 수익률 레벨(%)은 이 상태에 없음 — 매트릭스는 세션에서 파생 계산만.
function creditSpreadLatest() {
  const s = window.FENRIR_SERIES && window.FENRIR_SERIES['credit-spread'];
  if (!s || !s.series || !Array.isArray(s.dates) || !s.dates.length) return null;
  const last = s.dates.length - 1;
  const spreads = {};
  for (const [sec, key] of Object.entries(MATRIX_SPREAD_SERIES)) {
    const arr = s.series[key];
    spreads[sec] = (arr && Number.isFinite(+arr[last])) ? Math.round(+arr[last] * 1000) / 10 : null;   // % → bp, 0.1bp
  }
  return { spreads, basisDate: (s.meta && s.meta.last_updated) || s.dates[last] };
}
function freshMatrix() { const cs = creditSpreadLatest(); return { spreads: cs ? cs.spreads : {}, basisDate: cs ? cs.basisDate : null }; }

// 기본값 = 합계 100 인 중립 prior(즉시 유효 히트맵 + OK 뱃지)
const DEFAULTS = { rate: { down: 33, flat: 34, up: 33 }, spread: { narrow: 33, flat: 34, wide: 33 }, date: '', v2: freshV2(), sectors: freshSectors(), matrix: freshMatrix() };
const state = { rate: {}, spread: {}, date: '', v2: freshV2(), sectors: freshSectors(), matrix: freshMatrix() };

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
// 저장: 앵커 모드는 mode+anchors(Δbp 6)+w 만(24칸은 파생 → 미저장). 상세 모드는 24칸 포함.
// 착지 레벨(%)은 state 에 존재하지 않으므로 어느 모드든 덤프에 부재(§0.3).
function save() {
  try {
    const persist = structuredClone(state);
    delete persist.date; // 판단일 미저장 — 로드 시 오늘로 초기화(§ load 참조)
    if (persist.v2 && persist.v2.mode !== 'detail') delete persist.v2.cells;
    // follow 섹터는 스프레드 축에서 파생 → 확률 미저장(플래그만). custom 만 확률 저장.
    if (persist.sectors) for (const k of NONSHARED_SECTORS) {
      const sec = persist.sectors[k];
      if (sec && sec.mode !== 'custom') { delete sec.narrow; delete sec.flat; delete sec.wide; }
    }
    localStorage.setItem(LS_DRAFT, JSON.stringify(persist));
  } catch { /* noop */ }
}
function load() {
  let s = null; try { s = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null'); } catch { s = null; }
  Object.assign(state, structuredClone(DEFAULTS));
  if (s && s.rate && s.spread) {
    RATE_KEYS.forEach(k => { if (Number.isFinite(+s.rate[k])) state.rate[k] = +s.rate[k]; });
    SPREAD_KEYS.forEach(k => { if (Number.isFinite(+s.spread[k])) state.spread[k] = +s.spread[k]; });
    // 판단일(state.date)은 복원하지 않음 — 매 로드 오늘로 초기화(주간 판단 = 현재 세션 값, 과거일 고정 버그 방지).
    const v2 = validV2(s.v2);
    if (v2) state.v2 = v2;                    // ⑥ 작업본(24칸+w) 복원 — 우선
    const sec = validSectors(s.sectors);
    if (sec) state.sectors = sec;             // RG-3 섹터 작업본 복원
    // 매트릭스 스프레드(bp) 사용자 수정분 복원(basisDate 는 현재 파일 최신 유지). 수익률 레벨은 저장 안 됨.
    if (s.matrix && s.matrix.spreads) for (const sk of Object.keys(MATRIX_SPREAD_SERIES)) {
      if (Number.isFinite(+s.matrix.spreads[sk])) state.matrix.spreads[sk] = +s.matrix.spreads[sk];
    }
  } else {
    const carry = ledgerCarryV2();            // 2층: 전주 확정 rg2v2 이월(작업본 없을 때만)
    if (carry) state.v2 = carry;
  }
}

// 저장/이월 v2 형태 검증 → 정규화. 앵커 모드는 cells 없이 저장될 수 있음(파생 재산출). 실패 시 null.
function validV2(v2) {
  if (!v2 || typeof v2 !== 'object') return null;
  const out = freshV2();
  out.w = Number.isFinite(+v2.w) ? +v2.w : 100;
  const modeOk = v2.mode === 'detail' || v2.mode === 'anchor' ? v2.mode : null;
  // 앵커 Δbp 복원(레벨 % 는 저장 안 됨 → 없음)
  if (v2.anchors && typeof v2.anchors === 'object') {
    for (const dir of RATE_KEYS) {
      const a = v2.anchors[dir];
      if (a) out.anchors[dir] = {
        d3M: Number.isFinite(a.d3M) ? +a.d3M : null,     // null → null(+null=0 함정 회피)
        d3Y: Number.isFinite(a.d3Y) ? +a.d3Y : null,
      };
    }
  }
  // 24칸(상세 모드·구버전 저장). 앵커 모드 저장본엔 없을 수 있음 → fresh 유지 후 파생 재산출.
  if (v2.cells) {
    for (const dir of RATE_KEYS) {
      const arr = v2.cells[dir];
      if (Array.isArray(arr) && arr.length === RD_TENORS.length) {
        out.cells[dir] = arr.map(c => ({
          v: (c && Number.isFinite(+c.v)) ? +c.v : '',
          source: (c && c.source === 'user') ? 'user' : 'default',
        }));
      }
    }
  }
  // 구버전(모드 필드 없음): cells 가 있으면 상세 모드로 이관(기존 편집 보존), 없으면 앵커.
  out.mode = modeOk || (v2.cells ? 'detail' : 'anchor');
  return out;
}

// 저장 sectors 검증 → 정규화. custom 섹터만 확률 저장·복원, follow 섹터는 스프레드 축에서 파생(미저장).
//   레거시(모드 필드 없음): follow 로 이관(신규 기본 동작). 실패 시 null.
function validSectors(sec) {
  if (!sec || typeof sec !== 'object') return null;
  const out = freshSectors();
  for (const k of NONSHARED_SECTORS) {
    const o = sec[k];
    if (o && o.mode === 'custom' && SECTOR_DIRS.every(d => Number.isFinite(+o[d]))) {
      out[k] = { mode: 'custom', narrow: +o.narrow, flat: +o.flat, wide: +o.wide };
    } else {
      out[k] = { mode: 'follow', narrow: 33, flat: 34, wide: 33 };
    }
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
      out.mode = r.mode === 'detail' ? 'detail' : 'anchor';
      if (r.anchors) for (const dir of RATE_KEYS) {
        const a = r.anchors[dir];
        if (a) out.anchors[dir] = {
          d3M: Number.isFinite(a.d3M) ? +a.d3M : null,
          d3Y: Number.isFinite(a.d3Y) ? +a.d3Y : null,
        };
      }
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
// 앵커 모드(기본): 각 블록에 3M·3Y 착지금리(%) 2칸 + 자동 Δbp 병기. 24칸은 파생 표시(disabled).
// 상세 모드: 24칸 직접 편집(앵커 행 숨김). 표시 전환은 renderV2Ui 가 담당.
const V2_DIRLABEL = { down: '하락 ↓', flat: '보합 →', up: '상승 ↑' };
const ANCHOR_PTS = [{ key: '3M', dk: 'd3M', idx: IDX_3M }, { key: '3Y', dk: 'd3Y', idx: IDX_3Y }];
function buildV2Blocks() {
  $('rg-v2-blocks').innerHTML = RATE_KEYS.map(dir => `
    <div class="v2-block">
      <div class="v2-head">
        <span class="v2-title">${V2_DIRLABEL[dir]} 시나리오</span>
        <span class="v2-prob" id="rg-v2p-${dir}">P —</span>
        <span class="v2-src">9레짐 조건부 · 스프레드 확률 가중</span>
        <button class="btn sm v2-detail-reset" data-reset="${dir}" style="display:none">기본값 리셋</button>
      </div>
      <div class="v2-anchors" id="rg-v2anc-${dir}">
        ${ANCHOR_PTS.map(pt => `
          <div class="v2-anc-cell">
            <label>${pt.key} 착지금리(%)</label>
            <input type="number" step="0.001" inputmode="decimal" class="v2-anc-num" id="rg-anc-${dir}-${pt.key}" data-dir="${dir}" data-pt="${pt.key}" placeholder="—">
            <span class="v2-anc-delta" id="rg-ancd-${dir}-${pt.key}">Δ —</span>
          </div>`).join('')}
        <button class="btn sm v2-anc-reset" data-ancreset="${dir}">앵커 리셋</button>
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

// ── RG-3 섹터 보드 ──
function calibBandsObj() { return window.RG_CALIB && window.RG_CALIB.bands ? window.RG_CALIB.bands : null; }

// 섹터 6행(1회 생성). 회사채 행은 스프레드 축 공유(⇄ 표기). 입력=지속 요소, 출력(바·E[Δs])=갱신.
function buildSectorRowsDom() {
  $('rg-sec-rows').innerHTML = SECTORS.map((s, si) => {
    const cells = SECTOR_DIRS.map(dir => `
      <div class="sec-cell">
        <span class="sec-dir">${SECTOR_DIR_LABEL[dir]}</span>
        <input type="number" min="0" max="100" step="1" class="sec-num" id="rg-sec-${si}-${dir}" data-si="${si}" data-dir="${dir}">
        <input type="range" min="0" max="100" step="0.5" class="sec-range" id="rg-secs-${si}-${dir}" data-si="${si}" data-dir="${dir}">
      </div>`).join('');
    const nonShared = !s.share;
    return `<div class="sec-row" data-si="${si}">
      <div class="sec-head">
        <span class="sec-name">${s.key}${s.share ? ' <span class="sec-share">⇄</span>' : ''}</span>
        ${s.note ? `<span class="sec-note">${s.note}</span>` : ''}
        ${nonShared ? `<span class="sec-status" id="rg-sec-status-${si}"></span>` : ''}
        <span class="sec-band" id="rg-sec-band-${si}"></span>
        <span class="badge" id="rg-sec-sum-${si}">합계 —</span>
        ${nonShared ? `<button class="btn sm" id="rg-sec-reset-${si}" data-reset-si="${si}">RG-1 값으로 리셋</button>` : ''}
        <button class="btn sm" id="rg-sec-norm-${si}" data-si="${si}">정규화</button>
      </div>
      <div class="sec-inputs">${cells}</div>
      <div class="sec-outrow"><div class="sec-bar" id="rg-sec-bar-${si}"></div><span class="sec-eds" id="rg-sec-eds-${si}"></span></div>
    </div>`;
  }).join('');
}

// 입력 값 DOM 동기(포커스 칸 제외 → 커서 보존). 회사채 행은 state.spread 를 읽으므로 양방향 미러가 됨.
function writeSectorInputs() {
  const active = (typeof document !== 'undefined') ? document.activeElement : null;
  SECTORS.forEach((s, si) => {
    const probs = sectorProbs(s.key, state);
    SECTOR_DIRS.forEach(dir => {
      const num = $(`rg-sec-${si}-${dir}`), rng = $(`rg-secs-${si}-${dir}`);
      if (num && num !== active) num.value = probs[dir];
      if (rng && rng !== active) rng.value = Number.isFinite(+probs[dir]) ? +probs[dir] : 0;
    });
  });
}

function renderSecBar(si, probs) {
  const s = (+probs.narrow || 0) + (+probs.flat || 0) + (+probs.wide || 0);
  const pct = v => (s > 0 ? (v / s * 100) : 0);
  $(`rg-sec-bar-${si}`).innerHTML =
    `<span class="sb narrow" style="width:${pct(+probs.narrow || 0).toFixed(1)}%" title="축소 ${fmtP(pct(+probs.narrow || 0))}%"></span>`
    + `<span class="sb flat" style="width:${pct(+probs.flat || 0).toFixed(1)}%" title="보합 ${fmtP(pct(+probs.flat || 0))}%"></span>`
    + `<span class="sb wide" style="width:${pct(+probs.wide || 0).toFixed(1)}%" title="확대 ${fmtP(pct(+probs.wide || 0))}%"></span>`;
}

function renderSectorsDisplay() {
  const bands = calibBandsObj();
  SECTORS.forEach((s, si) => {
    const probs = sectorProbs(s.key, state);
    const st = probStatus([probs.narrow, probs.flat, probs.wide]);
    const nonShared = !s.share;
    const sec = nonShared ? state.sectors[s.key] : null;
    const isCustom = !!(sec && sec.mode === 'custom');
    setBadge(`rg-sec-sum-${si}`, st);
    // 비공유 섹터: follow=RG-1 따름(정규화 불요·리셋 비활성), custom=개별 조정(정규화·리셋 활성)
    const statusEl = $(`rg-sec-status-${si}`);
    if (statusEl) statusEl.innerHTML = isCustom
      ? '<span class="sec-mode custom">개별 조정</span>'
      : '<span class="sec-mode follow">RG-1 따름</span>';
    const rb = $(`rg-sec-reset-${si}`); if (rb) rb.disabled = !isCustom;
    const nb = $(`rg-sec-norm-${si}`);
    if (nb) {
      if (nonShared && !isCustom) { nb.style.display = 'none'; nb.disabled = true; }   // follow → 스프레드 축에서 정규화
      else { nb.style.display = ''; nb.disabled = !st.needNorm; }
    }
    const bandBp = sectorBandBp(s.key, bands);
    $(`rg-sec-band-${si}`).innerHTML = bandBp != null ? `밴드 ±${bandBp}bp` : '밴드 —';
    renderSecBar(si, probs);
    const eDs = expectedDs(probs, bandBp);
    // 축소(음수)=매력 → pos(초록), 확대(양수)=neg(빨강)
    $(`rg-sec-eds-${si}`).innerHTML = eDs == null ? 'E[Δs] —'
      : `E[Δs] <b class="${eDs < 0 ? 'pos' : eDs > 0 ? 'neg' : ''}">${fmtP(eDs)}bp</b>`;
  });
  renderMatrix();   // 섹터 E[Δs] 변경 → 매트릭스 즉시 갱신(순위표는 매트릭스로 대체됨)
}

function renderSectors() { writeSectorInputs(); renderSectorsDisplay(); }

// ── 섹터×구간 매력도 매트릭스 (RG-2 커브이동 × RG-3 스프레드) ──
const fmtPct3 = v => (Number.isFinite(v) ? v.toFixed(3) : '—');
// 매트릭스 섹터별 E[Δs](bp): 신용 5섹터는 자기 확률×밴드, 국고는 매트릭스가 0 처리.
function matrixEDsBySector() {
  const bands = calibBandsObj();
  const out = {};
  for (const key of ['공사채', '은행채', '회사채', '카드채', '여전채']) out[key] = expectedDs(sectorProbs(key, state), sectorBandBp(key, bands));
  return out;
}
// 매트릭스 계산(순수 조합): 국고 커브(세션) + 스프레드(bp) + 혼합 E[Δy] + 섹터 E[Δs]. 커브 미완 → null.
function computeMatrix() {
  if (!curveComplete(curveY)) return null;
  const mc = medianCurves();
  const parallel = expectedDyParallel(rateArr(), spreadArr(), mc);
  const byTenor = expectedDyByTenor(rateArr(), sceneCurves());
  const mixed = mixEDy(parallel, byTenor, wFrac());                 // RG-2 와 동일 소스(w 혼합)
  const eDy = (Array.isArray(mixed) && mixed.length === RD_TENORS.length) ? mixed : new Array(RD_TENORS.length).fill(0);
  return matrixReturns(curveY, state.matrix.spreads, eDy, matrixEDsBySector());
}
// 스프레드 입력 6칸(1회 생성). 국고=0 disabled.
function buildMatrixSpreads() {
  if (!$('rg-mtx-spreads')) return;
  $('rg-mtx-spreads').innerHTML = MATRIX_SECTORS.map((s, i) => {
    const isKtb = s === '국고채';
    return `<div class="mtx-scell"><label>${s}</label>
      <input type="number" step="0.1" inputmode="decimal" id="rg-mtx-sp-${i}" data-mtxsec="${s}" ${isKtb ? 'disabled value="0"' : ''}></div>`;
  }).join('');
}
function writeMatrixSpreads() {
  const active = (typeof document !== 'undefined') ? document.activeElement : null;
  MATRIX_SECTORS.forEach((s, i) => {
    const el = $(`rg-mtx-sp-${i}`); if (!el) return;
    if (s === '국고채') { el.value = 0; return; }
    if (el !== active) el.value = Number.isFinite(+state.matrix.spreads[s]) ? state.matrix.spreads[s] : '';
  });
  const b = $('rg-mtx-basis');
  if (b) b.textContent = state.matrix.basisDate ? `기본값 기준일 ${state.matrix.basisDate} · credit-spread.js` : '';
}
function renderMtxTable(id, m, field, kind) {
  const data = m[field];
  const head = `<thead><tr><th class="l">섹터＼구간</th>${m.tenors.map(t => `<th>${t}</th>`).join('')}</tr></thead>`;
  const body = m.sectors.map(s => {
    const best = m.bestTenorBySector[s];
    const cells = m.tenors.map((t, k) => {
      const v = data[s][k];
      let cls = '';
      if (kind === 'bp') {
        cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
        if (t === best) cls += ' best';
        if (m.topCell && m.topCell.sector === s && m.topCell.tenor === t) cls += ' topcell';
      }
      return `<td class="${cls.trim()}">${kind === 'pct' ? fmtPct3(v) : fmtP(round1(v))}</td>`;
    }).join('');
    return `<tr class="${s === '국고채' ? 'ktb' : ''}"><td class="sec">${s}</td>${cells}</tr>`;
  }).join('');
  $(id).innerHTML = head + `<tbody>${body}</tbody>`;
}
function renderMatrix() {
  if (!$('rg-mtx-attract')) return;
  writeMatrixSpreads();
  const m = computeMatrix();
  if (!m) {
    $('rg-mtx-now').innerHTML = '';
    $('rg-mtx-land').innerHTML = '';
    $('rg-mtx-attract').innerHTML = '<tbody><tr><td class="mtx-empty">위 RG-2의 국고 커브 8구간을 입력하면 섹터×구간 매트릭스가 계산됩니다. (수익률 레벨은 세션 전용 · 저장 안 함)</td></tr></tbody>';
    return;
  }
  renderMtxTable('rg-mtx-now', m, 'nowPct', 'pct');
  renderMtxTable('rg-mtx-land', m, 'landingPct', 'pct');
  renderMtxTable('rg-mtx-attract', m, 'returnsBp', 'bp');
  const note = $('rg-mtx-note');
  if (note && m.topCell) {
    const tc = m.topCell;
    note.dataset.top = `${tc.sector} ${tc.tenor} ${round1(tc.bp)}bp`;
  }
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

  refreshConfirmGate();       // 금리·스프레드 축 + 6섹터 합계 OK 여야 확정
  renderRolldown();           // RG-1 확률 변경 → 커브이동 성분 실시간 갱신
  renderSectors();            // 회사채 행 = 스프레드 축 미러 → 즉시 갱신
  save();
}

// 확정 가능 = 금리·스프레드 축 정규화 + custom 섹터만 개별 합계 100%.
//   follow 섹터는 스프레드 축을 상속하므로 sSt.ok 로 자동 충족(별도 정규화 불요).
function allSectorsOk() {
  return NONSHARED_SECTORS.every(k => {
    const sec = state.sectors[k];
    if (!sec || sec.mode !== 'custom') return true;
    return probStatus([sec.narrow, sec.flat, sec.wide]).ok;
  });
}
function refreshConfirmGate() {
  const rSt = probStatus(rateArr()), sSt = probStatus(spreadArr());
  const ok = rSt.ok && sSt.ok && allSectorsOk();
  $('rg-confirm').disabled = !ok;
  $('rg-confirm-hint').textContent = ok
    ? '금리·스프레드 축 + 개별 조정 섹터 합계 100% — 확정 가능.'
    : '금리·스프레드 축과 개별 조정(custom) 섹터가 각각 합계 100%가 되어야 확정할 수 있습니다(정규화 버튼).';
}

// ── RG-2: 커브이동 E[Δy](평행 v1 + 시나리오 v2 혼합) + 3성분 분해 막대 + 순위 ──
function medianCurves() { const c = window.RG_CALIB; return c && c.medianCurves ? c.medianCurves : null; }
function rateArr() { return RATE_KEYS.map(k => state.rate[k]); }
function spreadArr() { return SPREAD_KEYS.map(k => state.spread[k]); }
function wFrac() { const w = +state.v2.w; return (Number.isFinite(w) ? w : 100) / 100; }
function sceneCurves() { const o = {}; for (const d of RATE_KEYS) o[d] = state.v2.cells[d].map(c => (Number.isFinite(+c.v) ? +c.v : 0)); return o; }

// 현재 국고 커브의 구간 레벨(%) — 앵커 착지금리↔Δbp 환산 기준(세션 전용). 미입력 → null.
function curveLevelAt(idx) {
  const raw = curveY[idx];
  if (raw === '' || raw == null) return null;
  const v = +raw;
  return Number.isFinite(v) ? v : null;
}
const fmtSigned = v => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(1) : '—');

// 미설정(null) 앵커를 현재 조건부 기본커브의 3M·3Y 값으로 seed(최초 1회·리셋 후). 이미 값 있으면 유지(고정).
function seedAnchors() {
  if (!lastV2Defaults) return;
  for (const dir of RATE_KEYS) {
    const a = state.v2.anchors[dir];
    if (!Number.isFinite(a.d3M)) a.d3M = round1(lastV2Defaults[dir][IDX_3M]);   // null(+null=0 함정 회피) → seed
    if (!Number.isFinite(a.d3Y)) a.d3Y = round1(lastV2Defaults[dir][IDX_3Y]);
  }
}

// v2 모델 재산출: 1층 기본커브 갱신 → 모드별로 24칸(state.v2.cells) 채움(계산 경로 입력).
//   detail: source='default' 칸만 기본값 갱신(user 칸 유지) — 기존 동작 그대로.
//   anchor: 시나리오별 anchorFitCurve(anchors, shape) 로 8구간 전부 파생(앵커 2점 정확 일치).
function refreshV2Model() {
  lastV2Defaults = conditionalDefaultCurves(normalized(spreadArr()), medianCurves());
  seedAnchors();
  v2Method = {};
  if (state.v2.mode === 'detail') {
    for (const dir of RATE_KEYS) for (let k = 0; k < RD_TENORS.length; k++) {
      const cell = state.v2.cells[dir][k];
      if (cell.source === 'default') cell.v = lastV2Defaults ? round1(lastV2Defaults[dir][k]) : '';
    }
    return;
  }
  for (const dir of RATE_KEYS) {
    const shape = lastV2Defaults ? lastV2Defaults[dir] : null;
    const fit = anchorFitCurve(state.v2.anchors[dir], shape);
    if (fit) v2Method[dir] = fit.method;
    for (let k = 0; k < RD_TENORS.length; k++) {
      const cell = state.v2.cells[dir][k];
      cell.source = 'default';
      cell.v = fit ? round1(fit.curve[k]) : (shape ? round1(shape[k]) : '');
    }
  }
}
function dotTitle(dir, k) {
  const d = lastV2Defaults ? round1(lastV2Defaults[dir][k]) : null;
  const v = state.v2.cells[dir][k].v;
  return d == null ? '내 전망(user)' : `기본값 ${fmtP(d)} → 내전망 ${fmtP(+v)} (Δ ${fmtP(+v - d)})bp`;
}

// v2 DOM 동기(모드 반영): 24칸 값/disabled/dot + 앵커 착지금리·Δ + 모드 토글·보정방식 안내.
// 값은 포커스 칸 제외 기록(커서 보존).
function renderV2Ui() {
  const active = (typeof document !== 'undefined') ? document.activeElement : null;
  const isDetail = state.v2.mode === 'detail';
  const lvl = { '3M': curveLevelAt(IDX_3M), '3Y': curveLevelAt(IDX_3Y) };
  const curveHasAnchors = lvl['3M'] != null && lvl['3Y'] != null;

  // 24칸(파생/편집): 앵커 모드는 disabled 읽기전용, dot 은 상세 모드 user 칸만
  for (const dir of RATE_KEYS) for (let k = 0; k < RD_TENORS.length; k++) {
    const cell = state.v2.cells[dir][k];
    const num = $(`rg-v2-${dir}-${k}`), rng = $(`rg-v2s-${dir}-${k}`), dot = $(`rg-v2dot-${dir}-${k}`);
    if (num) { if (num !== active) num.value = cell.v; num.disabled = !isDetail; }
    if (rng) { if (rng !== active) rng.value = Number.isFinite(+cell.v) ? +cell.v : 0; rng.disabled = !isDetail; }
    if (dot) {
      const show = isDetail && cell.source === 'user';
      dot.style.display = show ? '' : 'none';
      dot.title = show ? dotTitle(dir, k) : '';
    }
  }

  // 앵커 행 + 상세 리셋 버튼 표시 전환
  for (const dir of RATE_KEYS) {
    const ancWrap = $(`rg-v2anc-${dir}`);
    if (ancWrap) ancWrap.style.display = isDetail ? 'none' : '';
    const detReset = document.querySelector(`.v2-detail-reset[data-reset="${dir}"]`);
    if (detReset) detReset.style.display = isDetail ? '' : 'none';
    for (const pt of ANCHOR_PTS) {
      const num = $(`rg-anc-${dir}-${pt.key}`), badge = $(`rg-ancd-${dir}-${pt.key}`);
      const d = state.v2.anchors[dir][pt.dk];
      if (badge) badge.textContent = Number.isFinite(d) ? `Δ ${fmtSigned(d)}bp` : 'Δ —';
      if (num) {
        num.disabled = isDetail || !curveHasAnchors;                       // 현재커브 없으면 착지금리 입력 비활성
        if (num !== active) num.value = (curveHasAnchors && Number.isFinite(d)) ? (lvl[pt.key] + d / 100).toFixed(3) : '';
        num.placeholder = curveHasAnchors ? '—' : '현재 커브 필요';
      }
    }
  }

  // 보정 방식·안내
  const methodEl = $('rg-v2-method');
  if (methodEl) {
    if (isDetail) methodEl.textContent = '상세 모드 — 24칸 직접 편집 (앵커 무시)';
    else if (!curveHasAnchors) methodEl.innerHTML = '<span class="warn-text">착지금리 입력은 위 국고 커브의 3M·3Y 입력 후 가능합니다.</span> 기본 앵커 Δ로 파생 커브 표시 중.';
    else {
      const fb = RATE_KEYS.filter(dir => v2Method[dir] === 'linear');
      methodEl.textContent = fb.length
        ? `앵커 보정 affine — 일부 선형 폴백(${fb.map(dir => RATE_LABEL[dir]).join('·')}: 기본커브 3M=3Y)`
        : '앵커 보정 affine — 기본커브 모양 보존, 3M·3Y 앵커 정확 일치';
    }
  }
  const detToggle = $('rg-v2-detail');
  if (detToggle) detToggle.checked = isDetail;
}
function renderV2ProbMirror() {
  const rN = normalized(rateArr());
  RATE_KEYS.forEach((k, i) => { const el = $(`rg-v2p-${k}`); if (el) el.textContent = `P(${RATE_LABEL[k]}) ${fmtP(rN[i])}%`; });
}

function renderRolldown() {
  if (!$('rg-rd-bars')) return;
  const mc = medianCurves();

  // v2 모델(앵커 파생/기본값) 실시간 갱신 + DOM 동기 + 확률 미러
  refreshV2Model();
  renderV2Ui();
  renderV2ProbMirror();
  renderMatrix();   // 커브·w·v2·확률 변경 시 섹터×구간 매트릭스 즉시 갱신(checklist ④)

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
    judgeDate: state.date,      // 판단일 → 만기(判+1개월)·D-day 계산(RG-4)
    probs: { rate: rateObj, spread: spreadObj },
    mode: { cell: m.key, name: PHASES[m.key].name, p: round1(m.p), top2: round1(top2Sum(cells)) },
    baseline: { bandKtb3yBp: b.ktb3y, bandRepSpreadBp: b.repSpread, calib: b.period },
    confirmedAt: new Date().toISOString(),
  };
  // RG-3 섹터: 6섹터 전부 정규화 확률 기록(재현성) + mode 플래그.
  //   shared-rate(국고)·shared-spread(회사)=RG-1 축 공유, follow=스프레드 상속, custom=개별 조정.
  const bands = calibBandsObj();
  rec.sectors = {};
  for (const s of SECTORS) {
    const p = sectorProbs(s.key, state);
    const arr = normalizeInPlace([p.narrow, p.flat, p.wide]);
    const nobj = { narrow: arr[0], flat: arr[1], wide: arr[2] };
    const mode = s.share === 'rate' ? 'shared-rate'
      : s.share === 'spread' ? 'shared-spread'
      : (state.sectors[s.key] && state.sectors[s.key].mode === 'custom') ? 'custom' : 'follow';
    rec.sectors[s.key] = { probs: nobj, mode, eDsBp: round1(expectedDs(nobj, sectorBandBp(s.key, bands))), shared: s.share ? true : undefined, sharedWith: s.share || undefined };
  }

  // RG-2 v2 파생값(mode + 앵커 Δbp 6 + 24칸 Δbp + 소스 + w) — 재현 가능하게 앵커·커브 둘 다 기록.
  //   커브 원본(레벨 %)은 미포함(§0.3). 앵커도 Δbp(레벨 아님).
  const curves = {}, sources = {}, anchors = {};
  for (const dir of RATE_KEYS) {
    curves[dir] = state.v2.cells[dir].map(c => (Number.isFinite(+c.v) ? round1(+c.v) : null));
    sources[dir] = state.v2.cells[dir].map(c => c.source);
    const a = state.v2.anchors[dir];
    anchors[dir] = { d3M: Number.isFinite(a.d3M) ? round1(+a.d3M) : null, d3Y: Number.isFinite(a.d3Y) ? round1(+a.d3Y) : null };
  }
  rec.rg2v2 = { mode: state.v2.mode, anchors, curves, sources, w: state.v2.w };

  // RG-2 헤드라인(혼합 기준 최상위 구간). 커브(레벨) 미완이면 생략.
  const parallel = expectedDyParallel(rateN, spreadN, medianCurves());
  const byTenor = expectedDyByTenor(rateN, sceneCurves());
  const mixed = mixEDy(parallel, byTenor, wFrac());
  if (curveComplete(curveY)) {
    const { rows, top } = rolldownTable(curveY, mixed);
    const version = state.v2.w === 100 ? 'v1-parallel' : state.v2.w === 0 ? 'v2-scenario' : 'mixed';
    // carryRollBp(구간별 캐리+롤다운, 파생 bp·레벨 아님) → RG-4 실현 순위 재계산용
    rec.rg2 = {
      version, topTenor: top ? top.tenor : null, topReturnBp: top ? top.total : null,
      w: state.v2.w, eDy3YBp: mixed ? round1(mixed[TENOR3Y]) : null,
      carryRollBp: rows.map(r => round1(r.carry + r.rolldown)),
    };
  }

  // RG 매트릭스(섹터×구간 총 기대수익). 전부 파생 bp — 수익률 레벨(%)은 미포함(§0.3). 커브 미완이면 생략.
  const matrix = computeMatrix();
  if (matrix) {
    const returnsBp = {}, carryRollBp = {}, spreadsUsed = {};
    for (const s of MATRIX_SECTORS) {
      returnsBp[s] = matrix.returnsBp[s].map(round1);
      carryRollBp[s] = matrix.carryRollBp[s].map(round1);
      spreadsUsed[s] = s === '국고채' ? 0 : (Number.isFinite(+state.matrix.spreads[s]) ? round1(+state.matrix.spreads[s]) : null);
    }
    rec.matrix = {
      returnsBp, carryRollBp,
      topCell: { sector: matrix.topCell.sector, tenor: matrix.topCell.tenor, bp: round1(matrix.topCell.bp) },
      spreadsUsed, basisDate: state.matrix.basisDate || null,
    };
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

// ── RG-4 채점 원장 ──
const CREDIT_SECTORS = ['공사채', '은행채', '카드채', '여전채'];  // 비공유 신용섹터(국고=rate·회사=spread 제외)
// 로컬(실행 TZ=KST) 오늘 YYYY-MM-DD. toISOString()은 UTC라 자정~09시에 하루 밀림 → 로컬 필드 조립.
function localTodayISO() {
  try { const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; } catch { return null; }
}
function todayISO() { return localTodayISO(); }
function ledger() { return window.RG_LEDGER || { judgments: {}, scores: {} }; }

// 미결 창: judgments 중 scores 없는 주차. 만기(判+1M)·D-day, 만기순 정렬.
function pendingList() {
  const L = ledger(), j = L.judgments || {}, sc = L.scores || {}, t = todayISO();
  return Object.keys(j).filter(w => !sc[w]).map(w => {
    const rec = j[w], mat = maturityOf(rec.judgeDate), dd = mat ? ddayTo(mat, t) : null;
    return { week: w, judgeDate: rec.judgeDate || null, maturity: mat, dday: dd, mature: dd != null && dd <= 0 };
  }).sort((a, b) => String(a.maturity).localeCompare(String(b.maturity)));
}

function renderPending() {
  if (!$('rg-pending')) return;
  const items = pendingList();
  $('rg-pending').innerHTML = items.length
    ? items.map(p => `<div class="pend ${p.mature ? 'mature' : ''}">
        <span class="pend-wk">${p.week}</span>
        <span class="pend-meta">판단 ${p.judgeDate || '—'} · 만기 ${p.maturity || '—'}</span>
        <span class="pend-dd">${p.dday == null ? '' : p.mature ? '만기 도래' : `D−${p.dday}`}</span>
      </div>`).join('')
    : '<div class="empty">미결 창이 없습니다. RG-1에서 주간 판단을 확정하면 여기 쌓입니다.</div>';
  // 채점 대상 = 만기 도래 & 미채점
  const sel = $('rg-score-select');
  const mature = items.filter(p => p.mature);
  sel.innerHTML = '<option value="">— 만기 도래 창 선택 —</option>' +
    mature.map(p => `<option value="${p.week}">${p.week} (만기 ${p.maturity})</option>`).join('');
  $('rg-score-hint').textContent = mature.length ? `채점 가능 ${mature.length}건.` : '만기 도래한 창이 없습니다.';
}

// 실현값 입력 그리드(1회 생성). 전부 파생 Δbp — 커브 레벨 원본은 받지 않는다(§0.3).
function buildScoreInputs() {
  const cell = (id, label) => `<label class="sc-cell">${label}<input type="number" step="0.1" id="${id}"></label>`;
  $('rg-score-inputs').innerHTML =
    `<div class="sc-grid">
       ${cell('rg-r-ktb3y', '국고3Y Δbp')}${cell('rg-r-repspread', '대표 스프레드 Δbp')}
       ${CREDIT_SECTORS.map((k, i) => cell(`rg-r-sec-${i}`, `${k} Δbp`)).join('')}
     </div>
     <div class="sc-label">실현 커브 8구간 Δbp (RG-2 순위 채점용)</div>
     <div class="sc-grid sc-grid-8">${RD_TENORS.map((t, i) => cell(`rg-r-cv-${i}`, t)).join('')}</div>`;
}
function readRealized() {
  const num = id => { const v = +($(id) && $(id).value); return Number.isFinite(v) ? v : 0; };
  return {
    ktb3yDeltaBp: num('rg-r-ktb3y'), repSpreadDeltaBp: num('rg-r-repspread'),
    sectorsDeltaBp: Object.fromEntries(CREDIT_SECTORS.map((k, i) => [k, num(`rg-r-sec-${i}`)])),
    curveDeltaBp: RD_TENORS.map((_, i) => num(`rg-r-cv-${i}`)),
  };
}
function yn(b) { return b ? '<b class="pos">적중</b>' : '<b class="neg">미적중</b>'; }
function onScore() {
  const week = $('rg-score-select').value;
  if (!week) { scoreStatus('만기 도래 창을 선택하세요.', 'bad'); return; }
  const j = ledger().judgments[week];
  if (!j) { scoreStatus('판단 레코드를 찾을 수 없습니다.', 'bad'); return; }
  const realized = readRealized();
  const metrics = scoreJudgment(j, realized, window.RG_CALIB && window.RG_CALIB.bands);
  const sec = metrics.brier.sectors;
  const rg2 = metrics.rg2Rank;
  const mr = metrics.matrixRank;
  $('rg-score-result').innerHTML = `<div class="sc-res">
    <div>실현 셀 <b>${metrics.realized.cell || '—'}</b> · 최빈 셀 ${yn(metrics.modalHit)}</div>
    <div>축 적중 — 금리 ${yn(metrics.axisHit.rate)} · 스프레드 ${yn(metrics.axisHit.spread)}</div>
    <div>Brier 9셀 <b>${fmtP(metrics.brier.cells9)}</b> · 섹터 신용평균 <b>${fmtP(sec.creditAvg)}</b> (6섹터평균 ${fmtP(sec.allAvg)})</div>
    <div>RG-2 순위 — ${rg2 ? `선택 ${rg2.picked} · 실현최고 ${rg2.realizedTop1} · top1 ${yn(rg2.hitTop1)} / top2 ${yn(rg2.hitTop2)}` : '판단 레코드에 rg2 없음(커브 미입력)'}</div>
    <div>매트릭스 순위 — ${mr ? `선택 ${mr.picked.sector} ${mr.picked.tenor} · 실현최고 ${mr.realizedTop1.sector} ${mr.realizedTop1.tenor} · top1 ${yn(mr.hitTop1)} / top3 ${yn(mr.hitTop3)}` : '판단 레코드에 matrix 없음(커브 미입력)'}</div>
  </div>`;
  const payload = { realized, metrics, scoredAt: new Date().toISOString() };
  $('rg-score-snippet').value = `window.RG_LEDGER.scores[${JSON.stringify(week)}] = ${JSON.stringify(payload, null, 2)};\n`;
  $('rg-score-snippet-wrap').style.display = '';
  scoreStatus(`${week} 채점 완료 — 스니펫을 data/rg-ledger.js 에 붙여넣고 커밋하세요.`, 'ok');
}
function scoreStatus(msg, kind) { const s = $('rg-score-status'); if (s) { s.textContent = msg; s.className = 'status ' + (kind || ''); } }
async function copyScoreSnippet() {
  const txt = $('rg-score-snippet').value; if (!txt) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); scoreStatus('복사됨 — data/rg-ledger.js 에 붙여넣기.', 'ok'); }
    else throw new Error('no clipboard');
  } catch {
    const ta = $('rg-score-snippet'); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    scoreStatus(ok ? '복사됨(폴백).' : '복사 실패 — 수동 복사.', ok ? 'ok' : 'bad');
  }
}

// 누적 대시보드: scores 기반. 2건 미만이면 표본 부족.
function renderDashboard() {
  if (!$('rg-dashboard')) return;
  const sc = ledger().scores || {};
  const weeks = Object.keys(sc).sort();
  if (weeks.length < 2) {
    $('rg-dashboard').innerHTML = `<div class="empty">표본 부족 — 채점 ${weeks.length}건(2건 이상 필요). 만기 도래 창을 채점해 원장에 쌓으세요.</div>`;
    return;
  }
  const rows = weeks.map(w => ({ w, m: sc[w].metrics }));
  const rate = a => (a.length ? a.filter(Boolean).length / a.length : null);
  const mean = a => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : null; };
  const modalR = rate(rows.map(r => r.m.modalHit));
  const rateR = rate(rows.map(r => r.m.axisHit.rate));
  const spreadR = rate(rows.map(r => r.m.axisHit.spread));
  const b9 = mean(rows.map(r => r.m.brier.cells9));
  const bSec = mean(rows.map(r => r.m.brier.sectors.creditAvg));
  const pct = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
  // 주차별 표(최근 → 과거) + Brier 미니바
  const maxB = Math.max(0.001, ...rows.map(r => r.m.brier.cells9).filter(Number.isFinite));
  const perWeek = rows.slice().reverse().map(r => {
    const b = r.m.brier.cells9;
    return `<tr><td class="l">${r.w}</td><td>${r.m.modalHit ? '✓' : '·'}</td>
      <td>${r.m.axisHit.rate ? '✓' : '·'}/${r.m.axisHit.spread ? '✓' : '·'}</td>
      <td>${fmtP(b)}</td>
      <td><span class="db-bar"><span style="width:${(b / maxB * 100).toFixed(0)}%"></span></span></td>
      <td>${r.m.rg2Rank ? (r.m.rg2Rank.hitTop1 ? 'top1' : r.m.rg2Rank.hitTop2 ? 'top2' : '—') : '—'}</td></tr>`;
  }).join('');
  // 섹터별 평균 Brier
  const secKeys = ['국고채', '공사채', '은행채', '회사채', '카드채', '여전채'];
  const secAvg = secKeys.map(k => ({ k, v: mean(rows.map(r => r.m.brier.sectors.perSector[k] && r.m.brier.sectors.perSector[k].brier)) }));

  $('rg-dashboard').innerHTML = `
    <div class="db-cards">
      <div class="db-card"><div class="db-l">최빈 셀 적중률</div><div class="db-m">${pct(modalR)}</div></div>
      <div class="db-card"><div class="db-l">금리 축 적중률</div><div class="db-m">${pct(rateR)}</div></div>
      <div class="db-card"><div class="db-l">스프레드 축 적중률</div><div class="db-m">${pct(spreadR)}</div></div>
      <div class="db-card"><div class="db-l">Brier 9셀 평균</div><div class="db-m">${fmtP(b9)}</div></div>
      <div class="db-card"><div class="db-l">섹터 Brier(신용) 평균</div><div class="db-m">${fmtP(bSec)}</div></div>
      <div class="db-card"><div class="db-l">채점 표본</div><div class="db-m">${weeks.length}</div></div>
    </div>
    <div class="sc-label" style="margin-top:14px">주차별 (Brier 낮을수록 정확)</div>
    <div style="overflow-x:auto"><table class="out-tbl"><thead><tr><th class="l">주차</th><th>최빈</th><th>금리/스프레드</th><th>Brier9</th><th>추이</th><th>RG-2</th></tr></thead><tbody>${perWeek}</tbody></table></div>
    <div class="sc-label" style="margin-top:14px">섹터별 평균 Brier <span style="color:var(--muted);font-weight:400">(국고=금리축·회사=스프레드축 공유 — 신용 4섹터가 독립 신호)</span></div>
    <div style="overflow-x:auto"><table class="out-tbl"><thead><tr>${secKeys.map(k => `<th>${k}</th>`).join('')}</tr></thead>
      <tbody><tr>${secAvg.map(s => `<td>${fmtP(s.v)}</td>`).join('')}</tr></tbody></table></div>`;
}

// ── 초기화 ──
export function initRg() {
  if (!$('rg-heatmap')) return;
  load();
  if (!state.date) state.date = localTodayISO() || ''; // 판단일 초기값 = 로컬 오늘 (1회)

  // 입력 셀 1회 생성 후 값 주입
  $('rg-rate-inputs').innerHTML = buildInputs('rate', RATE_KEYS, RATE_LABEL);
  $('rg-spread-inputs').innerHTML = buildInputs('spread', SPREAD_KEYS, SPREAD_LABEL);
  buildCurveInputs();
  buildV2Blocks();
  buildSectorRowsDom();
  buildMatrixSpreads();
  buildScoreInputs();
  const dateEl = $('rg-date'); if (dateEl) dateEl.value = state.date;
  const wEl = $('rg-w'); if (wEl) { wEl.value = state.v2.w; const wv = $('rg-w-val'); if (wv) wv.textContent = state.v2.w + '%'; }
  writeInputs();

  renderGuide();
  renderPlaybook();
  renderOutputs();      // renderRolldown 포함
  renderConfirmed();
  renderPending();      // RG-4 미결 창 + 채점 대상
  renderDashboard();    // RG-4 누적 대시보드

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

  // 커브(레벨) 입력(세션 전용, 비저장) — 경계에서 number 강제(빈칸은 '' 유지), 저장하지 않음
  $('rg-curve-inputs').addEventListener('input', (e) => {
    const el = e.target.closest('[data-idx]'); if (!el) return;
    curveY[+el.dataset.idx] = curveCell(el.value);   // 순수 함수에 number 만 전달(문자열 concat 버그 방지)
    renderRolldown();
  });

  // 매트릭스 섹터 스프레드(bp) 입력 — 국고 제외 6칸. 스프레드 레벨(bp)은 저장 가능(공개 파생 데이터).
  if ($('rg-mtx-spreads')) $('rg-mtx-spreads').addEventListener('input', (e) => {
    const el = e.target.closest('[data-mtxsec]'); if (!el) return;
    const secKey = el.dataset.mtxsec; if (secKey === '국고채') return;
    const v = +el.value;
    state.matrix.spreads[secKey] = Number.isFinite(v) ? v : null;
    renderMatrix(); save();
  });

  // v2 입력: 앵커 착지금리(%) 또는 24칸(상세 모드) — 위임 분기.
  $('rg-v2-blocks').addEventListener('input', (e) => {
    // (1) 앵커 착지금리(%) → Δbp 환산·저장. 현재 커브 없으면 무시(입력도 비활성).
    const anc = e.target.closest('[data-dir][data-pt]');
    if (anc) {
      if (state.v2.mode !== 'anchor') return;
      const dir = anc.dataset.dir, ptKey = anc.dataset.pt;
      const idx = ptKey === '3M' ? IDX_3M : IDX_3Y, dk = ptKey === '3M' ? 'd3M' : 'd3Y';
      const lvl = curveLevelAt(idx);
      if (lvl == null) return;                       // 현재 커브 미입력 → 환산 불가
      const landing = +anc.value;
      if (Number.isFinite(landing)) state.v2.anchors[dir][dk] = round1((landing - lvl) * 100);
      renderRolldown(); save();
      return;
    }
    // (2) 24칸 직접 편집 — 상세 모드에서만(앵커 모드는 disabled)
    const el = e.target.closest('[data-dir][data-k]'); if (!el) return;
    if (state.v2.mode !== 'detail') return;
    const dir = el.dataset.dir, k = +el.dataset.k;
    let v = +el.value; if (!Number.isFinite(v)) v = 0; v = Math.max(-60, Math.min(60, v));
    const cell = state.v2.cells[dir][k];
    cell.v = v; cell.source = 'user'; v2DetailDirty = true;
    const num = $(`rg-v2-${dir}-${k}`), rng = $(`rg-v2s-${dir}-${k}`);
    if (el === rng && num) num.value = v; else if (el === num && rng) rng.value = v;
    renderRolldown(); save();
  });
  // 리셋 버튼 위임: 앵커 리셋(기본커브 3M·3Y로 재seed) | 상세 기본값 리셋(해당 시나리오 24칸 default)
  $('rg-v2-blocks').addEventListener('click', (e) => {
    const ar = e.target.closest('[data-ancreset]');
    if (ar) {
      const dir = ar.dataset.ancreset;
      state.v2.anchors[dir] = { d3M: null, d3Y: null };   // → refreshV2Model 이 기본커브에서 재seed
      renderRolldown(); save();
      return;
    }
    const b = e.target.closest('[data-reset]');
    if (b) {
      const dir = b.dataset.reset;
      state.v2.cells[dir].forEach(c => { c.source = 'default'; });
      renderRolldown(); save();
    }
  });
  // 상세 모드 토글 — 앵커↔상세 전환(앵커→상세: 파생 24칸을 편집 시작값으로 동결 / 상세→앵커: 수정 소실 경고)
  const detToggle = $('rg-v2-detail');
  if (detToggle) detToggle.addEventListener('change', () => {
    if (detToggle.checked) {
      state.v2.mode = 'detail';
      // 현재 파생값을 편집 시작값으로: 기본커브와 다른 칸은 user 로 동결(기본값 갱신에 덮이지 않도록)
      for (const dir of RATE_KEYS) for (let k = 0; k < RD_TENORS.length; k++) {
        const cell = state.v2.cells[dir][k];
        const dv = lastV2Defaults ? round1(lastV2Defaults[dir][k]) : null;
        cell.source = (Number.isFinite(+cell.v) && (dv == null || Math.abs(+cell.v - dv) > 1e-9)) ? 'user' : 'default';
      }
      v2DetailDirty = false;
      renderRolldown(); save();
    } else {
      if (v2DetailDirty && !confirm('상세 모드에서 수정한 24칸이 앵커 파생값으로 대체됩니다. 계속할까요?')) {
        detToggle.checked = true;   // 되돌림
        return;
      }
      state.v2.mode = 'anchor';
      v2DetailDirty = false;
      renderRolldown(); save();
    }
  });
  // 전체 리셋 — 모드별: 앵커 전부 재seed | 상세 24칸 전부 기본값
  const resetAll = $('rg-v2-reset-all');
  if (resetAll) resetAll.addEventListener('click', () => {
    if (state.v2.mode === 'detail') {
      for (const dir of RATE_KEYS) state.v2.cells[dir].forEach(c => { c.source = 'default'; });
      v2DetailDirty = false;
    } else {
      for (const dir of RATE_KEYS) state.v2.anchors[dir] = { d3M: null, d3Y: null };
    }
    renderRolldown(); save();
  });
  // 혼합 w 슬라이더(0~100%) — 작업본 저장
  if (wEl) wEl.addEventListener('input', () => {
    let w = +wEl.value; if (!Number.isFinite(w)) w = 100; state.v2.w = Math.max(0, Math.min(100, w));
    const wv = $('rg-w-val'); if (wv) wv.textContent = state.v2.w + '%';
    renderRolldown(); save();
  });

  // RG-3 섹터 입력(숫자↔슬라이더 동기). 공유 섹터(국고→금리축, 회사→스프레드축) → RG-1/RG-2 전체 재계산.
  $('rg-sec-rows').addEventListener('input', (e) => {
    const el = e.target.closest('[data-si][data-dir]'); if (!el) return;
    const si = +el.dataset.si, dir = el.dataset.dir, s = SECTORS[si];
    let v = +el.value; if (!Number.isFinite(v)) v = 0; v = Math.max(0, Math.min(100, v));
    setSectorProb(s.key, dir, v, state);                      // 공유면 state.rate/spread, 아니면 state.sectors
    const num = $(`rg-sec-${si}-${dir}`), rng = $(`rg-secs-${si}-${dir}`);
    if (el === rng && num) num.value = v; else if (el === num && rng) rng.value = v;
    if (s.share) { writeInputs(); renderOutputs(); }          // ⇄ RG-1 축 동기 + 히트맵·커브이동 갱신
    else { renderSectors(); refreshConfirmGate(); save(); }
  });
  // 섹터 버튼 위임: "RG-1 값으로 리셋"(follow 복귀) | 정규화
  $('rg-sec-rows').addEventListener('click', (e) => {
    const rb = e.target.closest('[data-reset-si]');
    if (rb) {
      const s = SECTORS[+rb.dataset.resetSi];
      if (state.sectors[s.key]) state.sectors[s.key].mode = 'follow';   // 스프레드 축 상속 복귀
      renderSectors(); refreshConfirmGate(); save();
      return;
    }
    const b = e.target.closest('button[data-si]'); if (!b) return;
    const si = +b.dataset.si, s = SECTORS[si];
    const p = sectorProbs(s.key, state);
    const out = normalizeInPlace([p.narrow, p.flat, p.wide]);
    SECTOR_DIRS.forEach((dir, i) => { setSectorProb(s.key, dir, out[i], state); });
    if (s.share) { writeInputs(); renderOutputs(); }
    else { writeSectorInputs(); renderSectors(); refreshConfirmGate(); save(); }
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

  // 판단일 — input/change 둘 다 청취(달력 선택 시 브라우저별 발화 이벤트 차이 대비). 값은 재렌더가 덮어쓰지 않음.
  if (dateEl) {
    const onDate = () => { state.date = dateEl.value; save(); renderConfirmed(); };
    dateEl.addEventListener('input', onDate);
    dateEl.addEventListener('change', onDate);
  }

  // 초기화(기본값 복원) — 확률·판단일·v2(앵커 모드+앵커 재seed+w) 전부 기본값
  $('rg-reset').addEventListener('click', () => {
    Object.assign(state, structuredClone(DEFAULTS));
    v2DetailDirty = false;
    if (!state.date) state.date = localTodayISO() || ''; // 초기화 시에도 로컬 오늘
    if (dateEl) dateEl.value = state.date;
    if (wEl) { wEl.value = state.v2.w; const wv = $('rg-w-val'); if (wv) wv.textContent = state.v2.w + '%'; }
    writeInputs(); renderOutputs();
  });

  // 확정 + 복사
  $('rg-confirm').addEventListener('click', onConfirm);
  $('rg-snippet-copy').addEventListener('click', copySnippet);

  // RG-4 채점
  if ($('rg-score-btn')) $('rg-score-btn').addEventListener('click', onScore);
  if ($('rg-score-copy')) $('rg-score-copy').addEventListener('click', copyScoreSnippet);
  if ($('rg-score-select')) $('rg-score-select').addEventListener('change', () => { scoreStatus('', ''); $('rg-score-result').innerHTML = ''; $('rg-score-snippet-wrap').style.display = 'none'; });

  // 해설 펼침 기억
  const ex = $('rg-explainer');
  if (ex) {
    try { ex.open = localStorage.getItem(LS_EXPLAIN) === '1'; } catch { /* noop */ }
    ex.addEventListener('toggle', () => { try { localStorage.setItem(LS_EXPLAIN, ex.open ? '1' : '0'); } catch { /* noop */ } });
  }
}

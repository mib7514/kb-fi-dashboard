// rg-score.js — RG-4 채점 엔진. 순수 함수, DOM·IO·저장 없음(onoff-judge.js 패턴: 상단 상수·구조화 출력).
// 판단 레코드(RG_LEDGER.judgments[주차]) + 실현값(파생 Δbp) → 채점 지표.
//
// [분류 기준] 실현 방향은 σ 보합밴드로 분류하며 판단 시점과 '동일 밴드'를 쓴다(§2). 밴드는 계열별
//   RG_CALIB.bands 상수(캘리브레이션 고정) → 판단·채점 동일. 경계: |Δ| < 밴드 = 보합, 등호(=밴드)는
//   방향으로 처리(Δ≥밴드 → 상승/확대, Δ≤−밴드 → 하락/축소). Phase 1 calibrate.mjs 셀 분류와 동일.
// [공유 섹터 이중계산] 국고(=금리축)·회사(=스프레드축) 섹터는 축 채점과 동일 신호다. 6섹터 Brier 를
//   전부 산출(투명성)하되, 집계 헤드라인은 비공유 신용 4섹터(creditAvg)만 사용해 축과 이중가중을 피한다.

import { TENORS, MAT, HOLD } from './rg-rolldown.js';

// ── 상수 ──
export const RATE_LABELS = ['down', 'flat', 'up'];       // 하락/보합/상승
export const SPREAD_LABELS = ['narrow', 'flat', 'wide'];  // 축소/보합/확대
// 섹터 → 밴드 계열·실현 소스. 국고=rate(ktb3y), 회사=spread(repSpread), 그 외 신용섹터.
export const SCORE_SECTORS = [
  { key: '국고채', share: 'rate' }, { key: '공사채', share: null }, { key: '은행채', share: null },
  { key: '회사채', share: 'spread' }, { key: '카드채', share: null }, { key: '여전채', share: null },
];

const round2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// ── 날짜 헬퍼(만기·D-day) ──
export function addMonthsISO(iso, m) {
  const [y, mo, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + m, d)).toISOString().slice(0, 10);
}
export function maturityOf(judgeDate) { return judgeDate ? addMonthsISO(judgeDate, 1) : null; }
export function ddayTo(maturityISO, todayISO) {   // 만기 − 오늘 (일). ≤0 이면 만기 도래
  if (!maturityISO || !todayISO) return null;
  return Math.round((Date.parse(maturityISO + 'T00:00:00Z') - Date.parse(todayISO + 'T00:00:00Z')) / 86400000);
}

// ── 방향 분류(§2 동일 밴드) ──
export function classifyRealized(deltaBp, bandBp, labels = RATE_LABELS) {
  if (!Number.isFinite(deltaBp) || !Number.isFinite(bandBp)) return null;
  if (deltaBp >= bandBp) return labels[2];       // 등호 → 방향(상승/확대)
  if (deltaBp <= -bandBp) return labels[0];       // 등호 → 방향(하락/축소)
  return labels[1];                               // |Δ| < 밴드 → 보합
}

// 확률 객체 → 정규화 분수 배열(labels 순). 합≤0 → null.
function fracs(probsObj, labels) {
  const v = labels.map(k => (Number.isFinite(+probsObj?.[k]) ? +probsObj[k] : 0));
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map(x => x / s) : null;
}
export function argmaxDir(probsObj, labels) {
  const f = fracs(probsObj, labels);
  if (!f) return null;
  let bi = 0; for (let i = 1; i < f.length; i++) if (f[i] > f[bi]) bi = i;
  return labels[bi];
}

// 9셀 분포(분수, 합 1) = P(금리i)·P(스프레드j). rate/spread 확률 객체.
export function combine9(rateProbs, spreadProbs) {
  const rf = fracs(rateProbs, RATE_LABELS), sf = fracs(spreadProbs, SPREAD_LABELS);
  if (!rf || !sf) return null;
  const cells = {};
  RATE_LABELS.forEach((r, i) => SPREAD_LABELS.forEach((s, j) => { cells[`${r}|${s}`] = rf[i] * sf[j]; }));
  return cells;
}

// multi-class Brier: Σ(p − o)², o=실현 원핫. realKey 없으면 null.
export function brierMulti(dist, realKey) {
  if (!dist || realKey == null) return null;
  let b = 0;
  for (const [k, p] of Object.entries(dist)) { const o = k === realKey ? 1 : 0; b += (p - o) ** 2; }
  return b;
}
// 3분류 Brier(확률 객체, 실현 방향). 정규화 후 Σ(p−o)².
export function brier3(probsObj, realDir, labels = SPREAD_LABELS) {
  const f = fracs(probsObj, labels);
  if (!f || realDir == null) return null;
  return labels.reduce((acc, k, i) => acc + (f[i] - (k === realDir ? 1 : 0)) ** 2, 0);
}

// RG-2 순위 적중: 실현 커브 Δ 로 구간별 실현수익 재계산(캐리+롤다운 고정 + 실현 커브이동).
//   realized total[k] = carryRollBp[k] − D′[k]·실현Δy[k].   D′ = 만기 − 1/12.
export function scoreRg2Rank(rg2, realizedCurveDeltaBp) {
  if (!rg2 || !Array.isArray(rg2.carryRollBp) || rg2.carryRollBp.length !== TENORS.length) return null;
  if (!Array.isArray(realizedCurveDeltaBp) || realizedCurveDeltaBp.length !== TENORS.length) return null;
  const D = MAT.map(m => m - HOLD);
  const totals = TENORS.map((t, k) => {
    const cr = +rg2.carryRollBp[k], dy = +realizedCurveDeltaBp[k];
    return { tenor: t, total: (Number.isFinite(cr) ? cr : 0) - D[k] * (Number.isFinite(dy) ? dy : 0) };
  });
  const order = totals.slice().sort((a, b) => b.total - a.total);
  const picked = rg2.topTenor;
  const rank = order.findIndex(o => o.tenor === picked) + 1;   // 1-based, 0 → 미포함
  return {
    picked, realizedTop1: order[0].tenor, realizedTop2: [order[0].tenor, order[1].tenor],
    hitTop1: picked === order[0].tenor, hitTop2: rank === 1 || rank === 2, realizedRank: rank || null,
    realizedTotals: order.map(o => ({ tenor: o.tenor, total: round1(o.total) })),
  };
}

// ── 최상위: 판단 레코드 채점 ──
// judgment: RG_LEDGER.judgments[주차] (probs, mode, sectors, baseline, rg2, judgeDate)
// realized: { ktb3yDeltaBp, repSpreadDeltaBp, sectorsDeltaBp:{공사채,은행채,카드채,여전채}, curveDeltaBp:[8] }
// bands:    RG_CALIB.bands (섹터 밴드 조회). 축 밴드는 judgment.baseline 우선(판단 시점 동일).
export function scoreJudgment(judgment, realized, bands) {
  const bandRate = judgment.baseline?.bandKtb3yBp ?? bands?.ktb3y?.bandBp;
  const bandSpread = judgment.baseline?.bandRepSpreadBp ?? bands?.repSpread?.bandBp;

  const realRateDir = classifyRealized(realized.ktb3yDeltaBp, bandRate, RATE_LABELS);
  const realSpreadDir = classifyRealized(realized.repSpreadDeltaBp, bandSpread, SPREAD_LABELS);
  const realCell = (realRateDir && realSpreadDir) ? `${realRateDir}|${realSpreadDir}` : null;

  // 1) 최빈 셀 적중
  const modalHit = realCell != null && judgment.mode?.cell === realCell;

  // 2) 축별 방향 적중
  const axisHit = {
    rate: argmaxDir(judgment.probs?.rate, RATE_LABELS) === realRateDir,
    spread: argmaxDir(judgment.probs?.spread, SPREAD_LABELS) === realSpreadDir,
  };

  // 3a) 9셀 multi-class Brier
  const dist9 = combine9(judgment.probs?.rate, judgment.probs?.spread);
  const brierCells9 = brierMulti(dist9, realCell);

  // 3b) 섹터 3분류 Brier (6섹터 전부, 공유 2행 플래그). 헤드라인 집계는 신용 4섹터.
  const perSector = {};
  for (const s of SCORE_SECTORS) {
    const probs = judgment.sectors?.[s.key]?.probs;
    const delta = s.share === 'rate' ? realized.ktb3yDeltaBp
      : s.share === 'spread' ? realized.repSpreadDeltaBp
        : realized.sectorsDeltaBp?.[s.key];
    const band = s.share === 'rate' ? bandRate : s.share === 'spread' ? bandSpread : bands?.sectors?.[s.key]?.bandBp;
    const realDir = classifyRealized(delta, band, SPREAD_LABELS);
    perSector[s.key] = { brier: round2(brier3(probs, realDir)), realDir, shared: s.share || null };
  }
  const credit = SCORE_SECTORS.filter(s => !s.share).map(s => perSector[s.key].brier).filter(Number.isFinite);
  const all6 = SCORE_SECTORS.map(s => perSector[s.key].brier).filter(Number.isFinite);
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // 4) RG-2 순위 적중
  const rg2Rank = scoreRg2Rank(judgment.rg2, realized.curveDeltaBp);

  return {
    modalHit,
    axisHit,
    realized: { rateDir: realRateDir, spreadDir: realSpreadDir, cell: realCell },
    brier: {
      cells9: round2(brierCells9),
      sectors: { perSector, creditAvg: round2(mean(credit)), allAvg: round2(mean(all6)) },
    },
    rg2Rank,
    meta: { bandRate, bandSpread, note: '공유 2행(국고=rate·회사=spread)은 축 채점과 동일 신호 → 섹터 헤드라인은 creditAvg(신용 4섹터)' },
  };
}

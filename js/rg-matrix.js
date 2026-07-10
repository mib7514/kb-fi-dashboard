// rg-matrix.js — RG 섹터×구간 매력도 매트릭스 순수 계산 (spec §1 RG-2/RG-3 결합). DOM·IO·저장 없음.
// 섹터별 8구간 총 기대수익(bp) = 캐리(섹터 수익률) + 롤다운(국고 모양) − D′×(E[Δy_구간] + E[Δs_섹터]).
//   섹터 현재 커브 = 국고 커브 + 스프레드(bp)를 만기 평탄 가정으로 가산 → 롤다운은 국고와 동일(평행 이동).
//   국고채 행은 스프레드 0·E[Δs]=0 → 순수 금리(RG-2 결과와 정확히 일치, 재사용 decompose).
// [단위] 커브·스프레드 입력은 % 커브 + bp 스프레드. 산출 수익률은 %, 기대수익·성분은 bp.
// [§0.3] 반환에 수익률 '레벨'(nowPct/landingPct)이 포함되나 이는 세션 표시용이며 저장·스니펫엔 담지 않는다(호출자 책임).

import { TENORS, MAT, HOLD, curveComplete, decompose } from './rg-rolldown.js';

// 매트릭스 섹터 표시 순서(RG-3 SECTORS 와 동일). 국고=금리만, 나머지=국고+스프레드.
export const MATRIX_SECTORS = ['국고채', '공사채', '은행채', '회사채', '카드채', '여전채'];
// 섹터 → data/credit-spread.js series 기본 라벨(3Y). 국고는 스프레드 0(로드 안 함).
//   출처: tools/rg-calibration/run.mjs (밴드 캘리브레이션과 동일 계열).
export const MATRIX_SPREAD_SERIES = {
  공사채: '공사채AAA_3년', 은행채: '은행채AAA_3년', 회사채: '회사채AA-_3년',
  카드채: '카드채AA+_3년', 여전채: '여전채AA-_3년',
};

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// 섹터 현재 커브(%): 국고 커브 + 스프레드(bp→%) 만기 평탄 가산.
export function sectorCurveNow(ktbCurve, spreadBp) {
  const sp = (Number.isFinite(+spreadBp) ? +spreadBp : 0) / 100;   // bp → %
  return ktbCurve.map(y => (+y) + sp);
}

// 착지 수익률(%): 현재 + (E[Δy_구간] + E[Δs_섹터])/100. eDs 스칼라(섹터 스프레드 기대변화 bp).
export function landingCurve(sectorCurve, eDyByTenor, eDs) {
  const d = Number.isFinite(+eDs) ? +eDs : 0;
  return sectorCurve.map((y, k) => (+y) + ((Number.isFinite(+eDyByTenor[k]) ? +eDyByTenor[k] : 0) + d) / 100);
}

// 6섹터×8구간 매트릭스. spreads/eDsBySector = { 섹터: 값 }(국고는 무시·0 고정). eDyByTenor = 8칸 배열(bp, w혼합).
//   반환: sectors/tenors, nowPct/landingPct(%), returnsBp/carryRollBp(bp), topCell, bestTenorBySector.
//   커브 미완/eDy 형식오류 → null.
export function matrixReturns(ktbCurve, spreads, eDyByTenor, eDsBySector) {
  if (!curveComplete(ktbCurve)) return null;
  if (!Array.isArray(eDyByTenor) || eDyByTenor.length !== TENORS.length) return null;
  const nowPct = {}, landingPct = {}, returnsBp = {}, carryRollBp = {}, bestTenorBySector = {};
  let top = null;
  for (const s of MATRIX_SECTORS) {
    const isKtb = s === '국고채';
    const spreadBp = isKtb ? 0 : (Number.isFinite(+spreads?.[s]) ? +spreads[s] : 0);
    const eDs = isKtb ? 0 : (Number.isFinite(+eDsBySector?.[s]) ? +eDsBySector[s] : 0);
    const sc = sectorCurveNow(ktbCurve, spreadBp);
    const effEDy = eDyByTenor.map(v => (Number.isFinite(+v) ? +v : 0) + eDs);   // 구간 E[Δy] + 섹터 E[Δs](평탄)
    const rows = decompose(sc, effEDy);                                          // RG-2 분해 재사용
    nowPct[s] = sc.slice();
    landingPct[s] = landingCurve(sc, eDyByTenor, eDs);
    returnsBp[s] = rows.map(r => r.total);
    carryRollBp[s] = rows.map(r => r.carry + r.rolldown);                        // 채점·재현용(커브레벨 비의존 파생)
    let bi = 0;
    for (let k = 1; k < rows.length; k++) if (rows[k].total > rows[bi].total) bi = k;
    bestTenorBySector[s] = TENORS[bi];
    for (let k = 0; k < rows.length; k++) if (!top || rows[k].total > top.bp) top = { sector: s, tenor: TENORS[k], bp: rows[k].total };
  }
  return { sectors: MATRIX_SECTORS.slice(), tenors: TENORS.slice(), nowPct, landingPct, returnsBp, carryRollBp, topCell: top, bestTenorBySector };
}

// 실현 매트릭스 순위 채점: 저장된 carryRollBp(6×8) + 실현 Δ(국고 커브 8 + 섹터 스프레드 Δbp) 로 실현 총수익 재구성.
//   realized total[s][k] = carryRollBp[s][k] − D′[k]·(실현Δy[k] + 실현Δs_s).  회사채 Δs=repSpreadDeltaBp, 국고 Δs=0.
//   판단 topCell 이 실현 최고 셀이었는지 top-1 / top-3.
export function scoreMatrixRank(matrix, realized) {
  if (!matrix || !matrix.carryRollBp || !matrix.topCell) return null;
  const cr = matrix.carryRollBp;
  const D = MAT.map(m => m - HOLD);
  const dy = Array.isArray(realized?.curveDeltaBp) ? realized.curveDeltaBp : [];
  const sd = realized?.sectorsDeltaBp || {};
  const realDs = {
    국고채: 0, 공사채: +sd['공사채'] || 0, 은행채: +sd['은행채'] || 0,
    회사채: +realized?.repSpreadDeltaBp || 0, 카드채: +sd['카드채'] || 0, 여전채: +sd['여전채'] || 0,
  };
  const cells = [];
  for (const s of MATRIX_SECTORS) {
    const arr = cr[s];
    if (!Array.isArray(arr)) continue;
    for (let k = 0; k < TENORS.length; k++) {
      const c = +arr[k], d = +dy[k];
      const total = (Number.isFinite(c) ? c : 0) - D[k] * ((Number.isFinite(d) ? d : 0) + (realDs[s] || 0));
      cells.push({ sector: s, tenor: TENORS[k], total });
    }
  }
  if (!cells.length) return null;
  const order = cells.slice().sort((a, b) => b.total - a.total);
  const picked = matrix.topCell;
  const rank = order.findIndex(o => o.sector === picked.sector && o.tenor === picked.tenor) + 1;   // 1-based, 0=미포함
  return {
    picked: { sector: picked.sector, tenor: picked.tenor },
    realizedTop1: { sector: order[0].sector, tenor: order[0].tenor, total: round1(order[0].total) },
    realizedTop3: order.slice(0, 3).map(o => ({ sector: o.sector, tenor: o.tenor, total: round1(o.total) })),
    hitTop1: rank === 1, hitTop3: rank >= 1 && rank <= 3, realizedRank: rank || null,
  };
}

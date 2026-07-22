// rv-cross.js — 횡단면(당일 세션) 판별 엔진. 순수 함수, Node 테스트 가능.
//   확정 괴리 구조:
//   1. 괴리 = 호가수익률 − 기준. 기준 = 내장민평(minpyeong_yield) ?? 커브 보간값. 내장민평 1순위.
//   2. 버킷(채권그룹) 중앙값은 '내장민평 기반' 괴리만으로 산출(보간폴백 건은 중앙값 산출에서 제외).
//      단 조정괴리는 보간폴백 건도 해당 버킷 중앙값을 동일 적용(뱃지로 구분).
//      표본<RV_MIN_BUCKET_SAMPLE 이면 세션 전체 중앙값(역시 내장민평 기반) 폴백.
//   3. 내장민평−보간 차이 |Δ|>RV_VALIDATION_THRESHOLD_BP → 검증 플래그(내장민평 낡음/오기 가능).
//   4. 원(won) 스프레드는 수익률 환산 범위 외 → rawGap 계산 제외(원문 유지).
//
// ── 잠정 파라미터 (전부 실사용 후 조정 가능) ─────────────────────────────
//   · RV_VALIDATION_THRESHOLD_BP = 15  — 내장민평−보간 |Δ|>15bp 시 검증 플래그(⚠).
//       이론 근거 없는 잠정치. 실 호가 로그 축적 후 재조정.
//   · RV_MIN_BUCKET_SAMPLE       = 4   — 버킷(채권그룹) 내장민평 표본<4면 세션 중앙값 폴백.
//       버킷 안정성/표본수 트레이드오프. 실사용 후 조정 가능.
//   · 세션 자동 초기화           = 일단위 — 날짜(로컬 YYYY-MM-DD) 바뀌면 세션 리셋.
//       구현 위치: rv-screener-ui.js todayKey()/loadSession(). 실사용 후 조정 가능.
// ─────────────────────────────────────────────────────────────────────

// ⚠ 잠정 상수. 이론 근거 없이 잠정치이며, 실 호가 로그 축적 후 재조정 예정.
export const RV_VALIDATION_THRESHOLD_BP = 15;
// 버킷 내장민평 표본이 이 값 미만이면 세션 중앙값으로 폴백. 실사용 후 조정 가능.
export const RV_MIN_BUCKET_SAMPLE = 4;

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// rows = [{q, ref}] (ref = resolveReference 결과). quoteYieldFn = engine.quoteYield.
export function buildGaps(rows, quoteYieldFn) {
  return rows.map(({ q, ref }) => {
    const embedded = q.minpyeong_yield;
    const interp = ref ? ref.refYield : null; // 커브 보간값(외삽 시 null)
    const reference = embedded != null ? embedded : interp;
    const refSource = embedded != null ? '내장민평' : (interp != null ? '보간폴백' : null);
    const validationDiff = (embedded != null && interp != null) ? (embedded - interp) * 100 : null;
    const validationFlag = validationDiff != null && Math.abs(validationDiff) > RV_VALIDATION_THRESHOLD_BP;
    const qyObj = quoteYieldFn(q);
    const qy = qyObj.y;
    const rawGap = (qy != null && reference != null) ? (qy - reference) * 100 : null;
    const bucket = ref ? ref.group : null;
    return {
      q, ref, embedded, interp, reference, refSource, validationDiff, validationFlag,
      quoteYield: qy, quoteYieldBasis: qyObj.basis, rawGap, bucket,
      method: ref ? ref.method : 'unmatched',
    };
  });
}

// 버킷·세션 중앙값 — 내장민평 기반 rawGap만 사용.
export function bucketMedians(gaps) {
  const byBucket = new Map();
  const sessionVals = [];
  for (const g of gaps) {
    if (g.rawGap == null || g.bucket == null) continue;
    if (g.refSource !== '내장민평') continue; // 폴백 건 제외
    if (!byBucket.has(g.bucket)) byBucket.set(g.bucket, []);
    byBucket.get(g.bucket).push(g.rawGap);
    sessionVals.push(g.rawGap);
  }
  const bucketMedian = {}, bucketCount = {};
  for (const [b, vals] of byBucket) { bucketMedian[b] = median(vals); bucketCount[b] = vals.length; }
  return { bucketMedian, bucketCount, sessionMedian: median(sessionVals), sessionCount: sessionVals.length };
}

// 조정괴리 = rawGap − 적용중앙값. 표본<MIN → 세션폴백. 보간폴백 건도 버킷 중앙값 동일 적용.
export function adjustGaps(gaps, bm) {
  for (const g of gaps) {
    if (g.rawGap == null || g.bucket == null) { g.adjustedGap = null; g.medianUsed = null; g.medianSource = null; continue; }
    const bc = bm.bucketCount[g.bucket] || 0;
    let usedMed, src;
    if (bc >= RV_MIN_BUCKET_SAMPLE) { usedMed = bm.bucketMedian[g.bucket]; src = '버킷'; }
    else if (bm.sessionMedian != null) { usedMed = bm.sessionMedian; src = '세션폴백'; }
    else { usedMed = 0; src = '없음'; }
    g.medianUsed = usedMed;
    g.medianSource = src;
    g.adjustedGap = g.rawGap - usedMed;
  }
  return gaps;
}

// 방향별 정렬. 매도(offer): 조정괴리 큰 순(싸게 나온 순). 매수(bid): 작은(음수) 순.
export function splitByDirection(gaps) {
  const rankable = gaps.filter((g) => g.adjustedGap != null);
  const offers = rankable.filter((g) => g.q.side === 'offer').sort((a, b) => b.adjustedGap - a.adjustedGap);
  const bids = rankable.filter((g) => g.q.side === 'bid').sort((a, b) => a.adjustedGap - b.adjustedGap);
  const unrankable = gaps.filter((g) => g.adjustedGap == null && g.method !== 'unmatched');
  return { offers, bids, unrankable };
}

// 원스텝 파이프라인
export function crossSectional(rows, quoteYieldFn) {
  const gaps = buildGaps(rows, quoteYieldFn);
  const bm = bucketMedians(gaps);
  adjustGaps(gaps, bm);
  return { gaps, bm, ...splitByDirection(gaps) };
}

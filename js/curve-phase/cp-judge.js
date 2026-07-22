// cp-judge.js — Curve Phase Monitor 판정 엔진. 순수 함수(DOM·fetch 없음), 테스트 가능.
//   명령서 판정표를 결정론적 라벨로 구현. 각국 최신 as-of 스냅샷 입력(크로스 조인 없음).
//   ▸ 판정표 = 조건 성립 여부(변수1 pct + 5y5y·TP 60d 변화). 분해(20d) 실현과 갈릴 수 있어
//     실현 요약을 별도 산출(카드에서 병기해 혼동 방지). 임계값은 초기값 — 관찰 후 조정(각주).

export const STEEP_MIN = 10;  // bp — 5y5y·TP 60d "상승(주도)" 임계
export const FLAT_MAX = -10;  // bp — 중립 밴드 하한(−10~+10 = 중립)

// KR 주 판정. snapshot: { v1pct(3Y−기준 percentile), kr5y5yChg60(bp), usTpChg60(bp) }.
//   반환 { key, label, tone }. tone: 'flat'|'steep'|'warn'|'neutral'(카드 색).
export function judgeKR({ v1pct, kr5y5yChg60, usTpChg60 }) {
  if (v1pct == null) return { key: 'watch', label: 'watch — 데이터 부족', tone: 'neutral' };
  if (v1pct >= 70) return { key: 'flat_persist', label: '역사적 플랫 국면 지속', tone: 'flat' };
  if (v1pct <= 30) {
    if (kr5y5yChg60 != null && kr5y5yChg60 >= STEEP_MIN) {
      if (usTpChg60 != null && usTpChg60 >= STEEP_MIN) {
        return { key: 'steep_tp', label: '스팁 조건 성립 — TP 주도 (베어 스팁 경고)', tone: 'warn' };
      }
      return { key: 'steep_rstar', label: '스팁 조건 성립 — r* 재조정 주도', tone: 'steep' };
    }
    if (kr5y5yChg60 != null && kr5y5yChg60 >= FLAT_MAX) { // −10~+10bp
      return { key: 'neutral', label: '중립 — 미반영 정보 부재', tone: 'neutral' };
    }
    return { key: 'watch', label: 'watch — 소진·뒷단 플랫', tone: 'neutral' }; // 소진 + 5y5y<−10
  }
  return { key: 'watch', label: 'watch', tone: 'neutral' }; // 30<pct<70
}

// US 부가 식별 라벨. snapshot: { usExpChg60(bp), usTpChg60(bp) } → { key, label }.
//   기대·TP 중 ≥+10bp 이면서 더 큰 쪽이 주도. 둘 다 정체면 글로벌 중립.
export function judgeUS({ usExpChg60, usTpChg60 }) {
  const e = usExpChg60, t = usTpChg60;
  const eOn = e != null && e >= STEEP_MIN;
  const tOn = t != null && t >= STEEP_MIN;
  if (!eOn && !tOn) return { key: 'global_neutral', label: '글로벌 중립 — KR 고유 요인 점검' };
  if ((e ?? -Infinity) >= (t ?? -Infinity)) return { key: 'global_rstar', label: '글로벌 r* 재조정 국면' };
  return { key: 'global_tp', label: '글로벌 TP 국면' };
}

// 실현 요약(최근 20d Δ3s10s 분해). decompLatest={front,back,total} → {netBp,direction,dominant}.
//   판정표(조건)와 별개로 '실제 움직임'을 측정. dominant = |기여| 큰 쪽.
export function realizedKR(decompLatest) {
  if (!decompLatest) return null;
  const { front, back, total } = decompLatest;
  return {
    netBp: total,
    direction: total > 0 ? '스팁' : total < 0 ? '플랫' : '중립',
    dominant: Math.abs(front) >= Math.abs(back) ? '앞단' : '뒷단',
  };
}

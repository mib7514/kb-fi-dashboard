// prob-normalize.js — 확률 배열 정규화 공유 유틸. 순수 함수, DOM·파일 I/O 없음.
// 축별 합계 검증 → 경고 상태 반환 → 원클릭 정규화. RG-1(금리/스프레드 축 각 3칸),
// RG-3(6섹터×3) 등에서 재사용. 슬라이더 조작 시 자동 비례조정은 하지 않는다(수동 입력 원칙).
//
// [격리] CB(carry-ui.js)의 인라인 정규화(계산 시 자동·비파괴)와는 독립 모듈이다.
// 기존 CB 코드는 건드리지 않는다 — RG 는 이 유틸만 쓴다(리스크 격리, spec Phase 2).
//
// [정책] RG 정규화는 '원클릭 버튼'으로 입력값 자체를 합계 target 으로 재기입한다(파괴적).
// probStatus 로 경고를 띄우되, 계산용 비파괴 값이 필요하면 normalized() 를 쓴다.

// ── 상수(파일 상단 집약, onoff-judge.js TH 패턴) ──
export const PN = {
  target: 100,   // 합계 목표(%)
  tol: 0.05,     // |Σ−target| ≤ tol → OK(부동소수·반올림 흡수)
  minSum: 1e-9,  // 정규화 가능 최소 합(0 나눗셈 방지)
  dp: 1,         // 정규화 재기입 소수 자리
};

const toNums = arr => arr.map(v => { const n = +v; return Number.isFinite(n) ? n : 0; });
const round = (v, dp) => { const r = 10 ** dp; return Math.round(v * r) / r; };

// 합계·상태 판정. 반환: { sum, ok, empty, needNorm, delta }
//   ok: 합계 ≈ target | empty: 합 ≈ 0 | needNorm: 비어있지 않은데 합 ≠ target | delta: sum−target
export function probStatus(arr, { target = PN.target, tol = PN.tol } = {}) {
  const sum = toNums(arr).reduce((a, b) => a + b, 0);
  const empty = sum <= PN.minSum;
  const ok = !empty && Math.abs(sum - target) <= tol;
  return { sum: round(sum, 3), ok, empty, needNorm: !empty && !ok, delta: round(sum - target, 3) };
}

// 비파괴 정규화값(입력 보존). 계산용(히트맵 등). 합≈0 이면 원본 그대로.
export function normalized(arr, { target = PN.target } = {}) {
  const nums = toNums(arr);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum <= PN.minSum) return nums;
  return nums.map(v => v * target / sum);
}

// 원클릭 정규화(표시·저장용): 합=target 로 재기입 + dp 반올림. 반올림 잔차는 최댓값 칸에 흡수
// → 반환 배열 합이 정확히 target. 합≈0 이면 원본 반환(정규화 불가).
export function normalizeInPlace(arr, { target = PN.target, dp = PN.dp } = {}) {
  const nums = toNums(arr);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum <= PN.minSum) return nums;
  const out = nums.map(v => round(v * target / sum, dp));
  const resid = round(target - out.reduce((a, b) => a + b, 0), dp);
  if (resid !== 0 && out.length) {
    let idx = 0; for (let i = 1; i < out.length; i++) if (out[i] > out[idx]) idx = i;
    out[idx] = round(out[idx] + resid, dp);
  }
  return out;
}

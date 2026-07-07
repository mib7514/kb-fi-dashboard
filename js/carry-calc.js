// carry-calc.js — 레버리지 캐리 손익분기 순수 계산 엔진. DOM·파일 I/O 접근 금지.
//
// [단위 규약] 모든 금리성 수량은 bp. 듀레이션 D 는 수정듀레이션(무차원·연).
//   ytm / repo(레포비용) / rolldown(롤다운연율) / dKtb(ΔKTB) / dSpread(Δspread)
//   / eDy(E[Δy]) / breakeven / carry / pnl = 전부 bp.
//   확률 p 는 백분율(%)로 받아 내부에서 /100 (UI 가 합계 100% 검증).
//
// [수식]
//   순캐리율(bp)       = YTM − 레포 + 롤다운연율
//   보유기간 캐리(bp)   = 순캐리율 × h/12
//   손익분기 허용폭(bp) = 캐리 / D
//   E[Δy](bp)          = Σ pᵢ(ΔKTBᵢ+Δspreadᵢ), 헤지 ON → ΔKTB 항 제외
//   초과수익(bp)        = 캐리 − D × E[Δy]
//   시나리오 손익(bp)   = 캐리 − D × (ΔKTBᵢ+Δspreadᵢ), 헤지 동일 적용
//   듀레이션 근사       = 잔존(년) / (1 + YTM/2)

const round = (v, dp = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);

// 연 순캐리율(bp) = YTM − 레포 + 롤다운연율
export function netCarryRate({ ytm = 0, repo = 0, rolldown = 0 } = {}) {
  return (ytm || 0) - (repo || 0) + (rolldown || 0);
}

// 보유기간 캐리(bp) = 순캐리율 × h/12
export function carryBp({ ytm = 0, repo = 0, rolldown = 0, h = 0 } = {}) {
  return round(netCarryRate({ ytm, repo, rolldown }) * (h / 12));
}

// 손익분기 허용 확대폭(bp) = 캐리 / D. D 0/음수면 null.
export function breakevenBp({ ytm = 0, repo = 0, rolldown = 0, h = 0, D } = {}) {
  if (!D || D <= 0) return null;
  return round(netCarryRate({ ytm, repo, rolldown }) * (h / 12) / D);
}

// 시나리오 유효 이동(bp): 헤지 ON → ΔKTB 제외(Δspread만).
function scenMove(s, hedge) {
  return (hedge ? 0 : (s.dKtb || 0)) + (s.dSpread || 0);
}

// E[Δy](bp) = Σ pᵢ(ΔKTBᵢ+Δspreadᵢ). p 는 %.
export function expectedDy(scenarios = [], { hedge = false } = {}) {
  let sum = 0;
  for (const s of scenarios) sum += ((s.p || 0) / 100) * scenMove(s, hedge);
  return round(sum);
}

// 기대 초과수익(bp) = 캐리 − D × E[Δy]
export function excessReturn({ ytm = 0, repo = 0, rolldown = 0, h = 0, D = 0, scenarios = [], hedge = false } = {}) {
  const carry = netCarryRate({ ytm, repo, rolldown }) * (h / 12);
  let eDy = 0;
  for (const s of scenarios) eDy += ((s.p || 0) / 100) * scenMove(s, hedge);
  return round(carry - D * eDy);
}

// 시나리오별 손익(bp) = 캐리 − D × (ΔKTBᵢ+Δspreadᵢ). worst=최소 pnl.
export function scenarioPnl({ ytm = 0, repo = 0, rolldown = 0, h = 0, D = 0, scenarios = [], hedge = false } = {}) {
  const carry = netCarryRate({ ytm, repo, rolldown }) * (h / 12);
  return scenarios.map(s => {
    const move = scenMove(s, hedge);
    return { label: s.label, p: s.p, move: round(move), pnl: round(carry - D * move) };
  });
}

// 듀레이션 근사: D ≈ 잔존(년) / (1 + YTM/2). ytm 은 bp → 소수(/10000).
export function durationApprox(maturityYears, ytmBp) {
  if (!(maturityYears > 0)) return null;
  return round(maturityYears / (1 + (ytmBp || 0) / 10000 / 2));
}

// 그리드: 듀레이션 × 보유기간 → 손익분기 허용 확대폭(bp).
// 반환: [{ D, cells:[{ h, breakeven }] }]
export function gridTable({ ytm = 0, repo = 0, rolldown = 0, durations = [], horizons = [] } = {}) {
  const rate = netCarryRate({ ytm, repo, rolldown });
  return durations.map(D => ({
    D,
    cells: horizons.map(h => ({ h, breakeven: (D > 0) ? round(rate * (h / 12) / D) : null })),
  }));
}

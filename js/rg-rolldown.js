// rg-rolldown.js — RG-2 v1 롤다운 탐색기 순수 계산 (spec §1 RG-2). DOM·IO·저장 없음.
// 1개월 보유·구간별 기대수익(bp) = 캐리 + 롤다운 + 커브이동. onoff-judge.js 패턴(순수·상단 상수).
//
// [단위] 수익률 입력은 % (예: 3.50). 모든 산출은 bp. y(%)×100 = bp.
// [라이선스] 이 모듈은 커브 수익률을 계산에만 쓰고 반환값에 원본 레벨을 담지 않는 것은 호출자 책임 —
//   본 함수는 파생 성분(bp)만 반환한다. 원본 커브는 세션 메모리에만 존재(§0.3, 저장 금지).

// ── 상수 ──
export const TENORS = ['3M', '6M', '1Y', '1.5Y', '2Y', '2.5Y', '3Y', '5Y'];
export const MAT = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 5];        // 구간 만기(년)
export const HOLD = 1 / 12;                                    // 보유기간(년) = 1개월
export const TENOR3Y = 6;                                      // medianCurves deltaBp 의 3Y 인덱스
const RATE = ['down', 'flat', 'up'];
const SPREAD = ['narrow', 'flat', 'wide'];

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// 8점 격자 선형 보간. x ≤ 최소만기 → 최소만기 값 평탄 외삽(3M 미만). x ≥ 최대 → 최대값.
export function interp(xs, ys, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  for (let i = 1; i < n; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[n - 1];
}

// 커브 8구간 전부 유효 수치인지
export function curveComplete(curveY) {
  return Array.isArray(curveY) && curveY.length === TENORS.length
    && curveY.every(v => v !== '' && v != null && Number.isFinite(+v));  // 빈칸('')은 +''→0 이므로 명시 배제
}

// v1 평행이동 기대 Δy(bp): Σij P(금리i)P(스프레드j)·medianCurves[cell].deltaBp[3Y].
// rateProbs/spreadProbs 는 %(또는 임의 스케일) — 내부에서 각 축 합으로 정규화(방어). 계산 불가 시 null.
export function expectedDyParallel(rateProbs, spreadProbs, medianCurves, tenorIdx = TENOR3Y) {
  if (!medianCurves || !medianCurves.cells) return null;
  const rp = rateProbs.map(v => (Number.isFinite(+v) ? +v : 0));
  const sp = spreadProbs.map(v => (Number.isFinite(+v) ? +v : 0));
  const rsum = rp.reduce((a, b) => a + b, 0), ssum = sp.reduce((a, b) => a + b, 0);
  if (rsum <= 0 || ssum <= 0) return null;               // 확률 미입력 → null(호출자: 커브이동 0 + 안내)
  let e = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const cell = medianCurves.cells[`${RATE[i]}|${SPREAD[j]}`];
    if (!cell || !Array.isArray(cell.deltaBp)) return null;
    e += (rp[i] / rsum) * (sp[j] / ssum) * cell.deltaBp[tenorIdx];
  }
  return e;
}

// 구간별 3성분 분해. eDy(bp) 없으면(null) 커브이동=0 으로 계산.
// 반환 행: { tenor, maturity, y0, Dp, carry, rolldown, curveMove, total } (원값 유지; 표시 반올림은 호출자)
export function decompose(curveY, eDy) {
  const eff = Number.isFinite(eDy) ? eDy : 0;
  const nz = v => v + 0;                                  // −0 → 0 정규화(표시·엄격비교 안정)
  return TENORS.map((tenor, k) => {
    const T = MAT[k];
    const y0 = +curveY[k];
    const Dp = T - HOLD;                                  // 만기 − 1/12 (수정듀레이션 만기근사, v1)
    const yLand = interp(MAT, curveY, T - HOLD);          // 1개월 후 잔존만기 위치의 현재커브 수익률
    const carry = nz(y0 * 100 / 12);                      // y0(%)×100/12 = 1개월 캐리(bp)
    const rolldown = nz(-Dp * (yLand - y0) * 100);        // 착지커브=현재커브 가정
    const curveMove = nz(-Dp * eff);                      // 평행이동: 전 구간 동일 eDy
    return { tenor, maturity: T, y0, Dp, carry, rolldown, curveMove, total: nz(carry + rolldown + curveMove) };
  });
}

// 표시용: 분해 + 반올림(0.1bp) + 기대수익 내림차순 순위. top = 최고 기대수익 구간.
export function rolldownTable(curveY, eDy) {
  const rows = decompose(curveY, eDy).map(r => ({
    tenor: r.tenor, maturity: r.maturity,
    carry: round1(r.carry), rolldown: round1(r.rolldown), curveMove: round1(r.curveMove), total: round1(r.total),
    _total: r.total,
  }));
  const ranked = rows.slice().sort((a, b) => b._total - a._total);
  const top = ranked.length ? ranked[0] : null;
  return { rows, ranked, top: top ? { tenor: top.tenor, total: top.total } : null };
}

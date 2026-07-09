// calibrate.mjs — RG 캘리브레이션 순수 코어 (spec v1.1 §2·§3).
// 파일 I/O·XLSX 로드 없음. 입력은 정제된 시계열(Map: ISO날짜 → 값), 출력은 파생 통계값 객체.
// onoff-parse.js 관례(순수 모듈, 호출자가 I/O 담당)를 따른다 → tools/rg-calibration/run.mjs 가 I/O.
//
// [라이선스] 원시 수익률·스프레드 레벨은 이 모듈을 통과만 하고 절대 반환/직렬화되지 않는다.
// 반환값은 Δbp·σbp·표본수·소스레벨·메타뿐이다(§0.3, Phase 1 검수 대상).
//
// [방법론] 일별 롤링 전향 1개월 변화로 표본 확보(중첩 윈도우). 밴드(=±kσ)를 먼저 확정한 뒤
// 각 앵커를 9셀(금리 방향 × 스프레드 방향)로 분류(순환 의존 방지, §3). 셀별 8구간 Δ 중위값.
// 셀 표본 <MIN_CELL_N → 행(금리 방향) 주변부 → 전체 순으로 계층적 폴백, 소스레벨 기록.

// ── 상수(파일 상단 집약, onoff-judge.js TH 패턴) ──
export const TENORS = ['3M', '6M', '1Y', '1.5Y', '2Y', '2.5Y', '3Y', '5Y']; // 8구간(Z·S·C·L 정렬)
export const K = 0.25;              // 보합밴드 계수: band = k·σ (spec §2 초기값)
export const HORIZON_MONTHS = 1;    // 전향 호라이즌(개월)
export const TOLERANCE_DAYS = 7;    // 1개월 목표일에서 이 일수 내 첫 관측을 타깃으로(휴일·주말 흡수)
export const MIN_CELL_N = 30;       // 셀 표본 하한 — 미만이면 폴백(§3)
export const UNIT_BP = 100;         // 입력 단위 → bp 환산(수익률 %·스프레드 %p 공통 ×100)

export const RATE_DIRS = ['down', 'flat', 'up'];       // 금리: 하락/보합/상승
export const SPREAD_DIRS = ['narrow', 'flat', 'wide'];  // 스프레드: 축소/보합/확대
export const cellKey = (r, s) => `${r}|${s}`;

// ── 수치 헬퍼 ──
const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function median(arr) {
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 표본표준편차(n−1). n<2 → null.
export function stdev(arr) {
  const a = arr.filter(Number.isFinite);
  if (a.length < 2) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}

// ── 날짜 헬퍼(UTC, TZ 아티팩트 배제) ──
const DAY = 86400000;
export function addMonthsISO(iso, m) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + m, d));
  return dt.toISOString().slice(0, 10);
}
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

// 정렬된 날짜 배열에서 target 이상인 첫 인덱스(이분탐색). 없으면 -1.
function firstAtOrAfter(sortedDates, target) {
  let lo = 0, hi = sortedDates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedDates[mid] < target) lo = mid + 1; else hi = mid; }
  return lo < sortedDates.length ? lo : -1;
}

// ── 전향 1개월 변화 표본 ──
// series: Map(ISO → number). 각 앵커 d 에 대해 target=addMonths(d,1) 이상인 첫 관측을
// TOLERANCE 내에서 매칭(from,to,deltaBp). 매칭 실패(데이터 말미·큰 공백)는 스킵.
// 반환: { deltas:[bp...], pairs:[{from,to,anchorIdx}], dates:[정렬] }
export function forwardChanges(series, { months = HORIZON_MONTHS, tolDays = TOLERANCE_DAYS, unit = UNIT_BP } = {}) {
  const dates = [...series.keys()].sort();
  const deltas = [], pairs = [];
  for (let i = 0; i < dates.length; i++) {
    const from = dates[i];
    const target = addMonthsISO(from, months);
    const j = firstAtOrAfter(dates, target);
    if (j < 0) continue;
    const to = dates[j];
    if (diffDays(target, to) > tolDays) continue;     // 목표일에서 너무 멀면(큰 공백) 스킵
    const dv = (series.get(to) - series.get(from)) * unit;
    if (!Number.isFinite(dv)) continue;
    deltas.push(dv);
    pairs.push({ from, to, anchorIdx: i });
  }
  return { deltas, pairs, dates };
}

// ── 계열 밴드: σbp, bandBp=k·σ, 표본수 ──
export function computeBand(series, opts = {}) {
  const { deltas } = forwardChanges(series, opts);
  const sigma = stdev(deltas);
  return {
    sigmaBp: round1(sigma),
    bandBp: sigma == null ? null : round1(K * sigma),
    n: deltas.length,
  };
}

// 방향 분류(|Δ|<band → 보합; 임계=band 포함 방향). band 는 bp.
export function classifyRate(deltaBp, bandBp) {
  if (deltaBp >= bandBp) return 'up';
  if (deltaBp <= -bandBp) return 'down';
  return 'flat';
}
export function classifySpread(deltaBp, bandBp) {
  if (deltaBp >= bandBp) return 'wide';
  if (deltaBp <= -bandBp) return 'narrow';
  return 'flat';
}

// ── 핵심: 9셀 분류 + 셀별 8구간 중위 Δ + 계층적 폴백 ──
// 입력:
//   curve:  { '3M':Map, '6M':Map, ... '5Y':Map }  (국고 수익률, 8구간 전부)
//   rate:   Map (금리축 = 국고 3Y 수익률; 보통 curve['3Y'] 재사용)
//   spread: Map (스프레드축 = 회사채 AA- 3Y 스프레드)
//   bandRateBp, bandSpreadBp: §2 밴드(먼저 확정된 값)
// 앵커·타깃은 curve 8구간 + rate + spread 가 모두 존재하는 공통 날짜에서만 잡는다.
export function buildMedianCurves(curve, rate, spread, bandRateBp, bandSpreadBp, opts = {}) {
  const { months = HORIZON_MONTHS, tolDays = TOLERANCE_DAYS, unit = UNIT_BP } = opts;
  // 공통 날짜(모든 필요한 계열에 값 존재)
  const need = [rate, spread, ...TENORS.map(t => curve[t])];
  const common = [...rate.keys()]
    .filter(d => need.every(m => m.has(d) && Number.isFinite(m.get(d))))
    .sort();
  const commonSet = new Set(common);

  // 누적기: 셀별/행별/전역 — 표본수 + 구간별 Δbp 배열
  const mkAcc = () => ({ n: 0, byTenor: Object.fromEntries(TENORS.map(t => [t, []])) });
  const cells = {}; for (const r of RATE_DIRS) for (const s of SPREAD_DIRS) cells[cellKey(r, s)] = mkAcc();
  const rows = Object.fromEntries(RATE_DIRS.map(r => [r, mkAcc()]));
  const global = mkAcc();
  let matched = 0, firstDate = null, lastDate = null;

  for (let i = 0; i < common.length; i++) {
    const from = common[i];
    const target = addMonthsISO(from, months);
    const j = firstAtOrAfter(common, target);
    if (j < 0) continue;
    const to = common[j];
    if (diffDays(target, to) > tolDays) continue;

    const rateD = (rate.get(to) - rate.get(from)) * unit;
    const spreadD = (spread.get(to) - spread.get(from)) * unit;
    const rDir = classifyRate(rateD, bandRateBp);
    const sDir = classifySpread(spreadD, bandSpreadBp);
    const tenorDeltas = TENORS.map(t => (curve[t].get(to) - curve[t].get(from)) * unit);

    for (const acc of [cells[cellKey(rDir, sDir)], rows[rDir], global]) {
      acc.n++;
      TENORS.forEach((t, k) => acc.byTenor[t].push(tenorDeltas[k]));
    }
    matched++;
    if (!firstDate) firstDate = from;
    lastDate = to;
  }

  // 중위값 + 계층적 폴백(셀 → 행 → 전역), 소스레벨 셀 단위 기록
  const medOf = acc => TENORS.map(t => round1(median(acc.byTenor[t])));
  const globalMed = medOf(global);
  const out = {};
  const report = { cellCounts: {}, rowCounts: {}, globalN: global.n, fallbacks: [] };
  for (const r of RATE_DIRS) report.rowCounts[r] = rows[r].n;

  for (const r of RATE_DIRS) for (const s of SPREAD_DIRS) {
    const key = cellKey(r, s);
    const acc = cells[key];
    report.cellCounts[key] = acc.n;
    let source, deltaBp;
    if (acc.n >= MIN_CELL_N) { source = 'cell'; deltaBp = medOf(acc); }
    else if (rows[r].n >= MIN_CELL_N) { source = 'row'; deltaBp = medOf(rows[r]); report.fallbacks.push({ cell: key, n: acc.n, source }); }
    else { source = 'global'; deltaBp = globalMed; report.fallbacks.push({ cell: key, n: acc.n, source }); }
    out[key] = { n: acc.n, source, deltaBp };
  }

  return {
    medianCurves: { tenors: TENORS, cells: out, rows: report.rowCounts, globalN: global.n },
    report: { ...report, matched, common: common.length, firstDate, lastDate },
  };
}

// ── 최상위: 전체 캘리브레이션 → window.RG_CALIB 페이로드 + 리포트 통계 ──
// input:
//   curve:   { '3M':Map ... '5Y':Map }
//   rate:    Map (국고 3Y; 없으면 curve['3Y'])
//   spread:  Map (대표 스프레드, 회사채 AA- 3Y)
//   sectors: { 국고채:Map, 공사채:Map, 은행채:Map, 회사채:Map, 카드채:Map, 여전채:Map }
//   meta:    { period, generatedAt, ... } 부가정보(선택)
export function calibrate({ curve, rate, spread, sectors = {}, meta = {} }, opts = {}) {
  const rateSeries = rate || curve['3Y'];
  const bandRate = computeBand(rateSeries, opts);
  const bandSpread = computeBand(spread, opts);
  const sectorBands = {};
  for (const [name, s] of Object.entries(sectors)) sectorBands[name] = computeBand(s, opts);

  const { medianCurves, report } = buildMedianCurves(
    curve, rateSeries, spread, bandRate.bandBp, bandSpread.bandBp, opts,
  );

  const payload = {
    bands: { ktb3y: bandRate, repSpread: bandSpread, sectors: sectorBands },
    medianCurves,
    meta: {
      k: K, horizonMonths: HORIZON_MONTHS, minCellN: MIN_CELL_N, unit: 'bp',
      rateAxis: '국고 3Y 수익률 1개월 Δ', spreadAxis: '회사채 AA- 3Y 스프레드 1개월 Δ',
      period: report.firstDate && report.lastDate ? { from: report.firstDate, to: report.lastDate } : null,
      note: '파생 통계값만 — 원시 수익률·스프레드 레벨 미포함(§0.3)',
      ...meta,
    },
  };
  return { payload, report };
}

// ── 직렬화: data/rg-calib.js (window.RG_CALIB 전역, file:// CORS 회피 관례) ──
export function serialize(payload) {
  const { bands, medianCurves, meta } = payload;
  const j = (v) => JSON.stringify(v);
  const bandLine = (k, b) => `    ${j(k)}: ${j(b)}`;
  const sectorLines = Object.entries(bands.sectors).map(([k, b]) => `      ${j(k)}: ${j(b)}`).join(',\n');
  const cellLines = Object.entries(medianCurves.cells)
    .map(([k, c]) => `      ${j(k)}: ${j(c)}`).join(',\n');
  return (
    '// data/rg-calib.js — RG 캘리브레이션 산출물 (tools/rg-calibration 오프라인 생성).\n' +
    '// 파생 통계값만: Δbp·σbp·표본수·소스레벨·메타. 원시 수익률/스프레드 레벨 없음(§0.3).\n' +
    '// 재생성: node tools/rg-calibration/run.mjs. 로드: <script src="data/rg-calib.js">.\n' +
    'window.RG_CALIB = {\n' +
    '  bands: {\n' +
    bandLine('ktb3y', bands.ktb3y) + ',\n' +
    bandLine('repSpread', bands.repSpread) + ',\n' +
    '    sectors: {\n' + sectorLines + '\n    }\n' +
    '  },\n' +
    '  medianCurves: {\n' +
    '    tenors: ' + j(medianCurves.tenors) + ',\n' +
    '    rows: ' + j(medianCurves.rows) + ',\n' +
    '    globalN: ' + j(medianCurves.globalN) + ',\n' +
    '    cells: {\n' + cellLines + '\n    }\n' +
    '  },\n' +
    '  meta: ' + j(meta) + '\n' +
    '};\n'
  );
}

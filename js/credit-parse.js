// credit-parse.js — composite xlsx → data/credit-spread.js 파싱·직렬화·검증 공유 모듈.
// 브라우저(admin)와 node(tools/convert-composite.mjs)가 모두 import → 바이트 동일 산출 보장.
// 환경 무관: 파일 I/O·XLSX 로드는 호출자 담당, 이 모듈은 SheetJS AOA만 입력받는다.
//
// [정밀도 결정] 민평 스프레드 호가 그리드가 0.1bp(=%p 3자리)이므로 3자리 반올림값이
// '참값'이다. 원본 double은 부동소수점 노이즈(예: 0.180 → 0.17999999999999972)를
// 품으므로 3자리로 정규화한다. 날짜는 Excel 시리얼을 UTC 일단위 반올림으로 변환해
// 타임존 아티팩트를 제거한다. 이 두 규칙이 양 환경에서 동일해야 diff가 0이 된다.

export const MATURITIES = ['1년', '2년', '3년', '5년', '10년'];

// Excel 시리얼(1900 date system) → 'YYYY-MM-DD' (UTC, 일 단위 반올림으로 TZ 아티팩트 제거)
export function serialToISO(serial) {
  const days = Math.round(serial) - 25569; // 25569 = 1970-01-01의 Excel 시리얼
  return new Date(days * 86400000).toISOString().slice(0, 10);
}

// 민평 호가 그리드(0.1bp = %p 3자리)로 정규화 — 부동소수점 노이즈 제거
export const round3 = v =>
  (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 1000) / 1000 : null;

// --- 파싱: SheetJS AOA(header:1, raw:true) → 컬럼형 구조 ---
// aoa: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) 결과
// 반환: { cols:[{idx,label}], sectors, dates, series }
export function parseAoa(aoa) {
  // 헤더 = 17행(index 16). A열 이후 라벨 수집.
  const header = aoa[16] || [];
  const cols = [];
  for (let c = 1; c < header.length; c++) {
    const label = header[c];
    if (label != null && label !== '') cols.push({ idx: c, label: String(label) });
  }
  const sectors = [...new Set(cols.map(c => c.label.split('_')[0]))];

  // 데이터 행: A열이 날짜 시리얼(number > 40000)인 행만. 라벨/통계 행 무시.
  const dates = [];
  const series = {};
  for (const c of cols) series[c.label] = [];
  for (let r = 17; r < aoa.length; r++) {
    const a = aoa[r] && aoa[r][0];
    if (typeof a !== 'number' || a < 40000) continue;
    dates.push(serialToISO(a));
    for (const c of cols) series[c.label].push(round3(aoa[r][c.idx]));
  }
  return { cols, sectors, dates, series };
}

// --- 직렬화: data/credit-spread.js 텍스트(컬럼형) ---
export function serialize({ cols, sectors, dates, series }) {
  const meta = {
    source: 'composite-xlsx',
    last_updated: dates[dates.length - 1],
    sectors,
    maturities: MATURITIES,
  };
  return (
    'window.FENRIR_SERIES = window.FENRIR_SERIES || {};\n' +
    'window.FENRIR_SERIES["credit-spread"] = {\n' +
    '  meta: ' + JSON.stringify(meta) + ',\n' +
    '  dates: ' + JSON.stringify(dates) + ',\n' +
    '  series: {\n' +
    cols.map(c => '    ' + JSON.stringify(c.label) + ': ' + JSON.stringify(series[c.label])).join(',\n') +
    '\n  }\n};\n'
  );
}

// --- 업로드 구조 검증 ---
// 고정 기준값(2832행 등 특성화 게이트)이 아니라 '갱신돼도 참인' 구조 불변식만 검사한다.
// 새 영업일 추가(2833행 등)는 정상 통과, 파싱 붕괴·컬럼 변형·이상치만 실패.
// 실패 시 Error throw(위치 포함). 성공 시 파생 통계 반환(미리보기/리포트 공용).

export const EXPECTED_SECTORS = [
  '국고채권', '공사채AAA', '은행채AAA', '회사채AAA', '회사채AA+', '카드채AA+', '회사채AA0', '카드채AA0',
  '회사채AA-', '여전채AA-', '회사채A+', '여전채A+', '회사채A0', '여전채A0', '회사채BBB+',
];
export const EXPECTED_LABELS = EXPECTED_SECTORS.flatMap(s => MATURITIES.map(m => `${s}_${m}`));

const MIN_ROWS = 2832;       // 최초 구현 시점 행수 — 이보다 줄면 파싱 이상
const MIN_LAST_DATE = '2026-07-01';
const KTB_RANGE = [0, 20];   // 국고 금리 %
const CREDIT_RANGE = [-1, 15]; // 크레딧 스프레드 %p (역전 대비 하한 여유)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateStructure(parsed) {
  const { cols, dates, series } = parsed;
  const fail = m => { throw new Error('구조 검증 실패: ' + m); };

  // 1) 헤더 라벨 = 기대 75개(섹터15×만기5)와 정확히 일치
  const labels = cols.map(c => c.label);
  if (labels.length !== EXPECTED_LABELS.length)
    fail(`라벨 수 ${labels.length} ≠ ${EXPECTED_LABELS.length} (섹터15×만기5)`);
  const have = new Set(labels), want = new Set(EXPECTED_LABELS);
  const missing = EXPECTED_LABELS.filter(l => !have.has(l));
  const extra = labels.filter(l => !want.has(l));
  if (missing.length) fail(`누락 라벨: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`);
  if (extra.length) fail(`예상 밖 라벨: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`);

  // 2) 날짜: 행수·파싱·중복·오름차순·최신
  if (dates.length < MIN_ROWS) fail(`행수 ${dates.length} < ${MIN_ROWS} (기존 대비 감소)`);
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d))) fail(`날짜 파싱 불가: 행 ${i} '${d}'`);
    if (i > 0) {
      if (d === dates[i - 1]) fail(`중복 날짜: ${d} (행 ${i})`);
      if (d < dates[i - 1]) fail(`날짜 역순: ${dates[i - 1]} → ${d} (행 ${i})`);
    }
  }
  const last = dates[dates.length - 1];
  if (last < MIN_LAST_DATE) fail(`최신 날짜 ${last} < ${MIN_LAST_DATE}`);

  // 3) 값 범위(위반 셀 위치 포함) + 비null 비율 ≥ 50%(파싱 붕괴 감지)
  const n = dates.length;
  for (const c of cols) {
    const arr = series[c.label];
    const isKtb = c.label.startsWith('국고채권_');
    const [lo, hi] = isKtb ? KTB_RANGE : CREDIT_RANGE;
    let nn = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == null) continue;
      nn++;
      if (v < lo || v > hi)
        fail(`값 범위 위반: ${c.label} @ ${dates[i]} = ${v} (허용 ${lo}~${hi}${isKtb ? '%' : '%p'})`);
    }
    if (nn / n < 0.5) fail(`비null 비율 ${(nn / n * 100).toFixed(0)}% < 50%: ${c.label} (파싱 붕괴 의심)`);
  }

  // 파생 통계
  const lastVal = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  return {
    rows: n, first: dates[0], last,
    sectors: EXPECTED_SECTORS.length, cols: labels.length,
    ktb3: lastVal(series['국고채권_3년']),
    gsAAA3: lastVal(series['공사채AAA_3년']),
  };
}

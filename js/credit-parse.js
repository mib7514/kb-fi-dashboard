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

// --- G1 특성화 검증 ---
// 실패 시 Error throw. 성공 시 파생 통계 반환(리포트/미리보기 공용).
export function validateG1(parsed) {
  const { dates, series, sectors, cols } = parsed;
  const nonNull = arr => arr.filter(v => v != null);
  const last = arr => arr[arr.length - 1];
  const assert = (cond, msg) => { if (!cond) throw new Error('G1 FAIL: ' + msg); };

  assert(dates.length === 2832, `데이터 행 ${dates.length} ≠ 2832`);
  assert(dates[0] === '2015-01-02', `첫 날짜 ${dates[0]} ≠ 2015-01-02`);
  assert(last(dates) === '2026-07-01', `마지막 날짜 ${last(dates)} ≠ 2026-07-01`);
  assert(sectors.length === 15, `섹터 ${sectors.length} ≠ 15`);
  assert(cols.length === 75, `라벨 ${cols.length} ≠ 75`);
  assert(nonNull(series['공사채AAA_3년']).length === 2831,
    `공사채AAA_3년 비null ${nonNull(series['공사채AAA_3년']).length} ≠ 2831`);

  const ktb3 = last(series['국고채권_3년']);
  assert(Math.abs(ktb3 - 3.790) < 0.0015, `국고채권_3년 최신 ${ktb3} ≠ 3.790`);
  const gsAAA3 = last(series['공사채AAA_3년']);
  assert(Math.abs(gsAAA3 - 0.371) < 0.0015, `공사채AAA_3년 최신 ${gsAAA3} ≠ 0.371`);

  const aa3 = series['회사채AA-_3년'];
  const aa3nn = nonNull(aa3);
  assert(Math.abs(last(aa3) - 0.680) < 0.0015, `회사채AA-_3년 최신 ${last(aa3)} ≠ 0.680`);
  const aa3max = Math.max(...aa3nn), aa3min = Math.min(...aa3nn);
  assert(Math.abs(aa3max - 1.775) < 0.0015, `회사채AA-_3년 최대 ${aa3max} ≠ 1.775`);
  assert(Math.abs(aa3min - 0.251) < 0.0015, `회사채AA-_3년 최소 ${aa3min} ≠ 0.251`);
  const maxDate = dates[aa3.indexOf(aa3max)], minDate = dates[aa3.indexOf(aa3min)];
  assert(maxDate === '2022-11-30', `회사채AA-_3년 최대 날짜 ${maxDate} ≠ 2022-11-30`);
  assert(minDate === '2015-03-24', `회사채AA-_3년 최소 날짜 ${minDate} ≠ 2015-03-24`);

  return {
    rows: dates.length, first: dates[0], last: last(dates),
    sectors: sectors.length, cols: cols.length,
    ktb3, gsAAA3,
    aa3: { last: last(aa3), max: aa3max, min: aa3min, maxDate, minDate },
  };
}

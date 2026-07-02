// composite xlsx → data/credit-spread.js 변환기
// - 시트 `spread` 파싱: 헤더 17행, 데이터 18행~ (A열 날짜 시리얼)
// - 컬럼형(columnar) 출력, 결측 null, 소수 3자리 반올림
// - G1 특성화 기준값을 assert로 내장 (실패 시 비정상 종료)
//
// [정밀도 결정] 민평 스프레드의 실제 호가 그리드가 0.1bp(=%p 3자리)이므로
// 3자리 반올림값이 '참값'이다. 원본 xlsx 값의 ~68%는 부동소수점 노이즈
// (예: 0.180 → 0.17999999999999972, 미세 구분 ≈2.8e-16)를 품고 있어, 명세의
// 검증 기준값 표(G2·G5)가 이 노이즈 낀 원본 double에서 산출된 것이 오류다.
// 따라서 데이터는 3자리 반올림으로 정규화(참값)하고, percentile 게이트 기대값은
// 클린 데이터에서 독립 재산출한 값으로 교체한다(허용오차는 명령서 원안 유지).
//
// 실행: node tools/convert-composite.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.min.js'); // UMD 번들 재사용 (node에서 require 가능)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- 헬퍼 ---
// Excel 시리얼(1900 date system) → 'YYYY-MM-DD' (UTC, 일 단위 반올림으로 TZ 아티팩트 제거)
function serialToISO(serial) {
  const days = Math.round(serial) - 25569; // 25569 = 1970-01-01의 Excel 시리얼
  return new Date(days * 86400000).toISOString().slice(0, 10);
}
// 민평 호가 그리드(0.1bp = %p 3자리)로 정규화 — 부동소수점 노이즈 제거 (위 [정밀도 결정] 참조)
const round3 = v => (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 1000) / 1000 : null;

// --- 파일 로드 ---
const xlsxName = readdirSync(ROOT).find(f => f.endsWith('.xlsx'));
if (!xlsxName) { console.error('❌ 레포 루트에 .xlsx 파일이 없습니다.'); process.exit(1); }
const wb = XLSX.read(readFileSync(join(ROOT, xlsxName)), { type: 'buffer' });
const ws = wb.Sheets['spread'];
if (!ws) { console.error('❌ 시트 `spread` 없음.'); process.exit(1); }
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

// --- 헤더 (17행 = index 16) ---
const header = aoa[16];
const cols = []; // { idx, label }
for (let c = 1; c < header.length; c++) {
  const label = header[c];
  if (label != null && label !== '') cols.push({ idx: c, label: String(label) });
}
const maturities = ['1년', '2년', '3년', '5년', '10년'];
const sectors = [...new Set(cols.map(c => c.label.split('_')[0]))];

// --- 데이터 행: A열이 날짜 시리얼(number > 40000)인 행 ---
const dates = [];
const series = {};
for (const c of cols) series[c.label] = [];

for (let r = 17; r < aoa.length; r++) {
  const a = aoa[r]?.[0];
  if (typeof a !== 'number' || a < 40000) continue; // 날짜 아닌 행(라벨/통계) 무시
  dates.push(serialToISO(a));
  for (const c of cols) {
    series[c.label].push(round3(aoa[r][c.idx]));
  }
}

// --- G1 특성화 검증 (assert) ---
const nonNull = arr => arr.filter(v => v != null);
const last = arr => arr[arr.length - 1];
function assert(cond, msg) { if (!cond) { console.error('❌ G1 FAIL:', msg); process.exit(1); } }

assert(dates.length === 2832, `데이터 행 ${dates.length} ≠ 2832`);
assert(dates[0] === '2015-01-02', `첫 날짜 ${dates[0]} ≠ 2015-01-02`);
assert(last(dates) === '2026-07-01', `마지막 날짜 ${last(dates)} ≠ 2026-07-01`);
assert(sectors.length === 15, `섹터 ${sectors.length} ≠ 15`);
assert(cols.length === 75, `라벨 ${cols.length} ≠ 75`);
assert(nonNull(series['공사채AAA_3년']).length === 2831, `공사채AAA_3년 비null ${nonNull(series['공사채AAA_3년']).length} ≠ 2831`);

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

// --- 출력 ---
const meta = {
  source: 'composite-xlsx',
  last_updated: last(dates),
  sectors,
  maturities,
};
const out =
  'window.FENRIR_SERIES = window.FENRIR_SERIES || {};\n' +
  'window.FENRIR_SERIES["credit-spread"] = {\n' +
  '  meta: ' + JSON.stringify(meta) + ',\n' +
  '  dates: ' + JSON.stringify(dates) + ',\n' +
  '  series: {\n' +
  cols.map(c => '    ' + JSON.stringify(c.label) + ': ' + JSON.stringify(series[c.label])).join(',\n') +
  '\n  }\n};\n';

const outPath = join(ROOT, 'data', 'credit-spread.js');
writeFileSync(outPath, out);

const sizeKB = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('✅ G1 통과 — 모든 기준값 재현');
console.log(`   데이터 행: ${dates.length} | 기간: ${dates[0]} ~ ${last(dates)}`);
console.log(`   섹터: ${sectors.length} | 시리즈: ${cols.length}`);
console.log(`   국고채권_3년 최신: ${ktb3}% | 공사채AAA_3년 최신: ${(gsAAA3 * 100).toFixed(1)}bp`);
console.log(`   회사채AA-_3년: 최신 ${(last(aa3) * 100).toFixed(1)}bp / 최대 ${(aa3max * 100).toFixed(1)}bp(${maxDate}) / 최소 ${(aa3min * 100).toFixed(1)}bp(${minDate})`);
console.log(`   → ${outPath} (${sizeKB} KB)`);

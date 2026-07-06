// OO-1 파서/변환 특성화 테스트 — node --test (자동탐색)
//
// [라이선스] 실데이터(유료 민평)를 동결하지 않는다. 합성 fixture 만 사용:
// 가짜 종목 3개짜리 초소형 워크북을 메모리에서 만들어 SheetJS 로 왕복(write→read)한 뒤
// parseAoa/deriveGenerations/validateStructure 를 검증한다. 실데이터 앵커 검증은
// 커밋하지 않는 tests/local/ 로 분리(원본 xlsx 가 로컬에 있을 때만 실행).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  parseName, serialToISO, decompose,
  parseAoa, deriveGenerations, buildDataset, serialize, validateStructure,
} from '../js/onoff-parse.js';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.min.js');

// ISO 'YYYY-MM-DD' → Excel 시리얼(serialToISO 의 역). 합성 워크북 셀값 생성용.
const isoToSerial = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569;

// 합성 3종목 워크북 AOA (인포맥스 레이아웃 재현). col 0/2/4 = 종목, 값은 다음 열.
//   on   국고03000-2906(99-1)
//   off1 국고02000-2812(98-2)
//   off2 국고01000-2806(98-3)
// 의도적으로 섞음: 주말행(토), 중복일(후자 우선), NaN 수익률, 역순 입력.
const ON = '국고03000-2906(99-1)', OFF1 = '국고02000-2812(98-2)', OFF2 = '국고01000-2806(98-3)';

// [ISO, onY, off1Y, off2Y] — 값 셀은 없으면 null(빈칸)
const DAYS = [
  ['2024-01-03', 3.10, 3.00, 2.90], // Wed
  ['2024-01-02', 3.20, 3.05, 2.85], // Tue (역순 입력 → 정렬 확인)
  ['2024-01-01', 3.15, 3.00, 2.80], // Mon (day0)
  ['2024-01-06', 9.99, 9.99, 9.99], // Sat → 제거되어야 함
  ['2024-01-04', 3.00, 2.90, 2.88], // Thu, off2 는 결측(아래에서 null 처리)
];

function buildAoa() {
  const rows = [];
  rows[0] = ['시작', 1, '종료', 2, 'Data 개수', 5, '주기', '일'];
  rows[1] = [ON, null, OFF1, null, OFF2, null];
  rows[2] = ['일자', '민평3사 수익률(산출일)', '일자', '민평3사 수익률(산출일)', '일자', '민평3사 수익률(산출일)'];
  let r = 3;
  const put = (row, col, iso, y) => {
    if (iso == null) return;
    row[col] = isoToSerial(iso);
    row[col + 1] = (y == null ? NaN : y); // NaN → 파서가 스킵
  };
  for (const [iso, onY, o1, o2] of DAYS) {
    const row = [];
    put(row, 0, iso, onY);
    put(row, 2, iso, o1);
    // 2024-01-04 는 off2 결측(NaN) → 해당 세대 계열에서 그 날 제외되는지 확인
    put(row, 4, iso, iso === '2024-01-04' ? null : o2);
    rows[r++] = row;
  }
  // 중복일: 2024-01-03 을 나중 행에 다른 값으로 → 후자 우선 확인
  const dup = [];
  put(dup, 0, '2024-01-03', 3.11);
  put(dup, 2, '2024-01-03', 3.01);
  put(dup, 4, '2024-01-03', 2.91);
  rows[r++] = dup;
  return rows;
}

// 합성 AOA → SheetJS 왕복 → sheet_to_json(raw). 실제 xlsx 읽기 경로(시리얼 처리) 포함.
function roundTripAoa() {
  const ws = XLSX.utils.aoa_to_sheet(buildAoa());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const wb2 = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb2.Sheets['Sheet1'], { header: 1, raw: true });
}

test('parseName — 종목명 분해', () => {
  assert.deepEqual(parseName('국고03500-2906(26-5)'), { coupon: 3.5, maturity: '2029-06', tag: '26-5' });
  assert.deepEqual(parseName('국고00875-2312(20-8)'), { coupon: 0.875, maturity: '2023-12', tag: '20-8' });
  assert.equal(parseName('쓰레기'), null);
});

test('serialToISO / decompose 기본', () => {
  assert.equal(serialToISO(isoToSerial('2026-07-06')), '2026-07-06');
  // raw=(3.10-3.00)*100=10, slope=(3.00-2.90)*100=10, fly=0
  assert.deepEqual(decompose(3.10, 3.00, 2.90), { raw: 10, slope: 10, fly: 0 });
  // 부동소수점 노이즈 정규화: (3.15-3.00)=0.150000…*100 → 15.0
  assert.deepEqual(decompose(3.15, 3.00, 2.80), { raw: 15, slope: 20, fly: -5 });
});

test('parseAoa — 주말 제거·중복 후자·NaN 스킵·정렬', () => {
  const { bonds } = parseAoa(roundTripAoa());
  assert.equal(bonds.length, 3);
  const on = bonds[0];
  assert.equal(on.tag, '99-1');
  const dates = on.series.map(s => s[0]);
  // 주말(01-06) 제거, 오름차순 정렬, 중복(01-03) 후자 우선
  assert.deepEqual(dates, ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']);
  assert.equal(on.series.find(s => s[0] === '2024-01-03')[1], 3.11); // 후자 값
  // off2 는 01-04 결측(NaN) → 그 날 없음
  const off2dates = bonds[2].series.map(s => s[0]);
  assert.ok(!off2dates.includes('2024-01-04'), 'off2 는 01-04 결측');
});

test('deriveGenerations — 세대 1개·결측일 제외·raw/slope/fly', () => {
  const { bonds } = parseAoa(roundTripAoa());
  const gens = deriveGenerations(bonds);
  assert.equal(gens.length, 1, '구구지표까지 있는 세대는 1개(off2 가 마지막 종목)');
  const g = gens[0];
  assert.equal(g.tag, '99-1'); assert.equal(g.vs, '98-2'); assert.equal(g.slopeVs, '98-3');
  assert.equal(g.maturity, '2029-06'); assert.equal(g.start, '2024-01-01');
  // 01-04 는 off2 결측 → 계열에서 제외 → 3행만
  assert.deepEqual(g.series.map(s => s[0]), ['2024-01-01', '2024-01-02', '2024-01-03']);
  // day0: on 3.15/off1 3.00/off2 2.80 → raw 15, slope 20, fly -5
  assert.deepEqual(g.series[0].slice(1), [15, 20, -5]);
  // day2(중복 후자): on 3.11/off1 3.01/off2 2.91 → raw 10, slope 10, fly 0
  assert.deepEqual(g.series[2].slice(1), [10, 10, 0]);
});

test('buildDataset + serialize + validateStructure 왕복', () => {
  const ds = buildDataset(roundTripAoa());
  assert.equal(ds.tenor, '3Y');
  assert.equal(ds.updated, '2024-01-03'); // 세대 계열 최신일
  // 세대 수 하한(8) 미만이므로 실데이터 검증은 실패해야 정상(합성은 1세대)
  assert.throws(() => validateStructure(ds), /세대 수/);
  // 직렬화 텍스트는 파생 스프레드만 담고 원본 수익률(3.15 등)은 포함하지 않는다
  const txt = serialize(ds);
  assert.ok(txt.startsWith('window.ONOFF_KTB3Y = {'));
  assert.ok(!/3\.15|3\.11|2\.80/.test(txt), '원본 수익률이 직렬화에 노출되면 안 됨');
});

// run.mjs — RG 캘리브레이션 실행 엔트리(node). 파일 I/O·SheetJS 로드만 담당.
// 순수 로직은 calibrate.mjs, 파싱은 series-parse.mjs. 산출: data/rg-calib.js + 콘솔 리포트.
//
// 실행: node tools/rg-calibration/run.mjs [커브xlsx파일명]
// 사전: 아래 CONFIG 의 컬럼 라벨을 실제 입력 파일 헤더에 맞춘다(파일 수령 후 확정).
//
// [소스 전략]
//   커브(국고 8구간): CONFIG.curveXlsx 의 시트에서 parseWideAoa → pickSeries.
//   금리축·대표 스프레드·6섹터: 기본은 기존 data/credit-spread.js 재사용(SECTORS_FROM='credit-spread').
//     새 xlsx 에 스프레드가 함께 오면 SECTORS_FROM='xlsx' 로 바꾸고 매핑을 채운다.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseWideAoa, pickSeries, fenrirToMaps } from './series-parse.mjs';
import { calibrate, serialize, TENORS } from './calibrate.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('../../vendor/xlsx.min.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — 입력 파일 수령 후 이 블록만 실제 헤더에 맞게 수정한다.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // 국고 8구간 커브 xlsx (필수). 파일명 미지정 시 루트에서 'curve'|'국고' 포함 xlsx 자동 탐색.
  curveXlsx: process.argv[2] || 'Rg curve input.xlsx',
  curveSheet: null,          // null → 첫 시트(Sheet1).
  headerRow: 0,              // row0 = [날짜, 3M, 6M, 9M, 1Y, 1.5Y, 2Y, 2.5Y, 3Y, 4Y, 5Y, 7Y]
  dateCol: 0,
  dataStartRow: null,        // null → headerRow+1 (row1~)
  // 논리 구간키 → 실제 헤더 라벨(양식 그대로 bare). 8구간 필요, 9M·4Y·7Y 는 미사용.
  curveMap: {
    '3M': '3M', '6M': '6M', '1Y': '1Y', '1.5Y': '1.5Y',
    '2Y': '2Y', '2.5Y': '2.5Y', '3Y': '3Y', '5Y': '5Y',
  },

  // 금리축·국고섹터는 커브 3Y 로(9셀 금리 방향 ↔ medianCurves 3Y 구간 정합). 스프레드·5섹터는 composite.
  rateFromCurve: true,       // true → rate 축 = curve['3Y'], 국고채 섹터 = curve['3Y']
  SECTORS_FROM: 'credit-spread',

  // (SECTORS_FROM='credit-spread') 대표 스프레드 + 신용 5섹터 3Y 라벨.
  creditMap: {
    spread: '회사채AA-_3년',    // 대표 스프레드축(§6: 회사채 AA- 3Y)
    sectors: {                  // RG-3 신용 5섹터(국고채는 rateFromCurve 로 별도)
      공사채: '공사채AAA_3년',
      은행채: '은행채AAA_3년',
      회사채: '회사채AA-_3년',
      카드채: '카드채AA+_3년',
      여전채: '여전채AA-_3년',
    },
  },

  // (SECTORS_FROM='xlsx' 일 때) 커브 xlsx 안의 스프레드 헤더 매핑(위 creditMap 과 동일 구조).
  xlsxSpreadMap: null,
};
// ─────────────────────────────────────────────────────────────────────────────

function loadCurveAoa() {
  let name = CONFIG.curveXlsx;
  if (!name) {
    const xs = readdirSync(ROOT).filter(f => f.endsWith('.xlsx'));
    name = xs.find(f => /curve|국고|커브|rg/i.test(f)) || null;
    if (!name) throw new Error('국고 커브 xlsx 를 찾지 못했습니다. 인자로 파일명 지정: node tools/rg-calibration/run.mjs <파일명>');
  }
  const wb = XLSX.read(readFileSync(join(ROOT, name)), { type: 'buffer' });
  const sheet = CONFIG.curveSheet || wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`시트 '${sheet}' 없음. 가용=${wb.SheetNames.join(', ')}`);
  return { name, sheet, aoa: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) };
}

function loadCreditSpread() {
  // data/credit-spread.js 는 window.FENRIR_SERIES 전역 할당 → node 에서 shim 후 eval.
  const txt = readFileSync(join(ROOT, 'data', 'credit-spread.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', txt)(sandbox.window);
  const cs = sandbox.window.FENRIR_SERIES && sandbox.window.FENRIR_SERIES['credit-spread'];
  if (!cs) throw new Error('data/credit-spread.js 에서 FENRIR_SERIES["credit-spread"] 로드 실패');
  return cs;
}

function main() {
  const { name, sheet, aoa } = loadCurveAoa();
  const parsed = parseWideAoa(aoa, { headerRow: CONFIG.headerRow, dateCol: CONFIG.dateCol, dataStartRow: CONFIG.dataStartRow });
  const curve = pickSeries(parsed, CONFIG.curveMap);

  let rate, spread, sectors;
  if (CONFIG.SECTORS_FROM === 'credit-spread') {
    const cs = loadCreditSpread();
    const need = [CONFIG.creditMap.spread, ...Object.values(CONFIG.creditMap.sectors)];
    const maps = fenrirToMaps(cs, [...new Set(need)]);
    // 금리축·국고섹터 = 커브 3Y (medianCurves 3Y 구간과 동일 계열 → 분류 정합)
    rate = CONFIG.rateFromCurve ? curve['3Y'] : maps['국고채권_3년'];
    spread = maps[CONFIG.creditMap.spread];
    sectors = { 국고채: rate, ...Object.fromEntries(Object.entries(CONFIG.creditMap.sectors).map(([k, lbl]) => [k, maps[lbl]])) };
  } else {
    const m = CONFIG.xlsxSpreadMap;
    if (!m) throw new Error("SECTORS_FROM='xlsx' 인데 xlsxSpreadMap 미설정");
    const picked = pickSeries(parsed, { rate: m.rate, spread: m.spread, ...m.sectors });
    rate = picked.rate; spread = picked.spread;
    sectors = Object.fromEntries(Object.keys(m.sectors).map(k => [k, picked[k]]));
  }

  const { payload, report } = calibrate({
    curve, rate, spread, sectors,
    meta: { generatedAt: new Date().toISOString().slice(0, 10), source: { curve: name, sectors: CONFIG.SECTORS_FROM } },
  });

  const out = serialize(payload);
  const outPath = join(ROOT, 'data', 'rg-calib.js');
  writeFileSync(outPath, out);

  // ── 콘솔 리포트(phase1-report.md 작성 재료) ──
  console.log(`✅ 캘리브레이션 완료 — 커브 ${name} (${sheet}), 섹터=${CONFIG.SECTORS_FROM}`);
  console.log(`   공통 관측 ${report.common}일, 매칭 앵커 ${report.matched}개, 기간 ${report.firstDate} ~ ${report.lastDate}`);
  console.log('\n[밴드 (bp)]');
  const b = payload.bands;
  console.log(`   ktb3y    σ=${b.ktb3y.sigmaBp}  band=±${b.ktb3y.bandBp}  (n=${b.ktb3y.n})`);
  console.log(`   repSpread σ=${b.repSpread.sigmaBp} band=±${b.repSpread.bandBp} (n=${b.repSpread.n})`);
  for (const [k, v] of Object.entries(b.sectors)) console.log(`   ${k}  σ=${v.sigmaBp} band=±${v.bandBp} (n=${v.n})`);
  console.log('\n[셀별 표본수 · 소스레벨]');
  for (const [key, c] of Object.entries(payload.medianCurves.cells)) console.log(`   ${key.padEnd(14)} n=${String(c.n).padStart(5)}  ${c.source}`);
  console.log(`   행 주변부: ${JSON.stringify(payload.medianCurves.rows)}  전역 n=${payload.medianCurves.globalN}`);
  if (report.fallbacks.length) {
    console.log('\n[폴백 발동 셀]');
    for (const f of report.fallbacks) console.log(`   ${f.cell.padEnd(14)} n=${f.n} → ${f.source}`);
  } else console.log('\n[폴백 발동 셀] 없음(모든 셀 ≥ MIN_CELL_N)');
  console.log(`\n   → ${outPath} (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB)`);
  console.log('   검수: node tools/rg-calibration/verify-no-raw.mjs 로 원시 레벨 부재 확인');
}

main();

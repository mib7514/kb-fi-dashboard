// composite xlsx → data/credit-spread.js 변환기 (node)
// 파싱·직렬화·G1검증은 js/credit-parse.js 공유 모듈에 위임 — admin 브라우저 파서와
// 동일 로직을 써 산출물이 바이트 동일함을 보장한다(날짜 TZ 보정·3자리 반올림 포함).
// 이 파일은 파일 I/O와 SheetJS 로드(node)만 담당한다.
//
// 실행: node tools/convert-composite.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAoa, serialize, validateStructure } from '../js/credit-parse.js';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.min.js'); // UMD 번들 재사용 (node에서 require 가능)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- 파일 로드 → SheetJS AOA (admin과 동일한 raw:true 추출) ---
const xlsxName = readdirSync(ROOT).find(f => f.endsWith('.xlsx'));
if (!xlsxName) { console.error('❌ 레포 루트에 .xlsx 파일이 없습니다.'); process.exit(1); }
const wb = XLSX.read(readFileSync(join(ROOT, xlsxName)), { type: 'buffer' });
const ws = wb.Sheets['spread'];
if (!ws) { console.error('❌ 시트 `spread` 없음.'); process.exit(1); }
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

// --- 공유 모듈로 파싱·검증·직렬화 ---
const parsed = parseAoa(aoa);
let stats;
try {
  stats = validateStructure(parsed);
} catch (err) {
  console.error('❌ ' + err.message);
  process.exit(1);
}
const out = serialize(parsed);

const outPath = join(ROOT, 'data', 'credit-spread.js');
writeFileSync(outPath, out);

const sizeKB = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('✅ 구조 검증 통과');
console.log(`   데이터 행: ${stats.rows} | 기간: ${stats.first} ~ ${stats.last}`);
console.log(`   섹터: ${stats.sectors} | 시리즈: ${stats.cols}`);
console.log(`   국고채권_3년 최신: ${stats.ktb3}% | 공사채AAA_3년 최신: ${(stats.gsAAA3 * 100).toFixed(1)}bp`);
console.log(`   → ${outPath} (${sizeKB} KB)`);

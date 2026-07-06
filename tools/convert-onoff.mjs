// 인포맥스 종목별 민평 xlsx → data/onoff-ktb3y.js 변환기 (node)
// 파싱·변환·직렬화·검증은 js/onoff-parse.js 공유 모듈에 위임 — onoff-admin 브라우저 파서와
// 동일 로직을 써 산출물이 바이트 동일함을 보장한다(세대 정렬·스프레드 산출 포함).
// 이 파일은 파일 I/O·SheetJS 로드(node)만 담당한다. 원본 xlsx 는 .gitignore(*.xlsx)로 커밋 금지.
//
// 실행: node tools/convert-onoff.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDataset, serialize, validateStructure } from '../js/onoff-parse.js';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.min.js'); // UMD 번들 재사용 (node에서 require 가능)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 루트에 xlsx 가 여럿(크레딧 composite 등) → 종목별 민평 파일만 고른다.
// 파일명에 '지표' 또는 'ktb3y' 포함, 아니면 Sheet1 row1 이 '국고…(태그)' 인 파일.
function pickXlsx() {
  const xs = readdirSync(ROOT).filter(f => f.endsWith('.xlsx'));
  const byName = xs.find(f => /지표|ktb3y/i.test(f));
  if (byName) return byName;
  for (const f of xs) {
    try {
      const wb = XLSX.read(readFileSync(join(ROOT, f)), { type: 'buffer' });
      const ws = wb.Sheets['Sheet1'];
      if (!ws) continue;
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      if ((aoa[1] || []).some(v => typeof v === 'string' && /^국고\d{5}-\d{4}\(\d{2}-\d+\)/.test(v))) return f;
    } catch { /* skip */ }
  }
  return null;
}

const xlsxName = pickXlsx();
if (!xlsxName) { console.error('❌ 루트에서 종목별 민평 xlsx 를 찾지 못했습니다.'); process.exit(1); }

const wb = XLSX.read(readFileSync(join(ROOT, xlsxName)), { type: 'buffer' });
const ws = wb.Sheets['Sheet1'];
if (!ws) { console.error('❌ 시트 `Sheet1` 없음.'); process.exit(1); }
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

const dataset = buildDataset(aoa);
let stats;
try {
  stats = validateStructure(dataset);
} catch (err) {
  console.error('❌ ' + err.message);
  process.exit(1);
}
const out = serialize(dataset);

const outPath = join(ROOT, 'data', 'onoff-ktb3y.js');
writeFileSync(outPath, out);

const sizeKB = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('✅ 구조 검증 통과 —', xlsxName);
console.log(`   세대 수: ${stats.nGen} | updated: ${stats.updated}`);
const c = stats.current;
console.log(`   현재 세대 ${c.tag} (vs ${c.vs}, slope vs ${c.slopeVs}): ${c.rows}행 ${c.first} ~ ${c.last}`);
console.log(`   현재 fly ${c.fly}bp (raw ${c.raw} / slope ${c.slope})`);
console.log(`   → ${outPath} (${sizeKB} KB)`);

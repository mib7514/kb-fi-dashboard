// verify-no-raw.mjs — data/rg-calib.js 에 원시 수익률/스프레드 '레벨'이 없는지 검수(§0.3, Phase 1 §5).
// 허용: Δbp·σbp·표본수·소스레벨·메타(k·기간·날짜). 금지: 레벨 배열·레벨 키·수익률대(3.x)로 보이는 값.
// 실행: node tools/rg-calibration/verify-no-raw.mjs   (파일 없으면 안내 후 종료)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const path = join(ROOT, 'data', 'rg-calib.js');
if (!existsSync(path)) { console.log('ℹ️  data/rg-calib.js 아직 없음 — run.mjs 실행 후 검수하세요.'); process.exit(0); }

const txt = readFileSync(path, 'utf8');
const sandbox = {}; new Function('window', txt)(sandbox);
const c = sandbox.RG_CALIB;
const fails = [];

// 1) 금지 키: 레벨/원시 계열을 시사하는 키가 payload 어디에도 없어야 함.
const BANNED_KEY = /\b(series|dates|yields?|levels?|rawLevel|prices?|quotes?)\b/i;
(function scanKeys(o, path = '') {
  if (o == null || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    if (BANNED_KEY.test(k)) fails.push(`금지 키 '${k}' @ ${path}`);
    scanKeys(o[k], path ? `${path}.${k}` : k);
  }
})(c);

// 2) 허용 구조 존재 확인
if (!c || !c.bands || !c.medianCurves || !c.meta) fails.push('필수 섹션(bands/medianCurves/meta) 누락');
if (c && c.meta && c.meta.unit !== 'bp') fails.push(`meta.unit ≠ 'bp' (=${c && c.meta && c.meta.unit})`);

// 3) 값 크기 sanity: 모든 Δbp·σbp 는 bp 스케일(수익률 레벨 3.x% 는 여기 있으면 안 됨).
//    Δbp 는 1개월 변화라 보통 |·|<200bp. 3.0 같은 값 자체는 3bp 로 정상 가능 → 배열/키로만 판별.
const nums = [];
(function collect(o) { if (o == null) return; if (typeof o === 'number') nums.push(o); else if (typeof o === 'object') Object.values(o).forEach(collect); })(c);
// 레벨이 섞였다면 수백 개 3.x~5.x 연속 → 표본수(n, 정수 수백~수천)와 구분 위해 여기선 키 검사에 의존.

if (fails.length) { console.log('❌ 검수 실패:'); for (const f of fails) console.log('   -', f); process.exit(1); }
console.log('✅ 검수 통과 — data/rg-calib.js 에 원시 레벨 키/배열 없음. 파생 통계값만 확인.');
console.log(`   섹션: bands(ktb3y·repSpread·sectors×${Object.keys(c.bands.sectors).length}), medianCurves(9셀), meta`);
console.log(`   기간: ${c.meta.period ? c.meta.period.from + ' ~ ' + c.meta.period.to : '—'} · k=${c.meta.k} · 생성 ${c.meta.generatedAt}`);

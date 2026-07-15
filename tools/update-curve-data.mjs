// update-curve-data.mjs — 커브 데이터 갱신 원커맨드 (convert + backtest 통합, node).
//   레포 루트의 만기확장 xlsx → data/credit-spread.js (convert-composite) →
//   data/curve-rv-backtest.js (build-backtest) 순으로 재생성한다. 두 산출물의
//   meta.last_updated가 어긋나면(예: backtest만 구버전) 대시보드 기준일이 불일치하므로
//   마지막에 일치를 검증하고, 불일치면 비정상 종료한다.
//
//   구조 판단: 인제스트(convert)와 백테스트(build)는 관심사가 달라 별도 스크립트로 유지하되,
//   "xlsx 하나 새로 받았을 때 손으로 두 번 돌리다 backtest 재실행을 빠뜨리는" 재발을 막으려고
//   순차 실행 + 정합성 검증만 얹는 얇은 래퍼다. 각 단계 로직은 원본 스크립트에 그대로 위임한다.
//
// 실행: node tools/update-curve-data.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TOOLS, '..');

// --- 단계 실행: 실패(비정상 종료코드) 시 즉시 중단 ---
function step(label, script) {
  console.log(`\n▶ ${label} (node tools/${script})`);
  const r = spawnSync(process.execPath, [join(TOOLS, script)], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error(`❌ ${label} 실패 (exit ${r.status ?? 'signal ' + r.signal}). 중단.`);
    process.exit(1);
  }
}

// --- 산출물에서 meta.last_updated 추출 (window 전역 로드 없이 파일 텍스트에서 직접) ---
function lastUpdated(relPath) {
  const txt = readFileSync(join(ROOT, relPath), 'utf8');
  const m = txt.match(/"last_updated":"([0-9-]+)"/);
  if (!m) { console.error(`❌ ${relPath}: last_updated 파싱 실패.`); process.exit(1); }
  return m[1];
}

step('인제스트: composite xlsx → credit-spread.js', 'convert-composite.mjs');
step('백테스트: credit-spread.js → curve-rv-backtest.js', 'build-backtest.mjs');

// --- 정합성 검증: 두 기준일 일치 ---
const spreadDate = lastUpdated('data/credit-spread.js');
const backtestDate = lastUpdated('data/curve-rv-backtest.js');
if (spreadDate !== backtestDate) {
  console.error(`\n❌ 기준일 불일치: credit-spread=${spreadDate} vs curve-rv-backtest=${backtestDate}. 비정상 종료.`);
  process.exit(1);
}
console.log(`\n✅ 갱신 완료 · 기준일 일치 ${spreadDate} (credit-spread · curve-rv-backtest)`);

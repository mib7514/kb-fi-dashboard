// vol-termstructure.mjs — σ(스프레드 변동성) 텀스트럭처 감사 (출력 전용, node).
//   커브 RV의 vol_adjusted 순위(색·순위 = base/σ_h)가 "실저변동"을 재는지 "준동결 압축"을 재는지
//   데이터 갱신 시점마다 재검증하는 도구. audit-curve-nodes와 같은 지위의 감사 스크립트.
//
//   출력: 14섹터×10만기 σ_1개월(bp) + 250d 스테일 비율 매트릭스. ⚠ = σ(4년|5년) < σ(2년)×0.7
//   (역-텀스트럭처: 장기물 σ가 2년보다 30%+ 낮음). ⚠ 셀을 스테일 구간별로 집계.
//
//   판정 규칙(2026-07-16 등록): ⚠가 스테일 0~5% 셀에서도 광범위하면 실저변동(→게이트 유지),
//   스테일 10%+에만 집중이면 준동결 압축(→STALE_HEAVY_RATIO 조임). 최초 판정=Rule B(4년 ×0.5
//   실저변동 확증, 게이트 20 유지). 재실행 시 이 근거가 유지되는지 확인용.
//
// 실행: node tools/vol-termstructure.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
await import(pathToFileURL(join(ROOT, 'data', 'credit-spread.js')).href);
const C = await import(pathToFileURL(join(ROOT, 'js', 'curve-rv-calc.js')).href);
const { staleMask, combineMask, spreadVol, staleRatio } = C;

const D = globalThis.window.FENRIR_SERIES['credit-spread'];
const { series, meta } = D;
const KTB = '국고채권';
const sectors = meta.sectors.filter(s => s !== KTB); // 14
const dispI = meta.nodes.map((n, i) => i).filter(i => meta.nodes[i] !== 10);
const mats = dispI.map(i => meta.maturities[i]); // 10
const bpOf = (lab) => (series[lab] || []).map(v => (v == null || !Number.isFinite(v)) ? null : v * 100);
const maskOf = (sec, mat) => {
  let m = staleMask(series[`${sec}_${mat}`] || []);
  if (mat === '3월') m = combineMask(m, staleMask(series[`${KTB}_3월`] || []));
  return m;
};

// 셀별 σ_1M·스테일% 계산
const sig = {}, stl = {};
for (const sec of sectors) { sig[sec] = {}; stl[sec] = {};
  for (const mat of mats) {
    const bp = bpOf(`${sec}_${mat}`), mk = maskOf(sec, mat);
    sig[sec][mat] = spreadVol(bp, mk, 1);        // h=1개월
    stl[sec][mat] = staleRatio(bp, mk, '1y');    // 250d
  }
}

// ⚠ 판정: σ(4년|5년) < σ(2년)×0.7
const warn = {}; const warnCells = [];
for (const sec of sectors) { warn[sec] = {};
  const s2 = sig[sec]['2년'];
  for (const mat of ['4년', '5년']) {
    const sc = sig[sec][mat];
    const w = (s2 != null && sc != null && sc < s2 * 0.7);
    warn[sec][mat] = w;
    if (w) warnCells.push({ sec, mat, sig: sc, s2, ratio: sc / s2, stale: stl[sec][mat] });
  }
}

const pad = (s, n) => String(s).padStart(n);
const padE = (s, n) => String(s).padEnd(n);
const fS = (v) => v == null ? '   —' : pad(v.toFixed(1), 4);
const fP = (v) => v == null ? '  —' : pad(Math.round(v), 3);

console.log('════ σ_1개월(bp) 텀스트럭처 — ⚠=σ(4/5년)<σ(2년)×0.7 ════');
console.log(padE('섹터', 9) + mats.map(m => pad(m, 6)).join(''));
for (const sec of sectors) {
  const row = mats.map(m => pad(fS(sig[sec][m]) + (warn[sec][m] ? '⚠' : ' '), 6)).join('');
  console.log(padE(sec, 9) + row);
}

console.log('\n════ 250d 스테일 비율(%) — 동일 격자 ════');
console.log(padE('섹터', 9) + mats.map(m => pad(m, 6)).join(''));
for (const sec of sectors) {
  console.log(padE(sec, 9) + mats.map(m => pad(fP(stl[sec][m]), 6)).join(''));
}

// ⚠ 셀 스테일 구간 집계
const b0 = warnCells.filter(x => x.stale != null && x.stale <= 5).length;
const b1 = warnCells.filter(x => x.stale != null && x.stale > 5 && x.stale < 10).length;
const b2 = warnCells.filter(x => x.stale != null && x.stale >= 10).length;
console.log(`\n════ ⚠ 셀 ${warnCells.length}개 — 스테일 구간 분포 ════`);
console.log(`  스테일 ≤5%: ${b0}  ·  5~10%: ${b1}  ·  ≥10%: ${b2}`);
console.log('  (Rule B 판정 근거: ≤5% 구간에 ⚠가 광범위 = 실저변동. 이 값이 크게 줄면 재논의)');
console.log('  ⚠ 셀 상세 (σ / σ2년 / 비율 / 스테일%):');
warnCells.sort((a, b) => (b.stale ?? 0) - (a.stale ?? 0)).forEach(x =>
  console.log(`   ${padE(x.sec + ' ' + x.mat, 16)} σ=${x.sig.toFixed(2)} / σ2y=${x.s2.toFixed(2)} / ×${x.ratio.toFixed(2)} / 스테일 ${x.stale == null ? '—' : Math.round(x.stale) + '%'}`));

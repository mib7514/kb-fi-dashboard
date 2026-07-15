// test-curve-rv-ui.js — 커브 RV Phase 2 스모크 + 스크린샷 대체 (node, DOM 무관).
//   게이트 2(히트맵/드릴다운/스테일 조립) + 게이트 3(상위5·하위5·스테일 셀 표).
// 실행: node tools/test-curve-rv-ui.js

const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = join(__dirname, '..');
const f = (x, d = 0) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 && d === 0 ? '+' : '') + x.toFixed(d));

async function main() {
  globalThis.window = {};
  await import(pathToFileURL(join(ROOT, 'data', 'credit-spread.js')).href);
  const H = await import(pathToFileURL(join(ROOT, 'js', 'rv-heatmap.js')).href);
  const DATA = globalThis.window.FENRIR_SERIES['credit-spread'];
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`); } };

  console.log('════ 게이트 2: 히트맵/드릴다운/스테일 스모크 ════');
  const credit = DATA.meta.sectors.filter(s => s !== '국고채권');
  t('excess 히트맵 차원 = (1+14)×10, 10년 제외', () => {
    const hd = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1 });
    assert.equal(hd.rows.length, 15);
    assert.equal(hd.cols.length, 10);
    assert.ok(!hd.cols.includes('10년'), '10년 표시 제외');
    assert.equal(hd.rows[0], '국고채권');
    assert.ok(hd.value.slice(1).flat().some(v => v != null), 'excess 값 존재');
  });
  t('pctile 히트맵 %ile ∈ [0,100]', () => {
    const hd = H.buildHeatmap(DATA, { mode: 'pctile', horizonMonths: 1 });
    for (const v of hd.value.slice(1).flat()) if (v != null) assert.ok(v >= 0 && v <= 100);
  });
  t('호라이즌 3·6개월 조립', () => {
    for (const hz of [3, 6]) { const hd = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: hz }); assert.ok(hd.value.flat().some(v => v != null)); }
  });
  t('국고 행 zColor=null(무채색)', () => {
    const hd = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1 });
    assert.ok(hd.zColor[0].every(z => z == null));
  });
  let staleCells = [];
  t('스테일 셀이 실제로 존재(저등급 장기 예상)', () => {
    const hd = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1 });
    for (let r = 1; r < hd.rows.length; r++) for (let c = 0; c < hd.cols.length; c++)
      if (hd.stale[r][c]) staleCells.push(`${hd.rows[r]} ${hd.cols[c]}`);
    assert.ok(staleCells.length > 0, '스테일 셀 0개 — 표시 로직 확인 필요');
  });
  t('드릴다운: 3 호라이즌 + 히스토리 + 스테일', () => {
    const d = H.buildDrilldown(DATA, '공사채AAA', '3년');
    assert.equal(d.horizons.length, 3);
    assert.ok(Number.isFinite(d.spreadBp) && d.history.dates.length > 200);
    const dk = H.buildDrilldown(DATA, '국고채권', '3년'); // 국고 참조행도 동작
    assert.ok(dk.isKtb && Number.isFinite(dk.horizons[0].carry));
  });
  console.log(`게이트 2: pass ${pass} / fail ${fail}\n`);

  // ── 게이트 3: 스크린샷 대체 표 (excess h=1개월, 최신일) — 스테일·carryOnly 순위 제외 ──
  const hd = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1 });
  const ranked = [], excluded = [];
  for (let r = 1; r < hd.rows.length; r++) for (let c = 0; c < hd.cols.length; c++) {
    const v = hd.value[r][c];
    if (v == null || !Number.isFinite(v)) continue;
    const cell = { sec: hd.rows[r], mat: hd.cols[c], v, stale: hd.stale[r][c], co: hd.carryOnly[r][c] };
    if (cell.stale || cell.co) excluded.push(cell); else ranked.push(cell); // full-excess만 순위
  }
  const sorted = [...ranked].sort((a, b) => b.v - a.v);
  console.log('════ 게이트 3: 스크린샷 대체 (최신 ' + DATA.meta.last_updated + ', 1개월 기대수익 bp · 스테일/carryOnly 순위 제외) ════');
  console.log('▶ 상위 5셀 (초록):');
  sorted.slice(0, 5).forEach(x => console.log(`   ${x.sec} ${x.mat}: ${f(x.v)}bp`));
  console.log('▶ 하위 5셀 (무채색/적색):');
  sorted.slice(-5).reverse().forEach(x => console.log(`   ${x.sec} ${x.mat}: ${f(x.v)}bp`));
  console.log(`▶ 순위 제외 셀 ${excluded.length}개 (값 회색 표시만): 스테일 ${excluded.filter(x=>x.stale).length} / carryOnly† ${excluded.filter(x=>x.co).length}`);
  console.log('   스테일: ' + staleCells.join(', '));
  console.log('   carryOnly(†): ' + excluded.filter(x=>x.co).map(x=>`${x.sec} ${x.mat}`).slice(0,12).join(', ') + (excluded.filter(x=>x.co).length>12?' …':''));

  // 확인 포인트: 공사채AAA 2년이 1.5년 험프로 낮은 순위인지
  const gsRank = sorted.findIndex(x => x.sec === '공사채AAA' && x.mat === '2년');
  const gs2 = ranked.find(x => x.sec === '공사채AAA' && x.mat === '2년');
  console.log(`▶ 확인 포인트 — 공사채AAA 2년: ${f(gs2?.v)}bp · 순위 ${gsRank + 1}/${ranked.length} (하위권일수록 험프 영향 확인)`);

  console.log('');
  console.log(fail === 0 ? '✅ 게이트 2 전 통과' : `⛔ 게이트 2 실패 ${fail}건`);
  if (fail) process.exit(1);
}
main().catch(e => { console.error('실패:', e.stack || e.message); process.exit(1); });

// test-phase3.js — 커브 RV Phase 3 검증 (node). 에피소드 카운팅·ΔS 재계산·상호배제 테스트
//   + 표 출력(시나리오 +10bp 상위/하위 변화, 평균회귀 게이트 커버리지).
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = join(__dirname, '..');
const f0 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(0));

async function main() {
  globalThis.window = {};
  await import(pathToFileURL(join(ROOT, 'data', 'credit-spread.js')).href);
  await import(pathToFileURL(join(ROOT, 'data', 'curve-rv-backtest.js')).href);
  const BTmod = await import(pathToFileURL(join(ROOT, 'js', 'rv-backtest.js')).href);
  const H = await import(pathToFileURL(join(ROOT, 'js', 'rv-heatmap.js')).href);
  const UI = await import(pathToFileURL(join(ROOT, 'js', 'rv-ui.js')).href);
  const DATA = window.FENRIR_SERIES['credit-spread'];
  const BT = window.FENRIR_SERIES['curve-rv-backtest'].data;
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`); } };

  console.log('════ Phase 3 테스트 ════');
  // 에피소드 ① 연속 동일 버킷 압축: 단조 증가 → 버킷당 1 에피소드
  t('에피소드 압축: 단조 증가 → 버킷당 1', () => {
    const sp = Array.from({ length: 30 }, (_, i) => i + 1);
    const mask = new Array(30).fill(false);
    const s = BTmod.episodeStats(sp, mask, 1);
    assert.equal(s.low.n, 1); assert.equal(s.mid.n, 1); assert.equal(s.high.n, 1); // 긴 런=1 에피소드
  });
  // 에피소드 ② null(스테일)이 런을 끊어 2 에피소드
  t('에피소드: 스테일 null이 런 분할', () => {
    const sp = [1, 1, 1, 1, 1, 1]; const mask = [false, false, true, false, false, false];
    const s = BTmod.episodeStats(sp, mask, 1);
    assert.equal(s.high.n, 2); assert.equal(s.low.n, 0); assert.equal(s.mid.n, 0);
  });
  // ΔS 재계산: uniform +10bp → 표시값 = base − 10×(m−h), 색(zColor) 불변
  t('ΔS 재계산: +10bp → base − 10×(m−h), 색 불변', () => {
    const base = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1 });
    const scen = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1, scenario: { mode: 'uniform', uniform: 10, perSector: {} } });
    const r = base.rows.indexOf('회사채BBB+'), c = base.cols.indexOf('2년');
    const m = base.colsYears[c], h = 1 / 12;
    assert.ok(Math.abs(scen.value[r][c] - (base.value[r][c] - 10 * (m - h))) < 1e-6, 'ΔS 반영값');
    assert.equal(scen.zColor[r][c], base.zColor[r][c]); // 색·순위 불변(전제)
  });
  // 상호배제: 시나리오 활성 → meanRev 강제 off
  t('상호배제: 시나리오 활성 시 meanRev off', () => {
    const o1 = UI.resolveHeatmapOpts({ mode: 'excess', horizon: 1, scenario: { mode: 'uniform', uniform: 10, perSector: {} }, meanRev: true }, BT);
    assert.equal(o1.meanRev, false); assert.equal(o1.scenario.mode, 'uniform');
    const o2 = UI.resolveHeatmapOpts({ mode: 'excess', horizon: 1, scenario: { mode: 'none', perSector: {} }, meanRev: true }, BT);
    assert.equal(o2.meanRev, true); assert.equal(o2.scenario, null);
  });
  console.log(`테스트: pass ${pass} / fail ${fail}\n`);

  // ── 표 ①: 시나리오 전 섹터 +10bp, h=1개월 상위/하위 5셀 변화 ──
  const base = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1 });
  const scen = H.buildHeatmap(DATA, { mode: 'excess', horizonMonths: 1, scenario: { mode: 'uniform', uniform: 10, perSector: {} } });
  const collect = (hd) => { const a = []; for (let r = 1; r < hd.rows.length; r++) for (let c = 0; c < hd.cols.length; c++) { const v = hd.value[r][c]; if (v != null && !hd.stale[r][c] && !hd.carryOnly[r][c]) a.push({ sec: hd.rows[r], mat: hd.cols[c], v }); } return a.sort((x, y) => y.v - x.v); };
  const b5 = collect(base), s5 = collect(scen);
  console.log('════ 표 ①: 시나리오 전 섹터 +10bp (h=1개월) — 스프레드 확대 → 기대수익 하락 ════');
  console.log('  [불변] 상위5: ' + b5.slice(0, 5).map(x => `${x.sec} ${x.mat} ${f0(x.v)}`).join(' · '));
  console.log('  [+10bp] 상위5: ' + s5.slice(0, 5).map(x => `${x.sec} ${x.mat} ${f0(x.v)}`).join(' · '));
  console.log('  [불변] 하위5: ' + b5.slice(-5).reverse().map(x => `${x.sec} ${x.mat} ${f0(x.v)}`).join(' · '));
  console.log('  [+10bp] 하위5: ' + s5.slice(-5).reverse().map(x => `${x.sec} ${x.mat} ${f0(x.v)}`).join(' · '));

  // ── 표 ②: 평균회귀 게이트 커버리지 (셀×호라이즌 제공/미제공) ──
  console.log('\n════ 표 ②: 평균회귀 게이트 커버리지 (버킷당 에피소드 ≥5) ════');
  const cells = Object.keys(BT);
  for (const hh of [1, 3, 6]) {
    let provCells = 0, provBuckets = 0, failBuckets = 0;
    for (const lab of cells) {
      const st = BT[lab][hh]; if (!st) continue;
      const prov = ['low', 'mid', 'high'].filter(b => st[b]).length;
      if (prov > 0) provCells++;
      provBuckets += prov; failBuckets += (3 - prov);
    }
    console.log(`  h=${hh}개월: 제공 셀 ${provCells}/${cells.length} · 제공 버킷 ${provBuckets} · 게이트미달 버킷 ${failBuckets}`);
  }
  console.log(`  (만기≤3년·스테일<30%만 대상 ${cells.length}셀. 4·5년·과다스테일 셀은 애초 미제공)`);

  console.log('');
  console.log(fail === 0 ? '✅ Phase 3 테스트 전 통과' : `⛔ Phase 3 실패 ${fail}건`);
  if (fail) process.exit(1);
}
main().catch(e => { console.error('실패:', e.stack || e.message); process.exit(1); });

// build-backtest.mjs — 커브 RV 평균회귀 백테스트 사전계산 → data/curve-rv-backtest.js (node).
//   구조 판단: convert-composite에 합치지 않고 별도 스크립트 — 인제스트(민평 파싱)와
//   백테스트(계산)는 관심사가 다르고, 백테스트만 재계산하는 경우가 잦다. data/credit-spread.js
//   생성 후 실행. 산출물에 wall-clock 금지(asof=데이터 최신일).
//
// 명세: 섹터 × 만기(≤3년) × 호라이즌(1/3/6개월). 스테일 비율<30% 셀만. 스테일 제외 모수
//   full %ile 3버킷(저≤33/중/고≥67). 에피소드(연속 동일버킷) 진입일 forward Δ. 버킷당
//   독립 에피소드 <5면 미제공. 실행: node tools/build-backtest.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STALE_MAX = 30, MIN_EPISODES = 5, MAT_MAX = 3;
const r1 = (x) => (x == null || !Number.isFinite(x)) ? null : Math.round(x * 10) / 10;

async function main() {
  globalThis.window = {};
  await import(pathToFileURL(join(ROOT, 'data', 'credit-spread.js')).href);
  const { staleMask, combineMask } = await import(pathToFileURL(join(ROOT, 'js', 'curve-rv-calc.js')).href);
  const { episodeStats, applyGate, staleRatioFull, FWD_DAYS } = await import(pathToFileURL(join(ROOT, 'js', 'rv-backtest.js')).href);

  const D = globalThis.window.FENRIR_SERIES['credit-spread'];
  const { dates, series, meta } = D;
  const creditSectors = meta.sectors.filter(s => s !== '국고채권');
  const subMats = meta.nodes.map((n, i) => ({ n, mat: meta.maturities[i] })).filter(x => x.n <= MAT_MAX);
  const bpArr = (lab) => (series[lab] || []).map(v => (v == null || !Number.isFinite(v)) ? null : v * 100);

  const data = {};
  let provided = 0, excludedStale = 0, gateFail = 0;
  const coverage = {}; // {h: {provided, gateFail, staleExcl}}
  for (const h of [1, 3, 6]) coverage[h] = { provided: 0, gateFail: 0, staleExcl: 0 };

  for (const sec of creditSectors) {
    for (const { mat } of subMats) {
      const lab = `${sec}_${mat}`;
      if (!series[lab]) continue;
      const sp = bpArr(lab);
      let mask = staleMask(series[lab] || []);
      if (mat === '3월') mask = combineMask(mask, staleMask(series['국고채권_3월'] || []));
      const sr = staleRatioFull(sp, mask);
      const perH = {};
      for (const h of [1, 3, 6]) {
        if (sr != null && sr >= STALE_MAX) { excludedStale++; coverage[h].staleExcl++; continue; } // 스테일 과다 셀 제외
        const gated = applyGate(episodeStats(sp, mask, FWD_DAYS[h]), MIN_EPISODES);
        const out = {};
        for (const b of ['low', 'mid', 'high']) out[b] = gated[b] ? { n: gated[b].n, mean: r1(gated[b].mean), shrink: gated[b].shrink } : null;
        perH[h] = out;
        const anyProvided = Object.values(out).some(v => v);
        if (anyProvided) { provided++; coverage[h].provided++; } else { gateFail++; coverage[h].gateFail++; }
      }
      if (Object.keys(perH).length) data[lab] = perH;
    }
  }

  const outObj = {
    meta: { source: 'curve-rv-backtest', last_updated: dates[dates.length - 1], horizons: [1, 3, 6],
      buckets: ['low', 'mid', 'high'], bucket_edges: [33, 67], stale_max: STALE_MAX, min_episodes: MIN_EPISODES, maturity_max: MAT_MAX },
    data,
  };
  const body = 'window.FENRIR_SERIES = window.FENRIR_SERIES || {};\n' +
    'window.FENRIR_SERIES["curve-rv-backtest"] = ' + JSON.stringify(outObj) + ';\n';
  const outPath = join(ROOT, 'data', 'curve-rv-backtest.js');
  writeFileSync(outPath, body, 'utf8');

  console.error(`[build-backtest] 셀 ${Object.keys(data).length} · 제공 ${provided} · 게이트미달 ${gateFail} · 스테일제외 ${excludedStale}`);
  for (const h of [1, 3, 6]) console.error(`  h=${h}개월: 제공 ${coverage[h].provided} / 게이트미달 ${coverage[h].gateFail} / 스테일제외 ${coverage[h].staleExcl}`);
  console.error(`  → ${outPath} (${(Buffer.byteLength(body) / 1024).toFixed(1)}KB)`);
}
main().catch(e => { console.error('[build-backtest] 실패:', e.stack || e.message); process.exit(1); });

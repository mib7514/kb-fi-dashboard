// calibrate.mjs — Taylor 압력 캘리브레이션 재현/검증. (의사결정 아님 — 파라미터는 이미 동결.)
//   그리드서치: r* ∈ [−1.0,1.5]/0.1, α ∈ [0.25,1.0]/0.05, β ∈ [0.25,1.0]/0.05
//   채택 기준: (1) 분기변화 방향 일치율 ≥ 70% → (2) 상관 ≥ 0.85 → (3) RMSE 최소
//   CPI 3안 비교: QB(농산물·석유류제외, 채택) / 00(총지수, headline) / DB(식료품·에너지제외, OECD식)
//
// 실행(로컬):  NODE_TLS_REJECT_UNAUTHORIZED=0 ECOS_API_KEY=… node scripts/calibration/calibrate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSeries } from '../lib/ecos.mjs';
import { buildPressureSeries } from '../lib/taylor-series.mjs';
import { ECOS_SERIES, HP_LAMBDA, GDP_FETCH_START, CPI_FETCH_START, PRESSURE_START, PARAMS } from '../taylor-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ── 레퍼런스 로드 (엑셀 모델 산출 압력) ──
function loadReference() {
  const txt = readFileSync(join(here, 'reference.csv'), 'utf8').trim();
  const out = [];
  for (const line of txt.split(/\r?\n/).slice(1)) {
    const [date, p] = line.split(',');
    out.push({ month: date.slice(0, 7), pressure: Number(p) });
  }
  return out;
}

// ── 지표 ──
const sign = (x, eps = 1e-9) => (x > eps ? 1 : x < -eps ? -1 : 0);
function pearson(a, b) {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return sab / Math.sqrt(saa * sbb);
}
const rmse = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
const isQuarterEnd = (m) => ['03', '06', '09', '12'].includes(m.slice(5, 7));
// 방향 일치율: 스펙의 "분기 변화 방향" → 분기말 포인트만, 레퍼런스 무변화 쌍은 분모 제외.
// (상관·RMSE 는 전 겹침구간 = "분기말/월말" 대상. 노트북과 동일 관례.)
function directionMatch(rows) {
  const q = rows.filter((r) => isQuarterEnd(r.month));
  let ok = 0, tot = 0;
  for (let i = 1; i < q.length; i++) {
    const dr = q[i].ref - q[i - 1].ref;
    if (Math.abs(dr) <= 1e-9) continue;            // 무변화 분기쌍 제외
    tot++;
    if (sign(dr) === sign(q[i].model - q[i - 1].model)) ok++;
  }
  return { rate: ok / tot, ok, tot };
}

// 레퍼런스 월에 맞춘 {month,pi,ygap,base} 추출(파라미터 독립) → 그리드서치는 선형결합만.
function alignComponents(model, ref) {
  const byMonth = new Map(model.map((m) => [m.month, m]));
  const rows = [];
  for (const r of ref) { const m = byMonth.get(r.month); if (m) rows.push({ month: r.month, ref: r.pressure, pi: m.pi, ygap: m.ygap, base: m.base }); }
  return rows;
}

function evaluate(rows, { rstar, alpha, beta, piStar = 2.0 }) {
  const withModel = rows.map((r) => ({ ...r, model: rstar + r.pi + alpha * (r.pi - piStar) + beta * r.ygap - r.base }));
  const ref = withModel.map((r) => r.ref), model = withModel.map((r) => r.model);
  return { dir: directionMatch(withModel), corr: pearson(ref, model), rmse: rmse(ref, model) };
}

function gridSearch(rows) {
  const R = []; for (let v = -1.0; v <= 1.5 + 1e-9; v += 0.1) R.push(Math.round(v * 10) / 10);
  const A = []; for (let v = 0.25; v <= 1.0 + 1e-9; v += 0.05) A.push(Math.round(v * 100) / 100);
  const B = A.slice();
  let best = null, bestAny = null;
  for (const rstar of R) for (const alpha of A) for (const beta of B) {
    const m = evaluate(rows, { rstar, alpha, beta });
    const cand = { rstar, alpha, beta, ...m };
    if (!bestAny || m.rmse < bestAny.rmse) bestAny = cand;                 // 무제약 최소 RMSE(참고)
    if (m.dir.rate >= 0.70 && m.corr >= 0.85) {                           // 게이트 통과
      if (!best || m.rmse < best.rmse) best = cand;
    }
  }
  return { best, bestAny, grid: { R, A, B } };
}

const fmt = (x, d = 3) => (x == null ? '—' : x.toFixed(d));
function report(label, rows, res) {
  console.log(`\n──────── ${label} (n=${rows.length}) ────────`);
  const frozen = evaluate(rows, PARAMS);
  console.log(`[동결안 r*=${PARAMS.rstar} α=${PARAMS.alpha} β=${PARAMS.beta}]  방향 ${(frozen.dir.rate * 100).toFixed(1)}% (${frozen.dir.ok}/${frozen.dir.tot})  상관 ${fmt(frozen.corr)}  RMSE ${fmt(frozen.rmse)}`);
  const { best, bestAny, grid } = res;
  if (best) {
    const atEdge = [];
    if (best.rstar === grid.R[0] || best.rstar === grid.R[grid.R.length - 1]) atEdge.push('r*');
    if (best.alpha === grid.A[0] || best.alpha === grid.A[grid.A.length - 1]) atEdge.push('α');
    if (best.beta === grid.B[0] || best.beta === grid.B[grid.B.length - 1]) atEdge.push('β');
    console.log(`[그리드최적(게이트통과)  r*=${best.rstar} α=${best.alpha} β=${best.beta}]  방향 ${(best.dir.rate * 100).toFixed(1)}%  상관 ${fmt(best.corr)}  RMSE ${fmt(best.rmse)}${atEdge.length ? '  ⚠ 경계:' + atEdge.join(',') : ''}`);
  } else {
    console.log(`[그리드최적] 게이트(방향≥70% & 상관≥0.85) 통과 조합 없음`);
    console.log(`[무제약 최소RMSE 참고]  r*=${bestAny.rstar} α=${bestAny.alpha} β=${bestAny.beta}  방향 ${(bestAny.dir.rate * 100).toFixed(1)}%  상관 ${fmt(bestAny.corr)}  RMSE ${fmt(bestAny.rmse)}`);
  }
  return { frozen, best, bestAny };
}

async function main() {
  const ref = loadReference();
  console.log(`레퍼런스 ${ref.length}포인트 (${ref[0].month} ~ ${ref[ref.length - 1].month})`);

  // 공통: GDP·기준금리
  const gdp = await fetchSeries({ ...ECOS_SERIES.gdp, sdate: GDP_FETCH_START, edate: '2026Q4' });
  const base = await fetchSeries({ ...ECOS_SERIES.base, sdate: '20140101', edate: '20261231' });

  const cpiStart = CPI_FETCH_START.replace('-', '');
  const variants = [
    ['QB 근원(농산물·석유류제외, 채택)', 'QB'],
    ['00 총지수(headline)', '00'],
    ['DB 식료품·에너지제외(OECD식)', 'DB'],
  ];
  const results = {};
  for (const [label, item] of variants) {
    const cpi = await fetchSeries({ stat: ECOS_SERIES.cpiCore.stat, item, cycle: 'M', sdate: cpiStart, edate: '202612' });
    const model = buildPressureSeries({ cpiRows: cpi, gdpRows: gdp, baseDaily: base, params: PARAMS, lambda: HP_LAMBDA, startMonth: PRESSURE_START });
    const rows = alignComponents(model, ref);
    results[item] = report(label, rows, gridSearch(rows));
  }

  // 재현 판정(채택안 QB)
  const qb = results.QB.frozen;
  const NB = { dir: 0.756, corr: 0.924, rmse: 0.473 };
  console.log(`\n════════ 재현 판정 (채택안 QB vs 노트북 ${NB.dir * 100}% / ${NB.corr} / ${NB.rmse}) ════════`);
  const dDir = Math.abs(qb.dir.rate - NB.dir), dCorr = Math.abs(qb.corr - NB.corr), dRmse = Math.abs(qb.rmse - NB.rmse);
  console.log(`Δ방향 ${(dDir * 100).toFixed(1)}%p, Δ상관 ${dCorr.toFixed(3)}, ΔRMSE ${dRmse.toFixed(3)}`);
  const near = dDir <= 0.05 && dCorr <= 0.05 && dRmse <= 0.10;
  console.log(near ? '→ 유사(재현 OK). 파라미터 동결 유지.' : '→ ⚠ 이탈 큼. 중단하고 사용자 보고 필요.');
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });

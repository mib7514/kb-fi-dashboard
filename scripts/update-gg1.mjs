// update-gg1.mjs — ECOS 5종 적재 → data/gg1-income-gap.json 생성 (GG-1a fetch + GG-1b 선계산).
//   측정 레이어. UI 해석은 gg1-income-gap.html 소관.
//   monthly: 순상품교역조건지수(레벨·y/y) + 수출/수입물가 y/y(계약통화기준, 보조) + 갭 프록시(5y/10y/all).
//   quarterly: 실질 GDP·GDI y/y(원계열 레벨→계산) + gap_actual_pp = gdi−gdp + 분기집계 갭 프록시(10y).
//   β: 월간 tot_yoy 를 분기평균으로 집계해 gap_actual_pp 에 절편없는 OLS 회귀(5y/10y/all + 절편포함 참고).
//   updated_at 은 wall-clock 이 아니라 데이터 vintage 파생 → 데이터 불변 시 파일 불변(워크플로 diff-skip 정확).
//
// 실행(로컬 검증):  NODE_TLS_REJECT_UNAUTHORIZED=0 ECOS_PAGE_SIZE=10 ECOS_API_KEY=sample node scripts/update-gg1.mjs
//   · 사내 프록시 TLS 우회(NODE_TLS_…)와 ECOS_PAGE_SIZE 는 로컬 한정. CI(ubuntu·정식 키)엔 불필요.
// 실행(CI):  ECOS_API_KEY=<정식키> node scripts/update-gg1.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSeriesPaged } from './lib/ecos.mjs';
import { ECOS_SERIES, OUTPUT_YEARS, LOOKBACK_YEARS, BETA_THEORY_RANGE } from './gg1-config.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');
const pageSize = Number(process.env.ECOS_PAGE_SIZE) || 100000;

const roundN = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };
const round2 = (x) => roundN(x, 2);
const round3 = (x) => roundN(x, 3);
const round4 = (x) => roundN(x, 4);
const curYear = new Date().getFullYear(); // fetch edate 상한용(파일엔 미기록: vintage 파생)

// 'YYYYMM' → 12개월 전 키.  'YYYYQn' → 4분기 전 키(= 전년 동기).
const prevYearMonth = (t) => `${Number(t.slice(0, 4)) - 1}${t.slice(4, 6)}`;
const prevYearQuarter = (t) => `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;
const yoy = (cur, base) => round2((cur / base - 1) * 100);
// 'YYYYMM' → 'YYYYQn'
const monthToQuarter = (t) => `${t.slice(0, 4)}Q${Math.floor((Number(t.slice(4, 6)) - 1) / 3) + 1}`;

// 절편 없는 OLS: y = β·x. R² 은 무절편 모델 규약(uncentered) 1 − Σe²/Σy².
function olsNoIntercept(pts) {
  let sxx = 0, sxy = 0;
  for (const p of pts) { sxx += p.x * p.x; sxy += p.x * p.y; }
  const beta = sxx === 0 ? 0 : sxy / sxx;
  let sse = 0, syy = 0;
  for (const p of pts) { const e = p.y - beta * p.x; sse += e * e; syy += p.y * p.y; }
  return { beta: round4(beta), r2: syy === 0 ? 0 : round3(1 - sse / syy), n: pts.length };
}
// 절편 포함 OLS(참고치): y = a + β·x. R² 은 centered.
function olsIntercept(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const mx = sx / n, my = sy / n;
  const denom = sxx - n * mx * mx;
  const beta = denom === 0 ? 0 : (sxy - n * mx * my) / denom;
  const a = my - beta * mx;
  let sse = 0, sst = 0;
  for (const p of pts) { const e = p.y - (a + beta * p.x); sse += e * e; sst += (p.y - my) ** 2; }
  return { beta: round4(beta), intercept: round3(a), r2: sst === 0 ? 0 : round3(1 - sse / sst), n };
}

async function main() {
  const startY = curYear - LOOKBACK_YEARS; // y/y base 확보용 소급

  // ── 월간 fetch: 순상품교역조건 + 수출/수입물가(계약통화기준) ──
  const mSdate = `${startY}01`;
  const mEdate = `${curYear}12`;
  const [tot, exp, imp] = await Promise.all([
    fetchSeriesPaged({ ...ECOS_SERIES.tot, sdate: mSdate, edate: mEdate }, pageSize),
    fetchSeriesPaged({ ...ECOS_SERIES.exportPx, sdate: mSdate, edate: mEdate }, pageSize),
    fetchSeriesPaged({ ...ECOS_SERIES.importPx, sdate: mSdate, edate: mEdate }, pageSize),
  ]);
  const totMap = new Map(tot.map((r) => [r.time, r.value]));
  const expMap = new Map(exp.map((r) => [r.time, r.value]));
  const impMap = new Map(imp.map((r) => [r.time, r.value]));

  // 월간 y/y 전체 산출(트림 전) — 분기평균 집계·프록시 계산에 전 구간 필요.
  const monthlyFull = tot
    .filter((r) => {
      const b = prevYearMonth(r.time);
      return totMap.has(b) && expMap.has(r.time) && expMap.has(b) && impMap.has(r.time) && impMap.has(b);
    })
    .map((r) => {
      const b = prevYearMonth(r.time);
      return {
        ym: r.time,
        date: `${r.time.slice(0, 4)}-${r.time.slice(4, 6)}`,
        tot_index: round2(r.value),
        tot_yoy_pct: yoy(r.value, totMap.get(b)),
        export_price_yoy_pct: yoy(expMap.get(r.time), expMap.get(b)),
        import_price_yoy_pct: yoy(impMap.get(r.time), impMap.get(b)),
      };
    });

  // ── 분기 fetch: 실질 GDP·GDI(원계열 레벨) → y/y → gap ──
  const qSdate = `${startY}Q1`;
  const qEdate = `${curYear}Q4`;
  const [gdp, gdi] = await Promise.all([
    fetchSeriesPaged({ ...ECOS_SERIES.gdp, sdate: qSdate, edate: qEdate }, pageSize),
    fetchSeriesPaged({ ...ECOS_SERIES.gdi, sdate: qSdate, edate: qEdate }, pageSize),
  ]);
  const gdpMap = new Map(gdp.map((r) => [r.time, r.value]));
  const gdiMap = new Map(gdi.map((r) => [r.time, r.value]));

  const quarterlyFull = gdp
    .filter((r) => {
      const b = prevYearQuarter(r.time);
      return gdpMap.has(b) && gdiMap.has(r.time) && gdiMap.has(b);
    })
    .map((r) => {
      const b = prevYearQuarter(r.time);
      const gdpYoy = yoy(r.value, gdpMap.get(b));
      const gdiYoy = yoy(gdiMap.get(r.time), gdiMap.get(b));
      return { quarter: r.time, gdp_yoy_pct: gdpYoy, gdi_yoy_pct: gdiYoy, gap_actual_pp: round2(gdiYoy - gdpYoy) };
    });

  // ── β 회귀: 월간 tot_yoy 를 분기평균(3개월 완전분기만)으로 집계 → gap_actual_pp 에 회귀 ──
  const totYoyAgg = new Map(); // q → { sum, n }
  for (const m of monthlyFull) {
    const q = monthToQuarter(m.ym);
    const e = totYoyAgg.get(q) || { sum: 0, n: 0 };
    e.sum += m.tot_yoy_pct; e.n += 1; totYoyAgg.set(q, e);
  }
  const totYoyQAvg = new Map(); // q → 분기평균 tot_yoy (완전분기=3개월만)
  for (const [q, e] of totYoyAgg) if (e.n === 3) totYoyQAvg.set(q, e.sum / e.n);

  // 회귀 표본: gap_actual 과 분기평균 tot_yoy 가 모두 있는 분기(오름차순).
  const pairs = quarterlyFull
    .filter((q) => totYoyQAvg.has(q.quarter))
    .map((q) => ({ q: q.quarter, x: totYoyQAvg.get(q.quarter), y: q.gap_actual_pp }));
  if (pairs.length < 20) throw new Error(`회귀 표본 부족(${pairs.length}) — 입력 확인.`);

  const reg = {
    '5y': olsNoIntercept(pairs.slice(-20)),   // 최근 20분기 = 5년
    '10y': olsNoIntercept(pairs.slice(-40)),  // 최근 40분기 = 10년
    all: olsNoIntercept(pairs),
  };
  const withInt10y = olsIntercept(pairs.slice(-40));
  const betaBy = { '5y': reg['5y'].beta, '10y': reg['10y'].beta, all: reg.all.beta };

  // ── 갭 프록시: gap_proxy(m) = β_lookback × tot_yoy_pct(m) ──
  for (const m of monthlyFull) {
    m.gap_proxy_pp_5y = round2(betaBy['5y'] * m.tot_yoy_pct);
    m.gap_proxy_pp_10y = round2(betaBy['10y'] * m.tot_yoy_pct);
    m.gap_proxy_pp_all = round2(betaBy.all * m.tot_yoy_pct);
  }
  // 분기 집계 프록시(10y): β_10y × 분기평균 tot_yoy — 실적 갭과 나란히 비교용.
  for (const q of quarterlyFull) {
    q.gap_proxy_pp_10y = totYoyQAvg.has(q.quarter) ? round2(betaBy['10y'] * totYoyQAvg.get(q.quarter)) : null;
  }

  // ── 산출: 최근 15년 trim, 렌더 불필요 필드(ym) 제거 ──
  const monthly = monthlyFull.slice(-OUTPUT_YEARS * 12).map(({ ym, ...rest }) => rest);
  const quarterly = quarterlyFull.slice(-OUTPUT_YEARS * 4);
  if (monthly.length === 0 || quarterly.length === 0) {
    throw new Error(`산출 0행 — monthly=${monthly.length} quarterly=${quarterly.length}. 입력 확인.`);
  }

  const lastMonth = monthly[monthly.length - 1].date;      // 'YYYY-MM'
  const lastQuarter = quarterly[quarterly.length - 1].quarter;
  const updatedAt = `${lastMonth}-01T00:00:00Z`;           // vintage 파생(파일 불변성)

  const out = {
    meta: {
      module: 'GG-1',
      updated_at: updatedAt,
      last_monthly: lastMonth,
      last_quarter: lastQuarter,
      source: 'ECOS',
      series_codes: {
        tot: '403Y005/A (순상품교역조건지수, M)',
        export_price: '402Y014/*AA·계약통화기준(C) (수출물가 총지수, M)',
        import_price: '401Y015/*AA·계약통화기준(C) (수입물가 총지수, M)',
        gdp: '200Y106/1400 (실질 GDP, 원계열, Q)',
        gdi: '200Y106/1600 (실질 GDI, 원계열, Q)',
      },
      beta: {
        regression: reg, // { '5y'|'10y'|'all': { beta, r2, n } } — 무절편 OLS, R²=uncentered
        with_intercept_10y: withInt10y, // { beta, intercept, r2 } 참고치(절편 크면 구조변화 신호)
        theory_range: BETA_THEORY_RANGE, // [0.35, 0.40] = (수출+수입)/(2·명목GDP) 이론범위
        default_lookback: '10y',
        method: 'OLS no-intercept, 분기평균 집계 tot_yoy vs gap_actual_pp',
      },
      notes:
        'y/y=원계열 전년동기비. 월간 tot/export/import·분기 gdp/gdi 는 레벨→y/y 계산. '
        + 'export/import y/y 는 교역조건(순상품)의 줄다리기 분해용 보조지표(계약통화기준, 환율효과 제거) '
        + '— 순상품교역조건과 정확 일치 아님(가중·연쇄식 차이). gap_actual_pp=gdi_yoy−gdp_yoy. '
        + 'gap_proxy_pp_{5y,10y,all}=β_lookback×tot_yoy_pct(월간)/×분기평균 tot_yoy(분기). '
        + 'β=절편없는 OLS(분기평균 tot_yoy vs gap_actual), R²은 무절편 규약(uncentered). '
        + 'updated_at 은 wall-clock 아닌 최신 월간 vintage 파생(파일 불변성).',
    },
    monthly,
    quarterly,
  };

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'gg1-income-gap.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  const lq = quarterly[quarterly.length - 1];
  const lm = monthly[monthly.length - 1];
  console.error(
    `gg1-income-gap.json  monthly ${monthly.length}행(${monthly[0].date}~${lastMonth})  `
    + `quarterly ${quarterly.length}행(${quarterly[0].quarter}~${lastQuarter})\n`
    + `  β: 5y=${reg['5y'].beta}(R²${reg['5y'].r2},N${reg['5y'].n}) `
    + `10y=${reg['10y'].beta}(R²${reg['10y'].r2},N${reg['10y'].n}) all=${reg.all.beta}(R²${reg.all.r2},N${reg.all.n}) `
    + `| 절편포함10y β=${withInt10y.beta} a=${withInt10y.intercept} R²=${withInt10y.r2}\n`
    + `  ${lastQuarter}: GDP ${lq.gdp_yoy_pct} / GDI ${lq.gdi_yoy_pct} / 실적갭 ${lq.gap_actual_pp} / 프록시(10y) ${lq.gap_proxy_pp_10y}\n`
    + `  ${lm.date}: tot_yoy ${lm.tot_yoy_pct} → 월간 프록시(10y) ${lm.gap_proxy_pp_10y}%p`,
  );
}

main().catch((e) => { console.error('update-gg1 실패:', e.message); process.exit(1); });

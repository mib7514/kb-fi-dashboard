// update-gg1.mjs — ECOS 5종 적재 → data/gg1-income-gap.json 생성 (GG-1a).
//   측정 레이어. β·갭 프록시·해석은 GG-1b 소관(여기선 다루지 않음).
//   monthly: 순상품교역조건지수(레벨·y/y) + 수출/수입물가 y/y(계약통화기준, 보조).
//   quarterly: 실질 GDP·GDI y/y(원계열 레벨→계산) + gap_actual_pp = gdi−gdp.
//   updated_at 은 wall-clock 이 아니라 데이터 vintage 파생 → 데이터 불변 시 파일 불변(워크플로 diff-skip 정확).
//
// 실행(로컬 검증):  NODE_TLS_REJECT_UNAUTHORIZED=0 ECOS_PAGE_SIZE=10 ECOS_API_KEY=sample node scripts/update-gg1.mjs
//   · 사내 프록시 TLS 우회(NODE_TLS_…)와 ECOS_PAGE_SIZE 는 로컬 한정. CI(ubuntu·정식 키)엔 불필요.
// 실행(CI):  ECOS_API_KEY=<정식키> node scripts/update-gg1.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSeriesPaged } from './lib/ecos.mjs';
import { ECOS_SERIES, OUTPUT_YEARS, LOOKBACK_YEARS } from './gg1-config.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');
const pageSize = Number(process.env.ECOS_PAGE_SIZE) || 100000;

const round2 = (x) => Math.round(x * 100) / 100;
const curYear = new Date().getFullYear(); // fetch edate 상한용(파일엔 미기록: vintage 파생)

// 'YYYYMM' → 12개월 전 키.  'YYYYQn' → 4분기 전 키(= 전년 동기).
const prevYearMonth = (t) => `${Number(t.slice(0, 4)) - 1}${t.slice(4, 6)}`;
const prevYearQuarter = (t) => `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;
const yoy = (cur, base) => round2((cur / base - 1) * 100);

async function main() {
  const startY = curYear - LOOKBACK_YEARS; // y/y base 확보용 소급

  // ── 월간: 순상품교역조건 + 수출/수입물가(계약통화기준) ──
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

  let monthly = tot
    .filter((r) => {
      const b = prevYearMonth(r.time);
      return totMap.has(b) && expMap.has(r.time) && expMap.has(b) && impMap.has(r.time) && impMap.has(b);
    })
    .map((r) => {
      const b = prevYearMonth(r.time);
      return {
        date: `${r.time.slice(0, 4)}-${r.time.slice(4, 6)}`,
        tot_index: round2(r.value),
        tot_yoy_pct: yoy(r.value, totMap.get(b)),
        export_price_yoy_pct: yoy(expMap.get(r.time), expMap.get(b)),
        import_price_yoy_pct: yoy(impMap.get(r.time), impMap.get(b)),
      };
    });
  monthly = monthly.slice(-OUTPUT_YEARS * 12); // 최근 15년 trim

  // ── 분기: 실질 GDP·GDI(원계열 레벨) → y/y → gap ──
  const qSdate = `${startY}Q1`;
  const qEdate = `${curYear}Q4`;
  const [gdp, gdi] = await Promise.all([
    fetchSeriesPaged({ ...ECOS_SERIES.gdp, sdate: qSdate, edate: qEdate }, pageSize),
    fetchSeriesPaged({ ...ECOS_SERIES.gdi, sdate: qSdate, edate: qEdate }, pageSize),
  ]);
  const gdpMap = new Map(gdp.map((r) => [r.time, r.value]));
  const gdiMap = new Map(gdi.map((r) => [r.time, r.value]));

  let quarterly = gdp
    .filter((r) => {
      const b = prevYearQuarter(r.time);
      return gdpMap.has(b) && gdiMap.has(r.time) && gdiMap.has(b);
    })
    .map((r) => {
      const b = prevYearQuarter(r.time);
      const gdpYoy = yoy(r.value, gdpMap.get(b));
      const gdiYoy = yoy(gdiMap.get(r.time), gdiMap.get(b));
      return {
        quarter: r.time,
        gdp_yoy_pct: gdpYoy,
        gdi_yoy_pct: gdiYoy,
        gap_actual_pp: round2(gdiYoy - gdpYoy),
      };
    });
  quarterly = quarterly.slice(-OUTPUT_YEARS * 4); // 최근 15년 trim

  if (monthly.length === 0 || quarterly.length === 0) {
    throw new Error(`산출 0행 — monthly=${monthly.length} quarterly=${quarterly.length}. 입력 확인.`);
  }

  const lastMonth = monthly[monthly.length - 1].date;    // 'YYYY-MM'
  const lastQuarter = quarterly[quarterly.length - 1].quarter;
  // vintage 파생 updated_at(파일 불변성): 최신 월간 관측월 1일 00:00Z.
  const updatedAt = `${lastMonth}-01T00:00:00Z`;

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
      notes:
        'y/y=원계열 전년동기비. 월간 tot/export/import·분기 gdp/gdi 는 레벨→y/y 계산. '
        + 'export/import y/y 는 교역조건(순상품)의 줄다리기 분해용 보조지표(계약통화기준, 환율효과 제거) '
        + '— 순상품교역조건과 정확 일치 아님(가중·연쇄식 차이). gap_actual_pp=gdi_yoy−gdp_yoy. '
        + 'updated_at 은 wall-clock 아닌 최신 월간 vintage 파생(파일 불변성). β/갭 프록시 필드는 GG-1b 추가.',
    },
    monthly,
    quarterly,
  };

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'gg1-income-gap.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  const lq = quarterly[quarterly.length - 1];
  console.error(
    `gg1-income-gap.json  monthly ${monthly.length}행(${monthly[0].date}~${lastMonth})  `
    + `quarterly ${quarterly.length}행(${quarterly[0].quarter}~${lastQuarter})  `
    + `[${lastQuarter}: GDP ${lq.gdp_yoy_pct} / GDI ${lq.gdi_yoy_pct} / gap ${lq.gap_actual_pp}]`,
  );
}

main().catch((e) => { console.error('update-gg1 실패:', e.message); process.exit(1); });

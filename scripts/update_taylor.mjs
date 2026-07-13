// update_taylor.mjs — ECOS 4종 적재 → data/taylor-ktb3y.js · data/taylor-pressure.js 생성.
//   측정 레이어. 전략 해석/코멘트 없음. window 전역 할당(JSON/fetch 로딩 금지, GitHub Pages CORS).
//   asof 는 wall-clock 이 아니라 데이터 vintage 에서 파생 → 데이터 불변 시 파일 불변(워크플로 diff-skip 정확).
//
// 실행(로컬):  NODE_TLS_REJECT_UNAUTHORIZED=0 ECOS_API_KEY=… node scripts/update_taylor.mjs
//   (사내 프록시 TLS 우회는 로컬 한정. CI(ubuntu)에는 불필요.)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSeries } from './lib/ecos.mjs';
import { buildPressureSeries, ktbDailySeries } from './lib/taylor-series.mjs';
import { ECOS_SERIES, PARAMS, HP_LAMBDA, KTB_START, CPI_FETCH_START, GDP_FETCH_START, PRESSURE_START } from './taylor-config.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');

// 오늘(YYYYMMDD) — fetch edate 상한. (파일에는 기록하지 않음: vintage 파생.)
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
const num = (x) => (Number.isInteger(x) ? x : Math.round(x * 1000) / 1000);

// window 전역 파일 직렬화. series 는 한 쌍/줄(git diff 최소화).
function writeDataFile(path, header, globalName, meta, pairs) {
  const body = pairs.map((p) => `["${p[0]}",${num(p[1])}]`).join(',\n');
  const out = `${header}\nwindow.${globalName} = {\n  meta: ${JSON.stringify(meta)},\n  series: [\n${body}\n  ]\n};\n`;
  writeFileSync(path, out, 'utf8');
}

async function main() {
  const today = todayYmd();
  const curYear = today.slice(0, 4);

  // ── 1) 국고 3년 일별 → taylor-ktb3y.js ──
  const ktbRaw = await fetchSeries({ ...ECOS_SERIES.ktb3y, sdate: KTB_START.replace(/-/g, ''), edate: today });
  const ktb = ktbDailySeries(ktbRaw);
  const ktbLast = ktb[ktb.length - 1];
  mkdirSync(dataDir, { recursive: true });
  writeDataFile(
    join(dataDir, 'taylor-ktb3y.js'),
    '// data/taylor-ktb3y.js — ECOS 817Y002/010200000 국고채(3년) 일별금리. update_taylor.mjs 생성.',
    'TAYLOR_KTB3Y',
    { asof: ktbLast[0], source: 'ECOS 817Y002/010200000', unit: '%', start: ktb[0][0], n: ktb.length },
    ktb,
  );
  console.error(`taylor-ktb3y.js  ${ktb.length}일  ${ktb[0][0]} ~ ${ktbLast[0]} (최신 ${ktbLast[1]})`);

  // ── 2) 근원CPI·GDP·기준금리 → 압력 월별 → taylor-pressure.js ──
  const cpi = await fetchSeries({ ...ECOS_SERIES.cpiCore, sdate: CPI_FETCH_START.replace('-', ''), edate: `${curYear}12` });
  const gdp = await fetchSeries({ ...ECOS_SERIES.gdp, sdate: GDP_FETCH_START, edate: `${curYear}Q4` });
  const base = await fetchSeries({ ...ECOS_SERIES.base, sdate: `${Number(curYear) - 12}0101`, edate: today });

  const model = buildPressureSeries({ cpiRows: cpi, gdpRows: gdp, baseDaily: base, params: PARAMS, lambda: HP_LAMBDA, startMonth: PRESSURE_START });
  if (model.length === 0) throw new Error('압력 시계열 0 — 입력 데이터 확인 필요');
  const pairs = model.map((m) => [m.month, m.pressure]);
  const last = model[model.length - 1];
  const lastCpi = cpi[cpi.length - 1].time; // 'YYYYMM'
  const lastGdpQ = gdp[gdp.length - 1].time; // 'YYYYQn'

  writeDataFile(
    join(dataDir, 'taylor-pressure.js'),
    '// data/taylor-pressure.js — 수정 Taylor 압력(i* − 기준금리) 월별. update_taylor.mjs 생성.\n'
    + '// i* = r* + π + α(π−2) + β·ygap. π=근원CPI YoY, ygap=one-sided HP(λ=1600) 산출갭. 파라미터는 캘리브레이션 동결.',
    'TAYLOR_PRESSURE',
    {
      asof: last.month,
      params: { rstar: PARAMS.rstar, alpha: PARAMS.alpha, beta: PARAMS.beta, piStar: PARAMS.piStar, lambda: HP_LAMBDA },
      lastCpi: `${lastCpi.slice(0, 4)}-${lastCpi.slice(4, 6)}`,
      lastGdpQuarter: lastGdpQ,
      source: 'ECOS 901Y010/QB(근원CPI) · 200Y104/1400(실질GDP,SA) · 722Y001/0101000(기준금리)',
    },
    pairs,
  );
  console.error(`taylor-pressure.js  ${pairs.length}개월  ${pairs[0][0]} ~ ${last.month} (최신 압력 ${num(last.pressure)}, CPI ${lastCpi}, GDP ${lastGdpQ})`);
}

main().catch((e) => { console.error('update_taylor 실패:', e.message); process.exit(1); });

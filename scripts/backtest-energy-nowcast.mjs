// backtest-energy-nowcast.mjs — v2 Phase 1 검증 게이트 (보고 후 중단용, 미커밋 아티팩트).
//
// 목적: 주간 휘발유(GASREGW)로 당월 에너지 CPI m/m를 나우캐스트해, 헤드라인 CPI m/m
//   당월 전망을 "시즈널 단독" 대비 개선하는지 18개월(2025-01~2026-06) 백테스트.
//
// 방법 (명령서 v2 Phase 1 순서):
//  1) GASREGW($/gal, 주간 NSA)·DCOILWTICO($/bbl, 일간 NSA) fetch (title/units 검증 완료).
//  2) 당월 나우캐스트: 에너지 CPI m/m ~ 휘발유 m/m, 24개월 회귀(a+b·x), 계수·R² 기록.
//  3) 합성: 코어·식품 m/m은 시즈널(seasonalAvgMM 10y) 유지, 에너지만 나우캐스트로 대체.
//     헤드라인_pred = w_c·core_seas + w_f·food_seas + w_e·energy_*      (* = nowcast|seasonal)
//     가중치(w_c,w_f,w_e)는 제약 최소제곱(합=1, 무절편, 점-시점 trailing)로 추정.
//  4) 백테스트: 각 대상월 M에 대해 M 시점 가용 데이터만 사용(주간=M 종료 이하, CPI=M-1까지).
//     이란 구간(2025-06 Israel-Iran 충돌, 유가 급등)은 표에 별도 표기.
//
// ⚠️ 점-시점 주의: SA CPI는 사후 개정될 수 있으나 명령서 제약은 "주간 데이터 point-in-time".
//    CPI는 현행(최신) 값 사용(개정은 2차 요인). 휘발유는 미래 주 미사용(엄격 point-in-time).
//
// 실행: NODE_EXTRA_CA_CERTS=.corp-ca.pem  (+ .env FRED_API_KEY)  node scripts/backtest-energy-nowcast.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prevPeriod, nextPeriod, comparePeriods } from '../js/calc.js';
// gap-aware m/m: 2025-10 셧다운 결측월이 2025-11을 2개월 변화로 오염시키지 않도록
// (연속 1개월 차이일 때만 m/m 산출). CPI·휘발유 전 시리즈에 적용.
import { computeMMGapAware as computeMM } from '../js/us-inflation-calc.js';
// 나우캐스트 로직은 라이브와 동일 모듈 사용 (드리프트 방지). 계절 규약(a): 디시즌 회귀.
import {
  energyNowcast, estimateWeights, synthesizeHeadlineMM, seasonalForPeriod,
} from '../js/us-energy-nowcast.js';

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('FRED_API_KEY 없음'); process.exit(1); }

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = process.env.NOWCAST_CACHE || join(SCRIPT_DIR, '.nowcast-cache.json');

// ── FRED fetch ──
async function fredObs(id, start = '2018-01-01') {
  const u = new URL('https://api.stlouisfed.org/fred/series/observations');
  u.searchParams.set('series_id', id); u.searchParams.set('api_key', KEY);
  u.searchParams.set('file_type', 'json'); u.searchParams.set('observation_start', start);
  const r = await fetch(u, { headers: { 'User-Agent': 'fi-dashboard/nowcast' } });
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}`);
  const j = await r.json();
  return j.observations.filter((o) => o.value !== '.' && o.value !== '' && o.value != null)
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value));
}

async function loadData() {
  if (existsSync(CACHE_FILE) && !process.env.NOWCAST_REFRESH) {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  }
  const [gas, wti, energy, food, headline, core] = await Promise.all([
    fredObs('GASREGW'), fredObs('DCOILWTICO'), fredObs('CPIENGSL'),
    fredObs('CPIUFDSL'), fredObs('CPIAUCSL'), fredObs('CPILFESL'),
  ]);
  const data = { gas, wti, energy, food, headline, core };
  writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  return data;
}

// ── 주간/일간 → 월평균 (달력월 기준, date의 month로 버킷) ──
function monthlyAvg(obs) {
  const byM = new Map();
  for (const o of obs) {
    const p = o.date.slice(0, 7);
    const b = byM.get(p) || { s: 0, n: 0 };
    b.s += o.value; b.n += 1; byM.set(p, b);
  }
  return [...byM.entries()].map(([period, b]) => ({ period, value: b.s / b.n }))
    .sort((a, b) => comparePeriods(a.period, b.period));
}
// FRED 월간 인덱스(YYYY-MM-01) → {period:'YYYY-MM', value}
const toMonthly = (obs) => obs.map((o) => ({ period: o.date.slice(0, 7), value: o.value }))
  .sort((a, b) => comparePeriods(a.period, b.period));

function fmt(v, d = 3) { return v == null || !Number.isFinite(v) ? '—' : v.toFixed(d); }

async function main() {
  const data = await loadData();
  const gasM = monthlyAvg(data.gas);       // 휘발유 월평균 $/gal
  const wtiM = monthlyAvg(data.wti);       // WTI 월평균 $/bbl
  const energy = toMonthly(data.energy);
  const food = toMonthly(data.food);
  const headline = toMonthly(data.headline);
  const core = toMonthly(data.core);

  const gasMM = computeMM(gasM);           // 휘발유 m/m (NSA)
  const energyMM = computeMM(energy);
  const foodMM = computeMM(food);
  const headMM = computeMM(headline);
  const coreMM = computeMM(core);
  const wtiMM = computeMM(wtiM);
  const gasMMmap = new Map(gasMM.map((p) => [p.period, p.value]));
  const headMMmap = new Map(headMM.map((p) => [p.period, p.value]));
  const wtiMMmap = new Map(wtiMM.map((p) => [p.period, p.value]));

  // 대상월 18개
  const TARGETS = [];
  { let p = '2025-01'; while (comparePeriods(p, '2026-06') <= 0) { TARGETS.push(p); p = nextPeriod(p); } }
  const IRAN = new Set(['2025-06', '2025-07']); // Israel-Iran 12일 전쟁(2025-06-13~24) 유가 급등 → 6월 유입·7월 스필오버

  const REG_WIN = 24;    // 명령서: 24개월 회귀
  const WGT_WIN = 60;    // 가중치 추정 윈도우(점-시점)
  const rows = [];

  for (const M of TARGETS) {
    const prev = prevPeriod(M);
    // point-in-time 필터: CPI m/m는 M-1까지. 휘발유는 대상월 M까지(M의 주는 M 말이면 가용).
    const hist = (mm) => mm.filter((p) => comparePeriods(p.period, prev) <= 0);

    // 에너지 나우캐스트 (라이브 모듈, 디시즌 회귀). gasMM은 M까지 전달(나우캐스트 입력은 M).
    const gasUpToM = gasMM.filter((p) => comparePeriods(p.period, M) <= 0);
    const nc = energyNowcast({
      gasMM: gasUpToM, energyMM: hist(energyMM), endPeriod: prev, targetPeriod: M, regWindow: REG_WIN,
    });
    // 게이트 비교용 구 방식(NSA, deseason 없음).
    const ncNSA = energyNowcast({
      gasMM: gasUpToM, energyMM: hist(energyMM), endPeriod: prev, targetPeriod: M, regWindow: REG_WIN, deseason: false,
    });

    // 시즈널 성분 (endPeriod=M-1). 각 component m/m history는 M-1까지.
    const energySeas = seasonalForPeriod(hist(energyMM), prev, M);
    const foodSeas = seasonalForPeriod(hist(foodMM), prev, M);
    const coreSeas = seasonalForPeriod(hist(coreMM), prev, M);
    const headSeasDirect = seasonalForPeriod(hist(headMM), prev, M); // 실제 기존 방식(참고)

    // 가중치: 점-시점 trailing WGT_WIN.
    const w = estimateWeights(
      hist(headMM).slice(-WGT_WIN), hist(coreMM).slice(-WGT_WIN),
      hist(foodMM).slice(-WGT_WIN), hist(energyMM).slice(-WGT_WIN),
    );

    const synth = synthesizeHeadlineMM({
      coreSeas, foodSeas, energySeas, energyNowcastMM: nc.value, weights: w,
    });
    const synthNSA = synthesizeHeadlineMM({
      coreSeas, foodSeas, energySeas, energyNowcastMM: ncNSA.value, weights: w,
    });
    const actual = headMMmap.get(M);
    const absErr = (pred) => (actual != null && pred != null) ? Math.abs(pred - actual) : null;

    rows.push({
      M, iran: IRAN.has(M),
      gasNow: gasMMmap.get(M), gasDes: nc.gasDeseasonInput, wtiNow: wtiMMmap.get(M),
      b: nc.b, r2: nc.r2, regN: nc.n,
      w_e: w.w_e, w_f: w.w_f, w_c: w.w_c,
      energySeas, energyNowcast: nc.value,
      predSeasonal: synth.seasonal, headSeasDirect, predNowcast: synth.nowcast, actual,
      errSeasonal: actual != null ? synth.seasonal - actual : null,
      errNowcast: (actual != null && synth.nowcast != null) ? synth.nowcast - actual : null,
      errSeasDirect: actual != null ? headSeasDirect - actual : null,
      absErrNSA: absErr(synthNSA.nowcast), absErrDes: absErr(synth.nowcast),
    });
  }

  // ── 지표 집계 ──
  const stats = (key, filter = () => true) => {
    const es = rows.filter((r) => filter(r) && r[key] != null).map((r) => r[key]);
    if (!es.length) return { mae: null, rmse: null, n: 0 };
    const mae = es.reduce((s, e) => s + Math.abs(e), 0) / es.length;
    const rmse = Math.sqrt(es.reduce((s, e) => s + e * e, 0) / es.length);
    return { mae, rmse, n: es.length };
  };

  // ── 출력: 회귀·가중 요약 + 월별 표 + 지표 ──
  console.log('\n════════ 에너지 나우캐스트 백테스트 (2025-01 ~ 2026-06, 18M) ════════\n');
  console.log('회귀: 에너지 CPI m/m(SA) ~ 디시즌 휘발유 m/m(=휘발유 m/m − 10y 고정창 월별평균), 24개월 rolling.');
  console.log('합성: 코어·식품 시즈널 유지 + 에너지만 나우캐스트 대체. 가중: 60개월 제약 LSQ(합=1). [방식 (a)]\n');

  const H = 'M        iran  gas%    b     R²    w_e    E_seas  E_now   pred_S  pred_N  actual  |errS| |errN|';
  console.log(H); console.log('-'.repeat(H.length + 6));
  for (const r of rows) {
    const line = [
      r.M, r.iran ? ' ⚠ ' : '   ',
      fmt(r.gasNow, 1).padStart(6), fmt(r.b, 2).padStart(5), fmt(r.r2, 2).padStart(5),
      fmt(r.w_e, 3).padStart(6), fmt(r.energySeas, 2).padStart(6), fmt(r.energyNowcast, 2).padStart(7),
      fmt(r.predSeasonal, 3).padStart(7), fmt(r.predNowcast, 3).padStart(7), fmt(r.actual, 3).padStart(7),
      (r.errSeasonal == null ? '—' : fmt(Math.abs(r.errSeasonal), 3)).padStart(6),
      (r.errNowcast == null ? '—' : fmt(Math.abs(r.errNowcast), 3)).padStart(6),
    ].join(' ');
    console.log(line);
  }

  const all = { seas: stats('errSeasonal'), now: stats('errNowcast'), direct: stats('errSeasDirect') };
  const exIran = { seas: stats('errSeasonal', (r) => !r.iran), now: stats('errNowcast', (r) => !r.iran) };
  const june = rows.find((r) => r.M === '2026-06');

  console.log('\n──────── 지표 (헤드라인 m/m 예측오차, %p) ────────');
  console.log(`전체 18M    시즈널 단독:  MAE ${fmt(all.seas.mae)}  RMSE ${fmt(all.seas.rmse)}`);
  console.log(`            나우캐스트:   MAE ${fmt(all.now.mae)}  RMSE ${fmt(all.now.rmse)}`);
  console.log(`            (참고)기존 시즈널-헤드라인 직접: MAE ${fmt(all.direct.mae)}  RMSE ${fmt(all.direct.rmse)}`);
  console.log(`이란 제외    시즈널 단독:  MAE ${fmt(exIran.seas.mae)}  RMSE ${fmt(exIran.seas.rmse)}`);
  console.log(`            나우캐스트:   MAE ${fmt(exIran.now.mae)}  RMSE ${fmt(exIran.now.rmse)}`);
  console.log('\n──────── 2026-06 (판정 대상월) ────────');
  console.log(`  actual headline m/m = ${fmt(june.actual)}`);
  console.log(`  시즈널 단독 pred = ${fmt(june.predSeasonal)}  → |err| ${fmt(Math.abs(june.errSeasonal))}`);
  console.log(`  나우캐스트  pred = ${fmt(june.predNowcast)}  → |err| ${fmt(Math.abs(june.errNowcast))}`);
  console.log(`  개선폭(|errS|-|errN|) = ${fmt(Math.abs(june.errSeasonal) - Math.abs(june.errNowcast))} %p  (+면 개선)`);
  console.log(`  6월 회귀: b=${fmt(june.b, 3)}, R²=${fmt(june.r2, 3)}, gas m/m=${fmt(june.gasNow, 2)}%, w_e=${fmt(june.w_e, 3)}`);

  const juneImproved = june.errNowcast != null && Math.abs(june.errNowcast) < Math.abs(june.errSeasonal);
  console.log(`\n▶ 판정: 2026-06 시즈널 단독 대비 ${juneImproved ? '개선 확인 ✅' : '개선 미확인 ⛔ (원인 보고 필요)'}`);

  // ── 계절 규약 수정 수용 게이트: 저신호월 손해 축소 & 유가 대변동월 개선 유지 ──
  console.log('\n──────── 수용 게이트 (구 NSA → 디시즌(a) 나우캐스트 |err|, %p) ────────');
  const gate = (label, months) => {
    console.log(`  ${label}`);
    let ok = true;
    for (const m of months) {
      const r = rows.find((x) => x.M === m);
      if (!r || r.absErrNSA == null || r.absErrDes == null) { console.log(`    ${m}: 데이터 없음`); continue; }
      const seas = Math.abs(r.errSeasonal);
      const harmNSA = r.absErrNSA - seas, harmDes = r.absErrDes - seas; // +면 시즈널 대비 손해
      const cond = label.includes('저신호')
        ? harmDes <= harmNSA + 1e-9                 // 손해 축소(또는 개선 전환)
        : (seas - r.absErrDes) >= (seas - r.absErrNSA) - 0.05; // 개선폭 유지(±0.05 허용)
      ok = ok && cond;
      const tag = label.includes('저신호')
        ? `손해 ${fmt(harmNSA, 3)} → ${fmt(harmDes, 3)} ${harmDes <= harmNSA ? '↓' : '↑'}`
        : `개선 ${fmt(seas - r.absErrNSA, 3)} → ${fmt(seas - r.absErrDes, 3)} ${cond ? '유지' : '약화'}`;
      console.log(`    ${m}: |errNSA| ${fmt(r.absErrNSA)} → |errDes| ${fmt(r.absErrDes)}   (${tag})  ${cond ? '✅' : '⛔'}`);
    }
    return ok;
  };
  const g1 = gate('저신호월 3건 (손해 축소 기대)', ['2025-04', '2025-05', '2025-12']);
  const g2 = gate('유가 대변동월 4건 (개선 유지 기대)', ['2026-03', '2026-04', '2026-05', '2026-06']);
  console.log(`\n▶ 수용 게이트: ${g1 && g2 ? '통과 ✅ (저신호 손해↓ & 대변동 개선 유지)' : '미통과 ⛔'}`);
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });

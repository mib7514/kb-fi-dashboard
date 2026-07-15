// audit-curve-nodes.js — 커브 RV 개편 Phase 0 데이터 감사 (Node, 로컬 실행 전용, 사이트 번들 미포함).
//
// v2 (만기확장): 11노드(3월/6월/9월/1/1.5/2/2.5/3/4/5년/10년) xlsx를 감사해, 신규 노드
//   (3월/6월/9월/1.5/2.5/4년)가 실고시인지 인접 노드 보간인지 판별하고 히트맵 열을 확정한다.
//
// 입력: 만기확장 xlsx (argv[2] 또는 레포 루트 기본값). 시트 2개 사용:
//   · spread (헤더 17행, 데이터 20행~, 166열): A=일자, 국고열=금리 원값(%), 크레딧열=스프레드(%p).
//     → 노드 존재/첫관측/결측/보간의심(값=크레딧 스프레드·국고 금리레벨)·격차 산출.
//   · yield  (섹터 17행, 만기 18행, 데이터 19행~): 전 노드 금리 원계열(민평). 열 순서는 spread와 동일.
//     → **스테일 판정 전용** (크레딧 민평 원계열 기준 — 스프레드로 판정 시 국고 변동일을 오인).
//
// 출력: tools/audit-report-v2.md + 콘솔.
// 실행: node tools/audit-curve-nodes.js [xlsx경로]

const { createRequire } = require('node:module');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const require2 = createRequire(__filename);
const XLSX = require2('../vendor/xlsx.min.js');
const ROOT = join(__dirname, '..');

// ── 만기 노드 정의 (라벨 ↔ 연수) ──
const MAT_YEARS = { '3월': 0.25, '6월': 0.5, '9월': 0.75, '1년': 1, '1.5년': 1.5, '2년': 2, '2.5년': 2.5, '3년': 3, '4년': 4, '5년': 5, '10년': 10 };
const MAT_ORDER = Object.keys(MAT_YEARS); // 연수 오름차순
// 신규 노드 + 보간 판정용 고정 이웃 쌍(명령서 지정).
const NEW_NODES = ['3월', '6월', '9월', '1.5년', '2.5년', '4년'];
const NEIGHBORS = { '6월': ['3월', '9월'], '9월': ['6월', '1년'], '1.5년': ['1년', '2년'], '2.5년': ['2년', '3년'], '4년': ['3년', '5년'] };
const ENDPOINTS = new Set(['3월', '10년']); // 끝점 → 판정 불가

const STALE_RUN = 5;
const INTERP_TOL_BP = 0.25;
const INTERP_HIT_HI = 0.95;
const INTERP_HIT_LO = 0.60;
const ONE_YEAR = 245;
const STALE_HEAVY = 30;

// ── 유틸 ──
const round3 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 1000) / 1000 : null;
const serialToISO = (s) => new Date((Math.round(s) - 25569) * 86400000).toISOString().slice(0, 10);
const f1 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(1));
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));
function firstObs(dates, arr) { for (let i = 0; i < arr.length; i++) if (arr[i] != null) return dates[i]; return null; }
function missingPct(arr) { let n = 0; for (const v of arr) if (v == null) n++; return (n / arr.length) * 100; }

// spread 시트 파싱: 헤더 17행(idx16), 데이터 A열 시리얼(>40000). → {cols:[{idx,label}], dates, series}
function parseSheet(aoa, headerRowIdx) {
  const header = aoa[headerRowIdx] || [];
  const cols = [];
  for (let c = 1; c < header.length; c++) {
    const label = header[c];
    if (label != null && label !== '') cols.push({ idx: c, label: String(label) });
  }
  const dates = [];
  const series = {};
  for (const c of cols) series[c.label] = [];
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const a = aoa[r] && aoa[r][0];
    if (typeof a !== 'number' || a < 40000) continue;
    dates.push(serialToISO(a));
    for (const c of cols) series[c.label].push(round3(aoa[r][c.idx]));
  }
  return { cols, dates, series };
}

// yield 시트: 라벨은 spread 열 순서와 동일 → 위치로 라벨링. 데이터 A열 시리얼.
function parseYieldByCols(aoaYield, cols) {
  const dates = [];
  const series = {};
  for (const c of cols) series[c.label] = [];
  for (let r = 0; r < aoaYield.length; r++) {
    const a = aoaYield[r] && aoaYield[r][0];
    if (typeof a !== 'number' || a < 40000) continue;
    dates.push(serialToISO(a));
    for (const c of cols) series[c.label].push(round3(aoaYield[r][c.idx]));
  }
  return { dates, series };
}

// 5영업일 연속 동일 비null값 런 일수 비율(%). null이 런을 끊음.
function stalePct(arr) {
  let stale = 0, runVal = null, runLen = 0;
  const close = () => { if (runLen >= STALE_RUN) stale += runLen; runVal = null; runLen = 0; };
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) { close(); continue; }
    if (runLen > 0 && v === runVal) runLen++;
    else { close(); runVal = v; runLen = 1; }
  }
  close();
  return arr.length ? (stale / arr.length) * 100 : 0;
}

// 보간 의심 판정 (신규 내부 노드). 고정 이웃 쌍 선형보간 잔차로 전 구간 레짐 탐지.
//   · 잔차 = |node − lin(이웃)| (bp). 임계 0.25bp.
//   · 최근 1년 within-tol 비율(hit1y)로 현재 상태를 보고하되, **전 구간 전환**을 함께 탐지:
//     보간 레짐(잔차≈0) → 실고시 레짐(잔차>임계) 전환일 = 유효 히스토리 시작(백필 판별).
//   · 판정: 전 구간 실고시=실고시 / 전 구간 보간=보간 의심 / 중간 전환=부분 보간 의심(전환일).
// 반환 {verdict, hit1y, realStart(전환일 or null), backfilled(bool)}.
function interpVerdict(getSeries, sector, node) {
  if (ENDPOINTS.has(node)) return { verdict: '판정 불가(끝점)' };
  if (!NEW_NODES.includes(node)) return { verdict: '실고시' }; // 기존 노드(1/2/3/5년)
  const pair = NEIGHBORS[node];
  const target = getSeries(sector, node), lo = getSeries(sector, pair[0]), hi = getSeries(sector, pair[1]);
  if (!target) return { verdict: '노드 없음' };
  if (!lo || !hi) return { verdict: '판정 불가(이웃 없음)' };
  const w = (MAT_YEARS[node] - MAT_YEARS[pair[0]]) / (MAT_YEARS[pair[1]] - MAT_YEARS[pair[0]]);
  const n = target.length;
  // 전 구간 잔차(bp) — 결측은 NaN.
  const resid = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (target[i] == null || lo[i] == null || hi[i] == null) continue;
    resid[i] = Math.abs((target[i] - (lo[i] + (hi[i] - lo[i]) * w)) * 100);
  }
  // 최근 1년 within-tol 비율.
  let t1 = 0, w1 = 0;
  for (let i = Math.max(0, n - ONE_YEAR); i < n; i++) { if (Number.isNaN(resid[i])) continue; t1++; if (resid[i] < INTERP_TOL_BP) w1++; }
  const hit1y = t1 ? w1 / t1 : null;
  // 실고시 레짐 시작 탐지: 앞으로 20영업일 중 임계 초과 비율 ≥50%인 최초 시점.
  const WIN = 20;
  let realStartIdx = null;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(resid[i])) continue;
    let tot = 0, exc = 0;
    for (let j = i; j < Math.min(n, i + WIN); j++) { if (Number.isNaN(resid[j])) continue; tot++; if (resid[j] >= INTERP_TOL_BP) exc++; }
    if (tot >= 10 && exc / tot >= 0.5) { realStartIdx = i; break; }
  }
  // 판정: realStart 위치로.
  let verdict, backfilled = false, realStart = null;
  const firstValid = resid.findIndex((v) => !Number.isNaN(v));
  if (realStartIdx == null) verdict = '보간 의심';                 // 전 구간 보간(실고시 레짐 없음)
  else if (realStartIdx <= firstValid + WIN) verdict = '실고시';    // 사실상 처음부터 실고시
  else { verdict = '부분 보간 의심'; backfilled = true; realStart = realStartIdx; }
  return { verdict, hit1y, realStartIdx, backfilled, _resid: resid };
}

async function main() {
  const xlsxPath = process.argv[2] || join(ROOT, 'credit_spread_composite_영업일만_만기확장.xlsx');
  if (!existsSync(xlsxPath)) { console.error('❌ xlsx 없음:', xlsxPath); process.exit(1); }
  const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
  if (!wb.Sheets['spread'] || !wb.Sheets['yield']) { console.error('❌ spread/yield 시트 필요'); process.exit(1); }

  const spreadAoa = XLSX.utils.sheet_to_json(wb.Sheets['spread'], { header: 1, raw: true });
  const yieldAoa = XLSX.utils.sheet_to_json(wb.Sheets['yield'], { header: 1, raw: true });

  const S = parseSheet(spreadAoa, 16);          // 값(스프레드/국고레벨) — 보간·격차·존재
  const Y = parseYieldByCols(yieldAoa, S.cols); // 금리 원계열 — 스테일 전용

  const labels = S.cols.map((c) => c.label);
  const sectors = [...new Set(labels.map((l) => l.split('_')[0]))];
  const creditSectors = sectors.filter((s) => s !== '국고채권');
  const label = (sec, node) => `${sec}_${node}`;
  const has = (sec, node) => S.series[label(sec, node)] != null;
  const spreadSer = (sec, node) => S.series[label(sec, node)];   // 보간 판정용(크레딧=스프레드, 국고=레벨)
  const yieldSer = (sec, node) => Y.series[label(sec, node)];    // 스테일 판정용(원계열)

  // 노드 인벤토리 행 산출
  function invRow(sec, node) {
    if (!has(sec, node)) return { sec, node, exists: false, verdict: '노드 없음' };
    const arr = S.series[label(sec, node)];
    const ys = yieldSer(sec, node) || arr;      // 스테일은 yield 원계열
    const iv = interpVerdict(spreadSer, sec, node);
    return {
      sec, node, exists: true,
      firstObs: firstObs(S.dates, arr),
      missPct: missingPct(arr),
      staleYield: stalePct(ys),      // 명령서 지정: 크레딧 yield 원계열
      staleSpread: stalePct(arr),    // 실질: 스프레드(크레딧 리프라이싱) — 아래 finding 참조
      verdict: iv.verdict,
      realStart: iv.realStartIdx != null ? S.dates[iv.realStartIdx] : null,
      backfilled: !!iv.backfilled,
      hit1y: iv.hit1y,
    };
  }
  const inv = {};
  for (const s of sectors) inv[s] = MAT_ORDER.map((n) => invRow(s, n));

  // 만기쌍 유효성: 섹터·국고 둘 다 "현재 실고시"(실고시/부분보간=최근 실고시/끝점). 보간의심·노드없음 제외.
  //   부분 보간 의심 = 과거 백필+최근 실고시 → 현재 스프레드 산출은 유효(단 %ile 히스토리 짧음).
  const passOK = (v) => v === '실고시' || v === '부분 보간 의심' || v === '판정 불가(끝점)';
  function pairValid(sec, node) {
    const secRow = inv[sec].find((r) => r.node === node);
    const ktbRow = inv['국고채권'].find((r) => r.node === node);
    const secOK = secRow.exists && passOK(secRow.verdict);
    const ktbOK = ktbRow.exists && passOK(ktbRow.verdict);
    if (secOK && ktbOK) return { ok: true };
    const why = [];
    if (!secRow.exists) why.push(`${sec} 없음`); else if (!secOK) why.push(`${sec} ${secRow.verdict}`);
    if (!ktbRow.exists) why.push('국고 없음'); else if (!ktbOK) why.push(`국고 ${ktbRow.verdict}`);
    return { ok: false, why: why.join(' / ') };
  }

  // 보간 격차 분포(인접 실존 노드 스프레드 격차 bp, 최신)
  function gapDist(sec) {
    const segs = [];
    for (let i = 0; i < MAT_ORDER.length - 1; i++) {
      const a = MAT_ORDER[i], b = MAT_ORDER[i + 1];
      const A = spreadSer(sec, a), B = spreadSer(sec, b);
      if (!A || !B) { segs.push({ a, b, latest: null }); continue; }
      let latest = null;
      for (let j = 0; j < A.length; j++) if (A[j] != null && B[j] != null) latest = Math.abs((B[j] - A[j]) * 100);
      segs.push({ a, b, latest });
    }
    const lats = segs.map((s) => s.latest).filter((v) => v != null).sort((x, y) => x - y);
    return { segs, max: lats.length ? lats[lats.length - 1] : null, med: lats.length ? lats[Math.floor(lats.length / 2)] : null };
  }

  // ══════════ 리포트 ══════════
  const L = []; const p = (s) => L.push(s);
  p('# 커브 RV Phase 0 재감사 (만기확장) — 노드 감사 리포트 v2\n');
  p(`> 데이터: \`${xlsxPath.split(/[\\/]/).pop()}\` · spread+yield 시트`);
  p(`> 기간: ${S.dates[0]} ~ ${S.dates[S.dates.length - 1]} · 영업일 ${S.dates.length}(spread)/${Y.dates.length}(yield) · 섹터 ${sectors.length}(국고 포함) · 만기 ${MAT_ORDER.length}노드`);
  p(`> 판정 값: 보간의심=크레딧 스프레드·국고 금리레벨 / 스테일=yield 원계열(민평). 신규 노드: ${NEW_NODES.join('/')} (3월·10년 끝점 판정불가).\n`);

  // 1) 노드 인벤토리 — 크레딧
  p('## 노드 인벤토리 (크레딧 섹터)\n');
  p('스테일%: yield=크레딧 금리 원계열(명령서 지정) / **spread=스프레드(크레딧 리프라이싱, 실질)** — 괴리는 아래 finding 참조.\n');
  p('| 섹터 | 만기 | 첫 관측일 | 결측% | 스테일%(yield) | 스테일%(spread) | 판정 |');
  p('|---|---|---|---|---|---|---|');
  const vtxt = (r) => (r.backfilled && r.realStart) ? `${r.verdict}(실고시 ${r.realStart}~)` : r.verdict;
  for (const s of creditSectors) for (const r of inv[s]) {
    if (!r.exists) { p(`| ${s} | ${r.node} | — | — | — | — | 노드 없음 |`); continue; }
    p(`| ${s} | ${r.node} | ${r.firstObs} | ${f1(r.missPct)} | ${f1(r.staleYield)} | ${f1(r.staleSpread)} | ${vtxt(r)} |`);
  }
  p('');

  // 2) 국고 노드 (국고는 스프레드 개념 없음 → 금리 레벨 스테일만)
  p('## 국고 노드\n');
  p('| 만기 | 첫 관측일 | 결측% | 스테일%(금리레벨) | 판정 |');
  p('|---|---|---|---|---|');
  for (const r of inv['국고채권']) {
    if (!r.exists) { p(`| ${r.node} | — | — | — | 노드 없음 |`); continue; }
    p(`| ${r.node} | ${r.firstObs} | ${f1(r.missPct)} | ${f1(r.staleYield)} | ${vtxt(r)} |`);
  }
  p('');

  // 2b) 스테일 판정 방식 finding (예상 밖)
  p('## ⚠ 예상 밖 발견 — 스테일 판정 기준 (yield vs spread)\n');
  p('명령서는 "yield 원계열로 스테일 판정(국고 변동일 오인 방지)"을 지정했으나, **실제 벤더 거동은 반대**다:');
  p('- 크레딧 **yield는 매일 변동**(국고 변동을 그대로 passthrough) → yield 기준 스테일 ≈ **0%** (장기·저등급도).');
  p('- 그러나 **스프레드는 5영업일+ 정체**가 잦다(벤더가 스프레드를 고정한 채 국고만 얹음) → 크레딧 고유 리프라이싱은 스테일.');
  p('- 예: 회사채BBB+_10년 yield-stale 0.0% vs spread-stale 44.4% / 은행채AAA_10년 0.0% vs 55.3% / 회사채A0_10년 0.0% vs 57.7%.');
  p('→ **스프레드 RV의 유효 스테일 = spread 기준**. yield 기준(명령서)은 장기·저등급 스테일을 0%로 오판(과소). Phase 1 스테일 규칙은 **spread 기준 권장**(또는 국고-passthrough 탐지). *결정 요청.*\n');

  // 3) 신규 노드 보간 판정 요약 (섹터 집계)
  p('## 신규 노드 보간 판정 요약\n');
  p('신규 내부 노드(6월/9월/1.5/2.5/4년)별: 국고 판정 + 크레딧 14섹터 판정 분포.\n');
  p('| 만기 | 국고 | 크레딧 실고시 | 부분보간(백필) | 보간의심 |');
  p('|---|---|---|---|---|');
  for (const node of ['6월', '9월', '1.5년', '2.5년', '4년']) {
    const kr = inv['국고채권'].find((r) => r.node === node);
    const ktb = kr.backfilled && kr.realStart ? `부분보간(${kr.realStart}~)` : kr.verdict;
    let real = 0, part = 0, susp = 0;
    for (const s of creditSectors) {
      const v = inv[s].find((r) => r.node === node).verdict;
      if (v === '실고시') real++; else if (v === '부분 보간 의심') part++; else if (v === '보간 의심') susp++;
    }
    p(`| ${node} | ${ktb} | ${real} | ${part} | ${susp} |`);
  }
  p('');

  // 4) 만기쌍 유효성 매트릭스
  p('## 만기쌍 유효성 매트릭스 (섹터 스프레드 ∧ 국고 둘 다 실고시)\n');
  p('| 섹터 \\ 만기 | ' + MAT_ORDER.join(' | ') + ' |');
  p('|' + '---|'.repeat(MAT_ORDER.length + 1));
  for (const s of creditSectors) {
    const cells = MAT_ORDER.map((n) => (pairValid(s, n).ok ? '✅' : '❌'));
    p(`| ${s} | ${cells.join(' | ')} |`);
  }
  p('');

  // 5) 보간 격차 분포
  p('## 보간 격차 분포 (인접 노드 스프레드 격차, bp, 최신)\n');
  p('| 섹터 | ' + MAT_ORDER.slice(0, -1).map((a, i) => `${a}-${MAT_ORDER[i + 1]}`).join(' | ') + ' | max | med |');
  p('|' + '---|'.repeat(MAT_ORDER.length + 2));
  for (const s of creditSectors) {
    const g = gapDist(s);
    p(`| ${s} | ${g.segs.map((seg) => f1(seg.latest)).join(' | ')} | ${f1(g.max)} | ${f1(g.med)} |`);
  }
  p('');

  // 6) 권고 요약
  // 스테일 과다 = spread 기준(실질). yield 기준은 0%라 무의미.
  const staleHeavy = [];
  for (const s of creditSectors) for (const r of inv[s]) if (r.exists && r.staleSpread > STALE_HEAVY) staleHeavy.push(`${s}_${r.node} (spread ${f1(r.staleSpread)}%)`);
  // 히트맵 열 권고: 국고 실고시 ∧ 크레딧 과반 실고시인 만기만.
  function colRecommend(node) {
    const ktbRow = inv['국고채권'].find((r) => r.node === node);
    if (!ktbRow.exists || !passOK(ktbRow.verdict)) return { node, ok: false, reason: `국고 ${ktbRow.exists ? ktbRow.verdict : '없음'}` };
    let real = 0, tot = 0;
    for (const s of creditSectors) { const v = inv[s].find((r) => r.node === node).verdict; tot++; if (passOK(v)) real++; }
    return { node, ok: real >= Math.ceil(tot / 2), realRatio: `${real}/${tot}` };
  }
  const recs = MAT_ORDER.map(colRecommend);
  const okCols = recs.filter((r) => r.ok).map((r) => r.node);
  const sub3 = okCols.filter((n) => MAT_YEARS[n] <= 3);
  const three5 = okCols.filter((n) => MAT_YEARS[n] >= 3 && MAT_YEARS[n] <= 5);

  // 노드별 유효 실고시 히스토리 길이(영업일) = dates.length − max(realStartIdx over 국고+credit).
  function effHistDays(node) {
    let latestIdx = 0;
    for (const s of sectors) { const r = inv[s].find((x) => x.node === node); if (r.exists && r.realStart) { const i = S.dates.indexOf(r.realStart); if (i > latestIdx) latestIdx = i; } }
    return S.dates.length - latestIdx;
  }
  const SHORT_HIST = 490; // ~2년 미만이면 %ile 모수 부족 경고
  const shortCols = MAT_ORDER.filter((n) => !ENDPOINTS.has(n) && effHistDays(n) < SHORT_HIST && okCols.includes(n));
  const earlyBackfill = MAT_ORDER.filter((n) => inv['국고채권'].find((r) => r.node === n).backfilled);

  p('## 권고 요약\n');
  p('### 히트맵 열 구성 (현재 실고시 통과 노드)');
  p(`- **0~3년 구간**: ${sub3.join(' / ') || '—'}`);
  p(`- **3~5년 구간**: ${three5.join(' / ') || '—'}`);
  p(`- 전체 권고 열: **${okCols.join(' / ')}** (10년은 별도 장기 열)`);
  p(`- **유효 히스토리 충분**: 신규 노드 대부분 2015부터 실고시(~11.6년). 6월/9월은 2015-04~05부터(초기 3~4개월만 보간 백필 — %ile 무영향).`);
  if (shortCols.length) p(`- ⚠ %ile 히스토리 부족(<2년) 열: ${shortCols.join(' / ')} → 초기 "히스토리 부족" 표기 권장.`);
  else p('- ⚠ %ile 히스토리 부족(<2년) 열: 없음 — 전 권고 열이 245/750 윈도우 모수 충족.');
  p('- 열별 판정 (유효 실고시 히스토리):');
  for (const r of recs) {
    const yrs = ENDPOINTS.has(r.node) ? '—' : (effHistDays(r.node) / 245).toFixed(1) + '년';
    const bf = earlyBackfill.includes(r.node) ? ', 초기 백필' : '';
    p(`  - ${r.node}: ${r.ok ? `채택 (크레딧 실고시 ${r.realRatio}, 히스토리 ${yrs}${bf})` : `제외 (${r.reason || '크레딧 과반 미달 ' + (r.realRatio || '')})`}`);
  }
  p('');
  p('### 스테일 과다(>30%) 셀');
  p(staleHeavy.length ? staleHeavy.map((x) => `- ${x}`).join('\n') : '- 없음');
  p('');
  p('### 신규 노드 유효 히스토리 시작점 (%ile 모수 결정)');
  p('데이터는 2015부터 있으나 신규 노드는 특정일까지 **인접 보간 백필** → 유효 실고시 시작일부터만 %ile/백테스트 모수로 사용 가능.\n');
  p('| 만기 | 데이터 시작 | 국고 유효시작 | 크레딧 유효시작(최늦) | 유효 히스토리 길이 |');
  p('|---|---|---|---|---|');
  for (const node of NEW_NODES) {
    const kr = inv['국고채권'].find((r) => r.node === node);
    const kStart = kr.backfilled ? kr.realStart : (ENDPOINTS.has(node) ? '판정불가(끝점)' : kr.firstObs);
    let latest = null;
    for (const s of creditSectors) { const r = inv[s].find((x) => x.node === node); const rs = r.backfilled ? r.realStart : r.firstObs; if (rs && (!latest || rs > latest)) latest = rs; }
    const dataStart = inv['국고채권'].find((r) => r.node === node).firstObs;
    let lenTxt = '—';
    if (latest && !ENDPOINTS.has(node)) { const idx = S.dates.indexOf(latest); if (idx >= 0) lenTxt = `~${S.dates.length - idx}영업일 (약 ${((S.dates.length - idx) / 245).toFixed(1)}년)`; }
    p(`| ${node} | ${dataStart || '—'} | ${kStart || '—'} | ${latest || '—'} | ${lenTxt} |`);
  }
  p('');

  const report = L.join('\n') + '\n';
  writeFileSync(join(__dirname, 'audit-report-v2.md'), report, 'utf8');
  process.stdout.write(report);
  console.error('\n[audit-v2] tools/audit-report-v2.md 작성 완료.');
}

main().catch((e) => { console.error('[audit-v2] 실패:', e.stack || e.message); process.exit(1); });

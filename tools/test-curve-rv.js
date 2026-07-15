// test-curve-rv.js — 커브 RV Phase 1 검증 하네스 (node 실행). 게이트 1·2·4·5.
//   1) 자체 테스트: 손계산 대조 + 경계 null.  2) 실데이터 스팟 체크 표.
//   4) 3월 독립성 검사 판정.  5) 5노드 값 회귀 대조(재생성 vs 현행 HEAD).
// 실행: node tools/test-curve-rv.js   (data/credit-spread.js 재생성 후)

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..');
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

async function main() {
  const C = await import(pathToFileURL(join(ROOT, 'js', 'curve-rv-calc.js')).href);
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); } };

  console.log('════ 게이트 1: 자체 테스트 (손계산 대조 + 경계) ════');
  // ① carry: 평탄 커브 S=26, m=2, h=1/12 → 26/12 = 2.1667
  t('carry: S=26 × 1/12 = 2.1667', () => {
    const cv = { nodes: [1, 2, 3], values: [26, 26, 26] };
    near(C.carry(cv, 2, 1 / 12), 26 / 12);
  });
  // ② rolldown 평탄 커브 → 0, excess = carry
  t('rolldown 평탄=0, excess=carry', () => {
    const cv = { nodes: [1, 2, 3], values: [26, 26, 26] };
    near(C.reval(cv, 2, 1 / 12, 0), 0);
    near(C.excessReturn(cv, 2, 1 / 12, 0), 26 / 12);
  });
  // ③ rolldown 우상향: nodes[1,2]=[20,30], m=2,h=1/12 → rem=1.91667, S(rem)=29.1667
  //    reval = −(29.1667−30)×1.91667 = 1.5972 ; carry=2.5 ; excess=4.0972
  t('rolldown 우상향 손계산', () => {
    const cv = { nodes: [1, 2], values: [20, 30] };
    const rem = 2 - 1 / 12;
    const sRem = 20 + 10 * (rem - 1); // 29.16667
    near(C.curveVal(cv, rem), sRem);
    near(C.reval(cv, 2, 1 / 12, 0), -(sRem - 30) * rem);      // 1.59722
    near(C.reval(cv, 2, 1 / 12, 0), 1.59722, 1e-4);
    near(C.excessReturn(cv, 2, 1 / 12, 0), 30 / 12 + 1.59722, 1e-4); // 4.09722
  });
  // ④ ΔS≠0: 위 커브 + ΔS=5bp 확대 → reval=−(29.1667+5−30)×1.91667=−7.9861, excess=−5.4861
  t('ΔS=5 시나리오 재평가', () => {
    const cv = { nodes: [1, 2], values: [20, 30] };
    const rem = 2 - 1 / 12, sRem = 20 + 10 * (rem - 1);
    near(C.reval(cv, 2, 1 / 12, 5), -(sRem + 5 - 30) * rem, 1e-4); // −7.98611
    near(C.excessReturn(cv, 2, 1 / 12, 5), 30 / 12 + (-(sRem + 5 - 30) * rem), 1e-4); // −5.48611
  });
  // ⑤ 경계: m−h < 최소노드(0.25) → null (외삽 금지)
  t('경계 m−h<0.25 → null', () => {
    const cv = { nodes: [0.25, 0.5, 1], values: [10, 12, 15] };
    assert.equal(C.reval(cv, 0.25, 1 / 12, 0), null);      // rem=0.1667<0.25
    assert.equal(C.excessReturn(cv, 0.25, 1 / 12, 0), null);
    assert.equal(C.curveVal(cv, 0.1), null);               // 범위 밖
    assert.equal(C.curveVal(cv, 11), null);
  });
  // ⑥ 스테일 전 구간 → pctile null ; 스테일 마스크
  t('전 구간 스테일 → pctile null', () => {
    const s = new Array(300).fill(50); // bp, 전부 동일 → 5일룰 스테일
    const mask = C.staleMask(s.map(v => v / 100)); // %p 기준(동일값이면 결과 동일)
    assert.ok(mask.every(Boolean));
    assert.equal(C.pctile(s, mask, 'full'), null);
  });
  // ⑦ staleMask: 5일 미만 런은 스테일 아님, null이 런 끊음
  t('staleMask 5일 경계·null 끊김', () => {
    const s = [1, 1, 1, 1, 2, 3, 3, 3, 3, 3]; // 앞 4연속(<5, 비스테일), 뒤 5연속(스테일)
    const m = C.staleMask(s);
    assert.deepEqual(m.slice(0, 5), [false, false, false, false, false]);
    assert.deepEqual(m.slice(5), [true, true, true, true, true]);
  });
  // ⑧ maturityIndependence: 완전 상이 Δ → 100%, 동일 Δ → 0%
  t('maturityIndependence 극단', () => {
    const a = Array.from({ length: 260 }, (_, i) => 0.20 + i * 0.001);   // Δ=0.1bp
    const b = Array.from({ length: 260 }, (_, i) => 0.30 - i * 0.001);   // Δ=−0.1bp (상이)
    assert.ok(C.maturityIndependence(a, b).ratio > 99);
    assert.ok(C.maturityIndependence(a, a).ratio < 1);
  });
  console.log(`게이트 1: pass ${pass} / fail ${fail}\n`);

  // ── 실데이터 로드 ──
  globalThis.window = {};
  await import(pathToFileURL(join(ROOT, 'data', 'credit-spread.js')).href);
  const D = globalThis.window.FENRIR_SERIES['credit-spread'];
  const { dates, series, meta } = D;
  const nodes = meta.nodes, mats = meta.maturities;
  const T = dates.length - 1; // 최신 시점
  const bpArr = (lab) => (series[lab] || []).map(v => (v == null ? null : v * 100));

  // ── 게이트 2: 스팟 체크 표 (공사채AAA·회사채AA- × 1/2/3년 × h=1개월) ──
  console.log('════ 게이트 2: 실데이터 스팟 체크 (h=1개월, 최신 ' + dates[T] + ') ════');
  console.log('| 섹터 | 만기 | 스프레드bp | carry | rolldown | excess | 1y %ile |');
  console.log('|---|---|---|---|---|---|---|');
  const h = 1 / 12;
  for (const sec of ['공사채AAA', '회사채AA-']) {
    const values = mats.map(mat => { const v = series[`${sec}_${mat}`]?.[T]; return v == null ? null : v * 100; });
    const curve = { nodes, values };
    for (const m of [1, 2, 3]) {
      const lab = `${sec}_${m}년`;
      const sp = bpArr(lab);
      const mask = C.staleMask(series[lab] || []);
      const row = [sec, `${m}년`, f(C.curveVal(curve, m)), f(C.carry(curve, m, h)),
        f(C.reval(curve, m, h, 0)), f(C.excessReturn(curve, m, h, 0)), f(C.pctile(sp, mask, '1y'), 0)];
      console.log('| ' + row.join(' | ') + ' |');
    }
  }
  console.log('');

  // ── 게이트 4: 3월 독립성 검사 ──
  console.log('════ 게이트 4: 3월 독립성 검사 ════');
  // 국고3월 특칙 데모: 국고3월 스테일일 → 크레딧3월 마스크 합성
  let ratios = [];
  for (const sec of meta.sectors.filter(s => s !== '국고채권')) {
    const s3 = series[`${sec}_3월`], s6 = series[`${sec}_6월`];
    if (!s3 || !s6) continue;
    const r = C.maturityIndependence(s3, s6);
    ratios.push({ sec, ...r });
  }
  const avg = ratios.reduce((s, r) => s + (r.ratio || 0), 0) / ratios.length;
  const med = ratios.map(r => r.ratio).sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
  console.log(`섹터별 Δ(3월)≠Δ(6월) 비율(최근 250일): 평균 ${f(avg, 1)}% · 중앙 ${f(med, 1)}%`);
  console.log('  샘플: ' + ratios.slice(0, 4).map(r => `${r.sec} ${f(r.ratio, 1)}%`).join(' / '));
  const verdict = med >= 20 ? '독립 실고시 → 3월 포함 확정' : med < 5 ? '파생 의심 → 3월 열 제외' : '중간 → 재논의';
  console.log(`▶ 판정(중앙 ${f(med, 1)}%): ${verdict}\n`);

  // ── 게이트 5: 5노드 값 회귀 대조 (재생성 vs HEAD) ──
  console.log('════ 게이트 5: 5노드 값 회귀 대조 (재생성 vs 현행 HEAD) ════');
  const oldWin = {};
  try {
    const { execSync } = require('node:child_process');
    const headSrc = execSync('git show HEAD:data/credit-spread.js', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    new Function('window', headSrc)(oldWin);
  } catch (e) { console.log('  HEAD 로드 실패:', e.message); }
  const OLD = oldWin.FENRIR_SERIES && oldWin.FENRIR_SERIES['credit-spread'];
  if (!OLD) { console.log('  HEAD 데이터 없음 — 대조 skip'); }
  else {
    const oldIdx = new Map(OLD.dates.map((d, i) => [d, i]));
    const newIdx = new Map(dates.map((d, i) => [d, i]));
    const overlap = OLD.dates.filter(d => newIdx.has(d));
    const OLD5 = ['1년', '2년', '3년', '5년', '10년'];
    let cmp = 0, nullFill = 0, revised = 0, maxDev = 0, maxAt = '';
    const revDates = new Set(), fillDates = new Set();
    for (const sec of meta.sectors) for (const mat of OLD5) {
      const lab = `${sec}_${mat}`;
      const oa = OLD.series[lab], na = series[lab];
      if (!oa || !na) continue;
      for (const d of overlap) {
        const ov = oa[oldIdx.get(d)], nv = na[newIdx.get(d)];
        if (ov == null && nv == null) continue;
        cmp++;
        if ((ov == null) !== (nv == null)) { nullFill++; fillDates.add(d); continue; } // null↔값 (결측 채움/제거)
        const dev = Math.abs(ov - nv) * 100; // bp, 양쪽 비null
        if (dev > 0.05) { revised++; revDates.add(d); if (dev > maxDev) { maxDev = dev; maxAt = `${lab}@${d}`; } }
      }
    }
    const span = (set) => { const a = [...set].sort(); return a.length ? `${a[0]} ~ ${a[a.length - 1]} (${a.length}일)` : '없음'; };
    console.log(`중첩 기간: ${overlap[0]} ~ ${overlap[overlap.length - 1]} (${overlap.length}일) · 비교 셀 ${cmp}`);
    console.log(`① null↔값(결측 채움): ${nullFill}건 · 발생일 ${span(fillDates)} — 만기확장 파일이 결측을 채운 것(벤더 수정 아님)`);
    console.log(`② 기존값 변경(벤더 소급 수정 의심): ${revised}건 · 발생일 ${span(revDates)} · 최대 편차 ${f(maxDev, 3)}bp @ ${maxAt || '—'}`);
  }

  console.log('');
  console.log(fail === 0 ? '✅ 게이트 1 전 통과' : `⛔ 게이트 1 실패 ${fail}건`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error('실패:', e.stack || e.message); process.exit(1); });

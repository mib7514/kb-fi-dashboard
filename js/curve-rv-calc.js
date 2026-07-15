// curve-rv-calc.js — 커브 RV 기대수익 계산 코어 (Phase 1, 순수 함수만·DOM 접근 금지).
//   meta.nodes(발견된 숫자 만기 그리드) 위에서 스테일 필터 + 기대수익(캐리+롤/시나리오 재평가)을
//   독립 수행한다. 구 rv-calc.js(5노드)와 분리 — Phase 2 UI가 이 모듈로 전환한다.
//
// 단위: 스프레드·캐리·롤·기대수익 = bp. 만기·호라이즌 = 년(h=1개월 → 1/12). ΔS = bp.

// ── 1b) 스테일 필터 ──────────────────────────────────────────────
// 5영업일 연속 동일 스프레드값 → 그 런의 모든 날을 스테일(true). null이 런을 끊는다.
// 국고 3월 특칙(국고3월 스테일일 → 크레딧3월도 제외)은 호출부에서 combineMask로 합성.
export function staleMask(spreadSeries, runLen = 5) {
  const n = spreadSeries.length;
  const mask = new Array(n).fill(false);
  let start = -1, val = null, len = 0;
  const close = (end) => { if (len >= runLen) for (let k = start; k < end; k++) mask[k] = true; start = -1; val = null; len = 0; };
  for (let i = 0; i < n; i++) {
    const v = spreadSeries[i];
    if (v == null || !Number.isFinite(v)) { close(i); continue; }
    if (len > 0 && v === val) { len++; }
    else { close(i); start = i; val = v; len = 1; }
  }
  close(n);
  return mask;
}

// 여러 마스크 OR 합성 (국고3월 특칙 합성용). 길이 동일 가정.
export function combineMask(...masks) {
  const n = Math.max(0, ...masks.map(m => m.length));
  const out = new Array(n).fill(false);
  for (const m of masks) for (let i = 0; i < m.length; i++) if (m[i]) out[i] = true;
  return out;
}

// 스테일 비율(표기용): window 내 스테일 일수 / 유효(비null) 일수 %.
export function staleRatio(spreadSeries, mask, window) {
  const n = spreadSeries.length;
  const from = window === '1y' ? Math.max(0, n - 250) : 0;
  let stale = 0, valid = 0;
  for (let i = from; i < n; i++) {
    if (spreadSeries[i] == null || !Number.isFinite(spreadSeries[i])) continue;
    valid++; if (mask[i]) stale++;
  }
  return valid ? stale / valid * 100 : null;
}

// ── 1b) 3월 독립성 검사 ─────────────────────────────────────────
// 최근 1년(250영업일) Δ(3월 spread) ≠ Δ(6월 spread)인 비율. 판정은 호출부/리포트.
// s3m/s6m: 스프레드 시계열(%p, null 포함). Δ는 bp. 허용오차 0.05bp(민평 3자리 반올림 노이즈).
export function maturityIndependence(s3m, s6m, { window = 250, tolBp = 0.05 } = {}) {
  const n = Math.min(s3m.length, s6m.length);
  const from = Math.max(1, n - window);
  let diff = 0, total = 0;
  for (let i = from; i < n; i++) {
    const a0 = s3m[i - 1], a1 = s3m[i], b0 = s6m[i - 1], b1 = s6m[i];
    if ([a0, a1, b0, b1].some(v => v == null || !Number.isFinite(v))) continue;
    const dA = (a1 - a0) * 100, dB = (b1 - b0) * 100;
    total++;
    if (Math.abs(dA - dB) > tolBp) diff++;
  }
  return { ratio: total ? diff / total * 100 : null, nDiff: diff, nTotal: total };
}

// ── 1c) 기대수익 계산 코어 ──────────────────────────────────────
// 선형보간. m < 최소노드 또는 > 최대노드면 null(외삽 금지). nodes 오름차순.
export function interp(nodes, values, m) {
  const n = nodes.length;
  if (!n || m < nodes[0] || m > nodes[n - 1]) return null;
  for (let i = 1; i < n; i++) {
    if (m <= nodes[i]) {
      const x0 = nodes[i - 1], x1 = nodes[i], y0 = values[i - 1], y1 = values[i];
      if (y0 == null || y1 == null) return null;
      return y0 + (y1 - y0) * (m - x0) / (x1 - x0);
    }
  }
  return values[n - 1];
}

// curve = { nodes:[...년], values:[...bp] }. m년 스프레드(bp) — 보간, 범위 밖 null.
export function curveVal(curve, m) { return interp(curve.nodes, curve.values, m); }

// 캐리(bp) = S(m) × h.  [스프레드(bp) × 보유기간(년) = 기간 중 받는 스프레드(bp)]
export function carry(curve, m, h) {
  const s = curveVal(curve, m);
  return s == null ? null : s * h;
}

// 재평가(롤다운+시나리오, bp) = −[ S(m−h) + ΔS − S(m) ] × (m−h).
//   ΔS(bp)=0이면 순수 롤다운. m−h < 최소노드(외삽)면 null. 스프레드듀레이션 ≈ 잔존만기(m−h)
//   선형 근사(민평 정밀도 초과 정교화 안 함). ΔS 해석 = "호라이즌 h 말까지의 변화"(자동 스케일 없음).
export function reval(curve, m, h, dS = 0) {
  const rem = m - h;
  const sRem = curveVal(curve, rem);   // 롤다운 후 잔존만기 스프레드
  const sNow = curveVal(curve, m);
  if (sRem == null || sNow == null) return null; // rem < 최소노드 등 → null
  return -(sRem + dS - sNow) * rem;
}

// 기대수익(bp) = carry + reval. 어느 하나 null이면 null.
export function excessReturn(curve, m, h, dS = 0) {
  const c = carry(curve, m, h), r = reval(curve, m, h, dS);
  return (c == null || r == null) ? null : c + r;
}

// 스테일 제외 모수에서 %ile. seriesBp: bp 시계열(null 포함), mask: 스테일 boolean[].
//   window: '1y'=최근 250(스테일 제외 후) / 'full'=전체. current = 스테일 제외 최신값.
//   count(v <= cur)/n × 100. 유효 모수 0이면 null.
export function pctile(seriesBp, mask, window) {
  const clean = [];
  for (let i = 0; i < seriesBp.length; i++) {
    const v = seriesBp[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (mask && mask[i]) continue;
    clean.push(v);
  }
  if (!clean.length) return null;
  const cur = clean[clean.length - 1];
  const w = window === '1y' ? clean.slice(-250) : clean;
  if (!w.length) return null;
  let c = 0; for (const v of w) if (v <= cur) c++;
  return c / w.length * 100;
}

// 헬퍼: 특정 시점 t의 커브 재구성 (섹터 스프레드 노드값, bp). 결측 노드는 값 null.
//   series: {라벨:[%p...]}, nodes: 숫자, maturities: 라벨(node순). 반환 {nodes, values(bp)}.
export function curveAt(series, sector, nodes, maturities, t) {
  const values = maturities.map((mat) => {
    const arr = series[`${sector}_${mat}`];
    const v = arr ? arr[t] : null;
    return (v == null || !Number.isFinite(v)) ? null : v * 100; // %p → bp
  });
  return { nodes, values };
}

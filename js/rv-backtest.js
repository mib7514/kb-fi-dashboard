// rv-backtest.js — 커브 RV 평균회귀 백테스트 (순수 함수·DOM 무관, node 테스트 가능).
//   스테일 제외 모수 full %ile 3버킷 + 에피소드 카운팅(연속 동일 버킷 = 1 에피소드).
//   사전계산은 tools/build-backtest.mjs, 표시는 rv-heatmap/rv-ui.

export const BUCKETS = ['low', 'mid', 'high'];
export const FWD_DAYS = { 1: 21, 3: 63, 6: 126 }; // 개월 → 영업일(≈250/12)

// full %ile → 버킷 (저 ≤33 / 중 / 고 ≥67)
export function bucketize(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct <= 33) return 'low';
  if (pct >= 67) return 'high';
  return 'mid';
}

// 정렬 배열에서 v 이하 개수 (upperBound)
function countLE(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

// 스테일 제외 모수 분포 → 각 값의 full %ile 함수.
export function fullPctileFn(spreadBp, staleMask) {
  const dist = [];
  for (let i = 0; i < spreadBp.length; i++) {
    const v = spreadBp[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (staleMask && staleMask[i]) continue;
    dist.push(v);
  }
  dist.sort((a, b) => a - b);
  const n = dist.length;
  return (v) => (n === 0 || v == null || !Number.isFinite(v)) ? null : countLE(dist, v) / n * 100;
}

// 스테일 비율(%): 스테일 일수 / 유효(비null) 일수.
export function staleRatioFull(spreadBp, staleMask) {
  let stale = 0, valid = 0;
  for (let i = 0; i < spreadBp.length; i++) {
    if (spreadBp[i] == null || !Number.isFinite(spreadBp[i])) continue;
    valid++; if (staleMask[i]) stale++;
  }
  return valid ? stale / valid * 100 : null;
}

// 에피소드 통계: 버킷별 { n(에피소드), mean(진입일 forward Δ), shrink(Δ<0 횟수) }.
//   버킷 시리즈 = 스테일/무값 → null(에피소드 끊김). 연속 동일 버킷 = 1 에피소드,
//   진입일(런 첫날) 기준 forward Δ = spread[entry+fwd] − spread[entry].
export function episodeStats(spreadBp, staleMask, fwdDays) {
  const n = spreadBp.length;
  const pctOf = fullPctileFn(spreadBp, staleMask);
  const bucket = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = spreadBp[i];
    bucket[i] = (v == null || !Number.isFinite(v) || (staleMask && staleMask[i])) ? null : bucketize(pctOf(v));
  }
  const acc = { low: [], mid: [], high: [] };
  let i = 0;
  while (i < n) {
    const b = bucket[i];
    if (b == null) { i++; continue; }
    let j = i; while (j + 1 < n && bucket[j + 1] === b) j++; // 런 [i..j]
    const fwd = i + fwdDays;                                 // 진입일 forward
    if (fwd < n) {
      const s0 = spreadBp[i], s1 = spreadBp[fwd];
      if (s0 != null && s1 != null && Number.isFinite(s0) && Number.isFinite(s1)) acc[b].push(s1 - s0);
    }
    i = j + 1;
  }
  const out = {};
  for (const b of BUCKETS) {
    const d = acc[b];
    out[b] = d.length ? { n: d.length, mean: d.reduce((s, x) => s + x, 0) / d.length, shrink: d.filter(x => x < 0).length } : { n: 0, mean: null, shrink: 0 };
  }
  return out;
}

// 게이트 적용: 에피소드 < minEpisodes면 해당 버킷 null(미제공).
export function applyGate(stats, minEpisodes = 5) {
  const out = {};
  for (const b of BUCKETS) out[b] = (stats[b].n >= minEpisodes) ? { n: stats[b].n, mean: stats[b].mean, shrink: stats[b].shrink } : null;
  return out;
}

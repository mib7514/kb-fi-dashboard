// cp-overlay.js — 사이클 오버레이 계산. 순수 함수, ES module.
//   첫 인상일 T=0 에 정렬해 기울기(3s10s/2s10s) 경로를 세션 오프셋 축으로 재배열.
//   판정 라벨의 '역사 원형' 참조용 — 측정만(경로·실측 Δ). 각국 자체 거래일(크로스 조인 없음).

// 기울기 시계열: (장기 − 단기), bp. rows 는 해당국 yields.data.
export function slopeSeries(rows, kLong, kShort) {
  const out = [];
  for (const r of rows) {
    if (r[kLong] == null || r[kShort] == null) continue;
    out.push([r.date, Math.round((r[kLong] - r[kShort]) * 100 * 10) / 10]);
  }
  return out;
}

// T=0 정렬: t0 이후 첫 거래일을 offset 0 으로, [−pre, +post] 세션 슬라이스.
//   반환 { points:[{offset,date,bp}], t0Bp, endBp, t0Date } (t0 이 범위 밖이면 points:[]).
export function eventAligned(slope, t0, pre = 120, post = 250) {
  const idx = slope.findIndex((d) => d[0] >= t0);
  if (idx < 0) return { points: [], t0Bp: null, endBp: null, t0Date: null };
  const lo = Math.max(0, idx - pre);
  const hi = Math.min(slope.length - 1, idx + post);
  const points = [];
  for (let i = lo; i <= hi; i++) points.push({ offset: i - idx, date: slope[i][0], bp: slope[i][1] });
  return { points, t0Bp: slope[idx][1], endBp: slope[hi][1], t0Date: slope[idx][0] };
}

// 한 시장의 오버레이 구성: cycles 각 항목에 경로·실측 Δ(T0→창끝) 부착.
export function buildOverlay(rows, kLong, kShort, cycles) {
  const slope = slopeSeries(rows, kLong, kShort);
  return cycles.map((c) => {
    const a = eventAligned(slope, c.t0);
    const deltaBp = (a.t0Bp == null || a.endBp == null) ? null : Math.round((a.endBp - a.t0Bp) * 10) / 10;
    const lastOffset = a.points.length ? a.points[a.points.length - 1].offset : null;
    return { ...c, points: a.points, t0Bp: a.t0Bp, endBp: a.endBp, deltaBp, lastOffset, t0Date: a.t0Date };
  });
}

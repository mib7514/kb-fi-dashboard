// onoff-calc.js — On/Off 세대별 파생 스프레드에 대한 순수 계산 엔진. DOM·파일 I/O 접근 금지.
// 입력은 항상 '파생 계열'(deriveGenerations / window.ONOFF_KTB3Y.generations)이다:
//   generation = { tag, vs, slopeVs, start, maturity, series:[['YYYY-MM-DD', raw_bp, slope_bp, fly_bp], …] }
// 원본 수익률은 다루지 않는다(라이선스). decompose 만 원본 3수익률을 받는 프리미티브로,
// 산출 일관성을 위해 js/onoff-parse.js 의 단일 정의를 재수출한다.
//
// [day 정의 — 확정] day = 주말 제거 후 관측 인덱스 (day 0 = 첫 관측일). 파서 출력 기준 그대로.
//   세대 간 이벤트타임 비교는 이 인덱스로 정렬한다.
// [알려진 한계] 파서는 주말만 제거하고 한국 공휴일은 제거하지 않는다. 공휴일 민평 캐리오버 행이
//   세대마다 다른 위치에 잔존할 수 있어 세대 간 이벤트타임 정렬에 ±1~2 관측일 오차가 생길 수
//   있다. 밴드(분포) 비교 목적상 허용 오차로 둔다. 공휴일 테이블 도입은 실사용 후 필요 시(스코프 동결).

export { decompose } from './onoff-parse.js';

// 스프레드 프리미티브: 두 수익률(%) 차 → bp, 0.1bp 그리드로 정규화
export function spreadBp(yA, yB) {
  const v = (yA - yB) * 100;
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

// 세대 정렬: 최신(현재 지표물) → 과거 순. start(첫 관측일) 내림차순.
export function orderGenerations(generations) {
  return [...generations].sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

// 현재(최신) 세대 tag
export function currentTag(generations) {
  const o = orderGenerations(generations);
  return o.length ? o[0].tag : null;
}

// 한 세대의 fly 경로를 day 인덱스로 반환(컬럼형 — 차트/요약 공용)
export function flySeries(gen) {
  return {
    tag: gen.tag, vs: gen.vs, slopeVs: gen.slopeVs, start: gen.start, maturity: gen.maturity,
    dates: gen.series.map(r => r[0]),
    raw: gen.series.map(r => r[1]),
    slope: gen.series.map(r => r[2]),
    fly: gen.series.map(r => r[3]),
  };
}

// day 인덱스의 fly (없으면 null)
export function flyAtDay(gen, day) {
  const r = gen.series[day];
  return r ? r[3] : null;
}

// 이벤트타임 정렬: 세대들을 day 인덱스(day0=첫 관측)로 맞춘 fly 매트릭스.
// 반환: { days:[0..maxLen-1], series:[{ tag, start, fly:[…] }, …] } (최신 세대 먼저)
export function eventTimeAlign(generations) {
  const ordered = orderGenerations(generations);
  const maxLen = ordered.reduce((m, g) => Math.max(m, g.series.length), 0);
  return {
    days: Array.from({ length: maxLen }, (_, i) => i),
    series: ordered.map(g => ({ tag: g.tag, start: g.start, fly: g.series.map(r => r[3]) })),
  };
}

// 백분위(선형 보간) — numpy 기본식과 동일. band/percentile 재산출 기준.
export function percentile(arr, q) {
  const a = [...arr].filter(v => v != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = (a.length - 1) * q, lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const round2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// 밴드 통계: 특정 day 에서 '현재 세대를 제외한' 과거 세대들의 fly 분포 p25/median/p75.
// opts.excludeTag 로 기준 세대를 바꿀 수 있다(회고 조회 시 선택 세대 제외).
export function bandStats(generations, day, opts = {}) {
  const cur = opts.excludeTag !== undefined ? opts.excludeTag : currentTag(generations);
  const vals = generations
    .filter(g => g.tag !== cur)
    .map(g => flyAtDay(g, day))
    .filter(v => v != null);
  return {
    day, n: vals.length,
    p25: round1(percentile(vals, 0.25)),
    median: round1(percentile(vals, 0.50)),
    p75: round1(percentile(vals, 0.75)),
  };
}

// 세대간 z: 특정 day 에서 (기준 세대 fly − 과거 세대 평균) / 과거 세대 표준편차(모표준편차).
// 기준 세대는 opts.tag(기본 현재). 판정 엔진(OO-4)·요약 카드(OO-3)에서 사용.
export function generationZ(generations, day, opts = {}) {
  const tag = opts.tag !== undefined ? opts.tag : currentTag(generations);
  const self = generations.find(g => g.tag === tag);
  const current = self ? flyAtDay(self, day) : null;
  const vals = generations
    .filter(g => g.tag !== tag)
    .map(g => flyAtDay(g, day))
    .filter(v => v != null);
  if (!vals.length || current == null) return { z: null, mean: null, std: null, n: vals.length, current };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varr = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
  const std = Math.sqrt(varr);
  return { z: std ? round2((current - mean) / std) : null, mean: round1(mean), std: round1(std), n: vals.length, current };
}

// N영업일(관측) 변화: 현재 fly − N일 전 fly (현재 세대). 표본 부족 시 null.
export function flyChange(gen, lookback = 5) {
  const s = gen.series;
  if (s.length <= lookback) return null;
  return round1(s[s.length - 1][3] - s[s.length - 1 - lookback][3]);
}

// 사이클 내 fly 최고·최저 + 현재값·현재 day
export function flyExtremes(gen) {
  const fly = gen.series.map(r => r[3]);
  const last = gen.series[gen.series.length - 1];
  return {
    current: last ? last[3] : null,
    day: gen.series.length - 1,
    date: last ? last[0] : null,
    min: fly.length ? Math.min(...fly) : null,
    max: fly.length ? Math.max(...fly) : null,
  };
}

// ── 당일 호가 잠정 포인트 (수동 입력) ──
// 원본 수익률(지표/구지표/구구지표) 3개(구구지표 옵션)에서 파생 [raw, slope, fly] 를 계산.
// 구구지표 미입력 시 slope = 최종 민평 slope(가정) — slopeAssumed=true 로 표시.
// 순수 함수: UI 는 이 결과만 사용하고 series 배열을 직접 조작하지 않는다.
export function makeProvisional(gen, input) {
  const yOn = +input.yOn, yOff1 = +input.yOff1;
  const raw = round1((yOn - yOff1) * 100);
  const last = gen.series[gen.series.length - 1];
  const hasOff2 = input.yOff2 != null && input.yOff2 !== '' && Number.isFinite(+input.yOff2);
  const slope = hasOff2 ? round1((yOff1 - (+input.yOff2)) * 100) : last[2];
  const fly = round1(raw - slope);
  return { date: input.date, raw, slope, fly, slopeAssumed: !hasOff2, slopeRef: hasOff2 ? null : last[2] };
}

// 잠정 포인트를 세대 계열 끝에 append 한 새 세대(불변). day N+1 로 판정 재실행에 사용.
export function appendProvisional(gen, point) {
  return { ...gen, series: [...gen.series, [point.date, point.raw, point.slope, point.fly]] };
}

// cp-text.js — Curve Phase Monitor 표현 문구 모듈. 순수 함수(문자열 반환), 계산·판정 로직 없음.
//   목적: 산문 수정이 UI 코드와 분리되게 문구를 한 파일 상수로 집약(임계값 캘리브레이션 시 문구도 여기서).
//   입력: cp-judge 출력 key + 지표 스냅샷(숫자). 용어는 0-A 용어 사전 적용(내부 용어 미노출).
//   ※ cp-judge 실제 key 사용: flat_persist/steep_rstar/steep_tp/neutral/watch,
//     global_tp/global_rstar/global_neutral (명세의 global_calm = global_neutral).

// ── 로컬 포맷 헬퍼(표시 전용) ──
const f1 = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const sgn = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d));
const topPct = (pct) => (pct == null ? '—' : `${Math.round(100 - pct)}`); // percentile → 역사 상위 N%
const mdShort = (isoDate) => { // 'YYYY-MM-DD' → 'M/D'
  if (!isoDate) return '';
  const [, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}`;
};

// ── R1-A. 결론 문장 (히어로) ──
export const KR_CONCLUSION = {
  flat_persist:
    '지금은 역사적으로 커브가 눌리던(플랫) 국면입니다. 시장에 반영된 인상이 아직 다 집행되지 않아, '
    + '인상이 진행될 때마다 단기금리가 기준금리를 따라 올라붙으며 커브를 누릅니다.',
  steep_rstar:
    '커브가 서는(스팁) 조건이 성립했습니다. 단기 구간의 인상 반영이 소진됐고, '
    + '시장이 경제 체력을 재평가하며 장기금리를 밀어올리고 있습니다.',
  steep_tp:
    '커브가 서는(스팁) 조건이 성립했습니다. 단, 엔진이 장기채 보유 보상 상승이라 장기금리 자체가 오르며 '
    + '서는 형태(베어 스팁)일 수 있습니다 — 듀레이션 주의 국면입니다.',
  neutral:
    '단기 구간의 인상 반영은 소진됐지만, 장기 쪽에서 커브를 움직일 새 재료가 아직 없습니다.',
  watch:
    '국면 전환 관찰 구간입니다. 단기 구간의 인상 반영이 중간 수준이라 방향 판별에 추가 데이터가 필요합니다.',
};
export const US_CONCLUSION = {
  global_tp: '글로벌하게도 장기금리를 미는 힘은 보유 보상 쪽입니다.',
  global_rstar: '글로벌하게는 경제 체력 재평가가 장기금리를 밀고 있습니다.',
  global_neutral: '글로벌 장기 재료는 조용한 편 — 국내 고유 요인 점검 구간입니다.',
};
// KR 주 판정 문장 + US 식별 문장(두 번째 문장) 조합.
export function conclusion(krKey, usKey) {
  const kr = KR_CONCLUSION[krKey] || KR_CONCLUSION.watch;
  const us = US_CONCLUSION[usKey] || '';
  return us ? `${kr} ${us}` : kr;
}

// 판정 라벨 표시-변환(용어 사전). cp-judge 저장 라벨엔 TP·r* 등 내부어가 있어 화면엔 이걸 쓴다.
//   (저장 포맷은 무변경 — key 로 매핑.)
export const KR_DISPLAY_LABEL = {
  flat_persist: '역사적 플랫 국면 지속',
  steep_rstar: '스팁 조건 성립 — 경제 체력 재평가 주도',
  steep_tp: '스팁 조건 성립 — 보유 보상 주도 (베어 스팁 주의)',
  neutral: '중립 — 장기 재료 부재',
  watch: '관찰 구간 — 방향 판별 대기',
};
export const krDisplayLabel = (key) => KR_DISPLAY_LABEL[key] || '관찰 구간 — 방향 판별 대기';

// ── R1-A(보조). 판정 라벨 뒤 괄호 해설 (R3에서 판정 카드에 병기) ──
export const VERDICT_PAREN = {
  flat_persist: '(스팁 조건 미성립 — Q1 게이지가 왼쪽으로 이동하면 재평가)',
  steep_rstar: '(단기 반영 소진 + 경제 체력 재평가가 장기금리 견인)',
  steep_tp: '(단기 반영 소진 + 보유 보상 상승 — 듀레이션 주의)',
  neutral: '(단기 반영 소진, 장기 재료 부재)',
  watch: '(방향 판별 관찰 구간 — 추가 데이터 필요)',
};
export const verdictParen = (krKey) => VERDICT_PAREN[krKey] || '';

// ── R2 히어로. 최근 한 달 실제 움직임 + 판정↔실현 괴리 보조문 ──
const domToTerm = (dom) => (dom === '앞단' ? '단기' : '장기'); // 앞단→단기 요인, 뒷단→장기 요인
const dirGloss = (dir) => (dir === '스팁' ? '장단기 격차 확대' : dir === '플랫' ? '축소' : '');
// 우세 성분×방향 4분기 — 용어 사전("단기=누르는 힘")과 표면 모순 방지 위해 괄호로 메커니즘 병기.
const HERO_DRIVER = {
  단기_스팁: '단기 요인 주도 (인상 집행에 따른 게이지 축소 효과)',
  단기_플랫: '단기 요인 주도 (단기금리 상승이 커브를 누름)',
  장기_스팁: '장기 요인 주도 (장기금리가 커브를 세움)',
  장기_플랫: '장기 요인 주도 (장기금리 하락이 커브를 누름)',
};
export function heroRealized({ netBp, direction, dominant }) {
  const term = domToTerm(dominant);
  const driver = HERO_DRIVER[`${term}_${direction}`] || `${term} 요인 주도`;
  return `최근 한 달 커브는 실제로 ${sgn(netBp)}bp ${direction}(${dirGloss(direction)}) — ${driver}`;
}
// 판정 방향(flat_persist→플랫, steep_*→스팁, 그 외 null)과 실현 방향이 다르면 보조문, 같으면 null.
export function divergenceNote(krKey, realizedDirection) {
  const judged = krKey === 'flat_persist' ? '플랫' : (krKey === 'steep_rstar' || krKey === 'steep_tp') ? '스팁' : null;
  if (!judged || !realizedDirection || realizedDirection === '중립') return null;
  if (judged === realizedDirection) return null;
  return "국면 판정과 실제 움직임이 다른 방향입니다 — 판정은 '조건', 움직임은 '결과'라 갈릴 수 있습니다.";
}

// ── R1-B. 섹션별 한 줄 해설 ──
// Q1: 단기금리의 인상 반영. hikeDeltaBp/hikeDate 있으면 직전 인상 이동 문구 추가.
export function q1Blurb({ spreadBp, pct, hikeDeltaBp, hikeDate }) {
  let s = `현재 ${f1(spreadBp)}bp — 역사 상위 ${topPct(pct)}%. 인상이 집행될수록 이 바늘이 왼쪽으로 이동합니다.`;
  if (hikeDeltaBp != null && hikeDate) {
    const dir = hikeDeltaBp <= 0 ? '왼쪽(반영 소진 방향)' : '오른쪽(반영 잔량 방향)';
    s += ` 직전 인상(${mdShort(hikeDate)})으로 바늘이 ${dir}으로 ${f1(Math.abs(hikeDeltaBp))}bp 이동했습니다.`;
  }
  return s;
}
// Q2(US): 미국 장기금리 60일 변화 = 체력 재평가 + 보유 보상 분해.
const US_DRIVER = { global_tp: '장기채 보유 보상', global_rstar: '경제 체력 재평가' };
export function q2US({ expDeltaBp, tpDeltaBp, usKey }) {
  const head = `최근 60일 미국 장기금리 변화는 경제 체력 재평가 ${sgn(expDeltaBp)}bp + 장기채 보유 보상 ${sgn(tpDeltaBp)}bp로 분해됩니다`;
  return usKey === 'global_neutral'
    ? `${head} — 뚜렷이 주도하는 요인은 없습니다.`
    : `${head} — ${US_DRIVER[usKey] || '—'}이 주도하고 있습니다.`;
}
// Q2(KR): 사이클 이후 금리 60일 변화(방향어) + 초장기 보상 프록시(30−10) 위치.
//   마지막 절은 30−10 이 역사 상위 25% 이내일 때만(보상 압력 강함) 표시.
export function q2KR({ fyDeltaBp, s3010Pct }) {
  const dir = fyDeltaBp >= 0 ? '올랐고(커브를 세우는 방향)' : '내렸고(커브를 누르는 방향)';
  let s = `한국의 사이클 이후 금리는 60일간 ${sgn(fyDeltaBp)}bp ${dir}, 30−10년 격차는 역사 상위 ${topPct(s3010Pct)}%`;
  s += (s3010Pct != null && (100 - s3010Pct) <= 25)
    ? ' — 장기채 보유 보상 쪽 압력이 국내에서도 강합니다.'
    : ' 수준입니다.';
  return s;
}
export const Q2_KR_NOTE =
  '한국은 장기 요인을 체력/보상으로 분리할 공식 데이터가 없어 합산 측정하고, 미국 분해를 참고로 해석합니다.';

// Q3: 과거 인상 사이클의 플랫 정도 + 현재 출발점 비교. 값은 전부 cycles 데이터에서 계산(하드코딩 금지).
//   deltaHi/deltaLo = 과거 사이클 Δ(T0→T+250) 의 max/min(부호 유지, 플랫이면 음수).
export function q3Blurb({ nCycles, deltaHi, deltaLo, currentT0Bp, isLowest }) {
  const base = `한국 과거 ${nCycles}번의 인상 사이클 모두 1년간 ${sgn(deltaHi, 0)}~${sgn(deltaLo, 0)}bp 눌렸습니다(플랫).`;
  const tail = isLowest
    ? ` 단, 이번 사이클은 출발점(${f1(currentT0Bp)}bp)이 역대 최저 — 눌릴 여유가 과거보다 얇습니다.`
    : ` 이번 사이클 출발점은 ${f1(currentT0Bp)}bp입니다.`;
  return base + tail;
}

// ── 게이지·범례 라벨(0-A 용어) ──
export const GAUGE_LABELS = { left: '반영 소진(누르는 힘 없음)', right: '반영 잔량 많음(누르는 힘 강함)' };
export const DECOMP_LEGEND = {
  frontKR: '단기 요인(누르는 힘)', backKR: '장기 요인(합산)',
  frontUS: '단기 요인(누르는 힘)', backExpUS: '장기 요인 — 체력 재평가', backTpUS: '장기 요인 — 보유 보상',
};

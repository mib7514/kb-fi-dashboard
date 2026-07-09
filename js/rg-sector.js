// rg-sector.js — RG-3 섹터 스프레드 보드 순수 계산 (spec §1 RG-3). DOM·IO·저장 없음.
// 6섹터 × 방향 확률(축소/보합/확대) → 기대 Δs(bp) 순위. onoff-judge.js 패턴(순수·상단 상수).
//
// [공유] 국고채·회사채 행은 RG-1 축과 '동일한 단일 상태'를 참조한다(복제 아님).
//   회사채 → state.spread (축소/보합/확대 키 동일, identity).
//   국고채 → state.rate  (하락/보합/상승 → 축소/보합/확대 매핑: 하락=축소, 상승=확대).
//   그 외 → state.sectors[key]. 어느 뷰에서 고쳐도 즉시 양쪽 반영.
// [밴드 소스] δ = RG_CALIB.bands.sectors[key].bandBp. Phase 1 산출상 국고채 밴드 = 금리축(ktb3y)과
//   동일 계열(수익률 변화, ±4.6bp), 회사채 밴드 = repSpread(회사채 AA- 3Y, ±2.2bp)와 동일.

export const SECTOR_DIRS = ['narrow', 'flat', 'wide'];  // 축소/보합/확대
export const SECTOR_DIR_LABEL = { narrow: '축소', flat: '보합', wide: '확대' };
// 국고채(금리 축) 방향 매핑: 섹터 dir → RG-1 금리 키
export const RATE_DIR_OF = { narrow: 'down', flat: 'flat', wide: 'up' };  // 축소=하락, 확대=상승

// 표시 순서(spec): 국고/공사/은행/회사/카드/여전. band = RG_CALIB.bands.sectors 키.
// share: 'rate'(국고, 매핑) | 'spread'(회사채, identity) | null.
export const SECTORS = [
  { key: '국고채', band: '국고채', share: 'rate', note: 'RG-1 금리 축과 동일 입력 (하락=축소)' },
  { key: '공사채', band: '공사채', share: null },
  { key: '은행채', band: '은행채', share: null },
  { key: '회사채', band: '회사채', share: 'spread', note: 'RG-1 스프레드 축과 동일 입력' },
  { key: '카드채', band: '카드채', share: null },
  { key: '여전채', band: '여전채', share: null },
];
export const SECTOR_META = Object.fromEntries(SECTORS.map(s => [s.key, s]));

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// 기대 Δs(bp): δ×(P확대 − P축소), P 는 각 섹터 합으로 정규화한 비율. 합≤0/밴드 없음 → null.
// 부호: (+)=스프레드 확대 예상, (−)=축소 예상. 축소(더 음수)일수록 매력 상위.
export function expectedDs(probs, bandBp) {
  if (!probs || !Number.isFinite(bandBp)) return null;
  const n = +probs.narrow || 0, f = +probs.flat || 0, w = +probs.wide || 0;
  const s = n + f + w;
  if (s <= 0) return null;
  return bandBp * ((w - n) / s);
}

// 섹터 방향 확률 {narrow,flat,wide} 조회. 공유 섹터는 RG-1 축을 매핑해 돌려준다.
//   회사채 → state.spread (동일 참조). 국고채 → state.rate 를 축소/보합/확대로 매핑한 뷰(복사).
export function sectorProbs(key, state) {
  const m = SECTOR_META[key];
  if (m && m.share === 'spread') return state.spread;
  if (m && m.share === 'rate') {
    const r = state.rate || {};
    return { narrow: r.down, flat: r.flat, wide: r.up };
  }
  return state.sectors ? state.sectors[key] : null;
}

// 섹터 한 방향 확률 쓰기(단일 상태에 반영). 공유 섹터는 RG-1 축 필드로 되돌려 쓴다.
export function setSectorProb(key, dir, value, state) {
  const m = SECTOR_META[key];
  if (m && m.share === 'spread') { state.spread[dir] = value; return; }
  if (m && m.share === 'rate') { state.rate[RATE_DIR_OF[dir]] = value; return; }
  if (state.sectors && state.sectors[key]) state.sectors[key][dir] = value;
}

// 섹터 밴드(bp) 조회
export function sectorBandBp(key, bands) {
  const m = SECTOR_META[key];
  const s = bands && bands.sectors && m ? bands.sectors[m.band] : null;
  return s ? s.bandBp : null;
}

// 6섹터 행 구성: { key, share, shared, note, probs, bandBp, eDs }
export function buildSectorRows(state, bands) {
  return SECTORS.map(s => {
    const probs = sectorProbs(s.key, state);
    const bandBp = sectorBandBp(s.key, bands);
    return { key: s.key, share: s.share, shared: !!s.share, note: s.note, probs, bandBp, eDs: expectedDs(probs, bandBp) };
  });
}

// 매력 순위: 기대 Δs 오름차순(축소 기대 상위 = 앞). eDs null 은 뒤로. rank(1부터) 부여.
export function rankByAttractiveness(rows) {
  const ranked = rows.slice().sort((a, b) => {
    if (a.eDs == null && b.eDs == null) return 0;
    if (a.eDs == null) return 1;
    if (b.eDs == null) return -1;
    return a.eDs - b.eDs;
  });
  return ranked.map((r, i) => ({ ...r, rank: i + 1, eDsR: round1(r.eDs) }));
}

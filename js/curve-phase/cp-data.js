// cp-data.js — Curve Phase Monitor 데이터 로더. data/curve/*.json 을 fetch + localStorage 캐시.
//   로컬 서버 서빙 전제(file:// 미지원). fetch 성공 시 payload 를 캐시에 저장하고,
//   실패(오프라인·서버다운) 시 캐시로 폴백한다. UI 설정(룩백)은 cp-ui.js 가 별도 키로 관리.
//   KR(kr_yields·kr_base_rate) + US(us_yields·us_tp) 4종 로드.

const URLS = {
  krYields: 'data/curve/kr_yields.json',
  krBase: 'data/curve/kr_base_rate.json',
  usYields: 'data/curve/us_yields.json',
  usTp: 'data/curve/us_tp.json',
};
const CACHE_KEY = 'cp-data-cache';
const CACHE_VERSION = 2; // v2: US 추가

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res || !res.ok) throw new Error(`fetch 실패: ${url}`);
  return res.json();
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      kind: CACHE_KEY, version: CACHE_VERSION,
      cached_at: data.krYields?.meta?.updated_at ?? null, data,
    }));
  } catch { /* 용량 초과 등 — 캐시는 부가기능이므로 무시 */ }
}

function readCache() {
  try {
    const s = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (s && s.version === CACHE_VERSION && s.data) return s;
  } catch { /* noop */ }
  return null;
}

// 반환: { data:{krYields, krBase, usYields, usTp}, source:'fetch'|'cache', cached_at } 또는 null.
export async function loadCurveData() {
  try {
    const [krYields, krBase, usYields, usTp] = await Promise.all([
      fetchJson(URLS.krYields), fetchJson(URLS.krBase), fetchJson(URLS.usYields), fetchJson(URLS.usTp),
    ]);
    const data = { krYields, krBase, usYields, usTp };
    writeCache(data);
    return { data, source: 'fetch', cached_at: krYields.meta?.updated_at ?? null };
  } catch {
    const cached = readCache();
    if (cached) return { data: cached.data, source: 'cache', cached_at: cached.cached_at };
    return null;
  }
}

// 사이클 정의(정적). 부재 허용 — 오버레이만 비고 나머지 렌더. null 반환 시 오버레이 숨김.
export async function loadCycles() {
  try { return await fetchJson('data/curve/cycles.json'); } catch { return null; }
}

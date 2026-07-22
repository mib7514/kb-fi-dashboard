// cp-data.js — Curve Phase Monitor 데이터 로더. data/curve/*.json 을 fetch + localStorage 캐시.
//   로컬 서버 서빙 전제(file:// 미지원). fetch 성공 시 payload 를 캐시에 저장하고,
//   실패(오프라인·서버다운) 시 캐시로 폴백한다. UI 설정(룩백)은 cp-ui.js 가 별도 키로 관리.
//   Phase 2 는 KR 만 로드(kr_yields·kr_base_rate). US(us_yields·us_tp)는 Phase 3 에서 추가.

const URLS = {
  krYields: 'data/curve/kr_yields.json',
  krBase: 'data/curve/kr_base_rate.json',
};
const CACHE_KEY = 'cp-data-cache';
const CACHE_VERSION = 1;

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

// 반환: { data:{krYields, krBase}, source:'fetch'|'cache', cached_at } 또는 null(둘 다 실패).
export async function loadCurveData() {
  try {
    const [krYields, krBase] = await Promise.all([fetchJson(URLS.krYields), fetchJson(URLS.krBase)]);
    const data = { krYields, krBase };
    writeCache(data);
    return { data, source: 'fetch', cached_at: krYields.meta?.updated_at ?? null };
  } catch {
    const cached = readCache();
    if (cached) return { data: cached.data, source: 'cache', cached_at: cached.cached_at };
    return null;
  }
}

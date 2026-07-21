// ecos.mjs — 한국은행 ECOS Open API 얇은 클라이언트. Node 내장 fetch만 사용(무의존).
//   키: 환경변수 ECOS_API_KEY (파일/커밋 금지).
//   ※ 사내 프록시 TLS 가로채기 환경에서 로컬 실행 시 SELF_SIGNED_CERT_IN_CHAIN 발생 →
//     로컬 한정 `NODE_TLS_REJECT_UNAUTHORIZED=0`. CI(ubuntu)에는 불필요. 코드엔 넣지 않는다.

const BASE = 'https://ecos.bok.or.kr/api';

function keyOrThrow() {
  const k = (process.env.ECOS_API_KEY || '').trim();
  if (!k) throw new Error('ECOS_API_KEY 환경변수가 없습니다.');
  return k;
}

// StatisticSearch. cycle: 'D'|'M'|'Q'. sdate/edate 는 주기별 포맷(YYYYMMDD / YYYYMM / YYYYQn).
// 반환: [{ time:'...', value:number }] 오름차순. 결측('','-') 제외.
export async function fetchSeries({ stat, item, cycle, sdate, edate }) {
  const key = keyOrThrow();
  const url = `${BASE}/StatisticSearch/${key}/json/kr/1/100000/${stat}/${cycle}/${sdate}/${edate}/${item}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'fi-dashboard/taylor' } });
  if (!res.ok) throw new Error(`ECOS ${stat}/${item} HTTP ${res.status}`);
  const json = JSON.parse(await res.text());
  if (json.RESULT) throw new Error(`ECOS ${stat}/${item}: ${json.RESULT.CODE} ${json.RESULT.MESSAGE}`);
  const rows = json.StatisticSearch?.row;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`ECOS ${stat}/${item}: 관측치 0`);
  return rows
    .map((r) => ({ time: r.TIME, value: Number(r.DATA_VALUE) }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// fetchSeriesPaged — StatisticSearch 를 페이지 단위로 순회한다. fetchSeries 의 확장판:
//   · item2: 2차 분류가 있는 표(예: 수출입물가지수의 계약통화/달러/원화 기준)에서
//     ITEM_CODE2 로 한 계열만 골라낸다. 미지정 시 필터 없음(단일차원 표).
//   · pageSize: 한 요청당 관측치 수. 정식 키는 100000(1요청)로 taylor 와 동일.
//     sample 키는 요청당 10건 상한이 있어 로컬 검증 시 ECOS_PAGE_SIZE=10 으로 낮춘다.
// 반환: [{ time, value }] 오름차순, 결측 제외.
export async function fetchSeriesPaged({ stat, item, cycle, sdate, edate, item2 }, pageSize = 100000) {
  const key = keyOrThrow();
  const size = Math.max(1, Math.min(100000, Number(pageSize) || 100000));
  const out = [];
  for (let start = 1; ; start += size) {
    const end = start + size - 1;
    const url = `${BASE}/StatisticSearch/${key}/json/kr/${start}/${end}/${stat}/${cycle}/${sdate}/${edate}/${item}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'fi-dashboard/gg1' } });
    if (!res.ok) throw new Error(`ECOS ${stat}/${item} HTTP ${res.status}`);
    const json = JSON.parse(await res.text());
    if (json.RESULT) throw new Error(`ECOS ${stat}/${item}: ${json.RESULT.CODE} ${json.RESULT.MESSAGE}`);
    const rows = json.StatisticSearch?.row;
    if (!Array.isArray(rows) || rows.length === 0) break; // 마지막 페이지 다음
    out.push(...rows);
    if (rows.length < size) break; // 마지막 페이지
  }
  if (out.length === 0) throw new Error(`ECOS ${stat}/${item}: 관측치 0`);
  return out
    .filter((r) => (item2 ? r.ITEM_CODE2 === item2 : true))
    .map((r) => ({ time: r.TIME, value: Number(r.DATA_VALUE) }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

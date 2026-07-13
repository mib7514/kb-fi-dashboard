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

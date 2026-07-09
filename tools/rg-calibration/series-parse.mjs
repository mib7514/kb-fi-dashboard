// series-parse.mjs — 입력 소스 → 정제 시계열 Map(ISO → 값). 순수(호출자가 XLSX·fs 제공).
// 두 소스를 지원한다:
//   (A) Infomax 와이드 xlsx  — 국고 8구간 커브(필수, medianCurves 재료)
//   (B) 기존 data/credit-spread.js (window.FENRIR_SERIES) — 3Y 금리·대표 스프레드·6섹터 재사용
// 원시 레벨은 Map 으로만 다루고 calibrate.mjs 가 즉시 Δ 로 환산(레벨 미직렬화).

// Excel 시리얼(1900) → 'YYYY-MM-DD' (UTC 일단위 반올림, credit-parse.js 와 동일 규칙)
export function serialToISO(serial) {
  const days = Math.round(serial) - 25569;
  return new Date(days * 86400000).toISOString().slice(0, 10);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isWeekend = iso => { const g = new Date(iso + 'T00:00:00Z').getUTCDay(); return g === 0 || g === 6; };

// ── (A) Infomax 와이드 AOA → { headers:[label...], series:{label:Map} } ──
// 레이아웃(설정 가능):
//   headerRow: 컬럼 라벨 행 인덱스(0-base). dateCol: 날짜 열 인덱스. dataStartRow: 첫 데이터 행.
// A열이 날짜(Excel 시리얼 or ISO 문자열)인 행만 데이터로. 주말 자동 제거. 중복 날짜는 후자 우선.
// 값이 비수치면 그 (날짜,계열) 스킵 → 계열마다 결측 허용(Map 부재로 표현).
export function parseWideAoa(aoa, { headerRow = 0, dateCol = 0, dataStartRow = null } = {}) {
  const header = aoa[headerRow] || [];
  const cols = [];
  for (let c = 0; c < header.length; c++) {
    if (c === dateCol) continue;
    const label = header[c];
    if (label != null && String(label).trim() !== '') cols.push({ idx: c, label: String(label).trim() });
  }
  const series = {}; for (const c of cols) series[c.label] = new Map();
  const start = dataStartRow == null ? headerRow + 1 : dataStartRow;
  for (let r = start; r < aoa.length; r++) {
    const row = aoa[r]; if (!row) continue;
    const a = row[dateCol];
    let iso = null;
    if (typeof a === 'number' && a > 40000) iso = serialToISO(a);
    else if (typeof a === 'string' && DATE_RE.test(a.trim())) iso = a.trim();
    if (!iso || isWeekend(iso)) continue;
    for (const c of cols) {
      const v = row[c.idx];
      if (typeof v === 'number' && Number.isFinite(v)) series[c.label].set(iso, v);
    }
  }
  return { headers: cols.map(c => c.label), series };
}

// 라벨 매핑: parseWideAoa 결과에서 원하는 논리키 → 실제 헤더로 뽑아 Map 반환.
// map: { logical: 'exactHeader' }. 누락 헤더는 에러(오타·컬럼 변형 조기 감지).
export function pickSeries(parsed, map) {
  const out = {};
  for (const [logical, header] of Object.entries(map)) {
    const m = parsed.series[header];
    if (!m) throw new Error(`헤더 없음: '${header}' (논리키 ${logical}). 사용가능=${parsed.headers.join(', ')}`);
    if (m.size === 0) throw new Error(`계열 비어있음: '${header}'`);
    out[logical] = m;
  }
  return out;
}

// ── (B) window.FENRIR_SERIES['credit-spread'] → 라벨별 Map ──
// credit-spread.js 는 { dates:[ISO...], series:{ '섹터_만기':[값...] } } 컬럼형. null 은 결측.
export function fenrirToMaps(cs, labels) {
  const { dates, series } = cs;
  const out = {};
  for (const label of labels) {
    const arr = series[label];
    if (!arr) throw new Error(`credit-spread 라벨 없음: '${label}'`);
    const m = new Map();
    for (let i = 0; i < dates.length; i++) if (arr[i] != null && Number.isFinite(arr[i])) m.set(dates[i], arr[i]);
    out[label] = m;
  }
  return out;
}

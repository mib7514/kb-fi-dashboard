// gc-jp.mjs — 재무성(MOF) 국채금리 CSV 파싱 순수 함수. DOM·네트워크 없음(테스트 가능).
//   MOF jgbcm CSV 는 Shift-JIS + 연호(和暦) 날짜. 디코딩은 fetch-jp.mjs, 파싱은 여기.
//
// ── 연호(era) → 서기 변환 ──
//   昭和 S: 서기 = 1925 + N  (S49=1974, S63=1988, S64=1989[1.1~1.7])
//   平成 H: 서기 = 1988 + N  (H1=1989[1.8~], H31=2019[~4.30])
//   令和 R: 서기 = 2018 + N  (R1=2019[5.1~], R8=2026)
//   ※ 경계: 昭和64년(1989.1.1~1.7) → 平成1년(1989.1.8~) / 平成31년(~2019.4.30) → 令和1년(2019.5.1~).
//     변환은 순수 산술(연호 라벨을 신뢰) — 어느 연호가 유효했는지 판정하지 않는다. CSV 라벨이 정본.

import { round3 } from './gc-config.mjs';

const ERA_BASE = { S: 1925, H: 1988, R: 2018 };

// 'S49.9.24' | 'R1.5.10' → 'YYYY-MM-DD'. 형식 불일치·비연호(주석/합계행)면 null.
export function parseEraDate(s) {
  const m = /^\s*([SHRshr])(\d{1,2})\.(\d{1,2})\.(\d{1,2})\s*$/.exec(s ?? '');
  if (!m) return null;
  const base = ERA_BASE[m[1].toUpperCase()];
  if (base == null) return null;
  const year = base + Number(m[2]);
  const mo = Number(m[3]);
  const da = Number(m[4]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return `${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

// 값 셀 파싱: '' | '-' → null(결측·미발행). 그 외 숫자.
function numCell(v) {
  const t = (v ?? '').trim();
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// MOF jgbcm CSV 텍스트(Shift-JIS 디코딩 후) → [{d, y3, y10, y30}] 오름차순.
//   헤더('基準日,1年,…,40年')로 3年/10年/30年 컬럼을 라벨 매칭(위치 하드코딩 회피).
//   연호가 아닌 행(제목·주석·단위)은 parseEraDate=null 로 자동 스킵. 보간 없음(결측 null).
export function parseJgbCsv(text) {
  const lines = String(text).split(/\r?\n/);
  const hi = lines.findIndex((l) => l.includes('基準日'));
  if (hi < 0) throw new Error('JGB CSV 헤더(基準日) 없음 — Shift-JIS 디코딩/포맷 확인');
  const header = lines[hi].split(',').map((s) => s.trim());
  const i3 = header.indexOf('3年');
  const i10 = header.indexOf('10年');
  const i30 = header.indexOf('30年');
  if (i3 < 0 || i10 < 0 || i30 < 0) throw new Error(`JGB 컬럼 매핑 실패 3年=${i3} 10年=${i10} 30年=${i30}`);

  const rows = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const d = parseEraDate(cols[0]);
    if (!d) continue; // 제목·주석·빈 줄
    rows.push({ d, y3: round3(numCell(cols[i3])), y10: round3(numCell(cols[i10])), y30: round3(numCell(cols[i30])) });
  }
  rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return rows;
}

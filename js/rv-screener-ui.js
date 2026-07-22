// rv-screener-ui.js — RV-1 스크리너 페이지 컨트롤러 (Phase 1: 민평 업로드 + 요약).
//   측정만 한다. 판별은 결정론적 계산까지, "잡을 만한가"는 사용자 몫.
//
// 절대 원칙:
//  - 클라이언트 온리. 민평·호가 데이터는 브라우저 밖으로 절대 나가지 않는다(서버·전송·커밋 없음).
//  - no-build. vanilla JS. 외부 리소스는 cdnjs SheetJS(window.XLSX) 하나뿐.
//  - localStorage 만 사용(키 rv-screener-mp). 파일 자체는 저장하지 않고 파싱 결과 구조만 보관.
//
// 민평 파일 스펙(인포맥스 4788, 로컬 샘플로 검증):
//  - Sheet1 사용. 1행 메타, 헤더 행은 '채권그룹'+'발행사' 포함 행을 탐색(행번호 하드코딩 금지).
//  - 좌측 사이드표(B~C열, '채권그룹' 중복 출현)는 무시 → '발행사' 헤더를 E열(4) 이후에서 앵커로 잡음.
//  - E블록 순서: 채권그룹 | 발행사 | 평가사 | 15테너 | 회사코드 | …
//  - 회사코드 '00000' = 그룹 대표커브 행, 그 외 = 발행사 행. 발행사명은 유일키(중복 시 경고).

const LS_KEY = 'rv-screener-mp';
// 테너 라벨은 헤더에서 읽되, 기대 순서 검증용 기준.
const EXPECT_TENORS = ['3M', '6M', '9M', '1Y', '1.5Y', '2Y', '2.5Y', '3Y', '4Y', '5Y', '7Y', '10Y', '15Y', '20Y', '30Y'];

let MP = null; // { asOfLabel, asOfSource, issuers, groupCurves, dupes, counts }

// ── 민평 xlsx → 구조화 ──
// 반환: { asOfLabel, asOfSource, issuers:{name:{group,code,curve:{tenor:yield}}}, groupCurves:{group:{code,curve}}, dupes:[], counts:{...} }
function parseMinpyeong(arrayBuffer, fileName) {
  if (!window.XLSX) throw new Error('SheetJS(XLSX) 로드 실패 — 네트워크 확인');
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]]; // Sheet1
  const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  // 헤더 행 탐색: '채권그룹' + '발행사' 동시 포함
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const j = rows[i].map((c) => String(c)).join('|');
    if (j.includes('채권그룹') && j.includes('발행사')) { h = i; break; }
  }
  if (h < 0) throw new Error('헤더 행(채권그룹·발행사)을 찾지 못함 — 4788 내보내기 형식인지 확인');
  const header = rows[h].map((c) => String(c).trim());

  // 발행사 열 앵커: E열(4) 이후의 '발행사' (좌측 사이드표 배제)
  let issuerCol = -1;
  for (let i = header.length - 1; i >= 4; i--) { if (header[i] === '발행사') { issuerCol = i; break; } }
  if (issuerCol < 0) throw new Error('E열 이후 발행사 열을 찾지 못함');
  const groupCol = issuerCol - 1;
  const evalCol = issuerCol + 1;
  const tenorStart = evalCol + 1;
  const codeCol = header.findIndex((c) => c === '회사코드');

  // 테너 라벨은 헤더에서 직접 읽음(파일 순서 그대로). 없으면 기대 라벨로 폴백.
  const tenors = [];
  for (let t = 0; t < 15; t++) {
    const lbl = header[tenorStart + t];
    tenors.push(lbl && lbl !== '' ? lbl : EXPECT_TENORS[t]);
  }

  const issuers = {};
  const groupCurves = {};
  const dupes = new Set();
  let issuerRows = 0, repRows = 0;
  for (const r of rows.slice(h + 1)) {
    const name = String(r[issuerCol] ?? '').trim();
    if (!name) continue;
    const group = String(r[groupCol] ?? '').trim();
    const code = codeCol >= 0 ? String(r[codeCol] ?? '').trim() : '';
    const curve = {};
    for (let t = 0; t < 15; t++) {
      const v = r[tenorStart + t];
      const num = typeof v === 'number' ? v : (v === '' || v == null ? NaN : Number(v));
      if (Number.isFinite(num)) curve[tenors[t]] = num;
    }
    if (code === '00000') {
      groupCurves[group] = { code, curve };
      repRows++;
    } else {
      if (Object.prototype.hasOwnProperty.call(issuers, name)) dupes.add(name);
      issuers[name] = { group, code, curve };
      issuerRows++;
    }
  }

  // 기준일: 파일명 4788(YYMMDD) 또는 4788_YYMMDD_ 등에서 추출, 실패 시 업로드 시각
  const dateMatch = String(fileName || '').match(/4788[^0-9]*(\d{2})(\d{2})(\d{2})/);
  let asOfLabel, asOfSource;
  if (dateMatch) {
    asOfLabel = `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    asOfSource = '파일명';
  } else {
    asOfLabel = new Date().toISOString().slice(0, 16).replace('T', ' ');
    asOfSource = '업로드 시각(파일명 미상)';
  }

  const groups = new Set([...Object.values(issuers).map((x) => x.group), ...Object.keys(groupCurves)]);
  return {
    asOfLabel, asOfSource, issuers, groupCurves, dupes: [...dupes],
    counts: { issuers: issuerRows, reps: repRows, groups: groups.size, groupCurves: Object.keys(groupCurves).length },
  };
}

// ── 저장/복원 ──
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ kind: LS_KEY, version: 1, mp: MP })); } catch (e) { /* 용량초과 등 무시 */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (s && s.mp && s.mp.issuers) MP = s.mp;
  } catch { MP = null; }
}

// ── 렌더 ──
function renderSummary() {
  const warn = document.getElementById('mp-warn');
  const sum = document.getElementById('mp-summary');
  const clr = document.getElementById('mp-clear');
  const hint = document.getElementById('mp-hint');
  if (!MP) {
    warn.style.display = 'none';
    clr.style.display = 'none';
    sum.innerHTML = `<div class="empty">아직 민평이 없습니다. 위에서 <code>4788</code> 내보내기 <code>.xlsx</code>를 올리세요.<br>`
      + `업로드하면 발행사·그룹 커브가 브라우저에 구조화되어 이후 호가 판별에 쓰입니다.</div>`;
    return;
  }
  clr.style.display = '';
  hint.textContent = '다른 날짜 파일을 올리면 교체됩니다.';
  const c = MP.counts;
  if (MP.dupes.length) {
    warn.style.display = '';
    warn.innerHTML = `⚠️ 발행사명 중복 ${MP.dupes.length}종 — 유일키 가정 위반. 마지막 행 기준으로 덮어씀: `
      + `<span style="font-family:var(--mono)">${MP.dupes.slice(0, 12).join(', ')}${MP.dupes.length > 12 ? ' …' : ''}</span>`;
  } else {
    warn.style.display = 'none';
  }
  sum.innerHTML = `<div class="stats">
    <div class="stat"><div class="stat-label">발행사</div>
      <div class="stat-main">${c.issuers}<span class="stat-unit">종</span></div>
      <div class="stat-sub">회사코드 ≠ 00000</div></div>
    <div class="stat"><div class="stat-label">채권그룹(등급 버킷)</div>
      <div class="stat-main">${c.groups}<span class="stat-unit">그룹</span></div>
      <div class="stat-sub">대표커브 ${c.groupCurves}개(00000)</div></div>
    <div class="stat"><div class="stat-label">민평 기준일</div>
      <div class="stat-main" style="font-size:19px">${MP.asOfLabel}</div>
      <div class="stat-sub">${MP.asOfSource}</div></div>
    <div class="stat"><div class="stat-label">발행사명 중복</div>
      <div class="stat-main" style="color:${MP.dupes.length ? 'var(--red)' : 'var(--ok)'}">${MP.dupes.length}<span class="stat-unit">종</span></div>
      <div class="stat-sub">${MP.dupes.length ? '경고 배너 참조' : '유일키 정상'}</div></div>
  </div>`;
}

function renderFootnote() {
  document.getElementById('footnote').innerHTML =
    `<div>민평 그리드 = 인포맥스 4788 화면 내보내기. 헤더 행은 <span class="k">채권그룹·발행사</span> 포함 행을 자동 탐색(행번호 비의존). `
    + `실데이터는 E열부터(채권그룹·발행사·평가사·15테너·회사코드), 좌측 사이드표는 무시.</div>`
    + `<div>회사코드 <span class="k">00000</span>=그룹 대표커브, 그 외=발행사 커브. 등급은 채권그룹명에 내장 → 별도 매핑 없이 횡단면 버킷 키로 사용.</div>`
    + `<div>데이터는 <span class="k">localStorage</span>(브라우저 로컬)에만 저장 — 서버 전송·리포 커밋 없음.</div>`;
}

async function onFile(file) {
  const hint = document.getElementById('mp-hint');
  try {
    hint.textContent = `${file.name} 파싱 중…`;
    const buf = await file.arrayBuffer();
    const parsed = parseMinpyeong(buf, file.name);
    if (!parsed.counts.issuers) throw new Error('발행사 행 0 — 형식 확인');
    MP = parsed;
    save();
    renderSummary();
  } catch (e) {
    hint.textContent = '';
    const warn = document.getElementById('mp-warn');
    warn.style.display = '';
    warn.innerHTML = `❌ 파싱 실패: ${e.message}`;
  }
}

function wire() {
  document.getElementById('mp-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onFile(f);
    e.target.value = ''; // 같은 파일 재선택 허용
  });
  document.getElementById('mp-clear').addEventListener('click', () => {
    MP = null;
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
    document.getElementById('mp-hint').textContent = '인포맥스 4788 화면 내보내기(.xlsx). 브라우저 안에서만 처리 — 서버 전송·저장 없음.';
    renderSummary();
  });
}

export function initRvScreener() {
  load();
  wire();
  renderSummary();
  renderFootnote();
}

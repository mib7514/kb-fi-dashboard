// onoff-admin-ui.js — 종목별 민평 xlsx 업로드 → 세대별 파생 스프레드 변환 → data/onoff-ktb3y.js export.
// 파싱·변환·직렬화·검증은 js/onoff-parse.js 공유 모듈에 위임 → tools/convert-onoff.mjs 와
// 바이트 동일한 산출물을 생성한다(브라우저 ArrayBuffer 경로 = node Buffer 경로).
//
// [라이선스] 원본 수익률은 이 페이지 메모리에서만 존재하고, export 산출물에는 파생 스프레드(bp)만
// 담긴다. 원본 xlsx 자체는 절대 다운로드/커밋하지 않는다(.gitignore *.xlsx).
// SheetJS(XLSX)는 onoff-admin.html 이 로드한 vendor/xlsx.min.js 전역을 사용.

import { buildDataset, serialize, validateStructure } from './onoff-parse.js';

const state = { out: null, fname: null };

function setStatus(msg, kind) {
  const el = document.getElementById('oo-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + (kind || '');
}

// ── xlsx 로드 → 변환 → 검증 → 미리보기 ──
function handleFile(file) {
  const XLSX = window.XLSX;
  if (!XLSX) { setStatus('SheetJS(vendor/xlsx.min.js) 로드 실패', 'bad'); return; }
  state.fname = file.name;
  setStatus(`읽는 중 — ${file.name} …`, '');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const u8 = new Uint8Array(reader.result);
      const wb = XLSX.read(u8, { type: 'array' });
      const ws = wb.Sheets['Sheet1'];
      if (!ws) throw new Error("시트 'Sheet1' 없음");
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

      const dataset = buildDataset(aoa);          // 원본 수익률 → 세대별 파생(메모리 한정)
      const stats = validateStructure(dataset);   // 실패 시 throw → 구조 게이트(위치 포함)
      state.out = serialize(dataset);             // node 스크립트와 바이트 동일 (파생만)

      renderPreview(dataset, stats);
      document.getElementById('oo-export-btn').disabled = false;
      setStatus(`구조 검증 통과 — 세대 ${stats.nGen}, updated ${stats.updated}. export 가능.`, 'ok');
    } catch (err) {
      state.out = null;
      document.getElementById('oo-export-btn').disabled = true;
      renderPreview(null);
      setStatus('검증 실패: ' + err.message, 'bad');
    }
  };
  reader.onerror = () => setStatus('파일 읽기 실패', 'bad');
  reader.readAsArrayBuffer(file);
}

function renderPreview(dataset, stats) {
  const el = document.getElementById('oo-preview');
  if (!el) return;
  if (!dataset || !stats) {
    el.innerHTML = '<div class="empty">xlsx 를 올리면 세대별 변환 미리보기가 표시됩니다.</div>';
    return;
  }
  const sizeKB = (state.out ? new Blob([state.out]).size / 1024 : 0).toFixed(0);
  const c = stats.current;
  const rows = dataset.generations.map(g => {
    const last = g.series[g.series.length - 1];
    return `<div class="row-opt">
      <span class="ro-account">${g.tag}</span>
      <span class="ro-meta">vs ${g.vs} · slope ${g.slopeVs} · 만기 ${g.maturity}</span>
      <span class="ro-count">${g.series.length}행</span>
      <span class="ro-count">fly ${last[3]}bp</span>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="pv-stats">
      <div class="pv-stat"><div class="l">세대 수</div><div class="m">${stats.nGen}</div></div>
      <div class="pv-stat"><div class="l">현재 세대</div><div class="m" style="font-size:15px">${c.tag}</div></div>
      <div class="pv-stat"><div class="l">현재 세대 행수</div><div class="m">${c.rows}</div></div>
      <div class="pv-stat"><div class="l">최신 일자</div><div class="m" style="font-size:15px">${c.last}</div></div>
      <div class="pv-stat"><div class="l">현재 fly</div><div class="m">${c.fly}<span>bp</span></div></div>
      <div class="pv-stat"><div class="l">출력 크기</div><div class="m">${sizeKB}<span>KB</span></div></div>
    </div>
    <div class="flow" style="margin-top:0;margin-bottom:12px">현재 세대 <b>${c.tag}</b> (vs ${c.vs}, slope vs ${c.slopeVs}) ·
      ${c.first} ~ ${c.last} · raw <b>${c.raw}</b> / slope <b>${c.slope}</b> / fly <b>${c.fly}</b>bp ·
      구조 검증 통과(태그·만기 형식·날짜 오름차순·주말 제거·fly=raw−slope·값 범위)</div>
    <div class="rows">${rows}</div>`;
}

// ── export: data/onoff-ktb3y.js 다운로드 (파생 스프레드만) ──
function exportData() {
  if (!state.out) return;
  const blob = new Blob([state.out], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'onoff-ktb3y.js';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('다운로드: onoff-ktb3y.js → data/ 폴더에 넣고 커밋하세요.', 'ok');
}

// ── 다운로드 헬퍼 ──
function download(name, text) {
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 입찰일 → data/onoff-events.js ──
function exportEvents() {
  const ta = document.getElementById('oo-ev-input');
  const st = id => (m, k) => { const e = document.getElementById(id); if (e) { e.textContent = m; e.className = 'status ' + (k || ''); } };
  const setEv = st('oo-ev-status')();
  const raw = (ta.value || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const bad = raw.filter(d => !DATE_RE.test(d) || Number.isNaN(Date.parse(d)));
  if (bad.length) { const e = document.getElementById('oo-ev-status'); e.textContent = '날짜 형식 오류: ' + bad.slice(0, 5).join(', '); e.className = 'status bad'; return; }
  const auctions = [...new Set(raw)].sort();
  download('onoff-events.js',
    '// 입찰일 이벤트 — onoff-admin 생성. 분기·반기말은 자동 계산.\n' +
    'window.ONOFF_EVENTS = { auctions: ' + JSON.stringify(auctions) + ' };\n');
  const e = document.getElementById('oo-ev-status'); e.textContent = `입찰일 ${auctions.length}건 → onoff-events.js 다운로드. data/ 에 넣고 커밋.`; e.className = 'status ok';
}

// ── 코멘터리 append → data/onoff-commentary.js ──
function exportCommentary() {
  const snapEl = document.getElementById('oo-cmt-snapshot');
  const textEl = document.getElementById('oo-cmt-text');
  const status = document.getElementById('oo-cmt-status');
  const fail = m => { status.textContent = m; status.className = 'status bad'; };
  let snap;
  try { snap = JSON.parse(snapEl.value); } catch { return fail('JSON 스냅샷 파싱 실패 — 조회 페이지 [JSON 복사] 결과를 붙여넣으세요.'); }
  const text = (textEl.value || '').trim();
  if (!text) return fail('코멘터리 텍스트를 입력하세요.');
  const item = { date: snap.asof || '', text, inputSnapshot: snap };
  const existing = Array.isArray(window.ONOFF_COMMENTARY) ? window.ONOFF_COMMENTARY : [];
  const next = [...existing, item];
  download('onoff-commentary.js',
    '// 코멘터리 히스토리 — onoff-admin append. 각 항목 { date, text, inputSnapshot }.\n' +
    'window.ONOFF_COMMENTARY = [\n' +
    next.map(it => '  ' + JSON.stringify(it)).join(',\n') +
    '\n];\n');
  status.textContent = `코멘터리 append (총 ${next.length}건) → onoff-commentary.js 다운로드. data/ 에 넣고 커밋.`;
  status.className = 'status ok';
}

export function initOnoffEvents() {
  const btn = document.getElementById('oo-ev-btn');
  if (btn) btn.addEventListener('click', exportEvents);
}
export function initOnoffCommentary() {
  const btn = document.getElementById('oo-cmt-btn');
  if (btn) btn.addEventListener('click', exportCommentary);
}

export function initOnoffAdmin() {
  const drop = document.getElementById('oo-dropzone');
  const fileInput = document.getElementById('oo-file-input');
  const exportBtn = document.getElementById('oo-export-btn');
  if (!drop || !fileInput || !exportBtn) return; // 카드 미존재 시 무동작

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  exportBtn.addEventListener('click', exportData);

  renderPreview(null);
}

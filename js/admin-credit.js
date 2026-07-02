// admin-credit.js — 크레딧 스프레드 composite xlsx 업로드 → 검증 → data/credit-spread.js export.
// 파싱·직렬화·G1검증은 js/credit-parse.js 공유 모듈에 위임 → tools/convert-composite.mjs 와
// 바이트 동일한 산출물을 생성한다(브라우저 ArrayBuffer 경로 = node Buffer 경로 검증 완료).
// 미리보기 %ile 은 조회 페이지와 동일한 rv-calc.js 를 재사용한다.
// SheetJS(XLSX)는 admin.html 이 로드한 vendor/xlsx.min.js 의 전역을 사용.

import { parseAoa, serialize, validateStructure } from './credit-parse.js';
import { toBp, seriesPercentile } from './rv-calc.js';

const state = { out: null, fname: null };

function setStatus(msg, kind) {
  const el = document.getElementById('cs-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + (kind || '');
}

function fmtPct(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v) + '%ile' : '—';
}

// ── xlsx 로드 → 파싱 → 검증 → 미리보기 ──
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
      const ws = wb.Sheets['spread'];
      if (!ws) throw new Error("시트 'spread' 없음");
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      const parsed = parseAoa(aoa);
      const stats = validateStructure(parsed);    // 실패 시 throw → 구조 게이트(위치 포함)
      state.out = serialize(parsed);              // node 스크립트와 바이트 동일

      // 미리보기 %ile: 조회 페이지와 동일한 rv-calc 로 산출
      const gsAAA3full = seriesPercentile(toBp(parsed.series['공사채AAA_3년'] || []), 'full');

      renderPreview(parsed, stats, gsAAA3full);
      document.getElementById('cs-export-btn').disabled = false;
      setStatus(`구조 검증 통과 — ${stats.rows}행, ${stats.first} ~ ${stats.last}. export 가능.`, 'ok');
    } catch (err) {
      state.out = null;
      document.getElementById('cs-export-btn').disabled = true;
      renderPreview(null);
      setStatus('검증 실패: ' + err.message, 'bad');
    }
  };
  reader.onerror = () => setStatus('파일 읽기 실패', 'bad');
  reader.readAsArrayBuffer(file);
}

function renderPreview(parsed, stats, gsAAA3full) {
  const el = document.getElementById('cs-preview');
  if (!el) return;
  if (!parsed || !stats) {
    el.innerHTML = '<div class="empty">xlsx 를 올리면 검증 미리보기가 표시됩니다.</div>';
    return;
  }
  const sizeKB = (state.out ? new Blob([state.out]).size / 1024 : 0).toFixed(0);
  el.innerHTML = `
    <div class="pv-stats">
      <div class="pv-stat"><div class="l">데이터 행</div><div class="m">${stats.rows}</div></div>
      <div class="pv-stat"><div class="l">최신 일자</div><div class="m" style="font-size:15px">${stats.last}</div></div>
      <div class="pv-stat"><div class="l">공사AAA 3년 현재</div><div class="m">${(stats.gsAAA3 * 100).toFixed(1)}<span>bp</span></div></div>
      <div class="pv-stat"><div class="l">공사AAA 3년 %ile(full)</div><div class="m">${fmtPct(gsAAA3full)}</div></div>
      <div class="pv-stat"><div class="l">섹터 · 시리즈</div><div class="m" style="font-size:15px">${stats.sectors} · ${stats.cols}</div></div>
      <div class="pv-stat"><div class="l">출력 크기</div><div class="m">${sizeKB}<span>KB</span></div></div>
    </div>
    <div class="flow" style="margin-top:0">기간 <b>${stats.first} ~ ${stats.last}</b> · 국고3년 <b>${stats.ktb3}%</b> · 구조 검증 통과(라벨 75·날짜 오름차순·값 범위·비null≥50%)</div>`;
}

// ── export: data/credit-spread.js 다운로드 ──
function exportData() {
  if (!state.out) return;
  const blob = new Blob([state.out], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'credit-spread.js';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('다운로드: credit-spread.js → data/ 폴더에 넣고 커밋하세요.', 'ok');
}

export function initCreditAdmin() {
  const drop = document.getElementById('cs-dropzone');
  const fileInput = document.getElementById('cs-file-input');
  const exportBtn = document.getElementById('cs-export-btn');
  if (!drop || !fileInput || !exportBtn) return; // 카드 미존재 시 무동작 (CSV 흐름 무관)

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

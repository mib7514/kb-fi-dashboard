// nav.js — 공통 상단 내비게이션. 모듈 목록(NAV_ITEMS)을 단일 근원으로 정의하고
// 페이지 상단에 바를 자동 렌더(현재 페이지 활성 표시). index.html은 NAV_ITEMS로 카드도 구성.
// 다크 테마 CSS 변수(--bg/--panel/--accent…)는 각 페이지가 이미 정의 → 스타일만 자가 주입.
// ES module: 각 페이지에서 <script type="module" src="js/nav.js"> 한 줄로 삽입(기존 로직 무손상).

export const NAV_ITEMS = [
  { id: 'home', title: '홈', file: 'index.html', desc: '모듈 허브' },
  { id: 'inflation', title: '물가전망', file: 'inflation-forecast.html', desc: 'KR CPI 시즈널 m-m 추정 → y-y 시나리오' },
  { id: 'curve-rv', title: 'Curve RV', file: 'curve-rv.html', desc: '크레딧 스프레드 섹터×만기 상대가치 (캐리·롤·percentile·백테스트)' },
  { id: 'onoff', title: 'On/Off 스프레드', file: 'onoff-spread.html', desc: '국고 3년 지표물 커브조정 상대가치 — 세대 이벤트타임 비교' },
  { id: 'carry', title: '캐리 손익분기', file: 'carry-breakeven.html', desc: '레버리지 캐리 vs 금리·스프레드 확대 — 손익분기·시나리오 기대값 (입력형)' },
  { id: 'rg-regime', title: '레짐 판단', file: 'rg-regime.html', desc: '전향적 레짐 히트맵 — 금리·스프레드 방향 확률 → 9셀 결합확률 + 플레이북 (입력형)' },
];

const CSS = `
#site-nav { border-bottom: 1px solid var(--border, #21262d); margin-bottom: 22px; }
#site-nav .inner { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; gap: 18px;
  padding: 2px 0 12px; flex-wrap: nowrap; white-space: nowrap; overflow-x: auto; }
#site-nav .brand { font-size: 14px; font-weight: 700; color: var(--text, #e6edf3); text-decoration: none;
  letter-spacing: -0.01em; flex-shrink: 0; }
#site-nav .links { display: flex; gap: 6px; flex-wrap: nowrap; }
#site-nav .links a { font-size: 12.5px; color: var(--muted, #8b949e); text-decoration: none;
  padding: 5px 11px; border-radius: 6px; white-space: nowrap; transition: background .12s, color .12s; }
#site-nav .links a:hover { background: var(--panel-2, #1c2128); color: var(--text, #e6edf3); }
#site-nav .links a.active { background: var(--accent, #58a6ff); color: #08111f; font-weight: 600; }
`;

function currentFile() {
  const p = (location.pathname.split('/').pop() || '').trim();
  return p === '' ? 'index.html' : p;
}

// 현재 파일명 → 활성 모듈 id (매칭 없으면 home)
export function activeId() {
  const f = currentFile();
  const item = NAV_ITEMS.find(i => i.file === f);
  return item ? item.id : 'home';
}

export function renderNav(active = activeId()) {
  if (!document.getElementById('site-nav-style')) {
    const st = document.createElement('style');
    st.id = 'site-nav-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let bar = document.getElementById('site-nav');
  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'site-nav';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  const links = NAV_ITEMS.map(i =>
    `<a href="${i.file}"${i.id === active ? ' class="active"' : ''}>${i.title}</a>`).join('');
  bar.innerHTML = `<div class="inner">
    <a class="brand" href="index.html">FI Dashboard</a>
    <div class="links">${links}</div>
  </div>`;
}

// 자동 렌더
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => renderNav());
} else {
  renderNav();
}

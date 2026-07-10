// 홈 허브(index.html) 카드 렌더 DOM 스모크 — node --test (자동탐색).
// 재발 방지: NAV_ITEMS의 모든 비-home 모듈이 index.html의 실제 인라인 카드 로직으로
// 카드 1장씩 렌더되는지 검증(rg-regime 누락 회귀 대비). 실제 index.html·nav.js·data 사용.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const url = (p) => new URL('../' + p, import.meta.url);

// ── 최소 DOM/브라우저 셰임 ──────────────────────────────────────────────
function mkEl() {
  let html = '';
  return { get innerHTML() { return html; }, set innerHTML(v) { html = v; },
    appendChild() {}, setAttribute() {}, style: {}, textContent: '' };
}
function makeDoc() {
  const byId = {};
  return {
    readyState: 'complete',
    getElementById: (id) => (byId[id] ||= mkEl()),
    createElement: () => mkEl(),
    head: { appendChild() {} },
    body: { insertBefore() {}, firstChild: null },
    addEventListener() {},
  };
}

// data 스크립트를 브라우저 <script> 처럼 win 에 자기등록 (fetch·json 미사용 관례)
function loadData(win) {
  for (const f of ['data/kr-cpi-headline.js', 'data/credit-spread.js', 'data/onoff-ktb3y.js']) {
    new Function('window', readFileSync(url(f), 'utf8'))(win);
  }
}

// index.html 의 인라인 module 스크립트 본문을 추출 (import 문은 파라미터 주입으로 대체)
function extractHubScript() {
  const html = readFileSync(url('index.html'), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, 'index.html 인라인 module 스크립트를 찾지 못함');
  return m[1].replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/, '');
}

// nav.js 는 import 시 renderNav() 부작용이 document 를 요구 → 전역 셰임 후 로드
async function loadNavItems() {
  globalThis.window = globalThis;
  globalThis.document = makeDoc();
  globalThis.location = { pathname: '/index.html' };
  const mod = await import(url('js/nav.js'));
  return mod.NAV_ITEMS;
}

test('홈 허브: 모든 비-home NAV_ITEM 이 카드로 렌더 (rg-regime 포함)', async () => {
  const NAV_ITEMS = await loadNavItems();
  const win = {};
  loadData(win);
  const doc = makeDoc();

  // 실제 index.html 의 카드 생성 로직을 그대로 실행
  new Function('NAV_ITEMS', 'window', 'document', extractHubScript())(NAV_ITEMS, win, doc);
  const out = doc.getElementById('hub-grid').innerHTML;

  const expected = NAV_ITEMS.filter((i) => i.id !== 'home');
  const cardCount = (out.match(/class="hub-card"/g) || []).length;
  assert.equal(cardCount, expected.length, `카드 수 불일치 (기대 ${expected.length})`);

  for (const it of expected) {
    assert.ok(out.includes(`href="${it.file}"`), `${it.id} 카드의 링크(${it.file}) 누락`);
    assert.ok(out.includes(`<h2>${it.title}</h2>`), `${it.id} 카드의 제목(${it.title}) 누락`);
  }

  // 회귀 핵심: rg-regime 카드가 반드시 존재
  const rg = expected.find((i) => i.id === 'rg-regime');
  assert.ok(rg, 'NAV_ITEMS 에 rg-regime 항목이 없음');
  assert.ok(out.includes('href="rg-regime.html"'), 'rg-regime 카드가 허브에 렌더되지 않음');
});

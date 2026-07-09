# RG 모듈 Phase 0 — Ground-truth 점검 리포트

- 작성일: 2026-07-09
- 대상: `rg-regime-spec.md` §4 데이터 모델 및 UI 통합 방식 확정용 기존 패턴 조사
- 범위: **조사·보고만. 코드 변경 없음. 커밋 없음.**
- 원격 상태: `git fetch` 완료 — `main` = `origin/main` (동기화됨, 미커밋 변경 없음). `rg-regime-spec.md`는 untracked.

---

## 요약 (핵심 결론 6줄)

1. **저장의 이중 구조**: 영속 데이터는 `data/*.js`(window 전역, git 커밋)로, 개인·비커밋 뷰는 `localStorage`로 나뉜다. **주간 판단 원장/채점은 어느 쪽에도 선례가 없다 — RG가 신규 패턴을 정해야 한다.**
2. **정적 데이터는 `.json`이 아니라 `<script>` window 전역** — 레포에 `.json` 데이터 파일이 **하나도 없다**. `fetch()`도 없다. 이는 GitHub Pages `file://`/CORS 회피를 위한 **의도적 관례**다. → spec의 `calib/*.json` 런타임 로드는 **기존 관례와 충돌**한다(§5 상세).
3. **OO override는 "이력 보존"이 아니다** — 단일 객체 localStorage 덮어쓰기 + 런타임 재계산이다. spec §4의 "확정 이력 보존" 전제는 **ground-truth와 불일치**(§2 상세).
4. **판정 엔진은 순수 함수 + 임계값 상단 집약 패턴** — `onoff-judge.js`가 RG 채점 로직의 이상적 템플릿이다. DOM/IO 없음, 결정론적, 테스트 존재(§3).
5. **페이지 라우팅은 단일 근원(`NAV_ITEMS` in `nav.js`)** — 항목 1개 추가 + HTML 골격 복제 + admin 섹션 추가의 정형 절차가 있다(§4).
6. **확률 정규화 UI는 `carry-ui.js`에 인라인**되어 있고 별도 함수/컴포넌트로 분리되어 있지 **않다** — 재사용하려면 추출이 필요하다(§6).

---

## 1. 저장 패턴 (OO / CB)

### 1.1 두 계층으로 분리됨

| 계층 | 매체 | 커밋 여부 | 용도 | 생성 경로 |
|---|---|---|---|---|
| **영속·공유** | `data/*.js` (window 전역 할당) | ✅ git 커밋 | 파생 데이터셋, 이벤트, 코멘터리 | admin.html에서 다운로드 → `data/`에 넣고 수동 커밋 |
| **개인·휘발** | `localStorage` | ❌ 비커밋 | 개인 입력값·잠정 뷰·UI 상태 | 페이지에서 직접 write |

### 1.2 localStorage 키 전체 목록

| 키 | 소유 모듈 | 값 구조 | 비고 |
|---|---|---|---|
| `carry-inputs` | CB (`carry-ui.js:11`) | `state` 전체 직렬화 — 아래 스키마 | 입력 전체를 단일 객체로 |
| `carry-explainer-open` | CB (`carry-ui.js:214`) | `'0'` \| `'1'` | 해설 접힘 상태 |
| `onoff-provisional` | OO (`onoff-ui.js:14`) | `{ date, yOn, yOff1, yOff2 }` | 당일 호가 잠정 입력 |
| `onoff-explainer-open` | OO (`onoff-ui.js:15`) | `'0'` \| `'1'` | 해설 접힘 상태 |

**`carry-inputs` 값 스키마** (`carry-ui.js:16-24` DEFAULTS 형태):
```jsonc
{
  "ytm": 3.50, "repo": 2.90, "roll": 0,
  "durMode": "D",           // 'D' | 'mat'
  "dur": 1.8, "mat": 3.0, "h": 3, "hedge": false,
  "scen": [                 // 가변 길이 배열
    { "label": "기본", "p": 60, "dKtb": 3, "dSpread": 0 },
    { "label": "약세", "p": 25, "dKtb": 15, "dSpread": 0 },
    { "label": "강세", "p": 15, "dKtb": -5, "dSpread": 0 }
  ]
}
```
- 저장: `save()` = `localStorage.setItem(LS_KEY, JSON.stringify(state))` — **매 렌더 끝에 호출**(`renderOutputs()` 마지막 줄, `carry-ui.js:136`). 디바운스 없음, 전체 덮어쓰기.
- 로드: `load()`가 `Array.isArray(s.scen)` 방어 후 `Object.assign(state, s)`.

**`onoff-provisional` 값 스키마** (`onoff-ui.js:222`):
```jsonc
{ "date": "2026-07-07", "yOn": 3.12, "yOff1": 3.15, "yOff2": 3.18 }  // yOff2 nullable
```

### 1.3 정적 JSON 파일 사용 여부 — **없음**

- **레포에 `.json` 데이터 파일이 0개**다 (`.claude/settings.local.json` 제외 — 설정 파일).
- 모든 영속 데이터는 `data/*.js`가 **window 전역을 할당**하는 형태:
  - `data/onoff-ktb3y.js` → `window.ONOFF_KTB3Y = { tenor, updated, generations:[...] }`
  - `data/onoff-events.js` → `window.ONOFF_EVENTS = { auctions: [...] }`
  - `data/onoff-commentary.js` → `window.ONOFF_COMMENTARY = [...]`
  - `data/credit-spread.js`, `data/kr-cpi-headline.js` 동일 패턴
- **`fetch()` / `XMLHttpRequest` 사용처가 코드 전체에 없다.** (유일한 `.json` 문자열은 `forecast-ui.js:173`의 다운로드 파일명 — 데이터 로드 아님)
- 페이지는 `<script src="data/xxx.js"></script>`로 로드 후 `window.XXX`를 읽음 (`onoff-spread.html:254-256`, `index.html:56-58`).
- **함의**: GitHub Pages 정적/no-build 환경에서 `file://` 및 CORS 문제를 피하려는 의도적 선택. → **§5 캘리브레이션 배치에서 재확인 필요.**

---

## 2. Override 구현 (OO same-day override)

**spec §4 전제**: "같은 주 재확정 시 override (OO 모듈 same-day override 패턴 준용, **확정 이력 보존**)"

**Ground-truth: OO override는 이력을 보존하지 않는다.** 실제 구현은 다음과 같다:

- OO의 "override"는 **영속 원장의 재확정 개념이 아니라, 런타임 잠정(비커밋) 뷰 계산**이다 (`onoff-ui.js:183-194` `computeProv`).
- localStorage `onoff-provisional`은 **단일 객체**다. 새 입력 시 `localStorage.setItem`으로 **통째 덮어쓰기**(`onoff-ui.js:223`), `clear` 시 `removeItem`(`onoff-ui.js:233`). **이력 배열 없음.**
- "override" vs "append"는 **저장 방식이 아니라 판정 모드**다 (`onoff-ui.js:190`, `onoff-calc.js`의 `withProvisional`):
  - 잠정 기준일 == 민평 최종일 → `mode: 'override'` (최종일 원값을 잠정값으로 교체해 재계산, 차트 실선은 `series.slice(0,-1)`로 원값 1개 제외)
  - 잠정 기준일 > 최종일 → `mode: 'append'` (새 점 추가)
  - 기준일 < 최종일 → 무효(null 반환, `onoff-ui.js:221`)
- **영속 데이터(`data/onoff-ktb3y.js`)의 재확정은 override가 아니라 admin에서 새 xlsx로 전체 재생성 → 재커밋**이다. 파생 데이터 자체는 사실상 불변 스냅샷.

**RG에 대한 함의 (spec §4 수정 필요)**:
- spec이 원하는 "주간 판단 재확정 override + **확정 이력 보존**"은 OO에 **선례가 없다**. OO는 "덮어쓰기(무이력)" 패턴이다.
- RG가 이력 보존을 원한다면 **신규 패턴을 정의**해야 한다. 제안 선택지:
  - (A) `rg:judgment:{YYYY-WW}` 키에 **버전 배열** `[{confirmedAt, ...record}, ...]`로 append (덮어쓰기 아닌 push) — 이력 보존.
  - (B) 확정 이력이 실제로 필요한지 재검토 — OO처럼 최신값만 유지(단순).
- **spec v1.1 권고**: §4의 "OO same-day override 패턴 준용" 문구를 삭제하고, "이력 보존은 OO 선례 없음 → RG 신규 정의(버전 배열 append)"로 명시.

---

## 3. 판정 엔진 구조 (RG 채점의 템플릿)

**`js/onoff-judge.js`가 RG 채점 로직이 따라야 할 정확한 패턴이다.**

- **순수 함수, DOM·파일 I/O 없음** (파일 상단 주석 `onoff-judge.js:1`으로 계약 명시).
- **임계값을 파일 상단 단일 객체 `TH`에 집약** (`onoff-judge.js:10-25`) — RG의 보합밴드 `k`, Brier 파라미터 등도 동일하게 상단 상수로.
- **입출력 인터페이스**:
  - 입력: `judge(gen, auctions, zInfo)` — 파생 세대 데이터 + 이벤트 배열 + 사전계산 통계
  - 출력: `{ verdict:{label,type}, episodes, headline, past, upcoming, flags, events, now, z }` — 구조화된 결정론적 판정 객체
  - 스냅샷 직렬화 함수 별도: `buildSnapshot(gen, judgeResult, zInfo)` → JSON 복사용 평면 객체 (`onoff-judge.js:206`)
- **UI와 분리**: `onoff-ui.js`가 `judge()` 호출 → 결과를 배지로 렌더. 계산과 렌더가 완전 분리.
- **테스트 존재**: `tests/onoff-judge.test.mjs` (node `--test`). RG 채점도 동일하게 `js/rg-score.js`(순수) + `tests/rg-score.test.mjs`로 작성 가능.

**RG 적용 결론**: **동일 패턴 100% 적용 가능**. 권고 구조:
- `js/rg-calc.js` — 9셀 결합확률, 캐리/롤다운/커브이동 분해, E[Δy] 확률가중 (순수)
- `js/rg-score.js` — 실현 방향 분류(보합밴드), 최빈셀 적중, 축별 적중, Brier, 순위 적중 (순수, 상단 `TH`/밴드 상수)
- `js/rg-ui.js` — 입력 수집·localStorage·렌더 (OO/CB의 `*-ui.js`와 동일 역할)
- 각 순수 모듈에 `tests/*.test.mjs`

> 실행 주의(메모리): `node --test tests/`는 이 환경에서 실패. **인자 없이 `node --test` 자동탐색** 사용.

---

## 4. 페이지 라우팅 (새 rg-regime 페이지 추가 절차)

라우팅은 **`js/nav.js`의 `NAV_ITEMS` 배열이 단일 근원**이다.

**새 페이지 추가 정형 절차** (기존 carry 모듈이 최신 선례):

1. **`js/nav.js:6` `NAV_ITEMS`에 항목 1개 추가**:
   ```js
   { id: 'rg-regime', title: '레짐 판단', file: 'rg-regime.html', desc: '전향적 레짐 히트맵·롤다운·채점' }
   ```
   → 네비 바 링크 + `index.html` 카드가 **자동 생성**됨 (`index.html:73`이 `NAV_ITEMS` 재사용).
2. **`rg-regime.html` 생성** — 기존 페이지 HTML 골격 복제. 공통 요소:
   - `<head>`에 `:root` 다크테마 CSS 변수 블록 (각 페이지가 자체 정의 — nav.js는 스타일 자가주입만)
   - `<title>… | FI Dashboard</title>` 컨벤션
   - 본문 끝: `<script type="module" src="js/nav.js"></script>` (네비 자동 렌더)
   - `<script src="vendor/plotly.min.js"></script>` (차트 필요 시)
   - `<script src="data/xxx.js"></script>` (필요한 window 전역 데이터)
   - `<script type="module"> import { initRg } from './js/rg-ui.js'; initRg(); </script>`
   - 참조 골격: `carry-breakeven.html:213-217` (데이터 파일 없는 순수 입력형 — RG-1과 가장 유사), `onoff-spread.html:250-260` (데이터 로드 포함형).
3. **admin 통합** (필요 시): `admin.html`에 독립 `<h1>` 섹션 추가 + `js/*-admin-ui.js`에 `init…()` export → `admin.html:227-238`의 module 스크립트에서 호출. 각 데이터 흐름은 서로 독립 카드로 구성됨(코멘터리/이벤트/xlsx가 이미 병렬 배치).

**RG의 admin 필요 범위**: 캘리브레이션 JSON은 오프라인 스크립트 산출(§5)이므로 admin UI 불필요. 단, 주간 원장을 커밋형으로 갈 경우 OO 코멘터리처럼 "JSON 붙여넣기 → data/*.js append 다운로드" 흐름을 admin에 추가하는 선례가 있음(`onoff-admin-ui.js:124` `initOnoffCommentary`).

---

## 5. 캘리브레이션 JSON 배치

**spec §3/§4 제안**: `calib/neutral-bands.json`, `calib/regime-median-curves.json`을 런타임 로드.

**Ground-truth 충돌**: 앞서 §1.3대로 **레포는 `.json`을 런타임 로드하지 않는다**(`fetch` 없음, `file://` 회피 목적). 정적 결과는 **모두 `data/*.js` window 전역** 관례다.

**권고 (관례 정렬)**:
- 배치 디렉토리: 신규 `calib/`가 아니라 **기존 `data/` 디렉토리**에 두는 것이 관례에 맞음.
- 형식: `.json`이 아니라 **`data/rg-calib.js` (window 전역 할당)**:
  ```js
  // data/rg-calib.js — 오프라인 캘리브레이션 산출물 (tools/ 스크립트 생성). 파생 통계값만.
  window.RG_CALIB = {
    neutralBands: { ktb3y: { sigma: …, band: … }, sectors: {…} },
    regimeMedianCurves: { /* 9레짐 × 8구간 중위 Δbp + n + sourceLevel */ }
  };
  ```
  → `rg-regime.html`에서 `<script src="data/rg-calib.js">`로 로드, `window.RG_CALIB` 읽기. **CORS/`file://` 무관, 기존 모든 모듈과 동일.**
- 생성 스크립트: `tools/`에 격리 (`tools/convert-onoff.mjs`, `tools/convert-composite.mjs` 선례). 원시 수익률 미포함 검수는 admin export가 파생값만 담는 기존 원칙과 일치(§0.3).
- **만약** 순수 `.json` 형식을 굳이 원한다면, 로드는 `fetch`가 아니라 빌드 시 `.js` 래핑이 필요 → 관례상 처음부터 `.js` 전역이 단순.

**spec v1.1 권고**: §3 산출물 경로를 `calib/*.json` → `data/rg-calib.js`(window.RG_CALIB, 파생 통계값)로 변경. §4의 `rg:calib`도 "런타임 localStorage 아님 — `data/rg-calib.js` 정적 로드"로 명시.

---

## 6. 확률 슬라이더 / p-정규화 재사용성

**spec 전제 (RG-1 §, §7-9)**: "축별 합계 ≠ 100% 시 경고 뱃지 + 원클릭 정규화 버튼 (CB 모듈 p-정규화 패턴 재사용)".

**Ground-truth: CB의 p-정규화는 별도 함수/컴포넌트로 분리되어 있지 않고 `carry-ui.js`에 인라인**이다.

- **정규화 로직** (`carry-ui.js:43-49`, `derive()` 내부):
  ```js
  const sumP = state.scen.reduce((a, s) => a + num(s.p), 0);
  const needNorm = sumP > 0 && Math.abs(sumP - 100) > 0.05;   // 임계 0.05
  const scenN = state.scen.map(s => ({ ..., p: needNorm ? num(s.p) * 100 / sumP : num(s.p) }));
  ```
  → **입력값 보존, 계산 시점에만 정규화**(pᵢ×100/Σp). 이 방식이 spec의 "정규화 전 저장 불가/입력값 보존" 요구와 부합.
- **경고 뱃지 렌더** (`carry-ui.js:79-86`, `renderOutputs()` 내부): `#cb-psum` 뱃지 텍스트/클래스(`badge warn`/`badge ok`) + `#cb-norm-note` 설명 — **DOM 직접 조작, 함수 미분리.**
- **중요 차이**: CB에는 spec이 말하는 **"원클릭 정규화 버튼"이 없다**. CB는 **버튼 없이 계산 시 자동 정규화**(입력값은 그대로 두고 결과만 정규화값 사용)한다. spec RG는 "정규화 버튼 클릭 → 입력값 자체를 100으로 재기입, 정규화 전 저장 불가"를 원함 — **동작이 다르다**(CB=비파괴 자동, RG=파괴적 버튼).
- **슬라이더**: CB는 `<input type="number">`만 사용, **슬라이더 없음**(`carry-ui.js:64-71`). spec RG의 "숫자+슬라이더 병행"은 신규 구현 필요.

**재사용 결론**:
- **그대로 재사용 불가** — 분리된 컴포넌트가 없고, 버튼 없는 자동 정규화 방식이 RG 요구(버튼+파괴적 재기입)와 다름.
- **권고**: 정규화 로직을 순수 함수로 추출해 공유:
  ```js
  // js/prob-normalize.js (신규 공유 유틸)
  export function normalizeProbs(arr) { const s = arr.reduce((a,x)=>a+x,0);
    return s > 0 ? arr.map(x => x*100/s) : arr; }
  export function probSumStatus(arr, tol=0.05) { const s = arr.reduce((a,x)=>a+x,0);
    return { sum: s, ok: s>0 && Math.abs(s-100)<=tol }; }
  ```
  RG-1(6칸=금리3+스프레드3), RG-3(18칸=6섹터×3)에서 축별로 재사용. CB도 향후 이 유틸로 리팩터 가능(선택).
- **경고 뱃지 UI**: `carry-ui.js:79-86`의 `badge warn`/`badge ok` + note 패턴을 **시각 참조**로 복제(마크업은 페이지별 인라인이 관례).

---

## 7. spec §4 데이터 모델 — 확정 권고안 (v1.1 반영용)

Ground-truth 반영 후 §4 수정 제안:

```
[영속·커밋 — data/*.js window 전역]
data/rg-calib.js        window.RG_CALIB = { neutralBands, regimeMedianCurves }
                        오프라인 tools/ 스크립트 산출. 파생 통계값만. (구 calib/*.json 대체)
data/rg-ledger.js       window.RG_LEDGER = { judgments: {...}, scores: {...} }
                        주간 판단·채점 원장. admin "JSON 붙여넣기→append 다운로드" 흐름으로 커밋.
                        (커밋형 공유 원장을 원할 경우 — OO 코멘터리 선례)

[개인·휘발 — localStorage, 비커밋]
rg:draft                작성 중 주간 입력 (확정 전 임시). 단일 객체 덮어쓰기. (carry-inputs 선례)
rg:ui                   UI 상태(펼침 등). (*-explainer-open 선례)
```

**핵심 결정 필요 사항 (승인 요청)**:
1. **주간 원장의 영속 매체**: (A) 커밋형 `data/rg-ledger.js`(팀 공유·admin append 흐름, OO 코멘터리 선례) vs (B) 개인 localStorage(단순, 비공유). spec 문맥(팀 대시보드, 채점 추이 대시보드)상 **(A) 권고**.
2. **재확정 이력 보존**: OO에 선례 없음 → RG 신규. `judgments[YYYY-WW]`를 단일 객체 덮어쓰기(무이력) vs 버전 배열 append(이력). spec §4는 이력 원하나 §7-2 중첩창 채점엔 최신값만 필요 → **최신값 유지 + `confirmedAt` 타임스탬프 1개** 정도로 절충 권고.
3. **캘리브레이션 형식**: `.json` 런타임 로드 폐기 → `data/rg-calib.js` 전역 (관례 정렬, 확정).

---

## 8. 발견된 spec-현실 불일치 요약 (v1.1에서 수정할 항목)

| # | spec 기술 | Ground-truth | 조치 |
|---|---|---|---|
| 1 | `calib/*.json` 런타임 로드 | 레포에 `.json` 데이터 없음, `fetch` 없음 (의도적 `file://` 회피) | `data/rg-calib.js` window 전역으로 변경 |
| 2 | "OO same-day override 패턴 준용, 확정 이력 보존" | OO override는 단일객체 덮어쓰기 + 런타임 재계산, **이력 미보존** | "OO 선례 없음 — RG 신규 정의"로 문구 수정 |
| 3 | "CB p-정규화 패턴 재사용" (원클릭 버튼) | CB는 버튼 없는 **자동 비파괴 정규화**, 함수 미분리, 슬라이더 없음 | 공유 유틸 `js/prob-normalize.js` 추출 + 버튼·슬라이더 신규 구현 |
| 4 | `rg:judgment:{YYYY-WW}` 등 localStorage 원장 | localStorage는 개인·비커밋만. 공유 영속은 `data/*.js` 커밋 | 원장 매체 결정 필요(§7 항목1) |

---

## 부록 — 조사 근거 파일·라인

- 저장: `js/carry-ui.js:11,16-37,136`, `js/onoff-ui.js:14-15,212-251`
- 데이터 전역: `data/onoff-events.js:2`, `data/onoff-commentary.js:3`, `data/onoff-ktb3y.js:1`, `onoff-spread.html:254-256`, `index.html:56-58`
- override: `js/onoff-ui.js:183-194,215-237`, `onoff-calc.js`(`makeProvisional`/`withProvisional`)
- 판정 엔진: `js/onoff-judge.js:1,10-25,118-202,206-226`, `tests/onoff-judge.test.mjs`
- 라우팅: `js/nav.js:6-12,39-58`, `index.html:60-73`, `carry-breakeven.html:213-217`, `onoff-spread.html:250-260`
- admin 통합: `admin.html:165-238`, `js/onoff-admin-ui.js:86-155`
- 정규화 UI: `js/carry-ui.js:43-49,79-86,64-71`
- gitignore(원본 xlsx·csv 제외): `.gitignore`

---

**정지.** 다음 Phase(캘리브레이션) 미진행. 커밋 없음. 위 §7-8의 승인 필요 항목 결정 후 spec v1.1 갱신 → Phase 1 진행.

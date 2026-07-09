# RG 캘리브레이션 (tools/rg-calibration)

spec v1.1 §2·§3 오프라인 산출물 `data/rg-calib.js` 생성기. **사이트 페이지에서 로드되지 않는 격리 위치**
(tools/ · .mjs · 어떤 HTML도 참조 안 함). node 전용.

## 파일

| 파일 | 역할 | I/O |
|---|---|---|
| `calibrate.mjs` | 순수 코어 — 전향 1개월 변화·σ·밴드·9셀 분류·중위커브·계층폴백·직렬화 | 없음 |
| `series-parse.mjs` | 입력 파싱 — Infomax 와이드 xlsx AOA + 기존 credit-spread.js 어댑터 | 없음 |
| `run.mjs` | 실행 엔트리 — SheetJS 로드·CONFIG 매핑·`data/rg-calib.js` 기록·리포트 출력 | fs·xlsx |
| `selftest.mjs` | 합성 데이터 코어 검증(17 케이스) | 없음 |
| `verify-no-raw.mjs` | 산출물에 원시 레벨 부재 검수(§0.3·Phase 1 §5) | fs |

## 실행

```bash
node tools/rg-calibration/selftest.mjs          # 로직 검증(실데이터 불필요)
node tools/rg-calibration/run.mjs [커브xlsx]     # data/rg-calib.js 생성
node tools/rg-calibration/verify-no-raw.mjs      # 원시레벨 부재 검수
```

## 입력 데이터 형식 (파일 준비 시 참조)

### 이미 확보 — 추가 불필요
금리축·대표 스프레드·RG-3 6섹터 스프레드는 **기존 `data/credit-spread.js` 재사용**
(2015-01-02 ~ 2026-07-08, ~11.5년, 결측 거의 없음 — 확인 완료). `run.mjs` 기본
`SECTORS_FROM='credit-spread'` 경로가 아래 라벨을 자동으로 끌어온다:

| RG 논리키 | credit-spread 라벨 | 용도 |
|---|---|---|
| rate (금리축) | `국고채권_3년` | 9셀 금리 방향 + ktb3y 밴드 |
| spread (스프레드축) | `회사채AA-_3년` | 9셀 스프레드 방향 + repSpread 밴드 (§6 대표=회사채 AA- 3Y) |
| 공사채 | `공사채AAA_3년` | RG-3 섹터 밴드 |
| 은행채 | `은행채AAA_3년` | RG-3 섹터 밴드 |
| 회사채 | `회사채AA-_3년` | RG-3 섹터 밴드 (repSpread 와 동일 계열) |
| 카드채 | `카드채AA+_3년` | RG-3 섹터 밴드 |
| 여전채 | `여전채AA-_3년` | RG-3 섹터 밴드 |

### 필요 — 새 파일 1개
`medianCurves`(9레짐 × **8구간** 중위 Δ)에는 국고 커브 8구간이 필요한데, composite 에는
1Y·2Y·3Y·5Y 만 있고 **3M·6M·1.5Y·2.5Y 가 없다.** → 국고 커브 8구간 일별 수익률 xlsx 필요.

**형식 (Infomax 와이드):**
- 1열: 일자 (Excel 시리얼 또는 `YYYY-MM-DD`). 주말 행은 자동 제거됨.
- 이후 열: 만기별 국고 수익률(%). 헤더행에 만기 라벨.
- 필요한 8구간: **3M / 6M / 1Y / 1.5Y / 2Y / 2.5Y / 3Y / 5Y**
- 기간: 가용 최장(목표 15~20년). 최소 2015~ 이면 composite 와 겹쳐 즉시 사용 가능.
- 파일 위치: 레포 루트에 두거나 실행 시 인자로 경로 전달. `*.xlsx` 는 .gitignore 로 커밋 제외됨.

**파일 받으면:** `run.mjs` 상단 `CONFIG.curveMap` 의 라벨을 실제 헤더 문자열로 맞춘다
(헤더가 `국고 3M` 형태와 다르면 실제 텍스트 알려주면 매핑 조정). `headerRow`/`dateCol` 도
파일 레이아웃에 맞게 조정.

> **대안:** 새 xlsx 가 커브 + 스프레드(더 긴 이력)를 모두 담으면 `SECTORS_FROM='xlsx'` +
> `xlsxSpreadMap` 을 채워 단일 소스로 산출 가능. 기본은 composite 재사용(검증됨).

## 산출물 구조 (`data/rg-calib.js`)

```js
window.RG_CALIB = {
  bands: {                       // 계열별 σ·밴드(±kσ)·표본수, 단위 bp
    ktb3y:     { sigmaBp, bandBp, n },
    repSpread: { sigmaBp, bandBp, n },
    sectors: { 국고채:{...}, 공사채:{...}, 은행채:{...}, 회사채:{...}, 카드채:{...}, 여전채:{...} },
  },
  medianCurves: {                // 9셀 × 8구간 중위 Δbp + 표본수 + 소스레벨
    tenors: ['3M','6M','1Y','1.5Y','2Y','2.5Y','3Y','5Y'],
    rows: { down, flat, up },    // 행 주변부 표본수(투명성)
    globalN,
    cells: { 'down|narrow': { n, source:'cell'|'row'|'global', deltaBp:[8개] }, ... 9개 },
  },
  meta: { k:0.25, horizonMonths:1, minCellN:30, unit:'bp', period, generatedAt, ... },
};
```

원시 수익률/스프레드 레벨은 **미포함**(§0.3). Δbp·σbp·표본수·소스·메타만.
`fetch`·`.json` 미사용 — `<script src="data/rg-calib.js">` 전역 로드(repo 관례).

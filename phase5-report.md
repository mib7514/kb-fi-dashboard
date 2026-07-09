# RG 모듈 Phase 5 — RG-3 섹터 스프레드 보드 리포트

- 작성일: 2026-07-09
- 기준: `rg-regime-spec.md` v1.1 §1 RG-3, phase4-report.md §6 인계 노트
- 상태: **완료.** 커밋 준비(미커밋). 원격 `git fetch` 확인 — `main` 5 ahead(Phase 0~4), 동기화.

---

## 0. 요약

- RG-3 섹터 보드를 **RG-1과 동일 페이지**에 추가(입력 공유). 6섹터 × 방향 확률(축소/보합/확대) →
  기대 Δs 순위. `prob-normalize.js` 재사용(섹터별 합 100% 경고+정규화, 미정규화 섹터 있으면 확정 불가).
- **국고채·회사채 행 ↔ RG-1 축 = 단일 상태 공유**(복제 아님):
  - 회사채 → `state.spread`(축소/보합/확대 키 동일, identity 참조).
  - 국고채 → `state.rate`(하락/보합/상승), **방향 매핑 하락=축소·상승=확대**.
  - 어느 뷰에서 고쳐도 즉시 양방향 반영 + RG-1 히트맵·RG-2 커브이동 재계산.
- 순수 로직 `js/rg-sector.js`(expectedDs·sectorProbs·**setSectorProb**·buildSectorRows·rankByAttractiveness)
  + 단위테스트 8종. RG 전체 단위테스트 26종(rolldown 18 + sector 8) 통과, 기존 무손상.
- 확정 스니펫에 `sectors:{섹터별 probs + eDsBp + sharedWith}` 추가.

---

## 1. 체크리스트 ② — 밴드 소스 (calib 실측 기준 판단)

`data/rg-calib.js`의 `bands` 실측 구조:

| 섹터 | 밴드 σ / ±0.25σ | n | 계열 정체 |
|---|---|---:|---|
| 국고채 | 18.2 / **±4.6** | 3676 | **`ktb3y`(금리축)와 바이트 동일** — 국고 3Y 수익률 변화 계열 |
| 공사채 | 7.4 / ±1.9 | 2811 | 공사채AAA_3년 스프레드 |
| 은행채 | 5.9 / ±1.5 | 2811 | 은행채AAA_3년 스프레드 |
| 회사채 | 8.9 / **±2.2** | 2811 | **`repSpread`(RG-1 스프레드 축)와 동일** — 회사채 AA- 3Y |
| 카드채 | 12.6 / ±3.2 | 2811 | 카드채AA+_3년 스프레드 |
| 여전채 | 13.2 / ±3.3 | 2811 | 여전채AA-_3년 스프레드 |

**판단·조치:**
- **국고채 밴드 = 금리축(±4.6bp)과 동일 계열**(Phase 1에서 국고 섹터 밴드를 커브 3Y 수익률로 산출).
  이 정합에 근거해 **국고 행을 RG-1 금리 축과 단일 상태 공유**로 구현(하락=축소·상승=확대 매핑).
  → UI에 "RG-1 금리 축과 동일 입력 (하락=축소)" 표기 + "국고 행은 하락=축소 열, 상승=확대 열로 매핑,
  축소/확대는 수익률 방향" 명시. `rg-sector.js` SECTORS 국고채 `share:'rate'`.
- **회사채 밴드 = repSpread(±2.2bp)와 동일** → 회사채 행이 RG-1 스프레드 축과 상태 공유하는 것과 정합
  (`share:'spread'`, identity). 단위테스트로 `sectorBandBp('국고채')===ktb3y.bandBp`,
  `sectorBandBp('회사채')===repSpread.bandBp` 고정.

---

## 2. 계산 · 순위

```
E[Δs] = δ × (P확대 − P축소) / (P축소+P보합+P확대)   δ = 섹터 보합밴드(bp)
```
- (−) = 축소 예상(매력), (+) = 확대 예상. **순위 = E[Δs] 오름차순(축소 기대 상위 = 매력 상위)**.
- 예시(국고 축소 70/20/10, 여전 확대 10/20/70, 나머지 중립):
  1. 국고채 ±4.6 **−2.8bp** · 2~5. 공사/은행/회사/카드 0bp · 6. 여전채 ±3.3 **+2.0bp**.

---

## 3. 데이터 구조 · 공유

- `state.sectors` = **비공유 4섹터**(공사/은행/카드/여전) 각 {narrow,flat,wide}. **국고채·회사채는 미포함** —
  각각 `state.rate`·`state.spread`를 사용(단일 상태, 두 뷰).
- 공유 동작(단일 상태): 공유 섹터 행 편집 → `setSectorProb`가 RG-1 축 필드에 되돌려 씀
  (국고 축소→`rate.down`, 확대→`rate.up`; 회사채→`spread.*`) → `writeInputs()`(RG-1 뷰 동기)
  + `renderOutputs()`(히트맵·커브이동·섹터 재계산). 역방향(RG-1 축 편집) → `renderSectors()`가
  공유 행 갱신. `sectorProbs('국고채')`는 rate를 {narrow:down,flat,wide:up}로 매핑해 반환. 포커스 칸 제외(커서 보존).
- 저장: `state.sectors`(비공유 4섹터, 파생 확률)만 localStorage 작업본에 저장(§0.3 OK).
  국고채·회사채는 rate·spread로만 저장(중복 없음).
- 확정 게이트: 금리·스프레드 축 **+ 비공유 4섹터** 모두 합계 100%(국고·회사채는 RG-1 축으로 커버).

---

## 4. 산출물

| 파일 | 변경 | 내용 |
|---|---|---|
| `js/rg-sector.js` | 신규 | 순수 — expectedDs·sectorProbs·setSectorProb·sectorBandBp·buildSectorRows·rankByAttractiveness (국고 rate 매핑) |
| `tests/rg-sector.test.mjs` | 신규 | 단위테스트 8종(E[Δs]·밴드소스·공유 매핑·setSectorProb·순위) |
| `js/rg-ui.js` | 수정 | 섹터 상태(비공유 4)·6행 렌더·양방향 공유(rate/spread)·정규화 게이트·스니펫 sectors |
| `rg-regime.html` | 수정 | RG-3 섹터 보드 섹션(6행·미니바·순위표) + CSS |

- 확정 스니펫: `sectors[key] = { probs(정규화), eDsBp, shared?, sharedWith? }`
  (국고채 sharedWith:'rate', 회사채 sharedWith:'spread').

---

## 5. 검증

**단위테스트:** `node --test` — rg-sector 8/8, rg-rolldown 18/18(무손상). 전체 87개 중 3 실패는
OO 실데이터/게이트 앵커(로컬 xlsx 의존, RG 무관 기존 실패).

**DOM 스모크:** `initRg()` 전 흐름 + 정적 ID 감사 → **전부 통과.**
**로컬 서버 스모크:** 페이지·자산 HTTP 200(404 0건), RG-3 앵커 present → 콘솔 에러 유발 리소스 없음.

**체크리스트:**
| # | 항목 | 결과 |
|---|---|---|
| ① | 공유 섹터 편집 → RG-1 히트맵·RG-2 커브이동 즉시 갱신(역방향 포함) | ✓ 스모크(회사채·국고채 양방향: 히트맵·비교표 변화, 스프레드/금리 동기, 국고 하락=축소 매핑) |
| ② | 국고 섹터 밴드 소스 확인·명시 | ✓ §1(국고=금리축 ±4.6 동일 계열 → 금리 축 공유, UI 명시·단위테스트 고정) |
| ③ | 6섹터 정규화 개별 동작 + 미정규화면 확정 불가 | ✓ 스모크(공사채 warn→확정 비활성→정규화→활성) |
| ④ | 확정 스니펫에 sectors 포함 | ✓ 스모크(6섹터·국고/회사 sharedWith rate/spread·probs 합100·eDsBp) |
| ⑤ | 새로고침 후 작업본 복원 | ✓ 스모크(rg:draft 비공유 4섹터·국고채·회사채 키 없음) |

> ①의 커브이동 확인은 **구간별 비교표**로 판정: v2 셀이 전부 default일 때 byTenor(3Y)=평행(3Y)이라
> 3Y 단일 요약은 우연히 불변일 수 있으나, 나머지 7구간은 갱신됨(스모크가 비교표 전체 변화로 검증).

---

## 6. Phase 6 인계 노트

- RG-4 채점 원장: RG_LEDGER.scores 에 실현값 입력 → 자동 분류·채점.
  판정 기준 = RG_CALIB.bands(입력·채점 동일, §2). onoff-judge.js 순수 판정 패턴 준용.
- 지표: RG-1 최빈 셀 적중 / 축별 방향 적중 / Brier(9셀·섹터 3분류) / RG-2 순위 적중.
  섹터 채점은 rg-sector.js expectedDs·밴드 재사용, RG-2 순위 채점은 rolldownTable 재사용.
- 중첩 창(미결 4~5개) 만기 도래 순 채점 — 원장 judgments/scores 주차 키로 관리.

---

**정지.** Phase 5 완료, 커밋 준비 상태. **커밋·push 없음.** 다음 Phase 미진행.

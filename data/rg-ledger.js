// data/rg-ledger.js — RG 확정 원장(주간 판단 + 채점). 팀 공유·커밋 대상(§4).
// static 페이지는 repo 에 직접 쓸 수 없으므로 스니펫 방식:
//   RG-1 [확정] 버튼 → judgments 항목 1건 스니펫 생성 → 아래에 붙여넣기 → 커밋.
//   채점(RG-4, 후속 Phase)도 동일하게 scores 에 append.
// 로드: <script src="data/rg-ledger.js">. fetch·.json 미사용(repo 전역 관례).
//
// judgments[YYYY-Www] = { probs:{rate,spread}, mode, baseline, confirmedAt, ... }
//   재확정 시 같은 주차 키 최신값으로 교체(이력 미보존 — OO 패턴 정렬, §4).
// scores[YYYY-Www]    = { realized, metrics, scoredAt } (RG-4)
window.RG_LEDGER = { judgments: {}, scores: {} };

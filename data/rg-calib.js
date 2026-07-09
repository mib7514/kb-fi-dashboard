// data/rg-calib.js — RG 캘리브레이션 산출물 (tools/rg-calibration 오프라인 생성).
// 파생 통계값만: Δbp·σbp·표본수·소스레벨·메타. 원시 수익률/스프레드 레벨 없음(§0.3).
// 재생성: node tools/rg-calibration/run.mjs. 로드: <script src="data/rg-calib.js">.
window.RG_CALIB = {
  bands: {
    "ktb3y": {"sigmaBp":18.2,"bandBp":4.6,"n":3676},
    "repSpread": {"sigmaBp":8.9,"bandBp":2.2,"n":2811},
    sectors: {
      "국고채": {"sigmaBp":18.2,"bandBp":4.6,"n":3676},
      "공사채": {"sigmaBp":7.4,"bandBp":1.9,"n":2811},
      "은행채": {"sigmaBp":5.9,"bandBp":1.5,"n":2811},
      "회사채": {"sigmaBp":8.9,"bandBp":2.2,"n":2811},
      "카드채": {"sigmaBp":12.6,"bandBp":3.2,"n":2811},
      "여전채": {"sigmaBp":13.2,"bandBp":3.3,"n":2811}
    }
  },
  medianCurves: {
    tenors: ["3M","6M","1Y","1.5Y","2Y","2.5Y","3Y","5Y"],
    rows: {"down":977,"flat":852,"up":982},
    globalN: 2811,
    cells: {
      "down|narrow": {"n":201,"source":"cell","deltaBp":[-2.3,-3.9,-7.9,-9.4,-11,-11.3,-11.5,-14.8]},
      "down|flat": {"n":365,"source":"cell","deltaBp":[-3.9,-5.8,-8.3,-10.3,-10.5,-11.2,-11.5,-13.5]},
      "down|wide": {"n":411,"source":"cell","deltaBp":[-2.2,-4.5,-7.9,-9.8,-12.4,-13.3,-13.3,-15.5]},
      "flat|narrow": {"n":351,"source":"cell","deltaBp":[-0.5,-0.2,-0.1,-0.5,-0.1,0.1,0.5,0.4]},
      "flat|flat": {"n":330,"source":"cell","deltaBp":[-1.2,-1.6,-1.3,-0.9,-0.5,-0.5,0.2,1.2]},
      "flat|wide": {"n":171,"source":"cell","deltaBp":[0.4,2.3,2.2,1.7,-0.5,-1.9,-0.9,-0.2]},
      "up|narrow": {"n":289,"source":"cell","deltaBp":[0.4,1.6,6.4,9.7,12.2,12.7,13.6,13.8]},
      "up|flat": {"n":372,"source":"cell","deltaBp":[2.5,5.1,7.2,10.3,12.5,12.9,14,16.3]},
      "up|wide": {"n":321,"source":"cell","deltaBp":[5.7,7.4,11,13,13.7,15.9,17,20.8]}
    }
  },
  meta: {"k":0.25,"horizonMonths":1,"minCellN":30,"unit":"bp","rateAxis":"국고 3Y 수익률 1개월 Δ","spreadAxis":"회사채 AA- 3Y 스프레드 1개월 Δ","period":{"from":"2015-01-05","to":"2026-07-08"},"note":"파생 통계값만 — 원시 수익률·스프레드 레벨 미포함(§0.3)","generatedAt":"2026-07-09","source":{"curve":"Rg curve input.xlsx","sectors":"credit-spread"}}
};

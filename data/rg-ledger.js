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

window.RG_LEDGER.judgments["2026-W28"] = {
  "judgeDate": "2026-07-10",
  "probs": {
    "rate": {
      "down": 15,
      "flat": 75,
      "up": 10
    },
    "spread": {
      "narrow": 10,
      "flat": 75,
      "wide": 15
    }
  },
  "mode": {
    "cell": "flat|flat",
    "name": "중립·정체",
    "p": 56.3,
    "top2": 67.5
  },
  "baseline": {
    "bandKtb3yBp": 4.6,
    "bandRepSpreadBp": 2.2,
    "calib": "2015-01-05~2026-07-08"
  },
  "confirmedAt": "2026-07-10T07:22:14.388Z",
  "sectors": {
    "국고채": {
      "probs": {
        "narrow": 15,
        "flat": 75,
        "wide": 10
      },
      "mode": "shared-rate",
      "eDsBp": -0.2,
      "shared": true,
      "sharedWith": "rate"
    },
    "공사채": {
      "probs": {
        "narrow": 10,
        "flat": 75,
        "wide": 15
      },
      "mode": "follow",
      "eDsBp": 0.1
    },
    "은행채": {
      "probs": {
        "narrow": 10,
        "flat": 75,
        "wide": 15
      },
      "mode": "follow",
      "eDsBp": 0.1
    },
    "회사채": {
      "probs": {
        "narrow": 10,
        "flat": 75,
        "wide": 15
      },
      "mode": "shared-spread",
      "eDsBp": 0.1,
      "shared": true,
      "sharedWith": "spread"
    },
    "카드채": {
      "probs": {
        "narrow": 10,
        "flat": 75,
        "wide": 15
      },
      "mode": "follow",
      "eDsBp": 0.2
    },
    "여전채": {
      "probs": {
        "narrow": 10,
        "flat": 75,
        "wide": 15
      },
      "mode": "follow",
      "eDsBp": 0.2
    }
  },
  "rg2v2": {
    "mode": "anchor",
    "anchors": {
      "down": {
        "d3M": -2.8,
        "d3Y": -12.1
      },
      "flat": {
        "d3M": -0.4,
        "d3Y": -0.1
      },
      "up": {
        "d3M": 2.9,
        "d3Y": 14.9
      }
    },
    "curves": {
      "down": [
        -2.8,
        -5,
        -8.1,
        -10.3,
        -11.1,
        -11.8,
        -12.1,
        -14.5
      ],
      "flat": [
        -0.4,
        -0.4,
        -0.3,
        -0.3,
        -0.3,
        -0.3,
        -0.1,
        0.2
      ],
      "up": [
        2.9,
        5.3,
        8,
        11,
        13.1,
        13.8,
        14.9,
        17.3
      ]
    },
    "sources": {
      "down": [
        "default",
        "default",
        "default",
        "default",
        "default",
        "default",
        "default",
        "default"
      ],
      "flat": [
        "default",
        "default",
        "default",
        "default",
        "default",
        "default",
        "default",
        "default"
      ],
      "up": [
        "default",
        "default",
        "default",
        "default",
        "default",
        "default",
        "default",
        "default"
      ]
    },
    "w": 50
  },
  "rg2": {
    "version": "mixed",
    "topTenor": "5Y",
    "topReturnBp": 40,
    "w": 50,
    "eDy3YBp": -0.3,
    "carryRollBp": [
      23,
      28.1,
      33.4,
      33.6,
      34.4,
      33.8,
      34.3,
      38.5
    ]
  },
  "matrix": {
    "returnsBp": {
      "국고채": [
        23,
        28.3,
        33.8,
        34.3,
        35.3,
        34.9,
        35.3,
        40
      ],
      "공사채": [
        26.1,
        31.4,
        36.8,
        37.3,
        38.2,
        37.8,
        38.1,
        42.6
      ],
      "은행채": [
        26.1,
        31.3,
        36.8,
        37.3,
        38.2,
        37.8,
        38.1,
        42.7
      ],
      "회사채": [
        28.8,
        34.1,
        39.5,
        40,
        40.9,
        40.5,
        40.7,
        45.2
      ],
      "카드채": [
        28.1,
        33.3,
        38.8,
        39.2,
        40.1,
        39.6,
        39.9,
        44.3
      ],
      "여전채": [
        29.3,
        34.6,
        40,
        40.4,
        41.3,
        40.9,
        41.1,
        45.5
      ]
    },
    "carryRollBp": {
      "국고채": [
        23,
        28.1,
        33.4,
        33.6,
        34.4,
        33.8,
        34.3,
        38.6
      ],
      "공사채": [
        26.1,
        31.3,
        36.5,
        36.8,
        37.6,
        37,
        37.4,
        41.7
      ],
      "은행채": [
        26,
        31.2,
        36.5,
        36.7,
        37.5,
        36.9,
        37.3,
        41.6
      ],
      "회사채": [
        28.8,
        33.9,
        39.2,
        39.5,
        40.2,
        39.7,
        40.1,
        44.4
      ],
      "카드채": [
        28.1,
        33.2,
        38.5,
        38.8,
        39.5,
        39,
        39.4,
        43.7
      ],
      "여전채": [
        29.3,
        34.5,
        39.7,
        40,
        40.8,
        40.2,
        40.6,
        44.9
      ]
    },
    "topCell": {
      "sector": "여전채",
      "tenor": "5Y",
      "bp": 45.5
    },
    "spreadsUsed": {
      "국고채": 0,
      "공사채": 37.4,
      "은행채": 36.8,
      "회사채": 69.7,
      "카드채": 61.3,
      "여전채": 76.2
    },
    "basisDate": "2026-07-09"
  }
};

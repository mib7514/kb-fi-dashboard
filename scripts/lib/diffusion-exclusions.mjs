// ⚠️ 이식본 (PORTED) — 원본: Fenrir src/lib/inflation-diffusion/diffusion/exclusions.ts
//    기준 커밋: 1266dfc (+ 51c7abd). ex-energy 확산 시리즈용 에너지 제외 클러스터.
//    이 멤버십을 수정하면 반드시 Fenrir 원본과 동시 반영할 것 (두 레포의 멤버십은
//    코드 단위로 동일해야 함 — 드리프트 방지). TS→ESM 손이식, 데이터·구조 1:1.
//
// 동기(2026-06 CPI): 가중 ge2 확산 확대(74.4→75.6)의 상단이 에너지 y/y 잔존물로
//   확인됨. 에너지 직계(direct)+파급 2차(spillover)를 제외한 코어 확산(ex_energy)을
//   별도 판독 척도로 추가한다.
//
//  A. energy_direct    — 품목 가격 자체가 에너지 가격. 각국 공식 "Energy" 집계와 일치.
//  B. energy_spillover — 연료가 1차 비용 투입물인 운송·물류 서비스 (2차 파급).
//                        기준 = 전망모델 개선안 v2 개선 ③: 항공·시외운송·렌터카·배송.
//
// 경계 판정 근거(동결):
//  · 시내교통(SETG03 / DIMTRG)·택시(DTAXRG) → 제외 안 함 (intracity, CPI-PCE 대칭).
//  · 이사·화물(SEHP03 / DMSERG) → 제외 안 함 (v2 개선 ③ 범위 밖, 좁은 제외 원칙).
//  · 렌터카(SETA04 / DMVRRG) → 포함 (v2 개선 ③ 명시).
//  · 윤활유(DLUBRG)·해외여행 운임(DAFTRG) → 제외 안 함 (확정).
//
// 대상: US-CPI(BLS 136품목)·US-PCE(BEA 176품목)만. 타국(KR/EU/AU/JP)은 제외 테이블이
//   없어 ex_energy가 전체 가중 시리즈와 동일해진다(퇴화). calculator는 이 테이블을 읽기만.

/**
 * US-CPI (BLS CPI-U) 에너지 제외 목록.
 * energy_direct (6): BLS "Energy" 집계와 정확히 일치 (상품 4 + 서비스 2).
 * energy_spillover (4): 항공·시외운송·렌터카·배송 (v2 개선 ③).
 */
export const US_CPI_ENERGY_EXCLUSIONS = [
  // A. energy_direct (6)
  { code: 'SETB01', name: 'Gasoline (all types)', cluster: 'energy_direct' },
  { code: 'SETB02', name: 'Other motor fuels', cluster: 'energy_direct' },
  { code: 'SEHE01', name: 'Fuel oil', cluster: 'energy_direct' },
  { code: 'SEHE02', name: 'Propane, kerosene, and firewood', cluster: 'energy_direct' },
  { code: 'SEHF01', name: 'Electricity', cluster: 'energy_direct' },
  { code: 'SEHF02', name: 'Utility (piped) gas service', cluster: 'energy_direct' },
  // B. energy_spillover (4)
  { code: 'SETG01', name: 'Airline fares', cluster: 'energy_spillover' },
  { code: 'SETG02', name: 'Other intercity transportation', cluster: 'energy_spillover' },
  { code: 'SETA04', name: 'Car and truck rental', cluster: 'energy_spillover' },
  { code: 'SEEC02', name: 'Delivery services', cluster: 'energy_spillover' },
];

/**
 * US-PCE (BEA) 에너지 제외 목록. (라인번호는 U20404 기준)
 * energy_direct (5): BEA "Energy goods and services" (goods 3 + services 2).
 *   Lubricants and fluids(DLUBRG)는 BEA 에너지 정의 밖 → 제외 안 함.
 * energy_spillover (4): CPI 4종과 대칭 매핑.
 */
export const US_PCE_ENERGY_EXCLUSIONS = [
  // A. energy_direct (5)
  { code: 'DGASRG', name: 'Gasoline and other motor fuel', cluster: 'energy_direct' }, // L115
  { code: 'DOILRG', name: 'Fuel oil', cluster: 'energy_direct' },                       // L118
  { code: 'DLPFRG', name: 'Other fuels', cluster: 'energy_direct' },                    // L119
  { code: 'DELCRG', name: 'Electricity', cluster: 'energy_direct' },                    // L170
  { code: 'DGHERG', name: 'Natural gas', cluster: 'energy_direct' },                    // L171
  // B. energy_spillover (4) — CPI 대칭
  { code: 'DAITRG', name: 'Air transportation', cluster: 'energy_spillover' },              // L207 ~ SETG01
  { code: 'DORTRG', name: 'Other road transportation service', cluster: 'energy_spillover' }, // L206 ~ CPI SETG02 근사 매핑
  { code: 'DMVRRG', name: 'Motor vehicle rental', cluster: 'energy_spillover' },            // L197 ~ SETA04
  { code: 'DODSRG', name: 'Other delivery services', cluster: 'energy_spillover' },         // L288 ~ SEEC02
];

/** country → 제외 테이블. 정의 없는 국가는 undefined. */
const EXCLUSIONS_BY_COUNTRY = {
  'US-CPI': US_CPI_ENERGY_EXCLUSIONS,
  'US-PCE': US_PCE_ENERGY_EXCLUSIONS,
};

/**
 * 해당국 제외 품목 code 집합. 정의 없는 국가는 빈 집합.
 * calculator가 ex_energy 재정규화 분모를 만들 때 사용.
 */
export function exclusionCodeSet(country) {
  const table = EXCLUSIONS_BY_COUNTRY[country];
  return new Set(table ? table.map((e) => e.code) : []);
}

/** 해당국 제외 테이블(라벨 포함). 정의 없는 국가는 빈 배열. */
export function exclusionTable(country) {
  return EXCLUSIONS_BY_COUNTRY[country] ?? [];
}

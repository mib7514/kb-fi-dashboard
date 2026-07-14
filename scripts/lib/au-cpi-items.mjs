// ⚠️ 이식본 (PORTED) — 원본: Fenrir src/lib/inflation-diffusion/fetchers/au-cpi-items.ts
//    기준 커밋: a242949 (mib7514/fenrir HEAD, 2026-07-14 clone)
//    이 파일의 데이터·상수·방법론 수정 시 반드시 Fenrir 원본과 동시 반영할 것.
//    (이중 구현 드리프트 방지 — 한쪽만 고치면 확산지수가 조용히 갈라짐.)
//    TS→ESM 기계 변환(타입 주석 제거)만 적용. 데이터 값은 원본과 동일.



export const AU_HEADLINE_INDEX = '10001';                  // All groups CPI (monthly)
export const AU_QUARTERLY_HEADLINE_INDEX = '999901';       // All groups CPI, seasonally adjusted (quarterly)
export const AU_CORE_INTL_INDEX = '131197';                // All groups CPI excluding food and energy (monthly only)
export const AU_TRIMMED_MEAN_INDEX = '999902';             // Quarterly only — RBA core
export const AU_REGION = '50';                             // Weighted avg of 8 capital cities (~national)
export const AU_RATE_DATAFLOW = 'CPI';                     // v2.0.0
export const AU_WEIGHT_DATAFLOW = 'CPI_WEIGHTS';           // v1.0.0
export const AU_QUARTERLY_DATAFLOW = 'CPI_Q';              // v1.0.0 (Trimmed Mean + EC index levels)
export const AU_TSEST_ORIGINAL = '10';                     // Original (monthly CPI ECs)
export const AU_TSEST_SA = '20';                           // Seasonally Adjusted (CPI_Q only exposes this)
export const AU_FREQ_MONTHLY = 'M';
export const AU_FREQ_QUARTERLY = 'Q';
export const AU_MEASURE_INDEX = '1';                       // Index Numbers (only measure for ECs in CPI_Q)
export const AU_MEASURE_YOY = '3';                         // Pct change from prior year/corresponding quarter

export const AU_CPI_ITEMS = [
  { code: "114121", name: "Fruit" },
  { code: "114122", name: "Vegetables" },
  { code: "1144", name: "Other financial services" },
  { code: "115484", name: "Small electric household appliances" },
  { code: "115485", name: "Glassware, tableware and household utensils" },
  { code: "115495", name: "Preschool and primary education" },
  { code: "115496", name: "Secondary education" },
  { code: "115497", name: "Tertiary education" },
  { code: "115498", name: "Child care" },
  { code: "115500", name: "Other household services" },
  { code: "115501", name: "Snacks and confectionery" },
  { code: "115520", name: "Waters, soft drinks and juices" },
  { code: "115524", name: "Gas and other household fuels" },
  { code: "115529", name: "Insurance" },
  { code: "131178", name: "Pork" },
  { code: "131183", name: "Household textiles" },
  { code: "131185", name: "Carpets and other floor coverings" },
  { code: "131190", name: "Audio, visual and computing media and services" },
  { code: "131192", name: "Newspapers, magazines and stationery" },
  { code: "131194", name: "Deposit and loan facilities (direct charges)" },
  { code: "30014", name: "Rents" },
  { code: "40001", name: "Milk" },
  { code: "40002", name: "Cheese" },
  { code: "40004", name: "Ice cream and other dairy products" },
  { code: "40005", name: "Bread" },
  { code: "40006", name: "Cakes and biscuits" },
  { code: "40007", name: "Breakfast cereals" },
  { code: "40008", name: "Other cereal products" },
  { code: "40009", name: "Beef and veal" },
  { code: "40010", name: "Lamb and goat" },
  { code: "40012", name: "Poultry" },
  { code: "40014", name: "Other meats" },
  { code: "40015", name: "Fish and other seafood" },
  { code: "40025", name: "Restaurant meals" },
  { code: "40026", name: "Take away and fast foods" },
  { code: "40027", name: "Eggs" },
  { code: "40029", name: "Jams, honey and spreads" },
  { code: "40030", name: "Coffee, tea and cocoa" },
  { code: "40034", name: "Other food products n.e.c." },
  { code: "40045", name: "Footwear for men" },
  { code: "40046", name: "Footwear for women" },
  { code: "40047", name: "Footwear for infants and children" },
  { code: "40048", name: "Cleaning, repair and hire of clothing and footwear" },
  { code: "40053", name: "Maintenance and repair of the dwelling" },
  { code: "40055", name: "Electricity" },
  { code: "40058", name: "Furniture" },
  { code: "40060", name: "Major household appliances" },
  { code: "40066", name: "Tools and equipment for house and garden" },
  { code: "40067", name: "Cleaning and maintenance products" },
  { code: "40072", name: "Veterinary and other services for pets" },
  { code: "40073", name: "Pets and related products" },
  { code: "40077", name: "Postal services" },
  { code: "40078", name: "Telecommunication equipment and services" },
  { code: "40080", name: "Motor vehicles" },
  { code: "40081", name: "Automotive fuel" },
  { code: "40083", name: "Other services in respect of motor vehicles" },
  { code: "40084", name: "Spare parts and accessories for motor vehicles" },
  { code: "40085", name: "Maintenance and repair of motor vehicles" },
  { code: "40086", name: "Urban transport fares" },
  { code: "40087", name: "Beer" },
  { code: "40088", name: "Wine" },
  { code: "40089", name: "Spirits" },
  { code: "40090", name: "Tobacco" },
  { code: "40091", name: "Medical and hospital services" },
  { code: "40092", name: "Therapeutic appliances and equipment" },
  { code: "40093", name: "Dental services" },
  { code: "40094", name: "Pharmaceutical products" },
  { code: "40095", name: "Personal care products" },
  { code: "40096", name: "Hairdressing and personal grooming services" },
  { code: "40098", name: "Audio, visual and computing equipment" },
  { code: "40101", name: "Domestic holiday travel and accommodation" },
  { code: "40102", name: "International holiday travel and accommodation" },
  { code: "97549", name: "Food additives and condiments" },
  { code: "97550", name: "Oils and fats" },
  { code: "97551", name: "Garments for men" },
  { code: "97554", name: "Garments for women" },
  { code: "97555", name: "Garments for infants and children" },
  { code: "97557", name: "Accessories" },
  { code: "97558", name: "Water and sewerage" },
  { code: "97559", name: "New dwelling purchase by owner-occupiers" },
  { code: "97560", name: "Property rates and charges" },
  { code: "97564", name: "Other non-durable household products" },
  { code: "97567", name: "Books" },
  { code: "97571", name: "Equipment for sports, camping and open-air recreation" },
  { code: "97572", name: "Games, toys and hobbies" },
  { code: "97573", name: "Sports participation" },
  { code: "97574", name: "Other recreational, sporting and cultural services" },
];

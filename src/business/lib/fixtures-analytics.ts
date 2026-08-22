// PLAY-PHASE fixtures for 売上分析 — the 精算 ledger planes the booking
// calendar cannot express on its own.
//
// 売上分析 reads the settlement record (canon's own footnote: 「どの数値も
// 売上・レジ の精算記録から導出。」). 売上・レジ is 準備中, and core exposes no
// monthly aggregate at all, so the trailing-12-month ledger lives here as its
// own typed rows — the same shape fixtures-today.ts uses for the planes core
// has no surface for.
//
// TWO RULES THIS FILE OBEYS, both of them the lane's:
//
// 1. RELATIVE MONTHS (⚖ L-6). No row carries a date. A row is keyed by
//    `months_ago` (0 = the month the reader is standing in), so the ledger is
//    populated in any real month and the current month is always the partial
//    one. Labels are formatted from the render anchor in the page.
//
// 2. NO IMPOSSIBLE STATES (⚖ 8/9, demo-data-product-truth). A month's 新規売上,
//    回収売上 and 消化売上 are each a SUBSET of its 総合売上; visit counts are
//    positive; rates sit in 0–1. Every one of those is asserted in
//    src/__tests__/integration/business/analytics.test.ts over every row, so an
//    edit that breaks one goes red rather than reaching a screen.
//
// WHAT IS NOT HERE, because it is DERIVED from rows that already exist:
//   · the day-by-day ledger — distributed across the month's open days from the
//     row below (src/business/lib/analytics.ts), so the days always sum to the
//     month exactly
//   · TODAY's row — read from the appointment world, so 日報 and the 今日の運営
//     board can never disagree about what today earned
//   · 回数券 未消化残 — the customers' own 残数 at the store's 基準価格
//   · the staff ranking's numbers — this file states only each person's SHARE

import { STORE_A, STORE_B } from './fixtures'

/** One store-month of the settlement ledger. Money is yen; rates are 0–1.
 *  `months_ago` 0 is the month in progress — the only PARTIAL row, and the one
 *  the screen must never present as finished. */
export interface FixtureMonthlySales {
  store_id: string
  months_ago: number
  /** 総合売上. For `months_ago: 0` this is the month's FULL-MONTH figure, from
   *  which only the elapsed days are ever shown (analytics.ts) — a stated
   *  month-to-date constant would be wrong on every day but one. */
  total: number
  /** 新規売上 — the part of `total` from customers with no completed visit. */
  nw: number
  /** 回収売上 — the part of `total` settled in the month. */
  collected: number
  /** 消化売上 — the part of `total` taken as 回数券 consumption. */
  consumed: number
  /** 新規数 / 既存数 — visits, not bookings. */
  new_count: number
  existing_count: number
  next_rate: number
  repeat_rate: number
  util: number
  ltv: number
  new_ltv: number
}

/** The trailing 12 months, newest first per store. テスト銀座店 is the busy
 *  store (three treatment beds, five practitioners); テスト代官山店 runs at
 *  roughly 40% of it on one bed and three practitioners — the same shape at a
 *  smaller scale, so switching the store lens changes every number on the page
 *  rather than repainting one store's figures under another store's name. */
export const salesLedger: FixtureMonthlySales[] = [
  { store_id: STORE_A, months_ago: 0,  total: 1700000, nw: 570000, collected: 580000, consumed: 490000, new_count: 95,  existing_count: 176, next_rate: .66, repeat_rate: .62, util: .76, ltv: 48500, new_ltv: 24000 },
  { store_id: STORE_A, months_ago: 1,  total: 1650000, nw: 555000, collected: 560000, consumed: 475000, new_count: 93,  existing_count: 170, next_rate: .65, repeat_rate: .61, util: .75, ltv: 47000, new_ltv: 23600 },
  { store_id: STORE_A, months_ago: 2,  total: 1600000, nw: 545000, collected: 545000, consumed: 460000, new_count: 92,  existing_count: 163, next_rate: .64, repeat_rate: .60, util: .73, ltv: 45500, new_ltv: 23200 },
  { store_id: STORE_A, months_ago: 3,  total: 1560000, nw: 540000, collected: 530000, consumed: 445000, new_count: 91,  existing_count: 158, next_rate: .62, repeat_rate: .58, util: .71, ltv: 44000, new_ltv: 22800 },
  { store_id: STORE_A, months_ago: 4,  total: 1510000, nw: 530000, collected: 510000, consumed: 425000, new_count: 90,  existing_count: 151, next_rate: .60, repeat_rate: .56, util: .69, ltv: 42500, new_ltv: 22300 },
  { store_id: STORE_A, months_ago: 5,  total: 1450000, nw: 520000, collected: 490000, consumed: 405000, new_count: 88,  existing_count: 143, next_rate: .58, repeat_rate: .54, util: .67, ltv: 41000, new_ltv: 21800 },
  { store_id: STORE_A, months_ago: 6,  total: 1380000, nw: 505000, collected: 465000, consumed: 385000, new_count: 86,  existing_count: 134, next_rate: .56, repeat_rate: .51, util: .64, ltv: 39000, new_ltv: 21000 },
  // 年始の谷 — the January dip every salon has, kept so the trend is a real
  // shape rather than a straight line nobody has to read.
  { store_id: STORE_A, months_ago: 7,  total: 1290000, nw: 480000, collected: 430000, consumed: 355000, new_count: 82,  existing_count: 124, next_rate: .53, repeat_rate: .48, util: .60, ltv: 37000, new_ltv: 20200 },
  // 年末の山.
  { store_id: STORE_A, months_ago: 8,  total: 1680000, nw: 640000, collected: 570000, consumed: 450000, new_count: 104, existing_count: 164, next_rate: .55, repeat_rate: .46, util: .70, ltv: 35000, new_ltv: 19500 },
  { store_id: STORE_A, months_ago: 9,  total: 1420000, nw: 575000, collected: 480000, consumed: 375000, new_count: 96,  existing_count: 131, next_rate: .52, repeat_rate: .42, util: .62, ltv: 32000, new_ltv: 18400 },
  { store_id: STORE_A, months_ago: 10, total: 1310000, nw: 560000, collected: 440000, consumed: 340000, new_count: 94,  existing_count: 115, next_rate: .49, repeat_rate: .38, util: .56, ltv: 29000, new_ltv: 17100 },
  { store_id: STORE_A, months_ago: 11, total: 1240000, nw: 545000, collected: 410000, consumed: 310000, new_count: 92,  existing_count: 106, next_rate: .46, repeat_rate: .35, util: .52, ltv: 26000, new_ltv: 16000 },

  { store_id: STORE_B, months_ago: 0,  total: 680000, nw: 228000, collected: 232000, consumed: 196000, new_count: 38, existing_count: 70, next_rate: .58, repeat_rate: .54, util: .68, ltv: 41000, new_ltv: 20500 },
  { store_id: STORE_B, months_ago: 1,  total: 660000, nw: 222000, collected: 224000, consumed: 190000, new_count: 37, existing_count: 68, next_rate: .57, repeat_rate: .53, util: .67, ltv: 39800, new_ltv: 20100 },
  { store_id: STORE_B, months_ago: 2,  total: 640000, nw: 218000, collected: 218000, consumed: 184000, new_count: 37, existing_count: 65, next_rate: .56, repeat_rate: .52, util: .65, ltv: 38500, new_ltv: 19700 },
  { store_id: STORE_B, months_ago: 3,  total: 624000, nw: 216000, collected: 212000, consumed: 178000, new_count: 36, existing_count: 63, next_rate: .54, repeat_rate: .50, util: .63, ltv: 37200, new_ltv: 19300 },
  { store_id: STORE_B, months_ago: 4,  total: 604000, nw: 212000, collected: 204000, consumed: 170000, new_count: 36, existing_count: 60, next_rate: .52, repeat_rate: .48, util: .61, ltv: 35900, new_ltv: 18900 },
  { store_id: STORE_B, months_ago: 5,  total: 580000, nw: 208000, collected: 196000, consumed: 162000, new_count: 35, existing_count: 57, next_rate: .50, repeat_rate: .46, util: .59, ltv: 34600, new_ltv: 18400 },
  { store_id: STORE_B, months_ago: 6,  total: 552000, nw: 202000, collected: 186000, consumed: 154000, new_count: 34, existing_count: 54, next_rate: .48, repeat_rate: .44, util: .56, ltv: 32900, new_ltv: 17700 },
  { store_id: STORE_B, months_ago: 7,  total: 516000, nw: 192000, collected: 172000, consumed: 142000, new_count: 33, existing_count: 50, next_rate: .45, repeat_rate: .41, util: .53, ltv: 31200, new_ltv: 17000 },
  { store_id: STORE_B, months_ago: 8,  total: 672000, nw: 256000, collected: 228000, consumed: 180000, new_count: 42, existing_count: 66, next_rate: .47, repeat_rate: .39, util: .62, ltv: 29500, new_ltv: 16400 },
  { store_id: STORE_B, months_ago: 9,  total: 568000, nw: 230000, collected: 192000, consumed: 150000, new_count: 38, existing_count: 52, next_rate: .44, repeat_rate: .35, util: .54, ltv: 27000, new_ltv: 15500 },
  { store_id: STORE_B, months_ago: 10, total: 524000, nw: 224000, collected: 176000, consumed: 136000, new_count: 38, existing_count: 46, next_rate: .42, repeat_rate: .32, util: .48, ltv: 24500, new_ltv: 14400 },
  { store_id: STORE_B, months_ago: 11, total: 496000, nw: 218000, collected: 164000, consumed: 124000, new_count: 37, existing_count: 42, next_rate: .40, repeat_rate: .30, util: .44, ltv: 22000, new_ltv: 13500 },
]

/** ⚠SETTINGS-BATCH — 月間売上目標, per store. Canon's own strip carries the
 *  trace 「目標は設定で店舗・スタッフ別に変更」, so the number is a store's dial
 *  and lives as DATA: a screen that hardcoded ¥2,000,000 would make every store
 *  the same store. The 店舗設定 control ships with the settings batch (named in
 *  the build report's registry lines); per-staff targets are part of that same
 *  control and are not modelled here. */
export const salesTargets: Record<string, number> = {
  [STORE_A]: 2000000,
  [STORE_B]: 800000,
}

/** Each practitioner's SHARE of a store's month, per ranking metric. Integers,
 *  normalised at use — the amounts themselves are distributed off the month row
 *  with largest-remainder (analytics.ts), so every staff column sums back to
 *  the store figure exactly and a ranking table can never total to something
 *  the trend table disagrees with.
 *
 *  The four revenue vectors are deliberately DIFFERENT orders, because that is
 *  the whole job of the 指標 switch: the person who bills the most 総合売上 is
 *  not the person who burns the most 回数券. `ltv_factor` is a multiplier on
 *  the store's LTV rather than a share, since LTV is an average, not a total.
 *
 *  Reception (受付・会計 only — p-09) is absent on purpose: someone who takes no
 *  treatments is never a candidate in a treatment-revenue ranking, and their
 *  absence must come from the roster's own 資格, which is what
 *  `treatsPatients()` reads. */
export interface FixtureStaffMix {
  store_id: string
  staff_id: string
  total: number
  consumed: number
  existing: number
  nw: number
  ltv_factor: number
}

export const staffMix: FixtureStaffMix[] = [
  { store_id: STORE_A, staff_id: 'p-01', total: 24, consumed: 18, existing: 26, nw: 21, ltv_factor: 1.08 },
  { store_id: STORE_A, staff_id: 'p-04', total: 22, consumed: 21, existing: 19, nw: 25, ltv_factor: 1.14 },
  { store_id: STORE_A, staff_id: 'p-05', total: 19, consumed: 24, existing: 17, nw: 22, ltv_factor: 0.89 },
  { store_id: STORE_A, staff_id: 'p-06', total: 21, consumed: 20, existing: 23, nw: 18, ltv_factor: 1.02 },
  { store_id: STORE_A, staff_id: 'c-03', total: 14, consumed: 17, existing: 15, nw: 14, ltv_factor: 0.95 },
  { store_id: STORE_B, staff_id: 'p-02', total: 38, consumed: 31, existing: 41, nw: 33, ltv_factor: 1.10 },
  { store_id: STORE_B, staff_id: 'p-05', total: 34, consumed: 38, existing: 30, nw: 40, ltv_factor: 0.94 },
  { store_id: STORE_B, staff_id: 'c-03', total: 28, consumed: 30, existing: 29, nw: 27, ltv_factor: 1.01 },
]

/** 売上の内訳 — メニュー別 and 予約経路別 shares of a month, per store.
 *  Weights, distributed off the month's own 総合売上 so the segments sum back
 *  to the figure the target strip shows. Menu rows name a real menu id from
 *  ./fixtures (the label is read from the menu, never restated here); その他 is
 *  the neutral remainder bucket, not a fourth menu. */
export interface FixtureMix {
  store_id: string
  /** A menu id from ./fixtures, or null for the その他 remainder. */
  menu_id: string | null
  weight: number
}

export const menuMix: FixtureMix[] = [
  { store_id: STORE_A, menu_id: 'menu-01', weight: 42 },
  { store_id: STORE_A, menu_id: 'menu-02', weight: 24 },
  { store_id: STORE_A, menu_id: 'menu-03', weight: 16 },
  { store_id: STORE_A, menu_id: null, weight: 18 },
  { store_id: STORE_B, menu_id: 'menu-04', weight: 46 },
  { store_id: STORE_B, menu_id: 'menu-05', weight: 30 },
  { store_id: STORE_B, menu_id: 'menu-06', weight: 12 },
  { store_id: STORE_B, menu_id: null, weight: 12 },
]

/** 予約経路別. The buckets are the app's own booking-source vocabulary
 *  (./fixtures `source`), not canon's two-way split: 外部予約元 is a real source
 *  in this world and folding it into 電話・店頭 would name it as something it
 *  is not. */
export interface FixtureSourceMix {
  store_id: string
  label: string
  weight: number
}

export const sourceMix: FixtureSourceMix[] = [
  { store_id: STORE_A, label: 'Reserve', weight: 54 },
  { store_id: STORE_A, label: '電話・店頭', weight: 36 },
  { store_id: STORE_A, label: '外部予約元', weight: 10 },
  { store_id: STORE_B, label: 'Reserve', weight: 48 },
  { store_id: STORE_B, label: '電話・店頭', weight: 44 },
  { store_id: STORE_B, label: '外部予約元', weight: 8 },
]

/** ⚠SETTINGS-BATCH — 売上分析の閲覧権限. Canon gates the whole page to owner or
 *  店舗管理者 and shows a staff member their own lane instead. WHO may see the
 *  store's money is a store's judgement about its own people, so it is data for
 *  the same reason the board's 上書き権限 is (fixtures-today `overridePolicy`) —
 *  a component that hardcoded a role would make every store the same store.
 *  Fable default, OVERTURNABLE; the 店舗設定 control ships with the settings
 *  batch. */
export const analyticsPolicy = {
  /** 店舗全体の売上とスタッフ別の内訳を見られる役職. */
  viewRoles: ['オーナー', '店舗管理者'] as readonly string[],
}

/** Day-of-week weight for spreading a month across its open days — canon's own
 *  curve (weekends busy, midweek quiet), indexed by `Date#getDay`. The 定休日
 *  comes from the store's own calendar (fixtures-today `closedWeekday`) and is
 *  given weight 0 there, so a closed day can never be allocated a yen. */
export const dowWeight: Record<number, number> = {
  0: 1.35, 1: 0.78, 2: 0.86, 3: 0.92, 4: 0.95, 5: 1.22, 6: 1.45,
}

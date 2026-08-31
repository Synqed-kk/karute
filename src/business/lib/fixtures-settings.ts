// 設定 — THE DIAL PLANE, AND IT IS ADD-ONLY.
//
// This file states a dial's value ONLY when no other plane in this world states
// it already. Every dial the rooms have shipped keeps its existing home and the
// 設定 room READS it there:
//
//   · スキマガード / 厳しさ           → fixtures-today `storeBookingPolicy.gapGuardMode`
//   · 「置けない」場所への上書き権限   → fixtures-today `storeBookingPolicy.overridePolicy`
//   · 予約の移動単位 / ブロックの刻み  → fixtures-today `opsConfig.bookingStepMin` / `.blockStepMin`
//   · 販売可能な最小の長さ            → fixtures-today `opsConfig.minSellableMin`
//   · 現金差異の承認しきい値          → fixtures-register `cashTolerance` / `MAX_CASH_TOLERANCE`
//
// ⚠ THAT RULE IS THE WHOLE POINT OF THE ROOM. A settings page that carried its
// own copy of a store's dial would be the second home the ⚖ one-truth law
// forbids, and the copy would be the one the reader believes — a page that says
// 「15分」 while the board snaps to 30 is worse than a page that says nothing.
// The suite pins the rule both ways: nothing below re-states a world value, and
// every store dial the screen renders traces to a plane read.
//
// WHAT IS BELOW, THEREFORE, IS ONLY THE DIALS WITH NOWHERE ELSE TO LIVE — the
// settings-batch registry lines that no shipped room owns a value for. Each one
// carries the mistake-proofing law's THREE parts (⚖ Liam 8/21): the DEFAULT, the
// GUARDRAIL that stops a store harming itself with it, and the業種 (business
// type) note where a ruling actually gave one. A dial with no ruled type default
// says so rather than inventing one.
//
// NO ABSOLUTE DATES, NO CLOCK, NO DERIVATION (⚖ L-6 and the plane law): values
// only. The rules that read them live in `settings.ts`.

import { STORE_A, STORE_B } from './fixtures'

/** 文字起こしの公開範囲 (dial #16). ⚖ Liam 8/30 D3: per-business, and the SAFE
 *  default is private — 「If they are private, only the staff can see it」.
 *  Enforcement is SERVER-side at the data door; the 録音 room states the same
 *  fact in words (`TRANSCRIPT_POLICY_LINE`) and decides nothing itself. */
export type TranscriptVisibility = 'staff-only' | 'managers-too'

/** コーチングの共有の方針 (dial #21). `manager-grant` = a staff member may grant
 *  their manager the deeper view, one person at a time; `peer` additionally
 *  opens the double-consent peer share. Neither is ON for anybody by default —
 *  the grant is always the staff member's own (room 8's anti-coercion wall). */
export type CoachingSharingMode = 'manager-grant' | 'peer'

export interface StoreDials {
  /** 休憩の有給扱い (dial #11). FALSE = 休憩は無給, which is what 人件費 prices
   *  today (`shifts.ts laborCost` × `workedMinutes`, breaks excluded).
   *  GUARDRAIL: this dial moves a MONEY figure, so it is gated to the same roles
   *  人件費 itself is (`fixtures-shifts.shiftsPolicy.laborCostRoles`) and can
   *  never be changed by a reader who cannot see the number it changes.
   *  業種 (map row #11): most salons pay breaks unpaid; a shop on fixed shifts
   *  usually pays them. */
  breaksPaid: boolean
  /** 動的価格 (dial #4). The store-wide master canon's 料金・ポイント page carries
   *  (`dynSwitch`).
   *  ⚠ FALSE HERE IS THE TRUTH, NOT A PREFERENCE: no store-wide master exists in
   *  the product yet. 今日の運営's 販売可能枠の表示 is a PER-VIEWER display choice
   *  and the discount depth is derived from the price list, not from a dial. The
   *  row says so; nothing on the board changes when this value does.
   *  GUARDRAIL: the curve's depth is capped by `CURVE_MAX_DIP` in
   *  canon-logic/pricing.ts so a store cannot discount past its own floor. */
  dynamicPricing: boolean
  /** 文字起こしの公開範囲 (dial #16). DEFAULT = private.
   *  GUARDRAIL: staff always see the store's current mode before they record, and
   *  a change is 監査-logged. 業種: none ruled — privacy is not a business type. */
  transcriptVisibility: TranscriptVisibility
  /** 再来促しの日数しきい値 (dial #14). ⚖ Liam 8/23: one value, two doors.
   *  MIRRORED BY SHAPE from the phone's own constant — `REENGAGE_NUDGE_MIN_DAYS`
   *  (src/lib/karute/ai-reengagement.ts:41) — with a cite rather than an import,
   *  because Business territory may not import phone runtime. At reconnect the
   *  single core value replaces both.
   *  GUARDRAIL: `clampWinBackDays` holds it inside 14…365 — under two weeks the
   *  nudge reaches customers who are simply not due yet, and past a year it
   *  reaches people who have moved away.
   *  業種: ruled type-dependent by Liam (a 整体 cycle is not a hair cycle). */
  winBackDays: number
  /** コーチングの利用 (dial #20) — `org_settings.coaching_enabled`, per store. */
  coachingEnabled: boolean
  /** コーチングの共有の方針 (dial #21). */
  coachingSharing: CoachingSharingMode
  /** コーチングの記録の保存期間, months (dial #22).
   *  GUARDRAIL: `clampCoachingRetention` holds it inside 3…36 months. */
  coachingRetentionMonths: number
  /** 判断に必要なセッション数 (dial #23 — minted by room 9, see the build report).
   *  Room 8's own floor for showing a band at all.
   *  GUARDRAIL: `clampCoachingFloor` holds it inside 10…60 — a store cannot set
   *  it to 1 and turn a coin flip into a verdict about a person, nor to 500 and
   *  switch the board off by the back door. */
  coachingSampleFloor: number
  /** 表示言語 (dial #24 — minted by room 9). ⚖ Liam 8/31, ALL SYNQED products:
   *  every product follows the phone and is changeable in settings. Business is a
   *  RETROFIT round; this room ships the lever honestly disconnected. */
  displayLanguage: string
}

/** ⚠ ONE HOME AT MERGE — READ THIS BEFORE RESOLVING A CONFLICT.
 *  `coachingEnabled` and `coachingSampleFloor` are the same two facts room 8's
 *  branch states as `fixtures-coaching.coachingStores` and `coaching.FLOOR_DEFAULT`.
 *  Room 8 is NOT on this room's base (both branch from `ab8fec28`), so this plane
 *  states them for the room that owns their controls. Whichever branch lands
 *  SECOND deletes its own copy and reads the other's — the 設定 room reads room
 *  8's list, or room 8 reads this one. Two copies must not survive a merge. */
export const storeDials: Record<string, StoreDials> = {
  [STORE_A]: {
    breaksPaid: false,
    dynamicPricing: false,
    transcriptVisibility: 'staff-only',
    winBackDays: 61,
    coachingEnabled: true,
    coachingSharing: 'manager-grant',
    coachingRetentionMonths: 12,
    coachingSampleFloor: 20,
    displayLanguage: 'ja',
  },
  // ⚠ A SECOND STORE THAT DIFFERS, DELIBERATELY. A demo world where both stores
  // hold identical dials cannot show the reader that these are PER-STORE values,
  // and it would let a store-clamp defect pass every screenshot (the ⚖ 8/17
  // isolation law's own test shape). 代官山 has coaching switched off and a
  // longer win-back cycle.
  [STORE_B]: {
    breaksPaid: true,
    dynamicPricing: false,
    transcriptVisibility: 'staff-only',
    winBackDays: 90,
    coachingEnabled: false,
    coachingSharing: 'manager-grant',
    coachingRetentionMonths: 12,
    coachingSampleFloor: 20,
    displayLanguage: 'ja',
  },
}

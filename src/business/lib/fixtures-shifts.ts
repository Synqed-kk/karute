// PLAY-PHASE fixtures for スタッフ・シフト — the THREE facts the shift room
// needs that no other plane in this world carries.
//
// EVERYTHING ELSE IS BORROWED, NOT RESTATED. The roster's working hours and
// breaks are `fixtures-today.shifts` (its own header: "one row per staff
// member, applied to every day the store is open"), the 勤務不可 is
// `fixtures-today.absence`, the 定休日 is `fixtures-today.closedWeekday`, the
// day's bookings are `fixtures.appointments`, and the 欠勤影響 counts are the
// board's own 次に決めること rows. The month board and the 今日の運営 board are
// therefore ONE WORLD by construction rather than by agreement: there is no
// second copy of a shift to drift from the first.
//
// NO ABSOLUTE DATES (⚖ L-6). A leave request is stated as "the first eligible
// day from N days out", never as a calendar date, so the room is populated on
// any real date and a request can never land on a 定休日 or on a day its owner
// is off. The resolution lives in `shifts.ts`, next to the calendar it needs.

/** 時給 (⚠SETTINGS-BATCH — 人件費レート, per staff). Canon's card carries the
 *  trace 「時給レートは設定・店長のみ表示」, i.e. the rate is a store setting and
 *  a gated one. It is DATA here for the mistake-proofing reason every other
 *  dial in this world is: a component that hardcoded a wage would make every
 *  store the same store. The 店舗設定 control ships with the settings batch;
 *  these are Fable defaults and OVERTURNABLE.
 *
 *  Keys are the roster ids that hold a shift row in fixtures-today. A person
 *  with no shift row (p-09) has no scheduled hours, so no wage to apply. */
export const hourlyWage: Record<string, number> = {
  'p-01': 1600,
  'p-02': 1400,
  'c-03': 1300,
  'p-04': 1500,
  'p-05': 1500,
  'p-06': 1700,
}

/** ⚠SETTINGS-BATCH — who may see 人件費 and who may answer a 希望休.
 *  Same shape as the board's `opsConfig.overridePolicy`: a store's judgement
 *  about its own people, stated as data so no component decides it. Fable
 *  defaults, OVERTURNABLE; the 店舗設定 controls ship with the settings batch. */
export const shiftsPolicy = {
  /** 人件費 概算 — canon gates it to 店長 (「時給レートは設定・店長のみ表示」). */
  laborCostRoles: ['オーナー', '店舗管理者'] as readonly string[],
  /** 希望休の承認 — the answer that changes someone's month. */
  leaveApprovalRoles: ['オーナー', '店舗管理者'] as readonly string[],
}

/** 希望休の申請 — the plane canon calls PENDING_REQUESTS.
 *
 *  `fromDayOffset` is a FLOOR, not a date: `shifts.ts` walks forward from it to
 *  the first day the store is open and the requester is otherwise scheduled, so
 *  a request is never filed on a 定休日 or on the requester's own day off (both
 *  would be the impossible state ⚖ 8/9 forbids, and both would happen on some
 *  real dates if these were fixed offsets).
 *
 *  `overlapsBooking` picks WHICH kind of day: the 8/9 rule allows a deliberate
 *  conflict when the conflict is exactly the surface a warning exists to show,
 *  and 「この人はその日、予約を担当しています」 is the one judgement a manager
 *  answering a 希望休 must not be allowed to miss. The room refuses that
 *  approval with its reason rather than staging a hole in the day.
 *
 *  Both requesters work ONE store (p-04 → c-04 → 銀座, and c-03 is floating so
 *  her request is her own wherever she is read). A conflict with a booking a
 *  clamped viewer cannot see would have to be explained by naming another
 *  store's day, which the isolation law forbids — so no requester here has one. */
export interface FixtureLeaveRequest {
  staff_id: string
  fromDayOffset: number
  overlapsBooking: boolean
  reason: string
}

export const leaveRequests: FixtureLeaveRequest[] = [
  { staff_id: 'c-03', fromDayOffset: 5, overlapsBooking: false, reason: '私用' },
  // DELIBERATE CONFLICT (⚖ 8/9 exception, commented as required): this one
  // lands on a day its owner is already the assigned 担当, so the approval
  // surface has a real refusal to make.
  { staff_id: 'p-04', fromDayOffset: 2, overlapsBooking: true, reason: '通院' },
]

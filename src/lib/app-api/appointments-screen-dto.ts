// Appointments (予約) screen DTO — the Bearer twin of what the web page
// assembles server-side (design-parity P-B): the day agenda's server-derived
// ReservationViews (tombstones included), the store-lensed staff pickers, and
// the week/month projections. Coarse and screen-shaped like every screens/*
// DTO: the thin screen renders AppointmentsView from this verbatim.
//
// Month cells carry `dateIso` (string) — MonthGridCell's `date: Date` does
// not survive JSON; the thin screen revives it before handing to the view.

import { z } from 'zod'

export const ReservationViewDTO = z.object({
  id: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  startTimeHm: z.string(),
  durationMin: z.number(),
  customerName: z.string(),
  customerInitials: z.string(),
  karuteNumber: z.string().nullable(),
  service: z.string(),
  displayStatus: z.enum(['booked', 'in_session', 'completed', 'new']),
  isCancelled: z.boolean(),
  isNoShow: z.boolean(),
  statusReason: z.string().nullable(),
  statusSetByName: z.string().nullable(),
  statusSetAt: z.string().nullable(),
  // Validated shape-level; the view's strict StaffColorKey union is a
  // superset of what the schema accepts (record-screen DTO precedent).
  staffColorKey: z.string(),
  clientId: z.string(),
  karuteRecordId: z.string().nullable(),
  isFirstTimeVisit: z.boolean(),
  pack: z.object({ remaining: z.number(), size: z.number() }).nullable(),
  needsRenewal: z.boolean(),
  noShowCount: z.number(),
})

const WeekDayBookingChipDTO = z.object({
  id: z.string(),
  startTime: z.string(),
  shortName: z.string(),
  staffColor: z.string().optional(),
})

/** The ONE capacity fact (src/lib/capacity), as the wire carries it. Shared
 *  verbatim by the week row and the month cell so the two calendars on one
 *  screen can never describe the same day differently (C3 E18).
 *
 *  Every key `.default(...)` for the bundle-skew reason `menus` and
 *  `colorRosterIds` already carry: the thin bundle parses this SAME schema
 *  from a baked copy, so a required key would blank the whole 予約 screen on
 *  any server/bundle skew. Every default is the honest "no capacity" state,
 *  which is exactly what a server that does not send these fields means. */
const capacityFields = {
  /** lanes × the day's declared minutes; null = no honest capacity (see
   *  capacityReason). */
  capacityMinutes: z.number().nullable().default(null),
  /** The lane count used — the store's roster, floored by whoever worked. */
  lanes: z.number().default(0),
  /** 'none' = class-bound (one row is many people): the count table, never a
   *  percentage. */
  laneKind: z.enum(['staff', 'none']).default('none'),
  /** Where the day's hours came from — 空き may ride only 'store' (E21). */
  hoursSource: z.enum(['store', 'org', 'default']).nullable().default(null),
  /** Integer 0–100; 100 prints only alongside `full` (E23). */
  occupancyPct: z.number().nullable().default(null),
  /** 満 — sold out. */
  full: z.boolean().default(false),
  band: z.enum(['light', 'medium', 'busy']).nullable().default(null),
  /** 空き in minutes. Named apart from `availableMinutes`, which is the
   *  DENOMINATOR the shipped metric menu divides by, not the free time. */
  freeMinutes: z.number().nullable().default(null),
  /** Why there is no capacity. The 未設定 cell reads this rather than
   *  re-deriving it: the module checks kind → roster → hours in that order, so
   *  an hours reason PROVES the roster was known and the store is not
   *  class-bound. */
  capacityReason: z
    .enum([
      'kind-none',
      'roster-unknown',
      'no-lanes',
      'hours-unresolved',
      'closed',
      'hours-not-saved',
      'outside-hours',
      'over-concurrency',
    ])
    .nullable()
    .default(null),
}

export const WeekDayCardDataDTO = z.object({
  ...capacityFields,
  dateNumber: z.number(),
  monthNumber: z.number(),
  weekdayLabel: z.string(),
  isToday: z.boolean().optional(),
  count: z.number(),
  bookedMinutes: z.number(),
  availableMinutes: z.number(),
  newCustomerCount: z.number(),
  /** The row's JST calendar day, YYYY-MM-DD. */
  dateIso: z.string().default(''),
  /** May 稼働/空き claim a number for this day (STRESS-S F1's five conjuncts)? */
  capacityDefensible: z.boolean().default(false),
  /** A human really set this day's hours — the 未設定 discriminator. */
  hoursSaved: z.boolean().default(false),
  /** 定休日 or 臨時休業. */
  closed: z.boolean().default(false),
  cancelledCount: z.number().default(0),
  noShowDayCount: z.number().default(0),
  /** PKT-2 owns the producer; 0 on the wire until then. */
  returningCount: z.number().default(0),
  // .default(0) on the three dead counters — step 1 of 3 (STRESS-S §5): the
  // producer still writes 0 today, the wire stops requiring them next, and the
  // keys go last. Defaulting first is what makes those later steps non-breaking
  // across every server/bundle skew (same rule as `menus` / `colorRosterIds`).
  remindersPending: z.number().default(0),
  consentPending: z.number().default(0),
  unconfirmed: z.number().default(0),
  visibleBookings: z.array(WeekDayBookingChipDTO),
  hiddenCount: z.number(),
})

export const MonthCellDTO = z.object({
  ...capacityFields,
  id: z.string(),
  dateIso: z.string(),
  inMonth: z.boolean(),
  isToday: z.boolean(),
  count: z.number(),
  /** The count bucket. Untouched — it is the FLOOR every surface falls back to
   *  when a day has no capacity, so the percentage bands ride beside it rather
   *  than replacing it. */
  density: z.enum(['empty', 'light', 'medium', 'busy']),
})
/** JSON shape of one 月 grid cell — the wire type the date-jump panel's
 *  month loader returns on BOTH doors (facade GET on the phone, server action
 *  on web), so neither host hand-rolls its own. */
export type MonthCellDTOType = z.infer<typeof MonthCellDTO>

export const AppointmentsScreenDTO = z.object({
  /** Echo of the resolved query params — the view treats them as canon. */
  view: z.enum(['day', 'week', 'month']),
  selectedDateIso: z.string(),
  staffFilter: z.string(),
  staff: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      avatarInitials: z.string(),
      avatarUrl: z.string().optional(),
      /** 経営メンバー — the booking picker AND the 担当 view filter's own
       *  default list (StaffSelector) both default-hide them client-side,
       *  search reveals (⚖ 2026-09-01 overturn of Ⓒ). This array itself
       *  stays complete. Optional so an absent value fails OPEN (visible). */
      isManagement: z.boolean().optional(),
    }),
  ),
  /** The view's active-staff default (store-clamped, first-visible fallback). */
  activeStaffId: z.string().nullable(),
  authProfileId: z.string().nullable(),
  /** Combobox options for the new-booking dialog — id/name plus phone/furigana
   *  so the combobox can match on those too. */
  customers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      furigana: z.string().nullable(),
    }),
  ),
  /** Active-menu union for the booking picker (PR-4b) — store metadata rides
   *  along for the store chips. Degraded-allowed: [] when the read fails
   *  (picker absent = today's free-text dialog).
   *
   *  .default([]) — the thin bundle parses this SAME schema client-side from a
   *  baked copy, so a required key would make the field a breaking change
   *  across every server/bundle skew (a bundle baked with it against a rolled-
   *  back server would blank the whole 予約 screen over an absent picker). The
   *  default matches the degrade the route already applies, and the output type
   *  stays a plain array — consumers never see undefined. */
  menus: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string().nullable(),
        category_display_order: z.number(),
        display_order: z.number(),
        duration_minutes: z.number(),
        price_list_amount: z.number(),
        price_min_amount: z.number().nullable(),
        store_id: z.string().nullable(),
        storeName: z.string().nullable(),
      }),
    )
    .default([]),
  reservationViews: z.array(ReservationViewDTO),
  reservationStaff: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      takesBookings: z.boolean(),
      initials: z.string(),
    }),
  ),
  /** Palette source for the day grid — the active store's staff ids. Without
   *  it the phone falls back to coloring over the LANE list, which the
   *  management rule shortens, so an idle 経営メンバー re-hues everyone after
   *  them for that day only.
   *
   *  .default([]) for the same bundle-skew reason as `menus` above: the thin
   *  bundle parses this schema from a baked copy, so a required key would blank
   *  the whole 予約 screen on any bundle/server skew. Empty → ReservationGrid's
   *  own `?? staff.map(...)` fallback, i.e. today's behavior. */
  colorRosterIds: z.array(z.string()).default([]),
  businessHours: z.object({ start: z.number(), end: z.number() }),
  weekData: z.array(WeekDayCardDataDTO).nullable(),
  weekStartIso: z.string().nullable(),
  monthData: z.array(MonthCellDTO).nullable(),
  /** The SELECTED day's row — the day line's numbers, from the same adapter the
   *  week rows come from, so the two surfaces cannot disagree.
   *
   *  .default(null) for the bundle-skew reason `menus` and `colorRosterIds`
   *  already carry: the thin bundle parses this SAME schema from a baked copy,
   *  so a required key would blank the whole 予約 screen on any server/bundle
   *  skew. Null = today's behaviour (the line falls back to nothing). */
  dayTotals: WeekDayCardDataDTO.nullable().default(null),
  /** JST-midnight ISO of the rendered month's 1st. Same bundle-skew default. */
  monthStartIso: z.string().nullable().default(null),
  /** The window could not be read to exhaustion — the surface says the read
   *  failed rather than showing a low number. Same bundle-skew default; false
   *  is today's (silently-truncating) behaviour. */
  truncated: z.boolean().default(false),
  /** The salon's `solo_mode` capability, resolved server-side (screen.ts) so
   *  the view never reads org settings — the thin door carries none. Same
   *  bundle-skew default; false is today's behaviour. */
  soloMode: z.boolean().default(false),
})

export type AppointmentsScreenDTOType = z.infer<typeof AppointmentsScreenDTO>

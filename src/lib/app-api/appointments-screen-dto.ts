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

export const WeekDayCardDataDTO = z.object({
  dateNumber: z.number(),
  monthNumber: z.number(),
  weekdayLabel: z.string(),
  isToday: z.boolean().optional(),
  count: z.number(),
  bookedMinutes: z.number(),
  availableMinutes: z.number(),
  newCustomerCount: z.number(),
  remindersPending: z.number(),
  consentPending: z.number(),
  unconfirmed: z.number(),
  visibleBookings: z.array(WeekDayBookingChipDTO),
  hiddenCount: z.number(),
})

export const MonthCellDTO = z.object({
  id: z.string(),
  dateIso: z.string(),
  inMonth: z.boolean(),
  isToday: z.boolean(),
  count: z.number(),
  density: z.enum(['empty', 'light', 'medium', 'busy']),
})

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
  businessHours: z.object({ start: z.number(), end: z.number() }),
  weekData: z.array(WeekDayCardDataDTO).nullable(),
  weekStartIso: z.string().nullable(),
  monthData: z.array(MonthCellDTO).nullable(),
})

export type AppointmentsScreenDTOType = z.infer<typeof AppointmentsScreenDTO>

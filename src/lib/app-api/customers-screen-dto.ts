// Versioned, runtime-validated DTO for the customers-list screen facade read
// (packet 04, inventory #2). Screen-shaped: this IS the CustomersListView prop
// surface, serialized — rows are built by the SAME buildCustomersListScreen the
// web page renders from, so web and mobile can never derive different rows.
//
// PARITY, not redesign: all rows ship, exactly like today's page (which pages
// synqed-core to completion). No invented pagination — the report records the
// row-count reality so pagination can be a later, evidenced decision.
//
// burnByCustomer (今月消化 strip stat, 案A, PR #535 lineage) wired in packet
// 26 — same derivation the web page uses (monthlyBurnByCustomer over
// listBurnRedemptionsWithClient), same store/tenant scoping as the rest of
// this DTO. null = burn source unavailable (matches the strip's honesty
// gate); the field hides the stat, never the whole screen.

import { z } from 'zod'

const CustomerListRowDTO = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  karuteNumber: z.string(),
  age: z.number().nullable(),
  gender: z.string().nullable(),
  joinDate: z.string(),
  joinDateIso: z.string().nullable(),
  lastVisitDate: z.string(),
  lastVisitAgo: z.string(),
  lastVisitService: z.string().nullable().optional(),
  aiPredict: z.object({ label: z.string(), when: z.string() }),
  status: z.enum(['on-track', 'new', 'needs-followup', 'dormant', 'graduated', 'lost']),
  preferredStaffId: z.string().nullable(),
  preferredStaffName: z.string().nullable(),
  bookingStaffId: z.string().nullable().optional(),
  bookingStaffName: z.string().nullable().optional(),
  totalKarute: z.number(),
  phone: z.string().nullable(),
  pack: z
    .object({ remaining: z.number(), size: z.number(), unconsumed: z.number() })
    .nullable()
    .optional(),
  packAlert: z.enum(['contact', 'low']).nullable().optional(),
  joinAgo: z.string().nullable().optional(),
  nextBookingDate: z.string().nullable().optional(),
  noShowCount: z.number().optional(),
})

export const CustomersScreenDTO = z.object({
  rows: z.array(CustomerListRowDTO),
  totalRegistered: z.number(),
  /** The caller's staff id when they are on the roster (指名/self filter). */
  selfStaffId: z.string().nullable(),
  /** False when enrichment came back empty (booking columns hide). */
  bookingDataAvailable: z.boolean(),
  /** Staff filter pills (id + display name + initials). */
  staffList: z.array(
    z.object({ id: z.string(), name: z.string(), initials: z.string() }),
  ),
  /** Per-customer 今月消化 yen (mtd + prev-month same window), keyed by
   *  customer id. null = burn source unavailable (honesty gate). */
  burnByCustomer: z
    .record(z.string(), z.object({ mtd: z.number(), prev: z.number() }))
    .nullable(),
})

export type CustomersScreenDTOType = z.infer<typeof CustomersScreenDTO>

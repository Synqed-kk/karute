// Versioned, runtime-validated DTO for the customer-profile facade slice
// (PLAN §5, packet point 5). The DTO is a real contract: the assembled object is
// parsed before it leaves the server, so a shape drift fails loud in CI fixtures
// instead of silently shipping a wrong field to a frozen binary.
//
// DISTINCT ID NAMESPACES: `assignedStaffId` is a PROFILE id (the 指名 stylist),
// NOT the caller's authUserId or a synqed coreStaffId — the roster mixes two id
// namespaces and a generic `staffId` would misattribute records. Named explicitly.

import { z } from 'zod'

export const CustomerProfileDTO = z.object({
  id: z.string(),
  name: z.string(),
  furigana: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  assignedStaffId: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: z.string().nullable(),
  occupation: z.string().nullable(),
  memberNumber: z.string().nullable(),
  visitCount: z.number(),
  hasTicketPack: z.boolean(),
  lastVisitAt: z.string().nullable(),
  firstVisitAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  consentGranted: z.boolean(),
  /** Optimistic-concurrency token for If-Match (best-effort; = updatedAt). */
  version: z.string(),
})

export type CustomerProfileDTOType = z.infer<typeof CustomerProfileDTO>

/** Wire shape of the 30-day deletion pair (PHONEWIRE-2B) — parsed at the door
 *  for this file's usual reason: both doors call one body, so a code RENAME
 *  inside it passes tsc and lands on the phone as a generic 失敗 toast.
 *  The `error` enum is EXACTLY the three settled domain answers — 'failed' is
 *  an upstream failure and leaves as a 502, never a 2xx (the A2-4 honesty law
 *  one sibling over) — so a NEW guard code reaching a door unwired fails loud
 *  here instead of arriving as a toast nobody wrote. */
export const CustomerDeletionResultDTO = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), id: z.string() }),
  z.object({
    success: z.literal(false),
    error: z.enum(['already_scheduled', 'not_scheduled', 'window_expired']),
  }),
])

interface CustomerCore {
  id: string
  name: string
  furigana: string | null
  phone: string | null
  email: string | null
  notes: string | null
  assigned_staff_id: string | null
  date_of_birth: string | null
  gender: string | null
  occupation: string | null
  member_number: string | null
  visit_count: number
  has_ticket_pack: boolean
  last_visit_at: string | null
  first_visit_at: string | null
  created_at: string
  updated_at: string
}

/** Normalize core's snake_case customer + consent into the validated DTO. */
export function toCustomerProfileDTO(
  c: CustomerCore,
  consentGranted: boolean,
): CustomerProfileDTOType {
  return CustomerProfileDTO.parse({
    id: c.id,
    name: c.name,
    furigana: c.furigana ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    notes: c.notes ?? null,
    assignedStaffId: c.assigned_staff_id ?? null,
    dateOfBirth: c.date_of_birth ?? null,
    gender: c.gender ?? null,
    occupation: c.occupation ?? null,
    memberNumber: c.member_number ?? null,
    visitCount: c.visit_count ?? 0,
    hasTicketPack: c.has_ticket_pack ?? false,
    lastVisitAt: c.last_visit_at ?? null,
    firstVisitAt: c.first_visit_at ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    consentGranted,
    version: c.updated_at,
  })
}

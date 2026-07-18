// Versioned, runtime-validated DTO for the FULL customer-profile screen facade
// read (packet 06 §Build 2, inventory #4 — the highest customer-data class).
// This IS the CustomerProfileView prop surface, serialized: profile + sessions +
// photos + customerMemory + packs + lifecycle + the header flags, assembled by
// the SAME buildCustomerProfileScreen the web page renders from, so web and thin
// can never derive different view-models.
//
// ADDITIVE extension of the packet-03 slice: the coarse CustomerProfileDTO fields
// (id/name/furigana/version/…) stay at the top level so existing consumers keep
// working; the screen fields are added alongside. The thin screen re-parses with
// this same schema module (single source of truth for the shape).

import { z } from 'zod'
import { CustomerProfileDTO, toCustomerProfileDTO } from './customer-dto'
import type { CustomerProfileScreen } from '@/lib/customers/profile-screen'

// ── VisitPace (src/lib/visits/pace.ts) ──────────────────────────────────────
const VisitPaceSchema = z.object({
  hasDates: z.boolean(),
  totalVisits: z.number(),
  lastVisitAgoDays: z.number().nullable(),
  avgIntervalDays: z.number().nullable(),
  spanMonths: z.number().nullable(),
  state: z.enum(['on-rhythm', 'slightly-over', 'over']).nullable(),
  ratio: z.number().nullable(),
  segment: z.enum(['jouren', 'antei', 'ridatsugimi', 'shinki']).nullable(),
  pending: z.boolean(),
})

// ── CustomerProfileData (src/components/customers/redesign/types.ts) ─────────
const CustomerProfileDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  karuteNumber: z.string(),
  age: z.number().nullable(),
  gender: z.string().nullable(),
  joinDate: z.string(),
  totalKarute: z.number(),
  visitCount: z.number().optional(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  preferredStaffId: z.string().nullable().optional(),
  preferredStaffName: z.string().nullable(),
  bookingStaffName: z.string().nullable().optional(),
  status: z.enum(['on-track', 'new', 'needs-followup', 'dormant', 'graduated', 'lost']),
  memoryCount: z.number(),
  sessionCount: z.number(),
  photoCount: z.number(),
  lastVisitDate: z.string().nullable().optional(),
  usualService: z.string().nullable().optional(),
  occupation: z.string().nullable().optional(),
  hasTicketPack: z.boolean().optional(),
  memberNumber: z.string().nullable().optional(),
  isBirthdayMonth: z.boolean().optional(),
  dateOfBirth: z.string().nullable().optional(),
  genderCode: z.string().nullable().optional(),
  bookingMemo: z.string().nullable().optional(),
  visitPace: VisitPaceSchema.nullable().optional(),
  visitPaceLastVisitDate: z.string().nullable().optional(),
  visitPaceLastService: z.string().nullable().optional(),
  noShowCount: z.number().optional(),
})

// ── CustomerSessionEntry (SessionsTabContent.tsx) ────────────────────────────
const CustomerSessionEntrySchema = z.object({
  id: z.string(),
  karuteId: z.string().nullable(),
  date: z.string(),
  weekday: z.string(),
  service: z.string(),
  duration: z.number(),
  summary: z.string(),
  staffName: z.string(),
  entryCount: z.number(),
  aiSummarized: z.boolean(),
  memoryAdded: z.number().nullable().optional(),
  isLatest: z.boolean().optional(),
})

// ── CustomerPhoto (PhotosTabContent.tsx) ─────────────────────────────────────
const CustomerPhotoSchema = z.object({
  id: z.string(),
  signedUrl: z.string().nullable(),
  category: z.string(),
  caption: z.string().nullable(),
})

// ── CustomerMemory (spike-lifted/memory/types.ts) ────────────────────────────
const MemoryItemSchema = z.object({
  id: z.string(),
  category: z.enum(['personal', 'body', 'preference', 'goal', 'lifestyle']),
  label: z.string(),
  body: z.string(),
  source: z.enum(['ai', 'staff', 'intake']),
  capturedAt: z.string(),
  suggestTalkingPoint: z.boolean().optional(),
  pinned: z.boolean().optional(),
})

const CustomerIntakeSchema = z.object({
  firstVisitAt: z.string().nullable(),
  occupation: z.string().nullable().optional(),
  maintenanceFreq: z.string().nullable().optional(),
  referralSource: z.string().nullable().optional(),
  highlights: z.array(z.string()).optional(),
  fields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.string().nullable(),
        quote: z.string().nullable(),
        source: z.enum(['ai', 'staff']),
      }),
    )
    .optional(),
})

const CustomerMemorySchema = z.object({
  customerId: z.string(),
  items: z.array(MemoryItemSchema),
  intake: CustomerIntakeSchema.nullable(),
  lastUpdatedAt: z.string(),
  updatedThisVisit: z.number(),
})

// ── PackWithUsage (src/lib/packs/types.ts) ───────────────────────────────────
const PackWithUsageSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  kind: z.enum(['pack', 'subscription', 'single']),
  pack_size: z.number(),
  unit_price: z.number(),
  total_price: z.number().nullable(),
  purchase_round: z.number(),
  purchased_at: z.string().nullable(),
  source: z.enum(['manual', 'import', 'qr', 'pos', 'backfill']),
  status: z.enum(['active', 'exhausted', 'cancelled']),
  notes: z.string().nullable(),
  redeemedCount: z.number(),
  remaining: z.number(),
  unconsumedValue: z.number(),
  lastRedeemedOn: z.string().nullable(),
})

// ── CustomerLifecycle ────────────────────────────────────────────────────────
const CustomerLifecycleSchema = z.object({
  customer_id: z.string(),
  status: z.enum(['active', 'graduated', 'lost']),
  referral: z.boolean(),
})

/** Additive: coarse packet-03 fields (top level) + the full screen shape. */
export const CustomerProfileScreenDTO = CustomerProfileDTO.extend({
  profile: CustomerProfileDataSchema,
  sessions: z.array(CustomerSessionEntrySchema),
  photos: z.array(CustomerPhotoSchema),
  customerMemory: CustomerMemorySchema,
  packs: z.array(PackWithUsageSchema),
  lifecycle: CustomerLifecycleSchema.nullable(),
  hasNextBooking: z.boolean(),
  ticketsEnabled: z.boolean(),
  consentGrantedAtLabel: z.string().nullable(),
})

export type CustomerProfileScreenDTOType = z.infer<typeof CustomerProfileScreenDTO>

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

/** Merge the coarse customer DTO (additive base) with the assembled screen, then
 *  validate. `customer` is core's raw customer (tenancy already proven by the
 *  business-scoped client); `screen` is buildCustomerProfileScreen's output. */
export function toCustomerProfileScreenDTO(
  customer: CustomerCore,
  screen: CustomerProfileScreen,
): CustomerProfileScreenDTOType {
  return CustomerProfileScreenDTO.parse({
    ...toCustomerProfileDTO(customer, screen.consentGranted),
    profile: screen.customer,
    sessions: screen.sessions,
    photos: screen.photos,
    customerMemory: screen.customerMemory,
    packs: screen.packs,
    lifecycle: screen.lifecycle,
    hasNextBooking: screen.hasNextBooking,
    ticketsEnabled: screen.ticketsEnabled,
    consentGranted: screen.consentGranted,
    consentGrantedAtLabel: screen.consentGrantedAtLabel,
  })
}

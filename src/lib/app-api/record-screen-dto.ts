// Versioned, runtime-validated DTO for the record-home (/sessions, inventory #6)
// screen facade read (packet 08 §Build 2). This IS the RecordPageView data-prop
// surface MINUS the streamed AI pre-session brief (Decision 1 gives it a
// dedicated endpoint) — assembled by the SAME buildRecordScreen the web page
// renders from, so web and thin can never derive a different view-model.
//
// RECORDING-PRIVACY: recentRecordings carries summary metadata ONLY — there is
// NO transcript field in any row (voice-isolation rule; asserted in the negative
// suite). The raw take never rides this read; the transcript is born at save.

import { z } from 'zod'

// CachedCustomerOption (the combobox source + returning-signal lookup).
const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Combobox phone/furigana search (zod strips unknown keys — without these
   *  the route's values never reach the client). */
  phone: z.string().nullable(),
  furigana: z.string().nullable(),
  isExistingCustomer: z.boolean(),
  created_at: z.string().nullable(),
  visitCount: z.number(),
  hasTicketPack: z.boolean(),
  karute_number: z.number().nullable(),
})

const NextAppointmentSchema = z
  .object({
    id: z.string(),
    customerName: z.string(),
    customerId: z.string(),
    karuteNumber: z.string().nullable(),
    startTime: z.string(),
    durationMinutes: z.number(),
    title: z.string().nullable(),
    notes: z.string().nullable(),
    statusKey: z.enum(['in-session', 'booked', 'done', 'walk-in']).optional(),
    staffName: z.string().optional(),
    bookedUnderOtherStaff: z.boolean().optional(),
  })
  .nullable()

const NearbyBookingSchema = z.object({
  id: z.string(),
  start: z.string(),
  end: z.string(),
  customer: z.string(),
  /** Join key into customerFacts (picker dialog v2). OPTIONAL: a pair-16 client
   *  parsing this payload strips the key it doesn't know, and this schema
   *  parsing a pre-v2 cached payload sees it absent — both keep working. */
  customerId: z.string().optional(),
  initials: z.string(),
  karute: z.string().nullable(),
  service: z.string(),
  staff: z.string(),
  staffId: z.string().nullable(),
  // Display color key from the roster map (StaffColorKey | 'neutral') or null.
  staffColorKey: z.string().nullable(),
  statusKey: z.enum(['done', 'in-session', 'booked', 'new']),
  statusLabel: z.string(),
})

// PreSessionBrief — the MECHANICAL brief only (the AI brief streams separately).
const BriefSchema = z
  .object({
    isFirstTimeVisit: z.boolean().optional(),
    lastVisitDate: z.string(),
    lastVisitAgo: z.string(),
    hooks: z.array(z.object({ title: z.string(), body: z.string().nullable() })),
    concerns: z.array(z.string()),
    lastProduct: z.object({ name: z.string(), reaction: z.string().nullable() }).nullable(),
    recommendedFocus: z.string().nullable(),
    reservationMemo: z.string().nullable().optional(),
    memoAnalysis: z.array(z.string()).optional(),
  })
  .nullable()

// RecentRecording — summary metadata ONLY. NO transcript field (voice-isolation).
const RecentRecordingSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  initials: z.string(),
  karuteNumber: z.string().nullable(),
  service: z.string(),
  date: z.string(),
  startTime: z.string(),
  durationLabel: z.string(),
  karuteLinked: z.boolean(),
  entryCount: z.number(),
  karuteId: z.string().nullable(),
})

const VisitSegmentSchema = z.enum(['jouren', 'antei', 'ridatsugimi', 'shinki']).nullable()
const VisitRhythmSchema = z
  .object({
    daysSince: z.number(),
    avgIntervalDays: z.number(),
    ratio: z.number(),
    state: z.enum(['on-rhythm', 'slightly-over', 'over']),
  })
  .nullable()

const PackPresetSchema = z.object({ size: z.number(), unitPrice: z.number() })

// Per-customer display facts for the 録音 picker dialog. EVERY field but `id` is
// optional and omitted when empty — see RecordCustomerFact.
const CustomerFactSchema = z.object({
  id: z.string(),
  karuteNumber: z.string().optional(),
  isNew: z.boolean().optional(),
  hasKarute: z.boolean().optional(),
  pack: z.object({ remaining: z.number(), size: z.number() }).optional(),
  lastVisitDate: z.string().optional(),
  lastVisitService: z.string().optional(),
  staffName: z.string().optional(),
  staffColorKey: z.string().optional(),
})

export const RecordScreenDTO = z.object({
  locale: z.string(),
  customers: z.array(CustomerSchema),
  nextAppointment: NextAppointmentSchema,
  nearbyBookings: z.array(NearbyBookingSchema),
  brief: BriefSchema,
  recentRecordings: z.array(RecentRecordingSchema),
  consentDate: z.string().nullable(),
  visitSegment: VisitSegmentSchema,
  visitRhythm: VisitRhythmSchema,
  targetHasTicketPack: z.boolean(),
  targetPack: z.object({ id: z.string(), remaining: z.number(), size: z.number() }).nullable(),
  previousPack: z.object({ size: z.number(), unitPrice: z.number() }).nullable(),
  packPresets: z.array(PackPresetSchema),
  staffCanCustomizePacks: z.boolean(),
  staffCanDeletePhotos: z.boolean(),
  ticketsEnabled: z.boolean(),
  noiseSuppression: z.boolean(),
  currentStaffName: z.string().nullable(),
  /** Picker-dialog facts (v2). OPTIONAL for the same two-way reason as
   *  nearbyBookings.customerId above: the pair-16 bundle's schema strips it,
   *  and a device-cached pre-v2 payload replayed through THIS schema still
   *  parses (the dialog then renders its lean rows). */
  customerFacts: z.array(CustomerFactSchema).optional(),
  /** The caller's display role — seeds the thin SessionProvider so any
   *  useSession() consumer in the record subtree resolves (§Build 6 trace). */
  viewerRole: z.string(),
})

export type RecordScreenDTOType = z.infer<typeof RecordScreenDTO>

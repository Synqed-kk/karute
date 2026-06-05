// Shared types for the redesigned customer list + profile.
//
// Status enum + visit-progress + AI-predict are net-new vs the legacy
// CustomerRowData shape; populated by the page-level adapter.

import { BADGE_COLORS, type BadgeStyle } from '@/lib/badge-styles'

export type CustomerStatusKey = 'on-track' | 'new' | 'needs-followup' | 'dormant'

export interface CustomerListRow {
  id: string
  name: string
  initials: string
  karuteNumber: string // "#00120"
  age: number | null
  gender: string | null
  joinDate: string // pretty
  joinDateIso: string | null
  visitsDone: number
  visitsTotal: number
  lastVisitDate: string // pretty
  lastVisitAgo: string // "28 days ago"
  /** Treatment/course from the last past visit (QR course name, from
   *  appointment.title). Optional — only the list page adapter populates it;
   *  other CustomerListRow producers omit it and the card falls back to nothing. */
  lastVisitService?: string | null
  aiPredict: { label: string; when: string }
  status: CustomerStatusKey
  preferredStaffId: string | null
  preferredStaffName: string | null
  /** Staff on the customer's booking (from the QR scrape), used as a fallback
   *  担当 when there's no 指名 (preferredStaff). Display-only — the 指名あり
   *  filter still counts preferredStaffId, never this. */
  bookingStaffId?: string | null
  bookingStaffName?: string | null
  totalKarute: number
  phone: string | null
  email: string | null
}

export interface CustomerProfileData {
  id: string
  name: string
  initials: string
  karuteNumber: string
  age: number | null
  gender: string | null
  joinDate: string
  totalKarute: number
  /** Lifetime visit count from external sync (QuickReserve); 0 for in-app-only
   *  customers. Identity card shows max(visitCount, totalKarute). */
  visitCount?: number
  phone: string | null
  email: string | null
  /** Assigned/preferred stylist profile id — the edit dialog seeds the 指名
   *  スタッフ dropdown with this so it shows + can change the current pick. */
  preferredStaffId?: string | null
  preferredStaffName: string | null
  /** 担当 fallback from the customer's booking when there's no 指名. */
  bookingStaffName?: string | null
  nextVisitPredicted: string
  status: CustomerStatusKey
  memoryCount: number
  sessionCount: number
  photoCount: number
  /** Most recent visit, locale-pretty formatted ("2026年4月19日" /
   *  "Apr 19, 2026"). Null when the customer has no recorded visits
   *  yet — the identity card renders "—" in that case. */
  lastVisitDate?: string | null
  /** "Usual course" — the customer's most-frequent service across
   *  their karute records. Anthony's data model TODO until karute
   *  records carry a `service` column; identity card falls back to
   *  "—" when omitted. */
  usualService?: string | null
  /** Occupation/profession (deep crawl) — small-talk + body-context hook. */
  occupation?: string | null
  /** Holds a prepaid ticket/course pack (deep crawl). Drives the 回数券あり pill —
   *  behavior-changing: rebook rather than hard-sell. Boolean only (no count). */
  hasTicketPack?: boolean
  /** QuickReserve membership number (deep crawl) — disambiguates 同姓同名. */
  memberNumber?: string | null
  /** Birthday falls in the current month (derived from DOB) — drives the 🎂 chip. */
  isBirthdayMonth?: boolean
  /** Raw deep-crawl values used to SEED the edit form (so a normal save doesn't
   *  wipe a crawled DOB/gender). dateOfBirth is 'YYYY-MM-DD'; genderCode is
   *  'male' | 'female' | null. The display `age`/`gender` above derive from these. */
  dateOfBirth?: string | null
  genderCode?: string | null
  /** Raw QuickReserve reservation/intake memo (synqed customer.notes) — the
   *  staff-typed "▶症状:… ▶ゴール:…" booking note. Surfaced read-only by
   *  BookingMemoCard until AI extraction distributes it into the memory boxes. */
  bookingMemo?: string | null
}

// Display strings live in `messages/{en,ja}.json` under
// `customers.list.status.{key}`; callsites resolve via
// `t('status.' + key)` (see CustomerCardMobile, CustomerRowDesktop,
// CustomerIdentityCard).
//
// These customer-signal badges ARE the canonical badge style — the rest of the
// system (reservation, dashboard) was matched to them. To keep them in lockstep
// they now derive from the shared `BADGE_COLORS` source (identical values), so
// changing a color in badge-styles.ts updates every badge in the app together.
export const STATUS_STYLES: Record<CustomerStatusKey, BadgeStyle> = {
  'on-track': BADGE_COLORS.green,
  new: BADGE_COLORS.blue,
  'needs-followup': BADGE_COLORS.yellow,
  dormant: BADGE_COLORS.red,
}

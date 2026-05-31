// Shared types for the redesigned customer list + profile.
//
// Status enum + visit-progress + AI-predict are net-new vs the legacy
// CustomerRowData shape; populated by the page-level adapter.

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
  preferredStaffName: string | null
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
// Color palette mirrors the design-spike's `CustomerSignalChip` —
// each entry pairs a light-theme variant with a dark-theme variant
// via the `dark:` Tailwind prefix. Previous version was dark-only
// (`bg-sky-500/10 text-sky-200 …`) which made the badges illegible
// in the default light theme — the "新規" chip rendered light-blue
// text on a light-blue background.
export const STATUS_STYLES: Record<
  CustomerStatusKey,
  { bg: string; text: string; border: string }
> = {
  'on-track': {
    bg: 'bg-green-50 dark:bg-green-500/10',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-500/20',
  },
  new: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-500/20',
  },
  'needs-followup': {
    bg: 'bg-yellow-50 dark:bg-yellow-500/10',
    text: 'text-yellow-800 dark:text-yellow-300',
    border: 'border-yellow-300 dark:border-yellow-500/30',
  },
  dormant: {
    bg: 'bg-red-50 dark:bg-red-500/10',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-500/20',
  },
}

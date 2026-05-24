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
  phone: string | null
  email: string | null
  preferredStaffName: string | null
  nextVisitPredicted: string
  status: CustomerStatusKey
  memoryCount: number
  sessionCount: number
  photoCount: number
}

// Display strings are NOT colocated with the styles anymore — they live in
// `messages/{en,ja}.json` under `customers.list.status.{key}`. Callsites
// resolve them via `useTranslations('customers.list')` →
// `t('status.' + status.key)` so the status chip can render in either
// locale. Keeping these as classes-only avoids the English-string-in-
// state-object footgun.
export const STATUS_STYLES: Record<
  CustomerStatusKey,
  { bg: string; text: string; border: string }
> = {
  'on-track': {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
  },
  new: {
    bg: 'bg-sky-500/10',
    text: 'text-sky-200',
    border: 'border-sky-500/40',
  },
  'needs-followup': {
    bg: 'bg-amber-500/10',
    text: 'text-amber-200',
    border: 'border-amber-500/40',
  },
  dormant: {
    bg: 'bg-red-500/10',
    text: 'text-red-300',
    border: 'border-red-500/40',
  },
}

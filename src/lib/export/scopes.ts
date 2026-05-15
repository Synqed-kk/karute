// Scope + column metadata for the /data-export page.
// Mirrors the design spike (project/data-export/data.js) — the source of truth
// for what users can pull out of Karute and which fields carry PII.

export type ScopeKey = 'customers' | 'bookings' | 'karute'
export type FormatKey = 'csv' | 'xlsx' | 'json' | 'pdf'
export type ScheduleKey = 'once' | 'weekly' | 'monthly'
export type Tint = 'blue' | 'violet' | 'emerald'

export interface ExportColumn {
  key: string
  label: string
  group: string
  required: boolean
  recommended: boolean
  pii: boolean
}

export interface ExportFilter {
  key: string
  label: string
  options: string[]
}

export interface ExportScope {
  key: ScopeKey
  label: string
  labelJa: string
  sub: string
  icon: string
  tint: Tint
  columns: ExportColumn[]
  filters: ExportFilter[]
}

export interface ExportFormat {
  key: FormatKey
  label: string
  sub: string
  icon: string
  meta: string
  supports: ScopeKey[]
  hint?: string
}

// Backend posture: only the customers + CSV combination ships wired in v1.
// Everything else renders the UI but the API returns 501 with a "coming soon"
// payload.
export const WIRED_COMBINATIONS: { scope: ScopeKey; format: FormatKey }[] = [
  { scope: 'customers', format: 'csv' },
  { scope: 'customers', format: 'json' },
]

export const SCOPES: Record<ScopeKey, ExportScope> = {
  customers: {
    key: 'customers',
    label: 'Customers',
    labelJa: '顧客',
    sub: 'Customer master · contacts',
    icon: 'Users',
    tint: 'blue',
    columns: [
      { key: 'customer_id', label: 'Customer ID', group: 'Identifiers', required: true, recommended: false, pii: false },
      { key: 'name', label: 'Name', group: 'Identifiers', required: false, recommended: true, pii: true },
      { key: 'furigana', label: 'Name (kana)', group: 'Identifiers', required: false, recommended: false, pii: true },
      { key: 'phone', label: 'Phone', group: 'Contact', required: false, recommended: true, pii: true },
      { key: 'email', label: 'Email', group: 'Contact', required: false, recommended: true, pii: true },
      { key: 'preferred_staff', label: 'Preferred staff', group: 'Relationship', required: false, recommended: true, pii: false },
      { key: 'visit_count', label: 'Visit count', group: 'Activity', required: false, recommended: false, pii: false },
      { key: 'last_visit_at', label: 'Last visit', group: 'Activity', required: false, recommended: false, pii: false },
      { key: 'created_at', label: 'Registered at', group: 'Compliance', required: false, recommended: false, pii: false },
      { key: 'updated_at', label: 'Updated at', group: 'Compliance', required: false, recommended: false, pii: false },
      { key: 'notes', label: 'Internal notes', group: 'Free text', required: false, recommended: false, pii: false },
    ],
    filters: [
      { key: 'signal', label: 'Signal', options: ['New', 'Active', 'Follow-up', 'Dormant risk'] },
      { key: 'consent', label: 'Consent', options: ['Granted', 'Pending', 'Revoked'] },
    ],
  },
  bookings: {
    key: 'bookings',
    label: 'Bookings',
    labelJa: '予約',
    sub: 'Appointment schedule',
    icon: 'Calendar',
    tint: 'violet',
    columns: [
      { key: 'booking_id', label: 'Booking ID', group: 'Identifiers', required: true, recommended: false, pii: false },
      { key: 'date', label: 'Date', group: 'When', required: false, recommended: true, pii: false },
      { key: 'time', label: 'Time', group: 'When', required: false, recommended: true, pii: false },
      { key: 'duration', label: 'Duration (min)', group: 'When', required: false, recommended: true, pii: false },
      { key: 'customer_id', label: 'Customer ID', group: 'Who', required: false, recommended: false, pii: false },
      { key: 'customer_name', label: 'Customer name', group: 'Who', required: false, recommended: true, pii: true },
      { key: 'staff_id', label: 'Staff ID', group: 'Who', required: false, recommended: true, pii: false },
      { key: 'staff_name', label: 'Staff name', group: 'Who', required: false, recommended: false, pii: false },
      { key: 'service', label: 'Service', group: 'What', required: false, recommended: true, pii: false },
      { key: 'status', label: 'Status', group: 'State', required: false, recommended: false, pii: false },
      { key: 'source', label: 'Booking source', group: 'State', required: false, recommended: false, pii: false },
      { key: 'notes', label: 'Notes', group: 'Free text', required: false, recommended: false, pii: false },
    ],
    filters: [
      { key: 'status', label: 'Status', options: ['予約済', '施術中', '完了', '未確定'] },
      { key: 'source', label: 'Source', options: ['QuickReserve', 'Walk-in', 'Phone', 'LINE'] },
    ],
  },
  karute: {
    key: 'karute',
    label: 'Karute',
    labelJa: 'カルテ',
    sub: 'Session records · history',
    icon: 'Clipboard',
    tint: 'emerald',
    columns: [
      { key: 'karute_id', label: 'Karute ID', group: 'Identifiers', required: true, recommended: false, pii: false },
      { key: 'session_date', label: 'Session date', group: 'When', required: false, recommended: true, pii: false },
      { key: 'customer_id', label: 'Customer ID', group: 'Who', required: false, recommended: true, pii: false },
      { key: 'customer_name', label: 'Customer name', group: 'Who', required: false, recommended: false, pii: true },
      { key: 'staff_id', label: 'Staff ID', group: 'Who', required: false, recommended: true, pii: false },
      { key: 'staff_name', label: 'Staff name', group: 'Who', required: false, recommended: false, pii: false },
      { key: 'entries', label: 'Entries (JSON)', group: 'Content', required: false, recommended: true, pii: true },
      { key: 'summary', label: 'AI summary', group: 'Content', required: false, recommended: true, pii: true },
      { key: 'transcript', label: 'Diarized transcript', group: 'Content', required: false, recommended: false, pii: true },
      { key: 'ai_status', label: 'AI status', group: 'State', required: false, recommended: false, pii: false },
      { key: 'confidence', label: 'AI confidence', group: 'State', required: false, recommended: false, pii: false },
      { key: 'created_at', label: 'Created at', group: 'Compliance', required: false, recommended: false, pii: false },
    ],
    filters: [
      { key: 'ai_status', label: 'AI status', options: ['AI要約済', 'AI補完待ち', 'レビュー要', '下書き'] },
      { key: 'consent', label: 'Consent', options: ['Granted', 'Pending', 'Revoked'] },
    ],
  },
}

export const FORMATS: ExportFormat[] = [
  {
    key: 'csv',
    label: 'CSV',
    sub: 'UTF-8 with BOM · widely compatible',
    icon: 'FileSpreadsheet',
    meta: '.csv · ≈40 KB / 1,000 rows',
    supports: ['customers', 'bookings', 'karute'],
  },
  {
    key: 'xlsx',
    label: 'Excel',
    sub: 'One sheet per scope · types preserved',
    icon: 'FileSpreadsheet',
    meta: '.xlsx · ≈90 KB / 1,000 rows',
    supports: ['customers', 'bookings', 'karute'],
  },
  {
    key: 'json',
    label: 'JSON',
    sub: 'Array of objects · nesting preserved',
    icon: 'FileCode',
    meta: '.json · ≈260 KB / 1,000 rows',
    supports: ['customers', 'bookings', 'karute'],
  },
  {
    key: 'pdf',
    label: 'PDF',
    sub: 'Formatted karute · per-customer page',
    icon: 'FileText',
    meta: '.pdf · 1 page / karute',
    supports: ['karute'],
    hint: 'Karute only — uses the karute-detail print layout',
  },
]

export const SCHEDULES: { key: ScheduleKey; label: string }[] = [
  { key: 'once', label: 'One-time' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
]

export function defaultColumnsFor(scopeKey: ScopeKey): string[] {
  return SCOPES[scopeKey].columns
    .filter((c) => c.recommended || c.required)
    .map((c) => c.key)
}

export function recommendedColumnsFor(scopeKey: ScopeKey): string[] {
  return SCOPES[scopeKey].columns
    .filter((c) => c.recommended)
    .map((c) => c.key)
}

export function isWired(scope: ScopeKey, format: FormatKey): boolean {
  return WIRED_COMBINATIONS.some((c) => c.scope === scope && c.format === format)
}

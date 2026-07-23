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
  labelJa: string
  group: string
  required: boolean
  recommended: boolean
  pii: boolean
}

export interface ExportFilter {
  key: string
  label: string
  labelJa: string
  options: string[]
}

export interface ExportScope {
  key: ScopeKey
  label: string
  labelJa: string
  sub: string
  subJa: string
  icon: string
  tint: Tint
  columns: ExportColumn[]
  filters: ExportFilter[]
}

export interface ExportFormat {
  key: FormatKey
  label: string
  sub: string
  subJa: string
  icon: string
  meta: string
  metaJa: string
  supports: ScopeKey[]
  hint?: string
}

// Group headers are shared across scopes (e.g. "Identifiers" appears in all
// three) — one map instead of repeating groupJa on every column.
export const GROUP_LABELS_JA: Record<string, string> = {
  Identifiers: '識別子',
  Contact: '連絡先',
  Relationship: '関係',
  Activity: '利用状況',
  Compliance: '管理情報',
  'Free text': '自由記述',
  When: '日時',
  Who: '対象',
  What: '内容',
  State: '状態',
  Content: '記録内容',
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
    subJa: '顧客マスタ・連絡先',
    icon: 'Users',
    tint: 'blue',
    columns: [
      { key: 'customer_id', label: 'Customer ID', labelJa: '顧客ID', group: 'Identifiers', required: true, recommended: false, pii: false },
      { key: 'name', label: 'Name', labelJa: '氏名', group: 'Identifiers', required: false, recommended: true, pii: true },
      { key: 'furigana', label: 'Name (kana)', labelJa: 'ふりがな', group: 'Identifiers', required: false, recommended: false, pii: true },
      { key: 'phone', label: 'Phone', labelJa: '電話番号', group: 'Contact', required: false, recommended: true, pii: true },
      { key: 'email', label: 'Email', labelJa: 'メールアドレス', group: 'Contact', required: false, recommended: true, pii: true },
      { key: 'preferred_staff', label: 'Preferred staff', labelJa: '担当スタッフ', group: 'Relationship', required: false, recommended: true, pii: false },
      { key: 'visit_count', label: 'Visit count', labelJa: '来店回数', group: 'Activity', required: false, recommended: false, pii: false },
      { key: 'last_visit_at', label: 'Last visit', labelJa: '最終来店', group: 'Activity', required: false, recommended: false, pii: false },
      { key: 'created_at', label: 'Registered at', labelJa: '登録日', group: 'Compliance', required: false, recommended: false, pii: false },
      { key: 'updated_at', label: 'Updated at', labelJa: '更新日', group: 'Compliance', required: false, recommended: false, pii: false },
      { key: 'notes', label: 'Internal notes', labelJa: '社内メモ', group: 'Free text', required: false, recommended: false, pii: false },
    ],
    filters: [
      { key: 'signal', label: 'Signal', labelJa: '顧客ステータス', options: ['New', 'Active', 'Follow-up', 'Dormant risk'] },
      { key: 'consent', label: 'Consent', labelJa: '同意状況', options: ['Granted', 'Pending', 'Revoked'] },
    ],
  },
  bookings: {
    key: 'bookings',
    label: 'Bookings',
    labelJa: '予約',
    sub: 'Appointment schedule',
    subJa: '予約スケジュール',
    icon: 'Calendar',
    tint: 'violet',
    columns: [
      { key: 'booking_id', label: 'Booking ID', labelJa: '予約ID', group: 'Identifiers', required: true, recommended: false, pii: false },
      { key: 'date', label: 'Date', labelJa: '日付', group: 'When', required: false, recommended: true, pii: false },
      { key: 'time', label: 'Time', labelJa: '時間', group: 'When', required: false, recommended: true, pii: false },
      { key: 'duration', label: 'Duration (min)', labelJa: '所要時間（分）', group: 'When', required: false, recommended: true, pii: false },
      { key: 'customer_id', label: 'Customer ID', labelJa: '顧客ID', group: 'Who', required: false, recommended: false, pii: false },
      { key: 'customer_name', label: 'Customer name', labelJa: '顧客名', group: 'Who', required: false, recommended: true, pii: true },
      { key: 'staff_id', label: 'Staff ID', labelJa: 'スタッフID', group: 'Who', required: false, recommended: true, pii: false },
      { key: 'staff_name', label: 'Staff name', labelJa: 'スタッフ名', group: 'Who', required: false, recommended: false, pii: false },
      { key: 'service', label: 'Service', labelJa: '施術内容', group: 'What', required: false, recommended: true, pii: false },
      { key: 'status', label: 'Status', labelJa: 'ステータス', group: 'State', required: false, recommended: false, pii: false },
      { key: 'source', label: 'Booking source', labelJa: '予約経路', group: 'State', required: false, recommended: false, pii: false },
      { key: 'notes', label: 'Notes', labelJa: 'メモ', group: 'Free text', required: false, recommended: false, pii: false },
    ],
    filters: [
      { key: 'status', label: 'Status', labelJa: 'ステータス', options: ['予約済', '施術中', '完了', '未確定'] },
      { key: 'source', label: 'Source', labelJa: '予約経路', options: ['QuickReserve', 'Walk-in', 'Phone', 'LINE'] },
    ],
  },
  karute: {
    key: 'karute',
    label: 'Karute',
    labelJa: 'カルテ',
    sub: 'Session records · history',
    subJa: '施術記録・履歴',
    icon: 'Clipboard',
    tint: 'emerald',
    columns: [
      { key: 'karute_id', label: 'Karute ID', labelJa: 'カルテID', group: 'Identifiers', required: true, recommended: false, pii: false },
      { key: 'session_date', label: 'Session date', labelJa: '施術日', group: 'When', required: false, recommended: true, pii: false },
      { key: 'customer_id', label: 'Customer ID', labelJa: '顧客ID', group: 'Who', required: false, recommended: true, pii: false },
      { key: 'customer_name', label: 'Customer name', labelJa: '顧客名', group: 'Who', required: false, recommended: false, pii: true },
      { key: 'staff_id', label: 'Staff ID', labelJa: 'スタッフID', group: 'Who', required: false, recommended: true, pii: false },
      { key: 'staff_name', label: 'Staff name', labelJa: 'スタッフ名', group: 'Who', required: false, recommended: false, pii: false },
      { key: 'entries', label: 'Entries (JSON)', labelJa: '記録項目（JSON）', group: 'Content', required: false, recommended: true, pii: true },
      { key: 'summary', label: 'AI summary', labelJa: 'AI要約', group: 'Content', required: false, recommended: true, pii: true },
      { key: 'transcript', label: 'Diarized transcript', labelJa: '話者分離済み文字起こし', group: 'Content', required: false, recommended: false, pii: true },
      { key: 'ai_status', label: 'AI status', labelJa: 'AIステータス', group: 'State', required: false, recommended: false, pii: false },
      { key: 'confidence', label: 'AI confidence', labelJa: 'AI信頼度', group: 'State', required: false, recommended: false, pii: false },
      { key: 'created_at', label: 'Created at', labelJa: '作成日', group: 'Compliance', required: false, recommended: false, pii: false },
    ],
    filters: [
      { key: 'ai_status', label: 'AI status', labelJa: 'AIステータス', options: ['AI要約済', 'AI補完待ち', 'レビュー要', '下書き'] },
      { key: 'consent', label: 'Consent', labelJa: '同意状況', options: ['Granted', 'Pending', 'Revoked'] },
    ],
  },
}

export const FORMATS: ExportFormat[] = [
  {
    key: 'csv',
    label: 'CSV',
    sub: 'UTF-8 with BOM · widely compatible',
    subJa: 'UTF-8（BOM付き）・汎用性が高い',
    icon: 'FileSpreadsheet',
    meta: '.csv · ≈40 KB / 1,000 rows',
    metaJa: '.csv · 約40KB / 1,000件',
    supports: ['customers', 'bookings', 'karute'],
  },
  {
    key: 'xlsx',
    label: 'Excel',
    sub: 'One sheet per scope · types preserved',
    subJa: 'データ種別ごとに1シート・型を保持',
    icon: 'FileSpreadsheet',
    meta: '.xlsx · ≈90 KB / 1,000 rows',
    metaJa: '.xlsx · 約90KB / 1,000件',
    supports: ['customers', 'bookings', 'karute'],
  },
  {
    key: 'json',
    label: 'JSON',
    sub: 'Array of objects · nesting preserved',
    subJa: 'オブジェクト配列・ネストを保持',
    icon: 'FileCode',
    meta: '.json · ≈260 KB / 1,000 rows',
    metaJa: '.json · 約260KB / 1,000件',
    supports: ['customers', 'bookings', 'karute'],
  },
  {
    key: 'pdf',
    label: 'PDF',
    sub: 'Formatted karute · per-customer page',
    subJa: '整形済みカルテ・顧客ごとに1ページ',
    icon: 'FileText',
    meta: '.pdf · 1 page / karute',
    metaJa: '.pdf · カルテ1件につき1ページ',
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

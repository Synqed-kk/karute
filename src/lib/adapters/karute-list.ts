// ---------------------------------------------------------------------------
// Adapter: Supabase karute_records list rows -> KaruteRichRow for the
// redesigned karute list view.
// ---------------------------------------------------------------------------

export type KaruteDisplayStatus =
  | 'summarized'
  | 'pending'
  | 'review'
  | 'draft'

export interface KaruteRichRow {
  id: string
  /** ISO date (YYYY-MM-DD) of the session, for grouping. */
  date: string
  /** HH:MM of the session, in the caller's locale. */
  time: string
  customerName: string
  customerInitials: string
  /** Short stable badge derived from the row id, e.g. "#A1B2C". */
  karuteNumber: string
  service: string | null
  serviceDetail: string | null
  duration: number | null
  entryCount: number
  staffId: string | null
  staffName: string | null
  status: KaruteDisplayStatus
  summary: string
}

export interface KaruteListRecord {
  id: string
  session_date: string | null
  created_at: string
  summary: string | null
  transcript: string | null
  staff_profile_id: string | null
  customers: { id: string; name: string } | null
  profiles: { id: string; full_name: string | null } | null
  entries: Array<{ id: string }> | null
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function deriveKaruteNumber(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 5).toUpperCase()
  return `#${hex}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function deriveStatus(
  summary: string | null,
  transcript: string | null,
): KaruteDisplayStatus {
  if (summary && summary.trim().length > 0) return 'summarized'
  if (transcript && transcript.trim().length > 0) return 'pending'
  return 'draft'
}

export function karuteRecordsToRichRows(
  records: KaruteListRecord[],
): KaruteRichRow[] {
  return records.map((r) => {
    const customerName = r.customers?.name ?? 'Unknown'
    const dt = new Date(r.session_date ?? r.created_at)
    return {
      id: r.id,
      date: isoDay(dt),
      time: `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`,
      customerName,
      customerInitials: deriveInitials(customerName),
      karuteNumber: deriveKaruteNumber(r.id),
      service: null,
      serviceDetail: null,
      duration: null,
      entryCount: Array.isArray(r.entries) ? r.entries.length : 0,
      staffId: r.staff_profile_id,
      staffName: r.profiles?.full_name ?? null,
      status: deriveStatus(r.summary, r.transcript),
      summary: r.summary ?? '—',
    }
  })
}

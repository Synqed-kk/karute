import type { KaruteListRowData } from '@synqed-kk/ui'

// ---------------------------------------------------------------------------
// Adapter: Supabase karute_records list rows -> synqed-ui KaruteListRowData
// ---------------------------------------------------------------------------

export interface KaruteListRecord {
  id: string
  created_at: string
  summary: string | null
  customers: { id: string; name: string } | null
  entries: Array<{ id: string }> | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}/${day}`
}

export function karuteRecordsToRowData(
  records: KaruteListRecord[],
): KaruteListRowData[] {
  return records.map((r) => {
    const customerName = r.customers?.name ?? 'Unknown'
    const entryCount = Array.isArray(r.entries) ? r.entries.length : 0
    const summary = r.summary ?? '—'
    return {
      id: r.id,
      date: r.created_at,
      dateDisplay: formatShortDate(r.created_at),
      weekday: WEEKDAYS[new Date(r.created_at).getDay()],
      customerName,
      customerInitials: deriveInitials(customerName),
      service: 'Session',
      duration: 60,
      staffName: '—',
      summary,
      entryCount,
      aiStatusTone: r.summary ? 'summarized' : 'pending',
      aiStatusLabel: r.summary ? 'Summarized' : 'Pending',
      conversionStatus: 'active',
    }
  })
}

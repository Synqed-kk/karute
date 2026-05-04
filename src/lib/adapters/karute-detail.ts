import type { SessionEntryRowData, SessionEntryTone } from '@synqed-kk/ui'
import type { KaruteWithRelations } from '@/lib/supabase/karute'

// ---------------------------------------------------------------------------
// Adapter: karute_records detail -> synqed-ui prop shapes
// ---------------------------------------------------------------------------

const CATEGORY_TO_TONE: Record<string, SessionEntryTone> = {
  symptom: 'concern',
  concern: 'concern',
  body_area: 'condition',
  lifestyle: 'condition',
  treatment: 'treatment',
  product: 'product',
  preference: 'product',
  next_visit: 'next',
  next: 'next',
}

function timeOfDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatMediumDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export interface KaruteDetailHeader {
  customerName: string
  customerInitials: string
  staffName: string
  sessionDateLong: string
  sessionDateMedium: string
}

export function karuteToHeader(karute: KaruteWithRelations): KaruteDetailHeader {
  const k = karute as unknown as {
    customers?: { name: string } | null
    profiles?: { full_name: string } | null
    session_date?: string | null
    created_at: string
  }
  const customerName = k.customers?.name ?? '—'
  const staffName = k.profiles?.full_name ?? '—'
  const dateSource = k.session_date ?? k.created_at
  return {
    customerName,
    customerInitials: deriveInitials(customerName),
    staffName,
    sessionDateLong: formatLongDate(dateSource),
    sessionDateMedium: formatMediumDate(dateSource),
  }
}

export function karuteEntriesToTimeline(
  karute: KaruteWithRelations,
): SessionEntryRowData[] {
  const k = karute as unknown as {
    entries?: Array<{
      id: string
      category: string
      content: string
      created_at: string
    }>
  }
  const entries = k.entries ?? []
  return entries.map((e) => ({
    id: e.id,
    time: timeOfDay(e.created_at),
    content: e.content,
    categoryLabel: e.category,
    categoryTone: CATEGORY_TO_TONE[e.category] ?? 'concern',
  }))
}

export function karuteSummaryToBullets(
  karute: KaruteWithRelations,
): string[] {
  if (!karute.summary) return []
  return karute.summary
    .split(/[.。]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

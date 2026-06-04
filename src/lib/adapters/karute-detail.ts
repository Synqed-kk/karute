import type { SessionEntryRowData, SessionEntryTone } from '@synqed-kk/ui'
import type { KaruteWithRelations } from '@/lib/supabase/karute'
import type { SessionEntry, SessionCategory } from '@/components/karute/redesign/detail/CurrentSessionCard'

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
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  // New format (prompts.ts): newline-separated bullets, each line optionally
  // prefixed with ・/•/-. Prefer this — it's robust to dates like "16:00" and
  // to a Japanese 。inside a single bullet (which the old period-split mangled).
  const lines = karute.summary
    .split(/\r?\n+/)
    .map((s) => s.replace(/^[\s・*•\-–—]+/, '').trim())
    .filter(Boolean)
  if (lines.length > 1) return lines
  // Legacy/prose fallback — records summarized before the bullet format.
  return karute.summary
    .split(/[.。]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// New detail-redesign adapters
// ---------------------------------------------------------------------------

const CATEGORY_TO_SESSION_CATEGORY: Record<string, SessionCategory> = {
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

export function karuteEntriesToSessionEntries(
  karute: KaruteWithRelations,
): SessionEntry[] {
  const k = karute as unknown as {
    entries?: Array<{
      id: string
      category: string
      content: string
      created_at: string
    }>
  }
  return (k.entries ?? []).map((e) => ({
    id: e.id,
    category: CATEGORY_TO_SESSION_CATEGORY[e.category] ?? 'concern',
    time: timeOfDay(e.created_at),
    body: e.content,
  }))
}

export function deriveKaruteNumber(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 5).toUpperCase()
  return `#${hex}`
}

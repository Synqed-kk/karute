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
  preference: 'concern',
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

function formatLongDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatMediumDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: locale === 'ja' ? 'long' : 'short',
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

export function karuteToHeader(
  karute: KaruteWithRelations,
  locale = 'en',
): KaruteDetailHeader {
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
    sessionDateLong: formatLongDate(dateSource, locale),
    sessionDateMedium: formatMediumDate(dateSource, locale),
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
  const raw = karute.summary
  // New format (prompts.ts): bullet lines, each optionally prefixed with ・/•/-.
  // Detect the new format by a bullet marker OR a newline — NOT by line count.
  // That way a SINGLE bullet ("・次回来店：6月29日 16:00") isn't mis-routed to the
  // period-split (which mangles "16:00" / a 。inside the bullet), while a legacy
  // prose summary (no markers, no newlines) still splits into sentences.
  const looksBulleted = /\r?\n/.test(raw) || /^\s*[・•▪◦*\-–—]/.test(raw.trimStart())
  if (looksBulleted) {
    return raw
      .split(/\r?\n+/)
      .map((s) => s.replace(/^[\s・*•▪◦\-–—]+/, '').trim())
      .filter(Boolean)
  }
  // Legacy/prose fallback — records summarized before the bullet format.
  return raw
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
  preference: 'concern',
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
  // Clinical-narrative order so staff skim a coherent story — concern → state →
  // what was done → recommendation → plan — and repeated categories group instead
  // of scattering (the "気になる点 ×4 in random spots" problem). Stable within a
  // category (V8 sort is stable), so original order is preserved per group.
  const ORDER: Record<string, number> = {
    concern: 0,
    condition: 1,
    treatment: 2,
    product: 3,
    next: 4,
  }
  return (k.entries ?? [])
    .map((e) => ({
      id: e.id,
      category: CATEGORY_TO_SESSION_CATEGORY[e.category] ?? 'concern',
      time: timeOfDay(e.created_at),
      body: e.content,
    }))
    .sort((a, b) => (ORDER[a.category] ?? 9) - (ORDER[b.category] ?? 9))
}


export function deriveKaruteNumber(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 5).toUpperCase()
  return `#${hex}`
}

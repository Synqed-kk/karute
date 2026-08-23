import type { SessionEntryRowData, SessionEntryTone } from '@synqed-kk/ui'
import type { EntryCategory } from '@synqed-kk/client'
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
  // synqed-ui's tone enum has no preference/note tones — nearest neighbors.
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

function formatLongDate(iso: string, locale: string): string {
  const d = new Date(iso)
  // ja branch mirrors formatLongDateJst's (jst.ts:128) exact Intl options —
  // not imported, its en shape differs (weekday+short-month vs the long-month
  // en-US pin below). Both branches pin Asia/Tokyo: a created_at-fallback row
  // in the 15:00-24:00 UTC window now displays its JST day, not its UTC day.
  if (locale === 'ja') {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d)
  }
  return d.toLocaleDateString('en-US', {
    timeZone: 'Asia/Tokyo',
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

export function karuteToHeader(karute: KaruteWithRelations, locale: string): KaruteDetailHeader {
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
  return summaryTextToBullets(karute.summary)
}

/** Raw-text variant of the split above — the 詳細記録 pencil's optimistic
 *  post-save re-render calls this client-side with the just-saved text. */
export function summaryTextToBullets(raw: string | null): string[] {
  if (!raw) return []
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
  // Personal / life facts (pets, family, routine) get their OWN group — they are
  // NOT a body 状態. This is what surfaces "犬を飼い始めた" as rapport, not a condition.
  lifestyle: 'lifestyle',
  treatment: 'treatment',
  product: 'product',
  // preference gets its OWN chip (好み) — it was shelved under 製品, which
  // mislabeled correctly-categorized data (pressure prefs shown as a product).
  preference: 'preference',
  next_visit: 'next',
  next: 'next',
  // other = facts that fit no drawer; an honest メモ chip instead of silently
  // masquerading as a 気になる点.
  other: 'note',
}

/** Reverse of CATEGORY_TO_SESSION_CATEGORY (edit-layer W2 PR-B) — the DB enum a
 *  category-chip choice writes back as. The forward map collapses two DB values
 *  onto one display category (symptom+concern → concern; next_visit+next →
 *  next); this picks ONE canonical DB value per display chip so an edit-sheet
 *  category change has a single, deterministic write target. */
export const SESSION_CATEGORY_TO_ENTRY_CATEGORY: Record<SessionCategory, EntryCategory> = {
  concern: 'SYMPTOM',
  condition: 'BODY_AREA',
  lifestyle: 'LIFESTYLE',
  treatment: 'TREATMENT',
  preference: 'PREFERENCE',
  product: 'PRODUCT',
  next: 'NEXT_VISIT',
  note: 'OTHER',
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
      author?: SessionEntry['author']
      version?: number
      original_ai_content?: string | null
    }>
  }
  return (k.entries ?? []).map((e) => ({
    id: e.id,
    category: CATEGORY_TO_SESSION_CATEGORY[e.category] ?? 'concern',
    time: timeOfDay(e.created_at),
    body: e.content,
    author: e.author,
    version: e.version,
    original_ai_content: e.original_ai_content,
  }))
}

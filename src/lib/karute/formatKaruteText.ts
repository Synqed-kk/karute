import type { KaruteWithRelations } from '@/lib/supabase/karute'

const labels = {
  en: {
    title: 'Karute',
    customer: 'Customer',
    date: 'Date',
    aiSummary: 'AI Summary',
    entries: 'Entries',
    quote: 'Quote',
    transcript: 'Transcript',
  },
  ja: {
    title: 'カルテ',
    customer: '顧客',
    date: '日付',
    aiSummary: 'AI サマリー',
    entries: 'エントリー',
    quote: '引用',
    transcript: 'トランスクリプト',
  },
} as const

/**
 * Pure function — no side effects, no external dependencies.
 * Formats a karute record as structured plain text.
 * UTF-8 safe: all characters are preserved as-is in the output string.
 */
export function formatKaruteAsText(karute: KaruteWithRelations, locale: 'en' | 'ja' = 'ja'): string {
  const l = labels[locale]
  // customers is aliased via PostgREST as customers:client_id — cast to any for field access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerName = (karute as any).customers?.name ?? '---'
  const dateSource =
    (karute as { session_date?: string; created_at: string }).session_date ??
    karute.created_at
  const date = new Date(dateSource).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')

  const lines: string[] = []

  // Header
  lines.push(l.title)
  lines.push(`${l.customer}: ${customerName}`)
  lines.push(`${l.date}: ${date}`)
  lines.push('')

  // AI Summary section
  lines.push(`===== ${l.aiSummary} =====`)
  lines.push(karute.summary ?? '')
  lines.push('')

  // Entries section
  lines.push(`===== ${l.entries} =====`)
  const entries = (karute as { entries?: Array<{
    id: string
    category: string
    content: string
    source_quote: string | null
    confidence_score: number | null
    is_manual: boolean
    created_at: string
  }> }).entries ?? []

  for (const entry of entries) {
    lines.push('')
    lines.push(`[${entry.category}]`)
    lines.push(entry.content)
    if (entry.source_quote) {
      lines.push(`  ${l.quote}: "${entry.source_quote}"`)
    }
  }

  lines.push('')

  // Transcript section
  lines.push(`===== ${l.transcript} =====`)
  lines.push(karute.transcript ?? '')

  return lines.join('\n')
}

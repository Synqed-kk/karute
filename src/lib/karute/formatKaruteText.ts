import type { KaruteWithRelations } from '@/lib/supabase/karute'

/**
 * Pure function — no side effects, no external dependencies.
 * Formats a karute record as structured plain text with Japanese section headers.
 * UTF-8 safe: all Japanese characters are preserved as-is in the output string.
 */
export function formatKaruteAsText(karute: KaruteWithRelations): string {
  // customers is aliased via PostgREST as customers:client_id — cast to any for field access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerName = (karute as any).customers?.name ?? '---'
  const dateSource =
    (karute as { session_date?: string; created_at: string }).session_date ??
    karute.created_at
  const date = new Date(dateSource).toLocaleDateString('ja-JP')

  const lines: string[] = []

  // Header
  lines.push('カルテ')
  lines.push(`顧客: ${customerName}`)
  lines.push(`日付: ${date}`)
  lines.push('')

  // AI Summary section
  lines.push('===== AI サマリー =====')
  lines.push(karute.summary ?? '')
  lines.push('')

  // Entries section
  lines.push('===== エントリー =====')
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
      lines.push(`  引用: "${entry.source_quote}"`)
    }
  }

  lines.push('')

  // Transcript section
  lines.push('===== トランスクリプト =====')
  lines.push(karute.transcript ?? '')

  return lines.join('\n')
}

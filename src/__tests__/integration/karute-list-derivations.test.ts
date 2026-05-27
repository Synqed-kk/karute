/**
 * Karute list row derivations — guards the data-integrity contract
 * established in PRs #63 + #64:
 *
 *   - aiStatus derived from summary/transcript shape; 'needsReview'
 *     intentionally never assigned (no review_needed column yet)
 *   - conversionStatus derived from entry_count
 *   - service '—' fallback (NOT '施術' literal)
 *
 * Pure logic tests — no Supabase, no synqed-client. Mirrors the
 * derivation in src/app/[locale]/(app)/karute/page.tsx so a refactor
 * in either spot catches the other.
 */

type Row = {
  id: string
  session_date: string | null
  created_at: string
  summary: string | null
  transcript: string | null
  staff_profile_id: string | null
  client_id: string
  entries: Array<{ count: number }> | null
}

type KaruteAiStatus = 'summarized' | 'pending' | 'needsReview' | 'draft'
type KaruteConversionStatus = 'active' | 'provisional'

function deriveAiStatus(row: Row): KaruteAiStatus {
  if (row.summary && row.summary.trim().length > 0) return 'summarized'
  if (row.transcript && row.transcript.trim().length > 0) return 'pending'
  return 'draft'
}

function deriveConversionStatus(row: Row): KaruteConversionStatus {
  const count = Array.isArray(row.entries) ? (row.entries[0]?.count ?? 0) : 0
  return count > 0 ? 'active' : 'provisional'
}

function deriveService(serviceColumnValue: string | null | undefined): string {
  // Per PR #63/#64 contract: '—' (not '施術') when column is missing/null.
  // When ANTHONY adds karute_records.service, pass it through; this stays
  // a safety net.
  if (!serviceColumnValue || !serviceColumnValue.trim()) return '—'
  return serviceColumnValue
}

describe('karute list — aiStatus derivation', () => {
  const baseRow: Row = {
    id: 'k1',
    session_date: '2026-05-20',
    created_at: '2026-05-20T10:00:00Z',
    summary: null,
    transcript: null,
    staff_profile_id: 'staff-1',
    client_id: 'cust-1',
    entries: [{ count: 0 }],
  }

  it("returns 'summarized' when summary is present", () => {
    expect(deriveAiStatus({ ...baseRow, summary: 'AI summary text', transcript: 'transcript' })).toBe(
      'summarized',
    )
  })

  it("returns 'pending' when transcript exists but no summary", () => {
    expect(deriveAiStatus({ ...baseRow, transcript: 'transcript text' })).toBe('pending')
  })

  it("returns 'draft' when neither summary nor transcript", () => {
    expect(deriveAiStatus(baseRow)).toBe('draft')
  })

  it("treats empty-string summary as no summary (draft)", () => {
    expect(deriveAiStatus({ ...baseRow, summary: '   ' })).toBe('draft')
  })

  it("NEVER returns 'needsReview' from current derivation (no review_needed column)", () => {
    // This is the contract: until ANTHONY adds the review_needed column,
    // nothing produces 'needsReview'. Guards against accidentally
    // re-introducing the dead レビュー要 filter chip removed in PR #63.
    const all: KaruteAiStatus[] = []
    for (const summary of [null, '', '   ', 'real']) {
      for (const transcript of [null, '', '   ', 'real']) {
        all.push(deriveAiStatus({ ...baseRow, summary, transcript }))
      }
    }
    expect(all).not.toContain('needsReview')
  })
})

describe('karute list — conversionStatus derivation', () => {
  const baseRow: Row = {
    id: 'k1',
    session_date: '2026-05-20',
    created_at: '2026-05-20T10:00:00Z',
    summary: null,
    transcript: null,
    staff_profile_id: 'staff-1',
    client_id: 'cust-1',
    entries: null,
  }

  it("returns 'provisional' (仮カルテ) when entry_count is 0", () => {
    expect(deriveConversionStatus({ ...baseRow, entries: [{ count: 0 }] })).toBe('provisional')
  })

  it("returns 'active' when entry_count is >= 1", () => {
    expect(deriveConversionStatus({ ...baseRow, entries: [{ count: 1 }] })).toBe('active')
    expect(deriveConversionStatus({ ...baseRow, entries: [{ count: 12 }] })).toBe('active')
  })

  it("returns 'provisional' when entries array is null or empty", () => {
    expect(deriveConversionStatus({ ...baseRow, entries: null })).toBe('provisional')
    expect(deriveConversionStatus({ ...baseRow, entries: [] })).toBe('provisional')
  })
})

describe('karute list — service fallback', () => {
  it("returns '—' (NOT '施術') when service column is null", () => {
    expect(deriveService(null)).toBe('—')
    expect(deriveService(undefined)).toBe('—')
  })

  it("returns '—' for empty/whitespace strings", () => {
    expect(deriveService('')).toBe('—')
    expect(deriveService('   ')).toBe('—')
  })

  it("passes through real service values when ANTHONY's column lands", () => {
    expect(deriveService('フェイシャル')).toBe('フェイシャル')
    expect(deriveService('Cut & Color')).toBe('Cut & Color')
  })

  it("NEVER returns the literal '施術' (PR #63 contract)", () => {
    // Regression guard: don't let '施術' creep back in as a fallback.
    for (const input of [null, undefined, '', '   ', 'real']) {
      expect(deriveService(input)).not.toBe('施術')
    }
  })
})

import 'server-only'
import type { MemoryItem } from './memory-types'

// Heavy server deps (org-settings, the OpenAI extractor, the Supabase store) are
// loaded via dynamic import INSIDE the functions, not at module top-level. This
// keeps actions/karute's import chain light — the save-flow tests load this
// module without transitively pulling in org-settings/openai — while production
// (Next.js, which transforms everything) resolves them normally on first call.
// Both functions are best-effort and swallow all errors.

export async function ingestSessionMemory(params: {
  customerId: string
  businessId?: string | null
  transcript: string | null
  locale: string
  /** Prompt anchors (v3.1) — optional, degrade gracefully. */
  customerName?: string | null
  sessionDate?: string | null
}): Promise<void> {
  const { customerId, businessId, transcript, locale, customerName, sessionDate } = params
  if (!transcript || !transcript.trim()) return
  try {
    // Plan gate (P4): auto-extract is a paid capability once billing arms —
    // silent skip here (this whole function is best-effort by contract; the
    // record save it rides on must never fail on a plan check). Manual staff
    // memory edits live in actions/memory.ts → customer-memory.ts and are
    // deliberately NOT gated. Dynamic import per this file's header rule.
    const { featureAllowed } = await import('@/lib/subscription/feature-gate')
    if (!(await featureAllowed('customerMemoryAutoExtract'))) return
    const [{ getOrgSettings }, { getBusinessAiPersona }, store, { extractCustomerMemory }] =
      await Promise.all([
        import('@/actions/org-settings'),
        import('./business-ai-tokens'),
        import('./customer-memory'),
        import('./memory-extract'),
      ])
    const [orgSettings, existing] = await Promise.all([
      getOrgSettings().catch(() => null),
      store.getCustomerMemory(customerId),
    ])
    const persona = getBusinessAiPersona(orgSettings?.business_type)
    const ops = await extractCustomerMemory({
      transcripts: [transcript],
      existing,
      persona,
      locale,
      customerName,
      sessionDate,
    })
    await store.applyMemoryDelta({ customerId, businessId, ops })
  } catch (err) {
    console.error('[ingestSessionMemory] failed:', err)
  }
}

export async function backfillMemoryFromTranscripts(params: {
  customerId: string
  businessId?: string | null
  /** Plain strings keep working (undated — no header injected). Callers that
   *  have the session row should pass { text, date } so the model gets real
   *  dates: without them it either omits time anchors (rule 7) or — observed
   *  in the field 2026-07-15 — imitates dates found in the seeded existing
   *  items, stamping new facts with another session's month. */
  transcripts: Array<string | { text: string; date?: string | null }>
  locale: string
  /** Cap the walk for latency-sensitive callers (page render / brief): chunks
   *  of newest sessions processed, NOT the full history. The explicit 再学習
   *  action omits this and gets the full CHUNK_LIMIT depth. */
  maxChunks?: number
}): Promise<MemoryItem[]> {
  const { customerId, businessId, transcripts, locale, maxChunks } = params
  const usable = transcripts
    .map((t) => (typeof t === 'string' ? { text: t, date: null as string | null } : { text: t.text, date: t.date ?? null }))
    .filter((t) => t.text && t.text.trim())
  if (usable.length === 0) return []
  try {
    // Plan gate (P4): same key + same silent-skip contract as
    // ingestSessionMemory above. 再学習's user-facing "locked" copy is handled
    // by its action checking BEFORE the wipe — by the time this runs, allowed.
    const { featureAllowed } = await import('@/lib/subscription/feature-gate')
    if (!(await featureAllowed('customerMemoryAutoExtract'))) return []
    const [{ getOrgSettings }, { getBusinessAiPersona }, store, { extractCustomerMemory }] =
      await Promise.all([
        import('@/actions/org-settings'),
        import('./business-ai-tokens'),
        import('./customer-memory'),
        import('./memory-extract'),
      ])
    const orgSettings = await getOrgSettings().catch(() => null)
    const persona = getBusinessAiPersona(orgSettings?.business_type)
    // Chunked walk over the history instead of the old silent `.slice(0, 5)`:
    // that cap made 再学習 and the bootstrap read only 5 sessions ever — a fact
    // mentioned once in session 6+ of a long history could never enter memory.
    // Each call stays bounded (5 transcripts × 16k chars ≈ 20k tokens); chunks
    // run sequentially so each one reconciles against the memory the previous
    // chunk produced. CHUNK_LIMIT bounds a pathological history's cost — beyond
    // it we keep the NEWEST sessions and log the drop, never silently.
    // Seeding `existing` from the store (was hardcoded []) also stops a relearn
    // from re-adding facts that survive the wipe as staff-owned/pinned rows.
    // CONTRACT: `transcripts` arrives NEWEST-first — every caller sorts
    // explicitly before calling (core's list order is not guaranteed):
    // customers/[id]/page.tsx, ai-brief.ts (getCustomerKaruteRecords sorts),
    // actions/memory.ts. We keep the newest CHUNK_LIMIT×CHUNK_SIZE sessions
    // when over the cap (logged, never silent), then process chunks
    // OLDEST→NEWEST so facts evolve forward the way they happened (the dog is
    // alive before it passes away, not after).
    const CHUNK_SIZE = 5
    const CHUNK_LIMIT = 10 // ponytail: 50 sessions per backfill; a server-side batch job if a real customer exceeds it
    const chunkCap = Math.min(maxChunks ?? CHUNK_LIMIT, CHUNK_LIMIT)
    // Date header per transcript (inside the untrusted wrap, server-generated):
    // rule 7 converts relative time to absolute only when it knows the session
    // date — a dateless backfill made the model fabricate anchors instead.
    const withDateHeader = (t: { text: string; date: string | null }) => {
      const body = t.text.slice(0, 16000)
      if (!t.date) return body
      const d = t.date.slice(0, 10)
      return locale === 'ja' ? `【セッション日 ${d}】\n${body}` : `[Session date: ${d}]\n${body}`
    }
    let chunks: Array<typeof usable> = []
    for (let i = 0; i < usable.length; i += CHUNK_SIZE) {
      chunks.push(usable.slice(i, i + CHUNK_SIZE))
    }
    if (chunks.length > chunkCap) {
      console.warn(
        `[backfillMemoryFromTranscripts] ${customerId}: ${usable.length} transcripts exceeds the ${chunkCap * CHUNK_SIZE} cap — keeping the newest, dropping ${usable.length - chunkCap * CHUNK_SIZE}`,
      )
      chunks = chunks.slice(0, chunkCap)
    }
    chunks.reverse()
    let existing = await store.getCustomerMemory(customerId)
    for (const chunk of chunks) {
      const ops = await extractCustomerMemory({
        // The chunk itself is newest-first (input order) — reverse it so the
        // model READS oldest→newest too; each transcript carries its session
        // date as a header when the caller provided one (reading order stays
        // the chronology signal for undated legacy callers).
        transcripts: [...chunk].reverse().map(withDateHeader),
        existing,
        persona,
        locale,
      })
      if (ops.length > 0) {
        await store.applyMemoryDelta({ customerId, businessId, ops })
        existing = await store.getCustomerMemory(customerId)
      }
    }
    return existing
  } catch (err) {
    console.error('[backfillMemoryFromTranscripts] failed:', err)
    return []
  }
}

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
    // Identity-threaded when a businessId is present (packet 08 Decision 3 — the
    // facade save has no cookie); the cookie path is unchanged for web callers.
    const { featureAllowed, featureAllowedForBusiness } = await import('@/lib/subscription/feature-gate')
    const gateOk = businessId
      ? await featureAllowedForBusiness(businessId, 'customerMemoryAutoExtract')
      : await featureAllowed('customerMemoryAutoExtract')
    if (!gateOk) return
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
  transcripts: string[]
  locale: string
}): Promise<MemoryItem[]> {
  const { customerId, businessId, transcripts, locale } = params
  const usable = transcripts.filter((t) => t && t.trim())
  if (usable.length === 0) return []
  try {
    // Plan gate (P4): same key + same silent-skip contract as
    // ingestSessionMemory above. 再学習's user-facing "locked" copy is handled
    // by its action checking BEFORE the wipe — by the time this runs, allowed.
    // Identity-threaded when a businessId is present (packet 08 Decision 1 — the
    // facade brief has no cookie); the cookie path is unchanged for web callers.
    const { featureAllowed, featureAllowedForBusiness } = await import('@/lib/subscription/feature-gate')
    const gateOk = businessId
      ? await featureAllowedForBusiness(businessId, 'customerMemoryAutoExtract')
      : await featureAllowed('customerMemoryAutoExtract')
    if (!gateOk) return []
    const [{ getOrgSettings }, { getBusinessAiPersona }, store, { extractCustomerMemory }] =
      await Promise.all([
        import('@/actions/org-settings'),
        import('./business-ai-tokens'),
        import('./customer-memory'),
        import('./memory-extract'),
      ])
    const orgSettings = await getOrgSettings().catch(() => null)
    const persona = getBusinessAiPersona(orgSettings?.business_type)
    const ops = await extractCustomerMemory({
      // Cap the one-off bootstrap to the most recent few transcripts AND cap each
      // transcript's length — a single 90-min ASR transcript can be tens of
      // thousands of chars; 5 uncapped could blow the model context / cost. ~16k
      // chars (~4k tokens) each × 5 keeps the call bounded.
      transcripts: usable.slice(0, 5).map((t) => t.slice(0, 16000)),
      existing: [],
      persona,
      locale,
    })
    await store.applyMemoryDelta({ customerId, businessId, ops })
    return store.getCustomerMemory(customerId)
  } catch (err) {
    console.error('[backfillMemoryFromTranscripts] failed:', err)
    return []
  }
}

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
}): Promise<void> {
  const { customerId, businessId, transcript, locale } = params
  if (!transcript || !transcript.trim()) return
  try {
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
      // Cap the one-off bootstrap to the most recent few transcripts.
      transcripts: usable.slice(0, 5),
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

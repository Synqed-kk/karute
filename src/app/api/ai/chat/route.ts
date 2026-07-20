import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { runKaruteChat, parseContextHint, capHistory, type ChatTurn } from '@/lib/ai/karute-chat'

export const maxDuration = 60

export async function POST(request: Request) {
  // Explicit fail-fast auth guard (defense-in-depth). Anon already fails closed
  // downstream via getBusinessId(), but reject before any rate-limit/data work.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limited = await enforceAiRateLimit('chat')
  if (limited) return limited
  try {
    const body = await request.json().catch(() => null)

    const message = body?.message
    if (typeof message !== 'string' || message.trim().length === 0 || message.length > 4000) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
    }

    const locale: 'en' | 'ja' = body?.locale === 'en' ? 'en' : 'ja'

    const rawHistory = Array.isArray(body?.history) ? body.history : []
    const history: ChatTurn[] = capHistory(
      rawHistory.filter(
        (h: unknown): h is ChatTurn =>
          !!h &&
          typeof (h as ChatTurn).content === 'string' &&
          ((h as ChatTurn).role === 'user' || (h as ChatTurn).role === 'assistant'),
      ),
    )

    // Store scope (#347 semantics): clamp a branch-restricted staff's AI context
    // to their assigned store. Filter ONLY when allowedStoreIds is non-null (a
    // clamped staff); viewAll + floating staff = null = no filter, so their
    // context is byte-identical to pre-change (owner sees all stores).
    const scope = await resolveStoreScope()
    const scopedStoreId =
      scope.allowedStoreIds !== null ? (scope.storeId ?? undefined) : undefined

    const contextHint = parseContextHint(body?.context_hint)
    const synqed = await getSynqedClient()

    // Reads from synqed-core org settings (a JSON blob). The builder resolves
    // the persona + business label from the raw value itself.
    const orgSettings = await getOrgSettings()

    // Context assembly + LLM call live in the shared core (design-parity F-9b)
    // so the facade twin can never drift from this route.
    const { reply, contextLabel, usage } = await runKaruteChat({
      synqed,
      message,
      history,
      locale,
      contextHint,
      scopedStoreId,
      businessType: orgSettings?.business_type ?? null,
    })

    if (usage) {
      void reportAiUsage('chat', usage.tokensIn, usage.tokensOut)
    }
    // context_label is omitted from the JSON when absent (no hint) → the
    // no-hint response body stays byte-identical.
    return NextResponse.json({ reply, context_label: contextLabel })
  } catch (error) {
    console.error('[/api/ai/chat]', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

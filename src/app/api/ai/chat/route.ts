import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { runKaruteChat, parseContextHint, capHistory, type ChatTurn } from '@/lib/ai/karute-chat'
import { auditWeb } from '@/lib/audit-web'

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
  if (limited) {
    // Rewrapped (not returned directly) so the CP7 audit-writer walker sees a
    // literal 4xx exit — status is always 429 here (enforceAiRateLimit's only
    // truthy return); body + headers (incl. Retry-After) preserved as-is. The
    // .catch guards a parse failure on the limiter's own body from escaping
    // this route's error envelope.
    return NextResponse.json(await limited.json().catch(() => ({ error: 'rate_limited' })), {
      status: 429,
      headers: limited.headers,
    })
  }
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
    // 監査ログ Wave W2 (Option A, Liam 7/28): one ai.consult_session row per
    // exchange, unconditional before the success response — exact parity
    // with the facade twin's hook emit incl. the first_turn/history_len
    // detail ("ONE row per session" canon: the first_turn row IS the
    // session row) and the clamped store as the row's store lens. Both
    // detail fields derive from the CLIENT-supplied history, post-capHistory
    // — display color, never authority: a session-count consumer must
    // re-derive from row sequence, not trust the flag.
    await auditWeb({
      category: 'ai',
      action: 'ai.consult_session',
      detail: { first_turn: history.length === 0, history_len: history.length },
      storeId: scopedStoreId,
      requestId: crypto.randomUUID(),
    })
    // context_label is omitted from the JSON when absent (no hint) → the
    // no-hint response body stays byte-identical.
    return NextResponse.json({ reply, context_label: contextLabel })
  } catch (error) {
    console.error('[/api/ai/chat]', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
